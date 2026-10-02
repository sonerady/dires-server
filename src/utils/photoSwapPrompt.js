// 🔁 Model / Mekân Değiştir (23 Eyl 2026, kullanıcı isteği)
//
// Kullanıcının daha önce oluşturduğu (ya da yüklediği) mankenli bir kareyi
// CreateModelPhotoScreen'in API'si (/api/referenceBrowserV7/generate) üzerinden
// yeniden işler:
//   • model    → aynı kıyafet/poz/mekân/ışık, farklı manken (seçilen model
//                fotoğrafının kimliği ya da cinsiyet/yaşa göre yeni bir yüz)
//   • location → aynı manken/kıyafet/poz, yeni mekân (katalog mekânı, metin,
//                düz renk zemin)
// Görsel sırası sözleşmedir: 1 = kaynak kare, 2 = model referansı YA DA
// "Location" şeritli mekân referansı. İstem metni istemciye gitmez.

const PHOTO_SWAP_MODES = ["model", "location"];

function normalizePhotoSwapMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return PHOTO_SWAP_MODES.includes(mode) ? mode : null;
}

// nano-banana-2/edit'in kabul ettiği oranlar; kaynak karenin kadrajı korunur
const NB2_RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];
function nearestSupportedRatio(width, height) {
  if (!(width > 0 && height > 0)) return "3:4";
  const target = Math.log(width / height);
  let best = "3:4";
  let bestDiff = Infinity;
  for (const ratio of NB2_RATIOS) {
    const [w, h] = ratio.split(":").map(Number);
    const diff = Math.abs(Math.log(w / h) - target);
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best;
}

const clean = (value, max = 600) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const GENDER_WORDS = { woman: "woman", female: "woman", man: "man", male: "man", girl: "girl", boy: "boy" };

function describeNewModel(settings = {}) {
  const gender = GENDER_WORDS[String(settings.gender || "").toLowerCase()] || null;
  const age = clean(String(settings.age || ""), 40);
  const ageText = /years old/.test(age)
    ? age
    : { newborn: "a newborn", baby: "about 1-2 years old", child: "about 5-8 years old", young: "in their early twenties", adult: "in their forties" }[age] || null;
  const parts = [];
  if (gender) parts.push(`a ${gender}`);
  if (ageText) parts.push(ageText.startsWith("a ") || ageText.startsWith("about") || ageText.startsWith("in ") ? ageText : `${ageText}`);
  if (settings.ethnicity) parts.push(`${clean(settings.ethnicity, 60)} appearance`);
  if (settings.skinTone) parts.push(`${clean(settings.skinTone, 60)} skin tone`);
  if (settings.hairStyle) parts.push(`hair: ${clean(settings.hairStyle, 80)}`);
  if (settings.hairColor) parts.push(`hair colour: ${clean(settings.hairColor, 40)}`);
  return parts.join(", ");
}

const PRODUCT_LOCK = `PRODUCT LOCK (highest priority): every garment, shoe, bag and piece of jewelry worn in IMAGE 1 is the client's real product. Reproduce each one exactly — same design, cut, silhouette, length, colour, print/pattern placement, fabric texture and sheen, stitching, buttons, zips, labels and logos. Never redesign, recolour, simplify, add or remove any product detail.`;

const QUALITY = `Output a single photorealistic, high-end fashion e-commerce photograph: natural skin texture with visible pores, true-to-life fabric, crisp focus on the product, clean professional colour. No text, watermark, border, collage or split screen.`;

function userDetailBlock(customDetail) {
  const detail = clean(customDetail, Infinity);
  if (!detail) return "";
  return `\n\nUSER DETAIL (apply when it does not conflict with the PRODUCT LOCK): ${detail}`;
}

function buildModelSwapPrompt({ hasModelReference, settings = {}, customDetail }) {
  const identity = hasModelReference
    ? `IMAGE 2 is the MODEL REFERENCE. Replace the person in IMAGE 1 with the model from IMAGE 2: match that model's face and facial features, skin tone, hair colour, length and style, and body proportions so the result is unmistakably the same person as IMAGE 2. Use IMAGE 2 ONLY for identity — never copy its clothing, accessories, pose, background or lighting.`
    : `Replace the person in IMAGE 1 with a clearly DIFFERENT model${describeNewModel(settings) ? ` — ${describeNewModel(settings)}` : ""}.${settings.gender ? "" : " Keep the same gender and a similar age range as the original person."} Give them a new, natural, attractive face and a hairstyle that suits the outfit; they must not resemble the original person.`;
  return [
    `TASK: MODEL SWAP. IMAGE 1 is an existing fashion photo that must be recreated with a different model.`,
    identity,
    PRODUCT_LOCK,
    `KEEP IDENTICAL TO IMAGE 1: the pose and body position, hand placement, head angle, camera angle, lens feel, framing and crop, the location/background, the lighting direction, light quality and colour grade. The garments drape and fit the new model's body naturally with the same styling (tucked, rolled, open or closed exactly as in IMAGE 1).`,
    `The result must look like another frame from the same photoshoot — only the person changes.`,
    QUALITY,
  ].join("\n\n") + userDetailBlock(customDetail);
}

function describeLighting(settings = {}) {
  const parts = [];
  if (settings.weather) parts.push(`weather: ${clean(String(settings.weather?.prompt || settings.weather?.title || settings.weather), 80)}`);
  if (settings.timeOfDay) parts.push(`time of day: ${clean(String(settings.timeOfDay?.prompt || settings.timeOfDay?.title || settings.timeOfDay), 80)}`);
  return parts.length ? `\n\nATMOSPHERE: ${parts.join("; ")}. Light the whole scene, including the model, accordingly.` : "";
}

function buildLocationSwapPrompt({ hasLocationReference, settings = {}, customDetail }) {
  const hex = /^#?[0-9a-f]{6}$/i.test(String(settings.backgroundColorHex || "")) ? `#${String(settings.backgroundColorHex).replace("#", "").toUpperCase()}` : null;
  const title = clean(settings.location, 160);
  const description = clean(settings.locationEnhancedPrompt, 700);
  let destination;
  if (hex) {
    destination = `NEW SETTING: a seamless professional studio backdrop in the solid colour ${hex}${title ? ` (${title})` : ""}, evenly lit with soft studio light and a gentle natural floor shadow.`;
  } else if (hasLocationReference) {
    destination = `IMAGE 2 (the image with the bottom strip labelled "Location") shows the NEW LOCATION${title ? ` — ${title}` : ""}. Rebuild that same real venue around the model: keep its recognizable architecture, materials, colours and distinctive features, seen from a viewpoint that matches the camera of IMAGE 1. Do not copy any people, mannequins or products from IMAGE 2, and never reproduce the "Location" strip, label or border.${description ? ` Venue notes: ${description}` : ""}`;
  } else {
    destination = `NEW LOCATION: ${title || description || "a beautiful, believable location that suits the outfit"}.${description && title ? ` Venue notes: ${description}` : ""}`;
  }
  return [
    `TASK: LOCATION SWAP. IMAGE 1 is an existing fashion photo. Move the exact same shot to a new location.`,
    destination,
    PRODUCT_LOCK,
    `KEEP IDENTICAL TO IMAGE 1: the same person (face, identity, hair, makeup, body), the same pose, expression, hand placement and head angle, and a similar camera angle, framing and crop of the model. Remove every trace of the original background.`,
    `INTEGRATION: the model must truly stand in the new place — re-light them to match the new environment's light direction, colour temperature and ambient bounce, with correct contact shadows, reflections, perspective, scale and natural depth of field. No cut-out or pasted look.`,
    QUALITY,
  ].join("\n\n") + describeLighting(settings) + userDetailBlock(customDetail);
}

function buildPhotoSwapPrompt(mode, options = {}) {
  if (mode === "model") return buildModelSwapPrompt(options);
  if (mode === "location") return buildLocationSwapPrompt(options);
  throw new Error(`unknown photo swap mode: ${mode}`);
}

/** Konum modunda istekte gerçekten bir mekân var mı? (metin, katalog görseli ya da renk) */
function hasLocationTarget(settings = {}, locationImage) {
  return Boolean(
    (typeof locationImage === "string" && locationImage) ||
      clean(settings.location) ||
      clean(settings.locationEnhancedPrompt) ||
      /^#?[0-9a-f]{6}$/i.test(String(settings.backgroundColorHex || "")),
  );
}

module.exports = {
  PHOTO_SWAP_MODES,
  normalizePhotoSwapMode,
  nearestSupportedRatio,
  buildPhotoSwapPrompt,
  hasLocationTarget,
  describeNewModel,
};
