// 💳 Kredi iadesi analizi (15 Eyl 2026, kullanıcı isteği)
//
// Kullanıcı SimpleImageModal'daki "Kredi iadesi" butonuna basınca: üretimin ÜRÜN
// fotoğrafları + SONUÇ görseli, üstlerine kim olduklarını söyleyen renkli bir şerit
// basılarak (ORIGINAL PRODUCT #k / AI RESULT) Replicate üzerinden Gemini'ye gönderilir.
// Model yalnız iki şeye bakar: (1) ürün birebir mi (renk/desen/kesim/detay),
// (2) görsel teknik olarak bozuk mu (anatomi, artefakt, kesik ürün...). Stil, poz,
// mekân, manken beğenisi iade sebebi DEĞİLDİR — prompt bunu açıkça yasaklar.
// Karar (tam / kısmi / yok) modelin verdict'ine KÖRÜ KÖRÜNE değil, sunucudaki
// eşiklere göre verilir (decideRefund) — böylece tutarlı ve test edilebilir.
const axios = require("axios");
const path = require("path");
// sharp/canvas yerel modüller: yalnız etiketleme anında yüklenir (testler ve
// mimarisi farklı ortamlar saf fonksiyonları yine kullanabilsin).

// Öncelik: env → Gemini 3 Pro (kullanıcı isteği) → 3.1 Pro → 3 Flash yedekleri
const REFUND_MODELS = [
  process.env.REFUND_ANALYSIS_MODEL,
  "google/gemini-3-pro",
  "google/gemini-3.1-pro",
  "google/gemini-3-flash",
].filter((m, i, arr) => m && arr.indexOf(m) === i);

const DEFECTS = [
  "wrong_color", "wrong_pattern", "wrong_shape", "missing_details", "changed_product", "extra_product",
  "distorted_anatomy", "deformed_garment", "artifacts", "blur", "cropped_product", "broken_text_logo", "other",
];
const VERDICTS = ["refund_full", "refund_partial", "no_refund"];

// Eşikler (ürün eşleşmesi / görsel kalitesi 0-100)
const THRESHOLDS = {
  fullMatch: 50,      // ürün eşleşmesi bunun altındaysa TAM iade
  fullQuality: 40,    // görsel kalitesi bunun altındaysa TAM iade
  partialMatch: 75,   // bunun altındaysa KISMİ iade
  partialQuality: 60,
  partialPercent: 50,
  minConfidence: 0.5, // modelin "refund_full" demesi ancak bu güvenle geçerli
};

const LANGUAGE_NAMES = {
  tr: "Turkish", en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese",
  ru: "Russian", ar: "Arabic", ja: "Japanese", ko: "Korean", zh: "Chinese", nl: "Dutch", pl: "Polish",
  sv: "Swedish", da: "Danish", no: "Norwegian", fi: "Finnish", cs: "Czech", el: "Greek", he: "Hebrew",
  hi: "Hindi", id: "Indonesian", ms: "Malay", th: "Thai", vi: "Vietnamese", uk: "Ukrainian", ro: "Romanian",
  hu: "Hungarian", bg: "Bulgarian", hr: "Croatian", sk: "Slovak", sl: "Slovenian", sr: "Serbian", fa: "Persian",
  ur: "Urdu", bn: "Bengali", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", mr: "Marathi",
  gu: "Gujarati", pa: "Punjabi", az: "Azerbaijani", kk: "Kazakh", uz: "Uzbek", ka: "Georgian", hy: "Armenian",
  et: "Estonian", lv: "Latvian", lt: "Lithuanian", ca: "Catalan", fil: "Filipino", sw: "Swahili", af: "Afrikaans",
};
const languageName = (code) => LANGUAGE_NAMES[String(code || "en").toLowerCase().split("-")[0]] || "English";

function buildAnalysisPrompt({ languageCode = "en", productCount = 1 } = {}) {
  const lang = languageName(languageCode);
  return `You are the quality auditor of Diress, an AI fashion photoshoot app. A user paid credits for an AI-generated photo and requests a refund. Decide STRICTLY on two things: (1) does the AI RESULT reproduce the user's ORIGINAL PRODUCT faithfully, (2) is the AI RESULT technically usable.

You receive ${productCount + 1} images. The first ${productCount} carry a BLUE banner "ORIGINAL PRODUCT PHOTO #k" — the real product (ground truth). The LAST image carries a RED banner "AI RESULT" — the generated output you must audit. The banners are labels only; ignore them when scoring.

Score the AI RESULT:
- product_match (0-100): same product type, cut/silhouette, color and shade, pattern/print placement, material/texture, logos/text, distinctive details (buttons, zippers, straps, hardware, trims)? 100 = identical; 70-85 = same item with small deviations; 50-69 = clearly noticeable deviations (wrong shade, changed pattern, missing detail); below 50 = different or badly altered product.
- render_quality (0-100): anatomy (hands, limbs, face), deformed garment, melted/duplicated parts, artifacts, blur, product cut off, broken text/logo. 100 = flawless.
- defects: only from this list: ${DEFECTS.join(", ")}.
- Things that are NOT refund reasons and MUST NOT lower any score: the model's face/body/age/pose, background, location, lighting mood, styling, camera angle, framing choices, or the user's taste. Natural differences caused by wearing the garment (folds, drape, perspective, lighting on fabric, slight color shift from lighting) are normal, not defects.
- verdict: "refund_full" if the product is different/unrecognizable OR the image is unusable; "refund_partial" if it is the same product but with clearly noticeable fidelity errors or visible defects; otherwise "no_refund".
- confidence: 0-1.
- summary: 1-2 concrete sentences addressed to the user, written in ${lang}. No apologies, no marketing. If no refund, state briefly that the product matches and the image is technically sound.

Return ONLY this JSON, nothing else:
{"product_match": <int>, "render_quality": <int>, "defects": [<strings>], "verdict": "<refund_full|refund_partial|no_refund>", "confidence": <float>, "summary": "<text>"}`;
}

/** Model çıktısını güvenli değerlere indirger. */
function parseAnalysis(raw) {
  const text = String(raw || "");
  let obj = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) obj = JSON.parse(m[0]);
  } catch (_) {}
  if (!obj || typeof obj !== "object") return null;
  const clamp = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : null; };
  const productMatch = clamp(obj.product_match, 0, 100);
  const renderQuality = clamp(obj.render_quality, 0, 100);
  if (productMatch == null || renderQuality == null) return null;
  const defects = (Array.isArray(obj.defects) ? obj.defects : [])
    .map((d) => String(d || "").trim().toLowerCase())
    .filter((d, i, a) => DEFECTS.includes(d) && a.indexOf(d) === i);
  const verdict = VERDICTS.includes(obj.verdict) ? obj.verdict : "no_refund";
  const confRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5;
  const summary = String(obj.summary || "").trim().slice(0, 400) || null;
  return { productMatch, renderQuality, defects, verdict, confidence, summary };
}

/** Sunucu tarafı karar — modelin verdict'i tek başına belirleyici değildir. */
function decideRefund(analysis, creditsDeducted) {
  const deducted = Math.max(0, Number(creditsDeducted) || 0);
  const { productMatch, renderQuality, verdict, confidence } = analysis;
  const modelFull = verdict === "refund_full" && confidence >= THRESHOLDS.minConfidence;
  const modelPartial = verdict === "refund_partial" && confidence >= THRESHOLDS.minConfidence;
  let percent = 0;
  if (modelFull || productMatch < THRESHOLDS.fullMatch || renderQuality < THRESHOLDS.fullQuality) percent = 100;
  else if (modelPartial || productMatch < THRESHOLDS.partialMatch || renderQuality < THRESHOLDS.partialQuality) percent = THRESHOLDS.partialPercent;
  let credits = percent > 0 ? Math.ceil((deducted * percent) / 100) : 0;
  if (percent > 0 && deducted > 0 && credits < 1) credits = 1;
  const outcome = percent === 100 ? "refund_full" : percent > 0 ? "refund_partial" : "no_refund";
  return { percent, credits, outcome, status: credits > 0 ? "refunded" : "rejected" };
}

// ─── Etiketli görsel: üstte renkli şerit + büyük beyaz yazı ───
const LABEL_FONT = "DiressRefundLabel";
let nativeMods = null;
function native() {
  if (nativeMods) return nativeMods;
  const sharp = require("sharp");
  const { createCanvas, loadImage, registerFont } = require("canvas");
  try {
    registerFont(path.join(__dirname, "../assets/fonts/ArchivoBlack-Regular.ttf"), { family: LABEL_FONT });
  } catch (e) {
    console.warn("⚠️ [CREDIT_REFUND] etiket fontu yüklenemedi:", e.message);
  }
  nativeMods = { sharp, createCanvas, loadImage };
  return nativeMods;
}

/**
 * @param {Buffer} imageBuffer
 * @param {{title:string, subtitle?:string, color:string}} label
 * @returns {Promise<Buffer>} JPEG
 */
async function labelImage(imageBuffer, { title, subtitle = "", color = "#DC2626" }) {
  const { sharp, createCanvas, loadImage } = native();
  // Token/boyut için 1024px genişliğe indir
  const base = await sharp(imageBuffer).rotate().resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const img = await loadImage(base);
  const W = img.width, H = img.height;
  const strip = Math.max(64, Math.round(W * 0.11));
  const canvas = createCanvas(W, H + strip);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color; ctx.fillRect(0, 0, W, strip);
  ctx.drawImage(img, 0, strip, W, H);
  ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const titleSize = Math.round(strip * (subtitle ? 0.42 : 0.5));
  ctx.font = `${titleSize}px "${LABEL_FONT}"`;
  ctx.fillText(title, Math.round(W * 0.03), subtitle ? Math.round(strip * 0.36) : Math.round(strip / 2));
  if (subtitle) {
    ctx.font = `${Math.round(strip * 0.24)}px "${LABEL_FONT}"`;
    ctx.globalAlpha = 0.9;
    ctx.fillText(subtitle, Math.round(W * 0.03), Math.round(strip * 0.74));
    ctx.globalAlpha = 1;
  }
  // Çerçeve: aynı renkte ince kenar — görselin hangi gruba ait olduğu kenardan da okunur
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(6, Math.round(W * 0.008));
  ctx.strokeRect(ctx.lineWidth / 2, strip, W - ctx.lineWidth, H - ctx.lineWidth / 2);
  return canvas.toBuffer("image/jpeg", { quality: 0.9 });
}

const PRODUCT_LABEL = (k, n) => ({ title: `ORIGINAL PRODUCT PHOTO #${k}`, subtitle: n > 1 ? `Ground truth ${k} of ${n} — the real product` : "Ground truth — the real product", color: "#2563EB" });
const RESULT_LABEL = () => ({ title: "AI RESULT", subtitle: "Generated image — AUDIT THIS against the product", color: "#DC2626" });

/** Replicate Gemini (model yedekli). Görsel URL'leri sırayla: ürünler..., sonuç. */
async function callRefundVision(prompt, imageUrls, { timeoutMs = 120000 } = {}) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  let lastError;
  for (const model of REFUND_MODELS) {
    try {
      const res = await axios.post(
        `https://api.replicate.com/v1/models/${model}/predictions`,
        { input: { prompt, images: imageUrls, temperature: 0.1, max_output_tokens: 1024 } },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" }, timeout: timeoutMs },
      );
      const data = res.data || {};
      if (data.error) throw new Error(String(data.error));
      if (data.status && data.status !== "succeeded") throw new Error(`status ${data.status}`);
      const out = Array.isArray(data.output) ? data.output.join("") : String(data.output || "");
      if (!out.trim()) throw new Error("empty output");
      return { model, raw: out.trim() };
    } catch (e) {
      lastError = e;
      console.warn(`⚠️ [CREDIT_REFUND] ${model} başarısız: ${e.response?.data?.detail || e.message}`);
    }
  }
  throw lastError || new Error("No refund analysis model available");
}

/** reference_images jsonb → URL listesi (string ya da {url|image_url|uri}) */
function extractProductUrls(referenceImages, max = 3) {
  let list = referenceImages;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = [list]; } }
  if (!Array.isArray(list)) list = list && typeof list === "object" ? Object.values(list) : [];
  const urls = list
    .map((x) => (typeof x === "string" ? x : x && (x.url || x.image_url || x.imageUrl || x.uri || x.optimizedUrl)))
    .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  return urls.filter((u, i, a) => a.indexOf(u) === i).slice(0, max);
}

module.exports = {
  REFUND_MODELS, DEFECTS, VERDICTS, THRESHOLDS, languageName,
  buildAnalysisPrompt, parseAnalysis, decideRefund, labelImage, PRODUCT_LABEL, RESULT_LABEL,
  callRefundVision, extractProductUrls,
};
