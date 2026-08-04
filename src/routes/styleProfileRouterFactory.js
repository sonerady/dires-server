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
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");
const { callGeminiFlash } = require("../utils/promptEnhanceProvider");

// Service role şart: style_profiles RLS'li ve anon/authenticated'e policy yok.
// .env'de anahtar adı SUPABASE_SERVICE_ROLE_KEY (Railway'de SUPABASE_SERVICE_KEY olabilir).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

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
  const GEMINI_ATTEMPTS = 5;

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

  // Profil oluştur: { userId, images: [{base64}|{uri}, ...], lang } (min 3)
  // Title backend tarafından görsellerden otomatik ve dile göre üretilir.
  router.post("/", async (req, res) => {
    try {
      const { userId, images, lang, userTitle: rawUserTitle } = req.body;
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

      // Hızlı ilk aşama: yalnızca kullanıcının dili + İngilizce title/subtitle.
      // Tam analiz ve kalan tüm diller response döndükten sonra arka planda tamamlanır.
      const initialMetadata = await generateInitialLocalizedMetadata(
        imageUrls,
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
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);

      // Kalan diller arka planda üretilecek — istemci/admin bunu sessizce yoklar.
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
        analyzeProfileInBackground(inserted.id, imageUrls).catch(
          (backgroundErr) => {
            console.error(
              "❌ [STYLE_PROFILE] analiz task başlatılamadı:",
              backgroundErr?.message,
            );
          },
        );
        translateProfileInBackground(
          inserted.id,
          imageUrls,
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

  // 🌍 Global (küratörlü) stil profilleri — user_id = 'global' satırları.
  // Admin, normal POST / ucuna userId: "global" ile oluşturur; tüm kullanıcılara sunulur.
  router.get("/global", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("id, name, subtitle, tags, category_slug, image_urls, status, created_at")
        .eq("user_id", "global")
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return res.json({ success: true, profiles: data || [] });
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
