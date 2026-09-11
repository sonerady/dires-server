const SUNBURST_EDIT_MODEL = "openai/gpt-image-2.5/sunburst/edit";

// Preserve current V1 behavior when the database setting cannot be read.
const DEFAULT_MODEL_CREATION_PROVIDER = "gpt";

// Shared routes also serve editing; only product model creation is overridden.
function isModelCreationV1({
  qualityVersion = "v1",
  isBackSideAnalysis = false,
  isPoseChange = false,
  isColorChange = false,
  isEditMode = false,
  isRefinerMode = false,
} = {}) {
  return qualityVersion !== "v2" && !isBackSideAnalysis && !isPoseChange &&
    !isColorChange && !isEditMode && !isRefinerMode;
}

function usesSunburstForModelCreation(options, provider = DEFAULT_MODEL_CREATION_PROVIDER) {
  return provider === "gpt" && isModelCreationV1(options);
}

function usesNb2ForModelCreation(options, provider = DEFAULT_MODEL_CREATION_PROVIDER) {
  return provider === "gemini" && isModelCreationV1(options);
}

// Only a content-checker rejection triggers provider fallback, not arbitrary
// validation errors (missing images, invalid dimensions, etc.).
function isSunburstContentRejection(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const details = [error?.message, error?.body, error?.data, error?.response?.data];
  const text = details.map(value => typeof value === "string" ? value : JSON.stringify(value || "")).join(" ");
  return (Number(status) === 422 || /\b422\b/.test(text)) &&
    /content[ _-]checker|content[ _-]policy[ _-]violation|content[ _-]filter|flagged by a content/i.test(text);
}

module.exports = { DEFAULT_MODEL_CREATION_PROVIDER, isModelCreationV1, usesNb2ForModelCreation, SUNBURST_EDIT_MODEL, usesSunburstForModelCreation, isSunburstContentRejection };
