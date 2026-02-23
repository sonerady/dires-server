const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { optimizeImageUrl } = require("../utils/imageOptimizer");

// Pose kartları dikey olduğu için 400x800 boyutunda optimize et
const optimizePoseImageUrl = (imageUrl) => optimizeImageUrl(imageUrl, { width: 400, height: 800, quality: 80 });

/**
 * Favori ekleme/çıkarma (toggle)
 * POST /api/pose-favorites/toggle
 */
router.post("/toggle", async (req, res) => {
  try {
    const {
      userId,
      poseId,
      poseType = "default",
      poseTitle,
      poseImageUrl,
      poseKey,
    } = req.body;

    console.log("❤️ [POSE FAVORITES] Toggle işlemi:", {
      userId,
      poseId,
      poseType,
    });

    // Validasyon
    if (!userId || !poseId) {
      return res.status(400).json({
        success: false,
        error: "userId ve poseId gerekli",
      });
    }

    if (!["default", "custom"].includes(poseType)) {
      return res.status(400).json({
        success: false,
        error: "poseType 'default' veya 'custom' olmalı",
      });
    }

    // Mevcut favori var mı kontrol et
    const { data: existingFavorite, error: checkError } = await supabase
      .from("pose_favorites")
      .select("*")
      .eq("user_id", userId)
      .eq("pose_id", poseId)
      .eq("pose_type", poseType)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = no rows found, bu normal
      console.error("❌ [POSE FAVORITES] Kontrol hatası:", checkError);
      return res.status(500).json({
        success: false,
        error: "Favori kontrol edilirken hata oluştu",
      });
    }

    let result;
    let action;

    if (existingFavorite) {
      // Favori varsa, çıkar
      const { error: deleteError } = await supabase
        .from("pose_favorites")
        .delete()
        .eq("id", existingFavorite.id);

      if (deleteError) {
        console.error("❌ [POSE FAVORITES] Silme hatası:", deleteError);
        return res.status(500).json({
          success: false,
          error: "Favori çıkarılırken hata oluştu",
        });
      }

      action = "removed";
      result = { isFavorite: false };
      console.log("💔 [POSE FAVORITES] Favorilerden çıkarıldı");
    } else {
      // Favori yoksa, ekle
      const { data: newFavorite, error: insertError } = await supabase
        .from("pose_favorites")
        .insert({
          user_id: userId,
          pose_id: poseId,
          pose_type: poseType,
          pose_title: poseTitle || null,
          pose_image_url: poseImageUrl || null,
          pose_key: poseKey || null,
        })
        .select()
        .single();

      if (insertError) {
        console.error("❌ [POSE FAVORITES] Ekleme hatası:", insertError);
        return res.status(500).json({
          success: false,
          error: "Favori eklenirken hata oluştu",
        });
      }

      action = "added";
      result = { isFavorite: true, favorite: newFavorite };
      console.log("💖 [POSE FAVORITES] Favorilere eklendi");
    }

    res.json({
      success: true,
      action,
      result,
    });
  } catch (error) {
    console.error("❌ [POSE FAVORITES] Genel hata:", error);
    res.status(500).json({
      success: false,
      error: "Favori işlemi sırasında hata oluştu: " + error.message,
    });
  }
});

/**
 * Kullanıcının favori pozlarını listeleme
 * GET /api/pose-favorites/list/:userId
 */
router.get("/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { poseType, limit = 50, page = 1 } = req.query;

    console.log("📋 [POSE FAVORITES] Favori listesi isteniyor:", {
      userId,
      poseType,
      limit,
      page,
    });

    let query = supabase
      .from("pose_favorites")
      .select(
        "pose_id, pose_type, pose_title, pose_image_url, pose_key, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // Pose type filtresi
    if (poseType && ["default", "custom"].includes(poseType)) {
      query = query.eq("pose_type", poseType);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: favorites, error } = await query;

    if (error) {
      console.error("❌ [POSE FAVORITES] Liste hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Favori listesi alınırken hata oluştu",
      });
    }

    // Optimize image URLs
    const optimizedFavorites = favorites.map((fav) => ({
      ...fav,
      pose_image_url: optimizePoseImageUrl(fav.pose_image_url),
    }));

    res.json({
      success: true,
      result: {
        favorites: optimizedFavorites,
        count: optimizedFavorites.length,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ [POSE FAVORITES] Liste genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Favori listesi alınırken hata oluştu: " + error.message,
    });
  }
});

/**
 * Belirli pozların favori durumlarını kontrol etme
 * POST /api/pose-favorites/check
 */
router.post("/check", async (req, res) => {
  try {
    const { userId, poses } = req.body;

    console.log("🔍 [POSE FAVORITES] Favori durumu kontrol ediliyor:", {
      userId,
      posesCount: poses?.length,
    });

    if (!userId || !poses || !Array.isArray(poses)) {
      return res.status(400).json({
        success: false,
        error: "userId ve poses array'i gerekli",
      });
    }

    // Pose ID'lerini ve tiplerini çıkar
    const poseChecks = poses.map((pose) => ({
      pose_id: pose.id,
      pose_type: pose.type || "default",
    }));

    if (poseChecks.length === 0) {
      return res.json({
        success: true,
        result: {},
      });
    }

    // Favori durumlarını kontrol et
    const { data: favorites, error } = await supabase
      .from("pose_favorites")
      .select("pose_id, pose_type")
      .eq("user_id", userId)
      .in(
        "pose_id",
        poseChecks.map((p) => p.pose_id)
      );

    if (error) {
      console.error("❌ [POSE FAVORITES] Kontrol hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Favori durumu kontrol edilirken hata oluştu",
      });
    }

    // Sonucu formatla
    const favoriteMap = {};
    favorites.forEach((fav) => {
      const key = `${fav.pose_id}_${fav.pose_type}`;
      favoriteMap[key] = true;
    });

    res.json({
      success: true,
      result: favoriteMap,
    });
  } catch (error) {
    console.error("❌ [POSE FAVORITES] Kontrol genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Favori kontrol edilirken hata oluştu: " + error.message,
    });
  }
});

/**
 * Kullanıcının favori istatistikleri
 * GET /api/pose-favorites/stats/:userId
 */
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: stats, error } = await supabase
      .from("pose_favorites")
      .select("pose_type")
      .eq("user_id", userId);

    if (error) {
      console.error("❌ [POSE FAVORITES] İstatistik hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Favori istatistikleri alınırken hata oluştu",
      });
    }

    const defaultCount = stats.filter((s) => s.pose_type === "default").length;
    const customCount = stats.filter((s) => s.pose_type === "custom").length;

    res.json({
      success: true,
      result: {
        total: stats.length,
        default: defaultCount,
        custom: customCount,
      },
    });
  } catch (error) {
    console.error("❌ [POSE FAVORITES] İstatistik genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Favori istatistikleri alınırken hata oluştu: " + error.message,
    });
  }
});

module.exports = router;
