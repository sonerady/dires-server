// 📚 Ürün Kataloğu PDF — plan ucu (30 Eyl 2026, YALNIZ EKLENDİ; hiçbir eski uç değişmedi)
//
// POST /api/catalog-pdf/plan
//   gövde: { userId, language, brief, store, locked, products[], labels } (catalogPlanCore.sanitizePlanInput)
//   yanıt: { success, plan, source: "ai"|"fallback", reason?, model? }
// Kimlik: refundIdentity (cihaz kimliği ya da oturum; UUID tek başına yetmez) — Kendi aracını
// oluştur ile aynı. Kredi: ÜCRETSİZ (Kendi aracını oluştur ve banner şablon uyarlaması da
// kredi düşmüyor); kötüye kullanıma karşı IP başına dakikalık + kullanıcı başına 10 dakikalık
// ve günlük sınır. Sınır aşılınca 429 → istemci aynı çekirdeğin yerel planına düşer.
// Model hatasında da 200 + yedek plan döner (source: "fallback").
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { supabaseAdmin: db } = require("../supabaseClient");
const { refundIdentity } = require("../middleware/refundIdentity");
const { sanitizePlanInput } = require("../utils/catalogPlanCore");
const { planCatalog } = require("../utils/catalogPdfPlanner");

const router = express.Router();
const DAILY_LIMIT = Number(process.env.CATALOG_PDF_DAILY_LIMIT) || 40;
const daily = new Map(); // userId → { day, count } (tek örnek; yeniden başlatmada sıfırlanır)

function takeDaily(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const entry = daily.get(userId);
  if (!entry || entry.day !== day) {
    if (daily.size > 20000) daily.clear();
    daily.set(userId, { day, count: 1 });
    return true;
  }
  if (entry.count >= DAILY_LIMIT) return false;
  entry.count += 1;
  return true;
}

const limited = (req, res) => res.status(429).json({ success: false, reason: "rate_limited" });

router.use((req, res, next) => (db ? next() : res.status(503).json({ success: false, reason: "unavailable" })));
router.use(rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false, handler: limited }));

router.post(
  "/plan",
  (req, res, next) => refundIdentity(db)(req, res, next),
  rateLimit({ windowMs: 10 * 60000, limit: 8, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `catalog:${req.refundUserId}`, handler: limited }),
  async (req, res) => {
    try {
      const input = sanitizePlanInput(req.body);
      if (!input.products.length) return res.status(400).json({ success: false, reason: "invalid_input" });
      if (!takeDaily(req.refundUserId)) return res.status(429).json({ success: false, reason: "daily_limit" });
      const started = Date.now();
      const result = await planCatalog(input);
      const withImages = input.products.filter((p) => p.imageUrl).length;
      // Kimlik/anahtar/ürün metni loglanmaz — yalnız sayılar
      console.log(`📚 [CATALOG_PDF] plan source=${result.source}${result.reason ? ` reason=${result.reason}` : ""} products=${input.products.length} photos=${withImages} sections=${result.plan.sections.length} ${Date.now() - started}ms`);
      res.set("Cache-Control", "no-store").json({ success: true, plan: result.plan, source: result.source, reason: result.reason, model: result.model });
    } catch (error) {
      console.warn("⚠️ [CATALOG_PDF] plan failed:", String(error?.message || error).slice(0, 200));
      res.status(500).json({ success: false, reason: "plan_failed" });
    }
  },
);

module.exports = router;
