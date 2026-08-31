// 🏷️ Ürün tipi + alt tür sınıflandırma (13 Ağu 2026, kullanıcı isteği)
//
// Fotoğraf yüklenir yüklenmez istemci buraya sorar; dönen tip hem KULLANICIYA
// gösterilir hem de üretim isteğinde `productCategory`/`productSubtype` olarak
// gider. Otomatik stil havuzu önce (tip + alt tür), olmazsa (tip), olmazsa
// genel havuzdan seçer — bkz. autoGlobalStyle.pickAutoGlobalStyleProfile.
//
// Model: **openai/gpt-5.6-luna** — 26 Ağu 2026'dan beri fal'ın
// openrouter/router/vision geçidi üzerinden (doğrudan OpenRouter değil;
// bakiye/402 riski fal kredisine taşındı).
// Prompt-enhance hattındaki Gemini'den BİLEREK ayrı: bu çağrı kısa, sıcaklığı
// sıfır ve tek kelimelik yapılandırılmış cevap istiyor.
//
// ⚠️ Üst tip yalnız ÜÇ değer: shoes · jewelry · clothing. Ayakkabı ve takı
// dışındaki her şey (çanta, kemer, şapka, gözlük dahil) clothing sayılır.
// Alt tür bilinmiyorsa null döner ve filtre yalnız üst tiple çalışır.
const express = require("express");
const axios = require("axios");
const { fal } = require("@fal-ai/client");
const { createClient } = require("@supabase/supabase-js");
const logger = require("../utils/logger");

const LUNA_MODEL = "openai/gpt-5.6-luna";
// 🐋 26 Ağu 2026 (kullanıcı kararı): varsayılan sağlayıcı DEEPSEEK — eklenti
// stil akışıyla aynı model. thinking:disabled ŞART (reasoning tokenı çıktı
// bütçesini yer, 22 Ağu dersi). Data URI kabul ettiği canlı doğrulandı.
const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";

// app_config.product_type_provider okumak için (promptEnhanceProvider deseni)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Sağlayıcı seçimi 60 sn cache'lenir — her sınıflandırmada DB'ye gidilmez.
let _providerCache = { value: null, at: 0 };
const PROVIDER_TTL_MS = 60 * 1000;

async function getProductTypeProvider() {
  const now = Date.now();
  if (_providerCache.value && now - _providerCache.at < PROVIDER_TTL_MS) {
    return _providerCache.value;
  }
  let provider = "deepseek"; // varsayılan (kullanıcı kararı, 26 Ağu 2026)
  try {
    const { data } = await supabase
      .from("app_config")
      .select("product_type_provider")
      .limit(1)
      .maybeSingle();
    if (
      data &&
      typeof data.product_type_provider === "string" &&
      data.product_type_provider.trim()
    ) {
      provider = data.product_type_provider.trim().toLowerCase();
    }
  } catch (e) {
    // kolon yoksa PostgREST hata fırlatır — key/value fallback'i dene
    try {
      const { data } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "product_type_provider")
        .maybeSingle();
      if (data && typeof data.value === "string" && data.value.trim()) {
        provider = data.value.trim().toLowerCase();
      }
    } catch (e2) {}
  }
  if (provider !== "deepseek" && provider !== "fal") provider = "deepseek";
  _providerCache = { value: provider, at: now };
  return provider;
}

// Alt tür sözlüğü — model bunların DIŞINA çıkarsa değer null'a düşer ki
// havuzda karşılığı olmayan bir etiket filtreyi boşa düşürmesin.
const SUBTYPES = {
  shoes: ["heels", "sneakers", "boots", "sandals", "flats", "loafers"],
  // ⌚ 27 Ağu 2026 (kullanıcı kararı): SAAT takı DEĞİL — giyim/accessory.
  jewelry: ["ring", "necklace", "earring", "bracelet", "anklet"],
  clothing: [
    "dress",
    "top",
    "bottom",
    "outerwear",
    "knitwear",
    "swimwear",
    "lingerie",
    "bag",
    "accessory",
    "eyewear",
  ],
};
const CATEGORIES = Object.keys(SUBTYPES);

// 🧩 ÇOK GÖRSELLİ BAĞLAM (24 Ağu 2026, kullanıcı isteği)
// Parçaları tek tek sınıflandırıp sonucu oy çokluğuyla birleştirmek yanlış
// sonuç veriyordu: "erkek pantolon + çiçekli beyaz elbise" kombininde 1-1
// berabere kalıp ilk sınıflanan parça kazanıyordu. Artık görseller TEK
// istekte, ne oldukları söylenerek gönderiliyor; modelin bütünü görüp karar
// vermesi gerekiyor.
const CONTEXT_PREFIX = {
  outfit: `These images are SEPARATE PIECES of ONE outfit that a single model will wear together.
Do NOT classify them one by one. Judge the COMPLETE LOOK:
- category: the category that defines the outfit (the garments outweigh bags/shoes/accessories)
- subtype: the garment that defines the silhouette
- color / pattern: of that defining garment
- gender: who the COMPLETE outfit is merchandised for — woman or man, never
  "unisex". If pieces seem to conflict, the garments that cover the torso and
  legs decide; a single ambiguous accessory must not flip the answer.
`,
  angles: `These images are DIFFERENT ANGLES / DETAIL SHOTS of the SAME single product.
Classify that ONE product. Use every angle together — a detail that is only
visible in one frame still describes the same product.
`,
};

const CLASSIFY_PROMPT = `Classify the product in this photo.

Return STRICT JSON, nothing else:
{"category":"<category>","subtype":"<subtype>","form":"<form>","color":"<dominant color>","pattern":"<pattern>","gender":"<gender>","wearable":"<yes|no>"}

category must be exactly one of: shoes, jewelry, clothing
- "shoes" = any footwear
- "jewelry" = earrings, necklaces, rings, bracelets, anklets
- "clothing" = EVERYTHING else, including bags, belts, hats, scarves, eyewear

subtype must be exactly one of the list for the chosen category:
- shoes: heels, sneakers, boots, sandals, flats, loafers
- jewelry: ring, necklace, earring, bracelet, anklet
- clothing: dress, top, bottom, outerwear, knitwear, swimwear, lingerie, bag, accessory, eyewear
- sunglasses and (eye)glasses take subtype "eyewear"
- hair accessories (clips, barrettes, scrunchies, headbands) are CLOTHING with
  subtype "accessory" — never jewelry, even when rhinestone/crystal decorated
- watches (wristwatches, smartwatches) are CLOTHING with subtype "accessory" —
  never jewelry
- a bangle or any wrist piece is jewelry subtype "bracelet" (not ring);
  an ankle chain is jewelry subtype "anklet" (not bracelet)

form: ONLY meaningful for jewelry subtype "bracelet". It says how the piece is
built, because that decides how it can be photographed:
- "chain"  = flexible / extendable: chain, tennis, link, mesh, beaded, cord,
             leather or fabric bracelets — anything that can be opened and laid
             out in a straight line, usually closed with a clasp
- "bangle" = rigid and fixed-round: a solid bangle or cuff that keeps its circle
             and cannot be stretched or laid out straight, with or without a hinge
Use "" (empty) for every other subtype and whenever you cannot tell.

color: the product's single dominant color as one lowercase English word
(e.g. "red", "navy", "beige", "gold"). Use "multicolor" if no single color dominates.
pattern: one of solid, striped, floral, plaid, polka-dot, animal, graphic, other
gender: who the product is merchandised for — EXACTLY one of woman, man.
Judge from cut, proportions, styling and category conventions, NOT from any person
in the frame. "unisex", "neutral", "both" and empty are NOT valid answers: when the
product genuinely reads either way, pick the gender it is MORE LIKELY to be sold to
in a fashion store, using the smallest cues available (fit, proportions, palette,
hardware, how the item is typically merchandised). You must always commit to woman
or man.

wearable: "yes" if this is a FASHION item a model can wear or carry on their body
in a photoshoot (garments, footwear, jewelry, bags, belts, hats, scarves, eyewear,
watches — watches count as clothing). "no" for everything else: perfume, cosmetics, skincare, candles, home
goods, electronics, food, packaging, furniture. When "no", still fill category
with the closest of the three (usually "clothing") — but wearable must be "no".

If unsure about category, use "clothing". If unsure about subtype, use "accessory"
for clothing, or the closest match for the others. Output JSON only.`;

const PATTERNS = ["solid", "striped", "floral", "plaid", "polka-dot", "animal", "graphic", "other"];
// 🚻 Ürünün hedef cinsiyeti. Sözlük uygulamadaki üretim sözlüğüyle aynı:
// woman | man.
// ⚠️ 25 Ağu 2026 (kullanıcı kararı): CEVAP ASLA "unisex"/NULL OLAMAZ. Sebep:
// istemci artık bu değeri yalnız kart görselini seçmek için değil, kullanıcı
// kendi seçimini yapmadıysa ÜRETİM cinsiyeti olarak da kullanıyor; null
// dönünce prompt sessizce varsayılan kadına düşüyordu. Model yine de karar
// veremezse aşağıdaki GENDER_FALLBACK devreye girer.
const GENDER_FALLBACK = "woman";
const GENDER_ALIASES = {
  woman: "woman",
  women: "woman",
  womens: "woman",
  female: "woman",
  ladies: "woman",
  man: "man",
  men: "man",
  mens: "man",
  male: "man",
};

/** Serbest metin cevabı güvenli değerlere indirger. */
function normalize(raw) {
  const text = String(raw || "").toLowerCase();
  let category = null;
  let subtype = null;
  // 📿 Bileklik biçimi (27 Ağu 2026): chain (esnek/zincirli) | bangle (sert).
  // Yalnız jewelry/bracelet'te dolar; Refiner sahneleme kart setini bu seçer.
  let form = null;
  let color = null;
  let pattern = null;
  let gender = null;
  // 🧴 Giyilebilirlik (26 Ağu 2026, kullanıcı isteği): parfüm/krem gibi
  // moda dışı ürünlerde tarz kartları GÖSTERİLMEZ. Varsayılan TRUE —
  // model alanı atlarsa davranış eskisi gibi kalır (fail-open).
  let wearable = true;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const obj = JSON.parse(match[0]);
      category = String(obj.category || "").trim();
      subtype = String(obj.subtype || "").trim();
      form = String(obj.form || "").trim().toLowerCase() || null;
      color = String(obj.color || "").trim() || null;
      pattern = String(obj.pattern || "").trim() || null;
      gender = String(obj.gender || "").trim().toLowerCase() || null;
      const w = String(obj.wearable || "").trim().toLowerCase();
      if (w === "no" || w === "false") wearable = false;
    }
  } catch {
    // JSON gelmediyse aşağıdaki kelime taraması devreye girer
  }
  if (!CATEGORIES.includes(category)) {
    category = CATEGORIES.find((c) => new RegExp(`\\b${c}\\b`).test(text)) || "clothing";
  }
  if (!SUBTYPES[category].includes(subtype)) {
    subtype = SUBTYPES[category].find((sv) => new RegExp(`\\b${sv}\\b`).test(text)) || null;
  }
  // Biçim yalnız bileklikte anlamlı; başka yerde dolduysa yok sayılır.
  if (!(category === "jewelry" && subtype === "bracelet")) form = null;
  else if (!["chain", "bangle"].includes(form)) {
    // Model alanı atladıysa serbest metinden kurtarmayı dene, yine olmazsa
    // istemci kendi varsayılanını (chain) uygular.
    form = /\b(bangle|cuff|rigid)\b/.test(text)
      ? "bangle"
      : /\b(chain|tennis|link|mesh|beaded|cord|braid)\b/.test(text)
        ? "chain"
        : null;
  }
  // Renk serbest kelime ama tek kelimeye ve makul uzunluğa indirgenir;
  // desen sözlük dışına çıkarsa null (aynı-ürün kıyası yanlış pozitif üretmesin).
  if (color) color = color.split(/\s+/)[0].slice(0, 20) || null;
  if (!PATTERNS.includes(pattern)) pattern = null;
  // ⚠️ "woman" içinde "man" geçiyor; kelime sınırı (\b) ikisini ayırıyor ama
  // yine de önce woman denenir ki serbest metin taramasında karışmasın.
  gender = GENDER_ALIASES[gender] || null;
  if (!gender) {
    if (/\b(woman|women|womens|female|ladies)\b/.test(text)) gender = "woman";
    else if (/\b(man|men|mens|male)\b/.test(text)) gender = "man";
  }
  // Son çare: model "unisex" dediyse ya da hiç cinsiyet yazmadıysa boş
  // dönmüyoruz — havuzun ve uygulamanın varsayılanı kadın.
  const genderFallbackUsed = !gender;
  if (!gender) gender = GENDER_FALLBACK;
  return { category, subtype, form, color, pattern, gender, genderFallbackUsed, wearable };
}

// ⚠️ Aynı anda kaç görsel yollanacağı sınırlı: her görsel token maliyeti ve
// gecikme demek, kombin zaten en fazla 6 parça tutuyor.
const MAX_IMAGES_PER_CALL = 6;

/** ⚠️ 26 Ağu 2026 (kullanıcı kararı): çağrı doğrudan OpenRouter'dan
 *  fal'ın `openrouter/router/vision` GEÇİDİNE alındı — model yine Luna, ama
 *  faturalama fal kredisinden (OpenRouter bakiyesi bitince sınıflandırma 402
 *  ile ölüyordu; banner üretimi de aynı sebeple taşınmıştı).
 *  Canlı doğrulandı: bu uçta Luna için `reasoning` ZORUNLU DEĞİL (Fable'da
 *  zorunlu) ve `image_urls` DATA URI kabul ediyor (879KB base64 test edildi) —
 *  istemci yerel dosyaları data URI olarak yolladığı için şart.
 *  Reasoning KAPALI tutuluyor: Luna'nın görünmez reasoning tokenı bütçeyi
 *  yiyip boş içerik döndürüyordu (13 Ağu bug'ı). */
/** 🐋 DeepSeek sınıflandırma — TEK deneme (kullanıcı kararı, 26 Ağu 2026):
 *  hata alınca LLM zorlanmaz, route fallback cevabına düşer. */
async function callDeepSeekClassify(images, context = null) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY tanımlı değil");
  const response = await axios.post(
    "https://api.deepseek.com/chat/completions",
    {
      model: DEEPSEEK_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: (CONTEXT_PREFIX[context] || "") + CLASSIFY_PROMPT,
            },
            ...images.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ],
        },
      ],
      temperature: 0,
      max_tokens: 400,
      // ⚠️ v4-flash varsayılanı reasoning — kapatılmazsa dar bütçede boş
      // content döner (22 Ağu dersi).
      thinking: { type: "disabled" },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    },
  );
  const output = (response.data?.choices?.[0]?.message?.content || "").trim();
  if (!output) throw new Error("DeepSeek boş içerik döndürdü");
  return output;
}

async function callLunaVision(images, maxRetries = 2, context = null) {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_API_KEY tanımlı değil");
  fal.config({ credentials });

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fal.subscribe("openrouter/router/vision", {
        input: {
          model: LUNA_MODEL,
          prompt: (CONTEXT_PREFIX[context] || "") + CLASSIFY_PROMPT,
          image_urls: images,
          temperature: 0,
          max_tokens: 400,
        },
        logs: false,
      });

      // fal hatayı 200 gövdesinde `error` alanıyla da döndürebiliyor
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(falError);

      const output = result?.data?.output || result?.output || "";
      if (typeof output === "string" && output.trim()) return output;
      throw new Error("fal/openrouter boş içerik döndürdü");
    } catch (err) {
      lastErr = err;
      // Sağlayıcının GERÇEK gerekçesi gövdede; yalnız status yazmak teşhisi
      // imkânsızlaştırıyordu (13 Ağu dersi).
      const detail =
        err?.body?.detail || err?.message || JSON.stringify(err).slice(0, 300);
      logger.warn(
        `🏷️ [PRODUCT_TYPE] fal/Luna attempt ${attempt}/${maxRetries} hata: ${detail}`,
      );
    }
  }
  throw lastErr || new Error("Luna çağrısı başarısız");
}

const router = express.Router();

router.post("/classify", async (req, res) => {
  try {
    const { imageUrl, imageBase64, images: imagesRaw, context } = req.body || {};
    // Tekil (eski istemciler) ve çoklu (kombin / farklı açılar) aynı uçtan.
    const images = (
      Array.isArray(imagesRaw) && imagesRaw.length
        ? imagesRaw
        : [imageUrl || imageBase64]
    )
      .filter((x) => typeof x === "string" && x.length > 0)
      .slice(0, MAX_IMAGES_PER_CALL);

    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        error: "imageUrl, imageBase64 veya images gerekli",
      });
    }
    const ctx = context === "outfit" || context === "angles" ? context : null;

    // Çok büyük data URI'ler sağlayıcıda 400/413'e yol açıyor; istemci zaten
    // küçültülmüş kare yolluyor ama gelen her şeyi kabul etmeyelim.
    // Toplam data URI boyutu sağlayıcıda 400/413'e yol açabiliyor.
    const totalBytes = images.reduce(
      (n, img) => n + (img.startsWith("data:") ? img.length : 0),
      0,
    );
    if (totalBytes > 8_000_000) {
      logger.warn("🏷️ [PRODUCT_TYPE] görsel çok büyük, sınıflandırma atlandı");
      return res.json({ success: true, productType: "clothing", productSubtype: null, productForm: null, color: null, pattern: null, productGender: GENDER_FALLBACK, wearable: true, fallback: true });
    }

    const started = Date.now();
    // ⚠️ TEK deneme (kullanıcı kararı, 26 Ağu 2026): hangi sağlayıcı olursa
    // olsun hata → yeniden deneme YOK, çapraz sağlayıcı YOK; catch'teki
    // fallback cevabı döner (clothing + woman), kartlar onunla görünür.
    const provider = await getProductTypeProvider();
    const raw =
      provider === "fal"
        ? await callLunaVision(images, 1, ctx)
        : await callDeepSeekClassify(images, ctx);
    const { category, subtype, form, color, pattern, gender, genderFallbackUsed, wearable } =
      normalize(raw);
    logger.log(
      `🏷️ [PRODUCT_TYPE] ${category}/${subtype || "-"}${form ? `/${form}` : ""} ${color || "-"}/${pattern || "-"} ` +
        `${gender}${genderFallbackUsed ? " (fallback)" : ""}${wearable ? "" : " GİYİLEMEZ"} ` +
        `(${images.length} görsel${ctx ? ", " + ctx : ""}, ${Date.now() - started}ms, ${provider === "fal" ? "fal/luna" : "deepseek"})`,
    );
    return res.json({
      success: true,
      productType: category,
      productSubtype: subtype,
      // 📿 Yalnız bileklikte dolu: "chain" | "bangle" (diğerlerinde null)
      productForm: form,
      color,
      pattern,
      productGender: gender,
      // false → istemci tarz kartlarını gizler (moda dışı ürün)
      wearable,
    });
  } catch (err) {
    // Sınıflandırma üretimi ENGELLEMEZ — hata da olsa güvenli varsayılan döner.
    logger.error("❌ [PRODUCT_TYPE] hata:", err?.message);
    return res.json({
      success: true,
      productType: "clothing",
      productSubtype: null,
      productForm: null,
      color: null,
      pattern: null,
      productGender: GENDER_FALLBACK,
      wearable: true,
      fallback: true,
    });
  }
});

module.exports = router;
