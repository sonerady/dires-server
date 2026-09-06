const UPSCALE_CREDITS = Object.freeze({ 8: 20, 16: 40, 32: 80, 64: 120, 128: 240 });

const getUpscaleCredits = (mp = 4) => UPSCALE_CREDITS[Number(mp)] || 0;
const getGenerationCreditCost = (qualityVersion = "v1", mp = 4) =>
  (qualityVersion === "v2" ? 35 : 10) + getUpscaleCredits(mp);

module.exports = { UPSCALE_CREDITS, getUpscaleCredits, getGenerationCreditCost };
