// AI üretilen içerik bildirimleri (Google Play AI-Generated Content Policy).
// Kullanıcı uygulama içinden rahatsız edici içeriği işaretler; kayıt content_reports
// tablosuna düşer. Kimlik doğrulama istemez (anonim kullanıcılar da bildirebilmeli).
const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");

const db = supabaseAdmin || supabase;

const VALID_REASONS = ["sexual", "violent", "hateful", "misleading", "other"];

router.post("/content-reports", async (req, res) => {
  try {
    const { userId, imageUrl, contentId, reason, source, platform } = req.body || {};
    if (!reason || !VALID_REASONS.includes(String(reason))) {
      return res.status(400).json({ success: false, error: "invalid reason" });
    }
    const { error } = await db.from("content_reports").insert({
      user_id: userId || null,
      image_url: typeof imageUrl === "string" ? imageUrl.slice(0, 2000) : null,
      content_id: typeof contentId === "string" ? contentId.slice(0, 200) : null,
      reason: String(reason),
      source: typeof source === "string" ? source.slice(0, 100) : null,
      platform: typeof platform === "string" ? platform.slice(0, 20) : null,
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error("❌ [CONTENT_REPORT]", e.message);
    res.status(500).json({ success: false, error: "failed" });
  }
});

module.exports = router;
