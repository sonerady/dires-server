// Ghost mannequin is a product-only scene, not an edit of the styled outfit.
// Keep this rule shared by mobile/tablet/Mac (V2 + retry) and web (V1).
const SINGLE_PRODUCT_GHOST_PROMPT =
    "Create one single product photograph of ONLY the primary garment shown in the uploaded product reference. " +
    "The sole input image is the original primary product upload and is the only source of product identity. " +
    "Show exactly one garment, never a complete outfit or additional styling items. Before editing, identify " +
    "the single primary product using the reference's product-focused framing, repeated views and detail " +
    "close-ups. If this upload itself shows a model wearing a complete outfit, isolate ONLY that primary " +
    "product; the other garments are styling context, not part of the product to extract. For example, a " +
    "primary shirt or sweatshirt must be shown without the trousers worn with it; primary trousers must be " +
    "shown without the shirt worn with them. Do not automatically prefer an upper-body garment. Keep a " +
    "one-piece dress or jumpsuit intact, including its full lower section. Never merge separate garments " +
    "into one product or return several pieces as a set. If the reference is a " +
    "contact sheet showing repeated views and close-ups of the same garment, combine those details into ONE " +
    "garment in ONE photograph; do not reproduce the contact sheet or duplicate the garment. Remove any " +
    "secondary garments, accessories, props, hangers, packaging and people. Do not add coordinating pieces " +
    "to complete a look. Preserve the primary garment's exact colour, cut, silhouette, proportions, material, " +
    "weave, print placement, embroidery, branding, stitching, seams, buttons, zippers and trims. " +
    "Present it as professional ghost mannequin photography, with natural three-dimensional volume supported " +
    "by an invisible body. Where applicable, shape the shoulders and chest, show a clean hollow neckline and " +
    "interior depth, and give sleeves hollow tubular volume with a gentle elbow bend and open cuffs. " +
    "No visible human parts or mannequin pieces. The complete garment, including every hem and sleeve, is " +
    "centered and fully inside the frame, filling it with balanced white margins. Retouch wrinkles, creases, " +
    "dust and lint for a freshly pressed, pristine catalog finish without altering the design. Use soft, even " +
    "studio lighting, accurate colour and crisp fabric detail. The background is seamless, uniform pure white " +
    "#FFFFFF edge to edge, without shadows, reflections, gradients, grey or cream tint. No added text, " +
    "watermark, collage or split frame.";

function getPrimaryProductImage(referenceImages) {
    const first = Array.isArray(referenceImages) ? referenceImages[0] : null;
    // Never skip a missing first upload and silently select a different product.
    return typeof first === "string" && first.trim() ? first.trim() : null;
}

function buildProductKitSceneInput({ sceneType, prompt, resultImageUrl, primaryProductImageUrl }) {
    if (sceneType === "ghost") {
        if (!primaryProductImageUrl) {
            const error = new Error("Primary product image is required for the ghost mannequin scene");
            error.code = "PRIMARY_PRODUCT_IMAGE_REQUIRED";
            throw error;
        }
        // A prompt generated from the model/outfit photo can name extra clothes
        // even after that photo is removed. Do not carry it into this scene.
        return { prompt: SINGLE_PRODUCT_GHOST_PROMPT, imageUrls: [primaryProductImageUrl] };
    }
    return {
        prompt,
        imageUrls: [resultImageUrl, primaryProductImageUrl || resultImageUrl].filter(Boolean),
    };
}

module.exports = { getPrimaryProductImage, buildProductKitSceneInput, SINGLE_PRODUCT_GHOST_PROMPT };
