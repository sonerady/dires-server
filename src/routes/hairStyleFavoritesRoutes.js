const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

/**
 * Favori ekleme/çıkarma (toggle)
 * POST /api/hair-style-favorites/toggle
 */
router.post("/toggle", async (req, res) => {
  try {
    const {
      userId,
      hairStyleId,
      hairStyleType = "default",
      hairStyleTitle,
      hairStyleImageUrl,
      hairStyleKey,
    } = req.body;

    console.log("❤️ [HAIR STYLE FAVORITES] Toggle işlemi:", {
      userId,
      hairStyleId,
      hairStyleType,
    });

    // Validasyon
    if (!userId || !hairStyleId) {
      return res.status(400).json({
        success: false,
        error: "userId ve hairStyleId gerekli",
      });
    }

    if (!["default", "custom"].includes(hairStyleType)) {
      return res.status(400).json({
        success: false,
        error: "hairStyleType 'default' veya 'custom' olmalı",
      });
    }

    // Mevcut favori var mı kontrol et
    const { data: existingFavorite, error: checkError } = await supabase
      .from("hair_style_favorites")
      .select("*")
      .eq("user_id", userId)
      .eq("hair_style_id", hairStyleId)
      .eq("hair_style_type", hairStyleType)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = no rows found, bu normal
      console.error("❌ [HAIR STYLE FAVORITES] Kontrol hatası:", checkError);
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
        .from("hair_style_favorites")
        .delete()
        .eq("id", existingFavorite.id);

      if (deleteError) {
        console.error("❌ [HAIR STYLE FAVORITES] Silme hatası:", deleteError);
        return res.status(500).json({
          success: false,
          error: "Favori çıkarılırken hata oluştu",
        });
      }

      action = "removed";
      result = { isFavorite: false };
      console.log("💔 [HAIR STYLE FAVORITES] Favorilerden çıkarıldı");
    } else {
      // Favori yoksa, ekle
      const { data: newFavorite, error: insertError } = await supabase
        .from("hair_style_favorites")
        .insert({
          user_id: userId,
          hair_style_id: hairStyleId,
          hair_style_type: hairStyleType,
          hair_style_title: hairStyleTitle || null,
          hair_style_image_url: hairStyleImageUrl || null,
          hair_style_key: hairStyleKey || null,
        })
        .select()
        .single();

      if (insertError) {
        console.error("❌ [HAIR STYLE FAVORITES] Ekleme hatası:", insertError);
        return res.status(500).json({
          success: false,
          error: "Favori eklenirken hata oluştu",
        });
      }

      action = "added";
      result = { isFavorite: true, favorite: newFavorite };
      console.log("💖 [HAIR STYLE FAVORITES] Favorilere eklendi");
    }

    res.json({
      success: true,
      action,
      result,
    });
  } catch (error) {
    console.error("❌ [HAIR STYLE FAVORITES] Genel hata:", error);
    res.status(500).json({
      success: false,
      error: "Favori işlemi sırasında hata oluştu: " + error.message,
    });
  }
});

/**
 * Kullanıcının favori hair styles'larını listeleme
 * GET /api/hair-style-favorites/list/:userId
 */
router.get("/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { hairStyleType, limit = 50, page = 1 } = req.query;

    console.log("📋 [HAIR STYLE FAVORITES] Favori listesi isteniyor:", {
      userId,
      hairStyleType,
      limit,
      page,
    });

    let query = supabase
      .from("hair_style_favorites")
      .select(
        "hair_style_id, hair_style_type, hair_style_title, hair_style_image_url, hair_style_key, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // Hair style type filtresi
    if (hairStyleType && ["default", "custom"].includes(hairStyleType)) {
      query = query.eq("hair_style_type", hairStyleType);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: favorites, error } = await query;

    if (error) {
      console.error("❌ [HAIR STYLE FAVORITES] Liste hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Favori listesi alınırken hata oluştu",
      });
    }

    res.json({
      success: true,
      result: {
        favorites,
        count: favorites.length,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ [HAIR STYLE FAVORITES] Liste genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Favori listesi alınırken hata oluştu: " + error.message,
    });
  }
});

/**
 * Belirli hair styles'ların favori durumlarını kontrol etme
 * POST /api/hair-style-favorites/check
 */
router.post("/check", async (req, res) => {
  try {
    const { userId, hairStyles } = req.body;

    console.log("🔍 [HAIR STYLE FAVORITES] Favori durumu kontrol ediliyor:", {
      userId,
      hairStylesCount: hairStyles?.length,
    });

    if (!userId || !hairStyles || !Array.isArray(hairStyles)) {
      return res.status(400).json({
        success: false,
        error: "userId ve hairStyles array'i gerekli",
      });
    }

    // Hair Style ID'lerini ve tiplerini çıkar
    const hairStyleChecks = hairStyles.map((hairStyle) => ({
      hair_style_id: hairStyle.id,
      hair_style_type: hairStyle.type || "default",
    }));

    if (hairStyleChecks.length === 0) {
      return res.json({
        success: true,
        result: {},
      });
    }

    // Favori durumlarını kontrol et
    const { data: favorites, error } = await supabase
      .from("hair_style_favorites")
      .select("hair_style_id, hair_style_type")
      .eq("user_id", userId)
      .in(
        "hair_style_id",
        hairStyleChecks.map((p) => p.hair_style_id)
      );

    if (error) {
      console.error("❌ [HAIR STYLE FAVORITES] Kontrol hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Favori durumu kontrol edilirken hata oluştu",
      });
    }

    // Sonucu formatla
    const favoriteMap = {};
    favorites.forEach((fav) => {
      const key = `${fav.hair_style_id}_${fav.hair_style_type}`;
      favoriteMap[key] = true;
    });

    res.json({
      success: true,
      result: favoriteMap,
    });
  } catch (error) {
    console.error("❌ [HAIR STYLE FAVORITES] Kontrol genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Favori kontrol edilirken hata oluştu: " + error.message,
    });
  }
});

/**
 * Kullanıcının favori istatistikleri
 * GET /api/hair-style-favorites/stats/:userId
 */
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: stats, error } = await supabase
      .from("hair_style_favorites")
      .select("hair_style_type")
      .eq("user_id", userId);

    if (error) {
      console.error("❌ [HAIR STYLE FAVORITES] İstatistik hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Favori istatistikleri alınırken hata oluştu",
      });
    }

    const defaultCount = stats.filter(
      (s) => s.hair_style_type === "default"
    ).length;
    const customCount = stats.filter(
      (s) => s.hair_style_type === "custom"
    ).length;

    res.json({
      success: true,
      result: {
        total: stats.length,
        default: defaultCount,
        custom: customCount,
      },
    });
  } catch (error) {
    console.error("❌ [HAIR STYLE FAVORITES] İstatistik genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Favori istatistikleri alınırken hata oluştu: " + error.message,
    });
  }
});

module.exports = router;
