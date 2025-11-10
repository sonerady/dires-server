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
  isMultipleProducts = false,
  isColorChange = false,
  targetColor = null,
  isEditMode = false,
  editPrompt = null,
  isRefinerMode = false,
  referenceImages = null
) {
  try {
    console.log(
      "💎 Gemini 2.5 Flash ile jewelry prompt iyileştirme başlatılıyor"
    );

    const model = "gemini-2.5-flash";
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([k, v]) => v !== null && v !== undefined && v !== ""
      );

    console.log("🎛️ Jewelry Settings kontrolü:", hasValidSettings);

    // Jewelry için genel güvenli yönergeler
    const jewelryDirectives = `
JEWELRY RETOUCHING & PHOTOGRAPHY STANDARDS (MANDATORY):
- Always describe the item as a jewelry product (ring, earring, necklace, bracelet, watch, etc.)
- If multiple items are shown, treat them as a coordinated high-end jewelry collection.
- Remove all imperfections such as dust, scratches, fingerprints, or smudges.
- Polish gemstones and metal surfaces to a flawless, mirror-like brilliance.
- Maintain true-to-life color accuracy and realistic reflections.
- Ensure sharp focus on the main jewelry piece; background slightly softened for depth.
- Lighting must simulate luxury macro studio photography — bright, soft, diffused light with professional highlights and controlled shadows.
- Avoid artificial glow, exaggerated shine, or over-saturation.
- The result must look like a real professional jewelry catalog photo for luxury retail or e-commerce.
- Maintain natural reflections, realistic shadow fall, and perfect symmetry alignment.
- Never include models, hands, mannequins, or body parts unless explicitly shown in the reference image.
- Focus only on the jewelry itself — clarity, brilliance, detail, precision.
`;

    // Refiner Mode (E-commerce macro retouch)
    let promptForGemini;
    if (isRefinerMode) {
      promptForGemini = `
Transform this amateur jewelry product photo into a professional, high-end e-commerce jewelry image. Use the following structure:

Background:
- Replace with seamless pure white (#FFFFFF) or neutral studio gradient background.
- No texture, no props, no distractions.

Lighting:
- Studio-grade macro lighting setup.
- Bright, even illumination; soft shadows under the jewelry for depth.
- Subtle reflection on the base to add realism.
- No overexposure or dark shadows.

Presentation:
- Perfectly centered jewelry with balanced symmetry.
- Clean alignment of gemstones, chains, or metallic parts.
- Natural reflections and subtle highlights.

Detail Enhancement:
- Sharpen all gemstone facets and metal edges precisely.
- Polish surfaces to eliminate fingerprints or dust.
- Ensure prongs, mounts, engravings, and cuts are crisp.

Color & Material Accuracy:
- Maintain true metallic hues (gold, silver, platinum, rose gold).
- Gemstones must show natural color dispersion and brilliance.
- Avoid hue shifts or artificial glow.

Final Output:
- The result must be a single, ultra-realistic, flawless jewelry product image suitable for luxury e-commerce platforms.
- Perfect focus, perfect symmetry, studio-level clarity.
${jewelryDirectives}
`;
    } else if (isColorChange && targetColor && targetColor !== "original") {
      promptForGemini = `
Change ONLY the jewelry's primary metal or gemstone color to ${targetColor}, keeping every other detail identical.
Do not modify shape, design, reflections, or materials except for this color adjustment.
Maintain realistic reflections, metal texture, gemstone sparkle, and surface microdetails.
Keep lighting, composition, and background exactly as in the original image.
Ensure the result looks like a high-end studio photo, not edited.
${jewelryDirectives}
`;
    } else if (isEditMode && editPrompt && editPrompt.trim()) {
      promptForGemini = `
Edit Instruction: ${editPrompt.trim()}.

Generate a focused, professional English prompt that starts with "Retouch" or "Replace" and clearly describes only the requested change.
Keep all jewelry details identical — same reflections, metals, gemstones, background.
Maintain realistic studio lighting and sharpness.
Example edits:
- "Retouch the jewelry photo to remove dust and increase gemstone sparkle."
- "Replace the gemstone color with sapphire blue while keeping reflections natural."
- "Retouch the background to pure white while preserving all jewelry details."
${jewelryDirectives}
`;
    } else {
      // Default Jewelry Prompt
      promptForGemini = `
Retouch the jewelry photo to look like a professional high-end studio shot suitable for luxury catalogs and e-commerce.
You must automatically detect the jewelry type (ring, earring, bracelet, necklace, watch, etc.) and adapt lighting, angle, and retouching accordingly.

Main Requirements:
1. Clarity & Focus:
   - Macro-level sharpness on gemstones, metal edges, and texture.
   - Every engraving, cut, or reflection must be crisp and visible.

2. Lighting:
   - Studio lighting: soft, even illumination from multiple angles.
   - Gentle highlight reflections along metal surfaces.
   - Controlled shadows under jewelry for depth and realism.

3. Material & Surface:
   - Polish metal (gold, silver, platinum) surfaces to flawless sheen.
   - Remove all dust, fingerprints, and scratches.
   - Enhance gemstone clarity, brilliance, and fire.
   - Preserve natural imperfections that convey realism — avoid CGI look.

4. Composition:
   - Center the jewelry with balanced symmetry.
   - Maintain elegant minimal background (pure white, light gradient, or reflective surface).
   - Avoid any text, props, or branding.

5. Color & Tone:
   - Keep true color balance.
   - Maintain gemstone hue accuracy.
   - Avoid over-saturation or over-brightness.

6. Final Presentation:
   - Single ultra-realistic jewelry image only (no collage or multiple frames).
   - Ready for catalog or e-commerce listing.
   - Photorealistic finish, soft vignette, commercial polish.

${
  isMultipleProducts
    ? "If multiple jewelry items are visible, treat them as part of a cohesive collection — balance their positioning and lighting uniformly."
    : ""
}

${
  hasValidSettings
    ? `User provided settings: ${Object.entries(settings)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")}`
    : ""
}

${jewelryDirectives}
`;
    }

    console.log("💎 Gemini'ye gönderilen jewelry prompt:", promptForGemini);

    // Görseli base64'e çevir ve Gemini'ye gönder
    const parts = [{ text: promptForGemini }];

    try {
      console.log(`📸 Görsel Gemini'ye gönderiliyor: ${imageUrl}`);
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
    } catch (e) {
      console.error("📸 Görsel yüklenemedi:", e.message);
    }

    // Multi-image mode
    if (referenceImages && referenceImages.length > 1) {
      console.log(`💍 Multiple reference images: ${referenceImages.length}`);
      for (const ref of referenceImages) {
        try {
          const url = ref.uri || ref;
          const resp = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          const buf = resp.data;
          const base64 = Buffer.from(buf).toString("base64");
          parts.push({
            inlineData: { mimeType: "image/jpeg", data: base64 },
          });
        } catch (err) {
          console.error("💍 Multi image load error:", err.message);
        }
      }
    }

    // Gemini API çağrısı
    const maxRetries = 2;
    let enhancedPrompt = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`✨ Gemini çağrısı: Attempt ${attempt}/${maxRetries}`);
        const result = await genAI.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
        });

        const text =
          result.text?.trim() || result.response?.text()?.trim() || "";
        if (!text) throw new Error("Empty Gemini response");

        enhancedPrompt = text + jewelryDirectives;
        console.log("💍 Gemini jewelry prompt üretildi:", text);
        break;
      } catch (err) {
        console.error(`Gemini hata (attempt ${attempt}):`, err.message);
        if (attempt === maxRetries) {
          console.log(
            "⚠️ Gemini başarısız, fallback jewelry prompt kullanılıyor"
          );
          enhancedPrompt = `
Retouch the jewelry photo to look like a professional high-end studio shot.
Bright, even lighting; pure white background; flawless polishing.
Gemstones clear and brilliant; metals reflective with perfect symmetry.
No dust, no scratches, no blur. Photorealistic result ready for catalog use.
${jewelryDirectives}`;
        }
        await new Promise((r) =>
          setTimeout(r, Math.pow(2, attempt - 1) * 1000)
        );
      }
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("💎 Jewelry prompt iyileştirme hatası:", error);
    return `
Retouch the jewelry photo to look like a professional studio photograph with flawless lighting, perfect clarity, and high-end catalog quality.
${jewelryDirectives}`;
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
  garmentType = "clothing"
) {
  try {
    console.log("🤸 Gemini ile pose açıklaması oluşturuluyor...");
    console.log("🤸 Pose title:", poseTitle);
    console.log("🤸 Gender:", gender);
    console.log("🤸 Garment type:", garmentType);

    // Gemini 2.0 Flash modeli - Yeni SDK
    const model = "gemini-2.5-flash";

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
