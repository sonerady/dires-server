// 🧩 Kolaj planlayıcı — POST /api/collage/plan (30 Eyl 2026)
//
// Satıcının kolaj tarifi (amaç, oran, ton, yazı, marka rengi, kahraman fotoğraf — her biri
// "yapay zekâya bırak" olabilir) + en çok 9 küçük önizleme → tek kolaj planı:
//   { templateId, ratio, order, heroIndex, cells[{photoIndex,focusX,focusY,zoom}], gap, margin,
//     radius, background, caption{title,subtitle,align,color,position,font}|null, labels, reason }
//
// Model: Claude Opus 5.5, "Kendi aracını oluştur" ile AYNI yol (utils/customToolLlm.js → fal
// openrouter/router/vision geçidi, fal faturası). Görü açık (önizleme URL'leri).
// Yanıt collagePlanCore.validatePlan ile SIKI doğrulanır; bozuksa bir kez gerekçesiyle yeniden
// sorulur, yine olmazsa deterministik yedek plan döner (fallbackPlan). Satıcının açık değerleri
// her durumda kazanır (applyExplicit). Anahtar/URL loglanmaz.
const createCollagePlanner = require("./collagePlanCore");
const TEMPLATE_DATA = require("../data/collageTemplates.json");

const core = createCollagePlanner(TEMPLATE_DATA);
const { PURPOSES, MOODS, RATIOS, FONTS, LIMITS, TITLE_MAX, SUBTITLE_MAX } = createCollagePlanner;

const LLM_TIMEOUT_MS = 60000;
const TIME_BUDGET_MS = 75000;

const SYSTEM_PROMPT = `You are the art director of an e-commerce photo studio app. Online sellers give you 2–9 photos of their products and a short brief; you plan ONE collage image for their store, marketplace listing or social channel.
You think like a marketplace merchandiser and a social media designer at once: the product must stay fully visible and sharp, the layout must feel intentional, and any text must sell without inventing facts.
You answer with strict JSON only — no prose, no markdown fences.`;

const FAMILY_NOTES = {
  single: "one full-frame photo",
  grid: "equal cells in rows and columns",
  strip: "equal side-by-side columns or stacked rows",
  hero: "one large hero cell plus smaller supporting cells",
  mosaic: "rows of different cell sizes (editorial rhythm)",
  split: "two halves with BEFORE / AFTER labels",
  inset: "full-frame photo with a framed close-up inset in the corner",
};

const PURPOSE_NOTES = {
  instagram_post: "Instagram feed post (usually 4:5)",
  story: "Instagram / TikTok story (9:16)",
  marketplace: "marketplace gallery image (square, pure white background, no clutter)",
  lookbook: "lookbook / catalogue page (editorial, generous white space)",
  before_after: "before / after comparison",
  bundle: "bundle or \"what's in the box\" image (main product + included items)",
  color_variants: "the same product in different colours (equal cells, same scale)",
};

const pct = (v) => Math.round(v * 100);
function describeTemplate(t) {
  const hero = core.heroSlot(t);
  const cells = t.cells.map((c, i) => `${i}:[${pct(c[0])},${pct(c[1])},${pct(c[2])},${pct(c[3])}]`).join(" ");
  return `- ${t.id} (${t.family} — ${FAMILY_NOTES[t.family] || t.family}): slots x0,y0,x1,y1 % → ${cells}${hero !== null ? `; hero slot ${hero}` : ""}${t.overlay ? `; slot ${t.overlay.join(",")} is drawn on top as an inset` : ""}`;
}

function describePhoto(p, i, withImage) {
  const aspect = p.width / p.height;
  const shape = aspect > 1.08 ? "landscape" : aspect < 0.92 ? "portrait" : "square";
  const parts = [`photo ${i}${withImage ? ` (= attached image ${i + 1})` : ""}: ${p.width}×${p.height} px, ${shape} ${aspect.toFixed(2)}`];
  if (p.plain) parts.push(`plain ${p.bg ? `${p.bg} ` : ""}background`);
  if (p.bbox) parts.push(`product box (0–1) [${p.bbox.join(", ")}]`);
  if (p.avg) parts.push(`main colour ${p.avg}`);
  return parts.join(", ");
}

/** Model istemi — yalnız bu fotoğraf sayısına uygun şablonlar listelenir */
function buildPrompt(brief, { withImages = false } = {}) {
  const n = brief.photos.length;
  const allowed = core.templatesFor(n);
  const auto = (v) => (v === "auto" || v === null || v === undefined ? "auto (you choose)" : v);
  const caption = brief.caption.mode === "custom"
    ? `custom — use EXACTLY title ${JSON.stringify(brief.caption.title)} and subtitle ${JSON.stringify(brief.caption.subtitle)}`
    : brief.caption.mode === "none" ? "none — no text on the image (caption must be null)" : `ai — write it in language "${brief.language}" if text helps this purpose, otherwise null`;
  return [
    `Plan a collage of ${n} photos.`,
    "",
    "PHOTOS",
    ...brief.photos.map((p, i) => describePhoto(p, i, withImages)),
    "",
    "SELLER BRIEF (values other than auto are fixed by the seller and must be used exactly)",
    `- purpose: ${auto(brief.purpose)}${brief.purpose !== "auto" && PURPOSE_NOTES[brief.purpose] ? ` = ${PURPOSE_NOTES[brief.purpose]}` : ""}`,
    `- canvas ratio: ${auto(brief.ratio)}`,
    `- mood / tone: ${auto(brief.mood)}`,
    `- brand colour: ${brief.brandColor || "auto (none given)"}`,
    `- hero photo: ${brief.heroIndex === null ? "auto (you choose the strongest product shot)" : `photo ${brief.heroIndex}`}`,
    `- caption: ${caption}`,
    "",
    `ALLOWED TEMPLATES for ${n} photos (templateId must be one of these ids):`,
    ...allowed.map(describeTemplate),
    "",
    `Purposes: ${PURPOSES.map((p) => `${p} = ${PURPOSE_NOTES[p]}`).join("; ")}.`,
    `Canvas ratios: ${RATIOS.join(", ")}. Moods: ${MOODS.join(", ")}. Fonts (${FONTS.join(", ")}): modern = clean sans, elegant = serif, bold = condensed display, classic = book serif.`,
    "",
    "RULES",
    "- order: exactly one entry per slot, each photo index once. order[slot] = the photo placed in that slot. Put the strongest, clearest product shot in the hero slot; match landscape photos to wide cells and portrait photos to tall cells so nothing important is cropped.",
    "- cells: one entry per photo. focusX/focusY (0–1, in photo coordinates) = the point to keep centred — usually the product's centre (use the product box when given). zoom 1–2.5 (1 = no zoom); zoom in on small products on plain backgrounds, never crop away any part of the product.",
    `- gap ${LIMITS.gap.join("–")}, margin ${LIMITS.margin.join("–")}, radius ${LIMITS.radius.join("–")} (percent of the canvas short side).`,
    "- background: #RRGGBB. Marketplace images use pure white #FFFFFF. If a brand colour is given, use it (background or text colour) with readable contrast.",
    `- caption: null or { "title": ≤${TITLE_MAX} chars, "subtitle": ≤${SUBTITLE_MAX} chars (may be ""), "align": left|center|right, "position": top|bottom|overlay, "font": modern|elegant|bold|classic, "color": #RRGGBB readable on the background }. Write for the seller's shop in their voice; never invent prices, discounts, materials, sizes or claims you cannot see; no third-party brand names.`,
    "- labels: true only for split (before/after) templates.",
    `- purpose: the purpose you planned for (one of the purposes above).`,
    `- reason: one short sentence (≤ 200 chars) in language "${brief.language}" telling the seller why this layout works for their photos.`,
    "",
    "Reply with ONLY this JSON object:",
    '{"templateId":"…","ratio":"4:5","order":[0,1,2],"heroIndex":0,"cells":[{"photoIndex":0,"focusX":0.5,"focusY":0.5,"zoom":1}],"gap":1.6,"margin":3,"radius":2,"background":"#FFFFFF","caption":null,"labels":false,"purpose":"instagram_post","reason":"…"}',
  ].join("\n");
}

/** Önizleme adresleri yalnız bizim depolamamızdan (fal/OpenRouter'a rastgele adres gitmesin) */
function allowedImageHosts() {
  const hosts = new Set(["api.diress.ai", "diress.ai", "www.diress.ai"]);
  try {
    if (process.env.SUPABASE_URL) hosts.add(new URL(process.env.SUPABASE_URL).host);
  } catch {
    /* geçersiz env — varsayılanlar yeter */
  }
  return hosts;
}
function isAllowedImageUrl(url, hosts = allowedImageHosts()) {
  if (typeof url !== "string" || url.length > 2048) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (hosts.has(u.host) || /\.supabase\.co$/i.test(u.host));
  } catch {
    return false;
  }
}

async function defaultAsk({ systemPrompt, prompt, imageUrls }) {
  // Tembel yükleme: testler (ve fal anahtarı olmayan ortamlar) bu modülü LLM'siz kullanabilsin
  const { askToolModel } = require("./customToolLlm");
  return askToolModel({ systemPrompt, prompt, imageUrls, maxTokens: 8000, maxRetries: 1, timeoutMs: LLM_TIMEOUT_MS, tag: "COLLAGE_PLAN" });
}

function parseLoose(raw) {
  const { parseJsonLoose } = require("./menuStudioAstra");
  return parseJsonLoose(raw);
}

/**
 * @param {{ brief: object, ask?: Function, parse?: Function, now?: Function, budgetMs?: number }} o
 *   brief = core.validateBrief çıktısı. `ask` model çağrısı (testte sahte).
 * @returns {Promise<{ plan: object, source: "ai"|"fallback", issues: string[], error?: string }>}
 */
async function planCollage({ brief, ask = defaultAsk, parse = parseLoose, now = Date.now, budgetMs = TIME_BUDGET_MS }) {
  const started = now();
  const fallback = core.fallbackPlan(brief);
  const imageUrls = brief.photos.every((p) => p.url) ? brief.photos.map((p) => p.url) : [];
  const basePrompt = buildPrompt(brief, { withImages: imageUrls.length > 0 });
  let prompt = basePrompt;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // İkinci deneme yalnız süre kalmışsa (istemci ~2 dk bekler; toplam bütçe 75 sn)
    if (attempt > 1 && now() - started > budgetMs * 0.55) break;
    try {
      const raw = await ask({ systemPrompt: SYSTEM_PROMPT, prompt, imageUrls, attempt });
      const parsed = parse(raw);
      const { plan, issues } = core.validatePlan(parsed, brief);
      return { plan, source: "ai", issues };
    } catch (error) {
      lastError = error;
      const why = /^plan_/.test(error?.message || "") ? error.message.replace("plan_", "invalid ") : "not valid JSON";
      prompt = `${basePrompt}\n\nYour previous answer was rejected (${why}). Reply again with ONLY the JSON object, following every rule above.`;
    }
  }
  return { plan: fallback, source: "fallback", issues: [], error: lastError?.message || "unavailable" };
}

module.exports = {
  core,
  SYSTEM_PROMPT,
  buildPrompt,
  planCollage,
  isAllowedImageUrl,
  allowedImageHosts,
  LLM_TIMEOUT_MS,
};
