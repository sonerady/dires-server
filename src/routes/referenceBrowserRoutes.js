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

// Prompt'u iyileştirmek için Gemini'yi kullan
async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false,
  hasControlNet = false
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

    // Gemini'ye gönderilecek metin - Basitleştirilmiş replace odaklı prompt
    let promptForGemini = `
    IMPORTANT INSTRUCTION: Generate ONLY a simple replacement prompt without any introduction, explanation, or commentary. Do not start with phrases like "Here's a detailed prompt" or any descriptive text. Return ONLY the direct prompt content.

    Create a simple English prompt for replacing the garment from the reference image onto a ${modelGenderText}. 

    CRITICAL REQUIREMENTS:
    1. Replace the flat-lay garment from the input image directly onto a standing ${baseModelText}
    2. Keep the original garment exactly the same without changing any design, shape, colors, patterns, or details
    3. Do not modify or redesign the garment in any way
    4. The final image should be photorealistic, showing the same garment perfectly fitted on the ${baseModelText}
    5. Use natural studio lighting with a clean background
    6. Preserve ALL original garment details: colors, patterns, textures, hardware, stitching, logos, graphics, and construction elements
    7. The garment must appear identical to the reference image, just worn by the model instead of being flat

    LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English.

    ${
      originalPrompt
        ? `Additional requirements: ${originalPrompt}.`
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
    
    Generate a concise prompt focused on garment replacement while maintaining all original details.
    `;

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

// Arkaplan silme fonksiyonu
async function removeBackgroundFromImage(imageUrl, userId) {
  try {
    console.log("🖼️ Arkaplan silme işlemi başlatılıyor:", imageUrl);

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

        // Düzeltilmiş resmi Supabase'e yükle
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

        // Sensitive content hatasını kontrol et
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("flagged as sensitive") ||
            result.error.includes("E005") ||
            result.error.includes("sensitive content"))
        ) {
          console.error(
            "❌ Sensitive content hatası tespit edildi, flux-kontext-dev'e geçiş yapılacak"
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

// Ana generate endpoint'i - Tek resim için
router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme
  const CREDIT_COST = 20; // Her oluşturma 5 kredi
  let creditDeducted = false;
  let userId; // Scope için önceden tanımla
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
    } = req.body;

    // userId'yi scope için ata
    userId = requestUserId;

    console.log("🖼️ [BACKEND] isMultipleImages:", isMultipleImages);
    console.log("🛍️ [BACKEND] isMultipleProducts:", isMultipleProducts);
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

    // 🤖 Gemini'ye orijinal ham resmi gönder (paralel)
    const geminiPromise = enhancePromptWithGemini(
      promptText,
      finalImage, // Ham orijinal resim
      settings || {},
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleProducts,
      false // ControlNet yok, ham resim
    );

    // 🖼️ Arkaplan silme işlemi (paralel)
    const backgroundRemovalPromise = removeBackgroundFromImage(
      finalImage,
      userId
    );

    // ⏳ Gemini ve arkaplan silme işlemlerini paralel bekle
    console.log("⏳ Gemini ve arkaplan silme paralel olarak bekleniyor...");
    const [enhancedPrompt, backgroundRemovedImage] = await Promise.all([
      geminiPromise,
      backgroundRemovalPromise,
    ]);

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

    // 🖼️ İki resmi yan yana birleştirme (orijinal + canny) - Replicate için
    let combinedImageForReplicate = backgroundRemovedImage; // Fallback - her zaman arkaplanı silinmiş resim
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
    let finalResult;
    let processingTime;

    try {
      finalResult = await pollReplicateResult(initialResult.id);
      processingTime = Math.round((Date.now() - startTime) / 1000);
    } catch (pollingError) {
      console.error("❌ Polling hatası:", pollingError.message);

      // Sensitive content hatası yakalandıysa flux-kontext-dev'e geç
      if (pollingError.message === "SENSITIVE_CONTENT_FLUX_FALLBACK") {
        console.log(
          "🔄 Sensitive content hatası nedeniyle flux-kontext-dev'e geçiliyor..."
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

          console.log("✅ Flux-kontext-dev API'den başarılı sonuç alındı");
        } catch (fallbackError) {
          console.error(
            "❌ Flux-kontext-dev API'si de başarısız:",
            fallbackError.message
          );

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
                    (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
                })
                .eq("id", userId);

              console.log(
                `💰 ${CREDIT_COST} kredi iade edildi (Fallback API hatası)`
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
                  (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
              })
              .eq("id", userId);

            console.log(`💰 ${CREDIT_COST} kredi iade edildi (Polling hatası)`);
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

    if (isFluxKontextDevResult || isStandardResult) {
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
        locationImage,
        poseImage,
        hairStyleImage,
        formattedRatio,
        initialResult.id,
        processingTime,
        isMultipleImages,
        isMultipleProducts
      );

      // 🗑️ İşlem başarıyla tamamlandı, geçici dosyaları hemen temizle
      console.log("🧹 Başarılı işlem sonrası geçici dosyalar temizleniyor...");
      await cleanupTemporaryFiles(temporaryFiles);

      return res.status(200).json(responseData);
    } else {
      console.error("Replicate API başarısız:", finalResult);

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

module.exports = router;
