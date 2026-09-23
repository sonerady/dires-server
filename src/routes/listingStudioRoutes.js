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
const { GPT25_EDIT_MODEL, buildEditInput, probeImageDims } = require("../utils/gpt25Edit");
const { sendGenerationCompletedNotification } = require("../services/pushNotificationService");
const {
  normalizeImageTypes,
  normalizeMarketplace,
  normalizeStyle,
  buildBriefPrompt,
  parseBrief,
  fallbackBrief,
  buildListingPrompt,
  customSetId,
} = require("../utils/listingPrompts");
const { getListingExampleUrls } = require("../utils/listingExamples");

const { normalizeProductReferences, normalizeBrand, referenceDirection, primaryImageLine } = require("../utils/listingSellerInputs");
const router = express.Router();

// Export only persisted images belonging to this user/job. No client-supplied URLs.
const listingExportsInFlight = new Set();
router.get('/export/:jobId', async (req, res) => {
  const userId = String(req.query.userId || '');
  const preset = String(req.query.preset || 'original');
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  const { EXPORT_PRESETS, createListingArchive } = require('../utils/listingExport');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || !ids.length || ids.length > 12 || new Set(ids).size !== ids.length || !Object.prototype.hasOwnProperty.call(EXPORT_PRESETS, preset)) {
    return res.status(400).json({ success: false, error: 'INVALID_EXPORT_REQUEST' });
  }
  if (listingExportsInFlight.has(userId)) return res.status(429).json({ success: false, error: 'EXPORT_IN_PROGRESS' });
  listingExportsInFlight.add(userId);
  try {
    const { data, error } = await supabase.from('listing_studio_results')
      .select('id,image_type,variant_index,result_image_url,status')
      .eq('user_id', userId).eq('job_id', req.params.jobId).in('id', ids);
    if (error) throw error;
    const byId = new Map((data || []).map(row => [row.id, row]));
    if (ids.some(id => !byId.has(id) || byId.get(id).status !== 'completed' || !byId.get(id).result_image_url)) return res.status(404).json({ success: false, error: 'EXPORT_IMAGES_NOT_FOUND' });
    const { checkUserDownloadAccess, getLastSubscriptionPeriod, addWatermarkToImage } = require('./downloadRoutes');
    const access = await checkUserDownloadAccess(userId);
    const localization = { lang: req.query.lang || access.preferredLanguage, isInTrial: access.isInTrial === true, lastSubPeriod: access.canDownloadOriginal ? null : await getLastSubscriptionPeriod(userId) };
    const archive = await createListingArchive({ rows: ids.map(id => byId.get(id)), preset, getImage: async row => {
      if (!access.canDownloadOriginal) return addWatermarkToImage(row.result_image_url, localization);
      const response = await axios.get(row.result_image_url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 30 * 1024 * 1024 });
      return Buffer.from(response.data);
    } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="diress-listing-' + preset + '.zip"');
    return res.send(archive);
  } catch (error) {
    logger.warn('[LISTING] export failed:', error.message);
    return res.status(500).json({ success: false, error: 'EXPORT_FAILED' });
  } finally { listingExportsInFlight.delete(userId); }
});


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

// 17 Eyl 2026 (kullanıcı kararı): kare başına 5 kredi (istemcideki
// LISTING_CREDIT_PER_IMAGE ile aynı olmalı).
const LISTING_CREDIT_PER_IMAGE = Number(process.env.LISTING_CREDIT_PER_IMAGE || 5);
// 17 Eyl 2026 (kullanıcı isteği): aynı türden birden fazla kare istenebilir
// (ör. özellik infografiği ×3). Tür başına tavan 4, istek başına toplam 12.
const MAX_IMAGES_PER_REQUEST = 12;
const MAX_COUNT_PER_TYPE = 4;
// 17 Eyl 2026: tavan 9→12 çıkınca tek istek 12 paralel GPT Image 2.5 "high"
// çağrısı açıyordu; sağlayıcı hız sınırına takılınca kareler toplu düşüyordu.
const LISTING_CONCURRENCY = Math.max(1, Number(process.env.LISTING_CONCURRENCY || 4));
// 🖼️ Stil örnekleri (17 Eyl 2026): 4 sabit örnek HER karede gidince çıktılar
// aynı tasarım diline yakınsıyordu. Kare başına yalnız birkaçı, rastgele seçilir;
// 0 verilirse hiç gönderilmez.
const LISTING_STYLE_EXAMPLES = Math.max(0, Math.min(4, Number(process.env.LISTING_STYLE_EXAMPLES ?? 2)));
const pickExamples = (urls, count) => {
  if (!count || !urls?.length) return [];
  const pool = urls.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
};
// Bu süreden eski "processing" satırı ölü sayılır (sunucu yeniden başlamış olabilir)
const { listingItemStatus } = require("../utils/listingJobState");
const { mapWithLimit } = require("../utils/concurrency");
const { compareListingFrames } = require("../utils/listingFrameOrder");
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
async function generateOne({ prompt, imageUrl, ratio, exampleUrls = [], sourceSize }) {
  const body = buildEditInput(GPT25_EDIT_MODEL, {
    prompt, image_urls: [imageUrl, ...exampleUrls], aspect_ratio: ratio, source_size: sourceSize,
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

async function buildBrief({ details, marketplace, language, style, imageUrl, contentImages = [], contentDocs = [], frameCounts = {}, productReferences = [], brandProfile = null, primaryRole = "front" }) {
  // 🔢 Çoklu kare istenen her ek kopya brief'e bir "variants" planı daha ekler;
  // sabit 3200 token'da JSON yarıda kesilip TÜM brief fallback'e düşüyordu.
  const extraCopies = Object.values(frameCounts || {})
    .reduce((n, c) => n + Math.max(0, Math.min(MAX_COUNT_PER_TYPE, Math.floor(Number(c) || 1)) - 1), 0);
  const maxOutputTokens = Math.min(8000, 3200 + extraCopies * 420);
  const timeoutMs = (contentImages.length || contentDocs.length || productReferences.length ? 40000 : 25000) + extraCopies * 4000;
  try {
    // 📎 Ek içerik fotoğrafları 2..N. görsel, dosya metinleri prompt'ta "CONTENT FILES"
    const raw = await callStructuredText(
      buildBriefPrompt({ details, marketplace, language, style, contentImageCount: contentImages.length, contentDocs, frameCounts }) + `\n${primaryImageLine(primaryRole)} Do not assume unseen surfaces.\n` + referenceDirection(productReferences, 2 + contentImages.length) + (productReferences.length ? "\nFor legible text in additional product views use source content_image with the exact evidence quote." : "") + (brandProfile ? `\nSaved store identity: ${JSON.stringify(brandProfile)}. Keep this palette and typography across products; never change product colors. This overrides optional creative preferences only.` : ""),
      { maxOutputTokens, imageUrls: [imageUrl, ...contentImages, ...productReferences.map(r => r.url)], timeoutMs },
    );
    const brief = parseBrief(raw, details, (issue) =>
      logger.warn(`🛍️ [LISTING] brief ayrıştırma sorunu (bütçe ${maxOutputTokens}, ek kopya ${extraCopies}): ${issue}`),
      { contentDocs, contentImageCount: contentImages.length + productReferences.length },
    );
    // Sessiz kalite kaybının ikinci kapısı: JSON geçerli ama içi boş
    if (!brief.productName && !(brief.features || []).length && !Object.values(brief.frames || {}).some((f) => f?.concept)) {
      logger.warn(`🛍️ [LISTING] brief boş döndü — kareler yalnız şablon kurallarıyla üretilecek (bütçe ${maxOutputTokens})`);
    }
    return brief;
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
    const marketplace = normalizeMarketplace(options.marketplace);
    // 📝 Özelleştir notları: {_all, <type>} — kısa metin, 400 karakter tavan
    const typeNotes = {};
    if (options.typeNotes && typeof options.typeNotes === "object") {
      for (const [k, v] of Object.entries(options.typeNotes)) {
        if (typeof v === "string" && v.trim()) typeNotes[k] = v.trim().slice(0, 400);
      }
    }
    const productReferences = normalizeProductReferences(options.productReferences, imageUrl);
    // 📎 İçerik girdileri (yalnız brief LLM'ine; görsel modeline gitmez)
    const contentImages = (Array.isArray(options.contentImages) ? options.contentImages : [])
      .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
      .slice(0, MAX_CONTENT_IMAGES);
    const contentDocs = (Array.isArray(options.contentDocs) ? options.contentDocs : [])
      .filter((d) => d && typeof d.text === "string" && d.text.trim())
      .slice(0, MAX_CONTENT_DOCS)
      .map((d) => ({ name: String(d.name || "document").slice(0, 120), text: String(d.text).slice(0, MAX_CONTENT_DOC_CHARS) }));
    // 17 Eyl 2026 (kullanıcı kararı): ürün bilgisi METNİ tek başına zorunlu
    // değil. Metin, içerik fotoğrafı ve PDF birlikte de gidebilir, herhangi
    // biri tek başına da. Brief yazacak LLM'in en az bir girdiye ihtiyacı var.
    if (!details && !contentImages.length && !contentDocs.length && !productReferences.length) {
      return res.status(400).json({
        success: false,
        error: "product details, a content photo or a document is required",
        code: "BAD_REQUEST",
      });
    }
    const primaryRole = ["front", "back", "label", "detail", "auto"].includes(options.primaryRole) ? options.primaryRole : "front";
    const brandProfile = normalizeBrand(options.brandProfile);
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
    const language = String(options.language || brandProfile?.language || "en").split(/[-_]/)[0].toLowerCase();

    // 🎨 Özel setler: tanım İSTEMCİDEN DEĞİL, kullanıcının kendi satırlarından
    // okunur — prompt'a giren metnin sahibi belli olsun.
    const customIds = [...new Set(frames.map((f) => customSetId(f.type)).filter(Boolean))];
    const customSets = {};
    if (customIds.length) {
      const { data: setRows, error: setError } = await supabase
        .from("listing_custom_sets")
        .select("id,label,brief,reference_image_url")
        .eq("user_id", userId)
        .in("id", customIds);
      if (setError) {
        logger.error("🎨 [LISTING] özel setler okunamadı:", setError.message);
        return res.status(500).json({ success: false, error: "DB_READ_FAILED", code: "DB_READ_FAILED" });
      }
      for (const row of setRows || [])
        customSets[row.id] = {
          label: row.label,
          brief: row.brief,
          referenceImageUrl: row.reference_image_url || null,
          hasReference: !!row.reference_image_url,
        };
      const missing = customIds.filter((id) => !customSets[id]);
      if (missing.length)
        return res.status(400).json({ success: false, error: "UNKNOWN_CUSTOM_SET", code: "UNKNOWN_CUSTOM_SET" });
    }

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
    const brief = await buildBrief({ details, marketplace, language, style, imageUrl, contentImages, contentDocs, frameCounts: perType, productReferences, brandProfile, primaryRole });

    // 2) Satırlar (processing) — her tür ayrı kayıt
    // 🖼️ Stil örnekleri (şeritli) — brief ile paralel değil, hızlı (önbellekli)
    const exampleUrls = await getListingExampleUrls(supabase, logger);
    const rows = frames.map((f, index) => {
      const customSet = customSets[customSetId(f.type)] || null;
      const styleExamples = pickExamples(exampleUrls, customSet?.hasReference ? Math.max(0, LISTING_STYLE_EXAMPLES - 1) : LISTING_STYLE_EXAMPLES);
      const referenceImages = [...(customSet?.referenceImageUrl ? [customSet.referenceImageUrl] : []), ...productReferences.map(r => r.url), ...(brandProfile?.logoUrl ? [brandProfile.logoUrl] : []), ...styleExamples];
      return ({
      user_id: userId,
      job_id: jobId,
      image_type: f.type,
      // ⚠️ Tek insert'te tüm satırlar aynı created_at'i alıyor; sıra buradan gelir
      frame_index: index,
      variant_index: f.variantIndex,
      marketplace,
      style,
      ratio: f.ratio,
      language,
      product_details: details,
      brief: { ...brief, productReferences, brandProfile, primaryRole, listingReferenceImages: referenceImages, listingAttemptStartedAt: new Date().toISOString() },
      prompt: buildListingPrompt({
        type: f.type, marketplace, style, brief, language, ratio: f.ratio,
        notes: typeNotes, exampleCount: styleExamples.length,
        variantIndex: f.variantIndex, variantTotal: f.variantTotal,
        customSet, productReferences, brandProfile, primaryRole,
      }),
      source_image_url: imageUrl,
      status: "processing",
    }); });
    const { data: inserted, error: insertError } = await supabase
      .from("listing_studio_results")
      .insert(rows)
      .select("id, image_type, prompt, ratio, frame_index, variant_index, brief");
    if (insertError) {
      logger.error("🛍️ [LISTING] satır ekleme hatası:", insertError.message);
      return res.status(500).json({ success: false, error: "DB_INSERT_FAILED", code: "DB_INSERT_FAILED" });
    }

    // 3) Yanıt HEMEN: istemci jobId ile yoklar
    res.json({
      success: true,
      jobId,
      brief,
      items: inserted
        .slice()
        .sort((a, b) => (a.frame_index ?? 0) - (b.frame_index ?? 0))
        .map((row) => ({ id: row.id, type: row.image_type, ratio: row.ratio, variant: row.variant_index ?? 0, status: "processing", url: null })),
      creditPerImage: LISTING_CREDIT_PER_IMAGE,
    });

    // 4) Arka planda üretim — hepsi eş zamanlı, her kare bitince kendi satırı
    // tür anahtarı ("custom:<id>") → o setin referans görseli
    const customReferences = Object.fromEntries(
      Object.entries(customSets)
        .filter(([, set]) => set.referenceImageUrl)
        .map(([id, set]) => [`custom:${id}`, set.referenceImageUrl]),
    );
    runJobInBackground({ jobId, userId, imageUrl, ratio, inserted, access, startedAt, total: frames.length, exampleUrls, customReferences });
  } catch (e) {
    logger.error("🛍️ [LISTING] generate hatası:", e);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: e?.message || "INTERNAL", code: "INTERNAL" });
    }
  }
});

async function runJobInBackground({ jobId, userId, imageUrl, ratio, inserted, access, startedAt, total, exampleUrls = [], customReferences = {}, notify = true }) {
  try {
    const sourceSize = inserted.some(row => (row.ratio || ratio) === "original") ? await probeImageDims(imageUrl) : null;
    const settled = await mapWithLimit(inserted, LISTING_CONCURRENCY, async (row) => {
        const t0 = Date.now();
        try {
          // Her kare kendi rastgele örnek alt kümesini görür — set içindeki kareler
          // birbirinin tasarım kopyası olmasın diye.
          // 🎨 Özel setin kendi referans görseli varsa bu karenin ilk örneği
          // odur; kalan yerler genel stil örnekleriyle doldurulur.
          const ownReference = customReferences?.[row.image_type] || null;
          const frameExamples = Array.isArray(row.brief?.listingReferenceImages)
            ? row.brief.listingReferenceImages
            : ownReference
            ? [ownReference, ...pickExamples(exampleUrls, Math.max(0, LISTING_STYLE_EXAMPLES - 1))]
            : pickExamples(exampleUrls, LISTING_STYLE_EXAMPLES);
          const { url, provider } = await generateOne({ prompt: row.prompt, imageUrl, ratio: row.ratio || ratio, exampleUrls: frameExamples, sourceSize });
          const storedUrl = await saveResultToUserBucket(url, userId);
          const { error: saveError } = await supabase
            .from("listing_studio_results")
            .update({ status: "completed", result_image_url: storedUrl, provider,
              credits_deducted: 0, processing_time_seconds: Math.round((Date.now() - t0) / 1000),
              completed_at: new Date().toISOString() })
            .eq("id", row.id);
          if (saveError) throw saveError;
          // Billing errors cannot turn an already delivered image into a retryable failure.
          try {
            const ded = await deductCredits(access.creditOwnerId, LISTING_CREDIT_PER_IMAGE);
            if (ded.success) {
              const { error: ledgerError } = await supabase.from("listing_studio_results")
                .update({ credits_deducted: LISTING_CREDIT_PER_IMAGE }).eq("id", row.id);
              if (ledgerError) logger.error("🛍️ [LISTING] credit ledger update failed:", ledgerError.message);
            } else logger.error("🛍️ [LISTING] kredi düşülemedi:", ded.error);
          } catch (billingError) { logger.error("🛍️ [LISTING] billing failed:", billingError.message); }
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
    });
    const done = settled.filter((r) => r.status === "fulfilled" && r.value === true).length;
    // Tekrar denemede bildirim yollanmaz: kullanıcı zaten ekranda, aynı iş için
    // ikinci kez "görselleriniz hazır" bildirimi gitmesin.
    if (done && notify) sendGenerationCompletedNotification(userId, jobId, { source: "listing_studio" }).catch(() => {});
    logger.log(`🛍️ [LISTING] job:${jobId} bitti — ${done}/${total} kare, ${Math.round((Date.now() - startedAt) / 1000)}s`);
  } catch (e) {
    logger.error("🛍️ [LISTING] arka plan işi hatası:", e?.message);
  }
}

/* ───────────────────────── POST /retry ─────────────────────────
   17 Eyl 2026 (kullanıcı isteği): düşen kare AYNI iş kartında yeniden üretilir.
   Yeni jobId/yeni satır açılmaz — mevcut satır processing'e döner, prompt'u ve
   oranı korunur, istemci aynı kartı yoklamaya devam eder. Kredi yine yalnız
   başaran karede düşer. */

router.post("/retry", async (req, res) => {
  const startedAt = Date.now();
  try {
    const { userId, jobId, itemIds } = req.body || {};
    if (!userId || !UUID_RE.test(String(userId))) {
      return res.status(401).json({ success: false, error: "USER_REQUIRED", code: "USER_REQUIRED" });
    }
    if (!/^lst_[0-9]+_[0-9a-f]{8}$/.test(String(jobId))) {
      return res.status(400).json({ success: false, error: "BAD_REQUEST", code: "BAD_REQUEST" });
    }
    const ids = Array.isArray(itemIds)
      ? itemIds.filter((x) => typeof x === "string" && x.length <= 64).slice(0, MAX_IMAGES_PER_REQUEST)
      : null;

    // Düşen kareler + sunucu yeniden başladığı için "processing"de asılı kalmış
    // eski satırlar (30 dk+): ikisi de aynı kartta yeniden üretilebilir olmalı.
    let query = supabase
      .from("listing_studio_results")
      .select("id, image_type, prompt, ratio, source_image_url, status, created_at, frame_index, variant_index, brief")
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .in("status", ["failed", "processing"]);
    if (ids && ids.length) query = query.in("id", ids);
    const { data: found, error } = await query;
    if (error) throw error;
    let rows = (found || [])
      .filter((r) => listingItemStatus(r) === "failed")
      .sort((a, b) => (a.frame_index ?? 0) - (b.frame_index ?? 0));
    if (!rows?.length) {
      return res.status(404).json({ success: false, error: "NO_FAILED_ITEMS", code: "NO_FAILED_ITEMS" });
    }

    const access = await getUserAccess(userId);
    if (!access) {
      return res.status(404).json({ success: false, error: "USER_NOT_FOUND", code: "USER_NOT_FOUND" });
    }
    const totalCost = rows.length * LISTING_CREDIT_PER_IMAGE;
    if (access.creditBalance < totalCost) {
      return res.status(402).json({
        success: false, error: "INSUFFICIENT_CREDITS", code: "INSUFFICIENT_CREDITS",
        required: totalCost, currentCredit: access.creditBalance,
      });
    }

    const imageUrl = rows[0].source_image_url;
    if (!imageUrl) {
      return res.status(409).json({ success: false, error: "SOURCE_MISSING", code: "SOURCE_MISSING" });
    }

    const exampleUrls = await getListingExampleUrls(supabase, logger);
    const customReferences = {};
    const legacyIds = [...new Set(rows.filter(r => !Array.isArray(r.brief?.listingReferenceImages)).map(r => customSetId(r.image_type)).filter(Boolean))];
    if (legacyIds.length) {
      const { data: legacySets, error: legacyError } = await supabase.from("listing_custom_sets").select("id,reference_image_url").eq("user_id", userId).in("id", legacyIds);
      if (legacyError) throw legacyError;
      for (const set of legacySets || []) if (set.reference_image_url) customReferences[`custom:${set.id}`] = set.reference_image_url;
    }

    // Compare-and-swap the previous attempt: two retries cannot claim the same frame.
    const claimed = [];
    for (const row of rows) {
      const nextBrief = { ...(row.brief || {}), listingAttemptStartedAt: new Date().toISOString() };
      let claim = supabase.from("listing_studio_results")
        .update({ status: "processing", error: null, completed_at: null, brief: nextBrief })
        .eq("id", row.id).eq("user_id", userId).eq("status", row.status);
      claim = row.brief == null ? claim.is("brief", null) : claim.eq("brief", JSON.stringify(row.brief));
      const { data: updated, error: claimError } = await claim.select("id");
      if (claimError) logger.error("🛍️ [LISTING] retry claim failed:", claimError.message);
      else if (updated?.length) claimed.push({ ...row, brief: nextBrief });
    }
    rows = claimed;
    if (!rows.length) return res.status(409).json({ success: false, error: "RETRY_NOT_AVAILABLE", code: "RETRY_NOT_AVAILABLE" });

    logger.log(`🔁 [LISTING] job:${jobId} tekrar — ${rows.map((r) => r.image_type).join(",")}`);
    res.json({
      success: true,
      jobId,
      items: rows.map((r) => ({ id: r.id, type: r.image_type, ratio: r.ratio, variant: r.variant_index ?? 0, status: "processing", url: null })),
      creditPerImage: LISTING_CREDIT_PER_IMAGE,
    });

    runJobInBackground({
      jobId, userId, imageUrl, ratio: rows[0].ratio, inserted: rows,
      access, startedAt, total: rows.length, exampleUrls, customReferences, notify: false,
    });
  } catch (e) {
    logger.error("🛍️ [LISTING] retry hatası:", e?.message);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: e?.message || "INTERNAL", code: "INTERNAL" });
    }
  }
});

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
      .select("id, image_type, ratio, frame_index, variant_index, status, result_image_url, error, provider, credits_deducted, created_at, brief")
      .eq("job_id", jobId)
      .eq("user_id", userId);
    if (error) throw error;
    const items = (data || []).slice().sort(compareListingFrames).map((r) => ({
      id: r.id,
      type: r.image_type,
      ratio: r.ratio,
      variant: r.variant_index ?? 0,
      frameIndex: r.frame_index ?? 0,
      status: listingItemStatus(r),
      url: r.result_image_url,
      error: r.error,
      provider: r.provider,
    }));
    if (!items.length) return res.status(404).json({ success: false, error: "JOB_NOT_FOUND" });
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
    // ⚠️ Sınır SATIR değil İŞ bazlı: set başına kare sayısı 8'den 12'ye çıkınca
    // satır sınırı geçmişte gösterilen set sayısını sessizce düşürüyordu.
    const jobLimit = Math.min(40, Math.max(1, Number(req.query.jobs) || 12));
    const rowLimit = Math.min(600, Math.max(1, Number(req.query.limit) || jobLimit * MAX_IMAGES_PER_REQUEST));
    const { data, error } = await supabase
      .from("listing_studio_results")
      .select("id, job_id, image_type, marketplace, style, ratio, frame_index, variant_index, language, source_image_url, result_image_url, status, error, provider, credits_deducted, processing_time_seconds, created_at, completed_at, brief")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(rowLimit);
    if (error) throw error;
    // Yalnız en yeni jobLimit işi döndür — yarım kalmış bir set geçmişte eksik görünmesin
    const order = [];
    for (const row of data || []) if (!order.includes(row.job_id)) order.push(row.job_id);
    const keep = new Set(order.slice(0, jobLimit));
    // İşler yeniden eskiye; bir işin KARELERİ kendi içinde kanonik sırada
    const rank = new Map(order.map((jobId, i) => [jobId, i]));
    const results = (data || [])
      .filter((r) => keep.has(r.job_id))
      .map(({ brief, ...row }) => ({ ...row, status: listingItemStatus({ ...row, brief }) }))
      .sort((a, b) => (rank.get(a.job_id) - rank.get(b.job_id)) || compareListingFrames(a, b));
    return res.json({ success: true, results, jobCount: keep.size });
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

// ─────────────────────────────────────────────────────────────────────────
// 🎨 Özel setler (17 Eyl 2026, kullanıcı isteği)
// Kullanıcı hazır türlerin yanına kendi setini tanımlar: kısa ad + setin ne
// olacağını anlatan serbest metin + isteğe bağlı referans görsel. Kaydedilir,
// sonraki üretimlerde hap olarak seçilebilir. Üretimde tür anahtarı
// "custom:<id>" olur ve prompt yönergesi kullanıcının metninden gelir.
const CUSTOM_LABEL_MAX = 40;
const CUSTOM_BRIEF_MIN = 10;
const CUSTOM_BRIEF_MAX = 1500;

const publicCustomSet = (row) => ({
  id: row.id,
  label: row.label,
  brief: row.brief,
  referenceImageUrl: row.reference_image_url || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get("/custom-sets/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!UUID_RE.test(userId))
      return res.status(400).json({ success: false, error: "BAD_USER" });
    const { data, error } = await supabase
      .from("listing_custom_sets")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(40);
    if (error) throw error;
    res.json({ success: true, sets: (data || []).map(publicCustomSet) });
  } catch (e) {
    logger.error("🎨 [LISTING] özel setler okunamadı:", e?.message || e);
    res.status(500).json({ success: false, error: e?.message || "INTERNAL" });
  }
});

router.post("/custom-sets", async (req, res) => {
  try {
    const { userId, id, label, brief, referenceImageUrl } = req.body || {};
    if (!UUID_RE.test(String(userId || "")))
      return res.status(400).json({ success: false, error: "BAD_USER" });
    const cleanLabel = String(label || "").trim().slice(0, CUSTOM_LABEL_MAX);
    const cleanBrief = String(brief || "").trim().slice(0, CUSTOM_BRIEF_MAX);
    if (!cleanLabel)
      return res.status(400).json({ success: false, error: "LABEL_REQUIRED" });
    if (cleanBrief.length < CUSTOM_BRIEF_MIN)
      return res.status(400).json({ success: false, error: "BRIEF_TOO_SHORT" });
    const reference =
      typeof referenceImageUrl === "string" && /^https?:\/\//i.test(referenceImageUrl)
        ? referenceImageUrl
        : null;
    const payload = {
      user_id: userId,
      label: cleanLabel,
      brief: cleanBrief,
      reference_image_url: reference,
      updated_at: new Date().toISOString(),
    };
    let row;
    if (id && UUID_RE.test(String(id))) {
      const { data, error } = await supabase
        .from("listing_custom_sets")
        .update(payload)
        .eq("id", id)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: "NOT_FOUND" });
      row = data;
    } else {
      const { count } = await supabase
        .from("listing_custom_sets")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .is("archived_at", null);
      if ((count || 0) >= 40)
        return res.status(409).json({ success: false, error: "TOO_MANY_SETS" });
      const { data, error } = await supabase
        .from("listing_custom_sets")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      row = data;
    }
    res.json({ success: true, set: publicCustomSet(row) });
  } catch (e) {
    logger.error("🎨 [LISTING] özel set kaydedilemedi:", e?.message || e);
    res.status(500).json({ success: false, error: e?.message || "INTERNAL" });
  }
});

// Yumuşak silme: geçmiş üretimlerdeki custom:<id> tipleri anlamını yitirmesin.
router.delete("/custom-sets/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const userId = String(req.query.userId || "");
    if (!UUID_RE.test(id) || !UUID_RE.test(userId))
      return res.status(400).json({ success: false, error: "BAD_REQUEST" });
    const { error } = await supabase
      .from("listing_custom_sets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    logger.error("🎨 [LISTING] özel set silinemedi:", e?.message || e);
    res.status(500).json({ success: false, error: e?.message || "INTERNAL" });
  }
});

module.exports = router;
module.exports.__test = { LISTING_CREDIT_PER_IMAGE, SUPPORTED_RATIOS, MAX_IMAGES_PER_REQUEST, MAX_COUNT_PER_TYPE, LISTING_CONCURRENCY, LISTING_STYLE_EXAMPLES };
