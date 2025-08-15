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

// Location image'ın URL'sini normalize eder: string ya da {uri} olabilir
function getLocationImageUrl(locationImage) {
  try {
    if (!locationImage) return null;
    if (typeof locationImage === "string") return locationImage;
    if (typeof locationImage === "object") {
      if (locationImage.uri && typeof locationImage.uri === "string") {
        return locationImage.uri;
      }
      if (locationImage.url && typeof locationImage.url === "string") {
        return locationImage.url;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

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

    // Dosya formatını belirle
    let fileExtension = ".jpg";
    let contentType = "image/jpeg";

    if (imageUri.startsWith("data:image/png")) {
      fileExtension = ".png";
      contentType = "image/png";
    }

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_reference_${
      userId || "anonymous"
    }_${randomId}${fileExtension}`;

    console.log("Supabase'e yüklenecek dosya adı:", fileName);
    console.log("Content type:", contentType);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, imageBuffer, {
        contentType: contentType,
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

// Canvas + Portrait + Location için 3'lü birleştirme
async function combineThreeImagesCanvasPortraitLocation(
  canvasImageUrl,
  portraitImageUrl,
  locationImageUrl,
  userId
) {
  try {
    console.log(
      "🎨 [3-IMAGE CPL] Üç resim birleştiriliyor (Canvas + Portrait + Location)..."
    );
    console.log("🎨 [3-IMAGE CPL] Canvas:", canvasImageUrl);
    console.log("🎨 [3-IMAGE CPL] Portrait:", portraitImageUrl);
    console.log("🎨 [3-IMAGE CPL] Location:", locationImageUrl);

    const [canvasResponse, portraitResponse, locationResponse] =
      await Promise.all([
        axios.get(canvasImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
        axios.get(portraitImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
        axios.get(locationImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
      ]);

    const canvasBuffer = Buffer.from(canvasResponse.data);
    const portraitBuffer = Buffer.from(portraitResponse.data);
    const locationBuffer = Buffer.from(locationResponse.data);

    const canvasMetadata = await sharp(canvasBuffer).metadata();
    const portraitMetadata = await sharp(portraitBuffer).metadata();
    const locationMetadata = await sharp(locationBuffer).metadata();

    const maxHeight = Math.max(
      canvasMetadata.height,
      portraitMetadata.height,
      locationMetadata.height
    );

    const resizedCanvas = await sharp(canvasBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const resizedPortrait = await sharp(portraitBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const resizedLocation = await sharp(locationBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const resizedCanvasMetadata = await sharp(resizedCanvas).metadata();
    const resizedPortraitMetadata = await sharp(resizedPortrait).metadata();
    const resizedLocationMetadata = await sharp(resizedLocation).metadata();

    const spacing = 5;
    const totalWidth =
      resizedCanvasMetadata.width +
      resizedPortraitMetadata.width +
      resizedLocationMetadata.width +
      spacing * 2;

    const combinedImage = await sharp({
      create: {
        width: totalWidth,
        height: maxHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: resizedCanvas, top: 0, left: 0 },
        {
          input: resizedPortrait,
          top: 0,
          left: resizedCanvasMetadata.width + spacing,
        },
        {
          input: resizedLocation,
          top: 0,
          left:
            resizedCanvasMetadata.width +
            resizedPortraitMetadata.width +
            spacing * 2,
        },
      ])
      .png()
      .toBuffer();

    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `three_images_cpl_${timestamp}_${
      userId || "anonymous"
    }_${randomId}.png`;

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, combinedImage, { contentType: "image/png" });

    if (uploadError) throw uploadError;

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage.from("images").getPublicUrl(fileName);

    if (publicUrlError) throw publicUrlError;

    const combinedImageUrl = publicUrlData.publicUrl;
    console.log("✅ [3-IMAGE CPL] Birleştirme tamamlandı:", combinedImageUrl);
    return combinedImageUrl;
  } catch (error) {
    console.error("❌ [3-IMAGE CPL] Üç resim birleştirme hatası:", error);
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

// Prompt'u iyileştirmek için Gemini'yi kullan
async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false,
  hasControlNet = false,
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

    // Gemini 2.0 Flash modeli - En yeni API yapısı
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

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
      // Yetişkin mantığı
      if (genderLower === "male" || genderLower === "man") {
        modelGenderText = "male model";
      } else if (genderLower === "female" || genderLower === "woman") {
        modelGenderText = "female model";
      } else {
        modelGenderText = "female model"; // varsayılan
      }
      baseModelText = modelGenderText; // age'siz sürüm

      // Eğer yaş bilgisini yetişkinlerde kullanmak istersen
      if (age) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? `${age} male model`
            : `${age} female model`;
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

    // Eğer yaş 0-12 arası ise bebek/çocuk stili prompt yönlendirmesi ver
    let childPromptSection = "";
    const parsedAge = parseInt(age, 10);
    if (!isNaN(parsedAge) && parsedAge <= 16) {
      if (parsedAge <= 1) {
        // Baby-specific instructions (0-1 yaş)
        childPromptSection = `
    
🍼 BABY MODEL REQUIREMENTS (Age: ${parsedAge}):
CRITICAL: The model is a BABY (infant). This is MANDATORY - the model MUST clearly appear as a baby, not a child or adult.

BABY PHYSICAL CHARACTERISTICS (MANDATORY):
- Round, chubby baby cheeks
- Large head proportional to baby body
- Small baby hands and feet  
- Soft baby skin texture
- Infant body proportions (large head, short limbs, rounded belly)
- Baby-appropriate facial features (button nose, wide eyes, soft expressions)
- NO mature or adult-like features whatsoever

BABY DESCRIPTION FORMAT (MANDATORY):
Start the description like this: "A ${parsedAge}-year-old baby ${
          genderLower === "male" || genderLower === "man" ? "boy" : "girl"
        } (infant) is wearing..."
Then add: "Make sure he/she is clearly a baby: chubby cheeks, small body proportions, baby hands and feet."

BABY POSE REQUIREMENTS:
- Sitting, lying, or being gently supported poses only
- Natural baby movements (reaching, playing, looking around)
- NO standing poses unless developmentally appropriate
- NO complex or posed gestures
- Relaxed, natural baby positioning

This is an INFANT/BABY model. The result MUST show a clear baby, not a child or adult.`;
      } else if (parsedAge <= 3) {
        // Toddler-specific instructions (2-3 yaş)
        childPromptSection = `
    
👶 TODDLER MODEL REQUIREMENTS (Age: ${parsedAge}):
The model is a TODDLER. Use toddler-appropriate physical descriptions and poses.

TODDLER CHARACTERISTICS:
- Toddler proportions (chubby cheeks, shorter limbs)
- Round facial features appropriate for age ${parsedAge}
- Natural toddler expressions (curious, playful, gentle)
- Age-appropriate body proportions

DESCRIPTION FORMAT:
Include phrases like "toddler proportions", "chubby cheeks", "gentle expression", "round facial features".

This is a TODDLER model, not an adult.`;
      } else {
        // Child/teenage instructions (4-16 yaş)
        childPromptSection = `
    
⚠️ AGE-SPECIFIC STYLE RULES FOR CHILD MODELS:
The model described is a child aged ${parsedAge}. Please follow these mandatory restrictions and stylistic adjustments:
- Use age-appropriate physical descriptions, such as "child proportions", "gentle expression", "soft hair", or "youthful facial features".
- Avoid all adult modeling language (e.g., "confident pose", "elegant posture", "sharp cheekbones", "stylish demeanor").
- The model must appear natural, playful, and age-authentic — do NOT exaggerate facial structure or maturity.
- The model's pose should be passive, playful, or relaxed. DO NOT use assertive, posed, or seductive body language.
- Do NOT reference any makeup, mature accessories, or adult modeling presence.
- Ensure lighting and presentation is soft, clean, and suited for editorial children's fashion catalogs.
- Overall expression and body language must align with innocence, comfort, and simplicity.

This is a child model. Avoid inappropriate styling, body-focused language, or any pose/expression that could be misinterpreted.`;
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
            key !== "type" // Body measurements'ları hariç tut
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      console.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      console.log("📝 [BACKEND GEMINI] Settings text:", settingsText);

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
          key !== "type" // Body measurements'ları hariç tut
      )
      .map(
        ([key, value]) =>
          `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`
      )
      .join("\n    ")}
    
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

    // Location bilgisi için ek prompt section
    let locationPromptSection = "";
    if (locationImage) {
      locationPromptSection = `
    
    LOCATION REFERENCE: A location reference image has been provided to help you understand the desired environment/background setting. Please analyze this location image carefully and incorporate its environmental characteristics, lighting style, architecture, mood, and atmosphere into your enhanced prompt. This location should influence the background, lighting conditions, and overall scene composition in your description.`;

      console.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

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

    // Gemini'ye gönderilecek metin - Edit mode vs Color change vs Normal replace
    const criticalDirectives = `
    BRAND SAFETY: If the input image contains any brand names or logos (e.g., Nike, Adid<as, Prada, Gucci, Louis Vuitton, Chanel, Balenciaga, Versace, Dior, Hermès), DO NOT mention any brand names in your output. Refer to them generically (e.g., "brand label", "logo") without naming the brand.
    LENGTH CONSTRAINT: Your entire output MUST be no longer than 512 tokens. Keep it concise and within 512 tokens maximum.`;

    // Flux Max için genel garment transform talimatları (genel, ürün-özel olmayan)
    const fluxMaxGarmentTransformationDirectives = `
    FLUX MAX CONTEXT - GARMENT TRANSFORMATION (MANDATORY):
    - ABSOLUTELY AND IMMEDIATELY REMOVE ALL HANGERS, CLIPS, TAGS, AND FLAT-LAY ARTIFACTS from the input garment. CRITICAL: DO NOT RENDER ANY MANNEQUIN REMAINS OR UNINTENDED BACKGROUND ELEMENTS.
    - Transform the flat-lay garment into a hyper-realistic, three-dimensional worn garment on the existing model; avoid any 2D, sticker-like, or paper-like overlay.
    - Ensure realistic fabric physics: natural drape, weight, tension, compression, and subtle folds along shoulders, chest/bust, torso, and sleeves; maintain a clean commercial presentation with minimal distracting wrinkles.
    - Preserve ALL original garment details: exact colors, prints/patterns, material texture, stitching, construction elements (collar, placket, buttons/zippers, cuffs, hems), trims, and finishes. Do NOT redesign.
    - Integrate prints/patterns correctly over the 3D form: patterns must curve, stretch, and wrap naturally across body contours; no flat, uniform, or unnaturally straight pattern lines.
    - For structured details (e.g., knots, pleats, darts, seams), render functional tension, deep creases, and realistic shadows consistent with real fabric behavior.
    - Maintain photorealistic integration with the model and scene: correct scale, perspective, lighting, cast shadows, and occlusions; match camera angle and scene lighting.
    - Focus solely on transforming the garment onto the existing model and seamlessly integrating it into the outfit. Do not introduce new background elements unless a location reference is explicitly provided.`;

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

      Create a simple English prompt that STARTS with "change" for changing ONLY the color of the product/garment from the reference image to ${targetColor}.

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

      Create a simple English prompt that STARTS with "change" for changing ONLY the pose/position of the model in the reference image.

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

      Create a simple English prompt that STARTS with "Replace" for replacing the garment from the reference image onto a ${modelGenderText}.

      CRITICAL REQUIREMENTS:
      1. The prompt MUST begin with "Replace the flat-lay garment..."
      2. Keep the original garment exactly the same without changing any design, shape, colors, patterns, or details
      3. Do not modify or redesign the garment in any way
      4. The final image should be photorealistic, showing the same garment perfectly fitted on the ${baseModelText}
      5. Use natural studio lighting with a clean background
      6. Preserve ALL original garment details: colors, patterns, textures, hardware, stitching, logos, graphics, and construction elements
      7. The garment must appear identical to the reference image, just worn by the model instead of being flat

      PRODUCT DETAIL COVERAGE (MANDATORY): Describe the garment's construction details comprehensively but concisely: exact number of buttons or fasteners, button style/material, zipper presence and position, pocket count and style (e.g., welt, patch, flap), waistband or belt loops, seam placements, darts, pleats, hems and cuff types, stitching type/visibility, closures, trims and hardware, labels/patches (generic terms), fabric texture and weave, pattern alignment, lining presence, and any distinctive construction features. Keep this within the 512-token limit; prioritize the most visually verifiable details.

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
      ${locationPromptSection}
      ${posePromptSection}
      ${perspectivePromptSection}
      ${hairStylePromptSection}
      ${hairStyleTextSection}
      ${faceDescriptionSection}
      
      SILENT RULES (DO NOT OUTPUT THESE, JUST APPLY THEM): All rules, headings, examples, and meta-instructions you see in this message must be applied silently. Do not quote, restate, or paraphrase any rule text in your final output. Your final output MUST ONLY be the concise descriptive prompt for the image model, with no rule headings or capitalized instruction sentences.

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
        timeout: 30000, // 30 saniye timeout
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
          timeout: 30000, // 30 saniye timeout
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
          timeout: 30000, // 30 saniye timeout
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
          timeout: 30000, // 30 saniye timeout
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

        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: parts,
            },
          ],
        });

        const geminiGeneratedPrompt = result.response.text().trim();

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

    // Eğer Gemini sonuç üretemediyse (enhancedPrompt orijinal prompt ile aynıysa) Replicate GPT-4o-mini ile yedek dene
    if (enhancedPrompt === originalPrompt) {
      try {
        console.log(
          "🤖 [FALLBACK] Gemini başarısız, Replicate GPT-4o-mini deneniyor"
        );

        const replicateInput = {
          top_p: 1,
          prompt: promptForGemini,
          image_input: [imageUrl],
          temperature: 1,
          system_prompt: "You are a helpful assistant.",
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
              Prefer: "wait",
            },
            timeout: 120000,
          }
        );

        const replicateData = replicateResponse.data;
        if (replicateData.status === "succeeded") {
          const outArr = replicateData.output;
          enhancedPrompt = Array.isArray(outArr) ? outArr.join("") : outArr;
          enhancedPrompt = enhancedPrompt.trim();
          console.log(
            "🤖 [FALLBACK] Replicate GPT-4o-mini prompt üretimi başarılı"
          );
        } else {
          console.warn(
            "⚠️ [FALLBACK] Replicate GPT-4o-mini status:",
            replicateData.status
          );
        }
      } catch (repErr) {
        console.error(
          "❌ [FALLBACK] Replicate GPT-4o-mini hatası:",
          repErr.message
        );
      }
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
    return originalPrompt;
  }
}

// Not: Trim işlemi removeBg.js içinde yapılıyor; burada tekrar etmiyoruz

// Arkaplan silme fonksiyonu
async function removeBackgroundFromImage(imageUrl, userId) {
  try {
    console.log("🖼️ Arkaplan silme işlemi başlatılıyor:", imageUrl);

    // Önce dahili removeBg API'sini kullanmayı dene
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
    const finalResult = await pollReplicateResult(initialResult.id, 30, 480); // toplam 480s limit

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

async function pollReplicateResult(
  predictionId,
  maxAttempts = 60,
  maxTotalSeconds = 480
) {
  console.log(`Replicate prediction polling başlatılıyor: ${predictionId}`);

  const pollingStartTime = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const elapsedSeconds = Math.floor((Date.now() - pollingStartTime) / 1000);
    if (elapsedSeconds > maxTotalSeconds) {
      console.error(
        `⏰ Polling toplam süre limiti aşıldı (${elapsedSeconds}s > ${maxTotalSeconds}s). Durduruluyor.`
      );
      throw new Error("POLLING_TIMEOUT");
    }
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
      const totalElapsed = Math.floor((Date.now() - pollingStartTime) / 1000);
      if (totalElapsed > maxTotalSeconds || attempt === maxAttempts - 1) {
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
      // Background removal control
      skipBackgroundRemoval = false, // CreateModelPhotoScreen'den geldiğinde arkaplan silmeyi atla
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
    let backgroundRemovedImageUrl = null; // Canvas'dan gelen background removed image URL'i

    // Location görsel URL'sini normalize et (string veya {uri})
    const normalizedLocationUrl = getLocationImageUrl(locationImage);

    // Çoklu resim varsa birleştir, yoksa tek resmi kullan
    if (isMultipleImages && referenceImages.length > 1) {
      console.log(
        "🖼️ [BACKEND] Çoklu resim birleştirme işlemi başlatılıyor..."
      );

      // Location image varsa referenceImages'a ekle
      let imagesToCombine = [...referenceImages];
      if (normalizedLocationUrl) {
        console.log(
          "🏞️ [BACKEND] Location image canvas'a ekleniyor:",
          normalizedLocationUrl
        );
        imagesToCombine.push({
          uri: normalizedLocationUrl,
          width: (locationImage && locationImage.width) || 400,
          height: (locationImage && locationImage.height) || 400,
          isLocationImage: true,
        });
      }

      finalImage = await combineImagesOnCanvas(
        imagesToCombine,
        userId,
        isMultipleProducts
      );

      // Birleştirilmiş resmi geçici dosyalar listesine ekle
      temporaryFiles.push(finalImage);
    } else {
      // Tek resim için normal işlem (ama location image varsa birleştirme yap)
      const referenceImage = referenceImages[0];

      // Location image varsa tek resim ile birleştir
      if (normalizedLocationUrl) {
        console.log(
          "🏞️ [BACKEND] Tek resim + location image birleştirme başlatılıyor..."
        );
        const imagesToCombine = [
          referenceImage,
          {
            uri: normalizedLocationUrl,
            width: (locationImage && locationImage.width) || 400,
            height: (locationImage && locationImage.height) || 400,
            isLocationImage: true,
          },
        ];

        finalImage = await combineImagesOnCanvas(
          imagesToCombine,
          userId,
          false // tek resim + location, multiple products değil
        );

        // Birleştirilmiş resmi geçici dosyalar listesine ekle
        temporaryFiles.push(finalImage);
      } else {
        // Location image yoksa normal tek resim işlemi
        if (!referenceImage) {
          return res.status(400).json({
            success: false,
            result: {
              message: "Referans görseli gereklidir.",
            },
          });
        }

        console.log("Referans görseli:", referenceImage.uri);
        console.log(
          "🎨 [CANVAS] Canvas processed:",
          referenceImage.canvasProcessed
        );
        console.log(
          "🖼️ [CANVAS] Has background removed:",
          referenceImage.hasBackgroundRemoved
        );
        console.log(
          "🔍 [DEBUG] Reference image base64 mevcut mu:",
          !!referenceImage.base64
        );
        console.log(
          "🔍 [DEBUG] Background removed base64 mevcut mu:",
          !!referenceImage.backgroundRemovedBase64
        );
        console.log(
          "🔍 [DEBUG] Combined image base64 mevcut mu:",
          !!referenceImage.combinedImageBase64
        );
        console.log(
          "🔍 [DEBUG] Is combined image:",
          !!referenceImage.isCombinedImage
        );
        if (referenceImage.base64) {
          console.log(
            "🔍 [DEBUG] Base64 uzunluğu:",
            referenceImage.base64.length
          );
        }
        if (referenceImage.combinedImageBase64) {
          console.log(
            "🔍 [DEBUG] Combined base64 uzunluğu:",
            referenceImage.combinedImageBase64.length
          );
        }

        // Referans resmini önce Supabase'e yükle ve URL al
        let imageSourceForUpload;

        // Canvas'dan gelen resimse ve background removed varsa onu önceleyeceğiz
        if (
          referenceImage.canvasProcessed &&
          referenceImage.backgroundRemovedBase64
        ) {
          console.log(
            "🎨 [CANVAS] Canvas resmi ve background removed resmi algılandı"
          );

          // Canvas'dan birleştirilmiş resim varsa onu kullan, yoksa orijinal canvas resmi
          if (referenceImage.combinedImageBase64) {
            imageSourceForUpload = `data:image/png;base64,${referenceImage.combinedImageBase64}`;
            console.log(
              "🎨 [CANVAS] Birleştirilmiş Canvas+Background resmi kullanılıyor"
            );
          } else if (referenceImage.base64) {
            imageSourceForUpload = `data:image/png;base64,${referenceImage.base64}`;
            console.log(
              "🎨 [CANVAS] Canvas base64 kullanılıyor (PNG formatında)"
            );
          } else {
            imageSourceForUpload = referenceImage.uri;
            console.log(
              "🎨 [CANVAS] Canvas URI kullanılıyor:",
              referenceImage.uri
            );
          }

          // Background removed resmi de upload et
          try {
            const backgroundRemovedSource = `data:image/png;base64,${referenceImage.backgroundRemovedBase64}`;
            backgroundRemovedImageUrl = await uploadReferenceImageToSupabase(
              backgroundRemovedSource,
              userId
            );
            console.log(
              "🖼️ [CANVAS] Background removed resim upload edildi:",
              backgroundRemovedImageUrl
            );
            // Background removed resmi geçici dosyalar listesine ekle
            temporaryFiles.push(backgroundRemovedImageUrl);
          } catch (bgUploadError) {
            console.error(
              "🖼️ [CANVAS] Background removed resim upload hatası:",
              bgUploadError
            );
            // Hata durumunda sadece orijinal resimle devam et
          }
        } else {
          // Normal resim işleme (canvas değilse)
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
        }

        // Canvas durumunda finalImage upload'ını atla, direkt base64'lerle çalış
        if (
          referenceImage.canvasProcessed &&
          referenceImage.backgroundRemovedBase64
        ) {
          console.log(
            "🎨 [CANVAS] Canvas modu: finalImage upload atlanıyor, sadece backgroundRemovedImageUrl kullanılacak"
          );
          // Canvas'da finalImage upload'ını atla, sadece backgroundRemovedImageUrl kullan
          finalImage = backgroundRemovedImageUrl; // Background removed URL'yi kullan
        } else {
          // Normal upload işlemi
          finalImage = await uploadReferenceImageToSupabase(
            imageSourceForUpload,
            userId
          );
        }
      } // location image else bloğunu kapat
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

    // 🤖 Gemini'ye orijinal ham resmi gönder (paralel)
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
      // 🖼️ NORMAL MODE - Arkaplan silme işlemi

      // Canvas'dan gelen background removed resmi varsa onu kullan, yoksa API'ye git
      if (backgroundRemovedImageUrl) {
        console.log("🎨 [CANVAS] Canvas'dan gelen resimler işleniyor...");

        // Canvas'dan birleştirilmiş resim varsa onu kullan
        if (referenceImages[0]?.combinedImageBase64) {
          console.log(
            "🎨 [CANVAS] ✅ Birleştirilmiş Canvas+Background resmi Flux Max'e gönderiliyor!"
          );
          // Birleştirilmiş resmi doğrudan Flux'a gönder - upload edilmiş URL'i kullan
          // Canvas kombinasyonu için ayrı upload edilmiş URL'i bulalım
          try {
            const combinedImageSource = `data:image/png;base64,${referenceImages[0].combinedImageBase64}`;
            const combinedImageUrl = await uploadReferenceImageToSupabase(
              combinedImageSource,
              userId
            );
            console.log(
              "🎨 [CANVAS] Birleştirilmiş resim Flux için upload edildi:",
              combinedImageUrl
            );
            backgroundRemovedImage = combinedImageUrl;
            // Geçici dosya listesine ekle
            temporaryFiles.push(combinedImageUrl);
          } catch (uploadError) {
            console.error(
              "❌ [CANVAS] Birleştirilmiş resim upload hatası:",
              uploadError
            );
            // Fallback: finalImage kullan
            backgroundRemovedImage = finalImage;
          }
        } else {
          console.log(
            "🎨 [CANVAS] Canvas base64 mevcut değil, sadece background removed resmi kullanılıyor"
          );
          backgroundRemovedImage = backgroundRemovedImageUrl;
        }

        // Sadece Gemini'yi bekle, arkaplan zaten silinmiş
        console.log("⏳ Sadece Gemini prompt iyileştirmesi bekleniyor...");
        enhancedPrompt = await geminiPromise;
      } else if (skipBackgroundRemoval) {
        // CreateModelPhotoScreen'den gelen request - Arkaplan silme atlanıyor + Portrait oluşturuluyor
        console.log(
          "🖼️ CreateModelPhotoScreen modu: Arkaplan silme atlanıyor + Portrait oluşturuluyor..."
        );

        // Canvas'dan gelen resim bilgilerini kontrol et
        const hasCanvasData = referenceImages[0]?.combinedImageBase64;
        const hasBackgroundRemovedData = backgroundRemovedImageUrl;

        console.log("🔍 [PORTRAIT DEBUG] hasCanvasData:", !!hasCanvasData);
        console.log(
          "🔍 [PORTRAIT DEBUG] hasBackgroundRemovedData:",
          !!hasBackgroundRemovedData
        );
        console.log(
          "🔍 [PORTRAIT DEBUG] backgroundRemovedImageUrl:",
          backgroundRemovedImageUrl
        );

        if (hasCanvasData) {
          console.log(
            "👤 [PORTRAIT] CreateModelPhotoScreen modu: 3'lü birleştirme işlemi başlatılıyor..."
          );

          // Portrait prompt oluştur ve portrait resmi oluştur (paralel)
          // Portre promptunda (yalnızca Flux.1-dev için) ethnicity fallback kullan
          const fluxPortraitSettings = { ...settings };
          const portraitPromptPromise = generatePortraitPromptWithGemini(
            fluxPortraitSettings,
            settings.gender || "female"
          );

          // Gemini ve portrait prompt'u paralel bekle (portrait optional)
          console.log(
            "⏳ Gemini main prompt ve portrait prompt paralel oluşturuluyor..."
          );
          const [mainPromptResult, portraitPromptResult] =
            await Promise.allSettled([geminiPromise, portraitPromptPromise]);

          // Main prompt kesinlikle gerekli
          if (mainPromptResult.status === "fulfilled") {
            enhancedPrompt = mainPromptResult.value;
          } else {
            console.error(
              "❌ Main prompt oluşturulamadı:",
              mainPromptResult.reason
            );
            throw mainPromptResult.reason;
          }

          // Portrait prompt opsiyonel - hata olursa devam et
          let portraitPrompt = null;
          if (portraitPromptResult.status === "fulfilled") {
            portraitPrompt = portraitPromptResult.value;
            console.log("✅ Portrait prompt başarıyla oluşturuldu");
          } else {
            console.error(
              "⚠️ Portrait prompt oluşturulamadı, fallback kullanılacak:",
              portraitPromptResult.reason
            );
            // Fallback portrait prompt
            portraitPrompt = `Professional close-up portrait of a fashion ${
              settings.gender || "female"
            } model with striking editorial facial features. Pure white studio background, professional lighting, sharp detail, high-fashion model aesthetics, commercial photography style, head and shoulders view only.`;
          }

          // Portrait resmi oluştur
          console.log("🎨 [PORTRAIT] Portrait resmi oluşturuluyor...");
          console.log("🎨 [PORTRAIT] Portrait prompt:", portraitPrompt);

          let portraitImageUrl = null;
          try {
            portraitImageUrl = await generatePortraitWithFluxDev(
              portraitPrompt
            );
            console.log(
              "✅ [PORTRAIT] Portrait oluşturma başarılı:",
              portraitImageUrl
            );
          } catch (portraitError) {
            console.error(
              "❌ [PORTRAIT] Portrait oluşturma hatası:",
              portraitError
            );
            console.log(
              "🔄 [PORTRAIT] Portrait olmadan 2'li birleştirme yapılacak..."
            );

            // Portrait oluşturulamadıysa sadece Canvas+Background birleştir
            const combinedImageSource = `data:image/png;base64,${referenceImages[0].combinedImageBase64}`;
            const canvasImageUrl = await uploadReferenceImageToSupabase(
              combinedImageSource,
              userId
            );

            // Background removed image varsa birleştir, yoksa sadece canvas kullan
            if (backgroundRemovedImageUrl) {
              const twoImagesCombinedUrl =
                await combineCanvasAndBackgroundRemovedImages(
                  canvasImageUrl,
                  backgroundRemovedImageUrl,
                  userId
                );
              backgroundRemovedImage = twoImagesCombinedUrl;
              temporaryFiles.push(canvasImageUrl, twoImagesCombinedUrl);
            } else {
              console.log(
                "⚠️ [PORTRAIT] Background removed image null, sadece canvas kullanılıyor..."
              );
              backgroundRemovedImage = canvasImageUrl;
              temporaryFiles.push(canvasImageUrl);
            }

            console.log(
              "✅ [PORTRAIT] 2'li birleştirme tamamlandı (portrait hatası nedeniyle):",
              backgroundRemovedImage
            );
            return; // Early return - 3'lü birleştirmeye gitme
          }

          // Canvas resmi upload et
          const combinedImageSource = `data:image/png;base64,${referenceImages[0].combinedImageBase64}`;
          const canvasImageUrl = await uploadReferenceImageToSupabase(
            combinedImageSource,
            userId
          );

          if (hasBackgroundRemovedData) {
            // 3 veya 4 resmi birleştir: Canvas + Background Removed + Portrait + (Location)
            const normalizedLocationUrl = getLocationImageUrl(locationImage);
            if (normalizedLocationUrl) {
              console.log(
                "🎨 [PORTRAIT] 4 resim birleştiriliyor (location dahil)..."
              );
              const fourImagesCombinedUrl = await combineFourImages(
                canvasImageUrl,
                backgroundRemovedImageUrl,
                portraitImageUrl,
                normalizedLocationUrl,
                userId
              );
              backgroundRemovedImage = fourImagesCombinedUrl;
              temporaryFiles.push(
                canvasImageUrl,
                portraitImageUrl,
                fourImagesCombinedUrl
              );
              console.log(
                "✅ [PORTRAIT] 4'lü birleştirme tamamlandı:",
                fourImagesCombinedUrl
              );
            } else {
              console.log("🎨 [PORTRAIT] 3 resim birleştiriliyor...");
              const threeImagesCombinedUrl = await combineThreeImages(
                canvasImageUrl,
                backgroundRemovedImageUrl,
                portraitImageUrl,
                userId
              );
              backgroundRemovedImage = threeImagesCombinedUrl;
              temporaryFiles.push(
                canvasImageUrl,
                portraitImageUrl,
                threeImagesCombinedUrl
              );
              console.log(
                "✅ [PORTRAIT] 3'lü birleştirme tamamlandı:",
                threeImagesCombinedUrl
              );
            }
          } else {
            // 2 veya 3 resmi birleştir: Canvas + Portrait + (Location)
            const normalizedLocationUrl = getLocationImageUrl(locationImage);
            if (normalizedLocationUrl) {
              console.log(
                "🎨 [PORTRAIT] 3 resim birleştiriliyor (Canvas + Portrait + Location)..."
              );
              console.log("🔎 [PORTRAIT] location URL:", normalizedLocationUrl);
              const threeImagesCombinedUrl =
                await combineThreeImagesCanvasPortraitLocation(
                  canvasImageUrl,
                  portraitImageUrl,
                  normalizedLocationUrl,
                  userId
                );
              backgroundRemovedImage = threeImagesCombinedUrl;
              temporaryFiles.push(
                canvasImageUrl,
                portraitImageUrl,
                threeImagesCombinedUrl
              );
              console.log(
                "✅ [PORTRAIT] 3'lü birleştirme tamamlandı:",
                threeImagesCombinedUrl
              );
            } else {
              console.log(
                "🎨 [PORTRAIT] 2 resim birleştiriliyor (Canvas + Portrait)..."
              );
              const twoImagesCombinedUrl =
                await combineCanvasAndBackgroundRemovedImages(
                  canvasImageUrl,
                  portraitImageUrl,
                  userId
                );
              backgroundRemovedImage = twoImagesCombinedUrl;
              temporaryFiles.push(
                canvasImageUrl,
                portraitImageUrl,
                twoImagesCombinedUrl
              );
              console.log(
                "✅ [PORTRAIT] 2'li birleştirme tamamlandı:",
                twoImagesCombinedUrl
              );
            }
          }
        } else {
          // Canvas verisi yoksa normal akış
          console.log("⏳ Sadece Gemini prompt iyileştirmesi bekleniyor...");
          enhancedPrompt = await geminiPromise;
          backgroundRemovedImage = finalImage; // Orijinal resmi kullan
        }
      } else {
        // Normal arkaplan silme işlemi (paralel)
        console.log("🖼️ Normal arkaplan silme işlemi başlatılıyor...");
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
    }

    console.log("✅ Gemini prompt iyileştirme tamamlandı");
    console.log("✅ Arkaplan silme tamamlandı:", backgroundRemovedImage);

    // Geçici dosyayı silme listesine ekle
    temporaryFiles.push(backgroundRemovedImage);

    let combinedImageForReplicate = backgroundRemovedImage; // Fallback - her zaman arkaplanı silinmiş resim

    console.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    console.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // Replicate API'ye retry mekanizması ile istek gönder
    let replicateResponse;
    const maxRetries = 3;

    // Color change, edit mode ve pose change modunda sadece Flux Kontext Max kullan, Flux Dev'e geçme
    const useOnlyFluxMax = isColorChange || isEditMode || isPoseChange;

    if (useOnlyFluxMax) {
      let modeText = "";
      if (isColorChange) modeText += "Color change";
      if (isEditMode) modeText += (modeText ? ", " : "") + "Edit mode";
      if (isPoseChange) modeText += (modeText ? ", " : "") + "Pose change";

      console.log(
        `🎨 ${modeText} modu: Sadece Flux Kontext Max kullanılacak, Flux Dev'e geçiş yapılmayacak`
      );
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Replicate API attempt ${attempt}/${maxRetries}`);

        // Random seed her seferinde farklı olsun
        const seed = Math.floor(Math.random() * 2 ** 32);
        console.log(`🎲 Random seed: ${seed}`);

        // Ethnicity bilgisini Flux Kontext Max'e göndermemek için prompt'u sanitize et
        const sanitizedPromptForMax = (enhancedPrompt || "")
          .replace(/^.*ethnicity.*$/gim, "")
          .replace(/\n{2,}/g, "\n")
          .trim();

        replicateResponse = await axios.post(
          "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions",
          {
            input: {
              prompt: sanitizedPromptForMax,
              input_image: combinedImageForReplicate, // Birleştirilmiş resim Replicate için
              aspect_ratio: formattedRatio,
              disable_safety_checker: true,
              seed: seed, // Random seed eklendi
              num_inference_steps: 50,
              output_quality: 100,
              prompt_upsampling: true,
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
      finalResult = await pollReplicateResult(initialResult.id, 60, 480);
      processingTime = Math.round((Date.now() - startTime) / 1000);
    } catch (pollingError) {
      console.error("❌ Polling hatası:", pollingError.message);

      // Content moderation hatası yakalandıysa flux-kontext-dev'e geç (color change modunda değilse)
      if (
        pollingError.message === "SENSITIVE_CONTENT_FLUX_FALLBACK" &&
        !useOnlyFluxMax
      ) {
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
      } else if (
        pollingError.message === "SENSITIVE_CONTENT_FLUX_FALLBACK" &&
        useOnlyFluxMax
      ) {
        // Color change, edit mode veya pose change modunda Flux Dev'e geçiş yapılmayacak, direkt hata döndür
        let modeText = "";
        if (isColorChange) modeText = "Renk değiştirme";
        else if (isEditMode) modeText = "Düzenleme";
        else if (isPoseChange) modeText = "Poz değiştirme";

        console.log(
          `🎨 ${modeText} modu: Flux Dev'e geçiş yapılmayacak, direkt hata döndürülüyor`
        );

        // ❌ Status'u failed'e güncelle
        await updateGenerationStatus(finalGenerationId, userId, "failed", {
          processing_time_seconds: 0,
        });

        // 🗑️ Hata durumunda geçici dosyaları temizle
        console.log(
          `🧹 ${modeText} hatası sonrası geçici dosyalar temizleniyor...`
        );
        await cleanupTemporaryFiles(temporaryFiles);

        return res.status(500).json({
          success: false,
          result: {
            message: `${modeText} işlemi başarısız oldu`,
            error:
              "İşlem sırasında teknik bir sorun oluştu. Lütfen tekrar deneyin.",
          },
        });
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

  // Vurgulanacak ögeler - modelden prompt içinde birden fazla kez geçmesini iste
  const emphasisPoints = [];
  if (mood) emphasisPoints.push(`mood/expression: ${mood}`);
  if (accessories) emphasisPoints.push(`accessories: ${accessories}`);
  if (bodyShape) emphasisPoints.push(`body shape: ${bodyShape}`);
  if (hairStyle) emphasisPoints.push(`hair style: ${hairStyle}`);
  if (hairColor) emphasisPoints.push(`hair color: ${hairColor}`);
  if (skinTone) emphasisPoints.push(`skin tone: ${skinTone}`);
  if (age) emphasisPoints.push(`age: ${age}`);

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

    const emphasisText =
      emphasisPoints.length > 0
        ? `\n\nEMPHASIS REQUIREMENTS:\n- Repeat the following key attributes at least twice across the prompt where relevant: ${emphasisPoints.join(
            "; "
          )}.\n- Reiterate them again succinctly at the end of the prompt as a reminder line starting with 'Focus:'.\n`
        : "";
    const portraitPrompt = `Your task is to generate a short, artistic photo prompt for a professional fashion model (${gender}).

        **UNBREAKABLE RULE #1: THE FRAME**
        - The image MUST be an EXTREME CLOSE-UP of the face.
        - The frame starts at the chin and ends at the top of the head.
        - **ABSOLUTELY NO NECK, NO SHOULDERS, NO CHEST, NO BODY, NO CLOTHES.**
        - The entire focus is exclusively on the face.
        
        **UNBREAKABLE RULE #2: FORBIDDEN PHRASES**
        - **DO NOT USE** any of the following phrases in your output: "head-and-shoulders", "shoulders up", "bust shot", "portrait", "close-up portrait", "slight distance". Describe the shot without naming it with these common but incorrect terms.

        **MODEL & SCENE REQUIREMENTS:**
        - Subject: High-fashion model with striking, editorial facial features.
        - Background: Pure, solid white studio background.
        - Lighting: Professional, even studio lighting.
        - Style: Sharp detail, clear features, commercial fashion aesthetic.

        **CREATIVE TASK:**
        - Creatively weave the following characteristics into a cohesive description, but you must adhere strictly to all UNBREAKABLE RULES above.
        ${characteristicsText}
        ${emphasisText}
        **OUTPUT FORMAT:**
        - Generate only the final prompt text.
        - No quotes, no explanations, no rules, no meta-guidance.
        - **STRICT LIMIT: 77 tokens MAXIMUM.** Be concise and powerful.`;

    // Gemini 2.5 Flash modeli - En yeni API yapısı
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    // Gemini'den cevap al (retry mekanizması ile) - Yeni API
    let generatedPrompt;
    const maxRetries = 10;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 [GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [{ text: portraitPrompt }],
            },
          ],
        });

        generatedPrompt = result.response.text().trim();

        console.log(
          "🤖 [BACKEND GEMINI] Gemini'nin ürettiği portrait prompt:",
          generatedPrompt
        );
        break; // Başarılı olursa loop'tan çık
      } catch (geminiError) {
        console.error(
          `Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );

        if (attempt === maxRetries) {
          console.error(
            "Gemini API all attempts failed, using fallback prompt"
          );
          throw geminiError;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    if (!generatedPrompt) {
      throw new Error("Gemini'den boş yanıt alındı");
    }

    console.log("👤 Portrait prompt oluşturuldu:", generatedPrompt);
    return generatedPrompt + "No clothes";
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

    // ⏰ Processing timeout kontrolü (8 dakika)
    const PROCESSING_TIMEOUT_MINUTES = 8;
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

// Canvas ve background removed resimlerini yan yana birleştiren fonksiyon
async function combineThreeImages(
  canvasImageUrl,
  backgroundRemovedImageUrl,
  portraitImageUrl,
  userId
) {
  try {
    console.log("🎨 [3-IMAGE COMBINE] Üç resim birleştiriliyor (2x1 grid)...");
    console.log("🎨 [3-IMAGE COMBINE] Canvas resmi:", canvasImageUrl);
    console.log(
      "🎨 [3-IMAGE COMBINE] Background removed resmi:",
      backgroundRemovedImageUrl
    );
    console.log("🎨 [3-IMAGE COMBINE] Portrait resmi:", portraitImageUrl);

    if (!backgroundRemovedImageUrl) {
      console.log(
        "ℹ️ [3-IMAGE COMBINE] backgroundRemovedImageUrl boş; bu fonksiyon Canvas + BGRemoved + Portrait için kullanılmalı"
      );
    }

    // Üç resmi de indir
    const [canvasResponse, bgRemovedResponse, portraitResponse] =
      await Promise.all([
        axios.get(canvasImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
        axios.get(backgroundRemovedImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
        axios.get(portraitImageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
      ]);

    console.log(
      "📡 [3-IMAGE COMBINE] HTTP statusler:",
      canvasResponse.status,
      bgRemovedResponse.status,
      portraitResponse.status
    );

    const canvasBuffer = Buffer.from(canvasResponse.data);
    const bgRemovedBuffer = Buffer.from(bgRemovedResponse.data);
    const portraitBuffer = Buffer.from(portraitResponse.data);

    // Sharp ile resim boyutlarını öğren
    const canvasMetadata = await sharp(canvasBuffer).metadata();
    const bgRemovedMetadata = await sharp(bgRemovedBuffer).metadata();
    const portraitMetadata = await sharp(portraitBuffer).metadata();

    console.log(
      "🎨 [3-IMAGE COMBINE] Canvas boyutları:",
      canvasMetadata.width,
      "x",
      canvasMetadata.height
    );
    console.log(
      "🎨 [3-IMAGE COMBINE] BG removed boyutları:",
      bgRemovedMetadata.width,
      "x",
      bgRemovedMetadata.height
    );
    console.log(
      "🎨 [3-IMAGE COMBINE] Portrait boyutları:",
      portraitMetadata.width,
      "x",
      portraitMetadata.height
    );

    // 2x1 grid: üstte canvas | altta bgRemoved+portrait yan yana büyük
    const cellHeight = 1024;
    const spacing = 15;

    const canvasCell = await sharp(canvasBuffer)
      .resize({
        height: cellHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    const bgCell = await sharp(bgRemovedBuffer)
      .resize({
        height: Math.floor(cellHeight * 0.9),
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    const portraitCell = await sharp(portraitBuffer)
      .resize({
        height: Math.floor(cellHeight * 0.9),
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const canvasMeta = await sharp(canvasCell).metadata();
    const bgMeta = await sharp(bgCell).metadata();
    const portraitMeta = await sharp(portraitCell).metadata();

    const bottomRowWidth = bgMeta.width + portraitMeta.width + spacing;
    const totalWidth = Math.max(canvasMeta.width, bottomRowWidth);
    const totalHeight =
      cellHeight + spacing + Math.max(bgMeta.height, portraitMeta.height);

    const topX = Math.floor((totalWidth - canvasMeta.width) / 2);
    const bottomLeftX = Math.floor((totalWidth - bottomRowWidth) / 2);
    const bottomRightX = bottomLeftX + bgMeta.width + spacing;

    const combinedImage = await sharp({
      create: {
        width: totalWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: canvasCell, left: topX, top: 0 },
        { input: bgCell, left: bottomLeftX, top: cellHeight + spacing },
        { input: portraitCell, left: bottomRightX, top: cellHeight + spacing },
      ])
      .png()
      .toBuffer();

    // Birleştirilmiş resmi Supabase'e yükle
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `three_images_combined_${timestamp}_${
      userId || "anonymous"
    }_${randomId}.png`;

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, combinedImage, { contentType: "image/png" });

    if (uploadError) throw uploadError;

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage.from("images").getPublicUrl(fileName);

    if (publicUrlError) throw publicUrlError;

    const combinedImageUrl = publicUrlData.publicUrl;
    console.log(
      "✅ [3-IMAGE COMBINE] Üç resim başarıyla birleştirildi:",
      combinedImageUrl
    );

    return combinedImageUrl;
  } catch (error) {
    console.error("❌ [3-IMAGE COMBINE] Üç resim birleştirme hatası:", error);
    throw error;
  }
}

async function combineFourImages(
  canvasImageUrl,
  backgroundRemovedImageUrl,
  portraitImageUrl,
  locationImageUrl,
  userId
) {
  try {
    console.log("🎨 [4-IMAGE COMBINE] Dört resim birleştiriliyor...");
    console.log("🎨 [4-IMAGE COMBINE] Canvas resmi:", canvasImageUrl);
    console.log(
      "🎨 [4-IMAGE COMBINE] Background removed resmi:",
      backgroundRemovedImageUrl
    );
    console.log("🎨 [4-IMAGE COMBINE] Portrait resmi:", portraitImageUrl);
    console.log("🎨 [4-IMAGE COMBINE] Location resmi:", locationImageUrl);
    if (!locationImageUrl) {
      console.warn(
        "⚠️ [4-IMAGE COMBINE] Location URL boş veya geçersiz görünüyor"
      );
    }

    // Dört resmi de indir
    const [
      canvasResponse,
      bgRemovedResponse,
      portraitResponse,
      locationResponse,
    ] = await Promise.all([
      axios.get(canvasImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      }),
      axios.get(backgroundRemovedImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      }),
      axios.get(portraitImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      }),
      axios.get(locationImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      }),
    ]);

    console.log(
      "📡 [4-IMAGE COMBINE] HTTP statusler:",
      canvasResponse.status,
      bgRemovedResponse.status,
      portraitResponse.status,
      locationResponse.status
    );

    const canvasBuffer = Buffer.from(canvasResponse.data);
    const bgRemovedBuffer = Buffer.from(bgRemovedResponse.data);
    const portraitBuffer = Buffer.from(portraitResponse.data);
    const locationBuffer = Buffer.from(locationResponse.data);

    // Sharp ile resim boyutlarını öğren
    const canvasMetadata = await sharp(canvasBuffer).metadata();
    const bgRemovedMetadata = await sharp(bgRemovedBuffer).metadata();
    const portraitMetadata = await sharp(portraitBuffer).metadata();
    const locationMetadata = await sharp(locationBuffer).metadata();

    console.log(
      "🎨 [4-IMAGE COMBINE] Canvas boyutları:",
      canvasMetadata.width,
      "x",
      canvasMetadata.height
    );
    console.log(
      "🎨 [4-IMAGE COMBINE] BG removed boyutları:",
      bgRemovedMetadata.width,
      "x",
      bgRemovedMetadata.height
    );
    console.log(
      "🎨 [4-IMAGE COMBINE] Portrait boyutları:",
      portraitMetadata.width,
      "x",
      portraitMetadata.height
    );
    console.log(
      "🎨 [4-IMAGE COMBINE] Location boyutları:",
      locationMetadata.width,
      "x",
      locationMetadata.height
    );

    // En büyük yüksekliği al
    const maxHeight = Math.max(
      canvasMetadata.height,
      bgRemovedMetadata.height,
      portraitMetadata.height,
      locationMetadata.height
    );

    // Dört resmi aynı yüksekliğe resize et
    const resizedCanvas = await sharp(canvasBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const resizedBgRemoved = await sharp(bgRemovedBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();

    const resizedPortrait = await sharp(portraitBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const resizedLocation = await sharp(locationBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    // Resize edilmiş resimlerin boyutlarını al
    const resizedCanvasMetadata = await sharp(resizedCanvas).metadata();
    const resizedBgRemovedMetadata = await sharp(resizedBgRemoved).metadata();
    const resizedPortraitMetadata = await sharp(resizedPortrait).metadata();
    const resizedLocationMetadata = await sharp(resizedLocation).metadata();

    // 2x2 grid (üst: canvas | bgRemoved, alt: portrait | location), dikeyde büyük çıktı
    const cellHeight = 1024;
    const spacing = 15;

    // Hücre yüksekliğine göre yeniden boyutlandır
    const gridCanvas = await sharp(resizedCanvas)
      .resize({
        height: cellHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    const gridBgRemoved = await sharp(resizedBgRemoved)
      .resize({
        height: cellHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    const gridPortrait = await sharp(resizedPortrait)
      .resize({
        height: cellHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    const gridLocation = await sharp(resizedLocation)
      .resize({
        height: cellHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const gridCanvasMeta = await sharp(gridCanvas).metadata();
    const gridBgRemovedMeta = await sharp(gridBgRemoved).metadata();
    const gridPortraitMeta = await sharp(gridPortrait).metadata();
    const gridLocationMeta = await sharp(gridLocation).metadata();

    const leftColumnWidth = Math.max(
      gridCanvasMeta.width,
      gridPortraitMeta.width
    );
    const rightColumnWidth = Math.max(
      gridBgRemovedMeta.width,
      gridLocationMeta.width
    );
    const totalWidth = leftColumnWidth + rightColumnWidth + spacing;
    const totalHeight = cellHeight * 2 + spacing;

    const leftTopX = Math.floor((leftColumnWidth - gridCanvasMeta.width) / 2);
    const rightTopX =
      leftColumnWidth +
      spacing +
      Math.floor((rightColumnWidth - gridBgRemovedMeta.width) / 2);
    const leftBottomX = Math.floor(
      (leftColumnWidth - gridPortraitMeta.width) / 2
    );
    const rightBottomX =
      leftColumnWidth +
      spacing +
      Math.floor((rightColumnWidth - gridLocationMeta.width) / 2);

    const combinedImage = await sharp({
      create: {
        width: totalWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: gridCanvas, left: leftTopX, top: 0 },
        { input: gridBgRemoved, left: rightTopX, top: 0 },
        { input: gridPortrait, left: leftBottomX, top: cellHeight + spacing },
        { input: gridLocation, left: rightBottomX, top: cellHeight + spacing },
      ])
      .png()
      .toBuffer();

    // Birleştirilmiş resmi Supabase'e yükle
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `four_images_combined_${timestamp}_${
      userId || "anonymous"
    }_${randomId}.png`;

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, combinedImage, { contentType: "image/png" });

    if (uploadError) throw uploadError;

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage.from("images").getPublicUrl(fileName);

    if (publicUrlError) throw publicUrlError;

    const combinedImageUrl = publicUrlData.publicUrl;
    console.log(
      "✅ [4-IMAGE COMBINE] Dört resim başarıyla birleştirildi:",
      combinedImageUrl
    );

    return combinedImageUrl;
  } catch (error) {
    console.error("❌ [4-IMAGE COMBINE] Dört resim birleştirme hatası:", error);
    throw error;
  }
}

async function combineCanvasAndBackgroundRemovedImages(
  canvasImageUrl,
  backgroundRemovedImageUrl,
  userId
) {
  try {
    console.log("🎨 [CANVAS COMBINE] İki resim birleştiriliyor...");
    console.log("🎨 [CANVAS COMBINE] Canvas resmi:", canvasImageUrl);
    console.log(
      "🎨 [CANVAS COMBINE] Background removed resmi:",
      backgroundRemovedImageUrl
    );

    // Null URL kontrolü
    if (!canvasImageUrl) {
      throw new Error("Canvas image URL null veya boş!");
    }

    if (!backgroundRemovedImageUrl) {
      console.error("❌ [CANVAS COMBINE] Background removed image URL null!");
      throw new Error("Background removed image URL null veya boş!");
    }

    // İki resmi de indir
    const [canvasResponse, bgRemovedResponse] = await Promise.all([
      axios.get(canvasImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      }),
      axios.get(backgroundRemovedImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      }),
    ]);

    const canvasBuffer = Buffer.from(canvasResponse.data);
    const bgRemovedBuffer = Buffer.from(bgRemovedResponse.data);

    // Sharp ile resim boyutlarını öğren
    const canvasMetadata = await sharp(canvasBuffer).metadata();
    const bgRemovedMetadata = await sharp(bgRemovedBuffer).metadata();

    console.log(
      "🎨 [CANVAS COMBINE] Canvas boyutları:",
      canvasMetadata.width,
      "x",
      canvasMetadata.height
    );
    console.log(
      "🎨 [CANVAS COMBINE] BG removed boyutları:",
      bgRemovedMetadata.width,
      "x",
      bgRemovedMetadata.height
    );

    // En büyük yüksekliği al
    const maxHeight = Math.max(canvasMetadata.height, bgRemovedMetadata.height);

    // İki resmi aynı yüksekliğe resize et
    const resizedCanvas = await sharp(canvasBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const resizedBgRemoved = await sharp(bgRemovedBuffer)
      .resize({
        height: maxHeight,
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();

    // Resize edilmiş resimlerin boyutlarını al
    const resizedCanvasMetadata = await sharp(resizedCanvas).metadata();
    const resizedBgRemovedMetadata = await sharp(resizedBgRemoved).metadata();

    // Toplam genişlik hesapla (5px boşluk ile)
    const totalWidth =
      resizedCanvasMetadata.width + resizedBgRemovedMetadata.width + 5;

    // İki resmi yan yana birleştir
    const combinedImage = await sharp({
      create: {
        width: totalWidth,
        height: maxHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: resizedCanvas, top: 0, left: 0 },
        {
          input: resizedBgRemoved,
          top: 0,
          left: resizedCanvasMetadata.width + 5,
        },
      ])
      .png()
      .toBuffer();

    // Birleştirilmiş resmi Supabase'e yükle
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `canvas_combined_${timestamp}_${
      userId || "anonymous"
    }_${randomId}.png`;

    console.log(
      "🎨 [CANVAS COMBINE] Birleştirilmiş resim Supabase'e yükleniyor:",
      fileName
    );

    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, combinedImage, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("🎨 [CANVAS COMBINE] Supabase yükleme hatası:", error);
      throw new Error(`Combined image upload failed: ${error.message}`);
    }

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log(
      "🎨 [CANVAS COMBINE] Birleştirilmiş resim Public URL:",
      urlData.publicUrl
    );
    return urlData.publicUrl;
  } catch (error) {
    console.error("🎨 [CANVAS COMBINE] Resim birleştirme hatası:", error);
    throw error;
  }
}

// Canvas'dan yakalanan resmi yüklemek için endpoint
router.post("/uploadCanvasImage", async (req, res) => {
  try {
    const { imageData, userId = null } = req.body;

    if (!imageData) {
      return res.status(400).json({
        success: false,
        error: "Image data is required",
      });
    }

    console.log("🎨 Canvas resmi upload ediliyor...");

    let imageBuffer;
    let contentType = "image/png";

    // Base64 data URL kontrolü
    if (imageData.startsWith("data:image/")) {
      const base64Data = imageData.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");

      // Content type'ı belirle
      if (imageData.includes("data:image/png")) {
        contentType = "image/png";
      } else if (
        imageData.includes("data:image/jpeg") ||
        imageData.includes("data:image/jpg")
      ) {
        contentType = "image/jpeg";
      }
    } else {
      // Plain base64 string kabul et
      imageBuffer = Buffer.from(imageData, "base64");
    }

    // Dosya adı oluştur
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `canvas_${timestamp}_${
      userId || "anonymous"
    }_${randomId}.png`;

    console.log("🎨 Canvas resmi Supabase'e yükleniyor:", fileName);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, imageBuffer, {
        contentType: contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("🎨 Canvas resmi Supabase yükleme hatası:", error);
      return res.status(500).json({
        success: false,
        error: `Upload failed: ${error.message}`,
      });
    }

    console.log("🎨 Canvas resmi başarıyla yüklendi:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log("🎨 Canvas resmi Public URL:", urlData.publicUrl);

    res.json({
      success: true,
      imageUrl: urlData.publicUrl,
      fileName: fileName,
      message: "Canvas image uploaded successfully",
    });
  } catch (error) {
    console.error("🎨 Canvas resmi upload hatası:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Canvas image upload failed",
    });
  }
});

module.exports = router;
