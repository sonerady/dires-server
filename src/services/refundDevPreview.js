const { randomUUID } = require("node:crypto");
const {
  buildAnalysisPrompt,
  parseAnalysis,
  decideRefund,
  extractProductUrls,
  callRefundVision,
} = require("../utils/creditRefundAnalysis");
const { judgeRefund } = require("../utils/creditRefundJudge");

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
  judge = null, // testte hakem yerine sahte çağrı
}) {
  const reviews = new Map();
  // 24 Eyl 2026 (kullanıcı isteği): bir fotoğraf onay ya da ret aldıysa ikinci kez analiz
  // edilmez — canlıdaki credit_refund_requests kaydının yerine bellekte (kullanıcı+üretim).
  // status bunu `existing` olarak döndürür, istemci butonu pasif yapıp uyarı gösterir.
  const decided = new Map();
  const decidedKey = (userId, id) => `${userId}:${id}`;
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
      const previous = decided.get(decidedKey(userId, id));
      if (previous && previous.expires > Date.now())
        return {
          success: true,
          devPreview: true,
          eligible: false,
          existing: previous.result,
          creditsDeducted: gen.credits_deducted || 0,
        };
      return {
        success: true,
        devPreview: true,
        eligible: true,
        existing: null,
        creditsDeducted: gen.credits_deducted || 0,
      };
    },
    async analyze(userId, id, languageCode) {
      const previous = decided.get(decidedKey(userId, id));
      if (previous && previous.expires > Date.now()) return previous.result;
      const gen = await generation(userId, id);
      const products = extractProductUrls(gen.reference_images);
      const images = await Promise.all(
        [...products, gen.result_image_url].map(imageData),
      );
      const userDetails =
        gen.settings?.additionalDetails ||
        gen.settings?.additional_details ||
        "";
      let analysis;
      let decision;
      if (process.env.REFUND_ANALYZER === "legacy") {
        const prompt = buildAnalysisPrompt({ languageCode, productCount: products.length, userDetails });
        const { raw } = await vision(prompt, images);
        analysis = parseAnalysis(raw);
        if (!analysis) throw new Error("invalid_analysis");
        decision = decideRefund(analysis, gen.credits_deducted || 0);
      } else {
        // ⚖️ Hakem (canlıyla aynı karar yolu)
        ({ analysis, decision } = await judgeRefund({
          images,
          productCount: products.length,
          languageCode,
          userDetails,
          creditsDeducted: gen.credits_deducted || 0,
          ...(judge ? { vision: judge } : {}),
        }));
      }
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
      reviews.set(result.id, { userId, generationId: id, result, expires: Date.now() + 1800000 });
      if (decided.size >= 1000) decided.delete(decided.keys().next().value);
      decided.set(decidedKey(userId, id), { result, expires: Date.now() + 6 * 3600000 });
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
      if (review.generationId)
        decided.set(decidedKey(userId, review.generationId), { result: review.result, expires: Date.now() + 6 * 3600000 });
      return review.result;
    },
  };
}
module.exports = { enabled, createPreview };
