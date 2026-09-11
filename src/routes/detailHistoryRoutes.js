// "Detay Ekle" geçmişi — kullanıcıya bağlı, sunucuda (user_detail_history).
// Mobil components/AddDetail, Mac desktop/tool/AddDetailCard ve web AddDetailCard
// aynı uçları kullanır; cihaz depolaması yalnız çevrimdışı önbellek.
//   GET    /api/detail-history/:userId          → { success, items: [string] }  (en yeni 20)
//   POST   /api/detail-history/:userId  {text}  → { success, items }            (aynı metin varsa öne alınır)
//   DELETE /api/detail-history/:userId          → { success, items: [] }
//   DELETE /api/detail-history/:userId/item {text} → { success, items }
const express = require("express");
const { supabaseAdmin, supabase } = require("../supabaseClient");

const router = express.Router();
const db = () => supabaseAdmin || supabase;
const LIMIT = 20;
const MAX_LEN = 2000;

const validUser = (id) => typeof id === "string" && id.length >= 8 && id.length <= 128 && !/^anonymous(_user)?$/i.test(id);
const normalize = (t) => String(t ?? "").trim().slice(0, MAX_LEN);

async function list(userId) {
  const { data, error } = await db()
    .from("user_detail_history")
    .select("text")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data || []).map((r) => r.text);
}

router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!validUser(userId)) return res.json({ success: true, items: [] });
  try {
    res.json({ success: true, items: await list(userId) });
  } catch (e) {
    console.error("❌ [DETAIL_HISTORY] list:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/:userId", async (req, res) => {
  const { userId } = req.params;
  const text = normalize(req.body?.text);
  if (!validUser(userId)) return res.status(400).json({ success: false, error: "invalid userId" });
  if (!text) return res.status(400).json({ success: false, error: "text required" });
  try {
    const now = new Date().toISOString();
    const { error } = await db()
      .from("user_detail_history")
      .upsert({ user_id: userId, text, updated_at: now }, { onConflict: "user_id,text" });
    if (error) throw error;
    // 20'den fazlasını buda (en eskiler)
    const { data: all } = await db()
      .from("user_detail_history")
      .select("id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    const stale = (all || []).slice(LIMIT).map((r) => r.id);
    if (stale.length) await db().from("user_detail_history").delete().in("id", stale);
    res.json({ success: true, items: await list(userId) });
  } catch (e) {
    console.error("❌ [DETAIL_HISTORY] remember:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Toplu içe aktarma (cihazdaki eski AsyncStorage/localStorage listesi ilk açılışta buraya taşınır)
router.post("/:userId/import", async (req, res) => {
  const { userId } = req.params;
  const items = Array.isArray(req.body?.items) ? req.body.items.map(normalize).filter(Boolean).slice(0, LIMIT) : [];
  if (!validUser(userId)) return res.status(400).json({ success: false, error: "invalid userId" });
  try {
    if (items.length) {
      // Liste sırası korunsun: ilk eleman en yeni → updated_at azalan
      const base = Date.now();
      const rows = items.map((text, i) => ({ user_id: userId, text, updated_at: new Date(base - i * 1000).toISOString() }));
      const { error } = await db().from("user_detail_history").upsert(rows, { onConflict: "user_id,text", ignoreDuplicates: true });
      if (error) throw error;
    }
    res.json({ success: true, items: await list(userId) });
  } catch (e) {
    console.error("❌ [DETAIL_HISTORY] import:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete("/:userId/item", async (req, res) => {
  const { userId } = req.params;
  const text = normalize(req.body?.text);
  if (!validUser(userId) || !text) return res.status(400).json({ success: false, error: "invalid request" });
  try {
    const { error } = await db().from("user_detail_history").delete().eq("user_id", userId).eq("text", text);
    if (error) throw error;
    res.json({ success: true, items: await list(userId) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete("/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!validUser(userId)) return res.status(400).json({ success: false, error: "invalid userId" });
  try {
    const { error } = await db().from("user_detail_history").delete().eq("user_id", userId);
    if (error) throw error;
    res.json({ success: true, items: [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
