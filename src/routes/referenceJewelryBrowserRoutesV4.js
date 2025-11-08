const express = require("express");
const router = express.Router();
// Updated Gemini API with latest gemini-2.0-flash model
// Using @google/generative-ai with new safety settings configuration
const { GoogleGenAI } = require("@google/genai");
const mime = require("mime");
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

// Geçici dosyaları hemen silme fonksiyonu (işlem biter bitmez)
async function cleanupTemporaryFiles(fileUrls) {
  // Bu fonksiyon artık dosya silme işlemi yapmıyor.
  console.log(
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
    console.log(`👤 User ${userId.slice(0, 8)} pro status: ${isPro}`);

    return isPro;
  } catch (error) {
    console.error("❌ Pro status kontrol hatası:", error);
    return false;
  }
}

// Result image'ı user-specific bucket'e kaydetme fonksiyonu
async function saveResultImageToUserBucket(resultImageUrl, userId) {
  try {
    console.log("📤 Result image user bucket'ine kaydediliyor...");
    console.log("🖼️ Result image URL:", resultImageUrl);
    console.log("👤 User ID:", userId);

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

    console.log("📁 User bucket dosya adı:", fileName);

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

    console.log("✅ User bucket upload başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("user_image_results")
      .getPublicUrl(fileName);

    console.log("🔗 User bucket public URL:", urlData.publicUrl);

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
      console.log("🔄 Tek resim upload: EXIF rotation uygulandı");
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
          console.log(
            "✅ Tek resim upload: PNG'ye dönüştürüldü (EXIF rotation uygulandı)"
          );
        } catch (pngError) {
          console.error("❌ PNG dönüştürme hatası:", pngError.message);
          processedBuffer = imageBuffer; // Son çare: orijinal buffer
          console.log(
            "⚠️ Orijinal buffer kullanılıyor (EXIF rotation uygulanamadı)"
          );
        }
      } else {
        processedBuffer = imageBuffer; // Son çare: orijinal buffer
        console.log(
          "⚠️ Orijinal buffer kullanılıyor (EXIF rotation uygulanamadı)"
        );
      }
    }

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_reference_${
      userId || "anonymous"
    }_${randomId}.jpg`;

    console.log("Supabase'e yüklenecek dosya adı:", fileName);

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
    console.log("🔍 [DEBUG createPendingGeneration] Gelen userId:", userId);

    if (!userIdentifier || userIdentifier === "anonymous_user") {
      userIdentifier = uuidv4(); // UUID formatında anonymous user oluştur
      console.log(
        "🔍 [DEBUG] Yeni anonymous UUID oluşturuldu:",
        userIdentifier
      );
    } else if (
      !userIdentifier.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    ) {
      // Eğer gelen ID UUID formatında değilse, UUID'ye çevir veya yeni UUID oluştur
      console.log(
        "🔍 [DEBUG] User ID UUID formatında değil, yeni UUID oluşturuluyor:",
        userIdentifier
      );
      userIdentifier = uuidv4();
    } else {
      console.log(
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

    console.log("✅ Pending generation kaydedildi:", insertData[0]?.id);
    console.log(
      "🔍 [DEBUG] Kaydedilen generation_id:",
      insertData[0]?.generation_id
    );
    console.log("🔍 [DEBUG] Kaydedilen status:", insertData[0]?.status);
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

    console.log(
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
      console.log(
        `💳 [DEDUP-CHECK] Generation ${generationId} settings:`,
        JSON.stringify(existingGen?.settings || {}, null, 2)
      );
    } catch (_) {
      console.log(
        `💳 [DEDUP-CHECK] Generation ${generationId} settings: <unserializable>`
      );
    }
    console.log(
      `💳 [DEDUP-CHECK] creditDeducted flag:`,
      existingGen.settings?.creditDeducted
    );

    if (existingGen.settings?.creditDeducted === true) {
      console.log(
        `💳 [COMPLETION-CREDIT] Generation ${generationId} için zaten kredi düşürülmüş, atlanıyor`
      );
      return true;
    }

    console.log(`💳 [DEDUP-CHECK] İlk kredi düşürme, devam ediliyor...`);

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

    // Jenerasyon başına kredi düş (her tamamlanan için 20)
    const totalCreditCost = CREDIT_COST; // 20
    console.log(
      `💳 [COMPLETION-CREDIT] Bu generation için ${totalCreditCost} kredi düşürülecek`
    );

    // Krediyi atomic olarak düş
    const { data: currentUser, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (userError || !currentUser) {
      console.error(`❌ User ${userId} bulunamadı:`, userError);
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
    const { data: updateResult, error: updateError } = await supabase.rpc(
      "deduct_user_credit",
      {
        user_id: userId,
        credit_amount: totalCreditCost,
      }
    );

    if (updateError) {
      console.error(`❌ Kredi düşme hatası:`, updateError);
      return false;
    }

    const newBalance =
      updateResult?.new_balance || currentCredit - totalCreditCost;
    console.log(
      `✅ ${totalCreditCost} kredi başarıyla düşüldü. Yeni bakiye: ${newBalance}`
    );

    // 💳 Kredi tracking bilgilerini generation'a kaydet
    console.log(
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
      console.log(
        `💳 [TRACKING] Generation ${generationId} credit tracking başarıyla kaydedildi:`,
        creditTrackingUpdates
      );
    }

    // 🏷️ Generation'a kredi düşürüldü flag'i ekle
    const updatedSettings = {
      ...(existingGen?.settings || {}),
      creditDeducted: true,
    };
    console.log(
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
      console.log(
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
      console.log("💾 Result image user bucket'ine kaydediliyor...");
      try {
        // 1️⃣ Önce user'ın pro olup olmadığını kontrol et
        const isUserPro = await checkUserProStatus(userId);
        console.log(`👤 User pro status: ${isUserPro}`);

        let processedImageUrl = updates.result_image_url;

        // 2️⃣ Watermark işlemi client-side'a taşındı, server'da sadece orijinal resmi kaydet
        console.log(
          "💎 Watermark işlemi client-side'da yapılacak, orijinal resim kaydediliyor"
        );
        processedImageUrl = updates.result_image_url;

        // 3️⃣ İşlenmiş resmi user bucket'ine kaydet
        const userBucketUrl = await saveResultImageToUserBucket(
          processedImageUrl,
          userId
        );
        finalUpdates.result_image_url = userBucketUrl;
        console.log("✅ Result image user bucket'e kaydedildi:", userBucketUrl);
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

    console.log(`✅ Generation ${generationId} status güncellendi: ${status}`);

    // 💳 Başarılı completion'da kredi düş (idempotent)
    if (status === "completed" && userId && userId !== "anonymous_user") {
      const alreadyCompleted = previousStatus === "completed";
      const alreadyDeducted = previousSettings?.creditDeducted === true;
      if (alreadyCompleted && alreadyDeducted) {
        console.log(
          `💳 [SKIP] ${generationId} zaten completed ve kredi düşülmüş. Deduction atlanıyor.`
        );
      } else {
        console.log(
          `💳 [TRIGGER] updateGenerationStatus: ${generationId} → ${status} | previous=${previousStatus}`
        );
        console.log(`💳 [TRIGGER] Kredi düşürme kontrolü başlatılıyor...`);
        await deductCreditOnSuccess(generationId, userId);
      }
    }

    return data[0];
  } catch (dbError) {
    console.error("❌ Status güncelleme veritabanı hatası:", dbError);
    return false;
  }
}

// Gemini API için istemci oluştur (yeni SDK)
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Aspect ratio formatını düzelten yardımcı fonksiyon
function formatAspectRatio(ratioStr) {
  const validRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

  try {
    // "original" veya tanımsız değerler için varsayılan oran
    if (!ratioStr || ratioStr === "original" || ratioStr === "undefined") {
      console.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // ":" içermeyen değerler için varsayılan oran
    if (!ratioStr.includes(":")) {
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
    console.log(
      "🤖 Gemini 2.0 Flash ile prompt iyileştirme başlatılıyor (tek resim için)"
    );
    console.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    console.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    console.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);
    console.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);
    console.log("🎨 [GEMINI] ControlNet direktifi her zaman aktif");
    console.log("🎨 [GEMINI] Color change mode:", isColorChange);
    console.log("🎨 [GEMINI] Target color:", targetColor);
    console.log("✏️ [GEMINI] Edit mode:", isEditMode);
    console.log("✏️ [GEMINI] Edit prompt:", editPrompt);
    console.log("🔧 [GEMINI] Refiner mode:", isRefinerMode);
    console.log("🔄 [GEMINI] Back side analysis mode:", isBackSideAnalysis);

    // Gemini 2.0 Flash modeli - Yeni SDK
    const model = "gemini-2.5-flash-lite";

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

    // Cinsiyet belirleme - varsayılan olarak kadın
    const gender = settings?.gender || "female";
    const age = settings?.age || "";
    const parsedAgeInt = parseInt(age, 10);

    // Gender mapping'ini düzelt - hem man/woman hem de male/female değerlerini handle et
    let modelGenderText;
    let baseModelText;
    const genderLower = gender.toLowerCase();

    // Yaş grupları tanımlaması
    // 0-1   : baby (infant)
    // 2-3   : toddler
    // 4-12  : child
    // 13-16 : teenage
    // 17+   : adult

    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
      // Baby/Toddler
      let ageGroupWord;
      if (parsedAgeInt <= 1) {
        ageGroupWord = "baby"; // 0-1 yaş için baby
      } else {
        ageGroupWord = "toddler"; // 2-3 yaş için toddler
      }
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      if (parsedAgeInt <= 1) {
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

    console.log("👤 [GEMINI] Gelen gender ayarı:", gender);
    console.log("👶 [GEMINI] Gelen age ayarı:", age);
    console.log("👤 [GEMINI] Base model türü:", baseModelText);
    console.log("👤 [GEMINI] Age'li model türü:", modelGenderText);

    // Age specification - use client's age info naturally but limited
    let ageSection = "";
    if (age) {
      console.log("👶 [GEMINI] Yaş bilgisi tespit edildi:", age);

      ageSection = `
    AGE SPECIFICATION:
    The user provided age information is "${age}". IMPORTANT: Mention this age information EXACTLY 2 times in your entire prompt — once when first introducing the model, and once more naturally later in the description. Do not mention the age a third time.`;
    }

    // Yaş grupları için basit ve güvenli prompt yönlendirmesi
    let childPromptSection = "";
    const parsedAge = parseInt(age, 10);
    if (!isNaN(parsedAge) && parsedAge <= 16) {
      if (parsedAge <= 3) {
        // Baby/Toddler - çok basit
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
      console.log(
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

      console.log("📏 [BACKEND GEMINI] Body measurements section oluşturuldu");
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

      console.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      console.log("📝 [BACKEND GEMINI] Settings text:", settingsText);
      console.log(
        "🏞️ [BACKEND GEMINI] Location enhanced prompt:",
        settings?.locationEnhancedPrompt
      );
      console.log("🎨 [BACKEND GEMINI] Product color:", settings?.productColor);

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
      .join("\n    ")}${
        settings?.locationEnhancedPrompt &&
        settings.locationEnhancedPrompt.trim()
          ? `\n    \n    SPECIAL LOCATION DESCRIPTION:\n    User has provided a detailed location description: "${settings.locationEnhancedPrompt}"\n    IMPORTANT: Use this exact location description for the environment setting instead of a generic location name.`
          : ""
      }${
        settings?.productColor && settings.productColor !== "original"
          ? `\n    \n    🎨 PRODUCT COLOR REQUIREMENT:\n    The user has specifically selected "${settings.productColor}" as the product color. CRITICAL: Ensure the garment/product appears in ${settings.productColor} color in the final image. This color selection must be prominently featured and accurately represented.`
          : ""
      }
    
    IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.${
      settings?.productColor && settings.productColor !== "original"
        ? ` Pay special attention to the product color requirement - the garment must be ${settings.productColor}.`
        : ""
    }`;
    }

    // Pose ve perspective için akıllı öneri sistemi - JEWELRY FOCUSED
    let posePromptSection = "";
    let perspectivePromptSection = "";

    const hasPoseText =
      typeof settings?.pose === "string" && settings.pose.trim().length > 0;
    const hasPoseImage = Boolean(poseImage);

    // Pose handling - JEWELRY FOCUSED with detailed descriptions
    if (!hasPoseText && !hasPoseImage) {
      const jewelryText = isMultipleProducts
        ? "multiple jewelry pieces ensemble"
        : "jewelry piece";
      posePromptSection = `
    
DEFAULT POSE FOR JEWELRY PHOTOGRAPHY: If no specific pose is provided, use natural poses that showcase jewelry pieces effectively, inspired by popular jewelry photography styles.
POSE RULES FOR JEWELRY: 
- PRIORITY: Position the model so the jewelry piece is prominently displayed and fully visible. The pose should naturally showcase the jewelry piece based on where it is worn on the body.
- Use poses inspired by popular jewelry photography campaigns: elegant head tilts, gentle hand gestures, subtle shoulder turns, wrist-forward positions, and other poses that highlight jewelry effectively.
- Avoid poses that hide or obscure the jewelry piece. Keep hands and body positioning natural while ensuring the jewelry remains the focal point.
- Maintain a polished, elegant posture that complements luxury jewelry presentation. The pose should feel natural yet refined, suitable for high-end jewelry catalogs.
- Facial expression should be confident and elegant, with eyes directed toward camera or slightly off-camera for a sophisticated look.
IMPORTANT: Ensure jewelry details (gemstones, metal finish, clasps, settings, engravings) remain fully visible and well lit. The jewelry should be the hero of the image.


    - Best showcase ${
      isMultipleProducts
        ? "all jewelry pieces in the ensemble and their coordination"
        : "the jewelry piece's design, craftsmanship, and unique details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how the jewelry pieces work together and each piece's unique selling points"
        : "the jewelry piece's unique features, gemstones, metal work, and design elements"
    }
    - Demonstrate how ${
      isMultipleProducts
        ? "different jewelry pieces complement each other when worn together"
        : "the jewelry piece sits naturally on the model, following body contours"
    }
    - Show ${
      isMultipleProducts
        ? "how all jewelry pieces create an appealing coordinated look"
        : "the jewelry piece's scale, proportion, and how it enhances the model's appearance"
    }
    - Match the style and aesthetic of ${
      isMultipleProducts
        ? "the coordinated jewelry ensemble (elegant, modern, vintage, minimalist, etc.)"
        : "the jewelry piece (elegant, modern, vintage, minimalist, etc.)"
    }
    - Allow clear visibility of important jewelry elements ${
      isMultipleProducts
        ? "across all pieces"
        : "like gemstones, metal details, clasps, settings, and engravings"
    }
    - Create an appealing and natural presentation that would be suitable for luxury jewelry commercial photography
    ${
      isMultipleProducts
        ? "- Ensure each jewelry piece in the ensemble is visible and well-positioned\n    - Demonstrate the styling versatility of combining these jewelry pieces"
        : ""
    }
    - Use camera angles and poses inspired by popular jewelry photography: close-up shots for detail, elegant full-body poses for overall presentation, and sophisticated editorial-style compositions.`;

      console.log(
        `💎 [GEMINI] Akıllı poz seçimi aktif - ${
          isMultipleProducts ? "çoklu takı ensembline" : "takıya"
        } uygun poz önerilecek`
      );
    } else if (hasPoseImage) {
      posePromptSection = `
    
    POSE REFERENCE FOR JEWELRY: A pose reference image has been provided to show the desired body position and posture for the ${baseModelText} wearing jewelry, inspired by popular jewelry photography campaigns. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${baseModelText} should adopt this specific pose naturally and convincingly${
        isMultipleProducts
          ? ", ensuring all jewelry pieces in the ensemble remain clearly visible and well-positioned"
          : ", ensuring the jewelry piece remains clearly visible and well-positioned"
      }. Ensure the pose showcases the jewelry effectively, naturally highlighting the jewelry piece based on where it is worn on the body.`;

      console.log("💎 [GEMINI] Jewelry pose prompt section eklendi");
    } else if (hasPoseText) {
      // Check if we have a detailed pose description (from our new Gemini pose system)
      const poseNameForPrompt = sanitizePoseText(settings.pose);
      let detailedPoseDescription = null;

      // Try to get detailed pose description from Gemini
      try {
        console.log(
          "🤸 [GEMINI] Pose için detaylı açıklama oluşturuluyor:",
          settings.pose
        );
        detailedPoseDescription = await generatePoseDescriptionWithGemini(
          poseNameForPrompt,
          poseImage,
          settings.gender || "female",
          "jewelry"
        );
        console.log(
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
    
    DETAILED POSE INSTRUCTION FOR JEWELRY: The user has selected the pose "${poseNameForPrompt}". Use this detailed pose instruction for the ${baseModelText} wearing jewelry, inspired by popular jewelry photography campaigns:
    
    "${cleanedPoseDescription}"
    
    IMPORTANT: If the pose description above mentions any studio, backdrop, background, environment, or set, you must ignore those parts and instead describe and preserve the exact background that already exists in the provided model image.
    
    Ensure the ${baseModelText} follows this pose instruction precisely while maintaining natural movement and ensuring the pose complements ${
          isMultipleProducts
            ? "all jewelry pieces in the ensemble being showcased"
            : "the jewelry piece being showcased"
        }. The pose should enhance the presentation of the jewelry and create an appealing commercial jewelry photography composition, inspired by popular jewelry campaigns. Ensure the jewelry piece is clearly visible and naturally highlighted based on where it is worn on the body.`;

        console.log("💎 [GEMINI] Detaylı jewelry pose açıklaması kullanılıyor");
      } else {
        // Fallback to simple pose mention - Jewelry odaklı
        posePromptSection = `
    
    SPECIFIC POSE REQUIREMENT FOR JEWELRY: The user has selected a specific pose: "${poseNameForPrompt}". Please ensure the ${baseModelText} adopts this pose while maintaining natural movement and ensuring the pose complements ${
          isMultipleProducts
            ? "all jewelry pieces in the ensemble being showcased"
            : "the jewelry piece being showcased"
        }, inspired by popular jewelry photography campaigns. Ignore any background/backdrop/studio/environment directions that may be associated with that pose and always keep the original background from the input image unchanged and accurately described. Ensure the jewelry piece is clearly visible and naturally highlighted based on where it is worn on the body.`;

        console.log(
          "💎 [GEMINI] Basit jewelry pose açıklaması kullanılıyor (fallback)"
        );
      }

      console.log(
        "🤸 [GEMINI] Kullanıcı tarafından seçilen poz:",
        settings.pose
      );
    }

    // Eğer perspective seçilmemişse, Gemini'ye takıya uygun perspektif önerisi yap
    if (!settings?.perspective) {
      perspectivePromptSection = `
    
    JEWELRY PHOTOGRAPHY CAMERA ANGLES:
    - Best capture ${
      isMultipleProducts
        ? "all jewelry pieces' most important design features and their coordination"
        : "the jewelry piece's most important design features, gemstones, and craftsmanship details"
    }
    - Show ${
      isMultipleProducts
        ? "the craftsmanship quality and detail work of each jewelry piece"
        : "the jewelry piece's craftsmanship quality, metal work, gemstone settings, and intricate details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how all jewelry pieces work together and create a cohesive ensemble look"
        : "how the jewelry piece enhances the model's appearance and sits naturally on the body"
    }
    - Create the most appealing and commercial-quality presentation ${
      isMultipleProducts
        ? "for the multi-piece jewelry styling"
        : "inspired by popular jewelry photography campaigns"
    }
    - Match ${
      isMultipleProducts
        ? "the jewelry ensemble's style and intended market positioning (luxury, fashion, minimalist, etc.)"
        : "the jewelry piece's style and intended market positioning (luxury, fashion, minimalist, etc.)"
    }
    - Use camera angles inspired by popular jewelry photography: close-up shots for detail work, elegant mid-shots for overall presentation, sophisticated full-body compositions for lifestyle jewelry photography
    ${
      isMultipleProducts
        ? "- Ensure all jewelry pieces are visible and well-framed within the composition"
        : "- Ensure the jewelry piece is the hero of the image with optimal lighting and focus"
    }`;

      console.log(
        `💎 [GEMINI] Akıllı perspektif seçimi aktif - ${
          isMultipleProducts ? "çoklu takı ensembline" : "takıya"
        } uygun kamera açısı önerilecek`
      );
    } else {
      perspectivePromptSection = `
    
    SPECIFIC CAMERA PERSPECTIVE: The user has selected a specific camera perspective: "${
      settings.perspective
    }". Please ensure the photography follows this perspective while maintaining professional composition and optimal ${
        isMultipleProducts ? "multi-piece jewelry ensemble" : "jewelry piece"
      } presentation, inspired by popular jewelry photography styles.`;

      console.log(
        "💎 [GEMINI] Kullanıcı tarafından seçilen perspektif:",
        settings.perspective
      );
    }

    // Location prompt section kaldırıldı - artık kullanılmıyor

    // Hair style bilgisi için ek prompt section
    let hairStylePromptSection = "";
    if (hairStyleImage) {
      hairStylePromptSection = `
    
    HAIR STYLE REFERENCE: A hair style reference image has been provided to show the desired hairstyle for the ${baseModelText}. Please analyze this hair style image carefully and incorporate the exact hair length, texture, cut, styling, and overall hair appearance into your enhanced prompt. The ${baseModelText} should have this specific hairstyle that complements ${
        isMultipleProducts ? "the multi-product ensemble" : "the garment"
      } and overall aesthetic.`;

      console.log("💇 [GEMINI] Hair style prompt section eklendi");
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

      console.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

    // Text-based hair style requirement if user selected hairStyle string
    let hairStyleTextSection = "";
    if (settings?.hairStyle) {
      hairStyleTextSection = `
    
    SPECIFIC HAIR STYLE REQUIREMENT: The user has selected a specific hair style: "${settings.hairStyle}". Please ensure the ${baseModelText} is styled with this exact hair style, matching its length, texture and overall look naturally.`;
      console.log(
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

    let faceDescriptor;
    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
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

    // Gemini'ye gönderilecek metin - JEWELRY FOCUSED
    const criticalDirectives = `
    BRAND SAFETY: If the input image contains any brand names or logos (e.g., Tiffany & Co., Cartier, Bulgari, Van Cleef & Arpels, Harry Winston, David Yurman, Pandora, Swarovski), please refer to them generically (e.g., "brand label", "logo") without naming the specific brand.
    JEWELRY PRESENTATION: The hero item is jewelry. Explicitly require modern jewelry photography posing and camera angles that hero the jewelry piece. Use poses and angles inspired by popular jewelry campaigns that naturally showcase the jewelry based on where it is worn on the body. Keep every jewelry detail fully visible (gemstones, metal finish, clasps, settings, engravings). Reference popular jewelry photography perspectives: close-up detail shots, elegant mid-shots showcasing the piece on the model, sophisticated full-body lifestyle compositions. Maintain premium luxury jewelry styling with refined lighting that highlights gemstone brilliance and metal luster.`;

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
      ${
        isMultipleProducts
          ? "11. MANDATORY: Ensure ALL garments/products in the ensemble remain visible and properly coordinated after the edit"
          : ""
      }

      GEMINI TASK:
      1. Understand what modification the user wants
      2. ${
        isMultipleProducts
          ? "Identify how this modification affects ALL products in the ensemble"
          : "Create a professional English prompt that applies this modification"
      }
      3. Ensure the modification is technically possible and realistic${
        isMultipleProducts ? " for the complete multi-product outfit" : ""
      }
      4. Maintain the overall quality and style of the original image
      5. Describe the change in detail while preserving other elements${
        isMultipleProducts ? " and ALL unaffected products" : ""
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

      ${
        isMultipleProducts
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

      Create a professional fashion photography prompt in English that STARTS with "change" for changing ONLY the color of ${
        isMultipleProducts
          ? "the specified product(s)/garment(s)"
          : "the product/garment"
      } from the reference image to ${targetColor}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      IMPORTANT: Please explicitly mention in your generated prompt that this is for "professional fashion photography" to ensure the AI image model understands the context and produces high-quality fashion photography results.

      CRITICAL REQUIREMENTS FOR COLOR CHANGE:
      1. The prompt MUST begin with "Replace the ${
        isMultipleProducts
          ? "specified product(s)/garment(s)"
          : "product/garment"
      }..."
      2. ONLY change the color to ${targetColor}${
        isMultipleProducts ? " for the specified product(s)" : ""
      }
      3. Keep EVERYTHING else exactly the same: design, shape, patterns, details, style, fit, texture
      4. Do not modify ${
        isMultipleProducts ? "any garment" : "the garment"
      } design, cut, or any other aspect except the color
      5. The final image should be photorealistic, showing ${
        isMultipleProducts
          ? "the complete ensemble with the specified color changes"
          : `the same garment but in ${targetColor} color`
      }
      6. Use natural studio lighting with a clean background
      7. Preserve ALL original details except color: patterns (but in new color), textures, hardware, stitching, logos, graphics, and construction elements
      8. ${
        isMultipleProducts
          ? `ALL garments/products must appear identical to the reference image, just with the specified color change to ${targetColor} and proper ensemble coordination`
          : `The garment must appear identical to the reference image, just in ${targetColor} color instead of the original color`
      }
      9. MANDATORY: Include "professional fashion photography" phrase in your generated prompt
      ${
        isMultipleProducts
          ? `10. MANDATORY: Clearly specify which product(s) change color and which remain in their original colors`
          : ""
      }

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "change".

      ${
        originalPrompt
          ? `Additional color change requirements: ${originalPrompt}.`
          : ""
      }
      `;
    } else if (isPoseChange) {
      // POSE CHANGE MODE - Optimize edilmiş poz değiştirme prompt'u (100-150 token)
      promptForGemini = `
      FASHION POSE TRANSFORMATION: Generate a focused, detailed English prompt (100-150 words) that transforms the model's pose efficiently. Focus ONLY on altering the pose while keeping the existing model, outfit, lighting, and background exactly the same. You MUST explicitly describe the original background/environment details and state that they stay unchanged.

      USER POSE REQUEST: ${
        settings?.pose && settings.pose.trim()
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

      ${
        isMultipleProducts
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

      ${
        originalPrompt
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
      🚨 ABSOLUTE MANDATORY FIRST STEP - IMAGE ANALYSIS:
      
      BEFORE YOU WRITE ANYTHING, YOU MUST:
      1. LOOK AT THE REFERENCE IMAGE CAREFULLY
      2. IDENTIFY EXACTLY what type of jewelry is shown:
         - EARRINGS (worn on ears)
         - NECKLACE (worn around neck)  
         - RING (worn on finger)
         - BRACELET (worn on wrist)
      3. REMEMBER THIS TYPE - you will use ONLY this type throughout your entire prompt
      4. DO NOT use generic terms like "jewelry piece" - use the SPECIFIC type you identified
      
      🚨 CRITICAL RULE: If the image shows EARRINGS, write ONLY about EARRINGS. If it shows a BRACELET, write ONLY about a BRACELET. If it shows a NECKLACE, write ONLY about a NECKLACE. If it shows a RING, write ONLY about a RING. DO NOT mix types or add jewelry that is not in the image.
      
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.
         
      DEFAULT POSE INSTRUCTION: If no specific pose is provided by the user, you must select a pose that showcases the SPECIFIC jewelry type you identified in STEP 1. The pose must highlight WHERE that jewelry type is worn on the body. The pose should be elegant and photogenic, with body language that emphasizes the identified jewelry type's beauty. DO NOT mention other jewelry types or body parts unrelated to the identified type.

      After constructing the description of the SPECIFIC jewelry type you identified, model, and background descriptions, you must also generate an additional block that describes a professional jewelry photography effect. This effect must adapt to the SPECIFIC jewelry type you identified, its gemstone types, metal finish, color palette, lighting conditions, and background environment. Do not use generic examples. Instead, analyze the ACTUAL jewelry type from the image and propose an effect that enhances it. Your effect description must cover color grading, lighting treatment, detail visibility, background integration, focus and depth of field, and overall editorial polish. Always ensure the tone is professional, realistic, and aligned with the visual language of high-end jewelry campaigns. The effect description must make the final result feel like a hyper-realistic editorial-quality photograph, seamlessly blending the SPECIFIC jewelry type you identified, model, and environment into a single cohesive campaign-ready image.


      When generating jewelry photography prompts, you must always structure the text into four separate paragraphs using \n\n line breaks. Do not output one long block of text.

Paragraph 1 → Model Description & Pose

Introduce the model (age, gender, editorial features).

Describe the pose with elegant, jewelry-focused language, inspired by popular jewelry photography campaigns. Ensure the pose showcases the jewelry piece effectively.

🚨 CRITICAL FOR PARAGRAPH 1 - POSE MUST MATCH JEWELRY TYPE FROM STEP 1:
You MUST have identified the jewelry type in STEP 1. Now describe the pose based on THAT EXACT type:

- If STEP 1 identified EARRINGS → Describe poses that show the EARS clearly (head tilts, hair styled away from ears, etc.). The pose must highlight the EARS where earrings are worn. FORBIDDEN: Do NOT mention "collarbone", "neck", "décolletage", "wrist", "hands", "fingers", or any positioning related to necklaces, bracelets, or rings.

- If STEP 1 identified NECKLACE → Describe poses that show the NECK and décolletage clearly (head position, shoulder turns, etc.). The pose must highlight the NECK where necklaces are worn. FORBIDDEN: Do NOT mention "ears", "earlobes", "wrist", "hands", "fingers", or any positioning related to earrings, bracelets, or rings.

- If STEP 1 identified RING → Describe poses that show the HANDS and FINGERS naturally and clearly. The pose must highlight the FINGERS where rings are worn. FORBIDDEN: Do NOT mention "neck", "ears", "wrist", or any positioning related to necklaces, earrings, or bracelets.

- If STEP 1 identified BRACELET → Describe poses that show the WRISTS clearly and prominently. The pose must highlight the WRISTS where bracelets are worn (hands extended, wrists forward, etc.). FORBIDDEN: Do NOT mention "neck", "ears", "fingers", or any positioning related to necklaces, earrings, or rings.

🚨 REMEMBER: The pose you describe MUST match the jewelry type from STEP 1. If you identified a bracelet, the pose MUST showcase wrists, NOT ears or neck.

Paragraph 2 → Jewelry Piece & Craftsmanship Details

🚨 CRITICAL REMINDER: You MUST have already identified the jewelry type in STEP 1. In Paragraph 2, you MUST describe ONLY that exact jewelry type. Do NOT change, mix, or add other jewelry types.

🚨 MANDATORY RULES FOR PARAGRAPH 2 - STRICT TYPE ENFORCEMENT:

- If STEP 1 identified EARRINGS → You MUST describe ONLY earrings. Use ONLY these terms: "earrings", "ear hooks", "posts", "earlobes", "ears", "ear studs", "ear drops". FORBIDDEN terms: "necklace", "neck", "décolletage", "chain", "pendant", "bracelet", "wrist", "ring", "finger", or ANY terms related to other jewelry types.

- If STEP 1 identified NECKLACE → You MUST describe ONLY a necklace. Use ONLY these terms: "necklace", "chain", "pendant", "neck", "décolletage", "clasp", "chain links". FORBIDDEN terms: "earrings", "ears", "earlobes", "bracelet", "wrist", "ring", "finger", or ANY terms related to other jewelry types.

- If STEP 1 identified RING → You MUST describe ONLY a ring. Use ONLY these terms: "ring", "finger", "band", "setting", "ring finger", "finger band". FORBIDDEN terms: "necklace", "neck", "earrings", "ears", "bracelet", "wrist", or ANY terms related to other jewelry types.

- If STEP 1 identified BRACELET → You MUST describe ONLY a bracelet. Use ONLY these terms: "bracelet", "wrist", "wristband", "bangle", "cuff", "wrist chain", "clasp". FORBIDDEN terms: "necklace", "neck", "earrings", "ears", "ring", "finger", or ANY terms related to other jewelry types.

🚨 CRITICAL DESCRIPTION RULES:
1. Look at the ACTUAL reference image and describe EXACTLY what you see - the real design, the actual gemstones visible, the actual metal work, the real settings, clasps, and craftsmanship details.
2. Do NOT use placeholder text like "[insert...]", "e.g.,", "for example", or hypothetical descriptions.
3. Do NOT mix jewelry types - if you see a bracelet, describe ONLY a bracelet. Do NOT add earrings, necklaces, or rings.
4. Do NOT use example jewelry descriptions - describe ONLY what is actually visible in the reference image.
5. If the image shows jewelry with specific gemstones, describe THOSE gemstones. Do NOT add jewelry that is not visible in the image.
6. Use jewelry and gemology terminology to describe the SPECIFIC jewelry piece shown in the reference image.
7. Keep all design, colors, gemstones, metal finish, engravings EXACTLY the same as shown in the reference image.
8. Describe only what is ACTUALLY VISIBLE in the reference image, not hypothetical or example jewelry.

Paragraph 3 → Environment & Ambiance

Describe the setting in editorial tone (minimalist, refined, photogenic, luxury).

Mention architecture, light play, textures.

Keep it supportive, not distracting from the jewelry piece.

Paragraph 4 → Lighting, Composition & Final Output

Always describe lighting as "refined studio lighting that highlights gemstone brilliance and metal luster, blended with natural daylight softness".

After Paragraph 4, you MUST add a "CRITICAL RULES FOR JEWELRY PHOTOGRAPHY" section. This section should include professional jewelry photography guidelines covering: output requirements (single photograph only), lighting (refined studio lighting highlighting gemstone brilliance and metal luster), clarity and detail requirements, composition and framing guidelines, camera perspective, jewelry presentation, color accuracy, jewelry positioning, background control, depth and realism, posture and pose, focus and sharpness, and atmosphere. Write these rules in a professional, comprehensive manner suitable for high-end jewelry photography. Do NOT copy static rules - write them naturally as part of your prompt generation.

Conclude with: "The final result must be a single, hyper-realistic, editorial-quality jewelry photograph, seamlessly integrating model, jewelry piece, and environment at campaign-ready standards, inspired by popular jewelry photography styles

      

CRITICAL RULES FOR JEWELRY PHOTOGRAPHY:

Always construct prompts in the language and style of editorial jewelry photography. Use precise jewelry and gemology terminology rather than plain product description.

Describe the jewelry piece using jewelry industry terminology (gemstone cut, metal finish, setting style, clasp type, craftsmanship details, etc.).

Define the model's appearance with editorial tone (sculpted jawline, refined cheekbones, luminous gaze, poised stance) that complements luxury jewelry presentation.

Lighting must be described in jewelry photography terms (refined studio lighting, gemstone brilliance, metal luster, diffused daylight, balanced exposure, flattering shadow play, high-definition clarity that captures every detail).

Composition should reference jewelry photography language (close-up detail shots, elegant mid-shots, sophisticated full-body lifestyle compositions, rule of thirds, depth of field, polished framing, editorial atmosphere).

Environment must remain minimalist and photogenic, complementing the jewelry piece without distraction. Use words like "sophisticated", "refined", "contemporary", "luxury", "elevated backdrop".

Always conclude that the result is a single, high-end professional jewelry photograph, polished to editorial standards, suitable for luxury jewelry catalogs and campaigns, inspired by popular jewelry photography styles.

Do not use plain catalog language. Do not produce technical listing-style descriptions. The tone must always reflect editorial-level jewelry shoot aesthetic.

Exclude all original flat-lay elements (display stand, shadow box, packaging, textures, painting, or any other artifacts). Only the jewelry piece itself must be transferred.

The original background must be completely replaced with the newly described background. Do not keep or reuse any part of the input photo background.

The output must be hyper-realistic, high-end professional jewelry editorial quality, suitable for luxury commercial catalog presentation, inspired by popular jewelry photography campaigns.

      ${criticalDirectives}

      ${
        isMultipleProducts
          ? `
      💎 MULTIPLE JEWELRY PIECES MODE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES, each showing a different jewelry piece that together form a complete jewelry ensemble. You MUST analyze ALL the reference images provided and describe every single jewelry piece visible across all images. Each jewelry piece is equally important and must be properly described and positioned on the ${modelGenderText}.

      CRITICAL MULTIPLE JEWELRY PIECES REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each image shows a different jewelry piece
      - COUNT how many distinct jewelry pieces are present across ALL reference images
      - DESCRIBE each jewelry piece individually with its specific design details, gemstones, metal finish, settings, clasps, and craftsmanship elements from their respective reference images
      - ENSURE that ALL jewelry pieces from ALL reference images are mentioned in your prompt - do not skip any piece
      - COORDINATE how all jewelry pieces work together as a complete ensemble when worn together
      - SPECIFY the proper positioning and interaction between jewelry pieces
      - MAINTAIN the original design of each individual jewelry piece while showing them as a coordinated ensemble
      - REMEMBER: Each reference image shows a separate jewelry piece - combine them intelligently into one cohesive jewelry look
      `
          : ""
      }

      🚨 CRITICAL FIRST STEP - MANDATORY IMAGE ANALYSIS: 
      
      BEFORE YOU WRITE A SINGLE WORD, YOU MUST:
      1. CAREFULLY EXAMINE the reference image(s) provided
      2. IDENTIFY EXACTLY what type of jewelry is shown - look at WHERE it would be worn on the body
      3. CONFIRM the jewelry type: EARRINGS (worn on ears), NECKLACE (worn around neck), RING (worn on fingers), or BRACELET (worn on wrists)
      4. WRITE DOWN the identified jewelry type mentally before proceeding
      
      VISUAL IDENTIFICATION GUIDE:
      - EARRINGS: Small pieces designed to hang from or attach to the earlobes. Look for hooks, posts, or studs. They are NOT worn around the neck or on wrists.
      - NECKLACE: A chain, cord, or strand designed to be worn around the neck. It hangs from the neck, NOT from ears or wrists.
      - RING: A circular band designed to be worn on a finger. It fits around a finger, NOT around the neck, wrist, or attached to ears.
      - BRACELET: A band or chain designed to be worn around the wrist. It wraps around the wrist, NOT around the neck, on fingers, or attached to ears.
      
      🚨 ABSOLUTE RULE: Once you identify the jewelry type in STEP 1, you MUST describe ONLY that specific type throughout your ENTIRE prompt. 
      
      - If you see EARRINGS → Describe ONLY earrings. NEVER mention "necklace", "neck", "décolletage", "chain", "pendant", "bracelet", "wrist", "ring", "finger", or any terms related to other jewelry types.
      - If you see a NECKLACE → Describe ONLY a necklace. NEVER mention "earrings", "ears", "earlobes", "bracelet", "wrist", "ring", "finger", or any terms related to other jewelry types.
      - If you see a RING → Describe ONLY a ring. NEVER mention "necklace", "neck", "earrings", "ears", "bracelet", "wrist", or any terms related to other jewelry types.
      - If you see a BRACELET → Describe ONLY a bracelet. NEVER mention "necklace", "neck", "earrings", "ears", "ring", "finger", or any terms related to other jewelry types.
      
      🚨 CRITICAL: Do NOT guess, assume, or use example jewelry. Look at the ACTUAL image and describe EXACTLY what you see. If the image shows a bracelet, you MUST write about a bracelet. If it shows earrings, you MUST write about earrings. Do NOT mix types or add jewelry that is not in the image.
      
      STEP 2 - PROMPT GENERATION: Now create a professional jewelry photography prompt in English that STARTS with "Replace" for replacing ${
        isMultipleProducts
          ? "ALL the jewelry pieces from the reference image"
          : "the jewelry piece from the reference image"
      } onto a ${modelGenderText}, inspired by popular jewelry photography campaigns.
      
      JEWELRY PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional jewelry photography and commercial jewelry presentation. Ensure the output is suitable for high-end jewelry shoots, editorial styling, and luxury commercial jewelry photography, inspired by popular jewelry campaigns.

      IMPORTANT: Please explicitly mention in your generated prompt that this is for "professional jewelry photography" or "luxury jewelry photography" to ensure the AI image model understands the context and produces high-quality jewelry photography results.

      CRITICAL REQUIREMENTS FOR JEWELRY:
      1. The prompt MUST begin with "Replace the ${
        isMultipleProducts ? "multiple jewelry pieces" : "jewelry piece"
      }..."
      2. Keep ${
        isMultipleProducts
          ? "ALL original jewelry pieces"
          : "the original jewelry piece"
      } exactly the same without changing any design, shape, gemstones, metal finish, settings, clasps, or details
      3. Do not modify or redesign ${
        isMultipleProducts ? "any of the jewelry pieces" : "the jewelry piece"
      } in any way
      4. The final image should be photorealistic, showing ${
        isMultipleProducts
          ? "ALL jewelry pieces perfectly positioned and coordinated on the model"
          : "the same jewelry piece perfectly positioned"
      } on the ${baseModelText}
      5. Use refined studio lighting that highlights gemstone brilliance and metal luster, with a clean or sophisticated background
      6. Preserve ALL original details of ${
        isMultipleProducts ? "EACH jewelry piece" : "the jewelry piece"
      }: gemstones, metal finish, settings, clasps, engravings, and craftsmanship details
      7. ${
        isMultipleProducts
          ? "ALL jewelry pieces must appear identical to the reference image, just worn by the model as a complete coordinated jewelry ensemble"
          : "The jewelry piece must appear identical to the reference image, just worn by the model instead of being displayed flat"
      }
      8. MANDATORY: Include "professional jewelry photography" or "luxury jewelry photography" phrase in your generated prompt
      9. MANDATORY: Use poses and camera angles inspired by popular jewelry photography campaigns
      10. 🚨 CRITICAL - MANDATORY IMAGE ANALYSIS FIRST: You MUST complete STEP 1 (IMAGE ANALYSIS) before writing ANY paragraph. Look at the reference image and identify EXACTLY what type of jewelry is shown. Once you identify the jewelry type in STEP 1, you MUST stick to that EXACT type throughout the ENTIRE prompt - in Paragraph 1, Paragraph 2, Paragraph 3, and Paragraph 4.
      
      TYPE-SPECIFIC ENFORCEMENT:
      - If STEP 1 identified EARRINGS → Describe ONLY earrings in ALL paragraphs. NEVER mention "necklace", "neck", "décolletage", "chain", "pendant", "bracelet", "wrist", "ring", "finger", or ANY terms related to other jewelry types in ANY paragraph.
      - If STEP 1 identified NECKLACE → Describe ONLY a necklace in ALL paragraphs. NEVER mention "earrings", "ears", "earlobes", "bracelet", "wrist", "ring", "finger", or ANY terms related to other jewelry types in ANY paragraph.
      - If STEP 1 identified RING → Describe ONLY a ring in ALL paragraphs. NEVER mention "necklace", "neck", "earrings", "ears", "bracelet", "wrist", or ANY terms related to other jewelry types in ANY paragraph.
      - If STEP 1 identified BRACELET → Describe ONLY a bracelet in ALL paragraphs. NEVER mention "necklace", "neck", "earrings", "ears", "ring", "finger", or ANY terms related to other jewelry types in ANY paragraph.
      
      🚨 ABSOLUTE RULE: Describe EXACTLY what you see in the reference image. Do NOT use placeholder text like "[insert...]", "e.g.,", "for example", or hypothetical descriptions. Do NOT mix jewelry types. Do NOT add jewelry that is not in the image. If the image shows a bracelet, write ONLY about a bracelet. If it shows earrings, write ONLY about earrings. Do NOT add "blue stone earrings" or "diamond necklace" if they are not visible in the reference image.
      ${
        isMultipleProducts
          ? "11. MANDATORY: Explicitly mention and describe EACH individual jewelry piece visible in the reference image - do not generalize or group them"
          : ""
      }

      ${
        isMultipleProducts
          ? `
      MULTIPLE JEWELRY PIECES DETAIL COVERAGE (MANDATORY): 
      - ANALYZE the reference image and identify EACH distinct jewelry piece
      - DESCRIBE each jewelry piece's specific craftsmanship details, gemstones, metal work, settings, and design elements that you ACTUALLY SEE in the reference image
      - Do NOT use placeholder text like "[insert...]", "e.g.,", or example descriptions. Describe only what is visible in the image.
      - EXPLAIN how the jewelry pieces coordinate together as an ensemble
      - SPECIFY the proper positioning of each jewelry piece on the model based on where it is naturally worn
      - ENSURE no jewelry piece is overlooked or generically described. Describe each piece exactly as it appears in the reference image.
      `
          : ""
      }

      JEWELRY TRANSFORMATION REQUIREMENTS:
      - Generate ONLY ONE SINGLE unified jewelry photograph, not multiple images or split views
      - Transform the flat-lay jewelry piece into a hyper-realistic, three-dimensional jewelry piece worn on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance.
      - Ensure realistic jewelry positioning: the jewelry piece should be positioned naturally based on where it is worn on the body, following natural body contours and movements.
      - Preserve all original jewelry details including exact gemstones, metal finish, settings, clasps, engravings, and craftsmanship elements. Avoid redesigning the original jewelry piece.
      - Maintain photorealistic integration with the model and scene including correct scale, perspective, lighting that highlights gemstone brilliance and metal luster, cast shadows, and occlusions that match the camera angle and scene lighting.
      - Focus on transforming the jewelry piece onto the existing model and seamlessly integrating it into the scene. Avoid introducing new background elements unless a location reference is explicitly provided.
      - OUTPUT: One single professional jewelry photograph only, inspired by popular jewelry photography campaigns

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".

      ${
        originalPrompt
          ? `USER CONTEXT: The user has provided these specific requirements: ${originalPrompt}. Please integrate these requirements naturally into your jewelry replacement prompt while maintaining the professional structure and flow.`
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
      
      Generate a concise prompt focused on jewelry replacement while maintaining all original details. REMEMBER: Your response must START with "Replace". Apply all rules silently and do not include any rule text or headings in the output.
      
      🚨 CRITICAL REMINDER - FINAL CHECK BEFORE WRITING:
      
      Before writing ANY paragraph, you MUST:
      1. Look at the reference image CAREFULLY
      2. Identify EXACTLY what type of jewelry is shown: EARRINGS, NECKLACE, RING, or BRACELET
      3. Remember: EARRINGS hang from ears, NECKLACE goes around neck, RING fits on finger, BRACELET wraps around wrist
      4. Once identified, describe ONLY that exact type throughout ALL paragraphs
      
      TYPE-SPECIFIC REMINDERS:
      - If image shows EARRINGS → Write ONLY about earrings. FORBIDDEN: "necklace", "neck", "décolletage", "chain", "bracelet", "wrist", "ring", "finger"
      - If image shows NECKLACE → Write ONLY about necklace. FORBIDDEN: "earrings", "ears", "earlobes", "bracelet", "wrist", "ring", "finger"
      - If image shows RING → Write ONLY about ring. FORBIDDEN: "necklace", "neck", "earrings", "ears", "bracelet", "wrist"
      - If image shows BRACELET → Write ONLY about bracelet. FORBIDDEN: "necklace", "neck", "earrings", "ears", "ring", "finger"
      
      🚨 ABSOLUTE RULES:
      - Describe EXACTLY what you see in the reference image - the actual design, real gemstones, actual metal work
      - Do NOT write placeholder text like "[insert specific jewelry type here, e.g., diamond pendant necklace]" or use example descriptions
      - Do NOT mix jewelry types - if you see a bracelet, write ONLY about a bracelet
      - Do NOT add jewelry that is not in the image - if the image shows a bracelet, do NOT add "blue stone earrings" or "diamond necklace"
      - Look at the ACTUAL image and describe ONLY what is visible
      
      EXAMPLE FORMAT: "Replace the jewelry piece from the input image directly onto a [model description] while keeping the original jewelry piece exactly the same, using poses and camera angles inspired by popular jewelry photography campaigns..."
      `;
    }

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, use a natural pose inspired by popular jewelry photography campaigns that keeps the jewelry piece fully visible. The pose should naturally highlight the jewelry piece based on where it is worn on the body. Ensure jewelry details (gemstones, metal finish, settings) are clearly visible and well-lit.`;
      }
    }

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Multi-mode resim gönderimi: Back side analysis, Multiple products, veya Normal mod
    if (isBackSideAnalysis && referenceImages && referenceImages.length >= 2) {
      console.log(
        "🔄 [BACK_SIDE] Gemini'ye 2 resim gönderiliyor (ön + arka)..."
      );

      try {
        // İlk resim (ön taraf)
        console.log(
          `🔄 [BACK_SIDE] İlk resim (ön taraf) Gemini'ye gönderiliyor: ${
            referenceImages[0].uri || referenceImages[0]
          }`
        );

        const firstImageUrl = referenceImages[0].uri || referenceImages[0];
        const firstImageResponse = await axios.get(firstImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const firstImageBuffer = firstImageResponse.data;
        const base64FirstImage =
          Buffer.from(firstImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64FirstImage,
          },
        });

        console.log(
          "🔄 [BACK_SIDE] İlk resim (ön taraf) başarıyla Gemini'ye eklendi"
        );

        // İkinci resim (arka taraf)
        console.log(
          `🔄 [BACK_SIDE] İkinci resim (arka taraf) Gemini'ye gönderiliyor: ${
            referenceImages[1].uri || referenceImages[1]
          }`
        );

        const secondImageUrl = referenceImages[1].uri || referenceImages[1];
        const secondImageResponse = await axios.get(secondImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const secondImageBuffer = secondImageResponse.data;
        const base64SecondImage =
          Buffer.from(secondImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64SecondImage,
          },
        });

        console.log(
          "🔄 [BACK_SIDE] İkinci resim (arka taraf) başarıyla Gemini'ye eklendi"
        );
        console.log("🔄 [BACK_SIDE] Toplam 2 resim Gemini'ye gönderildi");
      } catch (imageError) {
        console.error(
          `🔄 [BACK_SIDE] Resim yüklenirken hata: ${imageError.message}`
        );
      }
    } else if (
      isMultipleProducts &&
      referenceImages &&
      referenceImages.length > 1
    ) {
      // Multi-product mode: Tüm referans resimleri gönder
      console.log(
        `🛍️ [MULTI-PRODUCT] Gemini'ye ${referenceImages.length} adet referans resmi gönderiliyor...`
      );

      try {
        for (let i = 0; i < referenceImages.length; i++) {
          const referenceImage = referenceImages[i];
          const imageUrl = referenceImage.uri || referenceImage;

          console.log(
            `🛍️ [MULTI-PRODUCT] ${
              i + 1
            }. resim Gemini'ye gönderiliyor: ${imageUrl}`
          );

          const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          const imageBuffer = imageResponse.data;
          const base64Image = Buffer.from(imageBuffer).toString("base64");

          parts.push({
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          });

          console.log(
            `🛍️ [MULTI-PRODUCT] ${i + 1}. resim başarıyla Gemini'ye eklendi`
          );
        }

        console.log(
          `🛍️ [MULTI-PRODUCT] Toplam ${referenceImages.length} adet referans resmi Gemini'ye gönderildi`
        );
      } catch (imageError) {
        console.error(
          `🛍️ [MULTI-PRODUCT] Referans resimleri yüklenirken hata: ${imageError.message}`
        );
      }
    } else {
      // Normal mod: Tek resim gönder
      try {
        console.log(`Referans görsel Gemini'ye gönderiliyor: ${imageUrl}`);

        const imageResponse = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 15000, // 30s'den 15s'ye düşürüldü
        });
        const imageBuffer = imageResponse.data;

        // Base64'e çevir
        const base64Image = Buffer.from(imageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Image,
          },
        });

        console.log("Referans görsel başarıyla Gemini'ye yüklendi");
      } catch (imageError) {
        console.error(`Görsel yüklenirken hata: ${imageError.message}`);
      }
    }

    // Location image handling kaldırıldı - artık kullanılmıyor

    // Pose image'ını da Gemini'ye gönder
    if (poseImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanPoseImageUrl = poseImage.split("?")[0];
        console.log(
          `🤸 Pose görsel base64'e çeviriliyor: ${cleanPoseImageUrl}`
        );

        const poseImageResponse = await axios.get(cleanPoseImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000, // 30s'den 15s'ye düşürüldü
        });
        const poseImageBuffer = poseImageResponse.data;

        // Base64'e çevir
        const base64PoseImage = Buffer.from(poseImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64PoseImage,
          },
        });

        console.log("🤸 Pose görsel başarıyla Gemini'ye eklendi");
      } catch (poseImageError) {
        console.error(
          `🤸 Pose görseli eklenirken hata: ${poseImageError.message}`
        );
      }
    }

    // Hair style image'ını da Gemini'ye gönder
    if (hairStyleImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanHairStyleImageUrl = hairStyleImage.split("?")[0];
        console.log(
          `💇 Hair style görsel base64'e çeviriliyor: ${cleanHairStyleImageUrl}`
        );

        const hairStyleImageResponse = await axios.get(cleanHairStyleImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000, // 30s'den 15s'ye düşürüldü
        });
        const hairStyleImageBuffer = hairStyleImageResponse.data;

        // Base64'e çevir
        const base64HairStyleImage =
          Buffer.from(hairStyleImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64HairStyleImage,
          },
        });

        console.log("💇 Hair style görsel başarıyla Gemini'ye eklendi");
      } catch (hairStyleImageError) {
        console.error(
          `💇 Hair style görseli eklenirken hata: ${hairStyleImageError.message}`
        );
      }
    }

    // Location image'ını da Gemini'ye gönder
    if (locationImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanLocationImageUrl = locationImage.split("?")[0];
        console.log(
          `🏞️ Location görsel base64'e çeviriliyor: ${cleanLocationImageUrl}`
        );

        const locationImageResponse = await axios.get(cleanLocationImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const locationImageBuffer = locationImageResponse.data;

        // Base64'e çevir
        const base64LocationImage =
          Buffer.from(locationImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64LocationImage,
          },
        });

        console.log("🏞️ Location görsel başarıyla Gemini'ye eklendi");
      } catch (locationImageError) {
        console.error(
          `🏞️ Location görseli eklenirken hata: ${locationImageError.message}`
        );
      }
    }

    // Gemini'den cevap al (retry mekanizması ile) - Yeni API
    let enhancedPrompt;
    const maxRetries = 10;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 [GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

        const result = await genAI.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: parts,
            },
          ],
        });

        const geminiGeneratedPrompt =
          result.text?.trim() || result.response?.text()?.trim() || "";

        // Gemini response kontrolü
        if (!geminiGeneratedPrompt) {
          console.error("❌ Gemini API response boş:", result);
          throw new Error("Gemini API response is empty or invalid");
        }

        // ControlNet direktifini dinamik olarak ekle
        // let controlNetDirective = "";
        // if (!hasControlNet) {
        //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

        // `;
        // } else {
        //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

        // `;
        // }

        // CRITICAL RULES artık Gemini tarafından yazılacak, statik olarak gönderilmiyor
        enhancedPrompt = geminiGeneratedPrompt;
        console.log(
          "🤖 [BACKEND GEMINI] Gemini'nin ürettiği prompt:",
          geminiGeneratedPrompt
        );
        console.log(
          "✨ [BACKEND GEMINI] Final enhanced prompt (statik kurallarla):",
          enhancedPrompt
        );
        break; // Başarılı olursa loop'tan çık
      } catch (geminiError) {
        console.error(
          `Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );

        if (attempt === maxRetries) {
          console.error(
            "Gemini API all attempts failed, using original prompt"
          );
          // Hata durumunda da uygun direktifi ekle
          // let controlNetDirective = "";
          // if (hasControlNet) {
          //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

          // `;
          // } else {
          //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

          // `;
          // }
          // Fallback durumunda da statik kuralları ekle - Jewelry odaklı
          const staticRules = `

CRITICAL RULES FOR JEWELRY PHOTOGRAPHY:

The output must be a single, high-end professional jewelry photograph only — no collages, duplicates, or extra frames.

Apply refined studio lighting that highlights gemstone brilliance and metal luster, blended naturally with daylight, ensuring flawless exposure, vibrant gemstone colors, and sharp focus on jewelry details.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look. Every jewelry detail (gemstones, metal finish, settings, clasps) must be crystal clear.

Model, jewelry piece, and environment must integrate into one cohesive, seamless professional jewelry photograph suitable for luxury commercial catalogs and editorial campaigns, inspired by popular jewelry photography styles.`;

          enhancedPrompt = originalPrompt + staticRules;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Eğer Gemini sonuç üretemediyse (enhancedPrompt orijinal prompt ile aynıysa) direkt fallback prompt kullan
    if (enhancedPrompt === originalPrompt) {
      console.log(
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

      // Yaş sayısını çıkar
      if (age) {
        if (age.includes("years old")) {
          const ageMatch = age.match(/(\d+)\s*years old/);
          if (ageMatch) {
            parsedAgeInt = parseInt(ageMatch[1]);
          }
        } else if (age.includes("baby") || age.includes("bebek")) {
          parsedAgeInt = 1;
        } else if (age.includes("child") || age.includes("çocuk")) {
          parsedAgeInt = 5;
        } else if (age.includes("young") || age.includes("genç")) {
          parsedAgeInt = 22;
        } else if (age.includes("adult") || age.includes("yetişkin")) {
          parsedAgeInt = 45;
        }
      }

      // Yaş grupları - güvenli flag-safe tanımlar
      if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
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
        console.log(
          "🏞️ [FALLBACK] Enhanced location prompt kullanılıyor:",
          locationEnhancedPrompt
        );
      } else if (location) {
        environmentDescription += ` in ${location}`;
        console.log("🏞️ [FALLBACK] Basit location kullanılıyor:", location);
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

      // Ana prompt oluştur - Jewelry photography odaklı (çoklu ürün desteği ile)
      let fallbackPrompt = `Replace the ${
        isMultipleProducts ? "multiple jewelry pieces" : "jewelry piece"
      } from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}, using poses and camera angles inspired by popular jewelry photography campaigns. `;

      // Jewelry photography ve kalite gereksinimleri
      fallbackPrompt += `This is for professional jewelry photography and commercial jewelry presentation, inspired by popular jewelry campaigns. Preserve ${
        isMultipleProducts
          ? "ALL original jewelry pieces"
          : "the original jewelry piece"
      } exactly as is, without altering any design, shape, gemstones, metal finish, settings, clasps, or details. The photorealistic output must show ${
        isMultipleProducts
          ? "ALL identical jewelry pieces perfectly positioned and coordinated"
          : "the identical jewelry piece perfectly positioned"
      } on the dynamic model for high-end jewelry shoots. `;

      // Takı özellikleri (genel)
      fallbackPrompt += `${
        isMultipleProducts ? "Each jewelry piece" : "The jewelry piece"
      } features high-quality craftsmanship with proper gemstone settings, metal work, and design details. `;

      // Çoklu ürün için ek koordinasyon talimatları
      if (isMultipleProducts) {
        fallbackPrompt += `Ensure ALL jewelry pieces work together as a coordinated ensemble, maintaining proper positioning and visual harmony between all pieces. `;
      }

      // Temizlik gereksinimleri - jewelry odaklı
      fallbackPrompt += `Please ensure that all display stands, shadow boxes, packaging, and flat-lay artifacts are completely removed. Transform the ${
        isMultipleProducts ? "jewelry pieces" : "jewelry piece"
      } into hyper-realistic, three-dimensional jewelry worn on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance. `;

      // Takı pozisyonlama gereksinimleri
      fallbackPrompt += `Ensure realistic jewelry positioning for ${
        isMultipleProducts ? "ALL jewelry pieces" : "the jewelry piece"
      }: the jewelry should be positioned naturally based on where it is worn on the body, following natural body contours and movements. Maintain a clean commercial presentation with proper jewelry placement. `;

      // Detay koruma - jewelry odaklı
      fallbackPrompt += `Preserve all original details of ${
        isMultipleProducts ? "EACH jewelry piece" : "the jewelry piece"
      } including exact gemstones, metal finish, settings, clasps, engravings, and craftsmanship elements. Avoid redesigning ${
        isMultipleProducts
          ? "any of the original jewelry pieces"
          : "the original jewelry piece"
      }. `;

      // Final kalite - Jewelry photography standartları
      fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting that highlights gemstone brilliance and metal luster, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional jewelry photography aesthetic suitable for luxury commercial and editorial use, inspired by popular jewelry photography campaigns.`;

      console.log(
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
    console.log(
      "🔄 [FALLBACK] Enhanced prompt oluşturulamadı, detaylı fallback prompt kullanılıyor"
    );

    // Statik kuralları fallback prompt'un sonuna da ekle - Jewelry odaklı
    const fallbackStaticRules = `

CRITICAL RULES FOR JEWELRY PHOTOGRAPHY:

The output must be a single, high-end professional jewelry photograph only — no collages, duplicates, or extra frames.

Apply refined studio lighting that highlights gemstone brilliance and metal luster, blended naturally with daylight, ensuring flawless exposure, vibrant gemstone colors, and sharp focus on jewelry details.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look. Every jewelry detail (gemstones, metal finish, settings, clasps) must be crystal clear.

Model, jewelry piece, and environment must integrate into one cohesive, seamless professional jewelry photograph suitable for luxury commercial catalogs and editorial campaigns, inspired by popular jewelry photography styles.`;

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

    // Yaş sayısını çıkar
    if (age) {
      if (age.includes("years old")) {
        const ageMatch = age.match(/(\d+)\s*years old/);
        if (ageMatch) {
          parsedAgeInt = parseInt(ageMatch[1]);
        }
      } else if (age.includes("baby") || age.includes("bebek")) {
        parsedAgeInt = 1;
      } else if (age.includes("child") || age.includes("çocuk")) {
        parsedAgeInt = 5;
      } else if (age.includes("young") || age.includes("genç")) {
        parsedAgeInt = 22;
      } else if (age.includes("adult") || age.includes("yetişkin")) {
        parsedAgeInt = 45;
      }
    }

    // Yaş grupları - güvenli flag-safe tanımlar (ikinci fallback)
    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
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
      console.log(
        "🏞️ [FALLBACK ERROR] Enhanced location prompt kullanılıyor:",
        locationEnhancedPrompt
      );
    } else if (location) {
      environmentDescription += ` in ${location}`;
      console.log("🏞️ [FALLBACK ERROR] Basit location kullanılıyor:", location);
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

    // Ana prompt oluştur (çoklu ürün desteği ile) - Jewelry odaklı
    let fallbackPrompt = `Replace the ${
      isMultipleProducts ? "multiple jewelry pieces" : "jewelry piece"
    } from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}, using poses and camera angles inspired by popular jewelry photography campaigns. `;

    // Jewelry photography ve kalite gereksinimleri
    fallbackPrompt += `This is for professional jewelry photography and commercial jewelry presentation, inspired by popular jewelry campaigns. Preserve ${
      isMultipleProducts
        ? "ALL original jewelry pieces"
        : "the original jewelry piece"
    } exactly as is, without altering any design, shape, gemstones, metal finish, settings, clasps, or details. The photorealistic output must show ${
      isMultipleProducts
        ? "ALL identical jewelry pieces perfectly positioned and coordinated"
        : "the identical jewelry piece perfectly positioned"
    } on the dynamic model for high-end jewelry shoots. `;

    // Takı özellikleri (genel)
    fallbackPrompt += `${
      isMultipleProducts ? "Each jewelry piece" : "The jewelry piece"
    } features high-quality craftsmanship with proper gemstone settings, metal work, and design details. `;

    // Çoklu ürün için ek koordinasyon talimatları
    if (isMultipleProducts) {
      fallbackPrompt += `Ensure ALL jewelry pieces work together as a coordinated ensemble, maintaining proper positioning and visual harmony between all pieces. `;
    }

    // Temizlik gereksinimleri - jewelry odaklı
    fallbackPrompt += `Please ensure that all display stands, shadow boxes, packaging, and flat-lay artifacts are completely removed. Transform the ${
      isMultipleProducts ? "jewelry pieces" : "jewelry piece"
    } into hyper-realistic, three-dimensional jewelry worn on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance. `;

    // Takı pozisyonlama gereksinimleri
    fallbackPrompt += `Ensure realistic jewelry positioning for ${
      isMultipleProducts ? "ALL jewelry pieces" : "the jewelry piece"
    }: the jewelry should be positioned naturally based on where it is worn on the body, following natural body contours and movements. Maintain a clean commercial presentation with proper jewelry placement. `;

    // Detay koruma - jewelry odaklı
    fallbackPrompt += `Preserve all original details of ${
      isMultipleProducts ? "EACH jewelry piece" : "the jewelry piece"
    } including exact gemstones, metal finish, settings, clasps, engravings, and craftsmanship elements. Avoid redesigning ${
      isMultipleProducts
        ? "any of the original jewelry pieces"
        : "the original jewelry piece"
    }. `;

    // Final kalite - Jewelry photography standartları
    fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting that highlights gemstone brilliance and metal luster, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional jewelry photography aesthetic suitable for luxury commercial and editorial use, inspired by popular jewelry photography campaigns.`;

    console.log(
      "🔄 [FALLBACK] Generated detailed fallback prompt:",
      fallbackPrompt
    );

    // Son fallback durumunda da statik kuralları ekle - Jewelry odaklı
    const finalStaticRules = `

CRITICAL RULES FOR JEWELRY PHOTOGRAPHY:

The output must be a single, high-end professional jewelry photograph only — no collages, duplicates, or extra frames.

Apply refined studio lighting that highlights gemstone brilliance and metal luster, blended naturally with daylight, ensuring flawless exposure, vibrant gemstone colors, and sharp focus on jewelry details.

Guarantee editorial-level clarity and detail, with no blur, dull tones, or artificial look. Every jewelry detail (gemstones, metal finish, settings, clasps) must be crystal clear.

Model, jewelry piece, and environment must integrate into one cohesive, seamless professional jewelry photograph suitable for luxury commercial catalogs and editorial campaigns, inspired by popular jewelry photography styles.`;

    return fallbackPrompt + finalStaticRules;
  }
}

// Arkaplan silme fonksiyonu kaldırıldı - artık kullanılmıyor

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
          timeout: 15000, // 30s'den 15s'ye düşürüldü polling için
        }
      );

      const result = response.data;
      console.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        console.log("Replicate işlemi başarıyla tamamlandı");
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
          console.log(
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
        console.log("🛑 PA hatası - Polling döngüsü derhal sonlandırılıyor");
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
  console.log(
    `🔄 Retry'li polling başlatılıyor: ${predictionId} (maxRetries: ${maxRetries})`
  );

  for (let retryAttempt = 1; retryAttempt <= maxRetries; retryAttempt++) {
    try {
      console.log(`🔄 Polling retry attempt ${retryAttempt}/${maxRetries}`);

      // Normal polling fonksiyonunu çağır
      const result = await pollReplicateResult(predictionId);

      // Başarılı ise sonucu döndür
      console.log(`✅ Polling retry ${retryAttempt} başarılı!`);
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
        console.log(`🔄 Geçici hata retry edilecek: ${pollingError.message}`);
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
      console.log(
        `⏳ Polling retry ${retryAttempt} için ${waitTime}ms bekleniyor...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

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
      console.log(
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
      console.log(
        "🧍 [BACKEND] Model referans görseli tespit edildi:",
        modelReferenceImage?.uri || modelReferenceImage
      );
    } else {
      console.log("🧍 [BACKEND] Model referans görseli bulunamadı");
    }

    const hasRequestField = (fieldName) =>
      Object.prototype.hasOwnProperty.call(req.body, fieldName);

    if (!isPoseChange && hasRequestField("hasProductPhotos")) {
      console.log(
        "🕺 [BACKEND] ChangeModelPose payload tespit edildi (hasProductPhotos mevcut), isPoseChange true olarak işaretleniyor"
      );
      isPoseChange = true;
    }

    console.log("🖼️ [BACKEND] isMultipleImages:", isMultipleImages);
    console.log("🛍️ [BACKEND] isMultipleProducts:", isMultipleProducts);
    console.log("🎨 [BACKEND] isColorChange:", isColorChange);
    console.log("🎨 [BACKEND] targetColor:", targetColor);
    console.log("🕺 [BACKEND] isPoseChange:", isPoseChange);
    console.log("🕺 [BACKEND] customDetail:", customDetail);
    console.log("✏️ [BACKEND] isEditMode:", isEditMode);
    console.log("✏️ [BACKEND] editPrompt:", editPrompt);
    console.log("🔧 [BACKEND] isRefinerMode:", isRefinerMode);
    const incomingReferenceCount = referenceImages?.length || 0;
    const totalReferenceCount =
      incomingReferenceCount + (modelReferenceImage ? 1 : 0);

    console.log(
      "📤 [BACKEND] Gelen referenceImages:",
      incomingReferenceCount,
      "adet"
    );
    console.log(
      "📤 [BACKEND] Toplam referans (model dahil):",
      totalReferenceCount
    );

    // EditScreen modunda promptText boş olabilir (editPrompt kullanılacak)
    const hasValidPrompt =
      promptText || (isEditMode && editPrompt && editPrompt.trim());

    console.log(
      "🔍 [VALIDATION] promptText:",
      promptText ? "✅ Var" : "❌ Yok"
    );
    console.log("🔍 [VALIDATION] isEditMode:", isEditMode);
    console.log(
      "🔍 [VALIDATION] editPrompt:",
      editPrompt ? "✅ Var" : "❌ Yok"
    );
    console.log("🔍 [VALIDATION] hasValidPrompt:", hasValidPrompt);

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
    console.log(
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

      console.log(
        `💳 [SESSION-DEDUP] SessionId ${sessionId} ile ${
          sessionGenerations.length
        } generation bulundu (${
          recentGenerations?.length || 0
        } recent'tan filtrelendi)`
      );

      if (
        !sessionError &&
        sessionGenerations &&
        sessionGenerations.length >= 1
      ) {
        console.log(
          `💳 [SESSION-DEDUP] Aynı session'da generation var, kredi düşürme atlanıyor (${sessionGenerations.length} generation)`
        );
        // shouldDeductCredit = false; // Disabled
      } else {
        console.log(
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

      console.log(
        `💳 [TIME-DEDUP] Son 30 saniyede ${
          recentGenerations?.length || 0
        } generation bulundu`
      );

      if (!recentError && recentGenerations && recentGenerations.length >= 1) {
        console.log(
          `💳 [TIME-DEDUP] Son 30 saniyede generation var, kredi düşürme atlanıyor (${recentGenerations.length} generation)`
        );
        // shouldDeductCredit = false; // Disabled
      } else {
        console.log(`💳 [TIME-DEDUP] İlk generation, kredi düşürülecek`);
      }
    }

    console.log(`💳 [CREDIT DEBUG] generationId: ${generationId}`);
    console.log(`💳 [CREDIT DEBUG] totalGenerations: ${totalGenerations}`);
    console.log(`💳 [NEW SYSTEM] Kredi işlemleri completion'da yapılacak`);

    // ✅ Eski kredi logic'i tamamen devre dışı - pay-on-success sistemi kullanılıyor
    if (false) {
      // shouldDeductCredit logic disabled
      // Toplam generation sayısına göre kredi hesapla
      const totalCreditCost = CREDIT_COST * totalGenerations;
      console.log(
        `💳 [CREDIT DEBUG] totalCreditCost: ${totalCreditCost} (${CREDIT_COST} x ${totalGenerations})`
      );

      try {
        console.log(`💳 Kullanıcı ${userId} için kredi kontrolü yapılıyor...`);
        console.log(
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
        console.log(
          `✅ ${totalCreditCost} kredi başarıyla düşüldü (${totalGenerations} generation). Yeni bakiye: ${
            currentCreditCheck - totalCreditCost
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
    console.log("📤 Reference images Supabase'e upload ediliyor...");
    const referenceImageUrls = await uploadReferenceImagesToSupabase(
      referenceImages,
      userId
    );

    // 🆔 Generation ID oluştur (eğer client'ten gelmediyse)
    finalGenerationId = generationId || uuidv4();

    // 📝 Pending generation oluştur (işlem başlamadan önce)
    console.log(`📝 Pending generation oluşturuluyor: ${finalGenerationId}`);
    console.log(
      `🔍 [DEBUG] Generation ID uzunluğu: ${finalGenerationId?.length}`
    );
    console.log(`🔍 [DEBUG] Generation ID tipi: ${typeof finalGenerationId}`);

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

          console.log(
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

    console.log("🎛️ [BACKEND] Gelen settings parametresi:", settings);
    console.log("🏞️ [BACKEND] Settings içindeki location:", settings?.location);
    console.log(
      "🏞️ [BACKEND] Settings içindeki locationEnhancedPrompt:",
      settings?.locationEnhancedPrompt
    );
    console.log("📝 [BACKEND] Gelen promptText:", promptText);
    console.log("🏞️ [BACKEND] Gelen locationImage:", locationImage);
    console.log("🤸 [BACKEND] Gelen poseImage:", poseImage);
    console.log("💇 [BACKEND] Gelen hairStyleImage:", hairStyleImage);

    let finalImage;

    // Çoklu resim varsa her birini ayrı ayrı upload et, canvas birleştirme yapma
    if (isMultipleImages && referenceImages.length > 1) {
      // Back side analysis için özel upload işlemi
      if (req.body.isBackSideAnalysis) {
        console.log(
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
          console.log(
            `📤 [BACK_SIDE] Resim ${i + 1} upload edildi:`,
            uploadedUrl
          );
        }

        // URL'leri referenceImages array'ine geri koy
        for (let i = 0; i < uploadedUrls.length; i++) {
          referenceImages[i] = { ...referenceImages[i], uri: uploadedUrls[i] };
        }

        console.log("✅ [BACK_SIDE] Tüm resimler Supabase'e upload edildi");

        // Canvas birleştirme bypass et - direkt URL'leri kullan
        finalImage = null; // Canvas'a gerek yok
      } else {
        console.log(
          "🖼️ [BACKEND] Çoklu resim modu - Her resim ayrı ayrı upload ediliyor..."
        );

        // Kombin modu kontrolü
        const isKombinMode = req.body.isKombinMode || false;
        console.log("🛍️ [BACKEND] Kombin modu kontrolü:", isKombinMode);

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
          console.log(
            `📤 [BACKEND] Resim ${i + 1} upload edildi:`,
            uploadedUrl
          );
        }

        // URL'leri referenceImages array'ine geri koy
        for (let i = 0; i < uploadedUrls.length; i++) {
          referenceImages[i] = { ...referenceImages[i], uri: uploadedUrls[i] };
        }

        console.log("✅ [BACKEND] Tüm resimler ayrı ayrı upload edildi");

        // Canvas birleştirme yapma - direkt ayrı resimleri kullan
        finalImage = null; // Canvas'a gerek yok

        // Kombin modunda MUTLAKA isMultipleProducts'ı true yap ki Gemini doğru prompt oluştursun
        if (isKombinMode) {
          console.log(
            "🛍️ [BACKEND] Kombin modu için isMultipleProducts değeri:",
            `${originalIsMultipleProducts} → true`
          );
          // Bu değişkeni lokal olarak override et
          isMultipleProducts = true;
        }
      } // Back side analysis else bloğu kapatma
    } else {
      // Tek resim için Supabase URL'sini doğrudan kullanmak üzere hazırlık yap
      console.log(
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

      console.log("Referans görseli:", referenceImage.uri);

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

    console.log("Supabase'den alınan final resim URL'si:", finalImage);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // 🚀 Paralel işlemler başlat
    console.log(
      "🚀 Paralel işlemler başlatılıyor: Gemini + Arkaplan silme + ControlNet hazırlığı..."
    );

    let enhancedPrompt, backgroundRemovedImage;

    if (isColorChange || isPoseChange || isRefinerMode) {
      // 🎨 COLOR CHANGE MODE, 🕺 POSE CHANGE MODE veya 🔧 REFINER MODE - Özel prompt'lar
      if (isColorChange) {
        console.log(
          "🎨 Color change mode: Basit renk değiştirme prompt'u oluşturuluyor"
        );
        enhancedPrompt = `Change the main color of the product/item in this image to ${targetColor}. Keep all design details, patterns, textures, and shapes exactly the same. Only change the primary color to ${targetColor}. The result should be photorealistic with natural lighting.`;
      } else if (isRefinerMode) {
        console.log(
          "🔧 Refiner mode: Profesyonel e-ticaret fotoğraf refiner prompt'u oluşturuluyor"
        );

        // Refiner modu için Gemini ile gelişmiş prompt oluştur
        console.log(
          "🤖 [GEMINI CALL - REFINER] enhancePromptWithGemini parametreleri:"
        );
        console.log("🤖 [GEMINI CALL - REFINER] - finalImage URL:", finalImage);
        console.log(
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
        console.log(
          "🕺 Pose change mode: Gemini ile poz değiştirme prompt'u oluşturuluyor"
        );

        // Poz değiştirme modunda Gemini ile prompt oluştur
        console.log(
          "🤖 [GEMINI CALL - POSE] enhancePromptWithGemini parametreleri:"
        );
        console.log("🤖 [GEMINI CALL - POSE] - finalImage URL:", finalImage);
        console.log(
          "🤖 [GEMINI CALL - POSE] - isMultipleProducts:",
          isMultipleProducts
        );
        console.log(
          "🤖 [GEMINI CALL - POSE] - referenceImages sayısı:",
          referenceImages?.length || 0
        );

        // EditScreen modunda editPrompt'u, normal modda promptText'i kullan
        const promptToUse =
          isEditMode && editPrompt && editPrompt.trim()
            ? editPrompt.trim()
            : promptText;

        console.log(
          "📝 [GEMINI CALL - POSE] Kullanılacak prompt:",
          isEditMode ? "editPrompt" : "promptText"
        );
        console.log("📝 [GEMINI CALL - POSE] Prompt içeriği:", promptToUse);

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

        console.log(
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
      console.log(
        isColorChange ? "🎨 Color change prompt:" : "🕺 Pose change prompt:",
        enhancedPrompt
      );
    } else if (!isPoseChange) {
      // 🖼️ NORMAL MODE - Arkaplan silme işlemi (paralel)
      // Gemini prompt üretimini paralelde başlat
      console.log("🤖 [GEMINI CALL] enhancePromptWithGemini parametreleri:");
      console.log("🤖 [GEMINI CALL] - finalImage URL:", finalImage);
      console.log("🤖 [GEMINI CALL] - isMultipleProducts:", isMultipleProducts);
      console.log(
        "🤖 [GEMINI CALL] - referenceImages sayısı:",
        referenceImages?.length || 0
      );

      // EditScreen modunda editPrompt'u, normal modda promptText'i kullan
      const promptToUse =
        isEditMode && editPrompt && editPrompt.trim()
          ? editPrompt.trim()
          : promptText;

      console.log(
        "📝 [GEMINI CALL] Kullanılacak prompt:",
        isEditMode ? "editPrompt" : "promptText"
      );
      console.log("📝 [GEMINI CALL] Prompt içeriği:", promptToUse);

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
      console.log("⏳ Gemini prompt iyileştirme bekleniyor...");
      enhancedPrompt = await geminiPromise;
    }

    console.log("✅ Gemini prompt iyileştirme tamamlandı");

    // Arkaplan silme kaldırıldı - direkt olarak finalImage kullanılacak
    backgroundRemovedImage = finalImage;

    // 🎨 Yerel ControlNet Canny çıkarma işlemi - Arkaplan silindikten sonra
    // console.log("🎨 Yerel ControlNet Canny çıkarılıyor (Sharp ile)...");
    let cannyImage = null;
    // try {
    //   cannyImage = await generateLocalControlNetCanny(
    //     backgroundRemovedImage,
    //     userId
    //   );
    //   console.log("✅ Yerel ControlNet Canny tamamlandı:", cannyImage);
    // } catch (controlNetError) {
    //   console.error(
    //     "❌ Yerel ControlNet Canny hatası:",
    //     controlNetError.message
    //   );
    //   console.log(
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
      console.log(
        "🖼️ [BACKEND] Çoklu resim modu: Ayrı resimler Gemini'ye gönderilecek"
      );
    } else {
      // Tek resim modunda arkaplan kaldırılmış resmi kullan
      // Back side analysis durumunda canvas kullanmıyoruz
      if (!req.body.isBackSideAnalysis) {
        combinedImageForReplicate = backgroundRemovedImage;
        console.log(
          "🖼️ [BACKEND] Tek resim modu: Arkaplan kaldırılmış resim Gemini'ye gönderiliyor"
        );
      } else {
        combinedImageForReplicate = null; // Back side'da kullanılmıyor
        console.log(
          "🔄 [BACK_SIDE] Canvas bypass edildi, direkt URL'ler kullanılacak"
        );
      }
    }
    // if (cannyImage) {
    //   try {
    //     console.log(
    //       "🎨 Orijinal ve Canny resimleri birleştiriliyor (Replicate için)..."
    //     );
    //     combinedImageForReplicate = await combineTwoImagesWithBlackLine(
    //       backgroundRemovedImage,
    //       cannyImage,
    //       userId
    //     );
    //     console.log(
    //       "✅ İki resim birleştirme tamamlandı:",
    //       combinedImageForReplicate
    //     );
    //   } catch (combineError) {
    //     console.error("❌ Resim birleştirme hatası:", combineError.message);
    //     console.log(
    //       "⚠️ Birleştirme hatası nedeniyle sadece arkaplanı silinmiş resim kullanılacak"
    //     );
    //     combinedImageForReplicate = backgroundRemovedImage;
    //   }
    // } else {
    //   console.log(
    //     "⚠️ ControlNet Canny mevcut değil, sadece arkaplanı silinmiş resim kullanılacak"
    //   );
    // }

    console.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    console.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // Replicate google/nano-banana modeli ile istek gönder
    let replicateResponse;
    const maxRetries = 3;
    let totalRetryAttempts = 0;
    let retryReasons = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🔄 Replicate google/nano-banana API attempt ${attempt}/${maxRetries}`
        );

        console.log("🚀 Replicate google/nano-banana API çağrısı yapılıyor...");

        // Replicate API için request body hazırla
        let imageInputArray;

        // Back side analysis: 2 ayrı resim gönder
        if (
          req.body.isBackSideAnalysis &&
          referenceImages &&
          referenceImages.length >= 2
        ) {
          console.log(
            "🔄 [BACK_SIDE] 2 ayrı resim Nano Banana'ya gönderiliyor..."
          );
          imageInputArray = [
            referenceImages[0].uri || referenceImages[0], // Ön resim - direkt string
            referenceImages[1].uri || referenceImages[1], // Arka resim - direkt string
          ];
          console.log("📤 [BACK_SIDE] Image input array:", imageInputArray);
        } else if (
          (isMultipleImages && referenceImages.length > 1) ||
          (modelReferenceImage &&
            (referenceImages.length > 0 || combinedImageForReplicate))
        ) {
          const totalRefs =
            referenceImages.length + (modelReferenceImage ? 1 : 0);
          console.log(
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
          console.log(
            "📤 [MULTIPLE] Sıralı image input array:",
            sortedImages.map((img, idx) => `${idx + 1}. ${img.type}`)
          );
          console.log("📤 [MULTIPLE] Image URLs:", imageInputArray);
        } else {
          // Tek resim modu: Birleştirilmiş tek resim
          imageInputArray = [combinedImageForReplicate];
        }

        let requestBody;
        const aspectRatioForRequest = formattedRatio || "9:16";

        if (isPoseChange) {
          // POSE CHANGE MODE - Farklı input parametreleri
          requestBody = {
            input: {
              prompt: enhancedPrompt, // Gemini'den gelen pose change prompt'u
              image_input: imageInputArray,
              output_format: "png",
              aspect_ratio: aspectRatioForRequest,
              // Pose change için optimize edilmiş parametreler (hız için)
              guidance_scale: 7.5, // Normal ile aynı (hız için)
              num_inference_steps: 20, // Normal ile aynı (hız için)
            },
          };
          console.log("🕺 [POSE_CHANGE] Nano Banana request body hazırlandı");
          console.log(
            "🕺 [POSE_CHANGE] Prompt:",
            enhancedPrompt.substring(0, 200) + "..."
          );
        } else {
          // NORMAL MODE - Orijinal parametreler
          requestBody = {
            input: {
              prompt: enhancedPrompt,
              image_input: imageInputArray,
              output_format: "png",
              aspect_ratio: aspectRatioForRequest,
            },
          };
        }

        console.log("📋 Replicate Request Body:", {
          prompt: enhancedPrompt.substring(0, 100) + "...",
          imageInput: req.body.isBackSideAnalysis
            ? "2 separate images"
            : isMultipleImages && referenceImages.length > 1
            ? `${referenceImages.length} separate images`
            : "single combined image",
          imageInputArray: imageInputArray,
          outputFormat: "jpg",
          aspectRatio: aspectRatioForRequest,
        });

        // Replicate API çağrısı - Prefer: wait header ile
        const response = await axios.post(
          "https://api.replicate.com/v1/models/google/nano-banana/predictions",
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
              "Content-Type": "application/json",
              Prefer: "wait", // Synchronous response için
            },
            timeout: 120000, // 2 dakika timeout
          }
        );

        console.log("📋 Replicate API Response Status:", response.status);
        console.log("📋 Replicate API Response Data:", {
          id: response.data.id,
          status: response.data.status,
          hasOutput: !!response.data.output,
          error: response.data.error,
        });

        // Response kontrolü
        if (response.data.status === "succeeded" && response.data.output) {
          console.log(
            "✅ Replicate API başarılı, output alındı:",
            response.data.output
          );

          // Replicate response'u formatla
          replicateResponse = {
            data: {
              id: response.data.id,
              status: "succeeded",
              output: response.data.output,
              urls: {
                get: response.data.urls?.get || null,
              },
            },
          };

          console.log(
            `✅ Replicate google/nano-banana API başarılı (attempt ${attempt})`
          );
          break; // Başarılı olursa loop'tan çık
        } else if (
          response.data.status === "processing" ||
          response.data.status === "starting"
        ) {
          console.log(
            "⏳ Replicate API hala işlem yapıyor, polling başlatılacak:",
            response.data.status
          );

          // Processing durumunda response'u formatla ve polling'e geç
          replicateResponse = {
            data: {
              id: response.data.id,
              status: response.data.status,
              output: response.data.output,
              urls: {
                get: response.data.urls?.get || null,
              },
            },
          };

          console.log(
            `⏳ Replicate google/nano-banana API processing (attempt ${attempt}) - polling gerekecek`
          );
          break; // Processing durumunda da loop'tan çık ve polling'e geç
        } else if (response.data.status === "failed") {
          console.error("❌ Replicate API failed:", response.data.error);

          // E9243, E004 ve benzeri geçici hatalar için retry yap
          if (
            response.data.error &&
            typeof response.data.error === "string" &&
            (response.data.error.includes("E9243") ||
              response.data.error.includes("E004") ||
              response.data.error.includes(
                "unexpected error handling prediction"
              ) ||
              response.data.error.includes("Director: unexpected error") ||
              response.data.error.includes(
                "Service is temporarily unavailable"
              ) ||
              response.data.error.includes("Please try again later") ||
              response.data.error.includes("Prediction failed.") ||
              response.data.error.includes(
                "Prediction interrupted; please retry (code: PA)"
              ))
          ) {
            console.log(
              `🔄 Geçici nano-banana hatası tespit edildi (attempt ${attempt}), retry yapılacak:`,
              response.data.error
            );
            retryReasons.push(`Attempt ${attempt}: ${response.data.error}`);
            throw new Error(
              `RETRYABLE_NANO_BANANA_ERROR: ${response.data.error}`
            );
          }

          throw new Error(
            `Replicate API failed: ${response.data.error || "Unknown error"}`
          );
        } else {
          console.error(
            "❌ Replicate API unexpected status:",
            response.data.status
          );
          throw new Error(`Unexpected status: ${response.data.status}`);
        }
      } catch (apiError) {
        console.error(
          `❌ Replicate google/nano-banana API attempt ${attempt} failed:`,
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
            apiError.message.includes("RETRYABLE_NANO_BANANA_ERROR"))
        ) {
          totalRetryAttempts++;
          const waitTime = attempt * 2000; // 2s, 4s, 6s bekle
          console.log(
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
    console.log("Replicate API başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error("Replicate prediction ID alınamadı:", initialResult);

      // 🗑️ Prediction ID hatası durumunda geçici dosyaları temizle
      console.log(
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

          console.log(
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

    // Replicate google/nano-banana API - Status kontrolü ve polling (retry mekanizmalı)
    const startTime = Date.now();
    let finalResult;
    let processingTime;
    const maxPollingRetries = 3; // Failed status'u için maksimum 3 retry

    // Status kontrolü
    if (initialResult.status === "succeeded") {
      // Direkt başarılı sonuç
      console.log(
        "🎯 Replicate google/nano-banana - başarılı sonuç, polling atlanıyor"
      );
      finalResult = initialResult;
      processingTime = Math.round((Date.now() - startTime) / 1000);
    } else if (
      initialResult.status === "processing" ||
      initialResult.status === "starting"
    ) {
      // Processing durumunda polling yap
      console.log(
        "⏳ Replicate google/nano-banana - processing status, polling başlatılıyor"
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
        console.log(
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
      console.log(
        "🎯 Replicate google/nano-banana - failed status, retry mekanizması başlatılıyor"
      );

      // Failed status için retry logic
      let retrySuccessful = false;
      for (
        let retryAttempt = 1;
        retryAttempt <= maxPollingRetries;
        retryAttempt++
      ) {
        console.log(
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
            console.log(
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
            console.log(
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
            input: {
              prompt: enhancedPrompt,
              image_input: retryImageInputArray,
              output_format: "jpg",
            },
          };

          console.log(
            `🔄 Retry ${retryAttempt}: Yeni prediction oluşturuluyor...`
          );

          const retryResponse = await axios.post(
            "https://api.replicate.com/v1/models/google/nano-banana/predictions",
            retryRequestBody,
            {
              headers: {
                Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
                "Content-Type": "application/json",
                Prefer: "wait",
              },
              timeout: 120000,
            }
          );

          console.log(`🔄 Retry ${retryAttempt} Response:`, {
            id: retryResponse.data.id,
            status: retryResponse.data.status,
            hasOutput: !!retryResponse.data.output,
            error: retryResponse.data.error,
          });

          // Retry response kontrolü
          if (
            retryResponse.data.status === "succeeded" &&
            retryResponse.data.output
          ) {
            console.log(
              `✅ Retry ${retryAttempt} başarılı! Output alındı:`,
              retryResponse.data.output
            );
            finalResult = retryResponse.data;
            retrySuccessful = true;
            break;
          } else if (
            retryResponse.data.status === "processing" ||
            retryResponse.data.status === "starting"
          ) {
            console.log(
              `⏳ Retry ${retryAttempt} processing durumunda, polling başlatılıyor...`
            );

            try {
              finalResult = await pollReplicateResult(retryResponse.data.id);
              console.log(`✅ Retry ${retryAttempt} polling başarılı!`);
              retrySuccessful = true;
              break;
            } catch (retryPollingError) {
              console.error(
                `❌ Retry ${retryAttempt} polling hatası:`,
                retryPollingError.message
              );
              // Bu retry attempt başarısız, bir sonraki deneme yapılacak
            }
          } else {
            console.error(
              `❌ Retry ${retryAttempt} başarısız:`,
              retryResponse.data.error
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

    console.log("Replicate final result:", finalResult);

    // Flux-kontext-dev API'den gelen sonuç farklı format olabilir (Prefer: wait nedeniyle)
    const isFluxKontextDevResult =
      finalResult && !finalResult.status && finalResult.output;
    const isStandardResult =
      finalResult.status === "succeeded" && finalResult.output;

    // Dev API'ye fallback yapıldıktan sonra başarılı sonuç kontrolü
    if (isFluxKontextDevResult || isStandardResult) {
      console.log("Replicate API işlemi başarılı");

      // 📊 Retry istatistiklerini logla
      if (totalRetryAttempts > 0) {
        console.log(
          `📊 Retry İstatistikleri: ${totalRetryAttempts} retry yapıldı`
        );
        console.log(`📊 Retry Nedenleri: ${retryReasons.join(" | ")}`);
      } else {
        console.log("📊 Retry İstatistikleri: İlk denemede başarılı");
      }

      // ✅ Status'u completed'e güncelle
      await updateGenerationStatus(finalGenerationId, userId, "completed", {
        enhanced_prompt: enhancedPrompt,
        result_image_url: finalResult.output,
        replicate_prediction_id: initialResult.id,
        processing_time_seconds: processingTime,
      });

      // 💳 KREDI GÜNCELLEME SIRASI
      // Kredi düşümü updateGenerationStatus içinde tetikleniyor (pay-on-success).
      // Bu nedenle güncel krediyi, status güncellemesinden SONRA okumalıyız.
      let currentCredit = null;
      if (userId && userId !== "anonymous_user") {
        try {
          const { data: updatedUser } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          currentCredit = updatedUser?.credit_balance || 0;
          console.log(
            `💳 Güncel kredi balance (post-deduct): ${currentCredit}`
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
          imageUrl: finalResult.output,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
          replicateData: finalResult,
          currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
          generationId: finalGenerationId, // 🆔 Generation ID'yi response'a ekle
        },
      };

      // Not: saveGenerationToDatabase artık gerekli değil çünkü updateGenerationStatus ile güncelliyoruz

      // 🗑️ İşlem başarıyla tamamlandı, geçici dosyaları hemen temizle
      console.log("🧹 Başarılı işlem sonrası geçici dosyalar temizleniyor...");
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
      console.log(
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

          console.log(
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
    console.log("🧹 Hata durumunda geçici dosyalar temizleniyor...");
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

        console.log(
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
  garmentType = "jewelry"
) {
  try {
    console.log("💎 Gemini ile jewelry pose açıklaması oluşturuluyor...");
    console.log("💎 Pose title:", poseTitle);
    console.log("💎 Gender:", gender);
    console.log("💎 Garment type:", garmentType);

    // Gemini 2.0 Flash modeli - Yeni SDK
    const model = "gemini-2.5-flash-lite";

    // Gender mapping
    const modelGenderText =
      gender.toLowerCase() === "male" || gender.toLowerCase() === "man"
        ? "male model"
        : "female model";

    // Pose açıklaması için özel prompt - Jewelry odaklı
    const posePrompt = `
    JEWELRY POSE DESCRIPTION TASK:
    
    You are a professional jewelry photography director. Create a detailed, technical pose description for a ${modelGenderText} wearing ${garmentType}, inspired by popular jewelry photography campaigns.
    
    POSE TITLE: "${poseTitle}"
    
    REQUIREMENTS FOR JEWELRY PHOTOGRAPHY:
    - Generate ONLY a detailed pose description/instruction
    - Do NOT create image generation prompts or visual descriptions
    - Focus on body positioning, hand placement, stance, and posture that showcases jewelry effectively
    - Include specific technical directions for the model
    - Keep it professional and suitable for jewelry photography
    - Make it clear and actionable for a model to follow
    - Consider how the pose will showcase the jewelry piece effectively, naturally highlighting it based on where it is worn on the body
    - Use poses inspired by popular jewelry photography campaigns: elegant head tilts, gentle hand gestures, subtle shoulder turns, wrist-forward positions, and other poses that naturally highlight jewelry
    
    OUTPUT FORMAT:
    Provide only the pose instruction in a clear, professional manner. Start directly with the pose description without any introductory text.
    
    EXAMPLE OUTPUT STYLE FOR JEWELRY:
    "Stand with feet shoulder-width apart, weight shifted to the back leg. Tilt head elegantly to one side to showcase the jewelry piece, ensuring it is clearly visible. Place left hand gently in a natural position that highlights the jewelry, fingers curved naturally. Extend right arm down and slightly away from body. Keep shoulders relaxed and down. Maintain confident, elegant eye contact with camera, with a subtle smile that complements luxury jewelry presentation."
    
    Generate a similar detailed pose instruction for the given pose title "${poseTitle}" for a ${modelGenderText} wearing jewelry, inspired by popular jewelry photography campaigns.
    `;

    console.log("🤸 Gemini'ye gönderilen pose prompt:", posePrompt);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: posePrompt }];

    // Pose image'ını da Gemini'ye gönder (eğer varsa)
    if (poseImage) {
      try {
        console.log("🤸 Pose görseli Gemini'ye ekleniyor:", poseImage);

        const cleanPoseImageUrl = poseImage.split("?")[0];
        const poseImageResponse = await axios.get(cleanPoseImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000, // 30s'den 15s'ye düşürüldü
        });
        const poseImageBuffer = poseImageResponse.data;

        // Base64'e çevir
        const base64PoseImage = Buffer.from(poseImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64PoseImage,
          },
        });

        console.log("🤸 Pose görseli başarıyla Gemini'ye eklendi");
      } catch (poseImageError) {
        console.error(
          "🤸 Pose görseli eklenirken hata:",
          poseImageError.message
        );
      }
    }

    // Gemini'den cevap al
    const result = await genAI.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: parts,
        },
      ],
    });

    const poseDescription = result.text.trim();
    console.log("🤸 Gemini'nin ürettiği pose açıklaması:", poseDescription);

    const sanitizedDescription = sanitizePoseText(poseDescription);
    if (sanitizedDescription !== poseDescription) {
      console.log("🤸 Pose açıklaması temizlendi:", sanitizedDescription);
    }

    return sanitizedDescription;
  } catch (error) {
    console.error("🤸 Gemini pose açıklaması hatası:", error);
    // Fallback: Basit pose açıklaması
    return sanitizePoseText(
      `Professional ${gender.toLowerCase()} model pose: ${poseTitle}. Stand naturally with good posture, position body to showcase the jewelry piece effectively, inspired by popular jewelry photography campaigns. The pose should naturally highlight the jewelry piece based on where it is worn on the body.`
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
      garmentType = "jewelry",
    } = req.body;

    console.log("🤸 Pose açıklaması isteği alındı:");
    console.log("🤸 Pose title:", poseTitle);
    console.log("🤸 Gender:", gender);
    console.log("🤸 Garment type:", garmentType);
    console.log("🤸 Pose image:", poseImage ? "Mevcut" : "Yok");

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

    console.log("🤸 Pose açıklaması başarıyla oluşturuldu");

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
      console.log(
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
        console.log(
          `🔍 User ${userId.slice(0, 8)} has ${
            userGenerations.length
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
          console.log(
            `🧹 Cleaning ${
              expiredGenerations.length
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
      console.log(
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
      console.log(
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
        console.log(
          `✅ Timeout generation ${generationId} failed olarak güncellendi`
        );
      } catch (updateError) {
        console.error(
          `❌ Timeout generation ${generationId} güncelleme hatası:`,
          updateError
        );
      }
    }

    console.log(
      `✅ Generation durumu: ${finalStatus}${
        shouldUpdateStatus ? " (timeout nedeniyle güncellendi)" : ""
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
router.get("/pending-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    console.log(`🔍 Pending generations sorgusu: ${userId}`);

    // Pending ve processing durumundaki generation'ları getir
    const { data: generations, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("user_id", userId)
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

    console.log(
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
          console.log(
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
            console.log(
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

      console.log(
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
router.get("/user-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query; // Opsiyonel: belirli statusleri filtrelemek için

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    console.log(
      `🔍 User generations sorgusu: ${userId}${
        status ? ` (status: ${status})` : ""
      }`
    );

    // 🕐 Her zaman son 1 saatlik data'yı döndür
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const oneHourAgoISO = oneHourAgo.toISOString();

    console.log(
      `🕐 [API_FILTER] Son 1 saatlik data döndürülüyor: ${oneHourAgoISO} sonrası`
    );

    let query = supabase
      .from("reference_results")
      .select("*")
      .eq("user_id", userId)
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

    console.log(
      `✅ ${generations?.length || 0} generation bulundu (${
        status || "all statuses"
      })`
    );

    // Debug: Generation'ları logla
    if (generations && generations.length > 0) {
      console.log(`🔍 [DEBUG] ${generations.length} generation bulundu:`);
      generations.forEach((gen, index) => {
        console.log(
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

    console.log(
      `🔍 [REFERENCE_IMAGES_ROUTE] Generation ${generationId.slice(
        0,
        8
      )}... için reference images sorgusu (User: ${userId.slice(0, 8)}...)`
    );
    console.log(`📋 [REFERENCE_IMAGES_ROUTE] Request details:`, {
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
      console.log(
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
    console.log(
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
