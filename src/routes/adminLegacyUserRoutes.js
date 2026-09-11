// Admin "Legacy Users" API'si — belirli kullanıcıları eski model davranışına sabitler.
// Bkz. src/utils/legacyModelUsers.js (bayrakların anlamı ve önbellek).
const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");
const { invalidateLegacyCache } = require("../utils/legacyModelUsers");

const db = supabaseAdmin || supabase;
const TABLE = "legacy_model_users";
const normalize = (email) => String(email || "").trim().toLowerCase();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

// Liste — uygulamadaki kullanıcı kaydıyla eşleşiyor mu bilgisiyle birlikte.
router.get("/legacy-users", async (req, res) => {
  try {
    const { data, error } = await db
      .from(TABLE)
      .select("id,email,note,use_nbpro_v2,skip_auto_pool_model,created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = data || [];
    let known = new Set();
    if (rows.length) {
      const { data: users } = await db
        .from("users")
        .select("email")
        .in("email", rows.map((r) => r.email));
      known = new Set((users || []).map((u) => normalize(u.email)));
    }
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, has_account: known.has(normalize(r.email)) })),
    });
  } catch (error) {
    console.error("❌ [LEGACY USERS] liste hatası:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ekle (aynı e-posta varsa notu/bayrakları günceller).
router.post("/legacy-users", async (req, res) => {
  try {
    const email = normalize(req.body?.email);
    if (!isEmail(email)) {
      return res.status(400).json({ success: false, error: "Geçerli bir e-posta gerekli" });
    }
    const payload = {
      email,
      note: typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 300) || null : null,
      use_nbpro_v2: req.body?.use_nbpro_v2 !== false,
      skip_auto_pool_model: req.body?.skip_auto_pool_model !== false,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db
      .from(TABLE)
      .upsert(payload, { onConflict: "email" })
      .select()
      .single();
    if (error) throw error;
    invalidateLegacyCache();
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ [LEGACY USERS] ekleme hatası:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bayrakları güncelle.
router.patch("/legacy-users/:id", async (req, res) => {
  try {
    const patch = { updated_at: new Date().toISOString() };
    if (typeof req.body?.use_nbpro_v2 === "boolean") patch.use_nbpro_v2 = req.body.use_nbpro_v2;
    if (typeof req.body?.skip_auto_pool_model === "boolean") patch.skip_auto_pool_model = req.body.skip_auto_pool_model;
    if (typeof req.body?.note === "string") patch.note = req.body.note.trim().slice(0, 300) || null;
    const { data, error } = await db.from(TABLE).update(patch).eq("id", req.params.id).select().single();
    if (error) throw error;
    invalidateLegacyCache();
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ [LEGACY USERS] güncelleme hatası:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listeden çıkar (kullanıcı yeni modele döner).
router.delete("/legacy-users/:id", async (req, res) => {
  try {
    const { error } = await db.from(TABLE).delete().eq("id", req.params.id);
    if (error) throw error;
    invalidateLegacyCache();
    res.json({ success: true });
  } catch (error) {
    console.error("❌ [LEGACY USERS] silme hatası:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
