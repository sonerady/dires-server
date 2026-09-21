// 🍳 Yemek fotoğrafı üretimi — fal'da GPT Image 2.5 Sunburst (text-to-image).
//
// Fotoğrafı olmayan ve internette uygun görsel bulunamayan yemekler için
// (ya da operatör doğrudan istediğinde) menüye uygun, gerçekçi bir yemek
// fotoğrafı üretir. Kalite "medium" (kullanıcı kararı, 18 Eyl 2026) —
// kit hattındaki GPT Image 2.5 ile aynı aile, ancak düzenleme değil üretim ucu.
const { fal } = require("@fal-ai/client");

const T2I_MODEL = "openai/gpt-image-2.5/sunburst/text-to-image";
const EDIT_MODEL = "openai/gpt-image-2.5/sunburst/edit";
const DEFAULT_QUALITY = "medium";

function configureFal() {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_API_KEY tanımlı değil");
  fal.config({ credentials });
}

/**
 * Menüde kullanılacak yemek fotoğrafı istemi.
 * Tabak/servis dilini yemeğin kendisine bırakır; yalnız fotoğrafın menüde
 * çalışması için gereken teknik çerçeveyi verir (temiz arka plan, doğal ışık,
 * yazı/logo yok) — böylece farklı yemeklerin kareleri bir arada tutarlı durur.
 */
function buildDishPrompt({ name, description, cuisine, style }) {
  const parts = [
    `A professional food photograph of "${name}"`,
    cuisine ? `, a dish from ${cuisine}` : "",
    description ? `. The dish is: ${description}` : "",
    ". Freshly prepared and plated the way this dish is traditionally served, shot for a restaurant menu.",
    " Natural directional light, shallow depth of field, appetising colour, crisp texture on the food surface, clean uncluttered surroundings, no text, no logo, no watermark, no hands, no people.",
  ];
  if (style) parts.push(` Overall look: ${style}.`);
  return parts.join("");
}

/**
 * Tek yemek için fotoğraf üret.
 * @returns {Promise<string>} fal'ın döndürdüğü geçici görsel URL'i
 *   (çağıran taraf bunu kendi depomuza almalı — fal URL'leri kalıcı değildir)
 */
async function generateDishImage({ name, description, cuisine, style, cutout = false, quality, imageSize = "square_hd", maxRetries = 2 }) {
  if (!name) throw new Error("Yemek adı gerekli");
  configureFal();

  const input = {
    prompt: [
      buildDishPrompt({ name, description, cuisine, style }),
      // Kesme görsel: arka planı sonradan silmeye gerek yok, model doğrudan
      // saydam üretiyor (background: "transparent" + PNG).
      cutout
        ? " The plate or bowl is isolated on a fully transparent background with clean edges — no table, no surface, no backdrop, no shadow baked into the image."
        : "",
    ].join(""),
    quality: quality || DEFAULT_QUALITY,
    image_size: imageSize,
    num_images: 1,
    output_format: cutout ? "png" : "jpeg",
    ...(cutout ? { background: "transparent" } : {}),
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🍳 [DISH_IMAGE] ${name} — GPT Image 2.5 (${input.quality}) deneme ${attempt}/${maxRetries}`);
      const result = await fal.subscribe(T2I_MODEL, { input, logs: false });
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(typeof falError === "string" ? falError : JSON.stringify(falError));
      const url = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
      if (url) return url;
      throw new Error("fal görsel döndürmedi");
    } catch (err) {
      lastErr = err;
      const detail = err?.body?.detail || err?.message || String(err).slice(0, 200);
      console.warn(`⚠️ [DISH_IMAGE] ${name} deneme ${attempt} hata: ${detail}`);
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr || new Error("Yemek görseli üretilemedi");
}

/**
 * Menünün TASARIM öğesi üret (arka plan, doku, süsleme, ayraç, kapak görseli).
 * Yemek fotoğrafından farkı: saydam arka plan desteği, PNG çıkışı ve
 * "kesinlikle yazı/harf/logo yok" vurgusu — bu görsellerin üstüne asıl metni
 * tasarım adımı HTML olarak koyuyor.
 *
 * @param {object} p
 * @param {string} p.prompt        Astra'nın yazdığı öğe tarifi
 * @param {boolean} [p.transparent] Saydam zemin (süsleme/ayraç için)
 * @param {string} [p.aspect]      "portrait" | "landscape" | "square"
 */
async function generateDesignAsset({ prompt, transparent = false, aspect = "portrait", quality, maxRetries = 2 }) {
  if (!prompt) throw new Error("Öğe tarifi gerekli");
  configureFal();

  const imageSize =
    aspect === "landscape" ? "landscape_16_9" : aspect === "square" ? "square_hd" : "portrait_16_9";

  const input = {
    prompt: [
      prompt,
      transparent
        ? " Isolated graphic element on a fully transparent background, clean edges, nothing else in the frame."
        : " Fills the whole frame edge to edge, even lighting, no vignette, no border.",
      " Absolutely no text, no letters, no numbers, no logos, no watermarks, no signatures, no UI elements, no people.",
    ].join(""),
    quality: quality || DEFAULT_QUALITY,
    image_size: imageSize,
    num_images: 1,
    output_format: transparent ? "png" : "jpeg",
    ...(transparent ? { background: "transparent" } : {}),
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🎨 [MENU_ASSET] ${aspect}${transparent ? "/saydam" : ""} deneme ${attempt}/${maxRetries}`);
      const result = await fal.subscribe(T2I_MODEL, { input, logs: false });
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(typeof falError === "string" ? falError : JSON.stringify(falError));
      const url = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
      if (url) return url;
      throw new Error("fal görsel döndürmedi");
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ [MENU_ASSET] deneme ${attempt} hata: ${err?.body?.detail || err.message}`);
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr || new Error("Tasarım öğesi üretilemedi");
}

/**
 * Var olan bir yemek fotoğrafını referans menünün FOTOĞRAF STİLİNE getir.
 * Sıfırdan üretmek yerine düzenleme ucu kullanılır (GPT Image 2.5 edit) —
 * böylece tabaktaki gerçek yemek korunur, yalnız ışık/zemin/kadraj/renk değişir.
 * Bu, restoranın kendi yüklediği fotoğraflar için kritik: yemek uydurulmamalı.
 *
 * @param {object} p
 * @param {string} p.imageUrl  mevcut fotoğraf (herkese açık URL)
 * @param {string} p.name      yemek adı (bağlam)
 * @param {string} p.style     analyzePhotoStyle çıktısı
 */
async function restyleDishImage({ imageUrl, name, style, cutout = false, quality, maxRetries = 2 }) {
  if (!imageUrl) throw new Error("Fotoğraf gerekli");
  if (!style) throw new Error("Fotoğraf stili tanımlı değil");
  configureFal();

  const prompt = [
    `Rephotograph this dish${name ? ` ("${name}")` : ""} in a different photographic style, keeping the food itself exactly as it is.`,
    " PRESERVE with total fidelity: the dish's identity, its ingredients, their colours, shapes, quantities and arrangement on the plate. Do not add, remove or substitute any food element.",
    ` RESTYLE to match this treatment: ${style}`,
    cutout
      ? " Cut the plate or bowl out completely: remove the table, surface and every trace of background so the dish sits on a fully transparent background with clean edges and no baked-in shadow. Keep the whole plate inside the frame with a little breathing room."
      : " Change only the camera angle, surface, background, lighting, colour grade, depth of field, crop and props as that treatment requires.",
    " No text, no letters, no logos, no watermarks, no hands, no people.",
  ].join("");

  // ⚠️ kitImageRoute.callGpt25KitEdit kullanılmıyor: buildEditInput alanları
  // beyaz listeye alıyor ve `background` parametresini düşürüyor — kesme
  // görseller için saydamlık şart, bu yüzden çağrı burada kuruluyor.
  const input = {
    prompt,
    image_urls: [imageUrl],
    image_size: "square_hd",
    quality: quality || DEFAULT_QUALITY,
    num_images: 1,
    output_format: cutout ? "png" : "jpeg",
    ...(cutout ? { background: "transparent" } : {}),
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📷 [MENU_RESTYLE] ${name || "yemek"}${cutout ? " (kesme/saydam)" : ""} deneme ${attempt}/${maxRetries}`);
      const result = await fal.subscribe(EDIT_MODEL, { input, logs: false });
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(typeof falError === "string" ? falError : JSON.stringify(falError));
      const url = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
      if (url) return url;
      throw new Error("fal görsel döndürmedi");
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ [MENU_RESTYLE] deneme ${attempt} hata: ${err?.body?.detail || err.message}`);
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr || new Error("Fotoğraf stile uyarlanamadı");
}

module.exports = { T2I_MODEL, EDIT_MODEL, DEFAULT_QUALITY, buildDishPrompt, generateDishImage, generateDesignAsset, restyleDishImage };
