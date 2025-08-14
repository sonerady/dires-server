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
        timeout: 30000, // 30 saniye timeout
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

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_reference_${
      userId || "anonymous"
    }_${randomId}.jpg`;

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
    const CREDIT_COST = 20; // Her oluşturma 20 kredi

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

// External dependencies (ensure these are properly imported in your environment):
// import axios from 'axios';
// import { GoogleGenerativeAI } from '@google/generative-ai';
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Assuming GEMINI_API_KEY is available

/**
 * Simulates a helper function to generate a detailed pose description from a pose name.
 * In a real scenario, this might be another Gemini call or a lookup from a database.
 */
async function generatePoseDescriptionWithGemini(
  poseName,
  poseImage,
  gender,
  category
) {
  console.log(
    `🤸 [GEMINI] Generating detailed pose description for: "${poseName}"`
  );
  // This is a placeholder. In a real application, this might involve
  // another AI call or a structured lookup to get a rich description
  // for the pose (e.g., "standing tall" -> "A model standing tall and confident, with arms relaxed at their sides, subtly highlighting the garment's silhouette.").
  return new Promise((resolve) => {
    setTimeout(() => {
      let description;
      switch (poseName.toLowerCase()) {
        case "standing tall":
          description =
            "A model standing tall and confident, with arms relaxed at their sides, subtly highlighting the garment's silhouette.";
          break;
        case "sitting on chair":
          description =
            "A model gracefully seated on a modern chair, one hand resting lightly on their lap, embodying a relaxed yet elegant posture.";
          break;
        case "dynamic walk":
          description =
            "A dynamic walking pose, captured mid-stride, with a slight turn of the body, showcasing the garment's movement and fluidity.";
          break;
        case "hands in pockets":
          description =
            "A casual pose with one or both hands comfortably placed in the garment's pockets, conveying a relaxed and confident attitude.";
          break;
        case "crossed arms":
          description =
            "A powerful and self-assured pose with arms crossed over the chest, demonstrating confidence and drawing attention to the garment's upper body fit.";
          break;
        case "leaning against wall":
          description =
            "A relaxed yet stylish pose where the model leans casually against a wall, showcasing the garment's drape and fit in a natural setting.";
          break;
        default:
          description = `A natural and appealing ${poseName} pose, expertly designed to showcase the garment's fit and features while maintaining a photorealistic and professional aesthetic.`;
      }
      resolve(description);
    }, 50); // Simulate a small delay
  });
}

/**
 * Enhances a prompt for AI image generation (virtual try-on) using Gemini,
 * incorporating various user settings and reference images.
 *
 * @param {string} originalPrompt - The initial, possibly short, prompt from the user.
 * @param {string} imageUrl - URL of the flat-lay garment image to be transformed.
 * @param {object} settings - User-selected settings (gender, age, pose, perspective, etc.).
 * @param {string} [locationImage] - URL of an image for background/environment reference.
 * @param {string} [poseImage] - URL of an image for model pose reference.
 * @param {string} [hairStyleImage] - URL of an image for model hairstyle reference.
 * @param {boolean} [isMultipleProducts=false] - True if multiple products are being styled together.
 * @param {boolean} [hasControlNet=false] - Indicates if ControlNet data is implicitly used (not directly impacts prompt content here).
 * @param {boolean} [isColorChange=false] - True if only the product color needs to be changed.
 * @param {string} [targetColor=null] - The target color if isColorChange is true.
 * @param {boolean} [isPoseChange=false] - True if only the model's pose needs to be changed.
 * @param {string} [customDetail=null] - Custom detail for pose or edit mode.
 * @param {boolean} [isEditMode=false] - True if in EditScreen mode, implies a specific edit prompt.
 * @param {string} [editPrompt=null] - The specific edit prompt from EditScreen.
 * @returns {Promise<string>} An enhanced, detailed prompt for the image generation model.
 */
async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false,
  hasControlNet = false, // As per instruction, this doesn't directly affect prompt content now.
  isColorChange = false,
  targetColor = null,
  isPoseChange = false,
  customDetail = null,
  isEditMode = false,
  editPrompt = null
) {
  try {
    console.log(
      "🤖 Gemini 2.0 Flash prompt enhancement initiated for single image try-on."
    );
    console.log("🏞️ [GEMINI] Location image parameter:", locationImage);
    console.log("🤸 [GEMINI] Pose image parameter:", poseImage);
    console.log("💇 [GEMINI] Hair style image parameter:", hairStyleImage);
    console.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);
    console.log("🎨 [GEMINI] Color change mode:", isColorChange);
    console.log("🎨 [GEMINI] Target color:", targetColor);
    console.log("✏️ [GEMINI] Edit mode:", isEditMode);
    console.log("✏️ [GEMINI] Edit prompt:", editPrompt);

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    console.log("🎛️ [BACKEND GEMINI] Settings check:", hasValidSettings);

    const gender = settings?.gender || "female";
    const age = settings?.age || "";
    const parsedAgeInt = parseInt(age, 10);

    let modelDescriptorText; // e.g., "25-year-old female model"
    let baseModelType; // e.g., "female model", "baby boy"
    const genderLower = gender.toLowerCase();

    // Determine model's age and gender descriptor
    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
      // Baby/Toddler (0-3 years)
      const ageGroupWord = parsedAgeInt <= 1 ? "baby" : "toddler";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelDescriptorText = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord}${
        parsedAgeInt <= 1 ? " (infant)" : ""
      }`;
      baseModelType = `${ageGroupWord} ${genderWord}${
        parsedAgeInt <= 1 ? " (infant)" : ""
      }`;
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      // Child/Teenage (4-16 years)
      const ageGroupWord = parsedAgeInt <= 12 ? "child" : "teenage";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelDescriptorText = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord}`;
      baseModelType = `${ageGroupWord} ${genderWord}`;
    } else {
      // Adult (17+ years)
      modelDescriptorText =
        genderLower === "male" || genderLower === "man"
          ? "male model"
          : "female model";
      if (age) modelDescriptorText = `${age} ${modelDescriptorText}`;
      baseModelType =
        genderLower === "male" || genderLower === "man"
          ? "male model"
          : "female model";
    }

    console.log("👤 [GEMINI] Base model type:", baseModelType);
    console.log("👤 [GEMINI] Age-specific model type:", modelDescriptorText);

    let ageInstruction = "";
    if (age) {
      ageInstruction = `
      AGE SPECIFICATION: The model's age is "${age}". Ensure the model appears precisely this age. Mention this age information no more than twice in the entire prompt, for naturalness.`;
    }

    let childModelSpecifics = "";
    if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      if (parsedAgeInt <= 1) {
        // Baby (0-1 year)
        childModelSpecifics = `
      BABY MODEL REQUIREMENTS (Age: ${parsedAgeInt}): The model MUST be a BABY (infant). Critical features: round, chubby baby cheeks, large head proportional to baby body, small baby hands and feet, soft baby skin texture, infant body proportions. Avoid any mature or adult-like features. Poses should be sitting, lying, or gently supported.`;
      } else if (parsedAgeInt <= 3) {
        // Toddler (2-3 years)
        childModelSpecifics = `
      TODDLER MODEL REQUIREMENTS (Age: ${parsedAgeInt}): The model MUST be a TODDLER. Use toddler proportions (chubby cheeks, shorter limbs), round facial features, and natural toddler expressions (curious, playful).`;
      } else {
        // Child/Teenage (4-16 years)
        childModelSpecifics = `
      AGE-SPECIFIC STYLE RULES FOR CHILD/TEENAGE MODELS (Age: ${parsedAgeInt}): Use age-appropriate physical descriptions (e.g., "child proportions", "youthful facial features"). AVOID adult modeling language, makeup, or mature accessories. Model must appear natural, playful, or relaxed. Avoid assertive or seductive body language.`;
      }
    }

    let bodyMeasurementsInstruction = "";
    if (settings?.type === "custom_measurements" && settings?.measurements) {
      const { bust, waist, hips, height, weight } = settings.measurements;
      console.log(
        "📏 [BACKEND GEMINI] Custom body measurements received:",
        settings.measurements
      );
      bodyMeasurementsInstruction = `
      CUSTOM BODY MEASUREMENTS: The user provided specific body measurements for the ${baseModelType}: Bust: ${bust} cm, Waist: ${waist} cm, Hips: ${hips} cm.${
        height ? ` Height: ${height} cm.` : ""
      }${
        weight ? ` Weight: ${weight} kg.` : ""
      } The garment must fit naturally and realistically on a body with these precise proportions.`;
    }

    let settingsInstructions = "";
    if (hasValidSettings) {
      const filteredSettings = Object.entries(settings).filter(
        ([key, value]) =>
          value !== null &&
          value !== undefined &&
          value !== "" &&
          ![
            "measurements",
            "type",
            "gender",
            "age",
            "pose",
            "perspective",
            "hairStyle",
          ].includes(key)
      );

      if (filteredSettings.length > 0) {
        settingsInstructions = `
      USER SETTINGS: Incorporate the following user-selected settings into the description where appropriate:
      ${filteredSettings
        .map(
          ([key, value]) =>
            `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`
        )
        .join("\n      ")}
      `;
        console.log("🎛️ [BACKEND GEMINI] Settings instructions generated.");
      }
    }

    let poseInstruction = "";
    if (!settings?.pose && !poseImage) {
      const garmentText = isMultipleProducts
        ? "the entire product ensemble"
        : "the garment/product";
      poseInstruction = `
      INTELLIGENT POSE SELECTION: As no specific pose was selected, intelligently choose the MOST APPROPRIATE pose for the ${baseModelType} that best showcases ${garmentText}'s design, fit, and unique features for commercial photography.`;
      console.log(`🤸 [GEMINI] Intelligent pose selection activated.`);
    } else if (poseImage) {
      poseInstruction = `
      POSE REFERENCE IMAGE: A pose reference image is provided. Analyze it carefully and accurately integrate the exact body positioning, hand placement, stance, facial expression, and overall posture into the model's description.`;
      console.log("🤸 [GEMINI] Pose instruction added (image).");
    } else if (settings?.pose) {
      let detailedPoseDescription = null;
      try {
        detailedPoseDescription = await generatePoseDescriptionWithGemini(
          settings.pose,
          poseImage,
          settings.gender || "female",
          "clothing"
        );
      } catch (poseDescError) {
        console.error(
          "🤸 [GEMINI] Error generating detailed pose description:",
          poseDescError
        );
      }
      poseInstruction = `
      SPECIFIC POSE: The user selected the pose "${
        settings.pose
      }". Use this detailed instruction for the ${baseModelType}: "${
        detailedPoseDescription || settings.pose
      }". Ensure the model strictly adheres to this pose.`;
      console.log("🤸 [GEMINI] Pose instruction added (text).");
    }

    let perspectiveInstruction = "";
    if (!settings?.perspective) {
      const garmentText = isMultipleProducts
        ? "the entire product ensemble"
        : "the garment/product";
      perspectiveInstruction = `
      INTELLIGENT CAMERA PERSPECTIVE SELECTION: No specific camera perspective was selected. Intelligently choose the MOST APPROPRIATE camera angle and perspective to best capture ${garmentText}'s key design features, fit, and overall silhouette for a commercial presentation.`;
      console.log(`📸 [GEMINI] Intelligent perspective selection activated.`);
    } else {
      perspectiveInstruction = `
      SPECIFIC CAMERA PERSPECTIVE: The user selected "${settings.perspective}" camera perspective. Ensure the photography follows this perspective, maintaining professional composition.`;
      console.log("📸 [GEMINI] Specific perspective instruction added.");
    }

    let locationInstruction = "";
    if (locationImage) {
      locationInstruction = `
      LOCATION REFERENCE IMAGE: A location reference image is provided. Analyze it to integrate its environmental characteristics, lighting style, architecture, and mood into the background and scene composition.`;
      console.log("🏞️ [GEMINI] Location instruction added.");
    }

    let hairStyleInstruction = "";
    if (hairStyleImage) {
      hairStyleInstruction = `
      HAIR STYLE REFERENCE IMAGE: A hair style reference image is provided. Analyze it carefully and incorporate the exact hair length, texture, cut, styling, and overall appearance for the ${baseModelType}.`;
      console.log("💇 [GEMINI] Hair style instruction added (image).");
    } else if (settings?.hairStyle) {
      hairStyleInstruction = `
      SPECIFIC HAIR STYLE: The user selected the hair style "${settings.hairStyle}". Ensure the ${baseModelType} is styled with this exact hair style, matching its length, texture, and overall look naturally.`;
      console.log("💇 [GEMINI] Hair style instruction added (text).");
    }

    // --- System-level instructions for Gemini's behavior ---
    const commonGeminiSystemInstruction = `
    You are an AI assistant specialized in generating concise, photorealistic prompts for an advanced image generation model used for virtual clothing try-ons. Your primary goal is to transform a flat-lay garment from an input image onto a human model, adhering strictly to all provided details and constraints.

    **CRITICAL RULES FOR YOUR OUTPUT:**
    1.  Your output MUST start with "Replace" or "Change". Do not include any introductory sentences, explanations, or commentary before that.
    2.  Apply ALL rules, headings, examples, and meta-instructions from this message silently. Do NOT quote, restate, or paraphrase any rule text in your final output.
    3.  Your final output MUST ONLY be the concise descriptive prompt for the image model.
    4.  BRAND SAFETY: If the input image contains brand names or logos, do NOT mention them. Refer to them generically (e.g., "brand label", "logo").
    5.  LENGTH CONSTRAINT: Your entire output MUST be no longer than 512 tokens. Be concise.
    6.  LANGUAGE: Always generate your prompt entirely in English.
    `;

    // --- Core garment transformation directives for Flux Max context ---
    const coreGarmentTransformationDirectives = `
    **GARMENT TRANSFORMATION DIRECTIVES:**
    -   IMMEDIATELY remove all hangers, clips, tags, and flat-lay artifacts from the input garment. Ensure NO mannequin remains or unintended background elements are rendered.
    -   Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model. Avoid any 2D, sticker-like, or paper-like overlays.
    -   Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along the body. Maintain a clean, commercial presentation.
    -   Preserve ALL original garment details: exact colors, prints/patterns, material texture, stitching, construction elements (collar, placket, buttons/zippers, cuffs, hems), trims, and finishes. Do NOT redesign the garment.
    -   Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours.
    -   Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting.`;

    let promptForGemini;

    if (isEditMode && editPrompt && editPrompt.trim()) {
      // EDIT MODE - Specific edit request
      promptForGemini = `
      ${commonGeminiSystemInstruction}

      **GEMINI TASK: EDIT MODE**
      Understand the user's specific edit request for the input image and generate a professional English prompt that accurately applies this modification.

      USER'S EDIT REQUEST: "${editPrompt.trim()}"

      CRITICAL FOR EDIT MODE:
      -   The prompt MUST begin with "Replace, change..."
      -   Apply the user's specific edit request precisely.
      -   Maintain photorealistic quality with natural lighting and the general style of the original image.
      -   Ensure the modification is realistic and technically feasible.
      -   Preserve all elements of the original image not explicitly targeted by the edit.

      ${originalPrompt ? `Additional context: ${originalPrompt}.` : ""}
      `;
    } else if (isColorChange && targetColor && targetColor !== "original") {
      // COLOR CHANGE MODE - Only change color
      promptForGemini = `
      ${commonGeminiSystemInstruction}

      **GEMINI TASK: COLOR CHANGE**
      Generate a concise English prompt to change ONLY the color of the product/garment from the reference image to "${targetColor}".

      CRITICAL FOR COLOR CHANGE:
      -   The prompt MUST begin with "Change the product/garment..."
      -   ONLY change the color to "${targetColor}".
      -   Keep EVERYTHING else exactly the same: design, shape, patterns, details, style, fit, texture, construction elements, hardware, stitching, logos/graphics.
      -   The garment must appear identical to the reference image, just in "${targetColor}" color.

      ${
        originalPrompt
          ? `Additional color change requirements: ${originalPrompt}.`
          : ""
      }
      `;
    } else if (isPoseChange) {
      // POSE CHANGE MODE - Only change pose
      promptForGemini = `
      ${commonGeminiSystemInstruction}

      **GEMINI TASK: POSE CHANGE**
      Generate a concise English prompt to change ONLY the pose/position of the model in the reference image.

      CRITICAL FOR POSE CHANGE:
      -   The prompt MUST begin with "Change the model's pose..."
      -   Keep the EXACT same person, face, clothing, background, and all other elements.
      -   ONLY change the pose/position/body posture of the model.
      -   The model must appear identical to the reference image, just in a different pose/position.

      POSE SELECTION / INSTRUCTION:
      ${
        customDetail && customDetail.trim()
          ? `The user wants the pose to be: "${customDetail.trim()}". Interpret and describe this pose in detail.`
          : `You MUST select ONE specific, professional, and elegant pose for the model. Consider fashion, portrait, or dynamic pose categories.`
      }

      CRITICAL CLOTHING COMPATIBILITY RULES (MUST REFLECT IN YOUR POSE DESCRIPTION):
      -   If the garment has NO POCKETS: Do NOT describe hands in pockets.
      -   If the garment has SHORT SLEEVES: Do NOT describe folding or adjusting long sleeves.
      -   If the garment is SLEEVELESS: Do NOT describe placing hands on sleeves.
      -   If it's a DRESS/SKIRT: Ensure leg positioning is appropriate for garment length.
      -   Do NOT change how the garment's neckline sits.
      -   Keep FIXED ACCESSORIES (belts, scarves) in original position.
      -   NEVER turn the model completely around (avoid full back views).
      -   NEVER change the garment's silhouette, fit, or draping.

      Your pose description must be detailed, including hand positioning (compatible with garment), weight distribution, facial direction, and body angles.
      ${originalPrompt ? `Additional considerations: ${originalPrompt}.` : ""}
      `;
    } else {
      // NORMAL MODE - Standard garment replacement
      promptForGemini = `
      ${commonGeminiSystemInstruction}

      **GEMINI TASK: VIRTUAL TRY-ON**
      Generate a highly detailed, photorealistic English prompt to transform the flat-lay garment from the input image onto a ${modelDescriptorText}.

      ${coreGarmentTransformationDirectives}

      **GARMENT DESCRIPTION:**
      Analyze the input garment image and concisely describe its key visual characteristics, construction details (e.g., number/style of buttons, pockets, collar type, hem/cuff types, stitching, hardware), fabric texture, and any unique design elements. Focus on details that define its unique look and cut.

      **MODEL AND SCENE SPECIFICS:**
      -   MODEL: A photorealistic ${modelDescriptorText}.
      ${ageInstruction}
      ${childModelSpecifics}
      ${bodyMeasurementsInstruction}
      ${settingsInstructions}
      ${locationInstruction}
      ${poseInstruction}
      ${perspectiveInstruction}
      ${hairStyleInstruction}
      ${
        isMultipleProducts
          ? "-   Multiple products: Ensure all products in the ensemble are visible, well-positioned, and their coordination is highlighted."
          : ""
      }

      ${originalPrompt ? `Additional requirements: ${originalPrompt}.` : ""}
      `;
    }

    console.log("Gemini request payload (prompt part):", promptForGemini);

    const parts = [{ text: promptForGemini }];

    // Add the main reference image
    try {
      console.log(`Reference image being sent to Gemini: ${imageUrl}`);
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: Buffer.from(imageResponse.data).toString("base64"),
        },
      });
      console.log("Reference image successfully added to Gemini parts.");
    } catch (imageError) {
      console.error(`Error loading reference image: ${imageError.message}`);
      throw new Error(
        `Failed to load main reference image: ${imageError.message}`
      );
    }

    // Helper to add additional images
    const addImageToParts = async (imgUrl, mimeType, logPrefix) => {
      if (imgUrl) {
        try {
          const cleanUrl = imgUrl.split("?")[0]; // Clean URL from query parameters
          console.log(
            `${logPrefix} image being converted to base64: ${cleanUrl}`
          );
          const response = await axios.get(cleanUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
          });
          parts.push({
            inlineData: {
              mimeType: mimeType,
              data: Buffer.from(response.data).toString("base64"),
            },
          });
          console.log(`${logPrefix} image successfully added to Gemini parts.`);
        } catch (error) {
          console.error(
            `${logPrefix} image could not be added: ${error.message}`
          );
        }
      }
    };

    await addImageToParts(locationImage, "image/jpeg", "🏞️ Location");
    await addImageToParts(poseImage, "image/jpeg", "🤸 Pose");
    await addImageToParts(hairStyleImage, "image/jpeg", "💇 Hair style");

    let enhancedPrompt;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 [GEMINI] API call attempt ${attempt}/${maxRetries}`);
        const result = await model.generateContent({
          contents: [{ role: "user", parts: parts }],
        });

        enhancedPrompt = result.response.text().trim();
        console.log(
          "🤖 [BACKEND GEMINI] Gemini's generated prompt:",
          enhancedPrompt
        );
        console.log(
          "✨ [BACKEND GEMINI] Final enhanced prompt (before fallback check):",
          enhancedPrompt
        );
        break; // Exit loop on success
      } catch (geminiError) {
        console.error(
          `Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );
        if (attempt === maxRetries) {
          console.error("Gemini API all attempts failed.");
          enhancedPrompt = originalPrompt; // Fallback to original prompt if all Gemini attempts fail
          break;
        }
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Fallback to Replicate GPT-4o-mini if Gemini failed or returned the original prompt
    if (enhancedPrompt === originalPrompt && originalPrompt !== null) {
      try {
        console.log(
          "🤖 [FALLBACK] Gemini failed or returned original prompt, trying Replicate GPT-4o-mini."
        );

        const replicateImageUrls = [imageUrl];
        if (locationImage) replicateImageUrls.push(locationImage.split("?")[0]);
        if (poseImage) replicateImageUrls.push(poseImage.split("?")[0]);
        if (hairStyleImage)
          replicateImageUrls.push(hairStyleImage.split("?")[0]);

        const replicateInput = {
          top_p: 1,
          prompt: promptForGemini, // Use the same detailed prompt sent to Gemini
          image_input: replicateImageUrls,
          temperature: 0.7, // Slightly lower temperature for more consistent results
          system_prompt:
            "You are a helpful assistant that generates concise, photorealistic prompts for AI image generation, specifically for virtual clothing try-on.",
          presence_penalty: 0,
          frequency_penalty: 0,
          max_completion_tokens: 512,
        };

        const replicateResponse = await axios.post(
          "https://api.replicate.com/v1/models/openai/gpt-4o-mini/predictions",
          { input: replicateInput },
          {
            headers: {
              Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
              "Content-Type": "application/json",
              Prefer: "wait", // Wait for the prediction to complete
            },
            timeout: 120000, // 2-minute timeout for Replicate API
          }
        );

        const replicateData = replicateResponse.data;
        if (replicateData.status === "succeeded") {
          let generatedReplicatePrompt = Array.isArray(replicateData.output)
            ? replicateData.output.join("")
            : replicateData.output;
          generatedReplicatePrompt = generatedReplicatePrompt.trim();

          // Ensure Replicate's output also starts with "Replace" or "Change"
          const lowerCaseReplicatePrompt =
            generatedReplicatePrompt.toLowerCase();
          if (
            !lowerCaseReplicatePrompt.startsWith("replace") &&
            !lowerCaseReplicatePrompt.startsWith("change")
          ) {
            if (isColorChange || isPoseChange) {
              generatedReplicatePrompt = `Change ${generatedReplicatePrompt}`;
            } else {
              // Normal try-on or edit mode
              generatedReplicatePrompt = `Replace ${generatedReplicatePrompt}`;
            }
          }
          console.log(
            "🤖 [FALLBACK] Replicate GPT-4o-mini prompt generation successful:",
            generatedReplicatePrompt
          );
          enhancedPrompt = generatedReplicatePrompt;
        } else {
          console.warn(
            "⚠️ [FALLBACK] Replicate GPT-4o-mini status:",
            replicateData.status
          );
          enhancedPrompt = originalPrompt; // Fallback if Replicate also fails
        }
      } catch (repErr) {
        console.error(
          "❌ [FALLBACK] Replicate GPT-4o-mini error:",
          repErr.message
        );
        enhancedPrompt = originalPrompt; // Fallback if Replicate errors out
      }
    }

    // Final safety check: Ensure the prompt starts with the required keywords
    const lowerCaseFinalPrompt = enhancedPrompt.toLowerCase();
    if (
      !lowerCaseFinalPrompt.startsWith("replace") &&
      !lowerCaseFinalPrompt.startsWith("change")
    ) {
      if (isColorChange || isPoseChange) {
        enhancedPrompt = `Change ${enhancedPrompt}`;
      } else {
        // Default for normal try-on or general edit mode
        enhancedPrompt = `Replace ${enhancedPrompt}`;
      }
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("🤖 Gemini 2.0 Flash prompt enhancement failed:", error);
    return originalPrompt; // Return original prompt on any unexpected error
  }
}
// Portrait prompt oluştur (Gemini) – Flux.1-dev için
async function generatePortraitPromptWithGemini(
  settings = {},
  gender = "female"
) {
  // Settings'ten sadece gerçekten gönderilen bilgileri çıkar (default verme!)
  const age = settings.age;
  let ethnicity = settings.ethnicity;
  const hairStyle = settings.hairStyle?.title || settings.hairStyle;
  const hairColor = settings.hairColor?.title || settings.hairColor;
  const skinTone = settings.skinTone;
  const mood = settings.mood;
  const accessoriesRaw = settings.accessories; // string (", ") formatında gelebilir
  // Keyword bazlı filtreyi kaldır: kararı Gemini'ye bırak
  const accessories = accessoriesRaw || null;
  const bodyShape =
    typeof settings.bodyShape === "string" ? settings.bodyShape : null;

  try {
    console.log("👤 Gemini ile portrait prompt oluşturuluyor...");

    // Ethnicity belirtilmemişse Asya dışından rastgele bir uygun grup seç
    if (!ethnicity) {
      const fallbackEthnicities = [
        "Latina",
        "Hispanic",
        "European",
        "Mediterranean",
        "Middle Eastern",
        "Persian",
        "Caucasian",
        "Turkish",
        "Brazilian",
        "Mexican",
      ];
      ethnicity =
        fallbackEthnicities[
          Math.floor(Math.random() * fallbackEthnicities.length)
        ];
    }

    // Sadece gönderilen (veya seçilen) karakteristikleri listeye ekle
    const characteristics = [];
    if (age) characteristics.push(`- Age: ${age}`);
    if (ethnicity) characteristics.push(`- Ethnicity: ${ethnicity}`);
    if (hairStyle) characteristics.push(`- Hair style: ${hairStyle}`);
    if (hairColor) characteristics.push(`- Hair color: ${hairColor}`);
    if (skinTone) characteristics.push(`- Skin tone: ${skinTone}`);
    if (mood) characteristics.push(`- Mood/expression: ${mood}`);
    if (accessories)
      characteristics.push(`- Accessories (face/head only): ${accessories}`);
    if (bodyShape) characteristics.push(`- Body shape: ${bodyShape}`);

    // Karakteristik varsa ekle, yoksa genel model açıklaması yap
    const characteristicsText =
      characteristics.length > 0
        ? `with these characteristics:\n    ${characteristics.join(
            "\n    "
          )}\n    \n    `
        : "";

    // Vurgulanacak ögeler - modelden prompt içinde birden fazla kez geçmesini iste
    const emphasisPoints = [];
    if (mood) emphasisPoints.push(`mood/expression: ${mood}`);
    if (accessories) emphasisPoints.push(`accessories: ${accessories}`);
    if (bodyShape) emphasisPoints.push(`body shape: ${bodyShape}`);
    if (hairStyle) emphasisPoints.push(`hair style: ${hairStyle}`);
    if (hairColor) emphasisPoints.push(`hair color: ${hairColor}`);
    if (skinTone) emphasisPoints.push(`skin tone: ${skinTone}`);
    if (age) emphasisPoints.push(`age: ${age}`);

    const emphasisText =
      emphasisPoints.length > 0
        ? `\n\nEMPHASIS REQUIREMENTS:\n- Repeat the following key attributes at least twice across the prompt where relevant: ${emphasisPoints.join(
            "; "
          )}.\n- Reiterate them again succinctly at the end of the prompt as a reminder line starting with 'Focus:'.\n`
        : "";

    const portraitPrompt = `Create a detailed portrait photo prompt for a professional fashion model (${gender}) ${characteristicsText}CRITICAL REQUIREMENTS:
    - MUST be a fashion model with high-end, editorial facial features
    - MUST have a pure white background (solid white studio backdrop)
    - Head-and-shoulders framing with a very slight distance from the camera (not an extreme close-up); keep a small breathing room around the head and shoulders
    - Professional studio lighting with even illumination
    - Sharp detail and clear facial features
    - High-fashion model aesthetics with striking, photogenic facial structure
    - Commercial fashion photography style
    
    ACCESSORY RULES:
    - If accessories are present, include ONLY face/head/hair-related accessories.
    - Do NOT mention or imply any body/hand/arm/waist accessories.
    IMPORTANT: Apply all the rules and constraints silently. Do NOT include or restate any rules, examples, or meta-instructions in the output.
    Generate a professional portrait photography prompt suitable for Flux.1-dev model. 
    LIMIT:
    - The final prompt MUST be no more than 77 tokens. Keep it concise.
    - Do NOT exceed 77 tokens under any circumstances.
    - Return only the final prompt text, without quotes or any meta-guidance (no 'Focus:' lines, no 'EMPHASIS REQUIREMENTS').
    Return only the prompt text, no explanations.`;

    // Gemini API'yi retry mekanizması ile çağır
    let response;
    let lastError;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`👤 Gemini API çağrısı attempt ${attempt}/${maxRetries}`);

        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: portraitPrompt }] }],
              generationConfig: {
                temperature: 0.7,
                topK: 20,
                topP: 0.8,
                maxOutputTokens: 200,
              },
            }),
          }
        );

        if (response.ok) {
          break; // Başarılı, döngüden çık
        } else if (response.status === 503 && attempt < maxRetries) {
          console.log(
            `⚠️ Gemini API 503 hatası, retry yapılıyor... (${attempt}/${maxRetries})`
          );
          lastError = new Error(`Gemini API hatası: ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          continue;
        } else {
          throw new Error(`Gemini API hatası: ${response.status}`);
        }
      } catch (error) {
        lastError = error;
        if (
          attempt < maxRetries &&
          (error.message.includes("503") ||
            error.message.includes("fetch failed"))
        ) {
          console.log(
            `⚠️ Gemini API network hatası, retry yapılıyor... (${attempt}/${maxRetries}):`,
            error.message
          );
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw error;
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error("Gemini API maximum retry reached");
    }

    const data = await response.json();
    const generatedPrompt =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!generatedPrompt) {
      throw new Error("Gemini'den boş yanıt alındı");
    }

    console.log("👤 Portrait prompt oluşturuldu:", generatedPrompt);
    return generatedPrompt;
  } catch (error) {
    console.error("❌ Portrait prompt oluşturma hatası:", error);

    // Fallback prompt - sadece gönderilen karakteristikleri kullan ve vurguyu tekrar et
    const fallbackCharacteristics = [];
    if (age) fallbackCharacteristics.push(`${age} age`);
    if (ethnicity) fallbackCharacteristics.push(`${ethnicity} ethnicity`);
    if (hairColor) fallbackCharacteristics.push(`${hairColor}`);
    if (skinTone) fallbackCharacteristics.push(`${skinTone} skin tone`);
    if (mood) fallbackCharacteristics.push(`${mood} mood`);
    if (accessories) fallbackCharacteristics.push(`${accessories}`);
    if (bodyShape) fallbackCharacteristics.push(`${bodyShape} body shape`);

    const characteristicsText =
      fallbackCharacteristics.length > 0
        ? ` with ${fallbackCharacteristics.join(", ")}.`
        : ".";

    const focusLine =
      emphasisPoints && emphasisPoints.length > 0
        ? ` Focus: ${emphasisPoints.join(", ")}.`
        : "";

    return `Professional head-and-shoulders portrait of a fashion ${gender} model with striking editorial facial features${characteristicsText} Pure white studio background, professional lighting, sharp detail, high-fashion model aesthetics, slight distance from camera (not extreme close-up), head and shoulders view with a bit of breathing room.${focusLine}`;
  }
}

async function generatePortraitWithFluxDev(portraitPrompt) {
  try {
    console.log("🎨 Flux.1-dev ile portrait resmi oluşturuluyor...");
    const finalPrompt = (portraitPrompt || "").trim();
    console.log("🎨 Portrait prompt (used):", finalPrompt);

    if (!process.env.REPLICATE_API_TOKEN) {
      console.error("❌ REPLICATE_API_TOKEN bulunamadı!");
      throw new Error("REPLICATE_API_TOKEN bulunamadı");
    }

    console.log("✅ REPLICATE_API_TOKEN mevcut, API çağrısı yapılıyor...");

    const requestBody = {
      version:
        "prunaai/flux.1-dev:b0306d92aa025bb747dc74162f3c27d6ed83798e08e5f8977adf3d859d0536a3",
      input: {
        seed: Math.floor(Math.random() * 2 ** 32),
        prompt: finalPrompt,
        guidance: 3.5,
        image_size: 1024,
        speed_mode: "Blink of an eye 👁️",
        aspect_ratio: "1:1",
        output_format: "jpg",
        output_quality: 100,
        num_inference_steps: 28,
      },
    };

    console.log("🔗 API Request Body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify(requestBody),
    });

    console.log("📡 API Response Status:", response.status);
    console.log(
      "📡 API Response Headers:",
      JSON.stringify([...response.headers.entries()], null, 2)
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error Response:", errorText);
      throw new Error(
        `Flux.1-dev API hatası: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log("📋 API Response Data:", JSON.stringify(result, null, 2));

    if (result.status === "succeeded" && result.output) {
      // Output bir array ise ilk elemanı al, string ise direkt kullan
      const portraitUrl = Array.isArray(result.output)
        ? result.output[0]
        : result.output;
      console.log("✅ Portrait resmi oluşturuldu:", portraitUrl);
      return portraitUrl;
    } else if (result.status === "failed") {
      console.error("❌ Portrait generation failed:", result.error);
      throw new Error(`Portrait oluşturma başarısız: ${result.error}`);
    } else if (result.status === "processing" || result.status === "starting") {
      // Prefer: wait kullanılmasına rağmen processing gelirse polling yap
      console.log(
        "⏳ Portrait processing devam ediyor, polling başlatılıyor..."
      );
      const finalResult = await pollReplicateResult(result.id, 30, 480); // toplam 480s limit

      if (finalResult.status === "succeeded" && finalResult.output) {
        const portraitUrl = Array.isArray(finalResult.output)
          ? finalResult.output[0]
          : finalResult.output;
        console.log(
          "✅ Portrait resmi oluşturuldu (polling sonrası):",
          portraitUrl
        );
        return portraitUrl;
      } else {
        throw new Error(
          `Portrait polling sonrası başarısız: ${finalResult.status} - ${finalResult.error}`
        );
      }
    } else {
      console.error("❌ Beklenmeyen API response:", result);
      throw new Error(`Portrait oluşturma beklenmeyen sonuç: ${result.status}`);
    }
  } catch (error) {
    console.error("❌ Portrait oluşturma hatası:", error);
    throw error;
  }
}

// Arkaplan silme fonksiyonu
async function removeBackgroundFromImage(imageUrl, userId) {
  try {
    console.log("🖼️ Arkaplan silme işlemi başlatılıyor:", imageUrl);

    // Önce dahili removeBg API'sini kullan (removeBg.js → /api/remove-background)
    try {
      const internalPort = process.env.PORT || 3001;
      const internalBaseUrl =
        process.env.INTERNAL_API_BASE_URL ||
        `https://dires-server.onrender.com:${internalPort}`;
      const endpoint = `${internalBaseUrl}/api/remove-background`;
      console.log("🔗 Dahili removeBg API çağrısı:", endpoint);

      const apiResp = await axios.post(
        endpoint,
        { imageUrl, userId },
        { timeout: 120000 }
      );

      const removedBgUrl =
        apiResp?.data?.removedBgUrl || apiResp?.data?.result?.removed_bg_url;
      if (removedBgUrl && typeof removedBgUrl === "string") {
        console.log("✅ removeBg API sonucu alındı:", removedBgUrl);
        return removedBgUrl;
      } else {
        console.warn(
          "⚠️ removeBg API beklenen alanları döndürmedi, yerel pipeline'a düşülüyor",
          apiResp?.data
        );
      }
    } catch (apiError) {
      console.warn(
        "⚠️ removeBg API çağrısı başarısız, yerel pipeline'a düşülüyor:",
        apiError.message
      );
    }

    // Orijinal fotoğrafın metadata bilgilerini al (orientation için)
    let originalMetadata = null;
    let originalImageBuffer = null;

    try {
      console.log("📐 Orijinal fotoğrafın metadata bilgileri alınıyor...");
      const originalResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000, // 30 saniye timeout
      });
      originalImageBuffer = Buffer.from(originalResponse.data);

      // Sharp ile metadata al
      originalMetadata = await sharp(originalImageBuffer).metadata();
      console.log("📐 Orijinal metadata:", {
        width: originalMetadata.width,
        height: originalMetadata.height,
        orientation: originalMetadata.orientation,
        format: originalMetadata.format,
      });
    } catch (metadataError) {
      console.error("⚠️ Orijinal metadata alınamadı:", metadataError.message);
    }

    // Replicate API'ye arkaplan silme isteği gönder
    const backgroundRemovalResponse = await axios.post(
      "https://api.replicate.com/v1/predictions",
      {
        version:
          "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
        input: {
          image: imageUrl,
          format: "png",
          reverse: false,
          threshold: 0,
          background_type: "white",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const initialResult = backgroundRemovalResponse.data;
    console.log("🖼️ Arkaplan silme başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error(
        "❌ Arkaplan silme prediction ID alınamadı:",
        initialResult
      );
      throw new Error("Background removal prediction başlatılamadı");
    }

    // Prediction durumunu polling ile takip et
    console.log("🔄 Arkaplan silme işlemi polling başlatılıyor...");
    const finalResult = await pollReplicateResult(initialResult.id, 30); // 30 deneme (1 dakika)

    if (finalResult.status === "succeeded" && finalResult.output) {
      console.log("✅ Arkaplan silme işlemi başarılı:", finalResult.output);

      // Arkaplanı silinmiş resmi indir ve orientation düzeltmesi yap
      let processedImageUrl;

      try {
        console.log(
          "🔄 Arkaplanı silinmiş resim orientation kontrolü yapılıyor..."
        );

        // Arkaplanı silinmiş resmi indir
        const processedResponse = await axios.get(finalResult.output, {
          responseType: "arraybuffer",
          timeout: 30000, // 30 saniye timeout
        });
        let processedImageBuffer = Buffer.from(processedResponse.data);

        // Eğer orijinal metadata varsa orientation kontrolü yap
        if (originalMetadata) {
          const processedMetadata = await sharp(
            processedImageBuffer
          ).metadata();
          console.log("📐 İşlenmiş resim metadata:", {
            width: processedMetadata.width,
            height: processedMetadata.height,
            orientation: processedMetadata.orientation,
            format: processedMetadata.format,
          });

          // Orientation farkını kontrol et
          const originalOrientation = originalMetadata.orientation || 1;
          const processedOrientation = processedMetadata.orientation || 1;

          // Boyut oranlarını karşılaştır (dikey/yatay değişim kontrolü)
          const originalIsPortrait =
            originalMetadata.height > originalMetadata.width;
          const processedIsPortrait =
            processedMetadata.height > processedMetadata.width;

          console.log("📐 Orientation karşılaştırması:", {
            originalOrientation,
            processedOrientation,
            originalIsPortrait,
            processedIsPortrait,
            orientationChanged: originalOrientation !== processedOrientation,
            aspectRatioChanged: originalIsPortrait !== processedIsPortrait,
          });

          // Eğer orientation farklıysa veya aspect ratio değiştiyse düzelt
          if (
            originalOrientation !== processedOrientation ||
            originalIsPortrait !== processedIsPortrait
          ) {
            console.log("🔄 Orientation düzeltmesi yapılıyor...");

            let sharpInstance = sharp(processedImageBuffer);

            // Orijinal orientation'ı uygula
            if (originalOrientation && originalOrientation !== 1) {
              // EXIF orientation değerlerine göre döndürme
              switch (originalOrientation) {
                case 2:
                  sharpInstance = sharpInstance.flop();
                  break;
                case 3:
                  sharpInstance = sharpInstance.rotate(180);
                  break;
                case 4:
                  sharpInstance = sharpInstance.flip();
                  break;
                case 5:
                  sharpInstance = sharpInstance.rotate(270).flop();
                  break;
                case 6:
                  sharpInstance = sharpInstance.rotate(90);
                  break;
                case 7:
                  sharpInstance = sharpInstance.rotate(90).flop();
                  break;
                case 8:
                  sharpInstance = sharpInstance.rotate(270);
                  break;
                default:
                  // Eğer aspect ratio değiştiyse basit döndürme yap
                  if (originalIsPortrait && !processedIsPortrait) {
                    sharpInstance = sharpInstance.rotate(90);
                  } else if (!originalIsPortrait && processedIsPortrait) {
                    sharpInstance = sharpInstance.rotate(-90);
                  }
              }
            } else if (originalIsPortrait !== processedIsPortrait) {
              // EXIF bilgisi yoksa sadece aspect ratio kontrolü yap
              if (originalIsPortrait && !processedIsPortrait) {
                console.log("🔄 Yataydan dikeye döndürülüyor...");
                sharpInstance = sharpInstance.rotate(90);
              } else if (!originalIsPortrait && processedIsPortrait) {
                console.log("🔄 Dikeyden yataya döndürülüyor...");
                sharpInstance = sharpInstance.rotate(-90);
              }
            }

            // Düzeltilmiş resmi buffer'a çevir
            processedImageBuffer = await sharpInstance
              .png({ quality: 100, progressive: true })
              .toBuffer();

            const correctedMetadata = await sharp(
              processedImageBuffer
            ).metadata();
            console.log("✅ Orientation düzeltmesi tamamlandı:", {
              width: correctedMetadata.width,
              height: correctedMetadata.height,
              orientation: correctedMetadata.orientation,
            });
          } else {
            console.log(
              "✅ Orientation düzeltmesi gerekmiyor, resim doğru pozisyonda"
            );
          }
        }

        // Trim artık dahili removeBg API tarafından yapılıyor; doğrudan yükle
        processedImageUrl = await uploadProcessedImageBufferToSupabase(
          processedImageBuffer,
          userId,
          "background_removed"
        );
      } catch (orientationError) {
        console.error(
          "❌ Orientation düzeltme hatası:",
          orientationError.message
        );
        console.log(
          "⚠️ Orientation düzeltmesi başarısız, orijinal işlenmiş resim kullanılacak"
        );

        // Fallback: Orijinal işlenmiş resmi direkt yükle
        processedImageUrl = await uploadProcessedImageToSupabase(
          finalResult.output,
          userId,
          "background_removed"
        );
      }

      return processedImageUrl;
    } else {
      console.error("❌ Arkaplan silme işlemi başarısız:", finalResult);
      throw new Error(finalResult.error || "Background removal failed");
    }
  } catch (error) {
    console.error("❌ Arkaplan silme hatası:", error);
    // Hata durumunda orijinal resmi döndür
    console.log("⚠️ Arkaplan silme başarısız, orijinal resim kullanılacak");
    return imageUrl;
  }
}

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

// Sharp ile yerel ControlNet Canny çıkarma fonksiyonu (API'siz)
// async function generateLocalControlNetCanny(imageUrl, userId) {
//   try {
//     console.log(
//       "🎨 Yerel ControlNet Canny çıkarma işlemi başlatılıyor:",
//       imageUrl
//     );

//     // Resmi indir
//     const imageResponse = await axios.get(imageUrl, {
//       responseType: "arraybuffer",
//       timeout: 15000,
//     });
//     const imageBuffer = Buffer.from(imageResponse.data);

//     console.log("📐 Resim boyutları alınıyor ve edge detection yapılıyor...");

//     // Sharp ile edge detection (Canny benzeri)
//     const cannyBuffer = await sharp(imageBuffer)
//       .greyscale() // Önce gri tonlama
//       .normalize() // Kontrast artırma
//       .convolve({
//         width: 3,
//         height: 3,
//         kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], // Edge detection kernel
//       })
//       .threshold(128) // Eşikleme (siyah-beyaz)
//       .negate() // Renkleri ters çevir (beyaz kenarlar için)
//       .png()
//       .toBuffer();

//     console.log("✅ Yerel edge detection tamamlandı");

//     // İşlenmiş resmi Supabase'e yükle
//     const timestamp = Date.now();
//     const randomId = require("uuid").v4().substring(0, 8);
//     const fileName = `local_canny_${
//       userId || "anonymous"
//     }_${timestamp}_${randomId}.png`;

//     const { data, error } = await supabase.storage
//       .from("reference")
//       .upload(fileName, cannyBuffer, {
//         contentType: "image/png",
//         cacheControl: "3600",
//         upsert: false,
//       });

//     if (error) {
//       console.error("❌ Yerel Canny resmi Supabase'e yüklenemedi:", error);
//       throw new Error(`Supabase upload error: ${error.message}`);
//     }

//     // Public URL al
//     const { data: urlData } = supabase.storage
//       .from("reference")
//       .getPublicUrl(fileName);

//     console.log("✅ Yerel ControlNet Canny URL'si:", urlData.publicUrl);
//     return urlData.publicUrl;
//   } catch (error) {
//     console.error("❌ Yerel ControlNet Canny hatası:", error);
//     throw new Error(`Local ControlNet Canny failed: ${error.message}`);
//   }
// }

// İki resmi yan yana birleştiren fonksiyon (orijinal + canny)
// async function combineTwoImagesWithBlackLine(
//   originalImageUrl,
//   cannyImageUrl,
//   userId
// ) {
//   try {
//     console.log("🎨 İki resim yan yana birleştiriliyor (siyah çizgi ile)...");
//     console.log("🖼️ Orijinal resim:", originalImageUrl);
//     console.log("🎨 Canny resim:", cannyImageUrl);

//     const loadedImages = [];

//     // Orijinal resmi yükle
//     try {
//       const originalResponse = await axios.get(originalImageUrl, {
//         responseType: "arraybuffer",
//         timeout: 15000,
//       });
//       const originalBuffer = Buffer.from(originalResponse.data);

//       const processedOriginalBuffer = await sharp(originalBuffer)
//         .jpeg({ quality: 100, progressive: true, mozjpeg: true })
//         .toBuffer();

//       const originalImg = await loadImage(processedOriginalBuffer);
//       loadedImages.push({ img: originalImg, type: "original" });

//       console.log(
//         `✅ Orijinal resim yüklendi: ${originalImg.width}x${originalImg.height}`
//       );
//     } catch (originalError) {
//       console.error(
//         "❌ Orijinal resim yüklenirken hata:",
//         originalError.message
//       );
//       throw new Error("Orijinal resim yüklenemedi");
//     }

//     // Canny resmi yükle
//     if (cannyImageUrl) {
//       try {
//         const cannyResponse = await axios.get(cannyImageUrl, {
//           responseType: "arraybuffer",
//           timeout: 15000,
//         });
//         const cannyBuffer = Buffer.from(cannyResponse.data);

//         const processedCannyBuffer = await sharp(cannyBuffer)
//           .jpeg({ quality: 100, progressive: true, mozjpeg: true })
//           .toBuffer();

//         const cannyImg = await loadImage(processedCannyBuffer);
//         loadedImages.push({ img: cannyImg, type: "canny" });

//         console.log(
//           `✅ Canny resim yüklendi: ${cannyImg.width}x${cannyImg.height}`
//         );
//       } catch (cannyError) {
//         console.error("❌ Canny resim yüklenirken hata:", cannyError.message);
//         // Canny yüklenemezse orijinal resmi tekrar kullan
//         loadedImages.push({ img: loadedImages[0].img, type: "canny_fallback" });
//       }
//     } else {
//       // Canny yoksa orijinal resmi tekrar kullan
//       loadedImages.push({ img: loadedImages[0].img, type: "canny_fallback" });
//     }

//     // Aynı yüksekliğe getir
//     const targetHeight = Math.min(
//       ...loadedImages.map((item) => item.img.height)
//     );

//     const originalScaledWidth =
//       (loadedImages[0].img.width * targetHeight) / loadedImages[0].img.height;
//     const cannyScaledWidth =
//       (loadedImages[1].img.width * targetHeight) / loadedImages[1].img.height;

//     const blackLineWidth = 4; // Siyah çizgi kalınlığı
//     const canvasWidth = originalScaledWidth + cannyScaledWidth + blackLineWidth;
//     const canvasHeight = targetHeight;

//     console.log(
//       `📏 İki resimli birleştirilmiş canvas boyutu: ${canvasWidth}x${canvasHeight}`
//     );

//     // Canvas oluştur
//     const canvas = createCanvas(canvasWidth, canvasHeight);
//     const ctx = canvas.getContext("2d");

//     // Canvas kalite ayarları
//     ctx.imageSmoothingEnabled = true;
//     ctx.imageSmoothingQuality = "high";
//     ctx.patternQuality = "best";
//     ctx.textRenderingOptimization = "optimizeQuality";

//     // Beyaz arka plan
//     ctx.fillStyle = "white";
//     ctx.fillRect(0, 0, canvasWidth, canvasHeight);

//     // 1. Orijinal resmi sol tarafa yerleştir
//     ctx.drawImage(loadedImages[0].img, 0, 0, originalScaledWidth, targetHeight);
//     console.log(
//       `🖼️ Orijinal resim yerleştirildi: (0, 0) - ${originalScaledWidth}x${targetHeight}`
//     );

//     // Siyah çizgi
//     ctx.fillStyle = "black";
//     ctx.fillRect(originalScaledWidth, 0, blackLineWidth, targetHeight);
//     console.log(
//       `⚫ Siyah çizgi çizildi: (${originalScaledWidth}, 0) - ${blackLineWidth}x${targetHeight}`
//     );

//     // 2. Canny resmi sağ tarafa yerleştir
//     ctx.drawImage(
//       loadedImages[1].img,
//       originalScaledWidth + blackLineWidth,
//       0,
//       cannyScaledWidth,
//       targetHeight
//     );
//     console.log(
//       `🎨 Canny resim yerleştirildi: (${
//         originalScaledWidth + blackLineWidth
//       }, 0) - ${cannyScaledWidth}x${targetHeight}`
//     );

//     // Canvas'ı buffer'a çevir
//     const buffer = canvas.toBuffer("image/png");
//     console.log(
//       "📊 İki resimli birleştirilmiş resim boyutu:",
//       buffer.length,
//       "bytes"
//     );

//     // Supabase'e yükle
//     const timestamp = Date.now();
//     const randomId = uuidv4().substring(0, 8);
//     const fileName = `combined_canny_controlnet_${
//       userId || "anonymous"
//     }_${timestamp}_${randomId}.png`;

//     const { data, error } = await supabase.storage
//       .from("reference")
//       .upload(fileName, buffer, {
//         contentType: "image/png",
//         cacheControl: "3600",
//         upsert: false,
//       });

//     if (error) {
//       console.error(
//         "❌ İki resimli birleştirilmiş resim Supabase'e yüklenemedi:",
//         error
//       );
//       throw new Error(`Supabase upload error: ${error.message}`);
//     }

//     const { data: urlData } = supabase.storage
//       .from("reference")
//       .getPublicUrl(fileName);

//     console.log(
//       "✅ 🎉 İki resimli ControlNet birleştirilmiş resim URL'si:",
//       urlData.publicUrl
//     );
//     return urlData.publicUrl;
//   } catch (error) {
//     console.error("❌ İki resimli ControlNet birleştirme hatası:", error);
//     throw error;
//   }
// }

// Replicate prediction durumunu kontrol eden fonksiyon
// Flux-kontext-dev ile alternatif API çağrısı
async function callFluxKontextDevAPI(
  enhancedPrompt,
  inputImageUrl,
  aspectRatio
) {
  try {
    console.log("🔄 Flux-kontext-dev API'ye geçiş yapılıyor...");

    const seed = Math.floor(Math.random() * 2 ** 32);
    console.log(`🎲 Alternatif API için random seed: ${seed}`);

    const response = await axios.post(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-dev/predictions",
      {
        input: {
          prompt: enhancedPrompt,
          go_fast: false,
          guidance: 2.5,
          input_image: inputImageUrl,
          aspect_ratio: aspectRatio,
          output_format: "jpg",
          output_quality: 100,
          num_inference_steps: 30,
          disable_safety_checker: true,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        timeout: 300000, // 5 dakika timeout (flux-kontext-dev daha uzun sürebilir)
      }
    );

    console.log("✅ Flux-kontext-dev API başarılı:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Flux-kontext-dev API hatası:", error.message);
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
          timeout: 30000, // 30 saniye timeout polling için
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
            result.error.includes("code: PA"))
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
            "❌ Content moderation/model hatası tespit edildi, flux-kontext-dev'e geçiş yapılacak:",
            result.error
          );
          throw new Error("SENSITIVE_CONTENT_FLUX_FALLBACK");
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
          "❌ Sensitive content hatası, flux-kontext-dev'e geçiş için polling durduruluyor"
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
            timeout: 30000, // 30 saniye timeout
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

// Arkaplanı kaldırılmış ürün + (opsiyonel) pose ve (opsiyonel) location görsellerini
// tek bir yatay kompozitte birleştirir ve Supabase'e yükler
async function combineReferenceAssets(
  backgroundRemovedUrl,
  poseUrl,
  locationUrl,
  userId
) {
  try {
    const assetUrls = [backgroundRemovedUrl, poseUrl, locationUrl].filter(
      (u) => typeof u === "string" && u.trim().length > 0
    );

    // En az 1 görsel şart (arkaplan kaldırılmış)
    if (assetUrls.length === 0) {
      throw new Error("combineReferenceAssets: no valid assets to combine");
    }

    // Tüm görselleri indir → (ilk ürün görseli için 1024x1024 beyaz zemin içinde ortalama) → diğerlerini JPEG'e çevir → loadImage ile yükle
    const loadedImages = [];
    for (let i = 0; i < assetUrls.length; i++) {
      const url = assetUrls[i].split("?")[0];
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
        });
        const buffer = Buffer.from(response.data);

        let processed;
        if (i === 0) {
          // Sadece arkaplanı kaldırılmış TRIM'lenmiş ürün görselini 1024x1024 beyaz zemine yerleştir
          const resized = await sharp(buffer)
            .resize(1024, 1024, { fit: "inside", withoutEnlargement: false })
            .png()
            .toBuffer();

          const whiteSquare = await sharp({
            create: {
              width: 1024,
              height: 1024,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          })
            .composite([{ input: resized, gravity: "center" }])
            .png()
            .toBuffer();

          processed = whiteSquare;
        } else {
          // Diğer varlıklar (portrait/location) için JPEG yeterli
          processed = await sharp(buffer)
            .jpeg({ quality: 90, progressive: true, mozjpeg: true })
            .toBuffer();
        }

        const img = await loadImage(processed);
        loadedImages.push(img);
      } catch (err) {
        console.error(
          `❌ combineReferenceAssets: asset ${i + 1} yüklenemedi:`,
          err.message
        );
      }
    }

    if (loadedImages.length === 0) {
      // Hiçbiri yüklenemediyse asıl görseli geri döndür
      return backgroundRemovedUrl;
    }

    // Yatay birleşim: tümünü aynı yüksekliğe ölçekle
    const targetHeight = Math.min(...loadedImages.map((img) => img.height));
    const widths = loadedImages.map(
      (img) => (img.width * targetHeight) / img.height
    );
    const canvasWidth = widths.reduce((a, b) => a + b, 0);
    const canvasHeight = targetHeight;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    let currentX = 0;
    for (let i = 0; i < loadedImages.length; i++) {
      const img = loadedImages[i];
      const drawWidth = widths[i];
      ctx.drawImage(img, currentX, 0, drawWidth, targetHeight);
      currentX += drawWidth;
    }

    const combinedBuffer = canvas.toBuffer("image/jpeg", { quality: 0.9 });
    const publicUrl = await uploadProcessedImageBufferToSupabase(
      combinedBuffer,
      userId,
      "combined_assets"
    );
    return publicUrl;
  } catch (error) {
    console.error("❌ combineReferenceAssets hatası:", error.message);
    // Hata durumunda arkaplanı kaldırılmış görseli geri döndür
    return backgroundRemovedUrl;
  }
}

// Ana generate endpoint'i - Tek resim için
router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme
  const CREDIT_COST = 20; // Her oluşturma 20 kredi
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
      finalImage = await combineImagesOnCanvas(
        referenceImages,
        userId,
        isMultipleProducts
      );

      // Birleştirilmiş resmi geçici dosyalar listesine ekle
      temporaryFiles.push(finalImage);
    } else {
      // Tek resim için normal işlem
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

      finalImage = await uploadReferenceImageToSupabase(
        imageSourceForUpload,
        userId
      );
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

      const backgroundRemovalPromise = removeBackgroundFromImage(
        finalImage,
        userId
      );

      // ⏳ Gemini ve arkaplan silme işlemlerini paralel bekle
      console.log("⏳ Gemini ve arkaplan silme paralel olarak bekleniyor...");
      [enhancedPrompt, backgroundRemovedImage] = await Promise.all([
        geminiPromise,
        backgroundRemovalPromise,
      ]);
    }

    console.log("✅ Gemini prompt iyileştirme tamamlandı");
    console.log("✅ Arkaplan silme tamamlandı:", backgroundRemovedImage);

    // Geçici dosyayı silme listesine ekle
    temporaryFiles.push(backgroundRemovedImage);

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

    // 👤 Portre üret (Flux.1-dev) ve varlıkları birleştir
    let portraitImageUrl = null;
    try {
      const genderForPortrait = (settings && settings.gender) || "female";
      const portraitPrompt = await generatePortraitPromptWithGemini(
        settings || {},
        genderForPortrait
      );
      portraitImageUrl = await generatePortraitWithFluxDev(portraitPrompt);
    } catch (portraitErr) {
      console.warn(
        "⚠️ Portrait üretimi başarısız, sadece mevcut varlıklar kullanılacak:",
        portraitErr.message
      );
    }

    // 🖼️ Çekirdek referans varlıklarını yatay kompozitte birleştir (Canvas bağımsız)
    // Arkaplanı kaldırılmış ürün + (varsa) portrait + (varsa) location
    let combinedImageForReplicate = await combineReferenceAssets(
      backgroundRemovedImage,
      portraitImageUrl,
      locationImage,
      userId
    );
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

    // Replicate API'ye retry mekanizması ile istek gönder
    let replicateResponse;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Replicate API attempt ${attempt}/${maxRetries}`);

        // Random seed her seferinde farklı olsun
        const seed = Math.floor(Math.random() * 2 ** 32);
        console.log(`🎲 Random seed: ${seed}`);

        replicateResponse = await axios.post(
          "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions",
          {
            input: {
              prompt: enhancedPrompt,
              input_image: combinedImageForReplicate, // Birleştirilmiş resim Replicate için
              aspect_ratio: formattedRatio,
              disable_safety_checker: true,
              seed: seed, // Random seed eklendi
              num_inference_steps: 50,
              output_quality: 100,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 120000, // 2 dakika timeout
          }
        );

        console.log(`✅ Replicate API başarılı (attempt ${attempt})`);
        break; // Başarılı olursa loop'tan çık
      } catch (apiError) {
        console.error(
          `❌ Replicate API attempt ${attempt} failed:`,
          apiError.message
        );

        // Son deneme değilse ve timeout hatası ise tekrar dene
        if (
          attempt < maxRetries &&
          (apiError.code === "ETIMEDOUT" ||
            apiError.code === "ECONNRESET" ||
            apiError.code === "ENOTFOUND" ||
            apiError.message.includes("timeout"))
        ) {
          const waitTime = attempt * 2000; // 2s, 4s, 6s bekle
          console.log(`⏳ ${waitTime}ms bekleniyor, sonra tekrar denenecek...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

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

    // Prediction durumunu polling ile takip et
    const startTime = Date.now();
    let finalResult;
    let processingTime;

    try {
      finalResult = await pollReplicateResult(initialResult.id);
      processingTime = Math.round((Date.now() - startTime) / 1000);
    } catch (pollingError) {
      console.error("❌ Polling hatası:", pollingError.message);

      // Content moderation hatası yakalandıysa flux-kontext-dev'e geç
      if (pollingError.message === "SENSITIVE_CONTENT_FLUX_FALLBACK") {
        console.log(
          "🔄 Content moderation/model hatası nedeniyle flux-kontext-dev'e geçiliyor..."
        );

        try {
          // Flux-kontext-dev API'ye geçiş yap
          const fallbackStartTime = Date.now();
          finalResult = await callFluxKontextDevAPI(
            enhancedPrompt,
            combinedImageForReplicate,
            formattedRatio
          );
          processingTime = Math.round((Date.now() - fallbackStartTime) / 1000);

          console.log(
            "✅ Flux-kontext-dev API'den başarılı sonuç alındı - kullanıcıya başarılı olarak döndürülecek"
          );
          console.log(
            "🔍 [DEBUG] Fallback finalResult:",
            JSON.stringify(finalResult, null, 2)
          );
          console.log(
            "🔍 [DEBUG] Fallback finalResult.output:",
            finalResult.output
          );
          console.log("🔍 [DEBUG] Fallback finalResult.id:", finalResult.id);

          // 🔄 Fallback API başarılı, status'u hemen "completed" olarak güncelle
          await updateGenerationStatus(finalGenerationId, userId, "completed", {
            enhanced_prompt: enhancedPrompt,
            result_image_url: finalResult.output,
            replicate_prediction_id: finalResult.id, // Fallback API'nin ID'si
            processing_time_seconds: processingTime,
            fallback_used: "flux-kontext-dev", // Fallback kullanıldığını belirtmek için
          });

          console.log(
            "✅ Database'de generation status 'completed' olarak güncellendi (fallback)"
          );

          // 💳 Fallback başarılı, güncel kredi bilgisini al ve response döndür
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
                `💳 Güncel kredi balance (fallback): ${currentCredit}`
              );
            } catch (creditError) {
              console.error(
                "❌ Güncel kredi sorgu hatası (fallback):",
                creditError
              );
            }
          }

          // 🗑️ Fallback başarılı, geçici dosyaları temizle
          console.log("🧹 Fallback başarılı, geçici dosyalar temizleniyor...");
          await cleanupTemporaryFiles(temporaryFiles);

          // ✅ Fallback başarılı response'u döndür
          console.log(
            "🎯 [DEBUG] Fallback başarılı, response döndürülüyor - normal flow'a GİRMEYECEK"
          );
          return res.status(200).json({
            success: true,
            result: {
              imageUrl: finalResult.output,
              originalPrompt: promptText,
              enhancedPrompt: enhancedPrompt,
              replicateData: finalResult,
              currentCredit: currentCredit,
              generationId: finalGenerationId,
              fallbackUsed: "flux-kontext-dev", // Client'a fallback kullanıldığını bildir
            },
          });
        } catch (fallbackError) {
          console.error(
            "❌ Flux-kontext-dev API'si de başarısız:",
            fallbackError.message
          );

          // ❌ Status'u failed'e güncelle (Fallback API da başarısız)
          await updateGenerationStatus(finalGenerationId, userId, "failed", {
            // error_message kolonu yok, bu yüzden genel field kullan
            processing_time_seconds: 0,
          });

          // 🗑️ Fallback API hatası durumunda geçici dosyaları temizle
          console.log(
            "🧹 Fallback API hatası sonrası geçici dosyalar temizleniyor..."
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
                    (currentUserCredit?.credit_balance || 0) +
                    actualCreditDeducted,
                })
                .eq("id", userId);

              console.log(
                `💰 ${actualCreditDeducted} kredi iade edildi (Fallback API hatası)`
              );
            } catch (refundError) {
              console.error("❌ Kredi iade hatası:", refundError);
            }
          }

          return res.status(500).json({
            success: false,
            result: {
              message: "Görsel işleme işlemi başarısız oldu",
              error:
                "İşlem sırasında teknik bir sorun oluştu. Lütfen tekrar deneyin.",
            },
          });
        }
      } else {
        // Diğer polling hataları için mevcut mantığı kullan

        // ❌ Status'u failed'e güncelle
        await updateGenerationStatus(finalGenerationId, userId, "failed", {
          // error_message kolonu yok, bu yüzden genel field kullan
          processing_time_seconds: 0,
        });

        // 🗑️ Polling hatası durumunda geçici dosyaları temizle
        console.log(
          "🧹 Polling hatası sonrası geçici dosyalar temizleniyor..."
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
                  (currentUserCredit?.credit_balance || 0) +
                  actualCreditDeducted,
              })
              .eq("id", userId);

            console.log(
              `💰 ${actualCreditDeducted} kredi iade edildi (Polling hatası)`
            );
          } catch (refundError) {
            console.error("❌ Kredi iade hatası:", refundError);
          }
        }

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

    // Gemini 2.0 Flash modeli
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_ONLY_HIGH",
        },
      ],
    });

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
          timeout: 30000,
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
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: parts,
        },
      ],
    });

    const poseDescription = result.response.text().trim();
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

    console.log(
      `🔍 Generation status sorgusu: ${generationId} (User: ${userId})`
    );

    // Generation'ı sorgula
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("generation_id", generationId)
      .eq("user_id", userId);

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
      console.log(
        `❌ Generation bulunamadı: ${generationId} (User: ${userId})`
      );
      return res.status(404).json({
        success: false,
        result: {
          message: "Generation bulunamadı",
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
