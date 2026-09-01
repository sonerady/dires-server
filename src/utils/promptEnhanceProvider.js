// ───────────────────────────────────────────────────────────────────────────
// Prompt Enhance Provider — tek merkezi dispatcher
//
// Tüm route'lar prompt enhance için buradan çağrı yapar.
// app_config.prompt_enhance_provider değerine göre seçim yapılır:
//   "replicate" (varsayılan) → Replicate üzerinden google/gemini-3-flash
//   "deepseek"               → DeepSeek (vision varsa v4-flash-vision-exp)
//
// ⚠️ 1 Eyl 2026 (kullanıcı kararı): DOĞRUDAN OPENROUTER YOLU TAMAMEN KALDIRILDI
// (hesap artık kullanılmıyor). Geriye iki sağlayıcı kaldı ve biri diğerinin
// yedeği: Replicate ⇄ DeepSeek. Eski "gemini" config değeri artık Replicate'e
// eşlenir. (fal üzerinden giden "openrouter/router/vision" GEÇİDİ bundan
// bağımsızdır — o fal faturasına yazılır ve yerinde durur.)
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

const REPLICATE_GEMINI_MODEL = "google/gemini-3-flash";

// 🎯 Ortak system instruction — tüm prompt-enhance tüketicileri için kalite
// çıtası. Mode-nötr: görev brief'inin format kurallarına itaat eder.
const GEMINI_SYSTEM_INSTRUCTION = `You are an elite prompt writer for state-of-the-art AI image generation and editing models (the Gemini image family). Your single output is the final prompt text itself — never commentary, never explanations, never headers, rule labels, bullet lists, warning symbols, or quoted instructions. If the task specifies a required starting word, structure, or format, follow it exactly.

Write in fluent, natural English as flowing narrative prose, like a world-class photographer's shoot brief. Every sentence must add a concrete visual fact — a named fabric, a light source with direction and quality, a lens behavior, a surface texture, a color relationship. Use positive framing only: describe what IS in the frame, never list what is absent or forbidden.

When reference images are involved, treat the product/garment reference as the immutable source of truth — its colors, patterns, construction, proportions and details are reproduced exactly, never redesigned. Translate any raw parameter values you encounter (hex codes, underscore_keys, non-English labels) into natural English photographic language; they must never appear verbatim in your output.

Aim for imagery with genuine editorial character: decisive light, a confident grade, intentional composition — the kind of frame that belongs to a current high-end campaign, never a generic stock photo.`;

// 🚫 GEÇERSİZ GİRDİ (E006) — TEKRAR DENEME YOK, DOĞRUDAN DEEPSEEK
// (1 Eyl 2026 kullanıcı kararı)
//
// Replicate/Gemini bazı isteklere "Async prediction failed: ModelError: The input
// was invalid. Please try again with different inputs. (E006)" döndürüyor. Bu
// DETERMİNİSTİK bir rettir: aynı prompt + aynı görsellerle tekrar denemek her
// seferinde aynı cevabı verir, sadece 3 deneme + backoff kadar gecikme üretir.
// Bu yüzden bu imza görülür görülmez deneme yapılmaz; iş beklemeden diğer
// sağlayıcıya (Replicate ⇄ DeepSeek) geçer.
function extractErrorText(error) {
  const raw = error?.response?.data?.error;
  return [
    error?.message,
    typeof raw === "string" ? raw : raw?.message,
    error?.response?.data?.detail,
    typeof error?.response?.data === "string" ? error.response.data : null,
  ]
    .filter((v) => typeof v === "string" && v)
    .join(" ");
}

function isInvalidInputError(error) {
  const text = extractErrorText(error).toLowerCase();
  if (!text) return false;
  return (
    /\(?\be006\b\)?/.test(text) ||
    text.includes("input was invalid") ||
    text.includes("invalid input")
  );
}

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
      // Replicate hata gövdesi obje de olabilir; string'e çevirmezsek mesaj
      // "[object Object]" olur ve E006 imzası kaybolur.
      if (data.error) {
        throw new Error(
          typeof data.error === "string" ? data.error : JSON.stringify(data.error),
        );
      }
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
      // E006 "input was invalid": aynı girdiyle tekrar denemek anlamsız —
      // döngü kırılır, dispatcher DeepSeek'e geçer.
      if (isInvalidInputError(error)) {
        console.error(
          "🚫 [REPLICATE-GEMINI] Geçersiz girdi (E006) — tekrar denenmiyor",
        );
        throw error;
      }
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
// 1 Eyl 2026 (kullanıcı kararı): OpenRouter kaldırıldı. Geriye iki sağlayıcı
// kaldı ve app_config.prompt_enhance_provider hangisinin ÖNCE deneneceğini
// seçer; diğeri her zaman yedektir:
//   "replicate" (varsayılan) → Replicate google/gemini-3-flash (yedek: DeepSeek)
//   "deepseek"               → DeepSeek (yedek: Replicate)
// Eski "gemini" değeri artık Replicate'e eşlenir — DB'de kalmış olması üretimi
// bozmaz, yalnız log'a not düşülür.
async function callGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const provider = await getPromptEnhanceProvider();
  const useReplicateFirst = provider !== "deepseek";
  console.log(
    `🔀 [PROMPT_ENHANCE] Provider: ${useReplicateFirst ? `Replicate (${REPLICATE_GEMINI_MODEL})` : "DeepSeek"} — app_config: "${provider}"`,
  );

  const stages = {
    replicate: () => callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries),
    // Yedek çağrıda deneme sayısı kısılır: istek zaten gecikmiş durumda.
    deepseek: () =>
      callDeepSeekFlashRaw(prompt, imageUrls, Math.min(maxRetries, 2)),
  };
  const primary = useReplicateFirst ? "replicate" : "deepseek";
  const fallback = useReplicateFirst ? "deepseek" : "replicate";

  try {
    return await stages[primary]();
  } catch (primaryErr) {
    // 🚫 E006 geldiyse tekrar denenmedi — doğrudan diğer sağlayıcıya geçilir.
    const invalidInput = isInvalidInputError(primaryErr);
    console.error(
      `⚠️ [PROMPT_ENHANCE] ${primary} başarısız${invalidInput ? " (geçersiz girdi/E006 — tekrar denenmedi)" : ""}: ${primaryErr.message} → yedek: ${fallback}`,
    );
    return stages[fallback]();
  }
}

// ─── Stil akışı (eklenti / stil profilleri) — DeepSeek-first ───
// 22 Ağu 2026 (kullanıcı kararı): eklentinin prompt üretimi DeepSeek'e taşındı
// ("en azından şimdilik") — maliyet Replicate Gemini'nin ~yarısı/dörtte biri.
// app_config'ten BAĞIMSIZ. DeepSeek başarısız olursa eski zincir devrededir
// (yedek: Replicate Gemini) ki profil oluşturma asla bloklanmasın.
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
  console.log(
    `🔁 [REPLICATE-STYLE] Stil işi Replicate'e gidiyor (${REPLICATE_GEMINI_MODEL})`,
  );
  return callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries);
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
  console.log(`🔁 [REPLICATE-STYLE-CLASSIFIER] Sınıflandırma Replicate'e gidiyor`);
  return callReplicateGeminiFlashRaw(
    prompt,
    imageUrls,
    maxRetries,
    generationOptions,
  );
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

  // Sağlayıcı app_config'ten — prompt enhance ile aynı ayar (OpenRouter 1 Eyl'de
  // kaldırıldı; "deepseek" dışındaki her değer Replicate demektir).
  const provider = await getPromptEnhanceProvider();
  const useReplicateFirst = provider !== "deepseek";
  console.log(
    `🔀 [VISION_CLASSIFIER] Provider: ${useReplicateFirst ? "Replicate" : "DeepSeek"} — app_config: "${provider}"`,
  );

  const stages = {
    replicate: () =>
      callReplicateGeminiFlashRaw(prompt, imageUrls, maxRetries, generationOptions),
    deepseek: () =>
      callDeepSeekFlashRaw(
        prompt,
        imageUrls,
        Math.min(maxRetries, 2),
        VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
        generationOptions,
      ),
  };
  const primary = useReplicateFirst ? "replicate" : "deepseek";
  const fallback = useReplicateFirst ? "deepseek" : "replicate";

  try {
    return await stages[primary]();
  } catch (err) {
    console.error(
      `⚠️ [VISION_CLASSIFIER] ${primary} başarısız${isInvalidInputError(err) ? " (geçersiz girdi/E006 — tekrar denenmedi)" : ""}: ${err.message} → yedek: ${fallback}`,
    );
    return stages[fallback]();
  }
}

module.exports = {
  callDeepSeekFlashRaw,
  isInvalidInputError,
  callGeminiFlash,
  callGeminiVisionClassifier,
  callReplicateStyleFlash,
  callReplicateStyleVisionClassifier,
  getPromptEnhanceProvider,
  GEMINI_SYSTEM_INSTRUCTION,
  VISION_CLASSIFIER_SYSTEM_INSTRUCTION,
};
