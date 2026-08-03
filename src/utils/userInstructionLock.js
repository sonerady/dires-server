const cleanText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const hasValue = (value, ignored = []) => {
  const text = cleanText(value);
  if (!text) return false;
  return !ignored.includes(text.toLowerCase());
};

const framingDescriptions = {
  full_body: "a complete head-to-toe full-body frame, including both feet",
  knee_shot: "a three-quarter frame from the knees upward",
  medium_shot: "a waist-up medium frame",
  chest_up: "a chest-up portrait frame",
  close_up: "a tight face-and-upper-chest close-up",
};

const focusDescriptions = {
  full_body: "the complete body and full garment silhouette",
  upper_body: "the upper body and upper-garment construction",
  lower_body: "the lower body and lower-garment construction",
  product: "the garment/product and its defining details",
  face: "the face while keeping the requested garment details readable",
};

const formatMeasurements = (measurements) => {
  if (!measurements || typeof measurements !== "object") return "";
  return [
    measurements.bust ? `bust ${cleanText(measurements.bust)} cm` : null,
    measurements.waist ? `waist ${cleanText(measurements.waist)} cm` : null,
    measurements.hips ? `hips ${cleanText(measurements.hips)} cm` : null,
    measurements.height ? `height ${cleanText(measurements.height)} cm` : null,
    measurements.weight ? `weight ${cleanText(measurements.weight)} kg` : null,
  ]
    .filter(Boolean)
    .join(", ");
};

/**
 * Gemini'nin yorumladığı brief'ten bağımsız, son image modeline gönderilecek
 * kompakt kullanıcı gereksinimleri. Yalnız görsel sonucu etkileyen ayarlar
 * alınır; qualityVersion/locationId gibi teknik UI alanları prompt'a girmez.
 */
function buildUserInstructionLock({
  settings = {},
  customDetail = null,
  hasLocationReference = false,
  hasPoseReference = false,
  hasHairReference = false,
} = {}) {
  const lines = [];
  const detail = cleanText(customDetail);

  if (detail) {
    lines.push(
      `ADD DETAIL — HIGHEST USER PRIORITY: "${detail}". Interpret the quoted request literally even when it is written in another language. Positive additions or changes must be unmistakably visible rather than subtly implied; anything explicitly excluded must be absent. If it intentionally asks to add or modify a garment detail, accessory, prop, styling element, background feature, pose, or visual treatment, that explicitly requested change is an allowed exception to general product-preservation rules; preserve every other unmentioned product detail exactly.`,
    );
  }

  const location = hasValue(settings.locationEnhancedPrompt)
    ? settings.locationEnhancedPrompt
    : settings.location;
  if (hasValue(location, ["auto"])) {
    lines.push(`LOCATION / ENVIRONMENT: ${cleanText(location)}.`);
  }
  if (hasLocationReference) {
    lines.push(
      "LOCATION REFERENCE: Reproduce the attached location reference faithfully as the actual environment of the photograph.",
    );
  }
  if (hasValue(settings.backgroundColorHex)) {
    lines.push(
      `BACKGROUND COLOR: Use ${cleanText(settings.backgroundColorHex)} as the intended background color, rendered with natural photographic lighting.`,
    );
  }
  if (hasValue(settings.weather, ["auto"])) {
    lines.push(`WEATHER: ${cleanText(settings.weather)}.`);
  }
  if (hasValue(settings.timeOfDay, ["auto"])) {
    lines.push(`TIME OF DAY: ${cleanText(settings.timeOfDay)}.`);
  }
  if (hasValue(settings.mood, ["auto"])) {
    lines.push(`MOOD / ATMOSPHERE: ${cleanText(settings.mood)}.`);
  }
  if (hasValue(settings.productColor, ["auto", "original"])) {
    lines.push(
      `PRODUCT COLOR: The garment's base color is ${cleanText(settings.productColor)}; keep prints, stitching, trims, hardware, texture, and natural highlight/shadow variation faithful.`,
    );
  }
  if (hasValue(settings.accessories, ["auto", "none"])) {
    lines.push(
      `ACCESSORIES: Include all of these requested accessories clearly and recognizably: ${cleanText(settings.accessories)}. Place them naturally without hiding the garment's important details.`,
    );
  }
  if (hasValue(settings.pose, ["auto"])) {
    lines.push(`POSE: ${cleanText(settings.pose)}. Match it clearly in the body position and gesture.`);
  }
  if (hasPoseReference) {
    lines.push(
      "POSE REFERENCE: Match the attached pose reference's body position, stance, and gesture while preserving the selected model identity and garment.",
    );
  }
  if (hasValue(settings.perspective, ["auto"])) {
    lines.push(`CAMERA PERSPECTIVE: ${cleanText(settings.perspective)}.`);
  }
  if (hasValue(settings.framing, ["auto"])) {
    const framingKey = cleanText(settings.framing);
    lines.push(
      `FRAMING: Compose the image as ${framingDescriptions[framingKey] || framingKey}; the crop must visibly match this selection.`,
    );
  }
  if (hasValue(settings.focusArea, ["auto"])) {
    const focusKey = cleanText(settings.focusArea);
    lines.push(
      `FOCUS AREA: Prioritize ${focusDescriptions[focusKey] || focusKey} in composition and sharp detail.`,
    );
  }
  if (hasValue(settings.skinTone, ["auto"])) {
    lines.push(`SKIN TONE: ${cleanText(settings.skinTone)}, rendered with natural skin texture.`);
  }
  if (hasValue(settings.hairStyle, ["auto"])) {
    lines.push(`HAIR STYLE: ${cleanText(settings.hairStyle)}.`);
  }
  if (hasHairReference) {
    lines.push(
      "HAIR REFERENCE: Reproduce the attached hairstyle reference faithfully in cut, length, texture, volume, parting, and finish.",
    );
  }
  if (hasValue(settings.hairColor, ["auto"])) {
    lines.push(`HAIR COLOR: ${cleanText(settings.hairColor)}.`);
  }
  if (settings.hijabMode === true) {
    lines.push(
      "MODEST HIJAB: Add a naturally worn, elegant hijab that fully covers the hair, ears, and neck with realistic fabric folds and shadows; keep the garment itself unchanged unless ADD DETAIL explicitly requests otherwise.",
    );
  }
  if (hasValue(settings.bodyShape, ["auto"])) {
    lines.push(
      `BODY SHAPE / SIZE: ${cleanText(settings.bodyShape)}; the silhouette, proportions, garment fit, and drape must visibly reflect this selection.`,
    );
  }
  const measurements = formatMeasurements(settings.measurements);
  if (measurements) {
    lines.push(
      `BODY MEASUREMENTS: ${measurements}; reflect these proportions realistically in silhouette, fit, and drape.`,
    );
  }
  if (hasValue(settings.age, ["auto"])) {
    lines.push(`MODEL AGE: ${cleanText(settings.age)}.`);
  }
  if (hasValue(settings.gender, ["auto"])) {
    lines.push(`MODEL GENDER PRESENTATION: ${cleanText(settings.gender)}.`);
  }
  if (hasValue(settings.ethnicity, ["auto"])) {
    lines.push(
      `MODEL ETHNICITY / HERITAGE: ${cleanText(settings.ethnicity)}. Interpret or translate this label semantically when necessary and reflect the selected heritage naturally and respectfully in the model's visible appearance.`,
    );
  }

  if (lines.length === 0) return "";

  return `USER-LOCKED REQUIREMENTS — FINAL COMPLIANCE PASS:
The final image must visibly satisfy every applicable item below. These explicit user choices override automatic, random, or generic creative suggestions. ADD DETAIL has priority if two user inputs conflict. Product references remain the source of truth except only for additions or modifications explicitly requested below; preserve everything else.
${lines.map((line) => `- ${line}`).join("\n")}
Before rendering, verify every line against the visible image. Do not omit, weaken, silently reinterpret, or merely mention a requirement without showing it.`;
}

function appendUserInstructionLock(prompt, lock) {
  const body = typeof prompt === "string" ? prompt.trim() : "";
  const suffix = typeof lock === "string" ? lock.trim() : "";
  if (!suffix) return body;
  if (!body) return suffix;
  return `${body}\n\n${suffix}`;
}

module.exports = {
  appendUserInstructionLock,
  buildUserInstructionLock,
};
