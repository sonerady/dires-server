// Shared with Refiner clothing staging and the e-commerce kit ghost scene.
// Background and product-selection rules stay with the caller.
const REFINER_GHOST_SLEEVE_DIRECTIVE = `GHOST MANNEQUIN — SLEEVE CONSTRUCTION: For any garment with sleeves, always construct the sleeves as if they are naturally supported by an invisible mannequin's arms. The sleeves must have clear internal volume and a hollow, tubular three-dimensional structure rather than appearing flat, collapsed, or hanging straight down.

Position both sleeves slightly outward from the torso with a natural mannequin-like arm pose. Introduce a subtle bend around the elbow area so the sleeves follow a soft, controlled curve instead of forming a rigid straight line. The sleeve openings and cuffs should preserve realistic circular or oval volume, clearly suggesting an invisible arm inside the garment.

Maintain natural spacing between the sleeves and the body. Do not let the sleeves stick tightly against the torso, collapse inward, overlap the body unnaturally, or appear empty and flattened. Preserve the garment's original sleeve length, width, cuffs, seams, fabric texture, construction, and proportions.

The final result should resemble professional e-commerce ghost mannequin photography: symmetrical, structured, dimensional, clean, and naturally shaped by an invisible human form.`;

const REFINER_GHOST_FINISH_DIRECTIVE = `REFINER CATALOG FINISH: Sharp focus and high clarity across the ENTIRE product: no blur, no bokeh, no shallow-depth-of-field or motion blur. Show the true fabric weave, knit texture or leather grain clearly without plastic smoothing, invented detail or sharpening halos.

Remove unwanted wrinkles, creases, dust, lint, loose threads and stains for a freshly pressed, pristine boutique finish. Preserve intentional pleats, gathers, fringes, embroidery, distressed finishes and every original construction detail. Keep the exact colour, silhouette, proportions, logos, labels, seams, buttons, zippers and trims; never redesign the garment.

Build natural shoulder width, chest volume and waist definition around an invisible body, with a clean hollow neckline, visible collar interior and realistic depth. For lower-body garments, preserve the natural waistband and leg volume. Remove all visible people, body parts, hangers and mannequin pieces. Present the complete product centred, shoulders level where applicable, hem balanced and every sleeve and edge fully inside the frame. Balance the presentation without changing an intentionally asymmetrical design.

Use bright, even professional studio lighting with no harsh shadows on the product or blown highlights. Preserve true-to-life colours and crisp, clean edges. The result must be photorealistic and ready for a premium e-commerce catalog, never a flat cutout or an illustration.`;

const REFINER_GHOST_MANNEQUIN_DIRECTIVE = `${REFINER_GHOST_SLEEVE_DIRECTIVE}

${REFINER_GHOST_FINISH_DIRECTIVE}`;

module.exports = { REFINER_GHOST_MANNEQUIN_DIRECTIVE };
