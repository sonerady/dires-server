const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabase = require("../supabaseClient");

// Gemini API setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
async function generateLocationWithImagen4Fast(prompt, userId) {
  try {
    console.log(
      "📸 Google Imagen-4-fast ile location generation başlatılıyor..."
    );
    console.log("Prompt:", prompt);

    const response = await fetch(
      "https://api.replicate.com/v1/models/google/imagen-4-ultra/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            prompt: `${prompt} The image should have vibrant colors, high contrast, excellent lighting, and sharp visual quality. No people, no humans, no figures, no mannequins, no characters, empty location, vacant space.`,
            aspect_ratio: "1:1",
            output_format: "jpg",
            safety_filter_level: "block_only_high",
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Imagen-4-fast API Error:", errorText);
      throw new Error(`Google Imagen-4-fast API Error: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Google Imagen-4-fast generation tamamlandı");
    console.log("Imagen result:", result);

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
      const storageResult = await uploadImageToSupabaseStorage(
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
      throw new Error("Google Imagen-4-fast'dan görsel çıkışı alınamadı");
    }
  } catch (error) {
    console.error("Google Imagen-4-fast generation hatası:", error);
    throw error;
  }
}

// GPT-4O-mini ile prompt enhance et
async function enhanceLocationPromptWithGPT(originalPrompt) {
  try {
    console.log("🤖 GPT-4O-mini ile prompt enhancement başlatılıyor...");

    const systemPrompt = `You are an expert AI prompt engineer specializing in photorealistic location photography. Create SHORT, SIMPLE prompts optimized for image generation.

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
    console.log("📊 GPT-4O-mini full result:", JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("❌ GPT-4O-mini error:", result.error);
      throw new Error(`GPT-4O-mini error: ${result.error}`);
    }

    let gptResponse = "";
    if (result.output) {
      if (Array.isArray(result.output)) {
        // Array ise tüm elemanları birleştir
        gptResponse = result.output.join("").trim();
        console.log(
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

    console.log("🎯 GPT-4O-mini raw response:", gptResponse);

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

        console.log("✅ Successfully parsed JSON response");
        console.log("📝 Parsed title:", generatedTitle);
        console.log("📝 Parsed prompt length:", enhancedPrompt.length);
        console.log("📍 Parsed location type:", locationType);
      } else {
        throw new Error("Missing required fields in JSON response");
      }
    } catch (jsonError) {
      console.log("⚠️ JSON parse failed, trying old format...");

      // Eski TITLE: ve PROMPT: formatını dene
      const titleMatch = gptResponse.match(/TITLE:\s*(.+)/i);
      const promptMatch = gptResponse.match(/PROMPT:\s*(.+)/is); // 's' flag ile multiline

      console.log("🔍 Title match:", titleMatch);
      console.log("🔍 Prompt match:", promptMatch);

      if (titleMatch && promptMatch) {
        generatedTitle = titleMatch[1].trim();
        enhancedPrompt = promptMatch[1].trim();
        console.log("✅ Successfully parsed old format response");
        console.log("📝 Parsed title:", generatedTitle);
        console.log("📝 Parsed prompt length:", enhancedPrompt.length);
        console.log("📍 Using default location type: unknown");
      } else {
        console.log(
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

    console.log("✅ GPT-4O-mini prompt enhancement tamamlandı");
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

    // 1. GPT-4O-mini ile prompt ve title oluştur
    const gptResult = await enhanceLocationPromptWithGPT(prompt);
    console.log("🔍 GPT Result:", {
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

    // 3. Supabase'e kaydet (zorla)
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
        `🎲 Shuffled ${shuffledData.length} locations with seed: ${
          shuffleSeed || "auto-generated"
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
