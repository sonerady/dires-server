// Shared V7 path: RN phone/tablet/Mac and the web all use this enhancer.
const value = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

function isOutfitRequest(settings = {}, modes = {}) {
  return [settings, modes].some(source => source && (
    source.isMultipleProducts === true || source.isKombinMode === true ||
    Number(source.kombinItemCount) > 1
  ));
}

// Category alone describes the hero item, not necessarily all uploaded products.
// Multi-angle uploads can contain outfits too; let the vision prompt resolve them
// instead of hard-coding a calf crop from an unverified client category.
function isFootwearShoot(settings = {}, modes = {}) {
  return value(settings?.productCategory) === 'shoes' &&
    !isOutfitRequest(settings, modes) &&
    ![settings, modes].some(source => source && (
      source.isMultipleAnglesMode === true || Number(source.multipleAnglesCount) > 1
    )) &&
    !['isRefinerMode', 'isEditMode', 'isColorChange', 'isPoseChange', 'isBackSideAnalysis']
      .some(key => modes[key] === true);
}

function buildMultiAngleProductScopeDirection({ photoCount = 0, settings = {}, modes = {} } = {}) {
  return `PRODUCT REFERENCE SCOPE — VISUAL EVIDENCE TAKES PRIORITY:
The product grid contains ${photoCount} reference photographs. The upload-mode label and product category are hints, not proof that all cells show the same product. Inspect all PRODUCT references before choosing the composition; model identity, pose and location references are not additional products.
If the cells show different views or close-ups of the SAME item, reconcile them into one faithful product (one normal left/right pair for shoes), without duplicates. If they show DISTINCT supplied products, such as a jacket, polo, trousers and loafers, retain every distinct product together as a complete outfit. Do not reinterpret a garment as an angle of a shoe or demote supplied clothing to disposable styling. Frame all supplied pieces clearly; use head-to-toe outfit coverage by default when tops, bottoms and footwear are supplied together. Explicit user framing still takes precedence. Never create a collage.
${value(settings?.productCategory) === 'shoes' && !isOutfitRequest(settings, modes)
    ? 'ONLY if every distinct supplied product is footwear, use footwear-led photography with accurate shoe details, believable feet and lower legs, and a balanced grounded pose. Repeated views of the same shoe are not additional products. If any distinct non-footwear product is supplied, omit all shoe-only crop, calf-height camera and shoe-dominant composition instructions; photograph the complete outfit instead. Incidental clothing on a shoe model is not a separate supplied product.'
    : 'Preserve every distinct supplied product; footwear included in an outfit must not take over the framing.'}`;
}

function buildFootwearDirection({ settings = {}, hasStyleReference = false, hasPoseReference = false } = {}) {
  const explicitFraming = [settings.focusArea, settings.framing, settings.perspective]
    .some(v => value(v) && !['auto', 'automatic', 'default'].includes(value(v)));
  const explicitPose = hasPoseReference || (value(settings.pose) && !['auto', 'automatic', 'default'].includes(value(settings.pose)));
  return `FOOTWEAR PHOTOGRAPHY:
SCOPE CHECK FIRST: Apply the footwear-only directions below ONLY when the supplied product references actually contain footwear alone. A shoes category is not proof. If the product image is a collage or outfit containing other distinct supplied garments/products, disregard the shoe-only crop, camera, pose and focus defaults below and instead preserve and clearly frame the complete supplied outfit. Distinguish separate supplied products from incidental styling worn by a model in a shoe photo. Explicit user framing takes precedence.
The product reference defines the exact footwear design, not the display setup. Preserve the toe shape, toe-box volume, sole thickness and profile, heel height and shape, shaft height and width, seams, panels, closures, hardware and visible branding. Describe only details actually visible across the product references; do not invent leather species, pull tabs, zippers, heels or other construction. Preserve material grain and the original color under the scene's light, including readable detail in black surfaces. A gold display pole, stand, shoe tree, support, background or empty boot opening in the source is not part of the product.

This is footwear worn by a real, anatomically coherent person unless the user explicitly requests a product-only photograph. Each shoe fits its corresponding left or right foot and connects naturally through the ankle to a continuous leg. Boot shafts contain the wearer's legs; show the legs continuing above the shafts whenever that area is in frame. The wearer is one complete human: any body part outside the crop continues beyond the image boundary, never ending, fading out or being cut off inside the scene. Keep the pair consistent in size, design and perspective. The rigid sole and heel retain their construction; only the upper flexes modestly where a real foot bends. Avoid empty walking boots, disconnected legs, duplicated feet, intersecting shoes and melted soles. Complete the visible outfit tastefully and appropriately for the selected age and weather, keeping the footwear unobstructed.

${hasStyleReference || explicitFraming
    ? 'Honor the explicit style reference and user-selected framing/perspective; do not replace them with a default crop. Within that composition, keep visible footwear details legible and naturally proportioned.'
    : "Use a footwear-led crop with enough leg visible to establish a real wearer. For tall boots include the entire shafts and legs above their top edges; for low shoes include ankles and lower legs. Place the TOP EDGE OF THE IMAGE across the wearer's legs above the boot tops (or across the calves for low shoes), so the legs continue naturally out of the top of the photograph. There is no sky or background visible above a severed leg: the crop ends while the legs are still continuing upward. Keep a small breathing margin around toes and heels, and only enough space above the shafts to show the natural leg connection. Make the footwear occupy most of the image height, not just the bottom half of a tall scenery photograph. Use a moderate three-quarter product view at shoe-to-calf camera height and sufficient working distance, without extreme wide-angle foreshortening."}
${hasStyleReference || explicitPose
    ? 'Preserve the requested pose or style-reference pose; resolve foot placement and support with believable anatomy, sharp footwear and clear separation.'
    : 'Choose a quiet, balanced stance with one foot slightly ahead of the other and clearly separated silhouettes. Both feet rest on a plausible shared ground plane with contact shadows at their actual sole and heel support points. Prefer this stable pose over airborne strides, running, crossed legs or extreme ankle twists.'}

Focus on the footwear: toe, heel and shaft details on both shoes remain crisp, with sufficient depth of field and a still, sharp capture. Use a moderate focal length and product-friendly depth of field (for example 70–85mm at f/8); these are photographic intent, not printed text. Separate dark materials with soft directional light and gentle fill rather than crushed blacks, plastic glare or sharpening halos. Keep scene illumination and shadows coherent with the shoes and wearer. Neutral white balance and faithful product color are the default; an explicit user/style-reference treatment takes precedence.

Location references and descriptions define the setting, not whether the model exists. A vacant, empty or unoccupied street describes the background without bystanders, never an instruction to remove the wearer. Recompose the environment around the footwear shot rather than copying a wide empty-scene camera. User-selected pose, framing, identity, age, modesty and explicit additional details take precedence over these default composition suggestions. Produce one coherent photograph, not a collage or separate product cutouts.`;
}

function buildFootwearEnhanceInstruction({ settings = {}, originalPrompt = '', customDetail = '', context = '', hasPoseReference = false, multipleAnglesCount = 0, kombinItemCount = 0 } = {}) {
  return `Write a concise, image-grounded English prompt for a footwear fashion photograph. Start with "Replace" and return only four flowing paragraphs. Analyze the product image before writing. This footwear brief replaces generic garment/fabric, face-first and dynamic-walking directions.
Paragraph 1: establish the actual footwear visibly worn on a living model and a product-led composition, not an empty pair of boots placed into a street.
Paragraph 2: describe the observed footwear silhouette and construction accurately, its natural fit and support on the feet. Unknown details remain unspecified. Avoid inventing material species or luxury features.
Paragraph 3: describe the requested setting briefly as supporting context, retaining its identity without letting an empty landscape erase the wearer or dominate the crop.
Paragraph 4: specify product-focused optics, clear material texture, faithful color, grounded shadows and a sharp still exposure. Do not spend the brief on the face when the crop excludes it.

${buildFootwearDirection({settings, hasPoseReference})}
${multipleAnglesCount > 1 ? 'The product grid shows multiple views of the SAME footwear design; reconcile those views, not extra shoes. A normal worn pair has one left and one right shoe, regardless of the number of reference views.' : ''}
${kombinItemCount > 1 ? 'The reference is an outfit grid. Retain every distinct supplied item as part of the outfit; do not omit other items or put multiple different pairs onto the same feet. Explicit outfit coverage takes precedence over a tighter default footwear crop.' : ''}

USER REQUEST (explicit changes override defaults):
${originalPrompt}
${customDetail ? `Additional details: ${customDetail}` : ''}

USER SETTINGS AND REFERENCE ROLES:
${context}`;
}

module.exports = { isFootwearShoot, buildFootwearDirection, buildFootwearEnhanceInstruction, buildMultiAngleProductScopeDirection };
