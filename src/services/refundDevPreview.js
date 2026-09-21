const { randomUUID } = require("node:crypto");
const {
  buildAnalysisPrompt,
  parseAnalysis,
  decideRefund,
  extractProductUrls,
  callRefundVision,
} = require("../utils/creditRefundAnalysis");

function enabled(env = process.env) {
  return (
    env.NODE_ENV === "development" &&
    env.CREDIT_REFUND_DEV_PREVIEW === "1" &&
    !env.RAILWAY_ENVIRONMENT &&
    !env.RAILWAY_ENVIRONMENT_NAME &&
    !env.VERCEL
  );
}

// Deliberately has no database writer, credit mutator or notification dependency.
function createPreview({
  loadGeneration,
  imageData,
  vision = callRefundVision,
}) {
  const reviews = new Map();
  async function generation(userId, id) {
    const gen = await loadGeneration(userId, id);
    if (
      !gen?.result_image_url ||
      !extractProductUrls(gen.reference_images).length
    )
      throw new Error("no_product_photo");
    return gen;
  }
  return {
    async status(userId, id) {
      const gen = await generation(userId, id);
      return {
        success: true,
        devPreview: true,
        eligible: true,
        existing: null,
        creditsDeducted: gen.credits_deducted || 0,
      };
    },
    async analyze(userId, id, languageCode) {
      const gen = await generation(userId, id);
      const products = extractProductUrls(gen.reference_images);
      const images = await Promise.all(
        [...products, gen.result_image_url].map(imageData),
      );
      const prompt = buildAnalysisPrompt({
        languageCode,
        productCount: products.length,
        userDetails:
          gen.settings?.additionalDetails ||
          gen.settings?.additional_details ||
          "",
      });
      const { raw } = await vision(prompt, images);
      const analysis = parseAnalysis(raw);
      if (!analysis) throw new Error("invalid_analysis");
      const decision = decideRefund(analysis, gen.credits_deducted || 0);
      const result = {
        success: true,
        devPreview: true,
        id: randomUUID(),
        status: decision.status,
        refundedCredits: decision.credits,
        summary: analysis.summary,
        defects: analysis.defects,
      };
      for (const [key, value] of reviews)
        if (value.expires < Date.now()) reviews.delete(key);
      if (reviews.size >= 500) reviews.delete(reviews.keys().next().value);
      reviews.set(result.id, { userId, result, expires: Date.now() + 1800000 });
      return result;
    },
    appeal(userId, requestId, text) {
      const review = reviews.get(requestId);
      if (
        !review ||
        review.expires < Date.now() ||
        review.userId !== userId ||
        review.result.status !== "rejected"
      )
        throw new Error("appeal_unavailable");
      if (
        typeof text !== "string" ||
        text.trim().length < 20 ||
        text.length > 2000
      )
        throw new Error("invalid_appeal");
      review.result = {
        ...review.result,
        status: "appeal_pending",
        appealText: text.trim(),
      };
      return review.result;
    },
  };
}
module.exports = { enabled, createPreview };
