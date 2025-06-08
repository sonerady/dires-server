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

// Prompt'u iyileştirmek için Gemini'yi kullan
async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false
) {
  try {
    console.log(
      "🤖 Gemini 2.0 Flash ile prompt iyileştirme başlatılıyor (tek resim için)"
    );
    console.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    console.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    console.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);
    console.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);

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
        maxOutputTokens: 8192,
      },
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

    // Gender mapping'ini düzelt - hem man/woman hem de male/female değerlerini handle et
    let modelGenderText;
    const genderLower = gender.toLowerCase();

    if (genderLower === "male" || genderLower === "man") {
      modelGenderText = "male model";
    } else if (genderLower === "female" || genderLower === "woman") {
      modelGenderText = "female model";
    } else {
      modelGenderText = "female model"; // varsayılan
    }

    // Yaş aralığına göre model türünü belirle
    if (age) {
      const ageLower = age.toLowerCase();
      if (ageLower.includes("baby") || ageLower.includes("bebek")) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "baby male model"
            : "baby female model";
      } else if (
        ageLower.includes("child") ||
        ageLower.includes("çocuk") ||
        ageLower.includes("kid")
      ) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "young male model"
            : "young female model"; // AI content policy için "child" yerine "young" kullan
      } else if (
        ageLower.includes("young") ||
        ageLower.includes("genç") ||
        ageLower.includes("teen")
      ) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "teenage male model"
            : "teenage female model";
      } else if (ageLower.includes("adult") || ageLower.includes("yetişkin")) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "adult male model"
            : "adult female model";
      } else if (ageLower.includes("years old") || /\d+/.test(age)) {
        // Özel girilen yaş (örn: "25 years old" veya sayı içeren)
        const ageNumber = parseInt(age.match(/\d+/)?.[0]);
        let ageCategory = "adult";

        if (ageNumber && ageNumber < 3) {
          ageCategory = "baby";
        } else if (ageNumber && ageNumber < 13) {
          ageCategory = "young";
        } else if (ageNumber && ageNumber < 18) {
          ageCategory = "teenage";
        } else if (ageNumber && ageNumber >= 18) {
          ageCategory = "adult";
        }

        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? `${ageCategory} male model`
            : `${ageCategory} female model`;
      }
    }

    console.log("👤 [GEMINI] Gelen gender ayarı:", gender);
    console.log("👶 [GEMINI] Gelen age ayarı:", age);
    console.log("👤 [GEMINI] Final model türü:", modelGenderText);

    // ⚠️ CRITICAL: Yaş bilgisinin önemi için özel section
    let ageSection = "";
    if (age) {
      console.log("👶 [GEMINI] CRITICAL: Yaş bilgisi tespit edildi:", age);
      ageSection = `
    
    🚨 CRITICAL AGE REQUIREMENT - ABSOLUTE PRIORITY:
    The user has specified a very important age requirement: "${age}"
    
    THIS IS EXTREMELY IMPORTANT AND MUST BE FOLLOWED:
    - You MUST incorporate this exact age specification into your enhanced prompt
    - The age "${age}" MUST appear explicitly in your generated prompt
    - This age specification is CRITICAL for the image generation process
    - Do NOT skip or ignore this age requirement under any circumstances
    - The model description MUST reflect the characteristics appropriate for this age: "${age}"
    - This is a mandatory requirement that cannot be omitted or changed
    
    EXAMPLE: If age is "25 years old", your prompt MUST include something like "25 years old model" or "25-year-old professional model"
    EXAMPLE: If age is "young adult", your prompt MUST include "young adult model" or similar appropriate age-specific language
    
    ⚠️ FAILURE TO INCLUDE THE AGE SPECIFICATION WILL RESULT IN INCORRECT IMAGE GENERATION ⚠️`;
    }

    let settingsPromptSection = "";

    if (hasValidSettings) {
      const settingsText = Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null && value !== undefined && value !== ""
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
        ([key, value]) => value !== null && value !== undefined && value !== ""
      )
      .map(
        ([key, value]) =>
          `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`
      )
      .join("\n    ")}
    
    IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.
    ${
      age
        ? `\n    SPECIAL ATTENTION: The age setting "${age}" is MANDATORY and must appear in your final prompt.`
        : ""
    }`;
    }

    // Pose ve perspective için akıllı öneri sistemi
    let posePromptSection = "";
    let perspectivePromptSection = "";

    // Eğer pose seçilmemişse, Gemini'ye kıyafete uygun poz önerisi yap
    if (!settings?.pose && !poseImage) {
      const garmentText = isMultipleProducts
        ? "multiple garments/products ensemble"
        : "garment/product";
      posePromptSection = `
    
    INTELLIGENT POSE SELECTION: Since no specific pose was selected by the user, please analyze the ${garmentText} in the reference image and intelligently select the MOST APPROPRIATE pose for the ${modelGenderText} that will:
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
    
    POSE REFERENCE: A pose reference image has been provided to show the desired body position and posture for the ${modelGenderText}. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${modelGenderText} should adopt this specific pose naturally and convincingly${
        isMultipleProducts
          ? ", ensuring all products in the ensemble remain clearly visible and well-positioned"
          : ""
      }.`;

      console.log("🤸 [GEMINI] Pose prompt section eklendi");
    } else if (settings?.pose) {
      posePromptSection = `
    
    SPECIFIC POSE REQUIREMENT: The user has selected a specific pose: "${
      settings.pose
    }". Please ensure the ${modelGenderText} adopts this pose while maintaining natural movement and ensuring the pose complements ${
        isMultipleProducts
          ? "all products in the ensemble being showcased"
          : "the garment being showcased"
      }.`;

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
    
    HAIR STYLE REFERENCE: A hair style reference image has been provided to show the desired hairstyle for the ${modelGenderText}. Please analyze this hair style image carefully and incorporate the exact hair length, texture, cut, styling, and overall hair appearance into your enhanced prompt. The ${modelGenderText} should have this specific hairstyle that complements ${
        isMultipleProducts ? "the multi-product ensemble" : "the garment"
      } and overall aesthetic.`;

      console.log("💇 [GEMINI] Hair style prompt section eklendi");
    }

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    IMPORTANT INSTRUCTION: Please generate ONLY the requested prompt without any introduction, explanation, or commentary. Do not start with phrases like "Here's a detailed prompt" or "Editorial Photography Prompt" or any descriptive text. Return ONLY the direct prompt content that will be used for image generation.

    PROMPT LENGTH REQUIREMENT: Generate a comprehensive, detailed prompt that is AT LEAST 500 words long. Include extensive descriptions of fabric details, lighting conditions, environmental elements, model positioning, garment construction, textures, colors, styling elements, and photographic composition. The prompt should be richly detailed and descriptive to ensure high-quality image generation.

    CRITICAL MODEL DESCRIPTION REQUIREMENT: You MUST provide extensive descriptions of the ${modelGenderText} throughout the prompt. This includes:
    - Physical appearance and body characteristics appropriate for the garment${
      age ? ` AND specifically for age "${age}"` : ""
    }
    - Posture, stance, and body positioning details appropriate for the specified age${
      age ? ` ("${age}")` : ""
    }
    - Facial expression and overall demeanor that matches the age specification${
      age ? ` ("${age}")` : ""
    }
    - Body lines, silhouette, and how the model carries themselves
    - Hand positioning, arm placement, and leg positioning
    - Model's interaction with the garment and how they wear it
    - Professional modeling presence and confidence appropriate for the age${
      age ? ` ("${age}")` : ""
    }
    - How the model's physique complements the garment design
    - Natural movement and body language that enhances the garment presentation
    ${
      age
        ? `- MANDATORY: Age-appropriate characteristics and appearance for "${age}" must be clearly described`
        : ""
    }
    The ${modelGenderText}${
      age ? ` (age: ${age})` : ""
    } should be mentioned frequently throughout the description, not just briefly at the beginning.

    MANDATORY COMPLETE STYLING REQUIREMENT: You MUST create a complete, cohesive outfit that perfectly complements the main reference garment. Analyze the reference garment carefully and determine what additional clothing items would:
    - Best complement and enhance the main garment
    - Create a harmonious color palette and style coordination
    - Match the occasion and style aesthetic of the main piece
    - Provide proper proportional balance to the overall look
    - Showcase the main garment as the hero piece while supporting it with appropriate items

    STYLING GUIDELINES:
    - If the reference is a TOP (shirt, blouse, sweater, etc.): Specify complementary bottoms (pants, skirts, shorts) that enhance the top's design, color, and style
    - If the reference is a BOTTOM (pants, skirt, shorts, etc.): Specify complementary tops that work perfectly with the bottom piece's style and color
    - If the reference is a DRESS: Specify appropriate outerwear, accessories, or layering pieces that complement without overwhelming
    - If the reference is OUTERWEAR: Specify appropriate underlying garments that show through or peek out in a stylish way
    - Always consider seasonal appropriateness and style cohesion
    - Mention specific colors, textures, and styles that work harmoniously with the main piece
    - Ensure the additional items don't compete with but rather enhance the main garment's visual impact

    EXAMPLES OF COMPLETE STYLING:
    - Red floral blouse → Pair with high-waisted cream or navy tailored trousers, or a flowing midi skirt in complementary neutral tones
    - Dark wash jeans → Style with a crisp white button-down shirt or a soft cashmere sweater in earth tones
    - Floral summer dress → Add a light denim jacket or linen blazer for layering depth
    - Black leather jacket → Show with a fitted white t-shirt and dark skinny jeans underneath

    CRITICAL GARMENT ANALYSIS REQUIREMENT: You MUST conduct a thorough visual analysis of the reference garment image and describe EVERY visible construction detail, fit characteristic, and structural element. This is essential for accurate representation:

    MANDATORY GARMENT INSPECTION CHECKLIST:
    1. FIT ANALYSIS: Analyze how the garment fits on the body - is it loose/relaxed, fitted/tailored, oversized, or form-fitting? Describe the silhouette shape and how much ease/room there is between fabric and body.
    
    2. CUT AND CONSTRUCTION: Examine the garment's cut style - A-line, straight cut, bias cut, princess seams, empire waist, wrap style, etc. Note any architectural shaping or construction techniques.
    
    3. DRAPE AND FABRIC BEHAVIOR: Observe how the fabric drapes and flows - does it hang straight, have natural gathers, create pleats or folds? Is the fabric stiff and structured or soft and flowing?
    
    4. PROPORTIONS AND MEASUREMENTS: Note the garment's proportions - sleeve length, hemline placement, neckline depth, overall garment length, and how these relate to the model's body.
    
    5. STRUCTURAL DETAILS: Identify all visible construction elements - seam placement, dart positioning, panel divisions, gathering, pleating, tucking, or any shaping techniques.
    
    6. EDGE TREATMENTS: Examine all edges - hemlines, necklines, armholes, cuffs - noting their finishing style, width, and how they behave (curved, straight, flared, gathered).
    
    7. VOLUME AND FULLNESS: Assess where the garment has volume or fullness - sleeves, skirt, bodice areas - and describe how this fullness is created and distributed.
    
    8. FABRIC WEIGHT AND TEXTURE: Determine the apparent fabric weight (lightweight/flowing vs heavyweight/structured) and surface texture that affects how the garment behaves.

    CRITICAL ACCURACY REQUIREMENT: Carefully analyze the reference image and describe ONLY the features that actually exist in the garment. Do NOT assume or invent details that are not visible. Pay special attention to:
    - Only mention pockets if they are clearly visible in the reference image
    - Only describe buttons, zippers, or closures that actually exist
    - Only reference specific design elements that are actually present
    - If a garment has no pockets, do NOT suggest poses involving hands in pockets
    - If there are no visible buttons, do NOT mention buttoning or unbuttoning
    - Base all styling and posing suggestions on the actual garment construction shown
    - Ensure model poses are appropriate for the specific garment features that exist
    
    GARMENT LENGTH AND BODY COVERAGE ANALYSIS: Carefully analyze where the garment falls on the body and specify the exact body areas it covers. For each garment type, describe precisely:
    - For tops/shirts/blouses: Does it reach the waist, hip bone, mid-torso, or is it cropped above the waist?
    - For dresses: Does it reach knee-length, midi (mid-calf), ankle-length, or floor-length?
    - For pants/trousers: Are they full-length, ankle-length, capri (mid-calf), or shorts?
    - For skirts: Do they reach mini (upper thigh), knee-length, midi, or maxi length?
    - For jackets/coats: Do they end at the waist, hip, mid-thigh, or longer?
    - For sleeves: Are they sleeveless, short-sleeve, three-quarter, or full-length?
    - For necklines: Specify if it's crew neck, V-neck, scoop neck, high neck, off-shoulder, etc.
    This length and coverage information is crucial for accurate garment representation and appropriate styling suggestions.

    DETAILED CONSTRUCTION TERMINOLOGY: Use professional fashion construction terms when describing garment details:
    - Seaming techniques: French seams, flat-fell seams, serged edges, bound seams
    - Shaping methods: Darts, princess seams, side panels, waist seaming, bust darts
    - Closures: Invisible zippers, exposed zippers, snap closures, hook-and-eye, ties
    - Hemming: Blind hem, rolled hem, raw edge, bias binding, faced hem
    - Neckline finishes: Bias binding, facing, self-fabric binding, contrast piping
    - Sleeve attachments: Set-in sleeves, raglan sleeves, dolman sleeves, cap sleeves

    SAFETY NOTICE: Please ensure that all descriptions avoid potentially sensitive or flagged content. Do NOT include any language or terms that could be interpreted as:
- Sexualized or body-focused descriptions (e.g., "slender", "curvy", "inviting", "provocative", "youthful", "bare skin", "revealing", "tight-fitting", etc.)
- Any reference to age, body type, or attractiveness in a way that could trigger moderation
- References to minors in suggestive settings or poses
Always prefer neutral, professional, and editorial-style language that emphasizes garment craftsmanship, fashion styling, and photographic composition. If a description includes a model, ensure the portrayal is professional, respectful, and appropriate for a fashion editorial setting.


    Create a detailed English prompt for high-fashion editorial photography featuring the main product/garment from the provided reference image worn by a ${modelGenderText}. Absolutely avoid terms like transparent, see-through, sheer, revealing, exposed, decolletage, cleavage, low-cut, plunging, bare skin, provocative, sensual, sexy, seductive, tight-fitting for sensitive areas, body-hugging, form-fitting, or fabric opacity levels. Use safe alternatives like lightweight, delicate, fine-weave, airy, modern cut, contemporary style, elegant neckline, refined cut instead. Never mention brand names, designer names, or commercial labels like Nike, Adidas, Zara, H&M, Louis Vuitton etc. Describe items as premium garment, high-quality piece, professional design instead. 

    CRITICAL FOCUS REQUIREMENT: COMPLETELY IGNORE and DO NOT mention any of the following elements that may appear in the reference image:
    - Background furniture, objects, or environmental items unrelated to the main garment
    - Sales tags, price tags, hangtags, or any commercial labeling on the garment
    - Photography equipment, mannequins, hangers, or display materials
    - Supporting fabrics, background cloths, or photography aids used in the reference shot
    - Irrelevant objects, decorative items, or clutter in the background
    - Store fixtures, retail displays, or commercial photography setups
    - Any visual elements that are not part of the actual garment/product itself
    
    Focus EXCLUSIVELY on analyzing and describing only the main garment/product that is meant to be showcased, treating it as if it's being worn by the ${modelGenderText} in a clean, professional editorial environment.

    The ${modelGenderText} must always be wearing the product. Describe the exact fabric type, weave pattern, weight, texture, finish, stretch properties, and coverage in natural flowing sentences. Detail every visible seam type, stitching patterns, thread visibility, seam finishing quality, hemming techniques, edge treatments, topstitching, and construction methods as part of the description. Analyze all design elements including prints, patterns, embroidery, color techniques, decorative elements like buttons, zippers, trim details, and hardware. Specify exact fit type, how the garment drapes, silhouette shape, proportions, length, sleeve style, and neckline construction. Include surface treatments, finishes, pleating, gathering, wash effects, coatings, embellishments, and quality indicators. The photography should be hyper-realistic with perfect studio lighting showcasing fabric texture and construction details, professional camera angles highlighting craftsmanship, and composition emphasizing garment excellence.

    ESSENTIAL GARMENT BEHAVIOR DESCRIPTION: You must describe how this specific garment behaves when worn:
    - How the fabric moves and flows with body movement
    - Where the garment creates volume, structure, or close fit
    - How the weight and drape of the fabric affects the overall silhouette
    - The way seams, darts, and construction elements shape the garment
    - How the garment's proportions relate to the human form
    - The visual impact of the garment's cut and construction choices

    ${
      originalPrompt
        ? `Incorporate these specific requirements: ${originalPrompt}.`
        : ""
    } ${
      hasValidSettings
        ? `Integrate these user settings naturally: ${Object.entries(settings)
            .filter(
              ([key, value]) =>
                value !== null && value !== undefined && value !== ""
            )
            .map(([key, value]) => `${key} is ${value}`)
            .join(", ")}.`
        : ""
    }
    
    ${ageSection}
    ${settingsPromptSection}
    ${locationPromptSection}
    ${posePromptSection}
    ${perspectivePromptSection}
    ${hairStylePromptSection}
    
    Generate a single, flowing description that reads like a master craftsperson's analysis of premium garment construction, emphasizing professional quality, material excellence, and attention to detail throughout. The ${modelGenderText}${
      age ? ` (age: ${age})` : ""
    } should be prominently featured and described extensively throughout the prompt - their posture, stance, body lines, professional presence, and how they embody the garment's style and quality. ${
      age
        ? `CRITICAL REMINDER: The model's age specification "${age}" MUST be explicitly mentioned and reflected in all physical descriptions, facial characteristics, and overall presentation style.`
        : ""
    } Describe how the ${modelGenderText} demonstrates natural movement showcasing how the fabric behaves when worn, with poses appropriate for the garment category${
      age ? ` and the model's age (${age})` : ""
    } and facial expressions matching the intended style and quality level. Include detailed descriptions of the model's physical interaction with the garment, their professional modeling presence${
      age ? ` appropriate for their age (${age})` : ""
    }, and how their body positioning enhances the overall presentation. The complete styled outfit should be described as a cohesive ensemble where the main garment is the star piece perfectly complemented by thoughtfully selected additional clothing items. ${
      age
        ? `FINAL REQUIREMENT: Ensure the model's age "${age}" is clearly specified in your enhanced prompt and all descriptions reflect age-appropriate characteristics.`
        : ""
    } Ensure no suggestive words, focus only on fashion and craftsmanship, use professional technical terminology, maintain editorial magazine tone, avoid content moderation triggers, emphasize construction over inappropriate body descriptions, and use no brand names whatsoever.
    `;

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, intelligently select the most suitable pose and camera angle for the ${modelGenderText} that showcases the garment's design features, fit, and construction quality. Choose poses appropriate for the garment category with body language that complements the style and allows clear visibility of craftsmanship details. Select camera perspectives that create appealing commercial presentations highlighting the garment's key selling points.`;
      } else {
        promptForGemini += `The ${modelGenderText} must adopt a pose that showcases the garment's construction details, fabric drape, and design elements while maintaining natural movement that demonstrates how the fabric behaves when worn. Ensure poses emphasize the garment's silhouette and proportions with facial expressions matching the intended style.`;
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
    const maxRetries = 3;

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

        enhancedPrompt = result.response.text().trim();
        console.log(
          "🤖 [BACKEND GEMINI] Gemini'nin ürettiği prompt:",
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
          enhancedPrompt = originalPrompt;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
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

// Ana generate endpoint'i - Tek resim için
router.post("/generate", async (req, res) => {
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
      console.log(
        "🔍 [DEBUG] Reference Image Object:",
        JSON.stringify(referenceImage, null, 2)
      );
      console.log("🔍 [DEBUG] Base64 data var mı?", !!referenceImage.base64);
      console.log(
        "🔍 [DEBUG] Base64 data uzunluğu:",
        referenceImage.base64 ? referenceImage.base64.length : "yok"
      );

      // Referans resmini önce Supabase'e yükle ve URL al
      let imageSourceForUpload;

      // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
      if (referenceImage.base64) {
        imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
        console.log("Base64 data kullanılıyor Supabase upload için");
      } else if (
        referenceImage.uri.startsWith("http://") ||
        referenceImage.uri.startsWith("https://")
      ) {
        imageSourceForUpload = referenceImage.uri;
        console.log(
          "HTTP URI kullanılıyor Supabase upload için:",
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

    // Kullanıcının prompt'unu Gemini ile iyileştir
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      finalImage,
      settings || {},
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleProducts
    );

    console.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    console.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // Replicate API'ye istek gönder
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
        locationImage,
        poseImage,
        hairStyleImage,
        formattedRatio,
        initialResult.id,
        processingTime,
        isMultipleImages,
        isMultipleProducts
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

module.exports = router;
