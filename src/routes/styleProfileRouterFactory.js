// ───────────────────────────────────────────────────────────────────────────
// 🎬 Stil profili router FABRİKASI
//
// İki ayrı alan aynı CRUD + analiz akışını kullanır, sadece hedef tablo,
// depolama ön eki ve Gemini analiz promptu değişir:
//   • styleProfileRoutes.js         → style_profiles          (model/moda çekimi)
//   • refinerStyleProfileRoutes.js  → refiner_style_profiles  (ürün/katalog çekimi)
//
// createStyleProfileRouter({ table, storagePrefix, analysisPrompt, subjectLabel })
// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// 🎬 Style Profiles — kullanıcı tanımlı marka stil presetleri
//
// Kullanıcı, beğendiği marka çekimlerinden (ör. Bershka/Zara) EN AZ 3 fotoğraf
// yükleyip isimli bir stil profili oluşturur. Gemini tüm fotoğraflara bakarak
// ortak estetiği anlatan bir "stil profili promptu" çıkarır. Fotoğraf her
// eklendiğinde/çıkarıldığında prompt TÜM fotoğraflar üzerinden yeniden üretilir.
//
// Üretim tarafında (referenceBrowserRoutesV7 /generate, styleProfileId parametresi)
// profildeki fotoğraflar tek bir grid'e birleştirilir, altına "STYLE REFERENCE ·
// CODE SR-1" kod plakası basılır ve stil referansı olarak nano-banana'ya gider —
// fotoğraflardaki kişilerin yüzleri/kimlikleri asla kopyalanmaz.
// ───────────────────────────────────────────────────────────────────────────

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");
const {
  // 20 Ağu 2026 (kullanıcı kararı): eklenti/stil-profili işleri Luna'dan GERİ
  // Replicate Gemini 3 Flash'a alındı — app_config'ten bağımsız Replicate-first,
  // başarısızlıkta OpenRouter yedeği. Yerel adlar korunarak 15+ çağrı noktası
  // değişmeden yönlendirildi.
  callReplicateStyleFlash: callGeminiFlash,
  callReplicateStyleVisionClassifier: callGeminiVisionClassifier,
} = require("../utils/promptEnhanceProvider");
const { parseEstimatedAgeResponse } = require("../utils/estimatedAge");
const {
  JEWELRY_CLEAN_VARIANT,
  PRODUCT_SHOT_STYLE_APPROACH,
  cleanAndPersistJewelryStyleImage,
} = require("../utils/jewelryCleanStyleImage");
// DB'de CDN sarmalı ya da render URL'si kayıtlı olabilir; fal'a HER ZAMAN
// ham obje URL'si gitmeli, yoksa sağlayıcı görseli indiremiyor.
const { getOriginalUrl } = require("../utils/imageOptimizer");
const sharp = require("sharp");
const { createFalClient } = require("../utils/jewelryCleanStyleImage");

// Service role şart: style_profiles RLS'li ve anon/authenticated'e policy yok.
// .env'de anahtar adı SUPABASE_SERVICE_ROLE_KEY (Railway'de SUPABASE_SERVICE_KEY olabilir).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// 🎨 Çekim tarzı kartlarının örnek görselleri — her istekte DB'ye gitmemek için
// kısa ömürlü bellek önbelleği (ekran her açılışta bu ucu çağırıyor).
const APPROACH_SAMPLE_TTL_MS = 10 * 60 * 1000;
// 🎞️ Bir kart slotuna seçilebilecek en fazla görsel (24 Ağu 2026, kullanıcı
// kararı). Uygulama her açılışta bunlardan rastgele birini gösteriyor.
const MAX_CARDS_PER_SLOT = 5;
const approachSampleCache = new Map();

// 📐 gpt-image-2 serbest oran kabul etmiyor; hazır ölçülerden birini istiyor.
// Kaynağın oranına EN YAKIN olanı seçmek, kartın kadrajının korunmasının tek
// yolu (nano-banana-2'deki `aspect_ratio: "auto"`nun karşılığı yok).
const GPT_IMAGE_SIZES = [
  { name: "portrait_16_9", ratio: 9 / 16 },
  { name: "portrait_4_3", ratio: 3 / 4 },
  { name: "square_hd", ratio: 1 },
  { name: "landscape_4_3", ratio: 4 / 3 },
  { name: "landscape_16_9", ratio: 16 / 9 },
];

function nearestGptImageSize(width, height) {
  // Ölçü okunamazsa kart oranına (3:4) düş — havuzun ezici çoğunluğu bu.
  if (!width || !height) return "portrait_4_3";
  const ratio = width / height;
  return GPT_IMAGE_SIZES.reduce((best, cur) =>
    Math.abs(cur.ratio - ratio) < Math.abs(best.ratio - ratio) ? cur : best,
  ).name;
}

function createStyleProfileRouter({
  table,
  storagePrefix,
  analysisPrompt,
  subjectLabel,
}) {
  const router = express.Router();
  const TABLE = table;
  const STORAGE_PREFIX = storagePrefix;
  const STYLE_ANALYSIS_PROMPT = analysisPrompt;
  const SUBJECT_LABEL = subjectLabel;

  // Tek görselden de stil profili kurulabilir (öneri şeridinden gelen akış).
  // Elle oluşturma ekranı kendi alt sınırını istemcide uyguluyor.
  const MIN_IMAGES = 1;
  const MAX_IMAGES = 3;
  const GLOBAL_IMPORT_WINDOW_HOURS = 10;

  // ─── Yardımcılar ───

  async function uploadStyleImage(image, userId) {
    // image: { base64 } veya { uri | url } (http/https)
    let buffer;
    let contentType = "image/jpeg";

    if (image?.base64) {
      const clean = String(image.base64).replace(/^data:image\/\w+;base64,/, "");
      buffer = Buffer.from(clean, "base64");
    } else {
      const url = image?.uri || image?.url;
      if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error("Image must include base64 or an http(s) url");
      }
      const resp = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      buffer = Buffer.from(resp.data);
      contentType = resp.headers["content-type"]?.split(";")[0] || "image/jpeg";
    }

    const fileName = `${STORAGE_PREFIX}${userId || "anonymous"}_${Date.now()}_${uuidv4().substring(0, 8)}.jpg`;
    const { error } = await supabase.storage
      .from("reference")
      .upload(fileName, buffer, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) throw new Error(`Supabase upload error: ${error.message}`);

    const { data } = supabase.storage.from("reference").getPublicUrl(fileName);
    return data.publicUrl;
  }

  async function analyzeStyleImages(imageUrls) {
    const prompt = STYLE_ANALYSIS_PROMPT;
    // Gemini'ye en fazla 8 görsel gönder (token/limit güvenliği); prompt yine tümünü temsil eder
    const sample = imageUrls.slice(0, 8);
    const result = await callGeminiFlash(prompt, sample, GEMINI_ATTEMPTS);
    return (result || "").trim();
  }

  // Kartta görünen title/subtitle alanları — UI taşmasını önlemek için sert karakter sınırı.
  // Teknik style_prompt bu sınırlara tabi değildir.
  // Model çağrılarında deneme sayısı. Sağlayıcı katmanı bunu HER İKİ sağlayıcı
  // için ayrı ayrı uyguluyor (Google → başarısızsa Replicate), yani üst sınır
  // bunun iki katıdır. Yüksek tutuluyor: bu işler arka planda çalışıyor,
  // kullanıcı beklemiyor; yarım kalan bir başlık/etiket ise kalıcı hata olur.
  // Replicate zaman zaman başarılı prediction içinde boş output döndürüyor.
  // Başlık, etiket, kategori ve ana analiz gibi kalıcı profil görevleri bu
  // geçici kesintide yarım kalmasın diye sağlayıcı çağrısını daha uzun dene.
  const GEMINI_ATTEMPTS = 10;

  const PROFILE_NAME_MAX_CHARS = 32;
  // Kullanıcının elle yazabileceği başlık sınırı — istemcideki maxLength ile aynı
  // olmalı; kartlarda taşmayı bu ikisi birlikte engelliyor.
  const USER_TITLE_MAX_CHARS = 32;
  const SUBTITLE_MAX_CHARS = 40;
  const SUBTITLE_LANG_NAMES = {
    tr: "Turkish",
    en: "English",
    de: "German",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    pt: "Portuguese",
    ru: "Russian",
    zh: "Chinese",
  };

  function normalizeSubtitleLang(lang) {
    const code = String(lang || "en").split("-")[0].toLowerCase();
    return GLOBAL_SUBTITLE_LANGS.includes(code) ? code : "en";
  }

  function getLanguageName(lang) {
    const code = normalizeSubtitleLang(lang);
    if (SUBTITLE_LANG_NAMES[code]) return SUBTITLE_LANG_NAMES[code];
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || "English";
    } catch {
      return "English";
    }
  }

  // Tamamlama aşamasında title/subtitle uygulamanın desteklediği TÜM dillerde
  // üretilir (client/locales içeriği; RTL diller yok).
  // TEXT kolonunda JSON string olarak saklanır: {"en":"...","tr":"...",...}
  const GLOBAL_SUBTITLE_LANGS = [
    "af", "am", "az", "be", "bg", "bn", "ca", "cs", "da", "de", "el", "en",
    "es", "et", "eu", "fi", "fil", "fr", "gl", "gu", "hi", "hr", "hu", "hy",
    "id", "is", "it", "ja", "ka", "kk", "km", "kn", "ko", "ky", "lo", "lt",
    "lv", "mk", "ml", "mn", "mr", "ms", "ne", "nl", "no", "pa", "pl", "pt",
    "rm", "ro", "ru", "si", "sk", "sl", "sr", "sv", "sw", "ta", "te", "th",
    "tr", "uk", "uz", "vi", "zh", "zu",
  ];

  async function generateGlobalSubtitles(imageUrls) {
    const prompt = `Look at these ${SUBJECT_LABEL} and write ONE short, stylish tagline that captures the shared aesthetic (mood + light + setting vibe), then translate it into every requested language.

  Return ONLY a valid JSON object whose keys are exactly these ISO 639-1 language codes:
  ${GLOBAL_SUBTITLE_LANGS.join(", ")}

  STRICT RULES:
  - Each value MAXIMUM ${SUBTITLE_MAX_CHARS} CHARACTERS. This is a hard limit — count characters, never exceed it.
  - Plain text values only. No quotes inside values, no emojis, no trailing period.
  - Do not mention people, faces or specific garments.
  - Output raw JSON only — no markdown, no code fences, no explanations.`;
    try {
      const sample = imageUrls.slice(0, 4);
      const result = await callGeminiFlash(prompt, sample, GEMINI_ATTEMPTS);
      const raw = (result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.en) return null;
      const out = {};
      for (const code of GLOBAL_SUBTITLE_LANGS) {
        if (typeof parsed[code] === "string" && parsed[code].trim()) {
          out[code] = parsed[code].trim().replace(/^["'""]+|["'""]+$/g, "").slice(0, SUBTITLE_MAX_CHARS);
        }
      }
      return out.en ? JSON.stringify(out) : null;
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] global subtitle üretilemedi:", err?.message);
      return null;
    }
  }

  async function generateSubtitle(imageUrls, lang = "en") {
    const langName = getLanguageName(lang);
    const prompt = `Look at these ${SUBJECT_LABEL} and write ONE short, stylish tagline that captures the shared aesthetic (mood + light + setting vibe).

  STRICT RULES:
  - Write it in ${langName}.
  - MAXIMUM ${SUBTITLE_MAX_CHARS} CHARACTERS. This is a hard limit — count characters, never exceed it.
  - Plain text only. No quotes, no emojis, no trailing period, no markdown.
  - Do not mention people, faces or specific garments.
  Example output (English): Soft daylight, minimal studio calm`;
    try {
      const sample = imageUrls.slice(0, 4);
      const result = await callGeminiFlash(prompt, sample, GEMINI_ATTEMPTS);
      const clean = (result || "").trim().replace(/^["'""]+|["'""]+$/g, "");
      if (!clean) return null;
      return clean.slice(0, SUBTITLE_MAX_CHARS);
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] subtitle üretilemedi:", err?.message);
      return null;
    }
  }

  function cleanProfileName(value) {
    return String(value || "")
      .trim()
      .replace(/^["'"“”]+|["'"“”]+$/g, "")
      .replace(/[.!]+$/g, "")
      .slice(0, PROFILE_NAME_MAX_CHARS)
      .trim();
  }

  function cleanSubtitle(value) {
    return String(value || "")
      .trim()
      .replace(/^["'"“”]+|["'"“”]+$/g, "")
      .replace(/[.!]+$/g, "")
      .slice(0, SUBTITLE_MAX_CHARS)
      .trim();
  }

  async function generateProfileName(imageUrls, lang = "en") {
    const code = normalizeSubtitleLang(lang);
    const langName = getLanguageName(code);
    const prompt = `Look at these ${SUBJECT_LABEL} and create ONE concise, memorable STYLE PROFILE TITLE that captures their shared photographic aesthetic.

  STRICT RULES:
  - Write it naturally in ${langName} (${code}).
  - 2 to 4 words.
  - MAXIMUM ${PROFILE_NAME_MAX_CHARS} CHARACTERS. This is a hard limit.
  - Title only. No quotes, emoji, punctuation, markdown or explanation.
  - Do not use brand names, people's names, specific garments or products.
  - Name the visual style, not the subject.`;
    try {
      const result = await callGeminiFlash(prompt, imageUrls.slice(0, 4), GEMINI_ATTEMPTS);
      return cleanProfileName(result);
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] title üretilemedi:", err?.message);
      return null;
    }
  }

  // 🏷️ Kullanıcının yazdığı başlık — güvenli sınırlara çekilir.
  // Boş/anlamsız girişte null döner ve otomatik başlık üretimine geri dönülür.
  function sanitizeUserTitle(value) {
    if (typeof value !== "string") return null;
    const cleaned = value
      .replace(/[\r\n]+/g, " ")
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, USER_TITLE_MAX_CHARS);
    return cleaned.length >= 2 ? cleaned : null;
  }

  // Kullanıcının başlığını KORUYARAK daha iyi yazılmış, tüm dillere yerelleşmiş
  // bir sürüm üretir. Kullanıcının niyeti/kelime seçimi esastır; model yalnızca
  // toparlar (büyük harf düzeni, akıcılık, gereksiz kelimelerin atılması) ve
  // gerekiyorsa fotoğraflardaki ortak estetikten bir kelime katar.
  async function enhanceUserTitle(userTitle, imageUrls, langs) {
    const prompt = `A user named their photoshoot style: "${userTitle}"

  Rewrite it as a polished STYLE PROFILE TITLE, then localize it into every requested language.

  Return ONLY a valid JSON object whose keys are exactly these ISO 639-1 language codes:
  ${langs.join(", ")}

  STRICT RULES:
  - STAY FAITHFUL to the user's wording and intent. Keep their key words when they work.
  - You may fix capitalization, drop filler words, and make it read better and more meaningful.
  - Do NOT invent a completely different title. If the user's title is already good, keep it (localized).
  - The attached photos show the style; use them only to disambiguate the user's words, never to override them.
  - Every value must be 2 to 4 words.
  - Every value MAXIMUM ${PROFILE_NAME_MAX_CHARS} CHARACTERS. This is a hard limit.
  - Proper nouns the user chose may stay untranslated; everything else must read naturally in that language.
  - No brand names, people's names, specific garments, emojis, quotes inside values or trailing punctuation.
  - Raw JSON only; no markdown or explanation.`;

    try {
      const result = await callGeminiFlash(prompt, imageUrls.slice(0, 4), GEMINI_ATTEMPTS);
      const raw = String(result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      const out = {};
      for (const code of langs) {
        const title = cleanProfileName(parsed?.[code]);
        if (title) out[code] = title;
      }
      return out;
    } catch (err) {
      console.warn(
        "⚠️ [STYLE_PROFILE] kullanıcı başlığı zenginleştirilemedi:",
        err?.message,
      );
      return {};
    }
  }

  // 🏷️ ETİKETLER — aramada kullanılır. Fotoğrafların ortak estetiğinden
  // çıkarılır ve TÜM desteklenen dillere yerelleştirilir; kullanıcı hangi
  // dilde ararsa arasın eşleşme olsun diye.
  const TAGS_PER_LANG = 6;

  async function generateProfileTags(imageUrls) {
    const prompt = `Look at these ${SUBJECT_LABEL} and extract SEARCH TAGS describing their shared photographic style, then localize the same tag set into every requested language.

  Return ONLY a valid JSON object whose keys are exactly these ISO 639-1 language codes:
  ${GLOBAL_SUBTITLE_LANGS.join(", ")}

  Each value must be an array of exactly ${TAGS_PER_LANG} short strings.

  STRICT RULES:
  - Tags describe the PHOTOGRAPHIC STYLE: setting family (street, studio, loft, beach), light (daylight, golden hour, hard flash, soft light), mood (minimal, editorial, playful, moody), colour feel (warm, cool, muted, high contrast), framing (full body, close-up).
  - Every tag is 1 to 2 words, lowercase, no punctuation, no emojis, no hashtags.
  - The SAME concepts in every language — index 0 in "en" and index 0 in "tr" must mean the same thing.
  - Use natural everyday words a shopper would type when searching, not jargon.
  - No brand names, no people's names, no specific garments or products, no place names.
  - NO gender and NO age tags. "women", "men", "girls", "kids", "teen", "young" are forbidden: the same style is used by sellers targeting every audience, and such a tag would filter it out of their search.
  - Raw JSON only; no markdown or explanation.`;

    try {
      const result = await callGeminiFlash(prompt, imageUrls.slice(0, 6), GEMINI_ATTEMPTS);
      const raw = String(result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      const out = {};
      for (const code of GLOBAL_SUBTITLE_LANGS) {
        const list = Array.isArray(parsed?.[code]) ? parsed[code] : null;
        if (!list) continue;
        const cleaned = list
          .map((tag) =>
            String(tag || "")
              .toLowerCase()
              .replace(/[#"'`.,;:!?]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 24),
          )
          .filter((tag) => tag.length >= 2);
        // Tekrarları at, sayıyı sınırla
        const unique = [...new Set(cleaned)].slice(0, TAGS_PER_LANG);
        if (unique.length) out[code] = unique;
      }
      return Object.keys(out).length ? out : null;
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] etiketler üretilemedi:", err?.message);
      return null;
    }
  }

  // 🗂️ KATEGORİLER — modaldaki yatay kategori barı.
  //
  // Tasarımın çekirdeği: model SERBEST kategori uydurmaz. Önce mevcut
  // kategoriler listelenip prompta veriliyor; model uyanı seçmek zorunda,
  // yalnızca hiçbiri tutmuyorsa yeni slug öneriyor. Aksi hâlde "shoes /
  // footwear / sneakers" gibi aynı şeyin üç kopyası birikir ve bar işe yaramaz.
  const CATEGORY_TABLE = "style_categories";
  const CATEGORY_NAME_MAX_CHARS = 22;

  // Modelin döndürdüğü slug'ı tek biçime indirger: ascii, küçük harf, tireli.
  // Aynı kategoriye iki farklı yazımla ulaşılmasın diye hem okuma hem yazma
  // yolunda kullanılır.
  function normalizeCategorySlug(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
  }

  function cleanCategoryName(value) {
    return String(value || "")
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CATEGORY_NAME_MAX_CHARS);
  }

  async function listCategories() {
    const { data, error } = await supabase
      .from(CATEGORY_TABLE)
      .select("slug, names")
      .eq("domain", TABLE)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn(
        "⚠️ [STYLE_PROFILE] kategoriler okunamadı (tablo eksik olabilir):",
        error.message,
      );
      return [];
    }
    return data || [];
  }

  // Yeni açılan bir kategorinin adını tüm dillere çevirir. Best-effort:
  // başarısız olursa kategori yalnızca İngilizce adıyla yaşamaya devam eder
  // (istemci `names[lang] || names.en` ile çözümlüyor).
  async function localizeCategoryName(slug, englishName) {
    const prompt = `Translate this product category name into every requested language.

  Category (English): "${englishName}"

  Return ONLY a valid JSON object whose keys are exactly these ISO 639-1 language codes:
  ${GLOBAL_SUBTITLE_LANGS.join(", ")}

  STRICT RULES:
  - Each value is the natural word a shopper in that language would use for this product category — not a literal word-by-word translation.
  - Keep it SHORT: 1-2 words, max ${CATEGORY_NAME_MAX_CHARS} characters. It has to fit on a small filter chip.
  - Use the language's own script (Japanese in Japanese script, Arabic in Arabic script, etc.).
  - Title Case where the language uses it; sentence case otherwise. No punctuation, no emojis, no quotes inside values.
  - Raw JSON only; no markdown or explanation.`;

    try {
      const result = await callGeminiFlash(prompt, [], GEMINI_ATTEMPTS);
      const raw = String(result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      const names = {};
      for (const code of GLOBAL_SUBTITLE_LANGS) {
        const name = cleanCategoryName(parsed?.[code]);
        if (name) names[code] = name;
      }
      names.en = names.en || cleanCategoryName(englishName) || slug;
      return names;
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] kategori adı çevrilemedi:", err?.message);
      return { en: cleanCategoryName(englishName) || slug };
    }
  }

  // Fotoğraflara bakıp kategoriyi belirler ve slug döner.
  // Yeni kategori gerekiyorsa satırı açar, çeviriyi arka plana bırakır —
  // profilin kategoriye bağlanması çevirinin bitmesini BEKLEMEZ.
  async function resolveProfileCategory(imageUrls) {
    try {
      const existing = await listCategories();
      const existingList = existing.length
        ? existing
            .map((row) => `- ${row.slug} (${row?.names?.en || row.slug})`)
            .join("\n  ")
        : "(none yet — you are creating the first category)";

      const prompt = `Look at these ${SUBJECT_LABEL} and decide which PRODUCT CATEGORY this shoot style is built for.

  EXISTING CATEGORIES — reuse one of these whenever the shoot reasonably fits:
  ${existingList}

  Return ONLY a valid JSON object: {"slug": "...", "en": "..."}

  STRICT RULES:
  - REUSE IS STRONGLY PREFERRED. If the shoot fits an existing category, return that EXACT slug from the list above, copied character for character. Only invent a new slug when nothing in the list genuinely fits.
  - The category is the KIND OF PRODUCT or SUBJECT the style serves, e.g.: shoes, bags, eyewear, jewelry, watches, modest-wear, swimwear, activewear, lingerie, denim, outerwear, kidswear, beauty, home, accessories, apparel.
  - A dress code that DEFINES the shoot counts as a category on its own — if every frame shows fully covered, modest styling, the category is modest-wear, not apparel.
  - If the frames show ordinary full outfits with no single dominant product type, use "apparel".
  - Judge by what the STYLE is made to sell across ALL frames, not by one incidental object in a single frame.
  - "slug": lowercase English, letters and hyphens only, 1-2 words.
  - "en": the human readable English name, Title Case, max ${CATEGORY_NAME_MAX_CHARS} characters (e.g. "Shoes", "Modest Wear", "Eyewear").
  - Raw JSON only; no markdown or explanation.`;

      const result = await callGeminiFlash(
        prompt,
        imageUrls.slice(0, 6),
        GEMINI_ATTEMPTS,
      );
      const raw = String(result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      const slug = normalizeCategorySlug(parsed?.slug);
      if (!slug) return null;

      // Mevcut kategoriye düştüyse iş bitti — yeni satır açma.
      const match = existing.find((row) => row.slug === slug);
      if (match) return slug;

      const englishName = cleanCategoryName(parsed?.en) || slug;

      // Yeni kategori. Aynı anda iki profil aynı slug'ı üretebilir; benzersiz
      // (domain, slug) indeksi sayesinde ikincisi çakışır ve ikisi de aynı
      // satırda buluşur — bu yüzden çakışma hatası yutuluyor.
      const { error: insErr } = await supabase
        .from(CATEGORY_TABLE)
        .insert({ domain: TABLE, slug, names: { en: englishName } });
      if (insErr && !String(insErr.message || "").includes("duplicate")) {
        console.warn("⚠️ [STYLE_PROFILE] kategori açılamadı:", insErr.message);
        return null;
      }

      console.log(`🗂️ [STYLE_PROFILE] yeni kategori: ${slug} (${englishName})`);

      // Çeviri arka planda; kategori bu sırada İngilizce adıyla kullanılabilir.
      setImmediate(() => {
        localizeCategoryName(slug, englishName)
          .then((names) =>
            supabase
              .from(CATEGORY_TABLE)
              .update({ names })
              .eq("domain", TABLE)
              .eq("slug", slug),
          )
          .catch((bgErr) =>
            console.warn(
              "⚠️ [STYLE_PROFILE] kategori çevirisi yazılamadı:",
              bgErr?.message,
            ),
          );
      });

      return slug;
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] kategori belirlenemedi:", err?.message);
      return null;
    }
  }

  // Başlık/alt başlık için ORTAK kurallar. Amaç "nokta atışı" isimlendirme:
  // "Editorial Look" gibi her tarza uyan boş etiketler yerine, o çekimi diğer
  // tarzlardan AYIRAN teknik imzayı yakalamak (zemin + ışık + duruş kodu).
  const NAMING_RULES = `NAMING PRECISION — this is the most important part:
  - The title must PINPOINT what makes this style different from other studio/street shoots. Generic labels like "Editorial Look", "Fashion Style", "Modern Vibes", "Studio Shoot" are FORBIDDEN — they fit everything and identify nothing.
  - Build the title from the strongest 2-3 SIGNALS you can actually see, e.g.:
      • set: seamless studio, blank wall, city street, loft, beach, staircase
      • light: direct flash, soft window light, hard sun, overcast, golden hour, high-key, low-key
      • grade: warm neutrals, cool grey, muted pastel, high contrast, washed out
      • framing/energy: tight crop, full body, still and composed, candid motion
      • dress code, ONLY when it is clearly consistent across the frames and defines the concept: modest / fully covered styling, tailored, streetwear
    Good: "High-Key Flash Studio", "Modest Soft Studio", "Overcast Street Walk", "Warm Window Loft".
  - The subtitle expands the title with the remaining signals in plain words. It must NOT repeat the title's words.
  - NEVER put gender or age in the title or subtitle. The same style gets reused with people of any gender and any age, so "Womenswear Studio", "Menswear Street", "Teen Flash", "Kids Daylight" are all FORBIDDEN — they tell a whole audience the style is not for them. Name the PHOTOGRAPHY, which is identical either way.
  - Never describe the specific garments, products, accessories or props in the frames — this is a reusable TEMPLATE that will be applied to someone else's products. Describe the PHOTOGRAPHY, not what is worn.
  - No brand names, no people's names, no place names, no emojis, no quotes inside values, no trailing punctuation.`;

  async function generateGlobalProfileNames(imageUrls) {
    const prompt = `Look at these ${SUBJECT_LABEL} and create ONE concise, memorable STYLE PROFILE TITLE that captures their shared photographic aesthetic, then localize that title naturally into every requested language.

  Return ONLY a valid JSON object whose keys are exactly these ISO 639-1 language codes:
  ${GLOBAL_SUBTITLE_LANGS.join(", ")}

  ${NAMING_RULES}

  STRICT RULES:
  - Every value must be 2 to 4 words.
  - Every value MAXIMUM ${PROFILE_NAME_MAX_CHARS} CHARACTERS. This is a hard limit.
  - Natural localized titles only; do not leave every value in English.
  - No quotes inside values, emoji, punctuation, markdown or explanations.
  - Do not use brand names, people's names, specific garments or products.
  - Name the visual style, not the subject.`;
    try {
      const result = await callGeminiFlash(prompt, imageUrls.slice(0, 4), GEMINI_ATTEMPTS);
      const raw = String(result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.en) return null;
      const localized = {};
      for (const code of GLOBAL_SUBTITLE_LANGS) {
        const clean = cleanProfileName(parsed[code]);
        if (clean) localized[code] = clean;
      }
      return localized.en ? JSON.stringify(localized) : null;
    } catch (err) {
      console.warn("⚠️ [STYLE_PROFILE] global title üretilemedi:", err?.message);
      return null;
    }
  }

  function fallbackProfileName(lang = "en") {
    const code = normalizeSubtitleLang(lang);
    const fallbacks = {
      tr: "Stil Profili",
      en: "Style Profile",
      de: "Stilprofil",
      es: "Perfil de Estilo",
      fr: "Profil de Style",
      it: "Profilo di Stile",
      ja: "スタイルプロフィール",
      ko: "스타일 프로필",
      pt: "Perfil de Estilo",
      ru: "Профиль Стиля",
      zh: "风格档案",
    };
    return cleanProfileName(fallbacks[code] || fallbacks.en);
  }

  function fallbackGlobalProfileNames() {
    const localized = {};
    for (const code of GLOBAL_SUBTITLE_LANGS) {
      localized[code] = fallbackProfileName(code);
    }
    return JSON.stringify(localized);
  }

  async function generateInitialLocalizedMetadata(
    imageUrls,
    lang = "en",
    userTitle = null,
  ) {
    const primaryLang = normalizeSubtitleLang(lang);
    const requestedLangs = [...new Set(["en", primaryLang])];

    // Kullanıcı kendi başlığını yazdıysa: başlık ondan gelir (zenginleştirilmiş),
    // subtitle yine fotoğraflardan üretilir.
    if (userTitle) {
      const [enhanced, subtitleMap] = await Promise.all([
        enhanceUserTitle(userTitle, imageUrls, requestedLangs),
        (async () => {
          const map = {};
          for (const code of requestedLangs) {
            map[code] = cleanSubtitle(
              await generateSubtitle(imageUrls, code),
            );
          }
          return map;
        })(),
      ]);
      const names = {};
      const subs = {};
      for (const code of requestedLangs) {
        // Model başarısız olursa kullanıcının yazdığı başlık AYNEN kullanılır —
        // hiçbir koşulda kullanıcının girdisi kaybolmaz.
        names[code] = enhanced[code] || cleanProfileName(userTitle) || userTitle;
        subs[code] = subtitleMap[code] || names[code];
      }
      return {
        name: JSON.stringify(names),
        subtitle: JSON.stringify(subs),
      };
    }
    const prompt = `Look at these ${SUBJECT_LABEL} and create:
  1. A concise STYLE PROFILE TITLE.
  2. A short subtitle describing the shared mood, light and setting vibe.

  Return ONLY valid JSON with exactly these language keys: ${requestedLangs.join(", ")}
  Each language value must be an object in this exact shape:
  {"title":"...","subtitle":"..."}

  ${NAMING_RULES}

  STRICT RULES:
  - Write natural localized text for each requested language.
  - title: 2 to 4 words, maximum ${PROFILE_NAME_MAX_CHARS} characters.
  - subtitle: maximum ${SUBTITLE_MAX_CHARS} characters.
  - No brand names, people's names, specific garments, emojis, quotes inside values or trailing punctuation.
  - Name and describe the photographic style, not the subject.
  - Raw JSON only; no markdown or explanation.`;

    const titles = {};
    const subtitles = {};
    try {
      const result = await callGeminiFlash(prompt, imageUrls.slice(0, 4), GEMINI_ATTEMPTS);
      const raw = String(result || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      for (const code of requestedLangs) {
        const title = cleanProfileName(parsed?.[code]?.title);
        const subtitle = cleanSubtitle(parsed?.[code]?.subtitle);
        if (title) titles[code] = title;
        if (subtitle) subtitles[code] = subtitle;
      }
    } catch (err) {
      console.warn(
        "⚠️ [STYLE_PROFILE] hızlı title/subtitle üretilemedi:",
        err?.message,
      );
    }

    for (const code of requestedLangs) {
      if (!titles[code]) titles[code] = fallbackProfileName(code);
      if (!subtitles[code]) subtitles[code] = titles[code];
    }

    return {
      name: JSON.stringify(titles),
      subtitle: JSON.stringify(subtitles),
    };
  }

  function mergeLocalizedMetadata(generatedJson, initialJson, cleanValue, fallback) {
    const parseObject = (value) => {
      try {
        const parsed = JSON.parse(String(value || ""));
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    };
    const generated = parseObject(generatedJson);
    const initial = parseObject(initialJson);
    const generatedEnglish = cleanValue(generated.en);
    const initialEnglish = cleanValue(initial.en);
    const merged = {};

    for (const code of GLOBAL_SUBTITLE_LANGS) {
      merged[code] =
        cleanValue(generated[code]) ||
        cleanValue(initial[code]) ||
        generatedEnglish ||
        initialEnglish ||
        fallback(code);
    }
    return JSON.stringify(merged);
  }

  // Şema geriye dönük olabilir: translations_status kolonu yoksa update'i
  // sessizce yut, profilin kendisi bozulmasın.
  async function setTranslationsStatus(profileId, value) {
    const { error } = await supabase
      .from(TABLE)
      .update({ translations_status: value })
      .eq("id", profileId);
    if (error) {
      console.warn(
        "⚠️ [STYLE_PROFILE] translations_status yazılamadı (kolon eksik olabilir):",
        error.message,
      );
    }
  }

  // 👶 TAHMİNİ YAŞ — otomatik stil havuzu için (auto/global). Referans
  // karelerdeki baskın öznenin yaşını TEK rakam olarak tahmin eder (örn. 27);
  // autoGlobalStyle.js bunu YALNIZ kullanıcı 18 yaşından küçük bir yaş girdiğinde
  // eşleşme için kullanır — yetişkin/yaşsız üretimlerde filtre yok.
  // Best-effort: profil insert edilirken auto/global kayıtlarına varsayılan 30
  // yazılır; geçerli bir tahmin gelirse bu değer gerçek tahminle değiştirilir.
  async function classifyAndSaveEstimatedAge(profileId, imageUrls) {
    try {
      const prompt = `Estimate the age in years of the dominant person in the reference image. Return exactly one integer from 0 to 99. If no person is visible, return none.`;
      const raw = await callGeminiVisionClassifier(
        prompt,
        imageUrls.slice(0, 3),
        2,
      );
      const estimatedAge = parseEstimatedAgeResponse(raw);
      if (estimatedAge === null) {
        console.warn(
          `👶 [STYLE_PROFILE] ${profileId} yaş cevabı çözülemedi; varsayılan 30 korunuyor:`,
          String(raw || "").slice(0, 160),
        );
        return;
      }
      const { error } = await supabase
        .from(TABLE)
        .update({ estimated_age: estimatedAge })
        .eq("id", profileId);
      if (error) {
        console.warn(
          "👶 [STYLE_PROFILE] estimated_age yazılamadı (migration bekliyor olabilir):",
          error.message,
        );
      } else {
        console.log(`👶 [STYLE_PROFILE] ${profileId} tahmini yaş: ${estimatedAge}`);
      }
    } catch (err) {
      console.warn("👶 [STYLE_PROFILE] yaş tahmini atlandı:", err?.message);
    }
  }

  // 1. AŞAMA — stil analizi. Profil bunun bitiminde "ready" olur; kullanıcının
  // kendi dili + İngilizce başlık/subtitle zaten insert anında yazılmış olur.
  // Kalan dillerin çevirisi bunu BEKLEMEZ (ayrı görev).
  async function analyzeProfileInBackground(profileId, imageUrls) {
    try {
      const stylePrompt = await analyzeStyleImages(imageUrls);
      if (!stylePrompt) throw new Error("Empty style analysis");

      const { error: coreErr } = await supabase
        .from(TABLE)
        .update({ style_prompt: stylePrompt, status: "ready" })
        .eq("id", profileId);
      if (coreErr) throw new Error(coreErr.message);

      console.log(
        `🎬 [STYLE_PROFILE] ${profileId} analiz tamam, kullanıma hazır (${stylePrompt.length} karakter, ${imageUrls.length} görsel)`,
      );
    } catch (err) {
      console.error(
        `❌ [STYLE_PROFILE] ${profileId} analiz hatası:`,
        err?.message,
      );
      await supabase
        .from(TABLE)
        .update({ status: "failed" })
        .eq("id", profileId);
    }
  }

  // 2. AŞAMA — kalan tüm dillerin başlık/subtitle çevirileri. Tamamen arka
  // planda; başarısız olsa bile profil kullanılabilir kalır (status'a dokunmaz),
  // çünkü kullanıcının dili ve İngilizce zaten mevcut.
  async function translateProfileInBackground(
    profileId,
    imageUrls,
    initialName,
    initialSubtitle,
    userTitle = null,
  ) {
    try {
      // Kullanıcı kendi başlığını yazdıysa kalan diller de ONDAN türetilir;
      // aksi hâlde arka plan çevirisi kullanıcının başlığını ezerdi.
      // Etiketler de burada, aynı arka plan turunda üretilir — kullanıcı
      // oluşturma akışında hiç beklemez, kartlar zaten görünür durumda.
      const [localizedNames, localizedSubtitles, localizedTags, categorySlug] =
        await Promise.all([
          userTitle
            ? enhanceUserTitle(userTitle, imageUrls, GLOBAL_SUBTITLE_LANGS)
            : generateGlobalProfileNames(imageUrls),
          generateGlobalSubtitles(imageUrls),
          generateProfileTags(imageUrls),
          resolveProfileCategory(imageUrls),
        ]);

      // Kategori yazımı da best-effort: başarısızsa profil kategorisiz kalır ve
      // yalnızca "Tümü" sekmesinde görünür — hiçbir akış bloke olmaz.
      if (categorySlug) {
        const { error: catErr } = await supabase
          .from(TABLE)
          .update({ category_slug: categorySlug })
          .eq("id", profileId);
        if (catErr) {
          console.warn(
            "⚠️ [STYLE_PROFILE] kategori kaydedilemedi:",
            catErr.message,
          );
        } else {
          console.log(
            `🗂️ [STYLE_PROFILE] ${profileId} kategorisi: ${categorySlug}`,
          );
        }
      }

      // Etiket yazımı best-effort: başarısız olursa profil kullanılabilir
      // kalır, arama yalnızca başlık/alt başlıkla çalışır.
      if (localizedTags) {
        const { error: tagErr } = await supabase
          .from(TABLE)
          .update({ tags: localizedTags })
          .eq("id", profileId);
        if (tagErr) {
          console.warn(
            "⚠️ [STYLE_PROFILE] etiketler kaydedilemedi:",
            tagErr.message,
          );
        } else {
          console.log(
            `🏷️ [STYLE_PROFILE] ${profileId} etiketleri yazıldı (${Object.keys(localizedTags).length} dil)`,
          );
        }
      }

      // Model herhangi bir dili atlamış olsa bile kayıtta tüm dil anahtarları
      // bulunsun; ilk aşamada üretilen kullanıcı dili ve İngilizce de korunur.
      const completedNames = mergeLocalizedMetadata(
        localizedNames,
        initialName,
        cleanProfileName,
        fallbackProfileName,
      );
      const completedSubtitles = mergeLocalizedMetadata(
        localizedSubtitles,
        initialSubtitle,
        cleanSubtitle,
        (code) => fallbackProfileName(code),
      );

      if (completedNames) {
        const { error: nameErr } = await supabase
          .from(TABLE)
          .update({ name: completedNames })
          .eq("id", profileId);
        if (nameErr) throw new Error(nameErr.message);
      }

      if (completedSubtitles) {
        const { error: subtitleErr } = await supabase
          .from(TABLE)
          .update({ subtitle: completedSubtitles })
          .eq("id", profileId);
        if (subtitleErr) {
          console.warn(
            "⚠️ [STYLE_PROFILE] arka plan subtitle kaydedilemedi:",
            subtitleErr.message,
          );
        }
      }

      await setTranslationsStatus(profileId, "ready");
      console.log(`🌍 [STYLE_PROFILE] ${profileId} tüm dil çevirileri tamamlandı`);
    } catch (err) {
      // Çeviri hatası profili bozmaz: status'a DOKUNMA.
      console.error(
        `⚠️ [STYLE_PROFILE] ${profileId} çeviri hatası (profil kullanılabilir):`,
        err?.message,
      );
      await setTranslationsStatus(profileId, "failed");
    }
  }

  async function reanalyzeAndSave(profileId, imageUrls) {
    try {
      // Fotoğraf ekleme/çıkarma sonrası analiz yenilenir ve profil hemen tekrar
      // kullanılabilir olur. Tüm dillerdeki subtitle yenilemesi analizi BEKLETMEZ,
      // arka planda sürer. Title profil kimliği olarak sabit kalır.
      const stylePrompt = await analyzeStyleImages(imageUrls);
      if (!stylePrompt) throw new Error("Empty style analysis");
      await supabase
        .from(TABLE)
        .update({ style_prompt: stylePrompt, status: "ready" })
        .eq("id", profileId);

      setImmediate(async () => {
        try {
          await setTranslationsStatus(profileId, "pending");
          // Fotoğraflar değiştiği için etiketler ve kategori NULL'a çekilmişti;
          // subtitle ile aynı turda yeniden üretilir, aksi hâlde profil kalıcı
          // olarak etiketsiz/kategorisiz kalır ve aramadan/bardan düşerdi.
          const [subtitle, refreshedTags, refreshedCategory] = await Promise.all([
            generateGlobalSubtitles(imageUrls),
            generateProfileTags(imageUrls),
            resolveProfileCategory(imageUrls),
          ]);

          if (refreshedTags || refreshedCategory) {
            const patch = {};
            if (refreshedTags) patch.tags = refreshedTags;
            if (refreshedCategory) patch.category_slug = refreshedCategory;
            const { error: metaErr } = await supabase
              .from(TABLE)
              .update(patch)
              .eq("id", profileId);
            if (metaErr) {
              console.warn(
                "⚠️ [STYLE_PROFILE] etiket/kategori yenilenemedi:",
                metaErr.message,
              );
            }
          }
          if (subtitle) {
            // Best-effort: subtitle kolonu henüz yoksa analiz sonucu bozulmasın
            const { error: subErr } = await supabase
              .from(TABLE)
              .update({ subtitle })
              .eq("id", profileId);
            if (subErr) {
              console.warn(
                "⚠️ [STYLE_PROFILE] subtitle kaydedilemedi (kolon eksik olabilir):",
                subErr.message,
              );
            }
          }
          await setTranslationsStatus(profileId, "ready");
        } catch (subtitleErr) {
          console.error(
            `⚠️ [STYLE_PROFILE] ${profileId} subtitle yenileme hatası (profil kullanılabilir):`,
            subtitleErr?.message,
          );
          await setTranslationsStatus(profileId, "failed");
        }
      });
      console.log(
        `🎬 [STYLE_PROFILE] ${profileId} analizi güncellendi (${stylePrompt.length} karakter, ${imageUrls.length} görsel)`,
      );
      return stylePrompt;
    } catch (err) {
      console.error(
        `❌ [STYLE_PROFILE] ${profileId} analiz hatası:`,
        err?.message,
      );
      await supabase
        .from(TABLE)
        .update({ status: "failed" })
        .eq("id", profileId);
      return null;
    }
  }

  async function getOwnedProfile(id, userId) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return { error: "Profile not found", status: 404 };
    if (String(data.user_id) !== String(userId)) {
      return { error: "Not authorized for this profile", status: 403 };
    }
    return { profile: data };
  }

  // ─── Routes ───

  // Profil oluştur: { userId, images, lang, productCategory, productSubtype,
  // styleApproach, tags }. Eklentiden jewelry gelirse profil DB'ye yazılmadan
  // önce her görselin takısız türevi Replicate üzerinden hazırlanır.
  // Title backend tarafından görsellerden otomatik ve dile göre üretilir.
  router.post("/", async (req, res) => {
    try {
      const {
        userId,
        images,
        lang,
        userTitle: rawUserTitle,
        productCategory,
        productSubtype,
        styleApproach,
        collection,
        tags,
      } = req.body;
      // Kullanıcının yazdığı başlık (opsiyonel). Geçersizse null → otomatik başlık.
      const userTitle = sanitizeUserTitle(rawUserTitle);
      if (!userId) {
        return res
          .status(400)
          .json({ success: false, error: "userId is required" });
      }
      if (!Array.isArray(images) || images.length < MIN_IMAGES) {
        return res.status(400).json({
          success: false,
          error: `At least ${MIN_IMAGES} images are required`,
          errorCode: "MIN_IMAGES",
        });
      }
      if (images.length > MAX_IMAGES) {
        return res.status(400).json({
          success: false,
          error: `At most ${MAX_IMAGES} images are allowed`,
          errorCode: "MAX_IMAGES",
        });
      }

      // Birbirinden bağımsız yüklemeleri paralel yap; ilk kartın görünmesini
      // gereksiz yere geciktirme.
      const imageUrls = await Promise.all(
        images.map((img) => uploadStyleImage(img, userId)),
      );

      const normalizedCategory = productCategory == null
        ? null
        : String(productCategory).trim().toLowerCase().slice(0, 40) || null;
      const normalizedSubtype = productSubtype == null
        ? null
        : String(productSubtype).trim().toLowerCase().slice(0, 40) || null;
      const parsedApproach = Number.parseInt(styleApproach, 10);
      // 5 = Beyaz Stüdyo (26 Ağu 2026): giyimin 4. kartı, koleksiyon gruplu.
      const normalizedApproach =
        Number.isInteger(parsedApproach) && parsedApproach >= 1 && parsedApproach <= 5
          ? parsedApproach
          : null;
      // 🏬 Koleksiyon etiketi ("zara", "cos"…) — Beyaz Stüdyo modalında
      // gruplama anahtarı. Slug'a indirgenir; boşsa hiç yazılmaz.
      const normalizedCollection =
        typeof collection === "string"
          ? collection.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40) || null
          : null;
      const normalizedTags = Array.isArray(tags)
        ? tags
            .filter((tag) => typeof tag === "string")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20)
        : [];
      // 🚻 Gender salt tablo ETİKETİDİR — stil analizine/promptuna girmez.
      // Kullanıcı kuralı (19 Ağu 2026): yalnız giyim + Sokak Stili (4)
      // kayıtlarında saklanıyordu.
      // ⚠️ 24 Ağu 2026'da TARZ KOŞULU KALDIRILDI: cinsiyet artık yalnız havuz
      // süzgeci değil, çekim tarzı KART GÖRSELLERİNİ de seçiyor. Editoryal'de
      // (tarz 1) erkek/kadın kart gösterebilmek için etiketin orada da
      // kaydedilmesi gerekiyor. Kısıt yalnız GİYİMDE kaldı.
      const rawGender = String(req.body.gender || "").trim().toLowerCase();
      const normalizedGender = ["woman", "man"].includes(rawGender)
        ? rawGender
        : null;
      const shouldStoreGender =
        TABLE === "style_profiles" &&
        normalizedGender !== null &&
        normalizedCategory === "clothing";
      // Takı temizliği YALNIZ takı modunda ve yalnız model üstündeki tarzlarda
      // yapılır. Ürün çekiminde (tarz 2) takı konunun kendisi — silinirse
      // referans yok olur (kullanıcı kuralı, 17 Ağu 2026).
      const isProductShotApproach =
        normalizedApproach === PRODUCT_SHOT_STYLE_APPROACH;
      const shouldCleanJewelry =
        TABLE === "style_profiles" &&
        ["auto", "global"].includes(String(userId)) &&
        normalizedCategory === "jewelry" &&
        !isProductShotApproach &&
        // 🚶 Sokak Stili (4) giyim hattına ait — yanlışlıkla jewelry+4
        // etiketlense bile temiz-türev ÜRETİLMEZ (19 Ağu 2026 kullanıcı kararı)
        normalizedApproach !== 4;
      const sourceFingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify(imageUrls))
        .digest("hex");

      let jewelryCleanImageUrls = null;
      if (isProductShotApproach && normalizedCategory === "jewelry") {
        console.log(
          "💎 [STYLE_PROFILE] Ürün çekimi (tarz 2) — takı temizliği ATLANDI, orijinal kare korunuyor",
        );
      }
      if (shouldCleanJewelry) {
        console.log(
          `💎 [STYLE_PROFILE] Jewelry kayıt: ${imageUrls.length} görsel profil kaydından önce temizleniyor`,
        );
        jewelryCleanImageUrls = await Promise.all(
          imageUrls.map((imageUrl, index) =>
            cleanAndPersistJewelryStyleImage({
              imageUrl,
              supabase,
              objectPathWithoutExtension: `jewelry-clean/live/${sourceFingerprint.slice(0, 20)}-${JEWELRY_CLEAN_VARIANT}-${index + 1}`,
            }),
          ),
        );
        console.log("💎 [STYLE_PROFILE] Jewelry clean görselleri hazır");
      }

      // Jewelry analizinde de takısız kareyi kullan: stil promptuna referanstaki
      // ürünün kendisi sızmasın. DB'de image_urls daima orijinali korur.
      const analysisImageUrls = jewelryCleanImageUrls || imageUrls;

      // Hızlı ilk aşama: yalnızca kullanıcının dili + İngilizce title/subtitle.
      // Tam analiz ve kalan tüm diller response döndükten sonra arka planda tamamlanır.
      const initialMetadata = await generateInitialLocalizedMetadata(
        analysisImageUrls,
        lang,
        userTitle,
      );

      const { data: inserted, error: insErr } = await supabase
        .from(TABLE)
        .insert({
          user_id: userId,
          name: initialMetadata.name,
          image_urls: imageUrls,
          status: "analyzing",
          ...(TABLE === "style_profiles" && normalizedCategory
            ? { product_category: normalizedCategory }
            : {}),
          ...(TABLE === "style_profiles" && normalizedSubtype
            ? { product_subtype: normalizedSubtype }
            : {}),
          ...(TABLE === "style_profiles" && normalizedApproach !== null
            ? { style_approach: normalizedApproach }
            : {}),
          ...(TABLE === "style_profiles" && normalizedCollection
            ? { collection: normalizedCollection }
            : {}),
          ...(shouldStoreGender ? { gender: normalizedGender } : {}),
          ...(TABLE === "style_profiles" && normalizedTags.length
            ? { auto_tags: normalizedTags }
            : {}),
          ...(TABLE === "style_profiles" && ["auto", "global"].includes(String(userId))
            ? { auto_pool: true }
            : {}),
          ...(shouldCleanJewelry
            ? {
                jewelry_clean_image_urls: jewelryCleanImageUrls,
                jewelry_clean_source_fingerprint: sourceFingerprint,
                jewelry_clean_stamped_grid_url: null,
                jewelry_cleaned_at: new Date().toISOString(),
                jewelry_clean_error: null,
              }
            : {}),
          // Yaş servisi sonuç vermezse otomatik havuz kayıtları NULL kalmasın.
          // Arka plandaki sınıflandırma geçerli bir tahmin üretirse üzerine yazar.
          ...(["auto", "global"].includes(String(userId))
            ? { estimated_age: 30 }
            : {}),
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);

      // Kalan diller arka planda üretilecek — istemci/admin bunu sessizce yoklar.
      // Not: 'auto' (gizli havuz) profilleri de çevrilir — admin ileride bir
      // auto stili globale terfi ettirebilir; çeviriler hazır beklesin.
      await setTranslationsStatus(inserted.id, "pending");

      // Subtitle kolonu geriye dönük şemalarda olmayabilir; ilk metadata best-effort.
      const { error: initialSubtitleErr } = await supabase
        .from(TABLE)
        .update({ subtitle: initialMetadata.subtitle })
        .eq("id", inserted.id);
      if (initialSubtitleErr) {
        console.warn(
          "⚠️ [STYLE_PROFILE] hızlı subtitle kaydedilemedi:",
          initialSubtitleErr.message,
        );
      }

      // Response'u bekletme. İki arka plan görevi BİRBİRİNDEN BAĞIMSIZ başlar:
      //  1) analiz → biter bitmez status "ready" olur, profil kullanılabilir
      //  2) kalan ~64 dilin çevirisi → sürerken profil zaten kullanılabilir
      setImmediate(() => {
        analyzeProfileInBackground(inserted.id, analysisImageUrls).catch(
          (backgroundErr) => {
            console.error(
              "❌ [STYLE_PROFILE] analiz task başlatılamadı:",
              backgroundErr?.message,
            );
          },
        );
        // 👶 Tahmini yaş — yalnız otomatik havuz adayları (auto/global) için;
        // kullanıcı profillerinde havuz seçimi olmadığından gereksiz.
        if (["auto", "global"].includes(String(userId))) {
          classifyAndSaveEstimatedAge(inserted.id, analysisImageUrls).catch(() => {});
        }
        translateProfileInBackground(
          inserted.id,
          analysisImageUrls,
          initialMetadata.name,
          initialMetadata.subtitle,
          userTitle,
        ).catch((backgroundErr) => {
          console.error(
            "❌ [STYLE_PROFILE] çeviri task başlatılamadı:",
            backgroundErr?.message,
          );
        });
      });

      return res.json({
        success: true,
        profile: {
          ...inserted,
          subtitle: initialMetadata.subtitle,
          status: "analyzing",
        },
      });
    } catch (err) {
      console.error("❌ [STYLE_PROFILE] create error:", err?.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 📊 ADMIN — çekim tarzı kullanım raporu.
  //
  // Üç soruyu yanıtlar:
  //   1) Stil referansı özelliği hiç kullanılıyor mu (yükleme vs kayıtlı tarz)?
  //   2) Kullanıcılar kendi çekim tarzlarını oluşturuyor mu?
  //   3) Hangi tarz kaç kez kullanıldı, ürettiği önce/sonra nasıl görünüyor?
  //
  // ⚠️ Kullanım sayıları yalnızca izleme migration'ından SONRAKİ üretimleri
  // kapsar (reference_results.style_profile_id). Öncesi için veri yok; UI bunu
  // açıkça yazıyor ki sayılar "hiç kullanılmamış" diye okunmasın.
  router.get("/admin/usage", async (req, res) => {
    try {
      // ── Profiller: global ve kullanıcı ayrımıyla ──
      const { data: profiles, error: profErr } = await supabase
        .from(TABLE)
        .select("id, user_id, name, subtitle, category_slug, image_urls, status, created_at")
        .order("created_at", { ascending: false });
      if (profErr) throw new Error(profErr.message);

      const globalProfiles = (profiles || []).filter((p) => p.user_id === "global");
      const userProfiles = (profiles || []).filter((p) => p.user_id !== "global");

      // ── Stil referansı özelliğinin genel kullanımı ──
      // Aynı satırları runsByProfile, distinctUsers ve örnek görseller için
      // zaten kullanıyoruz.
      // 1.1M satırlık reference_results üzerinde ayrıca iki ayrı exact-count
      // taraması yapmak yerine bu küçük stil-kullanım kümesinden toplamları da
      // hesapla. Supabase'in varsayılan 1000 satır sınırını aşmamak için sayfala.
      const usageRows = [];
      const usagePageSize = 1000;
      for (let from = 0; ; from += usagePageSize) {
        const { data: usagePage, error: usageErr } = await supabase
          .from("reference_results")
          .select(
            "id, user_id, style_profile_id, style_source, reference_images, result_image_url, style_reference_url, status, created_at",
          )
          .not("style_source", "is", null)
          .order("created_at", { ascending: false })
          .range(from, from + usagePageSize - 1);
        if (usageErr) throw new Error(usageErr.message);
        usageRows.push(...(usagePage || []));
        if (!usagePage || usagePage.length < usagePageSize) break;
      }

      const profileRuns = usageRows.reduce(
        (count, row) => count + (row.style_source === "profile" ? 1 : 0),
        0,
      );
      const uploadRuns = usageRows.reduce(
        (count, row) => count + (row.style_source === "upload" ? 1 : 0),
        0,
      );

      const distinctUsers = new Set(usageRows.map((r) => r.user_id).filter(Boolean));
      const runsByProfile = new Map();
      for (const row of usageRows) {
        if (!row.style_profile_id) continue;
        runsByProfile.set(
          row.style_profile_id,
          (runsByProfile.get(row.style_profile_id) || 0) + 1,
        );
      }

      // ── Kullanılan tarzların TÜM önce/sonra örnekleri ──
      // Eskiden her profil için ayrı sorgu + 4 kayıt limiti vardı. Yukarıdaki
      // toplu sorgu gerekli URL'leri zaten taşıyor; burada profile göre
      // gruplayarak N+1 sorguyu ve görünmeyen kayıtları kaldır.
      const samplesByProfile = {};
      for (const row of usageRows) {
        if (
          !row.style_profile_id ||
          row.status !== "completed" ||
          !row.result_image_url
        ) {
          continue;
        }

        let referenceImages = row.reference_images;
        if (typeof referenceImages === "string") {
          try {
            referenceImages = JSON.parse(referenceImages);
          } catch {
            referenceImages = [];
          }
        }

        const profileSamples = samplesByProfile[row.style_profile_id] || [];
        profileSamples.push({
          id: row.id,
          before: Array.isArray(referenceImages)
            ? referenceImages[0] || null
            : null,
          after: row.result_image_url,
          styleReferenceUrl: row.style_reference_url || null,
          createdAt: row.created_at,
        });
        samplesByProfile[row.style_profile_id] = profileSamples;
      }

      const decorate = (list) =>
        list.map((p) => ({
          id: p.id,
          userId: p.user_id,
          name: p.name,
          subtitle: p.subtitle,
          categorySlug: p.category_slug || null,
          imageUrls: p.image_urls || [],
          status: p.status,
          createdAt: p.created_at,
          runs: runsByProfile.get(p.id) || 0,
          samples: samplesByProfile[p.id] || [],
        }));

      // Kendi tarzını oluşturan kullanıcı sayısı — "özellik benimsendi mi"nin
      // en dolaysız ölçüsü.
      const creators = new Set(userProfiles.map((p) => p.user_id));

      return res.json({
        success: true,
        totals: {
          globalProfiles: globalProfiles.length,
          userProfiles: userProfiles.length,
          profileCreators: creators.size,
          profileRuns,
          uploadRuns,
          totalStyleRuns: profileRuns + uploadRuns,
          distinctUsers: distinctUsers.size,
        },
        globalProfiles: decorate(globalProfiles),
        userProfiles: decorate(userProfiles),
      });
    } catch (err) {
      console.error("❌ [STYLE_PROFILE] admin usage error:", err?.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin'de bir kullanıcı stilini globale almadan önce; yalnız son 10 saatte
  // tamamlanan stilli üretimleri, stilin ilk yüklenen referanslarıyla birlikte
  // gösterir. Bu endpoint hiçbir satırı değiştirmez.
  router.get("/admin/import-candidates", async (req, res) => {
    try {
      if (TABLE !== "style_profiles") {
        return res.status(404).json({ success: false, error: "Not available" });
      }
      const userId = String(req.query.userId || "").trim();
      if (!userId) {
        return res.status(400).json({ success: false, error: "userId is required" });
      }

      const cutoffIso = new Date(
        Date.now() - GLOBAL_IMPORT_WINDOW_HOURS * 60 * 60 * 1000,
      ).toISOString();

      const { data: resultRows, error: resultsErr } = await supabase
        .from("reference_results")
        .select(
          "id, generation_id, style_profile_id, reference_images, result_image_url, status, created_at",
        )
        .eq("user_id", userId)
        .eq("status", "completed")
        .not("style_profile_id", "is", null)
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false });
      if (resultsErr) throw new Error(resultsErr.message);

      const resultProfileIds = [
        ...new Set((resultRows || []).map((row) => row.style_profile_id).filter(Boolean)),
      ];
      if (resultProfileIds.length === 0) {
        return res.json({
          success: true,
          windowHours: GLOBAL_IMPORT_WINDOW_HOURS,
          profiles: [],
        });
      }

      // Global kataloğa alındıktan sonraki üretimler global profil ID'siyle
      // kaydolur. Admin'de bunları kaynak kullanıcı profiline geri bağla; aksi
      // halde aday kartı yalnız globale alınmadan önceki ilk sonuçlarda donar.
      const { data: resultProfiles, error: resultProfilesErr } = await supabase
        .from(TABLE)
        .select("id, user_id, source_profile_id")
        .in("id", resultProfileIds);
      if (resultProfilesErr) throw new Error(resultProfilesErr.message);
      const sourceIdByResultProfileId = new Map(
        (resultProfiles || []).map((profile) => [
          profile.id,
          profile.user_id === "global" && profile.source_profile_id
            ? profile.source_profile_id
            : profile.id,
        ]),
      );
      const sourceProfileIds = [
        ...new Set([...sourceIdByResultProfileId.values()].filter(Boolean)),
      ];

      const { data: profiles, error: profilesErr } = await supabase
        .from(TABLE)
        .select(
          "id, user_id, name, subtitle, tags, category_slug, image_urls, status, translations_status, created_at",
        )
        .eq("user_id", userId)
        .in("id", sourceProfileIds);
      if (profilesErr) throw new Error(profilesErr.message);

      const generationIds = (resultRows || [])
        .map((row) => row.generation_id)
        .filter(Boolean);
      let variationRows = [];
      if (generationIds.length > 0) {
        const { data, error } = await supabase
          .from("variation_generations")
          .select(
            "generation_id, source_generation_id, result_image_url, status, created_at",
          )
          .eq("user_id", userId)
          .eq("status", "completed")
          .in("source_generation_id", generationIds)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        variationRows = data || [];
      }

      const variationsBySource = new Map();
      for (const row of variationRows) {
        const list = variationsBySource.get(row.source_generation_id) || [];
        if (row.result_image_url) list.push(row.result_image_url);
        variationsBySource.set(row.source_generation_id, list);
      }

      const resultsByProfile = new Map();
      const latestResultAtByProfile = new Map();
      for (const row of resultRows || []) {
        const sourceProfileId = sourceIdByResultProfileId.get(row.style_profile_id);
        if (!sourceProfileId) continue;
        const list = resultsByProfile.get(sourceProfileId) || [];
        const outputUrls = [
          row.result_image_url,
          ...(variationsBySource.get(row.generation_id) || []),
        ].filter(Boolean);
        list.push({
          id: row.id,
          generationId: row.generation_id,
          sourceImageUrl: Array.isArray(row.reference_images)
            ? row.reference_images.find(Boolean) || null
            : null,
          outputUrls,
          createdAt: row.created_at,
        });
        resultsByProfile.set(sourceProfileId, list);
        if (!latestResultAtByProfile.has(sourceProfileId)) {
          latestResultAtByProfile.set(sourceProfileId, row.created_at);
        }
      }

      const { data: promotedRows, error: promotedErr } = await supabase
        .from(TABLE)
        .select("id, source_profile_id, display_image_urls")
        .eq("user_id", "global")
        .in("source_profile_id", sourceProfileIds);
      if (promotedErr) throw new Error(promotedErr.message);
      const promotedBySource = new Map(
        (promotedRows || []).map((row) => [row.source_profile_id, row]),
      );

      return res.json({
        success: true,
        windowHours: GLOBAL_IMPORT_WINDOW_HOURS,
        profiles: (profiles || [])
          .map((profile) => ({
            ...profile,
            examples: resultsByProfile.get(profile.id) || [],
            promotedGlobalProfileId: promotedBySource.get(profile.id)?.id || null,
            promotedDisplayImageUrls: Array.isArray(
              promotedBySource.get(profile.id)?.display_image_urls,
            )
              ? promotedBySource.get(profile.id).display_image_urls
              : [],
            latestResultAt: latestResultAtByProfile.get(profile.id) || null,
          }))
          .sort(
            (a, b) =>
              new Date(b.latestResultAt || 0).getTime() -
              new Date(a.latestResultAt || 0).getTime(),
          ),
      });
    } catch (err) {
      console.error("❌ [STYLE_PROFILE] import candidates error:", err?.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Kullanıcının seçtiği stili global kataloğa kopyalar. Üretim kaynağı olarak
  // yalnız sourceProfile.image_urls saklanır. Gerçek sonuçlar ayrı
  // display_image_urls alanına yazılır ve NB2 akışına hiçbir zaman girmez.
  router.post("/admin/promote-to-global", async (req, res) => {
    try {
      if (TABLE !== "style_profiles") {
        return res.status(404).json({ success: false, error: "Not available" });
      }
      const sourceProfileId = String(req.body?.sourceProfileId || "").trim();
      const userId = String(req.body?.userId || "").trim();
      const requestedDisplayUrls = Array.isArray(req.body?.selectedDisplayImageUrls)
        ? [...new Set(req.body.selectedDisplayImageUrls.map((url) => String(url || "").trim()))]
            .filter(Boolean)
        : [];
      if (!sourceProfileId || !userId) {
        return res.status(400).json({
          success: false,
          error: "sourceProfileId and userId are required",
        });
      }
      if (requestedDisplayUrls.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Select at least one showcase image",
        });
      }

      const { data: sourceProfile, error: sourceErr } = await supabase
        .from(TABLE)
        .select("*")
        .eq("id", sourceProfileId)
        .eq("user_id", userId)
        .maybeSingle();
      if (sourceErr || !sourceProfile) {
        return res.status(404).json({ success: false, error: "Source profile not found" });
      }
      const originalReferenceUrls = Array.isArray(sourceProfile.image_urls)
        ? sourceProfile.image_urls.filter(Boolean).slice(0, MAX_IMAGES)
        : [];
      if (originalReferenceUrls.length === 0 || sourceProfile.status !== "ready") {
        return res.status(400).json({
          success: false,
          error: "Source profile must be ready and include original references",
        });
      }

      const { data: existingGlobalProfile, error: existingGlobalErr } = await supabase
        .from(TABLE)
        .select("id")
        .eq("user_id", "global")
        .eq("source_profile_id", sourceProfileId)
        .maybeSingle();
      if (existingGlobalErr) throw new Error(existingGlobalErr.message);
      const resultStyleProfileIds = [
        sourceProfileId,
        existingGlobalProfile?.id,
      ].filter(Boolean);

      const cutoffIso = new Date(
        Date.now() - GLOBAL_IMPORT_WINDOW_HOURS * 60 * 60 * 1000,
      ).toISOString();

      const { data: resultRows, error: resultsErr } = await supabase
        .from("reference_results")
        .select("generation_id, result_image_url, created_at")
        .eq("user_id", userId)
        .in("style_profile_id", resultStyleProfileIds)
        .eq("status", "completed")
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false });
      if (resultsErr) throw new Error(resultsErr.message);

      const generationIds = (resultRows || [])
        .map((row) => row.generation_id)
        .filter(Boolean);
      let variationRows = [];
      if (generationIds.length > 0) {
        const { data, error } = await supabase
          .from("variation_generations")
          .select("source_generation_id, result_image_url, created_at")
          .eq("user_id", userId)
          .eq("status", "completed")
          .in("source_generation_id", generationIds)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        variationRows = data || [];
      }
      const variationsBySource = new Map();
      for (const row of variationRows) {
        const list = variationsBySource.get(row.source_generation_id) || [];
        if (row.result_image_url) list.push(row.result_image_url);
        variationsBySource.set(row.source_generation_id, list);
      }
      const allowedShowcaseUrls = new Set();
      for (const row of resultRows || []) {
        for (const url of [
          row.result_image_url,
          ...(variationsBySource.get(row.generation_id) || []),
        ]) {
          if (url) allowedShowcaseUrls.add(url);
        }
      }
      if (allowedShowcaseUrls.size === 0) {
        return res.status(400).json({
          success: false,
          error: `This style has no completed showcase results in the last ${GLOBAL_IMPORT_WINDOW_HOURS} hours`,
        });
      }
      const invalidDisplayUrls = requestedDisplayUrls.filter(
        (url) => !allowedShowcaseUrls.has(url),
      );
      if (invalidDisplayUrls.length > 0) {
        return res.status(400).json({
          success: false,
          error: "One or more selected images do not belong to this style's recent results",
        });
      }

      const globalProfilePayload = {
          user_id: "global",
          name: sourceProfile.name,
          subtitle: sourceProfile.subtitle,
          tags: sourceProfile.tags,
          category_slug: sourceProfile.category_slug,
          image_urls: originalReferenceUrls,
          display_image_urls: requestedDisplayUrls,
          style_prompt: sourceProfile.style_prompt,
          status: "ready",
          translations_status:
            sourceProfile.translations_status === "ready" ? "ready" : "pending",
          source_profile_id: sourceProfile.id,
          // Global kopya ilk kullanımında kolajı image_urls'tan yeniden kurar.
          stamped_grid_url: null,
        };
      const mutation = existingGlobalProfile
        ? supabase
            .from(TABLE)
            .update(globalProfilePayload)
            .eq("id", existingGlobalProfile.id)
        : supabase.from(TABLE).insert(globalProfilePayload);
      const { data: saved, error: saveErr } = await mutation.select().single();
      if (saveErr) throw new Error(saveErr.message);
      return res.json({
        success: true,
        profile: saved,
        updated: Boolean(existingGlobalProfile),
      });
    } catch (err) {
      console.error("❌ [STYLE_PROFILE] promote global error:", err?.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 🗂️ Kategori sözlüğü — modaldaki yatay bar bunu okur.
  // Sayım istemcide yapılır: profiller zaten category_slug ile geliyor, böylece
  // bar ile listedeki süzme sonucu her zaman birbirini tutar.
  router.get("/categories", async (_req, res) => {
    try {
      const categories = await listCategories();
      return res.json({ success: true, categories });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 🎯 Admin'in seçtiği sabit kart görselleri. Önce (kategori + alt tür) tam
  // eşleşmesi, boş kalan slotlar için kategori geneli. Tablo henüz yoksa
  // (migration çalıştırılmadıysa) sessizce boş döner — uygulama çalışmaya devam
  // eder, yalnız kartlar havuz görselini gösterir.
  const readApproachCards = async (category, subtype, gender = null) => {
    const bySlot = {};
    try {
      let q = supabase
        .from("style_approach_cards")
        .select("product_subtype, gender, style_approach, image_url")
        .eq("product_category", category);
      q = subtype
        ? q.or(`product_subtype.eq.${subtype},product_subtype.is.null`)
        : q.is("product_subtype", null);
      // 🚻 Cinsiyet (24 Ağu 2026): ürünün kadın/erkek giyimi olduğu tespit
      // edildiyse o cinsiyetin görseli + cinsiyetsiz genel görsel okunur;
      // tespit yoksa YALNIZ cinsiyetsiz satırlar (kadın kart erkek ürüne
      // sızmasın).
      q = gender
        ? q.or(`gender.eq.${gender},gender.is.null`)
        : q.is("gender", null);
      const { data, error } = await q;
      if (error) throw error;
      // Her slot için EN ÖZEL grup kazanır — karışım yok:
      // (alt tür + cinsiyet) > (cinsiyet) > (alt tür) > (genel).
      // Cinsiyet alt türden DAHA belirleyici: kullanıcı kartlarda önce
      // "kadın mı erkek mi" görmek istiyor.
      // ⚠️ Slot başına 5 GÖRSEL olabilir (24 Ağu): tek URL değil DİZİ döner,
      // uygulama her açılışta bunlardan rastgele birini gösteriyor.
      const rank = (row) => (row.product_subtype ? 1 : 0) + (row.gender ? 2 : 0);
      const bestRank = {};
      for (const row of data || []) {
        const slot = row.style_approach;
        const r = rank(row);
        if (bestRank[slot] === undefined || r > bestRank[slot]) {
          bestRank[slot] = r;
          bySlot[slot] = [];
        }
        if (r === bestRank[slot]) bySlot[slot].push(row.image_url);
      }
    } catch (err) {
      console.warn(
        "🎯 [APPROACH_CARDS] Seçili kart görselleri okunamadı (migration eksik olabilir):",
        err.message,
      );
    }
    return bySlot;
  };

  // 🎨 Çekim tarzı kartlarının ÖRNEK GÖRSELLERİ (17 Ağu 2026, kullanıcı isteği).
  // Yükleme kartının altındaki 1/2/3 kartları artık jenerik yer tutucu yerine
  // O TARZIN havuzundaki gerçek referans karelerini slayt olarak gösterir.
  // Alt tür havuzu boşsa kategori havuzuna düşer — kart asla boş kalmaz.
  router.get("/approach-samples", async (req, res) => {
    try {
      const category = String(req.query.category || "").trim().toLowerCase();
      if (!category) {
        return res
          .status(400)
          .json({ success: false, error: "category is required" });
      }
      const subtype = String(req.query.subtype || "").trim().toLowerCase() || null;
      // 🚻 Ürünün hedef cinsiyeti (classify ucundan gelir). Sözlük dışı her
      // değer yok sayılır ki kart seçimi beklenmedik bir etiketle boşa düşmesin.
      const genderRaw = String(req.query.gender || "").trim().toLowerCase();
      const gender = genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      const perApproach = Math.min(
        Math.max(Number.parseInt(req.query.limit, 10) || 8, 1),
        12,
      );

      const cacheKey = `${TABLE}|${category}|${subtype || "-"}|${gender || "-"}|${perApproach}`;
      const cached = approachSampleCache.get(cacheKey);
      if (cached && Date.now() - cached.at < APPROACH_SAMPLE_TTL_MS) {
        return res.json({ ...cached.payload, cached: true });
      }

      // 🎯 Admin'in elle seçtiği SABİT kart görselleri her şeyin önünde gelir.
      // Önce tam eşleşme (kategori+alt tür), sonra kategori geneli.
      const curated = await readApproachCards(category, subtype, gender);

      // Admin bir slotu seçmediyse kart boş kalmasın diye havuzdan kare gösterilir.
      // ⚠️ Bu da SABİT olmalı (kullanıcı kararı 17 Ağu: "değişmesin") — rastgele
      // değil, en yeni stil alınır; aynı havuzla her açılışta aynı kare gelir.
      const fetchWindow = async (
        approach,
        withSubtype,
        withGender = false,
        fromCategory = category,
      ) => {
        let q = supabase
          .from(TABLE)
          .select("image_urls")
          .in("user_id", ["auto", "global"])
          .eq("product_category", fromCategory)
          .eq("style_approach", approach)
          .not("image_urls", "is", null)
          .or("auto_pool.is.null,auto_pool.eq.true")
          .order("created_at", { ascending: false })
          .limit(perApproach);
        if (withSubtype && subtype) q = q.eq("product_subtype", subtype);
        // ⚠️ style_profiles.gender YALNIZ giyim + Sokak Stili (4) kayıtlarında
        // dolu (bkz. add_style_profiles_gender_column.sql). Diğer tarzlarda bu
        // süzgeç boş döner ve aşağıdaki kademe cinsiyetsiz havuza düşer.
        if (withGender && gender) q = q.eq("gender", gender);
        const { data } = await q;
        return (data || [])
          .map((row) => (Array.isArray(row.image_urls) ? row.image_urls[0] : null))
          .filter((url) => typeof url === "string" && /^https?:\/\//i.test(url))
          .slice(0, 1);
      };

      const samples = {};
      const curatedSlots = [];
      await Promise.all(
        [1, 2, 3, 4, 5].map(async (approach) => {
          // 1) Admin seçtiyse yalnız onun seçtikleri gösterilir.
          // ⚠️ 17 Ağu'daki "tek ve sabit kare" kararı 24 Ağu'da TERSİNE
          // çevrildi: monotonluk şikâyeti üzerine slota 5 görsele kadar
          // seçilebiliyor ve istemci her açılışta sırayı karıştırıyor
          // (StyleApproachPicker → SlidingArtwork).
          if (curated[approach]?.length) {
            samples[approach] = curated[approach];
            curatedSlots.push(approach);
            return;
          }
          // 2) Seçilmemiş slot: havuzdan kare göster ki kart boş kalmasın.
          //    Kademe: (alt tür + cinsiyet) → (cinsiyet) → (alt tür) → genel.
          let urls = gender ? await fetchWindow(approach, true, true) : [];
          if (urls.length === 0 && gender) urls = await fetchWindow(approach, false, true);
          if (urls.length === 0) urls = await fetchWindow(approach, true);
          // Alt tür havuzu boşsa kategori geneline düş.
          if (urls.length === 0) urls = await fetchWindow(approach, false);
          samples[approach] = urls;
        }),
      );

      // 👟 AYAKKABI = NORMAL GİYİM (27 Ağu 2026, kullanıcı kararı v2):
      // ayakkabıya özgü kart görseli yoksa kart BULANIK ödünçle değil,
      // GİYİMİN NET kartlarıyla dolar — kullanıcı ayakkabıda giyim tarz
      // kartlarının aynen görünmesini istiyor. Curated giyim kartları önce,
      // yoksa giyim havuzu (cinsiyet kademesiyle). Takı bu kuralın dışında.
      if (category === "shoes") {
        const clothingCurated = await readApproachCards("clothing", null, gender);
        await Promise.all(
          [1, 2, 3, 4, 5].map(async (approach) => {
            if (samples[approach]?.length) return; // ayakkabıya özel varsa dokunma
            if (clothingCurated[approach]?.length) {
              samples[approach] = clothingCurated[approach];
              return;
            }
            let urls = gender
              ? await fetchWindow(approach, false, true, "clothing")
              : [];
            if (urls.length === 0) {
              urls = await fetchWindow(approach, false, false, "clothing");
            }
            if (urls.length) samples[approach] = urls;
          }),
        );
      }

      // 🌫️ ÖDÜNÇ KARELER (26 Ağu 2026, kullanıcı kararı) — kendi havuzu BOŞ
      // kalan tarzlar için (ör. giyimde style_approach=2 hiç kayıt yok).
      // İstemci bunları BULANIK basıyor, kart boş gri kalmasın diye.
      // ⚠️ Kartlarda gösterilen curated karelerin AYNISI OLAMAZ: aynı görselin
      // net ve bulanık iki kopyası yan yana durmasın. Bu yüzden curated değil
      // doğrudan EDİTORYAL HAVUZUNDAN taze kareler alınır.
      const borrowed = {};
      const emptyApproaches = [1, 2, 3, 4, 5].filter((a) => !samples[a]?.length);
      if (emptyApproaches.length) {
        const taken = new Set(Object.values(samples).flat());
        // 🚻 Ödünç kareler de ürünün CİNSİYETİNE uyar (26 Ağu, kullanıcı):
        // önce cinsiyet eşleşmesi denenir; havuz dar kalırsa (ör. erkek ürünü
        // ama erkek editoryal az) cinsiyetsiz sorguya düşülür — kart hiç boş
        // kalmasın. Editoryal havuzu etiketli: woman ~5.8k / man ~200.
        const fetchBorrowPool = async (withGender, fromCategory = category) => {
          let q = supabase
            .from(TABLE)
            .select("image_urls")
            .in("user_id", ["auto", "global"])
            .eq("product_category", fromCategory)
            .eq("style_approach", 1)
            .not("image_urls", "is", null)
            .or("auto_pool.is.null,auto_pool.eq.true")
            .order("created_at", { ascending: false })
            .limit(60);
          if (withGender && gender) q = q.eq("gender", gender);
          const { data } = await q;
          return (data || [])
            .map((row) => (Array.isArray(row.image_urls) ? row.image_urls[0] : null))
            .filter(
              (url) =>
                typeof url === "string" &&
                /^https?:\/\//i.test(url) &&
                !taken.has(url),
            );
        };
        let pool = gender ? await fetchBorrowPool(true) : [];
        // Her boş karta dolu bir dilim düşecek kadar kare yoksa genele düş
        if (pool.length < emptyApproaches.length * perApproach) {
          const generic = await fetchBorrowPool(false);
          const seen = new Set(pool);
          pool = pool.concat(generic.filter((u) => !seen.has(u)));
        }
        // 👟 AYAKKABI = NORMAL GİYİM (27 Ağu 2026, kullanıcı): ayakkabı havuzu
        // incecik (≈11 kayıt) — kartlar bomboş kalıyordu. Kendi havuzu
        // yetmezse GİYİM editoryal havuzundan ödünç alınır (takı BİLEREK
        // hariç: takı görseli ayakkabı kartında, giyim görseli takı kartında
        // yanıltıcı olur). Aynı cinsiyet kademesi burada da işler.
        if (
          category === "shoes" &&
          pool.length < emptyApproaches.length * perApproach
        ) {
          const seen = new Set(pool);
          const clothingPool = (
            gender ? await fetchBorrowPool(true, "clothing") : []
          ).concat(await fetchBorrowPool(false, "clothing"));
          pool = pool.concat(
            clothingPool.filter((u) => {
              if (seen.has(u)) return false;
              seen.add(u);
              return true;
            }),
          );
        }
        // Her boş tarza AYRI dilim: iki boş kart aynı kareleri göstermesin.
        emptyApproaches.forEach((approach, i) => {
          const slice = pool.slice(i * perApproach, (i + 1) * perApproach);
          if (slice.length) borrowed[approach] = slice;
        });
      }

      const payload = { success: true, category, subtype, gender, samples, borrowed, curatedSlots };
      approachSampleCache.set(cacheKey, { at: Date.now(), payload });
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Beyaz Stüdyo koleksiyonları (26 Ağu 2026) ────────────────────────────
  // Giyimin 4. tarz kartına (style_approach=5) tıklanınca açılan modal bu ucu
  // çeker: havuzdaki beyaz stüdyo stilleri KOLEKSİYONA göre gruplu döner
  // ("zara", "cos"…; etiketsizler "other"). Kullanıcının seçtiği stilin id'si
  // üretime styleProfileId olarak gider — mevcut referans hattı, yeni yol yok.
  router.get("/white-studio-styles", async (req, res) => {
    try {
      const genderRaw = String(req.query.gender || "").trim().toLowerCase();
      const gender = genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      let q = supabase
        .from(TABLE)
        .select("id, name, image_urls, display_image_urls, collection, gender")
        .in("user_id", ["auto", "global"])
        .eq("product_category", "clothing")
        .eq("style_approach", 5)
        .eq("status", "completed")
        .not("image_urls", "is", null)
        .or("auto_pool.is.null,auto_pool.eq.true")
        .order("created_at", { ascending: false })
        .limit(200);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []).filter((row) => {
        // Cinsiyet YUMUŞAK süzgeç: zıt etiketli stil elenir, etiketsiz kalır
        if (!gender || !row.gender) return true;
        return row.gender === gender;
      });
      const groups = new Map();
      for (const row of rows) {
        const key = row.collection || "other";
        if (!groups.has(key)) groups.set(key, []);
        const cover = Array.isArray(row.display_image_urls) && row.display_image_urls[0]
          ? row.display_image_urls[0]
          : Array.isArray(row.image_urls)
            ? row.image_urls[0]
            : null;
        if (!cover) continue;
        groups.get(key).push({ id: row.id, name: row.name || null, image: cover });
      }
      // "other" en sonda; kalanlar alfabetik — modalda sıra kararlı olsun.
      const collections = [...groups.entries()]
        .sort(([a], [b]) =>
          a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b),
        )
        .map(([key, styles]) => ({ key, styles }));
      return res.json({ success: true, gender, collections });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: kart görseli seçimi ───────────────────────────────────────────
  // Admin panelde bir (kategori × alt tür) için üç tarzın seçili görselleri ve
  // seçilebilecek havuz adayları. /admin öneki app.js'te requireAdmin ile korunuyor.
  router.get("/admin/approach-cards", async (req, res) => {
    try {
      const category = String(req.query.category || "").trim().toLowerCase();
      if (!category) {
        return res
          .status(400)
          .json({ success: false, error: "category is required" });
      }
      const subtype =
        String(req.query.subtype || "").trim().toLowerCase() || null;
      const genderRaw = String(req.query.gender || "").trim().toLowerCase();
      const gender = genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      // candidates=0 → aday sorguları HİÇ çalışmaz. Panel adayları artık
      // sayfalanan /admin/approach-candidates ucundan çekiyor; burada tekrar
      // çekmek boşuna dört sorgu demekti.
      const skipCandidates = String(req.query.candidates || "") === "0";
      const candidateLimit = Math.min(
        Math.max(Number.parseInt(req.query.candidates, 10) || 60, 1),
        200,
      );

      const { data: rows, error: cardsErr } = await supabase
        .from("style_approach_cards")
        .select("*")
        .eq("product_category", category);
      if (cardsErr) throw cardsErr;

      // Panelde YALNIZ o an seçili (alt tür × cinsiyet) kombinasyonunun
      // kayıtları gösterilir — "genel" sekmesi cinsiyetsiz satırları düzenler.
      // ⚠️ Slot başına 5 GÖRSELE kadar (24 Ağu): tekil nesne değil DİZİ.
      const selected = {};
      for (const row of rows || []) {
        if ((row.product_subtype || "") !== (subtype || "")) continue;
        if ((row.gender || "") !== (gender || "")) continue;
        (selected[row.style_approach] ||= []).push({
          imageUrl: row.image_url,
          styleProfileId: row.style_profile_id,
          updatedAt: row.updated_at,
        });
      }
      // Panelde sıra sabit kalsın (eklenme sırası).
      for (const k of Object.keys(selected)) {
        selected[k].sort((a, b) =>
          String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")),
        );
      }

      // Seçim yapılacak havuz adayları — o tarzın gerçek stilleri.
      const candidates = {};
      await Promise.all(
        (skipCandidates ? [] : [1, 2, 3, 4]).map(async (approach) => {
          let q = supabase
            .from(TABLE)
            .select("id, image_urls, product_subtype, gender, created_at")
            .in("user_id", ["auto", "global"])
            .eq("product_category", category)
            .eq("style_approach", approach)
            .not("image_urls", "is", null)
            .or("auto_pool.is.null,auto_pool.eq.true")
            .order("created_at", { ascending: false })
            .limit(candidateLimit);
          if (subtype) q = q.eq("product_subtype", subtype);
          const { data } = await q;
          let list = (data || [])
            .map((row) => ({
              styleProfileId: row.id,
              imageUrl: Array.isArray(row.image_urls) ? row.image_urls[0] : null,
              subtype: row.product_subtype,
              gender: row.gender ?? null,
            }))
            .filter((item) => typeof item.imageUrl === "string");
          // 🚻 Cinsiyet sekmesindeyken aynı etiketli havuz stilleri BAŞA alınır
          // (etiketsizler listeden düşmez: havuzun büyük kısmı etiketsiz, bkz.
          // add_style_profiles_gender_column.sql).
          if (gender) {
            list = [
              ...list.filter((item) => item.gender === gender),
              ...list.filter((item) => item.gender !== gender),
            ];
          }
          candidates[approach] = list;
        }),
      );

      return res.json({ success: true, category, subtype, gender, selected, candidates });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message,
        hint: /style_approach_cards/.test(err.message || "")
          ? "migrations/add_style_approach_cards.sql çalıştırılmamış olabilir"
          : undefined,
      });
    }
  });

  // 📜 Sonsuz kaydırma için TEK TARZIN adayları, imleçle sayfalanır
  // (24 Ağu 2026, kullanıcı isteği: "belli sayıda değil, infinite scroll").
  //
  // Neden ayrı uç: /admin/approach-cards dört tarzın adayını birden çekiyor ve
  // sabit bir tavanla kesiyordu. Kapak görseli seçerken havuzun tamamı
  // gezilebilmeli.
  //
  // ⚠️ CİNSİYET SIRALAMASI ve SAYFALAMA birlikte çalışsın diye imleç iki
  // AŞAMA tutuyor: `0` = istenen cinsiyetle etiketli kayıtlar, `1` = geri
  // kalanlar. PostgREST'te "gender = X önce gelsin" diye sıralayamadığımız
  // için akış ikiye bölündü; istemci imleci sadece geri yolluyor.
  router.get("/admin/approach-candidates", async (req, res) => {
    try {
      const category = String(req.query.category || "").trim().toLowerCase();
      const approach = Number.parseInt(req.query.approach, 10);
      if (!category || ![1, 2, 3, 4].includes(approach)) {
        return res.status(400).json({
          success: false,
          error: "category and approach (1-4) are required",
        });
      }
      const subtype =
        String(req.query.subtype || "").trim().toLowerCase() || null;
      const genderRaw = String(req.query.gender || "").trim().toLowerCase();
      const gender =
        genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      const limit = Math.min(
        Math.max(Number.parseInt(req.query.limit, 10) || 48, 1),
        100,
      );

      const [phaseRaw, offsetRaw] = String(req.query.cursor || "0:0").split(":");
      let phase = Number.parseInt(phaseRaw, 10) || 0;
      let offset = Number.parseInt(offsetRaw, 10) || 0;
      const lastPhase = gender ? 1 : 0;

      const buildQuery = () => {
        let q = supabase
          .from(TABLE)
          .select("id, image_urls, product_subtype, gender, created_at")
          .in("user_id", ["auto", "global"])
          .eq("product_category", category)
          .eq("style_approach", approach)
          .not("image_urls", "is", null)
          .or("auto_pool.is.null,auto_pool.eq.true")
          .order("created_at", { ascending: false });
        if (subtype) q = q.eq("product_subtype", subtype);
        if (gender) {
          q =
            phase === 0
              ? q.eq("gender", gender)
              : q.or(`gender.neq.${gender},gender.is.null`);
        }
        return q;
      };

      const items = [];
      // Bir aşama bittiğinde sayfa yarım kalmasın diye döngü: kalan kadarını
      // sonraki aşamadan tamamlar.
      while (items.length < limit && phase <= lastPhase) {
        const need = limit - items.length;
        const { data, error } = await buildQuery().range(
          offset,
          offset + need - 1,
        );
        if (error) throw error;
        const mapped = (data || [])
          .map((row) => ({
            styleProfileId: row.id,
            imageUrl: Array.isArray(row.image_urls) ? row.image_urls[0] : null,
            subtype: row.product_subtype,
            gender: row.gender ?? null,
          }))
          .filter((item) => typeof item.imageUrl === "string");
        items.push(...mapped);

        if (!data || data.length < need) {
          phase += 1;
          offset = 0;
        } else {
          offset += need;
        }
      }

      // Sayfa dolmadıysa havuz bitmiştir; imleç null döner ve istemci durur.
      const cursor =
        items.length === limit && phase <= lastPhase ? `${phase}:${offset}` : null;

      return res.json({ success: true, items, cursor });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Bir slotu ayarla (aynı slot tekrar gönderilirse üzerine yazar).
  router.put("/admin/approach-cards", async (req, res) => {
    try {
      const category = String(req.body?.category || "").trim().toLowerCase();
      const subtype =
        String(req.body?.subtype || "").trim().toLowerCase() || null;
      const genderRaw = String(req.body?.gender || "").trim().toLowerCase();
      const gender = genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      const approach = Number.parseInt(req.body?.approach, 10);
      const imageUrl = String(req.body?.imageUrl || "").trim();
      const styleProfileId = req.body?.styleProfileId || null;

      if (!category || !imageUrl || ![1, 2, 3, 4].includes(approach)) {
        return res.status(400).json({
          success: false,
          error: "category, approach (1-4) and imageUrl are required",
        });
      }

      // ⚠️ 24 Ağu: slot artık TEK görsel tutmuyor, en fazla 5 görsel tutuyor.
      // Bu yüzden "üzerine yaz" değil "ekle" davranışı. Aynı görsel iki kez
      // eklenemez (unique indeks) ve 5'ten fazlası reddedilir.
      // NULL alt tür `.is()` ile, dolu alt tür `.eq()` ile aranır.
      const slotFilter = (query) => {
        let q = query
          .eq("product_category", category)
          .eq("style_approach", approach);
        q = subtype ? q.eq("product_subtype", subtype) : q.is("product_subtype", null);
        return gender ? q.eq("gender", gender) : q.is("gender", null);
      };

      const { data: existingRows, error: existingErr } = await slotFilter(
        supabase.from("style_approach_cards").select("id, image_url"),
      );
      if (existingErr) throw existingErr;

      const already = (existingRows || []).find((r) => r.image_url === imageUrl);
      if (already) {
        return res.json({ success: true, card: already, alreadySelected: true });
      }
      if ((existingRows || []).length >= MAX_CARDS_PER_SLOT) {
        return res.status(409).json({
          success: false,
          error: `Bu slotta en fazla ${MAX_CARDS_PER_SLOT} görsel olabilir — önce birini kaldırın.`,
          limit: MAX_CARDS_PER_SLOT,
        });
      }

      const result = await supabase
        .from("style_approach_cards")
        .insert({
          product_category: category,
          product_subtype: subtype,
          gender,
          style_approach: approach,
          image_url: imageUrl,
          style_profile_id: styleProfileId,
        })
        .select()
        .single();
      if (result.error) {
        // ⚠️ Eski tekil indeks (style_approach_cards_slot_idx) hâlâ duruyorsa
        // ikinci görsel unique ihlaliyle patlar. Ham Postgres hatası yerine
        // ne yapılacağını söyleyen bir mesaj dön.
        if (/slot_idx|duplicate key/i.test(result.error.message || "")) {
          return res.status(409).json({
            success: false,
            error:
              "Bu slota ikinci görsel eklenemiyor: migrations/add_style_approach_cards_multi.sql henüz çalıştırılmamış.",
          });
        }
        throw result.error;
      }

      approachSampleCache.clear(); // seçim anında görünsün
      return res.json({ success: true, card: result.data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });


  // ✏️ Kart görselini PROMPT ile yeniden üret (31 Ağu 2026, kullanıcı isteği)
  //
  // Akış: yönetici Türkçe yazar → metin İngilizce bir DÜZENLEME talimatına
  // çevrilir → openai/gpt-image-2/edit mevcut kareyi o talimatla yeniden üretir →
  // sonuç `reference` bucket'ına yüklenir → slottaki satırın image_url'i yeni
  // adrese döner. Kart aynı yerinde kalır, yalnız görseli değişir.
  //
  // ⚠️ ORAN KORUNUR: kaynağın en/boy oranı ölçülüp gpt-image-2'nin en yakın
  // hazır ölçüsüne eşleniyor (bkz. nearestGptImageSize) — kartlar 3:4
  // gösteriliyor, oran değişirse uygulamada kırpma bozuluyor. Model "aynı
  // kadraj" talimatını da prompt içinde alıyor; ikisi birlikte güvence.
  //
  // ⚠️ Eski görsel bucket'ta BIRAKILIR. Aynı kare başka bir slotta ya da bir
  // stil profilinde de kullanılıyor olabilir; silmek onları kırardı.
  router.post("/admin/approach-cards/regenerate", async (req, res) => {
    try {
      const category = String(req.body?.category || "").trim().toLowerCase();
      const subtype =
        String(req.body?.subtype || "").trim().toLowerCase() || null;
      const genderRaw = String(req.body?.gender || "").trim().toLowerCase();
      const gender =
        genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      const approach = Number.parseInt(req.body?.approach, 10);
      const imageUrl = String(req.body?.imageUrl || "").trim();
      const userPrompt = String(req.body?.prompt || "").trim();

      if (!category || !imageUrl || ![1, 2, 3, 4].includes(approach)) {
        return res.status(400).json({
          success: false,
          error: "category, approach (1-4) ve imageUrl zorunlu",
        });
      }
      if (userPrompt.length < 3) {
        return res
          .status(400)
          .json({ success: false, error: "Ne değişsin, birkaç kelimeyle yazın." });
      }
      // Erken kontrol: anahtar yoksa çeviri çağrısını boşuna yapmayalım.
      if (!(process.env.FAL_API_KEY || process.env.FAL_KEY)) {
        return res
          .status(500)
          .json({ success: false, error: "FAL_API_KEY tanımlı değil" });
      }

      // 1) Satır gerçekten bu slotta mı? Yalnız seçili kareler düzenlenebilir.
      let rowQuery = supabase
        .from("style_approach_cards")
        .select("id, image_url")
        .eq("product_category", category)
        .eq("style_approach", approach)
        .eq("image_url", imageUrl);
      rowQuery = subtype
        ? rowQuery.eq("product_subtype", subtype)
        : rowQuery.is("product_subtype", null);
      rowQuery = gender
        ? rowQuery.eq("gender", gender)
        : rowQuery.is("gender", null);
      const { data: row, error: rowErr } = await rowQuery.maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) {
        return res.status(404).json({
          success: false,
          error: "Bu görsel bu slotta seçili değil — sayfayı yenileyin.",
        });
      }

      // 2) Türkçe istek → İngilizce düzenleme talimatı.
      // Çeviri ayrı bir adım DEĞİL: model hem çeviriyi hem "sadece bunu
      // değiştir, gerisi aynı kalsın" çerçevesini tek çağrıda kuruyor.
      // Başarısız olursa ham metinle devam edilir — yönetici zaten İngilizce
      // yazmış olabilir, işi tamamen durdurmak gereksiz.
      const instructionBrief = [
        "You are writing a single image-editing instruction for an image editing model.",
        "The admin's request below may be written in Turkish; translate its meaning into English.",
        "Output ONLY the final English editing instruction, one paragraph, no preamble.",
        "The instruction must state that everything not mentioned stays exactly as in the source image:",
        "same subject, same product, same framing, same crop and aspect ratio, same camera angle.",
        "Apply only the requested change.",
        "",
        `ADMIN REQUEST: ${userPrompt}`,
      ].join("\n");

      let editPrompt = "";
      try {
        editPrompt = String(
          (await callGeminiFlash(instructionBrief, [], 2)) || "",
        ).trim();
      } catch (err) {
        console.warn(
          "⚠️ [APPROACH_CARD_REGEN] çeviri başarısız, ham metin kullanılıyor:",
          err?.message,
        );
      }
      if (!editPrompt) editPrompt = userPrompt;
      // Oran güvencesi prompt'a her hâlükârda eklenir (model çevirisi bunu
      // düşürmüş olabilir).
      const finalPrompt = `${editPrompt}\n\nKeep the exact same framing, crop, aspect ratio and composition as the source image.`;

      // 3) GPT Image 2 ile düzenle (31 Ağu 2026, kullanıcı kararı).
      //
      // ⚠️ ORAN: gpt-image-2'nin `aspect_ratio: "auto"` gibi bir seçeneği yok,
      // hazır `image_size` ölçülerinden birini istiyor. Bu yüzden kaynağın
      // oranı ÖLÇÜLÜP en yakın ölçüye eşleniyor — sabit bir değer yazılsaydı
      // (örn. portrait_4_3) 3:4 olmayan havuz kareleri kırpılırdı.
      const sourceUrl = getOriginalUrl(imageUrl);
      const sourceMeta = await axios.get(sourceUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      const { width: srcW, height: srcH } = await sharp(
        Buffer.from(sourceMeta.data),
      ).metadata();
      const imageSize = nearestGptImageSize(srcW, srcH);

      const falClient = createFalClient();
      const MODEL = "openai/gpt-image-2/edit";
      // Kuyruk kullanılıyor: gpt-image-2 senkron uçta zaman aşımına
      // düşebilecek kadar yavaş (kod tabanındaki diğer çağrılar da kuyrukta).
      console.log(
        `🎨 [APPROACH_CARD_REGEN] ${category}/${approach} · kaynak ${srcW}x${srcH} → ${imageSize} · gpt-image-2 kuyruğa veriliyor`,
      );
      console.log(
        `🎨 [APPROACH_CARD_REGEN] prompt: ${finalPrompt.slice(0, 160).replace(/\s+/g, " ")}…`,
      );
      const { request_id: requestId } = await falClient.queue.submit(MODEL, {
        input: {
          prompt: finalPrompt,
          image_urls: [sourceUrl],
          image_size: imageSize,
          // Kart görselleri uzun ömürlü ve seyrek üretiliyor (yönetici
          // eylemi) — burada kalite maliyete tercih ediliyor.
          quality: "high",
          num_images: 1,
          output_format: "jpeg",
        },
      });
      if (!requestId) throw new Error("fal request_id döndürmedi");
      console.log(`⏳ [APPROACH_CARD_REGEN] request_id: ${requestId}`);

      const MAX_POLLS = 90; // 3 sn × 90 ≈ 4,5 dakika
      const startedAt = Date.now();
      let producedUrl = null;
      let lastStatus = "";
      for (let poll = 0; poll < MAX_POLLS; poll += 1) {
        const status = await falClient.queue.status(MODEL, {
          requestId,
          logs: false,
        });
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        // Her turu basmak logu boğuyor (90 satır). Durum DEĞİŞTİĞİNDE ve
        // ayrıca 15 saniyede bir "hâlâ çalışıyor" satırı yazılır — takılma
        // ile ilerleme bu ikisiyle ayırt edilebiliyor.
        if (status.status !== lastStatus || poll % 5 === 0) {
          console.log(
            `⏳ [APPROACH_CARD_REGEN] ${poll + 1}/${MAX_POLLS} · ${status.status} · ${elapsed} sn`,
          );
          lastStatus = status.status;
        }
        if (status.status === "COMPLETED") {
          const done = await falClient.queue.result(MODEL, { requestId });
          producedUrl = done?.data?.images?.[0]?.url || null;
          console.log(
            `✅ [APPROACH_CARD_REGEN] üretim bitti (${elapsed} sn) → ${producedUrl ? "görsel var" : "GÖRSEL YOK"}`,
          );
          break;
        }
        if (status.status === "FAILED") {
          console.error(
            `❌ [APPROACH_CARD_REGEN] fal FAILED (${elapsed} sn)`,
            JSON.stringify(status).slice(0, 300),
          );
          throw new Error("GPT Image 2 üretimi başarısız");
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!producedUrl) {
        throw new Error("GPT Image 2 zaman aşımına uğradı veya görsel dönmedi");
      }

      // 4) Bucket'a yaz. Yol her seferinde benzersiz: aynı adrese yazmak
      // CDN'in uzun cache'i yüzünden eski kareyi geri getirirdi.
      const download = await axios.get(producedUrl, {
        responseType: "arraybuffer",
        timeout: 180000,
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024,
      });
      const contentType = String(
        download.headers["content-type"] || "image/jpeg",
      )
        .split(";")[0]
        .trim();
      const ext = contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : "jpg";
      const objectPath = `${STORAGE_PREFIX}approach_${category}_${approach}_${Date.now()}_${uuidv4().substring(0, 8)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("reference")
        .upload(objectPath, Buffer.from(download.data), {
          contentType,
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadErr) throw new Error(`Supabase upload: ${uploadErr.message}`);
      console.log(
        `📦 [APPROACH_CARD_REGEN] bucket'a yazıldı: ${objectPath} (${Math.round(download.data.byteLength / 1024)} KB)`,
      );
      const { data: publicData } = supabase.storage
        .from("reference")
        .getPublicUrl(objectPath);
      const newUrl = publicData?.publicUrl;
      if (!newUrl) throw new Error("Supabase public URL üretilemedi");

      // 5) DB'ye DOKUNULMAZ (31 Ağu 2026, kullanıcı isteği): sonuç önce
      // yöneticiye gösterilir, kart ancak "Kabul et" denince değişir.
      // Onay /approach-cards/apply, ret /approach-cards/discard ucunda.
      console.log(
        `👀 [APPROACH_CARD_REGEN] önizleme hazır — onay bekliyor: ${objectPath}`,
      );
      return res.json({
        success: true,
        imageUrl: newUrl,
        objectPath, // ret edilirse silinebilsin diye
        prompt: finalPrompt,
      });
    } catch (err) {
      const detail =
        err?.response?.data?.detail?.[0]?.msg ||
        err?.response?.data?.error ||
        err.message;
      console.error("❌ [APPROACH_CARD_REGEN]", detail);
      return res.status(500).json({ success: false, error: detail });
    }
  });


  // ✅ Önizlemeyi ONAYLA — kart görseli ancak burada değişir.
  // Ayrı uç olmasının sebebi: üretim uzun sürüyor ve yönetici sonucu görmeden
  // karar veremiyor. Üretim ucu artık yalnız bucket'a yazıp URL döndürüyor.
  router.post("/admin/approach-cards/apply", async (req, res) => {
    try {
      const category = String(req.body?.category || "").trim().toLowerCase();
      const subtype =
        String(req.body?.subtype || "").trim().toLowerCase() || null;
      const genderRaw = String(req.body?.gender || "").trim().toLowerCase();
      const gender =
        genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      const approach = Number.parseInt(req.body?.approach, 10);
      const oldImageUrl = String(req.body?.oldImageUrl || "").trim();
      const newImageUrl = String(req.body?.newImageUrl || "").trim();

      if (!category || !oldImageUrl || !newImageUrl || ![1, 2, 3, 4].includes(approach)) {
        return res.status(400).json({
          success: false,
          error: "category, approach, oldImageUrl ve newImageUrl zorunlu",
        });
      }

      let rowQuery = supabase
        .from("style_approach_cards")
        .select("id")
        .eq("product_category", category)
        .eq("style_approach", approach)
        .eq("image_url", oldImageUrl);
      rowQuery = subtype
        ? rowQuery.eq("product_subtype", subtype)
        : rowQuery.is("product_subtype", null);
      rowQuery = gender
        ? rowQuery.eq("gender", gender)
        : rowQuery.is("gender", null);
      const { data: row, error: rowErr } = await rowQuery.maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) {
        return res.status(404).json({
          success: false,
          error: "Değiştirilecek görsel bu slotta bulunamadı — sayfayı yenileyin.",
        });
      }

      // Satır YERİNDE güncellenir; yeni satır açılmaz, sıra ve sayı korunur.
      // style_profile_id sıfırlanır: üretilen kare artık o profilin karesi değil.
      const { error: updateErr } = await supabase
        .from("style_approach_cards")
        .update({ image_url: newImageUrl, style_profile_id: null })
        .eq("id", row.id);
      if (updateErr) throw updateErr;

      approachSampleCache.clear(); // değişiklik uygulamada hemen görünsün
      console.log(
        `✏️ [APPROACH_CARD_APPLY] ${category}/${approach} güncellendi → ${newImageUrl}`,
      );
      return res.json({ success: true, imageUrl: newImageUrl });
    } catch (err) {
      console.error("❌ [APPROACH_CARD_APPLY]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 🗑️ Beğenilmeyen önizlemeyi bucket'tan sil.
  //
  // ⚠️ Yalnız BU akışın ürettiği dosyalar silinebilir: yol hem storage
  // ön ekiyle hem `approach_` damgasıyla başlamak zorunda. Aksi hâlde uç,
  // istemciden gelen serbest bir yolla havuzdaki gerçek kareleri silebilirdi.
  router.post("/admin/approach-cards/discard", async (req, res) => {
    try {
      const objectPath = String(req.body?.objectPath || "").trim();
      const expectedPrefix = `${STORAGE_PREFIX}approach_`;
      if (!objectPath || !objectPath.startsWith(expectedPrefix)) {
        return res.status(400).json({
          success: false,
          error: "Yalnız bu akışta üretilen önizlemeler silinebilir",
        });
      }
      const { error } = await supabase.storage
        .from("reference")
        .remove([objectPath]);
      if (error) throw error;
      console.log(`🗑️ [APPROACH_CARD_DISCARD] silindi: ${objectPath}`);
      return res.json({ success: true });
    } catch (err) {
      console.error("❌ [APPROACH_CARD_DISCARD]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Slotu temizle → kart yeniden havuz görseline döner.
  router.delete("/admin/approach-cards", async (req, res) => {
    try {
      const category = String(req.body?.category || req.query.category || "")
        .trim()
        .toLowerCase();
      const subtype =
        String(req.body?.subtype || req.query.subtype || "")
          .trim()
          .toLowerCase() || null;
      const genderRaw = String(req.body?.gender || req.query.gender || "")
        .trim()
        .toLowerCase();
      const gender = genderRaw === "woman" || genderRaw === "man" ? genderRaw : null;
      const approach = Number.parseInt(
        req.body?.approach ?? req.query.approach,
        10,
      );
      if (!category || ![1, 2, 3, 4].includes(approach)) {
        return res
          .status(400)
          .json({ success: false, error: "category and approach (1-4) required" });
      }
      let q = supabase
        .from("style_approach_cards")
        .delete()
        .eq("product_category", category)
        .eq("style_approach", approach);
      q = subtype ? q.eq("product_subtype", subtype) : q.is("product_subtype", null);
      q = gender ? q.eq("gender", gender) : q.is("gender", null);
      // imageUrl verilirse YALNIZ o görsel kaldırılır; verilmezse slot boşalır.
      const imageUrl = String(req.body?.imageUrl || req.query.imageUrl || "").trim();
      if (imageUrl) q = q.eq("image_url", imageUrl);
      const { error } = await q;
      if (error) throw error;
      approachSampleCache.clear();
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 🌍 Global (küratörlü) stil profilleri — user_id = 'global' satırları.
  // Admin, normal POST / ucuna userId: "global" ile oluşturur; tüm kullanıcılara sunulur.
  router.get("/global", async (req, res) => {
    try {
      // Global vitrin admin panelinden değiştirilebildiği için bu cevabın cihaz,
      // proxy veya CDN üzerinde eski kalmasına izin verme. Özellikle eski mobil
      // sürümler aynı URL'yi tekrar çağırdığı için cache'lenmiş katalog aksi
      // hâlde yeni seçilen fotoğrafları hiç göremeyebiliyor.
      res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "CDN-Cache-Control": "no-store",
        "Surrogate-Control": "no-store",
        Pragma: "no-cache",
        Expires: "0",
      });
      const { data, error } = await supabase
        .from(TABLE)
        .select(
          "id, name, subtitle, tags, category_slug, image_urls, display_image_urls, source_profile_id, status, created_at",
        )
        .eq("user_id", "global")
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);

      // Geriye uyumluluk:
      // - Yeni istemciler vitrinde display_image_urls kullanıyor.
      // - Eski uygulama sürümleri bu alanı bilmediği için yalnız image_urls okuyor.
      // API cevabında image_urls'u seçilen vitrin sonuçlarına eşleyerek eski
      // sürümlerin de adminin seçtiği güncel fotoğrafları göstermesini sağla.
      // DB'deki gerçek image_urls DEĞİŞMİYOR; üretim route'u styleProfileId ile
      // profili doğrudan DB'den okuyup orijinal referansları NB2'ye göndermeye
      // devam ediyor. reference_image_urls yalnız yeni/debug tüketicileri için
      // bu ayrımı açıkça koruyor.
      const profiles = (data || []).map((profile) => {
        const referenceImageUrls = Array.isArray(profile.image_urls)
          ? profile.image_urls.filter(Boolean)
          : [];
        const displayImageUrls = Array.isArray(profile.display_image_urls)
          ? profile.display_image_urls.filter(Boolean)
          : [];
        const publicImageUrls =
          displayImageUrls.length > 0 ? displayImageUrls : referenceImageUrls;

        return {
          ...profile,
          image_urls: publicImageUrls,
          display_image_urls: publicImageUrls,
          reference_image_urls: referenceImageUrls,
        };
      });

      return res.json({ success: true, profiles });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Kullanıcının profillerini listele
  router.get("/user/:userId", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("user_id", req.params.userId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return res.json({ success: true, profiles: data || [] });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Profile fotoğraf ekle — prompt TÜM fotoğraflar üzerinden yeniden üretilir
  router.post("/:id/images", async (req, res) => {
    try {
      const { userId, images } = req.body;
      const owned = await getOwnedProfile(req.params.id, userId);
      if (owned.error) {
        return res
          .status(owned.status)
          .json({ success: false, error: owned.error });
      }
      if (!Array.isArray(images) || images.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "images array is required" });
      }

      const existing = Array.isArray(owned.profile.image_urls)
        ? owned.profile.image_urls
        : [];
      if (existing.length + images.length > MAX_IMAGES) {
        return res.status(400).json({
          success: false,
          error: `At most ${MAX_IMAGES} images are allowed`,
          errorCode: "MAX_IMAGES",
        });
      }

      const newUrls = [];
      for (const img of images) {
        newUrls.push(await uploadStyleImage(img, userId));
      }
      const allUrls = [...existing, ...newUrls];

      await supabase
        .from(TABLE)
        .update({ image_urls: allUrls, status: "analyzing", stamped_grid_url: null, tags: null, category_slug: null })
        .eq("id", req.params.id);

      const stylePrompt = await reanalyzeAndSave(req.params.id, allUrls);

      return res.json({
        success: true,
        profile: {
          ...owned.profile,
          image_urls: allUrls,
          style_prompt: stylePrompt,
          status: stylePrompt ? "ready" : "failed",
        },
      });
    } catch (err) {
      console.error("❌ [STYLE_PROFILE] add images error:", err?.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Profilden fotoğraf çıkar (min 3 kuralı korunur) — prompt yeniden üretilir
  router.delete("/:id/images", async (req, res) => {
    try {
      const { userId, imageUrl } = req.body;
      const owned = await getOwnedProfile(req.params.id, userId);
      if (owned.error) {
        return res
          .status(owned.status)
          .json({ success: false, error: owned.error });
      }
      const existing = Array.isArray(owned.profile.image_urls)
        ? owned.profile.image_urls
        : [];
      const remaining = existing.filter((u) => u !== imageUrl);
      if (remaining.length === existing.length) {
        return res
          .status(404)
          .json({ success: false, error: "Image not found in profile" });
      }
      if (remaining.length < MIN_IMAGES) {
        return res.status(400).json({
          success: false,
          error: `A profile must keep at least ${MIN_IMAGES} images`,
          errorCode: "MIN_IMAGES",
        });
      }

      await supabase
        .from(TABLE)
        .update({ image_urls: remaining, status: "analyzing", stamped_grid_url: null, tags: null, category_slug: null })
        .eq("id", req.params.id);

      const stylePrompt = await reanalyzeAndSave(req.params.id, remaining);

      return res.json({
        success: true,
        profile: {
          ...owned.profile,
          image_urls: remaining,
          style_prompt: stylePrompt,
          status: stylePrompt ? "ready" : "failed",
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Profili yeniden adlandır
  router.put("/:id", async (req, res) => {
    try {
      const { userId, name } = req.body;
      const owned = await getOwnedProfile(req.params.id, userId);
      if (owned.error) {
        return res
          .status(owned.status)
          .json({ success: false, error: owned.error });
      }
      if (!name || !String(name).trim()) {
        return res
          .status(400)
          .json({ success: false, error: "name is required" });
      }
      const { data, error } = await supabase
        .from(TABLE)
        .update({ name: String(name).trim().slice(0, 32) })
        .eq("id", req.params.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return res.json({ success: true, profile: data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 🌟 ADMIN — otomatik stil havuzu metadata'sı: tags / product_category / auto_pool.
  // Kolonlar add_auto_style_pool_columns.sql migration'ı ile gelir. Seçim şu an
  // ortak havuzdan rastgele; kategori/tag ileride eşleme için kayıt altına alınır.
  // Yalnızca gönderilen alanlar güncellenir.
  router.patch("/:id/auto-meta", async (req, res) => {
    try {
      const {
        userId, tags, productCategory, productSubtype, styleApproach,
        autoPool, estimatedAge,
      } = req.body;
      const owned = await getOwnedProfile(req.params.id, userId);
      if (owned.error) {
        return res
          .status(owned.status)
          .json({ success: false, error: owned.error });
      }

      const patch = {};
      if (tags !== undefined) {
        if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
          return res
            .status(400)
            .json({ success: false, error: "tags must be a string array" });
        }
        // ⚠️ Vitrin aramasının çok dilli `tags` kolonuna DOKUNMA — otomatik
        // havuz etiketleri ayrı `auto_tags` kolonunda tutulur.
        patch.auto_tags = tags
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20);
      }
      if (productCategory !== undefined) {
        const normalized =
          productCategory === null
            ? null
            : String(productCategory).trim().toLowerCase().slice(0, 40);
        patch.product_category = normalized || null;
      }
      if (productSubtype !== undefined) {
        // Alt tür serbest metin gelebilir; küçük harf + 40 karakter sınırı.
        const normalizedSub =
          productSubtype === null
            ? null
            : String(productSubtype).trim().toLowerCase().slice(0, 40);
        patch.product_subtype = normalizedSub || null;
      }
      if (styleApproach !== undefined) {
        // Sayısal enum 1..3; aralık dışı/boş değer null'a düşer (kolonda CHECK var).
        const n = parseInt(styleApproach, 10);
        patch.style_approach =
          Number.isInteger(n) && n >= 1 && n <= 3 ? n : null;
      }
      if (autoPool !== undefined) {
        patch.auto_pool = autoPool === null ? null : Boolean(autoPool);
      }
      if (estimatedAge !== undefined) {
        if (estimatedAge === null) {
          patch.estimated_age = null;
        } else {
          const parsedAge = parseInt(estimatedAge, 10);
          if (!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 99) {
            return res.status(400).json({
              success: false,
              error: "estimatedAge must be a number between 0 and 99 (or null)",
            });
          }
          patch.estimated_age = parsedAge;
        }
      }
      if (Object.keys(patch).length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "No fields to update" });
      }

      const { data, error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq("id", req.params.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return res.json({ success: true, profile: data });
    } catch (err) {
      console.error("❌ [STYLE_PROFILE] auto-meta error:", err?.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Profili sil
  router.delete("/:id", async (req, res) => {
    try {
      const { userId } = req.body;
      const owned = await getOwnedProfile(req.params.id, userId);
      if (owned.error) {
        return res
          .status(owned.status)
          .json({ success: false, error: owned.error });
      }
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("id", req.params.id);
      if (error) throw new Error(error.message);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  return router;
}

module.exports = { createStyleProfileRouter };
