// Required modules
const express = require("express");
const supabase = require("../supabaseClient");
const Replicate = require("replicate");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const sharp = require("sharp"); // Import Sharp

const upload = multer();
const router = express.Router();

// Transparent pikselleri trim eden yardımcı fonksiyon
async function trimTransparentPixels(imageBuffer) {
  try {
    const image = sharp(imageBuffer);
    const { width, height, channels } = await image.metadata();

    // Eğer alpha kanalı yoksa, direkt buffer'ı döndür
    if (channels < 4) {
      return imageBuffer;
    }

    // Resmi raw data olarak al
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });

    // Transparent olmayan piksellerin sınırlarını bul
    let minX = width,
      maxX = -1;
    let minY = height,
      maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;
        const alpha = data[pixelIndex + 3]; // Alpha kanalı

        // Eğer piksel transparent değilse (alpha > 0)
        if (alpha > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Eğer hiç opaque piksel bulunamadıysa, orijinal resmi döndür
    if (maxX === -1 || maxY === -1) {
      return imageBuffer;
    }

    // Küçük bir padding ekle (opsiyonel)
    const padding = 2;
    const cropLeft = Math.max(0, minX - padding);
    const cropTop = Math.max(0, minY - padding);
    const cropWidth = Math.min(width - cropLeft, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(
      height - cropTop,
      maxY - minY + 1 + padding * 2
    );

    // Trim edilmiş resmi oluştur
    const trimmedBuffer = await image
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .png()
      .toBuffer();

    console.log(
      `🎯 Trim işlemi: ${width}x${height} → ${cropWidth}x${cropHeight}`
    );

    return trimmedBuffer;
  } catch (error) {
    console.warn(
      "⚠️ Trim işlemi başarısız, orijinal resim kullanılıyor:",
      error.message
    );
    return imageBuffer;
  }
}

// Replicate API client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Replicate predictions API
const predictions = replicate.predictions;

// Prediction tamamlana kadar bekleme fonksiyonu
async function waitForPredictionToComplete(
  predictionId,
  timeout = 50000,
  interval = 2000
) {
  const startTime = Date.now();
  console.log(`Prediction ${predictionId} bekleniyor...`);

  while (true) {
    const currentPrediction = await predictions.get(predictionId);
    console.log(
      `Prediction ${predictionId} durumu: ${currentPrediction.status}`
    );

    if (currentPrediction.status === "succeeded") {
      console.log(`Prediction ${predictionId} tamamlandı.`);
      return currentPrediction;
    } else if (
      currentPrediction.status === "failed" ||
      currentPrediction.status === "canceled"
    ) {
      throw new Error(`Prediction ${predictionId} failed or was canceled.`);
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(`Prediction ${predictionId} timed out.`);
    }

    await new Promise((res) => setTimeout(res, interval));
  }
}

// URL'den arkaplan kaldırma için yeni endpoint
router.post("/remove-background", async (req, res) => {
  const { imageUrl, userId } = req.body || {};

  if (!imageUrl) {
    return res
      .status(400)
      .json({ success: false, message: "Image URL is required" });
  }

  try {
    console.log("🖼️ Arkaplan kaldırma başlatılıyor:", imageUrl);
    console.log(
      "REPLICATE_API_TOKEN:",
      process.env.REPLICATE_API_TOKEN
        ? `Mevcut (uzunluk: ${process.env.REPLICATE_API_TOKEN.length})`
        : "Eksik"
    );

    // 1) Orijinal görsel metadata (orientation) al
    let originalMetadata = null;
    try {
      console.log("📐 Orijinal fotoğrafın metadata bilgileri alınıyor...");
      const originalResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      const originalImageBuffer = Buffer.from(originalResponse.data);
      originalMetadata = await sharp(originalImageBuffer).metadata();
      console.log("📐 Orijinal metadata:", {
        width: originalMetadata.width,
        height: originalMetadata.height,
        orientation: originalMetadata.orientation,
        format: originalMetadata.format,
      });
    } catch (metaErr) {
      console.warn("⚠️ Orijinal metadata alınamadı:", metaErr.message);
    }

    // 2) Replicate prediction oluştur
    console.log("🧠 Replicate prediction oluşturuluyor...");
    const prediction = await predictions.create({
      // referenceBrowserRoutesV2.js mantığına uygun model ve inputlar
      version:
        "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
      input: {
        image: imageUrl,
        format: "png",
        reverse: false,
        threshold: 0,
        background_type: "rgba",
      },
    });
    console.log("🔖 Prediction ID:", prediction.id);

    // 3) Prediction'ı bekle
    const completedPrediction = await waitForPredictionToComplete(
      prediction.id,
      120000,
      3000
    );

    if (!completedPrediction.output) {
      throw new Error("Replicate API'den geçerli bir yanıt alınamadı");
    }

    const replicateOutputUrl = completedPrediction.output;
    console.log("✅ Replicate çıktı URL:", replicateOutputUrl);

    // 4) Çıktıyı indir, orientation düzelt, trim uygula ve Supabase'e yükle
    let processedBuffer;
    let trimmedMetadata = null;
    try {
      const processedResp = await axios.get(replicateOutputUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      let tmpBuffer = Buffer.from(processedResp.data);

      let pipeline = sharp(tmpBuffer).png();
      // Orientation düzeltmesi (sık kullanılan değerler)
      if (originalMetadata && originalMetadata.orientation) {
        const o = originalMetadata.orientation;
        if (o === 3) pipeline = pipeline.rotate(180);
        else if (o === 6) pipeline = pipeline.rotate(90); // CW
        else if (o === 8) pipeline = pipeline.rotate(270); // CCW
        // Diğer orientation türleri (2,4,5,7) nadir; ihtiyaç olursa eklenir
      }

      let orientationFixedBuffer = await pipeline.toBuffer();

      // Transparent pikselleri trim et
      console.log("🎯 Transparent trimming işlemi başlatılıyor...");
      processedBuffer = await trimTransparentPixels(orientationFixedBuffer);

      // Trim sonrası yeni boyutları al
      trimmedMetadata = await sharp(processedBuffer).metadata();
    } catch (procErr) {
      console.warn("⚠️ İşlenen resmi indirirken/işlerken hata:", procErr);
      // Fallback: Replicate URL'ini direkt döndürelim
      return res.status(200).json({
        success: true,
        removedBgUrl: replicateOutputUrl,
        originalUrl: imageUrl,
        result: { removed_bg_url: replicateOutputUrl },
      });
    }

    // 5) Supabase'e yükle ve public URL al
    const fileName = `${uuidv4()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, processedBuffer, {
        contentType: "image/png",
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage.from("images").getPublicUrl(fileName);
    if (publicUrlError) throw publicUrlError;

    const publicUrl = publicUrlData.publicUrl;

    return res.status(200).json({
      success: true,
      removedBgUrl: publicUrl,
      originalUrl: imageUrl,
      result: {
        removed_bg_url: publicUrl,
        trimmed_width: trimmedMetadata?.width,
        trimmed_height: trimmedMetadata?.height,
      },
    });
  } catch (error) {
    console.error("❌ Arkaplan kaldırma hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Arkaplan kaldırma işlemi sırasında bir hata oluştu",
      error: error.message || "Unknown error",
    });
  }
});

router.post("/remove-bg", upload.array("files", 20), async (req, res) => {
  const files = req.files;
  const { user_id, image_url } = req.body; // Retain user_id and image_url if needed

  console.log("image_url", image_url);

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "Dosya gerekli." });
  }

  try {
    const signedUrls = [];
    const removeBgResults = [];

    // 1. Upload files to Supabase storage
    for (const file of files) {
      const fileName = `${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from("images")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (error) throw error;

      const { data: publicUrlData, error: publicUrlError } =
        await supabase.storage.from("images").getPublicUrl(fileName);

      if (publicUrlError) throw publicUrlError;

      signedUrls.push(publicUrlData.publicUrl);
    }

    // 2. Background removal process
    let processingFailed = false; // Flag to track if any processing fails

    for (const url of signedUrls) {
      try {
        // Prediction oluştur
        const prediction = await predictions.create({
          version:
            "4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
          input: { image: url },
        });

        // Prediction'ın tamamlanmasını bekle
        const completedPrediction = await waitForPredictionToComplete(
          prediction.id,
          120000, // 2 dakika timeout
          3000 // 3 saniyede bir kontrol
        );

        if (completedPrediction.output) {
          removeBgResults.push(completedPrediction.output);
        } else {
          console.error("Çıktı alınamadı");
          removeBgResults.push({ error: "Çıktı alınamadı" });
          processingFailed = true;
        }
      } catch (error) {
        console.error("Arka plan kaldırma hatası:", error);
        removeBgResults.push({ error: error.message || "Unknown error" });
        processingFailed = true; // Set flag if any processing fails
      }
    }

    // After processing all images, check if any failed
    if (processingFailed) {
      return res.status(500).json({
        message: "Arka plan kaldırma işlemi sırasında bir hata oluştu.",
        removeBgResults,
      });
    }

    // Array to store processed image URLs
    const processedImageUrls = [];

    // 3. Upload processed images to Supabase and prepare for response
    for (const imageUrl of removeBgResults) {
      if (typeof imageUrl === "string") {
        try {
          // Download the image
          const response = await axios({
            method: "get",
            url: imageUrl,
            responseType: "arraybuffer",
          });

          const buffer = Buffer.from(response.data, "binary");

          // Use Sharp to ensure the output is in PNG format and trim transparent pixels
          let pngBuffer = await sharp(buffer)
            .png() // Ensure the output is in PNG format
            .toBuffer();

          // Transparent pikselleri trim et
          console.log(
            "🎯 Batch processing - Transparent trimming işlemi başlatılıyor..."
          );
          const processedBuffer = await trimTransparentPixels(pngBuffer);

          const fileName = `${uuidv4()}.png`;

          // Upload to Supabase
          const { data: uploadData, error: uploadError } =
            await supabase.storage
              .from("images") // Use an existing bucket
              .upload(fileName, processedBuffer, {
                contentType: "image/png",
              });

          if (uploadError) throw uploadError;

          // Get public URL
          const { data: publicUrlData, error: publicUrlError } =
            await supabase.storage.from("images").getPublicUrl(fileName);

          if (publicUrlError) throw publicUrlError;

          // Add URL to array
          processedImageUrls.push(publicUrlData.publicUrl);
        } catch (err) {
          console.error("Resim işleme hatası:", err);
          // Optionally, handle individual image processing errors
          // You might decide to set processingFailed = true; here if critical
        }
      } else {
        console.error("Geçersiz resim verisi:", imageUrl);
      }
    }

    // Check if any processedImageUrls were successfully created
    if (processedImageUrls.length === 0) {
      throw new Error("Hiçbir resim başarıyla işlendi.");
    }

    res.status(200).json({
      message: "Resimler başarıyla işlendi ve arka planları kaldırıldı.",
      processedImageUrls,
    });
  } catch (error) {
    console.error("İşlem başarısız:", error);

    res
      .status(500)
      .json({ message: "İşlem başarısız.", error: error.message || error });
  }
});

module.exports = router;
