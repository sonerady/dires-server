const express = require("express");
const axios = require("axios");

const router = express.Router();

const translationCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const GOOGLE_TRANSLATE_URL =
  "https://translation.googleapis.com/language/translate/v2";

const getApiKey = () =>
  process.env.GOOGLE_TRANSLATE_API_KEY ||
  process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY ||
  process.env.GOOGLE_TRANSLATION_API_KEY;

const sanitizeLanguage = (value = "") => {
  if (!value || typeof value !== "string") return null;
  return value.trim().toLowerCase();
};

const sanitizeTexts = (texts) => {
  if (!texts || typeof texts !== "object" || Array.isArray(texts)) {
    return {};
  }

  return Object.entries(texts).reduce((acc, [key, value]) => {
    if (typeof value !== "string") return acc;
    const trimmed = value.trim();
    if (!trimmed) return acc;
    acc[key] = trimmed;
    return acc;
  }, {});
};

const getCacheKey = ({ targetLanguage, sourceLanguage, text }) =>
  JSON.stringify({
    targetLanguage,
    sourceLanguage: sourceLanguage || "auto",
    text,
  });

const getCachedTranslation = (cacheKey) => {
  const entry = translationCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    translationCache.delete(cacheKey);
    return null;
  }

  return entry.value;
};

router.post("/ui-translate", async (req, res) => {
  const targetLanguage = sanitizeLanguage(req.body?.targetLanguage);
  const sourceLanguage = sanitizeLanguage(req.body?.sourceLanguage);
  const texts = sanitizeTexts(req.body?.texts);

  if (!targetLanguage) {
    return res.status(400).json({
      success: false,
      message: "targetLanguage is required",
    });
  }

  const textEntries = Object.entries(texts);
  if (textEntries.length === 0) {
    return res.status(400).json({
      success: false,
      message: "texts must contain at least one non-empty string",
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      message: "Translation service is not configured",
      missingEnv: "GOOGLE_TRANSLATE_API_KEY",
    });
  }

  try {
    const translatedTexts = {};
    const textsToTranslate = [];
    const keyOrder = [];

    for (const [key, value] of textEntries) {
      const cacheKey = getCacheKey({ targetLanguage, sourceLanguage, text: value });
      const cachedValue = getCachedTranslation(cacheKey);

      if (cachedValue) {
        translatedTexts[key] = cachedValue;
        continue;
      }

      textsToTranslate.push(value);
      keyOrder.push({ key, cacheKey });
    }

    if (textsToTranslate.length > 0) {
      const requestBody = {
        q: textsToTranslate,
        target: targetLanguage,
        format: "text",
      };

      if (sourceLanguage) {
        requestBody.source = sourceLanguage;
      }

      const response = await axios.post(
        `${GOOGLE_TRANSLATE_URL}?key=${encodeURIComponent(apiKey)}`,
        requestBody,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      const translations = response.data?.data?.translations || [];

      if (translations.length !== textsToTranslate.length) {
        return res.status(502).json({
          success: false,
          message: "Unexpected translation response",
        });
      }

      translations.forEach((item, index) => {
        const translatedText = item?.translatedText || textsToTranslate[index];
        const { key, cacheKey } = keyOrder[index];

        translatedTexts[key] = translatedText;
        translationCache.set(cacheKey, {
          value: translatedText,
          createdAt: Date.now(),
        });
      });
    }

    return res.json({
      success: true,
      targetLanguage,
      sourceLanguage: sourceLanguage || "auto",
      translatedTexts,
    });
  } catch (error) {
    console.error("❌ [UI_TRANSLATE] Translation failed:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Translation request failed",
      details: error.response?.data?.error?.message || error.message,
    });
  }
});

module.exports = router;
