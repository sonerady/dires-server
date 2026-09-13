// Shared V7 path: RN phone/tablet/Mac and the web all use this enhancer.
const value = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

function isFootwearShoot(settings = {}, modes = {}) {
  return value(settings?.productCategory) === 'shoes' &&
    !['isRefinerMode', 'isEditMode', 'isColorChange', 'isPoseChange', 'isBackSideAnalysis']
      .some(key => modes[key] === true);
}

function buildFootwearDirection({ settings = {}, hasStyleReference = false, hasPoseReference = false } = {}) {
  const explicitFraming = [settings.focusArea, settings.framing, settings.perspective]
    .some(v => value(v) && !['auto', 'automatic', 'default'].includes(value(v)));
  const explicitPose = hasPoseReference || (value(settings.pose) && !['auto', 'automatic', 'default'].includes(value(settings.pose)));
  return `FOOTWEAR PHOTOGRAPHY:
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

module.exports = { isFootwearShoot, buildFootwearDirection, buildFootwearEnhanceInstruction };
