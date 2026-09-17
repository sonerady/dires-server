// 🛍️ Listing Image Studio — e-ticaret listeleme görselleri (15 Eyl 2026)
//
// referenceBrowserRoutesV7'nin altyapısından türedi (aynı Supabase istemcisi,
// aynı kredi/ekip modeli, aynı fal sağlayıcıları, aynı kullanıcı bucket'ı) ama
// prompt katmanı moda/model çekimi DEĞİL, e-ticaret listing grameri
// (utils/listingPrompts). Tek istek = seçili görsel türlerinin hepsi eş zamanlı:
// önce ürün notlarından yapılandırılmış brief (LLM), sonra tür başına ayrı
// görüntü üretimi (Promise.allSettled), her kare kendi satırıyla
// `listing_studio_results` tablosuna yazılır.
//
// Model politikası: GPT Image 2.5 Sunburst, quality high. Kredi: görsel başına
// LISTING_CREDIT_PER_IMAGE, yalnız BAŞARILI kareler için, ekip kredisi varsa
// ekip sahibinden (teamService).
//
// Akış ASENKRON: POST /generate satırları açıp jobId döner; üretim arka planda
// sürer, her kare bitince kendi satırı güncellenir. İstemci GET /job/:jobId ile
// yoklar → biten kareler tek tek görünür, hepsinin bitmesi beklenmez.
//
// Erişim: RLS'de anon rolünün tabloya erişimi yok; anonim kullanıcılar da bu
// API üzerinden (service key) okur/yazar. `userId` = users.id (uuid) zorunlu.

const express = require("express");
const axios = require("axios");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { fal } = require("@fal-ai/client");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const teamService = require("../services/teamService");
const { callStructuredText } = require("../utils/promptEnhanceProvider");
const { GPT25_EDIT_MODEL, buildEditInput } = require("../utils/gpt25Edit");
const { sendGenerationCompletedNotification } = require("../services/pushNotificationService");
const {
  normalizeImageTypes,
  normalizeMarketplace,
  normalizeStyle,
  buildBriefPrompt,
  parseBrief,
  fallbackBrief,
  buildListingPrompt,
} = require("../utils/listingPrompts");
const { getListingExampleUrls } = require("../utils/listingExamples");

const router = express.Router();

// 📎 İçerik girdileri: ek fotoğraflar (vision) + PDF/TXT metinleri — brief LLM'ine gider
const MAX_CONTENT_IMAGES = 6;
const MAX_CONTENT_DOCS = 4;
const MAX_CONTENT_DOC_CHARS = 12000;
const CONTENT_DOC_MAX_BYTES = 20 * 1024 * 1024;

/* ───────────────────────── POST /content-doc ─────────────────────────
   📎 PDF / TXT → metin. İstemci dosyayı buraya yükler, çıkarılan metni alır ve
   üretim isteğinde options.contentDocs[{name,text}] olarak geri gönderir
   (dosya saklanmaz). pdf-parse yoksa 501 — `npm i pdf-parse`. */
const contentDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONTENT_DOC_MAX_BYTES, files: 1 },
});

async function extractDocText(file) {
  const name = String(file.originalname || "document");
  const mime = String(file.mimetype || "");
  if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) {
    let pdfParse;
    try {
      // eslint-disable-next-line global-require
      pdfParse = require("pdf-parse");
    } catch (e) {
      const err = new Error("PDF_PARSER_MISSING");
      err.status = 501;
      throw err;
    }
    const out = await pdfParse(file.buffer, { max: 60 });
    return { name, pages: Number(out.numpages || 0), text: String(out.text || "") };
  }
  if (/text\/plain|markdown/i.test(mime) || /\.(txt|md)$/i.test(name)) {
    return { name, pages: 1, text: file.buffer.toString("utf8") };
  }
  const err = new Error("UNSUPPORTED_FILE");
  err.status = 415;
  throw err;
}

router.post("/content-doc", (req, res) => {
  contentDocUpload.single("file")(req, res, async (upErr) => {
    if (upErr) {
      return res.status(413).json({ success: false, error: upErr.code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : upErr.message, code: "UPLOAD_ERROR" });
    }
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ success: false, error: "file is required", code: "BAD_REQUEST" });
      }
      const doc = await extractDocText(req.file);
      const text = doc.text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) {
        return res.status(422).json({ success: false, error: "NO_TEXT_FOUND", code: "NO_TEXT_FOUND" });
      }
      const clipped = text.slice(0, MAX_CONTENT_DOC_CHARS);
      logger.log(`📎 [LISTING] content-doc "${doc.name}" pages:${doc.pages} chars:${text.length}${text.length > clipped.length ? ` (clipped→${clipped.length})` : ""}`);
      return res.json({ success: true, name: doc.name, pages: doc.pages, chars: clipped.length, truncated: text.length > clipped.length, text: clipped });
    } catch (e) {
      const status = e?.status || 500;
      logger.warn("📎 [LISTING] content-doc hata:", e?.message);
      return res.status(status).json({ success: false, error: e?.message || "DOC_ERROR", code: e?.message || "DOC_ERROR" });
    }
  });
});

// ⚠️ SERVICE ROLE şart: listing_studio_results tablosunda anon rolünün hiçbir
// yetkisi yok (RLS). referenceBrowserV7'nin okuduğu SUPABASE_SERVICE_KEY yerel
// .env'de tanımlı değil (orada anon'a düşüyor ve reference_results'ın açık
// RLS'i bunu gizliyordu) — supabaseClient.js'deki admin istemci
// (SUPABASE_SERVICE_ROLE_KEY) kullanılır; yoksa SERVICE_KEY, en son anon.
const { supabaseAdmin } = require("../supabaseClient");
const supabase =
  supabaseAdmin ||
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

const LISTING_CREDIT_PER_IMAGE = Number(process.env.LISTING_CREDIT_PER_IMAGE || 10);
// 17 Eyl 2026 (kullanıcı isteği): aynı türden birden fazla kare istenebilir
// (ör. özellik infografiği ×3). Tür başına tavan 4, istek başına toplam 12.
const MAX_IMAGES_PER_REQUEST = 12;
const MAX_COUNT_PER_TYPE = 4;
const SUPPORTED_RATIOS = new Set(["1:1", "4:5", "3:4", "4:3", "9:16", "16:9", "original"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────── yardımcılar ───────────────────────── */

async function getUserAccess(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("id, is_pro, is_in_trial, credit_balance")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  let effective = { creditBalance: data.credit_balance || 0, creditOwnerId: userId, isTeamCredit: false };
  try {
    const eff = await teamService.getEffectiveCredits(userId);
    if (eff) effective = { ...effective, ...eff };
  } catch (e) {
    logger.warn("🛍️ [LISTING] effective credits okunamadı:", e?.message);
  }
  return {
    isPro: data.is_pro === true,
    isTrial: data.is_in_trial === true,
    creditBalance: Number(effective.creditBalance || 0),
    creditOwnerId: effective.creditOwnerId || userId,
  };
}

async function deductCredits(creditOwnerId, amount) {
  if (!(amount > 0)) return { success: true, newBalance: null };
  const { data, error } = await supabase.rpc("deduct_user_credit", {
    user_id: creditOwnerId,
    credit_amount: amount,
  });
  if (error || data === false || data?.success === false) {
    return { success: false, error: error?.message || "deduct failed" };
  }
  let newBalance = data?.new_balance ?? (typeof data === "number" ? data : null);
  if (newBalance === null) {
    const { data: row } = await supabase.from("users").select("credit_balance").eq("id", creditOwnerId).single();
    newBalance = row?.credit_balance ?? null;
  }
  return { success: true, newBalance };
}

// referenceBrowserV7 saveResultImageToUserBucket ile aynı bucket/düzen
async function saveResultToUserBucket(resultUrl, userId) {
  try {
    const resp = await axios.get(resultUrl, { responseType: "arraybuffer", timeout: 60000, maxContentLength: 60 * 1024 * 1024 });
    const buffer = Buffer.from(resp.data);
    const contentType = String(resp.headers?.["content-type"] || "image/png");
    const ext = /jpe?g/i.test(contentType) ? "jpg" : "png";
    const fileName = `${userId}/${Date.now()}_listing_${uuidv4().slice(0, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("user_image_results")
      .upload(fileName, buffer, { contentType, cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from("user_image_results").getPublicUrl(fileName);
    return data.publicUrl;
  } catch (e) {
    logger.warn("🛍️ [LISTING] bucket kaydı başarısız, sağlayıcı URL'i kullanılıyor:", e?.message);
    return resultUrl;
  }
}

// Listing always uses the explicitly requested Sunburst High quality.
// image_urls: [ürün fotoğrafı, ...şeritli stil örnekleri] — örnekler her üretimde gider
async function generateOne({ prompt, imageUrl, ratio, exampleUrls = [] }) {
  const body = buildEditInput(GPT25_EDIT_MODEL, {
    prompt, image_urls: [imageUrl, ...exampleUrls], aspect_ratio: ratio,
    quality: "high", num_images: 1, output_format: "png",
  });
  const resp = await axios.post(`https://fal.run/${GPT25_EDIT_MODEL}`, body, {
    headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" },
    timeout: 300000,
  });
  const url = resp?.data?.images?.[0]?.url;
  if (!url) throw new Error("Sunburst High returned no image");
  return { url, provider: "gpt-image-2.5:sunburst:high" };
}

async function buildBrief({ details, marketplace, language, style, imageUrl, contentImages = [], contentDocs = [] }) {
  try {
    // 📎 Ek içerik fotoğrafları 2..N. görsel, dosya metinleri prompt'ta "CONTENT FILES"
    const raw = await callStructuredText(
      buildBriefPrompt({ details, marketplace, language, style, contentImageCount: contentImages.length, contentDocs }),
      {
        maxOutputTokens: 3200,
        imageUrls: [imageUrl, ...contentImages],
        timeoutMs: contentImages.length || contentDocs.length ? 40000 : 25000,
      },
    );
    return parseBrief(raw, details);
  } catch (e) {
    logger.warn("🛍️ [LISTING] brief LLM başarısız, ham metinden brief kuruluyor:", e?.message);
    return fallbackBrief(details);
  }
}

/* ───────────────────────── POST /generate ───────────────────────── */

router.post("/generate", async (req, res) => {
  const startedAt = Date.now();
  try {
    const { userId, imageUrl, options = {} } = req.body || {};
    if (!userId || !UUID_RE.test(String(userId))) {
      return res.status(401).json({ success: false, error: "USER_REQUIRED", code: "USER_REQUIRED" });
    }
    if (!imageUrl || !/^https?:\/\//i.test(String(imageUrl))) {
      return res.status(400).json({ success: false, error: "imageUrl is required", code: "BAD_REQUEST" });
    }
    const imageTypes = normalizeImageTypes(options.imageTypes).slice(0, MAX_IMAGES_PER_REQUEST);
    if (!imageTypes.length) {
      return res.status(400).json({ success: false, error: "imageTypes is required", code: "BAD_REQUEST" });
    }
    const details = String(options.details || "").trim();
    if (!details) {
      return res.status(400).json({ success: false, error: "details is required", code: "BAD_REQUEST" });
    }
    const marketplace = normalizeMarketplace(options.marketplace);
    // 📝 Özelleştir notları: {_all, <type>} — kısa metin, 400 karakter tavan
    const typeNotes = {};
    if (options.typeNotes && typeof options.typeNotes === "object") {
      for (const [k, v] of Object.entries(options.typeNotes)) {
        if (typeof v === "string" && v.trim()) typeNotes[k] = v.trim().slice(0, 400);
      }
    }
    // 📎 İçerik girdileri (yalnız brief LLM'ine; görsel modeline gitmez)
    const contentImages = (Array.isArray(options.contentImages) ? options.contentImages : [])
      .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
      .slice(0, MAX_CONTENT_IMAGES);
    const contentDocs = (Array.isArray(options.contentDocs) ? options.contentDocs : [])
      .filter((d) => d && typeof d.text === "string" && d.text.trim())
      .slice(0, MAX_CONTENT_DOCS)
      .map((d) => ({ name: String(d.name || "document").slice(0, 120), text: String(d.text).slice(0, MAX_CONTENT_DOC_CHARS) }));
    const style = normalizeStyle(options.style);
    const ratio = SUPPORTED_RATIOS.has(options.ratio) ? options.ratio : "1:1";
    // 🔢 Tür başına adet ({features:3}) ve tür başına oran ({hero:"1:1"}) —
    // ikisi de isteğe bağlı; yoksa adet 1, oran setin varsayılanı.
    const typeCounts = {};
    if (options.typeCounts && typeof options.typeCounts === "object") {
      for (const [k, v] of Object.entries(options.typeCounts)) {
        const n = Math.floor(Number(v));
        if (imageTypes.includes(k) && Number.isFinite(n) && n > 1) typeCounts[k] = Math.min(MAX_COUNT_PER_TYPE, n);
      }
    }
    const typeRatios = {};
    if (options.typeRatios && typeof options.typeRatios === "object") {
      for (const [k, v] of Object.entries(options.typeRatios)) {
        if (imageTypes.includes(k) && SUPPORTED_RATIOS.has(v) && v !== ratio) typeRatios[k] = v;
      }
    }
    // Plan: sırayı koru, toplam tavanda kes, sonra tür başına gerçek adedi say
    const plan = [];
    for (const type of imageTypes) {
      const count = Math.min(MAX_COUNT_PER_TYPE, Math.max(1, typeCounts[type] || 1));
      for (let i = 0; i < count; i++) plan.push({ type, ratio: typeRatios[type] || ratio });
    }
    const frames = plan.slice(0, MAX_IMAGES_PER_REQUEST);
    const perType = frames.reduce((acc, f) => ({ ...acc, [f.type]: (acc[f.type] || 0) + 1 }), {});
    const seen = {};
    for (const f of frames) {
      f.variantIndex = seen[f.type] = seen[f.type] === undefined ? 0 : seen[f.type] + 1;
      f.variantTotal = perType[f.type];
    }
    const language = String(options.language || "en").split(/[-_]/)[0].toLowerCase();

    const access = await getUserAccess(userId);
    if (!access) {
      return res.status(404).json({ success: false, error: "USER_NOT_FOUND", code: "USER_NOT_FOUND" });
    }
    const totalCost = frames.length * LISTING_CREDIT_PER_IMAGE;
    // 🔒 Kapı: PRO/deneme YA DA yeterli kredi. PRO'da da kredi düşer (CMP mantığı),
    // yalnız bakiye yetmiyorsa PRO olmayan reddedilir.
    if (access.creditBalance < totalCost) {
      return res.status(402).json({
        success: false,
        error: "INSUFFICIENT_CREDITS",
        code: "INSUFFICIENT_CREDITS",
        required: totalCost,
        currentCredit: access.creditBalance,
      });
    }

    const jobId = `lst_${Date.now()}_${uuidv4().slice(0, 8)}`;
    logger.log(`🛍️ [LISTING] job:${jobId} user:${String(userId).slice(0, 8)} market:${marketplace} style:${style} ratio:${ratio} frames:${frames.length} types:${frames.map((f) => `${f.type}${f.variantTotal > 1 ? `#${f.variantIndex + 1}` : ""}${f.ratio !== ratio ? `@${f.ratio}` : ""}`).join(",")} contentImages:${contentImages.length} contentDocs:${contentDocs.length}`);

    // 1) Brief (ürün notları + içerik fotoğrafları/dosyaları → yapılandırılmış metin)
    const brief = await buildBrief({ details, marketplace, language, style, imageUrl, contentImages, contentDocs });

    // 2) Satırlar (processing) — her tür ayrı kayıt
    // 🖼️ Stil örnekleri (şeritli) — brief ile paralel değil, hızlı (önbellekli)
    const exampleUrls = await getListingExampleUrls(supabase, logger);
    const rows = frames.map((f) => ({
      user_id: userId,
      job_id: jobId,
      image_type: f.type,
      marketplace,
      style,
      ratio: f.ratio,
      language,
      product_details: details,
      brief,
      prompt: buildListingPrompt({
        type: f.type, marketplace, style, brief, language, ratio: f.ratio,
        notes: typeNotes, exampleCount: exampleUrls.length,
        variantIndex: f.variantIndex, variantTotal: f.variantTotal,
      }),
      source_image_url: imageUrl,
      status: "processing",
    }));
    const { data: inserted, error: insertError } = await supabase
      .from("listing_studio_results")
      .insert(rows)
      .select("id, image_type, prompt, ratio");
    if (insertError) {
      logger.error("🛍️ [LISTING] satır ekleme hatası:", insertError.message);
      return res.status(500).json({ success: false, error: "DB_INSERT_FAILED", code: "DB_INSERT_FAILED" });
    }

    // 3) Yanıt HEMEN: istemci jobId ile yoklar
    res.json({
      success: true,
      jobId,
      brief,
      items: inserted.map((row) => ({ id: row.id, type: row.image_type, ratio: row.ratio, status: "processing", url: null })),
      creditPerImage: LISTING_CREDIT_PER_IMAGE,
    });

    // 4) Arka planda üretim — hepsi eş zamanlı, her kare bitince kendi satırı
    runJobInBackground({ jobId, userId, imageUrl, ratio, inserted, access, startedAt, total: frames.length, exampleUrls });
  } catch (e) {
    logger.error("🛍️ [LISTING] generate hatası:", e);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: e?.message || "INTERNAL", code: "INTERNAL" });
    }
  }
});

async function runJobInBackground({ jobId, userId, imageUrl, ratio, inserted, access, startedAt, total, exampleUrls = [] }) {
  try {
    const settled = await Promise.allSettled(
      inserted.map(async (row) => {
        const t0 = Date.now();
        try {
          const { url, provider } = await generateOne({ prompt: row.prompt, imageUrl, ratio: row.ratio || ratio, exampleUrls });
          const storedUrl = await saveResultToUserBucket(url, userId);
          // Kredi: kare bazında, kare biter bitmez (başarısız kareye ücret yok)
          let charged = 0;
          const ded = await deductCredits(access.creditOwnerId, LISTING_CREDIT_PER_IMAGE);
          if (ded.success) charged = LISTING_CREDIT_PER_IMAGE;
          else logger.error("🛍️ [LISTING] kredi düşülemedi:", ded.error);
          await supabase
            .from("listing_studio_results")
            .update({
              status: "completed",
              result_image_url: storedUrl,
              provider,
              credits_deducted: charged,
              processing_time_seconds: Math.round((Date.now() - t0) / 1000),
              completed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          logger.log(`🛍️ [LISTING] job:${jobId} ${row.image_type} tamam (${provider}, ${Math.round((Date.now() - t0) / 1000)}s)`);
          return true;
        } catch (e) {
          await supabase
            .from("listing_studio_results")
            .update({ status: "failed", error: String(e?.message || e).slice(0, 500) })
            .eq("id", row.id);
          logger.warn(`🛍️ [LISTING] job:${jobId} ${row.image_type} başarısız: ${e?.message}`);
          return false;
        }
      }),
    );
    const done = settled.filter((r) => r.status === "fulfilled" && r.value === true).length;
    if (done) sendGenerationCompletedNotification(userId, jobId, { source: "listing_studio" }).catch(() => {});
    logger.log(`🛍️ [LISTING] job:${jobId} bitti — ${done}/${total} kare, ${Math.round((Date.now() - startedAt) / 1000)}s`);
  } catch (e) {
    logger.error("🛍️ [LISTING] arka plan işi hatası:", e?.message);
  }
}

/* ───────────────────────── GET /job/:jobId ───────────────────────── */

router.get("/job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const { userId } = req.query;
    if (!/^lst_[0-9]+_[0-9a-f]{8}$/.test(String(jobId)) || !UUID_RE.test(String(userId))) {
      return res.status(400).json({ success: false, error: "BAD_REQUEST" });
    }
    const { data, error } = await supabase
      .from("listing_studio_results")
      .select("id, image_type, ratio, status, result_image_url, error, provider, credits_deducted")
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const items = (data || []).map((r) => ({
      id: r.id,
      type: r.image_type,
      ratio: r.ratio,
      status: r.status,
      url: r.result_image_url,
      error: r.error,
      provider: r.provider,
    }));
    const finished = items.every((i) => i.status === "completed" || i.status === "failed");
    let creditBalance = null;
    if (finished) {
      try {
        const eff = await teamService.getEffectiveCredits(userId);
        if (typeof eff?.creditBalance === "number") creditBalance = eff.creditBalance;
      } catch (e) {}
    }
    return res.json({ success: true, jobId, items, finished, creditBalance });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || "INTERNAL" });
  }
});

/* ───────────────────────── GET /results/:userId ───────────────────────── */

router.get("/results/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(String(userId))) {
      return res.status(400).json({ success: false, error: "BAD_USER_ID" });
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const { data, error } = await supabase
      .from("listing_studio_results")
      .select("id, job_id, image_type, marketplace, style, ratio, language, source_image_url, result_image_url, status, error, provider, credits_deducted, processing_time_seconds, created_at, completed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.json({ success: true, results: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || "INTERNAL" });
  }
});

/* ───────────────────────── DELETE /result/:id ───────────────────────── */

router.delete("/result/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body || {};
    if (!UUID_RE.test(String(id)) || !UUID_RE.test(String(userId))) {
      return res.status(400).json({ success: false, error: "BAD_REQUEST" });
    }
    // Sahiplik: satır bu kullanıcıya ait olmalı (service key RLS'i atladığı için burada)
    const { data, error } = await supabase
      .from("listing_studio_results")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ success: false, error: "NOT_FOUND" });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || "INTERNAL" });
  }
});

module.exports = router;
module.exports.__test = { LISTING_CREDIT_PER_IMAGE, SUPPORTED_RATIOS, MAX_IMAGES_PER_REQUEST, MAX_COUNT_PER_TYPE };
