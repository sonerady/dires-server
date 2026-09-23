const express = require("express");
const axios = require("axios");
const { rateLimit } = require("express-rate-limit");
const { supabaseAdmin } = require("../supabaseClient");
const { requireAdmin } = require("../middleware/requireAdmin");
const { refundIdentity } = require("../middleware/refundIdentity");
const {
  sendRefundNotification,
  startRefundReviewWorker,
} = require("../services/refundNotification");
const {
  buildAnalysisPrompt,
  parseAnalysis,
  decideRefund,
  callRefundVision,
  extractProductUrls,
} = require("../utils/creditRefundAnalysis");
const router = express.Router();
const db = supabaseAdmin;
if (db && process.env.NODE_ENV !== "test") startRefundReviewWorker(db);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const check = (r) => {
  if (r.error) throw r.error;
  return r.data;
};
const publicRequest = (r) =>
  r && {
    id: r.id,
    status: r.status,
    verdict: r.verdict,
    productMatch: r.product_match,
    renderQuality: r.render_quality,
    refundedCredits: r.refunded_credits,
    refundPercent: r.refund_percent,
    summary: r.summary,
    reason: r.reason,
    appealText: r.appeal_text,
    adminNote: r.admin_note,
    creditsDeducted: r.credits_deducted,
    defects: r.defects,
    createdAt: r.created_at,
  };
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
router.use((req, res, next) =>
  db ? next() : res.status(503).json({ success: false, reason: "unavailable" }),
);
router.get(
  "/admin/requests",
  requireAdmin,
  wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    let q = db
      .from("credit_refund_requests")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (req.query.status === "pending" || !req.query.status)
      q = q.in("status", ["review_pending", "appeal_pending", "error"]);
    else if (req.query.status !== "all") q = q.eq("status", req.query.status);
    const result = await q.range((page - 1) * 20, page * 20 - 1);
    check(result);
    res.json({ success: true, items: result.data, total: result.count, page });
  }),
);
router.post(
  "/admin/:id/decision",
  requireAdmin,
  wrap(async (req, res) => {
    const { decision, note, verifiedOwner } = req.body || {};
    if (verifiedOwner && !UUID.test(verifiedOwner))
      return res.status(400).json({ success: false, reason: "invalid_owner" });
    if (
      !UUID.test(req.params.id) ||
      !["approve", "reject"].includes(decision) ||
      typeof note !== "string" ||
      note.trim().length < 5 ||
      note.length > 1500
    )
      return res
        .status(400)
        .json({ success: false, reason: "invalid_decision" });
    const result = check(
      await db.rpc("settle_credit_refund", {
        p_id: req.params.id,
        p_status: decision === "approve" ? "refunded" : "appeal_rejected",
        p_admin: req.adminUser.email,
        p_note: note.trim(),
        p_analysis: verifiedOwner ? { verifiedOwner } : {},
      }),
    );
    const row = await sendRefundNotification(db, result.request);
    res.json({
      success: true,
      request: row,
      alreadySettled: result.alreadySettled,
    });
  }),
);
router.post(
  "/admin/:id/notify",
  requireAdmin,
  wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.sendStatus(400);
    const row = check(
      await db
        .from("credit_refund_requests")
        .select("*")
        .eq("id", req.params.id)
        .single(),
    );
    res.json({ success: true, request: await sendRefundNotification(db, row) });
  }),
);
router.use(refundIdentity(db));
const limiter = rateLimit({
  windowMs: 60000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const devPreview = require("../services/refundDevPreview");
const preview = devPreview.createPreview({ loadGeneration, imageData });
router.use("/dev", (req, res, next) =>
  devPreview.enabled()
    ? next()
    : res.status(404).json({ success: false, reason: "dev_preview_disabled" }),
);
router.get(
  "/dev/status",
  wrap(async (req, res) => {
    res.json(await preview.status(req.refundUserId, req.query.generationId));
  }),
);
router.post(
  "/dev/analyze",
  limiter,
  wrap(async (req, res) => {
    res.json(
      await preview.analyze(
        req.refundUserId,
        req.body?.generationId,
        req.body?.languageCode,
      ),
    );
  }),
);
router.post(
  "/dev/appeal",
  limiter,
  wrap(async (req, res) => {
    res.json(
      preview.appeal(req.refundUserId, req.body?.requestId, req.body?.text),
    );
  }),
);
// Ürün Stüdyosu / Renk gibi araçlar generation_id'yi "zamandamgası_i" biçiminde üretiyor
// (UUID değil). Eskiden UUID olmayan her kimlik "not_found" dönüyordu → Ürün Stüdyosu
// iadesi HİÇ çalışmıyordu (23 Eyl 2026). UUID olmayanlar yalnız generation_id (text)
// kolonunda, sıkı bir karakter kümesiyle aranır (PostgREST filtre enjeksiyonu yok).
const LOOSE_GENERATION_ID = /^[A-Za-z0-9_-]{6,80}$/;
async function loadGeneration(userId, id) {
  const value = String(id || "");
  const isUuid = UUID.test(value);
  if (!isUuid && !LOOSE_GENERATION_ID.test(value)) return null;
  let q = db.from("reference_results").select("*").eq("user_id", userId);
  q = isUuid ? q.or(`generation_id.eq.${value},id.eq.${value}`) : q.eq("generation_id", value);
  return (check(await q.order("created_at", { ascending: false }).limit(1)) || [])[0];
}
async function eligibility(userId, id) {
  const config =
    check(
      await db
        .from("app_config")
        .select("refund_enabled,refund_daily_limit,refund_max_age_days")
        .limit(1)
        .maybeSingle(),
    ) || {};
  // 🎛️ app_config.refund_enabled=false → istemci iade butonunu TAMAMEN gizler (23 Eyl 2026);
  // bu yüzden `enabled` her yanıtta, geçmiş kararlar dahil, döner.
  const enabled = !!config.refund_enabled; // reason "disabled" ile aynı ölçüt
  const gen = await loadGeneration(userId, id);
  if (!gen) return { eligible: false, reason: "not_found", enabled };
  const proof = check(
    await db
      .from("credit_refund_charges")
      .select(
        "credits,credit_owner_id,result_image_url,product_image_urls,created_at",
      )
      .eq("user_id", userId)
      .eq("generation_id", String(gen.generation_id || gen.id))
      .maybeSingle(),
  );
  // Kanıt satırı borçlanma anında yazıldığı için görsel alanları boş olabilir
  // (üretim o an bitmemiştir). Yalnız DOLU alanlar generation satırının
  // üzerine yazılır; boş olanlar generation'dan gelmeye devam eder — aksi
  // halde result_image_url null'a ezilip "no_result" ile buton gizleniyordu.
  if (proof) {
    const overrides = {
      credits_deducted: proof.credits,
      credit_owner_id: proof.credit_owner_id,
      created_at: proof.created_at,
    };
    if (proof.result_image_url) {
      overrides.result_image_url = proof.result_image_url;
      overrides.pre_upscale_image_url = null;
    }
    if (
      Array.isArray(proof.product_image_urls)
        ? proof.product_image_urls.length
        : proof.product_image_urls
    )
      overrides.reference_images = proof.product_image_urls;
    Object.assign(gen, overrides);
  }
  const aliases = [String(gen.id), String(gen.generation_id || gen.id)];
  const existing = (check(
    await db
      .from("credit_refund_requests")
      .select("*")
      .eq("user_id", userId)
      .in("generation_id", aliases)
      .order("created_at")
      .limit(1),
  ) || [])[0];
  if (
    existing?.status === "analyzing" &&
    Date.now() - Date.parse(existing.created_at) > 180000
  ) {
    const recovered = check(
      await db
        .from("credit_refund_requests")
        .update({
          status: "review_pending",
          error_message: "Analysis interrupted; manual review required",
        })
        .eq("id", existing.id)
        .eq("status", "analyzing")
        .select("*")
        .maybeSingle(),
    );
    if (recovered) Object.assign(existing, recovered);
  }
  if (existing)
    return {
      eligible: false,
      reason: "already_requested",
      enabled,
      existing: publicRequest(existing),
      creditsDeducted: gen.credits_deducted,
    };
  // 🧪 Deneme kullanıcısı iade alamaz (23 Eyl 2026, kullanıcı kararı) — RPC de reddeder.
  const account = check(
    await db.from("users").select("is_in_trial").eq("id", userId).maybeSingle(),
  );
  const counted = await db
    .from("credit_refund_requests")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 86400000).toISOString());
  check(counted);
  const remaining = Math.max(
    0,
    (config.refund_daily_limit ?? 3) - (counted.count || 0),
  );
  // Yaş penceresi app_config.refund_max_age_days'ten gelir. Önceden 24 saat
  // KOD İÇİNDE sabitti ve config okunup kullanılmıyordu; değeri değiştirmek
  // hiçbir şeyi değiştirmiyordu (17 Eyl 2026).
  // 23 Eyl 2026 (kullanıcı kararı): iade en geç 24 saat — config daha uzun bir pencere
  // verse bile 24 saati aşamaz (daha kısa verilebilir). RPC de aynı sınırı uygular.
  const maxAgeMs =
    Math.min(1, Math.max(1 / 24, Number(config.refund_max_age_days) || 1)) * 86400000;
  let reason = !config.refund_enabled
    ? "disabled"
    : account?.is_in_trial === true
      ? "trial"
      : // Yalnız ANA üretimler (giyim/takı V7, web, Ürün Stüdyosu) borçlanırken iade kanıtı
      // yazar. Kanıtı olmayan satır = kit / çeşitlendirme / düzenleme türevi → iade yok.
      !proof
      ? "not_main_generation"
      : !gen.result_image_url
      ? "no_result"
      : !gen.credits_deducted
        ? "no_charge"
        : Date.now() - Date.parse(gen.created_at) > maxAgeMs
          ? "too_old"
          : !extractProductUrls(gen.reference_images).length
            ? "no_product_photo"
            : !remaining
              ? "daily_limit"
              : "ok";
  return {
    eligible: reason === "ok",
    reason,
    enabled,
    gen,
    creditsDeducted: gen.credits_deducted,
    dailyRemaining: remaining,
  };
}
router.get(
  "/status",
  wrap(async (req, res) => {
    const { gen, ...status } = await eligibility(
      req.refundUserId,
      req.query.generationId,
    );
    res.json({ success: true, ...status });
  }),
);
// Only trusted image hosts are downloaded. No redirects/private-network URLs.
async function imageData(url) {
  const u = new URL(url);
  const storageHost = new URL(process.env.SUPABASE_URL).hostname;
  if (
    u.protocol !== "https:" ||
    !(
      u.hostname === storageHost ||
      u.hostname === "api.diress.ai" ||
      u.hostname === "diress.ai" ||
      u.hostname.endsWith(".fal.media") ||
      u.hostname === "replicate.delivery" ||
      u.hostname.endsWith(".replicate.delivery")
    )
  )
    throw new Error("Untrusted image host");
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    maxRedirects: 0,
    maxContentLength: 20 * 1024 * 1024,
  });
  const sharp = require("sharp");
  const buffer = await sharp(response.data, { limitInputPixels: 40000000 })
    .rotate()
    .resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}
router.post(
  "/analyze",
  limiter,
  wrap(async (req, res) => {
    const { generationId, languageCode } = req.body || {};
    // Initial review is visual-only. Written explanations belong to the appeal.
    const reason = "";
    const category = "general";
    const e = await eligibility(req.refundUserId, generationId);
    if (!e.eligible) {
      const { gen, ...status } = e;
      return res
        .status(e.existing ? 200 : 409)
        .json({ success: !!e.existing, ...status });
    }
    const gen = e.gen;
    // New generations persist the charged owner. Legacy team charges require review, never guess another account.
    const owner = null; // The claim RPC derives ownership exclusively from the private charge ledger.
    const claimed = check(
      await db.rpc("claim_credit_refund", {
        p_user: req.refundUserId,
        p_result: gen.id,
        p_reason: reason.trim(),
        p_category: category,
        p_language: String(languageCode || "en").slice(0, 10),
        p_owner: owner,
      }),
    );
    if (claimed.existing)
      return res.json({ success: true, ...publicRequest(claimed.existing) });
    const row = claimed.request;
    try {
      const products = extractProductUrls(row.product_image_urls);
      const images = await Promise.all(
        [...products, row.result_image_url].map(imageData),
      );
      const prompt = buildAnalysisPrompt({
        languageCode,
        productCount: products.length,
        reason,
        category,
        userDetails:
          gen.settings?.additionalDetails ||
          gen.settings?.additional_details ||
          "",
      });
      const { model, raw } = await callRefundVision(prompt, images);
      const analysis = parseAnalysis(raw);
      if (!analysis) throw new Error("Invalid analysis response");
      const decision = decideRefund(analysis, row.credits_deducted);
      const result = check(
        await db.rpc("settle_credit_refund", {
          p_id: row.id,
          p_status:
            decision.status === "refunded" && !row.credit_owner_id
              ? "review_pending"
              : decision.status,
          p_analysis: { ...analysis, model },
        }),
      );
      return res.json({
        success: true,
        ...publicRequest(result.request),
        newBalance: result.newBalance,
      });
    } catch (error) {
      // Never delete a request or retry a credit mutation after an ambiguous network failure.
      await db
        .from("credit_refund_requests")
        .update({
          status: "review_pending",
          error_message: String(error.message).slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "analyzing");
      const current = check(
        await db
          .from("credit_refund_requests")
          .select("*")
          .eq("id", row.id)
          .single(),
      );
      return res.json({ success: true, ...publicRequest(current) });
    }
  }),
);
router.post(
  "/appeal",
  limiter,
  wrap(async (req, res) => {
    const { requestId, text } = req.body || {};
    if (
      !UUID.test(requestId || "") ||
      typeof text !== "string" ||
      text.trim().length < 20 ||
      text.length > 2000
    )
      return res.status(400).json({ success: false, reason: "invalid_appeal" });
    const changed = check(
      await db
        .from("credit_refund_requests")
        .update({
          status: "appeal_pending",
          appeal_text: text.trim(),
          appealed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("user_id", req.refundUserId)
        .eq("status", "rejected")
        .is("appealed_at", null)
        .select("*")
        .maybeSingle(),
    );
    if (!changed)
      return res
        .status(409)
        .json({ success: false, reason: "appeal_unavailable" });
    res.json({ success: true, ...publicRequest(changed) });
  }),
);
router.use((error, req, res, next) => {
  console.error("[Refund]", error.message);
  res.status(500).json({ success: false, reason: "request_failed" });
});
module.exports = router;
module.exports._test = { publicRequest, eligibility };
