const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı import ediyoruz

const router = express.Router();

// Kullanıcı bilgilerini almak için route
router.get("/user/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .limit(1);

    if (error) {
      console.error("Veritabanı hatası:", error.message);
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      console.error("Kullanıcı bulunamadı.");
      return res.status(404).json({ message: "Kullanıcı bulunamadı" });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Kullanıcı bilgisi alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Kullanıcı bakiyesini almak için route
router.get("/users/:id/balance", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Bakiye sorgulama hatası:", error.message);
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Bakiye bilgisi alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Kullanıcı bakiyesini güncellemek için route
router.put("/users/:id/balance", async (req, res) => {
  const { id } = req.params;
  const { credit_balance } = req.body;

  try {
    const { data, error } = await supabase
      .from("users")
      .update({ credit_balance })
      .eq("id", id)
      .select();

    if (error) {
      console.error("Bakiye güncelleme hatası:", error.message);
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Bakiye güncellenemedi:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Kullanıcının tek seferlik alımlarını almak için route
router.get("/users/:id/one-time-purchases", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("user_purchase")
      .select("coins_added, product_title, purchase_date")
      .eq("user_id", id)
      .eq("package_type", "one_time")
      .ilike("product_title", "%Coin Pack%");

    if (error) {
      console.error("Tek seferlik alım sorgulama hatası:", error.message);
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data || []);
  } catch (err) {
    console.error("Tek seferlik alım bilgisi alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Kullanıcı hesabını silmek için route
router.delete("/users/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Önce userproduct tablosundan kullanıcı verilerini sil
    const { error: deleteUserProductError } = await supabase
      .from("userproduct")
      .delete()
      .eq("user_id", id);

    if (deleteUserProductError) {
      console.error(
        "UserProduct silme hatası:",
        deleteUserProductError.message
      );
      return res.status(400).json({ error: deleteUserProductError.message });
    }

    // Sonra users tablosunda active'i false yap
    const { data, error: updateUserError } = await supabase
      .from("users")
      .update({ active: false })
      .eq("id", id)
      .select();

    if (updateUserError) {
      console.error("Kullanıcı güncelleme hatası:", updateUserError.message);
      return res.status(400).json({ error: updateUserError.message });
    }

    res.status(200).json({ message: "Hesap başarıyla silindi", data });
  } catch (err) {
    console.error("Hesap silinemedi:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// RevenueCat API anahtarı endpoint'i
router.get("/revenuecat-config", (req, res) => {
  try {
    const apiKey = process.env.REVENUECAT_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "RevenueCat API key not configured",
      });
    }

    res.json({
      success: true,
      apiKey: apiKey,
    });
  } catch (error) {
    console.error("RevenueCat config error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get RevenueCat configuration",
    });
  }
});

module.exports = router;
