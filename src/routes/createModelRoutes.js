2.0-flashconst express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Replicate'den gelen resmi Supabase storage'a kaydet
async function uploadModelImageToSupabaseStorage(
  imageUrl,
  userId,
  replicateId
) {
  try {
    console.log("📤 Model resmi Supabase storage'a yükleniyor...");
    console.log("Image URL:", imageUrl);
    console.log("User ID:", userId);
    console.log("Replicate ID:", replicateId);

    // Replicate'den resmi indir
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Resim indirilemedi: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageData = Buffer.from(imageBuffer);

    // Dosya adını oluştur
    const timestamp = Date.now();
    const fileName = `user-models/${userId}/${timestamp}-${replicateId}.jpg`;

    console.log("📁 Dosya adı:", fileName);

    // Supabase storage'a yükle
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("user-models")
      .upload(fileName, imageData, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase storage upload hatası:", uploadError);
      throw uploadError;
    }

    console.log("✅ Model resmi Supabase storage'a yüklendi:", uploadData.path);

    // Public URL oluştur
    const { data: urlData } = supabase.storage
      .from("user-models")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;
    console.log("🔗 Public URL:", publicUrl);

    return {
      storagePath: fileName,
      publicUrl: publicUrl,
    };
  } catch (error) {
    console.error("Model resmi yükleme hatası:", error);
    throw error;
  }
}

// Gemini ile dil/ülkeye uygun isim generate et
async function generateModelNameWithGemini(
  gender,
  age,
  languageCode,
  regionCode
) {
  try {
    console.log("🏷️ Gemini ile model ismi oluşturuluyor...");
    console.log(
      "Gender:",
      gender,
      "Age:",
      age,
      "Language:",
      languageCode,
      "Region:",
      regionCode
    );

    const requestData = {
      task: "generate_name",
      person: {
        gender: gender,
        age: age,
        language_code: languageCode,
        region_code: regionCode,
      },
      requirements: {
        name_type: "first_name_only",
        cultural_appropriateness: true,
        modern_usage: true,
        response_format: "name_only",
      },
    };

    const prompt = `You are an expert name generator. Based on the following data structure, generate a culturally appropriate first name.

INPUT DATA:
${JSON.stringify(requestData, null, 2)}

INSTRUCTIONS:
- Generate only ONE first name (no last name, no middle name)
- The name should be culturally appropriate for the specified language/region
- The name should be modern and commonly used in that culture
- Consider the gender and age appropriately
- Return ONLY the name, no additional text, explanations, or punctuation
- No quotes, no periods, no extra characters

Generate the appropriate first name:`;

    // Gemini API çağrısı
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);

    const response = await result.response;
    let generatedName = response.text().trim();

    console.log("📊 Gemini name generation result:", generatedName);

    // İsmi temizle - sadece ilk kelimeyi al ve büyük harfle başlat
    generatedName = generatedName
      .split(/\s+/)[0]
      .replace(
        /[^a-zA-ZğüşıöçĞÜŞİÖÇáéíóúñÁÉÍÓÚÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜ]/g,
        ""
      )
      .replace(/['".,!?;:]/g, ""); // Noktalama işaretlerini kaldır

    generatedName =
      generatedName.charAt(0).toUpperCase() +
      generatedName.slice(1).toLowerCase();

    console.log("✅ Generated model name:", generatedName);

    // Eğer isim çok kısa ise tekrar dene
    if (!generatedName || generatedName.length < 2) {
      console.log("⚠️ İsim çok kısa, tekrar deneniyor...");
      const retryPrompt = `Generate a single ${gender} first name from ${regionCode} culture (${languageCode} language). Just the name, nothing else:`;
      const retryResult = await model.generateContent(retryPrompt);
      const retryResponse = await retryResult.response;
      generatedName = retryResponse
        .text()
        .trim()
        .split(/\s+/)[0]
        .replace(
          /[^a-zA-ZğüşıöçĞÜŞİÖÇáéíóúñÁÉÍÓÚÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜ]/g,
          ""
        );
      generatedName =
        generatedName.charAt(0).toUpperCase() +
        generatedName.slice(1).toLowerCase();
    }

    // Son kontrol - hala boşsa basit bir isim ver
    if (!generatedName || generatedName.length < 2) {
      generatedName = gender === "woman" ? "Maria" : "Alex";
      console.log("🔄 Final fallback name used:", generatedName);
    }

    return generatedName;
  } catch (error) {
    console.error("❌ Gemini name generation hatası:", error);

    // Hata durumunda basit fallback
    const simpleName = gender === "woman" ? "Maria" : "Alex";
    console.log("🔄 Error fallback name:", simpleName);
    return simpleName;
  }
}

// GPT-4O-mini ile ID photo prompt enhance et
// Gemini ile resimli prompt enhance (upload edilen resim için)
async function analyzeImageAndGeneratePrompt(uploadedImageUrl) {
  try {
    console.log(
      "🤖 Gemini ile resim analizi ve prompt oluşturma başlatılıyor..."
    );
    console.log("📸 Upload edilen resim URL:", uploadedImageUrl);

    // Resmi base64'e çevir
    const imageResponse = await axios.get(uploadedImageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
    });
    const imageBuffer = imageResponse.data;
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const requestData = {
      task: "analyze_image_and_generate_prompt",
      image_analysis: {
        detect_gender: true,
        detect_age_range: true,
        detect_physical_features: true,
        detect_ethnicity: false,
      },
      prompt_requirements: {
        style: "professional_id_photo",
        background: "pure_white",
        clothing: "white_t_shirt",
        angle: "frontal_direct",
        lighting: "studio_professional",
        expression: "neutral_professional",
        quality: "high_definition_sharp",
      },
      output_format: {
        gender: "detected_gender",
        age: "estimated_age_number",
        prompt: "enhanced_id_photo_prompt",
      },
    };

    // Gemini'ye gönderilecek parts
    const parts = [
      {
        text: `You are an expert image analyzer and prompt engineer. Analyze this uploaded image and return a JSON response with the person's details and an ID photo prompt.

INPUT DATA STRUCTURE:
${JSON.stringify(requestData, null, 2)}

ANALYSIS REQUIREMENTS:
1. Detect the person's gender (woman/man)
2. Estimate their age (number between 18-80)
3. Analyze physical features (skin tone, hair, eyes, facial structure)
4. Generate a professional ID photo prompt

RESPONSE FORMAT (JSON):
{
  "gender": "woman" or "man",
  "age": estimated_age_as_number,
  "prompt": "detailed_professional_id_photo_prompt_in_english"
}

PROMPT REQUIREMENTS:
- Professional passport/ID photo style
- Clean white background (pure white, no texture)
- Person wearing clean white t-shirt
- Direct frontal camera angle (straight on)
- Neutral, professional facial expression
- Professional studio lighting with even illumination, no shadows
- High quality, sharp focus throughout
- Clean composition with proper ID photo proportions

CRITICAL REQUIREMENTS:
- Crystal clear, sharp focus throughout the entire image
- NO blur, NO motion blur, NO depth of field blur
- NO soft focus, NO dreamy effects, NO artistic blur
- Maximum sharpness and clarity on face, hair, clothing, and background
- NO borders, NO frames, NO text, NO watermarks, NO overlays

Analyze the image and return the JSON response:`,
      },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      },
    ];

    // Gemini API çağrısı
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(parts);

    const response = await result.response;
    let responseText = response.text().trim();

    console.log("📊 Gemini image analysis result:", responseText);

    // JSON parse et
    try {
      // JSON'u temizle (markdown formatından)
      responseText = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "");
      const analysisResult = JSON.parse(responseText);

      console.log("✅ Parsed analysis result:", analysisResult);

      // Validation
      if (
        !analysisResult.gender ||
        !analysisResult.age ||
        !analysisResult.prompt
      ) {
        throw new Error("Missing required fields in analysis result");
      }

      return {
        detectedGender: analysisResult.gender,
        detectedAge: analysisResult.age,
        enhancedPrompt: analysisResult.prompt,
      };
    } catch (parseError) {
      console.error("❌ JSON parse hatası:", parseError);
      console.log("Raw response:", responseText);

      // Fallback: Manual extraction
      const genderMatch = responseText.match(/"gender":\s*"(woman|man)"/i);
      const ageMatch = responseText.match(/"age":\s*(\d+)/);
      const promptMatch = responseText.match(/"prompt":\s*"([^"]+)"/);

      return {
        detectedGender: genderMatch ? genderMatch[1].toLowerCase() : "woman",
        detectedAge: ageMatch ? parseInt(ageMatch[1]) : 25,
        enhancedPrompt: promptMatch
          ? promptMatch[1]
          : `Professional ID photo of a person wearing a clean white t-shirt against a pure white background. Shot straight on with professional studio lighting. High quality, sharp focus, passport photo style. NO borders, NO frames, NO text, NO watermarks.`,
      };
    }
  } catch (error) {
    console.error("❌ Gemini image analysis hatası:", error);

    // Fallback
    return {
      detectedGender: "woman",
      detectedAge: 25,
      enhancedPrompt:
        "Professional ID photo of a person wearing a clean white t-shirt against a pure white background. Shot straight on with professional studio lighting. High quality, sharp focus, passport photo style. NO borders, NO frames, NO text, NO watermarks.",
    };
  }
}

async function enhanceModelPromptWithGemini2(originalPrompt, gender, age) {
  try {
    console.log("🤖 Gemini ile ID photo prompt enhancement başlatılıyor...");

    const prompt = `You are an expert AI prompt engineer specializing in professional ID photo generation. Create detailed, professional prompts for ID-style portrait photography.

IMPORTANT: Always respond in ENGLISH only, regardless of the input language. If the input is in Turkish, Arabic, or any other language, translate the concept to English and create an English prompt.

Generate a detailed ENGLISH prompt for creating professional ID photos.

🎯 ID PHOTO REQUIREMENTS:
- Professional passport/ID photo style
- Clean white background (pure white, no texture)
- Subject wearing clean white t-shirt
- Direct frontal camera angle (straight on)
- Neutral, professional facial expression
- Good studio lighting (even, no shadows)
- High quality, sharp focus
- Clean composition

📸 TECHNICAL SPECIFICATIONS:
- Shot straight on with direct camera angle
- Studio lighting setup
- Professional photography quality
- Sharp focus throughout
- Even lighting, no harsh shadows
- Clean white background
- White clothing (t-shirt)

🚫 STRICT PROHIBITIONS:
- NO borders, frames, or overlays
- NO text, watermarks, or graphics
- NO busy backgrounds or patterns
- NO colored clothing (only white t-shirt)
- NO dramatic lighting or shadows
- NO artistic effects or filters
- NO side angles or tilted shots

GENDER AND AGE CONTEXT:
- Gender: ${gender}
- Age: ${age}

USER DETAILS TO INCORPORATE:
"${originalPrompt}"

CRITICAL QUALITY REQUIREMENTS:
- Crystal clear, sharp focus throughout the entire image
- NO blur, NO motion blur, NO depth of field blur
- NO soft focus, NO dreamy effects, NO artistic blur
- Maximum sharpness and clarity on face, hair, clothing, and background
- Professional studio photography sharpness standards
- High definition, crisp details, razor-sharp focus

Create a professional ID photo prompt incorporating these details: "${originalPrompt}" for a ${age} year old ${gender}. Return only the enhanced prompt text, no additional formatting or explanations:`;

    // Gemini API çağrısı
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);

    const response = await result.response;
    let enhancedPrompt = response.text().trim();

    console.log("🎯 Gemini enhanced prompt:", enhancedPrompt);

    // Token sayısını kontrol et (yaklaşık)
    const tokenCount = enhancedPrompt.split(/\s+/).length;
    console.log(`Generated prompt token count: ${tokenCount}`);

    // Eğer çok uzunsa kısalt
    if (tokenCount > 512) {
      const words = enhancedPrompt.split(/\s+/);
      enhancedPrompt = words.slice(0, 512).join(" ");
      console.log(`Prompt kısaltıldı: ${enhancedPrompt}`);
    }

    console.log("✅ Gemini ID photo prompt enhancement tamamlandı");
    console.log("Enhanced prompt length:", enhancedPrompt.length);

    return enhancedPrompt;
  } catch (error) {
    console.error("❌ Gemini enhancement hatası:", error.message);
    console.error("❌ Full error:", error);

    // Fallback: Basit prompt döndür
    const fallbackPrompt = `Professional ID photo style portrait of a ${age} ${
      gender === "woman" ? "female" : "male"
    } person wearing a clean white t-shirt. Shot straight on with direct camera angle against a pure white background. The subject looks directly at the camera with a neutral, professional expression. Studio lighting, passport photo style, clean white background, white t-shirt, frontal view, high quality. Crystal clear, sharp focus throughout. NO borders, NO frames, NO text, NO watermarks, NO overlays, clean image only. ${
      originalPrompt ? `Additional details: ${originalPrompt}` : ""
    }`;

    console.log("🔄 Fallback prompt kullanılıyor:", fallbackPrompt);
    return fallbackPrompt;
  }
}

// Google nano-banana ile model generate et (text-to-image)
async function generateModelWithNanoBanana(prompt, gender, age, userId) {
  try {
    console.log("👤 Google nano-banana ile model generation başlatılıyor...");
    console.log("Original prompt:", prompt);
    console.log("Gender:", gender);
    console.log("Age:", age);

    // 1. Gemini ile prompt'u enhance et
    const enhancedPrompt = await enhanceModelPromptWithGemini2(
      prompt,
      gender,
      age
    );

    console.log("Enhanced prompt:", enhancedPrompt);

    const response = await fetch(
      "https://api.replicate.com/v1/models/google/nano-banana/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            prompt: enhancedPrompt,
            image_input: [],
            output_format: "jpg",
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google nano-banana API Error:", errorText);
      throw new Error(`Google nano-banana API Error: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Google nano-banana model generation tamamlandı");
    console.log("nano-banana result:", result);

    // Output string veya array olabilir
    let imageUrl = null;
    if (result.output) {
      if (Array.isArray(result.output) && result.output.length > 0) {
        imageUrl = result.output[0];
      } else if (typeof result.output === "string") {
        imageUrl = result.output;
      }
    }

    if (imageUrl) {
      // Resmi Supabase storage'a yükle
      const storageResult = await uploadModelImageToSupabaseStorage(
        imageUrl,
        userId,
        result.id
      );

      return {
        imageUrl: storageResult.publicUrl, // Supabase storage'dan gelen public URL
        storagePath: storageResult.storagePath, // Storage path'i de döndür
        replicateId: result.id,
      };
    } else {
      throw new Error("Google nano-banana'dan model görsel çıkışı alınamadı");
    }
  } catch (error) {
    console.error("Google nano-banana model generation hatası:", error);
    throw error;
  }
}

// Google nano-banana ile uploaded image'i ID photo'ya transform et
async function transformImageToIDPhoto(imageUrl, userId) {
  try {
    console.log(
      "🔄 Google nano-banana ile image-to-ID-photo transformation başlatılıyor..."
    );
    console.log("Input image URL:", imageUrl);

    // Hazır transform prompt - ID photo'ya dönüştürme
    const transformPrompt = `Transform this image into a professional ID photo style portrait. The person should be wearing a clean white t-shirt against a pure white background. Shot straight on with direct camera angle. Professional studio lighting with even illumination, no shadows. Neutral, professional facial expression looking directly at the camera. 

CRITICAL SHARPNESS REQUIREMENTS:
- Crystal clear, razor-sharp focus throughout the entire image
- NO blur, NO motion blur, NO depth of field blur, NO soft focus
- NO dreamy effects, NO artistic blur, NO background blur
- Maximum sharpness and clarity on face, hair, clothing, and background
- Professional studio photography sharpness standards
- High definition, crisp details, perfect focus

Clean composition with proper ID photo proportions. NO borders, NO frames, NO text, NO watermarks, NO overlays. Pure white background, white t-shirt, frontal view, passport photo style, professional quality.`;

    console.log("Transform prompt:", transformPrompt);
    console.log("🔍 Image URL test edilecek:", imageUrl);

    // Önce resmin erişilebilir olup olmadığını test et
    try {
      const testResponse = await fetch(imageUrl, {
        method: "HEAD",
        timeout: 10000,
      });
      console.log("✅ Image URL erişilebilir, status:", testResponse.status);
      console.log("📏 Content-Type:", testResponse.headers.get("content-type"));
      console.log(
        "📏 Content-Length:",
        testResponse.headers.get("content-length")
      );
    } catch (testError) {
      console.error("❌ Image URL erişilemez:", testError.message);
      throw new Error(`Image URL erişilemez: ${testError.message}`);
    }

    // referenceBrowserRoutes.js formatında axios kullan
    const requestBody = {
      input: {
        prompt: transformPrompt,
        image_input: [imageUrl], // String array formatında (referenceBrowserRoutes.js gibi)
        output_format: "jpg",
      },
    };

    console.log("📋 nano-banana Transform Request Body:", requestBody);

    const response = await axios.post(
      "https://api.replicate.com/v1/models/google/nano-banana/predictions",
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait", // Synchronous response için
        },
        timeout: 120000, // 2 dakika timeout (referenceBrowserRoutes.js gibi)
      }
    );

    console.log("📋 Transform API Response Status:", response.status);
    const result = response.data;
    console.log("✅ Google nano-banana image transformation tamamlandı");
    console.log("Transform result:", result);

    // Eğer API hatası varsa
    if (result.error || result.status === "failed") {
      console.error("❌ nano-banana API Error:", result.error);
      console.error("❌ nano-banana Logs:", result.logs);
      throw new Error(
        `nano-banana API Error: ${result.error || "Unknown error"}`
      );
    }

    // Output string veya array olabilir
    let transformedImageUrl = null;
    if (result.output) {
      if (Array.isArray(result.output) && result.output.length > 0) {
        transformedImageUrl = result.output[0];
      } else if (typeof result.output === "string") {
        transformedImageUrl = result.output;
      }
    }

    if (transformedImageUrl) {
      // Transformed resmi Supabase storage'a yükle
      const storageResult = await uploadModelImageToSupabaseStorage(
        transformedImageUrl,
        userId,
        result.id
      );

      return {
        imageUrl: storageResult.publicUrl, // Supabase storage'dan gelen public URL
        storagePath: storageResult.storagePath, // Storage path'i de döndür
        replicateId: result.id,
      };
    } else {
      throw new Error(
        "Google nano-banana'dan transformed görsel çıkışı alınamadı"
      );
    }
  } catch (error) {
    console.error("Google nano-banana image transformation hatası:", error);
    throw error;
  }
}

// Model'i Supabase'e kaydet
async function saveModelToDatabase(
  name,
  originalPrompt,
  enhancedPrompt,
  imageUrl,
  replicateId,
  gender,
  age,
  userId,
  isPublic = false
) {
  try {
    console.log("💾 Model Supabase'e kaydediliyor...");
    console.log("📝 Model name:", name);
    console.log("📝 Gender:", gender);
    console.log("📝 Age:", age);

    const { data, error } = await supabase
      .from("user_models")
      .insert({
        name: name,
        original_prompt: originalPrompt,
        enhanced_prompt: enhancedPrompt,
        image_url: imageUrl, // Supabase storage'dan gelen public URL
        replicate_id: replicateId,
        gender: gender,
        age: age,
        user_id: userId,
        is_public: isPublic,
        status: "completed",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase model kayıt hatası:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      throw error;
    }

    console.log("✅ Model Supabase'e kaydedildi:", data.id);
    return data;
  } catch (error) {
    console.error("Database model kayıt hatası:", error);
    throw error;
  }
}

// Supabase resim URL'lerini optimize eden yardımcı fonksiyon
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si ise optimize et
  if (imageUrl.includes("supabase.co")) {
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      ) + "?width=400&height=400&quality=80"
    );
  }

  return imageUrl;
};

// Resmi 1:1 canvas'a yerleştir (ortada + arka plan blurlu)
async function createSquareCanvasWithBackground(imageBuffer) {
  try {
    const sharp = require("sharp");

    // Resim metadata'sını al
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    // 1:1 canvas boyutu (en büyük kenarı baz al)
    const canvasSize = Math.max(width, height);

    // Arka plan: resmi blur'la ve cover yap
    const backgroundBuffer = await sharp(imageBuffer)
      .resize(canvasSize, canvasSize, {
        fit: "cover",
        position: "center",
      })
      .blur(20) // Blur efekti
      .jpeg({ quality: 90 })
      .toBuffer();

    // Ana resim: contain ile ortaya yerleştir
    const foregroundBuffer = await sharp(imageBuffer)
      .resize(canvasSize, canvasSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Şeffaf arka plan
      })
      .png() // PNG olarak şeffaflık için
      .toBuffer();

    // İki resmi birleştir (composite)
    const finalBuffer = await sharp(backgroundBuffer)
      .composite([
        {
          input: foregroundBuffer,
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    console.log(
      "✅ Square canvas with background oluşturuldu:",
      canvasSize + "x" + canvasSize
    );
    return finalBuffer;
  } catch (error) {
    console.error("❌ Canvas creation hatası:", error);
    return imageBuffer; // Hata durumunda orijinal resmi döndür
  }
}

// Uploaded image'i Supabase'e yükle (referenceBrowserRoutes.js'dan kopyalandı)
async function uploadImageToSupabase(imageUri, userId) {
  try {
    console.log("📤 Uploaded image Supabase'e yükleniyor...");
    let imageBuffer;

    // HTTP URL ise indir, değilse base64 olarak kabul et
    if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
      // HTTP URL - normal indirme
      const imageResponse = await axios.get(imageUri, {
        responseType: "arraybuffer",
        timeout: 15000,
      });
      imageBuffer = Buffer.from(imageResponse.data);
    } else if (imageUri.startsWith("data:image/")) {
      // Base64 data URL
      const base64Data = imageUri.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");
      console.log("📏 Base64 boyutu:", base64Data.length);
      console.log("📏 Buffer boyutu:", imageBuffer.length);
    } else {
      // file:// protokolü - Bu durumda frontend'den base64 data gönderilmeli
      throw new Error(
        "Yerel dosya path'i desteklenmemektedir. Lütfen resmin base64 data'sını gönderin."
      );
    }

    // EXIF rotation düzeltmesi uygula (referenceBrowserRoutes.js'dan)
    const sharp = require("sharp");
    let processedBuffer;
    try {
      // 1. EXIF rotation düzelt
      const rotatedBuffer = await sharp(imageBuffer)
        .rotate() // EXIF orientation bilgisini otomatik uygula
        .jpeg({ quality: 95 })
        .toBuffer();
      console.log("🔄 Model upload: EXIF rotation uygulandı");

      // 2. Square canvas with background oluştur
      processedBuffer = await createSquareCanvasWithBackground(rotatedBuffer);
      console.log("🎨 Model upload: Square canvas with background oluşturuldu");
    } catch (sharpError) {
      console.error("❌ Sharp işleme hatası:", sharpError.message);
      processedBuffer = imageBuffer; // Son çare: orijinal buffer
    }

    // Dosya adını oluştur
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const fileName = `images/${userId}/${timestamp}-model-${randomId}.jpg`;

    console.log("📁 Upload dosya adı:", fileName);

    // Supabase storage'a yükle (processed buffer ile)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, processedBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase image upload hatası:", uploadError);
      throw new Error(`Supabase upload error: ${uploadError.message}`);
    }

    console.log("✅ Image Supabase'e yüklendi:", uploadData.path);

    // Public URL oluştur
    const { data: urlData } = supabase.storage
      .from("images")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;
    console.log("🔗 Image Public URL:", publicUrl);

    return publicUrl;
  } catch (error) {
    console.error("Image upload hatası:", error);
    throw error;
  }
}

// CREATE MODEL ROUTE
router.post("/create-model", async (req, res) => {
  try {
    const {
      prompt = "",
      modelName = "",
      gender = "woman",
      age = "young",
      customAge = null,
      userId,
      isPublic = false,
      selectedImage = null,
      languageCode = "en",
      regionCode = "US",
    } = req.body;

    console.log("🚀 Create model işlemi başlatıldı");
    console.log("Model Name:", modelName);
    console.log("Original prompt:", prompt);
    console.log("Gender:", gender);
    console.log("Age:", age);
    console.log("Custom Age:", customAge);
    console.log("User ID:", userId);
    console.log("Is Public:", isPublic);
    console.log("Selected Image:", !!selectedImage);

    // User ID validation
    let actualUserId = userId;
    if (!actualUserId) {
      actualUserId = req.headers["x-user-id"] || req.headers["user-id"];
    }

    if (!actualUserId) {
      return res.status(400).json({
        success: false,
        error: "User ID gerekli",
      });
    }

    // UUID format validation
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(actualUserId)) {
      console.error("❌ Invalid UUID format:", actualUserId);
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format. UUID required.",
        details: `Received: ${actualUserId}`,
      });
    }

    // Validation
    if (!gender || !age) {
      return res.status(400).json({
        success: false,
        error: "Gender ve age gerekli",
      });
    }

    if (!modelName || modelName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Model name gerekli",
      });
    }

    // Age değerini belirle (custom age varsa onu kullan)
    const finalAge = customAge || age;

    console.log("✅ Using provided model name:", modelName.trim());

    let imagenResult;
    let analysisResult = null; // Image analysis result'ı store et

    if (selectedImage) {
      // Image upload edilmişse: Resmi Supabase'e yükle, sonra nano-banana ile transform et
      console.log(
        "📸 Selected image modu: nano-banana image-to-image transformation"
      );

      // 1. Upload edilen resmi Supabase'e yükle
      console.log("📸 selectedImage.uri:", selectedImage.uri);

      const uploadedImageUrl = await uploadImageToSupabase(
        selectedImage.uri,
        actualUserId
      );
      console.log("✅ Resim Supabase'e yüklendi:", uploadedImageUrl);

      // 1.5. Gemini ile resmi analiz et ve gender/age detect et
      console.log("🔍 Gemini ile resim analiz ve gender/age detection...");
      analysisResult = await analyzeImageAndGeneratePrompt(uploadedImageUrl);
      console.log("✅ Gemini analysis result:", analysisResult);

      const detectedGender = analysisResult.detectedGender;
      const detectedAge = analysisResult.detectedAge;

      console.log(
        `🔍 Detected from image: ${detectedGender}, ${detectedAge} years old`
      );

      console.log("✅ Using user-provided model name:", modelName.trim());

      // 2. nano-banana ile image-to-image transformation (ID photo'ya dönüştür)
      try {
        imagenResult = await transformImageToIDPhoto(
          uploadedImageUrl,
          actualUserId
        );
      } catch (transformError) {
        console.error(
          "❌ Image transformation başarısız, Gemini + text-to-image fallback kullanılıyor:",
          transformError.message
        );

        // Fallback: Zaten analiz edilmiş gender/age kullan, text-to-image yap
        console.log(
          "🔄 Fallback: Text-to-image ile generation (detected values ile)..."
        );

        // Zaten detect edilen values'ları kullan
        const enhancedPrompt = analysisResult.enhancedPrompt;

        // Text-to-image ile generate et (detected gender/age ile)
        imagenResult = await generateModelWithNanoBanana(
          enhancedPrompt,
          detectedGender,
          detectedAge,
          actualUserId
        );
      }
    } else {
      // Text prompt varsa: Text-to-image
      console.log("✍️ Text prompt modu: Generation işlemi başlatılıyor");
      imagenResult = await generateModelWithNanoBanana(
        prompt,
        gender,
        finalAge,
        actualUserId
      );
    }

    // Supabase'e kaydet (resim upload ise detected values kullan)
    const finalGender = selectedImage
      ? analysisResult?.detectedGender || gender
      : gender;
    const finalFinalAge = selectedImage
      ? analysisResult?.detectedAge || finalAge
      : finalAge;

    console.log(
      `💾 Saving to DB with: gender=${finalGender}, age=${finalFinalAge}`
    );

    const savedModel = await saveModelToDatabase(
      modelName.trim(), // Kullanıcıdan gelen isim
      prompt.trim(),
      prompt.trim(), // Enhanced prompt şimdilik aynı
      imagenResult.imageUrl, // Supabase storage'dan gelen public URL
      imagenResult.replicateId,
      finalGender, // Detected gender kullan
      finalFinalAge, // Detected age kullan
      actualUserId,
      isPublic
    );

    console.log("✅ Create model işlemi tamamlandı");

    res.json({
      success: true,
      message: "Model başarıyla oluşturuldu",
      data: {
        id: savedModel.id,
        name: savedModel.name,
        imageUrl: savedModel.image_url, // Modal için normal boyut
        imageUrlOptimized: optimizeImageUrl(savedModel.image_url), // FlatList için küçük boyut
        gender: savedModel.gender,
        age: savedModel.age,
        originalPrompt: savedModel.original_prompt,
        replicateId: savedModel.replicate_id,
        isPublic: savedModel.is_public,
        createdAt: savedModel.created_at,
        userId: savedModel.user_id,
      },
    });
  } catch (error) {
    console.error("❌ Create model hatası:", error);

    res.status(500).json({
      success: false,
      error: "Model oluşturulurken hata oluştu",
      details: error.message,
    });
  }
});

// GET USER'S MODELS
router.get("/user-models/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    console.log("👤 User models fetch - userId:", userId);

    // UUID format validation
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error("❌ Invalid UUID format:", userId);
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format. UUID required.",
        details: `Received: ${userId}`,
      });
    }

    const { data, error } = await supabase
      .from("user_models")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Supabase user models fetch hatası:", error);
      throw error;
    }

    console.log("✅ User models found:", data?.length || 0);

    // Optimize image URLs
    const optimizedData = (data || []).map((model) => ({
      ...model,
      image_url: optimizeImageUrl(model.image_url),
    }));

    res.json({
      success: true,
      data: optimizedData,
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("User models fetch hatası:", error);
    res.status(500).json({
      success: false,
      error: "User models getirilemedi",
      details: error.message,
    });
  }
});

// DELETE MODEL ROUTE
router.delete("/delete-model/:modelId", async (req, res) => {
  try {
    const { modelId } = req.params;

    console.log("🗑️ Model silme işlemi başlatıldı - ID:", modelId);

    // Model'i veritabanından sil
    const { data, error } = await supabase
      .from("user_models")
      .delete()
      .eq("id", modelId)
      .select()
      .single();

    if (error) {
      console.error("Supabase delete hatası:", error);

      // Eğer kayıt bulunamadıysa
      if (error.code === "PGRST116" || error.message?.includes("No rows")) {
        return res.status(404).json({
          success: false,
          error: "Model bulunamadı",
        });
      }

      throw error;
    }

    console.log("✅ Model başarıyla silindi:", data?.id);

    res.json({
      success: true,
      message: "Model başarıyla silindi",
      data: data,
    });
  } catch (error) {
    console.error("❌ Model silme hatası:", error);

    res.status(500).json({
      success: false,
      error: "Model silinirken hata oluştu",
      details: error.message,
    });
  }
});

// POST endpoint to detect gender from image
router.post("/detect-gender", async (req, res) => {
  try {
    const { selectedImage } = req.body;

    if (!selectedImage || !selectedImage.uri) {
      return res.status(400).json({
        success: false,
        error: "Image data is required",
      });
    }

    console.log("🔍 [GENDER_DETECT] Starting gender detection...");

    // Gemini ile gender detection
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Base64 data'yı ayıkla
    const base64Data = selectedImage.uri.replace(
      /^data:image\/[a-z]+;base64,/,
      ""
    );

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/jpeg",
      },
    };

    const prompt = `Analyze this image and determine the gender of the person. 
    Respond with ONLY one word: "woman" or "man". 
    Do not include any other text, explanations, or punctuation.
    If you cannot clearly determine the gender, respond with "woman" as default.`;

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const detectedGender = response.text().trim().toLowerCase();

    console.log("🎯 [GENDER_DETECT] Raw response:", detectedGender);

    // Response'u temizle ve validate et
    let finalGender = "woman"; // Default
    if (detectedGender.includes("man") && !detectedGender.includes("woman")) {
      finalGender = "man";
    } else if (detectedGender.includes("woman")) {
      finalGender = "woman";
    }

    console.log("✅ [GENDER_DETECT] Final detected gender:", finalGender);

    res.json({
      success: true,
      data: {
        detectedGender: finalGender,
      },
    });
  } catch (error) {
    console.error("❌ [GENDER_DETECT] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to detect gender",
      details: error.message,
    });
  }
});

// Model adını güncelleme endpoint'i
router.put("/update-model/:modelId", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { modelName } = req.body;

    console.log("🔄 Model güncelleme isteği:", { modelId, modelName });

    // Model adı validasyonu
    if (!modelName || modelName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Model adı boş olamaz",
      });
    }

    // Model adını güncelle
    const { data, error } = await supabase
      .from("user_models")
      .update({
        name: modelName.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", modelId)
      .select("*")
      .single();

    if (error) {
      console.error("❌ Supabase güncelleme hatası:", error);

      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          error: "Model bulunamadı",
        });
      }

      throw error;
    }

    console.log("✅ Model adı başarıyla güncellendi:", data?.name);

    res.json({
      success: true,
      message: "Model adı başarıyla güncellendi",
      data: data,
    });
  } catch (error) {
    console.error("❌ Model güncelleme hatası:", error);

    res.status(500).json({
      success: false,
      error: "Model güncellenirken hata oluştu",
      details: error.message,
    });
  }
});

module.exports = router;
