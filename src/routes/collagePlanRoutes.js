// 🧩 Kolaj planlayıcı ucu — POST /api/collage/plan (30 Eyl 2026, yeni ve bağımsız; eski uçlara dokunmaz)
//
// Gövde: { userId, brief: { mode, purpose, ratio, mood, caption{mode,title,subtitle}, brandColor,
//          heroIndex, language, photos[{ url, width, height, plain, bbox, bg, avg }] } }
// Yanıt: { success, source: "ai"|"fallback", plan }
//
// • Kimlik: refundIdentity (cihaz kimliği ya da oturum; e-posta şartı yok — client/AGENTS.md).
// • Hız sınırı: kullanıcı başına 6/dk + 60/gün (bellek içi, sunucu örneği başına).
// • Kredi kuralı: Banner Stüdyosu şablon uyarlamasıyla (/api/banner-studio/template-adapt) aynı —
//   PRO/deneme ya da kredi > 0 ise açık, kredi DÜŞMEZ. Değilse 403 pro_required; istemci aynı
//   çekirdekle yerel akıllı düzene düşer (kolaj aracı ücretsiz kalır).
// • Önizlemeler yalnız kendi depolamamızdan kabul edilir; biri yabancıysa hiçbiri modele gitmez.
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function createCollagePlanRouter({ db, identity = null, planner = null, limits = { perMinute: 6, perDay: 60 } } = {}) {
  const router = express.Router();
  const plannerModule = planner || require("../utils/collagePlanner");
  router.use((req, res, next) => (db ? next() : res.status(503).json({ success: false, reason: "unavailable" })));
  const identityMiddleware = identity || ((req, res, next) => require("../middleware/refundIdentity").refundIdentity(db)(req, res, next));
  const limiter = (windowMs, limit) => rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.refundUserId ? `collage:${req.refundUserId}` : ipKeyGenerator(req.ip || "")),
    handler: (req, res) => res.status(429).json({ success: false, reason: "rate_limited" }),
  });

  router.post("/plan", identityMiddleware, limiter(60 * 1000, limits.perMinute), limiter(24 * 60 * 60 * 1000, limits.perDay), async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const raw = body.brief && typeof body.brief === "object" ? body.brief : {};
      const brief = plannerModule.core.validateBrief({ ...raw, language: raw.language || req.query.language });
      if (brief.photos.length < 2) return res.status(400).json({ success: false, reason: "photos_required" });
      if (!brief.photos.every((p) => p.url && plannerModule.isAllowedImageUrl(p.url))) {
        brief.photos.forEach((p) => { p.url = null; });
      }
      const { data: user, error } = await db.from("users").select("is_pro, credit_balance").eq("id", req.refundUserId).maybeSingle();
      if (error) throw error;
      const open = user?.is_pro === true || (typeof user?.credit_balance === "number" && user.credit_balance > 0);
      if (!open) return res.status(403).json({ success: false, reason: "pro_required" });

      const started = Date.now();
      const result = await plannerModule.planCollage({ brief });
      const repaired = result.issues?.length ? `, onarılan: ${result.issues.join(",")}` : "";
      console.log(`🧩 [COLLAGE_PLAN] ${brief.photos.length} fotoğraf → ${result.plan?.templateId} (${result.source}${repaired}) ${Math.round((Date.now() - started) / 1000)} sn`);
      return res.set("Cache-Control", "no-store").json({ success: true, source: result.source, plan: result.plan });
    } catch (error) {
      console.warn("🧩 [COLLAGE_PLAN] hata:", error?.message);
      return res.status(500).json({ success: false, reason: "request_failed" });
    }
  });
  return router;
}

const clients = require("../supabaseClient");
module.exports = createCollagePlanRouter({ db: clients.supabaseAdmin || clients.supabase });
module.exports.createCollagePlanRouter = createCollagePlanRouter;
