// 🛍️ Genel e-ticaret ürün videosu yönetmeni (22 Eyl 2026).
// /api/generateImgToVidv2 artık yalnız moda değil: client "brief" gönderir
// (tür · sahne · kamera · insan). Brief YOKSA (eski uygulama sürümleri) route
// eski moda şablonunu kullanmaya devam eder — geriye dönük uyumluluk.
//
// İki üretim modu:
//  • scene === "keep"  → image-to-video: yüklenen fotoğraf videonun İLK KARESİ,
//                        sahne korunur (zaten iyi çekilmiş fotoğraflar için).
//  • diğer sahneler    → reference-to-video: fotoğraf yalnız ÜRÜN REFERANSI
//                        (@Image1), sahne yeniden kurulur (amatör fotoğraflar
//                        için — anasayfa örnekleri bu modla üretildi).

const STYLES = {
  // 🎲 Varsayılan ("Yapay Zekaya Bırak"): konsepti yönetmen seçer
  auto: "Choose the single most effective product-video concept for THIS product and its buyers — e.g. a premium hero showcase, the product in real use, an unboxing, macro material details, a fast social ad or a clean 360° spin — and commit to it fully.",
  showcase: "Hero product showcase: premium commercial lighting, a slow elegant reveal, the product is the undisputed hero of every frame.",
  in_use: "Product in use: a real person naturally uses the product in an authentic everyday moment, showing how it fits into life and what it feels like to use.",
  unboxing: "Unboxing: hands open clean packaging and reveal the product for the first time, a satisfying first-look moment, then a hero shot of the product.",
  macro: "Macro details: extreme close-ups of texture, material, finish and craftsmanship, shallow depth of field, light gliding across surfaces.",
  ad_hook: "Scroll-stopping social ad: a bold, surprising first second, fast rhythmic cuts, dynamic energy, ends on a strong hero frame of the product.",
  turntable: "360° turntable: the product rotates smoothly on a clean seamless backdrop, evenly lit, every side clearly visible, marketplace-listing ready.",
  on_model: "On a model: a professional model wears or holds the product (fashion, jewelry, bags, accessories), confident editorial movement that shows fit and detail.",
};

const SCENES = {
  keep: null, // image-to-video: fotoğrafın kendi sahnesi
  auto: "Choose the most fitting, attractive real-world setting for this specific product and its target customer.",
  studio: "A clean professional studio: seamless backdrop in a tone that complements the product, soft controlled key light.",
  home: "A bright, stylish, lived-in home interior with natural window daylight.",
  outdoor: "A lively, bright outdoor urban setting in soft natural daylight.",
  luxury: "A dark, moody luxury set: deep shadows, glossy reflective surfaces, warm dramatic accent light.",
  nature: "A fresh natural environment: greenery, stone, water or sand, soft daylight.",
};

const CAMERAS = {
  auto: null,
  push_in: "Camera: a slow, confident push-in toward the product.",
  orbit: "Camera: a smooth orbit around the product revealing all sides.",
  handheld: "Camera: natural handheld UGC feel, like filmed on a phone by a real customer.",
  static: "Camera: locked-off static framing; only the subject and light move.",
  cuts: "Camera: 3 to 4 dynamic cinematic cuts — wide, medium, close-up and macro.",
};

const PEOPLE = {
  auto: null,
  none: "PRODUCT ONLY: no people, no faces, no bodies; at most a single hand may interact with the product if the action needs it.",
  person: "Include a real person naturally interacting with the product.",
};

function sanitizeBrief(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pick = (map, v, def) => (Object.prototype.hasOwnProperty.call(map, v) ? v : def);
  return {
    style: pick(STYLES, raw.style, "auto"),
    scene: pick(SCENES, raw.scene, "auto"),
    camera: pick(CAMERAS, raw.camera, "auto"),
    people: pick(PEOPLE, raw.people, "auto"),
  };
}

// reference-to-video: fotoğraf yalnız ürün referansı
function isReferenceMode(brief) {
  return !!brief && brief.scene !== "keep";
}

function briefLines(brief) {
  return [
    STYLES[brief.style],
    SCENES[brief.scene],
    CAMERAS[brief.camera],
    PEOPLE[brief.people],
  ].filter(Boolean);
}

// Video türüne göre sabit kalite kilidi (video stüdyosu kart örneklerinin stil blokları)
const STYLE_SUFFIX = {
  auto: "Premium commercial look, crisp natural light, smooth camera, the product sharp and clearly visible, ends on a clean hero shot.",
  showcase: "Premium commercial lighting, slow elegant camera, the product is the undisputed hero, ends on a clean hero shot.",
  in_use: "Authentic, bright everyday moment, natural light, real hands and real use, the product clearly visible.",
  unboxing: "Satisfying first-look reveal, clean packaging, soft daylight, ends on a hero shot of the product.",
  macro: "Extreme macro, shallow depth of field, slow smooth camera slides and rack focus, light gliding across the material; tactile, high-end.",
  ad_hook: "Energetic, beat-synced cuts, bold first second, crisp daylight, ends on a strong hero frame.",
  turntable: "Exactly one smooth full rotation, locked-off centered camera, soft even studio light, every side clearly visible, no cuts.",
  on_model: "Editorial fashion film look, confident natural movement, soft daylight, the product's fit and details clearly visible.",
};

// Seedance'e giden promptun sonuna HER ZAMAN eklenen sabit kurallar
function identityClause(brief, hasSecondImage) {
  return `${STYLE_SUFFIX[brief?.style] || STYLE_SUFFIX.auto} ${identityRules(brief, hasSecondImage)}`;
}
function identityRules(brief, hasSecondImage) {
  if (isReferenceMode(brief)) {
    return (
      "The product is the exact item shown in @Image1" +
      (hasSecondImage ? " (@Image2 shows another angle of the same product)" : "") +
      " — keep its shape, color, material, logo, label and proportions identical in every shot. Ignore the background of the reference photo; it is only a product reference. No on-screen text, no subtitles, no added logos or brand names."
    );
  }
  return "Keep the product exactly as it appears in the first frame — same shape, color, material, logo and label. Preserve the scene and lighting of the image. No on-screen text, no subtitles, no added logos.";
}

function buildCommerceGeminiPrompt(brief, userPrompt, hasSecondImage) {
  const ref = isReferenceMode(brief);
  const hint = (userPrompt || "").trim();
  return `
You are a senior e-commerce video DIRECTOR writing the prompt for an AI video model. READ the product image carefully: what the product is, its category, material, color, size and who buys it. Then design a short, high-converting product video for online stores and social ads.

PRODUCTION MODE: ${ref
    ? "REFERENCE — the image is ONLY a product reference (often an amateur phone photo). Build a brand-new professional scene around the exact same product; never reproduce the messy original background. Refer to the product as @Image1" + (hasSecondImage ? " and to its second angle as @Image2" : "") + "."
    : "FIRST FRAME — the image is the first frame of the video. Keep its scene, background and lighting; bring it to life with motion that fits."}

CREATIVE BRIEF (follow it; it overrides your defaults):
- ${briefLines(brief).join("\n- ")}

User notes: "${hint}" (may be empty or in any language — translate the intent, keep it).

OUTPUT FORMAT (23 Eyl 2026 — the numbered shot-list shape gave the best results):
"<one-line concept for the product>, <pace>: 1) <shot> 2) <shot> 3) <shot> 4) <shot> <mood words>."
Each shot = ONE concrete, filmable action + setting + light + camera move, specific to THIS product (its material, color and how it is used). Make it commercial, desirable and concrete — something a brand would actually run as an ad.

HARD RULES:
- Output ONLY the prompt text, under 1600 characters.
- The product must stay identical: same shape, color, material, logo, label and proportions. Never invent features, text, prices or claims.
- No on-screen text, captions, watermarks or third-party brand names.
- Realistic physics and scale; the product is always clearly visible and in focus in the hero moments.
- Default to bright natural daylight or clean studio light; NO golden-hour, sunset or sunrise glow unless the brief or image clearly calls for it.
`;
}

function buildCommerceFallbackPrompt(brief, userPrompt) {
  const hint = (userPrompt || "").trim();
  return [
    "Premium e-commerce product video.",
    ...briefLines(brief),
    hint ? `Creative notes: ${hint.substring(0, 300)}.` : "",
    "Photorealistic, commercial lighting that flatters the product's material, smooth camera, the product clearly visible and in focus in every hero moment.",
  ].filter(Boolean).join(" ");
}

module.exports = {
  sanitizeBrief,
  isReferenceMode,
  identityClause,
  buildCommerceGeminiPrompt,
  buildCommerceFallbackPrompt,
};
