const express = require("express");
const { supabase } = require("../supabaseClient");
const logger = require("../utils/logger");

const router = express.Router();

// Kullanıcının visibility ayarını al
router.get("/user/:id/visibility", async (req, res) => {
  const { id } = req.params;

  try {
    logger.log(
      "👁️ [GET VISIBILITY] Kullanıcı visibility ayarı sorgulanıyor:",
      id
    );

    const { data, error } = await supabase
      .from("users")
      .select("product_visibility")
      .eq("id", id)
      .single();

    if (error) {
      console.error("❌ [GET VISIBILITY] Veritabanı hatası:", error.message);
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    if (!data) {
      console.error("❌ [GET VISIBILITY] Kullanıcı bulunamadı");
      return res.status(404).json({
        success: false,
        message: "Kullanıcı bulunamadı",
      });
    }

    logger.log(
      "✅ [GET VISIBILITY] Visibility ayarı başarıyla alındı:",
      data.product_visibility
    );

    res.status(200).json({
      success: true,
      result: {
        user_id: id,
        product_visibility: data.product_visibility || "public",
      },
    });
  } catch (err) {
    console.error("❌ [GET VISIBILITY] Sunucu hatası:", err.message);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
    });
  }
});

// Kullanıcının visibility ayarını güncelle
router.put("/user/:id/visibility", async (req, res) => {
  const { id } = req.params;
  const { product_visibility } = req.body;

  try {
    logger.log(
      "👁️ [PUT VISIBILITY] Kullanıcı visibility ayarı güncelleniyor:",
      {
        userId: id,
        newVisibility: product_visibility,
      }
    );

    // Validation - sadece 'public' ve 'private' değerleri kabul et
    if (
      !product_visibility ||
      !["public", "private"].includes(product_visibility)
    ) {
      console.error(
        "❌ [PUT VISIBILITY] Geçersiz visibility değeri:",
        product_visibility
      );
      return res.status(400).json({
        success: false,
        message: "product_visibility 'public' veya 'private' olmalıdır",
      });
    }

    // Kullanıcının var olup olmadığını kontrol et
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("id", id)
      .single();

    if (checkError || !existingUser) {
      console.error("❌ [PUT VISIBILITY] Kullanıcı bulunamadı:", id);
      return res.status(404).json({
        success: false,
        message: "Kullanıcı bulunamadı",
      });
    }

    // Visibility ayarını güncelle
    const { data, error } = await supabase
      .from("users")
      .update({ product_visibility })
      .eq("id", id)
      .select("id, product_visibility");

    if (error) {
      console.error(
        "❌ [PUT VISIBILITY] Veritabanı güncelleme hatası:",
        error.message
      );
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    logger.log("✅ [PUT VISIBILITY] Visibility ayarı başarıyla güncellendi:", {
      userId: id,
      newVisibility: product_visibility,
      updatedData: data,
    });

    res.status(200).json({
      success: true,
      result: {
        user_id: id,
        product_visibility: product_visibility,
        message: "Visibility ayarı başarıyla güncellendi",
      },
    });
  } catch (err) {
    console.error("❌ [PUT VISIBILITY] Sunucu hatası:", err.message);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
    });
  }
});

// Kullanıcının tüm ayarlarını al (visibility dahil)
router.get("/user/:id/settings", async (req, res) => {
  const { id } = req.params;

  try {
    logger.log("⚙️ [GET SETTINGS] Kullanıcı ayarları sorgulanıyor:", id);

    const { data, error } = await supabase
      .from("users")
      .select("id, product_visibility, is_pro, credit_balance")
      .eq("id", id)
      .single();

    if (error) {
      console.error("❌ [GET SETTINGS] Veritabanı hatası:", error.message);
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    if (!data) {
      console.error("❌ [GET SETTINGS] Kullanıcı bulunamadı");
      return res.status(404).json({
        success: false,
        message: "Kullanıcı bulunamadı",
      });
    }

    logger.log("✅ [GET SETTINGS] Kullanıcı ayarları başarıyla alındı");

    res.status(200).json({
      success: true,
      result: {
        user_id: data.id,
        product_visibility: data.product_visibility || "public",
        is_pro: data.is_pro || false,
        credit_balance: data.credit_balance || 0,
      },
    });
  } catch (err) {
    console.error("❌ [GET SETTINGS] Sunucu hatası:", err.message);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
    });
  }
});

module.exports = router;
