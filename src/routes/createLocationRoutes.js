const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { supabase } = require("../supabaseClient");
const logger = require("../utils/logger");

// Gemini API setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Replicate'den gelen resmi Supabase storage'a kaydet
async function uploadImageToSupabaseStorage(imageUrl, userId, replicateId) {
  try {
    logger.log("📤 Resim Supabase storage'a yükleniyor...");
    logger.log("Image URL:", imageUrl);
    logger.log("User ID:", userId);
    logger.log("Replicate ID:", replicateId);

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

    logger.log("📁 Dosya adı:", fileName);

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

    logger.log("✅ Resim Supabase storage'a yüklendi:", uploadData.path);

    // Public URL oluştur
    const { data: urlData } = supabase.storage
      .from("user-locations")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;
    logger.log("🔗 Public URL:", publicUrl);

    return {
      storagePath: fileName,
      publicUrl: publicUrl,
    };
  } catch (error) {
    console.error("Resim yükleme hatası:", error);
    throw error;
  }
}

// Flux 1.1 Pro Ultra ile location image generate et
// Google Imagen-4-fast ile location image generate et - Migrated to Fal.ai
async function generateLocationWithImagen4(prompt, userId) {
  try {
    logger.log(
      "📸 Fal.ai Imagen-4 ile location generation başlatılıyor..."
    );
    logger.log("Prompt:", prompt);

    const response = await fetch(
      // ⚠️ 25 Ağu 2026: fal imagen4 ucunu kaldırdı (404) → nano-banana-2 t2i
      "https://fal.run/fal-ai/nano-banana-2",
      {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${prompt} The scene must be rendered strictly from the perspective of a standing fashion model, while keeping the model completely hidden and not visible in the final image.`,
          aspect_ratio: "1:1",
          output_format: "jpeg",
          // nano-banana-2 şemasında safety_filter_level yok; resolution ayrı alan
          resolution: "1K",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Fal.ai Imagen-4 API Error:", errorText);
      throw new Error(`Fal.ai Imagen-4 API Error: ${response.status}`);
    }

    const result = await response.json();
    logger.log("✅ Fal.ai Imagen-4 generation tamamlandı");
    logger.log("Imagen result:", result);

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
      throw new Error("Fal.ai Imagen-4'dan görsel çıkışı alınamadı");
    }
  } catch (error) {
    console.error("Fal.ai Imagen-4 generation hatası:", error);
    throw error;
  }
}

// GPT-4O-mini ile prompt enhance et
async function enhanceLocationPromptWithGPT(originalPrompt) {
  try {
    logger.log("🤖 GPT-4O-mini ile prompt enhancement başlatılıyor...");

    const systemPrompt = `You are an expert AI prompt engineer specializing in photorealistic location photography. Create complete, detailed prompts optimized for image generation without omitting user instructions.

IMPORTANT: Always respond in ENGLISH only, regardless of the input language. If the input is in Turkish, Arabic, or any other language, translate the concept to English and create an English prompt.

Generate a clear, detailed ENGLISH prompt following best practices. Use as much detail as the scene requires.

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
- NO people, humans, figures, characters
- NO busy, cluttered, distracting elements
- NO extreme angles, unusual perspectives
- NO text, logos, branded elements
- NO dim, dark, moody, vintage, aged lighting
- NO technical camera specifications (no f/8, no lens types, no DSLR)

LOCATION TYPE ANALYSIS:
You MUST analyze the location description and determine if it's:
- "outdoor" (açık hava): natural environments, streets, parks, beaches, mountains, etc.
- "indoor" (kapalı mekan): rooms, buildings, restaurants, museums, etc.
- "studio" (stüdyo): professional photography studios, controlled environments

OUTPUT FORMAT (MUST BE IN ENGLISH):
{
  "prompt": "[detailed English prompt with vibrant colors and realistic details, using as much length as needed - NO technical camera specs, focus on visual description - translate any non-English concepts to English]",
  "title": "[short 5-10 word English location title]",
  "locationType": "[outdoor/indoor/studio]"
}

IMPORTANT: You MUST return a valid JSON object with these exact keys: prompt, title, locationType.`;

    const userPrompt = `Create a detailed location photography prompt from: "${originalPrompt}"`;

    // GPT-4O-mini API çağrısı
    const response = await fetch(
      "https://api.replicate.com/v1/models/openai/gpt-4o-mini/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            top_p: 1,
            prompt: userPrompt,
            messages: [],
            image_input: [],
            temperature: 0.7,
            system_prompt: systemPrompt,
            presence_penalty: 0,
            frequency_penalty: 0,
            max_completion_tokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`GPT-4O-mini API error: ${response.status}`);
    }

    const result = await response.json();
    logger.log("📊 GPT-4O-mini full result:", JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("❌ GPT-4O-mini error:", result.error);
      throw new Error(`GPT-4O-mini error: ${result.error}`);
    }

    let gptResponse = "";
    if (result.output) {
      if (Array.isArray(result.output)) {
        // Array ise tüm elemanları birleştir
        gptResponse = result.output.join("").trim();
        logger.log(
          "📋 GPT output is array, joined:",
          result.output.length,
          "pieces"
        );
      } else if (typeof result.output === "string") {
        gptResponse = result.output.trim();
      } else {
        console.error("❌ Unexpected output format:", typeof result.output);
        throw new Error("Unexpected output format in GPT-4O-mini response");
      }
    } else {
      console.error("❌ No output field in GPT response");
      throw new Error("No output field in GPT-4O-mini response");
    }

    logger.log("🎯 GPT-4O-mini raw response:", gptResponse);

    // JSON response'u parse et
    let generatedTitle = null;
    let enhancedPrompt = null;
    let locationType = "unknown";

    try {
      // Önce JSON olarak parse etmeye çalış
      const jsonResponse = JSON.parse(gptResponse);

      if (
        jsonResponse.prompt &&
        jsonResponse.title &&
        jsonResponse.locationType
      ) {
        generatedTitle = jsonResponse.title.trim();
        enhancedPrompt = jsonResponse.prompt.trim();
        locationType = jsonResponse.locationType.trim();

        logger.log("✅ Successfully parsed JSON response");
        logger.log("📝 Parsed title:", generatedTitle);
        logger.log("📝 Parsed prompt length:", enhancedPrompt.length);
        logger.log("📍 Parsed location type:", locationType);
      } else {
        throw new Error("Missing required fields in JSON response");
      }
    } catch (jsonError) {
      logger.log("⚠️ JSON parse failed, trying old format...");

      // Eski TITLE: ve PROMPT: formatını dene
      const titleMatch = gptResponse.match(/TITLE:\s*(.+)/i);
      const promptMatch = gptResponse.match(/PROMPT:\s*(.+)/is); // 's' flag ile multiline

      logger.log("🔍 Title match:", titleMatch);
      logger.log("🔍 Prompt match:", promptMatch);

      if (titleMatch && promptMatch) {
        generatedTitle = titleMatch[1].trim();
        enhancedPrompt = promptMatch[1].trim();
        logger.log("✅ Successfully parsed old format response");
        logger.log("📝 Parsed title:", generatedTitle);
        logger.log("📝 Parsed prompt length:", enhancedPrompt.length);
        logger.log("📍 Using default location type: unknown");
      } else {
        logger.log(
          "⚠️ Could not parse any format, throwing error for fallback"
        );
        throw new Error("Failed to parse GPT response format");
      }
    }

    // Title yoksa default oluştur
    if (!generatedTitle) {
      const words = originalPrompt.split(" ").slice(0, 3);
      generatedTitle = words.join(" ") || "Custom Location";
    }

    // Enhanced prompt yoksa hata fırlat
    if (!enhancedPrompt) {
      throw new Error("No enhanced prompt generated");
    }

    // Title'ı 3 kelime ile sınırla
    const titleWords = generatedTitle.split(" ").slice(0, 3);
    generatedTitle = titleWords.join(" ");

    // Token sayısını kontrol et (prompt için)
    const tokenCount = enhancedPrompt.split(/\s+/).length;
    logger.log(`Generated prompt token count: ${tokenCount}`);

    // Basit uzunluk kontrolü (çok kısa değilse kabul et)
    if (tokenCount < 50) {
      logger.log("⚠️ Generated prompt çok kısa, tekrar denenebilir...");
      logger.log("Token sayısı:", tokenCount);
    }

    logger.log("✅ GPT-4O-mini prompt enhancement tamamlandı");
    logger.log("Generated title:", generatedTitle);
    logger.log(
      "Enhanced prompt preview:",
      enhancedPrompt.substring(0, 100) + "..."
    );
    logger.log("Enhanced prompt length:", enhancedPrompt.length);

    return {
      title: generatedTitle,
      prompt: enhancedPrompt,
      locationType: locationType,
    };
  } catch (error) {
    console.error("❌ GPT-4O-mini enhancement hatası:", error.message);
    console.error("❌ Full error:", error);

    // Fallback yok - hata fırlat
    throw new Error(`GPT-4O-mini prompt generation failed: ${error.message}`);
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
  locationType = "unknown"
) {
  try {
    logger.log("💾 Location Supabase'e kaydediliyor...");
    logger.log("📝 Enhanced prompt değeri:", enhancedPrompt);
    logger.log("📝 Enhanced prompt length:", enhancedPrompt?.length);

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
        logger.log("⚠️ Tablo mevcut değil, geçici data dönülüyor...");
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

    logger.log("✅ Location Supabase'e kaydedildi:", data.id);
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

    logger.log("🔍 skipSaveToDatabase value:", skipSaveToDatabase);
    logger.log("🔍 skipSaveToDatabase type:", typeof skipSaveToDatabase);

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

    logger.log("🔍 User ID sources:");
    logger.log("- Body userId:", userId);
    logger.log("- Header x-user-id:", req.headers["x-user-id"]);
    logger.log("- Query userId:", req.query.userId);
    logger.log("- Final actualUserId:", actualUserId);

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

    logger.log("🚀 Create location işlemi başlatıldı");
    logger.log("Original prompt:", prompt);
    logger.log("Title:", title);
    logger.log("Category:", category);
    logger.log("User ID:", actualUserId);
    logger.log("Is Public:", isPublic);

    // 1. GPT-4O-mini ile prompt ve title oluştur
    const gptResult = await enhanceLocationPromptWithGPT(prompt);
    logger.log("🔍 GPT Result:", {
      title: gptResult.title,
      promptLength: gptResult.prompt?.length,
      promptPreview: gptResult.prompt?.substring(0, 100) + "...",
    });
    const enhancedPrompt = gptResult.prompt;
    const generatedTitle = gptResult.title;

    // 2. Fal.ai Imagen-4 ile görsel generate et
    const imagenResult = await generateLocationWithImagen4(
      enhancedPrompt,
      actualUserId
    );

    // 3. Supabase'e kaydet (zorla)
    logger.log("🔍 DEBUG: Forcing database save...");
    if (true) {
      // Zorla kaydet
      logger.log(
        "🔍 Before call - enhancedPrompt:",
        enhancedPrompt?.substring(0, 100) + "..."
      );
      logger.log(
        "🔍 Before call - enhancedPrompt length:",
        enhancedPrompt?.length
      );
      logger.log("🔍 Before call - generatedTitle:", generatedTitle);
      // Location type'ı belirle: frontend'den geliyorsa onu kullan, yoksa GPT'den geleni
      const finalLocationType =
        locationType || gptResult.locationType || "unknown";

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
        finalLocationType // Frontend'den gelen veya GPT'den gelen location type
      );

      logger.log(
        "✅ Create location işlemi tamamlandı (Fal.ai Imagen-4 ile veritabanına kaydedildi)"
      );

      res.json({
        success: true,
        message: "Location başarıyla oluşturuldu",
        data: {
          id: savedLocation.id,
          title: savedLocation.title,
          generatedTitle: savedLocation.generated_title,
          imageUrl: savedLocation.image_url, // Supabase storage'dan gelen public URL
          category: savedLocation.category,
          isPublic: savedLocation.is_public,
          originalPrompt: savedLocation.original_prompt,
          enhancedPrompt: savedLocation.enhanced_prompt,
          replicateId: savedLocation.replicate_id,
          locationType: savedLocation.location_type, // Yeni eklenen location type
          createdAt: savedLocation.created_at,
          userId: savedLocation.user_id,
        },
      });
    } else {
      // Sadece generate et, veritabanına kaydetme
      logger.log("✅ Create location işlemi tamamlandı (sadece generate)");

      res.json({
        success: true,
        message: "Location başarıyla generate edildi",
        data: {
          title: title.trim(),
          generatedTitle: generatedTitle,
          imageUrl: imagenResult.imageUrl,
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

    logger.log("👤 User locations fetch - userId:", userId);
    logger.log("📝 Category:", category);

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
      .select("*")
      .eq("user_id", userId)
      .eq("category", category)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Supabase user locations fetch hatası:", error);
      throw error;
    }

    logger.log("✅ User locations found:", data?.length || 0);

    res.json({
      success: true,
      data: data || [],
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

// Diziyi karıştıran yardımcı fonksiyon
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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
    } = req.query;

    logger.log("🔀 Public locations fetch - shuffle:", shuffle, "sort:", sort);
    logger.log("📝 Limit:", limit, "Offset:", offset);

    // Sort order'ı belirle
    let orderBy = { column: "created_at", ascending: false }; // Default: newest first

    if (sort === "newest" || sort === "created_at_desc") {
      orderBy = { column: "created_at", ascending: false };
    } else if (sort === "oldest" || sort === "created_at_asc") {
      orderBy = { column: "created_at", ascending: true };
    }

    // Shuffle parametresi true ise tüm veriyi al, shuffle yap, sonra paginate et
    if (shuffle === "true") {
      // Önce tüm public location'ları al (sadece outdoor ve indoor)
      const { data: allData, error } = await supabase
        .from("custom_locations")
        .select("*")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .in("location_type", ["outdoor", "indoor"]) // Sadece outdoor ve indoor
        .order(orderBy.column, { ascending: orderBy.ascending });

      if (error) {
        throw error;
      }

      // Shuffle yap
      const shuffledData = shuffleArray(allData || []);
      logger.log(`🎲 Shuffled ${shuffledData.length} locations`);

      // Pagination uygula
      const startIndex = parseInt(offset);
      const endIndex = startIndex + parseInt(limit);
      const paginatedData = shuffledData.slice(startIndex, endIndex);

      logger.log(
        `📄 Returning ${paginatedData.length} items (${startIndex}-${endIndex})`
      );

      res.json({
        success: true,
        data: paginatedData,
        count: paginatedData.length,
        total: shuffledData.length,
        hasMore: endIndex < shuffledData.length,
      });
    } else {
      // Normal pagination (shuffle olmadan) - sadece outdoor ve indoor
      const { data, error } = await supabase
        .from("custom_locations")
        .select("*")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .in("location_type", ["outdoor", "indoor"]) // Sadece outdoor ve indoor
        .order(orderBy.column, { ascending: orderBy.ascending })
        .range(offset, offset + limit - 1);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data: data || [],
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

    logger.log("🗑️ Location silme işlemi başlatıldı - ID:", locationId);

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
        logger.log(
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

    logger.log("✅ Location başarıyla silindi:", data?.id);

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
    } = req.body;

    logger.log("💾 Save to gallery işlemi başlatıldı");
    logger.log("Generated Title:", generatedTitle);
    logger.log("Original Prompt:", originalPrompt);
    logger.log("User ID from body:", userId);
    logger.log("User ID from headers:", req.headers["x-user-id"]);
    logger.log("All headers:", Object.keys(req.headers));
    logger.log("Raw x-user-id header:", req.headers["x-user-id"]);
    logger.log("Raw user-id header:", req.headers["user-id"]);

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
    logger.log("Header x-user-id value:", req.headers["x-user-id"]);
    logger.log("Header X-User-ID value:", req.headers["X-User-ID"]);
    logger.log("Header user-id value:", req.headers["user-id"]);
    logger.log("Header User-ID value:", req.headers["User-ID"]);
    logger.log("Final actualUserId:", actualUserId);

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
        logger.log("⚠️ Duplicate kayıt bulundu:", existingLocation.id);
        return res.json({
          success: true,
          message: "Location zaten galeri'de mevcut",
          data: existingLocation,
          duplicate: true,
        });
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
      locationType
    );

    logger.log("✅ Location başarıyla galeri'ye eklendi:", savedLocation.id);

    res.json({
      success: true,
      message: "Location başarıyla galeri'ye eklendi",
      data: {
        id: savedLocation.id,
        title: savedLocation.title,
        generatedTitle: savedLocation.generated_title,
        imageUrl: savedLocation.image_url,
        category: savedLocation.category,
        isPublic: savedLocation.is_public,
        originalPrompt: savedLocation.original_prompt,
        enhancedPrompt: savedLocation.enhanced_prompt,
        replicateId: savedLocation.replicate_id,
        locationType: savedLocation.location_type, // Yeni eklenen location type
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
