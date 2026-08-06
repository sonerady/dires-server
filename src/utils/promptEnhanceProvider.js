// ───────────────────────────────────────────────────────────────────────────
// Prompt Enhance Provider — tek merkezi dispatcher
//
// Tüm route'lar prompt enhance için Gemini 3 Flash'ı buradan çağırır.
// app_config.prompt_enhance_provider değerine göre seçim yapılır:
//   "gemini"    (default) → OpenRouter üzerinden google/gemini-3-flash-preview
//   "replicate"           → Replicate üzerinden google/gemini-3-flash (eski davranış)
//
// OpenRouter başarısız olursa güvenli fallback olarak Replicate denenir.
// Sağlayıcı seçimi kısa süreli (60 sn) cache'lenir; her çağrıda DB'ye gidilmez.
// ───────────────────────────────────────────────────────────────────────────

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// Supabase (app_config okumak için)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const OPENROUTER_GEMINI_MODEL = "google/gemini-3-flash-preview";
const REPLICATE_GEMINI_MODEL = "google/gemini-3-flash";

// 🎯 Ortak system instruction — tüm prompt-enhance tüketicileri için kalite
// çıtası. Mode-nötr: görev brief'inin format kurallarına itaat eder.
const GEMINI_SYSTEM_INSTRUCTION = `You are an elite prompt writer for state-of-the-art AI image generation and editing models (the Gemini image family). Your single output is the final prompt text itself — never commentary, never explanations, never headers, rule labels, bullet lists, warning symbols, or quoted instructions. If the task specifies a required starting word, structure, or format, follow it exactly.

Write in fluent, natural English as flowing narrative prose, like a world-class photographer's shoot brief. Every sentence must add a concrete visual fact — a named fabric, a light source with direction and quality, a lens behavior, a surface texture, a color relationship. Use positive framing only: describe what IS in the frame, never list what is absent or forbidden.

When reference images are involved, treat the product/garment reference as the immutable source of truth — its colors, patterns, construction, proportions and details are reproduced exactly, never redesigned. Translate any raw parameter values you encounter (hex codes, underscore_keys, non-English labels) into natural English photographic language; they must never appear verbatim in your output.

Aim for imagery with genuine editorial character: decisive light, a confident grade, intentional composition — the kind of frame that belongs to a current high-end campaign, never a generic stock photo.`;

// ─── Sağlayıcı seçimi (app_config) — 60 sn cache ───
let _providerCache = { value: null, at: 0 };
const PROVIDER_TTL_MS = 60 * 1000;

async function getPromptEnhanceProvider() {
  const now = Date.now();
  if (_providerCache.value && now - _providerCache.at < PROVIDER_TTL_MS) {
    return _providerCache.value;
  }

  let provider = "gemini"; // default
  try {
    const { data } = await supabase
      .from("app_config")
      .select("prompt_enhance_provider")
      .limit(1)
      .maybeSingle();
    if (
      data &&
      typeof data.prompt_enhance_provider === "string" &&
      data.prompt_enhance_provider.trim()
    ) {
      provider = data.prompt_enhance_provider.trim().toLowerCase();
    }
  } catch (e) {
    // kolon yoksa PostgREST hata fırlatır — key/value fallback'i dene
    try {
      const { data } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "prompt_enhance_provider")
        .maybeSingle();
      if (data && typeof data.value === "string" && data.value.trim()) {
        provider = data.value.trim().toLowerCase();
      }
    } catch (e2) {}
  }

  _providerCache = { value: provider, at: now };
  return provider;
}

// ─── OpenRouter Gemini Flash ───
async function callOpenRouterGeminiFlash(
  prompt,
  imageUrls = [],
  maxRetries = 3,
  systemInstruction = GEMINI_SYSTEM_INSTRUCTION,
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set");
  }
  const userContent = [
    { type: "text", text: prompt },
    ...(imageUrls || [])
      .filter(Boolean)
      .map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: userContent });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🤖 [OPENROUTER-GEMINI] attempt ${attempt}/${maxRetries} (model: ${OPENROUTER_GEMINI_MODEL}, images: ${userContent.length - 1})`,
      );
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: OPENROUTER_GEMINI_MODEL,
          messages,
          temperature: 1,
          top_p: 0.95,
          max_tokens: 65535,
          reasoning: { effort: "low", exclude: true },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://diress.ai",
            "X-OpenRouter-Title": "Diress",
          },
          timeout: 120000,
        },
      );
      const content = response.data?.choices?.[0]?.message?.content;
      const outputText = (Array.isArray(content)
        ? content
            .map((part) => (typeof part === "string" ? part : part?.text || ""))
            .join("")
        : content || ""
      ).trim();
      if (!outputText) throw new Error("OpenRouter Gemini response is empty");

      console.log(`✅ [OPENROUTER-GEMINI] Başarılı (attempt ${attempt})`);
      return outputText;
    } catch (error) {
      const detail = error.response?.data?.error?.message || error.message;
      console.error(`❌ [OPENROUTER-GEMINI] attempt ${attempt} failed:`, detail);
      if (attempt === maxRetries) throw error;
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ─── Replicate Gemini Flash (eski davranış / fallback) ───
async function callReplicateGeminiFlashRaw(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [REPLICATE-GEMINI] attempt ${attempt}/${maxRetries}`);
      const response = await axios.post(
        `https://api.replicate.com/v1/models/${REPLICATE_GEMINI_MODEL}/predictions`,
        {
          input: {
            top_p: 0.95,
            images: imageUrls || [],
            prompt: prompt,
            videos: [],
            temperature: 1,
            thinking_level: "low",
            max_output_tokens: 65535,
            system_instruction: GEMINI_SYSTEM_INSTRUCTION,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 120000,
        },
      );

      const data = response.data;
      if (data.error) throw new Error(data.error);
      if (data.status !== "succeeded") {
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      let outputText = "";
      if (Array.isArray(data.output)) outputText = data.output.join("");
      else if (typeof data.output === "string") outputText = data.output;

      if (!outputText || outputText.trim() === "") {
        throw new Error("Replicate Gemini response is empty");
      }

      console.log(`✅ [REPLICATE-GEMINI] Başarılı (attempt ${attempt})`);
      return outputText.trim();
    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ─── Dispatcher — app_config seçimine göre OpenRouter veya Replicate ───
async function callGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const provider = await getPromptEnhanceProvider();

  if (provider === "replicate") {
    console.log("🔀 [PROMPT_ENHANCE] Provider: replicate");
    return callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
  }

  console.log("🔀 [PROMPT_ENHANCE] Provider: gemini (OpenRouter)");
  try {
    return await callOpenRouterGeminiFlash(prompt, imageUrls, maxRetries);
  } catch (err) {
    console.error(
      "⚠️ [PROMPT_ENHANCE] OpenRouter Gemini başarısız, Replicate'e fallback:",
      err.message,
    );
    return callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
  }
}

module.exports = {
  callGeminiFlash,
  getPromptEnhanceProvider,
  callOpenRouterGeminiFlash,
  OPENROUTER_GEMINI_MODEL,
  GEMINI_SYSTEM_INSTRUCTION,
};
