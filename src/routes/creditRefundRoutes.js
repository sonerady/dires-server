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
// ⚖️ 25 Eyl 2026: iade kararı denetim protokollü hakemle (creditRefundJudge — Gemini 3.5 Flash, Replicate). Eski Gemini analizine dönmek için
// Railway env REFUND_ANALYZER=legacy.
const { judgeRefund } = require("../utils/creditRefundJudge");
const { refundExplanation } = require("../services/refundExplanation");
const USE_LEGACY_ANALYZER = process.env.REFUND_ANALYZER === "legacy";
const router = express.Router();
const db = supabaseAdmin;
if (db && process.env.NODE_ENV !== "test" && process.env.DISABLE_BACKGROUND_WORKERS !== "1") startRefundReviewWorker(db);
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
    // 25 Eyl 2026: iç admin notu uygulamaya GÖNDERİLMEZ (her dilde, teknik olabilir). Yerine admin kararı anında
    // kullanıcının dilinde üretilen açıklama (raw_response.userNote). Eski sürümler adminNote yoksa özeti gösterir.
    userNote: r.raw_response?.userNote?.text || null,
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
    // Kullanıcıya gösterilecek açıklama bir kez, talebin dilinde üretilip saklanır (onay VE ret)
    let settled = result.request;
    if (!result.alreadySettled && settled && ["refunded", "appeal_rejected"].includes(settled.status)) {
      try {
        const lang = String(settled.language_code || "en").toLowerCase().split("-")[0];
        const text = await refundExplanation({ ...settled, raw_response: null }, lang);
        if (text && text !== settled.summary) {
          const updated = check(
            await db
              .from("credit_refund_requests")
              .update({ raw_response: { ...(settled.raw_response || {}), userNote: { text, lang, at: new Date().toISOString() } } })
              .eq("id", settled.id)
              .select("*")
              .single(),
          );
          if (updated) settled = updated;
        }
      } catch (error) {
        console.warn("[Refund decision] user note", error.message);
      }
    }
    const row = await sendRefundNotification(db, settled);
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
// ⚡ 25 Eyl 2026 (kullanıcı raporu: "iade butonu resim açıldıktan çok sonra geliyor"): /status sıralı 6 ağ
// turuydu ve üretim satırı `select *` ile (~20 KB: kit/hikâye dizileri) okunuyordu. Artık yalnız gereken alanlar.
const GENERATION_FIELDS =
  "id,generation_id,user_id,created_at,credits_deducted,credit_owner_id,result_image_url,pre_upscale_image_url,reference_images,settings,status";
let configCache = null;
async function refundConfig() {
  if (configCache && Date.now() - configCache.at < 30000) return configCache.value;
  const value =
    check(
      await db
        .from("app_config")
        .select("refund_enabled,refund_daily_limit,refund_max_age_days")
        .limit(1)
        .maybeSingle(),
    ) || {};
  configCache = { value, at: Date.now() };
  return value;
}
async function loadGeneration(userId, id) {
  const value = String(id || "");
  const isUuid = UUID.test(value);
  if (!isUuid && !LOOSE_GENERATION_ID.test(value)) return null;
  let q = db.from("reference_results").select(GENERATION_FIELDS).eq("user_id", userId);
  q = isUuid ? q.or(`generation_id.eq.${value},id.eq.${value}`) : q.eq("generation_id", value);
  return (check(await q.order("created_at", { ascending: false }).limit(1)) || [])[0];
}
/** Uygunluk nedeni — sıra bilinçli (tests/creditRefundReason.test.js):
 *  kapalı → deneme → 24 saati geçmiş → kanıtsız (ana üretim değil) → sonuçsuz → borçsuz → ürün fotoğrafsız.
 *  24 Eyl 2026 (kullanıcı isteği): 24 saati geçmiş görsel HER ZAMAN "süresi doldu" der — kanıt
 *  kontrolünden ÖNCE; kanıt kaydı 23 Eyl deploy'undan önce yazılmadığı için eski ana üretimler
 *  yanlışlıkla "bu araç iade kapsamında değil" uyarısı alıyordu. */
function refundIneligibleReason({ config, account, proof, gen, maxAgeMs, edited = false, now = Date.now() }) {
  if (!config.refund_enabled) return "disabled";
  if (account?.is_in_trial === true) return "trial";
  if (now - Date.parse(gen.created_at) > maxAgeMs) return "too_old";
  // Yalnız ANA üretimler (giyim/takı V7, web, Ürün Stüdyosu) borçlanırken iade kanıtı
  // yazar. Kanıtı olmayan satır = kit / çeşitlendirme / düzenleme türevi → iade yok.
  if (!proof) return "not_main_generation";
  // 🔒 25 Eyl 2026 (kullanıcı raporu): görsel düzenleme ekranında (chat-edit) düzenlendiyse iade YOK — kullanıcı
  // ürünü düzenlemeyle bozup iade isteyebiliyordu. Düzenleme sonucu kullanıcının kendi isteği; hakem ise
  // yalnız orijinali görüyor, bu yüzden düzenlenmiş bir üretim iade kapsamından çıkar.
  if (edited) return "edited";
  if (!gen.result_image_url) return "no_result";
  // Üretim başarısız işaretlendiyse kredisi hata anında zaten iade edildi → ikinci iade yok
  if (!gen.credits_deducted || gen.status === "failed") return "no_charge";
  if (!extractProductUrls(gen.reference_images).length) return "no_product_photo";
  return "ok";
}
// Aynı görselin farklı adres biçimlerini (CDN yeniden boyutlandırma sarmalı, sorgu dizesi, host farkı)
// eşleştirmek için depolama dosya adı karşılaştırılır (örn. 1790269985339_result_86564657.jpg — zaman + rastgele ek).
function imageFileKey(url) {
  if (typeof url !== "string" || !url) return null;
  let value = url.split(/[?#]/)[0];
  const wrapped = value.indexOf("/cdn-cgi/image/");
  if (wrapped >= 0) value = value.slice(wrapped + "/cdn-cgi/image/".length).replace(/^[^/]*\//, "");
  const name = value.split("/").filter(Boolean).pop() || "";
  return name.length >= 12 ? decodeURIComponent(name) : null;
}
/** Bu üretimin görseli (ya da netleştirme öncesi / kanıttaki hâli) chat-edit ile düzenlendi mi? */
function wasEditedInChat(gen, proof, edits = []) {
  const keys = new Set([gen.result_image_url, gen.pre_upscale_image_url, proof?.result_image_url].map(imageFileKey).filter(Boolean));
  if (!keys.size) return false;
  return edits.some((edit) => keys.has(imageFileKey(edit.original_image_url)));
}
async function eligibility(userId, id) {
  // Birbirinden bağımsız üç okuma aynı anda (eskiden sırayla)
  const [config, gen, account] = await Promise.all([
    refundConfig(),
    loadGeneration(userId, id),
    db.from("users").select("is_in_trial").eq("id", userId).maybeSingle().then(check),
  ]);
  // 🎛️ app_config.refund_enabled=false → istemci iade butonunu TAMAMEN gizler (23 Eyl 2026);
  // bu yüzden `enabled` her yanıtta, geçmiş kararlar dahil, döner.
  const enabled = !!config.refund_enabled; // reason "disabled" ile aynı ölçüt
  if (!gen) return { eligible: false, reason: "not_found", enabled };
  const aliases = [String(gen.id), String(gen.generation_id || gen.id)];
  // Kanıt satırı ve mevcut talep de aynı anda. Talep araması claim_credit_refund RPC'siyle aynı:
  // result_id VEYA generation_id takma adları.
  const [proof, existingRows, chatEdits] = await Promise.all([
    db
      .from("credit_refund_charges")
      .select("credits,credit_owner_id,result_image_url,product_image_urls,created_at")
      .eq("user_id", userId)
      .eq("generation_id", String(gen.generation_id || gen.id))
      .maybeSingle()
      .then(check),
    db
      .from("credit_refund_requests")
      .select("*")
      .eq("user_id", userId)
      .or(`result_id.eq.${gen.id},generation_id.in.(${aliases.map((a) => `"${a}"`).join(",")})`)
      .order("created_at")
      .limit(1)
      .then(check),
    // Bu üretimden SONRA yapılmış tamamlanmış görsel düzenlemeleri (chat-edit) — "düzenlendi" kuralı
    db
      .from("chat_edits")
      .select("original_image_url")
      .eq("user_id", String(userId))
      .eq("status", "completed")
      .gte("created_at", gen.created_at)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(check),
  ]);
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
  const existing = (existingRows || [])[0];
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
      generationCreatedAt: gen.created_at,
      enabled,
      existing: publicRequest(existing),
      creditsDeducted: gen.credits_deducted,
    };
  // 🧪 Deneme kullanıcısı iade alamaz (23 Eyl 2026, kullanıcı kararı) — RPC de reddeder. (account yukarıda paralel okundu)
  // 24 Eyl 2026 (kullanıcı kararı): günlük iade inceleme sınırı KALDIRILDI (RPC'den de,
  // migrations/20260924090000). dailyRemaining null → istemciler "X hak kaldı" çipini gizler.
  // Yaş penceresi app_config.refund_max_age_days'ten gelir. Önceden 24 saat
  // KOD İÇİNDE sabitti ve config okunup kullanılmıyordu; değeri değiştirmek
  // hiçbir şeyi değiştirmiyordu (17 Eyl 2026).
  // 23 Eyl 2026 (kullanıcı kararı): iade en geç 24 saat — config daha uzun bir pencere
  // verse bile 24 saati aşamaz (daha kısa verilebilir). RPC de aynı sınırı uygular.
  const maxAgeMs =
    Math.min(1, Math.max(1 / 24, Number(config.refund_max_age_days) || 1)) * 86400000;
  let reason = refundIneligibleReason({ config, account, proof, gen, maxAgeMs, edited: wasEditedInChat(gen, proof, chatEdits || []) });
  return {
    eligible: reason === "ok",
    generationCreatedAt: gen.created_at,
    reason,
    enabled,
    gen,
    creditsDeducted: gen.credits_deducted,
    dailyRemaining: null,
  };
}
// 🔔 Bildirimden açılan "İaden onaylandı" ekranı (25 Eyl 2026): yalnız talebin sahibi görür. Onaylanan talepte
// gerekçe kullanıcının dilinde açıklanır (refundExplanation); iç admin notu ham gösterilmez.
router.get(
  "/request/:id",
  wrap(async (req, res) => {
    if (!UUID.test(req.params.id))
      return res.status(400).json({ success: false, reason: "invalid_request" });
    const row = check(
      await db
        .from("credit_refund_requests")
        .select("*")
        .eq("id", req.params.id)
        .eq("user_id", req.refundUserId)
        .maybeSingle(),
    );
    if (!row) return res.status(404).json({ success: false, reason: "not_found" });
    const lang = String(req.query.lang || row.language_code || "en").slice(0, 10);
    const explanation = ["refunded", "appeal_rejected"].includes(row.status) ? await refundExplanation(row, lang) : null;
    const safe = publicRequest(row);
    res.json({
      success: true,
      request: {
        ...safe,
        resultImageUrl: row.result_image_url,
        productImageUrl: extractProductUrls(row.product_image_urls, 1)[0] || null,
        reviewedAt: row.reviewed_at,
        reviewedByHuman: !!row.reviewed_by,
        appealed: !!row.appealed_at,
        explanation,
      },
    });
  }),
);
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
      const userDetails =
        gen.settings?.additionalDetails ||
        gen.settings?.additional_details ||
        "";
      let analysis;
      let decision;
      let model;
      if (USE_LEGACY_ANALYZER) {
        const prompt = buildAnalysisPrompt({
          languageCode,
          productCount: products.length,
          reason,
          category,
          userDetails,
        });
        const legacy = await callRefundVision(prompt, images);
        model = legacy.model;
        analysis = parseAnalysis(legacy.raw);
        if (!analysis) throw new Error("Invalid analysis response");
        decision = decideRefund(analysis, row.credits_deducted);
      } else {
        ({ model, analysis, decision } = await judgeRefund({
          images,
          productCount: products.length,
          languageCode,
          reason,
          category,
          userDetails,
          creditsDeducted: row.credits_deducted,
        }));
      }
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
module.exports.refundIneligibleReason = refundIneligibleReason;
module.exports.wasEditedInChat = wasEditedInChat;
module.exports.imageFileKey = imageFileKey;
