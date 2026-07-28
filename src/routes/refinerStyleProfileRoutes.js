// ───────────────────────────────────────────────────────────────────────────
// 🔧 Refiner Çekim Tarzları — ÜRÜN/KATALOG çekimi stil presetleri
//
// RefinerScreen "amatör ürün fotoğrafı → premium e-ticaret karesi" dönüşümü
// yapar: hayalet manken, düz zemin rengi, gölge/yansıma anahtarları, keskin
// odak, ürün kimliğinin birebir korunması. Dolayısıyla buradaki çekim tarzı,
// CreateModelPhoto tarafındaki moda/model estetiğinden FARKLI bir şey tarifler:
// zemin karakteri, ışık kurulumu, gölge/yansıma dili, ürün açısı ve kadraj,
// renk grade'i, yüzey/prop minimalizmi. Model, poz, mekân YOKTUR.
//
// Tablo: refiner_style_profiles (bkz. refiner_style_profiles_migration.sql)
// Uç:    /api/refiner-style-profiles
// ───────────────────────────────────────────────────────────────────────────
const { createStyleProfileRouter } = require("./styleProfileRouterFactory");

const REFINER_STYLE_ANALYSIS_PROMPT = `You are a senior e-commerce product photography director. The attached images are EXAMPLES of a catalog look the user wants their own product photos to have — references, not products to copy. Analyze ALL of them together and write a compact, TECHNICALLY PRECISE PRODUCT-SHOT STYLE PROFILE so an AI image model can reproduce this exact look on a COMPLETELY DIFFERENT product.

Describe, in concrete studio language with estimates:
1. BACKDROP & SURFACE — is it a flat seamless colour, a subtle gradient, a textured sweep, a surface the product sits on? Name the tone precisely (e.g. "pure white", "warm off-white #F5F1EA", "cool light grey"), state whether it is perfectly uniform or falls off toward the edges, and whether the product sits on a visible surface or floats.
2. LIGHT SETUP — key direction and size (large frontal softbox / 45° soft key / broad top light), fill level, how soft the shadow edges are, whether there is a rim/edge light separating the product from the backdrop, and how even the exposure is across the frame.
3. SHADOW & REFLECTION LANGUAGE — this is the single most recognisable trait of a catalog look. Say exactly what sits under the product: no shadow at all, a soft contact shadow, a long directional shadow, a mirror reflection, or a soft gradient reflection. Describe its softness, opacity and direction.
4. COLOR GRADE / PRESET RECIPE — if a filter or preset is clearly applied, IDENTIFY IT BY NAME using the real vocabulary of its ecosystem and pick the closest match instead of staying vague: VSCO (A6, C1, F2, HB1…), film emulations (Kodak Portra 400, Gold 200, Fuji 400H, Cinestill 800T), or phone-native looks. Write it as "closest to <name>"; if nothing matches, say "no filter preset, clean commercial capture". Then ALWAYS give the rebuildable recipe: palette and saturation, contrast curve, black level (lifted/matte vs crisp), white-balance bias (neutral / warm / cool), highlight roll-off, and any film-like grain or clean digital cleanliness.
5. CAMERA, CAPTURE DEVICE & FRAMING — FIRST name the capture device from the evidence: professional mirrorless/DSLR on a tripod, medium format, a smartphone (say so plainly, and name the phone-camera tells — deep tiny-sensor focus, HDR-flattened shadows, ultra-wide edge stretch, on-phone flash falloff), or analog film. A phone-shot flat-lay rebuilt as a studio capture loses the whole look, so commit to a call. Then give estimated focal length and working distance feel (macro detail vs 85mm compression), camera height and angle relative to the product (straight-on / slight top-down / 45°), crop tightness and margin around the product, whether the product is centred, and depth of field (everything crisp vs shallow).
6. PRODUCT PRESENTATION — how the product is staged: ghost-mannequin / laid flat / standing upright / propped at an angle / floating, single item vs pair, and any consistent styling habit (folded sleeves, laces tucked, symmetrical arrangement).
7. OVERALL LOOK — the commercial signature in a few words (e.g. "clinical marketplace white", "warm boutique editorial", "moody premium").

STRICT RULES:
- The attached images are STYLE references only. NEVER describe the specific products in them, their brand, logo, colour or category — the user's own product will be completely different.
- NEVER mention people, hands, faces, models or poses. If a person appears in a reference, ignore them entirely; this is product photography.
- Do not mention one-off props from a single frame (a leaf, a stone, a cup next to the item). Only describe staging habits that repeat across the frames.
- Prefer concrete values and numbers over vague adjectives whenever the images support them.
- The capture device (section 5) and the preset name (section 4) are HIGH-VALUE details. Commit to a call on both; "closest to" is enough, silence is not.
- After section 7, output ONE final line, exactly one of these two machine markers (no other text on that line):
  "BACKDROP_LOCK: FLAT"   → the frames share a plain, uniform studio backdrop that must be reproduced as-is;
  "BACKDROP_LOCK: SCENE"  → the frames share a styled surface/scene whose character must be recreated with a new arrangement.
- Output PLAIN TEXT only, 200-340 words, no headings other than the numbered labels above, no markdown.`;

module.exports = createStyleProfileRouter({
  table: "refiner_style_profiles",
  storagePrefix: "refiner_style_profile_",
  analysisPrompt: REFINER_STYLE_ANALYSIS_PROMPT,
  subjectLabel: "e-commerce product photos",
});
