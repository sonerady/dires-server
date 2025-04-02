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
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res
      .status(400)
      .json({ success: false, message: "Image URL is required" });
  }

  try {
    console.log("Replicate API ile arkaplan kaldırma başlatılıyor:", imageUrl);
    console.log(
      "REPLICATE_API_TOKEN:",
      process.env.REPLICATE_API_TOKEN
        ? "Mevcut (uzunluk: " + process.env.REPLICATE_API_TOKEN.length + ")"
        : "Eksik"
    );

    // Replicate prediction oluştur
    console.log("Prediction oluşturuluyor...");
    const prediction = await predictions.create({
      version:
        "4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
      input: { image: imageUrl },
    });

    console.log("Prediction ID:", prediction.id);

    // Prediction'ın tamamlanmasını bekle
    const completedPrediction = await waitForPredictionToComplete(
      prediction.id,
      120000, // 2 dakika timeout
      3000 // 3 saniyede bir kontrol
    );

    console.log("Completed prediction:", completedPrediction);

    if (!completedPrediction.output) {
      throw new Error("Replicate API'den geçerli bir yanıt alınamadı");
    }

    // Çıktıyı al
    const output = completedPrediction.output;
    console.log("Çıktı alındı:", output);

    // Başarılı yanıtı döndür
    res.status(200).json({
      success: true,
      removedBgUrl: output,
      originalUrl: imageUrl,
      result: {
        removed_bg_url: output,
      },
    });
  } catch (error) {
    console.error("Replicate API ile arkaplan kaldırma hatası:", error);
    console.error("Hata detayları:", error.stack);
    res.status(500).json({
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

          // Use Sharp to ensure the output is in PNG format without altering the background
          const processedBuffer = await sharp(buffer)
            .png() // Ensure the output is in PNG format
            .toBuffer();

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
