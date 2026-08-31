const JEWELRY_SUBTYPES = new Set([
  "ring",
  "necklace",
  "earring",
  "bracelet",
  "watch",
  "anklet",
]);

const APPAREL_INSTRUCTION_PATTERN =
  /\b(garment|garments|dress|dresses|outfit|outfits|wardrobe|fabric|fabrics|textile|hem|hems|sleeve|sleeves|neckline|collar|trousers|pants|skirt|shirt|blouse|jacket|coat|sweater|swimwear|lingerie|cloth|drape|draping|stitching|seams?)\b/i;

// BrowserV7'nin kıyafet üreticisi otomatik yüz/beauty paragrafları kurar.
// Jewelry final prompt'u bunları devralmaz; yalnız takı, temas anatomisi ve
// kullanıcının açık model seçimleri buildJewelryGenerationPrompt'tan gelir.
const AUTOMATIC_FACE_INSTRUCTION_PATTERN =
  /\b(face|faces|facial|identity|identities|biometric|likeness|complexion|makeup|beautif(?:y|ied|ication)|eyes?|eyebrows?|brows?|nose|nostrils?|lips?|mouth|teeth|cheeks?|cheekbones?|jaw|jawline|gaze|expression|pores?|vellus|freckles?|dimples?)\b/i;

const placementBySubtype = {
  earring:
    "Mount the exact earring through the anatomically correct earlobe or cartilage point at true scale. The post, hook or wire must physically pass through the piercing point; the lobe must naturally occlude the hidden section, and the backing or clasp must sit behind the ear according to the product's real construction. Preserve whether the product reference shows a single piece or a pair. Let any hanging element fall from the actual fastening point under gravity, with realistic weight and orientation. Keep the complete visible design readable and arrange hair behind the relevant ear without changing a manually requested hairstyle.",
  necklace:
    "Close the exact necklace continuously around the neck at true scale. The chain must wrap behind the neck, conform to the neck and collarbone contours, disappear naturally where anatomy occludes it, and return with consistent link size and tension. Place the pendant at the physically lowest point dictated by gravity and the real chain construction, with believable skin contact and no hovering segments. Keep the clasp logic and complete front design readable; keep hair behind the shoulders and the collarbone area unobstructed.",
  ring:
    "Fit the exact ring fully around one anatomically correct finger at true scale. The band must curve around the finger and become naturally hidden behind it, with subtle skin pressure, contact shadow and physically plausible clearance; it must never sit flat on top of the finger. Keep the setting aligned with the finger axis and preserve the band, stone profile and top view without duplicating the ring.",
  bracelet:
    "Close the exact bracelet completely around one anatomically correct wrist at true scale. Links or the band must wrap the wrist volume, become naturally occluded on the far side, respond to gravity and make believable intermittent skin contact. Preserve realistic slack, closure position, centerpiece orientation and contact shadows without floating, clipping or duplication.",
  watch:
    "Fasten the exact watch completely around one anatomically correct wrist at true scale. The case back must sit against the wrist, the strap or bracelet must wrap and disappear naturally around the far side, and the closure must be physically plausible. Preserve the case, dial, hands, indices, crown, links and closure; keep the watch face legible with accurate crystal and metal reflections and realistic contact shadows.",
  anklet:
    "Close the exact anklet continuously around one anatomically correct ankle at true scale. Let the chain conform to the ankle, pass naturally behind it, settle under gravity and touch the skin with consistent link size, realistic slack and small contact shadows. Charms must hang from their true attachment points with no floating, clipping, duplicated links or ornaments.",
};

function normalizeJewelrySubtype(value) {
  const subtype = String(value || "").trim().toLowerCase();
  return JEWELRY_SUBTYPES.has(subtype) ? subtype : null;
}

function extractJewelryCompatibleDirection(draftPrompt) {
  return String(draftPrompt || "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !APPAREL_INSTRUCTION_PATTERN.test(part))
    .filter((part) => !AUTOMATIC_FACE_INSTRUCTION_PATTERN.test(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2800);
}

// 💎 ÜRÜN ÇEKİMİ PROMPT'U — mankensiz natürmort.
// Takılı-vücut sürümündeki anatomi, ten teması ve model kimliği blokları burada
// BİLEREK yok; yerlerini yüzey teması, sahneleme ve "insan yok" kilidi alıyor.
//
// Yazım ilkeleri (17 Ağu 2026 revizyonu — ilk sürümün 4 zayıflığı düzeltildi):
// 1. ÇELİŞKİ HAKEMİ: Referans sahnenin KENDİSİ; CREATIVE DIRECTION onu yalnız
//    kelimeye döker. Çelişirlerse referans kazanır — açıkça yazılır. (İlk sürümde
//    "sahneyi aynen koru" ile "şu sahneyi kur" yan yana duruyordu, hakem yoktu.)
// 2. KOŞULLU YER TUTUCU: Referansta takı olmayabilir (boş yüzey). "Placeholder"
//    dili "should the reference already display…" ile koşullu; ölçek bloğu ise
//    yer tutucudan tamamen bağımsız yazıldı.
// 3. POZİTİF DİL + TEK FİZİK BLOĞU: Görsel modeller yasaktan çok tarifle çalışır.
//    Örtüşen SURFACE CONTACT + PHYSICAL INTEGRATION blokları PHYSICAL PRESENCE'ta
//    birleşti ve olumlu cümleye çevrildi. Tek sert yasak NO PERSON LOCK'ta kaldı.
// 4. KADRAJ: Çıktı oranı API'de ayrıca zorlanıyor (aspect_ratio); referans farklı
//    orandaysa ne yapılacağı ve ürünün kenardan kesilmemesi açıkça söylenir.
function buildJewelryProductShotPrompt({
  productName,
  synthesizedDirection = null,
  draftPrompt = "",
  customDetail = null,
}) {
  const synthesized = String(synthesizedDirection || "").trim();
  const creativeDirection =
    synthesized || extractJewelryCompatibleDirection(draftPrompt);
  const detail = String(customDetail || "").trim();

  return `Create one premium, photorealistic jewelry PRODUCT photograph — a styled still life — using the attached product image as the immutable source of truth. The commercial hero is the ${productName} itself, presented without any person.

NO PERSON LOCK (NON-NEGOTIABLE): The output contains NO human being and NO body part — no model, face, hand, finger, ear, neck, wrist, ankle, hair or skin anywhere in the frame, not even partially, blurred, reflected or out of focus. This is a product-only still life. If any person or body part appears, the result is FAILED.

JEWELRY IDENTITY LOCK: Reproduce the exact same piece without redesigning it. Preserve its metal color and finish, dimensions, proportions, silhouette, stone count, stone cuts and colors, prongs, bezels, links, chain pattern, clasp, engravings, texture, spacing and every visible construction detail, including whether the reference shows a single piece or a pair. Every component that exists stays; nothing is added, merged, duplicated, enlarged or simplified.

THE SET COMES FROM THE STYLE REFERENCE: The attached style reference is the actual set for this photograph — its surface, props, backdrop, staging, light direction and quality, color grade, camera angle and viewpoint all carry over as they appear. The product reference supplies the piece itself and nothing about the set. Where the written direction below and the visible reference disagree, THE REFERENCE WINS; the written direction only names in words what is already visible there.

PLACEMENT FIDELITY — THE PRODUCT TAKES THE REFERENCE PIECE'S EXACT SPOT: Should the reference already display a piece of jewelry, that piece is a position marker to be removed entirely, and the user's product inherits its place down to the detail. Match the same anchor point in the frame, the same distance from the edges, props and shadow shapes around it, and the same overlap with the surface texture beneath it. Match the same viewing angle and orientation — the tilt, rotation and which side faces the camera — expressed through the user's own construction. Match the same compositional gesture: the arrangement idea the photographer chose, whether a chain laid in a loose S-curve, a pair set slightly apart with one turned away, or a piece leaning against a fold, is carried out again with the user's product, adapted only as far as its real construction demands. The creative intent of the original frame — its focal point, its balance of filled and empty space, its direction of flow — survives intact. Where the two pieces differ in form so much that literal imitation would look wrong, keep that intent and let the product sit naturally rather than forcing it into a shape it does not have. Only true scale is recalculated; everything around the piece remains untouched.

TRUE SCALE: Size the piece from its own physical construction and from what this jewelry subtype really measures in the hand — never from how large it appears inside its source image, which may be a macro crop, and never from the size of anything occupying that spot in the reference. A delicate piece stays delicate even when it lands where something larger once sat, and all internal proportions hold at that corrected scale.

PHYSICAL PRESENCE IN THE SET: Build the piece as a real three-dimensional object resting in the photographed scene, so that every physical cue agrees with it being there. It settles the way its true weight dictates — chains and cords fall into gravity-driven curves with natural slack, rigid pieces rest on their real bearing facets, and a pair is placed with deliberate, believable spacing. Its footprint is anchored by accurate micro contact shadows; a reflective surface returns a reflection that matches its real geometry; polished metal picks up the surface color and the scene's own highlights; props in front of or behind it occlude correctly at the right depth. The result must read as photographed in place rather than composited onto the frame.

JEWELRY LIGHTING: Shape the light specifically for precious metal and gemstones. Use controlled specular highlights, clean facet reflections, believable refraction, restrained sparkle, accurate metal roughness and soft contact shadows. Keep every defining edge tack-sharp while allowing only a natural optical depth-of-field transition.

FRAMING AND COMPOSITION: The piece is the immediate focal point, rendered large enough that a buyer can inspect its construction, and it sits complete inside the frame with clear breathing room on every side — no part of the design runs off an edge. Keep the reference's camera angle and viewpoint; when the output frame's proportions differ from the reference, recompose within that frame rather than stretching or cropping the piece, extending the same surface and backdrop naturally to fill the space. Surface, props and negative space support the piece without competing with it, and props stay few, neutral and clearly secondary.${detail ? ` User detail: ${detail}.` : ""}

${creativeDirection ? `CREATIVE DIRECTION: ${creativeDirection}\n\n` : ""}The result is a single coherent professional product photograph suitable for a luxury jewelry catalog and e-commerce listing, with physically consistent camera perspective, lighting, reflections, surface contact, color science and scale.`;
}

function buildJewelryGenerationPrompt({
  draftPrompt = "",
  // 💎🎬 Anlamlandırılmış stil sentezi (13 Ağu 2026): stil referanslı takı
  // üretiminde Gemini'nin ham analiz+profil notlarından yazdığı akıcı brief.
  // Varsa creativeDirection OLDUĞU GİBİ bu olur — cümle bazlı regex süzgeci ve
  // 2800 karakter dilimi uygulanmaz. O iki savunma, kıyafet odaklı ham kompakt
  // prompt'un takıya sızmaması içindi; sentez zaten takıya uygun yazdırılıyor
  // ve süzgeç "gaze/expression" geçen anlamlı cümleleri de katlediyordu.
  synthesizedDirection = null,
  productSubtype = null,
  settings = {},
  customDetail = null,
  // 💎 ÜRÜN ÇEKİMİ (çekim tarzı 2): kare mankensiz bir natürmort. Aşağıdaki
  // anatomi/model blokları bu modda YAZILMAZ — yoksa model prompt'u kazanıyor ve
  // ürün çekimi seçilmiş olmasına rağmen mankenli editoryal kare çıkıyordu
  // (17 Ağu bug'ı, kullanıcı bildirdi).
  productShot = false,
} = {}) {
  const subtype = normalizeJewelrySubtype(productSubtype);
  const productName = subtype || "jewelry piece";
  if (productShot) {
    return buildJewelryProductShotPrompt({
      productName,
      synthesizedDirection,
      draftPrompt,
      customDetail,
    });
  }
  const placement =
    placementBySubtype[subtype] ||
    "Identify the exact jewelry type from the product reference and place it on the anatomically correct body area at true scale. Keep the entire piece unobstructed and commercially readable.";
  const synthesized = String(synthesizedDirection || "").trim();
  const creativeDirection =
    synthesized || extractJewelryCompatibleDirection(draftPrompt);
  const detail = String(customDetail || "").trim();

  const modelBits = [
    settings?.age ? `age presentation ${settings.age}` : null,
    settings?.gender ? `gender presentation ${settings.gender}` : null,
    settings?.ethnicity ? `heritage ${settings.ethnicity}` : null,
    settings?.skinTone ? `skin tone ${settings.skinTone}` : null,
  ].filter(Boolean);

  return `Create one premium, photorealistic jewelry campaign photograph using the attached product image as the immutable source of truth. The commercial hero is the ${productName}, not the model's clothing.

JEWELRY IDENTITY LOCK: Reproduce the exact same piece without redesigning it. Preserve its metal color and finish, dimensions, proportions, silhouette, stone count, stone cuts and colors, prongs, bezels, links, chain pattern, clasp, engravings, texture, spacing and every visible construction detail. Preserve the reference's single-versus-pair quantity. Do not add, remove, merge, duplicate, enlarge or simplify any component.

REFERENCE ROLE LOCK: Jewelry product reference images define the exact product and nothing else. A target model or jewelry campaign reference defines the person, anatomy, pose, crop and intended placement region. If that target reference already contains jewelry in the same region, treat it only as a placement marker: remove it completely and replace it with the user's exact product. Never copy, retain, blend or redesign the reference model's placeholder jewelry. Preserve the target model and the rest of the photograph unchanged outside the replacement area.

TRUE-SCALE SOURCE HIERARCHY: The target model reference provides the attachment point only; it provides ZERO information about the replacement jewelry's size. Never inherit, match or approximate the placeholder jewelry's diameter, length, width, stone size, pendant size or visual coverage. Determine the user's product scale only from reliable physical cues in the jewelry product references and from its actual construction and subtype. Never infer physical size from how large the isolated product appears inside its source-image canvas, because that may be a macro crop. Preserve a visibly small or delicate product as small and delicate even when the placeholder is oversized. If no reliable scale cue exists, choose a conservative, plausible real-world scale for that jewelry subtype rather than enlarging it to fill the placeholder area. Recalculate the replacement's pixel dimensions against the target ear, finger, neck, wrist or ankle; preserve all internal product proportions at that corrected scale.

ANATOMICAL PLACEMENT AND SCALE: ${placement} The jewelry must make believable contact with skin, with correct attachment points, gravity, weight, pressure and occlusion. Human anatomy must be natural and complete wherever visible.

PHYSICAL INTEGRATION LOCK: Reconstruct the jewelry as a real three-dimensional object mounted on the body, not as a flat overlay, sticker or pasted cutout. Match the target anatomy's depth, local perspective and surface curvature. Use correct near-side and far-side occlusion, exact contact points, subtle pressure where appropriate, micro contact shadows, reflected skin color in polished metal and scene-consistent highlights. No gap may appear where the real fastening or contact point should touch the body; no part may sink into, float above, pass incorrectly through or deform the anatomy. Scale must remain believable relative to the visible ear, neck, finger, wrist or ankle.

MODEL IDENTITY PRESERVATION: If an attached target model or jewelry campaign reference supplies the person for the final composition, preserve that exact person's face, facial geometry, identity, apparent age, expression, makeup and natural skin characteristics unchanged. Do not invent, beautify, restyle or replace the target model's facial features. People visible only in separate product-detail images are not identity sources. The jewelry edit may affect only the physically necessary contact and occlusion around its placement area; every unrelated part of the target model remains faithful to the reference.

JEWELRY LIGHTING: Shape the light specifically for precious metal and gemstones. Use controlled specular highlights, clean facet reflections, believable refraction, restrained sparkle, accurate metal roughness and soft contact shadows. Keep every defining edge tack-sharp while allowing only a natural optical depth-of-field transition. Skin retains pores, fine texture and realistic tonal variation.

COMPOSITION: Make the jewelry the immediate focal point and large enough in frame to inspect its design. The model, pose, styling and environment support the piece without covering or competing with it. Supporting apparel stays simple, neutral and visually secondary; do not invent apparel product details from the jewelry reference.${modelBits.length ? ` Model direction: ${modelBits.join(", ")}.` : ""}${detail ? ` User detail: ${detail}.` : ""}

${creativeDirection ? `CREATIVE DIRECTION: ${creativeDirection}\n\n` : ""}The result is a single coherent professional photograph suitable for a luxury jewelry campaign and e-commerce presentation, with physically consistent camera perspective, lighting, reflections, skin contact, color science and scale.`;
}

module.exports = {
  buildJewelryGenerationPrompt,
  extractJewelryCompatibleDirection,
  normalizeJewelrySubtype,
};
