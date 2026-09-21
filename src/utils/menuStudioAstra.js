// 🍽️ Menü stüdyosu — GPT-6 Astra köprüsü.
//
// YOL: fal → "openrouter/router/vision" GEÇİDİ → OpenRouter → openai/gpt-6-astra
// (fal faturasına yazılır; doğrudan OpenRouter hesabı kullanılmaz — bkz.
// promptEnhanceProvider.js başındaki 1 Eyl 2026 kararı).
//
// İki iş yapar:
//   1) researchDishes — fotoğrafı/açıklaması olmayan yemekler için WEB ARAMASI
//      açık çalışır: ismi düzeltir, kısa menü açıklaması yazar, serbestçe
//      kullanılabilir kaynaklardan (Unsplash/Pexels/Wikimedia) görsel adayları
//      önerir. Adaylar sunucuda doğrulanır, asla körü körüne güvenilmez.
//   2) designMenu — menünün TASARIMINI üretir. ⚠️ Bilerek hiçbir estetik
//      talimat verilmez (kullanıcı kararı, 18 Eyl 2026): kategori düzeni,
//      tipografi, renk, yerleşim tamamen modele bırakılır. Yalnızca teknik
//      kısıtlar (tek dosya HTML, baskı ölçüsü, verilen görsel URL'leri) söylenir.
const { fal } = require("@fal-ai/client");
const { createClient } = require("@supabase/supabase-js");

const ROUTER_ENDPOINT = "openrouter/router/vision";
const DEFAULT_MODEL = "openai/gpt-6-astra";
const MODEL_TTL_MS = 60 * 1000;

let cachedModel = DEFAULT_MODEL;
let cachedAt = 0;
let supabase = null;

function db() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return supabase;
}

/** app_config.menu_studio_model → 60 sn önbellekli (deploy'suz model değişimi). */
async function getMenuModel() {
  if (Date.now() - cachedAt < MODEL_TTL_MS) return cachedModel;
  cachedAt = Date.now();
  try {
    const client = db();
    if (client) {
      const { data } = await client.from("app_config").select("menu_studio_model").limit(1).maybeSingle();
      const v = String(data?.menu_studio_model || "").trim();
      if (v) cachedModel = v;
    }
  } catch {
    /* kolon yok / ağ hatası → varsayılan kalır */
  }
  return cachedModel;
}

function configureFal() {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_API_KEY tanımlı değil");
  fal.config({ credentials });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Astra'ya tek çağrı (fal geçidi üzerinden).
 * @returns {Promise<string>} modelin metin çıktısı
 */
/** Söz verilen sürede bitmezse reddet — fal kuyruğu takılırsa iş askıda kalmasın. */
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function askAstra({
  prompt,
  systemPrompt,
  imageUrls,
  webSearch = false,
  webSearchMaxUses,
  maxTokens = 32000,
  temperature,
  maxRetries = 2,
  tag = "MENU",
  model,
  // fal kuyruğu nadiren takılıyor; zaman aşımı olmadan proje sonsuza kadar
  // "generating" durumunda kalıyordu (18 Eyl 2026 — bir istek 20 dk askıda kaldı).
  timeoutMs = 7 * 60 * 1000,
} = {}) {
  configureFal();
  const resolvedModel = model || (await getMenuModel());

  const input = {
    model: resolvedModel,
    prompt,
    max_tokens: maxTokens,
    // ⚠️ fal geçidi Astra için zorunlu kılıyor: reasoning kapatılamıyor
    // ("Reasoning is mandatory for this endpoint and cannot be disabled").
    reasoning: true,
  };
  if (systemPrompt) input.system_prompt = systemPrompt;
  if (Array.isArray(imageUrls) && imageUrls.length) input.image_urls = imageUrls.filter(Boolean).slice(0, 12);
  if (typeof temperature === "number") input.temperature = temperature;
  if (webSearch) {
    input.enable_web_search = true;
    if (webSearchMaxUses) input.web_search_options = { max_uses: webSearchMaxUses };
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🍽️ [${tag}_ASTRA] ${resolvedModel} deneme ${attempt}/${maxRetries}${webSearch ? " (web arama açık)" : ""}`);
      const result = await withTimeout(
        fal.subscribe(ROUTER_ENDPOINT, { input, logs: false }),
        timeoutMs,
        `${tag}_ASTRA ${Math.round(timeoutMs / 1000)} sn içinde yanıt vermedi`,
      );

      // fal hatayı 200 gövdesinde `error` alanıyla da döndürebiliyor
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(typeof falError === "string" ? falError : JSON.stringify(falError));

      // 💰 fal gerçek maliyeti döndürüyor — sunucu loguna yazılır ki bir menünün
      // kaça mal olduğu sonradan hesaplanabilsin (18 Eyl 2026).
      const usage = result?.data?.usage || result?.usage;
      if (usage) {
        console.log(
          `💰 [${tag}_ASTRA] ${usage.prompt_tokens ?? "?"} girdi + ${usage.completion_tokens ?? "?"} çıktı token → $${Number(usage.cost || 0).toFixed(4)}`,
        );
      }

      const output = result?.data?.output ?? result?.output ?? "";
      if (typeof output === "string" && output.trim()) return output;
      throw new Error("fal/openrouter boş içerik döndürdü");
    } catch (err) {
      lastErr = err;
      const detail = err?.body?.detail || err?.message || String(err).slice(0, 300);
      console.warn(`⚠️ [${tag}_ASTRA] deneme ${attempt} hata: ${detail}`);
      if (attempt < maxRetries) await sleep(Math.min(2000 * 2 ** (attempt - 1), 8000));
    }
  }
  throw lastErr || new Error("Astra çağrısı başarısız");
}

/** ```json ... ``` sarmalını ve ön/arka gevezeliği temizleyip JSON'a çevirir. */
function parseJsonLoose(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* aşağıda ilk { veya [ ile son } veya ] arası denenir */
  }
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * OpenRouter web araması cevaba markdown atıf ekliyor:
 *   "... yoğurtla. ([kaynak.gov.tr](https://...))"
 * Bu metinler MENÜYE BASILIYOR — atıflar kesinlikle temizlenmeli.
 */
function stripCitations(value) {
  return String(value || "")
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "") // ([etiket](url))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [etiket](url) → etiket
    .replace(/\s*\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Model cevabındaki HTML'i ayıklar (kod bloğu / açıklama sarmalı olabilir). */
function extractHtml(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<!DOCTYPE html|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  const endTag = s.toLowerCase().lastIndexOf("</html>");
  if (endTag >= 0) s = s.slice(0, endTag + 7);
  return /<html[\s>]/i.test(s) ? s : null;
}

const RESEARCH_SYSTEM = `You are a culinary researcher and menu copywriter working for a restaurant menu production studio.
You verify dish names, write short appetising menu descriptions, and find usable photographs of dishes.
You always answer with strict JSON only — no prose, no markdown fences, no commentary.`;

/**
 * Fotoğrafı ve/veya açıklaması eksik yemekler için araştırma.
 * @param {object} p
 * @param {{id:string,name:string,description?:string,category?:string,needsImage:boolean}[]} p.dishes
 * @param {string} p.restaurantName
 * @param {string} [p.cuisine]
 * @param {string} [p.language] — açıklamaların yazılacağı dil (ISO 639-1)
 * @returns {Promise<{id:string,suggested_name?:string,description?:string,note?:string,image_candidates:{url:string,source_page?:string,credit?:string}[]}[]>}
 */
async function researchDishes({ dishes, restaurantName, cuisine, language = "tr" }) {
  const list = (dishes || []).filter((d) => d && d.name);
  if (!list.length) return [];

  const prompt = `Restaurant: ${restaurantName || "(unnamed)"}${cuisine ? `\nCuisine: ${cuisine}` : ""}
Menu language: ${language}

For EACH dish below do the following:
1. Check the dish name: spelling, diacritics, spacing and the capitalisation it should carry on a printed menu (menus normally use Title Case for dish names). If the operator typed it wrongly, inconsistently or in the wrong case, put the corrected form in "suggested_name". Omit the field only when the name is already exactly print-ready.
2. Write "description": one short appetising menu line in the menu language (max 110 characters), naming the real main ingredients of that dish. Never invent ingredients that the dish does not normally contain.
3. If "needs_image" is true, search the web and return up to 3 "image_candidates": direct links to a real photograph OF THAT DISH.
   - Each candidate must be a direct image file URL ending in .jpg, .jpeg, .png or .webp that is publicly reachable without a login.
   - Strongly prefer sources whose photos are free to reuse: images.unsplash.com, images.pexels.com, upload.wikimedia.org, cdn.pixabay.com, burst.shopifycdn.com.
   - Never return a page URL, a search-results URL, a thumbnail smaller than 600px, or a URL you have not actually seen in search results. If you cannot find a real one, return an empty array — an empty array is far better than a guessed link.
   - For each candidate also give "source_page" (the page it appears on) and "credit" (photographer or source name) when you know them.
4. If something about the dish is worth flagging to the operator (ambiguous name, regional variant, likely allergen), put one short sentence in "note" in the menu language.

Dishes:
${JSON.stringify(
  list.map((d) => ({
    id: d.id,
    name: d.name,
    current_description: d.description || null,
    category: d.category || null,
    needs_image: !!d.needsImage,
  })),
  null,
  1,
)}

Answer with a JSON array only, one object per dish, each shaped:
{"id": "<the id given above>", "suggested_name": "...", "description": "...", "note": "...", "image_candidates": [{"url": "...", "source_page": "...", "credit": "..."}]}`;

  const raw = await askAstra({
    prompt,
    systemPrompt: RESEARCH_SYSTEM,
    webSearch: true,
    // 💰 Arama sayısı maliyetin baskın kalemi: ölçümde 4 aramalık bir araştırma
    // 34.5k girdi token üretip $0.45'e mal oldu (arama başına ≈ $0.10). Eskiden
    // yemek başına 2 arama × 20 tavan vardı; yemek başına ~1, tavan 8'e çekildi.
    webSearchMaxUses: Math.min(8, Math.max(3, list.length)),
    maxTokens: 12000,
    temperature: 0.3,
    tag: "MENU_RESEARCH",
  });

  const parsed = parseJsonLoose(raw);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.dishes) ? parsed.dishes : [];
  return rows
    .filter((r) => r && r.id)
    .map((r) => ({
      id: String(r.id),
      suggested_name: typeof r.suggested_name === "string" ? stripCitations(r.suggested_name).slice(0, 160) : null,
      description: typeof r.description === "string" ? stripCitations(r.description).slice(0, 400) : null,
      note: typeof r.note === "string" ? stripCitations(r.note).slice(0, 300) : null,
      image_candidates: Array.isArray(r.image_candidates)
        ? r.image_candidates
            .filter((c) => c && typeof c.url === "string" && /^https?:\/\//i.test(c.url))
            .slice(0, 3)
            .map((c) => ({
              url: c.url.trim(),
              source_page: typeof c.source_page === "string" ? c.source_page.trim().slice(0, 500) : null,
              credit: typeof c.credit === "string" ? stripCitations(c.credit).slice(0, 200) : null,
            }))
        : [],
    }));
}

/**
 * Projenin referans görselleri. Hazır bir menü stili seçildiyse o stilin bütün
 * sayfaları buraya düşer — modele tek kapak yerine menünün tamamı gösterilir.
 */
function referenceImages(project, max = 6) {
  const extra = Array.isArray(project?.reference_image_urls) ? project.reference_image_urls : [];
  return [project?.reference_image_url, ...extra].filter(Boolean).slice(0, max);
}

const DESIGN_SPEC_SYSTEM = `You are a print designer reverse-engineering another designer's menu so it can be rebuilt exactly. You answer with strict JSON only — no prose, no markdown fences.`;

/**
 * Referans menüyü KATMAN KATMAN çözümle ve yapısal bir künyeye çevir.
 * Düz bir paragraf yerine yapısal JSON kullanılıyor çünkü tasarım adımına
 * tek tek uyulacak bir kontrol listesi olarak veriliyor — "aşağı yukarı benzer"
 * değil, madde madde aynı olsun diye (18 Eyl 2026 kullanıcı isteği).
 */
async function analyzeReferenceDesign({ project }) {
  const refs = referenceImages(project, 4);
  if (!refs.length) return null;

  const raw = await askAstra({
    prompt: `The attached ${refs.length > 1 ? `${refs.length} images are pages of one printed menu` : "image is a printed menu"} that must be rebuilt exactly, with different content. Reverse-engineer it layer by layer, the way you would if you had to redraw it in a layout program.${refs.length > 1 ? " Describe the shared system across the pages, and note in `page_furniture` what changes from page to page." : ""}

Go through the page from the bottom layer to the top and record EVERY deliberate design decision you can see. Be specific and quantitative wherever you can (percentages of page width/height, approximate point sizes relative to each other, colours as hex).

Answer with JSON only, in this shape:
{
  "canvas": {"ground": "the base background: colour, gradient, image or pattern", "shape_language": "any large shapes dividing the page — waves, diagonals, panels, arcs — described precisely enough to redraw, including where they cross the page"},
  "layers": [{"z": 1, "name": "short name", "what": "what this layer contains", "where": "position on the page in words or rough percentages"}],
  "grid": {"columns": "how the content is columned", "margins": "outer margins", "alignment": "how blocks align to each other"},
  "typography": {"display": "the biggest type: classification, weight, case, tracking, any effect such as outline or shadow", "section": "section headings", "item": "dish names", "body": "descriptions", "price": "how prices are set, or null if none visible", "scale": "rough size relationships between these"},
  "palette": ["hex or named colours, most used first"],
  "photography": {"present": true, "cutout": true, "angle": "camera angle", "shape": "round plate, square crop, full bleed...", "size": "how big relative to the page", "placement": "how the photos sit in the composition and whether they overlap shapes or type", "shadow": "shadow treatment"},
  "ornaments": "repeating motifs, watermarks, line work, icons — what they are and where",
  "page_furniture": "header, footer, page numbers, contact lines — what and where",
  "spacing": "density, breathing room, how tightly text blocks sit",
  "must_haves": ["the 5-10 details a viewer would notice immediately if they were missing"]
}`,
    systemPrompt: DESIGN_SPEC_SYSTEM,
    imageUrls: refs,
    maxTokens: 8000,
    temperature: 0.2,
    tag: "MENU_SPEC",
  });

  const parsed = parseJsonLoose(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

/**
 * Üretilen/uyarlanan yemek fotoğraflarını referansla KARŞILAŞTIR.
 * GPT'den gelen görseller körü körüne kabul edilmiyor: Astra hepsini görüp
 * hangisinin referansın çekim diline uymadığını söylüyor, uymayanlar yeniden
 * üretiliyor.
 * @returns {Promise<{index:number,ok:boolean,reason:string}[]>}
 */
async function verifyDishPhotos({ project, photos }) {
  const referenceUrl = project?.reference_image_url;
  const list = (photos || []).filter((p) => p && p.url).slice(0, 8);
  if (!referenceUrl || !list.length) return [];

  const raw = await askAstra({
    prompt: `Image 1 is the reference menu. Images 2-${list.length + 1} are dish photographs prepared for a new menu that must match the reference's photographic treatment.

Required treatment: ${project?.photo_style || "(match the reference)"}${project?.photo_cutout ? "\nThe dishes MUST be cut out on a transparent background — no table, no surface, no backdrop." : ""}

For each dish photograph in order, judge whether it genuinely matches the reference's treatment on the points that matter: camera angle, whether it is cut out or has its own background, plateware, lighting direction and hardness, colour grade, crop tightness.

Be strict. A photograph shot from the side when the reference is top-down FAILS. A photograph with a visible table when the reference is cut out FAILS.

Answer with JSON only: {"results": [{"index": 2, "ok": false, "reason": "shot from a low three-quarter angle, reference is straight top-down"}]} — one entry per dish photograph, using the image numbers above.`,
    systemPrompt: `You are a picture editor checking that new photographs match an existing art direction. You are strict and you answer with strict JSON only.`,
    imageUrls: [referenceUrl, ...list.map((p) => p.url)],
    maxTokens: 4000,
    temperature: 0.1,
    tag: "MENU_PHOTO_CHECK",
  });

  const parsed = parseJsonLoose(raw);
  const rows = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
  return rows
    .map((r) => {
      // Model 1 tabanlı görsel numarası veriyor (1 = referans), listeye çevir
      const idx = Number(r?.index);
      const listIndex = Number.isFinite(idx) ? idx - 2 : -1;
      if (listIndex < 0 || listIndex >= list.length) return null;
      return {
        itemId: list[listIndex].itemId,
        ok: r?.ok !== false,
        reason: typeof r?.reason === "string" ? stripCitations(r.reason).slice(0, 200) : null,
      };
    })
    .filter(Boolean);
}

const PHOTO_STYLE_SYSTEM = `You are a photo editor describing the food-photography treatment of a printed menu so that new photographs can be shot to match it. You answer with strict JSON only.`;

/**
 * Referans menüdeki YEMEK FOTOĞRAFLARININ stilini çözümle.
 * Çıkan brief hem yeni üretilen fotoğraflarda hem de mevcut fotoğrafların
 * yeniden stillendirilmesinde kullanılır — böylece bütün kareler aynı
 * çekimden çıkmış gibi durur.
 * @returns {Promise<string|null>} İngilizce stil brief'i, ya da fotoğraf yoksa null
 */
async function analyzePhotoStyle({ project }) {
  const refs = referenceImages(project, 4);
  if (!refs.length) return null;

  const raw = await askAstra({
    prompt: `The attached image is a printed menu. Look at the FOOD PHOTOGRAPHS inside it (ignore the typography and layout).

1. "cutout": decide whether the dishes are CUT OUT — the plate or bowl floats directly on the page's own colour or pattern with no photographic background of its own (often with a soft drop shadow) — or whether each photo is a normal rectangular picture showing its own scene, table or surface. Cut-out treatments are extremely common in this kind of menu and they change how the photographs must be produced, so judge it carefully. true = cut out, false = rectangular photo with its own background.

2. "angle": the dominant camera angle in one or two words ("top-down", "three-quarter", "eye level").

3. "style": describe their shared photographic treatment precisely enough that a photographer could reshoot any other dish to match: camera angle, the surface or ground the food sits on (or the absence of one, if cut out), the lighting (direction, hardness, warmth), colour grade and saturation, depth of field, how tightly the food is cropped, the plateware, plating and props, and the overall mood. Write one dense English paragraph of 2-4 sentences, phrased as instructions for a new photograph ("shot from...", "on...", "lit by..."). If the dishes are cut out, say so explicitly in this paragraph too and describe the plateware and shadow.

If the menu contains no food photographs at all, answer {"style": null}.

Answer with JSON only: {"cutout": true, "angle": "...", "style": "..."} `,
    systemPrompt: PHOTO_STYLE_SYSTEM,
    imageUrls: refs,
    maxTokens: 3000,
    temperature: 0.3,
    tag: "MENU_PHOTO_STYLE",
  });

  const parsed = parseJsonLoose(raw);
  const style = typeof parsed?.style === "string" ? stripCitations(parsed.style).slice(0, 900) : null;
  if (!style || style.length <= 20) return null;
  return {
    style,
    cutout: parsed?.cutout === true,
    angle: typeof parsed?.angle === "string" ? stripCitations(parsed.angle).slice(0, 60) : null,
  };
}

// Baskı ölçüleri — CSS @page için
const PAGE_SPECS = {
  A4: { css: "A4", label: "A4 (210 × 297 mm)", width: "210mm", height: "297mm" },
  A5: { css: "A5", label: "A5 (148 × 210 mm)", width: "148mm", height: "210mm" },
  US_LETTER: { css: "letter", label: "US Letter (8.5 × 11 in)", width: "8.5in", height: "11in" },
  SQUARE: { css: "200mm 200mm", label: "Kare (200 × 200 mm)", width: "200mm", height: "200mm" },
};

const DESIGN_SYSTEM = `You are the art director of a design studio that makes printed menus for restaurants that care how they look — the kind of menu people photograph, the kind a design annual would publish.

You work like a designer, not like a word processor. You build a composition on a real grid. You set a deliberate typographic scale with genuine contrast between display and body sizes. You treat empty space as a material. You commit to ONE strong idea and carry it through every element on the page.

Unless the operator has attached a reference design (in that case the reference outranks everything and you follow it, whatever its style), what you must never produce is the default restaurant-menu template: a centred serif name, a thin rule under it, dish names left with dotted leaders and prices right, every line the same size, evenly stacked from top to bottom, a decorative diamond between sections. That generic layout is exactly what the operator is trying to get away from. If your first instinct produces something that could be any restaurant anywhere, throw it away and design something that could only belong to THIS restaurant.

Ways real menu designers create structure, for your consideration — not a checklist: an asymmetric or columnar grid; a full-bleed or cropped photographic element; a dominant display size against very small text; a coloured or tinted ground rather than plain white; rotated, stacked or vertically set type; a numbering or coding system; a strong margin rule; sections that differ in treatment instead of repeating the same block.

You output one complete HTML document and nothing else — no explanation, no markdown fences.`;

// Revize kipi: tasarım YENİDEN ÇİZİLMEZ. Mevcut belge üzerinde yalnızca istenen
// değişiklik yapılır. Operatör her küçük düzenlemede tasarımın kayması ve önceki
// isteklerin kaybolmasından şikâyetçiydi (18 Eyl 2026).
const REVISE_SYSTEM = `You are the production designer who maintains a printed menu that has already been art-directed and approved.

Your job on this pass is NOT to design. The document you are given is the approved design. You apply the operator's requested change to it and you change absolutely nothing else.

What "nothing else" means, literally:
- The <head>, the font <link> tags, every font-family, every font-size, weight, letter-spacing and line-height stay byte-identical unless the request is about type.
- Every colour, gradient, tint, border, shadow and background image stays identical unless the request is about colour.
- The grid, margins, paddings, column widths, @page rules, page count and the order of pages and sections stay identical unless the request is about layout.
- Every image URL stays exactly where it is, at the same crop and scale, unless the request is about photographs.
- Class names, element structure and source order stay the same, so the operator's own text edits survive.

You do not tidy, improve, modernise, rebalance or "fix" anything you were not asked about. A reviewer diffing the old and the new document must see only the requested change and whatever minimal, unavoidable adjustment it forces (for example, a block that must grow to fit new text).

You output one complete HTML document and nothing else — no explanation, no markdown fences, no comments about what you changed.`;

const ASSET_SYSTEM = `You are an art director specifying the custom artwork a printed menu needs.
You do not draw; you write precise generation briefs for an image model, and you answer with strict JSON only — no prose, no markdown fences.`;

const ASSET_ROLES = ["background", "texture", "ornament", "divider", "cover", "spot"];

/**
 * Menünün ihtiyaç duyduğu TASARIM ÖĞELERİNİ planla (arka plan, doku, süsleme…).
 * Referans görsel varsa Astra onu GÖRÜR ve oradaki arka plan/dekoratif dili
 * çözümleyip aynı işlevi görecek öğeleri tarif eder. Öğeler sonra GPT Image 2.5
 * ile üretilir.
 *
 * @returns {Promise<{label,role,prompt,transparent,aspect,usage}[]>}
 */
async function planDesignAssets({ project, items, max = 4 }) {
  const referenceUrl = project?.reference_image_url || null;
  const dishNames = (items || []).slice(0, 25).map((i) => i.name).join(", ");

  const prompt = `RESTAURANT
name: ${project?.restaurant_name || ""}
${project?.cuisine ? `cuisine: ${project.cuisine}\n` : ""}${project?.subtitle ? `tagline: ${project.subtitle}\n` : ""}dishes: ${dishNames || "(not listed)"}
${project?.accent_color ? `accent colour: ${project.accent_color}\n` : ""}${project?.design_direction ? `design direction: ${project.design_direction}\n` : ""}
${referenceUrl ? "The attached image is the reference menu this design must follow. Study its background treatment, textures, decorative elements, borders and any illustrative artwork.\n" : ""}
TASK
Specify the custom artwork this menu needs — the pieces a designer would commission separately from the dish photographs: page backgrounds, surface textures, decorative ornaments, dividers, a cover image, small spot illustrations.

Rules:
- Ask for at most ${max} pieces, and only pieces the design genuinely needs. If this menu is purely typographic and needs no artwork at all, return an empty array [] — that is a valid and often correct answer.
${referenceUrl ? "- Mirror the FUNCTION of the artwork in the reference, adapted to this restaurant. If the reference sits on plain white with no artwork, return [].\n" : ""}- Each "prompt" is a complete, self-contained brief for an image-generation model: subject, material, colour, lighting, framing, mood. Write it in English, 1-3 sentences, concrete and visual.
- The artwork must contain NO text, letters, numbers, logos or people — the words are set as real type on top of it.
- Backgrounds and textures must be subtle enough that small type stays readable on them.
- "transparent": the image model can render a piece on a genuinely transparent background (alpha PNG), so cut-out ornaments, dividers, badges and spot illustrations that sit on top of the page can be requested with "transparent": true and they will drop onto any ground without a white box. Use false for full-bleed backgrounds and textures.
- "aspect": "portrait" for full pages, "landscape" for wide bands, "square" for spots.
- "usage": one short sentence, in the menu language (${project?.language || "tr"}), telling the layout designer where and how to use this piece.

Answer with a JSON array only, each item shaped:
{"label": "short name", "role": "background|texture|ornament|divider|cover|spot", "prompt": "...", "transparent": false, "aspect": "portrait", "usage": "..."}`;

  const raw = await askAstra({
    prompt,
    systemPrompt: ASSET_SYSTEM,
    imageUrls: referenceUrl ? [referenceUrl] : [],
    maxTokens: 6000,
    temperature: 0.7,
    tag: "MENU_ASSETS",
  });

  const parsed = parseJsonLoose(raw);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : [];
  return rows
    .filter((r) => r && typeof r.prompt === "string" && r.prompt.trim())
    .slice(0, max)
    .map((r) => ({
      label: stripCitations(r.label).slice(0, 80) || "Tasarım öğesi",
      role: ASSET_ROLES.includes(r.role) ? r.role : "ornament",
      prompt: stripCitations(r.prompt).slice(0, 900),
      transparent: !!r.transparent,
      aspect: ["portrait", "landscape", "square"].includes(r.aspect) ? r.aspect : "portrait",
      usage: stripCitations(r.usage).slice(0, 300) || null,
    }));
}

/** Operatörün seçtiği tasarım yönü → modele verilen brief cümlesi. */
const DIRECTION_BRIEF = {
  free: "Direction: entirely your call. Decide what visual language this particular restaurant deserves and commit to it fully.",
  modern: "Direction: contemporary editorial. Current design-magazine sensibility — a confident grid, large display type against small precise text, generous asymmetry, restrained palette with one decisive accent. It must read as designed in this decade, not as a traditional restaurant menu.",
  bold: "Direction: bold and graphic. Oversized type, strong colour blocking, high contrast, poster energy. The menu should work as a graphic object before it is read.",
  minimal: "Direction: minimal luxury. Extreme restraint, generous space, refined small type, precise alignment, almost no ornament — quiet confidence, nothing decorative that does not earn its place.",
  dark: "Direction: dark and atmospheric. A dark ground with light type, photography that glows against it, moody contrast — evening, candlelight, bar energy.",
  warm: "Direction: warm and welcoming. Warm ground tones, friendly but well-crafted typography, a hand-made feeling that still looks professionally art-directed.",
  playful: "Direction: playful and characterful. Unexpected type pairings, lively colour, wit in the details — energetic without becoming childish or cluttered.",
};

/**
 * Referans brief'i. Operatör bir menü görseli yüklediyse bu, promptun EN GÜÇLÜ
 * bölümü olur: yön/yoğunluk gibi stil tercihleri onun altında kalır, çünkü
 * kullanıcı zaten istediği görünümü göstermiştir.
 */
const REFERENCE_ANALYSIS = [
  "- the page architecture: how many columns, where the grid breaks, how the blocks are proportioned against each other",
  "- the typographic system: the classification of the display and text faces (serif or sans, condensed or wide, high or low contrast), their case, weight, letter-spacing and relative sizes",
  "- the section headings: their placement, alignment, case, and the rules or devices above and below them",
  "- the photography: how many photographs, their shapes and aspect ratios, where they sit in the grid, how tightly they are cropped, whether they butt against each other",
  "- the rules, dividers, borders, page furniture (header line, footer line, small caps labels) and any numbering",
  "- the palette, the ground colour and where colour is used at all",
  "- the density, the margins and the amount of empty space",
].join("\n");

const REFERENCE_BRIEF = {
  loose: `REFERENCE DESIGN — the FIRST attached image is a menu the operator likes. Take only its spirit: the mood, the palette feeling, the general attitude. You are free to restructure the layout as you see fit.`,
  close: `REFERENCE DESIGN — THIS IS THE OPERATOR'S PRIMARY INSTRUCTION AND IT OUTRANKS EVERY STYLISTIC PREFERENCE BELOW.
The FIRST attached image is a menu design the operator wants this menu to look like. Study it closely and rebuild ITS DESIGN SYSTEM with this restaurant's content:
${REFERENCE_ANALYSIS}
Reproduce that system faithfully — a viewer holding both should recognise them as the same design family. Replace only the content: this restaurant's name, sections, dishes, descriptions and prices, written in the menu language. Never copy the reference's own text, dish names, prices, address, social handle or brand, and never reproduce it as artwork.`,
  strict: `REFERENCE DESIGN — THIS IS THE OPERATOR'S PRIMARY INSTRUCTION AND IT OUTRANKS EVERY STYLISTIC PREFERENCE BELOW.
The FIRST attached image is a menu design the operator wants reproduced as a template. Rebuild it element for element with this restaurant's content:
${REFERENCE_ANALYSIS}
Match the reference's structure as closely as the different number of dishes allows: same column logic, same heading treatment, same photo shapes in the same positions, same rules and dividers, same typographic classification and case, same palette. Where this restaurant has more or fewer dishes than the reference, extend or shorten the pattern rather than inventing a new one. Replace only the content: this restaurant's name, sections, dishes, descriptions and prices, in the menu language. Never copy the reference's own text, dish names, prices, address, social handle or brand, and never reproduce it as artwork.`,
};

const PAGE_TARGET_BRIEF = {
  auto: "Page count: your decision — use as many pages as the content genuinely needs.",
  single: "Page count: EXACTLY ONE page. Everything must fit on a single sheet; scale the type and tighten the grid until it does.",
  spread: "Page count: EXACTLY TWO pages, designed as a facing spread that belongs together.",
  booklet: "Page count: FOUR pages, designed as a booklet that develops from page to page.",
};

const DENSITY_BRIEF = {
  airy: "Density: airy. Let the page breathe; generous margins and leading, fewer elements per page even if that means using more pages.",
  balanced: "Density: balanced. Comfortable reading rhythm without wasted space.",
  dense: "Density: dense. Fit the menu compactly, use a tight grid and small precise type — compact but never cramped or hard to read.",
};

const PHOTO_BRIEF = {
  auto: "Photography: you decide how prominently to use the supplied photographs, but every supplied photograph must appear somewhere in the design.",
  rich: "Photography: photography-led. The supplied photographs are the backbone of this design — use them large, cropped with intent, possibly full-bleed. Every supplied photograph must appear.",
  sparse: "Photography: sparing. Use the supplied photographs as small, precise accents inside a mainly typographic composition. Every supplied photograph must still appear, just quietly.",
  none: "Photography: none. Do not place any photographs in this design, even though image URLs are listed. Build a purely typographic composition.",
};

const CATEGORY_BRIEF = {
  auto: "Sections: decide yourself whether to group the dishes into named sections or present them as one continuous sequence, based on what serves this menu best.",
  grouped: "Sections: group the dishes under named section headings, using the category given for each dish (invent a sensible heading only where a dish has none). The section headings must be designed elements, not plain labels.",
  flat: "Sections: no section headings at all. Present the dishes as a single continuous composition; find another way to give the page structure.",
};

/**
 * Menünün tasarımını üret.
 *
 * ⚠️ Estetik MİKRO yönetim yok: yerleşim, tipografi, renk kararı modelin.
 * Operatör yalnız üst düzey yönü (design_direction), yoğunluğu ve içerik
 * görünürlüğünü (fiyat / açıklama / kategori / fotoğraf) seçer — 18 Eyl 2026
 * geri bildirimi: ilk çıktılar fazla klasik ve fazla sade kalıyordu.
 *
 * Yemek fotoğrafları modele GÖRSEL OLARAK da verilir (vision geçidi): tasarım
 * gerçek fotoğrafların rengi ve kadrajıyla uyumlu kurulsun diye.
 */
/**
 * Menü tasarımını üret.
 *
 * @param {object}   opts
 * @param {string=}  opts.feedback     Bu turdaki yeni istek.
 * @param {string[]=} opts.standing    Önceki turlarda verilmiş ve HÂLÂ GEÇERLİ istekler.
 *                                     fal'ın router uçları durumsuz — konuşma geçmişi
 *                                     parametresi yok — bu yüzden hafızayı biz taşıyoruz.
 * @param {string=}  opts.baseHtml     Doluysa REVİZE kipi: tasarım baştan çizilmez,
 *                                     bu belge üzerinde yalnızca istenen değişiklik yapılır.
 */
async function designMenu({ project, items, assets, feedback, standing, baseHtml }) {
  const page = PAGE_SPECS[project?.page_size] || PAGE_SPECS.A4;
  const showPrices = project?.show_prices !== false;
  const showDescriptions = project?.show_descriptions !== false;
  const photoMode = PHOTO_BRIEF[project?.photo_mode] ? project.photo_mode : "auto";
  const usePhotos = photoMode !== "none";

  const dishes = (items || []).map((i) => {
    const row = { name: i.name };
    if (showDescriptions && i.description) row.description = i.description;
    if (showPrices && i.price) row.price = i.price;
    if (i.category) row.category = i.category;
    if (usePhotos && i.image_url) row.image_url = i.image_url;
    return row;
  });

  const photoUrls = usePhotos ? dishes.map((d) => d.image_url).filter(Boolean) : [];
  const assetList = Array.isArray(assets) ? assets.filter((a) => a && a.image_url) : [];
  // Örnek tasarım: operatörün beğendiği bir menü görseli. Modele İLK görsel
  // olarak verilir; tasarım dili ondan alınır, içeriği değil.
  const referenceUrl = project?.reference_image_url || null;
  const referenceUrls = referenceImages(project, 4);

  const strength = REFERENCE_BRIEF[project?.reference_strength] ? project.reference_strength : "close";

  const brief = [
    // Referans varsa EN ÜSTTE ve yön brief'inin YERİNE geçer — ikisi birden
    // verilince model yönü dinleyip referansı görmezden geliyordu (18 Eyl 2026).
    referenceUrl ? REFERENCE_BRIEF[strength] : null,
    referenceUrl && strength !== "loose"
      ? "Where the reference and the preferences below disagree, the reference wins on everything visual; only the operator's explicit content switches (prices, descriptions, sections, photographs) override it."
      : null,
    referenceUrl && strength === "loose"
      ? DIRECTION_BRIEF[project?.design_direction] || DIRECTION_BRIEF.modern
      : referenceUrl
        ? null
        : DIRECTION_BRIEF[project?.design_direction] || DIRECTION_BRIEF.modern,
    PAGE_TARGET_BRIEF[project?.page_target] || PAGE_TARGET_BRIEF.auto,
    DENSITY_BRIEF[project?.density] || DENSITY_BRIEF.balanced,
    CATEGORY_BRIEF[project?.category_mode] || CATEGORY_BRIEF.auto,
    PHOTO_BRIEF[photoMode],
    showPrices
      ? "Prices: shown. Integrate them into the composition — they do not have to sit in a right-hand column."
      : "Prices: DO NOT show any prices anywhere in this menu. No price column, no numbers, no currency symbol.",
    showDescriptions
      ? "Descriptions: shown where a dish has one."
      : "Descriptions: DO NOT show dish descriptions. Dish names only.",
    project?.accent_color
      ? `Accent colour: build the palette around ${project.accent_color}. Everything else is your decision.`
      : "Palette: your decision.",
    referenceUrl && project?.reference_note
      ? `The operator says about the reference: ${project.reference_note}`
      : null,
    // Hazır menü stili seçildiyse o stilin hazır tarifi de brief'e girer.
    referenceUrl && project?.style_prompt
      ? `STYLE BRIEF for the chosen menu style — written by a designer who studied these exact reference pages. Follow it together with the images:\n${project.style_prompt}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Önceki turlardan gelen ve hâlâ geçerli olan istekler. Model durumsuz
  // çalıştığı için bunlar her seferinde yeniden veriliyor.
  const standingList = (standing || []).map((x) => String(x || "").trim()).filter(Boolean);
  const standingBlock = standingList.length
    ? `STANDING REQUESTS — the operator asked for each of these in an earlier pass and they are ALL still in force. The document must satisfy every one of them when you are done, even the ones this pass is not about. Never undo one of them.
${standingList.map((x, i) => `${i + 1}. ${x}`).join("\n")}
`
    : "";

  // ── REVİZE KİPİ ──────────────────────────────────────────────────────────────
  // Elde onaylanmış bir tasarım varken küçük bir düzenleme istendiğinde menüyü
  // baştan çizmek iki soruna yol açıyordu: (a) önceki istekler kayboluyordu,
  // (b) tasarım her turda azıcık kayıyordu. Burada belge temel alınıyor.
  if (baseHtml) {
    // Fotoğraf yenilendiyse belgedeki adres eskimiş olur. Eşleştirebildiklerimizi
    // makine gibi değiştiriyoruz (bedava ve kesin); kalanını modele bırakıyoruz.
    let working = baseHtml;
    for (const i of items || []) {
      const from = i.original_image_url;
      const to = i.image_url;
      if (from && to && from !== to && working.includes(from)) working = working.split(from).join(to);
    }
    const stale = [...new Set([...working.matchAll(/https?:\/\/[^"')\s]+\.(?:png|jpe?g|webp)/gi)].map((m) => m[0]))]
      .filter((u) => !photoUrls.includes(u) && !assetList.some((a) => a.image_url === u));

    // Belgede henüz geçmeyen fotoğraflar = yeni eklenen ya da yeniden üretilen
    // yemekler; sadece onları göstermek yeterli, tüm kareleri yüklemek gereksiz.
    const newPhotos = photoUrls.filter((u) => !working.includes(u)).slice(0, 6);
    const contentSwitches = [
      showPrices
        ? "Prices: shown."
        : "Prices: hidden — there must be no price, number or currency symbol anywhere.",
      showDescriptions ? "Descriptions: shown where a dish has one." : "Descriptions: hidden — dish names only.",
      usePhotos ? "Dish photographs: used." : "Dish photographs: none — remove any dish photograph.",
    ].join("\n");

    const revisePrompt = `CURRENT MENU DOCUMENT — this is the approved design. Work on it.
\`\`\`html
${working}
\`\`\`

${standingBlock}${feedback ? `THIS PASS — the operator's new request. Apply exactly this, and only this:
${feedback}
` : `THIS PASS — the operator changed a setting rather than writing a request. Bring the document in line with the settings below and change nothing else.
`}
CONTENT SETTINGS currently in force:
${contentSwitches}

DISH DATA — the single source of truth for names${showDescriptions ? ", descriptions" : ""}${showPrices ? ", prices" : ""} and photographs. Use it to add, correct or remove entries; never invent a dish, a price, an ingredient or a claim. Menu language: ${project?.language || "tr"}.
${JSON.stringify(dishes, null, 1)}
${newPhotos.length ? `\nNEW PHOTOGRAPHS — these image URLs are not in the document yet and belong to dishes added or re-shot since the last pass. Place them the same way the existing dish photographs are placed, at the same crop, scale and treatment:\n${newPhotos.join("\n")}\n` : ""}${stale.length ? `\nOUT-OF-DATE PHOTOGRAPHS — these URLs still appear in the document but are no longer that dish's photograph. Replace each one with the current URL the dish data gives for the dish it is illustrating, keeping the container, crop, scale and treatment exactly as they are. If a dish no longer has a photograph, remove the image but keep its slot in the composition intact:\n${stale.join("\n")}\n` : ""}
RULES
1. Return the COMPLETE HTML document, not a fragment and not a diff. It must still be self-contained: one <style> tag, no JavaScript, the same @page rule.
2. Keep every part of the design that the request does not touch byte-identical — fonts, colours, grid, margins, page count, image placement, class names, source order.
3. Keep the operator's own text edits: the wording that is in the document stays as it is unless the dish data or the request says otherwise.
4. If new content makes a block too tall, absorb it inside that block (tighten its own leading, or let the section grow) rather than reflowing the page or restyling neighbours. Never let text overflow or clip at a page edge.
5. If the request is impossible without breaking the design, do the closest thing that preserves the design and change nothing else.

Return only the HTML document.`;

    const revised = await askAstra({
      prompt: revisePrompt,
      systemPrompt: REVISE_SYSTEM,
      imageUrls: newPhotos,
      maxTokens: 48000,
      // Tutarlılık istiyoruz; yaratıcılık değil.
      temperature: 0.2,
      maxRetries: 2,
      tag: "MENU_REVISE",
    });
    const revisedHtml = extractHtml(revised);
    if (!revisedHtml) throw new Error("Astra geçerli bir HTML belgesi döndürmedi");
    return revisedHtml;
  }

  const prompt = `RESTAURANT
name: ${project?.restaurant_name || ""}
${project?.subtitle ? `tagline: ${project.subtitle}\n` : ""}${project?.cuisine ? `cuisine: ${project.cuisine}\n` : ""}menu language: ${project?.language || "tr"} (every word you write must be in this language)
${showPrices ? `currency symbol: ${project?.currency || "₺"}\n` : ""}${project?.notes ? `\nOperator notes — facts about the venue, not design instructions:\n${project.notes}\n` : ""}
DESIGN BRIEF
${brief}

DISHES (${dishes.length} total${photoUrls.length ? `, ${photoUrls.length} with a photograph` : ""})
${JSON.stringify(dishes, null, 1)}
${referenceUrls.length ? `\nATTACHED IMAGES: image${referenceUrls.length > 1 ? `s 1-${referenceUrls.length} are the pages of the operator's reference menu — one design, seen across several pages` : " 1 is the operator's reference design"}${photoUrls.length ? `; the images after them are the dish photographs` : ""}.\n` : ""}${photoUrls.length ? `\nThe dish photographs are attached so you can see them. Design with their actual colours, lighting and crops in mind — the palette and the photography should look like they belong together.\n` : ""}${photoUrls.length && project?.photo_cutout ? `\n⚠️ The dish photographs are CUT-OUT PNGs with a genuinely transparent background — each plate floats with no background of its own. Place them directly on your coloured grounds, overlap them with each other and with the type, let them cross panel edges, and give them a soft CSS drop-shadow (filter: drop-shadow(...)) so they sit on the page. Never put them inside a rectangular frame, a white box or a bordered container, and never give their container a background colour of its own.\n` : ""}${standingBlock ? `\n${standingBlock}` : ""}${feedback ? `\nREVISION REQUEST FROM THE OPERATOR — this overrides your previous choices where they conflict:\n${feedback}\n` : ""}
${
    project?.design_spec
      ? `REFERENCE DESIGN SPECIFICATION — the reference was reverse-engineered layer by layer. Treat this as a checklist and satisfy EVERY entry; a viewer comparing the two should not be able to point at a structural difference. Only the content changes.
${JSON.stringify(project.design_spec, null, 1)}

`
      : ""
  }${assetList.length ? `DESIGN ARTWORK — custom pieces generated for this menu. Use them as their role suggests; you decide the exact placement, scale and layering.
${JSON.stringify(
  assetList.map((a) => ({ role: a.role, label: a.label, usage: a.usage_note || a.usage || undefined, transparent: a.transparent, url: a.image_url })),
  null,
  1,
)}
Transparent pieces are cut-outs meant to sit over the page; the others are full-bleed grounds. Keep type legible over them — tint, scrim or crop as needed. You may reuse one artwork on several pages at different crops.
` : ""}TECHNICAL REQUIREMENTS (the only hard rules; everything visual is your decision)
1. Output ONE complete, self-contained HTML document: <!DOCTYPE html>, <html>, <head> with <meta charset="utf-8">, all CSS inside a single <style> tag. No JavaScript at all, no external CSS files.
2. Web fonts: load them from https://fonts.googleapis.com with a <link>, and pick typefaces deliberately — the default system serif is not a design decision. Always declare a real fallback stack.
3. Print target: ${page.label}. Include @page { size: ${page.css}; margin: <your choice> } and make the body render at exactly that paper size on screen as well, so the page is a true print preview. Use mm/pt for print geometry. Add -webkit-print-color-adjust: exact and print-color-adjust: exact so backgrounds and tints survive printing.
4. If the menu runs to more than one page, create further page containers of the same size separated by page-break-after: always. No text may overflow off a page or be clipped at a page edge.
4b.${
    project?.page_continuity === false
      ? " Pages may stand on their own."
      : ` CONTINUITY BETWEEN PAGES — mandatory whenever there is more than one page. The pages must read as one designed object, not as separate sheets:
   • Carry one system across every page: identical margins, the same running header/footer, consistent section numbering, the same type scale.
   • At least one picture MUST be split across the page break so that it visibly continues. The technique: put the SAME image src in a container on page N and again on page N+1; give the first \`object-fit: cover; object-position: <x>% center\` and the second the complementary position, sizing both so the two visible slices reconstruct one photograph interrupted by the fold. A plate cut at the outer edge of one page reappears, continuing, on the next.
   • Let the composition develop across pages instead of repeating: move the dominant element, deepen a tinted ground, or advance the accent — never repeat an identical page layout twice in a row.`
  }
5. ${
    usePhotos && photoUrls.length
      ? "Every dish image_url listed above must appear in the design, each used at least once, written exactly as given. You decide the crop, scale and placement. Never invent an image URL, never use a placeholder service, never take an image from anywhere else."
      : "Do not place any dish photographs in this design."
  }${assetList.length ? " The design artwork URLs may be used freely, repeated and cropped differently on different pages; artwork you do not need may be left out." : ""}
6. Every dish name${showDescriptions ? ", description" : ""}${showPrices ? " and price" : ""} shown must come from the data above, unchanged. Do not invent dishes, prices, allergens or claims. You may write your own structural words — section headings, the restaurant name, page furniture — in the menu language.
7. All text must be real, selectable HTML text; never bake text into an image, because the operator edits it afterwards.
8. Keep the markup clean and shallow enough for a human to edit the text nodes by hand.

Design the menu now and return only the HTML document.`;

  const raw = await askAstra({
    prompt,
    systemPrompt: DESIGN_SYSTEM,
    // Modele göster: varsa önce referans tasarım, sonra yemek fotoğrafları
    imageUrls: [...referenceUrls, ...assetList.map((a) => a.image_url).slice(0, 4), ...photoUrls.slice(0, 6)].filter(Boolean),
    maxTokens: 48000,
    temperature: 0.9,
    maxRetries: 2,
    tag: "MENU_DESIGN",
  });

  const html = extractHtml(raw);
  if (!html) throw new Error("Astra geçerli bir HTML belgesi döndürmedi");
  return html;
}

module.exports = {
  ROUTER_ENDPOINT,
  stripCitations,
  referenceImages,
  planDesignAssets,
  analyzePhotoStyle,
  analyzeReferenceDesign,
  verifyDishPhotos,
  DEFAULT_MODEL,
  PAGE_SPECS,
  getMenuModel,
  askAstra,
  researchDishes,
  designMenu,
  parseJsonLoose,
  extractHtml,
};
