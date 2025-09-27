const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();

// Supabase client'ını import et
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Thumbnail için resim URL'sini optimize eden fonksiyon
const optimizeImageForThumbnail = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si ise thumbnail boyutu ekle
  if (imageUrl.includes("supabase.co")) {
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      ) + "?width=300&height=300&quality=70"
    );
  }

  return imageUrl;
};

// Modal için resim URL'sini temizleyen fonksiyon - original boyut
const optimizeImageForModal = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si ise parametreleri kaldır (original boyut)
  if (imageUrl.includes("supabase.co")) {
    // Render URL'sini object URL'sine çevir ve parametreleri kaldır
    return imageUrl
      .replace("/storage/v1/render/image/public/", "/storage/v1/object/public/")
      .split("?")[0]; // Tüm query parametrelerini kaldır
  }

  return imageUrl;
};

// History objelerinin resim URL'lerini optimize eden fonksiyon
const optimizeHistoryImages = (historyItems) => {
  if (!Array.isArray(historyItems)) return historyItems;

  return historyItems.map((item) => {
    const optimizedItem = { ...item };

    // Result image'ları thumbnail olarak optimize et
    if (optimizedItem.result_image_url) {
      optimizedItem.result_image_url_thumbnail = optimizeImageForThumbnail(
        optimizedItem.result_image_url
      );
      optimizedItem.result_image_url_original = optimizeImageForModal(
        optimizedItem.result_image_url
      );
    }

    // Reference images'ları optimize et
    if (optimizedItem.reference_images) {
      try {
        let referenceImages = Array.isArray(optimizedItem.reference_images)
          ? optimizedItem.reference_images
          : JSON.parse(optimizedItem.reference_images || "[]");

        optimizedItem.reference_images_thumbnail = referenceImages.map(
          optimizeImageForThumbnail
        );
        optimizedItem.reference_images_original = referenceImages.map(
          optimizeImageForModal
        );

        // Frontend için orijinal reference_images'ı da array olarak gönder
        optimizedItem.reference_images = referenceImages;
      } catch (e) {
        console.warn("Reference images parse error:", e);
        // Hata durumunda boş array gönder
        optimizedItem.reference_images = [];
        optimizedItem.reference_images_thumbnail = [];
        optimizedItem.reference_images_original = [];
      }
    }

    // Location image'ı optimize et
    if (optimizedItem.location_image) {
      optimizedItem.location_image_thumbnail = optimizeImageForThumbnail(
        optimizedItem.location_image
      );
      optimizedItem.location_image_original = optimizeImageForModal(
        optimizedItem.location_image
      );
    }

    return optimizedItem;
  });
};

/**
 * GET /api/history/user/:userId
 * Kullanıcının history verilerini getir (pagination ile)
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10, page = 1 } = req.query;

    // Input validation
    if (!userId || userId === "anonymous_user") {
      return res.status(400).json({
        success: false,
        message: "Valid user ID required",
      });
    }

    const parsedLimit = Math.min(parseInt(limit) || 10, 50); // Max 50 item
    const parsedPage = Math.max(parseInt(page) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;

    console.log(`📊 [HISTORY] Fetching history for user: ${userId}`);
    console.log(
      `📊 [HISTORY] Pagination: page=${parsedPage}, limit=${parsedLimit}, offset=${offset}`
    );

    // Toplam sayıyı al
    const { count: totalCount, error: countError } = await supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["completed", "failed"]);

    if (countError) {
      console.error("❌ [HISTORY] Count query error:", countError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch total count",
      });
    }

    // History verilerini getir
    const { data: historyData, error: historyError } = await supabase
      .from("reference_results")
      .select(
        `
        id,
        user_id,
        generation_id,
        status,
        result_image_url,
        reference_images,
        location_image,
        aspect_ratio,
        created_at,
        credits_before_generation,
        credits_deducted,
        credits_after_generation
      `
      )
      .eq("user_id", userId)
      .in("status", ["completed", "failed"])
      .order("created_at", { ascending: false })
      .range(offset, offset + parsedLimit - 1);

    if (historyError) {
      console.error("❌ [HISTORY] Query error:", historyError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch history data",
      });
    }

    const hasMore = offset + parsedLimit < (totalCount || 0);

    console.log(`📊 [HISTORY] Retrieved ${historyData?.length || 0} items`);
    console.log(`📊 [HISTORY] Total count: ${totalCount}`);
    console.log(`📊 [HISTORY] Has more: ${hasMore}`);

    return res.json({
      success: true,
      data: optimizeHistoryImages(historyData || []),
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        totalCount: totalCount || 0,
        hasMore: hasMore,
        totalPages: Math.ceil((totalCount || 0) / parsedLimit),
      },
    });
  } catch (error) {
    console.error("❌ [HISTORY] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/stats/:userId
 * Kullanıcının history istatistiklerini getir
 */
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || userId === "anonymous_user") {
      return res.status(400).json({
        success: false,
        message: "Valid user ID required",
      });
    }

    // İstatistikleri getir
    const { data: statsData, error: statsError } = await supabase
      .from("reference_results")
      .select("status, credits_deducted")
      .eq("user_id", userId);

    if (statsError) {
      console.error("❌ [HISTORY_STATS] Query error:", statsError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch stats",
      });
    }

    const stats = {
      total: statsData.length,
      completed: statsData.filter((item) => item.status === "completed").length,
      failed: statsData.filter((item) => item.status === "failed").length,
      totalCreditsSpent: statsData
        .filter((item) => item.credits_deducted)
        .reduce((sum, item) => sum + (item.credits_deducted || 0), 0),
    };

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ [HISTORY_STATS] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
