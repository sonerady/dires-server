const express = require("express");
const { supabase } = require("../supabaseClient"); // Supabase client'ı import ediyoruz
const router = express.Router();

// Bildirimleri listeleme (kullanıcıya göre) - Özel bildirimler
router.get("/notifications/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Bildirimler alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Genel bildirimleri listeleme (Dile göre normalize edilmiş ve kullanıcı bazlı okundu bilgisiyle)
router.get("/public-notifications", async (req, res) => {
  const { lang, userId } = req.query;
  const targetLang = lang || 'en';

  try {
    // Tüm aktif genel bildirimleri al
    const { data: notifications, error: notifError } = await supabase
      .from("public_notifications")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (notifError) return res.status(400).json({ error: notifError.message });

    let readNotifIds = [];
    if (userId) {
      // Kullanıcının okuduğu bildirimlerin ID'lerini al
      const { data: readData, error: readError } = await supabase
        .from("user_read_public_notifications")
        .select("notification_id")
        .eq("user_id", userId);

      if (!readError && readData) {
        readNotifIds = readData.map(r => r.notification_id);
      }
    }

    // JSON verilerini seçilen dile göre normalize et ve okundu durumunu ekle
    const localizedData = notifications.map(notif => ({
      id: notif.id,
      title: notif.title_json[targetLang] || notif.title_json['en'] || "Notification",
      desc: notif.desc_json[targetLang] || notif.desc_json['en'] || "",
      detail: notif.detail_json ? (notif.detail_json[targetLang] || notif.detail_json['en'] || "") : "",
      icon_type: notif.icon_type,
      created_at: notif.created_at,
      is_read: userId ? readNotifIds.includes(notif.id) : false
    }));

    res.status(200).json(localizedData);
  } catch (err) {
    console.error("Genel bildirimler alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Bildirimleri okundu olarak işaretle
router.post("/mark-public-read", async (req, res) => {
  const { userId, notificationIds } = req.body;

  if (!userId || !notificationIds || !Array.isArray(notificationIds)) {
    return res.status(400).json({ error: "userId ve notificationIds array gereklidir." });
  }

  try {
    const inserts = notificationIds.map(id => ({
      user_id: userId,
      notification_id: id
    }));

    // Boş array ise çık
    if (inserts.length === 0) return res.status(200).json({ success: true });

    // upsert kullanarak mükerrer kayıtları engelle (Primary key: user_id, notification_id)
    const { error } = await supabase
      .from("user_read_public_notifications")
      .upsert(inserts, { onConflict: "user_id, notification_id" });

    if (error) return res.status(400).json({ error: error.message });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Okundu işaretleme hatası:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Okunmamış bildirim sayısını getir
router.get("/unread-count", async (req, res) => {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: "userId gereklidir." });

  try {
    // Tüm aktif bildirimlerin ID'lerini al
    const { data: allNotifs, error: notifError } = await supabase
      .from("public_notifications")
      .select("id")
      .eq("is_active", true);

    if (notifError) return res.status(400).json({ error: notifError.message });

    // Kullanıcının okuduklarını al
    const { data: readNotifs, error: readError } = await supabase
      .from("user_read_public_notifications")
      .select("notification_id")
      .eq("user_id", userId);

    if (readError) return res.status(400).json({ error: readError.message });

    const readIds = readNotifs.map(r => r.notification_id);
    const unreadCount = allNotifs.filter(n => !readIds.includes(n.id)).length;

    res.status(200).json({ count: unreadCount });
  } catch (err) {
    console.error("Unread count hatası:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

module.exports = router;
