const express = require("express");
const router = express.Router();
// Updated Gemini API with latest gemini-2.0-flash model
// Using @google/generative-ai with new safety settings configuration
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { createCanvas, loadImage } = require("canvas");

// Supabase istemci oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

console.log(
  "🔑 Supabase Key Type:",
  process.env.SUPABASE_SERVICE_KEY ? "SERVICE_KEY" : "ANON_KEY"
);
console.log("🔑 Key starts with:", supabaseKey?.substring(0, 20) + "...");

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Görüntülerin geçici olarak saklanacağı klasörü oluştur
const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Referans resmini Supabase'e yükleyip URL alan fonksiyon
async function uploadReferenceImageToSupabase(imageUri, userId) {
  try {
    console.log("Referans resmi Supabase'e yükleniyor:", imageUri);

    let imageBuffer;

    // HTTP URL ise indir, değilse base64 olarak kabul et
    if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
      // HTTP URL - normal indirme
      const imageResponse = await axios.get(imageUri, {
        responseType: "arraybuffer",
      });
      imageBuffer = Buffer.from(imageResponse.data);
    } else if (imageUri.startsWith("data:image/")) {
      // Base64 data URL
      const base64Data = imageUri.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");
    } else {
      // file:// protokolü - Bu durumda frontend'den base64 data gönderilmeli
      throw new Error(
        "Yerel dosya path'i desteklenmemektedir. Lütfen resmin base64 data'sını gönderin."
      );
    }

    // Dosya adı oluştur
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `reference_${
      userId || "anonymous"
    }_${timestamp}_${randomId}.jpg`;

    console.log("Supabase'e yüklenecek dosya adı:", fileName);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Supabase yükleme hatası:", error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    console.log("Supabase yükleme başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log("Supabase public URL:", urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error("Referans resmi Supabase'e yüklenirken hata:", error);
    throw error;
  }
}

// Reference images'ları Supabase'e upload eden fonksiyon
async function uploadReferenceImagesToSupabase(referenceImages, userId) {
  try {
    console.log(
      "📤 Reference images Supabase'e yükleniyor...",
      referenceImages.length,
      "adet"
    );

    const uploadedUrls = [];

    for (let i = 0; i < referenceImages.length; i++) {
      const referenceImage = referenceImages[i];

      try {
        let imageSourceForUpload;

        // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
        if (referenceImage.base64) {
          imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
          console.log(`📤 Reference image ${i + 1}: Base64 data kullanılıyor`);
        } else if (
          referenceImage.uri.startsWith("http://") ||
          referenceImage.uri.startsWith("https://")
        ) {
          imageSourceForUpload = referenceImage.uri;
          console.log(`📤 Reference image ${i + 1}: HTTP URI kullanılıyor`);
        } else {
          console.log(
            `⚠️ Reference image ${i + 1}: Desteklenmeyen format, atlanıyor`
          );
          uploadedUrls.push(referenceImage.uri); // Fallback olarak original URI'yi kullan
          continue;
        }

        const uploadedUrl = await uploadReferenceImageToSupabase(
          imageSourceForUpload,
          userId
        );
        uploadedUrls.push(uploadedUrl);
        console.log(
          `✅ Reference image ${i + 1} başarıyla upload edildi:`,
          uploadedUrl
        );
      } catch (uploadError) {
        console.error(
          `❌ Reference image ${i + 1} upload hatası:`,
          uploadError.message
        );
        // Hata durumunda original URI'yi fallback olarak kullan
        uploadedUrls.push(referenceImage.uri);
      }
    }

    console.log(
      "📤 Toplam",
      uploadedUrls.length,
      "reference image URL'si hazırlandı"
    );
    return uploadedUrls;
  } catch (error) {
    console.error("❌ Reference images upload genel hatası:", error);
    // Fallback: Original URI'leri döndür
    return referenceImages.map((img) => img.uri);
  }
}

// Görsel oluşturma sonuçlarını veritabanına kaydetme fonksiyonu
async function saveGenerationToDatabase(
  userId,
  data,
  originalPrompt,
  referenceImageUrls, // Artık URL'ler gelecek
  settings = {},
  locationImage = null,
  poseImage = null,
  hairStyleImage = null,
  aspectRatio = "9:16",
  replicatePredictionId = null,
  processingTimeSeconds = null,
  isMultipleImages = false,
  isMultipleProducts = false
) {
  try {
    // User ID yoksa veya UUID formatında değilse, UUID oluştur
    let userIdentifier = userId;

    if (!userIdentifier || userIdentifier === "anonymous_user") {
      userIdentifier = uuidv4(); // UUID formatında anonymous user oluştur
      console.log("Yeni anonymous UUID oluşturuldu:", userIdentifier);
    } else if (
      !userIdentifier.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    ) {
      // Eğer gelen ID UUID formatında değilse, UUID'ye çevir veya yeni UUID oluştur
      console.log(
        "User ID UUID formatında değil, yeni UUID oluşturuluyor:",
        userIdentifier
      );
      userIdentifier = uuidv4();
    }

    const { data: insertData, error } = await supabase
      .from("reference_results")
      .insert([
        {
          user_id: userIdentifier,
          original_prompt: originalPrompt,
          enhanced_prompt: data.result.enhancedPrompt,
          result_image_url: data.result.imageUrl,
          reference_images: referenceImageUrls, // Artık Supabase URL'leri
          settings: settings,
          location_image: locationImage,
          pose_image: poseImage,
          hair_style_image: hairStyleImage,
          aspect_ratio: aspectRatio,
          replicate_prediction_id: replicatePredictionId,
          processing_time_seconds: processingTimeSeconds,
          is_multiple_images: isMultipleImages,
          is_multiple_products: isMultipleProducts,
          created_at: new Date().toISOString(),
        },
      ]);

    if (error) {
      console.error("Veritabanına kaydetme hatası:", error);
      return false;
    }

    console.log("Görsel başarıyla reference_results tablosuna kaydedildi");
    return true;
  } catch (dbError) {
    console.error("Veritabanı işlemi sırasında hata:", dbError);
    return false;
  }
}

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Aspect ratio formatını düzelten yardımcı fonksiyon
function formatAspectRatio(ratioStr) {
  const validRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

  try {
    if (!ratioStr || !ratioStr.includes(":")) {
      console.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // Eğer gelen değer geçerli bir ratio ise kullan
    if (validRatios.includes(ratioStr)) {
      console.log(`Gelen ratio değeri geçerli: ${ratioStr}`);
      return ratioStr;
    }

    // Piksel değerlerini orana çevir
    const [width, height] = ratioStr.split(":").map(Number);

    if (!width || !height || isNaN(width) || isNaN(height)) {
      console.log(
        `Geçersiz ratio değerleri: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // En yakın standart oranı bul
    const aspectRatio = width / height;
    let closestRatio = "9:16";
    let minDifference = Number.MAX_VALUE;

    for (const validRatio of validRatios) {
      const [validWidth, validHeight] = validRatio.split(":").map(Number);
      const validAspectRatio = validWidth / validHeight;
      const difference = Math.abs(aspectRatio - validAspectRatio);

      if (difference < minDifference) {
        minDifference = difference;
        closestRatio = validRatio;
      }
    }

    console.log(
      `Ratio ${ratioStr} için en yakın desteklenen değer: ${closestRatio}`
    );
    return closestRatio;
  } catch (error) {
    console.error(
      `Ratio formatı işlenirken hata oluştu: ${error.message}`,
      error
    );
    return "9:16";
  }
}

// Change color için prompt'u iyileştirmek için Gemini'yi kullan
async function enhanceChangeColorPrompt(
  originalPrompt,
  imageUrl,
  settings = {}
) {
  try {
    console.log(
      "🤖 Gemini 2.0 Flash ile change color prompt iyileştirme başlatılıyor"
    );
    console.log(
      "🔑 [CHANGE COLOR] Gemini API Key mevcut:",
      !!process.env.GEMINI_API_KEY
    );
    console.log(
      "🔑 [CHANGE COLOR] Gemini API Key başlangıcı:",
      process.env.GEMINI_API_KEY?.substring(0, 20) + "..."
    );

    // Gemini 2.0 Flash modeli - En yeni API yapısı
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_LOW_AND_ABOVE", // Block most
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_LOW_AND_ABOVE", // Block most
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_LOW_AND_ABOVE", // Block most
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_LOW_AND_ABOVE", // Block most
        },
      ],
      generationConfig: {
        responseMimeType: "text/plain",
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8000,
      },
    });

    // Consistent character için basit settings
    console.log("🎯 [CHANGE COLOR GEMINI] Settings kontrolü:", settings);

    // Change color için özel prompt hazırlama

    // Seçilen renk bilgisi
    const selectedColor = settings?.productColor || "original";

    // Renk değiştirme talimatları için basit prompt
    let promptForGemini = `
    Change the color of the main product/clothing/item in this image to ${
      selectedColor && selectedColor !== "original"
        ? selectedColor
        : "a different color"
    }. Keep everything else exactly the same - same person, pose, background, and lighting.
    
    ${originalPrompt ? `Additional: ${originalPrompt}` : ""}
    `;

    console.log("Gemini'ye gönderilen change color istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];
    console.log("🤖 [CHANGE COLOR] Initial parts array created with text");

    // Referans görseli Gemini'ye gönder
    try {
      console.log(
        `🖼️ [CHANGE COLOR] Referans görsel Gemini'ye gönderiliyor: ${imageUrl}`
      );

      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 10000, // 10 saniye timeout
      });
      const imageBuffer = imageResponse.data;
      console.log(
        `🖼️ [CHANGE COLOR] İmage buffer size: ${imageBuffer.length} bytes`
      );

      // Base64'e çevir
      const base64Image = Buffer.from(imageBuffer).toString("base64");
      console.log(
        `🖼️ [CHANGE COLOR] Base64 image size: ${base64Image.length} characters`
      );

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });

      console.log(
        "✅ [CHANGE COLOR] Referans görsel başarıyla Gemini'ye yüklendi"
      );
      console.log(`🖼️ [CHANGE COLOR] Total parts count: ${parts.length}`);
    } catch (imageError) {
      console.error(
        `❌ [CHANGE COLOR] Görsel yüklenirken hata: ${imageError.message}`
      );
      console.error(`❌ [CHANGE COLOR] ImageURL: ${imageUrl}`);
    }

    // Gemini'den cevap al (retry mekanizması ile) - Yeni API
    let enhancedPrompt;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🤖 [CHANGE COLOR] API çağrısı attempt ${attempt}/${maxRetries}`
        );
        console.log(
          `🤖 [CHANGE COLOR] Gönderilen parts sayısı: ${parts.length}`
        );

        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: parts,
            },
          ],
        });

        console.log(
          `🤖 [CHANGE COLOR] Gemini API response alındı, response keys:`,
          Object.keys(result)
        );
        console.log(
          `🤖 [CHANGE COLOR] Response.response keys:`,
          Object.keys(result.response)
        );

        // Debug: Candidates array'ini kontrol et
        console.log(
          `🤖 [CHANGE COLOR] Candidates sayısı:`,
          result.response.candidates?.length || 0
        );

        if (
          result.response.candidates &&
          result.response.candidates.length > 0
        ) {
          console.log(
            `🤖 [CHANGE COLOR] İlk candidate keys:`,
            Object.keys(result.response.candidates[0])
          );
          console.log(
            `🤖 [CHANGE COLOR] İlk candidate finishReason:`,
            result.response.candidates[0].finishReason
          );
        }

        // Önce text() metodunu dene, boşsa candidates'tan al
        let responseText = "";
        try {
          responseText = result.response.text().trim();
          console.log("🤖 [CHANGE COLOR] text() metodu kullanıldı");
        } catch (textError) {
          console.log(
            "🤖 [CHANGE COLOR] text() metodu başarısız, candidates kullanılıyor"
          );
        }

        // Eğer text() boşsa veya hata verdiyse candidates'tan al
        if (
          !responseText &&
          result.response.candidates &&
          result.response.candidates.length > 0
        ) {
          const candidate = result.response.candidates[0];
          if (
            candidate.content &&
            candidate.content.parts &&
            candidate.content.parts.length > 0
          ) {
            responseText = candidate.content.parts[0].text?.trim() || "";
            console.log(
              "🤖 [CHANGE COLOR] candidates[0].content.parts[0].text kullanıldı"
            );
          }
        }

        enhancedPrompt = responseText;

        // Eğer hala boşsa, safety filter olmuş olabilir
        if (!enhancedPrompt || enhancedPrompt.trim().length === 0) {
          console.log(
            "⚠️ [CHANGE COLOR] Gemini response boş - muhtemelen safety filter"
          );
          console.log(
            "⚠️ [CHANGE COLOR] Original prompt fallback kullanılıyor"
          );
          enhancedPrompt =
            originalPrompt ||
            "Change the color of the main item in this image.";
        }

        console.log(
          "🤖 [CHANGE COLOR] Gemini'nin ürettiği change color prompt:",
          enhancedPrompt
        );
        console.log(
          "🤖 [CHANGE COLOR] Enhanced prompt uzunluğu:",
          enhancedPrompt.length
        );
        break; // Başarılı olursa loop'tan çık
      } catch (geminiError) {
        console.error(
          `❌ [CHANGE COLOR] Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );
        console.error(`❌ [CHANGE COLOR] Gemini error details:`, geminiError);

        if (attempt === maxRetries) {
          console.error(
            "❌ [CHANGE COLOR] All Gemini attempts failed, using original prompt"
          );
          enhancedPrompt = originalPrompt;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`⏳ [CHANGE COLOR] Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("🤖 Gemini 2.0 Flash prompt iyileştirme hatası:", error);
    return originalPrompt;
  }
}

// Replicate prediction durumunu kontrol eden fonksiyon
async function pollReplicateResult(predictionId, maxAttempts = 60) {
  console.log(`Replicate prediction polling başlatılıyor: ${predictionId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "json",
        }
      );

      const result = response.data;
      console.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        console.log("Replicate işlemi başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("Replicate işlemi başarısız:", result.error);

        // Sensitive content hatasını kontrol et
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("flagged as sensitive") ||
            result.error.includes("E005") ||
            result.error.includes("sensitive content"))
        ) {
          console.error(
            "❌ Sensitive content hatası tespit edildi, polling durduruluyor"
          );
          throw new Error(
            "SENSITIVE_CONTENT: Your content has been flagged as inappropriate. Please try again with a different image or settings."
          );
        }

        throw new Error(result.error || "Replicate processing failed");
      } else if (result.status === "canceled") {
        console.error("Replicate işlemi iptal edildi");
        throw new Error("Replicate processing was canceled");
      }

      // Processing veya starting durumundaysa bekle
      if (result.status === "processing" || result.status === "starting") {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 saniye bekle
        continue;
      }
    } catch (error) {
      console.error(`Polling attempt ${attempt + 1} hatası:`, error.message);

      // Sensitive content hatasını özel olarak handle et
      if (error.message.startsWith("SENSITIVE_CONTENT:")) {
        console.error("❌ Sensitive content hatası, polling durduruluyor");
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // Eğer hata "failed" status'dan kaynaklanıyorsa derhal durdur
      if (
        error.message.includes("Replicate processing failed") ||
        error.message.includes("processing was canceled")
      ) {
        console.error(
          "❌ Replicate işlemi başarısız/iptal, polling durduruluyor"
        );
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // Sadece network/connection hatalarında retry yap
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Replicate işlemi zaman aşımına uğradı");
}

// Çoklu resimleri canvas ile birleştiren fonksiyon
async function combineImagesOnCanvas(
  images,
  userId,
  isMultipleProducts = false
) {
  try {
    console.log(
      "🎨 Canvas ile resim birleştirme başlatılıyor...",
      images.length,
      "resim"
    );
    console.log("🛍️ Çoklu ürün modu:", isMultipleProducts);

    // Canvas boyutları
    let canvasWidth = 0;
    let canvasHeight = 0;
    const loadedImages = [];

    // Tüm resimleri yükle ve boyutları hesapla
    for (let i = 0; i < images.length; i++) {
      const imgData = images[i];
      let imageBuffer;

      try {
        // Base64 veya HTTP URL'den resmi yükle
        if (imgData.base64) {
          console.log(`📐 Resim ${i + 1}: Base64 formatından yükleniyor`);
          imageBuffer = Buffer.from(imgData.base64, "base64");
        } else if (
          imgData.uri.startsWith("http://") ||
          imgData.uri.startsWith("https://")
        ) {
          console.log(
            `📐 Resim ${i + 1}: HTTP URL'den yükleniyor: ${imgData.uri}`
          );
          const response = await axios.get(imgData.uri, {
            responseType: "arraybuffer",
            timeout: 10000, // 10 saniye timeout
          });
          imageBuffer = Buffer.from(response.data);
        } else if (imgData.uri.startsWith("file://")) {
          throw new Error("Yerel dosya için base64 data gönderilmelidir.");
        } else {
          throw new Error(`Desteklenmeyen URI formatı: ${imgData.uri}`);
        }

        // Sharp ile resmi önce işle (format uyumluluk için)
        console.log(`🔄 Resim ${i + 1}: Sharp ile preprocessing yapılıyor...`);
        const processedBuffer = await sharp(imageBuffer)
          .jpeg({ quality: 90 }) // JPEG formatına çevir
          .toBuffer();

        // Metadata'yı al
        const metadata = await sharp(processedBuffer).metadata();
        console.log(
          `📐 Resim ${i + 1}: ${metadata.width}x${metadata.height} (${
            metadata.format
          })`
        );

        // Canvas için loadImage kullan
        const img = await loadImage(processedBuffer);
        loadedImages.push(img);

        console.log(
          `✅ Resim ${i + 1} başarıyla yüklendi: ${img.width}x${img.height}`
        );
      } catch (imageError) {
        console.error(
          `❌ Resim ${i + 1} yüklenirken hata:`,
          imageError.message
        );

        // Fallback: Resmi atla ve devam et
        console.log(
          `⏭️ Resim ${i + 1} atlanıyor, diğer resimlerle devam ediliyor...`
        );
        continue;
      }
    }

    // Eğer hiç resim yüklenemezse hata fırlat
    if (loadedImages.length === 0) {
      throw new Error(
        "Hiçbir resim başarıyla yüklenemedi. Lütfen farklı resimler deneyin."
      );
    }

    console.log(`✅ Toplam ${loadedImages.length} resim başarıyla yüklendi`);

    // Canvas değişkenini tanımla
    let canvas;

    if (isMultipleProducts) {
      // Çoklu ürün modu: Yan yana birleştir
      console.log("🛍️ Çoklu ürün modu: Resimler yan yana birleştirilecek");

      // Her resmi aynı yüksekliğe getir
      const targetHeight = Math.min(...loadedImages.map((img) => img.height));

      // Toplam genişlik ve sabit yükseklik hesapla
      canvasWidth = loadedImages.reduce((total, img) => {
        const scaledWidth = (img.width * targetHeight) / img.height;
        return total + scaledWidth;
      }, 0);
      canvasHeight = targetHeight;

      console.log(
        `📏 Çoklu ürün canvas boyutu: ${canvasWidth}x${canvasHeight}`
      );

      // Canvas oluştur
      canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");

      // Beyaz arka plan
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Resimleri yan yana yerleştir
      let currentX = 0;
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const scaledWidth = (img.width * targetHeight) / img.height;

        ctx.drawImage(img, currentX, 0, scaledWidth, targetHeight);
        currentX += scaledWidth;

        console.log(
          `🖼️ Ürün ${i + 1} yerleştirildi: (${
            currentX - scaledWidth
          }, 0) - ${scaledWidth}x${targetHeight}`
        );
      }
    } else {
      // Normal mod: Alt alta birleştir (mevcut mantık)
      console.log("📚 Normal mod: Resimler alt alta birleştirilecek");

      canvasWidth = Math.max(...loadedImages.map((img) => img.width));
      canvasHeight = loadedImages.reduce((total, img) => total + img.height, 0);

      console.log(`📏 Normal canvas boyutu: ${canvasWidth}x${canvasHeight}`);

      // Canvas oluştur
      canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");

      // Beyaz arka plan
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Resimleri dikey olarak sırala
      let currentY = 0;
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const x = (canvasWidth - img.width) / 2; // Ortala

        ctx.drawImage(img, x, currentY);
        currentY += img.height;

        console.log(
          `🖼️ Resim ${i + 1} yerleştirildi: (${x}, ${currentY - img.height})`
        );
      }
    }

    // Canvas'ı buffer'a çevir
    const buffer = canvas.toBuffer("image/jpeg", { quality: 0.8 });
    console.log("📊 Birleştirilmiş resim boyutu:", buffer.length, "bytes");

    // Supabase'e yükle
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `combined_${isMultipleProducts ? "products" : "images"}_${
      userId || "anonymous"
    }_${timestamp}_${randomId}.jpg`;

    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, buffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("❌ Birleştirilmiş resim Supabase'e yüklenemedi:", error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log("✅ Birleştirilmiş resim Supabase URL'si:", urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error("❌ Canvas birleştirme hatası:", error);
    throw error;
  }
}

// Ana change color generate endpoint'i
router.post("/change-color/generate", async (req, res) => {
  // Kredi kontrolü ve düşme
  const CREDIT_COST = 20; // Her oluşturma 5 kredi
  let creditDeducted = false;
  let userId; // Scope için önceden tanımla

  try {
    const {
      ratio,
      promptText,
      referenceImages,
      settings,
      userId: requestUserId,
    } = req.body;

    // userId'yi scope için ata
    userId = requestUserId;

    console.log("🎯 [CHANGE COLOR] Change color generation başlatılıyor");
    console.log(
      "📤 [CHANGE COLOR] Gelen referenceImages:",
      referenceImages?.length || 0,
      "adet"
    );

    if (
      !promptText ||
      !referenceImages ||
      !Array.isArray(referenceImages) ||
      referenceImages.length < 1
    ) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Geçerli bir promptText ve en az 1 referenceImage sağlanmalıdır.",
        },
      });
    }

    if (userId && userId !== "anonymous_user") {
      try {
        console.log(`💳 Kullanıcı ${userId} için kredi kontrolü yapılıyor...`);

        // Krediyi atomic olarak düş (row locking ile)
        const { data: updatedUsers, error: deductError } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        if (deductError) {
          console.error("❌ Kredi sorgulama hatası:", deductError);
          return res.status(500).json({
            success: false,
            result: {
              message: "Kredi sorgulama sırasında hata oluştu",
              error: deductError.message,
            },
          });
        }

        const currentCreditCheck = updatedUsers?.credit_balance || 0;
        if (currentCreditCheck < CREDIT_COST) {
          return res.status(402).json({
            success: false,
            result: {
              message: "Yetersiz kredi. Lütfen kredi satın alın.",
              currentCredit: currentCreditCheck,
              requiredCredit: CREDIT_COST,
            },
          });
        }

        // Krediyi düş
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCreditCheck - CREDIT_COST })
          .eq("id", userId)
          .eq("credit_balance", currentCreditCheck); // Optimistic locking

        if (updateError) {
          console.error("❌ Kredi düşme hatası:", updateError);
          return res.status(500).json({
            success: false,
            result: {
              message:
                "Kredi düşme sırasında hata oluştu (başka bir işlem krediyi değiştirdi)",
              error: updateError.message,
            },
          });
        }

        creditDeducted = true;
        console.log(
          `✅ ${CREDIT_COST} kredi başarıyla düşüldü. Yeni bakiye: ${
            currentCreditCheck - CREDIT_COST
          }`
        );
      } catch (creditManagementError) {
        console.error("❌ Kredi yönetimi hatası:", creditManagementError);
        return res.status(500).json({
          success: false,
          result: {
            message: "Kredi yönetimi sırasında hata oluştu",
            error: creditManagementError.message,
          },
        });
      }
    }

    console.log("🎛️ [CHANGE COLOR] Gelen settings parametresi:", settings);
    console.log("📝 [CHANGE COLOR] Gelen promptText:", promptText);

    // Change color için tek resim işleme
    const referenceImage = referenceImages[0];

    if (!referenceImage) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Referans görseli gereklidir.",
        },
      });
    }

    console.log("🎯 [CHANGE COLOR] Referans görseli:", referenceImage.uri);

    // Referans resmini önce Supabase'e yükle ve URL al
    let imageSourceForUpload;

    // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
    if (referenceImage.base64) {
      imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
      console.log(
        "🎯 [CHANGE COLOR] Base64 data kullanılıyor Supabase upload için"
      );
    } else if (
      referenceImage.uri.startsWith("http://") ||
      referenceImage.uri.startsWith("https://")
    ) {
      imageSourceForUpload = referenceImage.uri;
      console.log(
        "🎯 [CHANGE COLOR] HTTP URI kullanılıyor Supabase upload için:",
        imageSourceForUpload
      );
    } else {
      // file:// protokolü için frontend'de base64 dönüştürme zorunlu
      return res.status(400).json({
        success: false,
        result: {
          message: "Yerel dosya için base64 data gönderilmelidir.",
        },
      });
    }

    const finalImage = await uploadReferenceImageToSupabase(
      imageSourceForUpload,
      userId
    );

    console.log("Supabase'den alınan final resim URL'si:", finalImage);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile change color için iyileştir
    const enhancedPrompt = await enhanceChangeColorPrompt(
      promptText,
      finalImage,
      settings || {}
    );

    console.log("📝 [CHANGE COLOR] Original prompt:", promptText);
    console.log(
      "✨ [CHANGE COLOR] Enhanced change color prompt:",
      enhancedPrompt
    );
    console.log(
      "📏 [CHANGE COLOR] Enhanced prompt uzunluğu:",
      enhancedPrompt?.length || 0
    );
    console.log(
      "❓ [CHANGE COLOR] Enhanced prompt boş mu?:",
      !enhancedPrompt || enhancedPrompt.trim().length === 0
    );

    // Replicate API'ye istek gönder
    console.log("🚀 [CHANGE COLOR] Replicate'e gönderilecek data:");
    console.log("   - prompt:", enhancedPrompt);
    console.log("   - input_image:", finalImage);
    console.log("   - aspect_ratio:", formattedRatio);

    const replicateResponse = await axios.post(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions",
      {
        input: {
          prompt: enhancedPrompt,
          input_image: finalImage,
          aspect_ratio: formattedRatio,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const initialResult = replicateResponse.data;
    console.log("Replicate API başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error("Replicate prediction ID alınamadı:", initialResult);

      // Kredi iade et
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
            })
            .eq("id", userId);

          console.log(
            `💰 ${CREDIT_COST} kredi iade edildi (Prediction ID hatası)`
          );
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "Replicate prediction başlatılamadı",
          error: initialResult.error || "Prediction ID missing",
        },
      });
    }

    // Prediction durumunu polling ile takip et
    const startTime = Date.now();
    const finalResult = await pollReplicateResult(initialResult.id);
    const processingTime = Math.round((Date.now() - startTime) / 1000);

    console.log("Replicate final result:", finalResult);

    if (finalResult.status === "succeeded" && finalResult.output) {
      console.log("Replicate API işlemi başarılı");

      // 💳 API başarılı olduktan sonra güncel kredi bilgisini al
      let currentCredit = null;
      if (userId && userId !== "anonymous_user") {
        try {
          const { data: updatedUser } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          currentCredit = updatedUser?.credit_balance || 0;
          console.log(`💳 Güncel kredi balance: ${currentCredit}`);
        } catch (creditError) {
          console.error("❌ Güncel kredi sorgu hatası:", creditError);
        }
      }

      // 📤 Reference images'ları Supabase'e upload et
      console.log("📤 Reference images Supabase'e upload ediliyor...");
      const referenceImageUrls = await uploadReferenceImagesToSupabase(
        referenceImages,
        userId
      );

      const responseData = {
        success: true,
        result: {
          imageUrl: finalResult.output,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
          replicateData: finalResult,
          currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
        },
      };

      await saveGenerationToDatabase(
        userId,
        responseData,
        promptText,
        referenceImageUrls, // Artık Supabase URL'leri
        settings,
        null, // locationImage
        null, // poseImage
        null, // hairStyleImage
        formattedRatio,
        initialResult.id,
        processingTime,
        false, // isMultipleImages
        false // isMultipleProducts
      );

      return res.status(200).json(responseData);
    } else {
      console.error("Replicate API başarısız:", finalResult);

      // Kredi iade et
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
            })
            .eq("id", userId);

          console.log(`💰 ${CREDIT_COST} kredi iade edildi (Replicate hatası)`);
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "Replicate API işlemi başarısız oldu",
          error: finalResult.error || "Bilinmeyen hata",
          status: finalResult.status,
        },
      });
    }
  } catch (error) {
    console.error("Resim oluşturma hatası:", error);

    // Kredi iade et
    if (creditDeducted && userId && userId !== "anonymous_user") {
      try {
        const { data: currentUserCredit } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        await supabase
          .from("users")
          .update({
            credit_balance:
              (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
          })
          .eq("id", userId);

        console.log(`💰 ${CREDIT_COST} kredi iade edildi (Genel hata)`);
      } catch (refundError) {
        console.error("❌ Kredi iade hatası:", refundError);
      }
    }

    // Sensitive content hatasını özel olarak handle et
    if (error.message && error.message.startsWith("SENSITIVE_CONTENT:")) {
      const cleanMessage = error.message.replace("SENSITIVE_CONTENT: ", "");
      return res.status(400).json({
        success: false,
        result: {
          message: cleanMessage,
          error_type: "sensitive_content",
          user_friendly: true,
        },
      });
    }

    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının change color sonuçlarını getiren endpoint
router.get("/change-color/results/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    const offset = (page - 1) * limit;

    // Kullanıcının sonuçlarını getir (en yeni önce)
    const { data: results, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("❌ Sonuçları getirme hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Sonuçları getirirken hata oluştu",
          error: error.message,
        },
      });
    }

    // Toplam sayıyı getir
    const { count, error: countError } = await supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      console.error("❌ Toplam sayı getirme hatası:", countError);
    }

    return res.status(200).json({
      success: true,
      result: {
        data: results || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: offset + limit < (count || 0),
      },
    });
  } catch (error) {
    console.error("❌ Change color results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Tüm change color sonuçlarını getiren endpoint (admin için)
router.get("/change-color/results", async (req, res) => {
  try {
    const { page = 1, limit = 50, userId } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from("reference_results")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Eğer userId filter'ı varsa ekle
    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: results, error } = await query;

    if (error) {
      console.error("❌ Tüm sonuçları getirme hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Sonuçları getirirken hata oluştu",
          error: error.message,
        },
      });
    }

    // Toplam sayıyı getir
    let countQuery = supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true });

    if (userId) {
      countQuery = countQuery.eq("user_id", userId);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error("❌ Toplam sayı getirme hatası:", countError);
    }

    return res.status(200).json({
      success: true,
      result: {
        data: results || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: offset + limit < (count || 0),
      },
    });
  } catch (error) {
    console.error("❌ All change color results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının mevcut kredisini getiren endpoint
router.get("/change-color/credit/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || userId === "anonymous_user") {
      return res.status(200).json({
        success: true,
        result: {
          credit: 0, // Anonymous kullanıcılar için sınırsız (veya 0 göster)
          isAnonymous: true,
        },
      });
    }

    const { data: userCredit, error } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ Kredi sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Kredi sorgulama sırasında hata oluştu",
          error: error.message,
        },
      });
    }

    return res.status(200).json({
      success: true,
      result: {
        credit: userCredit?.credit_balance || 0,
        isAnonymous: false,
      },
    });
  } catch (error) {
    console.error("❌ Kredi endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Kredi bilgisi alınırken hata oluştu",
        error: error.message,
      },
    });
  }
});

module.exports = router;
