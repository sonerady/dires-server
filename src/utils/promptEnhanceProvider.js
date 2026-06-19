// ───────────────────────────────────────────────────────────────────────────
// Prompt Enhance Provider — tek merkezi dispatcher
//
// Tüm route'lar prompt enhance için Gemini 3 Flash'ı buradan çağırır.
// app_config.prompt_enhance_provider değerine göre seçim yapılır:
//   "gemini"    (default) → Google'ın kendi Gemini API'si (yeni @google/genai SDK,
//                           GOOGLE_AISTUDIO_KEY → yoksa GEMINI_API_KEY), model: gemini-3.5-flash
//   "replicate"           → Replicate üzerinden google/gemini-3-flash (eski davranış)
//
// Google başarısız olursa güvenli fallback olarak Replicate denenir.
// Sağlayıcı seçimi kısa süreli (60 sn) cache'lenir; her çağrıda DB'ye gidilmez.
// ───────────────────────────────────────────────────────────────────────────

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI } = require("@google/genai");

// Supabase (app_config okumak için)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Google AI Studio (direkt Gemini) — ayrı kısıtsız key, yoksa eski GEMINI_API_KEY
const googleAiStudio = new GoogleGenAI({
  apiKey: process.env.GOOGLE_AISTUDIO_KEY || process.env.GEMINI_API_KEY,
});

// Replicate'teki google/gemini-3-flash yerine stabil Gemini 3.5 Flash
const GEMINI_DIRECT_MODEL = "gemini-3.5-flash";

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

// ─── Google direkt Gemini Flash (yeni @google/genai SDK) ───
async function callGoogleGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  if (!process.env.GOOGLE_AISTUDIO_KEY && !process.env.GEMINI_API_KEY) {
    throw new Error(
      "GOOGLE_AISTUDIO_KEY (veya GEMINI_API_KEY) environment variable is not set",
    );
  }

  // Görsel URL'lerini indirip base64 inlineData'ya çevir (Google direkt API URL kabul etmez)
  const imageParts = [];
  for (const url of imageUrls || []) {
    if (!url) continue;
    try {
      const imgResp = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      const mimeType =
        imgResp.headers["content-type"]?.split(";")[0]?.trim() || "image/jpeg";
      imageParts.push({
        inlineData: {
          mimeType,
          data: Buffer.from(imgResp.data).toString("base64"),
        },
      });
    } catch (imgErr) {
      console.error(
        `❌ [GOOGLE-GEMINI] Görsel indirilemedi (${String(url).substring(0, 80)}):`,
        imgErr.message,
      );
    }
  }

  const parts = [{ text: prompt }, ...imageParts];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🤖 [GOOGLE-GEMINI] attempt ${attempt}/${maxRetries} (model: ${GEMINI_DIRECT_MODEL}, images: ${imageParts.length})`,
      );
      const response = await googleAiStudio.models.generateContent({
        model: GEMINI_DIRECT_MODEL,
        contents: [{ role: "user", parts }],
        config: { temperature: 1, topP: 0.95, maxOutputTokens: 65535 },
      });

      const outputText = (response.text || "").trim();
      if (!outputText) throw new Error("Google Gemini response is empty");

      console.log(`✅ [GOOGLE-GEMINI] Başarılı (attempt ${attempt})`);
      return outputText;
    } catch (error) {
      console.error(`❌ [GOOGLE-GEMINI] attempt ${attempt} failed:`, error.message);
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
        "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
        {
          input: {
            top_p: 0.95,
            images: imageUrls || [],
            prompt: prompt,
            videos: [],
            temperature: 1,
            thinking_level: "low",
            max_output_tokens: 65535,
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

// ─── Dispatcher — app_config seçimine göre Google direkt veya Replicate ───
async function callGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const provider = await getPromptEnhanceProvider();

  if (provider === "replicate") {
    console.log("🔀 [PROMPT_ENHANCE] Provider: replicate");
    return callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
  }

  console.log("🔀 [PROMPT_ENHANCE] Provider: gemini (Google direkt)");
  try {
    return await callGoogleGeminiFlash(prompt, imageUrls, maxRetries);
  } catch (err) {
    console.error(
      "⚠️ [PROMPT_ENHANCE] Google Gemini başarısız, Replicate'e fallback:",
      err.message,
    );
    return callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
  }
}

module.exports = {
  callGeminiFlash,
  getPromptEnhanceProvider,
  callGoogleGeminiFlash,
  GEMINI_DIRECT_MODEL,
};
