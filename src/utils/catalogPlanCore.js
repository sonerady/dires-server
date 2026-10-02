/* eslint-disable */
// 🧭 Katalog PDF — plan çekirdeği (30 Eyl 2026)
//
// ⚠️ İKİZ DOSYA — bayt bayt aynı iki kopya:
//     client/components/catalogPdf/catalogPlanCore.js
//     server/src/utils/catalogPlanCore.js
// Biri değişirse diğeri de kopyalanır (client ve server ayrı depolar; ortak paket yok).
// Bağımlılıksız CommonJS: Metro da Node da doğrudan yükler.
//
// İçerik:
//   sanitizePlanInput(body)       → istek gövdesini şemaya oturtur (sunucu doğrulaması + istemci aynı şekli kurar)
//   buildFallbackPlan(input)      → yapay zekâ yoksa / başarısızsa belirlenimci plan (çevrimdışı da çalışır)
//   validatePlan(raw, input)      → modelin JSON'unu SIKI doğrular; bilinmeyen alan atılır
//   finalizePlan(raw, input, m)   → doğrula + eksikleri yedekten doldur + açık değerleri uygula
//   scrubCopy(text, facts, max)   → uydurma iddia / marka / iletişim / ölçü içeren cümleleri atar
// Kural: satıcının verdiği açık değerler (brief "Ben belirleyeyim" alanları, kilitli ayarlar,
// ürünün kendi adı/açıklaması/rozeti) HER ZAMAN yapay zekâ çıktısını ezer.
"use strict";

var PLAN_VERSION = 1;
var THEME_IDS = ["minimal", "editorial", "bold", "luxury", "pastel"];
var FONT_PAIR_IDS = ["modern", "classic", "elegant", "bold", "friendly", "geometric"];
var LAYOUTS = ["hero1", "grid2", "grid4", "grid6", "grid9", "list"];
var PURPOSES = ["retail", "wholesale", "seasonal", "lookbook", "newArrivals", "sale"];
var TONES = ["minimal", "premium", "playful", "bold"];
var BADGES = ["new", "bestseller", "sale"];
var THEME_ACCENTS = { minimal: "#121212", editorial: "#8C2F2B", bold: "#FF4B1F", luxury: "#C9A96E", pastel: "#DE7F98" };
var LIMITS = {
  products: 150, visionProducts: 12, sections: 12, name: 90, sku: 40, description: 320, aiDescription: 280,
  highlight: 70, highlights: 4, chip: 24, chips: 14, title: 70, subtitle: 90, tagline: 110, sectionTitle: 60,
  sectionIntro: 220, headline: 70, cta: 120, audience: 120, storeName: 60, rationale: 240, label: 60,
};
var DEFAULT_LABELS = {
  featured: "Featured", collection: "The collection", onSale: "On sale", newIn: "New in",
  thanks: "Thank you", cta: "Get in touch to order", dateLine: "", catalog: "Product catalog",
};
var LOCKED_KEYS = ["theme", "accent", "fontPair", "pageSize", "orientation", "toc", "showPrices", "showSku", "coverTitle", "coverSubtitle", "coverTagline", "coverProductId", "backHeadline", "backCta", "layout"];

// ─── Küçük yardımcılar ─────────────────────────────────────────────────────
function str(value, max) {
  var s = value == null ? "" : String(value);
  s = s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return typeof max === "number" ? s.slice(0, max).trim() : s;
}
function oneOf(value, list, fallback) { return list.indexOf(value) >= 0 ? value : fallback; }
function num(value) {
  if (value === null || value === undefined || value === "") return null;
  var n = typeof value === "number" ? value : Number(value);
  return isFinite(n) && n >= 0 && n < 1e12 ? Math.round(n * 1000) / 1000 : null;
}
function lower(s) {
  var t = String(s || "");
  try { t = t.toLocaleLowerCase("tr"); } catch (e) { t = t.toLowerCase(); }
  return t.replace(/i\u0307/g, "i");
}
function uniqueStrings(list, max, itemMax) {
  var out = [];
  var seen = {};
  (Array.isArray(list) ? list : []).forEach(function (item) {
    var s = str(item, itemMax);
    var k = lower(s);
    if (!s || seen[k] || out.length >= max) return;
    seen[k] = true;
    out.push(s);
  });
  return out;
}
function isHex(value) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }

// ─── İstek şeması ──────────────────────────────────────────────────────────
function sanitizePlanInput(body) {
  var b = body && typeof body === "object" ? body : {};
  var br = b.brief && typeof b.brief === "object" ? b.brief : {};
  var st = b.store && typeof b.store === "object" ? b.store : {};
  var lk = b.locked && typeof b.locked === "object" ? b.locked : {};
  var lb = b.labels && typeof b.labels === "object" ? b.labels : {};
  var language = typeof b.language === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(b.language) ? b.language : "en";

  var products = [];
  var seen = {};
  (Array.isArray(b.products) ? b.products : []).forEach(function (p) {
    if (!p || typeof p !== "object" || products.length >= LIMITS.products) return;
    var id = typeof p.id === "string" ? p.id.slice(0, 64) : "";
    if (!id || seen[id]) return;
    seen[id] = true;
    var imageUrl = typeof p.imageUrl === "string" && /^https:\/\/[^\s]+$/i.test(p.imageUrl) && p.imageUrl.length <= 600 ? p.imageUrl : null;
    products.push({
      id: id,
      name: str(p.name, LIMITS.name),
      sku: str(p.sku, LIMITS.sku),
      price: num(p.price),
      oldPrice: num(p.oldPrice),
      description: str(p.description, LIMITS.description),
      colors: uniqueStrings(p.colors, LIMITS.chips, LIMITS.chip),
      sizes: uniqueStrings(p.sizes, LIMITS.chips, LIMITS.chip),
      badge: oneOf(p.badge, BADGES, ""),
      hasImage: p.hasImage === true || !!imageUrl,
      imageUrl: imageUrl,
    });
  });
  var ids = {};
  products.forEach(function (p) { ids[p.id] = true; });

  var brief = {
    mode: oneOf(br.mode, ["ai", "manual"], "ai"),
    purpose: oneOf(br.purpose, ["auto"].concat(PURPOSES), "auto"),
    audience: str(br.audience, LIMITS.audience),
    tone: oneOf(br.tone, ["auto"].concat(TONES), "auto"),
    layout: oneOf(br.layout, ["auto"].concat(LAYOUTS), "auto"),
    coverTitle: str(br.coverTitle, LIMITS.title),
    coverSubtitle: str(br.coverSubtitle, LIMITS.subtitle),
    sectionsMode: oneOf(br.sectionsMode, ["auto", "custom"], "auto"),
    sectionTitles: uniqueStrings(br.sectionTitles, LIMITS.sections, LIMITS.sectionTitle),
    highlightMode: oneOf(br.highlightMode, ["auto", "custom", "none"], "auto"),
    highlightIds: (Array.isArray(br.highlightIds) ? br.highlightIds : []).filter(function (id, i, a) { return typeof id === "string" && ids[id] && a.indexOf(id) === i; }).slice(0, 24),
    prices: oneOf(br.prices, ["auto", "show", "hide"], "auto"),
  };
  // "Yapay zekâya bırak" modunda brief alanları açık değer sayılmaz
  if (brief.mode === "ai") {
    brief = { mode: "ai", purpose: "auto", audience: "", tone: "auto", layout: "auto", coverTitle: "", coverSubtitle: "", sectionsMode: "auto", sectionTitles: [], highlightMode: "auto", highlightIds: [], prices: "auto" };
  }

  var locked = {};
  if (THEME_IDS.indexOf(lk.theme) >= 0) locked.theme = lk.theme;
  if (isHex(lk.accent)) locked.accent = lk.accent.toUpperCase();
  if (FONT_PAIR_IDS.indexOf(lk.fontPair) >= 0) locked.fontPair = lk.fontPair;
  if (lk.pageSize === "A4" || lk.pageSize === "Letter") locked.pageSize = lk.pageSize;
  if (lk.orientation === "portrait" || lk.orientation === "landscape") locked.orientation = lk.orientation;
  if (LAYOUTS.indexOf(lk.layout) >= 0) locked.layout = lk.layout;
  ["toc", "showPrices", "showSku"].forEach(function (k) { if (typeof lk[k] === "boolean") locked[k] = lk[k]; });
  if (typeof lk.coverTitle === "string") locked.coverTitle = str(lk.coverTitle, LIMITS.title);
  if (typeof lk.coverSubtitle === "string") locked.coverSubtitle = str(lk.coverSubtitle, LIMITS.subtitle);
  if (typeof lk.coverTagline === "string") locked.coverTagline = str(lk.coverTagline, LIMITS.tagline);
  if (typeof lk.coverProductId === "string" && ids[lk.coverProductId]) locked.coverProductId = lk.coverProductId;
  if (typeof lk.backHeadline === "string") locked.backHeadline = str(lk.backHeadline, LIMITS.headline);
  if (typeof lk.backCta === "string") locked.backCta = str(lk.backCta, LIMITS.cta);

  var labels = {};
  Object.keys(DEFAULT_LABELS).forEach(function (k) { labels[k] = str(lb[k], LIMITS.label) || DEFAULT_LABELS[k]; });

  return {
    language: language,
    brief: brief,
    store: {
      name: str(st.name, LIMITS.storeName),
      currency: typeof st.currency === "string" && /^[A-Z]{3}$/.test(st.currency) ? st.currency : "USD",
      pageSize: st.pageSize === "Letter" ? "Letter" : "A4",
      orientation: st.orientation === "landscape" ? "landscape" : "portrait",
    },
    locked: locked,
    products: products,
    labels: labels,
  };
}

// ─── Uydurma iddia süzgeci ─────────────────────────────────────────────────
// Satıcının verdiği bilgide geçmeyen sertifika, malzeme, menşe, garanti, "çok satan",
// ölçü/rakam, marka ya da iletişim bilgisi içeren cümle (başlıkta: kelime) atılır.
var CLAIM_TERMS = [
  "certif", "sertifika", "organic", "organik", "patent", "award", "ödül", "guarantee", "garanti", "warranty",
  "waterproof", "water-resistant", "su geçirmez", "suya dayanıklı", "hypoallergenic", "antialerjik", "anti-alerjik",
  "eco-friendly", "eco friendly", "çevre dostu", "sustainab", "sürdürülebilir", "recycled", "geri dönüştürül",
  "handmade", "hand-made", "hand made", "el yapımı", "el işi", "vegan", "cruelty", "dermatolog", "clinical", "klinik",
  "free shipping", "ücretsiz kargo", "kargo bedava", "best-selling", "best selling", "bestseller", "best seller",
  "çok satan", "en çok satan", "limited edition", "sınırlı sayıda", "sınırlı üretim", "made in", "yerli üretim",
  "imported", "ithal", "genuine", "hakiki", "gerçek deri", "real leather", "the best", "en iyi", "number one", "#1",
  "world's", "dünyanın en", "100%", "%100", "premium quality", "birinci sınıf", "orijinal", "original",
  "cotton", "pamuk", "linen", "keten", "silk", "ipek", "leather", "deri ", "wool", "yün", "cashmere", "kaşmir",
  "polyester", "viscose", "viskon", "nylon", "naylon", "elastane", "elastan", "lycra", "likra", "satin", "saten",
  "velvet", "kadife", "suede", "süet", "ceramic", "seramik", "porcelain", "porselen", "stainless", "paslanmaz",
  "titanium", "titanyum", "sterling", "925", "14k", "18k", "22k", "24k", "karat", "solid wood", "masif", "bamboo",
  "bambu", "marble", "mermer", "gold-plated", "altın kaplama", "gümüş kaplama", "silver-plated",
];
var BRAND_TERMS = [
  "amazon", "etsy", "ebay", "trendyol", "hepsiburada", "n11", "shopify", "temu", "aliexpress", "instagram", "tiktok",
  "facebook", "whatsapp", "pinterest", "youtube", "google", "apple", "iphone", "samsung", "nike", "adidas", "puma",
  "zara", "h&m", "mango", "gucci", "prada", "chanel", "louis vuitton", "dior", "hermès", "hermes", "rolex", "cartier",
  "levi's", "lego", "disney", "ikea", "dyson", "diress",
];
var CONTACT_RE = /(https?:\/\/|www\.|[^\s@]+@[^\s@]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d)/i;
var SPEC_RE = /(\d+(?:[.,]\d+)?)\s?(cm|mm|km|kg|gr|mg|ml|cl|lt|oz|lbs?|inch|mah|kw|gb|tb|mb|hz|°c|°f|m|g|l|w|v|in|")(?![a-zçğıöşü0-9])/gi;
var EMOJI_RE = /[\u2600-\u27BF\uFE0F\u200D]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/g;

function termAt(text, term) {
  var i = text.indexOf(term);
  while (i >= 0) {
    var before = i === 0 ? " " : text.charAt(i - 1);
    if (!/[a-z0-9çğıöşü]/i.test(before)) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}
// Aynı iddianın diller arası karşılıkları: olgularda "keten" varsa modelin "linen" demesi uydurma değildir
var CLAIM_SYNONYMS = [
  ["linen", "keten"], ["cotton", "pamuk"], ["silk", "ipek"], ["leather", "deri ", "real leather", "gerçek deri", "genuine", "hakiki"],
  ["wool", "yün"], ["cashmere", "kaşmir"], ["suede", "süet"], ["velvet", "kadife"], ["satin", "saten"], ["ceramic", "seramik"],
  ["porcelain", "porselen"], ["marble", "mermer"], ["bamboo", "bambu"], ["stainless", "paslanmaz"], ["titanium", "titanyum"],
  ["viscose", "viskon"], ["nylon", "naylon"], ["elastane", "elastan"], ["lycra", "likra"], ["handmade", "hand-made", "hand made", "el yapımı", "el işi"],
  ["organic", "organik"], ["waterproof", "water-resistant", "su geçirmez", "suya dayanıklı"], ["recycled", "geri dönüştürül"],
  ["free shipping", "ücretsiz kargo", "kargo bedava"], ["certif", "sertifika"], ["guarantee", "garanti", "warranty"],
  ["limited edition", "sınırlı sayıda", "sınırlı üretim"], ["hypoallergenic", "antialerjik", "anti-alerjik"], ["eco-friendly", "eco friendly", "çevre dostu"],
  ["sustainab", "sürdürülebilir"], ["gold-plated", "altın kaplama"], ["silver-plated", "gümüş kaplama"], ["100%", "%100"],
  ["best-selling", "best selling", "bestseller", "best seller", "çok satan", "en çok satan"], ["original", "orijinal"],
];
function allowedByFacts(term, factsLower) {
  if (termAt(factsLower, term)) return true;
  for (var i = 0; i < CLAIM_SYNONYMS.length; i++) {
    var group = CLAIM_SYNONYMS[i];
    if (group.indexOf(term) < 0) continue;
    for (var j = 0; j < group.length; j++) if (termAt(factsLower, group[j])) return true;
  }
  return false;
}
/** Metin parçası, olgularda (facts) geçmeyen bir iddia/marka/iletişim/ölçü içeriyor mu? */
function violates(segment, factsLower) {
  var t = lower(segment);
  if (CONTACT_RE.test(segment)) return true;
  for (var i = 0; i < CLAIM_TERMS.length; i++) if (termAt(t, CLAIM_TERMS[i]) && !allowedByFacts(CLAIM_TERMS[i], factsLower)) return true;
  for (var j = 0; j < BRAND_TERMS.length; j++) if (termAt(t, BRAND_TERMS[j]) && !termAt(factsLower, BRAND_TERMS[j])) return true;
  var m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(t))) {
    if (factsLower.indexOf(m[1]) < 0) return true;
  }
  return false;
}
/** Cümlelere böler: nokta vb. ancak ardından boşluk/son gelirse cümle biter ("www.site.com" bölünmez). */
function sentences(text) {
  var out = [];
  var buf = "";
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    buf += ch;
    var next = text.charAt(i + 1);
    var endPunct = /[.!?;…]/.test(ch) && (next === "" || /\s/.test(next)) && !/[.!?;…]/.test(next);
    if (endPunct || ch === "\n" || ch === "•") { out.push(buf); buf = ""; }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * @param {*} text      modelin yazdığı metin
 * @param {string} facts satıcının verdiği olguların birleşik metni
 * @param {number} max   azami uzunluk
 * @param {{single?: boolean}} [opt] single: başlık/kısa ifade — cümle bölünmez; ihlalde tamamı atılır
 */
function scrubCopy(text, facts, max, opt) {
  var s = str(text).replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  var f = lower(facts || "");
  if (opt && opt.single) return violates(s, f) ? "" : s.slice(0, max).trim();
  var kept = sentences(s).filter(function (p) { return p.replace(/[•\s]/g, "") && !violates(p, f); }).join("").replace(/\s+/g, " ").trim();
  if (kept.length <= max) return kept;
  // Sınırı aşarsa son tam cümlede kes
  var cut = kept.slice(0, max);
  var end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

function productFacts(p) {
  return [p.name, p.sku, p.description, (p.colors || []).join(" "), (p.sizes || []).join(" ")].join(" \n ");
}
function storeFacts(input) {
  var b = input.brief;
  return [input.store.name, b.audience, b.coverTitle, b.coverSubtitle, (b.sectionTitles || []).join(" "), input.locked.coverTitle, input.locked.coverSubtitle, input.locked.coverTagline, input.locked.backHeadline, input.locked.backCta]
    .concat(input.products.map(productFacts)).join(" \n ");
}

// ─── Belirlenimci (yedek) plan ─────────────────────────────────────────────
function discounted(p) { return p.price != null && p.oldPrice != null && p.oldPrice > p.price; }
function layoutForCount(n) { return n <= 2 ? "hero1" : n <= 6 ? "grid2" : n <= 20 ? "grid4" : "grid6"; }
function featuredLayout(n) { return n <= 3 ? "hero1" : n <= 6 ? "grid2" : "grid4"; }

function inferPurpose(input) {
  var b = input.brief;
  if (b.purpose !== "auto") return b.purpose;
  var list = input.products;
  var sale = list.filter(discounted).length;
  if (sale && sale >= list.length * 0.3) return "sale";
  var fresh = list.filter(function (p) { return p.badge === "new"; }).length;
  if (fresh && fresh >= list.length * 0.5) return "newArrivals";
  return "retail";
}

function buildFallbackPlan(input) {
  var list = input.products;
  var labels = input.labels;
  var b = input.brief;
  var purpose = inferPurpose(input);
  var tone = b.tone !== "auto" ? b.tone : { lookbook: "premium", sale: "bold", seasonal: "premium", wholesale: "minimal", newArrivals: "minimal", retail: "minimal" }[purpose];
  var theme = { minimal: "minimal", premium: purpose === "lookbook" ? "luxury" : "editorial", playful: "pastel", bold: "bold" }[tone] || "minimal";
  var n = list.length;
  var base = b.layout !== "auto" ? b.layout : purpose === "wholesale" ? "list" : purpose === "lookbook" ? (n <= 12 ? "hero1" : "grid2") : layoutForCount(n);
  var ids = list.map(function (p) { return p.id; });
  var sections;
  if (purpose === "sale" && list.some(discounted) && !list.every(discounted)) {
    var off = list.filter(discounted).map(function (p) { return p.id; });
    sections = [
      { title: labels.onSale, intro: "", layout: base === "list" ? "list" : layoutForCount(off.length), productIds: off },
      { title: labels.collection, intro: "", layout: base, productIds: ids.filter(function (id) { return off.indexOf(id) < 0; }) },
    ];
  } else if (purpose === "newArrivals" && list.some(function (p) { return p.badge === "new"; }) && !list.every(function (p) { return p.badge === "new"; })) {
    var fresh = list.filter(function (p) { return p.badge === "new"; }).map(function (p) { return p.id; });
    sections = [
      { title: labels.newIn, intro: "", layout: base === "list" ? "list" : layoutForCount(fresh.length), productIds: fresh },
      { title: labels.collection, intro: "", layout: base, productIds: ids.filter(function (id) { return fresh.indexOf(id) < 0; }) },
    ];
  } else {
    sections = [{ title: "", intro: "", layout: base, productIds: ids }];
  }
  var withImage = list.filter(function (p) { return p.hasImage; });
  var cover = (b.highlightIds || []).map(function (id) { return list.find(function (p) { return p.id === id && p.hasImage; }); }).filter(Boolean)[0] || withImage[0] || null;
  var title = b.coverTitle || input.store.name || labels.catalog;
  var products = {};
  list.forEach(function (p) {
    if (p.badge) return;
    if (purpose === "sale" && discounted(p)) products[p.id] = { badge: "sale" };
    else if (b.purpose === "newArrivals") products[p.id] = { badge: "new" };
  });
  var plan = {
    theme: theme,
    accent: THEME_ACCENTS[theme],
    fontPair: null,
    pageSize: input.store.pageSize,
    orientation: input.store.orientation,
    toc: n >= 8 || sections.length >= 3,
    showPrices: b.prices === "show" ? true : b.prices === "hide" ? false : purpose === "lookbook" ? false : list.some(function (p) { return p.price != null; }),
    showSku: purpose === "wholesale" || list.some(function (p) { return !!p.sku; }),
    cover: {
      title: title,
      subtitle: b.coverSubtitle || labels.dateLine,
      tagline: "",
      imageProductId: cover ? cover.id : null,
    },
    sections: sections.filter(function (s) { return s.productIds.length; }),
    products: products,
    backPage: { headline: labels.thanks, cta: labels.cta },
    rationale: "",
  };
  return applyExplicit(plan, input);
}

// ─── Açık değerler ─────────────────────────────────────────────────────────
function conformSections(sections, titles, allIds) {
  var target = titles.map(function (title) { return { title: title, intro: "", layout: null, productIds: [] }; });
  var used = {};
  sections.forEach(function (s, i) {
    var idx = -1;
    for (var k = 0; k < target.length; k++) if (lower(target[k].title) === lower(s.title)) { idx = k; break; }
    if (idx < 0) idx = Math.min(i, target.length - 1);
    var t = target[idx];
    if (!t.layout) t.layout = s.layout;
    if (!t.intro && s.intro) t.intro = s.intro;
    s.productIds.forEach(function (id) { if (!used[id]) { used[id] = true; t.productIds.push(id); } });
  });
  allIds.forEach(function (id) { if (!used[id]) target[target.length - 1].productIds.push(id); });
  return target.filter(function (t) { return t.productIds.length; }).map(function (t) { return { title: t.title, intro: t.intro, layout: t.layout || "grid4", productIds: t.productIds }; });
}

function featureFirst(sections, ids, title) {
  var set = {};
  ids.forEach(function (id) { set[id] = true; });
  var existing = sections.find(function (s) { return s.productIds.length === ids.length && s.productIds.every(function (id) { return set[id]; }); });
  var rest = sections.map(function (s) { return { title: s.title, intro: s.intro, layout: s.layout, productIds: s.productIds.filter(function (id) { return !set[id]; }) }; })
    .filter(function (s) { return s.productIds.length; });
  var featured = existing
    ? { title: existing.title || title, intro: existing.intro, layout: existing.layout, productIds: ids.slice() }
    : { title: title, intro: "", layout: featuredLayout(ids.length), productIds: ids.slice() };
  return [featured].concat(rest);
}

function applyExplicit(plan, input) {
  var out = {
    theme: plan.theme, accent: plan.accent, fontPair: plan.fontPair, pageSize: plan.pageSize, orientation: plan.orientation,
    toc: plan.toc, showPrices: plan.showPrices, showSku: plan.showSku,
    cover: { title: plan.cover.title, subtitle: plan.cover.subtitle, tagline: plan.cover.tagline, imageProductId: plan.cover.imageProductId },
    sections: plan.sections.map(function (s) { return { title: s.title, intro: s.intro || "", layout: s.layout, productIds: s.productIds.slice() }; }),
    products: {},
    backPage: { headline: plan.backPage.headline, cta: plan.backPage.cta },
    rationale: plan.rationale || "",
  };
  var b = input.brief;
  var lk = input.locked;
  var allIds = input.products.map(function (p) { return p.id; });
  if (b.mode === "manual") {
    if (b.coverTitle) out.cover.title = b.coverTitle;
    if (b.coverSubtitle) out.cover.subtitle = b.coverSubtitle;
    if (b.prices === "show") out.showPrices = true;
    if (b.prices === "hide") out.showPrices = false;
    if (b.sectionsMode === "custom" && b.sectionTitles.length) out.sections = conformSections(out.sections, b.sectionTitles, allIds);
    if (b.highlightMode === "custom" && b.highlightIds.length) out.sections = featureFirst(out.sections, b.highlightIds, input.labels.featured);
    if (b.layout !== "auto") out.sections.forEach(function (s) { s.layout = b.layout; });
  }
  ["theme", "accent", "fontPair", "pageSize", "orientation", "toc", "showPrices", "showSku"].forEach(function (k) { if (lk[k] !== undefined) out[k] = lk[k]; });
  if (lk.layout && !(b.mode === "manual" && b.layout !== "auto")) out.sections.forEach(function (s) { s.layout = lk.layout; });
  if (lk.coverTitle !== undefined) out.cover.title = lk.coverTitle;
  if (lk.coverSubtitle !== undefined) out.cover.subtitle = lk.coverSubtitle;
  if (lk.coverTagline !== undefined) out.cover.tagline = lk.coverTagline;
  if (lk.coverProductId) out.cover.imageProductId = lk.coverProductId;
  if (lk.backHeadline !== undefined) out.backPage.headline = lk.backHeadline;
  if (lk.backCta !== undefined) out.backPage.cta = lk.backCta;
  // Satıcının kendi ürün metni kazanır; yapay zekâ "çok satan" diyemez
  input.products.forEach(function (p) {
    var c = plan.products && plan.products[p.id];
    if (!c) return;
    var copy = {};
    if (c.name && !p.name) copy.name = c.name;
    if (c.description && !p.description) copy.description = c.description;
    if (c.highlights && c.highlights.length) copy.highlights = c.highlights.slice(0, LIMITS.highlights);
    if (c.badge && !p.badge && c.badge !== "bestseller") copy.badge = c.badge;
    if (Object.keys(copy).length) out.products[p.id] = copy;
  });
  // Bölüm güvenliği: her ürün tam bir kez
  var seen = {};
  out.sections.forEach(function (s) { s.productIds = s.productIds.filter(function (id) { if (seen[id] || allIds.indexOf(id) < 0) return false; seen[id] = true; return true; }); });
  out.sections = out.sections.filter(function (s) { return s.productIds.length; }).slice(0, LIMITS.sections);
  var missing = allIds.filter(function (id) { return !seen[id]; });
  if (missing.length) {
    if (out.sections.length) out.sections[out.sections.length - 1].productIds = out.sections[out.sections.length - 1].productIds.concat(missing);
    else out.sections = [{ title: "", intro: "", layout: layoutForCount(missing.length), productIds: missing }];
  }
  if (out.cover.imageProductId && !input.products.some(function (p) { return p.id === out.cover.imageProductId && p.hasImage; })) {
    var first = input.products.find(function (p) { return p.hasImage; });
    out.cover.imageProductId = first ? first.id : null;
  }
  return out;
}

// ─── Model çıktısının sıkı doğrulaması ─────────────────────────────────────
function validatePlan(raw, input) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  var byId = {};
  input.products.forEach(function (p) { byId[p.id] = p; });
  var facts = storeFacts(input);
  var out = { sections: [], products: {} };
  if (THEME_IDS.indexOf(raw.theme) >= 0) out.theme = raw.theme;
  if (isHex(raw.accent)) out.accent = raw.accent.toUpperCase();
  if (FONT_PAIR_IDS.indexOf(raw.fontPair) >= 0) out.fontPair = raw.fontPair;
  if (raw.pageSize === "A4" || raw.pageSize === "Letter") out.pageSize = raw.pageSize;
  if (raw.orientation === "portrait" || raw.orientation === "landscape") out.orientation = raw.orientation;
  ["toc", "showPrices", "showSku"].forEach(function (k) { if (typeof raw[k] === "boolean") out[k] = raw[k]; });

  var c = raw.cover && typeof raw.cover === "object" ? raw.cover : {};
  out.cover = {
    title: scrubCopy(c.title, facts, LIMITS.title, { single: true }),
    subtitle: scrubCopy(c.subtitle, facts, LIMITS.subtitle, { single: true }),
    tagline: scrubCopy(c.tagline, facts, LIMITS.tagline),
    imageProductId: typeof c.imageProductId === "string" && byId[c.imageProductId] && byId[c.imageProductId].hasImage ? c.imageProductId : null,
  };

  var used = {};
  (Array.isArray(raw.sections) ? raw.sections.slice(0, 24) : []).forEach(function (s) {
    if (!s || typeof s !== "object" || out.sections.length >= LIMITS.sections) return;
    var ids = (Array.isArray(s.productIds) ? s.productIds : []).filter(function (id) {
      if (typeof id !== "string" || !byId[id] || used[id]) return false;
      used[id] = true;
      return true;
    });
    if (!ids.length) return;
    out.sections.push({
      title: scrubCopy(s.title, facts, LIMITS.sectionTitle, { single: true }),
      intro: scrubCopy(s.intro, facts, LIMITS.sectionIntro),
      layout: LAYOUTS.indexOf(s.layout) >= 0 ? s.layout : null,
      productIds: ids,
    });
  });

  var rp = raw.products && typeof raw.products === "object" && !Array.isArray(raw.products) ? raw.products : {};
  input.products.forEach(function (p) {
    var r = rp[p.id];
    if (!r || typeof r !== "object") return;
    var pf = productFacts(p);
    var copy = {};
    var name = scrubCopy(r.name, pf, LIMITS.name, { single: true });
    if (name && name.length >= 2) copy.name = name;
    var description = scrubCopy(r.description, pf, LIMITS.aiDescription);
    if (description) copy.description = description;
    var highlights = uniqueStrings((Array.isArray(r.highlights) ? r.highlights : []).map(function (h) { return scrubCopy(h, pf, LIMITS.highlight, { single: true }); }), LIMITS.highlights, LIMITS.highlight);
    if (highlights.length) copy.highlights = highlights;
    if (r.badge === "sale" && discounted(p)) copy.badge = "sale";
    else if (r.badge === "new" && input.brief.purpose === "newArrivals") copy.badge = "new";
    if (Object.keys(copy).length) out.products[p.id] = copy;
  });

  var bp = raw.backPage && typeof raw.backPage === "object" ? raw.backPage : {};
  out.backPage = { headline: scrubCopy(bp.headline, facts, LIMITS.headline, { single: true }), cta: scrubCopy(bp.cta, facts, LIMITS.cta) };
  out.rationale = scrubCopy(raw.rationale, facts, LIMITS.rationale);
  return out;
}

function finalizePlan(raw, input, meta) {
  var fallback = buildFallbackPlan(input);
  var v = raw ? validatePlan(raw, input) : null;
  var usable = !!(v && (v.sections.length || v.theme || v.cover.title));
  var plan = fallback;
  if (usable) {
    var theme = v.theme || fallback.theme;
    plan = {
      theme: theme,
      accent: v.accent || (v.theme ? THEME_ACCENTS[theme] : fallback.accent),
      fontPair: v.fontPair || null,
      pageSize: v.pageSize || fallback.pageSize,
      orientation: v.orientation || fallback.orientation,
      toc: typeof v.toc === "boolean" ? v.toc : fallback.toc,
      showPrices: typeof v.showPrices === "boolean" ? v.showPrices : fallback.showPrices,
      showSku: typeof v.showSku === "boolean" ? v.showSku : fallback.showSku,
      cover: {
        title: v.cover.title || fallback.cover.title,
        subtitle: v.cover.subtitle || fallback.cover.subtitle,
        tagline: v.cover.tagline || "",
        imageProductId: v.cover.imageProductId || fallback.cover.imageProductId,
      },
      sections: v.sections.length
        ? v.sections.map(function (s) { return { title: s.title, intro: s.intro, layout: s.layout || layoutForCount(s.productIds.length), productIds: s.productIds }; })
        : fallback.sections,
      products: v.products,
      backPage: { headline: v.backPage.headline || fallback.backPage.headline, cta: v.backPage.cta || fallback.backPage.cta },
      rationale: v.rationale || "",
    };
    plan = applyExplicit(plan, input);
  }
  plan.version = PLAN_VERSION;
  plan.source = usable ? (meta && meta.source) || "ai" : "fallback";
  return plan;
}

module.exports = {
  PLAN_VERSION: PLAN_VERSION, THEME_IDS: THEME_IDS, FONT_PAIR_IDS: FONT_PAIR_IDS, LAYOUTS: LAYOUTS, PURPOSES: PURPOSES,
  TONES: TONES, BADGES: BADGES, THEME_ACCENTS: THEME_ACCENTS, LIMITS: LIMITS, DEFAULT_LABELS: DEFAULT_LABELS, LOCKED_KEYS: LOCKED_KEYS,
  sanitizePlanInput: sanitizePlanInput, buildFallbackPlan: buildFallbackPlan, validatePlan: validatePlan,
  finalizePlan: finalizePlan, applyExplicit: applyExplicit, scrubCopy: scrubCopy, inferPurpose: inferPurpose,
};
