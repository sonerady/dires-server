const express = require("express");
const router = express.Router();
// Updated: Using Google Gemini API for prompt and tag generation
const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const { supabase } = require("../supabaseClient");

// Gemini API setup
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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

      // Debug: Request bilgilerini logla
      console.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      console.log(`🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`);

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls, // Direkt URL string array olarak gönder
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
          timeout: 120000 // 2 dakika timeout
        }
      );

      const data = response.data;

      // Hata kontrolü
      if (data.error) {
        console.error(`❌ [REPLICATE-GEMINI] API error:`, data.error);
        throw new Error(data.error);
      }

      // Status kontrolü
      if (data.status !== "succeeded") {
        console.error(`❌ [REPLICATE-GEMINI] Prediction failed with status:`, data.status);
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      // Output'u birleştir (array olarak geliyor)
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
      console.log(`📊 [REPLICATE-GEMINI] Metrics:`, data.metrics);

      return outputText.trim();

    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        console.error(`❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`);
        throw error;
      }

      // Retry öncesi kısa bekleme (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Replicate'den gelen resmi Supabase storage'a kaydet
async function uploadImageToSupabaseStorage(imageUrl, userId, replicateId) {
  try {
    console.log("📤 Resim Supabase storage'a yükleniyor...");
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
    const fileName = `user-locations/${userId}/${timestamp}-${replicateId}.jpg`;

    console.log("📁 Dosya adı:", fileName);

    // Supabase storage'a yükle
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("user-locations")
      .upload(fileName, imageData, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase storage upload hatası:", uploadError);
      throw uploadError;
    }

    console.log("✅ Resim Supabase storage'a yüklendi:", uploadData.path);

    // Public URL oluştur
    const { data: urlData } = supabase.storage
      .from("user-locations")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;
    console.log("🔗 Public URL:", publicUrl);

    return {
      storagePath: fileName,
      publicUrl: publicUrl,
    };
  } catch (error) {
    console.error("Resim yükleme hatası:", error);
    throw error;
  }
}

// Google Imagen-4-fast ile location image generate et
// Google Imagen-4-fast ile location image generate et - Migrated to Fal.ai
async function generateLocationWithImagen4Fast(prompt, userId) {
  try {
    console.log(
      "📸 Fal.ai Imagen-4-fast ile location generation başlatılıyor..."
    );
    console.log("Prompt:", prompt);

    const response = await fetch(
      "https://fal.run/fal-ai/imagen4/preview/ultra",
      {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${prompt} The image should have vibrant colors, high contrast, excellent lighting, and sharp visual quality. No people, no humans, no figures, no mannequins, no characters, empty location, vacant space.`,
          aspect_ratio: "1:1",
          output_format: "jpeg",
          safety_filter_level: "block_only_high",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Fal.ai Imagen-4-fast API Error:", errorText);
      throw new Error(`Fal.ai Imagen-4-fast API Error: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Fal.ai Imagen-4-fast generation tamamlandı");
    console.log("Imagen result:", result);

    // Fal.ai output: { images: [{ url: "..." }] }
    let imageUrl = null;
    let replicateId = result.request_id || `fal-${Date.now()}`;

    if (result.images && result.images.length > 0 && result.images[0].url) {
      imageUrl = result.images[0].url;
      // Array check for safety
      if (Array.isArray(imageUrl)) {
        imageUrl = imageUrl[0];
      }
    }
    // Fallback logic
    else if (result.output) {
      if (Array.isArray(result.output) && result.output.length > 0) {
        imageUrl = result.output[0];
      } else if (typeof result.output === "string") {
        imageUrl = result.output;
      }
    }

    if (imageUrl) {
      // Resmi Supabase storage'a yükle
      const storageResult = await uploadImageToSupabaseStorage(
        imageUrl,
        userId,
        replicateId
      );

      return {
        imageUrl: storageResult.publicUrl, // Supabase storage'dan gelen public URL
        storagePath: storageResult.storagePath, // Storage path'i de döndür
        replicateId: replicateId,
      };
    } else {
      throw new Error("Fal.ai Imagen-4-fast'dan görsel çıkışı alınamadı");
    }
  } catch (error) {
    console.error("Fal.ai Imagen-4-fast generation hatası:", error);
    throw error;
  }
}

// Gemini ile çok dilli tag'ler oluştur (tek kelime)
async function generateLocationTagsWithGPT(
  locationTitle,
  locationDescription,
  locationType
) {
  try {
    console.log("🏷️ [GEMINI] Tag generation başlatılıyor...");
    console.log("🏷️ [GEMINI] Location Title:", locationTitle);
    console.log("🏷️ [GEMINI] Location Description:", locationDescription?.substring(0, 100) || "N/A");
    console.log("🏷️ [GEMINI] Location Type:", locationType);

    // locationDescription null/undefined kontrolü
    if (!locationDescription || typeof locationDescription !== "string") {
      console.error("❌ Location description geçersiz:", locationDescription);
      throw new Error("Location description is required for tag generation");
    }

    const prompt = `Generate location tags for fashion photography. Each tag must be EXACTLY ONE WORD (single word, no spaces, no hyphens). Tags must be DIRECTLY RELATED to the location's main subject and theme.

Location: "${locationTitle}"
Description: "${locationDescription.substring(0, 300)}"
Type: ${locationType}

CRITICAL REQUIREMENTS:
- Each tag must be EXACTLY ONE WORD (single word only)
- Generate exactly 5 tags per language (minimum 5, maximum 5)
- Tags MUST be directly related to the location's MAIN SUBJECT and THEME
- MANDATORY: Extract key words from the location title and description - these MUST appear in tags
- The MAIN SUBJECT mentioned in title/description MUST be included in tags (e.g., if "gemi" is mentioned, "ship" or "gemi" must be a tag)
- Focus on the MAIN ELEMENTS: objects, places, styles, eras, materials mentioned in the location
- DO NOT use generic/abstract tags like "empty", "sunny", "pavement" unless they are the main subject
- Tags should describe WHAT is in the location, not general atmosphere
- If location mentions specific objects (car, ship, building, etc.), these MUST be in the tags

EXAMPLE 1:
If location is "Vintage car in Istanbul street":
- GOOD tags: istanbul, vintage, car, retro, classic, street, cobblestone, historic
- BAD tags: empty, sunny, pavement, bright, quiet (these are generic atmosphere, not the main subject)
- NOTE: "car" MUST be in tags because it's the main subject

EXAMPLE 2:
If location is "Denizde batmış eski bir gemi" (Old sunken ship in the sea):
- GOOD tags: ship, sunken, ocean, sea, wreck, rusty, old, underwater, coral, barnacle
- BAD tags: empty, blue, wet, dark (these are generic atmosphere)
- NOTE: "ship" or "gemi" MUST be in tags because it's the main subject mentioned

STEP-BY-STEP PROCESS:
1. Identify the MAIN SUBJECT from title/description (e.g., "gemi", "car", "building")
2. Extract key descriptive words (e.g., "eski", "batmış", "vintage", "historic")
3. Extract location/place words (e.g., "istanbul", "deniz", "ocean")
4. Extract style/era words (e.g., "vintage", "retro", "modern")
5. Create tags that include the MAIN SUBJECT and these key words
6. Ensure the MAIN SUBJECT is ALWAYS included in tags

Analyze the location title and description carefully. Extract the main subjects, objects, places, styles, and key characteristics. Create tags that directly relate to these elements, ensuring the MAIN SUBJECT is always included.

Languages required: en, es, pt, fr, de, it, tr, ru, uk, ar, fa, zh, zh-tw, ja, ko, hi, id

OUTPUT FORMAT (valid JSON only):
{
  "en": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "es": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "pt": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "fr": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "de": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "it": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "tr": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "ru": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "uk": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "ar": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "fa": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "zh": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "zh-tw": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "ja": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "ko": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "hi": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "id": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}

IMPORTANT: Return ONLY valid JSON, no explanations, no markdown, no code blocks.`;

    // Replicate Gemini Flash API çağrısı
    const geminiResponse = await callReplicateGeminiFlash(prompt, [], 3);

    if (!geminiResponse) {
      console.error("❌ Replicate Gemini API response boş");
      throw new Error("Replicate Gemini API response is empty or invalid");
    }

    console.log(
      "🎯 Replicate Gemini raw tags response:",
      geminiResponse.substring(0, 200)
    );

    // JSON response'u parse et
    let tags = null;

    try {
      // JSON parse etmeye çalış (markdown code block'ları temizle)
      let cleanedResponse = geminiResponse.trim();

      // Markdown code block'ları temizle
      if (cleanedResponse.startsWith("```json")) {
        cleanedResponse = cleanedResponse
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "");
      } else if (cleanedResponse.startsWith("```")) {
        cleanedResponse = cleanedResponse.replace(/```\s*/g, "");
      }

      tags = JSON.parse(cleanedResponse);

      // Validate tags structure
      const requiredLanguages = [
        "en", // English
        "es", // Spanish
        "pt", // Portuguese
        "fr", // French
        "de", // German
        "it", // Italian
        "tr", // Turkish
        "ru", // Russian
        "uk", // Ukrainian
        "ar", // Arabic
        "fa", // Persian/Farsi
        "zh", // Chinese Simplified
        "zh-tw", // Chinese Traditional
        "ja", // Japanese
        "ko", // Korean
        "hi", // Hindi
        "id", // Indonesian
      ];

      // Validate: her dil için 5 tag ve her tag tek kelime
      const isValid = requiredLanguages.every((lang) => {
        if (!Array.isArray(tags[lang]) || tags[lang].length !== 5) {
          return false;
        }
        // Her tag tek kelime olmalı (boşluk, tire yok)
        return tags[lang].every(
          (tag) =>
            typeof tag === "string" &&
            tag.trim().length > 0 &&
            !tag.includes(" ") &&
            !tag.includes("-")
        );
      });

      if (!isValid) {
        throw new Error(
          "Invalid tags structure - missing languages, incorrect tag count, or tags are not single words"
        );
      }

      console.log("✅ Successfully parsed tags JSON response");
      console.log(
        "📝 Tags generated for",
        Object.keys(tags).length,
        "languages (each tag is single word)"
      );
    } catch (jsonError) {
      console.error("❌ JSON parse failed:", jsonError);
      console.log("⚠️ Retrying tag generation with simplified prompt...");

      // Retry with a simpler prompt
      try {
        const retryPrompt = `Generate location tags. Each tag must be EXACTLY ONE WORD. Tags must be DIRECTLY RELATED to the location's main subject. Location: "${locationTitle}" - "${(locationDescription || "").substring(
          0,
          200
        )}". MANDATORY: Extract key words from title and description - the MAIN SUBJECT mentioned MUST be included in tags. Focus on main subjects, objects, places, styles mentioned. DO NOT use generic atmosphere tags. If location mentions specific objects (car, ship, building, etc.), these MUST be in the tags. Return JSON with languages: en, es, pt, fr, de, it, tr, ru, uk, ar, fa, zh, zh-tw, ja, ko, hi, id. Each language must have exactly 5 tags (minimum 5, maximum 5), each tag exactly one word. Return ONLY valid JSON, no explanations.`;

        const retryGeminiResponse = await callReplicateGeminiFlash(retryPrompt, [], 3);

        if (retryGeminiResponse) {
          let cleanedRetryResponse = retryGeminiResponse.trim();
          if (cleanedRetryResponse.startsWith("```json")) {
            cleanedRetryResponse = cleanedRetryResponse
              .replace(/```json\s*/g, "")
              .replace(/```\s*/g, "");
          } else if (cleanedRetryResponse.startsWith("```")) {
            cleanedRetryResponse = cleanedRetryResponse.replace(/```\s*/g, "");
          }

          tags = JSON.parse(cleanedRetryResponse);
          console.log("✅ [REPLICATE-GEMINI] Retry successful, tags generated");
        } else {
          throw new Error("Retry failed - no output");
        }
      } catch (retryError) {
        console.error("❌ [REPLICATE-GEMINI] Retry also failed:", retryError);
        throw new Error("Tag generation failed after retry");
      }
    }

    console.log("✅ [GEMINI] Tag generation tamamlandı");
    return tags;
  } catch (error) {
    console.error("❌ [GEMINI] Tag generation hatası:", error.message);
    console.error("❌ Full error:", error);

    throw error;
  }
}

// Gemini ile prompt enhance et
async function enhanceLocationPromptWithGPT(originalPrompt) {
  try {
    console.log("🤖 [GEMINI] Prompt enhancement başlatılıyor...");

    const promptForGemini = `You are an expert AI prompt engineer specializing in photorealistic location photography. Create SHORT, SIMPLE prompts optimized for image generation.

IMPORTANT: Always respond in ENGLISH only, regardless of the input language. If the input is in Turkish, Arabic, or any other language, translate the concept to English and create an English prompt.

Generate a SHORT, SIMPLE ENGLISH prompt (max 512 tokens) following best practices.

🎯 OPTIMIZATION REQUIREMENTS:
- Focus on visual description and atmosphere
- Include texture and material descriptions
- Specify lighting conditions
- Add basic composition details
- Mention realistic textures and photorealistic quality

📸 SIMPLE SPECIFICATIONS:
- Composition: Balanced composition, rule of thirds
- Style: Professional photography, realistic textures
- NO technical camera details (no f/8, no 35mm lens, no DSLR)

💡 LIGHTING SPECIFICATIONS:
- OUTDOOR: "Natural daylight"
- INDOOR: "Bright even lighting"
- Avoid: dim, muted, aged, warm yellow, sepia tones

🎨 ENHANCEMENT TECHNIQUES:
- Materials: "realistic textures", "detailed surfaces"
- Quality: "photorealistic", "high detail", "sharp focus"
- Colors: "vibrant colors", "high color saturation"
- Depth: "foreground to background", "layered composition"

🚫 PROHIBITIONS:
- NO people, humans, figures, characters, mannequins, models, or any living beings
- NO busy, cluttered, distracting elements
- NO extreme angles, unusual perspectives
- NO text, logos, branded elements
- NO dim, dark, moody, vintage, aged lighting
- NO technical camera specifications (no f/8, no lens types, no DSLR)
- The location MUST be completely empty, vacant, and unoccupied

LOCATION TYPE ANALYSIS:
You MUST analyze the location description and determine if it's:
- "outdoor" (açık hava): natural environments, streets, parks, beaches, mountains, etc.
- "indoor" (kapalı mekan): rooms, buildings, restaurants, museums, etc.
- "studio" (stüdyo): professional photography studios, controlled environments

OUTPUT FORMAT (MUST BE IN ENGLISH):
{
  "prompt": "[simple 200-400 word English prompt with vibrant colors and realistic details - NO technical camera specs, NO people, NO humans, NO figures, NO mannequins - focus on visual description of an EMPTY, VACANT location - translate any non-English concepts to English]",
  "title": "[complete, descriptive English location title - 4-8 words - MUST start with the MAIN SUBJECT/THEME of the location - make it general and beautiful - example: 'Vintage Car on Historic Istanbul Street' NOT 'Vintage Car in' - the title must be complete and meaningful]",
  "locationType": "[outdoor/indoor/studio]"
}

TITLE REQUIREMENTS:
- Title MUST start with the MAIN SUBJECT/THEME of the location (e.g., "Vintage Car", "Modern Office", "Beach Sunset")
- Title must be COMPLETE and MEANINGFUL (not incomplete like "Vintage Car in")
- Title must be GENERAL and BEAUTIFUL (4-8 words)
- Title should describe the location as a whole, not just one element
- Example: "Vintage Car on Historic Istanbul Street" ✅ NOT "Vintage Car in" ❌

IMPORTANT: You MUST return a valid JSON object with these exact keys: prompt, title, locationType. Return ONLY valid JSON, no explanations, no markdown, no code blocks.

Create a detailed location photography prompt from: "${originalPrompt}"`;

    // Replicate Gemini Flash API çağrısı (built-in retry mekanizması ile)
    console.log("🤖 [REPLICATE-GEMINI] Location prompt API çağrısı başlatılıyor...");

    const geminiResponse = await callReplicateGeminiFlash(promptForGemini, [], 3);

    if (!geminiResponse) {
      throw new Error("Replicate Gemini API response is empty after retries");
    }

    console.log("🎯 Replicate Gemini raw response:", geminiResponse);

    // JSON response'u parse et
    let generatedTitle = null;
    let enhancedPrompt = null;
    let locationType = "unknown";

    try {
      // JSON kod bloklarını temizle
      let cleanedResponse = geminiResponse
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .replace(/`/g, "")
        .trim();

      // Eğer başında veya sonunda fazladan karakterler varsa temizle
      cleanedResponse = cleanedResponse.replace(/^[^{]*\{/, "{");
      cleanedResponse = cleanedResponse.replace(/\}[^}]*$/, "}");

      const jsonResponse = JSON.parse(cleanedResponse);

      if (
        jsonResponse.prompt &&
        jsonResponse.title &&
        jsonResponse.locationType
      ) {
        generatedTitle = jsonResponse.title.trim();
        enhancedPrompt = jsonResponse.prompt.trim();
        locationType = jsonResponse.locationType.trim();

        console.log("✅ Successfully parsed JSON response");
        console.log("📝 Parsed title:", generatedTitle);
        console.log("📝 Parsed prompt length:", enhancedPrompt.length);
        console.log("📍 Parsed location type:", locationType);
      } else {
        throw new Error("Missing required fields in JSON response");
      }
    } catch (jsonError) {
      console.error("❌ JSON parse hatası:", jsonError.message);
      console.log("📝 Raw response:", geminiResponse);
      throw new Error(`Failed to parse Gemini response: ${jsonError.message}`);
    }

    // Title yoksa default oluştur
    if (!generatedTitle) {
      const words = originalPrompt.split(" ").slice(0, 5);
      generatedTitle = words.join(" ") || "Custom Location";
    }

    // Enhanced prompt yoksa hata fırlat
    if (!enhancedPrompt) {
      throw new Error("No enhanced prompt generated");
    }

    // Title'ı temizle ve kontrol et (4-8 kelime arası olmalı, eksik görünmemeli)
    const titleWords = generatedTitle
      .split(" ")
      .filter((word) => word.trim().length > 0);

    // Eğer title çok kısaysa (3 kelimeden az) veya eksik görünüyorsa, orijinal prompt'tan daha iyi bir title oluştur
    if (
      titleWords.length < 3 ||
      generatedTitle.toLowerCase().endsWith("in") ||
      generatedTitle.toLowerCase().endsWith("on") ||
      generatedTitle.toLowerCase().endsWith("at")
    ) {
      console.log(
        "⚠️ Title eksik görünüyor, orijinal prompt'tan daha iyi bir title oluşturuluyor..."
      );
      const originalWords = originalPrompt.split(" ").slice(0, 6);
      generatedTitle = originalWords.join(" ") || "Custom Location";
    } else {
      // Title'ı 8 kelime ile sınırla (daha uzun olabilir ama çok uzun olmasın)
      generatedTitle = titleWords.slice(0, 8).join(" ");
    }

    // Token sayısını kontrol et (prompt için)
    const tokenCount = enhancedPrompt.split(/\s+/).length;
    console.log(`Generated prompt token count: ${tokenCount}`);

    // Eğer 512 token'dan fazlaysa kısalt
    if (tokenCount > 512) {
      const words = enhancedPrompt.split(/\s+/);
      enhancedPrompt = words.slice(0, 512).join(" ");
      console.log(`Prompt kısaltıldı: ${enhancedPrompt}`);
    }

    // Basit uzunluk kontrolü (çok kısa değilse kabul et)
    if (tokenCount < 50) {
      console.log("⚠️ Generated prompt çok kısa, tekrar denenebilir...");
      console.log("Token sayısı:", tokenCount);
    }

    console.log("✅ [GEMINI] Prompt enhancement tamamlandı");
    console.log("Generated title:", generatedTitle);
    console.log(
      "Enhanced prompt preview:",
      enhancedPrompt.substring(0, 100) + "..."
    );
    console.log("Enhanced prompt length:", enhancedPrompt.length);

    return {
      title: generatedTitle,
      prompt: enhancedPrompt,
      locationType: locationType,
    };
  } catch (error) {
    console.error("❌ [GEMINI] Enhancement hatası:", error.message);
    console.error("❌ Full error:", error);

    // Fallback yok - hata fırlat
    throw new Error(`Gemini prompt generation failed: ${error.message}`);
  }
}

// Location'ı Supabase'e kaydet
async function saveLocationToDatabase(
  title,
  originalPrompt,
  enhancedPrompt,
  imageUrl,
  replicateId,
  category = "custom",
  userId = null,
  isPublic = false,
  generatedTitle = null,
  locationType = "unknown",
  tags = null
) {
  try {
    console.log("💾 Location Supabase'e kaydediliyor...");
    console.log("📝 Enhanced prompt değeri:", enhancedPrompt);
    console.log("📝 Enhanced prompt length:", enhancedPrompt?.length);

    const { data, error } = await supabase
      .from("custom_locations")
      .insert({
        title: title,
        generated_title: generatedTitle,
        original_prompt: originalPrompt,
        enhanced_prompt: enhancedPrompt, // Stores the actual enhanced prompt here
        image_url: imageUrl, // Supabase storage'dan gelen public URL
        replicate_id: replicateId,
        category: category,
        user_id: userId,
        is_public: isPublic,
        status: "completed",
        location_type: locationType, // Yeni eklenen location type
        tags: tags, // Multi-language tags for search
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase kayıt hatası:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));

      // Eğer tablo mevcut değilse, geçici olarak sahte data döndür
      if (
        error.code === "42P01" ||
        error.message?.includes("relation") ||
        error.message?.includes("table")
      ) {
        console.log("⚠️ Tablo mevcut değil, geçici data dönülüyor...");
        return {
          id: Date.now(),
          title: title,
          generated_title: generatedTitle,
          original_prompt: originalPrompt,
          enhanced_prompt: enhancedPrompt,
          image_url: imageUrl,
          replicate_id: replicateId,
          category: category,
          user_id: userId,
          is_public: isPublic,
          status: "completed",
          created_at: new Date().toISOString(),
        };
      }

      throw error;
    }

    console.log("✅ Location Supabase'e kaydedildi:", data.id);
    return data;
  } catch (error) {
    console.error("Database kayıt hatası:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));
    throw error;
  }
}

// CREATE LOCATION ROUTE
router.post("/create-location", async (req, res) => {
  try {
    const {
      prompt,
      title,
      category = "custom",
      userId,
      isPublic = false,
      skipSaveToDatabase = false, // Default false, zorla kaydet
      locationType = null,
    } = req.body;

    console.log("🔍 skipSaveToDatabase value:", skipSaveToDatabase);
    console.log("🔍 skipSaveToDatabase type:", typeof skipSaveToDatabase);

    // User ID validation - birden fazla yöntem
    let actualUserId = userId;

    // Method 1: Header'dan user ID al
    if (!actualUserId) {
      actualUserId = req.headers["x-user-id"] || req.headers["user-id"];
    }

    // Method 2: Auth token'dan user ID parse et (örnek)
    if (!actualUserId && req.headers.authorization) {
      // JWT token parse örneği - gerçek implementation'a göre değişir
      // const token = req.headers.authorization.split(' ')[1];
      // actualUserId = parseTokenToUserId(token);
    }

    // Method 3: Query parameter'dan al
    if (!actualUserId) {
      actualUserId = req.query.userId;
    }

    console.log("🔍 User ID sources:");
    console.log("- Body userId:", userId);
    console.log("- Header x-user-id:", req.headers["x-user-id"]);
    console.log("- Query userId:", req.query.userId);
    console.log("- Final actualUserId:", actualUserId);

    // UUID format validation
    if (actualUserId) {
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
    }

    // Validation
    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Prompt gerekli",
      });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Başlık gerekli",
      });
    }

    console.log("🚀 Create location işlemi başlatıldı");
    console.log("Original prompt:", prompt);
    console.log("Title:", title);
    console.log("Category:", category);
    console.log("User ID:", actualUserId);
    console.log("Is Public:", isPublic);

    // 1. Gemini ile prompt ve title oluştur
    const gptResult = await enhanceLocationPromptWithGPT(prompt);
    console.log("🔍 Gemini Result:", {
      title: gptResult.title,
      promptLength: gptResult.prompt?.length,
      promptPreview: gptResult.prompt?.substring(0, 100) + "...",
    });
    const enhancedPrompt = gptResult.prompt;
    const generatedTitle = gptResult.title;

    // 2. Google Imagen-4-fast ile görsel generate et
    const imagenResult = await generateLocationWithImagen4Fast(
      enhancedPrompt,
      actualUserId
    );

    console.log("✅ Image generation completed, starting tag generation...");

    // Location type'ı belirle: frontend'den geliyorsa onu kullan, yoksa Gemini'den geleni
    const finalLocationType =
      locationType || gptResult.locationType || "unknown";

    // 3. Gemini ile çok dilli tag'ler oluştur
    console.log("🏷️ Generating tags for location...");
    console.log("🏷️ Tag generation params:", {
      title: generatedTitle,
      descriptionLength: enhancedPrompt?.length,
      locationType: finalLocationType,
    });
    let locationTags = null;
    try {
      locationTags = await generateLocationTagsWithGPT(
        generatedTitle,
        enhancedPrompt,
        finalLocationType
      );
      console.log(
        "✅ Tags generated:",
        Object.keys(locationTags).length,
        "languages"
      );
    } catch (tagError) {
      console.error("❌ Tag generation hatası:", tagError);
      console.error("❌ Tag generation error details:", tagError.message);
      console.error("❌ Tag generation stack:", tagError.stack);
      console.log("⚠️ Tag generation başarısız, tekrar deneniyor...");

      // Retry tag generation with a simpler approach
      try {
        console.log("🔄 Retrying tag generation...");
        locationTags = await generateLocationTagsWithGPT(
          generatedTitle,
          enhancedPrompt,
          finalLocationType
        );
        console.log(
          "✅ Tags generated on retry:",
          Object.keys(locationTags).length,
          "languages"
        );
      } catch (retryError) {
        console.error("❌ Tag generation retry de başarısız:", retryError);
        console.error("❌ Retry error details:", retryError.message);
        console.error("❌ Retry error stack:", retryError.stack);
        // Tag generation başarısız olsa bile location creation devam etsin (tags null olarak kaydedilir)
        console.log("⚠️ Tag generation başarısız, location tags olmadan kaydediliyor...");
        locationTags = null;
      }
    }

    // 4. Supabase'e kaydet (zorla)
    console.log("🔍 DEBUG: Forcing database save...");
    if (true) {
      // Zorla kaydet
      console.log(
        "🔍 Before call - enhancedPrompt:",
        enhancedPrompt?.substring(0, 100) + "..."
      );
      console.log(
        "🔍 Before call - enhancedPrompt length:",
        enhancedPrompt?.length
      );
      console.log("🔍 Before call - generatedTitle:", generatedTitle);
      console.log(
        "🔍 Before call - tags:",
        JSON.stringify(locationTags, null, 2)
      );

      const savedLocation = await saveLocationToDatabase(
        generatedTitle.trim(), // Gemini'den gelen kısa title (5-10 kelime)
        prompt.trim(),
        enhancedPrompt,
        imagenResult.imageUrl, // Supabase storage'dan gelen public URL
        imagenResult.replicateId,
        category,
        actualUserId,
        isPublic,
        generatedTitle, // Gemini'den gelen title ayrı column'da
        finalLocationType, // Frontend'den gelen veya GPT'den gelen location type
        locationTags // Multi-language tags
      );

      console.log(
        "✅ Create location işlemi tamamlandı (Google Imagen-4-fast ile veritabanına kaydedildi)"
      );

      res.json({
        success: true,
        message: "Location başarıyla oluşturuldu",
        data: {
          id: savedLocation.id,
          title: savedLocation.title,
          generatedTitle: savedLocation.generated_title,
          imageUrl: optimizeImageUrl(savedLocation.image_url), // Optimize edilmiş Supabase URL
          category: savedLocation.category,
          isPublic: savedLocation.is_public,
          originalPrompt: savedLocation.original_prompt,
          enhancedPrompt: savedLocation.enhanced_prompt,
          replicateId: savedLocation.replicate_id,
          locationType: savedLocation.location_type, // Yeni eklenen location type
          tags: savedLocation.tags, // Multi-language tags
          createdAt: savedLocation.created_at,
          userId: savedLocation.user_id,
        },
      });
    } else {
      // Sadece generate et, veritabanına kaydetme
      console.log("✅ Create location işlemi tamamlandı (sadece generate)");

      res.json({
        success: true,
        message: "Location başarıyla generate edildi",
        data: {
          title: title.trim(),
          generatedTitle: generatedTitle,
          imageUrl: optimizeImageUrl(imagenResult.imageUrl),
          originalPrompt: prompt.trim(),
          enhancedPrompt: enhancedPrompt,
          replicateId: imagenResult.replicateId,
          category: category,
          userId: actualUserId,
        },
      });
    }
  } catch (error) {
    console.error("❌ Create location hatası:", error);

    res.status(500).json({
      success: false,
      error: "Location oluşturulurken hata oluştu",
      details: error.message,
    });
  }
});

// GET USER'S CUSTOM LOCATIONS
router.get("/user-locations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { category = "custom", limit = 20, offset = 0 } = req.query;

    console.log("👤 User locations fetch - userId:", userId);
    console.log("📝 Category:", category);

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
      .from("custom_locations")
      .select("*, favorite_count")
      .eq("user_id", userId)
      .eq("category", category)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Supabase user locations fetch hatası:", error);
      throw error;
    }

    console.log("✅ User locations found:", data?.length || 0);

    res.json({
      success: true,
      data: optimizeLocationImages(data || []),
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("User locations fetch hatası:", error);
    res.status(500).json({
      success: false,
      error: "User locations getirilemedi",
      details: error.message,
    });
  }
});

// Diziyi karıştıran yardımcı fonksiyon - Seed ile daha iyi randomness
const shuffleArray = (array, seed = null) => {
  const shuffled = [...array];

  // Eğer seed verilmemişse, current timestamp + random kullan
  const randomSeed = seed || Date.now() + Math.random() * 1000000;

  // Simple seeded random function
  let randomValue = randomSeed;
  const seededRandom = () => {
    randomValue = (randomValue * 9301 + 49297) % 233280;
    return randomValue / 233280;
  };

  // Fisher-Yates shuffle with seeded random
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  console.log(`🎲 Shuffled with seed: ${randomSeed}`);
  return shuffled;
};

// Supabase resim URL'lerini optimize eden yardımcı fonksiyon
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si ise optimize et
  if (imageUrl.includes("supabase.co")) {
    // URL'de zaten query parametreleri varsa ekleme
    if (imageUrl.includes("?")) {
      // Sadece render URL'sine çevir, parametreleri koruyarak
      return imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      );
    }
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      ) + "?width=500&height=500&quality=80"
    );
  }

  return imageUrl;
};

// Location objelerinin resim URL'lerini optimize eden fonksiyon
const optimizeLocationImages = (locations) => {
  if (!Array.isArray(locations)) return locations;

  return locations.map((location) => ({
    ...location,
    image_url: optimizeImageUrl(location.image_url),
  }));
};

// Seçilen resmin boyut parametrelerini kaldıran fonksiyon (API'ye gönderilmeden önce)
const cleanImageUrlForApi = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase render URL'si ise original object URL'sine çevir ve parametreleri kaldır
  if (
    imageUrl.includes("supabase.co") &&
    imageUrl.includes("/storage/v1/render/image/public/")
  ) {
    const cleanUrl = imageUrl
      .replace("/storage/v1/render/image/public/", "/storage/v1/object/public/")
      .split("?")[0]; // Query parametrelerini kaldır
    return cleanUrl;
  }

  return imageUrl;
};

// GET PUBLIC LOCATIONS
router.get("/public-locations", async (req, res) => {
  try {
    const {
      category = "custom",
      limit = 50,
      offset = 0,
      shuffle = "true", // Default shuffle kalıyor
      sort = "created_at_desc", // newest, oldest, created_at_desc, created_at_asc
      includeStudio = "false", // Studio'ları dahil et mi?
      t = null, // Timestamp cache buster / shuffle seed
    } = req.query;

    console.log("🔀 Public locations fetch - shuffle:", shuffle, "sort:", sort);
    console.log("📝 Limit:", limit, "Offset:", offset);
    console.log("🎬 Include Studio:", includeStudio);
    console.log("⏰ Timestamp seed:", t);

    // Location type filtresi - studio dahil mi?
    const allowedLocationTypes =
      includeStudio === "true"
        ? ["outdoor", "indoor", "studio"]
        : ["outdoor", "indoor"];

    // Sort order'ı belirle
    let orderBy = { column: "created_at", ascending: false }; // Default: newest first

    if (sort === "newest" || sort === "created_at_desc") {
      orderBy = { column: "created_at", ascending: false };
    } else if (sort === "oldest" || sort === "created_at_asc") {
      orderBy = { column: "created_at", ascending: true };
    }

    // Shuffle parametresi true ise tüm veriyi al, shuffle yap, sonra paginate et
    if (shuffle === "true") {
      // Önce tüm public location'ları al
      const { data: allData, error } = await supabase
        .from("custom_locations")
        .select("*, favorite_count")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .in("location_type", allowedLocationTypes) // Dynamic location types
        .order(orderBy.column, { ascending: orderBy.ascending });

      if (error) {
        throw error;
      }

      // Shuffle yap - timestamp'i seed olarak kullan (opsiyonel)
      const shuffleSeed = t ? parseInt(t) : null;
      const shuffledData = shuffleArray(allData || [], shuffleSeed);
      console.log(
        `🎲 Shuffled ${shuffledData.length} locations with seed: ${shuffleSeed || "auto-generated"
        }`
      );

      // Pagination uygula
      const startIndex = parseInt(offset);
      const endIndex = startIndex + parseInt(limit);
      const paginatedData = shuffledData.slice(startIndex, endIndex);

      console.log(
        `📄 Returning ${paginatedData.length} items (${startIndex}-${endIndex})`
      );

      res.json({
        success: true,
        data: optimizeLocationImages(paginatedData),
        count: paginatedData.length,
        total: shuffledData.length,
        hasMore: endIndex < shuffledData.length,
      });
    } else {
      // Normal pagination (shuffle olmadan)
      const { data, error } = await supabase
        .from("custom_locations")
        .select("*, favorite_count")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .in("location_type", allowedLocationTypes) // Dynamic location types
        .order(orderBy.column, { ascending: orderBy.ascending })
        .range(offset, offset + limit - 1);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data: optimizeLocationImages(data || []),
        count: data?.length || 0,
      });
    }
  } catch (error) {
    console.error("Public locations fetch hatası:", error);
    res.status(500).json({
      success: false,
      error: "Public locations getirilemedi",
      details: error.message,
    });
  }
});

// DELETE LOCATION ROUTE
router.delete("/delete-location/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    console.log("🗑️ Location silme işlemi başlatıldı - ID:", locationId);

    // Location'ı veritabanından sil
    const { data, error } = await supabase
      .from("custom_locations")
      .delete()
      .eq("id", locationId)
      .select()
      .single();

    if (error) {
      console.error("Supabase delete hatası:", error);

      // Eğer tablo mevcut değilse, geçici olarak başarılı response döndür
      if (
        error.code === "42P01" ||
        error.message?.includes("relation") ||
        error.message?.includes("table")
      ) {
        console.log(
          "⚠️ Tablo mevcut değil, geçici başarılı response dönülüyor..."
        );
        return res.json({
          success: true,
          message: "Location başarıyla silindi (test mode)",
        });
      }

      // Eğer kayıt bulunamadıysa
      if (error.code === "PGRST116" || error.message?.includes("No rows")) {
        return res.status(404).json({
          success: false,
          error: "Location bulunamadı",
        });
      }

      throw error;
    }

    console.log("✅ Location başarıyla silindi:", data?.id);

    res.json({
      success: true,
      message: "Location başarıyla silindi",
      data: data,
    });
  } catch (error) {
    console.error("❌ Location silme hatası:", error);

    res.status(500).json({
      success: false,
      error: "Location silinirken hata oluştu",
      details: error.message,
    });
  }
});

// SAVE TO GALLERY ROUTE (HTML'den gelecek istekler için)
router.post("/save-to-gallery", async (req, res) => {
  try {
    const {
      title,
      generatedTitle,
      originalPrompt,
      enhancedPrompt,
      imageUrl,
      replicateId,
      userId,
      category = "custom",
      isPublic = true,
      locationType = "unknown",
      tags: providedTags = null,
    } = req.body;

    console.log("💾 Save to gallery işlemi başlatıldı");
    console.log("Generated Title:", generatedTitle);
    console.log("Original Prompt:", originalPrompt);
    console.log("User ID from body:", userId);
    console.log("User ID from headers:", req.headers["x-user-id"]);
    console.log("All headers:", Object.keys(req.headers));
    console.log("Raw x-user-id header:", req.headers["x-user-id"]);
    console.log("Raw user-id header:", req.headers["user-id"]);

    // User ID validation
    let actualUserId = userId;
    if (!actualUserId || actualUserId === "undefined") {
      // Case-insensitive header search
      actualUserId =
        req.headers["x-user-id"] ||
        req.headers["X-User-ID"] ||
        req.headers["user-id"] ||
        req.headers["User-ID"];
    }

    // Debug: Header değerlerini kontrol et
    console.log("Header x-user-id value:", req.headers["x-user-id"]);
    console.log("Header X-User-ID value:", req.headers["X-User-ID"]);
    console.log("Header user-id value:", req.headers["user-id"]);
    console.log("Header User-ID value:", req.headers["User-ID"]);
    console.log("Final actualUserId:", actualUserId);

    // UUID format validation - sadece userId varsa kontrol et
    if (actualUserId && actualUserId !== "undefined") {
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
    } else {
      console.error("❌ User ID bulunamadı");
      return res.status(400).json({
        success: false,
        error: "User ID required",
        details: "No valid user ID found in request body or headers",
      });
    }

    // Validation
    if (!title || !originalPrompt || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: "Gerekli alanlar eksik (title, originalPrompt, imageUrl)",
      });
    }

    // Duplicate kontrolü - aynı replicateId ile kayıt var mı?
    if (replicateId) {
      const { data: existingLocation, error: checkError } = await supabase
        .from("custom_locations")
        .select("id, title")
        .eq("replicate_id", replicateId)
        .single();

      if (existingLocation) {
        console.log("⚠️ Duplicate kayıt bulundu:", existingLocation.id);
        return res.json({
          success: true,
          message: "Location zaten galeri'de mevcut",
          data: existingLocation,
          duplicate: true,
        });
      }
    }

    // Tag generation - eğer tags yoksa oluştur
    let locationTags = providedTags;
    if (!locationTags) {
      console.log("🏷️ Generating tags for save-to-gallery location...");
      try {
        locationTags = await generateLocationTagsWithGPT(
          generatedTitle?.trim() || title.trim(),
          enhancedPrompt?.trim() || originalPrompt.trim(),
          locationType
        );
        console.log(
          "✅ Tags generated:",
          Object.keys(locationTags).length,
          "languages"
        );
      } catch (tagError) {
        console.error("❌ Tag generation hatası:", tagError);
        // Tag generation başarısız olsa bile kaydetmeye devam et
        locationTags = null;
      }
    }

    // Supabase'e kaydet
    const savedLocation = await saveLocationToDatabase(
      generatedTitle?.trim() || title.trim(), // Önce generatedTitle'ı kullan
      originalPrompt.trim(),
      enhancedPrompt?.trim() || "",
      imageUrl,
      replicateId,
      category,
      actualUserId,
      isPublic,
      generatedTitle?.trim() || "",
      locationType,
      locationTags // Multi-language tags
    );

    res.json({
      success: true,
      message: "Location başarıyla galeri'ye eklendi",
      data: {
        id: savedLocation.id,
        title: savedLocation.title,
        generatedTitle: savedLocation.generated_title,
        imageUrl: optimizeImageUrl(savedLocation.image_url),
        category: savedLocation.category,
        isPublic: savedLocation.is_public,
        originalPrompt: savedLocation.original_prompt,
        enhancedPrompt: savedLocation.enhanced_prompt,
        replicateId: savedLocation.replicate_id,
        locationType: savedLocation.location_type, // Yeni eklenen location type
        tags: savedLocation.tags, // Multi-language tags
        createdAt: savedLocation.created_at,
      },
    });
  } catch (error) {
    console.error("❌ Save to gallery hatası:", error);

    res.status(500).json({
      success: false,
      error: "Galeri'ye kaydetme sırasında hata oluştu",
      details: error.message,
    });
  }
});

module.exports = router;
