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
        .jpeg({ quality: 95 })
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
            .png({ quality: 95 })
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
  isMultipleProducts = false,
  generationId = null // Yeni parametre
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
          generation_id: generationId, // Yeni alan
          status: "completed", // İşlem tamamlandığında completed olarak kaydediliyor
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
    const CREDIT_COST = 15; // Her oluşturma 15 kredi

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

    // Krediyi düş
    const { error: updateError } = await supabase
      .from("users")
      .update({ credit_balance: currentCredit - totalCreditCost })
      .eq("id", userId)
      .eq("credit_balance", currentCredit); // Optimistic locking

    if (updateError) {
      console.error(`❌ Kredi düşme hatası:`, updateError);
      return false;
    }

    console.log(
      `✅ ${totalCreditCost} kredi başarıyla düşüldü. Yeni bakiye: ${
        currentCredit - totalCreditCost
      }`
    );

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

    const updateData = {
      status: status,
      updated_at: new Date().toISOString(),
      ...updates,
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
  editPrompt = null // EditScreen'den gelen prompt
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

    // Gemini 2.0 Flash modeli - Yeni SDK
    const model = "gemini-2.5-flash";

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
          ? `\n    \n    SPECIAL LOCATION DESCRIPTION:\n    User has provided a detailed location description: "${settings.locationEnhancedPrompt}"\n    IMPORTANT: Use this exact location description for the environment/background setting instead of a generic location name.`
          : ""
      }
    
    IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.`;
    }

    // Pose ve perspective için akıllı öneri sistemi
    let posePromptSection = "";
    let perspectivePromptSection = "";

    // Pose handling - enhanced with detailed descriptions
    if (!settings?.pose && !poseImage) {
      const garmentText = isMultipleProducts
        ? "multiple garments/products ensemble"
        : "garment/product";
      posePromptSection = `
    
    INTELLIGENT POSE SELECTION: Since no specific pose was selected by the user, please analyze the ${garmentText} in the reference image and intelligently select the MOST APPROPRIATE pose for the ${baseModelText} that will:
    - Best showcase ${
      isMultipleProducts
        ? "all products in the ensemble and their coordination"
        : "the garment's design, cut, and construction details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how the products work together and each product's unique selling points"
        : "the product's unique features and selling points"
    }
    - Demonstrate how ${
      isMultipleProducts
        ? "the fabrics of different products drape and interact naturally"
        : "the fabric drapes and moves naturally"
    }
    - Show ${
      isMultipleProducts
        ? "how all products fit together and create an appealing silhouette"
        : "the garment's fit and silhouette most effectively"
    }
    - Match the style and aesthetic of ${
      isMultipleProducts
        ? "the coordinated ensemble (formal, casual, sporty, elegant, etc.)"
        : "the garment (formal, casual, sporty, elegant, etc.)"
    }
    - Allow clear visibility of important design elements ${
      isMultipleProducts
        ? "across all products"
        : "like necklines, sleeves, hems, and patterns"
    }
    - Create an appealing and natural presentation that would be suitable for commercial photography
    ${
      isMultipleProducts
        ? "- Ensure each product in the ensemble is visible and well-positioned\n    - Demonstrate the styling versatility of combining these products"
        : ""
    }`;

      console.log(
        `🤸 [GEMINI] Akıllı poz seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun poz önerilecek`
      );
    } else if (poseImage) {
      posePromptSection = `
    
    POSE REFERENCE: A pose reference image has been provided to show the desired body position and posture for the ${baseModelText}. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${baseModelText} should adopt this specific pose naturally and convincingly${
        isMultipleProducts
          ? ", ensuring all products in the ensemble remain clearly visible and well-positioned"
          : ""
      }.`;

      console.log("🤸 [GEMINI] Pose prompt section eklendi");
    } else if (settings?.pose) {
      // Check if we have a detailed pose description (from our new Gemini pose system)
      let detailedPoseDescription = null;

      // Try to get detailed pose description from Gemini
      try {
        console.log(
          "🤸 [GEMINI] Pose için detaylı açıklama oluşturuluyor:",
          settings.pose
        );
        detailedPoseDescription = await generatePoseDescriptionWithGemini(
          settings.pose,
          poseImage,
          settings.gender || "female",
          "clothing"
        );
        console.log(
          "🤸 [GEMINI] Detaylı pose açıklaması alındı:",
          detailedPoseDescription
        );
      } catch (poseDescError) {
        console.error("🤸 [GEMINI] Pose açıklaması hatası:", poseDescError);
      }

      if (detailedPoseDescription) {
        posePromptSection = `
    
    DETAILED POSE INSTRUCTION: The user has selected the pose "${
      settings.pose
    }". Use this detailed pose instruction for the ${baseModelText}:
    
    "${detailedPoseDescription}"
    
    Ensure the ${baseModelText} follows this pose instruction precisely while maintaining natural movement and ensuring the pose complements ${
          isMultipleProducts
            ? "all products in the ensemble being showcased"
            : "the garment being showcased"
        }. The pose should enhance the presentation of the clothing and create an appealing commercial photography composition.`;

        console.log("🤸 [GEMINI] Detaylı pose açıklaması kullanılıyor");
      } else {
        // Fallback to simple pose mention
        posePromptSection = `
    
    SPECIFIC POSE REQUIREMENT: The user has selected a specific pose: "${
      settings.pose
    }". Please ensure the ${baseModelText} adopts this pose while maintaining natural movement and ensuring the pose complements ${
          isMultipleProducts
            ? "all products in the ensemble being showcased"
            : "the garment being showcased"
        }.`;

        console.log(
          "🤸 [GEMINI] Basit pose açıklaması kullanılıyor (fallback)"
        );
      }

      console.log(
        "🤸 [GEMINI] Kullanıcı tarafından seçilen poz:",
        settings.pose
      );
    }

    // Eğer perspective seçilmemişse, Gemini'ye kıyafete uygun perspektif önerisi yap
    if (!settings?.perspective) {
      const garmentText = isMultipleProducts
        ? "multiple products ensemble"
        : "garment/product";
      perspectivePromptSection = `
    
    INTELLIGENT CAMERA PERSPECTIVE SELECTION: Since no specific camera perspective was selected by the user, please analyze the ${garmentText} and intelligently choose the MOST APPROPRIATE camera angle and perspective that will:
    - Best capture ${
      isMultipleProducts
        ? "all products' most important design features and their coordination"
        : "the garment's most important design features"
    }
    - Show ${
      isMultipleProducts
        ? "the construction quality and craftsmanship details of each product"
        : "the product's construction quality and craftsmanship details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how all products fit together and the overall ensemble silhouette"
        : "the fit and silhouette most effectively"
    }
    - Create the most appealing and commercial-quality presentation ${
      isMultipleProducts ? "for the multi-product styling" : ""
    }
    - Match ${
      isMultipleProducts
        ? "the ensemble's style and intended market positioning"
        : "the garment's style and intended market positioning"
    }
    ${
      isMultipleProducts
        ? "- Ensure all products are visible and well-framed within the composition"
        : ""
    }`;

      console.log(
        `📸 [GEMINI] Akıllı perspektif seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun kamera açısı önerilecek`
      );
    } else {
      perspectivePromptSection = `
    
    SPECIFIC CAMERA PERSPECTIVE: The user has selected a specific camera perspective: "${
      settings.perspective
    }". Please ensure the photography follows this perspective while maintaining professional composition and optimal ${
        isMultipleProducts ? "multi-product ensemble" : "garment"
      } presentation.`;

      console.log(
        "📸 [GEMINI] Kullanıcı tarafından seçilen perspektif:",
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

    // Gemini'ye gönderilecek metin - güvenli flag-safe versiyon
    const criticalDirectives = `
    BRAND SAFETY: If the input image contains any brand names or logos (e.g., Nike, Adidas, Prada, Gucci, Louis Vuitton, Chanel, Balenciaga, Versace, Dior, Hermès), please refer to them generically (e.g., "brand label", "logo") without naming the specific brand.
    LENGTH CONSTRAINT: Please keep your entire output within 512 tokens maximum for optimal processing.`;

    // Flux Max için genel garment transform talimatları (güvenli flag-safe versiyon)
    const fluxMaxGarmentTransformationDirectives = `
    GARMENT TRANSFORMATION REQUIREMENTS:
    - Please ensure that all hangers, clips, tags, and flat-lay artifacts are completely removed from the input garment. Avoid rendering any mannequin remains or unintended background elements.
    - Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance.
    - Ensure realistic fabric physics with natural drape, weight, tension, compression, and subtle folds along shoulders, chest/bust, torso, and sleeves. Maintain a clean commercial presentation with minimal distracting wrinkles.
    - Preserve all original garment details including exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Avoid redesigning the original garment.
    - Integrate prints/patterns correctly over the 3D form ensuring patterns curve, stretch, and wrap naturally across body contours. Avoid flat, uniform, or unnaturally straight pattern lines.
    - For structured details such as knots, pleats, darts, and seams, render functional tension, deep creases, and realistic shadows consistent with real fabric behavior.
    - Maintain photorealistic integration with the model and scene including correct scale, perspective, lighting, cast shadows, and occlusions that match the camera angle and scene lighting.
    - Focus on transforming the garment onto the existing model and seamlessly integrating it into the outfit. Avoid introducing new background elements unless a location reference is explicitly provided.`;

    // Gemini'ye gönderilecek metin - Edit mode vs Color change vs Normal replace
    let promptForGemini;

    if (isEditMode && editPrompt && editPrompt.trim()) {
      // EDIT MODE - EditScreen'den gelen özel prompt
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.

      ${criticalDirectives}

      SILENT RULES (DO NOT OUTPUT THESE, JUST APPLY THEM): All rules, headings, examples, and meta-instructions you see in this message must be applied silently. Do not quote, restate, or paraphrase any rule text in your final output. Your final output MUST ONLY be the concise descriptive prompt for the image model, with no rule headings or capitalized instruction sentences.

      ${fluxMaxGarmentTransformationDirectives}

      USER'S EDIT REQUEST: "${editPrompt.trim()}"

      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      IMPORTANT: The user can send you input in different languages, but you must always generate your prompt in English.

      CRITICAL REQUIREMENTS FOR EDIT MODE:
      1. The prompt MUST begin with "Replace, change..."
      2. Understand the user's edit request regardless of what language they write in
      3. Always generate your response in English
      4. Apply the user's specific edit request accurately
      5. Maintain photorealistic quality with natural lighting
      6. Keep the general style and quality of the original image
      7. Ensure the modification is realistic and technically feasible
      8. If the edit involves clothing changes, maintain proper fit and styling
      9. If the edit involves pose changes, ensure natural body positioning
      10. If the edit involves color changes, preserve garment details and textures

      GEMINI TASK:
      1. Understand what modification the user wants
      2. Create a professional English prompt that applies this modification
      3. Ensure the modification is technically possible and realistic
      4. Maintain the overall quality and style of the original image
      5. Describe the change in detail while preserving other elements

      LANGUAGE REQUIREMENT: Always generate your prompt in English and START with "Replace, change...".

      ${originalPrompt ? `Additional context: ${originalPrompt}.` : ""}
      `;
    } else if (isColorChange && targetColor && targetColor !== "original") {
      // COLOR CHANGE MODE - Sadece renk değiştirme
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "change". Do not include any introduction, explanation, or commentary.

      ${criticalDirectives}

      Create a professional fashion photography prompt in English that STARTS with "change" for changing ONLY the color of the product/garment from the reference image to ${targetColor}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      CRITICAL REQUIREMENTS FOR COLOR CHANGE:
      1. The prompt MUST begin with "Replace the product/garment..."
      2. ONLY change the color to ${targetColor}
      3. Keep EVERYTHING else exactly the same: design, shape, patterns, details, style, fit, texture
      4. Do not modify the garment design, cut, or any other aspect except the color
      5. The final image should be photorealistic, showing the same garment but in ${targetColor} color
      6. Use natural studio lighting with a clean background
      7. Preserve ALL original garment details except color: patterns (but in new color), textures, hardware, stitching, logos, graphics, and construction elements
      8. The garment must appear identical to the reference image, just in ${targetColor} color instead of the original color

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "change".

      ${
        originalPrompt
          ? `Additional color change requirements: ${originalPrompt}.`
          : ""
      }
      `;
    } else if (isPoseChange) {
      // POSE CHANGE MODE - Sadece poz değiştirme
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "change". Do not include any introduction, explanation, or commentary.

      ${criticalDirectives}

      Create a professional fashion photography prompt in English that STARTS with "change" for changing ONLY the pose/position of the model in the reference image.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      CRITICAL REQUIREMENTS FOR POSE CHANGE:
      1. The prompt MUST begin with "Replace the model's pose..."
      2. Keep the EXACT same person, face, clothing, background, and all other elements
      3. ONLY change the pose/position/body positioning of the model
      4. Do not modify or change anything else about the model or scene
      5. The result should be photorealistic with natural lighting and proper body proportions
      6. Preserve ALL original elements except the pose: same person, same outfit, same background, same lighting style
      7. The model must appear identical to the reference image, just in a different pose/position

      ${
        customDetail && customDetail.trim()
          ? `USER SPECIFIC POSE: The user wants the pose to be: ${customDetail.trim()}.`
          : `AUTOMATIC POSE SELECTION: You MUST choose ONE specific pose for the model.`
      }

      GEMINI TASK - ANALYZE AND CREATE POSE:
      1. ANALYZE the model in the input image (their current pose, body position, clothing style)
      2. IDENTIFY the clothing details (pockets, sleeves, length, style, accessories)
      3. SELECT one specific professional modeling pose that would look elegant and natural for this person
      4. CHOOSE from these categories:
         - ELEGANT POSES: graceful hand positions, confident stances, sophisticated postures
         - FASHION POSES: runway-style poses, magazine-worthy positions, stylish attitudes  
         - PORTRAIT POSES: flattering face angles, expressive hand gestures, artistic positioning
         - DYNAMIC POSES: movement-inspired stances, walking poses, turning positions

      ⚠️ CRITICAL CLOTHING COMPATIBILITY RULES:
      - If the garment has NO POCKETS: DO NOT put hands in pockets
      - If the garment has SHORT SLEEVES: DO NOT fold or adjust long sleeves
      - If the garment is SLEEVELESS: DO NOT place hands on sleeves or adjust arm coverage
      - If the garment is a DRESS/SKIRT: Keep leg positioning appropriate for the garment length
      - If the garment has specific NECKLINE: DO NOT change how it sits on the body
      - If the garment has FIXED ACCESSORIES (belts, scarves): Keep them in original position
      - NEVER turn the model completely around (avoid full back views)
      - NEVER change the garment's silhouette, fit, or draping

      GEMINI INSTRUCTIONS:
      - First ANALYZE the clothing details and limitations
      - Then DECIDE on ONE specific pose that RESPECTS the clothing constraints
      - DESCRIBE that pose in detail in your prompt with clothing-appropriate positioning
      - Include specific details: hand positioning (compatible with garment), weight distribution, facial direction, body angles
      - Make the pose description sound professional and beautiful
      - Ensure the pose suits the model's style and clothing EXACTLY as shown

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace". Do NOT include any rule names, headings, or capitalized instruction phrases (e.g., "FLUX MAX CONTEXT", "CRITICAL REQUIREMENTS", "MANDATORY", "LANGUAGE REQUIREMENT").

      ${originalPrompt ? `Additional considerations: ${originalPrompt}.` : ""}
      
      REQUIRED FORMAT: "Replace the model's pose to [SPECIFIC POSE NAME] - [DETAILED DESCRIPTION of the exact pose with clothing-appropriate hand placement, body positioning, weight distribution, and facial direction, ensuring the garment maintains its original appearance, fit, and features while creating photorealistic and elegant results]..."
      
      FINAL REMINDER: The garment must look IDENTICAL to the reference image - same fit, same features, same details. Only the model's body position changes.
      `;
    } else {
      // NORMAL MODE - Standart garment replace
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.

      ${criticalDirectives}

      Create a professional fashion photography prompt in English that STARTS with "Replace" for replacing the garment from the reference image onto a ${modelGenderText}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      CRITICAL REQUIREMENTS:
      1. The prompt MUST begin with "Replace the flat-lay garment..."
      2. Keep the original garment exactly the same without changing any design, shape, colors, patterns, or details
      3. Do not modify or redesign the garment in any way
      4. The final image should be photorealistic, showing the same garment perfectly fitted on the ${baseModelText}
      5. Use natural studio lighting with a clean background
      6. Preserve ALL original garment details: colors, patterns, textures, hardware, stitching, logos, graphics, and construction elements
      7. The garment must appear identical to the reference image, just worn by the model instead of being flat

      PRODUCT DETAIL COVERAGE (MANDATORY): Describe the garment's construction details. Keep this within the 512-token limit; prioritize the most visually verifiable details.

      ${fluxMaxGarmentTransformationDirectives}

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".

      ${
        originalPrompt
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
      ${faceDescriptionSection}
      
      Generate a concise prompt focused on garment replacement while maintaining all original details. REMEMBER: Your response must START with "Replace". Apply all rules silently and do not include any rule text or headings in the output.
      
      EXAMPLE FORMAT: "Replace the flat-lay garment from the input image directly onto a standing [model description] while keeping the original garment exactly the same..."
      `;
    }

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, intelligently select the most suitable pose and camera angle for the ${baseModelText} that showcases the garment's design features, fit, and construction quality. Choose poses appropriate for the garment category with body language that complements the style and allows clear visibility of craftsmanship details. Select camera perspectives that create appealing commercial presentations highlighting the garment's key selling points.`;
      }
    }

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Referans görseli Gemini'ye gönder
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

        enhancedPrompt = geminiGeneratedPrompt;
        console.log(
          "🤖 [BACKEND GEMINI] Gemini'nin ürettiği prompt:",
          geminiGeneratedPrompt
        );
        console.log(
          "✨ [BACKEND GEMINI] Final enhanced prompt:",
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
          enhancedPrompt = originalPrompt;
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

      // Ana prompt oluştur - Fashion photography odaklı
      let fallbackPrompt = `Replace the flat-lay garment from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}. `;

      // Fashion photography ve kalite gereksinimleri
      fallbackPrompt += `This is for professional fashion photography and commercial garment presentation. Preserve the original garment exactly as is, without altering any design, shape, colors, patterns, or details. The photorealistic output must show the identical garment perfectly fitted on the dynamic model for high-end fashion shoots. `;

      // Kıyafet özellikleri (genel)
      fallbackPrompt += `The garment features high-quality fabric with proper texture, stitching, and construction details. `;

      // Temizlik gereksinimleri - güvenli versiyon
      fallbackPrompt += `Please ensure that all hangers, clips, tags, and flat-lay artifacts are completely removed. Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance. `;

      // Fizik gereksinimleri
      fallbackPrompt += `Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along shoulders, chest, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles. `;

      // Detay koruma - güvenli versiyon
      fallbackPrompt += `Preserve all original garment details including exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Avoid redesigning the original garment. `;

      // Pattern entegrasyonu
      fallbackPrompt += `Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines. `;

      // Final kalite - Fashion photography standartları
      fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional fashion photography aesthetic suitable for commercial and editorial use.`;

      console.log(
        "🔄 [FALLBACK] Generated detailed fallback prompt:",
        fallbackPrompt
      );

      enhancedPrompt = fallbackPrompt;
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

    // Ana prompt oluştur
    let fallbackPrompt = `Replace the flat-lay garment from the input image directly onto a ${modelDescription} model${poseDescription}${accessoriesDescription}${environmentDescription}${cameraDescription}${clothingDescription}. `;

    // Fashion photography ve kalite gereksinimleri
    fallbackPrompt += `This is for professional fashion photography and commercial garment presentation. Preserve the original garment exactly as is, without altering any design, shape, colors, patterns, or details. The photorealistic output must show the identical garment perfectly fitted on the dynamic model for high-end fashion shoots. `;

    // Kıyafet özellikleri (genel)
    fallbackPrompt += `The garment features high-quality fabric with proper texture, stitching, and construction details. `;

    // Temizlik gereksinimleri - güvenli versiyon
    fallbackPrompt += `Please ensure that all hangers, clips, tags, and flat-lay artifacts are completely removed. Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model while avoiding any 2D, sticker-like, or paper-like overlay appearance. `;

    // Fizik gereksinimleri
    fallbackPrompt += `Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along shoulders, chest, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles. `;

    // Detay koruma - güvenli versiyon
    fallbackPrompt += `Preserve all original garment details including exact colors, prints/patterns, material texture, stitching, construction elements, trims, and finishes. Avoid redesigning the original garment. `;

    // Pattern entegrasyonu
    fallbackPrompt += `Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines. `;

    // Final kalite - Fashion photography standartları
    fallbackPrompt += `Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting. High quality, sharp detail, professional fashion photography aesthetic suitable for commercial and editorial use.`;

    console.log(
      "🔄 [FALLBACK] Generated detailed fallback prompt:",
      fallbackPrompt
    );
    return fallbackPrompt;
  }
}

// Arkaplan silme fonksiyonu kaldırıldı - artık kullanılmıyor

// İşlenmiş resmi Supabase'e yükleyen fonksiyon
async function uploadProcessedImageToSupabase(imageUrl, userId, processType) {
  try {
    console.log(`📤 ${processType} resmi Supabase'e yükleniyor:`, imageUrl);

    // Resmi indir
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000, // 30 saniye timeout
    });
    const imageBuffer = Buffer.from(imageResponse.data);

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_${processType}_${
      userId || "anonymous"
    }_${randomId}.png`;

    console.log(`📤 Supabase'e yüklenecek ${processType} dosya adı:`, fileName);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error(`❌ ${processType} resmi Supabase'e yüklenemedi:`, error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    console.log(`✅ ${processType} resmi Supabase'e yüklendi:`, data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log(
      `📤 ${processType} resmi Supabase public URL:`,
      urlData.publicUrl
    );
    return urlData.publicUrl;
  } catch (error) {
    console.error(
      `❌ ${processType} resmi Supabase'e yüklenirken hata:`,
      error
    );
    throw error;
  }
}

// Buffer'dan direkt Supabase'e yükleme fonksiyonu (orientation düzeltmesi için)
async function uploadProcessedImageBufferToSupabase(
  imageBuffer,
  userId,
  processType
) {
  try {
    console.log(
      `📤 ${processType} buffer'ı Supabase'e yükleniyor (${imageBuffer.length} bytes)`
    );

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_${processType}_corrected_${
      userId || "anonymous"
    }_${randomId}.png`;

    console.log(`📤 Supabase'e yüklenecek ${processType} dosya adı:`, fileName);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error(
        `❌ ${processType} buffer'ı Supabase'e yüklenemedi:`,
        error
      );
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    console.log(`✅ ${processType} buffer'ı Supabase'e yüklendi:`, data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log(
      `📤 ${processType} resmi Supabase public URL:`,
      urlData.publicUrl
    );
    return urlData.publicUrl;
  } catch (error) {
    console.error(
      `❌ ${processType} buffer'ı Supabase'e yüklenirken hata:`,
      error
    );
    throw error;
  }
}

async function callReplicateNanoBananaFallback(
  enhancedPrompt,
  inputImageUrl,
  aspectRatio,
  userId
) {
  try {
    console.log(
      "🔄 Replicate google/nano-banana fallback API'ye geçiş yapılıyor..."
    );

    // Replicate API için request body hazırla
    const requestBody = {
      input: {
        prompt: enhancedPrompt,
        image_input: [
          inputImageUrl, // Direkt string olarak gönder
        ],
        output_format: "jpg",
      },
    };

    console.log("📋 Fallback Replicate Request Body:", {
      prompt: enhancedPrompt.substring(0, 100) + "...",
      imageInput: inputImageUrl,
      outputFormat: "jpg",
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
        timeout: 60000, // 1 dakika timeout (fallback için daha kısa)
      }
    );

    console.log("📋 Fallback Replicate API Response Status:", response.status);
    console.log("📋 Fallback Replicate API Response Data:", {
      id: response.data.id,
      status: response.data.status,
      hasOutput: !!response.data.output,
      error: response.data.error,
    });

    // Response kontrolü
    if (response.data.status === "succeeded" && response.data.output) {
      console.log(
        "✅ Fallback Replicate API başarılı, output alındı:",
        response.data.output
      );

      return {
        id: response.data.id,
        status: "succeeded",
        output: response.data.output,
      };
    } else if (response.data.status === "failed") {
      console.error("❌ Fallback Replicate API failed:", response.data.error);
      throw new Error(
        `Fallback Replicate API failed: ${
          response.data.error || "Unknown error"
        }`
      );
    } else {
      console.error(
        "❌ Fallback Replicate API unexpected status:",
        response.data.status
      );
      throw new Error(`Fallback unexpected status: ${response.data.status}`);
    }
  } catch (error) {
    console.error(
      "❌ Replicate google/nano-banana fallback API hatası:",
      error.message
    );
    throw error;
  }
}

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
            result.error.includes("Prediction failed."))
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

// Çoklu resimleri canvas ile birleştiren fonksiyon
async function combineImagesOnCanvas(
  images,
  userId,
  isMultipleProducts = false,
  aspectRatio = "9:16",
  gridLayoutInfo = null // Grid layout bilgisi
) {
  try {
    console.log(
      "🎨 Canvas ile resim birleştirme başlatılıyor...",
      images.length,
      "resim"
    );
    console.log("🛍️ Çoklu ürün modu:", isMultipleProducts);
    console.log("📐 Hedef aspect ratio:", aspectRatio);
    console.log("🛍️ Grid Layout bilgisi:", gridLayoutInfo);

    // Aspect ratio'yu parse et ve güvenlik kontrolü yap
    let targetAspectRatio;
    const aspectRatioParts = aspectRatio.split(":");
    if (aspectRatioParts.length !== 2) {
      console.log(
        `❌ Geçersiz aspect ratio formatı: ${aspectRatio}, 9:16 kullanılıyor`
      );
      aspectRatio = "9:16";
    }

    const [ratioWidth, ratioHeight] = aspectRatio.split(":").map(Number);

    // NaN kontrolü
    if (
      isNaN(ratioWidth) ||
      isNaN(ratioHeight) ||
      ratioWidth <= 0 ||
      ratioHeight <= 0
    ) {
      console.log(
        `❌ Geçersiz aspect ratio değerleri: ${ratioWidth}:${ratioHeight}, 9:16 kullanılıyor`
      );
      const [defaultWidth, defaultHeight] = [9, 16];
      targetAspectRatio = defaultWidth / defaultHeight;
      console.log(
        "📐 Hedef aspect ratio değeri (fallback):",
        targetAspectRatio
      );
    } else {
      targetAspectRatio = ratioWidth / ratioHeight;
      console.log("📐 Hedef aspect ratio değeri:", targetAspectRatio);
    }

    // 🛍️ GRID LAYOUT MODU: Kombin için özel canvas boyutları
    let targetCanvasWidth, targetCanvasHeight;

    if (gridLayoutInfo && gridLayoutInfo.cols && gridLayoutInfo.rows) {
      // Grid layout modu - 1:1 kare format (her hücre 400x400)
      const cellSize = 400;
      targetCanvasWidth = gridLayoutInfo.cols * cellSize;
      targetCanvasHeight = gridLayoutInfo.rows * cellSize;

      console.log(
        `🛍️ [GRID] Kombin modu canvas boyutu: ${targetCanvasWidth}x${targetCanvasHeight}`
      );
      console.log(
        `🛍️ [GRID] Grid düzeni: ${gridLayoutInfo.cols}x${gridLayoutInfo.rows}, hücre boyutu: ${cellSize}px`
      );
    } else {
      // Normal mod - aspect ratio'ya göre boyutlandır
      // NaN kontrolü ekle
      if (isNaN(targetAspectRatio) || targetAspectRatio <= 0) {
        console.log(
          `❌ Geçersiz targetAspectRatio: ${targetAspectRatio}, varsayılan 9:16 kullanılıyor`
        );
        targetAspectRatio = 9 / 16;
      }

      if (targetAspectRatio > 1) {
        // Yatay format (16:9, 4:3 gibi)
        targetCanvasWidth = 1536; // Yüksek kalite
        targetCanvasHeight = Math.round(targetCanvasWidth / targetAspectRatio);
      } else {
        // Dikey format (9:16, 3:4 gibi) veya kare (1:1)
        targetCanvasHeight = 1536; // Yüksek kalite
        targetCanvasWidth = Math.round(targetCanvasHeight * targetAspectRatio);
      }

      // Minimum boyut garantisi ve NaN kontrolü
      if (isNaN(targetCanvasWidth) || targetCanvasWidth < 1024)
        targetCanvasWidth = 1024;
      if (isNaN(targetCanvasHeight) || targetCanvasHeight < 1024)
        targetCanvasHeight = 1024;
    }

    console.log(
      `📐 Hedef canvas boyutu: ${targetCanvasWidth}x${targetCanvasHeight}`
    );

    // Canvas boyutları
    let canvasWidth = targetCanvasWidth;
    let canvasHeight = targetCanvasHeight;
    const loadedImages = [];

    // Tüm resimleri yükle ve boyutları hesapla
    for (let i = 0; i < images.length; i++) {
      const imgData = images[i];
      let imageBuffer;

      try {
        // Base64 veya HTTP URL'den resmi yükle
        if (imgData.base64) {
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
            timeout: 15000, // 30s'den 15s'ye düşürüldü
            maxRedirects: 3,
          });
          imageBuffer = Buffer.from(response.data);
        } else if (imgData.uri.startsWith("file://")) {
          throw new Error("Yerel dosya için base64 data gönderilmelidir.");
        } else {
          throw new Error(`Desteklenmeyen URI formatı: ${imgData.uri}`);
        }

        // Sharp ile resmi önce işle (yüksek kalite korunarak)
        console.log(
          `🔄 Resim ${
            i + 1
          }: Sharp ile yüksek kalite preprocessing yapılıyor...`
        );

        let processedBuffer;
        try {
          // EXIF rotation fix: .rotate() EXIF bilgisini otomatik uygular
          processedBuffer = await sharp(imageBuffer)
            .rotate() // EXIF orientation bilgisini otomatik uygula
            .jpeg({ quality: 95 }) // Kalite artırıldı - ratio canvas için
            .toBuffer();

          console.log(`🔄 Resim ${i + 1}: EXIF rotation uygulandı`);
        } catch (sharpError) {
          console.error(
            `❌ Sharp işleme hatası resim ${i + 1}:`,
            sharpError.message
          );

          // Sharp ile işlenemezse orijinal buffer'ı kullan
          if (
            sharpError.message.includes("Empty JPEG") ||
            sharpError.message.includes("DNL not supported")
          ) {
            console.log(
              `⚠️ JPEG problemi tespit edildi, PNG'ye dönüştürülüyor...`
            );
            try {
              processedBuffer = await sharp(imageBuffer)
                .rotate() // EXIF rotation burada da uygula
                .png({ quality: 95 })
                .toBuffer();
              console.log(
                `✅ Resim ${
                  i + 1
                } PNG olarak başarıyla işlendi (EXIF rotation uygulandı)`
              );
            } catch (pngError) {
              console.error(
                `❌ PNG dönüştürme de başarısız resim ${i + 1}:`,
                pngError.message
              );
              throw new Error(`Resim ${i + 1} işlenemedi: ${pngError.message}`);
            }
          } else {
            throw sharpError;
          }
        }

        // Metadata'yı al (rotation uygulandıktan sonra)
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

    // Canvas oluştur - ratio'ya göre sabit boyut
    canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    // Anti-aliasing ve kalite ayarları
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Beyaz arka plan
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (gridLayoutInfo && gridLayoutInfo.cols && gridLayoutInfo.rows) {
      // 🛍️ GRID LAYOUT MODU: Kombin resimleri kare grid'e yerleştir
      console.log("🛍️ Grid Layout modu: Resimler kare grid'e yerleştirilecek");

      const cellSize = 400; // Her hücre 400x400

      // Grid çizgi çizme (debug için) - ince gri çizgiler
      ctx.strokeStyle = "#f0f0f0";
      ctx.lineWidth = 1;

      // Dikey çizgiler
      for (let i = 1; i < gridLayoutInfo.cols; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, canvasHeight);
        ctx.stroke();
      }

      // Yatay çizgiler
      for (let i = 1; i < gridLayoutInfo.rows; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(canvasWidth, i * cellSize);
        ctx.stroke();
      }

      // Resimleri grid pozisyonlarına yerleştir
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const imageData = images[i]; // Orijinal image data'sı

        // Grid pozisyonunu hesapla (clientten gelen gridPosition kullan veya hesapla)
        let col, row;
        if (imageData.gridPosition) {
          col = imageData.gridPosition.col;
          row = imageData.gridPosition.row;
        } else {
          col = i % gridLayoutInfo.cols;
          row = Math.floor(i / gridLayoutInfo.cols);
        }

        const cellX = col * cellSize;
        const cellY = row * cellSize;

        console.log(
          `🛍️ [GRID] Ürün ${
            i + 1
          }: Grid pozisyon (${col}, ${row}) - Canvas pozisyon (${cellX}, ${cellY})`
        );

        // Resmi kare hücre içerisine sığdır (aspect ratio koruyarak, hücreyi tam kaplar)
        const imgAspectRatio = img.width / img.height;
        let drawWidth, drawHeight, drawX, drawY;

        if (imgAspectRatio > 1) {
          // Yatay resim - yüksekliği hücre boyutuna eşitle, genişliği orantılı yap
          drawHeight = cellSize;
          drawWidth = cellSize * imgAspectRatio;
          drawX = cellX - (drawWidth - cellSize) / 2; // Ortala
          drawY = cellY;
        } else {
          // Dikey resim - genişliği hücre boyutuna eşitle, yüksekliği orantılı yap
          drawWidth = cellSize;
          drawHeight = cellSize / imgAspectRatio;
          drawX = cellX;
          drawY = cellY - (drawHeight - cellSize) / 2; // Ortala
        }

        // Hücre sınırları içinde kalması için clipping
        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX, cellY, cellSize, cellSize);
        ctx.clip();

        // Yüksek kaliteli çizim
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();

        console.log(
          `🛍️ [GRID] Ürün ${i + 1} kare hücreye yerleştirildi: (${drawX.toFixed(
            1
          )}, ${drawY.toFixed(1)}) - ${drawWidth.toFixed(
            1
          )}x${drawHeight.toFixed(1)}`
        );
      }
    } else if (isMultipleProducts) {
      // Eski çoklu ürün modu: Yan yana birleştir - canvas boyutuna sığdır (fallback)
      console.log("🛍️ Çoklu ürün modu: Resimler yan yana birleştirilecek");

      const itemWidth = canvasWidth / loadedImages.length;
      const itemHeight = canvasHeight;

      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const x = i * itemWidth;

        // Resmi canvas alanına sığdır (aspect ratio koruyarak)
        const imgAspectRatio = img.width / img.height;
        const itemAspectRatio = itemWidth / itemHeight;

        let drawWidth, drawHeight, drawX, drawY;

        if (imgAspectRatio > itemAspectRatio) {
          // Resim daha geniş - genişliğe göre sığdır
          drawWidth = itemWidth;
          drawHeight = itemWidth / imgAspectRatio;
          drawX = x;
          drawY = (itemHeight - drawHeight) / 2;
        } else {
          // Resim daha uzun - yüksekliğe göre sığdır
          drawHeight = itemHeight;
          drawWidth = itemHeight * imgAspectRatio;
          drawX = x + (itemWidth - drawWidth) / 2;
          drawY = 0;
        }

        // Yüksek kaliteli çizim - çoklu ürün modu
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();

        console.log(
          `🖼️ Ürün ${i + 1} yüksek kaliteyle yerleştirildi: (${drawX.toFixed(
            1
          )}, ${drawY.toFixed(1)}) - ${drawWidth.toFixed(
            1
          )}x${drawHeight.toFixed(1)}`
        );
      }
    } else {
      // Tek resim modu: Canvas ortasına yerleştir - aspect ratio koruyarak
      console.log("📚 Tek resim modu: Resim canvas ortasına yerleştirilecek");

      if (loadedImages.length === 1) {
        const img = loadedImages[0];
        const imgAspectRatio = img.width / img.height;
        const canvasAspectRatio = canvasWidth / canvasHeight;

        let drawWidth, drawHeight, drawX, drawY;

        if (imgAspectRatio > canvasAspectRatio) {
          // Resim daha geniş - genişliğe göre sığdır
          drawWidth = canvasWidth;
          drawHeight = canvasWidth / imgAspectRatio;
          drawX = 0;
          drawY = (canvasHeight - drawHeight) / 2;
        } else {
          // Resim daha uzun - yüksekliğe göre sığdır
          drawHeight = canvasHeight;
          drawWidth = canvasHeight * imgAspectRatio;
          drawX = (canvasWidth - drawWidth) / 2;
          drawY = 0;
        }

        // Yüksek kaliteli çizim ayarları
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();

        console.log(`🖼️ Resim canvas ortasına yüksek kaliteyle yerleştirildi:`);
        console.log(
          `   📍 Pozisyon: (${drawX.toFixed(1)}, ${drawY.toFixed(1)})`
        );
        console.log(
          `   📏 Boyut: ${drawWidth.toFixed(1)}x${drawHeight.toFixed(1)}`
        );
        console.log(`   📐 Orijinal resim: ${img.width}x${img.height}`);
        console.log(
          `   📐 Hedef canvas: ${canvasWidth}x${canvasHeight} (${aspectRatio})`
        );
      } else {
        // Çoklu resim alt alta (eski mantık) - ancak canvas boyutuna sığdır
        console.log("📚 Çoklu resim modu: Resimler alt alta birleştirilecek");

        const itemHeight = canvasHeight / loadedImages.length;

        for (let i = 0; i < loadedImages.length; i++) {
          const img = loadedImages[i];
          const y = i * itemHeight;

          // Resmi canvas alanına sığdır (aspect ratio koruyarak)
          const imgAspectRatio = img.width / img.height;
          const itemAspectRatio = canvasWidth / itemHeight;

          let drawWidth, drawHeight, drawX, drawY;

          if (imgAspectRatio > itemAspectRatio) {
            // Resim daha geniş - genişliğe göre sığdır
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / imgAspectRatio;
            drawX = 0;
            drawY = y + (itemHeight - drawHeight) / 2;
          } else {
            // Resim daha uzun - yüksekliğe göre sığdır
            drawHeight = itemHeight;
            drawWidth = itemHeight * imgAspectRatio;
            drawX = (canvasWidth - drawWidth) / 2;
            drawY = y;
          }

          // Yüksek kaliteli çizim
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
          ctx.restore();

          console.log(
            `🖼️ Resim ${i + 1} yerleştirildi: (${drawX.toFixed(
              1
            )}, ${drawY.toFixed(1)}) - ${drawWidth.toFixed(
              1
            )}x${drawHeight.toFixed(1)}`
          );
        }
      }
    }

    // Canvas'ı yüksek kalitede buffer'a çevir
    const buffer = canvas.toBuffer("image/jpeg", { quality: 0.9 }); // Kalite artırıldı
    console.log("📊 Birleştirilmiş resim boyutu:", buffer.length, "bytes");

    // Supabase'e yükle (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_combined_${
      isMultipleProducts ? "products" : "images"
    }_${userId || "anonymous"}_${randomId}.jpg`;

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

// Bu fonksiyon artık kullanılmıyor - location asset combining kaldırıldı

// Ana generate endpoint'i - Tek resim için
router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme
  const CREDIT_COST = 15; // Her oluşturma 15 kredi
  let creditDeducted = false;
  let actualCreditDeducted = CREDIT_COST; // Gerçekte düşülen kredi miktarı (iade için)
  let userId; // Scope için önceden tanımla
  let finalGenerationId = null; // Scope için önceden tanımla
  let temporaryFiles = []; // Silinecek geçici dosyalar

  try {
    const {
      ratio,
      promptText,
      referenceImages,
      settings,
      userId: requestUserId,
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleImages,
      isMultipleProducts,
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
      // Session deduplication
      sessionId = null, // Aynı batch request'leri tanımlıyor
    } = req.body;

    // userId'yi scope için ata
    userId = requestUserId;

    console.log("🖼️ [BACKEND] isMultipleImages:", isMultipleImages);
    console.log("🛍️ [BACKEND] isMultipleProducts:", isMultipleProducts);
    console.log("🎨 [BACKEND] isColorChange:", isColorChange);
    console.log("🎨 [BACKEND] targetColor:", targetColor);
    console.log("🕺 [BACKEND] isPoseChange:", isPoseChange);
    console.log("🕺 [BACKEND] customDetail:", customDetail);
    console.log("✏️ [BACKEND] isEditMode:", isEditMode);
    console.log("✏️ [BACKEND] editPrompt:", editPrompt);
    console.log(
      "📤 [BACKEND] Gelen referenceImages:",
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

    // Çoklu resim varsa birleştir, yoksa tek resmi kullan
    if (isMultipleImages && referenceImages.length > 1) {
      console.log(
        "🖼️ [BACKEND] Çoklu resim birleştirme işlemi başlatılıyor..."
      );

      // Kombin modu kontrolü
      const isKombinMode = req.body.isKombinMode || false;
      console.log("🛍️ [BACKEND] Kombin modu kontrolü:", isKombinMode);

      // Grid layout bilgisini request body'den al
      let gridLayoutInfo = null;

      // Request body'de grid layout bilgisi var mı kontrol et
      if (req.body.referenceImages && req.body.referenceImages.isGridLayout) {
        gridLayoutInfo = req.body.referenceImages.gridInfo;
        console.log(
          "🛍️ [BACKEND] Grid layout bilgisi bulundu:",
          gridLayoutInfo
        );
      } else {
        console.log("🛍️ [BACKEND] Grid layout bilgisi bulunamadı, normal mod");
      }

      if (isKombinMode && gridLayoutInfo) {
        // 🛍️ KOMBİN MODU: Grid layout'u canvas'ta birleştir
        console.log("🛍️ [BACKEND] Kombin modu - Grid canvas oluşturuluyor...");

        finalImage = await combineImagesOnCanvas(
          referenceImages,
          userId,
          false, // isMultipleProducts = false (kombin tek resim olarak işlenecek)
          "1:1", // Kombin için kare format
          gridLayoutInfo // Grid layout bilgisini geç
        );

        console.log("🛍️ [BACKEND] Kombin grid canvas oluşturuldu:", finalImage);
      } else {
        // Normal çoklu resim modu
        finalImage = await combineImagesOnCanvas(
          referenceImages,
          userId,
          isMultipleProducts,
          ratio,
          gridLayoutInfo // Grid layout bilgisini geç
        );
      }

      // Birleştirilmiş resmi geçici dosyalar listesine ekle
      temporaryFiles.push(finalImage);
    } else {
      // Tek resim için ratio'ya göre canvas işlemi
      console.log(
        "🖼️ [BACKEND] Tek resim için ratio'ya göre canvas işlemi başlatılıyor..."
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

      // Tek resim için de ratio'ya göre canvas'a yerleştir (grid layout yok)
      finalImage = await combineImagesOnCanvas(
        [{ uri: uploadedImageUrl }], // Tek resmi array içinde gönder
        userId,
        false, // isMultipleProducts = false
        ratio, // ratio parametresi
        null // gridLayoutInfo = null (tek resim)
      );

      // Canvas işleminden sonra oluşan resmi geçici dosyalar listesine ekle
      temporaryFiles.push(finalImage);
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

    if (isColorChange || isPoseChange) {
      // 🎨 COLOR CHANGE MODE veya 🕺 POSE CHANGE MODE - Basit değiştirme prompt'u
      if (isColorChange) {
        console.log(
          "🎨 Color change mode: Basit renk değiştirme prompt'u oluşturuluyor"
        );
        enhancedPrompt = `Change the main color of the product/item in this image to ${targetColor}. Keep all design details, patterns, textures, and shapes exactly the same. Only change the primary color to ${targetColor}. The result should be photorealistic with natural lighting.`;
      } else if (isPoseChange) {
        console.log(
          "🕺 Pose change mode: Gemini ile poz değiştirme prompt'u oluşturuluyor"
        );

        // Poz değiştirme modunda Gemini ile prompt oluştur
        enhancedPrompt = await enhancePromptWithGemini(
          promptText,
          finalImage, // isPoseChange modunda finalImage kullan (backgroundRemovedImage henüz yok)
          settings || {},
          locationImage,
          poseImage,
          hairStyleImage,
          isMultipleProducts,
          false, // hasControlNet
          false, // isColorChange
          null, // targetColor
          isPoseChange, // isPoseChange
          customDetail, // customDetail
          isEditMode, // isEditMode
          editPrompt // editPrompt
        );
      }
      backgroundRemovedImage = finalImage; // Orijinal image'ı kullan, arkaplan silme yok
      console.log(
        isColorChange ? "🎨 Color change prompt:" : "🕺 Pose change prompt:",
        enhancedPrompt
      );
    } else {
      // 🖼️ NORMAL MODE - Arkaplan silme işlemi (paralel)
      // Gemini prompt üretimini paralelde başlat
      const geminiPromise = enhancePromptWithGemini(
        promptText,
        finalImage, // Ham orijinal resim
        settings || {},
        locationImage,
        poseImage,
        hairStyleImage,
        isMultipleProducts,
        false, // ControlNet yok, ham resim
        isColorChange, // Renk değiştirme işlemi mi?
        targetColor, // Hedef renk bilgisi
        isPoseChange, // Poz değiştirme işlemi mi?
        customDetail, // Özel detay bilgisi
        isEditMode, // EditScreen modu mu?
        editPrompt // EditScreen'den gelen prompt
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

    // 🖼️ Kombin modunda finalImage kullan, diğer durumlarda arkaplan kaldırılmış resmi kullan
    let combinedImageForReplicate;

    if (req.body.isKombinMode) {
      // Kombin modunda canvas'ta birleştirilmiş grid'i kullan
      combinedImageForReplicate = finalImage;
      console.log(
        "🛍️ [BACKEND] Kombin modu: Grid canvas Gemini'ye gönderiliyor:",
        finalImage
      );
    } else {
      // Normal modda arkaplan kaldırılmış resmi kullan
      combinedImageForReplicate = backgroundRemovedImage;
      console.log(
        "🖼️ [BACKEND] Normal mod: Arkaplan kaldırılmış resim Gemini'ye gönderiliyor"
      );
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
        const requestBody = {
          input: {
            prompt: enhancedPrompt,
            image_input: [combinedImageForReplicate],
            output_format: "jpg",
          },
        };

        console.log("📋 Replicate Request Body:", {
          prompt: enhancedPrompt.substring(0, 100) + "...",
          imageInput: combinedImageForReplicate,
          outputFormat: "jpg",
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
              response.data.error.includes("Prediction failed."))
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
          processing_time_seconds: 0,
        });

        // 🗑️ Polling hatası durumunda geçici dosyaları temizle
        console.log(
          "🧹 Polling hatası sonrası geçici dosyalar temizleniyor..."
        );
        await cleanupTemporaryFiles(temporaryFiles);

        return res.status(500).json({
          success: false,
          result: {
            message: "Görsel işleme işlemi başarısız oldu",
            error: pollingError.message.includes("PREDICTION_INTERRUPTED")
              ? "Sunucu kesintisi oluştu. Lütfen tekrar deneyin."
              : "İşlem sırasında teknik bir sorun oluştu. Lütfen tekrar deneyin.",
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
          const retryRequestBody = {
            input: {
              prompt: enhancedPrompt,
              image_input: [combinedImageForReplicate],
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
        processing_time_seconds: 0,
      });

      // 🗑️ Replicate hata durumunda geçici dosyaları temizle
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
    const model = "gemini-2.0-flash-001";

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

    return poseDescription;
  } catch (error) {
    console.error("🤸 Gemini pose açıklaması hatası:", error);
    // Fallback: Basit pose açıklaması
    return `Professional ${gender.toLowerCase()} model pose: ${poseTitle}. Stand naturally with good posture, position body to showcase the garment effectively.`;
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

    let query = supabase
      .from("reference_results")
      .select("*")
      .eq("user_id", userId)
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

module.exports = router;
