// ✨ STİL ÖNERİLERİ — yüklenen ürün fotoğrafından yola çıkıp benzer estetikte
// editoryel moda çekimleri önerir. Kullanıcı beğendiklerini seçer, onlardan
// stil profili kurulur (mevcut /api/style-profiles akışı URL kabul ediyor).
//
// Uç noktalar:
//   POST /api/style-inspiration/analyze  { image, lang? }        → { query, descriptor }
//   POST /api/style-inspiration/search   { query, limit? }       → { images, provider }
//   POST /api/style-inspiration/suggest  { image, limit?, ... }  → ikisi tek çağrıda
//
// `image`: { base64 } veya { url }.

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const logger = require("../utils/logger");
const { callGeminiFlash } = require("../utils/promptEnhanceProvider");
const {
  searchStyleImages,
  trackUnsplashDownload,
  DEFAULT_LIMIT,
} = require("../utils/imageSearchProviders");

const router = express.Router();

const MAX_LIMIT = 20;

// ─────────────────────────────────────────────────────────────
// Ürün analizi promptu
//
// Amaç: görselden ARAMA SORGUSU üretmek. Sorgu, ürünün kendisini değil, o ürünün
// ait olduğu estetikteki EDİTORYEL ÇEKİMLERİ bulmalı — çünkü kullanıcıya stil
// referansı öneriyoruz, benzer ürün değil.
// ─────────────────────────────────────────────────────────────
const PRODUCT_QUERY_PROMPT = `You are a fashion e-commerce art director. Look at the attached product photo and produce a short English image-search query that will surface EDITORIAL FASHION PHOTOGRAPHS suitable as a styling reference for this exact product.

Return STRICT JSON only, no markdown, in this shape:
{
  "garment": "<2-4 words: the garment type, e.g. 'flowy midi dress', 'oversized denim jacket'>",
  "color": "<1-2 words: the dominant colour, e.g. 'deep red', 'off-white'>",
  "attributes": "<2-5 words: fabric/cut/mood, e.g. 'satin, draped, evening'>",
  "query": "<the final search query>"
}

Rules for "query":
- English, 4-8 words, lowercase.
- Start with the colour + garment, then styling/mood words, and ALWAYS end with "editorial fashion photography".
  Example: "deep red satin midi dress editorial fashion photography".
- Describe the GARMENT CATEGORY, not the specific print or logo — the query must return many varied results.
- Never include brand names, model names, prices, "buy", "shop", "product photo", "white background" or "mockup".
- If the photo shows several pieces, describe the outfit as a whole ("tailored beige co-ord set …").
- If the item is an accessory (bag, shoe, jewellery), still end with "editorial fashion photography" and mention how it is worn ("worn on model").

Output ONLY the JSON object.`;

function parseQueryJson(raw) {
  const text = String(raw || "").trim();
  // Model bazen ```json ... ``` sarmalıyor
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // İlk { ... } bloğunu yakalamayı dene
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

function sanitiseQuery(value) {
  const q = String(value || "")
    .replace(/["`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!q) return null;
  // 12 kelimeyi aşan sorgular arama sonuçlarını daraltıyor
  return q.split(" ").slice(0, 12).join(" ");
}

/**
 * Gemini'ye görsel göndermek için http(s) URL gerekiyor. base64 geldiyse önce
 * `reference` bucket'ına geçici olarak yükleyip public URL üretiyoruz.
 */
async function ensurePublicUrl(image, userId) {
  const direct = image?.url || image?.uri;
  if (direct && /^https?:\/\//i.test(direct)) return { url: direct, temp: false };

  const b64 = image?.base64;
  if (!b64) throw new Error("image must include base64 or an http(s) url");

  const clean = String(b64).replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(clean, "base64");
  const fileName = `temp_${Date.now()}_style_query_${userId || "anonymous"}_${uuidv4().substring(0, 8)}.jpg`;
  const { error } = await supabase.storage
    .from("reference")
    .upload(fileName, buffer, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });
  if (error) throw new Error(`Supabase upload error: ${error.message}`);
  const { data } = supabase.storage.from("reference").getPublicUrl(fileName);
  return { url: data.publicUrl, temp: true };
}

async function analyseProduct(image, userId) {
  const { url } = await ensurePublicUrl(image, userId);
  const raw = await callGeminiFlash(PRODUCT_QUERY_PROMPT, [url], 2);
  const parsed = parseQueryJson(raw);

  const query =
    sanitiseQuery(parsed?.query) ||
    sanitiseQuery(
      [parsed?.color, parsed?.garment, parsed?.attributes, "editorial fashion photography"]
        .filter(Boolean)
        .join(" "),
    );

  if (!query) throw new Error("Could not derive a search query from the image");

  return {
    query,
    descriptor: {
      garment: parsed?.garment || null,
      color: parsed?.color || null,
      attributes: parsed?.attributes || null,
    },
  };
}


/**
 * Sayfalama — her sayfa için sağlayıcıdan taze istek.
 *
 * Arama aktörlerinde "şu kayıttan itibaren ver" diye bir parametre yok; sadece
 * "kaç sonuç" denebiliyor. Bu yüzden N. sayfa için (N+1) × size sonuç isteyip
 * SON `size` tanesini alıyoruz. Pinterest arama sıralaması sorgu başına tutarlı
 * olduğu için bu, her sayfada gerçekten yeni görseller demek.
 *
 * Bedeli: sayfa derinleştikçe istek büyür (sayfa 3 → 40 sonuçluk çalıştırma).
 * Bu yüzden derinlik MAX_PAGE ile sınırlanıyor.
 */
const MAX_PAGE = 4; // 0..4 → en fazla 50 sonuçluk çalıştırma

async function pagedSearch(query, size, page) {
  const safePage = Math.min(page, MAX_PAGE);
  const want = size * (safePage + 1);

  const { results, provider, cached } = await searchStyleImages(query, {
    limit: want,
  });

  const slice = results.slice(safePage * size, (safePage + 1) * size);

  return {
    provider,
    cached: !!cached,
    images: slice,
    page: safePage,
    // Sağlayıcı istediğimiz kadarını döndürebildiyse muhtemelen dahası da var.
    // Eksik döndürdüyse sonuna gelmişiz demektir.
    hasMore:
      safePage < MAX_PAGE &&
      results.length >= want &&
      slice.length === size,
    total: results.length,
  };
}


// ─────────────────────────────────────────────────────────────
// Uzaktan kill switch — app_config.style_suggestions_visible
//
// Sütun FALSE ise (varsayılan) bu uçların hiçbiri çalışmaz. İstemci zaten şeridi
// render etmiyor ama sunucu tarafında da kapatıyoruz: eski sürümdeki istemciler
// ya da doğrudan istek atanlar da özelliği kullanamasın.
//
// Sonuç 60 sn önbelleklenir — her istekte app_config sorgulamak gereksiz.
// ─────────────────────────────────────────────────────────────
const VISIBILITY_TTL_MS = 60 * 1000;
let visibilityCache = { at: 0, value: null };

async function isStyleSuggestionsEnabled() {
  if (
    visibilityCache.value !== null &&
    Date.now() - visibilityCache.at < VISIBILITY_TTL_MS
  ) {
    return visibilityCache.value;
  }

  let enabled = false; // güvenli varsayılan: KAPALI
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("platform, style_suggestions_visible");
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    // Herhangi bir platformda açıksa özellik açık sayılır; platform bazlı
    // görünürlüğü istemci kendi app_config okumasıyla zaten uyguluyor.
    enabled = rows.some((row) => row?.style_suggestions_visible === true);
  } catch (e) {
    // Sütun yoksa ya da okunamıyorsa KAPALI kabul et — özellik varsayılan kapalı
    logger.warn(
      "✨ [STYLE_INSPIRATION] app_config okunamadı, özellik kapalı sayılıyor:",
      e?.message,
    );
    enabled = false;
  }

  visibilityCache = { at: Date.now(), value: enabled };
  return enabled;
}

/** Tüm uçlarda ortak koruma. */
async function guard(res) {
  const enabled = await isStyleSuggestionsEnabled();
  if (!enabled) {
    res.status(403).json({
      success: false,
      error: "style suggestions are disabled",
      disabled: true,
    });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// POST /analyze — sadece sorgu üret
// ─────────────────────────────────────────────────────────────
router.post("/analyze", async (req, res) => {
  try {
    if (!(await guard(res))) return;
    const { image, userId } = req.body || {};
    if (!image) {
      return res
        .status(400)
        .json({ success: false, error: "image is required" });
    }
    const result = await analyseProduct(image, userId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error("❌ [STYLE_INSPIRATION] analyze error:", err?.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /search — hazır sorguyla ara
// ─────────────────────────────────────────────────────────────
router.post("/search", async (req, res) => {
  try {
    if (!(await guard(res))) return;
    const { query, limit } = req.body || {};
    const clean = sanitiseQuery(query);
    if (!clean) {
      return res
        .status(400)
        .json({ success: false, error: "query is required" });
    }
    const size = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(parseInt(req.body?.page, 10) || 0, 0);
    const paged = await pagedSearch(clean, size, page);
    return res.json({ success: true, query: clean, ...paged });
  } catch (err) {
    logger.error("❌ [STYLE_INSPIRATION] search error:", err?.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /suggest — analiz + arama tek çağrıda (istemcinin kullandığı uç)
// ─────────────────────────────────────────────────────────────
router.post("/suggest", async (req, res) => {
  try {
    if (!(await guard(res))) return;
    const { image, limit, userId, query: providedQuery } = req.body || {};
    const size = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(parseInt(req.body?.page, 10) || 0, 0);

    let query = sanitiseQuery(providedQuery);
    let descriptor = null;

    if (!query) {
      if (!image) {
        return res
          .status(400)
          .json({ success: false, error: "image or query is required" });
      }
      const analysed = await analyseProduct(image, userId);
      query = analysed.query;
      descriptor = analysed.descriptor;
    }

    const paged = await pagedSearch(query, size, page);

    logger.log(
      `✨ [STYLE_INSPIRATION] "${query}" sayfa ${page} → ${paged.images.length} öneri (${paged.provider || "sonuç yok"}, havuz ${paged.total})`,
    );

    return res.json({ success: true, query, descriptor, ...paged });
  } catch (err) {
    logger.error("❌ [STYLE_INSPIRATION] suggest error:", err?.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Bir öneri gerçekten stil referansı olarak SEÇİLDİĞİNDE çağrılır.
 * Unsplash API kuralı: kullanım anında download ucunun tetiklenmesi zorunlu;
 * tetiklenmezse uygulamanın API erişimi askıya alınabilir.
 * Kullanıcı akışını bloklamaz — her koşulda 200 döner.
 */
router.post("/used", async (req, res) => {
  try {
    const { source, downloadLocation } = req.body || {};
    if (source === "unsplash" && downloadLocation) {
      // Beklemeden tetikle; hata olsa da istemci beklemesin
      trackUnsplashDownload(downloadLocation);
    }
    return res.json({ success: true });
  } catch (err) {
    logger.warn("⚠️ [STYLE_INSPIRATION] used bildirimi hatası:", err?.message);
    return res.json({ success: true });
  }
});

module.exports = router;
