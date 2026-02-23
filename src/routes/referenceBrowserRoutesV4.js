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
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(`🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

      // Debug: Request bilgilerini logla
      logger.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      logger.log(`🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`);

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls, // Direkt URL string array olarak gönder
          prompt: prompt,
          videos: [],
          temperature: 1,
          thinking_level: "low",
          max_output_tokens: 65535
        }
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
        requestBody,
        {
          headers: {
            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
          },
          timeout: 120000 // 2 dakika timeout
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
        console.error(`❌ [REPLICATE-GEMINI] Prediction failed with status:`, data.status);
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

      logger.log(`✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`);
      logger.log(`📊 [REPLICATE-GEMINI] Metrics:`, data.metrics);

      return outputText.trim();

    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        console.error(`❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`);
        throw error;
      }

      // Retry öncesi kısa bekleme (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
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
    return { uri: sanitizeImageUrl(imageEntry) };
  }

  const result = { ...imageEntry };
  const currentUri = result.uri || result.url || null;

  if (currentUri && currentUri.startsWith("file://")) {
    if (result.base64) {
      const uploadSource = `data:image/jpeg;base64,${result.base64}`;
      const uploadedUrl = await uploadReferenceImageToSupabase(
        uploadSource,
        userId
      );
      result.uri = uploadedUrl;
      delete result.base64;
    } else {
      throw new Error(
        "Yerel dosya path'i tespit edildi ancak base64 verisi bulunamadı."
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
        .jpeg({ quality: 100 })
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
            .png({ quality: 100 })
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

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_reference_${userId || "anonymous"
      }_${randomId}.jpg`;

    logger.log("Supabase'e yüklenecek dosya adı:", fileName);

    // Supabase'e yükle (processed buffer ile)
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
async function uploadReferenceImagesToSupabase(referenceImages, userId) {
  try {
    logger.log(
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
        } else if (
          referenceImage.uri.startsWith("http://") ||
          referenceImage.uri.startsWith("https://")
        ) {
          imageSourceForUpload = referenceImage.uri;
          logger.log(`📤 Reference image ${i + 1}: HTTP URI kullanılıyor`);
        } else {
          logger.log(
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
      }
    }

    logger.log(
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
  generationId = null
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
    const CREDIT_COST = 10; // Her oluşturma 10 kredi

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

    // Generation bilgilerini al (totalGenerations için)
    const { data: generation, error: genError } = await supabase
      .from("reference_results")
      .select("settings")
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .single();

    if (genError || !generation) {
      console.error(
        `❌ Generation ${generationId} bilgileri alınamadı:`,
        genError
      );
      return false;
    }

    // Jenerasyon başına kredi düş (her tamamlanan için 10)
    const totalCreditCost = CREDIT_COST;
    logger.log(
      `💳 [COMPLETION-CREDIT] Bu generation için ${totalCreditCost} kredi düşürülecek`
    );

    // 🔗 TEAM-AWARE: Team-aware kredi bilgisi al
    let creditOwnerId = userId;
    let currentCredit = 0;

    try {
      const effectiveCredits = await teamService.getEffectiveCredits(userId);
      currentCredit = effectiveCredits.creditBalance || 0;
      creditOwnerId = effectiveCredits.creditOwnerId;

      logger.log(
        `💳 [COMPLETION-CREDIT] Team-aware kredi: ${currentCredit}`,
        effectiveCredits.isTeamCredit ? `(team owner: ${creditOwnerId})` : "(kendi kredisi)"
      );
    } catch (teamError) {
      console.warn(`⚠️ [COMPLETION-CREDIT] Team-aware başarısız, fallback kullanılıyor:`, teamError.message);
      // Fallback: eski yöntem
      const { data: currentUser, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();

      if (userError || !currentUser) {
        console.error(`❌ User ${userId} bulunamadı:`, userError);
        return false;
      }
      currentCredit = currentUser.credit_balance || 0;
    }

    if (currentCredit < totalCreditCost) {
      console.error(
        `❌ Yetersiz kredi! Mevcut: ${currentCredit}, Gerekli: ${totalCreditCost}`
      );
      // Başarısız sonuç olarak işaretle ama generation'ı completed bırak
      return false;
    }

    // 🔒 Atomic kredi düşürme - race condition'ı önlemek için RPC kullan
    // 🔗 TEAM-AWARE: creditOwnerId kullan (team owner veya kendisi)
    const { data: updateResult, error: updateError } = await supabase.rpc(
      "deduct_user_credit",
      {
        user_id: creditOwnerId, // Team-aware: doğru hesaptan düş
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
      `✅ [COMPLETION-CREDIT] ${totalCreditCost} kredi başarıyla düşüldü (${creditOwnerId === userId ? "kendi hesabından" : "team owner hesabından"}). Yeni bakiye: ${newBalance}`
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
  isMultipleImages = false // Çoklu resim modu mu?
) {
  try {
    logger.log("🤖 [GEMINI] Prompt iyileştirme başlatılıyor");
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
    const parsedAgeInt = parseInt(age, 10);

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
        }
    
    IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.${settings?.productColor && settings.productColor !== "original"
          ? ` Pay special attention to the product color requirement - the garment must be ${settings.productColor}.`
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
      promptForGemini = `
MANDATORY INSTRUCTION (READ CAREFULLY, FOLLOW EXACTLY):

You are a prompt generator for e-commerce product photo transformation. Produce ONE single technical prompt that an image editor/AI will follow to convert a raw product photo into a professional, Amazon-compliant catalog image.

STRICT STYLE & FORMAT:
- The prompt you produce MUST start with: "Transform this amateur product photo into a professional high-end e-commerce product photo."
- Use clear technical sections in THIS ORDER and with THESE HEADINGS exactly:
  Background:
  Presentation (Invisible Mannequin / Ghost Effect):
  Symmetry & Alignment:
  Material & Micro-Detail:
  Lighting:
  Color Accuracy:
  Cleanup & Finishing:
  Final Output Quality:
- End the prompt with EXACTLY this line:
  "The final result must look like a flawless product photo ready for e-commerce catalogs, fashion websites, or online marketplaces. Maintain a photorealistic, luxury presentation suitable for premium retail."
- Length target: 200–300 words.

BACKGROUND (ALWAYS):
- Replace background with a pure seamless white studio background (#FFFFFF).

ADAPTIVE PRODUCT LOGIC:
- If CLOTHING → 
  • Apply ghost mannequin effect (remove mannequin/hanger, keep inside visible).  
  • Adjust garment to professional catalog stance, not amateur photo posture.  
  • Shoulders straight, neckline centered, hemline balanced.  
  • Wrinkle-free, freshly pressed look.  

- If ACCESSORIES (bags, hats, wallets) → 
  • Center product, arrange straps/chains elegantly.  
  • Correct tilt or sag, present in luxury catalog stance.  

- If JEWELRY → 
  • Macro-level clarity for gemstones and metals.  
  • No glare, natural brilliance, precise reflections.  

- If WATCHES → 
  • Dial upright, bezel and bracelet symmetrical.  
  • Glass crystal-clear, no reflections.  
  • Mechanism details sharp.  

- If FOOTWEAR → 
  • Remove legs/feet completely.  
  • Present shoes in industry-standard e-commerce views:  
    – Main image MUST be **side profile view** (outer side).  
    – Secondary angle (if pair) in **45° angled view** to show depth.  
  • Avoid top-down flat perspectives unless explicitly required.  
  • Shoes must appear upright, stable, perfectly aligned.  
  • Correct perspective so outsole is horizontal and silhouette natural.  
  • Highlight stitching, mesh, sole patterns, and logo/branding clearly.  
  • Remove dust, creases, scuffs; present as brand-new.  

- If OTHER GOODS → 
  • Correct geometry, straighten angles, remove packaging distortions.  

CORRECTION & ENHANCEMENT RULES:
- Correct tilt, rotation, or unnatural posture.  
- Ensure product looks **more professional and ideal than the amateur photo**.  
- Remove all imperfections: dust, lint, stickers, price tags, stains.  

LIGHTING:
- Bright, even, shadowless studio lighting.  
- Prevent glare or blown highlights.  
- Allow subtle, realistic depth to preserve 3D form.  

COLOR ACCURACY:
- Faithful, true-to-life reproduction.  
- Neutral white balance, no oversaturation or dull tones.  

OUTPUT:
- Generate ONLY the final technical prompt using the exact headings above. Do not include these instructions, variables, or commentary.

EXAMPLE (for format illustration only):
"Transform this amateur product photo into a professional high-end e-commerce product photo. Remove the background and replace it with a pure seamless white studio background (#FFFFFF).

Background: Pure seamless white studio background (#FFFFFF).
Presentation (Invisible Mannequin / Ghost Effect): Since xxx is footwear, remove the legs and stage both shoes in catalog-standard angles: one shoe in clear side profile view, the other at 45° for depth. Ensure stable and natural stance.
Symmetry & Alignment: Correct tilt and perspective so outsole is level and shoes are symmetrical.
Material & Micro-Detail: Highlight stitching, mesh, sole patterns, and branding with sharp clarity. Remove creases and scuffs.
Lighting: Apply bright, even, shadowless lighting. No glare or blown highlights.
Color Accuracy: Ensure xxx colors are faithful, with neutral white balance.
Cleanup & Finishing: Remove dust, marks, or imperfections. Keep edges crisp and pristine.
Final Output Quality: Single flawless, photorealistic catalog photo ready for Amazon/e-commerce platforms."
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

    // Google Gemini API için resimleri base64'e çevir
    const parts = [{ text: promptForGemini }];

    // Resim verilerini içerecek parts dizisini hazırla
    try {
      logger.log("📤 [GEMINI] Resimler Gemini'ye gönderiliyor...");

      let imageBuffer;

      // Multi-mode resim gönderimi: Back side analysis, Multiple products, veya Normal mod
      if (
        isBackSideAnalysis &&
        referenceImages &&
        referenceImages.length >= 2
      ) {
        logger.log(
          "🔄 [BACK_SIDE] Gemini'ye 2 resim gönderiliyor (ön + arka)..."
        );

        const firstImageUrl = sanitizeImageUrl(
          referenceImages[0].uri || referenceImages[0]
        );
        const secondImageUrl = sanitizeImageUrl(
          referenceImages[1].uri || referenceImages[1]
        );

        // İlk resmi indir ve base64'e çevir
        if (
          firstImageUrl.startsWith("http://") ||
          firstImageUrl.startsWith("https://")
        ) {
          const imageResponse = await axios.get(firstImageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          imageBuffer = Buffer.from(imageResponse.data);
        } else {
          throw new Error("Invalid image URL format");
        }

        const base64First = imageBuffer.toString("base64");
        const mimeTypeFirst = mime.getType(firstImageUrl) || "image/jpeg";
        parts.push({
          inlineData: {
            data: base64First,
            mimeType: mimeTypeFirst,
          },
        });

        // İkinci resmi indir ve base64'e çevir
        if (
          secondImageUrl.startsWith("http://") ||
          secondImageUrl.startsWith("https://")
        ) {
          const imageResponse2 = await axios.get(secondImageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          imageBuffer = Buffer.from(imageResponse2.data);
        } else {
          throw new Error("Invalid image URL format");
        }

        const base64Second = imageBuffer.toString("base64");
        const mimeTypeSecond = mime.getType(secondImageUrl) || "image/jpeg";
        parts.push({
          inlineData: {
            data: base64Second,
            mimeType: mimeTypeSecond,
          },
        });

        logger.log("🔄 [BACK_SIDE] Toplam 2 resim Gemini'ye eklendi");
      } else if (
        isMultipleProducts &&
        referenceImages &&
        referenceImages.length > 1
      ) {
        // Multi-product mode: Tüm referans resimleri gönder
        logger.log(
          `🛍️ [MULTI-PRODUCT] Gemini'ye ${referenceImages.length} adet referans resmi gönderiliyor...`
        );

        for (let i = 0; i < referenceImages.length; i++) {
          const imageUrl = sanitizeImageUrl(
            referenceImages[i].uri || referenceImages[i]
          );

          if (
            imageUrl.startsWith("http://") ||
            imageUrl.startsWith("https://")
          ) {
            const imageResponse = await axios.get(imageUrl, {
              responseType: "arraybuffer",
              timeout: 15000,
            });
            imageBuffer = Buffer.from(imageResponse.data);
          } else {
            throw new Error("Invalid image URL format");
          }

          const base64 = imageBuffer.toString("base64");
          const mimeType = mime.getType(imageUrl) || "image/jpeg";
          parts.push({
            inlineData: {
              data: base64,
              mimeType: mimeType,
            },
          });
        }

        logger.log(
          `🛍️ [MULTI-PRODUCT] Toplam ${referenceImages.length} adet referans resmi Gemini'ye eklendi`
        );
      } else {
        // Normal mod: Tek resim gönder
        if (imageUrl) {
          const cleanImageUrl = sanitizeImageUrl(imageUrl);

          if (
            cleanImageUrl.startsWith("http://") ||
            cleanImageUrl.startsWith("https://")
          ) {
            const imageResponse = await axios.get(cleanImageUrl, {
              responseType: "arraybuffer",
              timeout: 15000,
            });
            imageBuffer = Buffer.from(imageResponse.data);
          } else {
            throw new Error("Invalid image URL format");
          }

          const base64 = imageBuffer.toString("base64");
          const mimeType = mime.getType(cleanImageUrl) || "image/jpeg";
          parts.push({
            inlineData: {
              data: base64,
              mimeType: mimeType,
            },
          });

          logger.log("🖼️ Referans görsel Gemini'ye eklendi:", imageUrl);
        }
      }

      // Pose image'ını da ekle
      if (poseImage) {
        const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);

        if (
          cleanPoseImageUrl.startsWith("http://") ||
          cleanPoseImageUrl.startsWith("https://")
        ) {
          const imageResponse = await axios.get(cleanPoseImageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          imageBuffer = Buffer.from(imageResponse.data);
        } else {
          throw new Error("Invalid pose image URL format");
        }

        const base64 = imageBuffer.toString("base64");
        const mimeType = mime.getType(cleanPoseImageUrl) || "image/jpeg";
        parts.push({
          inlineData: {
            data: base64,
            mimeType: mimeType,
          },
        });

        logger.log("🤸 Pose görsel Gemini'ye eklendi");
      }

      // Hair style image'ını da ekle
      if (hairStyleImage) {
        const cleanHairStyleImageUrl = sanitizeImageUrl(
          hairStyleImage.split("?")[0]
        );

        if (
          cleanHairStyleImageUrl.startsWith("http://") ||
          cleanHairStyleImageUrl.startsWith("https://")
        ) {
          const imageResponse = await axios.get(cleanHairStyleImageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          imageBuffer = Buffer.from(imageResponse.data);
        } else {
          throw new Error("Invalid hair style image URL format");
        }

        const base64 = imageBuffer.toString("base64");
        const mimeType = mime.getType(cleanHairStyleImageUrl) || "image/jpeg";
        parts.push({
          inlineData: {
            data: base64,
            mimeType: mimeType,
          },
        });

        logger.log("💇 Hair style görsel Gemini'ye eklendi");
      }

      // Location image'ını da ekle
      if (locationImage) {
        const cleanLocationImageUrl = sanitizeImageUrl(
          locationImage.split("?")[0]
        );

        if (
          cleanLocationImageUrl.startsWith("http://") ||
          cleanLocationImageUrl.startsWith("https://")
        ) {
          const imageResponse = await axios.get(cleanLocationImageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          imageBuffer = Buffer.from(imageResponse.data);
        } else {
          throw new Error("Invalid location image URL format");
        }

        const base64 = imageBuffer.toString("base64");
        const mimeType = mime.getType(cleanLocationImageUrl) || "image/jpeg";
        parts.push({
          inlineData: {
            data: base64,
            mimeType: mimeType,
          },
        });

        logger.log("🏞️ Location görsel Gemini'ye eklendi");
      }
    } catch (imageError) {
      console.error("❌ Resim indirme/çevirme hatası:", imageError);
      throw new Error(`Image processing error: ${imageError.message}`);
    }

    // Replicate Gemini Flash API çağrısı için image URL'lerini topla
    const imageUrlsForReplicate = [];

    // Referans resimlerin URL'lerini ekle
    if (isBackSideAnalysis && referenceImages && referenceImages.length >= 2) {
      const firstImageUrl = sanitizeImageUrl(referenceImages[0].uri || referenceImages[0]);
      const secondImageUrl = sanitizeImageUrl(referenceImages[1].uri || referenceImages[1]);
      imageUrlsForReplicate.push(firstImageUrl, secondImageUrl);
    } else if (isMultipleProducts && referenceImages && referenceImages.length > 1) {
      for (const refImg of referenceImages) {
        const imgUrl = sanitizeImageUrl(refImg.uri || refImg);
        if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
          imageUrlsForReplicate.push(imgUrl);
        }
      }
    } else if (imageUrl) {
      const cleanImageUrl = sanitizeImageUrl(imageUrl);
      if (cleanImageUrl.startsWith("http://") || cleanImageUrl.startsWith("https://")) {
        imageUrlsForReplicate.push(cleanImageUrl);
      }
    }

    // Pose, hair style ve location resimlerini de ekle
    if (poseImage) {
      const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
      if (cleanPoseImageUrl.startsWith("http://") || cleanPoseImageUrl.startsWith("https://")) {
        imageUrlsForReplicate.push(cleanPoseImageUrl);
      }
    }
    if (hairStyleImage) {
      const cleanHairStyleImageUrl = sanitizeImageUrl(hairStyleImage.split("?")[0]);
      if (cleanHairStyleImageUrl.startsWith("http://") || cleanHairStyleImageUrl.startsWith("https://")) {
        imageUrlsForReplicate.push(cleanHairStyleImageUrl);
      }
    }
    if (locationImage) {
      const cleanLocationImageUrl = sanitizeImageUrl(locationImage.split("?")[0]);
      if (cleanLocationImageUrl.startsWith("http://") || cleanLocationImageUrl.startsWith("https://")) {
        imageUrlsForReplicate.push(cleanLocationImageUrl);
      }
    }

    logger.log(`🤖 [REPLICATE-GEMINI] Toplam ${imageUrlsForReplicate.length} resim URL'si hazırlandı`);

    // Replicate Gemini Flash API çağrısı (3 retry ile)
    let enhancedPrompt;

    try {
      // parts array'indeki text prompt'u al
      const textPrompt = parts.find(p => p.text)?.text || promptForGemini;

      const geminiResponse = await callReplicateGeminiFlash(textPrompt, imageUrlsForReplicate, 3);

      // Statik kuralları sadece normal mode'da ekle (backside ve pose change'de ekleme)
      let staticRules = "";

      if (!isPoseChange && !isBackSideAnalysis) {
        // Sadece normal mode'da statik kuralları ekle (backside ve pose change'de değil)
        staticRules = `

        CRITICAL RULES (English)
        
        The output must be a single, high-end professional fashion photograph only — no collages, duplicates, or extra frames.
        
        Apply studio-grade fashion lighting blended naturally with daylight, ensuring flawless exposure, vibrant textures, and sharp focus.
        
        Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look.
        
        Model, garment, and environment must integrate into one cohesive, seamless professional photo suitable for commercial catalogs and editorial campaigns.
        
        Additional Professional Fashion Photography Rules:
        
        Composition & Framing: Follow professional composition guidelines (rule of thirds, balanced framing). The model and garment must be the primary focus, with the background supporting but never distracting.
        
        Camera Perspective: Use appropriate fashion shot perspectives (full body, or mid-shot) depending on garment type. Avoid extreme or distorted angles unless explicitly requested.
        
        Garment Presentation: Ensure the garment is perfectly centered, wrinkle-minimized, and fully visible. Critical details like logos, embroidery, seams, and textures must be sharp and unobstructed.
        
        Color Accuracy: Colors must remain faithful to the original garment. Avoid oversaturation or washed-out tones. White balance must be neutral and realistic.
        
        Fabric Physics: Knit, silk, denim, leather, or any other fabric must exhibit accurate surface qualities — sheen, matte, weight, drape — under the chosen lighting.
        
        Background Control: Background must complement the garment. It should add atmosphere but never overpower the fashion subject. Keep it clean, realistic, and photogenic.
        
        Depth & Realism: Maintain natural shadows, reflections, and occlusion to create depth. No flat overlays or unrealistic detachment between model and environment.
        
        Posture & Pose: Model poses must enhance garment flow and silhouette. Avoid awkward or unnatural positions that distort the clothing.
        
        Focus & Sharpness: The garment must always be in sharp focus, especially at neckline, chest, and detailing areas. Background can be slightly softened (natural depth of field) to highlight the subject.
        
        Atmosphere: Scene must feel like a real, live professional photoshoot. Lighting, environment, and styling should combine into a polished, high-fashion aesthetic.`;
      }

      enhancedPrompt = geminiResponse + staticRules;
      logger.log(
        "🤖 [REPLICATE-GEMINI] Gemini'nin ürettiği prompt:",
        geminiResponse.substring(0, 200) + "..."
      );
      logger.log(
        "✨ [REPLICATE-GEMINI] Final enhanced prompt (statik kurallarla) hazırlandı"
      );
    } catch (geminiError) {
      console.error(
        "❌ [REPLICATE-GEMINI] All attempts failed:",
        geminiError.message
      );
      // Fallback durumunda da statik kuralları ekle
      const staticRules = `

CRITICAL RULES:

The output must be a single, high-end professional fashion photograph only — no collages, duplicates, or extra frames.

Apply studio-grade fashion lighting blended naturally with daylight, ensuring flawless exposure, vibrant textures, and sharp focus.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look.

Model, garment, and environment must integrate into one cohesive, seamless professional photo suitable for commercial catalogs and editorial campaigns.`;

      enhancedPrompt = originalPrompt + staticRules;
    }

    // Eğer Gemini sonuç üretemediyse (enhancedPrompt orijinal prompt ile aynıysa) direkt fallback prompt kullan
    if (enhancedPrompt === originalPrompt) {
      logger.log(
        "🔄 [FALLBACK] Gemini başarısız, detaylı fallback prompt kullanılıyor"
      );

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



router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme
  const CREDIT_COST = 10; // Her oluşturma 10 kredi
  let creditDeducted = false;
  let actualCreditDeducted = CREDIT_COST; // Gerçekte düşülen kredi miktarı (iade için)
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
    logger.log("📤 Reference images Supabase'e upload ediliyor...");
    const referenceImageUrls = await uploadReferenceImagesToSupabase(
      referenceImages,
      userId
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
    };

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
      finalGenerationId
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
      // Tek resim için Supabase URL'sini doğrudan kullanmak üzere hazırlık yap
      logger.log(
        "🖼️ [BACKEND] Tek resim için Supabase yükleme işlemi başlatılıyor..."
      );

      const referenceImage = referenceImages[0];

      if (!referenceImage) {
        return res.status(400).json({
          success: false,
          result: {
            message: "Referans görseli gereklidir.",
          },
        });
      }

      logger.log("Referans görseli:", referenceImage.uri);

      // Referans resmini önce Supabase'e yükle ve URL al
      let imageSourceForUpload;

      // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
      if (referenceImage.base64) {
        imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
      } else if (
        referenceImage.uri.startsWith("http://") ||
        referenceImage.uri.startsWith("https://")
      ) {
        imageSourceForUpload = referenceImage.uri;
      } else {
        // file:// protokolü için frontend'de base64 dönüştürme zorunlu
        return res.status(400).json({
          success: false,
          result: {
            message: "Yerel dosya için base64 data gönderilmelidir.",
          },
        });
      }

      const uploadedImageUrl = await uploadReferenceImageToSupabase(
        imageSourceForUpload,
        userId
      );

      // Tek resim senaryosunda doğrudan Supabase URL'sini kullan
      finalImage = sanitizeImageUrl(uploadedImageUrl);
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
          referenceImages // Multi-product için tüm referans resimler
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
          false // isMultipleImages - Gemini'ye tek resim gönderiliyor
        );
      }
      backgroundRemovedImage = finalImage; // Orijinal image'ı kullan, arkaplan silme yok
      logger.log(
        isColorChange ? "🎨 Color change prompt:" : "🕺 Pose change prompt:",
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
        referenceImages // Multi-product için tüm referans resimler
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

    // Fal.ai entegrasyonu (V5 ve Back routes ile uyumlu)
    let replicateResponse;
    const maxRetries = 3;
    let totalRetryAttempts = 0;
    const retryReasons = [];

    // V2 model seçimi (Pro model)
    const isV2 = req.body.quality === "v2";
    const falModel = isV2 // req.body'de quality varsa v2 kontrolü yap
      ? "fal-ai/nano-banana-pro/edit"
      : "fal-ai/nano-banana/edit";

    logger.log(
      `🤖 Fal.ai Modeli Seçildi: ${falModel} ${isV2 ? "(PRO)" : "(Standard)"}`
    );

    const startTime = Date.now(); // Define startTime here for overall processing time

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.log(
          `🔄 Fal.ai nano-banana API attempt ${attempt}/${maxRetries}`
        );

        logger.log("🚀 Fal.ai API çağrısı yapılıyor...");

        // Fal.ai için image_urls array'ini hazırla (Replicate logic ile aynı)
        let imageInputArray;

        // Back side analysis: 2 ayrı resim gönder
        if (
          req.body.isBackSideAnalysis &&
          referenceImages &&
          referenceImages.length >= 2
        ) {
          logger.log(
            "🔄 [BACK_SIDE] 2 ayrı resim Fal.ai'ye gönderiliyor..."
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
            `🖼️ [MULTIPLE] ${totalRefs} adet referans resmi Fal.ai'ye gönderiliyor...`
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

        const aspectRatioForRequest = formattedRatio || "9:16";

        // Fal.ai Request Body
        const requestBody = {
          prompt: enhancedPrompt,
          image_urls: imageInputArray,
          num_images: 1,
          output_format: "png",
          aspect_ratio: aspectRatioForRequest,
          // İsteğe bağlı parametreler (hız için V5'tekine benzer yapılabilir)
          // guidance_scale, num_inference_steps vs. Fal.ai defaults usually work well
        };

        // Pose change parametreleri
        if (isPoseChange) {
          requestBody.guidance_scale = 7.5;
          requestBody.num_inference_steps = 20;
          logger.log("🕺 [POSE_CHANGE] Fal.ai parametreleri eklendi");
        }

        logger.log("📋 Fal.ai Request Body:", {
          prompt: enhancedPrompt.substring(0, 100) + "...",
          imageInputCount: imageInputArray.length,
          outputFormat: "png",
          aspectRatio: aspectRatioForRequest,
          model: falModel,
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

        // Fal.ai Response kontrolü
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
            throw new Error(`RETRYABLE_NANO_BANANA_ERROR: ${errorMsg}`);
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

        // 5dk timeout hatası ise direkt failed yap ve retry yapma
        if (
          apiError.message.includes("timeout") ||
          apiError.code === "ETIMEDOUT" ||
          apiError.code === "ECONNABORTED"
        ) {
          console.error(
            `❌ 5 dakika timeout hatası, generation failed yapılıyor: ${apiError.message}`
          );

          // Generation status'unu direkt failed yap
          await updateGenerationStatus(finalGenerationId, userId, "failed", {
            processing_time_seconds: 300,
          });

          throw apiError; // Timeout hatası için retry yok
        }

        // Son deneme değilse ve network hataları veya geçici hatalar ise tekrar dene
        if (
          attempt < maxRetries &&
          (apiError.code === "ECONNRESET" ||
            apiError.code === "ENOTFOUND" ||
            apiError.response?.status >= 500 ||
            apiError.message.includes("RETRYABLE_NANO_BANANA_ERROR"))
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
    logger.log("Fal.ai API final yanıtı (Replicate formatında):", initialResult);

    // Compatibility definitions for downstream logic
    const finalResult = initialResult;
    const processingTime = Math.round((Date.now() - startTime) / 1000); // Calculate actual processing time

    if (!initialResult.id) {
      console.error("Fal.ai prediction ID alınamadı:", initialResult);

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
          message: "Prediction başlatılamadı",
          error: initialResult.error || "Prediction ID missing",
        },
      });
    }

    // Since Fal.ai is synchronous, if we reached here, the call was successful.
    // No polling logic is needed.
    // The `finalResult` is already `initialResult` and `processingTime` is calculated.

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

      await updateGenerationStatus(finalGenerationId, userId, "completed", {
        enhanced_prompt: enhancedPrompt,
        result_image_url: resultImageUrl,
        replicate_prediction_id: initialResult.id,
        processing_time_seconds: processingTime,
      });

      // 💳 KREDI GÜNCELLEME SIRASI
      // Kredi düşümü updateGenerationStatus içinde tetikleniyor (pay-on-success).
      // Bu nedenle güncel krediyi, status güncellemesinden SONRA okumalıyız.
      // 🔗 TEAM-AWARE: Team owner'ın kredisini al (team member ise)
      let currentCredit = null;
      if (userId && userId !== "anonymous_user") {
        try {
          const effectiveCredits = await teamService.getEffectiveCredits(userId);
          currentCredit = effectiveCredits.creditBalance || 0;
          logger.log(
            `💳 [TEAM-AWARE] Güncel kredi balance (post-deduct): ${currentCredit}`,
            effectiveCredits.isTeamCredit ? `(team owner: ${effectiveCredits.creditOwnerId})` : "(kendi hesabı)"
          );
        } catch (creditError) {
          console.error(
            "❌ Güncel kredi sorgu hatası (post-deduct):",
            creditError
          );
          // Fallback: eski yöntem
          try {
            const { data: updatedUser } = await supabase
              .from("users")
              .select("credit_balance")
              .eq("id", userId)
              .single();
            currentCredit = updatedUser?.credit_balance || 0;
          } catch (fallbackError) {
            console.error("❌ Fallback kredi sorgu hatası:", fallbackError);
          }
        }
      }

      const responseData = {
        success: true,
        result: {
          imageUrl: resultImageUrl,
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
          user_friendly: true,
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
// 🔗 TEAM-AWARE: Team member ise owner'ın kredisini döndürür
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

    // 🔗 TEAM-AWARE: Önce team-aware endpoint'i dene
    try {
      const effectiveCredits = await teamService.getEffectiveCredits(userId);
      return res.status(200).json({
        success: true,
        result: {
          credit: effectiveCredits.creditBalance || 0,
          isAnonymous: false,
          isTeamCredit: effectiveCredits.isTeamCredit || false,
          creditOwnerId: effectiveCredits.creditOwnerId,
        },
      });
    } catch (teamError) {
      console.warn("⚠️ Team-aware kredi başarısız, fallback kullanılıyor:", teamError.message);
    }

    // Fallback: eski yöntem
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
        console.error("❌ Pose görseli işleme hatası:", imageError);
      }
    }

    // Replicate Gemini Flash API çağrısı (3 retry ile)
    const poseDescription = await callReplicateGeminiFlash(posePrompt, imageUrlsForPose, 3);

    if (!poseDescription) {
      console.error("❌ Replicate Gemini API response boş");
      throw new Error("Replicate Gemini API response is empty or invalid");
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
    console.error("🤸 [REPLICATE-GEMINI] Pose açıklaması hatası:", error);
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

    // Log'u sadece ilk sorgulamada yap (spam önlemek için)
    if (Math.random() < 0.1) {
      // %10 ihtimalle logla
      logger.log(
        `🔍 Generation status sorgusu: ${generationId.slice(
          0,
          8
        )}... (User: ${userId.slice(0, 8)}...)`
      );
    }

    // Generation'ı sorgula
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    // Debug: Bu user'ın aktif generation'larını da kontrol et
    if (!generationArray || generationArray.length === 0) {
      const { data: userGenerations } = await supabase
        .from("reference_results")
        .select("generation_id, status, created_at")
        .eq("user_id", userId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (userGenerations && userGenerations.length > 0) {
        logger.log(
          `🔍 User ${userId.slice(0, 8)} has ${userGenerations.length
          } active generations:`,
          userGenerations
            .map((g) => `${g.generation_id.slice(0, 8)}(${g.status})`)
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
            } expired generations for user ${userId.slice(0, 8)}`
          );

          await supabase
            .from("reference_results")
            .update({ status: "failed" })
            .in(
              "generation_id",
              expiredGenerations.map((g) => g.generation_id)
            )
            .eq("user_id", userId);
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

    return res.status(200).json({
      success: true,
      result: {
        generationId: generation.generation_id,
        status: finalStatus,
        resultImageUrl: generation.result_image_url,
        originalPrompt: generation.original_prompt,
        enhancedPrompt: generation.enhanced_prompt,
        errorMessage: shouldUpdateStatus ? "İşlem zaman aşımına uğradı" : null,
        processingTimeSeconds: generation.processing_time_seconds,
        createdAt: generation.created_at,
        updatedAt: generation.updated_at,
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
    logger.log(`📊 [PENDING-V4] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

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
      `🔍 User generations sorgusu: ${userId}${
        status ? ` (status: ${status})` : ""
      } (platform: ${platform || 'web'})`
    );
    logger.log(`📊 [USER-GENERATIONS-V4] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

    // 🕐 Her zaman son 1 saatlik data'yı döndür
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const oneHourAgoISO = oneHourAgo.toISOString();

    logger.log(
      `🕐 [API_FILTER] Son 1 saatlik data döndürülüyor: ${oneHourAgoISO} sonrası`
    );

    // Team üyeleri için .in() kullan
    let query = supabase
      .from("reference_results")
      .select("*")
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
            status: gen.status,
            resultImageUrl: gen.result_image_url,
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
            createdAt: gen.created_at,
            updatedAt: gen.updated_at,
          })) || [],
        totalCount: generations?.length || 0,
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
