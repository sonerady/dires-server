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

// Flux 1.1 Pro Ultra ile location image generate et
async function generateLocationWithFlux11ProUltra(prompt, userId) {
  try {
    console.log(
      "📸 Flux 1.1 Pro Ultra ile location generation başlatılıyor..."
    );
    console.log("Prompt:", prompt);

    const response = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro-ultra/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            raw: false,
            prompt: prompt,
            aspect_ratio: "1:1",
            output_format: "jpg",
            safety_tolerance: 2,
            image_prompt_strength: 0.1,
            seed: Math.floor(Math.random() * 1000000),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Flux 1.1 Pro Ultra API Error:", errorText);
      throw new Error(`Flux 1.1 Pro Ultra API Error: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Flux 1.1 Pro Ultra generation tamamlandı");
    console.log("Flux result:", result);

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
      throw new Error("Flux 1.1 Pro Ultra'dan görsel çıkışı alınamadı");
    }
  } catch (error) {
    console.error("Flux 1.1 Pro Ultra generation hatası:", error);
    throw error;
  }
}

// Gemini ile prompt enhance et
async function enhanceLocationPromptWithGemini(originalPrompt) {
  try {
    console.log("🤖 Gemini ile prompt enhancement başlatılıyor...");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const enhancementPrompt = `Create beautiful location background prompt (max 77 tokens) from: "${originalPrompt}". 

CRITICAL REQUIREMENTS - EMPTY LOCATION:
- Ground level viewpoint of an empty space
- Create a walkable surface/platform/area
- Background should be ground level perspective, not aerial or bird's eye view
- Empty environment with NO people, NO humans, NO characters

LOCATION SPECIFICATIONS:
- Natural daylight, soft even lighting, bright contemporary atmosphere
- VIBRANT and LIVELY colors, rich textures, dynamic architectural details
- HIGH ENERGY atmosphere, colorful and alive environment
- Ground-level perspective of empty spaces

EXAMPLES OF CORRECT APPROACH:
- Paris: Empty street level cobblestone plaza with Eiffel Tower visible in background
- Beach: Empty sandy shore with ocean horizon behind, not aerial ocean view
- City: Empty sidewalk/plaza level with buildings as backdrop, not rooftop perspective
- Garden: Empty garden path level with flowers/trees around, not top-down view

LIGHTING: natural daylight, soft lighting, bright natural light, even lighting
ATMOSPHERE: vibrant, lively, energetic, colorful, dynamic, alive
AVOID: golden hour, sunset, dramatic lighting, aerial/bird's eye views, dull/muted colors, people, humans, characters, persons

Create a 3-word English title.

OUTPUT FORMAT:
TITLE: [3-word title]
PROMPT: [enhanced prompt]`;

    const result = await model.generateContent(enhancementPrompt);
    let geminiResponse = result.response.text().trim();

    console.log("🎯 Gemini raw response:", geminiResponse);

    // Title ve prompt'u parse et
    let generatedTitle = null;
    let enhancedPrompt = geminiResponse;

    // TITLE: ve PROMPT: formatını parse et
    const titleMatch = geminiResponse.match(/TITLE:\s*(.+)/i);
    const promptMatch = geminiResponse.match(/PROMPT:\s*(.+)/i);

    if (titleMatch && promptMatch) {
      generatedTitle = titleMatch[1].trim();
      enhancedPrompt = promptMatch[1].trim();
    } else {
      // Fallback: Eğer format parse edilemezse, ilk satırı title olarak al
      const lines = geminiResponse.split("\n").filter((line) => line.trim());
      if (lines.length >= 2) {
        generatedTitle = lines[0].replace(/TITLE:\s*/i, "").trim();
        enhancedPrompt = lines
          .slice(1)
          .join(" ")
          .replace(/PROMPT:\s*/i, "")
          .trim();
      }
    }

    // Title yoksa default oluştur
    if (!generatedTitle) {
      const words = originalPrompt.split(" ").slice(0, 3);
      generatedTitle = words.join(" ") || "Custom Location";
    }

    // Title'ı 3 kelime ile sınırla
    const titleWords = generatedTitle.split(" ").slice(0, 3);
    generatedTitle = titleWords.join(" ");

    // Token sayısını kontrol et (prompt için)
    const tokenCount = enhancedPrompt.split(/\s+/).length;
    console.log(`Generated prompt token count: ${tokenCount}`);

    // Eğer 77 token'dan fazlaysa kısalt
    if (tokenCount > 77) {
      const words = enhancedPrompt.split(/\s+/);
      enhancedPrompt = words.slice(0, 77).join(" ");
      console.log(`Prompt kısaltıldı: ${enhancedPrompt}`);
    }

    console.log("✅ Gemini prompt enhancement tamamlandı");
    console.log("Generated title:", generatedTitle);
    console.log("Enhanced prompt:", enhancedPrompt);

    return {
      title: generatedTitle,
      prompt: enhancedPrompt,
    };
  } catch (error) {
    console.error("Gemini enhancement hatası:", error);
    // Fallback: empty location odaklı İngilizce prompt ve title
    const fallbackTitle =
      originalPrompt.split(" ").slice(0, 3).join(" ") || "Custom Location";
    const fallbackPrompt = `Beautiful empty location background of ${originalPrompt}, ground level perspective, walkable surface, natural daylight, VIBRANT and LIVELY colors, energetic contemporary atmosphere, colorful dynamic environment, NO people, NO humans, NO characters, empty space`;
    return {
      title: fallbackTitle,
      prompt: fallbackPrompt,
    };
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
  storagePath = null
) {
  try {
    console.log("💾 Location Supabase'e kaydediliyor...");

    const { data, error } = await supabase
      .from("custom_locations")
      .insert({
        title: title,
        generated_title: generatedTitle,
        original_prompt: originalPrompt,
        enhanced_prompt: enhancedPrompt,
        image_url: imageUrl,
        storage_path: storagePath, // Storage path'i de kaydet
        replicate_id: replicateId,
        category: category,
        user_id: userId,
        is_public: isPublic,
        status: "completed",
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
    } = req.body;

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
    const geminiResult = await enhanceLocationPromptWithGemini(prompt);
    const enhancedPrompt = geminiResult.prompt;
    const generatedTitle = geminiResult.title;

    // 2. Flux 1.1 Pro Ultra ile görsel generate et
    const fluxResult = await generateLocationWithFlux11ProUltra(
      enhancedPrompt,
      actualUserId
    );

    // 3. Supabase'e kaydet
    const savedLocation = await saveLocationToDatabase(
      title.trim(), // Original user input title
      prompt.trim(),
      enhancedPrompt,
      fluxResult.imageUrl,
      fluxResult.replicateId,
      category,
      actualUserId,
      isPublic,
      generatedTitle, // Gemini'den gelen title ayrı column'da
      fluxResult.storagePath // Storage path'i de geç
    );

    console.log("✅ Create location işlemi tamamlandı");

    res.json({
      success: true,
      message: "Location başarıyla oluşturuldu",
      data: {
        id: savedLocation.id,
        title: savedLocation.title,
        imageUrl: savedLocation.image_url,
        storagePath: savedLocation.storage_path, // Storage path'i de döndür
        category: savedLocation.category,
        isPublic: savedLocation.is_public,
        originalPrompt: savedLocation.original_prompt,
        enhancedPrompt: savedLocation.enhanced_prompt,
        replicateId: savedLocation.replicate_id,
        createdAt: savedLocation.created_at,
      },
    });
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

    console.log("✅ User locations found:", data?.length || 0);

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
      shuffle = "true",
    } = req.query;

    console.log("🔀 Public locations fetch - shuffle:", shuffle);
    console.log("📝 Limit:", limit, "Offset:", offset);

    // Shuffle parametresi true ise tüm veriyi al, shuffle yap, sonra paginate et
    if (shuffle === "true") {
      // Önce tüm public location'ları al
      const { data: allData, error } = await supabase
        .from("custom_locations")
        .select("*")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      // Shuffle yap
      const shuffledData = shuffleArray(allData || []);
      console.log(`🎲 Shuffled ${shuffledData.length} locations`);

      // Pagination uygula
      const startIndex = parseInt(offset);
      const endIndex = startIndex + parseInt(limit);
      const paginatedData = shuffledData.slice(startIndex, endIndex);

      console.log(
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
      // Normal pagination (shuffle olmadan)
      const { data, error } = await supabase
        .from("custom_locations")
        .select("*")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
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

module.exports = router;
