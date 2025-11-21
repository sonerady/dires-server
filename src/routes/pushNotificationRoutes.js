const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

/**
 * POST /api/push-notifications/save-device-token
 * Device token'ı kaydet/güncelle
 */
router.post("/save-device-token", async (req, res) => {
  try {
    const { userId, expoPushToken, language } = req.body;

    // Validasyon
    if (!userId || !expoPushToken) {
      return res.status(400).json({
        success: false,
        error: "userId ve expoPushToken gerekli",
      });
    }

    // Dil kodunu normalize et (tr-TR -> tr, en-US -> en)
    let normalizedLanguage = "en";
    if (language) {
      normalizedLanguage = language.split("-")[0].toLowerCase();
      // Desteklenen diller listesi
      const supportedLanguages = ["en", "tr", "es", "fr", "de", "it", "ja", "ko", "pt", "ru", "zh"];
      if (!supportedLanguages.includes(normalizedLanguage)) {
        normalizedLanguage = "en";
      }
    }

    console.log(`📱 [PUSH_TOKEN] Device token kaydediliyor: ${userId?.slice(0, 8)} (raw language: ${language || "not provided"}, normalized: ${normalizedLanguage})`);

    // Token'ı users tablosuna kaydet/güncelle
    // Language'i de kaydet (eğer kolon varsa)
    const updateData = {
      push_token: expoPushToken,
      push_token_updated_at: new Date().toISOString(),
    };
    
    // Normalize edilmiş language'i kaydet
    updateData.preferred_language = normalizedLanguage;

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select();

    if (error) {
      console.error("❌ [PUSH_TOKEN] Token kaydetme hatası:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    if (!data || data.length === 0) {
      console.error("❌ [PUSH_TOKEN] Kullanıcı bulunamadı:", userId?.slice(0, 8));
      return res.status(404).json({
        success: false,
        error: "Kullanıcı bulunamadı",
      });
    }

    console.log(`✅ [PUSH_TOKEN] Device token başarıyla kaydedildi: ${userId?.slice(0, 8)}`);
    return res.status(200).json({
      success: true,
      message: "Token başarıyla kaydedildi",
    });
  } catch (error) {
    console.error("❌ [PUSH_TOKEN] Token kaydetme hatası:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/push-notifications/test-notification
 * Test notification gönder (debug için)
 */
router.post("/test-notification", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId gerekli",
      });
    }

    const { sendPushNotification } = require("../services/pushNotificationService");
    
    const result = await sendPushNotification(
      userId,
      "🧪 Test Bildirimi",
      "Bu bir test bildirimidir. Eğer bunu görüyorsanız, push notification sistemi çalışıyor!",
      { type: "test" }
    );

    return res.status(200).json({
      success: result.success,
      message: result.success ? "Test bildirimi gönderildi" : "Test bildirimi gönderilemedi",
      tickets: result.tickets,
      error: result.error,
    });
  } catch (error) {
    console.error("❌ [TEST] Test notification hatası:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

