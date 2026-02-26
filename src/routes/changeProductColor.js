const express = require("express");
const router = express.Router();
// Updated: Using Google Gemini API for prompt generation
const { GoogleGenAI } = require("@google/genai");
const mime = require("mime");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { createCanvas, loadImage } = require("canvas");
const {
  sendGenerationCompletedNotification,
} = require("../services/pushNotificationService");
const teamService = require("../services/teamService");
const logger = require("../utils/logger");
const { optimizeImageUrl } = require("../utils/imageOptimizer");

// Supabase istemci oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

logger.log(
  "🔑 Supabase Key Type:",
  process.env.SUPABASE_SERVICE_KEY ? "SERVICE_KEY" : "ANON_KEY"
);
logger.log("🔑 Key starts with:", supabaseKey?.substring(0, 20) + "...");

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Gemini API setup
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Replicate API üzerinden Gemini 2.5 Flash çağrısı yapan helper fonksiyon
// Hata durumunda 3 kez tekrar dener
async function callReplicateGeminiFlash(
  prompt,
  imageUrls = [],
  maxRetries = 3
) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(
        `🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`
      );

      // Debug: Request bilgilerini logla
      logger.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      logger.log(
        `🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`
      );

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls, // Direkt URL string array olarak gönder
          prompt: prompt,
          videos: [],
          temperature: 1,
          thinking_level: "low",
          max_output_tokens: 65535,
        },
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 120000, // 2 dakika timeout
        }
      );

      const data = response.data;

      // Hata kontrolü
      if (data.error) {
        console.error(`❌ [REPLICATE-GEMINI] API error:`, data.error);
        throw new Error(data.error);
      }

      // Status kontrolü
      if (data.status !== "succeeded") {
        console.error(
          `❌ [REPLICATE-GEMINI] Prediction failed with status:`,
          data.status
        );
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      // Output'u birleştir (array olarak geliyor)
      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        console.error(`❌ [REPLICATE-GEMINI] Empty response`);
        throw new Error("Replicate Gemini response is empty");
      }

      logger.log(
        `✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`
      );
      logger.log(`📊 [REPLICATE-GEMINI] Metrics:`, data.metrics);

      return outputText.trim();
    } catch (error) {
      console.error(
        `❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === maxRetries) {
        console.error(
          `❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`
        );
        throw error;
      }

      // Retry öncesi kısa bekleme (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// @fal-ai/client import for GPT Image 1.5
const { fal } = require("@fal-ai/client");
fal.config({
  credentials: process.env.FAL_API_KEY,
});

// Fal.ai GPT Image 1.5 Edit API call using SDK (for Refiner mode - Ghost Mannequin style)
async function callFalAiGptImageEditForRefiner(
  prompt,
  imageUrl,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(
        `🎨 [FAL_AI_GPT_REFINER] Image generation attempt ${attempt}/${maxRetries}`
      );
      logger.log(
        `🎨 [FAL_AI_GPT_REFINER] Prompt: ${prompt.substring(0, 100)}...`
      );

      // fal.queue.submit ile GPT Image 1.5'e istek gönder
      const { request_id } = await fal.queue.submit(
        "fal-ai/gpt-image-1.5/edit",
        {
          input: {
            prompt: prompt,
            image_urls: [imageUrl], // Single image for refiner
            image_size: "1024x1536", // Portrait size for e-commerce - ALWAYS fixed regardless of user ratio
            quality: "medium", // medium for balanced quality/speed
            input_fidelity: "high", // preserve product details
            num_images: 1,
            output_format: "jpeg",
          },
        }
      );

      if (!request_id) {
        throw new Error("Fal.ai did not return a request_id");
      }

      logger.log(
        `⏳ [FAL_AI_GPT_REFINER] Request submitted, request_id: ${request_id}`
      );

      // Poll for completion
      let maxPolls = 60;
      for (let poll = 0; poll < maxPolls; poll++) {
        const statusResult = await fal.queue.status(
          "fal-ai/gpt-image-1.5/edit",
          {
            requestId: request_id,
            logs: false,
          }
        );

        logger.log(
          `⏳ [FAL_AI_GPT_REFINER] Poll ${poll + 1}/${maxPolls}, status: ${statusResult.status
          }`
        );

        if (statusResult.status === "COMPLETED") {
          // Get the final result
          const finalResult = await fal.queue.result(
            "fal-ai/gpt-image-1.5/edit",
            {
              requestId: request_id,
            }
          );

          if (
            finalResult.data &&
            finalResult.data.images &&
            finalResult.data.images.length > 0
          ) {
            logger.log(`✅ [FAL_AI_GPT_REFINER] Image generated successfully`);
            return finalResult.data.images[0].url;
          }
          throw new Error("No images in completed result");
        }

        if (statusResult.status === "FAILED") {
          throw new Error("Fal.ai GPT Image generation failed");
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      throw new Error("Fal.ai GPT Image polling timeout");
    } catch (error) {
      console.error(
        `❌ [FAL_AI_GPT_REFINER] Attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// Görüntülerin geçici olarak saklanacağı klasörü oluştur
const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Geçici dosyaları hemen silme fonksiyonu (işlem biter bitmez)
async function cleanupTemporaryFiles(fileUrls) {
  // Bu fonksiyon artık dosya silme işlemi yapmıyor.
  logger.log(
    "🧹 cleanupTemporaryFiles çağrıldı fakat dosya silme işlemi devre dışı bırakıldı."
  );
  // İleride log veya başka bir işlem eklenebilir.
}

function sanitizeImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") {
    return imageUrl;
  }

  try {
    const parsedUrl = new URL(imageUrl);
    ["width", "height", "quality"].forEach((param) =>
      parsedUrl.searchParams.delete(param)
    );
    // searchParams.delete already mutates search; ensure empty queries stripped
    if (!parsedUrl.searchParams.toString()) {
      parsedUrl.search = "";
    }
    return parsedUrl.toString();
  } catch (error) {
    // URL sınıfı relative path'lerde hata verebilir; orijinal değeri döndür
    return imageUrl;
  }
}

function normalizeReferenceEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return {
      uri: sanitizeImageUrl(entry),
    };
  }

  const normalized = { ...entry };

  if (entry.uri) {
    normalized.uri = sanitizeImageUrl(entry.uri);
  } else if (entry.url) {
    normalized.uri = sanitizeImageUrl(entry.url);
  }

  return normalized.uri ? normalized : null;
}

async function ensureRemoteReferenceImage(imageEntry, userId) {
  if (!imageEntry) {
    return null;
  }

  if (typeof imageEntry === "string") {
    if (imageEntry.startsWith("file://")) {
      throw new Error(
        "Yerel dosya path'i desteklenmiyor. Base64 data gönderilmelidir."
      );
    }
    return {
      uri: sanitizeImageUrl(imageEntry),
      base64: null,
      alreadyUploaded: false,
    };
  }

  const result = { ...imageEntry };
  const currentUri = result.uri || result.url || null;

  // file:// veya blob: URL'leri için base64 upload gerekir
  const needsUpload =
    currentUri &&
    (currentUri.startsWith("file://") || currentUri.startsWith("blob:"));

  if (needsUpload) {
    if (result.base64) {
      const uploadSource = `data:image/jpeg;base64,${result.base64}`;
      const uploadedUrl = await uploadReferenceImageToSupabase(
        uploadSource,
        userId
      );
      result.uri = uploadedUrl;
      // 🚀 OPTIMIZE: base64'ü silme - Gemini için sakla
      // result.base64 zaten var, onu koruyoruz
      result.alreadyUploaded = true; // 🚀 Bu resim zaten upload edildi flag'i
      logger.log(
        `📤 [UPLOAD] ${currentUri.startsWith("blob:") ? "Blob" : "File"
        } URL Supabase'e yüklendi (base64 korundu):`,
        uploadedUrl?.slice(0, 60)
      );
    } else {
      throw new Error(
        `${currentUri.startsWith("blob:") ? "Blob" : "Yerel dosya"
        } path'i tespit edildi ancak base64 verisi bulunamadı.`
      );
    }
  }

  if (result.uri) {
    result.uri = sanitizeImageUrl(result.uri);
  }

  return result;
}

// Kullanıcının pro olup olmadığını kontrol etme fonksiyonu
async function checkUserProStatus(userId) {
  try {
    if (!userId || userId === "anonymous_user") {
      return false; // Anonymous kullanıcılar pro değil
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ User pro status kontrol hatası:", error);
      return false; // Hata durumunda pro değil kabul et
    }

    // is_pro true ise pro kabul et
    const isPro = user?.is_pro === true;
    logger.log(`👤 User ${userId.slice(0, 8)} pro status: ${isPro}`);

    return isPro;
  } catch (error) {
    console.error("❌ Pro status kontrol hatası:", error);
    return false;
  }
}

// Result image'ı user-specific bucket'e kaydetme fonksiyonu
async function saveResultImageToUserBucket(resultImageUrl, userId) {
  try {
    logger.log("📤 Result image user bucket'ine kaydediliyor...");
    logger.log("🖼️ Result image URL:", resultImageUrl);
    logger.log("👤 User ID:", userId);

    if (!resultImageUrl || !userId) {
      throw new Error("Result image URL ve User ID gereklidir");
    }

    // Result image'ı indir
    const imageResponse = await axios.get(resultImageUrl, {
      responseType: "arraybuffer",
      timeout: 30000, // 30 saniye timeout
    });
    const imageBuffer = Buffer.from(imageResponse.data);

    // User klasörü için dosya adı oluştur
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `${userId}/${timestamp}_result_${randomId}.jpg`;

    logger.log("📁 User bucket dosya adı:", fileName);

    // user_image_results bucket'ine yükle
    const { data, error } = await supabase.storage
      .from("user_image_results")
      .upload(fileName, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("❌ User bucket upload hatası:", error);
      throw new Error(`User bucket upload error: ${error.message}`);
    }

    logger.log("✅ User bucket upload başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("user_image_results")
      .getPublicUrl(fileName);

    logger.log("🔗 User bucket public URL:", urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error("❌ Result image user bucket'e kaydedilemedi:", error);
    // Hata durumunda orijinal URL'yi döndür
    return resultImageUrl;
  }
}

// Referans resmini Supabase'e yükleyip URL alan fonksiyon
async function uploadReferenceImageToSupabase(imageUri, userId) {
  try {
    let imageBuffer;

    // HTTP URL ise indir, değilse base64 olarak kabul et
    if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
      // HTTP URL - normal indirme
      const imageResponse = await axios.get(imageUri, {
        responseType: "arraybuffer",
        timeout: 15000, // 30s'den 15s'ye düşürüldü
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

    // EXIF rotation düzeltmesi uygula
    let processedBuffer;
    try {
      processedBuffer = await sharp(imageBuffer)
        .rotate() // EXIF orientation bilgisini otomatik uygula
        .jpeg()
        .toBuffer();
      logger.log("🔄 Tek resim upload: EXIF rotation uygulandı");
    } catch (sharpError) {
      console.error("❌ Sharp işleme hatası:", sharpError.message);

      // Sharp hatası durumunda orijinal buffer'ı kullan
      if (
        sharpError.message.includes("Empty JPEG") ||
        sharpError.message.includes("DNL not supported")
      ) {
        try {
          processedBuffer = await sharp(imageBuffer)
            .rotate() // EXIF rotation burada da dene
            .png()
            .toBuffer();
          logger.log(
            "✅ Tek resim upload: PNG'ye dönüştürüldü (EXIF rotation uygulandı)"
          );
        } catch (pngError) {
          console.error("❌ PNG dönüştürme hatası:", pngError.message);
          processedBuffer = imageBuffer; // Son çare: orijinal buffer
          logger.log(
            "⚠️ Orijinal buffer kullanılıyor (EXIF rotation uygulanamadı)"
          );
        }
      } else {
        processedBuffer = imageBuffer; // Son çare: orijinal buffer
        logger.log(
          "⚠️ Orijinal buffer kullanılıyor (EXIF rotation uygulanamadı)"
        );
      }
    }

    // Boyut bilgisi (compress client tarafında yapılıyor)
    logger.log(
      `📏 [SIZE-CHECK] Resim boyutu: ${(processedBuffer.length / 1024 / 1024).toFixed(2)} MB (client tarafında compress edildi)`
    );

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_reference_${userId || "anonymous"
      }_${randomId}.jpg`;

    logger.log("Supabase'e yüklenecek dosya adı:", fileName);

    // Supabase'e yükle (processed buffer ile - artık compress edilmiş olabilir)
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, processedBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Supabase yükleme hatası:", error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    logger.log("Supabase yükleme başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    logger.log("Supabase public URL:", urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error("Referans resmi Supabase'e yüklenirken hata:", error);
    throw error;
  }
}

// Reference images'ları Supabase'e upload eden fonksiyon
// 🚀 OPTIMIZE: ensureRemoteReferenceImage tarafından zaten upload edilmiş resimleri tekrar upload etmez
async function uploadReferenceImagesToSupabase(referenceImages, userId) {
  try {
    logger.log(
      "📤 Reference images Supabase'e yükleniyor...",
      referenceImages.length,
      "adet"
    );

    const uploadedUrls = [];
    const base64DataArray = []; // 🚀 Gemini için base64'leri de sakla

    for (let i = 0; i < referenceImages.length; i++) {
      const referenceImage = referenceImages[i];

      try {
        let base64ForGemini = null;

        // 🚀 OPTIMIZE: Eğer resim zaten ensureRemoteReferenceImage tarafından upload edildiyse
        // tekrar upload etme, sadece URL ve base64'ü kullan
        if (referenceImage.alreadyUploaded) {
          logger.log(
            `🚀 [OPTIMIZE] Reference image ${i + 1
            }: Zaten upload edilmiş, tekrar upload atlanıyor`
          );
          uploadedUrls.push(referenceImage.uri);
          base64ForGemini = referenceImage.base64 || null;
          base64DataArray.push(base64ForGemini);
          if (base64ForGemini) {
            logger.log(
              `✅ Reference image ${i + 1
              }: Mevcut base64 kullanılıyor - boyut: ${Math.round(
                base64ForGemini.length / 1024
              )} KB`
            );
          }
          continue;
        }

        let imageSourceForUpload;

        // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
        if (referenceImage.base64) {
          imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
          base64ForGemini = referenceImage.base64; // 🚀 Gemini için sakla
          logger.log(
            `📤 Reference image ${i + 1}: Client base64 kullanılıyor`
          );
        } else if (
          referenceImage.uri &&
          (referenceImage.uri.startsWith("http://") ||
            referenceImage.uri.startsWith("https://"))
        ) {
          // 🚀 HTTP URL'yi indir ve base64'e çevir - hem upload hem Gemini için kullan
          try {
            logger.log(
              `🔄 Reference image ${i + 1
              }: HTTP URL'den indiriliyor (tek sefer)...`
            );
            const cleanUrl = sanitizeImageUrl(referenceImage.uri);
            const imageResponse = await axios.get(cleanUrl, {
              responseType: "arraybuffer",
              timeout: 30000,
            });
            base64ForGemini = Buffer.from(imageResponse.data).toString(
              "base64"
            );
            imageSourceForUpload = `data:image/jpeg;base64,${base64ForGemini}`;
            logger.log(
              `✅ Reference image ${i + 1
              }: URL'den base64'e çevrildi - boyut: ${Math.round(
                base64ForGemini.length / 1024
              )} KB`
            );
          } catch (downloadErr) {
            console.error(
              `❌ Reference image ${i + 1}: İndirme hatası:`,
              downloadErr.message
            );
            imageSourceForUpload = referenceImage.uri; // Fallback: orijinal URL
          }
        } else {
          logger.log(
            `⚠️ Reference image ${i + 1}: Desteklenmeyen format, atlanıyor`
          );
          uploadedUrls.push(referenceImage.uri); // Fallback olarak original URI'yi kullan
          base64DataArray.push(null);
          continue;
        }

        const uploadedUrl = await uploadReferenceImageToSupabase(
          imageSourceForUpload,
          userId
        );
        uploadedUrls.push(uploadedUrl);
        base64DataArray.push(base64ForGemini); // 🚀 Gemini için base64'ü sakla
        logger.log(
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
        base64DataArray.push(null);
      }
    }

    logger.log(
      "📤 Toplam",
      uploadedUrls.length,
      "reference image URL'si hazırlandı"
    );

    // 🚀 Hem URL'leri hem base64'leri döndür
    return { urls: uploadedUrls, base64Array: base64DataArray };
  } catch (error) {
    console.error("❌ Reference images upload genel hatası:", error);
    // Fallback: Original URI'leri döndür (eski format uyumluluğu için)
    return { urls: referenceImages.map((img) => img.uri), base64Array: [] };
  }
}

// 📊 Color change tablosuna kayıt oluşturma fonksiyonu
async function saveToColorChangeGenerations({
  userId,
  generationId,
  status = "pending",
  originalPrompt = null,
  enhancedPrompt = null,
  originalImageUrl = null,
  resultImageUrl = null,
  targetColor = null,
  settings = {},
  aspectRatio = "9:16",
  qualityVersion = "v1",
  falRequestId = null,
  processingTimeSeconds = null,
  creditsUsed = 10,
}) {
  try {
    const { data, error } = await supabase
      .from("color_change_generations")
      .insert([
        {
          user_id: userId,
          generation_id: generationId,
          status,
          original_prompt: originalPrompt,
          enhanced_prompt: enhancedPrompt,
          original_image_url: originalImageUrl,
          result_image_url: resultImageUrl,
          target_color: targetColor,
          settings,
          aspect_ratio: aspectRatio,
          quality_version: qualityVersion,
          fal_request_id: falRequestId,
          processing_time_seconds: processingTimeSeconds,
          credits_used: creditsUsed,
        },
      ])
      .select();

    if (error) {
      console.error("❌ [COLOR_TABLE] Kayıt hatası:", error.message);
      return null;
    }
    logger.log(
      `✅ [COLOR_TABLE] Kayıt oluşturuldu: ${generationId} (${status})`
    );
    return data?.[0] || null;
  } catch (err) {
    console.error("❌ [COLOR_TABLE] Exception:", err.message);
    return null;
  }
}

// 📊 Color change tablosunu güncelleme fonksiyonu
async function updateColorChangeGeneration(
  generationId,
  userId,
  updates = {}
) {
  try {
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("color_change_generations")
      .update(updateData)
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .select();

    if (error) {
      console.error("❌ [COLOR_TABLE] Güncelleme hatası:", error.message);
      return false;
    }
    logger.log(
      `✅ [COLOR_TABLE] Güncellendi: ${generationId} →`,
      Object.keys(updates).join(", ")
    );
    return true;
  } catch (err) {
    console.error("❌ [COLOR_TABLE] Update exception:", err.message);
    return false;
  }
}

// İşlem başlamadan önce pending status ile kayıt oluşturma fonksiyonu
async function createPendingGeneration(
  userId,
  originalPrompt,
  referenceImageUrls,
  settings = {},
  locationImage = null,
  poseImage = null,
  hairStyleImage = null,
  aspectRatio = "9:16",
  isMultipleImages = false,
  isMultipleProducts = false,
  generationId = null,
  qualityVersion = "v1" // Kalite versiyonu parametresi
) {
  try {
    // User ID yoksa veya UUID formatında değilse, UUID oluştur
    let userIdentifier = userId;
    logger.log("🔍 [DEBUG createPendingGeneration] Gelen userId:", userId);

    if (!userIdentifier || userIdentifier === "anonymous_user") {
      userIdentifier = uuidv4(); // UUID formatında anonymous user oluştur
      logger.log(
        "🔍 [DEBUG] Yeni anonymous UUID oluşturuldu:",
        userIdentifier
      );
    } else if (
      !userIdentifier.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    ) {
      // Eğer gelen ID UUID formatında değilse, UUID'ye çevir veya yeni UUID oluştur
      logger.log(
        "🔍 [DEBUG] User ID UUID formatında değil, yeni UUID oluşturuluyor:",
        userIdentifier
      );
      userIdentifier = uuidv4();
    } else {
      logger.log(
        "🔍 [DEBUG] User ID UUID formatında, aynı ID kullanılıyor:",
        userIdentifier
      );
    }

    const { data: insertData, error } = await supabase
      .from("reference_results")
      .insert([
        {
          user_id: userIdentifier,
          original_prompt: originalPrompt,
          enhanced_prompt: null, // Henüz işlenmedi
          result_image_url: null, // Henüz sonuç yok
          reference_images: referenceImageUrls,
          settings: settings,
          location_image: locationImage,
          pose_image: poseImage,
          hair_style_image: hairStyleImage,
          aspect_ratio: aspectRatio,
          replicate_prediction_id: null, // Henüz prediction yok
          processing_time_seconds: null,
          is_multiple_images: isMultipleImages,
          is_multiple_products: isMultipleProducts,
          generation_id: generationId,
          status: "pending", // Başlangıçta pending
          quality_version: qualityVersion, // Kalite versiyonu kaydediliyor
          created_at: new Date().toISOString(),
        },
      ])
      .select(); // Insert edilen datayı geri döndür

    if (error) {
      console.error("❌ Pending generation kaydetme hatası:", error);
      return null;
    }

    logger.log("✅ Pending generation kaydedildi:", insertData[0]?.id);
    logger.log(
      "🔍 [DEBUG] Kaydedilen generation_id:",
      insertData[0]?.generation_id
    );
    logger.log("🔍 [DEBUG] Kaydedilen status:", insertData[0]?.status);
    return insertData[0]; // Insert edilen kaydı döndür
  } catch (dbError) {
    console.error("❌ Pending generation veritabanı hatası:", dbError);
    return null;
  }
}

// Başarılı completion'da kredi düşürme fonksiyonu
async function deductCreditOnSuccess(generationId, userId) {
  try {
    logger.log(
      `💳 [COMPLETION-CREDIT] Generation ${generationId} başarılı, kredi düşürülüyor...`
    );

    // 🔒 Deduplication: Bu generation için zaten kredi düşürülmüş mü kontrol et
    // settings içinde creditDeducted flag'i kontrol et
    const { data: existingGen, error: checkError } = await supabase
      .from("reference_results")
      .select("settings")
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .single();

    if (checkError) {
      console.error(`❌ Generation kontrolü hatası:`, checkError);
      return false;
    }

    try {
      logger.log(
        `💳 [DEDUP-CHECK] Generation ${generationId} settings:`,
        JSON.stringify(existingGen?.settings || {}, null, 2)
      );
    } catch (_) {
      logger.log(
        `💳 [DEDUP-CHECK] Generation ${generationId} settings: <unserializable>`
      );
    }
    logger.log(
      `💳 [DEDUP-CHECK] creditDeducted flag:`,
      existingGen.settings?.creditDeducted
    );

    if (existingGen.settings?.creditDeducted === true) {
      logger.log(
        `💳 [COMPLETION-CREDIT] Generation ${generationId} için zaten kredi düşürülmüş, atlanıyor`
      );
      return true;
    }

    logger.log(`💳 [DEDUP-CHECK] İlk kredi düşürme, devam ediliyor...`);

    // Kalite versiyonuna göre kredi maliyeti (existingGen'den al)
    const qualityVersion =
      existingGen?.settings?.qualityVersion ||
      existingGen?.settings?.quality_version ||
      "v1";
    const CREDIT_COST = qualityVersion === "v2" ? 35 : 10; // v2 için 35, v1 için 10 kredi

    logger.log(
      `💳 [CREDIT] Kalite versiyonu: ${qualityVersion}, Kredi maliyeti: ${CREDIT_COST}`
    );

    // Jenerasyon başına kredi düş
    const totalCreditCost = CREDIT_COST;
    logger.log(
      `💳 [COMPLETION-CREDIT] Bu generation için ${totalCreditCost} kredi düşürülecek`
    );

    // 🔗 TEAM-AWARE: Team member ise owner'ın kredisinden düş
    const effectiveCredits = await teamService.getEffectiveCredits(userId);
    const creditOwnerId = effectiveCredits.creditOwnerId || userId;
    const isTeamCredit = effectiveCredits.isTeamCredit || false;

    logger.log(`💳 [TEAM-AWARE] Kredi sahibi belirlendi:`, {
      requestingUser: userId,
      creditOwnerId: creditOwnerId,
      isTeamCredit: isTeamCredit
    });

    // Krediyi atomic olarak düş - creditOwnerId üzerinden
    const { data: currentUser, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", creditOwnerId)
      .single();

    if (userError || !currentUser) {
      console.error(`❌ User ${creditOwnerId} bulunamadı:`, userError);
      return false;
    }

    const currentCredit = currentUser.credit_balance || 0;

    if (currentCredit < totalCreditCost) {
      console.error(
        `❌ Yetersiz kredi! Mevcut: ${currentCredit}, Gerekli: ${totalCreditCost}`
      );
      // Başarısız sonuç olarak işaretle ama generation'ı completed bırak
      return false;
    }

    // 🔒 Atomic kredi düşürme - race condition'ı önlemek için RPC kullan
    // creditOwnerId kullanarak doğru hesaptan düşür
    const { data: updateResult, error: updateError } = await supabase.rpc(
      "deduct_user_credit",
      {
        user_id: creditOwnerId,
        credit_amount: totalCreditCost,
      }
    );

    if (updateError) {
      console.error(`❌ Kredi düşme hatası:`, updateError);
      return false;
    }

    const newBalance =
      updateResult?.new_balance || currentCredit - totalCreditCost;
    logger.log(
      `✅ ${totalCreditCost} kredi başarıyla düşüldü (${isTeamCredit ? 'team owner' : 'user'}: ${creditOwnerId}). Yeni bakiye: ${newBalance}`
    );

    // 💳 Kredi tracking bilgilerini generation'a kaydet
    logger.log(
      `💳 [TRACKING] Generation ${generationId} için kredi tracking bilgileri kaydediliyor...`
    );
    const creditTrackingUpdates = {
      credits_before_generation: currentCredit,
      credits_deducted: totalCreditCost,
      credits_after_generation: newBalance,
    };

    const { error: trackingError } = await supabase
      .from("reference_results")
      .update(creditTrackingUpdates)
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    if (trackingError) {
      console.error(`❌ Credit tracking güncelleme hatası:`, trackingError);
      // Kredi zaten düştü, tracking hatası önemli değil
    } else {
      logger.log(
        `💳 [TRACKING] Generation ${generationId} credit tracking başarıyla kaydedildi:`,
        creditTrackingUpdates
      );
    }

    // 🏷️ Generation'a kredi düşürüldü flag'i ekle
    const updatedSettings = {
      ...(existingGen?.settings || {}),
      creditDeducted: true,
    };
    logger.log(
      `🏷️ [FLAG-UPDATE] Updating settings for ${generationId}:`,
      JSON.stringify(updatedSettings, null, 2)
    );
    const { error: flagError } = await supabase
      .from("reference_results")
      .update({ settings: updatedSettings })
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    if (flagError) {
      console.error(`❌ CreditDeducted flag güncelleme hatası:`, flagError);
      // Kredi zaten düştü, flag hatası önemli değil
    } else {
      logger.log(
        `🏷️ Generation ${generationId} creditDeducted flag'i başarıyla eklendi`
      );
    }

    return true;
  } catch (error) {
    console.error(`❌ deductCreditOnSuccess hatası:`, error);
    return false;
  }
}

// Generation status güncelleme fonksiyonu
async function updateGenerationStatus(
  generationId,
  userId,
  status,
  updates = {}
) {
  try {
    // Idempotent kredi düşümü için önce mevcut kaydın durumunu ve settings'ini oku
    let previousStatus = null;
    let previousSettings = null;
    try {
      const { data: existingRows, error: existingErr } = await supabase
        .from("reference_results")
        .select("status, settings")
        .eq("generation_id", generationId)
        .eq("user_id", userId);
      if (!existingErr && existingRows && existingRows.length > 0) {
        previousStatus = existingRows[0]?.status || null;
        previousSettings = existingRows[0]?.settings || null;
      }
    } catch (readErr) {
      console.warn(
        "⚠️ Mevcut generation durumu okunamadı (devam ediliyor)",
        readErr
      );
    }

    // Eğer completed status'a geçiyorsa ve result_image_url varsa, user bucket'e kaydet
    let finalUpdates = { ...updates };

    if (status === "completed" && updates.result_image_url) {
      logger.log("💾 Result image user bucket'ine kaydediliyor...");
      try {
        // 1️⃣ Önce user'ın pro olup olmadığını kontrol et
        const isUserPro = await checkUserProStatus(userId);
        logger.log(`👤 User pro status: ${isUserPro}`);

        let processedImageUrl = updates.result_image_url;

        // 2️⃣ Watermark işlemi client-side'a taşındı, server'da sadece orijinal resmi kaydet
        logger.log(
          "💎 Watermark işlemi client-side'da yapılacak, orijinal resim kaydediliyor"
        );
        processedImageUrl = updates.result_image_url;

        // 3️⃣ İşlenmiş resmi user bucket'ine kaydet
        const userBucketUrl = await saveResultImageToUserBucket(
          processedImageUrl,
          userId
        );
        finalUpdates.result_image_url = userBucketUrl;
        logger.log("✅ Result image user bucket'e kaydedildi:", userBucketUrl);
      } catch (bucketError) {
        console.error("❌ User bucket kaydetme hatası:", bucketError);
        // Hata durumunda orijinal URL'yi kullan
      }
    }

    const updateData = {
      status: status,
      updated_at: new Date().toISOString(),
      ...finalUpdates,
    };

    const { data, error } = await supabase
      .from("reference_results")
      .update(updateData)
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .select();

    if (error) {
      console.error("❌ Generation status güncelleme hatası:", error);
      return false;
    }

    logger.log(`✅ Generation ${generationId} status güncellendi: ${status}`);

    // 💳 Başarılı completion'da kredi düş (idempotent)
    if (status === "completed" && userId && userId !== "anonymous_user") {
      const alreadyCompleted = previousStatus === "completed";
      const alreadyDeducted = previousSettings?.creditDeducted === true;
      if (alreadyCompleted && alreadyDeducted) {
        logger.log(
          `💳 [SKIP] ${generationId} zaten completed ve kredi düşülmüş. Deduction atlanıyor.`
        );
      } else {
        logger.log(
          `💳 [TRIGGER] updateGenerationStatus: ${generationId} → ${status} | previous=${previousStatus}`
        );
        logger.log(`💳 [TRIGGER] Kredi düşürme kontrolü başlatılıyor...`);
        await deductCreditOnSuccess(generationId, userId);
      }

      // 📱 Push notification gönder (sadece yeni completed ise)
      if (!alreadyCompleted) {
        logger.log(
          `📱 [NOTIFICATION] Generation completed - notification gönderiliyor: ${generationId}`
        );
        sendGenerationCompletedNotification(userId, generationId).catch(
          (error) => {
            console.error(
              `❌ [NOTIFICATION] Notification gönderme hatası:`,
              error
            );
            // Notification hatası generation'ı etkilemesin, sessizce devam et
          }
        );
      }
    }

    // 🎨 Color change tablosunu da senkronize et
    const isColorChangeGen =
      previousSettings?.isColorChange ||
      finalUpdates?.settings?.isColorChange;
    if (isColorChangeGen) {
      const colorUpdateData = { status };
      if (finalUpdates.result_image_url)
        colorUpdateData.result_image_url = finalUpdates.result_image_url;
      if (finalUpdates.enhanced_prompt)
        colorUpdateData.enhanced_prompt = finalUpdates.enhanced_prompt;
      if (finalUpdates.replicate_prediction_id)
        colorUpdateData.fal_request_id =
          finalUpdates.replicate_prediction_id;
      if (finalUpdates.processing_time_seconds)
        colorUpdateData.processing_time_seconds =
          finalUpdates.processing_time_seconds;
      await updateColorChangeGeneration(
        generationId,
        userId,
        colorUpdateData
      );
    }

    return data[0];
  } catch (dbError) {
    console.error("❌ Status güncelleme veritabanı hatası:", dbError);
    return false;
  }
}

// Replicate API kullanılacak - genAI client artık gerekli değil

// Aspect ratio formatını düzelten yardımcı fonksiyon
function formatAspectRatio(ratioStr) {
  const validRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

  try {
    // "original" veya tanımsız değerler için varsayılan oran
    if (!ratioStr || ratioStr === "original" || ratioStr === "undefined") {
      logger.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // ":" içermeyen değerler için varsayılan oran
    if (!ratioStr.includes(":")) {
      logger.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // Eğer gelen değer geçerli bir ratio ise kullan
    if (validRatios.includes(ratioStr)) {
      logger.log(`Gelen ratio değeri geçerli: ${ratioStr}`);
      return ratioStr;
    }

    // Piksel değerlerini orana çevir
    const [width, height] = ratioStr.split(":").map(Number);

    if (!width || !height || isNaN(width) || isNaN(height)) {
      logger.log(
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

    logger.log(
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

function sanitizePoseText(text) {
  if (!text || typeof text !== "string") {
    return text;
  }

  try {
    const forbiddenKeywords = [
      "background",
      "backdrop",
      "environment",
      "studio",
      "set",
    ];

    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const filtered = sentences.filter((sentence) => {
      const lower = sentence.toLowerCase();
      return !forbiddenKeywords.some((keyword) => lower.includes(keyword));
    });

    const joined = filtered.join(" ").trim();
    if (joined) {
      return joined;
    }

    const keywordRegex = /(studio|background|backdrop|environment|set)/gi;
    const stripped = text.replace(keywordRegex, "").replace(/\s+/g, " ").trim();
    return stripped;
  } catch (error) {
    console.error("❌ Pose metni temizlenirken hata:", error);
    return text;
  }
}

async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false,
  isColorChange = false, // Renk değiştirme mi?
  targetColor = null, // Hedef renk
  isPoseChange = false, // Poz değiştirme mi?
  customDetail = null, // Özel detay
  isEditMode = false, // EditScreen modu mu?
  editPrompt = null, // EditScreen'den gelen prompt
  isRefinerMode = false, // RefinerScreen modu mu?
  isBackSideAnalysis = false, // Arka taraf analizi modu mu?
  referenceImages = null, // Back side analysis için 2 resim
  isMultipleImages = false, // Çoklu resim modu mu?
  userId = null, // Compress için userId
  originalBase64Data = null // Orijinal base64 verisi - URL'den tekrar indirmemek için
) {
  try {
    logger.log(
      "🤖 [GEMINI] Google Gemini ile prompt iyileştirme başlatılıyor"
    );
    logger.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    logger.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    logger.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);
    logger.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);
    logger.log("🎨 [GEMINI] Color change mode:", isColorChange);
    logger.log("🎨 [GEMINI] Target color:", targetColor);
    logger.log("✏️ [GEMINI] Edit mode:", isEditMode);
    logger.log("✏️ [GEMINI] Edit prompt:", editPrompt);
    logger.log("🔧 [GEMINI] Refiner mode:", isRefinerMode);
    logger.log("🔄 [GEMINI] Back side analysis mode:", isBackSideAnalysis);

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    logger.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

    // Cinsiyet belirleme - varsayılan olarak kadın
    const gender = settings?.gender || "female";
    const age = settings?.age || "";
    let parsedAgeInt = parseInt(age, 10);

    // If age is a string (like "baby", "bebek", etc.), parse it into a numeric value
    if (isNaN(parsedAgeInt) && age) {
      const ageLower = age.toLowerCase();
      if (ageLower.includes("baby") || ageLower.includes("bebek")) {
        parsedAgeInt = 1;
      } else if (ageLower.includes("child") || ageLower.includes("çocuk")) {
        parsedAgeInt = 5;
      } else if (ageLower.includes("young") || ageLower.includes("genç")) {
        parsedAgeInt = 22;
      } else if (ageLower.includes("adult") || ageLower.includes("yetişkin")) {
        parsedAgeInt = 45;
      } else if (
        ageLower.includes("newborn") ||
        ageLower.includes("yenidoğan")
      ) {
        parsedAgeInt = 0;
      }
    }

    // Gender mapping'ini düzelt - hem man/woman hem de male/female değerlerini handle et
    let modelGenderText;
    let baseModelText;
    const genderLower = gender.toLowerCase();

    // Yaş grupları tanımlaması
    // 0     : newborn (yenidoğan)
    // 1     : baby (infant)
    // 2-3   : toddler
    // 4-12  : child
    // 13-16 : teenage
    // 17+   : adult

    // Newborn kontrolü - hem "newborn" string'i hem de 0 yaş kontrolü
    const isNewborn =
      age?.toLowerCase() === "newborn" ||
      age?.toLowerCase() === "yenidoğan" ||
      (!isNaN(parsedAgeInt) && parsedAgeInt === 0);

    if (isNewborn) {
      // NEWBORN (0 yaş) - Özel newborn fashion photography
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      modelGenderText = `newborn baby ${genderWord} (0 months old, infant)`;
      baseModelText = `newborn baby ${genderWord}`;

      logger.log(
        "👶 [GEMINI] NEWBORN MODE tespit edildi - Newborn fashion photography"
      );
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
      // Baby/Toddler (1-3 yaş)
      let ageGroupWord;
      if (parsedAgeInt === 1) {
        ageGroupWord = "baby"; // 1 yaş için baby
      } else {
        ageGroupWord = "toddler"; // 2-3 yaş için toddler
      }
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      if (parsedAgeInt === 1) {
        // Baby için daha spesifik tanım
        modelGenderText = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord} (infant)`;
        baseModelText = `${ageGroupWord} ${genderWord} (infant)`;
      } else {
        modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
        baseModelText = `${ageGroupWord} ${genderWord}`;
      }
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
      // Child
      const ageGroupWord = "child";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      baseModelText = `${ageGroupWord} ${genderWord}`;
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      // Teenage
      const ageGroupWord = "teenage";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      baseModelText = `${ageGroupWord} ${genderWord}`;
    } else {
      // Yetişkin mantığı - güvenli flag-safe tanımlar
      if (genderLower === "male" || genderLower === "man") {
        modelGenderText = "adult male model";
      } else if (genderLower === "female" || genderLower === "woman") {
        modelGenderText = "adult female model with confident expression";
      } else {
        modelGenderText = "adult female model with confident expression"; // varsayılan
      }
      baseModelText = modelGenderText; // age'siz sürüm

      // Eğer yaş bilgisini yetişkinlerde kullanmak istersen
      if (age) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? `${age} year old adult male model`
            : `${age} year old adult female model with confident expression`;
      }
    }

    logger.log("👤 [GEMINI] Gelen gender ayarı:", gender);
    logger.log("👶 [GEMINI] Gelen age ayarı:", age);
    logger.log("👤 [GEMINI] Base model türü:", baseModelText);
    logger.log("👤 [GEMINI] Age'li model türü:", modelGenderText);

    // Age specification - use client's age info naturally but limited
    let ageSection = "";
    if (age) {
      logger.log("👶 [GEMINI] Yaş bilgisi tespit edildi:", age);

      ageSection = `
    AGE SPECIFICATION:
    The user provided age information is "${age}". IMPORTANT: Mention this age information EXACTLY 2 times in your entire prompt — once when first introducing the model, and once more naturally later in the description. Do not mention the age a third time.`;
    }

    // Yaş grupları için basit ve güvenli prompt yönlendirmesi
    let childPromptSection = "";
    const parsedAge = parseInt(age, 10);

    if (isNewborn) {
      // NEWBORN (0 yaş) - Özel newborn fashion photography direktifleri
      childPromptSection = `
NEWBORN FASHION PHOTOGRAPHY MODE:
This is a professional newborn fashion photography session. The model is a newborn baby (0 months old, infant). 

CRITICAL NEWBORN PHOTOGRAPHY REQUIREMENTS:
- The newborn must be photographed in a safe, comfortable, and natural position suitable for newborn fashion photography
- Use soft, gentle poses that are appropriate for newborns - lying down positions, swaddled poses, or supported sitting positions
- Ensure the garment/product fits naturally on the newborn's small frame
- Use soft, diffused lighting that is gentle on the newborn's eyes
- Maintain a peaceful, serene atmosphere typical of newborn photography
- The newborn should appear comfortable, content, and naturally positioned
- Focus on showcasing the garment/product while ensuring the newborn's safety and comfort in the composition
- Use professional newborn photography techniques: natural fabric draping, gentle positioning, and age-appropriate styling
- The overall aesthetic should be gentle, tender, and suitable for newborn fashion photography campaigns

CAMERA FRAMING REQUIREMENT FOR NEWBORN:
- Use CLOSE-UP framing (tight crop) that focuses on the newborn and the garment/product
- The composition should be intimate and detail-focused, capturing the newborn's delicate features and the product's details
- Frame the shot to emphasize the newborn's face, hands, and the garment/product being showcased
- Avoid wide shots - maintain a close-up perspective that creates an intimate, tender atmosphere
- The camera should be positioned close to the subject, creating a warm, personal connection with the viewer

IMPORTANT: This is newborn fashion photography - maintain professional standards while ensuring all poses and positions are safe and appropriate for a newborn infant.`;
    } else if (!isNaN(parsedAge) && parsedAge <= 16) {
      if (parsedAge <= 3) {
        // Baby/Toddler (1-3 yaş) - çok basit
        childPromptSection = `
Age-appropriate modeling for young child (${parsedAge} years old). Natural, comfortable poses suitable for children's fashion photography.`;
      } else {
        // Child/teenage - sadece temel kurallar
        childPromptSection = `
Child model (${parsedAge} years old). Use age-appropriate poses and expressions suitable for children's fashion photography. Keep styling natural and comfortable.`;
      }
    }

    // Body shape measurements handling
    let bodyShapeMeasurementsSection = "";
    if (settings?.type === "custom_measurements" && settings?.measurements) {
      const { bust, waist, hips, height, weight } = settings.measurements;
      logger.log(
        "📏 [BACKEND GEMINI] Custom body measurements alındı:",
        settings.measurements
      );

      bodyShapeMeasurementsSection = `
    
    CUSTOM BODY MEASUREMENTS PROVIDED:
    The user has provided custom body measurements for the ${baseModelText}:
    - Bust: ${bust} cm
    - Waist: ${waist} cm  
    - Hips: ${hips} cm
    ${height ? `- Height: ${height} cm` : ""}
    ${weight ? `- Weight: ${weight} kg` : ""}
    
    IMPORTANT: Use these exact measurements to ensure the ${baseModelText} has realistic body proportions that match the provided measurements. The garment should fit naturally on a body with these specific measurements. Consider how the garment would drape and fit on someone with these proportions. The model's body should reflect these measurements in a natural and proportional way.`;

      logger.log("📏 [BACKEND GEMINI] Body measurements section oluşturuldu");
    }

    let settingsPromptSection = "";

    if (hasValidSettings) {
      const settingsText = Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null &&
            value !== undefined &&
            value !== "" &&
            key !== "measurements" &&
            key !== "type" &&
            key !== "locationEnhancedPrompt" // Enhanced prompt'u settings text'inden hariç tut
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      logger.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      logger.log("📝 [BACKEND GEMINI] Settings text:", settingsText);
      logger.log(
        "🏞️ [BACKEND GEMINI] Location enhanced prompt:",
        settings?.locationEnhancedPrompt
      );
      logger.log("🎨 [BACKEND GEMINI] Product color:", settings?.productColor);

      settingsPromptSection = `
    User selected settings: ${settingsText}
    
    SETTINGS DETAIL FOR BETTER PROMPT CREATION:
    ${Object.entries(settings)
          .filter(
            ([key, value]) =>
              value !== null &&
              value !== undefined &&
              value !== "" &&
              key !== "measurements" &&
              key !== "type" &&
              key !== "locationEnhancedPrompt" // Enhanced prompt'u detay listesinden hariç tut
          )
          .map(
            ([key, value]) =>
              `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`
          )
          .join("\n    ")}${settings?.locationEnhancedPrompt &&
            settings.locationEnhancedPrompt.trim()
            ? `\n    \n    SPECIAL LOCATION DESCRIPTION:\n    User has provided a detailed location description: "${settings.locationEnhancedPrompt}"\n    IMPORTANT: Use this exact location description for the environment setting instead of a generic location name.`
            : ""
        }${settings?.productColor && settings.productColor !== "original"
          ? `\n    \n    🎨 PRODUCT COLOR REQUIREMENT:\n    The user has specifically selected "${settings.productColor}" as the product color. CRITICAL: Ensure the garment/product appears in ${settings.productColor} color in the final image. This color selection must be prominently featured and accurately represented.`
          : ""
        }${settings?.framing && settings.framing !== "auto"
          ? `\n    \n    📐 CAMERA FRAMING REQUIREMENT:\n    The user has specifically selected "${settings.framing.replace(/_/g, ' ')}" as the camera framing/composition. CRITICAL: You MUST compose the shot as a ${settings.framing.replace(/_/g, ' ')} shot.\n    ${settings.framing === "full_body"
            ? "Frame the ENTIRE body from head to feet with proper spacing around the model. Show the complete figure including legs and feet."
            : settings.framing === "knee_shot"
              ? "Frame from the knees upward, focusing on upper body region while cutting off below the knees."
              : settings.framing === "medium_shot"
                ? "Frame from waist upward, showing upper torso and head area only."
                : settings.framing === "chest_up"
                  ? "Frame from chest upward, focusing on upper torso, shoulders, neck and head."
                  : settings.framing === "close_up"
                    ? "Tight framing on face and upper chest only, creating an intimate close-up shot."
                    : `Use ${settings.framing.replace(/_/g, ' ')} framing as specified.`
          }\n    This framing selection is MANDATORY and must be strictly followed in the final composition.`
          : ""
        }

    IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.${settings?.productColor && settings.productColor !== "original"
          ? ` Pay special attention to the product color requirement - the garment must be ${settings.productColor}.`
          : ""
        }${settings?.framing && settings.framing !== "auto"
          ? ` Pay special attention to the camera framing requirement - the shot MUST be composed as a ${settings.framing.replace(/_/g, ' ')} shot.`
          : ""
        }`;
    }

    // Pose ve perspective için akıllı öneri sistemi
    let posePromptSection = "";
    let perspectivePromptSection = "";

    const hasPoseText =
      typeof settings?.pose === "string" && settings.pose.trim().length > 0;
    const hasPoseImage = Boolean(poseImage);

    // Pose handling - enhanced with detailed descriptions
    if (!hasPoseText && !hasPoseImage) {
      const garmentText = isMultipleProducts
        ? "multiple garments/products ensemble"
        : "garment/product";
      posePromptSection = `
    
DEFAULT POSE: If no specific pose is provided, use natural, product-focused poses.  
POSE RULES: 
- PRIORITY: Keep the ${garmentText} oriented toward the camera so the entire design stays open and unobstructed. A straight-on stance or a subtle angle toward the lens (only if every key detail remains visible) is acceptable.  
- Avoid dramatic side profiles, over-the-shoulder turns, or poses that hide large sections of the ${garmentText} from the lens.  
- Encourage a confident, editorial pose that still keeps the torso presented to the camera; slight dynamic twists are fine as long as seams, closures, and logos remain clear.  
- Keep both hands away from pockets or positions that would cover prints, trims, or construction details.  
- Maintain a polished posture and engaged expression (toward the camera or slightly off-camera) that highlights the product professionally.  
IMPORTANT: Ensure garment details (neckline, chest, sleeves, logos, seams) remain fully visible and well lit.


    - Best showcase ${isMultipleProducts
          ? "all products in the ensemble and their coordination"
          : "the garment's design, cut, and construction details"
        }
    - Highlight ${isMultipleProducts
          ? "how the products work together and each product's unique selling points"
          : "the product's unique features and selling points"
        }
    - Demonstrate how ${isMultipleProducts
          ? "the fabrics of different products drape and interact naturally"
          : "the fabric drapes and moves naturally"
        }
    - Show ${isMultipleProducts
          ? "how all products fit together and create an appealing silhouette"
          : "the garment's fit and silhouette most effectively"
        }
    - Match the style and aesthetic of ${isMultipleProducts
          ? "the coordinated ensemble (formal, casual, sporty, elegant, etc.)"
          : "the garment (formal, casual, sporty, elegant, etc.)"
        }
    - Allow clear visibility of important design elements ${isMultipleProducts
          ? "across all products"
          : "like necklines, sleeves, hems, and patterns"
        }
    - Create an appealing and natural presentation that would be suitable for commercial photography
    ${isMultipleProducts
          ? "- Ensure each product in the ensemble is visible and well-positioned\n    - Demonstrate the styling versatility of combining these products"
          : ""
        }
    - If the featured item is footwear, a handbag, hat, watch, jewelry, eyewear, or other accessory, guide the pose using modern fashion campaign cues that hero the item while keeping every detail visible.`;

      logger.log(
        `🤸 [GEMINI] Akıllı poz seçimi aktif - ${isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun poz önerilecek`
      );
    } else if (hasPoseImage) {
      posePromptSection = `
    
    POSE REFERENCE: A pose reference image has been provided to show the desired body position and posture for the ${baseModelText}. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${baseModelText} should adopt this specific pose naturally and convincingly${isMultipleProducts
          ? ", ensuring all products in the ensemble remain clearly visible and well-positioned"
          : ""
        }.`;

      logger.log("🤸 [GEMINI] Pose prompt section eklendi");
    } else if (hasPoseText) {
      // Check if we have a detailed pose description (from our new Gemini pose system)
      const poseNameForPrompt = sanitizePoseText(settings.pose);
      let detailedPoseDescription = null;

      // Try to get detailed pose description from Gemini
      try {
        logger.log(
          "🤸 [GEMINI] Pose için detaylı açıklama oluşturuluyor:",
          settings.pose
        );
        detailedPoseDescription = await generatePoseDescriptionWithGemini(
          poseNameForPrompt,
          poseImage,
          settings.gender || "female",
          "clothing"
        );
        logger.log(
          "🤸 [GEMINI] Detaylı pose açıklaması alındı:",
          detailedPoseDescription
        );
      } catch (poseDescError) {
        console.error("🤸 [GEMINI] Pose açıklaması hatası:", poseDescError);
      }

      if (detailedPoseDescription) {
        const cleanedPoseDescription = sanitizePoseText(
          detailedPoseDescription
        );
        posePromptSection = `
    
    DETAILED POSE INSTRUCTION: The user has selected the pose "${poseNameForPrompt}". Use this detailed pose instruction for the ${baseModelText}:
    
    "${cleanedPoseDescription}"
    
    IMPORTANT: If the pose description above mentions any studio, backdrop, background, environment, or set, you must ignore those parts and instead describe and preserve the exact background that already exists in the provided model image.
    
    Ensure the ${baseModelText} follows this pose instruction precisely while maintaining natural movement and ensuring the pose complements ${isMultipleProducts
            ? "all products in the ensemble being showcased"
            : "the garment being showcased"
          }. The pose should enhance the presentation of the clothing and create an appealing commercial photography composition.`;

        logger.log("🤸 [GEMINI] Detaylı pose açıklaması kullanılıyor");
      } else {
        // Fallback to simple pose mention
        posePromptSection = `
    
    SPECIFIC POSE REQUIREMENT: The user has selected a specific pose: "${poseNameForPrompt}". Please ensure the ${baseModelText} adopts this pose while maintaining natural movement and ensuring the pose complements ${isMultipleProducts
            ? "all products in the ensemble being showcased"
            : "the garment being showcased"
          }. Ignore any background/backdrop/studio/environment directions that may be associated with that pose and always keep the original background from the input image unchanged and accurately described.`;

        logger.log(
          "🤸 [GEMINI] Basit pose açıklaması kullanılıyor (fallback)"
        );
      }

      logger.log(
        "🤸 [GEMINI] Kullanıcı tarafından seçilen poz:",
        settings.pose
      );
    }

    // Eğer perspective seçilmemişse, Gemini'ye kıyafete uygun perspektif önerisi yap
    if (!settings?.perspective) {
      perspectivePromptSection = `
    
    - Best capture ${isMultipleProducts
          ? "all products' most important design features and their coordination"
          : "the garment's most important design features"
        }
    - Show ${isMultipleProducts
          ? "the construction quality and craftsmanship details of each product"
          : "the product's construction quality and craftsmanship details"
        }
    - Highlight ${isMultipleProducts
          ? "how all products fit together and the overall ensemble silhouette"
          : "the fit and silhouette most effectively"
        }
    - Create the most appealing and commercial-quality presentation ${isMultipleProducts ? "for the multi-product styling" : ""
        }
    - Match ${isMultipleProducts
          ? "the ensemble's style and intended market positioning"
          : "the garment's style and intended market positioning"
        }
    ${isMultipleProducts
          ? "- Ensure all products are visible and well-framed within the composition"
          : ""
        }`;

      logger.log(
        `📸 [GEMINI] Akıllı perspektif seçimi aktif - ${isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun kamera açısı önerilecek`
      );
    } else {
      perspectivePromptSection = `
    
    SPECIFIC CAMERA PERSPECTIVE: The user has selected a specific camera perspective: "${settings.perspective
        }". Please ensure the photography follows this perspective while maintaining professional composition and optimal ${isMultipleProducts ? "multi-product ensemble" : "garment"
        } presentation.`;

      logger.log(
        "📸 [GEMINI] Kullanıcı tarafından seçilen perspektif:",
        settings.perspective
      );
    }

    // Location prompt section kaldırıldı - artık kullanılmıyor

    // Hair style bilgisi için ek prompt section
    let hairStylePromptSection = "";
    if (hairStyleImage) {
      hairStylePromptSection = `
    
    HAIR STYLE REFERENCE: A hair style reference image has been provided to show the desired hairstyle for the ${baseModelText}. Please analyze this hair style image carefully and incorporate the exact hair length, texture, cut, styling, and overall hair appearance into your enhanced prompt. The ${baseModelText} should have this specific hairstyle that complements ${isMultipleProducts ? "the multi-product ensemble" : "the garment"
        } and overall aesthetic.`;

      logger.log("💇 [GEMINI] Hair style prompt section eklendi");
    }

    // Location image bilgisi için ek prompt section
    let locationPromptSection = "";
    if (locationImage) {
      locationPromptSection = `
    
    LOCATION ENVIRONMENT REFERENCE: A location reference image has been provided to show the desired environment and setting for the fashion photography. Please analyze this location image carefully and create a detailed, comprehensive environment description that includes:

    ENVIRONMENT ANALYSIS REQUIREMENTS:
    - Analyze the architectural elements, lighting conditions, and atmospheric details visible in the location image
    - Identify the specific type of environment (indoor/outdoor, studio, urban, natural, etc.)
    - Describe the lighting characteristics (natural light, artificial lighting, time of day, etc.)
    - Note any distinctive features, textures, colors, and mood of the location
    - Identify any props, furniture, or environmental elements that could enhance the fashion shoot
    - Consider how the environment complements the garment and overall aesthetic

    DETAILED ENVIRONMENT DESCRIPTION:
    Create a rich, detailed description of the environment that will serve as the backdrop for the fashion photography. Include specific details about:
    - The physical space and its characteristics
    - Lighting setup and mood
    - Color palette and atmosphere
    - Any distinctive architectural or design elements
    - How the environment enhances the garment presentation
    - Professional photography considerations for this specific location

    The environment description should be detailed enough to guide the AI image generation model in creating a photorealistic, professional fashion photograph that seamlessly integrates the model and garment into this specific location setting.`;

      logger.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

    // Text-based hair style requirement if user selected hairStyle string
    let hairStyleTextSection = "";
    if (settings?.hairStyle) {
      hairStyleTextSection = `
    
    SPECIFIC HAIR STYLE REQUIREMENT: The user has selected a specific hair style: "${settings.hairStyle}". Please ensure the ${baseModelText} is styled with this exact hair style, matching its length, texture and overall look naturally.`;
      logger.log(
        "💇 [GEMINI] Hair style text section eklendi:",
        settings.hairStyle
      );
    }

    // Dinamik yüz tanımı - çeşitlilik için
    const faceDescriptorsAdult = [
      "soft angular jawline with friendly eyes",
      "gentle oval face and subtle dimples",
      "defined cheekbones with warm smile",
      "rounded face with expressive eyebrows",
      "heart-shaped face and bright eyes",
      "slightly sharp chin and relaxed expression",
      "broad forehead with calm gaze",
    ];
    const faceDescriptorsChild = [
      "round cheeks and bright curious eyes",
      "button nose and playful grin",
      "soft chubby cheeks with gentle smile",
      "big innocent eyes and tiny nose",
      "freckled cheeks and joyful expression",
    ];
    const faceDescriptorsNewborn = [
      "tiny delicate features with soft round cheeks",
      "peaceful sleeping expression with closed eyes",
      "gentle newborn face with small button nose",
      "serene infant features with soft skin",
      "tender newborn appearance with tiny lips",
      "calm sleeping baby with peaceful expression",
    ];

    let faceDescriptor;
    if (isNewborn) {
      // Newborn için özel yüz tanımları
      faceDescriptor =
        faceDescriptorsNewborn[
        Math.floor(Math.random() * faceDescriptorsNewborn.length)
        ];
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
      faceDescriptor =
        faceDescriptorsChild[
        Math.floor(Math.random() * faceDescriptorsChild.length)
        ];
    } else {
      faceDescriptor =
        faceDescriptorsAdult[
        Math.floor(Math.random() * faceDescriptorsAdult.length)
        ];
    }

    const faceDescriptionSection = `
    
    FACE DESCRIPTION GUIDELINE: Below is *one example* of a possible face description → "${faceDescriptor}". This is **only an example**; do NOT reuse it verbatim. Instead, create your own natural-sounding, age-appropriate face description for the ${baseModelText} so that each generation features a unique and photogenic look.`;

    // Gemini'ye gönderilecek metin - güvenli flag-safe versiyon
    const criticalDirectives = `
    BRAND SAFETY: If the input image contains any brand names or logos (e.g., Nike, Adidas, Prada, Gucci, Louis Vuitton, Chanel, Balenciaga, Versace, Dior, Hermès), please refer to them generically (e.g., "brand label", "logo") without naming the specific brand.
    ACCESSORY PRESENTATION: When the hero item is footwear, a handbag, backpack, small leather good, hat, watch, jewelry, eyewear, belt, or any similar fashion accessory, explicitly require modern fashion campaign posing and camera angles that hero the accessory. Specify refined hand/foot/head placement, keep every design detail fully visible, and reference popular e-commerce hero perspectives (runway footwear angles, wrist-level watch close-ups, eye-line eyewear framing, handbag-on-hip hero shot, etc.) while maintaining premium fashion styling.`;

    // Flux Max için genel garment transform talimatları (güvenli flag-safe versiyon)
    const fluxMaxGarmentTransformationDirectives = `
    GARMENT TRANSFORMATION REQUIREMENTS:
    - Generate ONLY ONE SINGLE unified fashion photograph, not multiple images or split views
    - Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance.
    - Ensure realistic fabric physics with natural drape, weight, tension, compression, and subtle folds along shoulders, chest/bust, torso, and sleeves. Maintain a clean commercial presentation with minimal distracting wrinkles.
    - Preserve all original garment details including exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Avoid redesigning the original garment.
    - Integrate prints/patterns correctly over the 3D form ensuring patterns curve, stretch, and wrap naturally across body contours. Avoid flat, uniform, or unnaturally straight pattern lines.
    - For structured details such as knots, pleats, darts, and seams, render functional tension, deep creases, and realistic shadows consistent with real fabric behavior.
    - Maintain photorealistic integration with the model and scene including correct scale, perspective, lighting, cast shadows, and occlusions that match the camera angle and scene lighting.
    - Focus on transforming the garment onto the existing model and seamlessly integrating it into the outfit. Avoid introducing new background elements unless a location reference is explicitly provided.
    - OUTPUT: One single professional fashion photograph only`;

    // Gemini'ye gönderilecek metin - Edit mode vs Color change vs Normal replace
    let promptForGemini;

    if (isEditMode && editPrompt && editPrompt.trim()) {
      // EDIT MODE - EditScreen'den gelen özel prompt
      promptForGemini = `
      SIMPLE EDIT INSTRUCTION: Generate a very short, focused prompt (maximum 30 words) that:
      
      1. STARTS with "Replace"
      2. Translates the user's request to English if needed  
      3. Describes ONLY the specific modification requested
      4. Does NOT mention garments, models, poses, backgrounds, or photography details
      5. Keeps existing scene unchanged
 

Only one single professional fashion photograph must be generated — no collage, no split views, no duplicates, no extra flat product shots.

The output must look like a high-end professional fashion photograph, suitable for luxury catalogs and editorial campaigns.

Apply studio-grade fashion lighting blended naturally with ambient light so the model and garment are perfectly lit, with no flat or artificial look.

Ensure crisp focus, maximum clarity, and editorial-level sharpness across the entire image; no blur, no washed-out textures.

Maintain true-to-life colors and accurate material textures; avoid dull or overexposed tones.

Integrate the model, garment, and background into one cohesive, seamless photo that feels like it was captured in a real professional photoshoot environment.

Only one single final image must be generated — no collages, no split frames, no duplicates.

Composition aligned with professional fashion standards (rule of thirds, balanced framing, depth of field).

Output must always be a single, hyper-realistic, high-end fashion photograph; never a plain catalog image.

Editorial-level fashion shoot aesthetic.

Confident model poses.

      USER REQUEST: "${editPrompt.trim()}"
      
      EXAMPLES:
      - User: "modele dövme ekle" → "Replace the model's skin with elegant tattoos while maintaining photorealistic quality."
      - User: "saçını kırmızı yap" → "Replace the hair color with vibrant red while keeping natural texture."
      - User: "arka planı mavi yap" → "Replace the background with blue color while preserving lighting."
      
      Generate ONLY the focused edit prompt, nothing else.
      ${isMultipleProducts
          ? "11. MANDATORY: Ensure ALL garments/products in the ensemble remain visible and properly coordinated after the edit"
          : ""
        }

      GEMINI TASK:
      1. Understand what modification the user wants
      2. ${isMultipleProducts
          ? "Identify how this modification affects ALL products in the ensemble"
          : "Create a professional English prompt that applies this modification"
        }
      3. Ensure the modification is technically possible and realistic${isMultipleProducts ? " for the complete multi-product outfit" : ""
        }
      4. Maintain the overall quality and style of the original image
      5. Describe the change in detail while preserving other elements${isMultipleProducts ? " and ALL unaffected products" : ""
        }

      LANGUAGE REQUIREMENT: Always generate your prompt in English and START with "Replace, change...".

      ${originalPrompt ? `Additional context: ${originalPrompt}.` : ""}
      `;
    } else if (isRefinerMode) {
      // REFINER MODE - Teknik profesyonel e-ticaret fotoğraf geliştirme prompt'u

      // Extract creation settings from settings object
      const addShadow = settings?.addShadow ?? false;
      const addReflection = settings?.addReflection ?? false;
      const backgroundColor = settings?.backgroundColor || "White";
      const colorInputMode = settings?.colorInputMode || "text";

      logger.log("🔧 [REFINER GEMINI] Creation settings:", {
        addShadow,
        addReflection,
        backgroundColor,
        colorInputMode,
      });

      // Build dynamic settings instruction for Gemini
      let creationSettingsInstruction = `
=== USER-SELECTED CREATION SETTINGS (APPLY THESE EXACTLY) ===

The user has selected the following settings for this product photo transformation. You MUST incorporate these settings into your generated prompt:

▶ BACKGROUND COLOR SETTING:
`;

      // Handle background color - translate to English if needed
      if (colorInputMode === "hex") {
        creationSettingsInstruction += `- Background color: HEX code ${backgroundColor} (use this exact color code for the background)
`;
      } else {
        // Text color mode - instruct Gemini to use English translation
        creationSettingsInstruction += `- Background color: "${backgroundColor}" 
  IMPORTANT: If this color name is NOT in English (e.g., "Beyaz", "Weiß", "Blanc", "Bianco", "白", etc.), you MUST translate it to English in your output prompt. For example:
    - "Beyaz" → "White"
    - "Siyah" → "Black"
    - "Kırmızı" → "Red"
    - "Mavi" → "Blue"
    - "Pembe" → "Pink"
    - "Gri" → "Gray"
    - "Bej" → "Beige"
    - "Krem" → "Cream"
  Use the ENGLISH color name in your generated prompt.
`;
      }

      creationSettingsInstruction += `
▶ EFFECT SETTINGS (CRITICAL - MUST FOLLOW EXACTLY):
- Add Shadow Underneath Product: ${addShadow
          ? "YES - Add a soft, natural shadow beneath/underneath the product for depth and professional look"
          : "ABSOLUTELY NO - Do NOT add ANY shadow underneath the product. The product MUST appear to be floating on a completely flat, shadowless background. There should be ZERO drop shadow, ZERO soft shadow, ZERO cast shadow beneath the product. The background must be completely uniform and clean with no darkness or shading underneath the product whatsoever."
        }
- Add Reflection Underneath Product: ${addReflection
          ? "YES - Add a subtle reflection/mirror effect beneath the product for luxury catalog look"
          : "ABSOLUTELY NO - Do NOT add ANY reflection or mirror effect underneath the product. There should be ZERO floor reflection, ZERO glossy surface reflection, ZERO mirror effect beneath the product. The product should NOT appear to be sitting on a reflective surface."
        }

${!addShadow && !addReflection
          ? `
⚠️ EXTREMELY IMPORTANT - NO SHADOW AND NO REFLECTION:
Since BOTH shadow and reflection are DISABLED, the product MUST appear on a completely flat, uniform background with:
- NO shadow of any kind underneath (no drop shadow, no soft shadow, no cast shadow)
- NO reflection of any kind underneath (no floor reflection, no mirror effect)
- The product should appear to be "floating" on a perfectly clean, uniform colored background
- The background color should be completely consistent and even - no variations, no darkness under the product
`
          : ""
        }

CRITICAL: These settings OVERRIDE the default background rules in the product-specific sections below. Make sure your generated prompt explicitly mentions:
1. The exact background color requested (in English)
2. ${addShadow
          ? "Include soft natural shadow underneath for depth"
          : "EXPLICITLY STATE: 'No shadow underneath the product' or 'Shadowless background'"
        }
3. ${addReflection
          ? "Include subtle reflection for luxury look"
          : "EXPLICITLY STATE: 'No reflection underneath' or 'Non-reflective background'"
        }

`;

      promptForGemini = `
MANDATORY INSTRUCTION (READ CAREFULLY, FOLLOW EXACTLY):

You are an expert AI prompt generator for professional e-commerce product photo transformation. Your task is to analyze the product image and generate ONE highly detailed technical prompt that will transform an amateur/low-quality product photo into a professional, premium catalog-ready image.

${creationSettingsInstruction}

=== STEP 1: PRODUCT IDENTIFICATION (CRITICAL) ===
First, carefully analyze the image and identify the product category:
- CLOTHING (shirts, dresses, jackets, pants, coats, etc.)
- JEWELRY (rings, necklaces, bracelets, earrings, watches)
- FOOTWEAR (shoes, sneakers, boots, sandals, heels)
- EYEWEAR (sunglasses, prescription glasses)
- BAGS & ACCESSORIES (handbags, wallets, belts, hats, scarves)
- OTHER PRODUCTS (electronics, home goods, etc.)

Based on the identified product type, generate a SPECIALIZED transformation prompt following the rules below.

=== STEP 2: GENERATE TRANSFORMATION PROMPT ===

STRICT FORMAT REQUIREMENTS:
- Start with: "Transform this amateur product photo into a professional high-end e-commerce catalog photo."
- AFTER the opening statement, IMMEDIATELY specify the user-selected settings:
  * "Background: [ENGLISH color name] ${addShadow
          ? "with soft natural shadow for depth"
          : "with no shadow - completely flat and clean"
        } ${addReflection ? "and subtle reflection effect for luxury look" : ""}"
- Focus & Clarity Requirement: You MUST include instructions for "Sharp focus, high clarity, NO BLUR, no bokeh, everything in crisp focus" in your generated prompt.
- Include ALL relevant sections based on product type
- End with: "The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail. Negative Prompt: blur, focus blur, bokeh, motion blur, bad lighting."
- Length: 250-350 words

=== PRODUCT-SPECIFIC TRANSFORMATION RULES ===

▶ FOR CLOTHING (Most Important - Ghost Mannequin Style):
Background: Pure flat ${colorInputMode === "hex" ? backgroundColor : backgroundColor
        } background (solid, uniform color - NOT a studio environment), ${addShadow
          ? "with soft natural shadow underneath for depth"
          : "absolutely NO shadows, NO gradients - completely flat and uniform"
        }${addReflection
          ? ", with subtle floor reflection for premium catalog look"
          : ""
        }.
Ghost Mannequin Effect (CRITICAL): 
  - COMPLETELY remove any visible mannequin, hanger, or human body parts
  - Create professional "invisible mannequin" effect showing the garment's internal 3D structure
  - Clean hollow neckline with visible interior depth and collar interior
  - Realistic garment form as if worn by invisible body - natural shoulder width, chest volume, waist definition
  - Sleeves positioned naturally with slight bend showing arm cavity depth
  - Preserve ALL garment construction details: stitching, seams, buttons, zippers, trims, labels
Fabric Enhancement:
  - Remove ALL wrinkles, creases, dust, lint, loose threads, stains
  - Enhance fabric texture visibility (weave patterns, knit textures, leather grain)
  - Present as freshly pressed, brand-new, straight from boutique
Positioning: Perfectly centered, shoulders level, hemline balanced, symmetrical presentation
Lighting: Even, bright, professional studio lighting - no harsh shadows, no blown highlights

▶ FOR JEWELRY (Rings, Necklaces, Bracelets, Earrings):
Background: Pure flat ${colorInputMode === "hex" ? backgroundColor : backgroundColor
        } background (solid, uniform color) ${addShadow
          ? "with SOFT REALISTIC SHADOW underneath for depth"
          : "with absolutely NO shadow underneath"
        } ${addReflection
          ? "and elegant reflection for luxury feel"
          : "and NO reflection"
        }
EARRING PAIRING RULE (CRITICAL):
  - If the product is an EARRING and only ONE earring is visible in the image (no pair shown):
    * You MUST create/generate the matching pair earring
    * Display BOTH earrings SIDE BY SIDE in the final image
    * The pair should be a perfect mirror/match of the original earring
    * Position them symmetrically, slightly angled towards each other for elegant presentation
    * Both earrings should have identical styling, lighting, and quality
  - If both earrings of a pair are already visible, keep them as they are
Gemstone Enhancement (CRITICAL):
  - Maximum clarity and sparkle for all gemstones (diamonds, rubies, emeralds, etc.)
  - Natural brilliance with precise light reflections - gems must SHINE and SPARKLE
  - Remove any dust, fingerprints, smudges from stones and metal surfaces
Metal Polish:
  - Gold must appear rich, warm, and gleaming without overexposure
  - Silver/platinum must be bright, clean, with subtle reflections
  - Remove tarnish, scratches, dull spots
Detail: Macro-level clarity showing every facet, clasp mechanism, chain links
Positioning: Arranged elegantly, chains untangled, clasps hidden or styled

▶ FOR FOOTWEAR (Shoes, Sneakers, Boots, Sandals, Slippers):
Background: Pure flat ${colorInputMode === "hex" ? backgroundColor : backgroundColor
        } background (solid, uniform color).
Positioning & Presentation (CRITICAL): 
  - SINGLE SHOE RULE: Even if the original photo shows a pair of shoes/slippers, your generated prompt MUST instruct to show ONLY ONE SINGLE shoe.
  - STRICT SIDE PROFILE: This single shoe MUST be presented in a direct, technical side profile view (outer side) as the primary angle. This is the absolute industry standard for professional clean e-commerce product photography.
  - The shoe must appear upright and stable, as if sitting on an invisible floor - NOT a flat lay or tilted angle.
  - COMPLETELY remove any visible legs, feet, socks, or mannequin parts from the original photo.
  - Ensure the shoe is perfectly centered in the frame.
Shadow & Reflection (CRITICAL):
  - Shadow: ${addShadow
          ? "Add a subtle, FLAT soft shadow directly beneath the sole contact points on the ground to ground the shoe realistically. The shadow must be clean and not spill outwards too far."
          : "Absolutely NO shadow - the shoe must appear on a completely clean, shadowless background."
        }
  - Reflection: ${addReflection
          ? "Add a very subtle floor reflection beneath the shoe for a premium luxury catalog look."
          : "Absolutely NO reflection underneath."
        }
Cleaning & Quality:
  - High Clarity: The shoe's texture (leather, mesh, suede, rubber) must be sharp and clear with high detail resolution.
  - Flawless Condition: Remove ALL dust, scuffs, creases (especially on the toe box), dirt marks, or sticker residue. Laces should appear neatly styled and clean.
  - Edges: The silhouette must be perfectly sharp and cut out cleanly against the background.
  - Lighting: Bright, even studio lighting that highlights the shoe's shape and materials without overexposure.
  - NO BLUR: Ensure the entire shoe is in sharp focus from toe to heel. No background blur or depth-of-field.
  - Present as brand-new, unworn condition
Detail Enhancement:
  - Sharpen stitching, mesh textures, sole patterns
  - Highlight logo/branding clearly
  - Show material quality (leather grain, fabric weave, rubber texture)

▶ FOR EYEWEAR (Sunglasses, Glasses):
Background: Pure flat ${backgroundColor} background (solid, uniform color) ${addShadow
          ? "with subtle shadow underneath for depth"
          : "with absolutely NO shadow underneath"
        } ${addReflection
          ? "and reflection below for premium look"
          : "and NO reflection"
        }
Positioning: Front-facing or slight 3/4 angle showing frame shape
Lens: Crystal clear, no smudges, no fingerprints, proper reflections showing lens quality
Frame: Highlight material quality, hinge details, temple arm construction

▶ FOR BAGS & ACCESSORIES:
Background: Pure flat ${colorInputMode === "hex" ? backgroundColor : backgroundColor
        } background (solid, uniform color) ${addShadow
          ? "with natural shadow underneath"
          : "with absolutely NO shadow underneath"
        } ${addReflection ? "and subtle reflection" : "and NO reflection"}
Positioning: Standing upright naturally, straps/handles arranged elegantly
Structure: Correct any sagging, maintain proper shape as if stuffed/structured
Hardware: Metal parts polished, zippers/clasps highlighted
Cleaning: Remove dust, scratches, marks - present as brand new

=== UNIVERSAL ENHANCEMENT RULES (Apply to ALL products) ===

AMATEUR PHOTO FIXES (CRITICAL):
- CORRECT bad/amateur lighting - transform harsh shadows, uneven lighting, yellow/warm tints into professional studio lighting
- REMOVE all imperfections: dust particles, lint, fingerprints, smudges, scratches, stains, price tags, stickers
- FIX color accuracy - ensure true-to-life colors, proper white balance, no color casts
- SHARPEN details - remove any blur or softness from amateur photography
- CORRECT perspective/distortion from poor camera angles

FINAL QUALITY STANDARDS:
- Professional catalog-ready composition
- Maximum detail clarity and sharpness
- True-to-life color reproduction
- Clean, pristine product presentation
- Luxury e-commerce marketplace standard (Amazon, ASOS, NET-A-PORTER quality)

=== OUTPUT ===
Generate ONLY the final transformation prompt. Do NOT include these instructions, category labels, or commentary. Just the prompt text.
REMEMBER: Use ENGLISH for all color names in your output, even if the user provided them in another language.
`;
    } else if (isColorChange && targetColor && targetColor !== "original") {
      // COLOR CHANGE MODE - Sadece renk değiştirme
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "change". Do not include any introduction, explanation, or commentary.

      ${criticalDirectives}

      ${isMultipleProducts
          ? `
      🛍️ MULTIPLE PRODUCTS COLOR CHANGE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES, each showing a different garment/product. When changing the color to ${targetColor}, you MUST analyze ALL reference images, specify which product(s) to change and ensure ALL products remain properly coordinated as an ensemble.

      CRITICAL MULTIPLE PRODUCTS COLOR REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each image shows a different garment/product
      - IDENTIFY ALL distinct garments/products across ALL reference images
      - SPECIFY which product(s) should change to ${targetColor}
      - ENSURE the color change maintains overall ensemble coordination
      - PRESERVE the original colors and design of products not being changed
      - MAINTAIN proper color harmony between all products in the outfit
      - REMEMBER: Each reference image shows a separate item - consider them together as one outfit
      `
          : ""
        }

      Create a professional fashion photography prompt in English that STARTS with "change" for changing ONLY the color of ${isMultipleProducts
          ? "the specified product(s)/garment(s)"
          : "the product/garment"
        } from the reference image to ${targetColor}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      IMPORTANT: Please explicitly mention in your generated prompt that this is for "professional fashion photography" to ensure the AI image model understands the context and produces high-quality fashion photography results.

      CRITICAL REQUIREMENTS FOR COLOR CHANGE:
      1. The prompt MUST begin with "Replace the ${isMultipleProducts
          ? "specified product(s)/garment(s)"
          : "product/garment"
        }..."
      2. ONLY change the color to ${targetColor}${isMultipleProducts ? " for the specified product(s)" : ""
        }
      3. Keep EVERYTHING else exactly the same: design, shape, patterns, details, style, fit, texture
      4. Do not modify ${isMultipleProducts ? "any garment" : "the garment"
        } design, cut, or any other aspect except the color
      5. The final image should be photorealistic, showing ${isMultipleProducts
          ? "the complete ensemble with the specified color changes"
          : `the same garment but in ${targetColor} color`
        }
      6. Use natural studio lighting with a clean background
      7. Preserve ALL original details except color: patterns (but in new color), textures, hardware, stitching, logos, graphics, and construction elements
      8. ${isMultipleProducts
          ? `ALL garments/products must appear identical to the reference image, just with the specified color change to ${targetColor} and proper ensemble coordination`
          : `The garment must appear identical to the reference image, just in ${targetColor} color instead of the original color`
        }
      9. MANDATORY: Include "professional fashion photography" phrase in your generated prompt
      ${isMultipleProducts
          ? `10. MANDATORY: Clearly specify which product(s) change color and which remain in their original colors`
          : ""
        }

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "change".

      ${originalPrompt
          ? `Additional color change requirements: ${originalPrompt}.`
          : ""
        }
      `;
    } else if (isPoseChange) {
      // POSE CHANGE MODE - Optimize edilmiş poz değiştirme prompt'u (100-150 token)
      promptForGemini = `
      FASHION POSE TRANSFORMATION: Generate a focused, detailed English prompt (100-150 words) that transforms the model's pose efficiently. Focus ONLY on altering the pose while keeping the existing model, outfit, lighting, and background exactly the same. You MUST explicitly describe the original background/environment details and state that they stay unchanged.

      USER POSE REQUEST: ${settings?.pose && settings.pose.trim()
          ? `Transform the model to: ${settings.pose.trim()}`
          : customDetail && customDetail.trim()
            ? `Transform the model to: ${customDetail.trim()}`
            : "Transform to a completely different iconic professional fashion modeling pose that contrasts dramatically with the current pose"
        }

      COMPREHENSIVE POSE TRANSFORMATION REQUIREMENTS:

      1. POSE ANALYSIS & TRANSFORMATION:
      - Analyze the current pose in the image thoroughly
      - Select a DRAMATICALLY CONTRASTING pose that showcases the garment beautifully
      - Describe the new pose in elaborate detail: body positioning, limb placement, weight distribution, head angle, eye direction
      - Include subtle pose nuances: shoulder positioning, hip angle, foot placement, hand gestures
      - Ensure the pose enhances the garment's silhouette and flow

      2. BODY LANGUAGE & EXPRESSION:
      - Describe confident, editorial-worthy body language
      - Include facial expression that matches the pose energy
      - Specify eye contact direction and intensity
      - Detail posture that conveys fashion-forward attitude

      3. POSE-SPECIFIC DETAILS:
      - If sitting pose: describe chair interaction, leg positioning, back posture
      - If standing pose: weight distribution, stance width, hip positioning
      - If leaning pose: support points, angle, natural flow
      - If walking pose: stride, arm movement, head position
      - If editorial pose: dramatic angles, fashion-forward positioning

      4. GARMENT INTERACTION:
      - Describe how the pose allows the garment to drape naturally
      - Ensure pose doesn't create unflattering fabric bunching
      - Show garment details and construction through pose
      - Allow fabric to flow and move naturally with the pose

      5. PROFESSIONAL PHOTOGRAPHY ELEMENTS:
      - Studio-grade lighting that enhances the pose
      - Camera angle that best captures the pose and garment
      - Depth of field that focuses on the model and pose
      - Professional composition that frames the pose perfectly

      6. BACKGROUND & IDENTITY PRESERVATION:
      - Carefully observe and describe the current background/environment (location type, colors, props, textures, lighting)
      - Explicitly instruct that the existing background remains exactly the same with zero alterations
      - Emphasize keeping the same model identity, face, hairstyle, makeup, accessories, and outfit with no modifications
      - Mention notable background elements (walls, furniture, decor, floor, lighting fixtures, scenery) and insist they stay identical
      - If any pose references mention backgrounds (e.g., studio, backdrop, set, environment), explicitly override those directions: state that the original background from the provided image stays unchanged and must be described faithfully. Never introduce or suggest a new background.

      CRITICAL FORMATTING REQUIREMENTS:
      - Your response MUST start with "Change"
      - Must be 100-150 words (concise but detailed)
      - Must be entirely in English
      - Focus ONLY on pose transformation
      - Do NOT include any generic fashion photography rules
      - Do NOT mention garment replacement
      - Do NOT propose background changes; instead, clearly state the background stays identical to the original photo
      - The background and environment MUST remain completely unchanged and explicitly described as such
      - Be specific but concise about the exact pose

      Generate a focused, efficient pose transformation prompt that starts with "Change", clearly states the original background and model remain unchanged, overrides any conflicting background instructions from pose references, and gets straight to the point.
      `;
    } else if (isBackSideAnalysis) {
      // BACK SIDE ANALYSIS MODE - Özel arka taraf analizi prompt'u
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.

      🔄 CRITICAL BACK DESIGN SHOWCASE MODE:
      
      ANALYSIS REQUIREMENT: You are looking at TWO distinct views of the SAME garment:
      1. TOP IMAGE: Shows the garment worn on a model from the FRONT
      2. BOTTOM IMAGE (labeled "ARKA ÜRÜN"): Shows the BACK design of the same garment
      
      YOUR MISSION: Transform the TOP image so the model displays the BACK design from the BOTTOM image.
      
      🚫 DO NOT CREATE: Generic walking poses, editorial strides, front-facing poses, or standard fashion poses
      
      ✅ MANDATORY REQUIREMENTS:
      1. **BODY POSITIONING**: Model MUST be turned completely around (180 degrees) to show their BACK to the camera
      2. **BACK DESIGN FOCUS**: The exact back graphic/pattern/design from the "ARKA ÜRÜN" image must be clearly visible on the model's back
      3. **CAMERA ANGLE**: Shoot from behind the model to capture the back design prominently
      4. **HEAD POSITION**: Model can either face completely away OR look back over shoulder (choose based on garment style)
      
      SPECIFIC BACK POSE EXECUTION:
      - **Primary View**: Full back view showing the complete back design
      - **Model Stance**: Natural standing pose with back to camera, may include subtle over-shoulder glance
      - **Design Visibility**: Ensure the back graphic/pattern from "ARKA ÜRÜN" image is the main focal point
      - **Garment Fit**: Show how the back design sits on the model's back naturally
      
      TECHNICAL REQUIREMENTS:
      - Camera positioned BEHIND the model
      - Back design from "ARKA ÜRÜN" clearly showcased
      - Professional fashion photography lighting
      - Sharp focus on back design details
      - Model wearing the exact same garment as shown in both reference images
      
      EXAMPLE STRUCTURE: "Replace the front-facing model with a back-facing pose, showing the model turned away from camera to display the [describe specific back design elements you see in ARKA ÜRÜN image] prominently across their back, captured with professional photography lighting..."
      
      🎯 FINAL GOAL: Create a back view that matches the "ARKA ÜRÜN" reference but worn on the model from the top image.

      ${criticalDirectives}

      ${isMultipleProducts
          ? `
      🛍️ MULTIPLE PRODUCTS BACK SIDE MODE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES showing different garments/products with both front and back views. You MUST analyze and describe ALL products visible across all reference images from both angles and coordinate them properly as an ensemble.

      CRITICAL MULTIPLE PRODUCTS BACK SIDE REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each may show different garments/products
      - ANALYZE each product from both front AND back angles across all reference images
      - DESCRIBE how all products coordinate together from all viewing angles
      - ENSURE proper layering and fit from both front and back perspectives
      - REMEMBER: Each reference image shows separate items - combine them intelligently
      `
          : ""
        }

      Create a professional fashion photography prompt in English that shows the model from the BACK VIEW wearing the garment, specifically displaying the back design elements visible in the "ARKA ÜRÜN" image.
      
      🚨 CRITICAL SINGLE OUTPUT REQUIREMENT:
      - GENERATE ONLY ONE SINGLE RESULT IMAGE showing the back view
      - DO NOT create multiple separate images, split views, or collages
      - DO NOT generate both front and back images
      - DO NOT create flat product photos or extra product shots
      - FOCUS ONLY on the back view transformation - one unified fashion photograph
      - RESULT MUST BE: Professional back-view fashion model shot ONLY
      
      CRITICAL PROMPT ELEMENTS TO INCLUDE:
      - "model turned away from camera"
      - "back view" or "rear view"  
      - "showing the back of the garment"
      - "single fashion photograph"
      - "one unified image"
      - Description of the specific back design (graphic, pattern, text, etc.) you see in the "ARKA ÜRÜN" image
      - "professional fashion photography"
      - "back design prominently displayed"
      
      IMPORTANT: Your generated prompt MUST result in a BACK VIEW of the model, not a front view or side view. The model should be facing AWAY from the camera to show the back design. Output ONLY ONE single image.

      ${fluxMaxGarmentTransformationDirectives}

      MANDATORY BACK SIDE PROMPT SUFFIX:
      After generating your main prompt, ALWAYS append this exact text to the end:
      
      "The garment must appear realistic with natural drape, folds along the shoulders, and accurate fabric texture. The print must wrap seamlessly on the fabric, following the model's back curvature. The lighting, background, and perspective must match the original scene, resulting in one cohesive and photorealistic image."

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".

      ${originalPrompt
          ? `USER CONTEXT: The user has provided these specific requirements: ${originalPrompt}. Please integrate these requirements naturally into your back side analysis prompt while maintaining professional structure.`
          : ""
        }
      
      ${ageSection}
      ${childPromptSection}
      ${bodyShapeMeasurementsSection}
      ${settingsPromptSection}
      ${posePromptSection}
      ${perspectivePromptSection}
      ${hairStylePromptSection}
      ${hairStyleTextSection}
      ${locationPromptSection}
      ${faceDescriptionSection}
      
      Generate a concise prompt focused on showcasing both front and back garment details while maintaining all original design elements. REMEMBER: Your response must START with "Replace" and emphasize back design features.
      `;
    } else {
      // NORMAL MODE - Standart garment replace
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.
      
      IMPORTANT: Your generated prompt must be UNDER 5000 characters total. Be concise but descriptive. Focus on the most important details.
         
      DEFAULT POSE INSTRUCTION: If no specific pose is provided by the user, you must randomly select an editorial-style fashion pose that best showcases the garment’s unique details, fit, and silhouette. The pose should be confident and photogenic, with body language that emphasizes fabric drape, construction, and design elements, while remaining natural and commercially appealing. Always ensure the garment’s critical features (neckline, sleeves, logos, seams, textures) are clearly visible from the chosen pose.

      After constructing the garment, model, and background descriptions, you must also generate an additional block of at least 200 words that describes a professional editorial fashion photography effect. This effect must always adapt naturally to the specific garment, fabric type, color palette, lighting conditions, and background environment described earlier. Do not use a fixed style for every prompt. Instead, analyze the context and propose an effect that enhances the scene cohesively. Examples might include glossy highlights and refined softness for silk in a studio setting, or natural tones, airy realism, and depth of field for cotton in outdoor daylight. These are only examples, not strict rules — you should always generate an effect description that best matches the unique scene. Your effect description must cover color grading, lighting treatment, texture and fabric physics, background integration, focus and depth of field, and overall editorial polish. Always ensure the tone is professional, realistic, and aligned with the visual language of high-end fashion magazines. The effect description must make the final result feel like a hyper-realistic editorial-quality fashion photograph, seamlessly blending garment, model, and environment into a single cohesive campaign-ready image.


      When generating fashion photography prompts, you must always structure the text into four separate paragraphs using \n\n line breaks. Do not output one long block of text.

Paragraph 1 → Model Description & Pose

Introduce the model (age, gender, editorial features).

Describe the pose with confident, fashion-forward language.

Paragraph 2 → Garment & Fabric Physics

Use fashion and textile jargon.

Describe fabric drape, weight, tension, folds, stitching.

Keep all design, color, patterns, trims, logos exactly the same as the reference.

Paragraph 3 → Environment & Ambiance

Describe the setting in editorial tone (minimalist, refined, photogenic).

Mention architecture, light play, textures.

Keep it supportive, not distracting.

Paragraph 4 → Lighting, Composition & Final Output

Always describe lighting as “natural daylight blended with studio-grade softness”.


Conclude with: “The final result must be a single, hyper-realistic, editorial-quality fashion photograph, seamlessly integrating model, garment, and environment at campaign-ready standards

      

CRITICAL RULES:

Always construct prompts in the language and style of editorial fashion photography. Use precise fashion industry jargon rather than plain product description.

Describe the garment using textile and tailoring terminology (drape, silhouette, cut, ribbed, pleated, piqué knit, melange, structured detailing, trims, seams, stitchwork, etc.).

Define the model’s appearance with editorial tone (sculpted jawline, refined cheekbones, luminous gaze, poised stance).

Lighting must be described in studio-grade fashion terms (diffused daylight, editorial softness, balanced exposure, flattering shadow play, high-definition clarity).

Composition should reference fashion photography language (rule of thirds, depth of field, eye-level perspective, polished framing, editorial atmosphere).

Environment must remain minimalist and photogenic, complementing the garment without distraction. Use words like “sophisticated”, “refined”, “contemporary”, “elevated backdrop”.

Always conclude that the result is a single, high-end professional fashion photograph, polished to editorial standards, suitable for premium catalogs and campaigns.

Do not use plain catalog language. Do not produce technical listing-style descriptions. The tone must always reflect editorial-level fashion shoot aesthetic

Exclude all original flat-lay elements (hanger, frame, shadows, textures, painting, or any other artifacts). Only the garment itself must be transferred.

The original background must be completely replaced with the newly described background. Do not keep or reuse any part of the input photo background.

The output must be hyper-realistic, high-end professional fashion editorial quality, suitable for commercial catalog presentation.

      ${criticalDirectives}

      ${isMultipleProducts
          ? `
      🛍️ MULTIPLE PRODUCTS MODE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES, each showing a different garment/product that together form a complete outfit/ensemble. You MUST analyze ALL the reference images provided and describe every single product visible across all images. Each product is equally important and must be properly described and fitted onto the ${modelGenderText}.

      CRITICAL MULTIPLE PRODUCTS REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each image shows a different garment/product
      - COUNT how many distinct garments/products are present across ALL reference images
      - DESCRIBE each product individually with its specific design details, colors, patterns, and construction elements from their respective reference images
      - ENSURE that ALL products from ALL reference images are mentioned in your prompt - do not skip any product
      - COORDINATE how all products work together as a complete ensemble when worn together
      - SPECIFY the proper layering, positioning, and interaction between products
      - MAINTAIN the original design of each individual product while showing them as a coordinated outfit
      - REMEMBER: Each reference image shows a separate item - combine them intelligently into one cohesive outfit
      `
          : ""
        }

      Create a professional fashion photography prompt in English that STARTS with "Replace" for replacing ${isMultipleProducts
          ? "ALL the garments/products from the reference image"
          : "the garment from the reference image"
        } onto a ${modelGenderText}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for ${isNewborn
          ? "professional newborn fashion photography"
          : "professional fashion photography"
        } and commercial garment presentation. Ensure the output is suitable for ${isNewborn
          ? "high-end newborn fashion photography shoots, newborn editorial styling, and newborn commercial product photography"
          : "high-end fashion shoots, editorial styling, and commercial product photography"
        }.

      IMPORTANT: Please explicitly mention in your generated prompt that this is for "${isNewborn
          ? "professional newborn fashion photography"
          : "professional fashion photography"
        }" to ensure the AI image model understands the context and produces high-quality ${isNewborn ? "newborn " : ""
        }fashion photography results.

      CRITICAL REQUIREMENTS:
      1. The prompt MUST begin with "Replace the ${isMultipleProducts
          ? "multiple flat-lay garments/products"
          : "flat-lay garment"
        }..."
      2. Keep ${isMultipleProducts
          ? "ALL original garments/products"
          : "the original garment"
        } exactly the same without changing any design, shape, colors, patterns, or details
      3. Do not modify or redesign ${isMultipleProducts ? "any of the garments/products" : "the garment"
        } in any way
      4. The final image should be photorealistic, showing ${isMultipleProducts
          ? "ALL garments/products perfectly fitted and coordinated"
          : "the same garment perfectly fitted"
        } on the ${baseModelText}
      5. Use natural studio lighting with a clean background
      6. Preserve ALL original details of ${isMultipleProducts ? "EACH garment/product" : "the garment"
        }: colors, patterns, textures, hardware, stitching, logos, graphics, and construction elements
      7. ${isMultipleProducts
          ? "ALL garments/products must appear identical to the reference image, just worn by the model as a complete coordinated outfit"
          : "The garment must appear identical to the reference image, just worn by the model instead of being flat"
        }
      8. MANDATORY: Include "professional fashion photography" phrase in your generated prompt
      ${isMultipleProducts
          ? "9. MANDATORY: Explicitly mention and describe EACH individual product/garment visible in the reference image - do not generalize or group them"
          : ""
        }

      ${isMultipleProducts
          ? `
      MULTIPLE PRODUCTS DETAIL COVERAGE (MANDATORY): 
      - ANALYZE the reference image and identify EACH distinct garment/product (e.g., top, bottom, jacket, accessories, etc.)
      - DESCRIBE each product's specific construction details, materials, colors, and design elements
      - EXPLAIN how the products layer and coordinate together
      - SPECIFY the proper fit and positioning of each product on the model
      - ENSURE no product is overlooked or generically described
      `
          : ""
        }

      ${fluxMaxGarmentTransformationDirectives}

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".

      ${originalPrompt
          ? `USER CONTEXT: The user has provided these specific requirements: ${originalPrompt}. Please integrate these requirements naturally into your garment replacement prompt while maintaining the professional structure and flow.`
          : ""
        }
      
      ${ageSection}
      ${childPromptSection}
      ${bodyShapeMeasurementsSection}
      ${settingsPromptSection}
      ${posePromptSection}
      ${perspectivePromptSection}
      ${hairStylePromptSection}
      ${hairStyleTextSection}
      ${locationPromptSection}
      ${faceDescriptionSection}
      
      Generate a concise prompt focused on garment replacement while maintaining all original details. REMEMBER: Your response must START with "Replace". Apply all rules silently and do not include any rule text or headings in the output.
      
      EXAMPLE FORMAT: "Replace the flat-lay garment from the input image directly onto a standing [model description] while keeping the original garment exactly the same..."
      `;
    }

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, use a natural pose that keeps the garment fully visible. The stance may be front-facing or slightly angled, but avoid hiding details. Do not put hands in pockets. Ensure garment features are clearly shown.`;
      }
    }

    logger.log("🤖 [GEMINI] Prompt oluşturuluyor:", promptForGemini);

    // Google Gemini API için resimleri base64'e çevir ve parts dizisine ekle
    const parts = [{ text: promptForGemini }];

    // Resimleri indirip base64'e çevir
    const imageBuffers = [];

    // Multi-mode resim gönderimi: Back side analysis, Multiple products, veya Normal mod
    if (isBackSideAnalysis && referenceImages && referenceImages.length >= 2) {
      logger.log(
        "🔄 [BACK_SIDE] Gemini'ye 2 resim gönderiliyor (ön + arka)..."
      );

      const firstImageUrl = sanitizeImageUrl(
        referenceImages[0].uri || referenceImages[0]
      );
      const secondImageUrl = sanitizeImageUrl(
        referenceImages[1].uri || referenceImages[1]
      );

      try {
        const [firstResponse, secondResponse] = await Promise.all([
          axios.get(firstImageUrl, { responseType: "arraybuffer" }),
          axios.get(secondImageUrl, { responseType: "arraybuffer" }),
        ]);

        imageBuffers.push(
          Buffer.from(firstResponse.data),
          Buffer.from(secondResponse.data)
        );
        logger.log("🔄 [BACK_SIDE] Toplam 2 resim Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Resim indirme hatası:", imageError);
        throw new Error("Failed to download images for Gemini");
      }
    } else if (
      isMultipleProducts &&
      referenceImages &&
      referenceImages.length > 1
    ) {
      // Multi-product mode: Tüm referans resimleri gönder
      logger.log(
        `🛍️ [MULTI-PRODUCT] Gemini'ye ${referenceImages.length} adet referans resmi gönderiliyor...`
      );

      try {
        const imagePromises = referenceImages.map((refImg) => {
          const imageUrl = sanitizeImageUrl(refImg.uri || refImg);
          return axios.get(imageUrl, { responseType: "arraybuffer" });
        });

        const imageResponses = await Promise.all(imagePromises);
        imageBuffers.push(
          ...imageResponses.map((res) => Buffer.from(res.data))
        );

        logger.log(
          `🛍️ [MULTI-PRODUCT] Toplam ${referenceImages.length} adet referans resmi Gemini'ye eklendi`
        );
      } catch (imageError) {
        console.error("❌ Resim indirme hatası:", imageError);
        throw new Error("Failed to download images for Gemini");
      }
    } else {
      // Normal mod: Tek resim gönder
      if (originalBase64Data) {
        // 🚀 Orijinal base64 varsa direkt kullan - URL'den indirme yapma
        logger.log(
          "🚀 [GEMINI] Orijinal base64 kullanılıyor - URL indirmesi atlandı"
        );
        imageBuffers.push(Buffer.from(originalBase64Data, "base64"));
        logger.log("🖼️ Referans görsel (base64) Gemini'ye eklendi");
      } else if (imageUrl) {
        // Base64 yoksa URL'den indir (fallback)
        try {
          logger.log("⬇️ [GEMINI] Base64 yok, URL'den indiriliyor:", imageUrl);
          const cleanImageUrl = sanitizeImageUrl(imageUrl);
          const imageResponse = await axios.get(cleanImageUrl, {
            responseType: "arraybuffer",
            timeout: 30000, // 30 saniye timeout
          });
          imageBuffers.push(Buffer.from(imageResponse.data));
          logger.log("🖼️ Referans görsel Gemini'ye eklendi:", imageUrl);
        } catch (imageError) {
          console.error("❌ Resim indirme hatası:", imageError);
          throw new Error("Failed to download image for Gemini");
        }
      }
    }

    // Pose image'ını da ekle
    if (poseImage) {
      try {
        const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
        const poseResponse = await axios.get(cleanPoseImageUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(poseResponse.data));
        logger.log("🤸 Pose görsel Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Pose resim indirme hatası:", imageError);
      }
    }

    // Hair style image'ını da ekle
    if (hairStyleImage) {
      try {
        const cleanHairStyleImageUrl = sanitizeImageUrl(
          hairStyleImage.split("?")[0]
        );
        const hairResponse = await axios.get(cleanHairStyleImageUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(hairResponse.data));
        logger.log("💇 Hair style görsel Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Hair style resim indirme hatası:", imageError);
      }
    }

    // Location image'ını da ekle
    if (locationImage) {
      try {
        const cleanLocationImageUrl = sanitizeImageUrl(
          locationImage.split("?")[0]
        );
        const locationResponse = await axios.get(cleanLocationImageUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(locationResponse.data));
        logger.log("🏞️ Location görsel Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Location resim indirme hatası:", imageError);
      }
    }

    // Base64'e çevir ve parts'e ekle
    for (const buffer of imageBuffers) {
      const base64Image = buffer.toString("base64");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });
    }

    // Replicate Gemini Flash API çağrısı için image URL'lerini topla
    const imageUrlsForReplicate = [];

    // Referans resimlerin URL'lerini ekle
    if (isBackSideAnalysis && referenceImages && referenceImages.length >= 2) {
      const firstImageUrl = sanitizeImageUrl(
        referenceImages[0].uri || referenceImages[0]
      );
      const secondImageUrl = sanitizeImageUrl(
        referenceImages[1].uri || referenceImages[1]
      );
      imageUrlsForReplicate.push(firstImageUrl, secondImageUrl);
    } else if (
      isMultipleProducts &&
      referenceImages &&
      referenceImages.length > 1
    ) {
      for (const refImg of referenceImages) {
        const imgUrl = sanitizeImageUrl(refImg.uri || refImg);
        if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
          imageUrlsForReplicate.push(imgUrl);
        }
      }
    } else if (imageUrl) {
      const cleanImageUrl = sanitizeImageUrl(imageUrl);
      if (
        cleanImageUrl.startsWith("http://") ||
        cleanImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanImageUrl);
      }
    }

    // Pose, hair style ve location resimlerini de ekle
    if (poseImage) {
      const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
      if (
        cleanPoseImageUrl.startsWith("http://") ||
        cleanPoseImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanPoseImageUrl);
      }
    }
    if (hairStyleImage) {
      const cleanHairStyleImageUrl = sanitizeImageUrl(
        hairStyleImage.split("?")[0]
      );
      if (
        cleanHairStyleImageUrl.startsWith("http://") ||
        cleanHairStyleImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanHairStyleImageUrl);
      }
    }
    if (locationImage) {
      const cleanLocationImageUrl = sanitizeImageUrl(
        locationImage.split("?")[0]
      );
      if (
        cleanLocationImageUrl.startsWith("http://") ||
        cleanLocationImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanLocationImageUrl);
      }
    }

    logger.log(
      `🤖 [REPLICATE-GEMINI] Toplam ${imageUrlsForReplicate.length} resim URL'si hazırlandı`
    );

    // Replicate Gemini Flash API çağrısı (3 retry ile)
    // Not: Resim compression artık client tarafında yapılıyor (6MB limit)
    let enhancedPrompt;

    try {
      // parts array'indeki text prompt'u al
      const textPrompt = parts.find((p) => p.text)?.text || promptForGemini;

      const geminiGeneratedPrompt = await callReplicateGeminiFlash(
        textPrompt,
        imageUrlsForReplicate,
        3
      );

      // Statik kurallar kaldırıldı - fal.ai 5000 karakter limiti var
      // Gemini'nin ürettiği prompt yeterince detaylı
      let staticRules = "";

      enhancedPrompt = geminiGeneratedPrompt + staticRules;
      logger.log(
        `🤖 [REPLICATE-GEMINI] Gemini'nin ürettiği prompt (${geminiGeneratedPrompt.length} karakter):`,
        geminiGeneratedPrompt
      );

      // Gemini safety filter kesme kontrolü - prompt çok kısa veya cümle ortasında kesilmişse
      const trimmedGemini = geminiGeneratedPrompt.trim();
      const endsWithPunctuation = /[.!?")\]]$/.test(trimmedGemini);
      const isTooShort = trimmedGemini.length < 300;

      if (isTooShort || !endsWithPunctuation) {
        logger.log(
          `⚠️ [GEMINI-TRUNCATION] Prompt kesik tespit edildi! Uzunluk: ${trimmedGemini.length}, Noktalama ile bitiyor: ${endsWithPunctuation}`
        );
        logger.log(
          `⚠️ [GEMINI-TRUNCATION] Son 50 karakter: "${trimmedGemini.slice(-50)}"`
        );
        // Fallback prompt'a düşmeyi tetikle
        throw new Error(`Gemini prompt truncated (${trimmedGemini.length} chars, ends with punctuation: ${endsWithPunctuation})`);
      }

      // 🔧 REFINER MODE için Gemini yanıt validasyonu - yanlış format kontrolü
      if (isRefinerMode) {
        const lowerPrompt = geminiGeneratedPrompt.toLowerCase();
        const hasWrongFormat =
          lowerPrompt.includes("replace the flat-lay") ||
          lowerPrompt.includes("replace the flatlay") ||
          lowerPrompt.includes("onto a model") ||
          lowerPrompt.includes("onto a child") ||
          lowerPrompt.includes("onto a female") ||
          lowerPrompt.includes("onto a male") ||
          lowerPrompt.includes("garment replacement") ||
          lowerPrompt.includes("worn by") ||
          lowerPrompt.includes("wearing the garment");

        if (hasWrongFormat) {
          logger.log(
            "⚠️ [REFINER-VALIDATION] Gemini yanlış format üretmiş (model/garment replacement), fallback kullanılıyor"
          );

          const addShadowVal = settings?.addShadow ?? false;
          const addReflectionVal = settings?.addReflection ?? false;
          const backgroundColorVal = settings?.backgroundColor || "White";
          const colorInputModeVal = settings?.colorInputMode || "text";

          let bgColorEnglishVal = backgroundColorVal;
          const colorTranslationsVal = {
            beyaz: "White",
            siyah: "Black",
            kırmızı: "Red",
            mavi: "Blue",
            yeşil: "Green",
            sarı: "Yellow",
            turuncu: "Orange",
            mor: "Purple",
            pembe: "Pink",
            gri: "Gray",
            kahverengi: "Brown",
            bej: "Beige",
            krem: "Cream",
            lacivert: "Navy Blue",
          };
          if (
            colorInputModeVal !== "hex" &&
            colorTranslationsVal[backgroundColorVal?.toLowerCase()]
          ) {
            bgColorEnglishVal =
              colorTranslationsVal[backgroundColorVal.toLowerCase()];
          }

          const shadowTextVal = addShadowVal
            ? "with soft natural shadow underneath for depth"
            : "with no shadow - completely flat and clean";
          const reflectionTextVal = addReflectionVal
            ? "Add subtle reflection underneath for luxury catalog look."
            : "No reflection underneath.";

          enhancedPrompt = `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglishVal} ${shadowTextVal}; ${reflectionTextVal} Sharp focus, high clarity, NO BLUR, no bokeh, everything in crisp focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglishVal}, completely flat${addShadowVal ? "" : ", shadowless"
            }${addReflectionVal ? "" : ", and non-reflective"
            }, making the product appear ${addShadowVal || addReflectionVal
              ? "professionally presented"
              : "to float cleanly"
            }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail. Negative Prompt: blur, focus blur, bokeh, motion blur, bad lighting.`;

          logger.log("🔧 [REFINER-VALIDATION] Fallback prompt uygulandı");
        } else {
          logger.log("✅ [REFINER-VALIDATION] Gemini doğru format üretmiş");
        }
      }

      logger.log(
        "✨ [REPLICATE-GEMINI] Final enhanced prompt (statik kurallarla) hazırlandı"
      );
    } catch (geminiError) {
      console.error(
        "❌ [REPLICATE-GEMINI] All attempts failed:",
        geminiError.message
      );

      // 🔧 REFINER MODE için özel catch fallback - Gemini tamamen başarısız olduğunda
      if (isRefinerMode) {
        logger.log(
          "🔧 [CATCH-REFINER] Gemini başarısız, refiner fallback prompt kullanılıyor"
        );

        const addShadowCatch = settings?.addShadow ?? false;
        const addReflectionCatch = settings?.addReflection ?? false;
        const backgroundColorCatch = settings?.backgroundColor || "White";
        const colorInputModeCatch = settings?.colorInputMode || "text";

        let bgColorEnglishCatch = backgroundColorCatch;
        const colorTranslationsCatch = {
          beyaz: "White",
          siyah: "Black",
          kırmızı: "Red",
          mavi: "Blue",
          yeşil: "Green",
          sarı: "Yellow",
          turuncu: "Orange",
          mor: "Purple",
          pembe: "Pink",
          gri: "Gray",
          kahverengi: "Brown",
          bej: "Beige",
          krem: "Cream",
          lacivert: "Navy Blue",
        };
        if (
          colorInputModeCatch !== "hex" &&
          colorTranslationsCatch[backgroundColorCatch?.toLowerCase()]
        ) {
          bgColorEnglishCatch =
            colorTranslationsCatch[backgroundColorCatch.toLowerCase()];
        }

        const shadowTextCatch = addShadowCatch
          ? "with soft natural shadow underneath for depth"
          : "with no shadow - completely flat and clean";
        const reflectionTextCatch = addReflectionCatch
          ? "Add subtle reflection underneath for luxury catalog look."
          : "No reflection underneath.";

        enhancedPrompt = `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglishCatch} ${shadowTextCatch}; ${reflectionTextCatch} Sharp focus, high clarity, NO BLUR, no bokeh, everything in crisp focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglishCatch}, completely flat${addShadowCatch ? "" : ", shadowless"
          }${addReflectionCatch ? "" : ", and non-reflective"
          }, making the product appear ${addShadowCatch || addReflectionCatch
            ? "professionally presented"
            : "to float cleanly"
          }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail. Negative Prompt: blur, focus blur, bokeh, motion blur, bad lighting.`;
      } else {
        // Normal mode için fallback - statik kuralları ekle
        const staticRules = `

CRITICAL RULES:

The output must be a single, high-end professional fashion photograph only — no collages, duplicates, or extra frames.

Apply studio-grade fashion lighting blended naturally with daylight, ensuring flawless exposure, vibrant textures, and sharp focus.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look.

Model, garment, and environment must integrate into one cohesive, seamless professional photo suitable for commercial catalogs and editorial campaigns.`;

        enhancedPrompt = originalPrompt + staticRules;
      }
    }

    // Eğer Gemini sonuç üretemediyse (enhancedPrompt orijinal prompt ile aynıysa) direkt fallback prompt kullan
    if (enhancedPrompt === originalPrompt) {
      logger.log(
        "🔄 [FALLBACK] Gemini başarısız, detaylı fallback prompt kullanılıyor"
      );

      // 🔧 REFINER MODE için özel fallback prompt - Model/garment replacement DEĞİL, ürün fotoğrafı iyileştirme
      if (isRefinerMode) {
        logger.log(
          "🔧 [FALLBACK-REFINER] Refiner mode fallback prompt kullanılıyor"
        );

        // Refiner settings'lerini al
        const addShadow = settings?.addShadow ?? false;
        const addReflection = settings?.addReflection ?? false;
        const backgroundColor = settings?.backgroundColor || "White";
        const colorInputMode = settings?.colorInputMode || "text";

        // Background color için İngilizce çeviri (Türkçe renk isimleri için)
        let bgColorEnglish = backgroundColor;
        const colorTranslations = {
          beyaz: "White",
          siyah: "Black",
          kırmızı: "Red",
          mavi: "Blue",
          yeşil: "Green",
          sarı: "Yellow",
          turuncu: "Orange",
          mor: "Purple",
          pembe: "Pink",
          gri: "Gray",
          kahverengi: "Brown",
          bej: "Beige",
          krem: "Cream",
          lacivert: "Navy Blue",
        };
        if (
          colorInputMode !== "hex" &&
          colorTranslations[backgroundColor?.toLowerCase()]
        ) {
          bgColorEnglish = colorTranslations[backgroundColor.toLowerCase()];
        }

        // Shadow ve reflection açıklamaları
        const shadowText = addShadow
          ? "with soft natural shadow underneath for depth"
          : "with no shadow - completely flat and clean";
        const reflectionText = addReflection
          ? "Add subtle reflection underneath for luxury catalog look."
          : "No reflection underneath.";

        const refinerFallbackPrompt = `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglish} ${shadowText}; ${reflectionText} Sharp focus, high clarity, NO BLUR, no bokeh, everything in crisp focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglish}, completely flat${addShadow ? "" : ", shadowless"
          }${addReflection ? "" : ", and non-reflective"
          }, making the product appear ${addShadow || addReflection
            ? "professionally presented"
            : "to float cleanly"
          }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail. Negative Prompt: blur, focus blur, bokeh, motion blur, bad lighting.`;

        logger.log("🔧 [FALLBACK-REFINER] Generated refiner fallback prompt");
        return refinerFallbackPrompt;
      }

      // Settings'ten bilgileri çıkar
      const location = settings?.location;
      const locationEnhancedPrompt = settings?.locationEnhancedPrompt; // Enhanced prompt bilgisini al
      const weather = settings?.weather;
      const age = settings?.age;
      const gender = settings?.gender;
      const productColor = settings?.productColor;
      const mood = settings?.mood;
      const perspective = settings?.perspective;
      const accessories = settings?.accessories;
      const skinTone = settings?.skinTone;
      const hairStyle = settings?.hairStyle;
      const hairColor = settings?.hairColor;
      const bodyShape = settings?.bodyShape;
      const pose = settings?.pose;
      const ethnicity = settings?.ethnicity;

      // Model tanımı
      let modelDescription = "";

      // Yaş ve cinsiyet - aynı koşullar kullanılıyor
      const genderLower = gender ? gender.toLowerCase() : "female";
      let parsedAgeInt = null;

      // Newborn kontrolü - fallback prompt için
      const isNewbornFallback =
        age?.toLowerCase() === "newborn" ||
        age?.toLowerCase() === "yenidoğan" ||
        age === "0";

      // Yaş sayısını çıkar
      if (age) {
        if (age.includes("years old")) {
          const ageMatch = age.match(/(\d+)\s*years old/);
          if (ageMatch) {
            parsedAgeInt = parseInt(ageMatch[1]);
          }
        } else if (isNewbornFallback || age === "0") {
          parsedAgeInt = 0; // Newborn
        } else if (age.includes("baby") || age.includes("bebek")) {
          parsedAgeInt = 1;
        } else if (age.includes("child") || age.includes("çocuk")) {
          parsedAgeInt = 5;
        } else if (age.includes("young") || age.includes("genç")) {
          parsedAgeInt = 22;
        } else if (age.includes("adult") || age.includes("yetişkin")) {
          parsedAgeInt = 45;
        } else {
          // Direkt sayı olarak parse et
          const numericAge = parseInt(age, 10);
          if (!isNaN(numericAge)) {
            parsedAgeInt = numericAge;
          }
        }
      }

      // Yaş grupları - güvenli flag-safe tanımlar
      if (isNewbornFallback || (!isNaN(parsedAgeInt) && parsedAgeInt === 0)) {
        // NEWBORN (0 yaş) - Fallback prompt için
        const genderWord =
          genderLower === "male" || genderLower === "man" ? "boy" : "girl";
        modelDescription = `newborn baby ${genderWord} (0 months old, infant)`;
      } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
        // Çocuk/genç yaş grupları için güvenli tanımlar
        if (parsedAgeInt <= 12) {
          modelDescription =
            genderLower === "male" || genderLower === "man"
              ? "child model (male)"
              : "child model (female)";
        } else {
          modelDescription =
            genderLower === "male" || genderLower === "man"
              ? "teenage model (male)"
              : "teenage model (female)";
        }
      } else {
        // Yetişkin - güvenli tanımlar
        if (genderLower === "male" || genderLower === "man") {
          modelDescription = "adult male model";
        } else {
          modelDescription = "adult female model with confident expression";
        }
      }

      // Etnik köken
      if (ethnicity) {
        modelDescription += ` ${ethnicity}`;
      }

      // Ten rengi
      if (skinTone) {
        modelDescription += ` with ${skinTone} skin`;
      }

      // Saç detayları
      if (hairColor && hairStyle) {
        modelDescription += `, ${hairColor} ${hairStyle}`;
      } else if (hairColor) {
        modelDescription += `, ${hairColor} hair`;
      } else if (hairStyle) {
        modelDescription += `, ${hairStyle}`;
      }

      // Vücut tipi
      if (bodyShape) {
        modelDescription += `, ${bodyShape} body shape`;
      }

      // Poz ve ifade
      let poseDescription = "";
      if (pose) poseDescription += `, ${pose}`;
      if (mood) poseDescription += ` with ${mood} expression`;

      // Aksesuarlar
      let accessoriesDescription = "";
      if (accessories) {
        accessoriesDescription += `, wearing ${accessories}`;
      }

      // Ortam - enhanced prompt öncelikli
      let environmentDescription = "";
      if (locationEnhancedPrompt && locationEnhancedPrompt.trim()) {
        environmentDescription += ` in ${locationEnhancedPrompt}`;
        logger.log(
          "🏞️ [FALLBACK] Enhanced location prompt kullanılıyor:",
          locationEnhancedPrompt
        );
      } else if (location) {
        environmentDescription += ` in ${location}`;
        logger.log("🏞️ [FALLBACK] Basit location kullanılıyor:", location);
      }
      if (weather) environmentDescription += ` during ${weather} weather`;

      // Kamera açısı
      let cameraDescription = "";
      if (perspective) {
        cameraDescription += `, ${perspective} camera angle`;
      }

      // Ürün rengi
      let clothingDescription = "";
      if (productColor && productColor !== "original") {
        clothingDescription += `, wearing ${productColor} colored clothing`;
      }

      // Ana prompt oluştur - Fashion photography odaklı (çoklu ürün desteği ile)
      let fallbackPrompt = `Replace the ${isMultipleProducts
        ? "multiple flat-lay garments/products"
        : "flat-lay garment"
        } from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}. `;

      // Fashion photography ve kalite gereksinimleri
      fallbackPrompt += `This is for professional fashion photography and commercial garment presentation. Preserve ${isMultipleProducts
        ? "ALL original garments/products"
        : "the original garment"
        } exactly as is, without altering any design, shape, colors, patterns, or details. The photorealistic output must show ${isMultipleProducts
          ? "ALL identical garments/products perfectly fitted and coordinated"
          : "the identical garment perfectly fitted"
        } on the dynamic model for high-end fashion shoots. `;

      // Kıyafet özellikleri (genel)
      fallbackPrompt += `${isMultipleProducts ? "Each garment/product" : "The garment"
        } features high-quality fabric with proper texture, stitching, and construction details. `;

      // Çoklu ürün için ek koordinasyon talimatları
      if (isMultipleProducts) {
        fallbackPrompt += `Ensure ALL products work together as a coordinated ensemble, maintaining proper layering, fit, and visual harmony between all items. `;
      }

      // Temizlik gereksinimleri - güvenli versiyon
      fallbackPrompt += `Please ensure that all hangers, clips, tags, and flat-lay artifacts are completely removed. Transform the ${isMultipleProducts ? "flat-lay garments/products" : "flat-lay garment"
        } into hyper-realistic, three-dimensional worn ${isMultipleProducts ? "garments/products" : "garment"
        } on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance. `;

      // Fizik gereksinimleri
      fallbackPrompt += `Ensure realistic fabric physics for ${isMultipleProducts ? "ALL garments/products" : "the garment"
        }: natural drape, weight, tension, compression, and subtle folds along shoulders, chest, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles. `;

      // Detay koruma - güvenli versiyon
      fallbackPrompt += `Preserve all original details of ${isMultipleProducts ? "EACH garment/product" : "the garment"
        } including exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Avoid redesigning ${isMultipleProducts
          ? "any of the original garments/products"
          : "the original garment"
        }. `;

      // Pattern entegrasyonu
      fallbackPrompt += `Integrate prints/patterns correctly over the 3D form for ${isMultipleProducts ? "ALL products" : "the garment"
        }: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines. `;

      // Newborn fashion photography direktifleri (fallback prompt için)
      if (isNewbornFallback || (!isNaN(parsedAgeInt) && parsedAgeInt === 0)) {
        fallbackPrompt += `NEWBORN FASHION PHOTOGRAPHY MODE: This is professional newborn fashion photography. The model is a newborn baby (0 months old, infant). Use safe, gentle poses appropriate for newborns - lying down positions, swaddled poses, or supported sitting positions. Ensure soft, diffused lighting gentle on the newborn's eyes. Maintain a peaceful, serene atmosphere. The newborn should appear comfortable, content, and naturally positioned. Focus on showcasing the garment/product while ensuring the newborn's safety and comfort. Use professional newborn photography techniques with natural fabric draping and age-appropriate styling. The overall aesthetic should be gentle, tender, and suitable for newborn fashion photography campaigns. CAMERA FRAMING: Use CLOSE-UP framing (tight crop) that focuses on the newborn and the garment/product. The composition should be intimate and detail-focused, capturing the newborn's delicate features and the product's details. Frame the shot to emphasize the newborn's face, hands, and the garment/product being showcased. Avoid wide shots - maintain a close-up perspective that creates an intimate, tender atmosphere. The camera should be positioned close to the subject, creating a warm, personal connection with the viewer. `;
      }

      // Final kalite - Fashion photography standartları
      fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional fashion photography aesthetic suitable for commercial and editorial use.`;

      logger.log(
        "🔄 [FALLBACK] Generated detailed fallback prompt:",
        fallbackPrompt
      );

      enhancedPrompt = fallbackPrompt + fallbackStaticRules;
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("🤖 Gemini 2.0 Flash prompt iyileştirme hatası:", error);
    // Hata durumunda da uygun direktifi ekle
    // let controlNetDirective = "";
    // if (hasControlNet) {
    //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

    // `;
    // } else {
    //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

    // `;
    // }

    // Fallback prompt - detaylı kıyafet odaklı format
    logger.log(
      "🔄 [FALLBACK] Enhanced prompt oluşturulamadı, detaylı fallback prompt kullanılıyor"
    );

    // 🔧 REFINER MODE için özel catch fallback - Gemini hata verdiğinde
    if (isRefinerMode) {
      logger.log(
        "🔧 [CATCH-REFINER-ERROR] Gemini hatası, refiner fallback prompt kullanılıyor"
      );

      const addShadowCatchErr = settings?.addShadow ?? false;
      const addReflectionCatchErr = settings?.addReflection ?? false;
      const backgroundColorCatchErr = settings?.backgroundColor || "White";
      const colorInputModeCatchErr = settings?.colorInputMode || "text";

      let bgColorEnglishCatchErr = backgroundColorCatchErr;
      const colorTranslationsCatchErr = {
        beyaz: "White",
        siyah: "Black",
        kırmızı: "Red",
        mavi: "Blue",
        yeşil: "Green",
        sarı: "Yellow",
        turuncu: "Orange",
        mor: "Purple",
        pembe: "Pink",
        gri: "Gray",
        kahverengi: "Brown",
        bej: "Beige",
        krem: "Cream",
        lacivert: "Navy Blue",
      };
      if (
        colorInputModeCatchErr !== "hex" &&
        colorTranslationsCatchErr[backgroundColorCatchErr?.toLowerCase()]
      ) {
        bgColorEnglishCatchErr =
          colorTranslationsCatchErr[backgroundColorCatchErr.toLowerCase()];
      }

      const shadowTextCatchErr = addShadowCatchErr
        ? "with soft natural shadow underneath for depth"
        : "with no shadow - completely flat and clean";
      const reflectionTextCatchErr = addReflectionCatchErr
        ? "Add subtle reflection underneath for luxury catalog look."
        : "No reflection underneath.";

      return `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglishCatchErr} ${shadowTextCatchErr}; ${reflectionTextCatchErr} Sharp focus, high clarity, NO BLUR, no bokeh, everything in crisp focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglishCatchErr}, completely flat${addShadowCatchErr ? "" : ", shadowless"
        }${addReflectionCatchErr ? "" : ", and non-reflective"
        }, making the product appear ${addShadowCatchErr || addReflectionCatchErr
          ? "professionally presented"
          : "to float cleanly"
        }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail. Negative Prompt: blur, focus blur, bokeh, motion blur, bad lighting.`;
    }

    // Statik kuralları fallback prompt'un sonuna da ekle
    const fallbackStaticRules = `

CRITICAL RULES:

The output must be a single, high-end professional fashion photograph only — no collages, duplicates, or extra frames.

Apply studio-grade fashion lighting blended naturally with daylight, ensuring flawless exposure, vibrant textures, and sharp focus.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look.

Model, garment, and environment must integrate into one cohesive, seamless professional photo suitable for commercial catalogs and editorial campaigns.`;

    // Settings'ten bilgileri çıkar
    const location = settings?.location;
    const locationEnhancedPrompt = settings?.locationEnhancedPrompt; // Enhanced prompt bilgisini al
    const weather = settings?.weather;
    const age = settings?.age;
    const gender = settings?.gender;
    const productColor = settings?.productColor;
    const mood = settings?.mood;
    const perspective = settings?.perspective;
    const accessories = settings?.accessories;
    const skinTone = settings?.skinTone;
    const hairStyle = settings?.hairStyle;
    const hairColor = settings?.hairColor;
    const bodyShape = settings?.bodyShape;
    const pose = settings?.pose;
    const ethnicity = settings?.ethnicity;

    // Model tanımı
    let modelDescription = "";

    // Yaş ve cinsiyet - aynı koşullar kullanılıyor
    const genderLower = gender ? gender.toLowerCase() : "female";
    let parsedAgeInt = null;

    // Newborn kontrolü - ikinci fallback prompt için
    const isNewbornFallbackError =
      age?.toLowerCase() === "newborn" ||
      age?.toLowerCase() === "yenidoğan" ||
      age === "0";

    // Yaş sayısını çıkar
    if (age) {
      if (age.includes("years old")) {
        const ageMatch = age.match(/(\d+)\s*years old/);
        if (ageMatch) {
          parsedAgeInt = parseInt(ageMatch[1]);
        }
      } else if (isNewbornFallbackError || age === "0") {
        parsedAgeInt = 0; // Newborn
      } else if (age.includes("baby") || age.includes("bebek")) {
        parsedAgeInt = 1;
      } else if (age.includes("child") || age.includes("çocuk")) {
        parsedAgeInt = 5;
      } else if (age.includes("young") || age.includes("genç")) {
        parsedAgeInt = 22;
      } else if (age.includes("adult") || age.includes("yetişkin")) {
        parsedAgeInt = 45;
      } else {
        // Direkt sayı olarak parse et
        const numericAge = parseInt(age, 10);
        if (!isNaN(numericAge)) {
          parsedAgeInt = numericAge;
        }
      }
    }

    // Yaş grupları - güvenli flag-safe tanımlar (ikinci fallback)
    if (
      isNewbornFallbackError ||
      (!isNaN(parsedAgeInt) && parsedAgeInt === 0)
    ) {
      // NEWBORN (0 yaş) - İkinci fallback prompt için
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelDescription = `newborn baby ${genderWord} (0 months old, infant)`;
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      // Çocuk/genç yaş grupları için güvenli tanımlar
      if (parsedAgeInt <= 12) {
        modelDescription =
          genderLower === "male" || genderLower === "man"
            ? "child model (male)"
            : "child model (female)";
      } else {
        modelDescription =
          genderLower === "male" || genderLower === "man"
            ? "teenage model (male)"
            : "teenage model (female)";
      }
    } else {
      // Yetişkin - güvenli tanımlar
      if (genderLower === "male" || genderLower === "man") {
        modelDescription = "adult male model";
      } else {
        modelDescription = "adult female model with confident expression";
      }
    }

    // Etnik köken
    if (ethnicity) {
      modelDescription += ` ${ethnicity}`;
    }

    // Ten rengi
    if (skinTone) {
      modelDescription += ` with ${skinTone} skin`;
    }

    // Saç detayları
    if (hairColor && hairStyle) {
      modelDescription += `, ${hairColor} ${hairStyle}`;
    } else if (hairColor) {
      modelDescription += `, ${hairColor} hair`;
    } else if (hairStyle) {
      modelDescription += `, ${hairStyle}`;
    }

    // Vücut tipi
    if (bodyShape) {
      modelDescription += `, ${bodyShape} body shape`;
    }

    // Poz ve ifade
    let poseDescription = "";
    if (pose) poseDescription += `, ${pose}`;
    if (mood) poseDescription += ` with ${mood} expression`;

    // Aksesuarlar
    let accessoriesDescription = "";
    if (accessories) {
      accessoriesDescription += `, wearing ${accessories}`;
    }

    // Ortam - enhanced prompt öncelikli
    let environmentDescription = "";
    if (locationEnhancedPrompt && locationEnhancedPrompt.trim()) {
      environmentDescription += ` in ${locationEnhancedPrompt}`;
      logger.log(
        "🏞️ [FALLBACK ERROR] Enhanced location prompt kullanılıyor:",
        locationEnhancedPrompt
      );
    } else if (location) {
      environmentDescription += ` in ${location}`;
      logger.log("🏞️ [FALLBACK ERROR] Basit location kullanılıyor:", location);
    }
    if (weather) environmentDescription += ` during ${weather} weather`;

    // Kamera açısı
    let cameraDescription = "";
    if (perspective) {
      cameraDescription += `, ${perspective} camera angle`;
    }

    // Ürün rengi
    let clothingDescription = "";
    if (productColor && productColor !== "original") {
      clothingDescription += `, wearing ${productColor} colored clothing`;
    }

    // Ana prompt oluştur (çoklu ürün desteği ile)
    let fallbackPrompt = `Replace the ${isMultipleProducts
      ? "multiple flat-lay garments/products"
      : "flat-lay garment"
      } from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}. `;

    // Fashion photography ve kalite gereksinimleri
    fallbackPrompt += `This is for professional fashion photography and commercial garment presentation. Preserve ${isMultipleProducts
      ? "ALL original garments/products"
      : "the original garment"
      } exactly as is, without altering any design, shape, colors, patterns, or details. The photorealistic output must show ${isMultipleProducts
        ? "ALL identical garments/products perfectly fitted and coordinated"
        : "the identical garment perfectly fitted"
      } on the dynamic model for high-end fashion shoots. `;

    // Kıyafet özellikleri (genel)
    fallbackPrompt += `${isMultipleProducts ? "Each garment/product" : "The garment"
      } features high-quality fabric with proper texture, stitching, and construction details. `;

    // Çoklu ürün için ek koordinasyon talimatları
    if (isMultipleProducts) {
      fallbackPrompt += `Ensure ALL products work together as a coordinated ensemble, maintaining proper layering, fit, and visual harmony between all items. `;
    }

    // Temizlik gereksinimleri - güvenli versiyon
    fallbackPrompt += `Please ensure that all hangers, clips, tags, and flat-lay artifacts are completely removed. Transform the ${isMultipleProducts ? "flat-lay garments/products" : "flat-lay garment"
      } into hyper-realistic, three-dimensional worn ${isMultipleProducts ? "garments/products" : "garment"
      } on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance. `;

    // Fizik gereksinimleri
    fallbackPrompt += `Ensure realistic fabric physics for ${isMultipleProducts ? "ALL garments/products" : "the garment"
      }: natural drape, weight, tension, compression, and subtle folds along shoulders, chest, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles. `;

    // Detay koruma - güvenli versiyon
    fallbackPrompt += `Preserve all original details of ${isMultipleProducts ? "EACH garment/product" : "the garment"
      } including exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Avoid redesigning ${isMultipleProducts
        ? "any of the original garments/products"
        : "the original garment"
      }. `;

    // Pattern entegrasyonu
    fallbackPrompt += `Integrate prints/patterns correctly over the 3D form for ${isMultipleProducts ? "ALL products" : "the garment"
      }: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines. `;

    // Newborn fashion photography direktifleri (ikinci fallback prompt için)
    if (
      isNewbornFallbackError ||
      (!isNaN(parsedAgeInt) && parsedAgeInt === 0)
    ) {
      fallbackPrompt += `NEWBORN FASHION PHOTOGRAPHY MODE: This is professional newborn fashion photography. The model is a newborn baby (0 months old, infant). Use safe, gentle poses appropriate for newborns - lying down positions, swaddled poses, or supported sitting positions. Ensure soft, diffused lighting gentle on the newborn's eyes. Maintain a peaceful, serene atmosphere. The newborn should appear comfortable, content, and naturally positioned. Focus on showcasing the garment/product while ensuring the newborn's safety and comfort. Use professional newborn photography techniques with natural fabric draping and age-appropriate styling. The overall aesthetic should be gentle, tender, and suitable for newborn fashion photography campaigns. CAMERA FRAMING: Use CLOSE-UP framing (tight crop) that focuses on the newborn and the garment/product. The composition should be intimate and detail-focused, capturing the newborn's delicate features and the product's details. Frame the shot to emphasize the newborn's face, hands, and the garment/product being showcased. Avoid wide shots - maintain a close-up perspective that creates an intimate, tender atmosphere. The camera should be positioned close to the subject, creating a warm, personal connection with the viewer. `;
    }

    // Final kalite - Fashion photography standartları
    fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional fashion photography aesthetic suitable for commercial and editorial use.`;

    logger.log(
      "🔄 [FALLBACK] Generated detailed fallback prompt:",
      fallbackPrompt
    );

    // Son fallback durumunda da statik kuralları ekle
    const finalStaticRules = `

CRITICAL RULES:

The output must be a single, high-end professional fashion photograph only — no collages, duplicates, or extra frames.

Apply studio-grade fashion lighting blended naturally with daylight, ensuring flawless exposure, vibrant textures, and sharp focus.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look.

Model, garment, and environment must integrate into one cohesive, seamless professional photo suitable for commercial catalogs and editorial campaigns.`;

    return fallbackPrompt + finalStaticRules;
  }
}

// Arkaplan silme fonksiyonu kaldırıldı - artık kullanılmıyor

async function pollReplicateResult(predictionId, maxAttempts = 60) {
  logger.log(`Replicate prediction polling başlatılıyor: ${predictionId}`);

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
          timeout: 15000, // 30s'den 15s'ye düşürüldü polling için
        }
      );

      const result = response.data;
      logger.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        logger.log("Replicate işlemi başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("Replicate işlemi başarısız:", result.error);

        // PA (Prediction interrupted) hatası kontrolü - DERHAL DURDUR
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("Prediction interrupted") ||
            result.error.includes("code: PA") ||
            result.error.includes("please retry (code: PA)"))
        ) {
          console.error(
            "❌ PA hatası tespit edildi, polling DERHAL durduruluyor:",
            result.error
          );
          throw new Error(
            "PREDICTION_INTERRUPTED: Replicate sunucusunda kesinti oluştu. Lütfen tekrar deneyin."
          );
        }

        // Content moderation ve model hatalarını kontrol et
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("flagged as sensitive") ||
            result.error.includes("E005") ||
            result.error.includes("sensitive content") ||
            result.error.includes("Content moderated") ||
            result.error.includes("ModelError") ||
            result.error.includes("retrying once"))
        ) {
          console.error(
            "❌ Content moderation/model hatası tespit edildi, Gemini 2.5 Flash Image Preview'e geçiş yapılacak:",
            result.error
          );
          throw new Error("SENSITIVE_CONTENT_FLUX_FALLBACK");
        }

        // E9243, E004 ve benzeri geçici hatalar için retry'a uygun hata fırlat
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("E9243") ||
            result.error.includes("E004") ||
            result.error.includes("unexpected error handling prediction") ||
            result.error.includes("Director: unexpected error") ||
            result.error.includes("Service is temporarily unavailable") ||
            result.error.includes("Please try again later") ||
            result.error.includes("Prediction failed.") ||
            result.error.includes(
              "Prediction interrupted; please retry (code: PA)"
            ))
        ) {
          logger.log(
            "🔄 Geçici nano-banana hatası tespit edildi, retry'a uygun:",
            result.error
          );
          throw new Error(`RETRYABLE_ERROR: ${result.error}`);
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
      if (error.message === "SENSITIVE_CONTENT_FLUX_FALLBACK") {
        console.error(
          "❌ Sensitive content hatası, Gemini 2.5 Flash Image Preview'e geçiş için polling durduruluyor"
        );
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // PA (Prediction interrupted) hatası için özel retry mantığı - KESIN DURDUR
      if (
        error.message.includes("Prediction interrupted") ||
        error.message.includes("code: PA") ||
        error.message.includes("PREDICTION_INTERRUPTED")
      ) {
        console.error(
          `❌ PA hatası tespit edildi, polling KESIN DURDURULUYOR: ${error.message}`
        );
        logger.log("🛑 PA hatası - Polling döngüsü derhal sonlandırılıyor");
        throw error; // Orijinal hatayı fırlat ki üst seviyede yakalanabilsin
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

// Retry mekanizmalı polling fonksiyonu
async function pollReplicateResultWithRetry(predictionId, maxRetries = 3) {
  logger.log(
    `🔄 Retry'li polling başlatılıyor: ${predictionId} (maxRetries: ${maxRetries})`
  );

  for (let retryAttempt = 1; retryAttempt <= maxRetries; retryAttempt++) {
    try {
      logger.log(`🔄 Polling retry attempt ${retryAttempt}/${maxRetries}`);

      // Normal polling fonksiyonunu çağır
      const result = await pollReplicateResult(predictionId);

      // Başarılı ise sonucu döndür
      logger.log(`✅ Polling retry ${retryAttempt} başarılı!`);
      return result;
    } catch (pollingError) {
      console.error(
        `❌ Polling retry ${retryAttempt} hatası:`,
        pollingError.message
      );

      // Bu hatalar için retry yapma - direkt fırlat
      if (
        pollingError.message.includes("PREDICTION_INTERRUPTED") ||
        pollingError.message.includes("SENSITIVE_CONTENT_FLUX_FALLBACK") ||
        pollingError.message.includes("processing was canceled")
      ) {
        console.error(
          `❌ Retry yapılmayacak hata türü: ${pollingError.message}`
        );
        throw pollingError;
      }

      // Geçici hatalar için retry yap (E9243 gibi)
      if (pollingError.message.includes("RETRYABLE_ERROR")) {
        logger.log(`🔄 Geçici hata retry edilecek: ${pollingError.message}`);
        // Retry döngüsü devam edecek
      }

      // Son deneme ise hata fırlat
      if (retryAttempt === maxRetries) {
        console.error(
          `❌ Tüm polling retry attemptları başarısız: ${pollingError.message}`
        );
        throw pollingError;
      }

      // Bir sonraki deneme için bekle
      const waitTime = retryAttempt * 3000; // 3s, 6s, 9s
      logger.log(
        `⏳ Polling retry ${retryAttempt} için ${waitTime}ms bekleniyor...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme (kalite versiyonuna göre dinamik)
  let creditDeducted = false;
  let actualCreditDeducted = 10; // Default v1 için 10 kredi
  let userId; // Scope için önceden tanımla
  let finalGenerationId = null; // Scope için önceden tanımla
  let temporaryFiles = []; // Silinecek geçici dosyalar

  try {
    let {
      ratio,
      promptText,
      referenceImages,
      settings,
      userId: requestUserId,
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleImages = false,
      isMultipleProducts: originalIsMultipleProducts,
      generationId, // Yeni parametre
      totalGenerations = 1, // Toplam generation sayısı (varsayılan 1)
      // Color change specific parameters
      isColorChange = false, // Bu bir renk değiştirme işlemi mi?
      targetColor = null, // Hedef renk bilgisi
      // Pose change specific parameters
      isPoseChange = false, // Bu bir poz değiştirme işlemi mi?
      customDetail = null, // Özel detay bilgisi
      // Edit mode specific parameters (EditScreen)
      isEditMode = false, // Bu EditScreen'den gelen bir edit işlemi mi?
      editPrompt = null, // EditScreen'den gelen özel prompt
      // Refiner mode specific parameters (RefinerScreen)
      isRefinerMode = false, // Bu RefinerScreen'den gelen refiner işlemi mi?
      // Session deduplication
      sessionId = null, // Aynı batch request'leri tanımlıyor
      modelPhoto = null,
    } = req.body;

    // Kalite versiyonu kontrolü (settings'ten al) - Refiner modunda v1'e zorla
    const qualityVersion = isRefinerMode
      ? "v1"
      : settings?.qualityVersion || settings?.quality_version || "v1";
    const CREDIT_COST = qualityVersion === "v2" ? 35 : 10; // v2 için 35, v1 için 10 kredi
    actualCreditDeducted = CREDIT_COST;

    logger.log(
      `🎨 [QUALITY_VERSION] Settings'ten alınan kalite versiyonu: ${qualityVersion}`
    );
    logger.log(
      `🎨 [QUALITY_VERSION] Settings objesi:`,
      JSON.stringify(settings || {}, null, 2)
    );

    modelPhoto = modelPhoto ? sanitizeImageUrl(modelPhoto) : modelPhoto;

    // ReferenceImages sanitization + model referansını yakala
    referenceImages = Array.isArray(referenceImages)
      ? referenceImages
        .map((img) => normalizeReferenceEntry(img))
        .filter(Boolean)
      : [];

    let modelReferenceImage = null;

    const existingModelIndex = referenceImages.findIndex((img) => {
      const type = (img?.type || img?.imageType || "").toLowerCase();
      return type === "model" || img?.isModelReference === true;
    });

    if (existingModelIndex !== -1) {
      modelReferenceImage = {
        ...referenceImages[existingModelIndex],
        uri: sanitizeImageUrl(
          referenceImages[existingModelIndex]?.uri ||
          referenceImages[existingModelIndex]?.url
        ),
        type:
          referenceImages[existingModelIndex]?.type ||
          referenceImages[existingModelIndex]?.imageType ||
          "model",
        isModelReference: true,
      };
      referenceImages.splice(existingModelIndex, 1);
    }

    if (!modelReferenceImage && modelPhoto) {
      logger.log(
        "🧍 [BACKEND] Model referansı SelectAge'den alındı:",
        modelPhoto
      );
      modelReferenceImage = {
        uri: modelPhoto,
        type: "model",
        isModelReference: true,
        source: "selectAge",
      };
    }

    // Yerel dosya path'lerini Supabase'e upload ederek URL'leri normalize et
    referenceImages = (
      await Promise.all(
        referenceImages.map((img) =>
          ensureRemoteReferenceImage(img, requestUserId)
        )
      )
    ).filter(Boolean);

    modelReferenceImage = await ensureRemoteReferenceImage(
      modelReferenceImage,
      requestUserId
    );

    // isMultipleProducts'ı değiştirilebilir hale getir (kombin modu için)
    let isMultipleProducts = originalIsMultipleProducts;

    // userId'yi scope için ata
    userId = requestUserId;

    if (modelReferenceImage) {
      logger.log(
        "🧍 [BACKEND] Model referans görseli tespit edildi:",
        modelReferenceImage?.uri || modelReferenceImage
      );
    } else {
      logger.log("🧍 [BACKEND] Model referans görseli bulunamadı");
    }

    const hasRequestField = (fieldName) =>
      Object.prototype.hasOwnProperty.call(req.body, fieldName);

    if (!isPoseChange && hasRequestField("hasProductPhotos")) {
      logger.log(
        "🕺 [BACKEND] ChangeModelPose payload tespit edildi (hasProductPhotos mevcut), isPoseChange true olarak işaretleniyor"
      );
      isPoseChange = true;
    }

    logger.log("🖼️ [BACKEND] isMultipleImages:", isMultipleImages);
    logger.log("🛍️ [BACKEND] isMultipleProducts:", isMultipleProducts);
    logger.log("🎨 [BACKEND] isColorChange:", isColorChange);
    logger.log("🎨 [BACKEND] targetColor:", targetColor);
    logger.log("🕺 [BACKEND] isPoseChange:", isPoseChange);
    logger.log("🕺 [BACKEND] customDetail:", customDetail);
    logger.log("✏️ [BACKEND] isEditMode:", isEditMode);
    logger.log("✏️ [BACKEND] editPrompt:", editPrompt);
    logger.log("🔧 [BACKEND] isRefinerMode:", isRefinerMode);
    const incomingReferenceCount = referenceImages?.length || 0;
    const totalReferenceCount =
      incomingReferenceCount + (modelReferenceImage ? 1 : 0);

    logger.log(
      "📤 [BACKEND] Gelen referenceImages:",
      incomingReferenceCount,
      "adet"
    );
    logger.log(
      "📤 [BACKEND] Toplam referans (model dahil):",
      totalReferenceCount
    );

    // EditScreen modunda promptText boş olabilir (editPrompt kullanılacak)
    const hasValidPrompt =
      promptText || (isEditMode && editPrompt && editPrompt.trim());

    logger.log(
      "🔍 [VALIDATION] promptText:",
      promptText ? "✅ Var" : "❌ Yok"
    );
    logger.log("🔍 [VALIDATION] isEditMode:", isEditMode);
    logger.log(
      "🔍 [VALIDATION] editPrompt:",
      editPrompt ? "✅ Var" : "❌ Yok"
    );
    logger.log("🔍 [VALIDATION] hasValidPrompt:", hasValidPrompt);

    if (!hasValidPrompt || totalReferenceCount < 1) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Geçerli bir prompt (promptText veya editPrompt) ve en az 1 referenceImage sağlanmalıdır.",
        },
      });
    }

    // 💡 YENİ YAKLAŞIM: Kredi başlangıçta düşürülmüyor, başarılı tamamlamada düşürülecek
    logger.log(
      `💳 [NEW APPROACH] Kredi başlangıçta düşürülmüyor, başarılı tamamlamada düşürülecek`
    );

    // Kredi kontrolü kaldırıldı - başarılı completion'da yapılacak

    // ✅ Eski kredi logic'i tamamen kaldırıldı
    if (false) {
      // Completely disabled - credit deduction moved to completion
      // Son 1 dakikadaki tüm generation'ları getir ve settings'te sessionId kontrolü yap
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: recentGenerations, error: sessionError } = await supabase
        .from("reference_results")
        .select("created_at, generation_id, settings")
        .eq("user_id", userId)
        .gte("created_at", oneMinuteAgo)
        .order("created_at", { ascending: false });

      // Client-side filtering: settings içinde sessionId'yi ara
      const sessionGenerations =
        recentGenerations?.filter((gen) => {
          try {
            return gen.settings && gen.settings.sessionId === sessionId;
          } catch (e) {
            return false;
          }
        }) || [];

      logger.log(
        `💳 [SESSION-DEDUP] SessionId ${sessionId} ile ${sessionGenerations.length
        } generation bulundu (${recentGenerations?.length || 0
        } recent'tan filtrelendi)`
      );

      if (
        !sessionError &&
        sessionGenerations &&
        sessionGenerations.length >= 1
      ) {
        logger.log(
          `💳 [SESSION-DEDUP] Aynı session'da generation var, kredi düşürme atlanıyor (${sessionGenerations.length} generation)`
        );
        // shouldDeductCredit = false; // Disabled
      } else {
        logger.log(
          `💳 [SESSION-DEDUP] Session'ın ilk generation'ı, kredi düşürülecek`
        );
      }
    } else if (false) {
      // shouldDeductCredit disabled - was for time-based deduplication
      // SessionId yoksa time-based deduplication kullan
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
      const { data: recentGenerations, error: recentError } = await supabase
        .from("reference_results")
        .select("created_at, generation_id")
        .eq("user_id", userId)
        .gte("created_at", thirtySecondsAgo)
        .order("created_at", { ascending: false });

      logger.log(
        `💳 [TIME-DEDUP] Son 30 saniyede ${recentGenerations?.length || 0
        } generation bulundu`
      );

      if (!recentError && recentGenerations && recentGenerations.length >= 1) {
        logger.log(
          `💳 [TIME-DEDUP] Son 30 saniyede generation var, kredi düşürme atlanıyor (${recentGenerations.length} generation)`
        );
        // shouldDeductCredit = false; // Disabled
      } else {
        logger.log(`💳 [TIME-DEDUP] İlk generation, kredi düşürülecek`);
      }
    }

    logger.log(`💳 [CREDIT DEBUG] generationId: ${generationId}`);
    logger.log(`💳 [CREDIT DEBUG] totalGenerations: ${totalGenerations}`);
    logger.log(`💳 [NEW SYSTEM] Kredi işlemleri completion'da yapılacak`);

    // ✅ Eski kredi logic'i tamamen devre dışı - pay-on-success sistemi kullanılıyor
    if (false) {
      // shouldDeductCredit logic disabled
      // Toplam generation sayısına göre kredi hesapla
      const totalCreditCost = CREDIT_COST * totalGenerations;
      logger.log(
        `💳 [CREDIT DEBUG] totalCreditCost: ${totalCreditCost} (${CREDIT_COST} x ${totalGenerations})`
      );

      try {
        logger.log(`💳 Kullanıcı ${userId} için kredi kontrolü yapılıyor...`);
        logger.log(
          `💳 Toplam ${totalGenerations} generation için ${totalCreditCost} kredi düşülecek`
        );

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
        if (currentCreditCheck < totalCreditCost) {
          return res.status(402).json({
            success: false,
            result: {
              message: "Yetersiz kredi. Lütfen kredi satın alın.",
              currentCredit: currentCreditCheck,
              requiredCredit: totalCreditCost,
            },
          });
        }

        // Toplam krediyi düş
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCreditCheck - totalCreditCost })
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
        logger.log(
          `✅ ${totalCreditCost} kredi başarıyla düşüldü (${totalGenerations} generation). Yeni bakiye: ${currentCreditCheck - totalCreditCost
          }`
        );

        // Gerçekte düşülen kredi miktarını sakla (iade için)
        actualCreditDeducted = totalCreditCost;
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

    // 📋 Reference images'ları Supabase'e upload et (pending generation için)
    // 🚀 Bu fonksiyon artık hem URL'leri hem base64'leri döndürüyor (Gemini optimizasyonu)
    logger.log("📤 Reference images Supabase'e upload ediliyor...");
    const uploadResult = await uploadReferenceImagesToSupabase(
      referenceImages,
      userId
    );
    const referenceImageUrls = uploadResult.urls;
    const referenceBase64Array = uploadResult.base64Array; // 🚀 Gemini için base64'ler
    logger.log(
      `🚀 [OPTIMIZE] ${referenceBase64Array.filter((b) => b).length
      } adet base64 Gemini için hazır`
    );

    // 🆔 Generation ID oluştur (eğer client'ten gelmediyse)
    finalGenerationId = generationId || uuidv4();

    // 📝 Pending generation oluştur (işlem başlamadan önce)
    logger.log(`📝 Pending generation oluşturuluyor: ${finalGenerationId}`);
    logger.log(
      `🔍 [DEBUG] Generation ID uzunluğu: ${finalGenerationId?.length}`
    );
    logger.log(`🔍 [DEBUG] Generation ID tipi: ${typeof finalGenerationId}`);

    // SessionId ve totalGenerations'ı settings'e ekle (completion'da kredi için gerekli)
    const settingsWithSession = {
      ...settings,
      totalGenerations: totalGenerations, // Pay-on-success için gerekli
      ...(sessionId && { sessionId: sessionId }),
      ...(isColorChange && { isColorChange: true }), // Color change flag'i kaydet
    };

    // Kalite versiyonunu ayrı bir değişken olarak al
    const qualityVersionForDB = isRefinerMode
      ? "v1"
      : settings?.qualityVersion || settings?.quality_version || "v1";

    const pendingGeneration = await createPendingGeneration(
      userId,
      promptText,
      referenceImageUrls,
      settingsWithSession,
      locationImage,
      poseImage,
      hairStyleImage,
      ratio,
      isMultipleImages,
      isMultipleProducts,
      finalGenerationId,
      qualityVersionForDB // Kalite versiyonunu parametre olarak geç
    );

    if (!pendingGeneration) {
      console.error("❌ Pending generation oluşturulamadı");

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
                (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
            })
            .eq("id", userId);

          logger.log(
            `💰 ${actualCreditDeducted} kredi iade edildi (Pending generation hatası)`
          );
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "İşlem kaydı oluşturulamadı",
        },
      });
    }

    // 🔄 Status'u processing'e güncelle
    await updateGenerationStatus(finalGenerationId, userId, "processing");

    // 📊 Color change modunda color_change_generations tablosuna da kaydet
    if (isColorChange) {
      await saveToColorChangeGenerations({
        userId,
        generationId: finalGenerationId,
        status: "processing",
        originalPrompt: promptText,
        originalImageUrl: referenceImageUrls?.[0] || null,
        targetColor: targetColor || settings?.productColor || null,
        settings: settingsWithSession,
        aspectRatio: ratio,
        qualityVersion: qualityVersionForDB,
        creditsUsed: CREDIT_COST,
      });
    }

    logger.log("🎛️ [BACKEND] Gelen settings parametresi:", settings);
    logger.log("🏞️ [BACKEND] Settings içindeki location:", settings?.location);
    logger.log(
      "🏞️ [BACKEND] Settings içindeki locationEnhancedPrompt:",
      settings?.locationEnhancedPrompt
    );
    logger.log("📝 [BACKEND] Gelen promptText:", promptText);
    logger.log("🏞️ [BACKEND] Gelen locationImage:", locationImage);
    logger.log("🤸 [BACKEND] Gelen poseImage:", poseImage);
    logger.log("💇 [BACKEND] Gelen hairStyleImage:", hairStyleImage);

    // 🚀 OPTIMIZASYON: uploadReferenceImagesToSupabase'den gelen base64'ü Gemini için kullan
    // Bu sayede aynı resim iki kez indirilmez - tek indirme ile hem Supabase hem Gemini
    let originalBase64ForGemini = referenceBase64Array?.[0] || null;

    if (originalBase64ForGemini) {
      logger.log(
        "🚀 [BACKEND] Gemini için base64 hazır (upload sırasında alındı) - boyut:",
        Math.round(originalBase64ForGemini.length / 1024),
        "KB"
      );
    } else {
      logger.log(
        "⚠️ [BACKEND] Base64 bulunamadı - Gemini URL'den indirecek (fallback)"
      );
    }

    let finalImage;

    // Çoklu resim varsa her birini ayrı ayrı upload et, canvas birleştirme yapma
    if (isMultipleImages && referenceImages.length > 1) {
      // Back side analysis için özel upload işlemi
      if (req.body.isBackSideAnalysis) {
        logger.log(
          "🔄 [BACK_SIDE] Tüm resimleri Supabase'e upload ediliyor..."
        );

        // Her resmi Supabase'e upload et
        const uploadedUrls = [];
        for (let i = 0; i < referenceImages.length; i++) {
          const img = referenceImages[i];
          const imageSource = img.base64
            ? `data:image/jpeg;base64,${img.base64}`
            : img.uri;
          const uploadedUrl = await uploadReferenceImageToSupabase(
            imageSource,
            userId
          );
          uploadedUrls.push(uploadedUrl);
          logger.log(
            `📤 [BACK_SIDE] Resim ${i + 1} upload edildi:`,
            uploadedUrl
          );
        }

        // URL'leri referenceImages array'ine geri koy
        for (let i = 0; i < uploadedUrls.length; i++) {
          referenceImages[i] = { ...referenceImages[i], uri: uploadedUrls[i] };
        }

        logger.log("✅ [BACK_SIDE] Tüm resimler Supabase'e upload edildi");

        // Canvas birleştirme bypass et - direkt URL'leri kullan
        finalImage = null; // Canvas'a gerek yok
      } else {
        logger.log(
          "🖼️ [BACKEND] Çoklu resim modu - Her resim ayrı ayrı upload ediliyor..."
        );

        // Kombin modu kontrolü
        const isKombinMode = req.body.isKombinMode || false;
        logger.log("🛍️ [BACKEND] Kombin modu kontrolü:", isKombinMode);

        // Her resmi ayrı ayrı Supabase'e upload et
        const uploadedUrls = [];
        for (let i = 0; i < referenceImages.length; i++) {
          const img = referenceImages[i];
          const imageSource = img.base64
            ? `data:image/jpeg;base64,${img.base64}`
            : img.uri;
          const uploadedUrl = await uploadReferenceImageToSupabase(
            imageSource,
            userId
          );
          uploadedUrls.push(uploadedUrl);
          logger.log(
            `📤 [BACKEND] Resim ${i + 1} upload edildi:`,
            uploadedUrl
          );
        }

        // URL'leri referenceImages array'ine geri koy
        for (let i = 0; i < uploadedUrls.length; i++) {
          referenceImages[i] = { ...referenceImages[i], uri: uploadedUrls[i] };
        }

        logger.log("✅ [BACKEND] Tüm resimler ayrı ayrı upload edildi");

        // Canvas birleştirme yapma - direkt ayrı resimleri kullan
        finalImage = null; // Canvas'a gerek yok

        // Kombin modunda MUTLAKA isMultipleProducts'ı true yap ki Gemini doğru prompt oluştursun
        if (isKombinMode) {
          logger.log(
            "🛍️ [BACKEND] Kombin modu için isMultipleProducts değeri:",
            `${originalIsMultipleProducts} → true`
          );
          // Bu değişkeni lokal olarak override et
          isMultipleProducts = true;
        }
      } // Back side analysis else bloğu kapatma
    } else {
      // 🚀 OPTIMIZE: Tek resim için zaten uploadReferenceImagesToSupabase ile upload edildi
      // Tekrar upload yapmıyoruz - referenceImageUrls[0]'ı kullan
      logger.log(
        "🖼️ [BACKEND] Tek resim modu - önceden upload edilen URL kullanılıyor"
      );

      if (!referenceImageUrls?.[0]) {
        return res.status(400).json({
          success: false,
          result: {
            errorCode: "REFERENCE_IMAGE_REQUIRED",
            message: "Reference image is required.",
          },
        });
      }

      // Zaten upload edilmiş URL'yi kullan - tekrar upload YOK!
      finalImage = sanitizeImageUrl(referenceImageUrls[0]);
      logger.log(
        "🚀 [OPTIMIZE] Tek resim için önceden upload edilen URL kullanıldı (çift upload önlendi)"
      );
    }

    logger.log("Supabase'den alınan final resim URL'si:", finalImage);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    logger.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // 🚀 Paralel işlemler başlat
    logger.log(
      "🚀 Paralel işlemler başlatılıyor: Gemini + Arkaplan silme + ControlNet hazırlığı..."
    );

    let enhancedPrompt, backgroundRemovedImage;

    if (isColorChange || isPoseChange || isRefinerMode) {
      // 🎨 COLOR CHANGE MODE, 🕺 POSE CHANGE MODE veya 🔧 REFINER MODE - Özel prompt'lar
      if (isColorChange) {
        logger.log(
          "🎨 Color change mode: Basit renk değiştirme prompt'u oluşturuluyor"
        );
        enhancedPrompt = `Change the main color of the product/item in this image to ${targetColor}. Keep all design details, patterns, textures, and shapes exactly the same. Only change the primary color to ${targetColor}. The result should be photorealistic with natural lighting.`;
      } else if (isRefinerMode) {
        logger.log(
          "🔧 Refiner mode: Profesyonel e-ticaret fotoğraf refiner prompt'u oluşturuluyor"
        );

        // Refiner modu için Gemini ile gelişmiş prompt oluştur
        logger.log(
          "🤖 [GEMINI CALL - REFINER] enhancePromptWithGemini parametreleri:"
        );
        logger.log("🤖 [GEMINI CALL - REFINER] - finalImage URL:", finalImage);
        logger.log(
          "🤖 [GEMINI CALL - REFINER] - isMultipleProducts:",
          isMultipleProducts
        );

        enhancedPrompt = await enhancePromptWithGemini(
          promptText ||
          "Transform this amateur product photo into a professional high-end e-commerce product photo with invisible mannequin effect, perfect lighting, white background, and luxury presentation quality",
          finalImage,
          settings || {},
          locationImage,
          poseImage,
          hairStyleImage,
          isMultipleProducts,
          false, // isColorChange
          null, // targetColor
          false, // isPoseChange
          null, // customDetail
          false, // isEditMode
          null, // editPrompt
          isRefinerMode, // isRefinerMode - yeni parametre
          req.body.isBackSideAnalysis || false, // Arka taraf analizi modu mu?
          referenceImages, // Multi-product için tüm referans resimler
          false, // isMultipleImages
          userId, // Compress için userId
          originalBase64ForGemini // 🚀 Orijinal base64 - URL indirmesi atlanacak
        );
      } else if (isPoseChange) {
        logger.log(
          "🕺 Pose change mode: Gemini ile poz değiştirme prompt'u oluşturuluyor"
        );

        // Poz değiştirme modunda Gemini ile prompt oluştur
        logger.log(
          "🤖 [GEMINI CALL - POSE] enhancePromptWithGemini parametreleri:"
        );
        logger.log("🤖 [GEMINI CALL - POSE] - finalImage URL:", finalImage);
        logger.log(
          "🤖 [GEMINI CALL - POSE] - isMultipleProducts:",
          isMultipleProducts
        );
        logger.log(
          "🤖 [GEMINI CALL - POSE] - referenceImages sayısı:",
          referenceImages?.length || 0
        );

        // EditScreen modunda editPrompt'u, normal modda promptText'i kullan
        const promptToUse =
          isEditMode && editPrompt && editPrompt.trim()
            ? editPrompt.trim()
            : promptText;

        logger.log(
          "📝 [GEMINI CALL - POSE] Kullanılacak prompt:",
          isEditMode ? "editPrompt" : "promptText"
        );
        logger.log("📝 [GEMINI CALL - POSE] Prompt içeriği:", promptToUse);

        // Pose change için sadece model fotoğrafını Gemini'ye gönder
        let modelImageForGemini;
        if (
          modelReferenceImage &&
          (modelReferenceImage.uri || modelReferenceImage.url)
        ) {
          modelImageForGemini = sanitizeImageUrl(
            modelReferenceImage.uri || modelReferenceImage.url
          );
        } else if (referenceImages && referenceImages.length > 0) {
          const firstReference = referenceImages[0];
          modelImageForGemini = sanitizeImageUrl(
            firstReference && (firstReference.uri || firstReference.url)
              ? firstReference.uri || firstReference.url
              : firstReference
          );
        } else {
          modelImageForGemini = finalImage;
        }

        logger.log(
          "🤖 [GEMINI CALL - POSE] Sadece model fotoğrafı gönderiliyor:",
          modelImageForGemini
        );

        enhancedPrompt = await enhancePromptWithGemini(
          promptToUse, // EditScreen'de editPrompt, normal modda promptText
          modelImageForGemini, // Sadece model fotoğrafı (ilk resim)
          settings || {},
          locationImage,
          poseImage,
          hairStyleImage,
          false, // isMultipleProducts - pose change'de product yok
          false, // isColorChange
          null, // targetColor
          isPoseChange, // isPoseChange
          customDetail, // customDetail
          isEditMode, // isEditMode
          editPrompt, // editPrompt
          false, // isRefinerMode
          false, // isBackSideAnalysis - pose change'de arka analizi yok
          null, // referenceImages - Gemini'ye product photolar gönderilmez
          false, // isMultipleImages - Gemini'ye tek resim gönderiliyor
          userId, // Compress için userId
          originalBase64ForGemini // 🚀 Orijinal base64 - URL indirmesi atlanacak
        );
      }
      backgroundRemovedImage = finalImage; // Orijinal image'ı kullan, arkaplan silme yok
      logger.log(
        isColorChange
          ? "🎨 Color change prompt:"
          : isRefinerMode
            ? "🔧 Refiner prompt:"
            : "🕺 Pose change prompt:",
        enhancedPrompt
      );
    } else if (!isPoseChange) {
      // 🖼️ NORMAL MODE - Arkaplan silme işlemi (paralel)
      // Gemini prompt üretimini paralelde başlat
      logger.log("🤖 [GEMINI CALL] enhancePromptWithGemini parametreleri:");
      logger.log("🤖 [GEMINI CALL] - finalImage URL:", finalImage);
      logger.log("🤖 [GEMINI CALL] - isMultipleProducts:", isMultipleProducts);
      logger.log(
        "🤖 [GEMINI CALL] - referenceImages sayısı:",
        referenceImages?.length || 0
      );

      // EditScreen modunda editPrompt'u, normal modda promptText'i kullan
      const promptToUse =
        isEditMode && editPrompt && editPrompt.trim()
          ? editPrompt.trim()
          : promptText;

      logger.log(
        "📝 [GEMINI CALL] Kullanılacak prompt:",
        isEditMode ? "editPrompt" : "promptText"
      );
      logger.log("📝 [GEMINI CALL] Prompt içeriği:", promptToUse);

      const geminiPromise = enhancePromptWithGemini(
        promptToUse, // EditScreen'de editPrompt, normal modda promptText
        finalImage, // Ham orijinal resim (kombin modunda birleştirilmiş grid)
        settings || {},
        locationImage,
        poseImage,
        hairStyleImage,
        isMultipleProducts, // Kombin modunda true olmalı
        isColorChange, // Renk değiştirme işlemi mi?
        targetColor, // Hedef renk bilgisi
        isPoseChange, // Poz değiştirme işlemi mi?
        customDetail, // Özel detay bilgisi
        isEditMode, // EditScreen modu mu?
        editPrompt, // EditScreen'den gelen prompt
        isRefinerMode, // RefinerScreen modu mu?
        req.body.isBackSideAnalysis || false, // Arka taraf analizi modu mu?
        referenceImages, // Multi-product için tüm referans resimler
        isMultipleImages, // Çoklu resim modu mu?
        userId, // Compress için userId
        originalBase64ForGemini // 🚀 Orijinal base64 - URL indirmesi atlanacak
      );

      // ⏳ Sadece Gemini prompt iyileştirme bekle
      logger.log("⏳ Gemini prompt iyileştirme bekleniyor...");
      enhancedPrompt = await geminiPromise;
    }

    logger.log("✅ Gemini prompt iyileştirme tamamlandı");

    // Arkaplan silme kaldırıldı - direkt olarak finalImage kullanılacak
    backgroundRemovedImage = finalImage;

    // 🎨 Yerel ControlNet Canny çıkarma işlemi - Arkaplan silindikten sonra
    // logger.log("🎨 Yerel ControlNet Canny çıkarılıyor (Sharp ile)...");
    let cannyImage = null;
    // try {
    //   cannyImage = await generateLocalControlNetCanny(
    //     backgroundRemovedImage,
    //     userId
    //   );
    //   logger.log("✅ Yerel ControlNet Canny tamamlandı:", cannyImage);
    // } catch (controlNetError) {
    //   console.error(
    //     "❌ Yerel ControlNet Canny hatası:",
    //     controlNetError.message
    //   );
    //   logger.log(
    //     "⚠️ Yerel ControlNet hatası nedeniyle sadece arkaplanı silinmiş resim kullanılacak"
    //   );
    //   cannyImage = null;
    // }

    // 👤 Portrait generation kaldırıldı - Gemini kendi kendine hallediyor

    // 🖼️ Çoklu resim modunda ayrı resimleri kullan, tek resim modunda arkaplan kaldırılmış resmi kullan
    let combinedImageForReplicate;

    if (isMultipleImages && referenceImages.length > 1) {
      // Çoklu resim modunda ayrı resimleri kullan (canvas birleştirme yok)
      combinedImageForReplicate = null; // Ayrı resimler kullanılacak
      logger.log(
        "🖼️ [BACKEND] Çoklu resim modu: Ayrı resimler Gemini'ye gönderilecek"
      );
    } else {
      // Tek resim modunda arkaplan kaldırılmış resmi kullan
      // Back side analysis durumunda canvas kullanmıyoruz
      if (!req.body.isBackSideAnalysis) {
        combinedImageForReplicate = backgroundRemovedImage;
        logger.log(
          "🖼️ [BACKEND] Tek resim modu: Arkaplan kaldırılmış resim Gemini'ye gönderiliyor"
        );
      } else {
        combinedImageForReplicate = null; // Back side'da kullanılmıyor
        logger.log(
          "🔄 [BACK_SIDE] Canvas bypass edildi, direkt URL'ler kullanılacak"
        );
      }
    }
    // if (cannyImage) {
    //   try {
    //     logger.log(
    //       "🎨 Orijinal ve Canny resimleri birleştiriliyor (Replicate için)..."
    //     );
    //     combinedImageForReplicate = await combineTwoImagesWithBlackLine(
    //       backgroundRemovedImage,
    //       cannyImage,
    //       userId
    //     );
    //     logger.log(
    //       "✅ İki resim birleştirme tamamlandı:",
    //       combinedImageForReplicate
    //     );
    //   } catch (combineError) {
    //     console.error("❌ Resim birleştirme hatası:", combineError.message);
    //     logger.log(
    //       "⚠️ Birleştirme hatası nedeniyle sadece arkaplanı silinmiş resim kullanılacak"
    //     );
    //     combinedImageForReplicate = backgroundRemovedImage;
    //   }
    // } else {
    //   logger.log(
    //     "⚠️ ControlNet Canny mevcut değil, sadece arkaplanı silinmiş resim kullanılacak"
    //   );
    // }

    logger.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    logger.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // 🔧 REFINER MODE: Use GPT Image 1.5 instead of nano-banana
    if (isRefinerMode) {
      logger.log("🔧 [REFINER MODE] GPT Image 1.5 API kullanılacak...");
      logger.log("🔧 [REFINER MODE] Final Image URL:", finalImage);

      try {
        // GPT Image 1.5 ile görsel oluştur
        const gptImageResult = await callFalAiGptImageEditForRefiner(
          enhancedPrompt,
          finalImage
        );

        logger.log(
          "✅ [REFINER MODE] GPT Image 1.5 başarılı:",
          gptImageResult
        );

        // Generation'ı completed olarak güncelle (result_image_url ile - updateGenerationStatus içinde Supabase'e kaydediliyor)
        await updateGenerationStatus(finalGenerationId, userId, "completed", {
          result_image_url: gptImageResult,
          enhanced_prompt: enhancedPrompt,
        });

        logger.log(
          "✅ [REFINER MODE] Generation completed olarak güncellendi"
        );

        // Response döndür (imageUrl eklendi - RefinerScreen için)
        return res.json({
          success: true,
          result: {
            imageUrl: gptImageResult, // RefinerScreen bu format'ı bekliyor
            output: [gptImageResult], // Diğer client'lar için
            prompt: enhancedPrompt,
            generationId: finalGenerationId,
            isRefinerMode: true,
            apiUsed: "gpt-image-1.5",
          },
        });
      } catch (refinerError) {
        console.error(
          "❌ [REFINER MODE] GPT Image 1.5 hatası:",
          refinerError.message
        );

        // Generation'ı failed olarak güncelle
        await updateGenerationStatus(finalGenerationId, userId, "failed");

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
                  (currentUserCredit?.credit_balance || 0) +
                  actualCreditDeducted,
              })
              .eq("id", userId);

            logger.log(
              `💰 ${actualCreditDeducted} kredi iade edildi (Refiner mode hatası)`
            );
          } catch (refundError) {
            console.error("❌ Kredi iade hatası:", refundError);
          }
        }

        return res.status(500).json({
          success: false,
          result: {
            message: "Refiner işlemi başarısız oldu",
            error: refinerError.message,
          },
        });
      }
    }

    // Fal.ai nano-banana modeli ile istek gönder (NORMAL MODE - non-refiner)
    let replicateResponse;
    const maxRetries = 3;
    let totalRetryAttempts = 0;
    let retryReasons = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.log(
          `🔄 Fal.ai nano-banana API attempt ${attempt}/${maxRetries}`
        );

        logger.log("🚀 Fal.ai nano-banana API çağrısı yapılıyor...");

        // Fal.ai API için request body hazırla
        let imageInputArray;

        // Back side analysis: 2 ayrı resim gönder
        if (
          req.body.isBackSideAnalysis &&
          referenceImages &&
          referenceImages.length >= 2
        ) {
          logger.log(
            "🔄 [BACK_SIDE] 2 ayrı resim Nano Banana'ya gönderiliyor..."
          );
          imageInputArray = [
            referenceImages[0].uri || referenceImages[0], // Ön resim - direkt string
            referenceImages[1].uri || referenceImages[1], // Arka resim - direkt string
          ];
          logger.log("📤 [BACK_SIDE] Image input array:", imageInputArray);
        } else if (
          (isMultipleImages && referenceImages.length > 1) ||
          (modelReferenceImage &&
            (referenceImages.length > 0 || combinedImageForReplicate))
        ) {
          const totalRefs =
            referenceImages.length + (modelReferenceImage ? 1 : 0);
          logger.log(
            `🖼️ [MULTIPLE] ${totalRefs} adet referans resmi Nano Banana'ya gönderiliyor...`
          );

          const sortedImages = [];

          if (modelReferenceImage) {
            sortedImages.push({
              ...modelReferenceImage,
              uri: sanitizeImageUrl(
                modelReferenceImage.uri || modelReferenceImage
              ),
              type: modelReferenceImage.type || "model",
            });
          }

          if (isMultipleImages && referenceImages.length > 1) {
            const normalizedProducts = referenceImages.map((img) => ({
              ...img,
              uri: sanitizeImageUrl(img.uri || img),
              type: img?.type || "product",
            }));
            sortedImages.push(...normalizedProducts);
          } else if (referenceImages.length > 0 || combinedImageForReplicate) {
            const productSource =
              typeof combinedImageForReplicate === "string" &&
                combinedImageForReplicate
                ? combinedImageForReplicate
                : referenceImages[0]?.uri || referenceImages[0];

            if (productSource) {
              sortedImages.push({
                uri: sanitizeImageUrl(productSource),
                type: "product",
                isModelReference: false,
              });
            }
          }

          imageInputArray = sortedImages.map((img) => img.uri || img);
          logger.log(
            "📤 [MULTIPLE] Sıralı image input array:",
            sortedImages.map((img, idx) => `${idx + 1}. ${img.type}`)
          );
          logger.log("📤 [MULTIPLE] Image URLs:", imageInputArray);
        } else {
          // Tek resim modu: Birleştirilmiş tek resim
          imageInputArray = [combinedImageForReplicate];
        }

        // Kalite versiyonu kontrolü (settings'ten al)
        const qualityVersion = isRefinerMode
          ? "v1"
          : settings?.qualityVersion || settings?.quality_version || "v1";
        const isV2 = qualityVersion === "v2";
        // For fal.ai, we use nano-banana/edit for v1 and nano-banana-2/edit for v2
        // Back side analysis modunda her zaman nano-banana-2 kullan
        const falModel =
          isV2 || req.body.isBackSideAnalysis
            ? "fal-ai/nano-banana-2/edit"
            : "fal-ai/nano-banana/edit";

        logger.log(
          `🎨 [QUALITY_VERSION] Seçilen versiyon: ${qualityVersion}, Model: ${falModel}`
        );

        let requestBody;
        const aspectRatioForRequest = formattedRatio || "9:16";

        const maxPromptLength = 4900;
        let truncatedPrompt = enhancedPrompt;
        logger.log(`📏 [FAL_PROMPT] Enhanced prompt uzunluğu: ${enhancedPrompt.length} karakter`);
        if (enhancedPrompt.length > maxPromptLength) {
          logger.log(
            `⚠️ Prompt ${enhancedPrompt.length} karakter, ${maxPromptLength}'e kırpılıyor...`
          );
          truncatedPrompt = enhancedPrompt.substring(0, maxPromptLength);
        }
        logger.log(`📋 [FAL_PROMPT] Fal.ai'ya giden prompt (${truncatedPrompt.length} karakter):`, truncatedPrompt);

        // v2/backSide: 2K resolution, v1: 2K
        const resolutionParam =
          isV2 || req.body.isBackSideAnalysis ? "2K" : "2K";

        if (isPoseChange) {
          requestBody = {
            prompt: truncatedPrompt,
            image_urls: imageInputArray,
            output_format: "png",
            aspect_ratio: aspectRatioForRequest,
            num_images: 1,
            resolution: resolutionParam,
            safety_tolerance: "6",
            ...(isV2 && { limit_generations: true }),
          };
          logger.log(
            `🕺 [POSE_CHANGE] fal.ai ${falModel} request body hazırlandı`
          );
          logger.log(
            "🕺 [POSE_CHANGE] Prompt:",
            enhancedPrompt.substring(0, 200) + "..."
          );
        } else {
          requestBody = {
            prompt: truncatedPrompt,
            image_urls: imageInputArray,
            output_format: "png",
            aspect_ratio: aspectRatioForRequest,
            num_images: 1,
            resolution: resolutionParam,
            safety_tolerance: "6",
            ...(isV2 && { limit_generations: true }),
          };
        }

        logger.log("📋 Fal.ai Request Body:", {
          prompt: enhancedPrompt.substring(0, 100) + "...",
          imageInput: req.body.isBackSideAnalysis
            ? "2 separate images"
            : isMultipleImages && referenceImages.length > 1
              ? `${referenceImages.length} separate images`
              : "single combined image",
          imageInputArray: imageInputArray,
          outputFormat: "png",
          aspectRatio: aspectRatioForRequest,
        });

        // Fal.ai API çağrısı
        const response = await axios.post(
          `https://fal.run/${falModel}`,
          requestBody,
          {
            headers: {
              Authorization: `Key ${process.env.FAL_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 300000, // 5 dakika timeout
          }
        );

        logger.log("📋 Fal.ai API Response Status:", response.status);
        logger.log("📋 Fal.ai API Response Data:", {
          request_id: response.data.request_id,
          hasImages: !!response.data.images,
          imagesCount: response.data.images?.length || 0,
        });

        // Fal.ai Response kontrolü - fal.ai returns images array directly
        if (response.data.images && response.data.images.length > 0) {
          logger.log(
            "✅ Fal.ai API başarılı, images alındı:",
            response.data.images.map((img) => img.url)
          );

          // Fal.ai response'u Replicate formatına dönüştür (mevcut kod ile uyumluluk için)
          const outputUrls = response.data.images.map((img) => img.url);
          replicateResponse = {
            data: {
              id: response.data.request_id || `fal-${uuidv4()}`,
              status: "succeeded",
              output: outputUrls,
              urls: {
                get: null,
              },
            },
          };

          logger.log(
            `✅ Fal.ai nano-banana API başarılı (attempt ${attempt})`
          );
          break; // Başarılı olursa loop'tan çık
        } else if (response.data.detail || response.data.error) {
          // Fal.ai error response
          const errorMsg = response.data.detail || response.data.error;
          console.error("❌ Fal.ai API failed:", errorMsg);

          // Geçici hatalar için retry yap
          if (
            typeof errorMsg === "string" &&
            (errorMsg.includes("temporarily unavailable") ||
              errorMsg.includes("try again later") ||
              errorMsg.includes("rate limit") ||
              errorMsg.includes("timeout"))
          ) {
            logger.log(
              `🔄 Geçici fal.ai hatası tespit edildi (attempt ${attempt}), retry yapılacak:`,
              errorMsg
            );
            retryReasons.push(`Attempt ${attempt}: ${errorMsg}`);
            throw new Error(`RETRYABLE_SERVICE_ERROR: ${errorMsg}`);
          }

          throw new Error(`Fal.ai API failed: ${errorMsg || "Unknown error"}`);
        } else {
          // No images returned - unexpected
          console.error(
            "❌ Fal.ai API unexpected response - no images:",
            response.data
          );
          throw new Error(`Fal.ai API returned no images`);
        }
      } catch (apiError) {
        console.error(
          `❌ Fal.ai nano-banana API attempt ${attempt} failed:`,
          apiError.message
        );

        // 120 saniye timeout hatası ise direkt failed yap ve retry yapma
        if (
          apiError.message.includes("timeout") ||
          apiError.code === "ETIMEDOUT" ||
          apiError.code === "ECONNABORTED"
        ) {
          console.error(
            `❌ 120 saniye timeout hatası, generation failed yapılıyor: ${apiError.message}`
          );

          // Generation status'unu direkt failed yap
          await updateGenerationStatus(finalGenerationId, userId, "failed", {
            processing_time_seconds: 120,
          });

          throw apiError; // Timeout hatası için retry yok
        }

        // Son deneme değilse ve network hataları veya geçici hatalar ise tekrar dene
        if (
          attempt < maxRetries &&
          (apiError.code === "ECONNRESET" ||
            apiError.code === "ENOTFOUND" ||
            apiError.response?.status >= 500 ||
            apiError.message.includes("RETRYABLE_SERVICE_ERROR"))
        ) {
          totalRetryAttempts++;
          const waitTime = attempt * 2000; // 2s, 4s, 6s bekle
          logger.log(
            `⏳ ${waitTime}ms bekleniyor, sonra tekrar denenecek... (${attempt}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        // Retry yapılamayan hatalar için log
        console.error(
          `❌ Retry yapılamayan hata türü (attempt ${attempt}/${maxRetries}):`,
          {
            code: apiError.code,
            message: apiError.message?.substring(0, 100),
            status: apiError.response?.status,
          }
        );

        // Son deneme veya farklı hata türü ise fırlat
        throw apiError;
      }
    }

    const initialResult = replicateResponse.data;
    logger.log("Fal.ai API başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error("Replicate prediction ID alınamadı:", initialResult);

      // 🗑️ Prediction ID hatası durumunda geçici dosyaları temizle
      logger.log(
        "🧹 Prediction ID hatası sonrası geçici dosyalar temizleniyor..."
      );
      await cleanupTemporaryFiles(temporaryFiles);

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
                (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
            })
            .eq("id", userId);

          logger.log(
            `💰 ${actualCreditDeducted} kredi iade edildi (Prediction ID hatası)`
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

    // Fal.ai nano-banana API - Status kontrolü (fal.ai genellikle sonucu direkt döner)
    const startTime = Date.now();
    let finalResult;
    let processingTime;
    const maxPollingRetries = 3; // Fallback retry

    // Status kontrolü
    if (initialResult.status === "succeeded") {
      // Direkt başarılı sonuç
      logger.log("🎯 Fal.ai nano-banana - başarılı sonuç, polling atlanıyor");
      finalResult = initialResult;
      processingTime = Math.round((Date.now() - startTime) / 1000);
    } else if (
      initialResult.status === "processing" ||
      initialResult.status === "starting"
    ) {
      // Processing durumunda polling yap (fal.ai için genellikle gerekmez)
      logger.log(
        "⏳ Fal.ai nano-banana - processing status, polling başlatılıyor"
      );

      try {
        finalResult = await pollReplicateResultWithRetry(
          initialResult.id,
          maxPollingRetries
        );
        processingTime = Math.round((Date.now() - startTime) / 1000);
      } catch (pollingError) {
        console.error("❌ Polling hatası:", pollingError.message);

        // Polling hatası durumunda status'u failed'e güncelle
        await updateGenerationStatus(finalGenerationId, userId, "failed", {
          processing_time_seconds: Math.round((Date.now() - startTime) / 1000),
        });

        // 🗑️ Polling hatası durumunda geçici dosyaları temizle
        logger.log(
          "🧹 Polling hatası sonrası geçici dosyalar temizleniyor..."
        );
        await cleanupTemporaryFiles(temporaryFiles);

        // Error response'a generationId ekle ki client hangi generation'ın başarısız olduğunu bilsin
        return res.status(500).json({
          success: false,
          result: {
            message: "Görsel işleme işlemi başarısız oldu",
            error: pollingError.message.includes("PREDICTION_INTERRUPTED")
              ? "Sunucu kesintisi oluştu. Lütfen tekrar deneyin."
              : "İşlem sırasında teknik bir sorun oluştu. Lütfen tekrar deneyin.",
            generationId: finalGenerationId, // Client için generation ID ekle
            status: "failed",
          },
        });
      }
    } else {
      // Diğer durumlar (failed, vs) - retry mekanizmasıyla
      logger.log(
        "🎯 Fal.ai nano-banana - failed status, retry mekanizması başlatılıyor"
      );

      // Failed status için retry logic
      let retrySuccessful = false;
      for (
        let retryAttempt = 1;
        retryAttempt <= maxPollingRetries;
        retryAttempt++
      ) {
        logger.log(
          `🔄 Failed status retry attempt ${retryAttempt}/${maxPollingRetries}`
        );

        try {
          // 2 saniye bekle, sonra yeni prediction başlat
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * retryAttempt)
          );

          // Aynı parametrelerle yeni prediction oluştur
          let retryImageInputArray;

          // Back side analysis: 2 ayrı resim gönder
          if (
            req.body.isBackSideAnalysis &&
            referenceImages &&
            referenceImages.length >= 2
          ) {
            logger.log(
              "🔄 [RETRY BACK_SIDE] 2 ayrı resim Nano Banana'ya gönderiliyor..."
            );
            retryImageInputArray = [
              referenceImages[0].uri || referenceImages[0], // Ön resim - direkt string
              referenceImages[1].uri || referenceImages[1], // Arka resim - direkt string
            ];
          } else if (
            (isMultipleImages && referenceImages.length > 1) ||
            (modelReferenceImage &&
              (referenceImages.length > 0 || combinedImageForReplicate))
          ) {
            const totalRefs =
              referenceImages.length + (modelReferenceImage ? 1 : 0);
            logger.log(
              `🔄 [RETRY MULTIPLE] ${totalRefs} ayrı resim Nano Banana'ya gönderiliyor...`
            );

            const sortedImages = [];

            if (modelReferenceImage) {
              sortedImages.push(
                sanitizeImageUrl(modelReferenceImage.uri || modelReferenceImage)
              );
            }

            if (isMultipleImages && referenceImages.length > 1) {
              referenceImages.forEach((img) =>
                sortedImages.push(sanitizeImageUrl(img.uri || img))
              );
            } else {
              const productSource =
                typeof combinedImageForReplicate === "string" &&
                  combinedImageForReplicate
                  ? combinedImageForReplicate
                  : referenceImages[0]?.uri || referenceImages[0];

              if (productSource) {
                sortedImages.push(sanitizeImageUrl(productSource));
              }
            }

            retryImageInputArray = sortedImages;
          } else {
            // Tek resim modu: Birleştirilmiş tek resim
            retryImageInputArray = [combinedImageForReplicate];
          }

          const retryRequestBody = {
            prompt: enhancedPrompt,
            image_urls: retryImageInputArray,
            output_format: "png",
            aspect_ratio: formattedRatio || "9:16",
            num_images: 1,
            resolution: resolutionParam,
            safety_tolerance: "6",
            ...(isV2 && { limit_generations: true }),
          };

          logger.log(
            `🔄 Retry ${retryAttempt}: Yeni prediction oluşturuluyor... (Model: ${falModel})`
          );

          const retryResponse = await axios.post(
            `https://fal.run/${falModel}`,
            retryRequestBody,
            {
              headers: {
                Authorization: `Key ${process.env.FAL_API_KEY}`,
                "Content-Type": "application/json",
              },
              timeout: 300000,
            }
          );

          logger.log(`🔄 Retry ${retryAttempt} Response:`, {
            request_id: retryResponse.data.request_id,
            hasImages: !!retryResponse.data.images,
            imagesCount: retryResponse.data.images?.length || 0,
          });

          // Retry response kontrolü - fal.ai returns images array directly
          if (
            retryResponse.data.images &&
            retryResponse.data.images.length > 0
          ) {
            const outputUrls = retryResponse.data.images.map((img) => img.url);
            logger.log(
              `✅ Retry ${retryAttempt} başarılı! Images alındı:`,
              outputUrls
            );
            // Fal.ai response'u mevcut format ile uyumlu hale getir
            finalResult = {
              id: retryResponse.data.request_id || `fal-retry-${uuidv4()}`,
              status: "succeeded",
              output: outputUrls,
            };
            retrySuccessful = true;
            break;
          } else if (retryResponse.data.detail || retryResponse.data.error) {
            console.error(
              `❌ Retry ${retryAttempt} başarısız:`,
              retryResponse.data.detail || retryResponse.data.error
            );
            // Bu retry attempt başarısız, bir sonraki deneme yapılacak
          } else {
            console.error(
              `❌ Retry ${retryAttempt} başarısız - no images returned`
            );
            // Bu retry attempt başarısız, bir sonraki deneme yapılacak
          }
        } catch (retryError) {
          console.error(
            `❌ Retry ${retryAttempt} exception:`,
            retryError.message
          );
          // Bu retry attempt başarısız, bir sonraki deneme yapılacak
        }
      }

      if (!retrySuccessful) {
        console.error(
          `❌ Tüm retry attemptları başarısız oldu. Orijinal failed result kullanılıyor.`
        );
        finalResult = initialResult;
      }

      processingTime = Math.round((Date.now() - startTime) / 1000);
    }

    logger.log("Fal.ai final result:", finalResult);

    // Flux-kontext-dev API'den gelen sonuç farklı format olabilir (Prefer: wait nedeniyle)
    const isFluxKontextDevResult =
      finalResult && !finalResult.status && finalResult.output;
    const isStandardResult =
      finalResult.status === "succeeded" && finalResult.output;

    // Dev API'ye fallback yapıldıktan sonra başarılı sonuç kontrolü
    if (isFluxKontextDevResult || isStandardResult) {
      logger.log("Replicate API işlemi başarılı");

      // 📊 Retry istatistiklerini logla
      if (totalRetryAttempts > 0) {
        logger.log(
          `📊 Retry İstatistikleri: ${totalRetryAttempts} retry yapıldı`
        );
        logger.log(`📊 Retry Nedenleri: ${retryReasons.join(" | ")}`);
      } else {
        logger.log("📊 Retry İstatistikleri: İlk denemede başarılı");
      }

      // ✅ Status'u completed'e güncelle
      // fal.ai returns output as array, always use the first image
      const resultImageUrl = Array.isArray(finalResult.output)
        ? finalResult.output[0]
        : finalResult.output;
      const updatedGeneration = await updateGenerationStatus(finalGenerationId, userId, "completed", {
        enhanced_prompt: enhancedPrompt,
        result_image_url: resultImageUrl,
        replicate_prediction_id: initialResult.id,
        processing_time_seconds: processingTime,
      });
      // updateGenerationStatus Supabase bucket'e kaydedip DB'yi günceller,
      // dönen kayıttaki result_image_url artık Supabase URL'sidir (fal.media değil)
      const finalResultImageUrl = updatedGeneration?.result_image_url || resultImageUrl;

      // 💳 KREDI GÜNCELLEME SIRASI
      // Kredi düşümü updateGenerationStatus içinde tetikleniyor (pay-on-success).
      // Bu nedenle güncel krediyi, status güncellemesinden SONRA okumalıyız.
      // 🔗 TEAM-AWARE: Team member için owner'ın kredisini döndür
      let currentCredit = null;
      if (userId && userId !== "anonymous_user") {
        try {
          const effectiveCredits = await teamService.getEffectiveCredits(userId);
          currentCredit = effectiveCredits.creditBalance || 0;
          logger.log(
            `💳 Güncel kredi balance (post-deduct, team-aware): ${currentCredit}`,
            effectiveCredits.isTeamCredit ? `(team owner: ${effectiveCredits.creditOwnerId})` : ''
          );
        } catch (creditError) {
          console.error(
            "❌ Güncel kredi sorgu hatası (post-deduct):",
            creditError
          );
        }
      }

      const responseData = {
        success: true,
        result: {
          // Supabase bucket URL kullan (fal.media yerine)
          imageUrl: finalResultImageUrl,
          imageUrlThumbnail: finalResultImageUrl ? optimizeImageUrl(finalResultImageUrl, { width: 500, height: 500, quality: 80 }) : null,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
          replicateData: finalResult,
          currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
          generationId: finalGenerationId, // 🆔 Generation ID'yi response'a ekle
        },
      };

      // Not: saveGenerationToDatabase artık gerekli değil çünkü updateGenerationStatus ile güncelliyoruz

      // 🗑️ İşlem başarıyla tamamlandı, geçici dosyaları hemen temizle
      logger.log("🧹 Başarılı işlem sonrası geçici dosyalar temizleniyor...");
      await cleanupTemporaryFiles(temporaryFiles);

      return res.status(200).json(responseData);
    } else {
      console.error("Replicate API başarısız:", finalResult);

      // ❌ Status'u failed'e güncelle
      await updateGenerationStatus(finalGenerationId, userId, "failed", {
        // error_message kolonu yok, bu yüzden genel field kullan
        processing_time_seconds: Math.round((Date.now() - startTime) / 1000),
      });

      // 🗑️ Replicate hata durumında geçici dosyaları temizle
      logger.log(
        "🧹 Replicate hatası sonrası geçici dosyalar temizleniyor..."
      );
      await cleanupTemporaryFiles(temporaryFiles);

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
                (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
            })
            .eq("id", userId);

          logger.log(
            `💰 ${actualCreditDeducted} kredi iade edildi (Replicate hatası)`
          );
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
          generationId: finalGenerationId, // Client için generation ID ekle
        },
      });
    }
  } catch (error) {
    console.error("Resim oluşturma hatası:", error);

    // ❌ Status'u failed'e güncelle (genel hata durumu)
    if (finalGenerationId) {
      await updateGenerationStatus(finalGenerationId, userId, "failed", {
        // error_message kolonu yok, bu yüzden genel field kullan
        processing_time_seconds: 0,
      });
    }

    // 🗑️ Hata durumunda da geçici dosyaları temizle
    logger.log("🧹 Hata durumunda geçici dosyalar temizleniyor...");
    await cleanupTemporaryFiles(temporaryFiles);

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
              (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
          })
          .eq("id", userId);

        logger.log(
          `💰 ${actualCreditDeducted} kredi iade edildi (Genel hata)`
        );
      } catch (refundError) {
        console.error("❌ Kredi iade hatası:", refundError);
      }
    }

    // Sensitive content hatasını özel olarak handle et
    if (error.message && error.message.startsWith("SENSITIVE_CONTENT:")) {
      return res.status(400).json({
        success: false,
        result: {
          message: "sensitiveContent.message", // i18n key
          title: "sensitiveContent.title", // i18n key
          shortMessage: "sensitiveContent.shortMessage", // i18n key
          error_type: "sensitive_content",
          user_friendly: true,
          i18n_keys: {
            message: "sensitiveContent.message",
            title: "sensitiveContent.title",
            shortMessage: "sensitiveContent.shortMessage",
            understood: "sensitiveContent.understood",
          },
        },
      });
    }

    // Prediction interrupted (PA) hatasını özel olarak handle et
    if (error.message && error.message.startsWith("PREDICTION_INTERRUPTED:")) {
      return res.status(503).json({
        success: false,
        result: {
          message:
            "Replicate sunucusunda geçici bir kesinti oluştu. Lütfen birkaç dakika sonra tekrar deneyin.",
          error_type: "prediction_interrupted",
          user_friendly: true,
          retry_after: 30, // 30 saniye sonra tekrar dene
        },
      });
    }

    // Timeout hatalarını özel olarak handle et
    if (
      error.message &&
      (error.message.includes("timeout") ||
        error.message.includes("Gemini API timeout") ||
        error.message.includes("120s"))
    ) {
      return res.status(503).json({
        success: false,
        result: {
          message:
            "İşlem 2 dakika zaman aşımına uğradı. Lütfen daha küçük bir resim deneyiniz veya tekrar deneyin.",
          error_type: "timeout",
          user_friendly: false,
          retry_after: 30, // 30 saniye sonra tekrar dene
        },
      });
    }

    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
        error: error.message,
        generationId: finalGenerationId, // Client için generation ID ekle
        status: "failed",
      },
    });
  }
});

// Kullanıcının reference browser sonuçlarını getiren endpoint
// Team üyesi ise tüm ekip üyelerinin sonuçlarını getirir (Shared Workspace)
router.get("/results/:userId", async (req, res) => {
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

    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

    logger.log(`📊 [RESULTS-V5] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

    const offset = (page - 1) * limit;

    // Kullanıcının (veya takım üyelerinin) sonuçlarını getir (en yeni önce)
    const { data: results, error } = await supabase
      .from("reference_results")
      .select("*")
      .in("user_id", memberIds)
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
      .in("user_id", memberIds);

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
    console.error("❌ Reference browser results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Tüm reference browser sonuçlarını getiren endpoint (admin için)
router.get("/results", async (req, res) => {
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
    console.error("❌ All reference browser results endpoint hatası:", error);
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
router.get("/credit/:userId", async (req, res) => {
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

// Pose açıklaması için Gemini'yi kullan (sadece pose tarifi)
async function generatePoseDescriptionWithGemini(
  poseTitle,
  poseImage,
  gender = "female",
  garmentType = "clothing"
) {
  try {
    logger.log("🤸 [GEMINI] Pose açıklaması oluşturuluyor...");
    logger.log("🤸 [GEMINI] Pose title:", poseTitle);
    logger.log("🤸 [GEMINI] Gender:", gender);
    logger.log("🤸 [GEMINI] Garment type:", garmentType);

    // Gender mapping
    const modelGenderText =
      gender.toLowerCase() === "male" || gender.toLowerCase() === "man"
        ? "male model"
        : "female model";

    // Pose açıklaması için özel prompt
    const posePrompt = `
    POSE DESCRIPTION TASK:
    
    You are a professional fashion photography director. Create a detailed, technical pose description for a ${modelGenderText} wearing ${garmentType}.
    
    POSE TITLE: "${poseTitle}"
    
    REQUIREMENTS:
    - Generate ONLY a detailed pose description/instruction
    - Do NOT create image generation prompts or visual descriptions
    - Focus on body positioning, hand placement, stance, and posture
    - Include specific technical directions for the model
    - Keep it professional and suitable for fashion photography
    - Make it clear and actionable for a model to follow
    - Consider how the pose will showcase the garment effectively
    
    OUTPUT FORMAT:
    Provide only the pose instruction in a clear, professional manner. Start directly with the pose description without any introductory text.
    
    EXAMPLE OUTPUT STYLE:
    "Stand with feet shoulder-width apart, weight shifted to the back leg. Turn torso slightly at a 45-degree angle to the camera. Place left hand on hip with thumb pointing backward, fingers curved naturally. Extend right arm down and slightly away from body. Keep shoulders relaxed and down. Tilt head slightly toward the raised shoulder. Maintain confident eye contact with camera."
    
    Generate a similar detailed pose instruction for the given pose title "${poseTitle}" for a ${modelGenderText}.
    `;

    logger.log("🤸 [GEMINI] Pose prompt hazırlandı:", posePrompt);

    // Replicate Gemini Flash API için resim URL'lerini hazırla
    const imageUrlsForPose = [];

    // Pose image'ını URL olarak ekle (eğer varsa)
    if (poseImage) {
      try {
        const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
        if (
          cleanPoseImageUrl.startsWith("http://") ||
          cleanPoseImageUrl.startsWith("https://")
        ) {
          imageUrlsForPose.push(cleanPoseImageUrl);
          logger.log("🤸 [REPLICATE-GEMINI] Pose görseli eklendi");
        }
      } catch (imageError) {
        console.error("❌ Pose resim ekleme hatası:", imageError);
      }
    }

    // Replicate Gemini Flash API çağrısı (3 retry ile)
    const poseDescription = await callReplicateGeminiFlash(
      posePrompt,
      imageUrlsForPose,
      3
    );

    if (!poseDescription) {
      throw new Error("Replicate Gemini API response is empty");
    }

    logger.log(
      "🤸 [REPLICATE-GEMINI] Pose açıklaması alındı:",
      poseDescription.substring(0, 100) + "..."
    );

    const sanitizedDescription = sanitizePoseText(poseDescription);
    if (sanitizedDescription !== poseDescription) {
      logger.log("🤸 Pose açıklaması temizlendi:", sanitizedDescription);
    }

    return sanitizedDescription;
  } catch (error) {
    console.error("🤸 Replicate Gemini pose açıklaması hatası:", error);
    // Fallback: Basit pose açıklaması
    return sanitizePoseText(
      `Professional ${gender.toLowerCase()} model pose: ${poseTitle}. Stand naturally with good posture, position body to showcase the garment effectively.`
    );
  }
}

// Pose açıklaması oluşturma endpoint'i
router.post("/generatePoseDescription", async (req, res) => {
  try {
    const {
      poseTitle,
      poseImage,
      gender = "female",
      garmentType = "clothing",
    } = req.body;

    logger.log("🤸 Pose açıklaması isteği alındı:");
    logger.log("🤸 Pose title:", poseTitle);
    logger.log("🤸 Gender:", gender);
    logger.log("🤸 Garment type:", garmentType);
    logger.log("🤸 Pose image:", poseImage ? "Mevcut" : "Yok");

    if (!poseTitle) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Pose title gereklidir",
        },
      });
    }

    // Gemini ile pose açıklaması oluştur
    const poseDescription = await generatePoseDescriptionWithGemini(
      poseTitle,
      poseImage,
      gender,
      garmentType
    );

    logger.log("🤸 Pose açıklaması başarıyla oluşturuldu");

    return res.status(200).json({
      success: true,
      result: {
        poseTitle: poseTitle,
        poseDescription: poseDescription,
        gender: gender,
        garmentType: garmentType,
      },
    });
  } catch (error) {
    console.error("🤸 Pose açıklaması endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Pose açıklaması oluşturulurken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Generation status sorgulama endpoint'i (polling için)
router.get("/generation-status/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { userId } = req.query;

    if (!generationId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Generation ID gereklidir",
        },
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

    // Log'u sadece ilk sorgulamada yap (spam önlemek için)
    if (Math.random() < 0.1) {
      // %10 ihtimalle logla
      logger.log(
        `🔍 Generation status sorgusu: ${generationId.slice(
          0,
          8
        )}... (User: ${userId.slice(0, 8)}..., Team: ${isTeamMember})`
      );
    }

    // Generation'ı sorgula - Team üyeleri için .in() kullan
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("generation_id", generationId)
      .in("user_id", memberIds);

    // Debug: Bu user/team'in aktif generation'larını da kontrol et
    if (!generationArray || generationArray.length === 0) {
      const { data: userGenerations } = await supabase
        .from("reference_results")
        .select("generation_id, status, created_at, user_id")
        .in("user_id", memberIds)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (userGenerations && userGenerations.length > 0) {
        logger.log(
          `🔍 User/Team ${userId.slice(0, 8)} has ${userGenerations.length
          } active generations:`,
          userGenerations
            .map((g) => `${g.generation_id ? g.generation_id.slice(0, 8) : 'null'}(${g.status})`)
            .join(", ")
        );

        // 30 dakikadan eski pending/processing generation'ları temizle
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const expiredGenerations = userGenerations.filter(
          (g) => new Date(g.created_at) < thirtyMinutesAgo
        );

        if (expiredGenerations.length > 0) {
          logger.log(
            `🧹 Cleaning ${expiredGenerations.length
            } expired generations for user/team ${userId.slice(0, 8)}`
          );

          // Null generation_id'leri filtrele
          const validGenerationIds = expiredGenerations
            .map((g) => g.generation_id)
            .filter((id) => id !== null && id !== undefined);

          if (validGenerationIds.length > 0) {
            await supabase
              .from("reference_results")
              .update({ status: "failed" })
              .in("generation_id", validGenerationIds)
              .in("user_id", memberIds);
          }
        }
      }
    }

    if (error) {
      console.error("❌ Generation sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Generation sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    // Array'den ilk elemanı al veya yoksa null
    const generation =
      generationArray && generationArray.length > 0 ? generationArray[0] : null;

    if (!generation) {
      // Log'u daha sade yap (spam önlemek için)
      logger.log(
        `🔍 Generation not found: ${generationId.slice(
          0,
          8
        )}... (could be completed or expired)`
      );

      // Frontend'e generation'ın tamamlandığını veya süresi dolduğunu söyle
      return res.status(404).json({
        success: false,
        result: {
          message: "Generation not found (possibly completed or expired)",
          generationId: generationId,
          status: "not_found",
          shouldStopPolling: true, // Frontend'e polling'i durdurmayı söyle
        },
      });
    }

    // ⏰ Processing timeout kontrolü (15 dakika)
    const PROCESSING_TIMEOUT_MINUTES = 15;
    const createdAt = new Date(generation.created_at);
    const now = new Date();
    const minutesElapsed = (now - createdAt) / (1000 * 60);

    let finalStatus = generation.status;
    let shouldUpdateStatus = false;

    if (
      (generation.status === "processing" || generation.status === "pending") &&
      minutesElapsed > PROCESSING_TIMEOUT_MINUTES
    ) {
      logger.log(
        `⏰ Generation ${generationId} timeout (${Math.round(
          minutesElapsed
        )} dakika), failed olarak işaretleniyor`
      );
      finalStatus = "failed";
      shouldUpdateStatus = true;

      // Database'de status'u failed'e güncelle
      try {
        await updateGenerationStatus(generationId, userId, "failed", {
          processing_time_seconds: Math.round(minutesElapsed * 60),
        });
        logger.log(
          `✅ Timeout generation ${generationId} failed olarak güncellendi`
        );
      } catch (updateError) {
        console.error(
          `❌ Timeout generation ${generationId} güncelleme hatası:`,
          updateError
        );
      }
    }

    logger.log(
      `✅ Generation durumu: ${finalStatus}${shouldUpdateStatus ? " (timeout nedeniyle güncellendi)" : ""
      }`
    );

    // 💳 Güncel kredi bilgisini de döndür (arka plandan dönüşte güncellensin)
    let currentCredit = null;
    if (userId && userId !== "anonymous_user") {
      try {
        const { data: userData } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();
        currentCredit = userData?.credit_balance ?? null;
      } catch (creditError) {
        console.error("❌ Kredi sorgu hatası (status endpoint):", creditError);
      }
    }

    const thumbnailUrl = generation.result_image_url ? optimizeImageUrl(generation.result_image_url, { width: 500, height: 500, quality: 80 }) : null;
    if (finalStatus === "completed") {
      logger.log(`🖼️ [THUMBNAIL] Generation ${generation.generation_id}: original=${generation.result_image_url?.substring(0, 60)} | thumbnail=${thumbnailUrl?.substring(0, 80)}`);
    }

    return res.status(200).json({
      success: true,
      result: {
        generationId: generation.generation_id,
        qualityVersion:
          generation.quality_version ||
          generation.settings?.qualityVersion ||
          generation.settings?.quality_version ||
          "v1", // Kalite versiyonu
        status: finalStatus,
        resultImageUrl: generation.result_image_url,
        resultImageThumbnail: thumbnailUrl,
        originalPrompt: generation.original_prompt,
        enhancedPrompt: generation.enhanced_prompt,
        settings: generation.settings || {}, // Settings bilgisini de ekle
        errorMessage: shouldUpdateStatus ? "İşlem zaman aşımına uğradı" : null,
        processingTimeSeconds: generation.processing_time_seconds,
        createdAt: generation.created_at,
        updatedAt: generation.updated_at,
        currentCredit: currentCredit, // 💳 Güncel kredi bilgisi
      },
    });
  } catch (error) {
    console.error("❌ Generation status endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Generation status sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının pending/processing generation'larını getiren endpoint
// Team üyesi ise tüm ekip üyelerinin pending generation'larını getirir (Shared Workspace)
// platform=mobile ise sadece kullanıcının kendi verilerini döndürür
router.get("/pending-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { platform } = req.query; // 'web' veya 'mobile'

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Mobile için sadece kullanıcının kendi verilerini döndür
    // Web için team üyelerinin verilerini de döndür (Shared Workspace)
    let memberIds = [userId];
    let isTeamMember = false;

    if (platform !== 'mobile') {
      const teamData = await teamService.getTeamMemberIds(userId);
      memberIds = teamData.memberIds;
      isTeamMember = teamData.isTeamMember;
    }

    logger.log(`🔍 Pending generations sorgusu: ${userId} (platform: ${platform || 'web'})`);
    logger.log(`📊 [PENDING-V5] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

    // Pending ve processing durumundaki generation'ları getir (takım üyeleri dahil - sadece web)
    const { data: generations, error } = await supabase
      .from("reference_results")
      .select("*")
      .in("user_id", memberIds)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Pending generations sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Pending generations sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    logger.log(
      `✅ ${generations?.length || 0} pending/processing generation bulundu`
    );

    // ⏰ Timeout kontrolü ve otomatik cleanup
    const PROCESSING_TIMEOUT_MINUTES = 15;
    const now = new Date();
    let validGenerations = [];
    let timeoutGenerations = [];

    if (generations && generations.length > 0) {
      for (const gen of generations) {
        const createdAt = new Date(gen.created_at);
        const minutesElapsed = (now - createdAt) / (1000 * 60);

        if (minutesElapsed > PROCESSING_TIMEOUT_MINUTES) {
          logger.log(
            `⏰ Generation ${gen.generation_id} timeout (${Math.round(
              minutesElapsed
            )} dakika)`
          );
          timeoutGenerations.push(gen);

          // Database'de failed olarak işaretle
          try {
            await updateGenerationStatus(gen.generation_id, userId, "failed", {
              processing_time_seconds: Math.round(minutesElapsed * 60),
            });
            logger.log(
              `✅ Timeout generation ${gen.generation_id} failed olarak güncellendi`
            );
          } catch (updateError) {
            console.error(
              `❌ Timeout generation ${gen.generation_id} güncelleme hatası:`,
              updateError
            );
          }
        } else {
          validGenerations.push(gen);
        }
      }

      logger.log(
        `🧹 ${timeoutGenerations.length} timeout generation temizlendi, ${validGenerations.length} aktif generation kaldı`
      );
    }

    return res.status(200).json({
      success: true,
      result: {
        generations:
          validGenerations?.map((gen) => ({
            generationId: gen.generation_id,
            status: gen.status,
            resultImageUrl: gen.result_image_url,
            resultImageThumbnail: gen.result_image_url ? optimizeImageUrl(gen.result_image_url, { width: 500, height: 500, quality: 80 }) : null,
            originalPrompt: gen.original_prompt,
            enhancedPrompt: gen.enhanced_prompt,
            errorMessage: null, // error_message kolonu yok
            processingTimeSeconds: gen.processing_time_seconds,
            createdAt: gen.created_at,
            updatedAt: gen.updated_at,
          })) || [],
        count: validGenerations?.length || 0,
      },
    });
  } catch (error) {
    console.error("❌ Pending generations endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Pending generations sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının tüm generation'larını getiren endpoint (pending, processing, completed, failed)
// Team üyesi ise tüm ekip üyelerinin generation'larını getirir (Shared Workspace)
// platform=mobile ise sadece kullanıcının kendi verilerini döndürür
router.get("/user-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, platform } = req.query; // Opsiyonel: belirli statusleri filtrelemek için, platform: 'web' veya 'mobile'

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Mobile için sadece kullanıcının kendi verilerini döndür
    // Web için team üyelerinin verilerini de döndür (Shared Workspace)
    let memberIds = [userId];
    let isTeamMember = false;

    if (platform !== 'mobile') {
      const teamData = await teamService.getTeamMemberIds(userId);
      memberIds = teamData.memberIds;
      isTeamMember = teamData.isTeamMember;
    }

    logger.log(
      `🔍 User generations sorgusu: ${userId}${status ? ` (status: ${status})` : ""
      } (platform: ${platform || 'web'})`
    );
    logger.log(`📊 [USER-GENERATIONS-V5] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

    // 🕐 Her zaman son 1 saatlik data'yı döndür
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const oneHourAgoISO = oneHourAgo.toISOString();

    logger.log(
      `🕐 [API_FILTER] Son 1 saatlik data döndürülüyor: ${oneHourAgoISO} sonrası`
    );

    // Team üyeleri için .in() kullan
    // User email bilgisini de çekmek için join yap
    let query = supabase
      .from("reference_results")
      .select(`
        *,
        users:user_id (
          email
        )
      `)
      .in("user_id", memberIds)
      .gte("created_at", oneHourAgoISO) // Her zaman 1 saatlik filtreleme
      .order("created_at", { ascending: false });

    // Status filtresi varsa uygula
    if (status) {
      if (status === "pending") {
        query = query.in("status", ["pending", "processing"]);
      } else {
        query = query.eq("status", status);
      }
    }

    const { data: generations, error } = await query;

    if (error) {
      console.error("❌ User generations sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "User generations sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    logger.log(
      `✅ ${generations?.length || 0} generation bulundu (${status || "all statuses"
      })`
    );

    // Debug: Generation'ları logla
    if (generations && generations.length > 0) {
      logger.log(`🔍 [DEBUG] ${generations.length} generation bulundu:`);
      generations.forEach((gen, index) => {
        logger.log(
          `  ${index + 1}. ID: ${gen.generation_id}, Status: ${gen.status}`
        );
      });
    }

    return res.status(200).json({
      success: true,
      result: {
        generations:
          generations?.map((gen) => ({
            id: gen.id,
            generationId: gen.generation_id,
            userId: gen.user_id,
            userEmail: gen.users?.email || null, // Team workspace için user email
            status: gen.status,
            resultImageUrl: gen.result_image_url,
            resultImageThumbnail: gen.result_image_url ? optimizeImageUrl(gen.result_image_url, { width: 500, height: 500, quality: 80 }) : null,
            originalPrompt: gen.original_prompt,
            enhancedPrompt: gen.enhanced_prompt,
            referenceImages: gen.reference_images,
            settings: gen.settings,
            locationImage: gen.location_image,
            poseImage: gen.pose_image,
            hairStyleImage: gen.hair_style_image,
            aspectRatio: gen.aspect_ratio,
            replicatePredictionId: gen.replicate_prediction_id,
            processingTimeSeconds: gen.processing_time_seconds,
            isMultipleImages: gen.is_multiple_images,
            isMultipleProducts: gen.is_multiple_products,
            errorMessage: null, // error_message kolonu yok
            qualityVersion:
              gen.quality_version ||
              gen.settings?.qualityVersion ||
              gen.settings?.quality_version ||
              "v1", // Kalite versiyonu
            createdAt: gen.created_at,
            updatedAt: gen.updated_at,
          })) || [],
        totalCount: generations?.length || 0,
        isTeamData: isTeamMember,
      },
    });
  } catch (error) {
    console.error("❌ User generations endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "User generations sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Belirli bir generation'ın reference_images'larını getiren endpoint
router.get("/generation/:generationId/reference-images", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { userId } = req.query;

    if (!generationId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Generation ID gereklidir",
        },
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    logger.log(
      `🔍 [REFERENCE_IMAGES_ROUTE] Generation ${generationId.slice(
        0,
        8
      )}... için reference images sorgusu (User: ${userId.slice(0, 8)}...)`
    );
    logger.log(`📋 [REFERENCE_IMAGES_ROUTE] Request details:`, {
      method: req.method,
      path: req.path,
      generationId: generationId.slice(0, 8) + "...",
      userId: userId.slice(0, 8) + "...",
      fullUrl: req.originalUrl,
    });

    // Generation'ı sorgula
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select("reference_images, settings, original_prompt, created_at")
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "❌ [REFERENCE_IMAGES] Generation sorgulama hatası:",
        error
      );
      return res.status(500).json({
        success: false,
        result: {
          message: "Generation sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    // Array'den ilk elemanı al
    const generation =
      generationArray && generationArray.length > 0 ? generationArray[0] : null;

    if (!generation) {
      logger.log(
        `🔍 [REFERENCE_IMAGES] Generation ${generationId} bulunamadı`
      );
      return res.status(404).json({
        success: false,
        result: {
          message: "Generation bulunamadı",
          generationId: generationId,
        },
      });
    }

    const referenceImages = generation.reference_images || [];
    logger.log(
      `✅ [REFERENCE_IMAGES] Generation ${generationId} için ${referenceImages.length} reference image bulundu`
    );

    // Reference images'ları işle ve array formatında döndür
    const processedReferenceImages = Array.isArray(referenceImages)
      ? referenceImages.map((imageUrl, index) => ({
        uri: imageUrl,
        width: 1024,
        height: 1024,
        type: index === 0 ? "model" : "product", // İlk resim model, diğerleri product
      }))
      : [];

    return res.status(200).json({
      success: true,
      result: {
        generationId: generationId,
        referenceImages: processedReferenceImages,
        originalPrompt: generation.original_prompt,
        settings: generation.settings,
        createdAt: generation.created_at,
        hasReferenceImages: processedReferenceImages.length > 0,
        totalReferenceImages: processedReferenceImages.length,
      },
    });
  } catch (error) {
    console.error("❌ [REFERENCE_IMAGES] Endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Reference images sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

module.exports = router;
