const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

/**
 * GET /api/push-notifications/ping
 * Health check
 */
router.get("/ping", (req, res) => {
  res.json({ success: true, message: "Pong!" });
});

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



/**
 * POST /api/push-notifications/send-to-user
 * Belirli bir kullanıcıya bildirim gönder
 */
router.post("/send-to-user", async (req, res) => {
  try {
    const { userId, title, body, data, onlyNonPro } = req.body;

    console.log("🔍 [MANUAL_PUSH] Request received:", { userId, onlyNonPro, type: typeof onlyNonPro });

    if (!userId || !title || !body) {
      return res.status(400).json({
        success: false,
        error: "userId, title ve body gerekli",
      });
    }

    // Eğer sadece pro olmayanlara gönderilecekse kontrol et
    if (onlyNonPro) {
      const { data: user, error } = await supabase
        .from("users")
        .select("is_pro")
        .eq("id", userId)
        .single();

      console.log("🔍 [MANUAL_PUSH] User check result:", { user, error });

      if (error) {
        console.error("❌ [MANUAL_PUSH] User sorgu hatası:", error);
        return res.status(500).json({ success: false, error: "Kullanıcı kontrol edilemedi" });
      }

      if (user && user.is_pro === true) {
        console.log(`⚠️ [MANUAL_PUSH] Kullanıcı PRO olduğu için gönderilmedi: ${userId}`);
        return res.status(400).json({
          success: false,
          error: "Kullanıcı PRO üye, bildirim gönderilmedi (Only Non-Pro seçili)",
        });
      }
    }

    const { sendPushNotification } = require("../services/pushNotificationService");

    const result = await sendPushNotification(
      userId,
      title,
      body,
      data || { type: "manual_notification" }
    );

    return res.status(200).json({
      success: result.success,
      message: result.success ? "Bildirim başarıyla gönderildi" : "Bildirim gönderilemedi",
      tickets: result.tickets,
      error: result.error,
    });
  } catch (error) {
    console.error("❌ [MANUAL_PUSH] Gönderim hatası:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/push-notifications/send-broadcast
 * Tüm kullanıcılara bildirim gönder (Broadcast)
 */
router.post("/send-broadcast", async (req, res) => {
  try {
    const { title, body, data } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: "title ve body gerekli",
      });
    }

    const { Expo } = require("expo-server-sdk");
    const expo = new Expo();

    // Tüm kullanıcıların push token'larını al
    // Not: Çok fazla kullanıcı varsa bu sorgu sayfalama (pagination) ile yapılmalı
    const { data: users, error } = await supabase
      .from("users")
      .select("push_token")
      .not("push_token", "is", null);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, error: "Hiçbir kayıtlı token bulunamadı" });
    }

    console.log(`📢 [BROADCAST] ${users.length} kullanıcıya bildirim gönderiliyor...`);

    const messages = [];
    for (const user of users) {
      if (Expo.isExpoPushToken(user.push_token)) {
        messages.push({
          to: user.push_token,
          sound: "default",
          title: title,
          body: body,
          data: data || { type: "broadcast_notification" },
        });
      }
    }

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("❌ [BROADCAST] Chunk hatası:", error);
      }
    }

    return res.status(200).json({
      success: true,
      message: `${messages.length} kullanıcıya bildirim gönderildi`,
      totalTargeted: users.length,
      sentCount: messages.length,
    });

  } catch (error) {
    console.error("❌ [BROADCAST] Genel hata:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/push-notifications/target-users
 * Bildirim gönderilebilecek hedef kullanıcıları getir (Pro olmayanlar)
 */
/**
 * GET /api/push-notifications/target-users
 * Bildirim gönderilebilecek hedef kullanıcıları getir (Pro olmayanlar)
 */
router.get("/target-users", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Önce toplam sayıyı al
    const { count, error: countError } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .not("push_token", "is", null)
      .or("is_pro.eq.false,is_pro.is.null");

    if (countError) {
      console.error("❌ [TARGET_USERS] Sayı alma hatası:", countError);
    }

    // Pro olmayan ve push token'ı olan kullanıcıları getir
    // is_pro false veya null olanları al
    const { data, error } = await supabase
      .from("users")
      .select("id, created_at, is_pro, push_token")
      .not("push_token", "is", null)
      .or("is_pro.eq.false,is_pro.is.null")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("❌ [TARGET_USERS] Sorgu hatası:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({
      success: true,
      users: data,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error("❌ [TARGET_USERS] Genel hata:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
