const express = require("express");
const router = express.Router();
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
const supabase = createClient(supabaseUrl, supabaseKey);

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
  referenceImageUrls // Artık URL'ler gelecek
) {
  try {
    // User ID yoksa, "anonymous" olarak kaydedelim
    const userIdentifier = userId || "anonymous_" + Date.now();

    const { data: insertData, error } = await supabase
      .from("reference_explores")
      .insert([
        {
          user_id: userIdentifier,
          image_url: data.result.imageUrl,
          prompt: originalPrompt,
          enhanced_prompt: data.result.enhancedPrompt,
          reference_images: referenceImageUrls, // Artık Supabase URL'leri
          created_at: new Date().toISOString(),
        },
      ]);

    if (error) {
      console.error("Veritabanına kaydetme hatası:", error);
      return false;
    }

    console.log("Görsel başarıyla veritabanına kaydedildi");
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
  hairStyleImage
) {
  try {
    console.log("Gemini ile prompt iyileştirme başlatılıyor (tek resim için)");
    console.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    console.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    console.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);

    // Gemini modeli
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

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
    
    IMPORTANT: Please incorporate the user settings above into your description when appropriate.`;
    }

    // Location bilgisi için ek prompt section
    let locationPromptSection = "";
    if (locationImage) {
      locationPromptSection = `
    
    LOCATION REFERENCE: A location reference image has been provided to help you understand the desired environment/background setting. Please analyze this location image carefully and incorporate its environmental characteristics, lighting style, architecture, mood, and atmosphere into your enhanced prompt. This location should influence the background, lighting conditions, and overall scene composition in your description.`;

      console.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

    // Pose bilgisi için ek prompt section
    let posePromptSection = "";
    if (poseImage) {
      posePromptSection = `
    
    STYLING REFERENCE: A styling reference image has been provided to show the desired product arrangement and positioning approach. Please analyze this styling image carefully and incorporate the arrangement style, positioning technique, and overall product presentation approach into your enhanced prompt. The product should be arranged following this reference styling approach.`;

      console.log("🎨 [GEMINI] Styling prompt section eklendi");
    }

    // Hair style bilgisi için ek prompt section
    let hairStylePromptSection = "";
    if (hairStyleImage) {
      hairStylePromptSection = `
    
    ENVIRONMENTAL STYLING REFERENCE: An environmental styling reference image has been provided to show additional styling elements that should complement the overall scene aesthetic. Please analyze this reference image carefully and incorporate complementary styling elements, textures, or decorative aspects that enhance the product presentation and environmental mood.`;

      console.log("🌿 [GEMINI] Environmental styling prompt section eklendi");
    }

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    IMPORTANT INSTRUCTION: Please generate ONLY the requested prompt without any introduction, explanation, or commentary. Do not start with phrases like "Here's a detailed prompt" or "Editorial Photography Prompt" or any descriptive text. Return ONLY the direct prompt content that will be used for image generation.

    PROMPT LENGTH REQUIREMENT: Generate a comprehensive, detailed prompt that is AT LEAST 500 words long. Include extensive descriptions of fabric details, lighting conditions, environmental elements, product arrangement, garment construction, textures, colors, styling elements, and photographic composition. The prompt should be richly detailed and descriptive to ensure high-quality image generation.

    CRITICAL ACCURACY REQUIREMENT: Carefully analyze the reference image and describe ONLY the features that actually exist in the garment. Do NOT assume or invent details that are not visible. Pay special attention to:
    - Only mention pockets if they are clearly visible in the reference image
    - Only describe buttons, zippers, or closures that actually exist
    - Only reference specific design elements that are actually present
    - Base all styling and arrangement suggestions on the actual garment construction shown
    - Ensure product positioning highlights the specific garment features that exist
    - Do not suggest interactions with non-existent elements

    Create a detailed English prompt for professional e-commerce product photography featuring the main product/garment from the provided reference image. Ignore all background elements, supporting materials, fabric cloths, or photography aids and focus only on the actual product meant to be showcased. Never mention brand names, designer names, or commercial labels and describe items as premium garment, high-quality piece, professional design instead.

    This should be professional cut-out and clipping path treatment with the product completely isolated from any background elements, perfect clipping path applied with pixel-perfect edges, clean cut-out technique with no background artifacts, pure white background with no textures or variations, and professional isolation as if expertly cut-out in post-production. Apply advanced product retouching with all surface imperfections, dust, scratches and blemishes completely removed, wrinkles and fabric creases professionally smoothed, color correction applied for accurate vibrant colors, lighting perfectly balanced with no harsh shadows, surface textures enhanced for maximum appeal, stitching and seams cleaned where visible, manufacturing defects digitally corrected, and fabric grain optimized for premium appearance.

    For clothing items, apply ghost mannequin effect with garment appearing naturally shaped as if worn by an invisible model, proper draping and dimensional form showing natural fall, sleeves, collar and body sections properly positioned, no visible mannequin or model, realistic volume and three-dimensional appearance, and professional fashion photography styling. Use professional studio lighting that is soft and even, eliminating harsh shadows on the product, multiple light sources simulation for perfect illumination, no directional shadows casting onto background, highlight and shadow balance optimized for detail visibility, commercial photography lighting setup, and color temperature perfectly balanced.

    The product should be positioned center-frame against pure white background, perfectly isolated for premium e-commerce presentation. Describe the exact fabric type, weave pattern, weight, texture, finish, stretch properties, and coverage. Detail every visible seam type, stitching patterns, thread visibility, seam finishing quality, hemming techniques, edge treatments, topstitching, and construction methods. Analyze all design elements including prints, patterns, embroidery, color techniques, decorative elements like buttons, zippers, trim details, and hardware. Include surface treatments, finishes, pleating, gathering, wash effects, coatings, embellishments, and quality indicators. Demand hyper-realistic professional e-commerce product photography with pure white background, perfect clipping path isolation, studio-quality lighting revealing every fabric detail, commercial photography composition with optimal product presentation, no environmental elements or props, and professional retouching standards.

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
    
    ${settingsPromptSection}
    ${locationPromptSection}
    ${posePromptSection}
    ${hairStylePromptSection}
    
    Generate a single flowing description that reads like a master craftsperson's analysis of premium garment construction, emphasizing professional quality, material excellence, and attention to detail throughout, formatted for professional e-commerce product photography with pure white background.
    `;

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("product styling")) {
      promptForGemini += `Product must be arranged to perfectly showcase construction details and design elements with positioning that highlights fabric drape, texture, and special design features. Arrangement should complement environmental aesthetic and location mood with styling that allows clear visibility of craftsmanship details like seams, hems, and closures. Product should be positioned to demonstrate quality and appeal within the environment, emphasizing unique characteristics and design while creating compelling visual storytelling through pure product display. Use professional product photography lighting that reveals every fabric detail and texture with expert composition balancing product focus and environmental context.`;
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

    // Gemini'den cevap al (retry mekanizması ile)
    let enhancedPrompt;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent({
          contents: [{ parts }],
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
    console.error("Prompt iyileştirme hatası:", error);
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
            "❌ Sensitive content hatası tespit edildi, polling durduruluyor"
          );
          throw new Error(
            "SENSITIVE_CONTENT: İlgili ürün işlenirken uygunsuz içerikler tespit edildi. Lütfen farklı bir görsel veya ayarlarla yeniden deneyin."
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

      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Replicate işlemi zaman aşımına uğradı");
}

// Çoklu resimleri canvas ile birleştiren fonksiyon
async function combineImagesOnCanvas(images, userId) {
  try {
    console.log(
      "🎨 Canvas ile resim birleştirme başlatılıyor...",
      images.length,
      "resim"
    );

    // Canvas boyutları - en geniş resmi baz alacağız
    let maxWidth = 0;
    let totalHeight = 0;
    const loadedImages = [];

    // Tüm resimleri yükle ve boyutları hesapla
    for (let i = 0; i < images.length; i++) {
      const imgData = images[i];
      let imageBuffer;

      // Base64 veya HTTP URL'den resmi yükle
      if (imgData.base64) {
        imageBuffer = Buffer.from(imgData.base64, "base64");
      } else if (
        imgData.uri.startsWith("http://") ||
        imgData.uri.startsWith("https://")
      ) {
        const response = await axios.get(imgData.uri, {
          responseType: "arraybuffer",
        });
        imageBuffer = Buffer.from(response.data);
      } else if (imgData.uri.startsWith("file://")) {
        throw new Error("Yerel dosya için base64 data gönderilmelidir.");
      }

      const img = await loadImage(imageBuffer);
      loadedImages.push(img);

      if (img.width > maxWidth) {
        maxWidth = img.width;
      }
      totalHeight += img.height;

      console.log(`📐 Resim ${i + 1}: ${img.width}x${img.height}`);
    }

    console.log(`📏 Canvas boyutu: ${maxWidth}x${totalHeight}`);

    // Canvas oluştur
    const canvas = createCanvas(maxWidth, totalHeight);
    const ctx = canvas.getContext("2d");

    // Beyaz arka plan
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, maxWidth, totalHeight);

    // Resimleri dikey olarak sırala
    let currentY = 0;
    for (let i = 0; i < loadedImages.length; i++) {
      const img = loadedImages[i];
      const x = (maxWidth - img.width) / 2; // Ortala

      ctx.drawImage(img, x, currentY);
      currentY += img.height;

      console.log(
        `🖼️ Resim ${i + 1} yerleştirildi: (${x}, ${currentY - img.height})`
      );
    }

    // Canvas'ı buffer'a çevir
    const buffer = canvas.toBuffer("image/jpeg", { quality: 0.8 });
    console.log("📊 Birleştirilmiş resim boyutu:", buffer.length, "bytes");

    // Supabase'e yükle
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `combined_${
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
    } = req.body;

    // userId'yi scope için ata
    userId = requestUserId;

    console.log("🖼️ [BACKEND] isMultipleImages:", isMultipleImages);
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
      finalImage = await combineImagesOnCanvas(referenceImages, userId);
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

      console.log(
        "🔍 [DEBUG] Base64 data uzunluğu:",
        referenceImage.base64 ? referenceImage.base64.length : "yok"
      );

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
      hairStyleImage
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
    const finalResult = await pollReplicateResult(initialResult.id);

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
        referenceImageUrls // Artık Supabase URL'leri
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

    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
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
