// 💳 Kredi iadesi (15 Eyl 2026, kullanıcı isteği)
//
//   GET  /api/credit-refund/status?userId&generationId  → buton durumu (uygun mu, önceki karar)
//   POST /api/credit-refund/analyze {userId, generationId, languageCode}
//        → ürün + sonuç etiketlenir → Gemini analizi → sunucu kararı → kredi iadesi (atomik RPC)
//
// Kurallar: üretim başına TEK talep (DB unique), günlük sınır ve azami yaş app_config'ten
// (refund_enabled / refund_daily_limit / refund_max_age_days, 60 sn önbellek).
// Kredi, kaydı düşülen tutar (reference_results.credits_deducted) üzerinden iade edilir.
const express = require("express");
const axios = require("axios");
const { rateLimit } = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const { supabaseAdmin, supabase } = require("../supabaseClient");
const teamService = require("../services/teamService");
const logger = require("../utils/logger");
const {
  buildAnalysisPrompt, parseAnalysis, decideRefund, labelImage, PRODUCT_LABEL, RESULT_LABEL,
  callRefundVision, extractProductUrls,
} = require("../utils/creditRefundAnalysis");

const router = express.Router();
const db = supabaseAdmin || supabase;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── app_config (60 sn önbellek) ───
const DEFAULT_CONFIG = { enabled: true, dailyLimit: 3, maxAgeDays: 14 };
let configCache = { at: 0, value: DEFAULT_CONFIG };
async function getRefundConfig() {
  if (Date.now() - configCache.at < 60000) return configCache.value;
  try {
    const { data } = await db.from("app_config").select("refund_enabled, refund_daily_limit, refund_max_age_days").limit(1).maybeSingle();
    if (data) {
      configCache = { at: Date.now(), value: {
        enabled: data.refund_enabled !== false,
        dailyLimit: Number.isFinite(data.refund_daily_limit) ? data.refund_daily_limit : DEFAULT_CONFIG.dailyLimit,
        maxAgeDays: Number.isFinite(data.refund_max_age_days) ? data.refund_max_age_days : DEFAULT_CONFIG.maxAgeDays,
      } };
    } else configCache = { at: Date.now(), value: DEFAULT_CONFIG };
  } catch (_) { configCache = { at: Date.now(), value: configCache.value }; }
  return configCache.value;
}

async function loadGeneration(userId, generationId) {
  const id = String(generationId);
  let q = db.from("reference_results")
    .select("id, generation_id, user_id, result_image_url, pre_upscale_image_url, reference_images, credits_deducted, status, created_at, settings")
    .eq("user_id", userId);
  q = UUID_RE.test(id) ? q.or(`generation_id.eq.${id},id.eq.${id}`) : q.eq("generation_id", id);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

async function loadExisting(userId, generationId) {
  const { data, error } = await db.from("credit_refund_requests")
    .select("id, status, verdict, product_match, render_quality, refund_percent, refunded_credits, defects, summary, created_at")
    .eq("user_id", userId).eq("generation_id", String(generationId)).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function countToday(userId) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await db.from("credit_refund_requests")
    .select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since).neq("status", "error");
  if (error) throw error;
  return count || 0;
}

const publicRequest = (row) => row && ({
  status: row.status, verdict: row.verdict, productMatch: row.product_match, renderQuality: row.render_quality,
  refundPercent: row.refund_percent, refundedCredits: row.refunded_credits, defects: row.defects || [],
  summary: row.summary, createdAt: row.created_at,
});

/** Uygunluk kontrolü — status ucu ve analyze aynı mantığı kullanır. */
async function checkEligibility(userId, generationId) {
  const config = await getRefundConfig();
  if (!config.enabled) return { eligible: false, reason: "disabled", config };
  const existing = await loadExisting(userId, generationId);
  if (existing && existing.status !== "error") return { eligible: false, reason: "already_requested", existing, config };
  const gen = await loadGeneration(userId, generationId);
  if (!gen) return { eligible: false, reason: "not_found", config };
  if (!gen.result_image_url) return { eligible: false, reason: "no_result", config, gen };
  const deducted = Math.max(0, Number(gen.credits_deducted) || 0);
  if (deducted <= 0) return { eligible: false, reason: "no_charge", config, gen };
  const ageDays = (Date.now() - Date.parse(gen.created_at)) / 86400000;
  if (Number.isFinite(ageDays) && ageDays > config.maxAgeDays) return { eligible: false, reason: "too_old", config, gen };
  const productUrls = extractProductUrls(gen.reference_images);
  if (!productUrls.length) return { eligible: false, reason: "no_product_photo", config, gen };
  const used = await countToday(userId);
  if (used >= config.dailyLimit) return { eligible: false, reason: "daily_limit", config, gen, dailyRemaining: 0 };
  return { eligible: true, reason: "ok", config, gen, productUrls, creditsDeducted: deducted, dailyRemaining: config.dailyLimit - used };
}

router.get("/status", async (req, res) => {
  try {
    const { userId, generationId } = req.query;
    if (!UUID_RE.test(String(userId || "")) || !generationId) return res.status(400).json({ success: false, error: "userId ve generationId gerekli" });
    const e = await checkEligibility(userId, generationId);
    return res.json({
      success: true, eligible: e.eligible, reason: e.reason,
      creditsDeducted: e.creditsDeducted ?? (e.gen ? Math.max(0, Number(e.gen.credits_deducted) || 0) : null),
      dailyRemaining: e.dailyRemaining ?? null, dailyLimit: e.config.dailyLimit,
      existing: publicRequest(e.existing),
    });
  } catch (err) {
    logger.error("💳 [CREDIT_REFUND] status hata:", err.message);
    return res.status(500).json({ success: false, error: "status failed" });
  }
});

const analyzeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 6, standardHeaders: "draft-7", legacyHeaders: false });

async function fetchBuffer(url) {
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  return Buffer.from(r.data);
}
async function uploadAnalysisImage(buffer, userId, tag) {
  const fileName = `refund-analysis/${userId}/${Date.now()}_${tag}_${uuidv4().slice(0, 8)}.jpg`;
  const { error } = await db.storage.from("reference").upload(fileName, buffer, { contentType: "image/jpeg" });
  if (error) throw error;
  return db.storage.from("reference").getPublicUrl(fileName).data.publicUrl;
}

router.post("/analyze", analyzeLimiter, async (req, res) => {
  const started = Date.now();
  const { userId, generationId, languageCode } = req.body || {};
  if (!UUID_RE.test(String(userId || "")) || !generationId) return res.status(400).json({ success: false, error: "userId ve generationId gerekli" });
  let requestId = null;
  try {
    const e = await checkEligibility(userId, generationId);
    if (!e.eligible) {
      return res.status(e.reason === "already_requested" ? 200 : 409).json({
        success: e.reason === "already_requested", eligible: false, reason: e.reason, existing: publicRequest(e.existing),
      });
    }
    const { gen, productUrls, creditsDeducted } = e;
    const resultUrl = gen.pre_upscale_image_url || gen.result_image_url;

    // 1) Kayıt aç (unique → yarış durumunda ikinci istek burada düşer)
    const { data: inserted, error: insErr } = await db.from("credit_refund_requests").insert({
      user_id: userId, generation_id: String(generationId), result_image_url: resultUrl, product_image_urls: productUrls,
      credits_deducted: creditsDeducted, status: "analyzing", language_code: String(languageCode || "en").slice(0, 10),
    }).select("id").single();
    if (insErr) {
      if (String(insErr.code) === "23505") {
        const ex = await loadExisting(userId, generationId);
        return res.json({ success: true, eligible: false, reason: "already_requested", existing: publicRequest(ex) });
      }
      throw insErr;
    }
    requestId = inserted.id;

    // 2) Etiketli görseller (ürünler mavi, sonuç kırmızı şerit)
    const labeled = [];
    for (let i = 0; i < productUrls.length; i++) {
      labeled.push(await labelImage(await fetchBuffer(productUrls[i]), PRODUCT_LABEL(i + 1, productUrls.length)));
    }
    labeled.push(await labelImage(await fetchBuffer(resultUrl), RESULT_LABEL()));
    const analysisUrls = [];
    for (let i = 0; i < labeled.length; i++) {
      analysisUrls.push(await uploadAnalysisImage(labeled[i], userId, i < productUrls.length ? `product${i + 1}` : "result"));
    }

    // 3) Gemini analizi
    const prompt = buildAnalysisPrompt({ languageCode, productCount: productUrls.length });
    const { model, raw } = await callRefundVision(prompt, analysisUrls);
    const analysis = parseAnalysis(raw);
    if (!analysis) throw new Error("Analiz çıktısı çözümlenemedi");

    // 4) Karar + iade
    const decision = decideRefund(analysis, creditsDeducted);
    let newBalance = null;
    if (decision.credits > 0) {
      const eff = await teamService.getEffectiveCredits(userId).catch(() => null);
      const owner = eff?.creditOwnerId || userId;
      const { data: rpc, error: rpcErr } = await db.rpc("refund_user_credit", { user_id: owner, credit_amount: decision.credits });
      if (rpcErr || !rpc || rpc.success === false) throw new Error(`Kredi iadesi yazılamadı: ${rpcErr?.message || rpc?.error || "unknown"}`);
      newBalance = rpc.new_balance;
    }

    const row = {
      status: decision.status, verdict: decision.outcome, product_match: analysis.productMatch, render_quality: analysis.renderQuality,
      confidence: analysis.confidence, refund_percent: decision.percent, refunded_credits: decision.credits, defects: analysis.defects,
      summary: analysis.summary, model, raw_response: { raw, verdict: analysis.verdict }, analysis_image_urls: analysisUrls,
      updated_at: new Date().toISOString(),
    };
    await db.from("credit_refund_requests").update(row).eq("id", requestId);
    logger.log(`💳 [CREDIT_REFUND] ${userId} gen=${generationId} match=${analysis.productMatch} quality=${analysis.renderQuality} ` +
      `verdict=${analysis.verdict}(${analysis.confidence}) → ${decision.outcome} ${decision.credits}/${creditsDeducted} kredi (${model}, ${Date.now() - started}ms)`);

    return res.json({
      success: true, eligible: true, reason: "ok",
      status: decision.status, verdict: decision.outcome, refundPercent: decision.percent, refundedCredits: decision.credits,
      creditsDeducted, productMatch: analysis.productMatch, renderQuality: analysis.renderQuality, confidence: analysis.confidence,
      defects: analysis.defects, summary: analysis.summary, newBalance, model,
    });
  } catch (err) {
    logger.error("💳 [CREDIT_REFUND] analyze hata:", err.message);
    // Hatalı kaydı "error" olarak işaretle → kullanıcı yeniden deneyebilsin (unique çakışmasın diye silinir)
    if (requestId) await db.from("credit_refund_requests").delete().eq("id", requestId).then(() => {}, () => {});
    return res.status(502).json({ success: false, reason: "analysis_failed", error: "Analiz tamamlanamadı, lütfen tekrar dene." });
  }
});

module.exports = router;
module.exports._test = { checkEligibility, getRefundConfig };
