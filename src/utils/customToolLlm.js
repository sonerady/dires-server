// 🧠 "Kendi aracını oluştur" — dil modeli köprüsü (24 Eyl 2026, kullanıcı kararı:
// Astra yerine Claude Opus 5.5).
//
// YOL: fal → "openrouter/router/vision" geçidi → OpenRouter → anthropic/claude-opus-5.5
// Fatura fal kredisine yazılır (1 Eyl 2026 kararı; Banner Stüdyosu da Claude'u bu
// yoldan kullanıyor). Doğrudan Anthropic anahtarı sunucuda yok. Geçit tarafında
// `reasoning` zorunlu: düşünme token'ları max_tokens'tan yer, bütçeler buna göre geniş.
// Model deploy'suz değiştirilebilir: CUSTOM_TOOL_LLM_MODEL.
const { askAstra } = require('./menuStudioAstra');

const CUSTOM_TOOL_MODEL = process.env.CUSTOM_TOOL_LLM_MODEL || 'anthropic/claude-opus-5.5';

function askToolModel({ tag = 'CUSTOM_TOOL', maxRetries = 2, timeoutMs = 240000, ...options } = {}) {
  return askAstra({ model: CUSTOM_TOOL_MODEL, maxRetries, timeoutMs, tag, ...options });
}

module.exports = { CUSTOM_TOOL_MODEL, askToolModel };
