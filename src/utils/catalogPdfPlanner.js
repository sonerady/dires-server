// 📚 Ürün Kataloğu PDF — yapay zekâ planlayıcısı (30 Eyl 2026)
//
// YOL: askToolModel (utils/customToolLlm.js) → fal "openrouter/router/vision" → OpenRouter →
// anthropic/claude-opus-5.5 — "Kendi aracını oluştur" ile AYNI istemci, model ve geçit (fal
// faturası; doğrudan Anthropic anahtarı yok). Geçitte reasoning zorunlu → max_tokens geniş.
// Model çıktısı ASLA doğrudan istemciye gitmez: catalogPlanCore.finalizePlan sıkı doğrular
// (bilinmeyen alan/ürün kimliği atılır, uydurma iddia/marka/iletişim/ölçü içeren cümleler
// silinir, satıcının açık değerleri üstüne yazılır). Model yanıt vermezse / JSON bozuksa
// belirlenimci yedek plan döner (istemci her koşulda plan alır).
const { askToolModel, CUSTOM_TOOL_MODEL } = require("./customToolLlm");
const { parseJsonLoose } = require("./menuStudioAstra");
const core = require("./catalogPlanCore");

const PLAN_TIMEOUT_MS = Number(process.env.CATALOG_PDF_PLAN_TIMEOUT_MS) || 110000;
const MAX_IMAGES = 12; // askAstra görsel sınırı

function languageName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}

/** Yalnız kendi depolamamızdaki (Supabase) https görselleri modele gider. */
function allowedImageHost(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    const own = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host.toLowerCase() : "";
    return (own && host === own) || host.endsWith(".supabase.co") || host === "api.diress.ai";
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = [
  "You are a senior e-commerce catalog art director and copywriter. You plan a printable product catalog (PDF) for a small online seller.",
  "Answer with ONE strict JSON object and nothing else — no markdown, no comments.",
  "Hard rules:",
  "1. Use only facts the seller gave (names, codes, prices, descriptions, colours, sizes) and what is plainly visible in the product photos (product type, colour, shape, style). Never invent materials or fabric content, dimensions, specifications, certifications, origin (\"made in\"), guarantees, awards, bestseller or popularity claims, stock, shipping or delivery promises, discounts, or contact details.",
  "2. Never mention third-party brands, marketplaces or platforms (for example Amazon, Etsy, Trendyol, Instagram) unless the seller wrote them.",
  "3. No emojis, hashtags or ALL-CAPS words. Keep copy short and calm, like a real printed catalog.",
  "4. Values the seller fixed (the \"explicit\" block) are final: use them exactly and plan everything else around them.",
  "5. Use only the ids and enum values you are given. Every product id must appear in exactly one section.",
].join("\n");

function describeBrief(input) {
  const b = input.brief;
  if (b.mode !== "manual") return "The seller chose \"Let AI decide\": choose purpose, tone, layout, sections and copy yourself.";
  const v = (value, label) => (value && value !== "auto" ? `${label}: ${value}` : `${label}: you decide`);
  return [
    v(b.purpose, "Purpose"),
    b.audience ? `Audience: ${b.audience}` : "Audience: you decide",
    v(b.tone, "Tone"),
    v(b.layout, "Products per page layout (apply to every section)"),
    b.coverTitle ? `Cover title (fixed): ${b.coverTitle}` : "Cover title: you write it",
    b.coverSubtitle ? `Cover subtitle (fixed): ${b.coverSubtitle}` : "Cover subtitle: you write it",
    b.sectionsMode === "custom" && b.sectionTitles.length ? `Sections (fixed titles, in this order; assign every product to one of them): ${JSON.stringify(b.sectionTitles)}` : "Sections: you decide",
    b.highlightMode === "custom" && b.highlightIds.length ? `Highlight these products first, in their own opening section: ${JSON.stringify(b.highlightIds)}` : b.highlightMode === "none" ? "Do not create a featured/highlights section." : "Highlights: you decide",
    b.prices === "show" ? "Prices: show" : b.prices === "hide" ? "Prices: hide" : "Prices: you decide",
  ].join("\n");
}

/**
 * @param input sanitizePlanInput çıktısı
 * @returns {{ prompt: string, imageUrls: string[] }}
 */
function buildPlanPrompt(input) {
  const withImages = input.products.filter((p) => p.imageUrl && allowedImageHost(p.imageUrl)).slice(0, MAX_IMAGES);
  const imageLines = withImages.map((p, i) => `image ${i + 1} = product ${p.id}`);
  const products = input.products.map((p) => {
    const facts = { id: p.id };
    if (p.name) facts.name = p.name;
    if (p.sku) facts.sku = p.sku;
    if (p.price != null) facts.price = p.price;
    if (p.oldPrice != null) facts.oldPrice = p.oldPrice;
    if (p.description) facts.description = p.description;
    if (p.colors.length) facts.colors = p.colors;
    if (p.sizes.length) facts.sizes = p.sizes;
    if (p.badge) facts.badge = p.badge;
    facts.photo = withImages.includes(p) ? `image ${withImages.indexOf(p) + 1}` : p.hasImage ? "not attached" : "none";
    return facts;
  });
  const lang = input.language;
  const prompt = [
    `Write every visible word in ${languageName(lang)} (${lang}).`,
    "",
    "## Catalog brief",
    describeBrief(input),
    "",
    "## Store",
    JSON.stringify({ name: input.store.name || null, currency: input.store.currency, pageSize: input.store.pageSize, orientation: input.store.orientation }),
    "",
    "## Explicit values (final — keep exactly)",
    JSON.stringify(input.locked),
    "",
    `## Products (${input.products.length}, in the seller's order)`,
    JSON.stringify(products),
    imageLines.length ? `\n## Photos\n${imageLines.join("\n")}` : "",
    "",
    "## How to plan",
    "- theme: minimal (clean, fits anything) | editorial (fashion, lifestyle, premium) | bold (sale, streetwear, energetic) | luxury (dark; jewellery, watches, premium) | pastel (kids, beauty, home, playful).",
    "- accent: one #RRGGBB colour taken from the products' dominant colours, readable on the theme's page.",
    "- fontPair: modern | classic | elegant | bold | friendly | geometric (or null to use the theme default).",
    "- layout per section: hero1 (1 per page, hero items or very small catalogs) | grid2 (premium, 3–8 products) | grid4 (standard retail) | grid6 / grid9 (large assortments) | list (wholesale price lists with codes).",
    "- sections: when there are 6+ products and 2+ clear product types, group by type (1–3 word titles, e.g. \"Dresses\", \"Bags\"); otherwise one section with an empty title. At most 8 sections. intro: optional, one short sentence from the facts.",
    "- products: add entries only where you add value. name: only for products without a name — a plain 2–5 word product name from the photo. description: only for products without one — 1–2 short sentences (max 200 characters) about what is visible. highlights: up to 3 short points (max 45 characters each) drawn from the facts or clearly visible details. badge: \"sale\" only when oldPrice > price; \"new\" only for a new-arrivals catalog. Never \"bestseller\".",
    "- cover: title (max 40 characters), subtitle (max 60), tagline (optional, max 90); imageProductId = the product with the strongest cover photo.",
    "- toc: true when there are 8+ products or 3+ sections. showPrices / showSku: true unless the purpose calls for hiding them (lookbook: prices may be hidden).",
    "- backPage: headline (max 40 characters) and cta (max 90) that invite buyers to get in touch — no phone numbers, emails or URLs (the seller adds them).",
    "- rationale: one short sentence explaining your plan, in the catalog language.",
    "",
    "## Output (JSON only)",
    '{"theme":"minimal","accent":"#RRGGBB","fontPair":null,"pageSize":"A4","orientation":"portrait","toc":true,"showPrices":true,"showSku":true,"cover":{"title":"","subtitle":"","tagline":"","imageProductId":""},"sections":[{"title":"","intro":"","layout":"grid4","productIds":[""]}],"products":{"<id>":{"name":"","description":"","highlights":[""],"badge":"sale"}},"backPage":{"headline":"","cta":""},"rationale":""}',
  ].join("\n");
  return { prompt, imageUrls: withImages.map((p) => p.imageUrl) };
}

/**
 * @param input sanitizePlanInput çıktısı
 * @param {{ ask?: Function }} [deps] testlerde model çağrısı taklit edilir
 * @returns {Promise<{ plan, source: 'ai'|'fallback', reason?: string, model?: string }>}
 */
async function planCatalog(input, deps = {}) {
  const ask = deps.ask || askToolModel;
  const { prompt, imageUrls } = buildPlanPrompt(input);
  let raw = null;
  try {
    raw = await ask({ systemPrompt: SYSTEM_PROMPT, prompt, imageUrls, maxTokens: 16000, temperature: 0.4, maxRetries: 1, timeoutMs: PLAN_TIMEOUT_MS, tag: "CATALOG_PDF_PLAN" });
  } catch (error) {
    console.warn("⚠️ [CATALOG_PDF] model unavailable:", String(error?.message || error).slice(0, 200));
    return { plan: core.finalizePlan(null, input), source: "fallback", reason: "model_unavailable" };
  }
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== "object") {
    return { plan: core.finalizePlan(null, input), source: "fallback", reason: "invalid_model_output" };
  }
  const plan = core.finalizePlan(parsed, input, { source: "ai" });
  return { plan, source: plan.source, model: CUSTOM_TOOL_MODEL, ...(plan.source === "ai" ? {} : { reason: "unusable_model_output" }) };
}

module.exports = { planCatalog, buildPlanPrompt, allowedImageHost, SYSTEM_PROMPT };
