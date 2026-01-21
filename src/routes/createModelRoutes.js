const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const NANO_BANANA_API_URL = "https://fal.run/fal-ai/nano-banana/edit";

// Replicate API üzerinden Gemini 2.5 Flash çağrısı yapan helper fonksiyon
// Hata durumunda 3 kez tekrar dener
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

      console.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      console.log(`🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`);

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls,
          prompt: prompt,
          videos: [],
          temperature: 1,
          dynamic_thinking: false,
          max_output_tokens: 65535
        }
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
        requestBody,
        {
          headers: {
            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
          },
          timeout: 120000
        }
      );

      const data = response.data;

      if (data.error) {
        console.error(`❌ [REPLICATE-GEMINI] API error:`, data.error);
        throw new Error(data.error);
      }

      if (data.status !== "succeeded") {
        console.error(`❌ [REPLICATE-GEMINI] Prediction failed with status:`, data.status);
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

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

      console.log(`✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`);

      return outputText.trim();

    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        console.error(`❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`);
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

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

// Replicate Gemini ile dil/ülkeye uygun isim generate et
async function generateModelNameWithGemini(
  gender,
  age,
  languageCode,
  regionCode
) {
  try {
    console.log("🏷️ Replicate Gemini ile model ismi oluşturuluyor...");
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

    // Replicate Gemini API çağrısı
    let generatedName = await callReplicateGeminiFlash(prompt, [], 3);

    console.log("📊 Replicate Gemini name generation result:", generatedName);

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
      const retryResult = await callReplicateGeminiFlash(retryPrompt, [], 3);
      generatedName = retryResult
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
    console.error("❌ Replicate Gemini name generation hatası:", error);

    // Hata durumunda basit fallback
    const simpleName = gender === "woman" ? "Maria" : "Alex";
    console.log("🔄 Error fallback name:", simpleName);
    return simpleName;
  }
}

// Kullanıcının mevcut modellerinin isimlerini çek
async function getUserExistingModelNames(userId) {
  try {
    const { data, error } = await supabase
      .from("user_models")
      .select("name")
      .eq("user_id", userId)
      .eq("status", "completed");

    if (error) {
      console.error("❌ Mevcut modeller çekilirken hata:", error);
      return [];
    }

    const modelNames = data.map((model) => model.name).filter(Boolean);
    console.log("📋 Kullanıcının mevcut modelleri:", modelNames);
    return modelNames;
  } catch (error) {
    console.error("❌ Mevcut modeller çekilirken hata:", error);
    return [];
  }
}

// GPT-4O-mini ile ID photo prompt enhance et
// Replicate Gemini ile resimli prompt enhance (upload edilen resim için)
async function analyzeImageAndGeneratePrompt(
  uploadedImageUrl,
  modelName = null,
  languageCode = "en",
  regionCode = "US",
  existingModelNames = []
) {
  try {
    console.log(
      "🤖 Replicate Gemini ile resim analizi ve prompt oluşturma başlatılıyor..."
    );
    console.log("📸 Upload edilen resim URL:", uploadedImageUrl);
    console.log("📝 Model Name:", modelName);
    console.log("🌍 Language Code:", languageCode);
    console.log("🌍 Region Code:", regionCode);
    console.log("📋 Existing Model Names:", existingModelNames);

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

    // Replicate Gemini'ye gönderilecek prompt
    const promptText = `You are an expert image analyzer and prompt engineer. Analyze this uploaded image and return a JSON response with the person's details and an ID photo prompt.

INPUT DATA STRUCTURE:
${JSON.stringify(requestData, null, 2)}

LANGUAGE INFORMATION:
- Language Code: ${languageCode}
- Region Code: ${regionCode}
${modelName ? `\nUSER PROVIDED NAME: ${modelName} (You can use this or suggest a better modern name based on the person's appearance)` : `\nMODEL NAME GENERATION REQUIRED: Generate a MODERN, contemporary name appropriate for language ${languageCode} and region ${regionCode}`}
${existingModelNames.length > 0 ? `\nEXISTING MODEL NAMES (DO NOT USE THESE): ${existingModelNames.join(", ")}` : ''}

ANALYSIS REQUIREMENTS:
1. Detect the person's gender (woman/man)
2. Estimate their age (number between 18-80)
3. Analyze physical features (skin tone, hair, eyes, facial structure)
4. Generate a professional ID photo prompt
5. ALWAYS generate a MODERN, contemporary name appropriate for the detected person, matching the language and region. The name must be different from existing model names and should be a popular, modern name that fits the person's appearance and age. ${modelName ? `You can use "${modelName}" if it fits, or suggest a better modern name based on the person's appearance.` : ''}

RESPONSE FORMAT (JSON):
{
  "gender": "woman" or "man",
  "age": estimated_age_as_number,
  "suggestedName": "a_name_appropriate_for_language_and_region_based_on_person_appearance",
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
- Include the suggested name (from suggestedName field) in the prompt
- Include the detected gender (woman/man) in the prompt
- Include the estimated age (as a number) in the prompt

CRITICAL REQUIREMENTS:
- Crystal clear, sharp focus throughout the entire image
- NO blur, NO motion blur, NO depth of field blur
- NO soft focus, NO dreamy effects, NO artistic blur
- Maximum sharpness and clarity on face, hair, clothing, and background
- NO borders, NO frames, NO text, NO watermarks, NO overlays

IMPORTANT: The prompt must include:
1. The suggested name from the "suggestedName" field (MUST be a MODERN, contemporary name appropriate for language ${languageCode} and region ${regionCode}, different from existing names: ${existingModelNames.length > 0 ? existingModelNames.join(", ") : "none"})
2. The detected gender (woman/man)
3. The estimated age (as a number, e.g., "25 years old")

Analyze the image and return the JSON response:`;

    // Replicate Gemini API çağrısı - resim URL'sini direkt gönder
    const imageUrls = uploadedImageUrl.startsWith("http") ? [uploadedImageUrl] : [];
    let responseText = await callReplicateGeminiFlash(promptText, imageUrls, 3);

    console.log("📊 Replicate Gemini image analysis result:", responseText);

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

      // Prompt'a model ismi, yaş ve cinsiyeti ekle
      let finalPrompt = analysisResult.prompt;
      const detectedGender = analysisResult.gender;
      const detectedAge = analysisResult.age;
      // Her zaman suggestedName kullan, yoksa modelName'i kullan (fallback)
      const suggestedName = analysisResult.suggestedName || modelName || null;

      // Prompt'un başına model ismi, yaş ve cinsiyeti ekle
      if (suggestedName) {
        finalPrompt = `${suggestedName}, a ${detectedAge}-year-old ${detectedGender}, ${finalPrompt}`;
      } else {
        finalPrompt = `a ${detectedAge}-year-old ${detectedGender}, ${finalPrompt}`;
      }

      return {
        detectedGender: detectedGender,
        detectedAge: detectedAge,
        enhancedPrompt: finalPrompt,
        suggestedName: suggestedName, // Önerilen isim (varsa)
      };
    } catch (parseError) {
      console.error("❌ JSON parse hatası:", parseError);
      console.log("Raw response:", responseText);

      // Fallback: Manual extraction
      const genderMatch = responseText.match(/"gender":\s*"(woman|man)"/i);
      const ageMatch = responseText.match(/"age":\s*(\d+)/);
      const promptMatch = responseText.match(/"prompt":\s*"([^"]+)"/);
      const suggestedNameMatch = responseText.match(/"suggestedName":\s*"([^"]+)"/i);

      const detectedGender = genderMatch ? genderMatch[1].toLowerCase() : "woman";
      const detectedAge = ageMatch ? parseInt(ageMatch[1]) : 25;
      const fallbackSuggestedName = suggestedNameMatch ? suggestedNameMatch[1] : modelName;
      let fallbackPrompt = promptMatch
        ? promptMatch[1]
        : `Professional ID photo of a person wearing a clean white t-shirt against a pure white background. Shot straight on with professional studio lighting. High quality, sharp focus, passport photo style. NO borders, NO frames, NO text, NO watermarks.`;

      // Fallback prompt'a da model ismi, yaş ve cinsiyeti ekle
      if (fallbackSuggestedName) {
        fallbackPrompt = `${fallbackSuggestedName}, a ${detectedAge}-year-old ${detectedGender}, ${fallbackPrompt}`;
      } else {
        fallbackPrompt = `a ${detectedAge}-year-old ${detectedGender}, ${fallbackPrompt}`;
      }

      return {
        detectedGender: detectedGender,
        detectedAge: detectedAge,
        enhancedPrompt: fallbackPrompt,
        suggestedName: fallbackSuggestedName, // Önerilen isim (varsa)
      };
    }
  } catch (error) {
    console.error("❌ Replicate Gemini image analysis hatası:", error);

    // Fallback
    const fallbackGender = "woman";
    const fallbackAge = 25;
    const fallbackSuggestedName = modelName || null;
    let fallbackPrompt = "Professional ID photo of a person wearing a clean white t-shirt against a pure white background. Shot straight on with professional studio lighting. High quality, sharp focus, passport photo style. NO borders, NO frames, NO text, NO watermarks.";

    // Error fallback prompt'a da model ismi, yaş ve cinsiyeti ekle
    if (fallbackSuggestedName) {
      fallbackPrompt = `${fallbackSuggestedName}, a ${fallbackAge}-year-old ${fallbackGender}, ${fallbackPrompt}`;
    } else {
      fallbackPrompt = `a ${fallbackAge}-year-old ${fallbackGender}, ${fallbackPrompt}`;
    }

    return {
      detectedGender: fallbackGender,
      detectedAge: fallbackAge,
      enhancedPrompt: fallbackPrompt,
      suggestedName: fallbackSuggestedName, // Önerilen isim (varsa)
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

    // Replicate Gemini API çağrısı
    let enhancedPrompt = await callReplicateGeminiFlash(prompt, [], 3);

    console.log("🎯 Replicate Gemini enhanced prompt:", enhancedPrompt);

    // Token sayısını kontrol et (yaklaşık)
    const tokenCount = enhancedPrompt.split(/\s+/).length;
    console.log(`Generated prompt token count: ${tokenCount}`);

    // Eğer çok uzunsa kısalt
    if (tokenCount > 512) {
      const words = enhancedPrompt.split(/\s+/);
      enhancedPrompt = words.slice(0, 512).join(" ");
      console.log(`Prompt kısaltıldı: ${enhancedPrompt}`);
    }

    console.log("✅ Replicate Gemini ID photo prompt enhancement tamamlandı");
    console.log("Enhanced prompt length:", enhancedPrompt.length);

    return enhancedPrompt;
  } catch (error) {
    console.error("❌ Replicate Gemini enhancement hatası:", error.message);
    console.error("❌ Full error:", error);

    // Fallback: Basit prompt döndür
    const fallbackPrompt = `Professional ID photo style portrait of a ${age} ${gender === "woman" ? "female" : "male"
      } person wearing a clean white t-shirt. Shot straight on with direct camera angle against a pure white background. The subject looks directly at the camera with a neutral, professional expression. Studio lighting, passport photo style, clean white background, white t-shirt, frontal view, high quality. Crystal clear, sharp focus throughout. NO borders, NO frames, NO text, NO watermarks, NO overlays, clean image only. ${originalPrompt ? `Additional details: ${originalPrompt}` : ""
      }`;

    console.log("🔄 Fallback prompt kullanılıyor:", fallbackPrompt);
    return fallbackPrompt;
  }
}

// Google Imagen 4 API URL
const IMAGEN_4_API_URL = "https://fal.run/fal-ai/imagen4/preview/ultra";

// Google nano-banana ile model generate et (text-to-image) - Migrated to Fal.ai Imagen 4
async function generateModelWithNanoBanana(prompt, gender, age, userId) {
  try {
    console.log("👤 [FAL.AI] Imagen 4 ile model generation başlatılıyor...");
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

    // Imagen 4 için request body - Text-to-Image
    const requestBody = {
      prompt: enhancedPrompt,
      aspect_ratio: "3:4", // ID photo / portrait için dikey format
      output_format: "jpeg",
      safety_filter_level: "block_only_high",
    };

    console.log("📦 [FAL.AI] Request body:", requestBody);

    const response = await axios.post(
      IMAGEN_4_API_URL,
      requestBody,
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 300000, // 5 dakika timeout
      }
    );

    console.log("📄 [FAL.AI] Yanıt alındı, Status:", response.status);

    // Fal.ai response: { images: [{ url: "..." }] }
    const result = response.data;
    console.log("✅ [FAL.AI] Result:", result);

    let imageUrl = null;
    if (result.images && result.images.length > 0 && result.images[0].url) {
      imageUrl = result.images[0].url;
      // Fix: Ensure imageUrl is a string if it's an array (extra safety)
      if (Array.isArray(imageUrl)) {
        imageUrl = imageUrl[0];
      }
    }

    if (imageUrl) {
      // Resmi Supabase storage'a yükle
      const storageResult = await uploadModelImageToSupabaseStorage(
        imageUrl,
        userId,
        result.request_id || `fal-${Date.now()}`
      );

      return {
        imageUrl: storageResult.publicUrl, // Supabase storage'dan gelen public URL
        storagePath: storageResult.storagePath, // Storage path'i de döndür
        replicateId: result.request_id || `fal-${Date.now()}`,
      };
    } else {
      throw new Error("Fal.ai Nano Banana'dan model görsel çıkışı alınamadı");
    }
  } catch (error) {
    console.error("Fal.ai Nano Banana model generation hatası:", error.message);
    if (error.response && error.response.data) {
      console.error("Fal.ai Details:", error.response.data);
    }
    throw error;
  }
}

// Google nano-banana ile uploaded image'i ID photo'ya transform et - Migrated to Fal.ai
async function transformImageToIDPhoto(imageUrl, userId) {
  try {
    console.log(
      "🔄 [FAL.AI] Nano Banana ile image-to-ID-photo transformation başlatılıyor..."
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
    } catch (testError) {
      console.error("❌ Image URL erişilemez:", testError.message);
      throw new Error(`Image URL erişilemez: ${testError.message}`);
    }

    const requestBody = {
      prompt: transformPrompt,
      image_urls: [imageUrl],
      output_format: "jpeg",
      num_images: 1,
    };

    console.log("📦 [FAL.AI] Transform Request Body:", requestBody);

    const response = await axios.post(
      NANO_BANANA_API_URL,
      requestBody,
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 300000, // 5 dakika timeout
      }
    );

    console.log("📄 [FAL.AI] Transformation Response Status:", response.status);
    const result = response.data;
    console.log("✅ [FAL.AI] Transform result:", result);

    // Eğer API hatası varsa
    if (result.detail || result.error) {
      const errorMsg = result.detail || result.error;
      console.error("❌ Fal.ai API Error:", errorMsg);
      throw new Error(`Fal.ai API Error: ${errorMsg}`);
    }

    let transformedImageUrl = null;
    if (result.images && result.images.length > 0 && result.images[0].url) {
      transformedImageUrl = result.images[0].url;
      // Fix: Ensure transformedImageUrl is a string if it's an array (extra safety)
      if (Array.isArray(transformedImageUrl)) {
        transformedImageUrl = transformedImageUrl[0];
      }
    }

    if (transformedImageUrl) {
      // Transformed resmi Supabase storage'a yükle
      const storageResult = await uploadModelImageToSupabaseStorage(
        transformedImageUrl,
        userId,
        result.request_id || `fal-${Date.now()}`
      );

      return {
        imageUrl: storageResult.publicUrl, // Supabase storage'dan gelen public URL
        storagePath: storageResult.storagePath, // Storage path'i de döndür
        replicateId: result.request_id || `fal-${Date.now()}`,
      };
    } else {
      throw new Error(
        "Fal.ai Nano Banana'dan transformed görsel çıkışı alınamadı"
      );
    }
  } catch (error) {
    console.error("Fal.ai Nano Banana image transformation hatası:", error.message);
    if (error.response && error.response.data) {
      console.error("Fal.ai Error Details:", error.response.data);
    }
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
  isPublic = false,
  termsAccepted = null,
  originalImageUrl = null
) {
  try {
    console.log("💾 Model Supabase'e kaydediliyor...");
    console.log("📝 Model name:", name);
    console.log("📝 Gender:", gender);
    console.log("📝 Age:", age);
    console.log("📝 Terms Accepted:", termsAccepted);
    console.log("📝 Original Image URL:", originalImageUrl);

    const insertData = {
      name: name,
      original_prompt: originalPrompt,
      enhanced_prompt: enhancedPrompt,
      image_url: imageUrl, // Supabase storage'dan gelen public URL (transform edilmiş)
      replicate_id: replicateId,
      gender: gender,
      age: age,
      user_id: userId,
      is_public: isPublic,
      status: "completed",
      created_at: new Date().toISOString(),
    };

    // Terms accepted sadece null değilse ekle (eski versiyonlar için uyumluluk)
    if (termsAccepted !== null) {
      insertData.terms_accepted = termsAccepted;
    }

    // Original image URL sadece null değilse ekle (eski versiyonlar için uyumluluk)
    if (originalImageUrl !== null) {
      insertData.original_image_url = originalImageUrl;
    }

    const { data, error } = await supabase
      .from("user_models")
      .insert(insertData)
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
      termsAccepted = null, // Şartları kabul etme durumu (nullable - eski versiyonlar için)
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
    console.log("Terms Accepted:", termsAccepted);

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

    // Validation - customAge varsa age zorunlu değil
    if (!gender || (!age && !customAge)) {
      return res.status(400).json({
        success: false,
        error: "Gender and age (or customAge) are required",
      });
    }

    if (!modelName || modelName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Model name is required",
      });
    }

    // Age değerini belirle (custom age varsa onu kullan)
    const finalAge = customAge || age;

    console.log("✅ Using provided model name:", modelName.trim());

    let imagenResult;
    let analysisResult = null; // Image analysis result'ı store et
    let uploadedImageUrl = null; // Orijinal yüklenen resim URL'i

    if (selectedImage) {
      // Image upload edilmişse: Resmi Supabase'e yükle, sonra nano-banana ile transform et
      console.log(
        "📸 Selected image modu: nano-banana image-to-image transformation"
      );

      // 1. Upload edilen resmi Supabase'e yükle
      console.log("📸 selectedImage.uri:", selectedImage.uri);

      uploadedImageUrl = await uploadImageToSupabase(
        selectedImage.uri,
        actualUserId
      );
      console.log("✅ Resim Supabase'e yüklendi:", uploadedImageUrl);

      // 1.5. Kullanıcının mevcut modellerini çek
      const existingModelNames = await getUserExistingModelNames(actualUserId);

      // 1.6. Gemini ile resmi analiz et ve gender/age detect et
      console.log("🔍 Gemini ile resim analiz ve gender/age detection...");
      analysisResult = await analyzeImageAndGeneratePrompt(
        uploadedImageUrl,
        modelName.trim() || null,
        languageCode,
        regionCode,
        existingModelNames
      );
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

    // Model ismini belirle: analiz sonucunda gelen suggestedName'i öncelikli kullan
    // Eğer analiz sonucunda isim yoksa, kullanıcının girdiği ismi kullan
    const finalModelName = analysisResult?.suggestedName || modelName.trim() || "Model";

    console.log(
      `💾 Saving to DB with: gender=${finalGender}, age=${finalFinalAge}, name=${finalModelName}`
    );

    // Veritabanına kaydedilecek kısa açıklama oluştur
    // Fotoğraf oluşturma için uzun prompt kullanılacak, ama veritabanına kısa açıklama kaydedilecek
    let shortDescription = "";
    if (selectedImage && analysisResult) {
      // Resim upload edildiyse: yaş ve cinsiyet ile kısa açıklama
      const genderText = finalGender === "woman" ? "woman" : "man";
      shortDescription = `${finalFinalAge}-year-old ${genderText}`;
    } else {
      // Text prompt ise: kısa versiyonu
      shortDescription = prompt.trim().substring(0, 100); // İlk 100 karakter
      if (prompt.trim().length > 100) {
        shortDescription += "...";
      }
    }

    const savedModel = await saveModelToDatabase(
      finalModelName, // Kullanıcıdan gelen isim veya önerilen isim
      prompt.trim(), // Original prompt
      shortDescription, // Kısa açıklama (veritabanına kaydedilecek)
      imagenResult.imageUrl, // Supabase storage'dan gelen public URL (transform edilmiş)
      imagenResult.replicateId,
      finalGender, // Detected gender kullan
      finalFinalAge, // Detected age kullan
      actualUserId,
      isPublic,
      termsAccepted, // Şartları kabul etme durumu
      uploadedImageUrl // Orijinal yüklenen resim URL'i (null olabilir)
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
        suggestedName: analysisResult?.suggestedName || null, // Analiz sonucunda önerilen isim
        detectedGender: analysisResult?.detectedGender || null, // Analiz sonucunda tespit edilen cinsiyet
        detectedAge: analysisResult?.detectedAge || null, // Analiz sonucunda tespit edilen yaş
      },
    });
  } catch (error) {
    console.error("❌ Create model hatası:", error);

    res.status(500).json({
      success: false,
      error: "Error creating model",
      details: error.message,
    });
  }
});

// ANALYZE IMAGE - Fotoğraf yüklendiğinde analiz yap ve isim, yaş, cinsiyet döndür
router.post("/analyze-image", async (req, res) => {
  try {
    const {
      selectedImage = null,
      languageCode = "en",
      regionCode = "US",
      userId = null,
    } = req.body;

    console.log("🔍 [ANALYZE_IMAGE] Image analysis başlatılıyor...");
    console.log("🌍 Language Code:", languageCode);
    console.log("🌍 Region Code:", regionCode);

    if (!selectedImage || !selectedImage.uri) {
      return res.status(400).json({
        success: false,
        error: "Image data is required",
      });
    }

    // User ID validation
    let actualUserId = userId;
    if (!actualUserId) {
      actualUserId = req.headers["x-user-id"] || req.headers["user-id"];
    }

    // UUID format validation
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (actualUserId && !uuidRegex.test(actualUserId)) {
      console.error("❌ Invalid UUID format:", actualUserId);
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format. UUID required.",
      });
    }

    // 1. Upload edilen resmi Supabase'e yükle
    let uploadedImageUrl;
    try {
      uploadedImageUrl = await uploadImageToSupabase(
        selectedImage.uri,
        actualUserId || "temp"
      );
      console.log("✅ Resim Supabase'e yüklendi:", uploadedImageUrl);
    } catch (uploadError) {
      console.error("❌ Image upload hatası:", uploadError);
      return res.status(500).json({
        success: false,
        error: "Image upload failed",
        details: uploadError.message,
      });
    }

    // 2. Kullanıcının mevcut modellerini çek (eğer userId varsa)
    let existingModelNames = [];
    if (actualUserId) {
      existingModelNames = await getUserExistingModelNames(actualUserId);
    }

    // 3. Gemini ile resmi analiz et
    const analysisResult = await analyzeImageAndGeneratePrompt(
      uploadedImageUrl,
      null, // modelName yok, analiz sonucunda önerilecek
      languageCode,
      regionCode,
      existingModelNames
    );

    console.log("✅ [ANALYZE_IMAGE] Analysis result:", analysisResult);

    // 4. Sonuçları döndür
    res.json({
      success: true,
      data: {
        suggestedName: analysisResult.suggestedName || null,
        detectedGender: analysisResult.detectedGender || null,
        detectedAge: analysisResult.detectedAge || null,
      },
    });
  } catch (error) {
    console.error("❌ [ANALYZE_IMAGE] Analysis hatası:", error);
    res.status(500).json({
      success: false,
      error: "Image analysis failed",
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

    let data;
    try {
      const result = await supabase
        .from("user_models")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (result.error) {
        console.error("Supabase user models fetch hatası:", result.error);
        const statusCode = result.error.message?.includes("fetch failed")
          ? 503
          : 500;
        return res.status(statusCode).json({
          success: false,
          error:
            statusCode === 503
              ? "Database temporarily unavailable"
              : "User models getirilemedi",
          details: result.error.message,
        });
      }

      data = result.data;
    } catch (fetchError) {
      console.error(
        "Supabase user models fetch sırasında beklenmeyen hata:",
        fetchError
      );
      const statusCode = fetchError?.message?.includes("fetch failed")
        ? 503
        : 500;
      return res.status(statusCode).json({
        success: false,
        error:
          statusCode === 503
            ? "Database temporarily unavailable"
            : "User models getirilemedi",
        details: fetchError?.message,
      });
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
          error: "Model not found",
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
      error: "Error deleting model",
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

    // Replicate Gemini ile gender detection
    // Not: Replicate API sadece URL kabul ediyor, base64 desteklemiyor
    // Bu endpoint için resim olmadan prompt gönderiyoruz - fallback kullanılacak

    const prompt = `Analyze this image and determine the gender of the person. 
    Respond with ONLY one word: "woman" or "man". 
    Do not include any other text, explanations, or punctuation.
    If you cannot clearly determine the gender, respond with "woman" as default.`;

    try {
      // Base64 resmi URL'ye çeviremiyoruz, boş olarak gönderiyoruz
      // Replicate API resim olmadan çalışacak - bu durumda fallback kullanılacak
      console.log("⚠️ [GENDER_DETECT] Base64 image - Replicate API does not support, using fallback");

      // Default gender döndür (bu endpoint base64 kullandığı için)
      const finalGender = "woman";
      console.log("✅ [GENDER_DETECT] Using default gender:", finalGender);

      res.json({
        success: true,
        data: {
          detectedGender: finalGender,
        },
      });
    } catch (geminiError) {
      console.error("❌ [GENDER_DETECT] Detection failed:", geminiError.message);

      // Fallback to default
      res.json({
        success: true,
        data: {
          detectedGender: "woman",
        },
      });
    }
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
        error: "Model name cannot be empty",
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
          error: "Model not found",
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
      error: "Error updating model",
      details: error.message,
    });
  }
});

module.exports = router;
