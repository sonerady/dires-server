// ───────────────────────────────────────────────────────────────────────────
// Prompt Enhance Provider — tek merkezi dispatcher
//
// Tüm route'lar prompt enhance için Gemini Flash'ı buradan çağırır.
// app_config.prompt_enhance_provider değerine göre seçim yapılır:
//   "gemini"    (default) → OpenRouter üzerinden google/gemini-3.7-flash
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

// 13 Ağu 2026 (kullanıcı kararı): prompt enhance + stil sentezi Gemini 3.7 Flash.
// Slug OpenRouter /api/v1/models listesinden doğrulandı.
const OPENROUTER_GEMINI_MODEL = "google/gemini-3.7-flash";
// 19 Ağu 2026 (kullanıcı kararı): EKLENTİ/stil-profili akışı Luna'ya taşındı —
// Luna 30 Tem'deki %80 indirimle en ucuz seçenek ($0.20/$1.20 per 1M).
const OPENROUTER_LUNA_MODEL = "openai/gpt-5.6-luna";
const REPLICATE_GEMINI_MODEL = "google/gemini-3-flash";

// 🎯 Ortak system instruction — tüm prompt-enhance tüketicileri için kalite
// çıtası. Mode-nötr: görev brief'inin format kurallarına itaat eder.
const GEMINI_SYSTEM_INSTRUCTION = `You are an elite prompt writer for state-of-the-art AI image generation and editing models (the Gemini image family). Your single output is the final prompt text itself — never commentary, never explanations, never headers, rule labels, bullet lists, warning symbols, or quoted instructions. If the task specifies a required starting word, structure, or format, follow it exactly.

Write in fluent, natural English as flowing narrative prose, like a world-class photographer's shoot brief. Every sentence must add a concrete visual fact — a named fabric, a light source with direction and quality, a lens behavior, a surface texture, a color relationship. Use positive framing only: describe what IS in the frame, never list what is absent or forbidden.

When reference images are involved, treat the product/garment reference as the immutable source of truth — its colors, patterns, construction, proportions and details are reproduced exactly, never redesigned. Translate any raw parameter values you encounter (hex codes, underscore_keys, non-English labels) into natural English photographic language; they must never appear verbatim in your output.

Aim for imagery with genuine editorial character: decisive light, a confident grade, intentional composition — the kind of frame that belongs to a current high-end campaign, never a generic stock photo.`;

const VISION_CLASSIFIER_SYSTEM_INSTRUCTION = `You are a precise visual classifier, not a prompt writer. Follow the requested output format exactly. Return only the classification value requested by the user, with no prose, explanation, punctuation, markdown, or additional words.`;

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
  generationOptions = {},
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
      const routedModel = generationOptions.model || OPENROUTER_GEMINI_MODEL;
      console.log(
        `🤖 [OPENROUTER-GEMINI] attempt ${attempt}/${maxRetries} (model: ${routedModel}, images: ${userContent.length - 1})`,
      );
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: routedModel,
          messages,
          temperature: generationOptions.temperature ?? 1,
          top_p: generationOptions.topP ?? 0.95,
          max_tokens: generationOptions.maxOutputTokens ?? 65535,
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
      const baseWaitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      const waitTime = baseWaitTime + Math.floor(Math.random() * 750);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ─── DeepSeek (eklenti stil akışı — 22 Ağu 2026 kullanıcı kararı) ───
// OpenAI-uyumlu chat/completions. Görsel varsa vision modeli, yoksa düz flash.
// Görseller public URL olarak gönderilir (DeepSeek http(s) URL kabul ediyor;
// ≤32 MiB, 60 sn indirme penceresi). Fiyat avantajı: input $0.22-0.44/1M,
// output $0.66-1.32/1M — Replicate Gemini'nin ($0.50/$3.00) yaklaşık yarısı/dörtte biri.
const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";
const DEEPSEEK_TEXT_MODEL = "deepseek-v4-flash";

async function callDeepSeekFlashRaw(
  prompt,
  imageUrls = [],
  maxRetries = 3,
  systemInstruction = GEMINI_SYSTEM_INSTRUCTION,
  generationOptions = {},
) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY environment variable is not set");
  }

  const images = (imageUrls || []).filter(Boolean);
  const model = images.length > 0 ? DEEPSEEK_VISION_MODEL : DEEPSEEK_TEXT_MODEL;
  const userContent = [
    { type: "text", text: prompt },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: userContent });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🐋 [DEEPSEEK] attempt ${attempt}/${maxRetries} (model: ${model}, images: ${images.length})`,
      );
      const response = await axios.post(
        "https://api.deepseek.com/chat/completions",
        {
          model,
          messages,
          temperature: generationOptions.temperature ?? 1,
          top_p: generationOptions.topP ?? 0.95,
          max_tokens: generationOptions.maxOutputTokens ?? 8192,
          // v4-flash varsayılanı REASONING — görünmez düşünme tokenları çıktı
          // bütçesinden düşer, dar bütçede cevap boş kalır (Luna dersinin aynısı,
          // 22 Ağu'da canlı doğrulandı: 10 token bütçede content="" geldi).
          thinking: { type: "disabled" },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 120000,
        },
      );
      const outputText = (response.data?.choices?.[0]?.message?.content || "").trim();
      if (!outputText) throw new Error("DeepSeek response is empty");

      console.log(`✅ [DEEPSEEK] Başarılı (attempt ${attempt})`);
      return outputText;
    } catch (error) {
      const detail = error.response?.data?.error?.message || error.message;
      console.error(`❌ [DEEPSEEK] attempt ${attempt} failed:`, detail);
      if (attempt === maxRetries) throw error;
      const baseWaitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      const waitTime = baseWaitTime + Math.floor(Math.random() * 750);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ─── Replicate Gemini Flash (eski davranış / fallback) ───
async function callReplicateGeminiFlashRaw(
  prompt,
  imageUrls = [],
  maxRetries = 3,
  generationOptions = {},
) {
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
            temperature: generationOptions.temperature ?? 1,
            thinking_level: "low",
            max_output_tokens: generationOptions.maxOutputTokens ?? 65535,
            system_instruction:
              generationOptions.systemInstruction || GEMINI_SYSTEM_INSTRUCTION,
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
      // Aynı profil için paralel başlayan başlık/etiket/kategori görevleri aynı
      // anda tekrar Replicate'e yüklenmesin; exponential backoff'a jitter ekle.
      const baseWaitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      const waitTime = baseWaitTime + Math.floor(Math.random() * 750);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ─── Dispatcher ───
// 17 Ağu 2026 (kullanıcı kararı): app_config.prompt_enhance_provider YENİDEN
// OKUNUYOR. 13 Ağu'da sağlayıcı OpenRouter'a sabitlenmişti; OpenRouter bakiyesi
// bitince (402) her çağrı önce 10 boş denemeyle sürünüp sonra fallback'e
// düşüyordu. Artık config ne diyorsa ORAYA gidilir, diğeri yalnız yedektir —
// böylece sağlayıcı değiştirmek için kod deploy'u gerekmez, DB'den yeter.
//   "replicate" → Replicate google/gemini-3-flash (yedek: OpenRouter)
//   "gemini"    → OpenRouter google/gemini-3.7-flash (yedek: Replicate)
async function callGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const provider = await getPromptEnhanceProvider();
  const useReplicateFirst = provider === "replicate";
  console.log(
    `🔀 [PROMPT_ENHANCE] Provider: ${useReplicateFirst ? "Replicate (gemini-3-flash)" : "OpenRouter (gemini-3.7-flash)"} — app_config: "${provider}"`,
  );
  if (useReplicateFirst) {
    try {
      return await callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
    } catch (err) {
      console.error(
        "⚠️ [PROMPT_ENHANCE] Replicate Gemini başarısız, OpenRouter'a fallback:",
        err.message,
      );
      return callOpenRouterGeminiFlash(prompt, imageUrls, maxRetries);
    }
  }
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

// ─── Luna (stil-profili / eklenti akışı) ───
// 19 Ağu 2026: auto-style eklentisinden gelen profil oluşturma işleri
// (stil sentezi, başlık, etiket, kategori, yaş tahmini) Luna'ya gider —
// app_config'ten BAĞIMSIZ (o ayar üretim prompt-enhance'ini yönetmeye devam
// eder). Luna başarısız olursa eski Gemini zinciri devreye girer ki profil
// oluşturma asla bloklanmasın.
async function callLunaFlash(prompt, imageUrls = [], maxRetries = 3) {
  try {
    console.log(`🌙 [LUNA-STYLE] Stil işi Luna'ya gidiyor (${OPENROUTER_LUNA_MODEL})`);
    return await callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      maxRetries,
      GEMINI_SYSTEM_INSTRUCTION,
      { model: OPENROUTER_LUNA_MODEL },
    );
  } catch (err) {
    console.error(
      "⚠️ [LUNA-STYLE] Luna başarısız, Gemini zincirine fallback:",
      err.message,
    );
    return callGeminiFlash(prompt, imageUrls, maxRetries);
  }
}

async function callLunaVisionClassifierRaw(prompt, imageUrls = [], maxRetries = 3) {
  try {
    console.log(`🌙 [LUNA-CLASSIFIER] Sınıflandırma Luna'ya gidiyor`);
    return await callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      maxRetries,
      VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
      {
        model: OPENROUTER_LUNA_MODEL,
        temperature: 0,
        // Luna'nın görünmez reasoning tokenları bütçeden düşebiliyor
        // (13 Ağu dersi) — reasoning zaten exclude, bütçe yine de geniş.
        maxOutputTokens: 300,
      },
    );
  } catch (err) {
    console.error(
      "⚠️ [LUNA-CLASSIFIER] Luna başarısız, Gemini zincirine fallback:",
      err.message,
    );
    return callGeminiVisionClassifier(prompt, imageUrls, maxRetries);
  }
}

// ─── Stil akışı (eklenti / stil profilleri) — DeepSeek-first ───
// 22 Ağu 2026 (kullanıcı kararı): eklentinin prompt üretimi DeepSeek'e taşındı
// ("en azından şimdilik") — maliyet Replicate Gemini'nin ~yarısı/dörtte biri.
// app_config'ten BAĞIMSIZ. DeepSeek başarısız olursa eski zincir devrededir
// (Replicate Gemini → OpenRouter) ki profil oluşturma asla bloklanmasın.
// (20 Ağu kararı olan Replicate-first bu kararla değiştirildi.)
async function callReplicateStyleFlash(prompt, imageUrls = [], maxRetries = 3) {
  try {
    console.log(`🐋 [DEEPSEEK-STYLE] Stil işi DeepSeek'e gidiyor`);
    return await callDeepSeekFlashRaw(prompt, imageUrls, maxRetries);
  } catch (deepseekErr) {
    console.error(
      "⚠️ [DEEPSEEK-STYLE] DeepSeek başarısız, Replicate'e fallback:",
      deepseekErr.message,
    );
  }
  try {
    console.log(
      `🔁 [REPLICATE-STYLE] Stil işi Replicate'e gidiyor (${REPLICATE_GEMINI_MODEL})`,
    );
    return await callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
  } catch (err) {
    console.error(
      "⚠️ [REPLICATE-STYLE] Replicate başarısız, OpenRouter'a fallback:",
      err.message,
    );
    // ⚠️ OpenRouter bakiyesi çok düşük (20 Ağu): 65535 token'lık varsayılan
    // istek "can only afford ~8589" ile reddediliyor ve 10 deneme boşa
    // yanıyordu. Yedekte bütçe 8000'e çekilir (bu limitte istek GEÇER) ve
    // deneme sayısı 2 ile sınırlanır — yedek sessiz ve işlevsel kalır.
    return callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      Math.min(maxRetries, 2),
      GEMINI_SYSTEM_INSTRUCTION,
      { maxOutputTokens: 8000 },
    );
  }
}

async function callReplicateStyleVisionClassifier(
  prompt,
  imageUrls = [],
  maxRetries = 3,
) {
  const generationOptions = {
    temperature: 0,
    // Replicate Gemini'nin düşük seviyeli thinking tokenları da bu bütçeden
    // düşer; çok dar bütçe görünür cevap üretilmeden tükenebiliyor.
    maxOutputTokens: 256,
    systemInstruction: VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
  };
  try {
    console.log(`🐋 [DEEPSEEK-STYLE-CLASSIFIER] Sınıflandırma DeepSeek'e gidiyor`);
    return await callDeepSeekFlashRaw(
      prompt,
      imageUrls,
      maxRetries,
      VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
      generationOptions,
    );
  } catch (deepseekErr) {
    console.error(
      "⚠️ [DEEPSEEK-STYLE-CLASSIFIER] DeepSeek başarısız, Replicate'e fallback:",
      deepseekErr.message,
    );
  }
  try {
    console.log(`🔁 [REPLICATE-STYLE-CLASSIFIER] Sınıflandırma Replicate'e gidiyor`);
    return await callReplicateGeminiFlashRaw(
      prompt,
      imageUrls,
      maxRetries,
      generationOptions,
    );
  } catch (err) {
    console.error(
      "⚠️ [REPLICATE-STYLE-CLASSIFIER] Replicate başarısız, OpenRouter'a fallback:",
      err.message,
    );
    // Bütçe zaten 256 token (bakiyeye sığar); yalnız deneme sayısı kırpılır.
    return callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      Math.min(maxRetries, 2),
      VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
      generationOptions,
    );
  }
}

// Kısa, yapılandırılmış görsel sınıflandırma görevleri için prompt-yazarı
// talimatını kullanma. Düşük sıcaklık ve dar çıktı bütçesi, yaş gibi sonuçların
// serbest metne dönüşmesini engeller.
async function callGeminiVisionClassifier(
  prompt,
  imageUrls = [],
  maxRetries = 3,
) {
  const generationOptions = {
    temperature: 0,
    // Replicate Gemini'nin düşük seviyeli thinking tokenları da bu bütçeden
    // düşer; çok dar bütçe görünür cevap üretilmeden tükenebiliyor.
    maxOutputTokens: 256,
    systemInstruction: VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
  };

  // Sağlayıcı app_config'ten (17 Ağu 2026) — prompt enhance ile aynı ayar.
  const provider = await getPromptEnhanceProvider();
  const useReplicateFirst = provider === "replicate";
  console.log(
    `🔀 [VISION_CLASSIFIER] Provider: ${useReplicateFirst ? "Replicate" : "OpenRouter"} — app_config: "${provider}"`,
  );
  if (useReplicateFirst) {
    try {
      return await callReplicateGeminiFlashRaw(
        prompt,
        imageUrls,
        maxRetries,
        generationOptions,
      );
    } catch (err) {
      console.error(
        "⚠️ [VISION_CLASSIFIER] Replicate başarısız, OpenRouter'a fallback:",
        err.message,
      );
      return callOpenRouterGeminiFlash(
        prompt,
        imageUrls,
        maxRetries,
        VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
        generationOptions,
      );
    }
  }
  try {
    return await callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      maxRetries,
      VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
      generationOptions,
    );
  } catch (err) {
    console.error(
      "⚠️ [VISION_CLASSIFIER] OpenRouter başarısız, Replicate'e fallback:",
      err.message,
    );
    return callReplicateGeminiFlashRaw(
      prompt,
      imageUrls,
      maxRetries,
      generationOptions,
    );
  }
}

module.exports = {
  callDeepSeekFlashRaw,
  callGeminiFlash,
  callGeminiVisionClassifier,
  callLunaFlash,
  callLunaVisionClassifier: callLunaVisionClassifierRaw,
  callReplicateStyleFlash,
  callReplicateStyleVisionClassifier,
  getPromptEnhanceProvider,
  callOpenRouterGeminiFlash,
  OPENROUTER_GEMINI_MODEL,
  GEMINI_SYSTEM_INSTRUCTION,
  VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
};
