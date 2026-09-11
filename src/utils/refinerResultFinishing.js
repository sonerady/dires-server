const { applyResultUpscale, upscaleResultImage, markGenerationStage } = require("./resultUpscale");
const logger = require("./logger");

const GARMENTS = new Set(["clothing", "dress", "top", "bottom", "outerwear", "knitwear", "swimwear", "lingerie"]);
const OTHER_PRODUCTS = new Set([
  "shoes", "jewelry", "eyewear", "bag", "accessory", "accessories",
  "earrings", "rings", "necklaces", "bracelets_chain", "bracelets_bangle",
  "ring", "necklace", "earring", "bracelet", "anklet",
]);
const normalize = value => String(value || "").trim().toLowerCase();

function shouldFinishRefinerMain(request = {}) {
  const settings = request.settings || {};
  if (request.isRefinerMode !== true || request.isVariant === true || request.isVariation === true ||
      settings.isVariant === true || settings.isVariation === true) return false;
  const subtype = normalize(request.productSubtype ?? settings.productSubtype);
  // The classifier also labels eyewear, bags and watches as clothing. Their
  // subtype decides; a real garment (including outfits) remains excluded.
  if (GARMENTS.has(subtype)) return false;
  if (OTHER_PRODUCTS.has(subtype)) return true;
  const category = normalize(request.productCategory ?? settings.productCategory ?? settings.productType);
  return OTHER_PRODUCTS.has(category);
}

// Called only after the main Refiner GPT result, never by variation routes.
// The included 4 MP pass has no extra credit fee. Explicit >4 MP selections
// still run through the existing paid upscale flow after this base finish.
async function finishRefinerMainResult({ request, imageUrl, upscaleMp = 4, userId, generationId, ensureBaseCharge }) {
  let finished = { imageUrl, appliedMp: null, preUpscaleUrl: null, creditsCharged: 0 };
  if (imageUrl && shouldFinishRefinerMain(request)) {
    try {
      await markGenerationStage(generationId, userId, "upscaling");
      const sharpened = await upscaleResultImage(imageUrl, 4);
      if (!sharpened) throw new Error("REFINER_4MP_EMPTY_RESULT");
      finished = { imageUrl: sharpened, appliedMp: 4, preUpscaleUrl: imageUrl, creditsCharged: 0 };
      logger.log("✅ [REFINER MAIN] Pruna 4 MP finish completed");
    } catch (error) {
      logger.warn("⚠️ [REFINER MAIN] Pruna 4 MP unavailable; retaining GPT result:", error?.message);
      // First Pruna failure ends post-processing. Do not retry or send the
      // same GPT result through the optional paid upscale path afterwards.
      return finished;
    } finally {
      await markGenerationStage(generationId, userId, null);
    }
  }

  const selectedUpscale = await applyResultUpscale({
    imageUrl: finished.imageUrl, upscaleMp, userId, generationId, ensureBaseCharge,
    logTag: "REFINER UPSCALE",
  });
  return selectedUpscale.appliedMp ? selectedUpscale : finished;
}

module.exports = { shouldFinishRefinerMain, finishRefinerMainResult };
