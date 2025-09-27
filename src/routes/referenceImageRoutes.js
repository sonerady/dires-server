const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Supabase istemci oluştur - referenceBrowserRoutes ile aynı yapı
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

console.log(
  "🔑 [REF_IMAGES] Supabase Key Type:",
  process.env.SUPABASE_SERVICE_KEY ? "SERVICE_KEY" : "ANON_KEY"
);
console.log(
  "🔑 [REF_IMAGES] Key starts with:",
  supabaseKey?.substring(0, 20) + "..."
);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Belirli bir generation'ın reference_images'larını getiren endpoint
router.get("/generation/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { userId } = req.query;

    console.log(`🔍 [REF_IMAGES_ROUTE] Route çağrıldı:`, {
      generationId: generationId?.slice(0, 8) + "...",
      userId: userId?.slice(0, 8) + "...",
      method: req.method,
      path: req.path,
      fullUrl: req.originalUrl,
    });

    // Validation
    if (!generationId) {
      console.error("❌ [REF_IMAGES_ROUTE] Generation ID eksik");
      return res.status(400).json({
        success: false,
        message: "Generation ID gereklidir",
      });
    }

    if (!userId) {
      console.error("❌ [REF_IMAGES_ROUTE] User ID eksik");
      return res.status(400).json({
        success: false,
        message: "User ID gereklidir",
      });
    }

    // UUID format kontrolü
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(generationId)) {
      console.error(
        "❌ [REF_IMAGES_ROUTE] Generation ID UUID formatında değil:",
        generationId
      );
      return res.status(400).json({
        success: false,
        message: "Generation ID geçerli UUID formatında olmalıdır",
        providedId: generationId,
      });
    }

    if (!uuidRegex.test(userId)) {
      console.error(
        "❌ [REF_IMAGES_ROUTE] User ID UUID formatında değil:",
        userId
      );
      return res.status(400).json({
        success: false,
        message: "User ID geçerli UUID formatında olmalıdır",
        providedId: userId,
      });
    }

    console.log(
      `🔍 [REF_IMAGES_ROUTE] Generation ${generationId.slice(
        0,
        8
      )}... için reference images sorgulanıyor...`
    );

    // Generation'ı sorgula
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select(
        "id, generation_id, reference_images, settings, original_prompt, created_at, status, result_image_url"
      )
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      console.error("❌ [REF_IMAGES_ROUTE] Supabase query hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Generation sorgulanırken hata oluştu",
        error: error.message,
      });
    }

    console.log(`🔍 [REF_IMAGES_ROUTE] Supabase query sonucu:`, {
      found: generationArray?.length || 0,
      generationId:
        generationArray?.[0]?.generation_id?.slice(0, 8) + "..." || "N/A",
    });

    // Generation bulunamadı
    if (!generationArray || generationArray.length === 0) {
      console.log(
        `❌ [REF_IMAGES_ROUTE] Generation ${generationId.slice(
          0,
          8
        )}... bulunamadı`
      );
      return res.status(404).json({
        success: false,
        message: "Generation bulunamadı",
        generationId: generationId,
      });
    }

    const generation = generationArray[0];
    console.log(`✅ [REF_IMAGES_ROUTE] Generation bulundu:`, {
      id: generation.id,
      generationId: generation.generation_id?.slice(0, 8) + "...",
      status: generation.status,
      hasReferenceImages: !!generation.reference_images,
      referenceImagesType: typeof generation.reference_images,
      isArray: Array.isArray(generation.reference_images),
      arrayLength: Array.isArray(generation.reference_images)
        ? generation.reference_images.length
        : 0,
    });

    const referenceImages = generation.reference_images || [];

    // Reference images'ları işle
    let processedReferenceImages = [];

    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
      console.log(
        `📸 [REF_IMAGES_ROUTE] ${referenceImages.length} reference image işleniyor...`
      );

      processedReferenceImages = referenceImages.map((imageUrl, index) => {
        const imageType = index === 0 ? "model" : "product";

        console.log(`🖼️ [REF_IMAGES_ROUTE] Image ${index + 1}:`, {
          url: imageUrl?.substring(0, 50) + "...",
          type: imageType,
          isValidUrl:
            typeof imageUrl === "string" && imageUrl.startsWith("http"),
        });

        return {
          uri: imageUrl,
          width: 1024,
          height: 1024,
          type: imageType,
          index: index,
        };
      });
    } else {
      console.log(`ℹ️ [REF_IMAGES_ROUTE] Reference images boş veya geçersiz:`, {
        type: typeof referenceImages,
        isArray: Array.isArray(referenceImages),
        length: referenceImages?.length || 0,
        value: referenceImages,
      });
    }

    const responseData = {
      generationId: generationId,
      referenceImages: processedReferenceImages,
      originalPrompt: generation.original_prompt,
      settings: generation.settings,
      createdAt: generation.created_at,
      status: generation.status,
      resultImageUrl: generation.result_image_url,
      hasReferenceImages: processedReferenceImages.length > 0,
      totalReferenceImages: processedReferenceImages.length,
      modelImages: processedReferenceImages.filter(
        (img) => img.type === "model"
      ),
      productImages: processedReferenceImages.filter(
        (img) => img.type === "product"
      ),
    };

    console.log(`🚀 [REF_IMAGES_ROUTE] Response hazırlandı:`, {
      generationId: generationId.slice(0, 8) + "...",
      hasReferenceImages: responseData.hasReferenceImages,
      totalReferenceImages: responseData.totalReferenceImages,
      modelImagesCount: responseData.modelImages.length,
      productImagesCount: responseData.productImages.length,
      status: responseData.status,
    });

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("❌ [REF_IMAGES_ROUTE] Endpoint genel hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Reference images sorgulanırken hata oluştu",
      error: error.message,
      generationId: req.params.generationId,
    });
  }
});

// Test endpoint - route'un çalışıp çalışmadığını kontrol etmek için
router.get("/test", async (req, res) => {
  console.log("🧪 [REF_IMAGES_ROUTE] Test endpoint çağrıldı");
  return res.status(200).json({
    success: true,
    message: "Reference Images Route çalışıyor!",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
