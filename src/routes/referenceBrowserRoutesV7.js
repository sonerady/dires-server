const express = require("express");
const router = express.Router();
const mime = require("mime");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { createCanvas, loadImage } = require("canvas");
const {
  sendGenerationCompletedNotification,
} = require("../services/pushNotificationService");
const teamService = require("../services/teamService");
const logger = require("../utils/logger");
const {
  startAutomaticTrialVariation,
} = require("./variationRoutes");
// app_config ile kapatıldığında sessizce atlamak için işaret hatası
class EditorialDisabled extends Error {}

const {
  isEditorialAvailable,
  isEditorialEnabledRemotely,
  shouldAttachCollages,
  getEditorialCollages,
  pickVariationDirective,
  buildEditorialPromptBlock,
} = require("../config/editorialStyle");
const { optimizeImageUrl } = require("../utils/imageOptimizer");
const {
  evaluatePrompt: evaluateSafetyPrompt,
  hardenPrompt: hardenSafetyPrompt,
  isSafetyTestUser,
  SAFETY_SYSTEM_PROMPT,
} = require("../utils/nudityGuard");
const {
  sanitizePromptForContentFilter,
  isContentFilter422,
} = require("../utils/promptContentFilter");
// 🛡️ Boş (bembeyaz) referans kolajını üretim başlamadan yakalar
const {
  isBlankImage,
  BLANK_REFERENCE_RESPONSE,
} = require("../utils/blankReferenceGuard");
const {
  appendUserInstructionLock,
  buildUserInstructionLock,
} = require("../utils/userInstructionLock");
const {
  callOpenRouterGeminiFlash,
} = require("../utils/promptEnhanceProvider");
// 🌟 Otomatik global stil — stil seçmeyen üretimlere gizli "house style" katmanı
const {
  isAutoGlobalStyleEnabled,
  pickAutoGlobalStyleProfile,
  buildAutoStyleSoftBlock,
  resolveProfileDisplayName,
  resolveUserAgeNumber,
  resolveAutoStyleMode,
  buildAutoStyleUsagePatch,
  countPriorSuccessfulAutoStyleUses,
  buildRepeatedAutoStylePoseDirective,
  buildAutoStyleGenderDirective,
  isAutoGlobalStyleEnabledForPlatform,
} = require("../utils/autoGlobalStyle");
const { normalizeCreationMode } = require("../utils/creationMode");
const {
  STYLE_REFERENCE_PLATE_VARIANT,
  isCurrentStyleReferencePlateUrl,
} = require("../utils/styleReferenceImage");

// Supabase istemci oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

logger.log(
  "🔑 Supabase Key Type:",
  process.env.SUPABASE_SERVICE_KEY ? "SERVICE_KEY" : "ANON_KEY",
);
logger.log("🔑 Key starts with:", supabaseKey?.substring(0, 20) + "...");

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// 🎯 Ortak system instruction — hem Replicate hem Google direkt enhance yolu
// kullanır. Mode-nötr yazıldı (normal replace, refiner, edit, color-change ve
// pose-change akışlarının hepsi buradan geçer): görev brief'inin format
// kurallarına itaat eder, kimlik + kalite çıtasını sabitler.
const GEMINI_SYSTEM_INSTRUCTION = `You are an elite prompt writer for state-of-the-art AI image generation and editing models (the Gemini image family). Your single output is the final prompt text itself — never commentary, never explanations, never headers, rule labels, bullet lists, warning symbols, or quoted instructions. If the task specifies a required starting word, structure, or format, follow it exactly.

Write in fluent, natural English as flowing narrative prose, like a world-class photographer's shoot brief. Every sentence must add a concrete visual fact — a named fabric, a light source with direction and quality, a lens behavior, a surface texture, a color relationship. Use positive framing only: describe what IS in the frame, never list what is absent or forbidden.

When reference images are involved, treat the product/garment reference as the immutable source of truth — its colors, patterns, construction, proportions and details are reproduced exactly, never redesigned. Translate any raw parameter values you encounter (hex codes, underscore_keys, non-English labels) into natural English photographic language; they must never appear verbatim in your output.

Photographic realism is non-negotiable. Ground every creative choice in real camera and material behavior: natural skin microtexture and anatomy, believable fabric physics, tangible environmental surfaces, physically consistent light direction and shadows, coherent perspective, plausible optics and unified photographic color science. Describe these properties specifically for the requested model, garment and setting instead of relying on the word "realistic" alone.

Aim for imagery with genuine editorial character: decisive light, a confident grade, intentional composition — the kind of frame that belongs to a current high-end campaign, never a generic stock photo.`;

// Her V7 üretim modunda (normal, stil referansı, renk/poz değişimi, refiner,
// backside, v1/v2) görsel modeline gitmeden önce eklenen ortak kalite tabanı.
// Gemini'nin "photorealistic" kelimesini yazması tek başına yeterli olmadığı
// için gerçekçiliği cilt, anatomi, kumaş, ortam, ışık ve kamera fiziği üzerinden
// somut ve denetlenebilir şekilde tarif eder.
const UNIVERSAL_PHOTOREALISM_DIRECTIVE = `PHOTOGRAPHIC REALISM — NON-NEGOTIABLE:
Render the result as an authentic professional photograph captured in one physically coherent real-world scene, never as synthetic AI imagery or a 3D render. When a human model is present, preserve anatomically correct proportions, natural posture and believable hands, fingers, eyes and teeth; render living skin with visible pores, fine vellus hair, subtle tonal variation and small natural imperfections, plus individually resolved hair strands and realistic contact between body and clothing.

GARMENT-TO-BODY & SCENE INTEGRATION — MANDATORY: Treat the product reference as the source of the garment's design, not as a flat layer to paste onto the model. Discard the source mannequin, hanger, display form, background, cutout edges and source-photo lighting completely. Reconstruct the exact garment as a real three-dimensional piece physically worn by the living model in the requested pose. Preserve its design, construction, colors, print and proportions while naturally adapting its worn geometry to the model's bust, waist, hips, shoulders and limbs through believable fabric thickness, weight, gravity, support and movement. Create pose-specific tension, compression, folds, drape, overlap, occlusion and contact shadows wherever fabric meets skin or another garment; hems and structured areas retain the stiffness appropriate to their actual material instead of holding the source mannequin silhouette. Prints, embroidery, seams, boning, trims and highlights follow the body's curved surface, perspective and fabric deformation without looking stretched, painted or projected. Relight the garment from scratch inside the final scene so its diffuse color, metallic or glossy response, highlights, shadows, bounce light and color cast come from the same sources that illuminate the model and environment. Skin-to-garment boundaries show natural pressure and contact, with no cutout edge, halo or pasted-on transition. The finished frame must look as though the model truly wore the garment when the photograph was captured, never as though the garment was composited afterward.

Render every garment or product with true-to-reference fabric weave, stitching, seams, thickness, weight, gravity-driven drape, tension folds, compression and contact shadows. Make every visible surface in the environment physically tangible with credible material texture, scale, perspective, atmospheric depth and grounded foot contact. Use one consistent, motivated lighting setup across the model, garment and environment: matching direction, softness, color temperature, exposure, cast shadows, bounce light, reflections and highlight roll-off. Use plausible photographic optics with coherent lens perspective, natural depth-of-field transition, realistic dynamic range and restrained sensor or film texture. All subjects and objects must share the same perspective, focus logic, color science, grain and illumination so the frame reads as a genuine high-end fashion photograph rather than a composited or generated image. Avoid waxy or airbrushed skin, mannequin stiffness, malformed anatomy, floating subjects, cutout halos, fake blur, oversharpening, inconsistent shadows, plastic fabric and sterile CGI surfaces.`;

function appendUniversalPhotorealism(prompt) {
  const base = String(prompt || "").trim();
  if (base.includes("PHOTOGRAPHIC REALISM — NON-NEGOTIABLE:")) {
    return base;
  }
  return `${base}\n\n${UNIVERSAL_PHOTOREALISM_DIRECTIVE}`.trim();
}

// Replicate API üzerinden Gemini Flash çağrısı yapan helper fonksiyon.
// Model: google/gemini-3-flash.
// Hata durumunda 3 kez tekrar dener
const REPLICATE_GEMINI_MODEL = "google/gemini-3-flash";

// 🏷️ Ürün tipi — yalnız bilinen üç değer kabul edilir; gerisi yok sayılır ki
// istemciden gelen serbest metin havuzu boşa düşürmesin.
const PRODUCT_CATEGORIES = ["shoes", "jewelry", "clothing"];
function normalizeProductCategory(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return PRODUCT_CATEGORIES.includes(v) ? v : null;
}

// Alt tür yalnız kendi kategorisinin sözlüğünden kabul edilir; yanlış eşleşme
// (ör. shoes + ring) filtreyi boş havuza düşürür.
const PRODUCT_SUBTYPES = {
  shoes: ["heels", "sneakers", "boots", "sandals", "flats", "loafers"],
  jewelry: ["ring", "necklace", "earring", "bracelet", "watch", "anklet"],
  clothing: ["dress","top","bottom","outerwear","knitwear","swimwear","lingerie","bag","accessory"],
};
// 🎨 Çekim tarzı SAYISAL enum (kullanıcı kararı 13 Ağu): 1 Editoryal ·
// 2 Sanatsal · 3 E-ticaret. İstemci sayı ya da metin ("2") gönderebilir.
function normalizeStyleApproach(raw) {
  const n = parseInt(raw, 10);
  // 4 = Sokak Stili (19 Ağu 2026)
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}
function normalizeProductSubtype(rawCategory, rawSubtype) {
  const cat = normalizeProductCategory(rawCategory);
  if (!cat) return null;
  const v = String(rawSubtype || "").trim().toLowerCase();
  return PRODUCT_SUBTYPES[cat].includes(v) ? v : null;
}
async function callReplicateGeminiFlash(
  prompt,
  imageUrls = [],
  maxRetries = 3,
) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(
        `🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries} (model: ${REPLICATE_GEMINI_MODEL})`,
      );

      // Debug: Request bilgilerini logla
      logger.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      logger.log(`🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`);

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls, // Direkt URL string array olarak gönder
          prompt: prompt,
          videos: [],
          temperature: 1,
          thinking_level: "low",
          max_output_tokens: 65535,
          system_instruction: GEMINI_SYSTEM_INSTRUCTION,
        },
      };

      const response = await axios.post(
        `https://api.replicate.com/v1/models/${REPLICATE_GEMINI_MODEL}/predictions`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 120000, // 2 dakika timeout
        },
      );

      const data = response.data;

      // Hata kontrolü
      if (data.error) {
        console.error(`❌ [REPLICATE-GEMINI] API error:`, data.error);
        throw new Error(data.error);
      }

      // Status kontrolü
      if (data.status !== "succeeded") {
        console.error(
          `❌ [REPLICATE-GEMINI] Prediction failed with status:`,
          data.status,
        );
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      // Output'u birleştir (array olarak geliyor)
      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        console.error(`❌ [REPLICATE-GEMINI] Empty response`);
        throw new Error("Replicate Gemini response is empty");
      }

      logger.log(
        `✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`,
      );
      logger.log(`📊 [REPLICATE-GEMINI] Metrics:`, data.metrics);

      return outputText.trim();
    } catch (error) {
      console.error(
        `❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`,
        error.message,
      );

      if (attempt === maxRetries) {
        console.error(
          `❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`,
        );
        throw error;
      }

      // Retry öncesi kısa bekleme (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// Prompt enhance sağlayıcısını app_config'ten oku: "gemini" (OpenRouter) | "replicate".
// Default: "gemini". is_gpt ile aynı esnek okuma: önce kolon, sonra key/value fallback.
async function getPromptEnhanceProvider() {
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
      return data.prompt_enhance_provider.trim().toLowerCase();
    }
  } catch (e) {
    // kolon yoksa PostgREST hata fırlatır — sessizce geç
  }
  try {
    const { data } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "prompt_enhance_provider")
      .maybeSingle();
    if (data && typeof data.value === "string" && data.value.trim()) {
      return data.value.trim().toLowerCase();
    }
  } catch (e) {}
  return "gemini"; // default: OpenRouter
}

// Prompt enhance dispatcher — 13 Ağu 2026 (kullanıcı kararı): app_config
// ARTIK OKUNMAZ, sağlayıcı SABİT OpenRouter (gemini-3.7-flash). Replicate yalnız
// OpenRouter başarısız olursa devreye giren güvenli fallback.
async function callGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  // 17 Ağu 2026 (kullanıcı kararı): app_config.prompt_enhance_provider YENİDEN
  // OKUNUYOR. 13 Ağu'da OpenRouter'a sabitlenmişti; bakiye bitince (402) her
  // çağrı boşuna deneyip fallback'e düşüyordu. Artık config neredeyse oraya
  // gidilir, diğeri yedektir.
  const provider = await getPromptEnhanceProvider();
  const useReplicateFirst = provider === "replicate";
  logger.log(`🔀 [PROMPT_ENHANCE] Provider: ${useReplicateFirst ? "Replicate gemini-3-flash" : "OpenRouter gemini-3.7-flash"} — app_config: "${provider}"`);
  if (useReplicateFirst) {
    try {
      return await callReplicateGeminiFlash(prompt, imageUrls, maxRetries);
    } catch (err) {
      console.error(
        "⚠️ [PROMPT_ENHANCE] Replicate Gemini başarısız, OpenRouter'a fallback:",
        err.message,
      );
      return callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      maxRetries,
      GEMINI_SYSTEM_INSTRUCTION,
    );
    }
  }
  try {
    return await callOpenRouterGeminiFlash(
      prompt,
      imageUrls,
      maxRetries,
      GEMINI_SYSTEM_INSTRUCTION,
    );
  } catch (err) {
    console.error(
      "⚠️ [PROMPT_ENHANCE] OpenRouter Gemini başarısız, Replicate'e fallback:",
      err.message,
    );
    return callReplicateGeminiFlash(prompt, imageUrls, maxRetries);
  }
}

// @fal-ai/client import for GPT Image 1.5
const { fal } = require("@fal-ai/client");
fal.config({
  credentials: process.env.FAL_API_KEY,
});

// Fal.ai GPT Image 1.5 Edit API call using SDK (for Refiner mode - Ghost Mannequin style)
async function callFalAiGptImageEditForRefiner(
  prompt,
  imageUrl,
  maxRetries = 3,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(
        `🎨 [FAL_AI_GPT_REFINER] Image generation attempt ${attempt}/${maxRetries}`,
      );
      logger.log(
        `🎨 [FAL_AI_GPT_REFINER] Prompt: ${prompt.substring(0, 100)}...`,
      );

      // fal.queue.submit ile GPT Image 1.5'e istek gönder
      const { request_id } = await fal.queue.submit(
        "fal-ai/gpt-image-1.5/edit",
        {
          input: {
            prompt: prompt,
            image_urls: [imageUrl], // Single image for refiner
            image_size: "1024x1536", // Portrait size for e-commerce - ALWAYS fixed regardless of user ratio
            quality: "medium", // medium for balanced quality/speed
            input_fidelity: "high", // preserve product details
            num_images: 1,
            output_format: "jpeg",
          },
        },
      );

      if (!request_id) {
        throw new Error("Fal.ai did not return a request_id");
      }

      logger.log(
        `⏳ [FAL_AI_GPT_REFINER] Request submitted, request_id: ${request_id}`,
      );

      // Poll for completion
      let maxPolls = 60;
      for (let poll = 0; poll < maxPolls; poll++) {
        const statusResult = await fal.queue.status(
          "fal-ai/gpt-image-1.5/edit",
          {
            requestId: request_id,
            logs: false,
          },
        );

        logger.log(
          `⏳ [FAL_AI_GPT_REFINER] Poll ${poll + 1}/${maxPolls}, status: ${
            statusResult.status
          }`,
        );

        if (statusResult.status === "COMPLETED") {
          // Get the final result
          const finalResult = await fal.queue.result(
            "fal-ai/gpt-image-1.5/edit",
            {
              requestId: request_id,
            },
          );

          if (
            finalResult.data &&
            finalResult.data.images &&
            finalResult.data.images.length > 0
          ) {
            logger.log(`✅ [FAL_AI_GPT_REFINER] Image generated successfully`);
            return finalResult.data.images[0].url;
          }
          throw new Error("No images in completed result");
        }

        if (statusResult.status === "FAILED") {
          throw new Error("Fal.ai GPT Image generation failed");
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      throw new Error("Fal.ai GPT Image polling timeout");
    } catch (error) {
      console.error(
        `❌ [FAL_AI_GPT_REFINER] Attempt ${attempt} failed:`,
        error.message,
      );

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// Client'tan gelen aspect ratio'yu fal.ai GPT Image 2 image_size enum'una dönüştür
// Results.js'deki tüm ratio seçenekleri: 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16
// GPT Image 2 enum: landscape_16_9, landscape_4_3, square_hd, square, portrait_4_3, portrait_16_9
// Enum'u olmayan ratio'lar aspect oran bazlı EN YAKIN enum'a eşlenir:
//   21:9 (2.33) ve 16:9 (1.78) → landscape_16_9
//   3:2 (1.50), 4:3 (1.33), 5:4 (1.25) → landscape_4_3
//   1:1 (1.00) → square_hd
//   4:5 (0.80), 3:4 (0.75), 2:3 (0.67) → portrait_4_3
//   9:16 (0.56) → portrait_16_9
function mapRatioToGptImage2Size(ratio) {
  const mapping = {
    // Ultra-wide + widescreen landscape → landscape_16_9
    "21:9": "landscape_16_9",
    "16:9": "landscape_16_9",
    // Standard / klasik landscape → landscape_4_3
    "3:2": "landscape_4_3",
    "4:3": "landscape_4_3",
    "5:4": "landscape_4_3",
    // Kare
    "1:1": "square_hd",
    // Standard / klasik portrait → portrait_4_3
    "4:5": "portrait_4_3",
    "3:4": "portrait_4_3",
    "2:3": "portrait_4_3",
    // Widescreen portrait → portrait_16_9
    "9:16": "portrait_16_9",
  };
  return mapping[ratio] || "portrait_4_3"; // fallback: 3:4 portrait
}

// GPT Image 2'ye giden input resimleri 3:1 aspect ratio limitine uydur.
// GPT Image 2 hata verir: "Image aspect ratio X:Y exceeds the maximum allowed ratio of 3:1"
// NOT: fal.ai tam 3:1'e çok yakın oranlarda (ör. 2.997) bile reddediyor (rounding/integer math).
// O yüzden trigger eşiğini 2.9'a çektik, padding hedefi 2.5 (sağlam safety buffer).
async function ensureMaxAspectRatio3to1ForInput(imageUrls, userId) {
  const TRIGGER_RATIO = 2.9; // Bu oranı geçen resimlere padding uygula (sınıra yakın da dahil)
  const TARGET_RATIO = 2.5; // Padding sonrası hedef oran (3.0'dan iyi uzak)
  const processedUrls = [];

  for (const url of imageUrls || []) {
    if (!url || typeof url !== "string") {
      processedUrls.push(url);
      continue;
    }
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      const buf = Buffer.from(response.data);

      const meta = await sharp(buf).metadata();
      const W = meta.width || 0;
      const H = meta.height || 0;

      if (!W || !H) {
        processedUrls.push(url); // Metadata okunamadı → orijinali kullan
        continue;
      }

      const ratio = W >= H ? W / H : H / W;

      if (ratio <= TRIGGER_RATIO) {
        processedUrls.push(url); // Zaten güvenli bölgede
        continue;
      }

      logger.log(
        `📐 [GPT2_ASPECT] ${W}x${H} (ratio ${ratio.toFixed(3)}:1) > ${TRIGGER_RATIO}:1, padding uygulanıyor (hedef ${TARGET_RATIO}:1)...`,
      );

      // Kısa kenarı büyüt, uzun kenara dokunma. Hedef oran 2.8:1 (3.0'ın altında buffer).
      let padTop = 0,
        padBottom = 0,
        padLeft = 0,
        padRight = 0;
      let newW = W,
        newH = H;

      if (W > H) {
        // Yatay resim → height'ı artır (W/TARGET_RATIO'a denk getir)
        newH = Math.ceil(W / TARGET_RATIO);
        const totalPadV = newH - H;
        padTop = Math.floor(totalPadV / 2);
        padBottom = totalPadV - padTop;
      } else {
        // Dikey resim → width'i artır (H/TARGET_RATIO'a denk getir)
        newW = Math.ceil(H / TARGET_RATIO);
        const totalPadH = newW - W;
        padLeft = Math.floor(totalPadH / 2);
        padRight = totalPadH - padLeft;
      }

      const padded = await sharp(buf)
        .extend({
          top: padTop,
          bottom: padBottom,
          left: padLeft,
          right: padRight,
          background: { r: 255, g: 255, b: 255 },
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      // Padding sonrası metadata doğrulama (debug)
      const paddedMeta = await sharp(padded).metadata();
      const finalRatio =
        (paddedMeta.width || newW) >= (paddedMeta.height || newH)
          ? (paddedMeta.width || newW) / (paddedMeta.height || newH)
          : (paddedMeta.height || newH) / (paddedMeta.width || newW);
      logger.log(
        `🔬 [GPT2_ASPECT] Padding sonrası: ${paddedMeta.width}x${paddedMeta.height}, ratio: ${finalRatio.toFixed(3)}:1`,
      );

      const timestamp = Date.now();
      const randomId = uuidv4().substring(0, 8);
      const fileName = `temp_${timestamp}_gpt2_pad_${userId || "anonymous"}_${randomId}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("reference")
        .upload(fileName, padded, {
          contentType: "image/jpeg",
        });

      if (upErr) {
        logger.warn(
          `❌ [GPT2_ASPECT] Supabase upload failed, orijinali kullan:`,
          upErr.message,
        );
        processedUrls.push(url);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from("reference")
        .getPublicUrl(fileName);

      logger.log(
        `✅ [GPT2_ASPECT] Padded: ${newW}x${newH}, URL: ${urlData.publicUrl}`,
      );
      processedUrls.push(urlData.publicUrl);
    } catch (err) {
      logger.warn(
        `⚠️ [GPT2_ASPECT] Preprocess error for ${url.substring(0, 60)}:`,
        err.message,
      );
      processedUrls.push(url); // Hata → orijinali kullan
    }
  }

  return processedUrls;
}

// Fal.ai GPT Image 2 Edit API call - V1 mode (non-refiner, non-backSide) için
// Birden fazla image_url kabul eder, aspect_ratio mapping ile image_size parametresi alır
async function callFalAiGptImage2Edit(
  prompt,
  imageUrls,
  imageSize = "portrait_4_3",
  maxRetries = 3,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(
        `🎨 [FAL_AI_GPT2_V1] attempt ${attempt}/${maxRetries}, image_size: ${imageSize}, images: ${imageUrls?.length || 0}`,
      );
      logger.log(`🎨 [FAL_AI_GPT2_V1] Prompt: ${prompt.substring(0, 100)}...`);

      const { request_id } = await fal.queue.submit("openai/gpt-image-2/edit", {
        input: {
          prompt: prompt,
          image_urls: imageUrls,
          image_size: imageSize,
          quality: "medium", // low/medium/high
          num_images: 1,
          output_format: "jpeg",
        },
      });

      if (!request_id) {
        throw new Error("Fal.ai did not return a request_id");
      }

      logger.log(
        `⏳ [FAL_AI_GPT2_V1] Request submitted, request_id: ${request_id}`,
      );

      const maxPolls = 60;
      for (let poll = 0; poll < maxPolls; poll++) {
        const statusResult = await fal.queue.status("openai/gpt-image-2/edit", {
          requestId: request_id,
          logs: false,
        });

        logger.log(
          `⏳ [FAL_AI_GPT2_V1] Poll ${poll + 1}/${maxPolls}, status: ${statusResult.status}`,
        );

        if (statusResult.status === "COMPLETED") {
          const finalResult = await fal.queue.result(
            "openai/gpt-image-2/edit",
            {
              requestId: request_id,
            },
          );

          if (
            finalResult.data &&
            finalResult.data.images &&
            finalResult.data.images.length > 0
          ) {
            logger.log(`✅ [FAL_AI_GPT2_V1] Image generated successfully`);
            return finalResult.data.images[0].url;
          }
          throw new Error("No images in completed result");
        }

        if (statusResult.status === "FAILED") {
          throw new Error("Fal.ai GPT Image 2 generation failed");
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      throw new Error("Fal.ai GPT Image 2 polling timeout");
    } catch (error) {
      console.error(
        `❌ [FAL_AI_GPT2_V1] Attempt ${attempt} failed:`,
        error.message,
      );

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// App-level config bayrağı okuma: Supabase `app_config` tablosunda is_gpt = true
// ise V1 modu GPT Image 2 kullanır, false ise nano-banana-2'ye düşer.
// İki yaygın schema'yı dener:
//   1) Direct column: `app_config.is_gpt` (tek satır, boolean kolon)
//   2) Key/value:     `app_config` rows { key: "is_gpt", value: true }
// Hata/okunamazsa default olarak GPT açık (true) döner — güvenli fallback.
async function isGptEnabledForV1() {
  try {
    const { data } = await supabase
      .from("app_config")
      .select("is_gpt")
      .limit(1)
      .maybeSingle();
    if (data && typeof data.is_gpt === "boolean") return data.is_gpt;
  } catch (e) {
    // kolon yoksa PostgREST hata fırlatır — sessizce geç
  }
  try {
    const { data } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "is_gpt")
      .maybeSingle();
    if (data && data.value !== undefined && data.value !== null) {
      const v = data.value;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true";
      if (typeof v === "object" && v !== null && "bool" in v)
        return Boolean(v.bool);
    }
  } catch (e) {}
  return true; // default: GPT açık
}

// 🧠 NB2 thinking level — app_config.nb2_thinking_level ("high" | "minimal" | "off").
// Render öncesi kompozisyon/ışık muhakemesi; maliyet etkisi +$0.002/görsel (ihmal edilebilir).
// Varsayılan: "high". "off" → parametre hiç gönderilmez.
async function getNb2ThinkingLevel() {
  const normalize = (v) => {
    const s = String(v || "").trim().toLowerCase();
    return s === "high" || s === "minimal" || s === "off" ? s : null;
  };
  try {
    const { data } = await supabase
      .from("app_config")
      .select("nb2_thinking_level")
      .limit(1)
      .maybeSingle();
    const v = normalize(data?.nb2_thinking_level);
    if (v) return v;
  } catch (e) {
    // kolon yoksa PostgREST hata fırlatır — key/value fallback'i dene
    try {
      const { data } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "nb2_thinking_level")
        .maybeSingle();
      const v = normalize(data?.value);
      if (v) return v;
    } catch (e2) {}
  }
  return "high"; // default: açık
}

// Görüntülerin geçici olarak saklanacağı klasörü oluştur
const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Geçici dosyaları hemen silme fonksiyonu (işlem biter bitmez)
async function cleanupTemporaryFiles(fileUrls) {
  // Bu fonksiyon artık dosya silme işlemi yapmıyor.
  logger.log(
    "🧹 cleanupTemporaryFiles çağrıldı fakat dosya silme işlemi devre dışı bırakıldı.",
  );
  // İleride log veya başka bir işlem eklenebilir.
}

function sanitizeImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") {
    return imageUrl;
  }

  try {
    const parsedUrl = new URL(imageUrl);
    ["width", "height", "quality"].forEach((param) =>
      parsedUrl.searchParams.delete(param),
    );
    // searchParams.delete already mutates search; ensure empty queries stripped
    if (!parsedUrl.searchParams.toString()) {
      parsedUrl.search = "";
    }
    return parsedUrl.toString();
  } catch (error) {
    // URL sınıfı relative path'lerde hata verebilir; orijinal değeri döndür
    return imageUrl;
  }
}

function normalizeReferenceEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return {
      uri: sanitizeImageUrl(entry),
    };
  }

  const normalized = { ...entry };

  if (entry.uri) {
    normalized.uri = sanitizeImageUrl(entry.uri);
  } else if (entry.url) {
    normalized.uri = sanitizeImageUrl(entry.url);
  }

  return normalized.uri ? normalized : null;
}

async function ensureRemoteReferenceImage(imageEntry, userId) {
  if (!imageEntry) {
    return null;
  }

  if (typeof imageEntry === "string") {
    if (imageEntry.startsWith("file://")) {
      throw new Error(
        "Yerel dosya path'i desteklenmiyor. Base64 data gönderilmelidir.",
      );
    }
    return {
      uri: sanitizeImageUrl(imageEntry),
      base64: null,
      alreadyUploaded: false,
    };
  }

  const result = { ...imageEntry };
  const currentUri = result.uri || result.url || null;

  // file:// veya blob: URL'leri için base64 upload gerekir
  const needsUpload =
    currentUri &&
    (currentUri.startsWith("file://") || currentUri.startsWith("blob:"));

  if (needsUpload) {
    if (result.base64) {
      const uploadSource = `data:image/jpeg;base64,${result.base64}`;
      const uploadedUrl = await uploadReferenceImageToSupabase(
        uploadSource,
        userId,
      );
      result.uri = uploadedUrl;
      // 🚀 OPTIMIZE: base64'ü silme - Gemini için sakla
      // result.base64 zaten var, onu koruyoruz
      result.alreadyUploaded = true; // 🚀 Bu resim zaten upload edildi flag'i
      logger.log(
        `📤 [UPLOAD] ${
          currentUri.startsWith("blob:") ? "Blob" : "File"
        } URL Supabase'e yüklendi (base64 korundu):`,
        uploadedUrl?.slice(0, 60),
      );
    } else {
      throw new Error(
        `${
          currentUri.startsWith("blob:") ? "Blob" : "Yerel dosya"
        } path'i tespit edildi ancak base64 verisi bulunamadı.`,
      );
    }
  }

  if (result.uri) {
    result.uri = sanitizeImageUrl(result.uri);
  }

  return result;
}

// Kullanıcının pro olup olmadığını kontrol etme fonksiyonu
async function checkUserProStatus(userId) {
  try {
    if (!userId || userId === "anonymous_user") {
      return false; // Anonymous kullanıcılar pro değil
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ User pro status kontrol hatası:", error);
      return false; // Hata durumunda pro değil kabul et
    }

    // is_pro true ise pro kabul et
    const isPro = user?.is_pro === true;
    logger.log(`👤 User ${userId.slice(0, 8)} pro status: ${isPro}`);

    return isPro;
  } catch (error) {
    console.error("❌ Pro status kontrol hatası:", error);
    return false;
  }
}

// Result image'ı user-specific bucket'e kaydetme fonksiyonu
async function saveResultImageToUserBucket(resultImageUrl, userId) {
  try {
    logger.log("📤 Result image user bucket'ine kaydediliyor...");
    logger.log("🖼️ Result image URL:", resultImageUrl);
    logger.log("👤 User ID:", userId);

    if (!resultImageUrl || !userId) {
      throw new Error("Result image URL ve User ID gereklidir");
    }

    // Result image'ı indir
    const imageResponse = await axios.get(resultImageUrl, {
      responseType: "arraybuffer",
      timeout: 30000, // 30 saniye timeout
    });
    const imageBuffer = Buffer.from(imageResponse.data);

    // User klasörü için dosya adı oluştur
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `${userId}/${timestamp}_result_${randomId}.jpg`;

    logger.log("📁 User bucket dosya adı:", fileName);

    // user_image_results bucket'ine yükle
    const { data, error } = await supabase.storage
      .from("user_image_results")
      .upload(fileName, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("❌ User bucket upload hatası:", error);
      throw new Error(`User bucket upload error: ${error.message}`);
    }

    logger.log("✅ User bucket upload başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("user_image_results")
      .getPublicUrl(fileName);

    logger.log("🔗 User bucket public URL:", urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error("❌ Result image user bucket'e kaydedilemedi:", error);
    // Hata durumunda orijinal URL'yi döndür
    return resultImageUrl;
  }
}

// 🖼️ Izgara önizlemesi (thumbnail) üretimi
//
// Neden gerekli: netleştirilmiş sonuçlar 30 MB'ı aşabiliyor. Cloudflare Image
// Resizing bu boyuttaki kaynağı reddediyor (403) — yani Results ızgarasındaki
// optimizeImageUrl önizlemesi hiç yüklenmiyor, kart boş kalıyor (tam boyutlu
// görsel modalda açıldığı için sorun yalnızca ızgarada görülüyordu).
// Çözüm: önizlemeyi biz üretip bucket'e koyuyoruz.
async function saveThumbnailToUserBucket(sourceUrl, userId) {
  try {
    if (!sourceUrl || !userId) return null;
    const resp = await axios.get(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: 250 * 1024 * 1024,
      maxBodyLength: 250 * 1024 * 1024,
    });
    const thumb = await sharp(Buffer.from(resp.data))
      .rotate()
      .resize(900, 900, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    const fileName = `${userId}/${Date.now()}_thumb_${uuidv4().substring(0, 8)}.jpg`;
    const { error } = await supabase.storage
      .from("user_image_results")
      .upload(fileName, thumb, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: true,
      });
    if (error) throw new Error(error.message);

    const { data: urlData } = supabase.storage
      .from("user_image_results")
      .getPublicUrl(fileName);
    logger.log(
      `🖼️ [THUMB] Önizleme üretildi (${Math.round(thumb.length / 1024)} KB): ${urlData?.publicUrl}`,
    );
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn("⚠️ [THUMB] Önizleme üretilemedi:", err?.message);
    return null;
  }
}

// Referans resmini Supabase'e yükleyip URL alan fonksiyon
async function uploadReferenceImageToSupabase(imageUri, userId) {
  try {
    let imageBuffer;

    // HTTP URL ise indir, değilse base64 olarak kabul et
    if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
      // HTTP URL - normal indirme
      const imageResponse = await axios.get(imageUri, {
        responseType: "arraybuffer",
        timeout: 15000, // 30s'den 15s'ye düşürüldü
      });
      imageBuffer = Buffer.from(imageResponse.data);
    } else if (imageUri.startsWith("data:image/")) {
      // Base64 data URL
      const base64Data = imageUri.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");
    } else {
      // file:// protokolü - Bu durumda frontend'den base64 data gönderilmeli
      throw new Error(
        "Yerel dosya path'i desteklenmemektedir. Lütfen resmin base64 data'sını gönderin.",
      );
    }

    // EXIF rotation düzeltmesi uygula
    let processedBuffer;
    try {
      processedBuffer = await sharp(imageBuffer)
        .rotate() // EXIF orientation bilgisini otomatik uygula
        .jpeg()
        .toBuffer();
      logger.log("🔄 Tek resim upload: EXIF rotation uygulandı");
    } catch (sharpError) {
      console.error("❌ Sharp işleme hatası:", sharpError.message);

      // Sharp hatası durumunda orijinal buffer'ı kullan
      if (
        sharpError.message.includes("Empty JPEG") ||
        sharpError.message.includes("DNL not supported")
      ) {
        try {
          processedBuffer = await sharp(imageBuffer)
            .rotate() // EXIF rotation burada da dene
            .png()
            .toBuffer();
          logger.log(
            "✅ Tek resim upload: PNG'ye dönüştürüldü (EXIF rotation uygulandı)",
          );
        } catch (pngError) {
          console.error("❌ PNG dönüştürme hatası:", pngError.message);
          processedBuffer = imageBuffer; // Son çare: orijinal buffer
          logger.log(
            "⚠️ Orijinal buffer kullanılıyor (EXIF rotation uygulanamadı)",
          );
        }
      } else {
        processedBuffer = imageBuffer; // Son çare: orijinal buffer
        logger.log(
          "⚠️ Orijinal buffer kullanılıyor (EXIF rotation uygulanamadı)",
        );
      }
    }

    // Boyut bilgisi (compress client tarafında yapılıyor)
    logger.log(
      `📏 [SIZE-CHECK] Resim boyutu: ${(processedBuffer.length / 1024 / 1024).toFixed(2)} MB (client tarafında compress edildi)`,
    );

    // Dosya adı oluştur (otomatik temizleme için timestamp prefix)
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `temp_${timestamp}_reference_${
      userId || "anonymous"
    }_${randomId}.jpg`;

    logger.log("Supabase'e yüklenecek dosya adı:", fileName);

    // Supabase'e yükle (processed buffer ile - artık compress edilmiş olabilir)
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, processedBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Supabase yükleme hatası:", error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    logger.log("Supabase yükleme başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    logger.log("Supabase public URL:", urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error("Referans resmi Supabase'e yüklenirken hata:", error);
    throw error;
  }
}

// Reference images'ları Supabase'e upload eden fonksiyon
// 🚀 OPTIMIZE: ensureRemoteReferenceImage tarafından zaten upload edilmiş resimleri tekrar upload etmez
async function uploadReferenceImagesToSupabase(referenceImages, userId) {
  try {
    logger.log(
      "📤 Reference images Supabase'e yükleniyor...",
      referenceImages.length,
      "adet",
    );

    const uploadedUrls = [];
    const base64DataArray = []; // 🚀 Gemini için base64'leri de sakla

    for (let i = 0; i < referenceImages.length; i++) {
      const referenceImage = referenceImages[i];

      try {
        let base64ForGemini = null;

        // 🚀 OPTIMIZE: Eğer resim zaten ensureRemoteReferenceImage tarafından upload edildiyse
        // tekrar upload etme, sadece URL ve base64'ü kullan
        if (referenceImage.alreadyUploaded) {
          logger.log(
            `🚀 [OPTIMIZE] Reference image ${
              i + 1
            }: Zaten upload edilmiş, tekrar upload atlanıyor`,
          );
          uploadedUrls.push(referenceImage.uri);
          base64ForGemini = referenceImage.base64 || null;
          base64DataArray.push(base64ForGemini);
          if (base64ForGemini) {
            logger.log(
              `✅ Reference image ${
                i + 1
              }: Mevcut base64 kullanılıyor - boyut: ${Math.round(
                base64ForGemini.length / 1024,
              )} KB`,
            );
          }
          continue;
        }

        let imageSourceForUpload;

        // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
        if (referenceImage.base64) {
          imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
          base64ForGemini = referenceImage.base64; // 🚀 Gemini için sakla
          logger.log(`📤 Reference image ${i + 1}: Client base64 kullanılıyor`);
        } else if (
          referenceImage.uri &&
          (referenceImage.uri.startsWith("http://") ||
            referenceImage.uri.startsWith("https://"))
        ) {
          // 🚀 HTTP URL'yi indir ve base64'e çevir - hem upload hem Gemini için kullan
          try {
            logger.log(
              `🔄 Reference image ${
                i + 1
              }: HTTP URL'den indiriliyor (tek sefer)...`,
            );
            const cleanUrl = sanitizeImageUrl(referenceImage.uri);
            const imageResponse = await axios.get(cleanUrl, {
              responseType: "arraybuffer",
              timeout: 30000,
            });
            base64ForGemini = Buffer.from(imageResponse.data).toString(
              "base64",
            );
            imageSourceForUpload = `data:image/jpeg;base64,${base64ForGemini}`;
            logger.log(
              `✅ Reference image ${
                i + 1
              }: URL'den base64'e çevrildi - boyut: ${Math.round(
                base64ForGemini.length / 1024,
              )} KB`,
            );
          } catch (downloadErr) {
            console.error(
              `❌ Reference image ${i + 1}: İndirme hatası:`,
              downloadErr.message,
            );
            imageSourceForUpload = referenceImage.uri; // Fallback: orijinal URL
          }
        } else {
          logger.log(
            `⚠️ Reference image ${i + 1}: Desteklenmeyen format, atlanıyor`,
          );
          uploadedUrls.push(referenceImage.uri); // Fallback olarak original URI'yi kullan
          base64DataArray.push(null);
          continue;
        }

        const uploadedUrl = await uploadReferenceImageToSupabase(
          imageSourceForUpload,
          userId,
        );
        uploadedUrls.push(uploadedUrl);
        base64DataArray.push(base64ForGemini); // 🚀 Gemini için base64'ü sakla
        logger.log(
          `✅ Reference image ${i + 1} başarıyla upload edildi:`,
          uploadedUrl,
        );
      } catch (uploadError) {
        console.error(
          `❌ Reference image ${i + 1} upload hatası:`,
          uploadError.message,
        );
        // Hata durumunda original URI'yi fallback olarak kullan
        uploadedUrls.push(referenceImage.uri);
        base64DataArray.push(null);
      }
    }

    logger.log(
      "📤 Toplam",
      uploadedUrls.length,
      "reference image URL'si hazırlandı",
    );

    // 🚀 Hem URL'leri hem base64'leri döndür
    return { urls: uploadedUrls, base64Array: base64DataArray };
  } catch (error) {
    console.error("❌ Reference images upload genel hatası:", error);
    // Fallback: Original URI'leri döndür (eski format uyumluluğu için)
    return { urls: referenceImages.map((img) => img.uri), base64Array: [] };
  }
}

// İşlem başlamadan önce pending status ile kayıt oluşturma fonksiyonu
async function createPendingGeneration(
  userId,
  originalPrompt,
  referenceImageUrls,
  settings = {},
  locationImage = null,
  poseImage = null,
  hairStyleImage = null,
  aspectRatio = "9:16",
  isMultipleImages = false,
  isMultipleProducts = false,
  generationId = null,
  qualityVersion = "v1", // Kalite versiyonu parametresi
  // 📊 Kullanım izleme: üretim hangi çekim tarzıyla yapıldı?
  // Bunlar prompt üretiminde zaten elimizde; kaydedilmezse "hangi tarz kaç kez
  // kullanıldı" sorusu sonradan hiçbir şekilde yanıtlanamıyor.
  styleProfileId = null,
  styleSource = null,
  creationMode = null,
) {
  try {
    // User ID yoksa veya UUID formatında değilse, UUID oluştur
    let userIdentifier = userId;
    logger.log("🔍 [DEBUG createPendingGeneration] Gelen userId:", userId);

    if (!userIdentifier || userIdentifier === "anonymous_user") {
      userIdentifier = uuidv4(); // UUID formatında anonymous user oluştur
      logger.log("🔍 [DEBUG] Yeni anonymous UUID oluşturuldu:", userIdentifier);
    } else if (
      !userIdentifier.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    ) {
      // Eğer gelen ID UUID formatında değilse, UUID'ye çevir veya yeni UUID oluştur
      logger.log(
        "🔍 [DEBUG] User ID UUID formatında değil, yeni UUID oluşturuluyor:",
        userIdentifier,
      );
      userIdentifier = uuidv4();
    } else {
      logger.log(
        "🔍 [DEBUG] User ID UUID formatında, aynı ID kullanılıyor:",
        userIdentifier,
      );
    }

    const { data: insertData, error } = await supabase
      .from("reference_results")
      .insert([
        {
          user_id: userIdentifier,
          original_prompt: originalPrompt,
          enhanced_prompt: null, // Henüz işlenmedi
          result_image_url: null, // Henüz sonuç yok
          reference_images: referenceImageUrls,
          settings: settings,
          location_image: locationImage,
          pose_image: poseImage,
          hair_style_image: hairStyleImage,
          aspect_ratio: aspectRatio,
          replicate_prediction_id: null, // Henüz prediction yok
          processing_time_seconds: null,
          is_multiple_images: isMultipleImages,
          is_multiple_products: isMultipleProducts,
          generation_id: generationId,
          status: "pending", // Başlangıçta pending
          quality_version: qualityVersion, // Kalite versiyonu kaydediliyor
          style_profile_id: styleProfileId,
          style_source: styleSource,
          creation_mode: creationMode,
          created_at: new Date().toISOString(),
        },
      ])
      .select(); // Insert edilen datayı geri döndür

    if (error) {
      console.error("❌ Pending generation kaydetme hatası:", error);
      return null;
    }

    logger.log("✅ Pending generation kaydedildi:", insertData[0]?.id);
    logger.log(
      "🔍 [DEBUG] Kaydedilen generation_id:",
      insertData[0]?.generation_id,
    );
    logger.log("🔍 [DEBUG] Kaydedilen status:", insertData[0]?.status);
    return insertData[0]; // Insert edilen kaydı döndür
  } catch (dbError) {
    console.error("❌ Pending generation veritabanı hatası:", dbError);
    return null;
  }
}

// Başarılı completion'da kredi düşürme fonksiyonu
async function deductCreditOnSuccess(generationId, userId) {
  try {
    logger.log(
      `💳 [COMPLETION-CREDIT] Generation ${generationId} başarılı, kredi düşürülüyor...`,
    );

    // 🔒 Deduplication: Bu generation için zaten kredi düşürülmüş mü kontrol et
    // settings içinde creditDeducted flag'i kontrol et
    const { data: existingGen, error: checkError } = await supabase
      .from("reference_results")
      .select("settings")
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .single();

    if (checkError) {
      console.error(`❌ Generation kontrolü hatası:`, checkError);
      return false;
    }

    try {
      logger.log(
        `💳 [DEDUP-CHECK] Generation ${generationId} settings:`,
        JSON.stringify(existingGen?.settings || {}, null, 2),
      );
    } catch (_) {
      logger.log(
        `💳 [DEDUP-CHECK] Generation ${generationId} settings: <unserializable>`,
      );
    }
    logger.log(
      `💳 [DEDUP-CHECK] creditDeducted flag:`,
      existingGen.settings?.creditDeducted,
    );

    if (existingGen.settings?.creditDeducted === true) {
      logger.log(
        `💳 [COMPLETION-CREDIT] Generation ${generationId} için zaten kredi düşürülmüş, atlanıyor`,
      );
      return true;
    }

    logger.log(`💳 [DEDUP-CHECK] İlk kredi düşürme, devam ediliyor...`);

    // Kalite versiyonuna göre kredi maliyeti (existingGen'den al)
    const qualityVersion =
      existingGen?.settings?.qualityVersion ||
      existingGen?.settings?.quality_version ||
      "v1";
    const CREDIT_COST = qualityVersion === "v2" ? 35 : 10; // v2 için 35, v1 için 10 kredi

    logger.log(
      `💳 [CREDIT] Kalite versiyonu: ${qualityVersion}, Kredi maliyeti: ${CREDIT_COST}`,
    );

    // Jenerasyon başına kredi düş
    const totalCreditCost = CREDIT_COST;
    logger.log(
      `💳 [COMPLETION-CREDIT] Bu generation için ${totalCreditCost} kredi düşürülecek`,
    );

    // 🔗 TEAM-AWARE: Team member ise owner'ın kredisinden düş
    const effectiveCredits = await teamService.getEffectiveCredits(userId);
    const creditOwnerId = effectiveCredits.creditOwnerId || userId;
    const isTeamCredit = effectiveCredits.isTeamCredit || false;

    logger.log(`💳 [TEAM-AWARE] Kredi sahibi belirlendi:`, {
      requestingUser: userId,
      creditOwnerId: creditOwnerId,
      isTeamCredit: isTeamCredit,
    });

    // Krediyi atomic olarak düş - creditOwnerId üzerinden
    const { data: currentUser, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", creditOwnerId)
      .single();

    if (userError || !currentUser) {
      console.error(`❌ User ${creditOwnerId} bulunamadı:`, userError);
      return false;
    }

    const currentCredit = currentUser.credit_balance || 0;

    if (currentCredit < totalCreditCost) {
      console.error(
        `❌ Yetersiz kredi! Mevcut: ${currentCredit}, Gerekli: ${totalCreditCost}`,
      );
      // Başarısız sonuç olarak işaretle ama generation'ı completed bırak
      return false;
    }

    // 🔒 Atomic kredi düşürme - race condition'ı önlemek için RPC kullan
    // creditOwnerId kullanarak doğru hesaptan düşür
    const { data: updateResult, error: updateError } = await supabase.rpc(
      "deduct_user_credit",
      {
        user_id: creditOwnerId,
        credit_amount: totalCreditCost,
      },
    );

    if (updateError) {
      console.error(`❌ Kredi düşme hatası:`, updateError);
      return false;
    }

    const newBalance =
      updateResult?.new_balance || currentCredit - totalCreditCost;
    logger.log(
      `✅ ${totalCreditCost} kredi başarıyla düşüldü (${isTeamCredit ? "team owner" : "user"}: ${creditOwnerId}). Yeni bakiye: ${newBalance}`,
    );

    // 💳 Kredi tracking bilgilerini generation'a kaydet
    logger.log(
      `💳 [TRACKING] Generation ${generationId} için kredi tracking bilgileri kaydediliyor...`,
    );
    const creditTrackingUpdates = {
      credits_before_generation: currentCredit,
      credits_deducted: totalCreditCost,
      credits_after_generation: newBalance,
    };

    const { error: trackingError } = await supabase
      .from("reference_results")
      .update(creditTrackingUpdates)
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    if (trackingError) {
      console.error(`❌ Credit tracking güncelleme hatası:`, trackingError);
      // Kredi zaten düştü, tracking hatası önemli değil
    } else {
      logger.log(
        `💳 [TRACKING] Generation ${generationId} credit tracking başarıyla kaydedildi:`,
        creditTrackingUpdates,
      );
    }

    // 🏷️ Generation'a kredi düşürüldü flag'i ekle
    const updatedSettings = {
      ...(existingGen?.settings || {}),
      creditDeducted: true,
    };
    logger.log(
      `🏷️ [FLAG-UPDATE] Updating settings for ${generationId}:`,
      JSON.stringify(updatedSettings, null, 2),
    );
    const { error: flagError } = await supabase
      .from("reference_results")
      .update({ settings: updatedSettings })
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    if (flagError) {
      console.error(`❌ CreditDeducted flag güncelleme hatası:`, flagError);
      // Kredi zaten düştü, flag hatası önemli değil
    } else {
      logger.log(
        `🏷️ Generation ${generationId} creditDeducted flag'i başarıyla eklendi`,
      );
    }

    return true;
  } catch (error) {
    console.error(`❌ deductCreditOnSuccess hatası:`, error);
    return false;
  }
}

// Generation status güncelleme fonksiyonu
async function updateGenerationStatus(
  generationId,
  userId,
  status,
  updates = {},
) {
  try {
    // Idempotent kredi düşümü için önce mevcut kaydın durumunu ve settings'ini oku
    let previousStatus = null;
    let previousSettings = null;
    try {
      const { data: existingRows, error: existingErr } = await supabase
        .from("reference_results")
        .select("status, settings")
        .eq("generation_id", generationId)
        .eq("user_id", userId);
      if (!existingErr && existingRows && existingRows.length > 0) {
        previousStatus = existingRows[0]?.status || null;
        previousSettings = existingRows[0]?.settings || null;
      }
    } catch (readErr) {
      console.warn(
        "⚠️ Mevcut generation durumu okunamadı (devam ediliyor)",
        readErr,
      );
    }

    // Eğer completed status'a geçiyorsa ve result_image_url varsa, user bucket'e kaydet
    let finalUpdates = { ...updates };

    if (status === "completed" && updates.result_image_url) {
      logger.log("💾 Result image user bucket'ine kaydediliyor...");
      try {
        // 1️⃣ Önce user'ın pro olup olmadığını kontrol et
        const isUserPro = await checkUserProStatus(userId);
        logger.log(`👤 User pro status: ${isUserPro}`);

        let processedImageUrl = updates.result_image_url;

        // 2️⃣ Watermark işlemi client-side'a taşındı, server'da sadece orijinal resmi kaydet
        logger.log(
          "💎 Watermark işlemi client-side'da yapılacak, orijinal resim kaydediliyor",
        );
        processedImageUrl = updates.result_image_url;

        // 3️⃣ İşlenmiş resmi user bucket'ine kaydet
        const userBucketUrl = await saveResultImageToUserBucket(
          processedImageUrl,
          userId,
        );
        finalUpdates.result_image_url = userBucketUrl;
        logger.log("✅ Result image user bucket'e kaydedildi:", userBucketUrl);
      } catch (bucketError) {
        console.error("❌ User bucket kaydetme hatası:", bucketError);
        // Hata durumunda orijinal URL'yi kullan
      }
    }

    // 🔍 Netleştirilmiş sonuçlar için iki ek iş:
    //   1) Öncesi karesi kalıcılaştırılır — fal.media URL'leri süreli, oysa
    //      SimpleImageModal'daki öncesi/sonrası sürgüsü bu kareyi kullanıyor.
    //   2) Izgara önizlemesi üretilir — 30 MB'lık kaynağı CDN küçültemiyor.
    if (status === "completed" && finalUpdates.upscaled_mp) {
      try {
        if (updates.pre_upscale_image_url) {
          const savedPre = await saveResultImageToUserBucket(
            updates.pre_upscale_image_url,
            userId,
          );
          if (savedPre) finalUpdates.pre_upscale_image_url = savedPre;
        }
        // Önizleme kaynağı olarak KÜÇÜK olan öncesi karesi tercih edilir;
        // yoksa büyük sonuç indirilir (yavaş ama çalışır).
        const thumbSource =
          finalUpdates.pre_upscale_image_url || finalUpdates.result_image_url;
        const thumbUrl = await saveThumbnailToUserBucket(thumbSource, userId);
        if (thumbUrl) finalUpdates.result_thumb_url = thumbUrl;
      } catch (thumbErr) {
        console.warn(
          "⚠️ Netleştirme yardımcı görselleri hazırlanamadı:",
          thumbErr?.message,
        );
      }
    }

    const updateData = {
      status: status,
      updated_at: new Date().toISOString(),
      ...finalUpdates,
    };

    const { data, error } = await supabase
      .from("reference_results")
      .update(updateData)
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .select();

    if (error) {
      console.error("❌ Generation status güncelleme hatası:", error);
      return false;
    }

    logger.log(`✅ Generation ${generationId} status güncellendi: ${status}`);

    // 💳 Başarılı completion'da kredi düş (idempotent)
    if (status === "completed" && userId && userId !== "anonymous_user") {
      const alreadyCompleted = previousStatus === "completed";
      const alreadyDeducted = previousSettings?.creditDeducted === true;
      if (alreadyCompleted && alreadyDeducted) {
        logger.log(
          `💳 [SKIP] ${generationId} zaten completed ve kredi düşülmüş. Deduction atlanıyor.`,
        );
      } else {
        logger.log(
          `💳 [TRIGGER] updateGenerationStatus: ${generationId} → ${status} | previous=${previousStatus}`,
        );
        logger.log(`💳 [TRIGGER] Kredi düşürme kontrolü başlatılıyor...`);
        await deductCreditOnSuccess(generationId, userId);
      }

      // 📱 Push notification gönder (sadece yeni completed ise)
      if (!alreadyCompleted) {
        logger.log(
          `📱 [NOTIFICATION] Generation completed - notification gönderiliyor: ${generationId}`,
        );
        sendGenerationCompletedNotification(userId, generationId, {
          source: previousSettings?.source,
        }).catch((error) => {
          console.error(
            `❌ [NOTIFICATION] Notification gönderme hatası:`,
            error,
          );
          // Notification hatası generation'ı etkilemesin, sessizce devam et
        });

        // Trial otomasyonu client yaşam döngüsüne bağlı değildir. Ana sonuç DB
        // ve bucket'a yazılır yazılmaz ilk iki varyant backend'de başlar; app
        // arka planda veya kapalı olsa da üretim devam eder.
        if (
          previousSettings?.automaticTrialVariationRequested === true &&
          data?.[0]?.result_image_url
        ) {
          startAutomaticTrialVariation({
            userId,
            sourceGenerationId: generationId,
            sourceImageUrl: data[0].result_image_url,
            referenceImages: [
              ...(Array.isArray(data[0].reference_images)
                ? data[0].reference_images
                : []),
              data[0].pose_image,
              data[0].hair_style_image,
            ].filter(Boolean),
          }).catch((error) => {
            logger.error(
              `❌ [TRIAL_VARIATION] Backend otomatik başlatma hatası (${generationId}):`,
              error?.message || error,
            );
          });
        }
      }
    }

    return data[0];
  } catch (dbError) {
    console.error("❌ Status güncelleme veritabanı hatası:", dbError);
    return false;
  }
}

// Replicate API kullanılacak - genAI client artık gerekli değil

// Aspect ratio formatını düzelten yardımcı fonksiyon
function formatAspectRatio(ratioStr) {
  const validRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

  try {
    // "original" veya tanımsız değerler için varsayılan oran
    if (!ratioStr || ratioStr === "original" || ratioStr === "undefined") {
      logger.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`,
      );
      return "9:16";
    }

    // ":" içermeyen değerler için varsayılan oran
    if (!ratioStr.includes(":")) {
      logger.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`,
      );
      return "9:16";
    }

    // Eğer gelen değer geçerli bir ratio ise kullan
    if (validRatios.includes(ratioStr)) {
      logger.log(`Gelen ratio değeri geçerli: ${ratioStr}`);
      return ratioStr;
    }

    // Piksel değerlerini orana çevir
    const [width, height] = ratioStr.split(":").map(Number);

    if (!width || !height || isNaN(width) || isNaN(height)) {
      logger.log(
        `Geçersiz ratio değerleri: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`,
      );
      return "9:16";
    }

    // En yakın standart oranı bul
    const aspectRatio = width / height;
    let closestRatio = "9:16";
    let minDifference = Number.MAX_VALUE;

    for (const validRatio of validRatios) {
      const [validWidth, validHeight] = validRatio.split(":").map(Number);
      const validAspectRatio = validWidth / validHeight;
      const difference = Math.abs(aspectRatio - validAspectRatio);

      if (difference < minDifference) {
        minDifference = difference;
        closestRatio = validRatio;
      }
    }

    logger.log(
      `Ratio ${ratioStr} için en yakın desteklenen değer: ${closestRatio}`,
    );
    return closestRatio;
  } catch (error) {
    console.error(
      `Ratio formatı işlenirken hata oluştu: ${error.message}`,
      error,
    );
    return "9:16";
  }
}

function sanitizePoseText(text) {
  if (!text || typeof text !== "string") {
    return text;
  }

  try {
    const forbiddenKeywords = [
      "background",
      "backdrop",
      "environment",
      "studio",
      "set",
    ];

    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const filtered = sentences.filter((sentence) => {
      const lower = sentence.toLowerCase();
      return !forbiddenKeywords.some((keyword) => lower.includes(keyword));
    });

    const joined = filtered.join(" ").trim();
    if (joined) {
      return joined;
    }

    const keywordRegex = /(studio|background|backdrop|environment|set)/gi;
    const stripped = text.replace(keywordRegex, "").replace(/\s+/g, " ").trim();
    return stripped;
  } catch (error) {
    console.error("❌ Pose metni temizlenirken hata:", error);
    return text;
  }
}

// 🎯 Focus area direktifi — kullanıcı CreateModelPhotoScreen'de Odak Alanı seçtiyse
// çekim bölgesini (upper body / lower body / close-up / detail / full-body) SERT
// bir talimat olarak prompt'un en başına yerleştirir. Auto veya bilinmeyen değerde
// boş döner (direktif eklenmez).
function buildFocusAreaDirective(focusArea) {
  if (!focusArea || typeof focusArea !== "string") return "";
  const key = focusArea.trim().toLowerCase();
  if (!key || key === "auto") return "";

  switch (key) {
    case "upper_body":
      return `⚠️ STRICT FRAMING DIRECTIVE — UPPER BODY ONLY:
The final image MUST show ONLY the upper body of the model — from roughly the waist or hips upward (head, shoulders, torso, arms). The lower body (legs, knees, feet, shoes) MUST be cropped out or entirely out of frame. This is a hard, non-negotiable requirement: do NOT produce a full-body shot. Compose the frame as a medium / cowboy shot with the garment's upper portion as the focal subject.`;
    case "lower_body":
      return `⚠️ STRICT FRAMING DIRECTIVE — LOWER BODY ONLY:
The final image MUST show ONLY the lower body of the model — from roughly the waist / hips downward (hips, thighs, knees, calves, feet, footwear). The upper body (face, chest, arms, torso detail) MUST be cropped out or entirely out of frame. This is a hard, non-negotiable requirement: do NOT produce a full-body shot or an upper-body shot. Compose the frame so that the lower-body garment (pants, skirt, shoes, etc.) is the sole focal subject.`;
    case "close_up":
      return `⚠️ STRICT FRAMING DIRECTIVE — CLOSE-UP PORTRAIT:
The final image MUST be a tight close-up on the upper torso / face area of the model (chest, shoulders, neckline, face). Do NOT produce a full-body shot or a wide shot. The composition should feel like an intimate editorial portrait — the upper garment details and facial expression are the main subject.`;
    case "detail":
      return `⚠️ STRICT FRAMING DIRECTIVE — EXTREME DETAIL / MACRO:
The final image MUST be an extreme close-up on a single detail of the garment — fabric texture, stitching, trim, button, seam, print, collar, cuff, or embellishment. Do NOT produce a full-body, upper-body, or lower-body shot. The frame should be dominated by the garment detail with shallow depth of field; the model's body is mostly out of frame or provides minimal contextual background only.`;
    case "full_body":
      return `⚠️ STRICT FRAMING DIRECTIVE — FULL BODY, HEAD TO TOE:
The final image MUST show the model's complete body from the top of the head to the feet, including the full outfit and footwear. Do NOT crop the head, arms, hands, legs, feet, or any part of the garment. Keep comfortable visible space above the head and below the feet, and compose a clearly recognizable full-length fashion shot. This is a hard, non-negotiable requirement: do NOT produce an upper-body, lower-body, close-up, or detail shot.`;
    default:
      return "";
  }
}

// 📸 Perspektif normalizasyonu — client stabil id ("low_angle") gönderir ama
// eski sürümler / kayıtlı profiller lokalize ad ("Alttan Açı") gönderebiliyor.
// Ham değer prompta sızmasın diye bilinen id + TR adları doğal İngilizce
// fotoğrafçılık terimine çevrilir; bilinmeyen değer olduğu gibi döner
// (meta-prompt'taki çeviri talimatı son güvenlik ağıdır).
const PERSPECTIVE_LABELS = {
  eye_level: "eye-level angle",
  high_angle: "high angle — camera above the model, looking down",
  low_angle: "low angle — camera below eye level, looking up",
  three_quarter: "three-quarter angle",
  over_shoulder: "over-the-shoulder framing",
  top_down: "top-down view",
  worms_eye: "worm's-eye view — near ground level, looking up",
  profile_shot: "side profile",
  "göz hizası": "eye-level angle",
  "yukarıdan açı": "high angle — camera above the model, looking down",
  "alttan açı": "low angle — camera below eye level, looking up",
  "¾ perspektif": "three-quarter angle",
  "omuz arkası": "over-the-shoulder framing",
  "tepeden bakış": "top-down view",
  "yerden yukarı": "worm's-eye view — near ground level, looking up",
  "yan profil": "side profile",
};

function normalizePerspective(value) {
  if (!value || typeof value !== "string") return value;
  const key = value.trim().toLowerCase();
  return PERSPECTIVE_LABELS[key] || value;
}

// 🧵 Narratif fallback prompt — Gemini enhance tamamen başarısız olduğunda
// kullanılır. Kullanıcı ayarlarını virgülle zincirlenmiş ham parametre dökümü
// yerine akıcı, fotoğrafçı-brief tarzı 4 paragraflık cümlelere dönüştürür.
// (Nano-banana narrative promptlarla en iyi sonucu verir; parametre yığını
// stok/yapay görünüm üretir.)
function buildNarrativeFallbackPrompt(settings = {}, isMultipleProducts = false) {
  const s = settings || {};
  const genderLower = (s.gender || "female").toLowerCase();
  const isMale = genderLower === "male" || genderLower === "man";
  const ageStr = s.age ? String(s.age) : "";
  const isNewborn =
    ageStr.toLowerCase() === "newborn" ||
    ageStr.toLowerCase() === "yenidoğan" ||
    ageStr === "0";
  let parsedAgeInt = null;
  if (isNewborn) {
    parsedAgeInt = 0;
  } else if (ageStr) {
    const m = ageStr.match(/(\d+)/);
    if (m) parsedAgeInt = parseInt(m[1], 10);
    else if (/baby|bebek/i.test(ageStr)) parsedAgeInt = 1;
    else if (/child|çocuk/i.test(ageStr)) parsedAgeInt = 5;
    else if (/young|genç/i.test(ageStr)) parsedAgeInt = 22;
    else if (/adult|yetişkin/i.test(ageStr)) parsedAgeInt = 45;
  }

  let modelNoun;
  if (parsedAgeInt === 0) {
    modelNoun = `newborn baby ${isMale ? "boy" : "girl"} (0 months old, infant)`;
  } else if (parsedAgeInt !== null && parsedAgeInt <= 12) {
    modelNoun = `child model (${isMale ? "male" : "female"})`;
  } else if (parsedAgeInt !== null && parsedAgeInt <= 16) {
    modelNoun = `teenage model (${isMale ? "male" : "female"})`;
  } else {
    modelNoun = isMale ? "adult male model" : "adult female model";
  }

  const garmentPhrase = isMultipleProducts
    ? "flat-lay garments from the reference images"
    : "flat-lay garment from the reference image";

  // Paragraf 1 — model & poz
  const traits = [];
  if (s.ethnicity) traits.push(`of ${s.ethnicity} heritage`);
  if (s.skinTone)
    traits.push(`with ${s.skinTone} skin carrying a healthy, natural finish`);
  if (s.hairColor && s.hairStyle)
    traits.push(`with ${s.hairColor} hair styled as ${s.hairStyle}`);
  else if (s.hairColor) traits.push(`with ${s.hairColor} hair`);
  else if (s.hairStyle) traits.push(`with hair styled as ${s.hairStyle}`);
  if (s.bodyShape)
    traits.push(`with a ${s.bodyShape} body shape that the garment fits naturally`);

  const an = (phrase) => (/^[aeiou]/i.test(phrase) ? "an" : "a");
  let p1 = `Replace the ${garmentPhrase} so that the exact same ${
    isMultipleProducts ? "garments are" : "garment is"
  } worn by ${an(modelNoun)} ${modelNoun}${traits.length ? " " + traits.join(", ") : ""}, photographed for professional fashion photography.`;
  p1 += s.pose
    ? ` The model holds a ${s.pose} pose`
    : ` The model stands in a relaxed, confident editorial pose, weight shifted naturally onto one leg with expressive but believable body language`;
  p1 += s.mood ? `, carrying a ${s.mood} expression.` : ".";
  if (s.accessories) p1 += ` The look is styled with ${s.accessories}.`;

  // Paragraf 2 — kıyafet sadakati & kumaş fiziği
  let p2 = `${
    isMultipleProducts
      ? "Every garment appears exactly as in its reference image"
      : "The garment appears exactly as in the reference image"
  } — identical colorway, prints and pattern scale, weave and knit texture, stitching, hardware, trims, labels, and hem finish — now worn as fully three-dimensional cloth with believable volume: the fabric wraps the body, catches light on raised folds, and settles into soft shadow inside creases, with all hangers, clips, tags, and flat-lay artifacts gone.`;
  if (s.productColor && s.productColor !== "original") {
    p2 += ` The garment is presented in ${s.productColor}.`;
  }
  if (isMultipleProducts) {
    p2 += ` All pieces work together as one coordinated ensemble with natural layering and each item's own intended fit respected.`;
  }
  p2 += ` Prints and patterns follow the body's contours — curving, compressing, and flowing with the fabric in realistic continuity across seams.`;

  // Paragraf 3 — ortam
  const env =
    (s.locationEnhancedPrompt && s.locationEnhancedPrompt.trim()) || s.location;
  let p3 = env
    ? `The scene takes place in ${env}`
    : `The scene is a refined, contemporary studio with a clean, elevated backdrop`;
  if (s.weather) p3 += `, during ${s.weather} weather`;
  p3 += `. The environment reads with real depth — a tactile foreground, the model mid-frame, and a softly held background — its palette and mood supporting the garment as the hero of the image.`;

  // Paragraf 4 — fotoğraf, ışık, grade
  const normalizedPerspective = normalizePerspective(s.perspective);
  let p4 = normalizedPerspective
    ? `The photograph is composed from ${an(normalizedPerspective)} ${normalizedPerspective} viewpoint, `
    : `The photograph is composed at eye level with polished editorial framing, `;
  p4 += `lit by a professional lighting design suited to the setting, with one clear key light direction, natural falloff, and true contact shadows. The color grade is confident — dense blacks, accurate whites, honest saturation — with crisp focus on the garment and lifelike skin and fabric texture. The final result is a single, hyper-realistic, high-end professional fashion photograph, polished to editorial standards and suitable for premium catalogs and campaigns.`;

  if (parsedAgeInt === 0) {
    p4 += ` This is professional newborn fashion photography: the newborn rests in a safe, gentle, supported position, softly and evenly lit, framed in an intimate close-up that emphasizes the baby's delicate features and the garment's details in a tender, serene atmosphere.`;
  }

  return [p1, p2, p3, p4].join("\n\n");
}

// 🔁 Basitleştirilmiş ikinci enhance denemesi — tam meta-prompt başarısız
// olduğunda çok daha kısa bir talimatla Gemini'ye bir şans daha verir.
// Başarısızsa null döner; çağıran narratif statik şablona düşer.
async function attemptSimplifiedEnhance(settings, isMultipleProducts, imageUrl) {
  try {
    const narrativeSeed = buildNarrativeFallbackPrompt(
      settings,
      isMultipleProducts,
    );
    const simplifiedInstruction = `You are a fashion photography prompt writer. Rewrite and enrich the draft prompt below into one flowing, vivid, positively-framed prompt for an AI image editing model, keeping every factual requirement (model, garment fidelity, setting, camera) intact and adding concrete fabric, light, and pose detail based on the attached garment image. Output ONLY the final prompt text, in English, with no headers, lists, or commentary.

DRAFT PROMPT:
${narrativeSeed}`;
    const imageUrls = imageUrl ? [sanitizeImageUrl(imageUrl)] : [];
    const simplified = await callGeminiFlash(
      simplifiedInstruction,
      imageUrls,
      1,
    );
    if (simplified && simplified.trim().length > 200) {
      logger.log(
        "🔁 [FALLBACK] Basitleştirilmiş ikinci Gemini denemesi başarılı",
      );
      return simplified.trim();
    }
  } catch (retryErr) {
    console.error(
      "🔁 [FALLBACK] Basitleştirilmiş ikinci deneme de başarısız:",
      retryErr.message,
    );
  }
  return null;
}

async function enhancePromptWithGemini(
  originalPrompt,
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false,
  isColorChange = false, // Renk değiştirme mi?
  targetColor = null, // Hedef renk
  isPoseChange = false, // Poz değiştirme mi?
  customDetail = null, // Özel detay
  isEditMode = false, // EditScreen modu mu?
  editPrompt = null, // EditScreen'den gelen prompt
  isRefinerMode = false, // RefinerScreen modu mu?
  isBackSideAnalysis = false, // Arka taraf analizi modu mu?
  referenceImages = null, // Back side analysis için 2 resim
  isMultipleImages = false, // Çoklu resim modu mu?
  userId = null, // Compress için userId
  originalBase64Data = null, // Orijinal base64 verisi - URL'den tekrar indirmemek için
  kombinItemCount = 0, // 🛍️ Kombin modunda grid içindeki tekil ürün sayısı (0 = kombin değil)
  multipleAnglesCount = 0, // 📐 Aynı ürünün grid içindeki farklı açı sayısı
  modelReferenceImageUrl = null, // 👤 Kullanıcı belirli bir model fotoğrafı seçtiyse URL'i (varsa yüz icat edilmez, referanstaki kişi korunur; görsel Gemini'ye de eklenir)
) {
  try {
    logger.log("🤖 [GEMINI] Google Gemini ile prompt iyileştirme başlatılıyor");
    logger.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    logger.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    logger.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);
    logger.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);
    logger.log("🎨 [GEMINI] Color change mode:", isColorChange);
    logger.log("🎨 [GEMINI] Target color:", targetColor);
    logger.log("✏️ [GEMINI] Edit mode:", isEditMode);
    logger.log("✏️ [GEMINI] Edit prompt:", editPrompt);
    logger.log("🔧 [GEMINI] Refiner mode:", isRefinerMode);
    logger.log("🔄 [GEMINI] Back side analysis mode:", isBackSideAnalysis);
    logger.log("📐 [GEMINI] Multiple angles count:", multipleAnglesCount);

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== "",
      );

    logger.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

    // 🎯 Focus area — kullanıcı belirli bir çekim bölgesi seçtiyse (auto değilse)
    // prompt'un en başına sert, pazarlıksız bir talimat olarak yerleştir.
    const focusAreaDirective = buildFocusAreaDirective(settings?.focusArea);
    if (focusAreaDirective) {
      logger.log(
        "🎯 [GEMINI] Focus area direktifi başa ekleniyor:",
        settings?.focusArea,
      );
    }

    // 📝 OPENING NARRATIVE — Skin / Pose / User-Detail intent'leri statik metin
    // olarak prepend edilmiyor. Gemini'ye "bu intent'leri kıyafete göre yorumla,
    // 2-3 cümlelik pozitif anlatı olarak (başlıksız, ⚠️'siz) prompt'un EN BAŞINA
    // yaz" talimatı veriliyor. Böylece skin ve pose cümleleri kıyafetin kumaşına,
    // rengine ve sahnesine uyarlanmış akıcı brief dili olarak gider.
    const directCustomDetail =
      typeof customDetail === "string" ? customDetail.trim() : "";
    // Fallback: eski client sürümleri customDetail'i ayrı parametre olarak
    // göndermiyor — originalPrompt içindeki "Additional details: X" satırından
    // parse et. Böylece USER DETAIL DIRECTIVE bloğu her koşulda üretilir.
    let extractedFromOriginal = "";
    if (!directCustomDetail && typeof originalPrompt === "string") {
      const match = originalPrompt.match(
        /Additional\s+details\s*:\s*([^.]*?)(?=\.\s+[A-Z]|\.\s*$|$)/i,
      );
      if (match && match[1]) {
        extractedFromOriginal = match[1].trim().replace(/\.$/, "");
      }
    }
    const trimmedCustomDetail = directCustomDetail || extractedFromOriginal;
    if (extractedFromOriginal && !directCustomDetail) {
      logger.log(
        "📝 [GEMINI] customDetail parametresi boş — originalPrompt'tan extract edildi:",
        extractedFromOriginal,
      );
    }
    const hasUserPose =
      (typeof settings?.pose === "string" && settings.pose.trim().length > 0) ||
      Boolean(poseImage);
    const includeOpenPoseDirective = !hasUserPose;

    // 📏 MODEL BODY SIZE & HEIGHT — kullanıcı client'te belirli bir
    // bodyShape (örn. "Petite", "Tall", "Plus Size") veya custom measurements
    // (bust/waist/hips/height/weight) seçtiyse, Gemini bu intent'i başlıksız
    // pozitif anlatı cümleleri olarak prompt'un EN BAŞINA işler. Hedef: modelin
    // beden ve boyu kullanıcı seçimine sadık, gerçekçi proportionlarla çıksın.
    const bodyShapeText =
      typeof settings?.bodyShape === "string" ? settings.bodyShape.trim() : "";
    const hasCustomMeasurements =
      settings?.type === "custom_measurements" &&
      settings?.measurements &&
      typeof settings.measurements === "object";
    const measurements = hasCustomMeasurements ? settings.measurements : null;
    const hasModelBodyDirective = Boolean(bodyShapeText) || Boolean(measurements);

    const openingDirectiveItems = [];

    if (hasModelBodyDirective) {
      const measurementsLine = measurements
        ? `Custom measurements (must be matched realistically): ${[
            measurements.bust ? `bust ${measurements.bust} cm` : null,
            measurements.waist ? `waist ${measurements.waist} cm` : null,
            measurements.hips ? `hips ${measurements.hips} cm` : null,
            measurements.height ? `height ${measurements.height} cm` : null,
            measurements.weight ? `weight ${measurements.weight} kg` : null,
          ]
            .filter(Boolean)
            .join(", ")}.`
        : "";
      const bodyShapeLine = bodyShapeText
        ? `Selected body type / size: "${bodyShapeText}".`
        : "";
      openingDirectiveItems.push(
        `MODEL BODY — Intent: the user has explicitly selected a specific body size / proportions / height for the model that MUST be honored in the final image with strict, photorealistic accuracy. ${bodyShapeLine} ${measurementsLine} The model's silhouette, body proportions, height impression in frame, garment drape, fit, and overall posture MUST all reflect this exact body specification, staying true to these proportions rather than a generic editorial standard size. Frame the camera and choose a pose that is flattering and natural for THIS specific body type. → Your task: write 2-3 flowing sentences that adapt this body specification to THIS specific garment's TYPE / CATEGORY, its fabric behavior on this body, the ENVIRONMENT / LOCATION, and the overall ATMOSPHERE / MOOD — describing how the garment realistically drapes, fits, and moves on a body of these proportions in this scene (e.g. a flowy linen dress softly skimming a curvier silhouette on a Mediterranean terrace; a tailored blazer cleanly structured on a petite frame in an urban plaza; a sweater hugging an athletic build in a mountain setting). The body specification must remain clearly visible and respected in your prose.`,
      );
    }

    openingDirectiveItems.push(
      `NATURAL SKIN — Intent: the model's face must look like a real, healthy, well-groomed human in a professional fashion photograph — soft natural pores, subtle authentic skin texture, a matte-to-soft finish, clear and even-toned, with light natural makeup at most. Think "photoreal editorial model photographed in high resolution", the kind of honest, living skin seen in premium fashion campaigns. Facial lighting neutral and photographic. → Your task: write 2-3 flowing sentences that adapt this intent to THIS specific garment's TYPE / CATEGORY (tailoring, knitwear, activewear, eveningwear, swimwear, streetwear, etc.), its fabric & color palette, the ENVIRONMENT / LOCATION, and the overall ATMOSPHERE / MOOD (e.g. warm late-day glow on softly tanned skin for linen on a Mediterranean terrace; cool porcelain complexion with crisp studio key light for structured black eveningwear; fresh, healthy skin with light dew sheen for sportswear in an outdoor morning setting). Describe the skin the camera actually sees — positive, concrete, photographic.`,
    );
    if (includeOpenPoseDirective) {
      openingDirectiveItems.push(
        `FASHION POSE — Intent: no specific pose was requested, so a dynamic fashion-editorial pose must be chosen that flatters THIS specific garment — never the stiff mannequin default (both arms hanging straight down at the sides, feet parallel, frontal symmetric stance, blank catalog expression). Hands enter pockets only if the garment clearly has visible pockets in the reference image, and hand placement always keeps key garment details (neckline, print, stitching, buttons, hem, logo) fully visible. The pose must feel like a professional lookbook / editorial shoot — natural, expressive, with believable weight and motion, chosen to showcase fit, drape, and silhouette. → Your task: write 2-3 flowing sentences that pick and describe ONE specific editorial pose tailored to THIS garment's TYPE / CATEGORY, silhouette, cut, fabric behavior, and intended styling — AND that also fits the ENVIRONMENT / LOCATION and ATMOSPHERE / MOOD of the scene (e.g. relaxed contrapposto with a gentle shoulder turn for a flowy summer dress on a cobblestone street; confident wide three-quarter stance with one hand at the waist for a structured tailored blazer in an urban plaza; mid-step walking frame with natural arm swing for sportswear on a running track; seated editorial pose leaning forward for eveningwear in a candlelit interior). Describe the pose in positive photographic prose — what the body IS doing.`,
      );
    }
    if (trimmedCustomDetail) {
      openingDirectiveItems.push(
        `USER DETAIL — Intent: the user has explicitly provided this non-negotiable additional detail that MUST be honored and clearly reflected in the scene: "${trimmedCustomDetail}". Treat this with the same strictness as skin and pose. → Your task: write 2-3 flowing sentences that integrate this user detail naturally into the garment + scene context, adapting it to the garment TYPE / CATEGORY, the ENVIRONMENT / LOCATION, and the ATMOSPHERE / MOOD (if it's a background / environment element, describe how it frames the composition with THIS garment and its setting; if it's a styling / mood / prop element, describe how it complements the fabric, color, silhouette, and lighting). The detail must stay clearly recognizable and visible in your prose.`,
      );
    }

    const openingDirectivesInstruction = openingDirectiveItems.length
      ? `
OPENING NARRATIVE REQUIREMENTS — MANDATORY OUTPUT STRUCTURE:

Your enhanced prompt MUST OPEN with a short narrative section that fulfills the following ${openingDirectiveItems.length} intent${openingDirectiveItems.length > 1 ? "s" : ""} in this exact order, BEFORE the detailed model / garment / environment / photography paragraphs. For each intent, interpret it and write 2-3 flowing sentences tailored to THIS specific shoot — adapting it to the garment TYPE / CATEGORY, its fabric / color / silhouette, the ENVIRONMENT / LOCATION, and the overall ATMOSPHERE / MOOD. Do NOT copy the instruction text verbatim. Write these as natural, positively-framed photographic prose that blends into the rest of the prompt: describe what IS in the frame. Your output must NEVER contain ⚠️ symbols, section headers, rule labels, ALL-CAPS warnings, or lists of forbidden things — the final prompt must read like a photographer's shoot brief, not a rulebook. Never skip, soften, contradict, or merge these intents.

${openingDirectiveItems.map((item, idx) => `${idx + 1}. ${item}`).join("\n\n")}

After this opening narrative section, continue with the rest of the enhanced prompt as usual.
`
      : "";

    if (openingDirectivesInstruction) {
      logger.log(
        `📝 [GEMINI] Opening directives Gemini'ye gönderiliyor (${hasModelBodyDirective ? "body + " : ""}skin${includeOpenPoseDirective ? " + pose" : ""}${trimmedCustomDetail ? " + user detail" : ""}) — enhanced şekilde başa yazılacak`,
      );
      if (hasModelBodyDirective) {
        logger.log(
          "📏 [GEMINI] Model body directive en başa eklendi:",
          bodyShapeText || JSON.stringify(measurements),
        );
      }
    }

    // Cinsiyet belirleme - varsayılan olarak kadın
    const gender = settings?.gender || "female";
    const age = settings?.age || "";
    let parsedAgeInt = parseInt(age, 10);

    // If age is a string (like "baby", "bebek", etc.), parse it into a numeric value
    if (isNaN(parsedAgeInt) && age) {
      const ageLower = age.toLowerCase();
      if (ageLower.includes("baby") || ageLower.includes("bebek")) {
        parsedAgeInt = 1;
      } else if (ageLower.includes("child") || ageLower.includes("çocuk")) {
        parsedAgeInt = 5;
      } else if (ageLower.includes("young") || ageLower.includes("genç")) {
        parsedAgeInt = 22;
      } else if (ageLower.includes("adult") || ageLower.includes("yetişkin")) {
        parsedAgeInt = 45;
      } else if (
        ageLower.includes("newborn") ||
        ageLower.includes("yenidoğan")
      ) {
        parsedAgeInt = 0;
      }
    }

    // Gender mapping'ini düzelt - hem man/woman hem de male/female değerlerini handle et
    let modelGenderText;
    let baseModelText;
    const genderLower = gender.toLowerCase();

    // Yaş grupları tanımlaması
    // 0     : newborn (yenidoğan)
    // 1     : baby (infant)
    // 2-3   : toddler
    // 4-12  : child
    // 13-16 : teenage
    // 17+   : adult

    // Newborn kontrolü - hem "newborn" string'i hem de 0 yaş kontrolü
    const isNewborn =
      age?.toLowerCase() === "newborn" ||
      age?.toLowerCase() === "yenidoğan" ||
      (!isNaN(parsedAgeInt) && parsedAgeInt === 0);

    if (isNewborn) {
      // NEWBORN (0 yaş) - Özel newborn fashion photography
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      modelGenderText = `newborn baby ${genderWord} (0 months old, infant)`;
      baseModelText = `newborn baby ${genderWord}`;

      logger.log(
        "👶 [GEMINI] NEWBORN MODE tespit edildi - Newborn fashion photography",
      );
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 3) {
      // Baby/Toddler (1-3 yaş)
      let ageGroupWord;
      if (parsedAgeInt === 1) {
        ageGroupWord = "baby"; // 1 yaş için baby
      } else {
        ageGroupWord = "toddler"; // 2-3 yaş için toddler
      }
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";

      if (parsedAgeInt === 1) {
        // Baby için daha spesifik tanım
        modelGenderText = `${parsedAgeInt}-year-old ${ageGroupWord} ${genderWord} (infant)`;
        baseModelText = `${ageGroupWord} ${genderWord} (infant)`;
      } else {
        modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
        baseModelText = `${ageGroupWord} ${genderWord}`;
      }
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 12) {
      // Child
      const ageGroupWord = "child";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      baseModelText = `${ageGroupWord} ${genderWord}`;
    } else if (!isNaN(parsedAgeInt) && parsedAgeInt <= 16) {
      // Teenage
      const ageGroupWord = "teenage";
      const genderWord =
        genderLower === "male" || genderLower === "man" ? "boy" : "girl";
      modelGenderText = `${parsedAgeInt} year old ${ageGroupWord} ${genderWord}`;
      baseModelText = `${ageGroupWord} ${genderWord}`;
    } else {
      // Yetişkin mantığı - güvenli flag-safe tanımlar
      if (genderLower === "male" || genderLower === "man") {
        modelGenderText = "adult male model";
      } else if (genderLower === "female" || genderLower === "woman") {
        modelGenderText = "adult female model with confident expression";
      } else {
        modelGenderText = "adult female model with confident expression"; // varsayılan
      }
      baseModelText = modelGenderText; // age'siz sürüm

      // Eğer yaş bilgisini yetişkinlerde kullanmak istersen.
      // "22" gibi sayısal yaş → "22 year old ..."; "young" gibi kelime yaş →
      // "young adult ..." (aksi halde "young year old" gibi bozuk gramer çıkıyor).
      if (age) {
        const isNumericAge = /^\d+\s*(years?\s*old)?$/i.test(String(age).trim());
        const agePrefix = isNumericAge
          ? `${parseInt(age, 10)} year old`
          : String(age).trim();
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? `${agePrefix} adult male model`
            : `${agePrefix} adult female model with confident expression`;
      }
    }

    logger.log("👤 [GEMINI] Gelen gender ayarı:", gender);
    logger.log("👶 [GEMINI] Gelen age ayarı:", age);
    logger.log("👤 [GEMINI] Base model türü:", baseModelText);
    logger.log("👤 [GEMINI] Age'li model türü:", modelGenderText);

    // Age specification - use client's age info naturally but limited
    let ageSection = "";
    if (age) {
      logger.log("👶 [GEMINI] Yaş bilgisi tespit edildi:", age);

      ageSection = `
    AGE SPECIFICATION:
    The user provided age information is "${age}". IMPORTANT: Mention this age information EXACTLY 2 times in your entire prompt — once when first introducing the model, and once more naturally later in the description. Do not mention the age a third time.`;
    }

    // Yaş grupları için basit ve güvenli prompt yönlendirmesi
    let childPromptSection = "";
    const parsedAge = parseInt(age, 10);

    if (isNewborn) {
      // NEWBORN (0 yaş) - Özel newborn fashion photography direktifleri
      childPromptSection = `
NEWBORN FASHION PHOTOGRAPHY MODE:
This is a professional newborn fashion photography session. The model is a newborn baby (0 months old, infant). 

CRITICAL NEWBORN PHOTOGRAPHY REQUIREMENTS:
- The newborn must be photographed in a safe, comfortable, and natural position suitable for newborn fashion photography
- Use soft, gentle poses that are appropriate for newborns - lying down positions, swaddled poses, or supported sitting positions
- Ensure the garment/product fits naturally on the newborn's small frame
- Use soft, diffused lighting that is gentle on the newborn's eyes
- Maintain a peaceful, serene atmosphere typical of newborn photography
- The newborn should appear comfortable, content, and naturally positioned
- Focus on showcasing the garment/product while ensuring the newborn's safety and comfort in the composition
- Use professional newborn photography techniques: natural fabric draping, gentle positioning, and age-appropriate styling
- The overall aesthetic should be gentle, tender, and suitable for newborn fashion photography campaigns

CAMERA FRAMING REQUIREMENT FOR NEWBORN:
- Use CLOSE-UP framing (tight crop) that focuses on the newborn and the garment/product
- The composition should be intimate and detail-focused, capturing the newborn's delicate features and the product's details
- Frame the shot to emphasize the newborn's face, hands, and the garment/product being showcased
- Avoid wide shots - maintain a close-up perspective that creates an intimate, tender atmosphere
- The camera should be positioned close to the subject, creating a warm, personal connection with the viewer

IMPORTANT: This is newborn fashion photography - maintain professional standards while ensuring all poses and positions are safe and appropriate for a newborn infant.`;
    } else if (!isNaN(parsedAge) && parsedAge <= 16) {
      if (parsedAge <= 3) {
        // Baby/Toddler (1-3 yaş) - çok basit
        childPromptSection = `
Age-appropriate modeling for young child (${parsedAge} years old). Natural, comfortable poses suitable for children's fashion photography.`;
      } else {
        // Child/teenage - sadece temel kurallar
        childPromptSection = `
Child model (${parsedAge} years old). Use age-appropriate poses and expressions suitable for children's fashion photography. Keep styling natural and comfortable.`;
      }
    }

    // Body shape measurements handling
    let bodyShapeMeasurementsSection = "";
    if (settings?.type === "custom_measurements" && settings?.measurements) {
      const { bust, waist, hips, height, weight } = settings.measurements;
      logger.log(
        "📏 [BACKEND GEMINI] Custom body measurements alındı:",
        settings.measurements,
      );

      bodyShapeMeasurementsSection = `
    
    CUSTOM BODY MEASUREMENTS PROVIDED:
    The user has provided custom body measurements for the ${baseModelText}:
    - Bust: ${bust} cm
    - Waist: ${waist} cm  
    - Hips: ${hips} cm
    ${height ? `- Height: ${height} cm` : ""}
    ${weight ? `- Weight: ${weight} kg` : ""}
    
    IMPORTANT: Use these exact measurements to ensure the ${baseModelText} has realistic body proportions that match the provided measurements. The garment should fit naturally on a body with these specific measurements. Consider how the garment would drape and fit on someone with these proportions. The model's body should reflect these measurements in a natural and proportional way.`;

      logger.log("📏 [BACKEND GEMINI] Body measurements section oluşturuldu");
    }

    let settingsPromptSection = "";

    if (hasValidSettings) {
      const settingsText = Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null &&
            value !== undefined &&
            value !== "" &&
            key !== "measurements" &&
            key !== "type" &&
            key !== "locationEnhancedPrompt", // Enhanced prompt'u settings text'inden hariç tut
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      logger.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      logger.log("📝 [BACKEND GEMINI] Settings text:", settingsText);
      logger.log(
        "🏞️ [BACKEND GEMINI] Location enhanced prompt:",
        settings?.locationEnhancedPrompt,
      );
      logger.log("🎨 [BACKEND GEMINI] Product color:", settings?.productColor);

      settingsPromptSection = `
    User selected settings: ${settingsText}

    ⚙️ SETTING VALUE NORMALIZATION (MANDATORY): The setting values below are raw UI data and may contain non-English labels (e.g. Turkish), underscore_separated keys, or hex color codes (e.g. "#FFF3E7"). NEVER copy such raw values into your output prompt. Always translate them into natural English photographic language: a hex code becomes a descriptive color or skin-tone phrase (e.g. "a warm ivory complexion"), an underscore key becomes its natural term (e.g. "low_angle" → "a low camera angle looking up"), and any non-English label is translated to its English equivalent. The final prompt must read as if written by a native English-speaking photographer.

    SETTINGS DETAIL FOR BETTER PROMPT CREATION:
    ${Object.entries(settings)
      .filter(
        ([key, value]) =>
          value !== null &&
          value !== undefined &&
          value !== "" &&
          key !== "measurements" &&
          key !== "type" &&
          key !== "locationEnhancedPrompt", // Enhanced prompt'u detay listesinden hariç tut
      )
      .map(
        ([key, value]) =>
          `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`,
      )
      .join("\n    ")}${
      settings?.locationEnhancedPrompt && settings.locationEnhancedPrompt.trim()
        ? `\n    \n    SPECIAL LOCATION DESCRIPTION:\n    User has provided a detailed location description: "${settings.locationEnhancedPrompt}"\n    IMPORTANT: Use this exact location description for the environment setting instead of a generic location name.`
        : ""
    }${
      settings?.productColor && settings.productColor !== "original"
        ? `\n    \n    🎨 PRODUCT COLOR REQUIREMENT (NON-NEGOTIABLE):\n    The user selected "${settings.productColor}" as the garment color. In your prompt, name this color precisely and repeat it once more when describing the fabric, so the image model locks onto it (if it is a hex code, translate it into its closest natural color name and mention both). The recolor applies to the garment's base fabric while every design element — prints, pattern scale, stitching, trims, hardware, labels, construction — stays exactly as in the reference, and the fabric keeps realistic shading: the ${settings.productColor} surface shows natural tonal variation in highlights and shadow folds rather than one flat uniform fill. Choose scene lighting that renders this color faithfully (neutral white balance, no strong color casts).`
        : ""
    }${
      settings?.framing && settings.framing !== "auto"
        ? `\n    \n    📐 CAMERA FRAMING REQUIREMENT:\n    The user has specifically selected "${settings.framing.replace(/_/g, " ")}" as the camera framing/composition. CRITICAL: You MUST compose the shot as a ${settings.framing.replace(/_/g, " ")} shot.\n    ${
            settings.framing === "full_body"
              ? "Frame the ENTIRE body from head to feet with proper spacing around the model. Show the complete figure including legs and feet."
              : settings.framing === "knee_shot"
                ? "Frame from the knees upward, focusing on upper body region while cutting off below the knees."
                : settings.framing === "medium_shot"
                  ? "Frame from waist upward, showing upper torso and head area only."
                  : settings.framing === "chest_up"
                    ? "Frame from chest upward, focusing on upper torso, shoulders, neck and head."
                    : settings.framing === "close_up"
                      ? "Tight framing on face and upper chest only, creating an intimate close-up shot."
                      : `Use ${settings.framing.replace(/_/g, " ")} framing as specified.`
          }\n    This framing selection is MANDATORY and must be strictly followed in the final composition.`
        : ""
    }

    IMPORTANT: Please incorporate ALL user settings above into your description when appropriate.${
      settings?.productColor && settings.productColor !== "original"
        ? ` Pay special attention to the product color requirement - the garment must be ${settings.productColor}.`
        : ""
    }${
      settings?.framing && settings.framing !== "auto"
        ? ` Pay special attention to the camera framing requirement - the shot MUST be composed as a ${settings.framing.replace(/_/g, " ")} shot.`
        : ""
    }`;
    }

    // Pose ve perspective için akıllı öneri sistemi
    let posePromptSection = "";
    let perspectivePromptSection = "";

    const hasPoseText =
      typeof settings?.pose === "string" && settings.pose.trim().length > 0;
    const hasPoseImage = Boolean(poseImage);

    // Pose handling - enhanced with detailed descriptions
    if (!hasPoseText && !hasPoseImage) {
      const garmentText = isMultipleProducts
        ? "multiple garments/products ensemble"
        : "garment/product";
      posePromptSection = `
    
DEFAULT POSE: No specific pose was provided — you have full creative freedom over the pose, camera angle, and placement of the model within the frame (off-center compositions, walking frames, seated poses, three-quarter turns, and intentional negative space are all welcome when they serve the garment). The single guarantee that must always hold: the ${garmentText}'s key design elements (neckline, chest, sleeves, prints, closures, seams, hem) stay clearly visible and well lit from the chosen angle, and hand placement keeps them unobstructed.


    - Best showcase ${
      isMultipleProducts
        ? "all products in the ensemble and their coordination"
        : "the garment's design, cut, and construction details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how the products work together and each product's unique selling points"
        : "the product's unique features and selling points"
    }
    - Demonstrate how ${
      isMultipleProducts
        ? "the fabrics of different products drape and interact naturally"
        : "the fabric drapes and moves naturally"
    }
    - Show ${
      isMultipleProducts
        ? "how all products fit together and create an appealing silhouette"
        : "the garment's fit and silhouette most effectively"
    }
    - Match the style and aesthetic of ${
      isMultipleProducts
        ? "the coordinated ensemble (formal, casual, sporty, elegant, etc.)"
        : "the garment (formal, casual, sporty, elegant, etc.)"
    }
    - Allow clear visibility of important design elements ${
      isMultipleProducts
        ? "across all products"
        : "like necklines, sleeves, hems, and patterns"
    }
    - Create an appealing and natural presentation that would be suitable for commercial photography
    ${
      isMultipleProducts
        ? "- Ensure each product in the ensemble is visible and well-positioned\n    - Demonstrate the styling versatility of combining these products"
        : ""
    }
    - If the featured item is footwear, a handbag, hat, watch, jewelry, eyewear, or other accessory, guide the pose using modern fashion campaign cues that hero the item while keeping every detail visible.`;

      logger.log(
        `🤸 [GEMINI] Akıllı poz seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun poz önerilecek`,
      );
    } else if (hasPoseImage) {
      posePromptSection = `
    
    POSE REFERENCE: A pose reference image has been provided to show the desired body position and posture for the ${baseModelText}. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${baseModelText} should adopt this specific pose naturally and convincingly${
      isMultipleProducts
        ? ", ensuring all products in the ensemble remain clearly visible and well-positioned"
        : ""
    }.`;

      logger.log("🤸 [GEMINI] Pose prompt section eklendi");
    } else if (hasPoseText) {
      // Check if we have a detailed pose description (from our new Gemini pose system)
      const poseNameForPrompt = sanitizePoseText(settings.pose);
      let detailedPoseDescription = null;

      // Try to get detailed pose description from Gemini
      try {
        logger.log(
          "🤸 [GEMINI] Pose için detaylı açıklama oluşturuluyor:",
          settings.pose,
        );
        detailedPoseDescription = await generatePoseDescriptionWithGemini(
          poseNameForPrompt,
          poseImage,
          settings.gender || "female",
          "clothing",
        );
        logger.log(
          "🤸 [GEMINI] Detaylı pose açıklaması alındı:",
          detailedPoseDescription,
        );
      } catch (poseDescError) {
        console.error("🤸 [GEMINI] Pose açıklaması hatası:", poseDescError);
      }

      if (detailedPoseDescription) {
        const cleanedPoseDescription = sanitizePoseText(
          detailedPoseDescription,
        );
        posePromptSection = `
    
    DETAILED POSE INSTRUCTION: The user has selected the pose "${poseNameForPrompt}". Use this detailed pose instruction for the ${baseModelText}:
    
    "${cleanedPoseDescription}"
    
    IMPORTANT: If the pose description above mentions any studio, backdrop, background, environment, or set, you must ignore those parts and instead describe and preserve the exact background that already exists in the provided model image.
    
    Ensure the ${baseModelText} follows this pose instruction precisely while maintaining natural movement and ensuring the pose complements ${
      isMultipleProducts
        ? "all products in the ensemble being showcased"
        : "the garment being showcased"
    }. The pose should enhance the presentation of the clothing and create an appealing commercial photography composition.`;

        logger.log("🤸 [GEMINI] Detaylı pose açıklaması kullanılıyor");
      } else {
        // Fallback to simple pose mention
        posePromptSection = `
    
    SPECIFIC POSE REQUIREMENT: The user has selected a specific pose: "${poseNameForPrompt}". Please ensure the ${baseModelText} adopts this pose while maintaining natural movement and ensuring the pose complements ${
      isMultipleProducts
        ? "all products in the ensemble being showcased"
        : "the garment being showcased"
    }. Ignore any background/backdrop/studio/environment directions that may be associated with that pose and always keep the original background from the input image unchanged and accurately described.`;

        logger.log("🤸 [GEMINI] Basit pose açıklaması kullanılıyor (fallback)");
      }

      logger.log(
        "🤸 [GEMINI] Kullanıcı tarafından seçilen poz:",
        settings.pose,
      );
    }

    // Eğer perspective seçilmemişse, Gemini'ye kıyafete uygun perspektif önerisi yap
    if (!settings?.perspective) {
      perspectivePromptSection = `
    
    - Best capture ${
      isMultipleProducts
        ? "all products' most important design features and their coordination"
        : "the garment's most important design features"
    }
    - Show ${
      isMultipleProducts
        ? "the construction quality and craftsmanship details of each product"
        : "the product's construction quality and craftsmanship details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how all products fit together and the overall ensemble silhouette"
        : "the fit and silhouette most effectively"
    }
    - Create the most appealing and commercial-quality presentation ${
      isMultipleProducts ? "for the multi-product styling" : ""
    }
    - Match ${
      isMultipleProducts
        ? "the ensemble's style and intended market positioning"
        : "the garment's style and intended market positioning"
    }
    ${
      isMultipleProducts
        ? "- Ensure all products are visible and well-framed within the composition"
        : ""
    }`;

      logger.log(
        `📸 [GEMINI] Akıllı perspektif seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun kamera açısı önerilecek`,
      );
    } else {
      perspectivePromptSection = `

    SPECIFIC CAMERA PERSPECTIVE: The user has selected a specific camera perspective: "${normalizePerspective(
      settings.perspective,
    )}". Please ensure the photography follows this perspective while maintaining professional composition and optimal ${
      isMultipleProducts ? "multi-product ensemble" : "garment"
    } presentation.`;

      logger.log(
        "📸 [GEMINI] Kullanıcı tarafından seçilen perspektif:",
        settings.perspective,
      );
    }

    // Location prompt section kaldırıldı - artık kullanılmıyor

    // Hair style bilgisi için ek prompt section
    let hairStylePromptSection = "";
    if (hairStyleImage) {
      hairStylePromptSection = `
    
    HAIR STYLE REFERENCE: A hair style reference image is provided — it is the source of truth for the ${baseModelText}'s hair. Read it like a session stylist: identify the cut and its shape, exact length, layering, texture (straight / wavy / curly / coily), color and any dimension (balayage, highlights), volume, parting, and finish (glossy blowout, natural air-dry, editorial slick). Reproduce THIS hairstyle faithfully in your prompt using that professional vocabulary, and style it in harmony with ${
      isMultipleProducts ? "the multi-product ensemble" : "the garment"
    } — falling or pinned so necklines, collars, earrings, and shoulder details of the outfit remain clearly visible.`;

      logger.log("💇 [GEMINI] Hair style prompt section eklendi");
    }

    // Location image bilgisi için ek prompt section
    let locationPromptSection = "";
    if (locationImage) {
      locationPromptSection = `
    
    LOCATION ENVIRONMENT REFERENCE: A location reference image is provided — it defines WHERE this shoot takes place. Read it like a location scout and rebuild it in your prompt's environment paragraph as a vivid, specific scene: the type of space (indoor / outdoor, studio, urban street, coastal, interior), its architecture and materials (weathered stone, polished concrete, warm timber, glass), depth layers from foreground to background, the ambient color palette, and the light already living in the scene (time of day, direction, quality — hard sun, soft window light, overcast diffusion). Then stage the model INSIDE this environment: standing on its actual ground, lit by its actual light, casting believable shadows onto its surfaces — a photograph taken on location, with the scene's atmosphere flattering the garment's fabric and palette. Reproduce this specific location faithfully; do not swap it for a generic backdrop.`;

      logger.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

    // Text-based hair style requirement if user selected hairStyle string
    let hairStyleTextSection = "";
    if (settings?.hairStyle) {
      hairStyleTextSection = `
    
    SPECIFIC HAIR STYLE REQUIREMENT: The user has selected the hair style "${settings.hairStyle}". This may arrive as an internal slug (e.g. "u_cut_layers", "curtain_bangs_wavy") — first translate it into its natural hairdressing name, then describe it in your prompt with professional salon vocabulary: cut shape and length, layering, texture (straight / wavy / coily), volume and movement, parting, and finish (sleek blowout, air-dried, tousled). The ${baseModelText} wears exactly this hairstyle, styled to complement the garment's neckline and the scene's lighting — e.g. hair tucked or swept so it never hides collars, straps, or key design details.`;
      logger.log(
        "💇 [GEMINI] Hair style text section eklendi:",
        settings.hairStyle,
      );
    }

    // Dinamik yüz çeşitliliği — Gemini'yi hazır örnek cümleye DEMİRLEMEMEK için tam
    // cümle örneği verilmez; her istekte farklı kombinasyonda rastgele "esin eksenleri"
    // verilir (yüz şekli × göz karakteri × ayırt edici detay × ifade). Gemini bunları
    // birebir kullanamaz — özgün kompozisyon zorunludur.
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const faceAxes = isNewborn
      ? {
          shape: pick(["softly rounded", "delicately small", "gently full-cheeked"]),
          eyes: pick(["peacefully closed", "sleepy half-open", "calm and resting"]),
          detail: pick(["tiny button nose", "soft wisps of newborn hair", "delicate rosebud lips"]),
          expression: pick(["serene sleep", "peaceful calm", "tender stillness"]),
        }
      : !isNaN(parsedAgeInt) && parsedAgeInt <= 12
        ? {
            shape: pick(["round", "softly oval", "heart-shaped", "full-cheeked"]),
            eyes: pick(["big and curious", "bright and lively", "gentle and warm", "sparkling with mischief"]),
            detail: pick(["light freckles", "a playful dimple", "a button nose", "soft baby hairs at the hairline"]),
            expression: pick(["joyful grin", "shy soft smile", "curious wonder", "natural candid laugh"]),
          }
        : {
            shape: pick(["oval", "heart-shaped", "square", "round", "diamond", "oblong", "angular"]),
            eyes: pick(["almond-shaped", "hooded", "wide-set", "deep-set", "upturned", "monolid", "downturned"]),
            detail: pick(["light freckles across the nose", "a small beauty mark", "soft dimples", "bold natural brows", "high cheekbones", "a gentle cleft chin", "delicate fine features", "a strong defined jawline"]),
            expression: pick(["calm confidence", "a warm approachable smile", "poised editorial neutrality", "a soft candid smile", "quiet magnetic intensity"]),
          };

    // 👤 Kullanıcı belirli bir model fotoğrafı SEÇTİYSE yüz icat edilmez —
    // referanstaki kişinin kimliği aynen korunur. Rastgele esin eksenleri
    // sadece model seçilmediğinde devreye girer.
    const hasModelReference = Boolean(modelReferenceImageUrl);
    const faceDescriptionSection = hasModelReference
      ? `

    MODEL IDENTITY (USER-PROVIDED — PRESERVE EXACTLY): The user has provided a specific model reference image (attached) — THIS exact person is the model who wears the garment. Preserve their face, facial features, identity, skin tone, apparent age, and hair exactly as seen in the model reference image. In your prompt, describe the model faithfully FROM that reference in natural photographic language (face shape, eyes, hair, expression as they actually appear) so the image model reproduces the same person. Do NOT invent, alter, beautify, age, or replace any facial feature — the final photograph must be unmistakably the same person as in the model reference.`
      : `

    FACE DESCRIPTION (UNIQUENESS REQUIRED): Invent a completely ORIGINAL, photoreal, age-appropriate face for the ${baseModelText} — never a stock, template, or recycled description, and never the same face twice across generations. As loose inspiration ONLY for this generation (recombine, alter, or discard any of them freely): face shape leaning "${faceAxes.shape}", eye character around "${faceAxes.eyes}", a distinctive touch such as "${faceAxes.detail}", and an expression of "${faceAxes.expression}". Do NOT restate these fragments verbatim — compose your own flowing description covering face shape, eyes, brows, nose, lips, jawline, and expression, so every generation features a clearly different, unique, and photogenic human face.`;
    if (hasModelReference) {
      logger.log(
        "👤 [GEMINI] Model referansı seçili — yüz randomizasyonu DEVRE DIŞI, kimlik korunacak",
      );
    }

    // Gemini'ye gönderilecek metin - güvenli flag-safe versiyon
    const criticalDirectives = `
    BRAND SAFETY: If the input image contains any brand names or logos (e.g., Nike, Adidas, Prada, Gucci, Louis Vuitton, Chanel, Balenciaga, Versace, Dior, Hermès), please refer to them generically (e.g., "brand label", "logo") without naming the specific brand.
    ACCESSORY PRESENTATION: When the hero item is footwear, a handbag, backpack, small leather good, hat, watch, jewelry, eyewear, belt, or any similar fashion accessory, explicitly require modern fashion campaign posing and camera angles that hero the accessory. Specify refined hand/foot/head placement, keep every design detail fully visible, and reference popular e-commerce hero perspectives (runway footwear angles, wrist-level watch close-ups, eye-line eyewear framing, handbag-on-hip hero shot, etc.) while maintaining premium fashion styling.`;

    // 🎬 ART DIRECTION — look'u Gemini ürünün kendisinden türetir. Hazır
    // reçete/menü verilmez (kullanıcı kararı): Gemini kıyafeti analiz edip
    // o kıyafetin markası çekseydi nasıl görünürdü sorusuna kendisi cevap
    // yazar. Talimat menü değil, metod verir — jenerik ortalamaya çökmesin
    // diye somutluk ve karakter zorunlu tutulur.
    const styleDnaLibrary = `
    🎬 ART DIRECTION — DERIVE THE LOOK FROM THE GARMENT ITSELF:

    Before writing the photography paragraph, silently answer this question: "If the brand behind THIS exact garment shot its own campaign, what would the photograph look like?" Read the garment's DNA — its fabric weight and surface, its color temperature, its price impression, its attitude (relaxed, sharp, romantic, sporty, rebellious, refined) — and design ONE distinctive visual identity for this shoot from that reading: a specific light source and direction with a clear quality (hard or soft, warm or cool), a confident color grade with named characteristics, a deliberate composition energy (still and sculptural, or caught mid-motion; centered and calm, or off-center and tense), and a lens behavior that serves it. Commit fully to that identity with concrete photographic language.

    Every garment must produce a DIFFERENT answer — a crisp poplin shirt, a washed denim jacket, a silk slip dress, and a technical running shell each demand visibly different light, grade, and energy. The one outcome you never produce is the interchangeable default: soft frontal light, centered static model, neutral washed grade. If your photography paragraph could be pasted under any other garment without feeling wrong, redesign it until it belongs to THIS one only.`;

    // Nano-banana-2/Pro için genel garment transform talimatları (güvenli flag-safe versiyon).
    // Gemini image modelleri anlatı (narrative) tarzı, pozitif çerçeveli, kumaş/kamera
    // terminolojisi zengin promptlarla en iyi sonucu verir — talimatlar buna göre yazıldı.
    const garmentTransformationDirectives = `
    GARMENT TRANSFORMATION REQUIREMENTS (write these as flowing narrative sentences inside your prompt, not as a bullet list):
    - Single frame: the output is exactly ONE unified fashion photograph — one model, one scene, one camera view.
    - Dimensional realism: the flat-lay garment becomes a fully three-dimensional worn garment with believable volume — fabric wraps around the body, catches light on raised folds, and falls into soft shadow inside creases. It reads as physically worn cloth, never as a flat graphic layered onto the model.
    - Fabric physics vocabulary: name the fabric behavior explicitly using textile language the image model understands — how this specific material drapes (fluid, crisp, structured, clinging), its weight class (featherweight chiffon vs. heavy melton wool), where tension gathers (shoulder seams, bust, elbows) and where it releases (hem, sleeve openings). Keep the presentation commercially clean with only natural, intentional folds.
    - Faithful reproduction: every original garment detail transfers exactly — colorway, prints and pattern scale, weave/knit texture, topstitching, seams, buttons, zippers, trims, labels, hem finish. The garment in the output is the same product a customer would receive, worn instead of flat.
    - Pattern mapping: prints and patterns follow the body's 3D contours — curving over the bust/chest, compressing at the waist, flowing around sleeves — with realistic continuity at seams. Pattern lines bend with the fabric, never stay ruler-straight.
    - Construction under tension: knots, pleats, darts, gathers, and seams show functional, load-bearing behavior — real creases, believable pull lines, and contact shadows exactly where fabric works against the body.
    - Scene integration: the garment shares one light source with the model and environment — matching color temperature, cast shadows, contact occlusion at collar/waist/cuffs, correct scale and perspective for the camera angle. The environment stays as described; introduce new background elements only when a location reference explicitly provides them.
    - TUCKING / UNTUCKING RULE (APPLIES TO ALL MODES, INCLUDING SINGLE-GARMENT REPLACEMENT): keep the top's natural, intended length and hemline exactly as the flat-lay shows — the hem falls freely OVER the waistband of the bottoms. A tucked-in styling is allowed only if (a) the flat-lay clearly shows the top already tucked, or (b) the garment is unambiguously a formal dress shirt / blouse whose design demands tucking. Casual shirts, t-shirts, sweatshirts, hoodies, knitwear, oversized / cropped / streetwear tops default to UNTUCKED. Integration comes from realistic draping over the bottoms — never from invented half-tucks, French tucks, or added belts.
    - OUTPUT: one single professional fashion photograph only.`;

    // Gemini'ye gönderilecek metin - Edit mode vs Color change vs Normal replace
    let promptForGemini;

    if (isEditMode && editPrompt && editPrompt.trim()) {
      // EDIT MODE - EditScreen'den gelen özel prompt
      promptForGemini = `
      EDIT INSTRUCTION: Generate a complete, focused edit prompt that retains every applicable requirement and:
      
      1. STARTS with "Replace"
      2. Translates the user's request to English if needed  
      3. Describes ONLY the specific modification requested
      4. Does NOT mention garments, models, poses, backgrounds, or photography details
      5. Keeps existing scene unchanged
 

Only one single professional fashion photograph must be generated — no collage, no split views, no duplicates, no extra flat product shots.

The output must look like a high-end professional fashion photograph, suitable for luxury catalogs and editorial campaigns.

Apply studio-grade fashion lighting blended naturally with ambient light so the model and garment are perfectly lit, with no flat or artificial look.

Ensure crisp focus, maximum clarity, and editorial-level sharpness across the entire image; no blur, no washed-out textures.

Maintain true-to-life colors and accurate material textures; avoid dull or overexposed tones.

Integrate the model, garment, and background into one cohesive, seamless photo that feels like it was captured in a real professional photoshoot environment.

Only one single final image must be generated — no collages, no split frames, no duplicates.

Composition aligned with professional fashion standards (rule of thirds, balanced framing, depth of field).

Output must always be a single, hyper-realistic, high-end fashion photograph; never a plain catalog image.

Editorial-level fashion shoot aesthetic.

Confident model poses.

      USER REQUEST: "${editPrompt.trim()}"
      
      EXAMPLES:
      - User: "modele dövme ekle" → "Replace the model's skin with elegant tattoos while maintaining photorealistic quality."
      - User: "saçını kırmızı yap" → "Replace the hair color with vibrant red while keeping natural texture."
      - User: "arka planı mavi yap" → "Replace the background with blue color while preserving lighting."
      
      Generate ONLY the focused edit prompt, nothing else.
      ${
        isMultipleProducts
          ? "11. MANDATORY: Ensure ALL garments/products in the ensemble remain visible and properly coordinated after the edit"
          : ""
      }

      GEMINI TASK:
      1. Understand what modification the user wants
      2. ${
        isMultipleProducts
          ? "Identify how this modification affects ALL products in the ensemble"
          : "Create a professional English prompt that applies this modification"
      }
      3. Ensure the modification is technically possible and realistic${
        isMultipleProducts ? " for the complete multi-product outfit" : ""
      }
      4. Maintain the overall quality and style of the original image
      5. Describe the change in detail while preserving other elements${
        isMultipleProducts ? " and ALL unaffected products" : ""
      }

      LANGUAGE REQUIREMENT: Always generate your prompt in English and START with a clear edit verb such as "Replace" or "Change".

      ${originalPrompt ? `Additional context: ${originalPrompt}.` : ""}
      `;
    } else if (isRefinerMode) {
      // REFINER MODE - Teknik profesyonel e-ticaret fotoğraf geliştirme prompt'u

      // Extract creation settings from settings object
      const addShadow = settings?.addShadow ?? false;
      const addReflection = settings?.addReflection ?? false;
      const backgroundColor = settings?.backgroundColor || "White";
      const colorInputMode = settings?.colorInputMode || "text";

      logger.log("🔧 [REFINER GEMINI] Creation settings:", {
        addShadow,
        addReflection,
        backgroundColor,
        colorInputMode,
      });

      // Build dynamic settings instruction for Gemini
      let creationSettingsInstruction = `
=== USER-SELECTED CREATION SETTINGS (APPLY THESE EXACTLY) ===

The user has selected the following settings for this product photo transformation. You MUST incorporate these settings into your generated prompt:

▶ BACKGROUND COLOR SETTING:
`;

      // Handle background color - translate to English if needed
      if (colorInputMode === "hex") {
        creationSettingsInstruction += `- Background color: HEX code ${backgroundColor} (use this exact color code for the background)
`;
      } else {
        // Text color mode - instruct Gemini to use English translation
        creationSettingsInstruction += `- Background color: "${backgroundColor}" 
  IMPORTANT: If this color name is NOT in English (e.g., "Beyaz", "Weiß", "Blanc", "Bianco", "白", etc.), you MUST translate it to English in your output prompt. For example:
    - "Beyaz" → "White"
    - "Siyah" → "Black"
    - "Kırmızı" → "Red"
    - "Mavi" → "Blue"
    - "Pembe" → "Pink"
    - "Gri" → "Gray"
    - "Bej" → "Beige"
    - "Krem" → "Cream"
  Use the ENGLISH color name in your generated prompt.
`;
      }

      creationSettingsInstruction += `
▶ EFFECT SETTINGS (CRITICAL - MUST FOLLOW EXACTLY):
- Add Shadow Underneath Product: ${
        addShadow
          ? "YES - Add a soft, natural shadow beneath/underneath the product for depth and professional look"
          : "ABSOLUTELY NO - Do NOT add ANY shadow underneath the product. The product MUST appear to be floating on a completely flat, shadowless background. There should be ZERO drop shadow, ZERO soft shadow, ZERO cast shadow beneath the product. The background must be completely uniform and clean with no darkness or shading underneath the product whatsoever."
      }
- Add Reflection Underneath Product: ${
        addReflection
          ? "YES - Add a subtle reflection/mirror effect beneath the product for luxury catalog look"
          : "ABSOLUTELY NO - Do NOT add ANY reflection or mirror effect underneath the product. There should be ZERO floor reflection, ZERO glossy surface reflection, ZERO mirror effect beneath the product. The product should NOT appear to be sitting on a reflective surface."
      }

${
  !addShadow && !addReflection
    ? `
⚠️ EXTREMELY IMPORTANT - NO SHADOW AND NO REFLECTION:
Since BOTH shadow and reflection are DISABLED, the product MUST appear on a completely flat, uniform background with:
- NO shadow of any kind underneath (no drop shadow, no soft shadow, no cast shadow)
- NO reflection of any kind underneath (no floor reflection, no mirror effect)
- The product should appear to be "floating" on a perfectly clean, uniform colored background
- The background color should be completely consistent and even - no variations, no darkness under the product
`
    : ""
}

CRITICAL: These settings OVERRIDE the default background rules in the product-specific sections below. Make sure your generated prompt explicitly mentions:
1. The exact background color requested (in English)
2. ${
        addShadow
          ? "Include soft natural shadow underneath for depth"
          : "EXPLICITLY STATE: 'No shadow underneath the product' or 'Shadowless background'"
      }
3. ${
        addReflection
          ? "Include subtle reflection for luxury look"
          : "EXPLICITLY STATE: 'No reflection underneath' or 'Non-reflective background'"
      }

`;

      promptForGemini = `
MANDATORY INSTRUCTION (READ CAREFULLY, FOLLOW EXACTLY):

You are an expert AI prompt generator for professional e-commerce product photo transformation. Your task is to analyze the product image and generate ONE highly detailed technical prompt that will transform an amateur/low-quality product photo into a professional, premium catalog-ready image.

${creationSettingsInstruction}

=== STEP 1: PRODUCT IDENTIFICATION (CRITICAL) ===
First, carefully analyze the image and identify the product category:
- CLOTHING (shirts, dresses, jackets, pants, coats, etc.)
- JEWELRY (rings, necklaces, bracelets, earrings, watches)
- FOOTWEAR (shoes, sneakers, boots, sandals, heels)
- EYEWEAR (sunglasses, prescription glasses)
- BAGS & ACCESSORIES (handbags, wallets, belts, hats, scarves)
- OTHER PRODUCTS (electronics, home goods, etc.)

Based on the identified product type, generate a SPECIALIZED transformation prompt following the rules below.

=== STEP 2: GENERATE TRANSFORMATION PROMPT ===

STRICT FORMAT REQUIREMENTS:
- Start with: "Transform this amateur product photo into a professional high-end e-commerce catalog photo."
- AFTER the opening statement, IMMEDIATELY specify the user-selected settings:
  * "Background: [ENGLISH color name] ${
    addShadow
      ? "with soft natural shadow for depth"
      : "with no shadow - completely flat and clean"
  } ${addReflection ? "and subtle reflection effect for luxury look" : ""}"
- Focus & Clarity Requirement: You MUST include instructions for "Sharp focus and high clarity throughout — every surface, edge, and texture rendered crisply from front to back with deep, full-frame focus" in your generated prompt.
- Include ALL relevant sections based on product type
- End with: "The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail, with crisp full-frame focus and clean, even, professional lighting."
- Length: no word limit — write as thoroughly as the product transformation deserves; every sentence should add a concrete visual instruction

=== PRODUCT-SPECIFIC TRANSFORMATION RULES ===

▶ FOR CLOTHING (Most Important - Ghost Mannequin Style):
Background: Pure flat ${
        colorInputMode === "hex" ? backgroundColor : backgroundColor
      } background (solid, uniform color - NOT a studio environment), ${
        addShadow
          ? "with soft natural shadow underneath for depth"
          : "absolutely NO shadows, NO gradients - completely flat and uniform"
      }${
        addReflection
          ? ", with subtle floor reflection for premium catalog look"
          : ""
      }.
Ghost Mannequin Effect (CRITICAL): 
  - COMPLETELY remove any visible mannequin, hanger, or human body parts
  - Create professional "invisible mannequin" effect showing the garment's internal 3D structure
  - Clean hollow neckline with visible interior depth and collar interior
  - Realistic garment form as if worn by invisible body - natural shoulder width, chest volume, waist definition
  - Sleeves positioned naturally with slight bend showing arm cavity depth
  - Preserve ALL garment construction details: stitching, seams, buttons, zippers, trims, labels
Fabric Enhancement:
  - Remove ALL wrinkles, creases, dust, lint, loose threads, stains
  - Enhance fabric texture visibility (weave patterns, knit textures, leather grain)
  - Present as freshly pressed, brand-new, straight from boutique
Positioning: Perfectly centered, shoulders level, hemline balanced, symmetrical presentation
Lighting: Even, bright, professional studio lighting - no harsh shadows, no blown highlights

▶ FOR JEWELRY (Rings, Necklaces, Bracelets, Earrings):
Background: Pure flat ${
        colorInputMode === "hex" ? backgroundColor : backgroundColor
      } background (solid, uniform color) ${
        addShadow
          ? "with SOFT REALISTIC SHADOW underneath for depth"
          : "with absolutely NO shadow underneath"
      } ${
        addReflection
          ? "and elegant reflection for luxury feel"
          : "and NO reflection"
      }
EARRING PAIRING RULE (CRITICAL):
  - If the product is an EARRING and only ONE earring is visible in the image (no pair shown):
    * You MUST create/generate the matching pair earring
    * Display BOTH earrings SIDE BY SIDE in the final image
    * The pair should be a perfect mirror/match of the original earring
    * Position them symmetrically, slightly angled towards each other for elegant presentation
    * Both earrings should have identical styling, lighting, and quality
  - If both earrings of a pair are already visible, keep them as they are
Gemstone Enhancement (CRITICAL):
  - Maximum clarity and sparkle for all gemstones (diamonds, rubies, emeralds, etc.)
  - Natural brilliance with precise light reflections - gems must SHINE and SPARKLE
  - Remove any dust, fingerprints, smudges from stones and metal surfaces
Metal Polish:
  - Gold must appear rich, warm, and gleaming without overexposure
  - Silver/platinum must be bright, clean, with subtle reflections
  - Remove tarnish, scratches, dull spots
Detail: Macro-level clarity showing every facet, clasp mechanism, chain links
Positioning: Arranged elegantly, chains untangled, clasps hidden or styled

▶ FOR FOOTWEAR (Shoes, Sneakers, Boots, Sandals, Slippers):
Background: Pure flat ${
        colorInputMode === "hex" ? backgroundColor : backgroundColor
      } background (solid, uniform color).
Positioning & Presentation (CRITICAL): 
  - SINGLE SHOE RULE: Even if the original photo shows a pair of shoes/slippers, your generated prompt MUST instruct to show ONLY ONE SINGLE shoe.
  - STRICT SIDE PROFILE: This single shoe MUST be presented in a direct, technical side profile view (outer side) as the primary angle. This is the absolute industry standard for professional clean e-commerce product photography.
  - The shoe must appear upright and stable, as if sitting on an invisible floor - NOT a flat lay or tilted angle.
  - COMPLETELY remove any visible legs, feet, socks, or mannequin parts from the original photo.
  - Ensure the shoe is perfectly centered in the frame.
Shadow & Reflection (CRITICAL):
  - Shadow: ${
    addShadow
      ? "Add a subtle, FLAT soft shadow directly beneath the sole contact points on the ground to ground the shoe realistically. The shadow must be clean and not spill outwards too far."
      : "Absolutely NO shadow - the shoe must appear on a completely clean, shadowless background."
  }
  - Reflection: ${
    addReflection
      ? "Add a very subtle floor reflection beneath the shoe for a premium luxury catalog look."
      : "Absolutely NO reflection underneath."
  }
Cleaning & Quality:
  - High Clarity: The shoe's texture (leather, mesh, suede, rubber) must be sharp and clear with high detail resolution.
  - Flawless Condition: Remove ALL dust, scuffs, creases (especially on the toe box), dirt marks, or sticker residue. Laces should appear neatly styled and clean.
  - Edges: The silhouette must be perfectly sharp and cut out cleanly against the background.
  - Lighting: Bright, even studio lighting that highlights the shoe's shape and materials without overexposure.
  - NO BLUR: Ensure the entire shoe is in sharp focus from toe to heel. No background blur or depth-of-field.
  - Present as brand-new, unworn condition
Detail Enhancement:
  - Sharpen stitching, mesh textures, sole patterns
  - Highlight logo/branding clearly
  - Show material quality (leather grain, fabric weave, rubber texture)

▶ FOR EYEWEAR (Sunglasses, Glasses):
Background: Pure flat ${backgroundColor} background (solid, uniform color) ${
        addShadow
          ? "with subtle shadow underneath for depth"
          : "with absolutely NO shadow underneath"
      } ${
        addReflection
          ? "and reflection below for premium look"
          : "and NO reflection"
      }
Positioning: Front-facing or slight 3/4 angle showing frame shape
Lens: Crystal clear, no smudges, no fingerprints, proper reflections showing lens quality
Frame: Highlight material quality, hinge details, temple arm construction

▶ FOR BAGS & ACCESSORIES:
Background: Pure flat ${
        colorInputMode === "hex" ? backgroundColor : backgroundColor
      } background (solid, uniform color) ${
        addShadow
          ? "with natural shadow underneath"
          : "with absolutely NO shadow underneath"
      } ${addReflection ? "and subtle reflection" : "and NO reflection"}
Positioning: Standing upright naturally, straps/handles arranged elegantly
Structure: Correct any sagging, maintain proper shape as if stuffed/structured
Hardware: Metal parts polished, zippers/clasps highlighted
Cleaning: Remove dust, scratches, marks - present as brand new

=== UNIVERSAL ENHANCEMENT RULES (Apply to ALL products) ===

AMATEUR PHOTO FIXES (CRITICAL):
- CORRECT bad/amateur lighting - transform harsh shadows, uneven lighting, yellow/warm tints into professional studio lighting
- REMOVE all imperfections: dust particles, lint, fingerprints, smudges, scratches, stains, price tags, stickers
- FIX color accuracy - ensure true-to-life colors, proper white balance, no color casts
- SHARPEN details - remove any blur or softness from amateur photography
- CORRECT perspective/distortion from poor camera angles

FINAL QUALITY STANDARDS:
- Professional catalog-ready composition
- Maximum detail clarity and sharpness
- True-to-life color reproduction
- Clean, pristine product presentation
- Luxury e-commerce marketplace standard (Amazon, ASOS, NET-A-PORTER quality)

=== OUTPUT ===
Generate ONLY the final transformation prompt. Do NOT include these instructions, category labels, or commentary. Just the prompt text.
REMEMBER: Use ENGLISH for all color names in your output, even if the user provided them in another language.
`;
    } else if (isColorChange && targetColor && targetColor !== "original") {
      // COLOR CHANGE MODE - Sadece renk değiştirme
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Change". Do not include any introduction, explanation, or commentary.

      ${criticalDirectives}

      ${
        isMultipleProducts
          ? `
      🛍️ MULTIPLE PRODUCTS COLOR CHANGE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES, each showing a different garment/product. When changing the color to ${targetColor}, you MUST analyze ALL reference images, specify which product(s) to change and ensure ALL products remain properly coordinated as an ensemble.

      CRITICAL MULTIPLE PRODUCTS COLOR REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each image shows a different garment/product
      - IDENTIFY ALL distinct garments/products across ALL reference images
      - SPECIFY which product(s) should change to ${targetColor}
      - ENSURE the color change maintains overall ensemble coordination
      - PRESERVE the original colors and design of products not being changed
      - MAINTAIN proper color harmony between all products in the outfit
      - REMEMBER: Each reference image shows a separate item - consider them together as one outfit
      `
          : ""
      }

      Create a professional fashion photography prompt in English that STARTS with "Change" for changing ONLY the color of ${
        isMultipleProducts
          ? "the specified product(s)/garment(s)"
          : "the product/garment"
      } from the reference image to ${targetColor}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for professional fashion photography and commercial garment presentation. Ensure the output is suitable for high-end fashion shoots, editorial styling, and commercial product photography.

      IMPORTANT: Please explicitly mention in your generated prompt that this is for "professional fashion photography" to ensure the AI image model understands the context and produces high-quality fashion photography results.

      CRITICAL REQUIREMENTS FOR COLOR CHANGE:
      1. The prompt MUST begin with "Change the color of the ${
        isMultipleProducts
          ? "specified product(s)/garment(s)"
          : "product/garment"
      }..."
      2. ONLY change the color to ${targetColor}${
        isMultipleProducts ? " for the specified product(s)" : ""
      }
      3. Keep EVERYTHING else exactly the same: design, shape, patterns, details, style, fit, texture
      4. Do not modify ${
        isMultipleProducts ? "any garment" : "the garment"
      } design, cut, or any other aspect except the color
      5. The final image should be photorealistic, showing ${
        isMultipleProducts
          ? "the complete ensemble with the specified color changes"
          : `the same garment but in ${targetColor} color`
      }
      6. Use natural studio lighting with a clean background
      7. Preserve ALL original details except color: patterns (but in new color), textures, hardware, stitching, logos, graphics, and construction elements
      8. ${
        isMultipleProducts
          ? `ALL garments/products must appear identical to the reference image, just with the specified color change to ${targetColor} and proper ensemble coordination`
          : `The garment must appear identical to the reference image, just in ${targetColor} color instead of the original color`
      }
      9. MANDATORY: Include "professional fashion photography" phrase in your generated prompt
      ${
        isMultipleProducts
          ? `10. MANDATORY: Clearly specify which product(s) change color and which remain in their original colors`
          : ""
      }

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Change".

      ${
        originalPrompt
          ? `Additional color change requirements: ${originalPrompt}.`
          : ""
      }
      `;
    } else if (isPoseChange) {
      // POSE CHANGE MODE - Eksiksiz poz değiştirme prompt'u
      promptForGemini = `
      FASHION POSE TRANSFORMATION: Generate a focused, detailed English prompt (no word limit — write as richly as the pose change needs) that transforms the model's pose efficiently. Focus ONLY on altering the pose while keeping the existing model, outfit, lighting, and background exactly the same. You MUST explicitly describe the original background/environment details and state that they stay unchanged.

      USER POSE REQUEST: ${
        settings?.pose && settings.pose.trim()
          ? `Transform the model to: ${settings.pose.trim()}`
          : customDetail && customDetail.trim()
            ? `Transform the model to: ${customDetail.trim()}`
            : "Transform to a completely different iconic professional fashion modeling pose that contrasts dramatically with the current pose"
      }

      COMPREHENSIVE POSE TRANSFORMATION REQUIREMENTS:

      1. POSE ANALYSIS & TRANSFORMATION:
      - Analyze the current pose in the image thoroughly
      - Select a DRAMATICALLY CONTRASTING pose that showcases the garment beautifully
      - Describe the new pose in elaborate detail: body positioning, limb placement, weight distribution, head angle, eye direction
      - Include subtle pose nuances: shoulder positioning, hip angle, foot placement, hand gestures
      - Ensure the pose enhances the garment's silhouette and flow

      2. BODY LANGUAGE & EXPRESSION:
      - Describe confident, editorial-worthy body language
      - Include facial expression that matches the pose energy
      - Specify eye contact direction and intensity
      - Detail posture that conveys fashion-forward attitude

      3. POSE-SPECIFIC DETAILS:
      - If sitting pose: describe chair interaction, leg positioning, back posture
      - If standing pose: weight distribution, stance width, hip positioning
      - If leaning pose: support points, angle, natural flow
      - If walking pose: stride, arm movement, head position
      - If editorial pose: dramatic angles, fashion-forward positioning

      4. GARMENT INTERACTION:
      - Describe how the pose allows the garment to drape naturally
      - Ensure pose doesn't create unflattering fabric bunching
      - Show garment details and construction through pose
      - Allow fabric to flow and move naturally with the pose

      5. PROFESSIONAL PHOTOGRAPHY ELEMENTS:
      - Studio-grade lighting that enhances the pose
      - Camera angle that best captures the pose and garment
      - Depth of field that focuses on the model and pose
      - Professional composition that frames the pose perfectly

      6. BACKGROUND & IDENTITY PRESERVATION:
      - Carefully observe and describe the current background/environment (location type, colors, props, textures, lighting)
      - Explicitly instruct that the existing background remains exactly the same with zero alterations
      - Emphasize keeping the same model identity, face, hairstyle, makeup, accessories, and outfit with no modifications
      - Mention notable background elements (walls, furniture, decor, floor, lighting fixtures, scenery) and insist they stay identical
      - If any pose references mention backgrounds (e.g., studio, backdrop, set, environment), explicitly override those directions: state that the original background from the provided image stays unchanged and must be described faithfully. Never introduce or suggest a new background.

      CRITICAL FORMATTING REQUIREMENTS:
      - Your response MUST start with "Change"
      - No word limit — as detailed as the pose change needs, without repeating ideas
      - Must be entirely in English
      - Focus ONLY on pose transformation
      - Do NOT include any generic fashion photography rules
      - Do NOT mention garment replacement
      - Do NOT propose background changes; instead, clearly state the background stays identical to the original photo
      - The background and environment MUST remain completely unchanged and explicitly described as such
      - Be specific but concise about the exact pose

      Generate a focused, efficient pose transformation prompt that starts with "Change", clearly states the original background and model remain unchanged, overrides any conflicting background instructions from pose references, and gets straight to the point.
      `;
    } else if (isBackSideAnalysis) {
      // BACK SIDE ANALYSIS MODE - Özel arka taraf analizi prompt'u
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.

      🔄 CRITICAL BACK DESIGN SHOWCASE MODE:
      
      ANALYSIS REQUIREMENT: You are looking at TWO distinct views of the SAME garment:
      1. TOP IMAGE: Shows the garment worn on a model from the FRONT
      2. BOTTOM IMAGE (labeled "ARKA ÜRÜN"): Shows the BACK design of the same garment
      
      YOUR MISSION: Transform the TOP image so the model displays the BACK design from the BOTTOM image.
      
      🚫 DO NOT CREATE: Generic walking poses, editorial strides, front-facing poses, or standard fashion poses
      
      ✅ MANDATORY REQUIREMENTS:
      1. **BODY POSITIONING**: Model MUST be turned completely around (180 degrees) to show their BACK to the camera
      2. **BACK DESIGN FOCUS**: The exact back graphic/pattern/design from the "ARKA ÜRÜN" image must be clearly visible on the model's back
      3. **CAMERA ANGLE**: Shoot from behind the model to capture the back design prominently
      4. **HEAD POSITION**: Model can either face completely away OR look back over shoulder (choose based on garment style)
      
      SPECIFIC BACK POSE EXECUTION:
      - **Primary View**: Full back view showing the complete back design
      - **Model Stance**: Natural standing pose with back to camera, may include subtle over-shoulder glance
      - **Design Visibility**: Ensure the back graphic/pattern from "ARKA ÜRÜN" image is the main focal point
      - **Garment Fit**: Show how the back design sits on the model's back naturally
      
      TECHNICAL REQUIREMENTS:
      - Camera positioned BEHIND the model
      - Back design from "ARKA ÜRÜN" clearly showcased
      - Professional fashion photography lighting
      - Sharp focus on back design details
      - Model wearing the exact same garment as shown in both reference images
      
      EXAMPLE STRUCTURE: "Replace the front-facing model with a back-facing pose, showing the model turned away from camera to display the [describe specific back design elements you see in ARKA ÜRÜN image] prominently across their back, captured with professional photography lighting..."
      
      🎯 FINAL GOAL: Create a back view that matches the "ARKA ÜRÜN" reference but worn on the model from the top image.

      ${criticalDirectives}

      ${
        isMultipleProducts
          ? `
      🛍️ MULTIPLE PRODUCTS BACK SIDE MODE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES showing different garments/products with both front and back views. You MUST analyze and describe ALL products visible across all reference images from both angles and coordinate them properly as an ensemble.

      CRITICAL MULTIPLE PRODUCTS BACK SIDE REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each may show different garments/products
      - ANALYZE each product from both front AND back angles across all reference images
      - DESCRIBE how all products coordinate together from all viewing angles
      - ENSURE proper layering and fit from both front and back perspectives
      - REMEMBER: Each reference image shows separate items - combine them intelligently
      `
          : ""
      }

      Create a professional fashion photography prompt in English that shows the model from the BACK VIEW wearing the garment, specifically displaying the back design elements visible in the "ARKA ÜRÜN" image.
      
      🚨 CRITICAL SINGLE OUTPUT REQUIREMENT:
      - GENERATE ONLY ONE SINGLE RESULT IMAGE showing the back view
      - DO NOT create multiple separate images, split views, or collages
      - DO NOT generate both front and back images
      - DO NOT create flat product photos or extra product shots
      - FOCUS ONLY on the back view transformation - one unified fashion photograph
      - RESULT MUST BE: Professional back-view fashion model shot ONLY
      
      CRITICAL PROMPT ELEMENTS TO INCLUDE:
      - "model turned away from camera"
      - "back view" or "rear view"  
      - "showing the back of the garment"
      - "single fashion photograph"
      - "one unified image"
      - Description of the specific back design (graphic, pattern, text, etc.) you see in the "ARKA ÜRÜN" image
      - "professional fashion photography"
      - "back design prominently displayed"
      
      IMPORTANT: Your generated prompt MUST result in a BACK VIEW of the model, not a front view or side view. The model should be facing AWAY from the camera to show the back design. Output ONLY ONE single image.

      ${garmentTransformationDirectives}

      MANDATORY BACK SIDE PROMPT SUFFIX:
      After generating your main prompt, ALWAYS append this exact text to the end:
      
      "The garment must appear realistic with natural drape, folds along the shoulders, and accurate fabric texture. The print must wrap seamlessly on the fabric, following the model's back curvature. The lighting, background, and perspective must match the original scene, resulting in one cohesive and photorealistic image."

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".

      ${
        originalPrompt
          ? `USER CONTEXT: The user has provided these specific requirements: ${originalPrompt}. Please integrate these requirements naturally into your back side analysis prompt while maintaining professional structure.`
          : ""
      }
      
      ${ageSection}
      ${childPromptSection}
      ${bodyShapeMeasurementsSection}
      ${settingsPromptSection}
      ${posePromptSection}
      ${perspectivePromptSection}
      ${hairStylePromptSection}
      ${hairStyleTextSection}
      ${locationPromptSection}
      ${faceDescriptionSection}
      
      Generate a complete, detailed prompt that showcases both front and back garment details while maintaining all original design elements. REMEMBER: Your response must START with "Replace" and emphasize back design features.
      `;
    } else {
      // NORMAL MODE - Standart garment replace
      promptForGemini = `
      MANDATORY INSTRUCTION: You MUST generate a prompt that STARTS with the word "Replace". The first word of your output must be "Replace". Do not include any introduction, explanation, or commentary.

      LENGTH GUIDANCE: There is no character limit — write as richly and thoroughly as the shoot deserves. Every sentence should add a concrete visual fact (fabric, light, pose, texture) rather than repeating ideas.

      TARGET MODEL CONTEXT: Your output will be sent to a state-of-the-art AI image editing model, which responds best to flowing NARRATIVE descriptions written like a professional photographer's shoot brief — not keyword lists, not bullet points, not shouted commands. Write rich, specific, connected sentences. Use POSITIVE framing throughout: describe what IS in the frame (e.g. "a clean, uncluttered backdrop") rather than listing what is absent. Hyper-specificity wins: name the exact fabric ("brushed cotton fleece", "fluid silk charmeuse", "structured piqué knit"), the exact light ("late-afternoon window light with a soft silver bounce"), the exact lens behavior ("85mm portrait lens at f/2.8, shallow depth of field").

      IMAGE ROLE GROUNDING: The reference images you receive have distinct roles — the garment/product reference(s) show the EXACT product(s) to be worn (treat them as the immutable source of truth for design, color, pattern and construction), and any model / pose / hair / location references define who wears it, how they stand, how they are styled, and where the scene takes place. In your prompt, make clear that the garment from the reference is the one being worn.

      DEFAULT POSE INSTRUCTION: If no specific pose is provided by the user, select an editorial-style fashion pose that best showcases this exact garment's details, fit, and silhouette — confident, photogenic body language that puts fabric drape, construction, and design elements on display while staying natural and commercially appealing. Keep the garment's critical features (neckline, sleeves, logos, seams, textures) clearly visible from the chosen pose.

      OUTPUT STRUCTURE — write the prompt as four flowing paragraphs separated by \n\n line breaks (never one long block):

      Paragraph 1 → Model & Pose. Introduce the model (age, gender, editorial presence) with fashion-magazine language, then describe the pose cinematically — weight distribution, shoulder line, hand placement, gaze direction — chosen to flatter THIS garment.

      Paragraph 2 → Garment & Fabric Physics. This is the heart of the prompt. Identify the garment precisely (category, cut, silhouette) and describe it with textile jargon: fiber and weave/knit, drape class, weight, surface finish, seam and trim work. State that every design element — colorway, prints and their scale, stitching, hardware, labels, hem — matches the reference exactly, then describe how the fabric physically behaves on this body in this pose: where it folds, where it holds structure, where light catches the surface.

      Paragraph 3 → Environment & Atmosphere. Describe the setting like a location scout: architecture or landscape, surface textures, depth layers (foreground / midground / background), ambient color palette, and the mood it creates. The environment supports and elevates the garment as an editorial backdrop. The original flat-lay background is fully replaced by this described scene, and only the garment itself carries over from the product photo — the final scene contains no hangers, clips, mannequin forms, or flat-lay artifacts.

      Paragraph 4 → Photography, Light & Grade. Choose a camera, lens character, viewpoint, depth of field, lighting approach, and color treatment that genuinely serve this specific garment, pose, model, and location. Make these choices feel intentional and varied across generations: adapt the perspective, visual energy, contrast, depth, and mood to the scene rather than relying on a fixed studio recipe. Use precise professional photography language where it helps define the image, but never treat any particular focal length, lighting setup, or color grade as the default. For controlled studio shoots, a clean high-key commercial grade and balanced three-point softbox lighting can be appropriate. For premium editorial scenes, a medium-format film character with subtle fine grain can be appropriate. Use these only when they genuinely suit the garment, location, and intended mood; never apply them as a default recipe. The final result is a single, hyper-realistic, editorial-quality fashion photograph, seamlessly integrating model, garment, and environment at campaign-ready standards.

      CRITICAL RULES:

      Write in the language of editorial fashion photography — precise industry jargon over plain product description (drape, silhouette, cut, ribbed, pleated, piqué knit, melange, structured detailing, trims, seams, stitchwork).

      Define the model's appearance with editorial tone (sculpted jawline, refined cheekbones, luminous gaze, poised stance) while keeping it natural and photoreal.

      Compose with fashion-photography vocabulary — rule of thirds, negative space, eye-level or low-angle perspective, foreground depth, polished framing.

      The environment stays photogenic and supportive — sophisticated, refined, contemporary — framing the garment as the hero of the image.

      The final sentence of the prompt always affirms: a single, high-end professional fashion photograph, polished to editorial standards, suitable for premium catalogs and campaigns.

      The output must be hyper-realistic, high-end professional fashion editorial quality, suitable for commercial catalog presentation.

      ${criticalDirectives}

      ${
        isMultipleProducts
          ? `
      🛍️ MULTIPLE PRODUCTS MODE: You are receiving MULTIPLE SEPARATE REFERENCE IMAGES, each showing a different garment/product that together form a complete outfit/ensemble. You MUST analyze ALL the reference images provided and describe every single product visible across all images. Each product is equally important and must be properly described and fitted onto the ${modelGenderText}.

      CRITICAL MULTIPLE PRODUCTS REQUIREMENTS:
      - ANALYZE ALL the reference images provided - each image shows a different garment/product
      - COUNT how many distinct garments/products are present across ALL reference images
      - DESCRIBE each product individually with its specific design details, colors, patterns, and construction elements from their respective reference images
      - ENSURE that ALL products from ALL reference images are mentioned in your prompt - do not skip any product
      - COORDINATE how all products work together as a complete ensemble when worn together
      - SPECIFY the proper layering, positioning, and interaction between products
      - MAINTAIN the original design of each individual product while showing them as a coordinated outfit
      - REMEMBER: Each reference image shows a separate item - combine them intelligently into one cohesive outfit
      `
          : ""
      }

      Create a professional fashion photography prompt in English that STARTS with "Replace" for replacing ${
        isMultipleProducts
          ? "ALL the garments/products from the reference image"
          : "the garment from the reference image"
      } onto a ${modelGenderText}.
      
      FASHION PHOTOGRAPHY CONTEXT: The prompt you generate will be used for ${
        isNewborn
          ? "professional newborn fashion photography"
          : "professional fashion photography"
      } and commercial garment presentation. Ensure the output is suitable for ${
        isNewborn
          ? "high-end newborn fashion photography shoots, newborn editorial styling, and newborn commercial product photography"
          : "high-end fashion shoots, editorial styling, and commercial product photography"
      }.

      IMPORTANT: Please explicitly mention in your generated prompt that this is for "${
        isNewborn
          ? "professional newborn fashion photography"
          : "professional fashion photography"
      }" to ensure the AI image model understands the context and produces high-quality ${
        isNewborn ? "newborn " : ""
      }fashion photography results.

      🎥 CINEMATOGRAPHY & COLOR GRADE REQUIREMENTS (NON-NEGOTIABLE — this is what separates an editorial photograph from a lifeless stock photo):
      Your enhanced prompt MUST include a dedicated technical paragraph written in confident director-of-photography language, with CONCRETE specs chosen to flatter THIS garment and THIS scene:
      - CAMERA: name an exact focal length and aperture (e.g. "85mm at f/2.2 with a gently melted background", "35mm at f/5.6 holding the architecture crisp"), plus the camera height and angle relative to the model.
      - LIGHTING RECIPE: a specific key light direction and quality (hard vs soft), fill/shadow density, and ONE deliberate lighting character (crisp rim light, hard sun with graphic shadows, window-light falloff, etc.) — never the phrase "professional studio lighting" on its own.
      - COLOR GRADE: a confident editorial grade described like a preset — rich contrast, deep blacks, controlled highlights, an intentional palette (e.g. "clean digital editorial with dense blacks and accurate whites", "Portra-like warm neutrals with high micro-contrast").
      ✦ GRADE CHARACTER: the grade is always CONFIDENT — deep, dense blacks; clean, accurate whites; honest saturation where the garment demands it; controlled highlights with real tonal depth. Even when the scene calls for soft light, keep the light soft but the grade decisive: rich contrast, a deliberate palette, and shadows with genuine density.
      The final image must feel like a frame from a current high-end fashion editorial — the kind people save to Pinterest/Behance mood boards — never like a generic stock catalog photo.

      ${styleDnaLibrary}

      CRITICAL REQUIREMENTS:
      1. The prompt MUST begin with "Replace the ${
        isMultipleProducts
          ? "multiple flat-lay garments/products"
          : "flat-lay garment"
      }..."
      2. Keep ${
        isMultipleProducts
          ? "ALL original garments/products"
          : "the original garment"
      } exactly the same without changing any design, shape, colors, patterns, or details
      3. Do not modify or redesign ${
        isMultipleProducts ? "any of the garments/products" : "the garment"
      } in any way
      4. The final image should be photorealistic, showing ${
        isMultipleProducts
          ? "ALL garments/products perfectly fitted and coordinated"
          : "the same garment perfectly fitted"
      } on the ${baseModelText}
      5. Light the scene with a professional lighting design chosen to fit the environment and fabric (studio softbox, golden-hour daylight, diffused overcast, etc.) — when no location is specified, default to a refined studio setting with a clean, elevated backdrop
      6. Preserve ALL original details of ${
        isMultipleProducts ? "EACH garment/product" : "the garment"
      }: colors, patterns, textures, hardware, stitching, logos, graphics, and construction elements
      7. ${
        isMultipleProducts
          ? "ALL garments/products must appear identical to the reference image, just worn by the model as a complete coordinated outfit"
          : "The garment must appear identical to the reference image, just worn by the model instead of being flat"
      }
      8. MANDATORY: Include "professional fashion photography" phrase in your generated prompt
      ${
        isMultipleProducts
          ? "9. MANDATORY: Explicitly mention and describe EACH individual product/garment visible in the reference image - do not generalize or group them"
          : ""
      }

      ${
        isMultipleProducts
          ? `
      MULTIPLE PRODUCTS DETAIL COVERAGE (MANDATORY): 
      - ANALYZE the reference image and identify EACH distinct garment/product (e.g., top, bottom, jacket, accessories, etc.)
      - DESCRIBE each product's specific construction details, materials, colors, and design elements
      - EXPLAIN how the products layer and coordinate together
      - SPECIFY the proper fit and positioning of each product on the model
      - ENSURE no product is overlooked or generically described
      `
          : ""
      }

      ${garmentTransformationDirectives}

      LANGUAGE REQUIREMENT: The final prompt MUST be entirely in English and START with "Replace".

      ${
        originalPrompt
          ? `USER CONTEXT: The user has provided these specific requirements: ${originalPrompt}. Please integrate these requirements naturally into your garment replacement prompt while maintaining the professional structure and flow.`
          : ""
      }
      
      ${ageSection}
      ${childPromptSection}
      ${bodyShapeMeasurementsSection}
      ${settingsPromptSection}
      ${posePromptSection}
      ${perspectivePromptSection}
      ${hairStylePromptSection}
      ${hairStyleTextSection}
      ${locationPromptSection}
      ${faceDescriptionSection}
      
      Generate a complete, detailed prompt focused on garment replacement while maintaining all original details. REMEMBER: Your response must START with "Replace". Apply all rules silently and do not include any rule text or headings in the output.
      
      EXAMPLE FORMAT: "Replace the flat-lay garment from the input image directly onto a standing [model description] while keeping the original garment exactly the same..."
      `;
    }

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, choose a confident, editorial fashion pose with full creative freedom over angle, framing, and the model's placement in the composition — expressive, natural body language (weight shifted onto one leg, a relaxed shoulder turn, a mid-step walking frame, a poised hand placement that stays clear of key design details). Hands rest naturally at the sides, on the waist, or in gentle motion — inside pockets only if the garment clearly has visible pockets in the reference. The one constant: every signature feature of the garment (neckline, sleeves, prints, seams, hem) remains clearly on display and well lit from the chosen angle.`;
      }
    }

    // 🛍️ Kombin modu: Grid resmi içindeki tüm parçaların giydirilmesi için Gemini'yi
    // bilgilendir. Sadece grid image Gemini'ye gider (latency için), ama prompt'ta
    // içindeki her ürünün nasıl giydirileceği detaylı olarak açıklanması isteniyor.
    if (kombinItemCount && kombinItemCount > 1) {
      promptForGemini += `

🛍️ KOMBIN / OUTFIT COMPOSITION MODE — CRITICAL:
The main reference image provided is a COMPOSITE GRID showing ${kombinItemCount} separate garment pieces laid out side by side in flat-lay form. These are NOT one single garment — they are distinct outfit items (e.g. top, bottom, outerwear, footwear, accessories) that must ALL be worn simultaneously on the model as a single cohesive outfit.

Your enhanced prompt MUST explicitly instruct the generator to:
1. Identify EACH individual garment cell in the grid (their order in the grid does not dictate styling order — analyze each visually).
2. Describe how each piece should be worn on the model (upper body vs. lower body, outer layer vs. base layer, footwear, accessories) and how they interact, respecting each garment's own intended fit and silhouette as shown in its grid cell.
3. TUCKING / LAYERING NEUTRALITY — CRITICAL: Do NOT automatically tuck tops into bottoms. Only tuck a top into a bottom if the top is clearly a formal dress shirt paired with tailored trousers/skirt, OR the flat-lay of the top visibly shows a tucked-in styling. For casual shirts, t-shirts, sweatshirts, knitwear, oversized tops, cropped tops, hoodies, and any top whose intended wear is untucked → leave it fully UNTUCKED, hanging naturally over the waistband of the bottom. When in doubt, default to UNTUCKED. Do not invent tucking, belting, half-tucks, or "French tucks" unless the garment's own design clearly demands it.
4. For EACH piece separately, preserve the exact color, pattern/print, stitching, fabric texture, trims, buttons, prints, length, hem, and construction details exactly as shown in its grid cell. Do NOT merge, simplify, redesign, shorten, lengthen, or adjust the fit of any piece.
5. Describe the expected complete silhouette of the full outfit on the model once all ${kombinItemCount} pieces are worn together — but the silhouette must follow from the garments themselves, not from a default styling assumption.
6. Ensure the outfit looks natural, cohesive, and styled as a real editorial fashion look — no floating garments, no missing pieces, no duplicate garments.

Start your enhanced prompt by explicitly listing what you see in the grid (one short sentence per piece) before the full prompt, so the downstream image generator has per-item grounding.`;
    }

    if (multipleAnglesCount && multipleAnglesCount > 1) {
      promptForGemini += `

📐 SAME PRODUCT / MULTIPLE ANGLES MODE — CRITICAL:
The main reference image is a COMPOSITE GRID containing ${multipleAnglesCount} photographs of ONE AND THE SAME product captured from different angles and distances. The cells do NOT show separate garments and must NEVER be combined into an outfit.

Analyze every cell together as complementary evidence of one product. Reconstruct a single, consistent garment on the model by preserving all visible front, side, back, silhouette, material, print, stitching, trim, hardware and proportion details. Resolve occluded details using the other angle cells, never duplicate the product, never create a collage in the output, and never treat detail close-ups as separate accessories. The final result must contain exactly one instance of this product, worn naturally by the model.`;
    }

    // 📝 Opening directives — skin / pose / user-detail intent'leri Gemini
    // tarafından kıyafete özgü, başlıksız pozitif anlatı cümleleri olarak
    // prompt'un EN BAŞINA yazılıyor (⚠️ başlık formatı kaldırıldı — final
    // prompt fotoğrafçı brief'i gibi okunmalı, kural kitabı gibi değil).
    if (openingDirectivesInstruction) {
      promptForGemini = `${openingDirectivesInstruction}

${promptForGemini}`;
    }

    // 🎯 Focus area direktifi — EN BAŞA koy ki hem Gemini hem generator'a
    // pazarlıksız bir çerçeveleme talimatı olarak görünsün. Enhanced prompt'u
    // üretirken Gemini bu direktifi koruması için net işaretle.
    if (focusAreaDirective) {
      promptForGemini = `${focusAreaDirective}

(Keep the framing directive above verbatim as the opening of your enhanced prompt — do NOT rewrite, soften, or remove it.)

${promptForGemini}`;
    }

    logger.log("🤖 [GEMINI] Prompt oluşturuluyor:", promptForGemini);

    // Google Gemini API için resimleri base64'e çevir ve parts dizisine ekle
    const parts = [{ text: promptForGemini }];

    // Resimleri indirip base64'e çevir
    const imageBuffers = [];

    // Multi-mode resim gönderimi: Back side analysis, Multiple products, veya Normal mod
    if (isBackSideAnalysis && referenceImages && referenceImages.length >= 2) {
      logger.log(
        "🔄 [BACK_SIDE] Gemini'ye 2 resim gönderiliyor (ön + arka)...",
      );

      const firstImageUrl = sanitizeImageUrl(
        referenceImages[0].uri || referenceImages[0],
      );
      const secondImageUrl = sanitizeImageUrl(
        referenceImages[1].uri || referenceImages[1],
      );

      try {
        const [firstResponse, secondResponse] = await Promise.all([
          axios.get(firstImageUrl, { responseType: "arraybuffer" }),
          axios.get(secondImageUrl, { responseType: "arraybuffer" }),
        ]);

        imageBuffers.push(
          Buffer.from(firstResponse.data),
          Buffer.from(secondResponse.data),
        );
        logger.log("🔄 [BACK_SIDE] Toplam 2 resim Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Resim indirme hatası:", imageError);
        throw new Error("Failed to download images for Gemini");
      }
    } else if (
      isMultipleProducts &&
      referenceImages &&
      referenceImages.length > 1
    ) {
      // Multi-product mode: Tüm referans resimleri gönder
      logger.log(
        `🛍️ [MULTI-PRODUCT] Gemini'ye ${referenceImages.length} adet referans resmi gönderiliyor...`,
      );

      try {
        const imagePromises = referenceImages.map((refImg) => {
          const imageUrl = sanitizeImageUrl(refImg.uri || refImg);
          return axios.get(imageUrl, { responseType: "arraybuffer" });
        });

        const imageResponses = await Promise.all(imagePromises);
        imageBuffers.push(
          ...imageResponses.map((res) => Buffer.from(res.data)),
        );

        logger.log(
          `🛍️ [MULTI-PRODUCT] Toplam ${referenceImages.length} adet referans resmi Gemini'ye eklendi`,
        );
      } catch (imageError) {
        console.error("❌ Resim indirme hatası:", imageError);
        throw new Error("Failed to download images for Gemini");
      }
    } else {
      // Normal mod: Tek resim gönder
      if (originalBase64Data) {
        // 🚀 Orijinal base64 varsa direkt kullan - URL'den indirme yapma
        logger.log(
          "🚀 [GEMINI] Orijinal base64 kullanılıyor - URL indirmesi atlandı",
        );
        imageBuffers.push(Buffer.from(originalBase64Data, "base64"));
        logger.log("🖼️ Referans görsel (base64) Gemini'ye eklendi");
      } else if (imageUrl) {
        // Base64 yoksa URL'den indir (fallback)
        try {
          logger.log("⬇️ [GEMINI] Base64 yok, URL'den indiriliyor:", imageUrl);
          const cleanImageUrl = sanitizeImageUrl(imageUrl);
          const imageResponse = await axios.get(cleanImageUrl, {
            responseType: "arraybuffer",
            timeout: 30000, // 30 saniye timeout
          });
          imageBuffers.push(Buffer.from(imageResponse.data));
          logger.log("🖼️ Referans görsel Gemini'ye eklendi:", imageUrl);
        } catch (imageError) {
          console.error("❌ Resim indirme hatası:", imageError);
          throw new Error("Failed to download image for Gemini");
        }
      }
    }

    // 👤 Model referans görselini ekle — Gemini kişiyi görüp kimliğini
    // sadakatle tarif edebilsin (yüz icat etme kapalıyken zorunlu bağlam)
    if (modelReferenceImageUrl) {
      try {
        const cleanModelRefUrl = sanitizeImageUrl(
          String(modelReferenceImageUrl).split("?")[0],
        );
        const modelRefResponse = await axios.get(cleanModelRefUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(modelRefResponse.data));
        logger.log("👤 Model referans görseli Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Model referans resmi indirme hatası:", imageError);
      }
    }

    // Pose image'ını da ekle
    if (poseImage) {
      try {
        const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
        const poseResponse = await axios.get(cleanPoseImageUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(poseResponse.data));
        logger.log("🤸 Pose görsel Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Pose resim indirme hatası:", imageError);
      }
    }

    // Hair style image'ını da ekle
    if (hairStyleImage) {
      try {
        const cleanHairStyleImageUrl = sanitizeImageUrl(
          hairStyleImage.split("?")[0],
        );
        const hairResponse = await axios.get(cleanHairStyleImageUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(hairResponse.data));
        logger.log("💇 Hair style görsel Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Hair style resim indirme hatası:", imageError);
      }
    }

    // Location image'ını da ekle
    if (locationImage) {
      try {
        const cleanLocationImageUrl = sanitizeImageUrl(
          locationImage.split("?")[0],
        );
        const locationResponse = await axios.get(cleanLocationImageUrl, {
          responseType: "arraybuffer",
        });
        imageBuffers.push(Buffer.from(locationResponse.data));
        logger.log("🏞️ Location görsel Gemini'ye eklendi");
      } catch (imageError) {
        console.error("❌ Location resim indirme hatası:", imageError);
      }
    }

    // Gemini'ye sadece ana görsel (+ pose/hair/location) gidiyor.
    // Kombin tekil ürünleri ve size reference resmi Gemini'den atlanıyor
    // (prompt enhancement için yeterince latency oluşturuyorlardı).
    // Nano-banana tarafına /generate handler'da ekstra olarak ekleniyorlar.

    // Base64'e çevir ve parts'e ekle
    for (const buffer of imageBuffers) {
      const base64Image = buffer.toString("base64");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });
    }

    // Replicate Gemini Flash API çağrısı için image URL'lerini topla
    const imageUrlsForReplicate = [];

    // Referans resimlerin URL'lerini ekle
    if (isBackSideAnalysis && referenceImages && referenceImages.length >= 2) {
      const firstImageUrl = sanitizeImageUrl(
        referenceImages[0].uri || referenceImages[0],
      );
      const secondImageUrl = sanitizeImageUrl(
        referenceImages[1].uri || referenceImages[1],
      );
      imageUrlsForReplicate.push(firstImageUrl, secondImageUrl);
    } else if (
      isMultipleProducts &&
      referenceImages &&
      referenceImages.length > 1
    ) {
      for (const refImg of referenceImages) {
        const imgUrl = sanitizeImageUrl(refImg.uri || refImg);
        if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
          imageUrlsForReplicate.push(imgUrl);
        }
      }
    } else if (imageUrl) {
      const cleanImageUrl = sanitizeImageUrl(imageUrl);
      if (
        cleanImageUrl.startsWith("http://") ||
        cleanImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanImageUrl);
      }
    }

    // 👤 Model referans görselini de ekle (kimlik koruması için Gemini görmeli)
    if (modelReferenceImageUrl) {
      const cleanModelRefUrl = sanitizeImageUrl(
        String(modelReferenceImageUrl).split("?")[0],
      );
      if (
        cleanModelRefUrl.startsWith("http://") ||
        cleanModelRefUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanModelRefUrl);
        logger.log("👤 [REPLICATE-GEMINI] Model referans görseli eklendi");
      }
    }

    // Pose, hair style ve location resimlerini de ekle
    if (poseImage) {
      const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
      if (
        cleanPoseImageUrl.startsWith("http://") ||
        cleanPoseImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanPoseImageUrl);
      }
    }
    if (hairStyleImage) {
      const cleanHairStyleImageUrl = sanitizeImageUrl(
        hairStyleImage.split("?")[0],
      );
      if (
        cleanHairStyleImageUrl.startsWith("http://") ||
        cleanHairStyleImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanHairStyleImageUrl);
      }
    }
    if (locationImage) {
      const cleanLocationImageUrl = sanitizeImageUrl(
        locationImage.split("?")[0],
      );
      if (
        cleanLocationImageUrl.startsWith("http://") ||
        cleanLocationImageUrl.startsWith("https://")
      ) {
        imageUrlsForReplicate.push(cleanLocationImageUrl);
      }
    }

    logger.log(
      `🤖 [REPLICATE-GEMINI] Toplam ${imageUrlsForReplicate.length} resim URL'si hazırlandı`,
    );

    // Replicate Gemini Flash API çağrısı (3 retry ile)
    // Not: Resim compression artık client tarafında yapılıyor (6MB limit)
    let enhancedPrompt;

    try {
      // parts array'indeki text prompt'u al
      let textPrompt = parts.find((p) => p.text)?.text || promptForGemini;

      // 🔒 Ek güvenlik katmanı — SADECE test hesabı (nodselemen): enhancer'ın EN BAŞINA
      // "uygunsuz/+18 istekte o yönde prompt üretme" system prompt'unu ekle. Gerçek
      // kullanıcılarda bu satır hiç çalışmaz (textPrompt aynen kalır).
      if (await isSafetyTestUser(userId)) {
        textPrompt = `${SAFETY_SYSTEM_PROMPT}\n\n---\n${textPrompt}`;
        logger.log(
          `🔒 [SAFETY] Enhancer'a güvenlik system prompt'u eklendi (test hesabı ${userId}).`,
        );
      }

      const geminiGeneratedPrompt = await callGeminiFlash(
        textPrompt,
        imageUrlsForReplicate,
        3,
      );

      // Statik kurallar kaldırıldı (not: fal.ai eski 5000 char limiti kalktı — 50k+ kabul ediyor, test edildi Tem 2026)
      // Gemini'nin ürettiği prompt yeterince detaylı
      let staticRules = "";

      enhancedPrompt = geminiGeneratedPrompt + staticRules;
      logger.log(
        `🤖 [REPLICATE-GEMINI] Gemini'nin ürettiği prompt (${geminiGeneratedPrompt.length} karakter):`,
        geminiGeneratedPrompt,
      );

      // Gemini safety filter kesme kontrolü - prompt çok kısa veya cümle ortasında kesilmişse
      const trimmedGemini = geminiGeneratedPrompt.trim();
      const endsWithPunctuation = /[.!?")\]]$/.test(trimmedGemini);
      const isTooShort = trimmedGemini.length < 300;

      if (isTooShort || !endsWithPunctuation) {
        logger.log(
          `⚠️ [GEMINI-TRUNCATION] Prompt kesik tespit edildi! Uzunluk: ${trimmedGemini.length}, Noktalama ile bitiyor: ${endsWithPunctuation}`,
        );
        logger.log(
          `⚠️ [GEMINI-TRUNCATION] Son 50 karakter: "${trimmedGemini.slice(-50)}"`,
        );
        // Fallback prompt'a düşmeyi tetikle
        throw new Error(
          `Gemini prompt truncated (${trimmedGemini.length} chars, ends with punctuation: ${endsWithPunctuation})`,
        );
      }

      // 🔧 REFINER MODE için Gemini yanıt validasyonu - yanlış format kontrolü
      if (isRefinerMode) {
        const lowerPrompt = geminiGeneratedPrompt.toLowerCase();
        const hasWrongFormat =
          lowerPrompt.includes("replace the flat-lay") ||
          lowerPrompt.includes("replace the flatlay") ||
          lowerPrompt.includes("onto a model") ||
          lowerPrompt.includes("onto a child") ||
          lowerPrompt.includes("onto a female") ||
          lowerPrompt.includes("onto a male") ||
          lowerPrompt.includes("garment replacement") ||
          lowerPrompt.includes("worn by") ||
          lowerPrompt.includes("wearing the garment");

        if (hasWrongFormat) {
          logger.log(
            "⚠️ [REFINER-VALIDATION] Gemini yanlış format üretmiş (model/garment replacement), fallback kullanılıyor",
          );

          const addShadowVal = settings?.addShadow ?? false;
          const addReflectionVal = settings?.addReflection ?? false;
          const backgroundColorVal = settings?.backgroundColor || "White";
          const colorInputModeVal = settings?.colorInputMode || "text";

          let bgColorEnglishVal = backgroundColorVal;
          const colorTranslationsVal = {
            beyaz: "White",
            siyah: "Black",
            kırmızı: "Red",
            mavi: "Blue",
            yeşil: "Green",
            sarı: "Yellow",
            turuncu: "Orange",
            mor: "Purple",
            pembe: "Pink",
            gri: "Gray",
            kahverengi: "Brown",
            bej: "Beige",
            krem: "Cream",
            lacivert: "Navy Blue",
          };
          if (
            colorInputModeVal !== "hex" &&
            colorTranslationsVal[backgroundColorVal?.toLowerCase()]
          ) {
            bgColorEnglishVal =
              colorTranslationsVal[backgroundColorVal.toLowerCase()];
          }

          const shadowTextVal = addShadowVal
            ? "with soft natural shadow underneath for depth"
            : "with no shadow - completely flat and clean";
          const reflectionTextVal = addReflectionVal
            ? "Add subtle reflection underneath for luxury catalog look."
            : "No reflection underneath.";

          enhancedPrompt = `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglishVal} ${shadowTextVal}; ${reflectionTextVal} Sharp focus and high clarity throughout — every surface, edge, and texture rendered crisply from front to back with deep, full-frame focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglishVal}, completely flat${
            addShadowVal ? "" : ", shadowless"
          }${
            addReflectionVal ? "" : ", and non-reflective"
          }, making the product appear ${
            addShadowVal || addReflectionVal
              ? "professionally presented"
              : "to float cleanly"
          }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail, with crisp full-frame focus and clean, even, professional lighting.`;

          logger.log("🔧 [REFINER-VALIDATION] Fallback prompt uygulandı");
        } else {
          logger.log("✅ [REFINER-VALIDATION] Gemini doğru format üretmiş");
        }
      }

      logger.log(
        "✨ [REPLICATE-GEMINI] Final enhanced prompt (statik kurallarla) hazırlandı",
      );
    } catch (geminiError) {
      console.error(
        "❌ [REPLICATE-GEMINI] All attempts failed:",
        geminiError.message,
      );

      // 🔧 REFINER MODE için özel catch fallback - Gemini tamamen başarısız olduğunda
      if (isRefinerMode) {
        logger.log(
          "🔧 [CATCH-REFINER] Gemini başarısız, refiner fallback prompt kullanılıyor",
        );

        const addShadowCatch = settings?.addShadow ?? false;
        const addReflectionCatch = settings?.addReflection ?? false;
        const backgroundColorCatch = settings?.backgroundColor || "White";
        const colorInputModeCatch = settings?.colorInputMode || "text";

        let bgColorEnglishCatch = backgroundColorCatch;
        const colorTranslationsCatch = {
          beyaz: "White",
          siyah: "Black",
          kırmızı: "Red",
          mavi: "Blue",
          yeşil: "Green",
          sarı: "Yellow",
          turuncu: "Orange",
          mor: "Purple",
          pembe: "Pink",
          gri: "Gray",
          kahverengi: "Brown",
          bej: "Beige",
          krem: "Cream",
          lacivert: "Navy Blue",
        };
        if (
          colorInputModeCatch !== "hex" &&
          colorTranslationsCatch[backgroundColorCatch?.toLowerCase()]
        ) {
          bgColorEnglishCatch =
            colorTranslationsCatch[backgroundColorCatch.toLowerCase()];
        }

        const shadowTextCatch = addShadowCatch
          ? "with soft natural shadow underneath for depth"
          : "with no shadow - completely flat and clean";
        const reflectionTextCatch = addReflectionCatch
          ? "Add subtle reflection underneath for luxury catalog look."
          : "No reflection underneath.";

        enhancedPrompt = `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglishCatch} ${shadowTextCatch}; ${reflectionTextCatch} Sharp focus and high clarity throughout — every surface, edge, and texture rendered crisply from front to back with deep, full-frame focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglishCatch}, completely flat${
          addShadowCatch ? "" : ", shadowless"
        }${
          addReflectionCatch ? "" : ", and non-reflective"
        }, making the product appear ${
          addShadowCatch || addReflectionCatch
            ? "professionally presented"
            : "to float cleanly"
        }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail, with crisp full-frame focus and clean, even, professional lighting.`;
      } else {
        // Normal mode: enhancedPrompt'u originalPrompt'a eşitle ki aşağıdaki
        // detaylı fallback zinciri (basitleştirilmiş ikinci deneme → narratif
        // şablon) devreye girsin. Ham client parametre prompt'u asla direkt
        // görüntü modeline gitmesin.
        enhancedPrompt = originalPrompt;
      }
    }

    // Eğer Gemini sonuç üretemediyse (enhancedPrompt orijinal prompt ile aynıysa) direkt fallback prompt kullan
    if (enhancedPrompt === originalPrompt) {
      logger.log(
        "🔄 [FALLBACK] Gemini başarısız, detaylı fallback prompt kullanılıyor",
      );

      // 🔧 REFINER MODE için özel fallback prompt - Model/garment replacement DEĞİL, ürün fotoğrafı iyileştirme
      if (isRefinerMode) {
        logger.log(
          "🔧 [FALLBACK-REFINER] Refiner mode fallback prompt kullanılıyor",
        );

        // Refiner settings'lerini al
        const addShadow = settings?.addShadow ?? false;
        const addReflection = settings?.addReflection ?? false;
        const backgroundColor = settings?.backgroundColor || "White";
        const colorInputMode = settings?.colorInputMode || "text";

        // Background color için İngilizce çeviri (Türkçe renk isimleri için)
        let bgColorEnglish = backgroundColor;
        const colorTranslations = {
          beyaz: "White",
          siyah: "Black",
          kırmızı: "Red",
          mavi: "Blue",
          yeşil: "Green",
          sarı: "Yellow",
          turuncu: "Orange",
          mor: "Purple",
          pembe: "Pink",
          gri: "Gray",
          kahverengi: "Brown",
          bej: "Beige",
          krem: "Cream",
          lacivert: "Navy Blue",
        };
        if (
          colorInputMode !== "hex" &&
          colorTranslations[backgroundColor?.toLowerCase()]
        ) {
          bgColorEnglish = colorTranslations[backgroundColor.toLowerCase()];
        }

        // Shadow ve reflection açıklamaları
        const shadowText = addShadow
          ? "with soft natural shadow underneath for depth"
          : "with no shadow - completely flat and clean";
        const reflectionText = addReflection
          ? "Add subtle reflection underneath for luxury catalog look."
          : "No reflection underneath.";

        const refinerFallbackPrompt = `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglish} ${shadowText}; ${reflectionText} Sharp focus and high clarity throughout — every surface, edge, and texture rendered crisply from front to back with deep, full-frame focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglish}, completely flat${
          addShadow ? "" : ", shadowless"
        }${
          addReflection ? "" : ", and non-reflective"
        }, making the product appear ${
          addShadow || addReflection
            ? "professionally presented"
            : "to float cleanly"
        }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail, with crisp full-frame focus and clean, even, professional lighting.`;

        logger.log("🔧 [FALLBACK-REFINER] Generated refiner fallback prompt");
        return refinerFallbackPrompt;
      }

      // 🔁 Önce basitleştirilmiş ikinci Gemini denemesi, o da olmazsa
      // narratif statik şablon. Ham parametre dökümü asla görüntü modeline gitmez.
      const simplifiedRetry = await attemptSimplifiedEnhance(
        settings,
        isMultipleProducts,
        imageUrl,
      );
      enhancedPrompt =
        simplifiedRetry ||
        buildNarrativeFallbackPrompt(settings, isMultipleProducts);
      logger.log(
        simplifiedRetry
          ? "🔁 [FALLBACK] Basitleştirilmiş enhance kullanılıyor"
          : "🧵 [FALLBACK] Narratif statik fallback prompt kullanılıyor",
      );
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("🤖 Gemini 2.0 Flash prompt iyileştirme hatası:", error);
    // Hata durumunda da uygun direktifi ekle
    // let controlNetDirective = "";
    // if (hasControlNet) {
    //   controlNetDirective = `CONTROLNET GUIDANCE: The input image contains two sections separated by a black line. The LEFT side shows the original garment with background removed for color and texture reference. The RIGHT side shows a black and white ControlNet edge detection image that must be used strictly for understanding the garment's structural design, seam placement, silhouette accuracy, and construction details. Use the right side image only for garment structure guidance - it should not influence the model's appearance, pose, facial features, background, or scene composition. The ControlNet data serves exclusively to ensure accurate garment construction and fit.

    // `;
    // } else {
    //   controlNetDirective = `BACKGROUND REMOVED IMAGE GUIDANCE: The input image shows the original garment with background removed (white background) for clear color and texture reference. Focus on analyzing the garment's design, construction details, fabric characteristics, and styling elements. Use this clean product image to understand the garment's true colors, textures, patterns, and structural features without any background distractions.

    // `;
    // }

    // Fallback prompt - detaylı kıyafet odaklı format
    logger.log(
      "🔄 [FALLBACK] Enhanced prompt oluşturulamadı, detaylı fallback prompt kullanılıyor",
    );

    // 🔧 REFINER MODE için özel catch fallback - Gemini hata verdiğinde
    if (isRefinerMode) {
      logger.log(
        "🔧 [CATCH-REFINER-ERROR] Gemini hatası, refiner fallback prompt kullanılıyor",
      );

      const addShadowCatchErr = settings?.addShadow ?? false;
      const addReflectionCatchErr = settings?.addReflection ?? false;
      const backgroundColorCatchErr = settings?.backgroundColor || "White";
      const colorInputModeCatchErr = settings?.colorInputMode || "text";

      let bgColorEnglishCatchErr = backgroundColorCatchErr;
      const colorTranslationsCatchErr = {
        beyaz: "White",
        siyah: "Black",
        kırmızı: "Red",
        mavi: "Blue",
        yeşil: "Green",
        sarı: "Yellow",
        turuncu: "Orange",
        mor: "Purple",
        pembe: "Pink",
        gri: "Gray",
        kahverengi: "Brown",
        bej: "Beige",
        krem: "Cream",
        lacivert: "Navy Blue",
      };
      if (
        colorInputModeCatchErr !== "hex" &&
        colorTranslationsCatchErr[backgroundColorCatchErr?.toLowerCase()]
      ) {
        bgColorEnglishCatchErr =
          colorTranslationsCatchErr[backgroundColorCatchErr.toLowerCase()];
      }

      const shadowTextCatchErr = addShadowCatchErr
        ? "with soft natural shadow underneath for depth"
        : "with no shadow - completely flat and clean";
      const reflectionTextCatchErr = addReflectionCatchErr
        ? "Add subtle reflection underneath for luxury catalog look."
        : "No reflection underneath.";

      return `Transform this amateur product photo into a professional high-end e-commerce catalog photo. Background: ${bgColorEnglishCatchErr} ${shadowTextCatchErr}; ${reflectionTextCatchErr} Sharp focus and high clarity throughout — every surface, edge, and texture rendered crisply from front to back with deep, full-frame focus. Apply a professional ghost mannequin effect to the product. Completely remove any visible hanger, mannequin, human body parts, and any other external elements. The garment/product must appear as if worn by an invisible body or floating cleanly, showcasing its natural 3D internal structure and form. Create a clean, hollow neckline with visible interior depth and a well-defined collar interior (for clothing items). Ensure realistic volume, natural shape, and appropriate form definition. Position any sleeves or extensions naturally with slight bends to indicate depth. Preserve and enhance all product construction details, including logos, labels, stitching, seams, hardware, and finishing details. Remove all wrinkles, creases, dust, lint, loose threads, stains, and any imperfections. Enhance the material texture, presenting the product as freshly pressed, pristine, and brand-new, straight from a luxury boutique. Position the product perfectly centered, with balanced proportions and symmetrical presentation. Illuminate the product with even, bright, professional studio lighting that highlights the product's form and details without harsh shadows or blown-out highlights. Correct any bad lighting, uneven tones, or color casts from the original amateur photo, ensuring true-to-life color accuracy and proper white balance. Sharpen all details to remove any blur or softness. Ensure the silhouette is clean and perfectly cut out against the background. The background must be a pure, uniform ${bgColorEnglishCatchErr}, completely flat${
        addShadowCatchErr ? "" : ", shadowless"
      }${
        addReflectionCatchErr ? "" : ", and non-reflective"
      }, making the product appear ${
        addShadowCatchErr || addReflectionCatchErr
          ? "professionally presented"
          : "to float cleanly"
      }. Remove any traces of original background elements. The final result must look like a flawless premium product photo ready for luxury e-commerce catalogs, fashion websites, and online marketplaces. Maintain photorealistic quality suitable for premium retail, with crisp full-frame focus and clean, even, professional lighting.`;
    }

    // 🔁 Basitleştirilmiş ikinci Gemini denemesi, o da olmazsa narratif
    // statik şablon. Ham parametre dökümü asla görüntü modeline gitmez.
    const simplifiedRetryCatch = await attemptSimplifiedEnhance(
      settings,
      isMultipleProducts,
      imageUrl,
    );
    if (simplifiedRetryCatch) {
      logger.log("🔁 [CATCH-FALLBACK] Basitleştirilmiş enhance kullanılıyor");
      return simplifiedRetryCatch;
    }
    logger.log("🧵 [CATCH-FALLBACK] Narratif statik fallback prompt kullanılıyor");
    return buildNarrativeFallbackPrompt(settings, isMultipleProducts);
  }
}

// Arkaplan silme fonksiyonu kaldırıldı - artık kullanılmıyor

async function pollReplicateResult(predictionId, maxAttempts = 60) {
  logger.log(`Replicate prediction polling başlatılıyor: ${predictionId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "json",
          timeout: 15000, // 30s'den 15s'ye düşürüldü polling için
        },
      );

      const result = response.data;
      logger.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        logger.log("Replicate işlemi başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("Replicate işlemi başarısız:", result.error);

        // PA (Prediction interrupted) hatası kontrolü - DERHAL DURDUR
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("Prediction interrupted") ||
            result.error.includes("code: PA") ||
            result.error.includes("please retry (code: PA)"))
        ) {
          console.error(
            "❌ PA hatası tespit edildi, polling DERHAL durduruluyor:",
            result.error,
          );
          throw new Error(
            "PREDICTION_INTERRUPTED: Replicate sunucusunda kesinti oluştu. Lütfen tekrar deneyin.",
          );
        }

        // Content moderation ve model hatalarını kontrol et
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("flagged as sensitive") ||
            result.error.includes("E005") ||
            result.error.includes("sensitive content") ||
            result.error.includes("Content moderated") ||
            result.error.includes("ModelError") ||
            result.error.includes("retrying once"))
        ) {
          console.error(
            "❌ Content moderation/model hatası tespit edildi, Gemini 2.5 Flash Image Preview'e geçiş yapılacak:",
            result.error,
          );
          throw new Error("SENSITIVE_CONTENT_FLUX_FALLBACK");
        }

        // E9243, E004 ve benzeri geçici hatalar için retry'a uygun hata fırlat
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("E9243") ||
            result.error.includes("E004") ||
            result.error.includes("unexpected error handling prediction") ||
            result.error.includes("Director: unexpected error") ||
            result.error.includes("Service is temporarily unavailable") ||
            result.error.includes("Please try again later") ||
            result.error.includes("Prediction failed.") ||
            result.error.includes(
              "Prediction interrupted; please retry (code: PA)",
            ))
        ) {
          logger.log(
            "🔄 Geçici nano-banana hatası tespit edildi, retry'a uygun:",
            result.error,
          );
          throw new Error(`RETRYABLE_ERROR: ${result.error}`);
        }

        throw new Error(result.error || "Replicate processing failed");
      } else if (result.status === "canceled") {
        console.error("Replicate işlemi iptal edildi");
        throw new Error("Replicate processing was canceled");
      }

      // Processing veya starting durumundaysa bekle
      if (result.status === "processing" || result.status === "starting") {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 saniye bekle
        continue;
      }
    } catch (error) {
      console.error(`Polling attempt ${attempt + 1} hatası:`, error.message);

      // Sensitive content hatasını özel olarak handle et
      if (error.message === "SENSITIVE_CONTENT_FLUX_FALLBACK") {
        console.error(
          "❌ Sensitive content hatası, Gemini 2.5 Flash Image Preview'e geçiş için polling durduruluyor",
        );
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // PA (Prediction interrupted) hatası için özel retry mantığı - KESIN DURDUR
      if (
        error.message.includes("Prediction interrupted") ||
        error.message.includes("code: PA") ||
        error.message.includes("PREDICTION_INTERRUPTED")
      ) {
        console.error(
          `❌ PA hatası tespit edildi, polling KESIN DURDURULUYOR: ${error.message}`,
        );
        logger.log("🛑 PA hatası - Polling döngüsü derhal sonlandırılıyor");
        throw error; // Orijinal hatayı fırlat ki üst seviyede yakalanabilsin
      }

      // Eğer hata "failed" status'dan kaynaklanıyorsa derhal durdur
      if (
        error.message.includes("Replicate processing failed") ||
        error.message.includes("processing was canceled")
      ) {
        console.error(
          "❌ Replicate işlemi başarısız/iptal, polling durduruluyor",
        );
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // Sadece network/connection hatalarında retry yap
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Replicate işlemi zaman aşımına uğradı");
}

// Retry mekanizmalı polling fonksiyonu
async function pollReplicateResultWithRetry(predictionId, maxRetries = 3) {
  logger.log(
    `🔄 Retry'li polling başlatılıyor: ${predictionId} (maxRetries: ${maxRetries})`,
  );

  for (let retryAttempt = 1; retryAttempt <= maxRetries; retryAttempt++) {
    try {
      logger.log(`🔄 Polling retry attempt ${retryAttempt}/${maxRetries}`);

      // Normal polling fonksiyonunu çağır
      const result = await pollReplicateResult(predictionId);

      // Başarılı ise sonucu döndür
      logger.log(`✅ Polling retry ${retryAttempt} başarılı!`);
      return result;
    } catch (pollingError) {
      console.error(
        `❌ Polling retry ${retryAttempt} hatası:`,
        pollingError.message,
      );

      // Bu hatalar için retry yapma - direkt fırlat
      if (
        pollingError.message.includes("PREDICTION_INTERRUPTED") ||
        pollingError.message.includes("SENSITIVE_CONTENT_FLUX_FALLBACK") ||
        pollingError.message.includes("processing was canceled")
      ) {
        console.error(
          `❌ Retry yapılmayacak hata türü: ${pollingError.message}`,
        );
        throw pollingError;
      }

      // Geçici hatalar için retry yap (E9243 gibi)
      if (pollingError.message.includes("RETRYABLE_ERROR")) {
        logger.log(`🔄 Geçici hata retry edilecek: ${pollingError.message}`);
        // Retry döngüsü devam edecek
      }

      // Son deneme ise hata fırlat
      if (retryAttempt === maxRetries) {
        console.error(
          `❌ Tüm polling retry attemptları başarısız: ${pollingError.message}`,
        );
        throw pollingError;
      }

      // Bir sonraki deneme için bekle
      const waitTime = retryAttempt * 3000; // 3s, 6s, 9s
      logger.log(
        `⏳ Polling retry ${retryAttempt} için ${waitTime}ms bekleniyor...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// 🎬 Stil profili adı DB'de çok dilli obje ({"en":"...","tr":"..."}) veya onun JSON
// string hâli olabilir. Prompt'a bunun tamamı girerse model 66 dillik bir blob okur;
// prompt'a daima TEK dil (İngilizce) girer.
function resolveStyleProfileNameForPrompt(raw) {
  if (!raw) return null;
  let val = raw;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        val = JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  if (val && typeof val === "object") {
    const pick =
      val.en ||
      val.tr ||
      Object.values(val).find((v) => typeof v === "string" && v.trim());
    return typeof pick === "string" && pick.trim() ? pick.trim() : null;
  }
  return null;
}

// 🎬 Stüdyo/düz zemin profilleri: "farklı bir mekân uydur" kuralı bunlarda ZARAR verir
// (düz beyaz stüdyo → sütunlu, mimari beyaz iç mekân olarak çıkıyordu). Analiz
// metnindeki ENVIRONMENT_LOCK işareti; yoksa metin sezgisi ile karar verilir.
const STUDIO_LOCK_HINT_RE =
  /\b(studio|seamless|cyclorama|infinity wall|blank wall|blank backdrop|neutral backdrop|white backdrop|(?:plain|bare|empty|clean|white|off-white|neutral) (?:white |off-white |neutral )?(?:wall|walls)|minimal(?:ist)? (?:white )?(?:set|interior|interiors|room|space|backdrop))\b/i;

function isStudioLockedStyleProfile(stylePrompt) {
  if (!stylePrompt) return false;
  const marker = /ENVIRONMENT_LOCK:\s*([A-Z_]+)/i.exec(stylePrompt);
  if (marker) return marker[1].toUpperCase() === "STUDIO";
  return STUDIO_LOCK_HINT_RE.test(stylePrompt);
}

// Bazı stil profilleri kompozisyonun iki kişilik olduğunu açıkça işaretler.
// Eski marker adı geriye uyumluluk için korunur; artık kadın/erkek veya romantik
// eşleşme dayatmaz, yalnızca iki kişilik kompozisyon sinyali olarak kullanılır.
function hasTwoPersonSubjectLock(stylePrompt) {
  return /SUBJECT_COUNT_LOCK:\s*COUPLE_FEMALE_MALE/i.test(
    String(stylePrompt || ""),
  );
}

// Analiz metni prompt'a girmeden önce temizlenir: makine işareti çıkarılır, stüdyo
// kilidi varsa "farklı mekân kullan" cümlesi de çıkarılır (aksi hâlde alt bölümdeki
// stüdyo kuralıyla çelişiyor ve model mekânı değiştiriyor).
function sanitizeStylePromptForOutput(stylePrompt, studioLocked) {
  if (!stylePrompt) return stylePrompt;
  let out = String(stylePrompt).replace(/^\s*ENVIRONMENT_LOCK:.*$/gim, "");
  if (studioLocked) {
    out = out.replace(
      /New shoots must use a different location from any sample frame[^.]*\.[ \t]*/gi,
      "",
    );
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// 🔍 Netleştirme kredi tarifesi — RefinerScreen'deki tabloyla aynı mantık:
// taban 10 kredi, kademe başına maliyetle orantılı artış. 4 MP zaten "kapalı"
// olduğu için burada yer almaz (ek işlem yapılmaz → ücret de yok).
const RESULT_UPSCALE_CREDIT_BY_MP = { 8: 20, 16: 40, 32: 80, 64: 120, 128: 240 };

// Netleştirme için krediyi atomic olarak düşer. Yetersizse false döner ve
// çağıran taraf netleştirmeyi hiç başlatmaz (üretim yine de teslim edilir).
async function chargeUpscaleCredits(userId, targetMp) {
  const cost = RESULT_UPSCALE_CREDIT_BY_MP[Number(targetMp)];
  if (!cost) return { charged: 0, ok: false };
  if (!userId || userId === "anonymous_user") return { charged: 0, ok: false };

  try {
    const effectiveCredits = await teamService.getEffectiveCredits(userId);
    const creditOwnerId = effectiveCredits.creditOwnerId || userId;
    const balance = effectiveCredits.creditBalance || 0;

    if (balance < cost) {
      logger.warn(
        `💳 [UPSCALE-CREDIT] Yetersiz kredi (var: ${balance}, gerekli: ${cost}) — netleştirme atlanıyor`,
      );
      return { charged: 0, ok: false };
    }

    const { error } = await supabase.rpc("deduct_user_credit", {
      user_id: creditOwnerId,
      credit_amount: cost,
    });
    if (error) {
      logger.warn("💳 [UPSCALE-CREDIT] Kredi düşülemedi:", error.message);
      return { charged: 0, ok: false };
    }
    logger.log(`💳 [UPSCALE-CREDIT] ${cost} kredi düşüldü (${targetMp} MP)`);
    return { charged: cost, ok: true };
  } catch (err) {
    logger.warn("💳 [UPSCALE-CREDIT] Hata:", err?.message);
    return { charged: 0, ok: false };
  }
}

// Üretim kaydına ara aşama işareti yazar (settings.stage). Polling bu alanı
// okuyup Results kartında durum rozeti gösterir. Hata durumunda sessiz geçilir —
// bu yalnızca görsel geri bildirim, üretimi bloklamamalı.
async function markGenerationStage(generationId, userId, stage) {
  try {
    if (!generationId || !userId) return;
    const { data: rows } = await supabase
      .from("reference_results")
      .select("settings")
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .limit(1);
    const current = rows?.[0]?.settings || {};
    await supabase
      .from("reference_results")
      .update({ settings: { ...current, stage } })
      .eq("generation_id", generationId)
      .eq("user_id", userId);
  } catch (err) {
    logger.warn("⚠️ [STAGE] Aşama işareti yazılamadı:", err?.message);
  }
}

// 🔍 SONUÇ NETLEŞTİRME — üretim biter bitmez sonucu seçilen megapiksele yükseltir.
// Results ekranındaki MP butonu 4'ten büyük seçildiğinde devreye girer; 4 "kapalı"
// demektir. Model ve parametreler RefinerScreen'deki akışla aynı
// (prunaai/p-image-upscale, target modu).
const RESULT_UPSCALE_MODEL_VERSION =
  "b998e77850c393ccddb1a4c32e5c298c91f89f2af9d9fc72bb85e1949fd80ae3";
const RESULT_UPSCALE_ALLOWED_MP = [8, 16, 32, 64, 128];

async function upscaleResultImage(imageUrl, targetMp) {
  const mp = Number(targetMp);
  if (!RESULT_UPSCALE_ALLOWED_MP.includes(mp)) return null;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token || !imageUrl) return null;

  const created = await axios.post(
    "https://api.replicate.com/v1/predictions",
    {
      version: RESULT_UPSCALE_MODEL_VERSION,
      input: {
        image: imageUrl,
        upscale_mode: "target",
        target: mp,
        output_format: "jpg",
        output_quality: 95,
        enhance_details: true,
        disable_safety_checker: true,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      timeout: 180000,
    },
  );

  let prediction = created.data;
  for (let i = 0; i < 90 && ["starting", "processing"].includes(prediction?.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await axios.get(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 },
    );
    prediction = poll.data;
  }

  if (prediction?.status !== "succeeded") {
    throw new Error(
      `Result upscale failed: ${prediction?.error || prediction?.status || "unknown"}`,
    );
  }
  const out = prediction.output;
  const url = Array.isArray(out) ? out[0] : out;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

// 🎬 STYLE REFERENCE MODE — kompakt, deterministik prompt.
// Kullanıcı bir stil referans görseli yüklediğinde koca Gemini enhanced-prompt hattı
// ÇALIŞTIRILMAZ; ortam/ışık/kamera/poz zaten referans görselden kopyalanacağı için
// prompt yalnızca (1) referans direktifi + kod plakası işareti, (2) ürün sadakati,
// (3) kullanıcının seçim/detay girdilerinden oluşur.
// 👗🎬 ANLAMLANDIRMA PASI (13 Ağu 2026, kullanıcı kararı — jewelry V7 ile aynı
// desen): stil referansının HAM teknik verisi (DP spec'i + profil analiz notları)
// NB2/NB Pro prompt'una OLDUĞU GİBİ yapıştırılmaz. Gemini önce bu malzemeyi tek
// bir akıcı yaratıcı brief'e sentezler; buildStyleReferencePrompt ham iki blok
// yerine bu sentezi gömer. Sentez başarısızsa ham bloklar fallback (üretim asla
// bozulmaz). Uzunluk sınırı bilerek YOK (kullanıcı kuralı: Gemini'ye yapay kısa
// karakter sınırı koyma).
async function synthesizeGarmentStyleDirection({
  styleReferenceUrl,
  technicalAnalysis = null,
  styleProfile = null, // { name, stylePrompt, imageCount } — kolaj profili modunda dolu
  settings = {},
  stamped = true,
}) {
  const materials = [];
  if (styleProfile?.stylePrompt) {
    materials.push(
      `STYLE PROFILE NOTES (art-director analysis distilled from the reference frames):\n${styleProfile.stylePrompt}`,
    );
  }
  if (technicalAnalysis) {
    materials.push(
      `TECHNICAL CAMERA & LIGHTING ANALYSIS (director-of-photography spec of the reference):\n${technicalAnalysis}`,
    );
  }
  const isCollage = Boolean(styleProfile);
  const modelBits = [
    settings?.age ? `age presentation ${settings.age}` : null,
    settings?.gender ? `gender presentation ${settings.gender}` : null,
    settings?.ethnicity ? `heritage ${settings.ethnicity}` : null,
  ].filter(Boolean);

  const synthesisPrompt = `You are the creative director of a high-end fashion campaign. The attached image is a photographic STYLE REFERENCE${
    stamped
      ? ` (ignore the black "STYLE REFERENCE" code plate along its bottom edge — it is an input marker, not part of the photograph)`
      : ""
  }. ${
    isCollage
      ? "It is a collage grid of several frames that all belong to ONE brand aesthetic — treat the frames as examples of a photographic style, not sets to rebuild."
      : "It is a single photograph whose shot conditions the new image must faithfully recreate."
  }

Write ONE flowing English creative direction for a NEW photorealistic fashion photograph in which a model wears the user's garment. The garment itself is defined elsewhere by separate product references — your direction covers everything EXCEPT the garment's design. Translate the reference's photographic identity into meaningful, actionable direction — interpret, fuse and rewrite; never paste analysis fragments verbatim and never use numbered spec labels. Weave naturally into prose:

- ENVIRONMENT: ${
    isCollage
      ? "the FAMILY of places the frames share (architecture character, materials, urban/nature/indoor feel) — described so a NEW location of the same family can be invented, unless the frames share a plain studio set, which is then kept exactly as bare as shown."
      : "the concrete visible elements of the location (type of place, architecture and materials, surfaces, furniture and fixed objects with their position, vegetation, depth layers) so the same kind of scene can be rebuilt rather than a vague look-alike."
  }
- LIGHT: direction, hardness, fill and shadow density, natural vs studio, time-of-day feel — and how it sculpts fabric and skin.
- COLOR GRADE: the reference's exact grade/preset feel (palette, saturation, contrast curve and black level, white-balance bias, highlight roll-off, grain or fade), carried like a fixed preset baked into the file.
- CAMERA: capture-device character (phone-shot vs professional vs film — keep whatever the reference is), focal-length feel, aperture and depth of field, camera height and angle, framing, crop and body coverage.
- POSE & ENERGY: ${
    isCollage
      ? "the shared posing register, attitude, gaze energy and level of movement across the frames — the register a photographer would carry into the next frame of the same shoot, not any single literal gesture."
      : "the subject's motion state and pose geometry (body orientation, weight distribution, limb configuration, head and gaze direction), plus any supporting object the pose depends on."
  }${modelBits.length ? ` The model reads as ${modelBits.join(", ")}.` : ""}

HARD RULES:
- NEVER describe the reference wardrobe: no clothing, shoe, bag or accessory descriptions from the reference — the model's outfit comes exclusively from the user's separate product references.
- Do NOT describe or preserve any reference person's facial identity or biometric likeness; direction about gaze and expression ENERGY is welcome, identity is off-limits.
- PLAIN TEXT, flowing prose paragraphs, no headings, no lists, no markdown.
- There is no character limit — write as richly and thoroughly as the shoot deserves; every sentence must add a concrete visual fact rather than repeating ideas.${
    materials.length
      ? `\n\nRAW ANALYSIS MATERIALS (internal notes about the same reference — fuse their facts into your direction, never quote them verbatim):\n\n${materials.join("\n\n")}`
      : ""
  }`;

  const out = (
    await callGeminiFlash(synthesisPrompt, [styleReferenceUrl], 2)
  )?.trim();
  return out || null;
}

function buildStyleReferencePrompt({
  settings = {},
  customDetail = null,
  hasModelReference = false,
  isMultipleProducts = false,
  stamped = true,
  styleProfile = null, // { name, stylePrompt, imageCount } — stil profili (grid kolaj) modu
  technicalAnalysis = null, // Gemini'nin tekil referanstan çıkardığı teknik kamera/ışık analizi
  // 👗🎬 Anlamlandırılmış sentez — varsa ham stylePrompt/technicalAnalysis
  // blokları YERİNE bu gömülür (yukarıdaki synthesizeGarmentStyleDirection)
  synthesizedDirection = null,
  hasUserPose = false, // 🧍 Kullanıcı AÇIKÇA poz seçtiyse: kullanıcının pozu referans pozunu EZER
  repeatPoseDirective = "", // Aynı gizli stil kullanıcıda tekrarlandıysa referans iskeletini kopyalama
} = {}) {
  const refPointer = stamped
    ? `the attached image that carries a solid BLACK code plate along its bottom edge with the printed text "STYLE REFERENCE · CODE SR-1" (it is the LAST attached image)`
    : `the LAST attached image`;

  // Stüdyo/düz zemin profillerinde mekân ÇEŞİTLENDİRİLMEZ — birebir korunur.
  const studioLocked =
    !!styleProfile && isStudioLockedStyleProfile(styleProfile.stylePrompt);
  const twoPersonProfileLocked =
    !!styleProfile &&
    hasTwoPersonSubjectLock(styleProfile.stylePrompt);
  const profileName = styleProfile
    ? resolveStyleProfileNameForPrompt(styleProfile.name)
    : null;

  const sections = [];
  const forceFreshPose = !hasUserPose && Boolean(repeatPoseDirective);

  // Kod plakası sızıntısına karşı EN BAŞTA sert kural — model bazen input'taki
  // plakayı çıktıya kopyalıyor; ilk cümle olarak yasaklamak en etkili yöntem.
  if (stamped) {
    sections.push(
      `⚠️ ABSOLUTE OUTPUT RULE — READ FIRST: The final photograph fills the frame edge to edge; the bottom edge simply continues the scene. The black code plate strip you will see along the bottom of one attached input image is an INPUT-ONLY marker used to identify that image — the output must not contain that black strip or any similar added band. (Printed graphics, brand marks and labels that belong to the garment itself stay exactly as they are.)`,
    );
  }

  if (styleProfile) {
    sections.push(`⚠️ STYLE REFERENCE MODE — STRICT DIRECTIVES

STYLE REFERENCE COLLAGE: Among the attached images, ${refPointer} is the STYLE REFERENCE. It is a COLLAGE GRID of ${styleProfile.imageCount} separate photoshoot frames that all belong to ONE brand aesthetic${profileName ? ` ("${profileName}")` : ""}. Treat the collage as EXAMPLES of a photographic STYLE only — mood boards, not sets to rebuild. Extract the SHARED aesthetic across its frames and reproduce that aesthetic in the final photograph:
${studioLocked ? `- the SET itself: the same plain backdrop, wall/floor tone and emptiness (see BACKDROP LOCK below),` : `- the FAMILY of environments (urban street / studio / loft / etc.) — category only, never a specific pictured place,`}
- the shared lighting language (direction, hardness/softness, time-of-day feel),
- the shared color grade, contrast and atmosphere,
- the shared camera language (focal-length feel, angles, crops, depth of field),
- the shared posing style, energy and attitude.
Compose ONE coherent new photograph inspired by this aesthetic — do not reproduce any single frame pixel-by-pixel, and do not render a collage/grid in the output.

${
      studioLocked
        ? `⚠️ BACKDROP LOCK — STUDIO / PLAIN SET (HIGHEST PRIORITY, OVERRIDES EVERYTHING BELOW): The reference frames share a plain, seamless studio-style set. REPRODUCE THAT SAME BACKDROP EXACTLY: the same flat, evenly lit surface, the same wall and floor tone, the same emptiness and the same absence of depth. Keep it exactly as bare as the reference — do not enrich, decorate or restage it, and add nothing that the reference frames do not show. Turning this plain set into a different, more detailed or more spacious environment is a hard failure here.`
        : `⚠️ LOCATIONS ARE EXAMPLES, NOT TEMPLATES (NON-NEGOTIABLE): Matching the sample locations is NOT required. The places in the collage frames only illustrate the vibe. Invent a NEW location that belongs to the same family (same architecture character, surfaces, urban/nature/indoor feel) but is clearly DIFFERENT from every pictured street, building, room, shopfront or backdrop. Do NOT rebuild, mirror or lightly remix any sample set.
EXCEPTION — STUDIO: If the frames share a plain/seamless studio setup (neutral backdrop, minimal set), reproducing that same studio character is correct and expected — studio need not vary.`
    }
🚫 NO ONE-OFF PROP CARRY-OVER (NON-NEGOTIABLE): Incidental objects that appear in one or a few collage frames — a motorcycle, scooter, parked car, bicycle, traffic sign, graffiti, storefront, specific chair, plant, bag left in the background, etc. — are coincidences of that shoot, NOT part of the style. NEVER place such one-off props in the output, even if they are visually prominent in the collage. Only shared light, grade, camera and posing language define the style.`);

    sections.push(
      hasModelReference
        ? `⚠️ GLOBAL STYLE FACE SEPARATION — HIGHEST PRIORITY: Every person inside the style collage is mood-board talent, NEVER a model-identity reference. The user has supplied a separate model reference, so preserve ONLY that user-provided person's identity. Take ZERO facial anatomy, facial proportions, distinctive features, skin marks or biometric likeness from any collage person. The collage may influence only non-identity performance direction such as gaze intensity, expression energy, attitude and posing register; it must never blend a collage face into the user's model.`
        : `⚠️ GLOBAL STYLE CASTING & MANDATORY FACE REPLACEMENT — HIGHEST PRIORITY: Every person inside the style collage is mood-board talent, NEVER a model-identity reference. Cast a completely NEW, photoreal person whose face is unmistakably different and biologically unrelated to EVERY collage person. Rebuild all identity-bearing facial geometry: different face shape and proportions, eye shape and spacing, brows, nose structure, lips, cheekbones, jawline, hairline and distinctive marks. The output must fail any same-person or look-alike comparison with the collage people.

ALLOWED INSPIRATION — NON-IDENTIFYING ONLY: Preserve the broad casting language that makes the style work with the garment: overall fashion archetype and presence, approximate adult age band, gaze direction/intensity, expression energy, confidence, attitude and grooming mood. Translate that direction onto the new person rather than copying a face. Similar campaign energy is correct; similar facial identity is a hard failure. Any explicit user age, gender, ethnicity, hair or model setting overrides the collage.`
    );

    sections.push(`👥 SUBJECT COUNT & INTERACTION CONTINUITY (HIGH PRIORITY): Read the collage's recurring composition. If every relevant frame consistently shows TWO people together, the output must also contain exactly TWO clearly visible, newly cast people and preserve the same relationship/interaction language, adapted naturally to the user's garment. If the frames are consistently solo, keep a solo hero; if counts vary, do not invent a mandatory partner unless the profile carries an explicit two-person subject-count lock.

The PRIMARY/HERO person follows all user-selected age, gender, identity, ethnicity, hair, body and pose settings and is the ONLY person who wears the user's product. Any supporting person remains secondary, is cast age-appropriately for the relationship shown, and wears a newly designed complementary outfit that fits the scene and pose without copying reference wardrobe, duplicating the user's product or obscuring its important details. Never delete a consistently required supporting person merely because another instruction says “model” in the singular.`);
  } else {
    // 🧍 Poz kaynağı: kullanıcı AÇIKÇA poz seçtiyse KULLANICININ pozu referansı
    // ezer — poz kilitleri (motion/seat/geometry) o durumda yazılmaz; referans
    // yalnız sahne/ışık/grade/kamera verir. Poz seçilmediyse referans pozu
    // ~%90 iskelet sadakatiyle korunur.
    const poseBullet = hasUserPose
      ? `- (the POSE is the exception: the user explicitly selected a pose — described elsewhere in this prompt — and that USER POSE OVERRIDES the reference pose entirely).`
      : forceFreshPose
        ? `- the same posing ENERGY and ATTITUDE, but with a deliberately DIFFERENT pose skeleton as required by the repeated-style directive below.`
      : `- every visible person's exact pose, stance, gesture and body language — INCLUDING motion state, relative placement, physical contact and interaction geometry.`;

    const poseLocks = hasUserPose
      ? `

🧍 USER POSE OVERRIDE (HIGHEST PRIORITY FOR THE HERO'S POSE): The user has explicitly chosen the PRIMARY/HERO model's pose — that instruction is the only source of the hero pose. Ignore the reference hero's limb geometry, motion and gestures rather than blending them into the user's pose. If the reference visibly contains a required supporting person, KEEP that person and adapt their pose naturally around the user's hero pose while retaining the reference relationship and interaction energy; never collapse the pair into a solo portrait. Stage the result within the reference's scene, light, grade and camera language. If the user's pose requires a supporting object (sitting, leaning), include a scene-appropriate one even if the reference has none.`
      : forceFreshPose
        ? ""
      : `

🎬 MOTION STATE LOCK (HIGH PRIORITY): First read every visible reference person's motion state and reproduce the group action exactly. If they are captured IN MOTION — walking mid-stride, stepping, turning, hair or fabric responding — rebuild the same coordinated motion and interaction phase. Do NOT convert moving people into a static catalog pose. If they are genuinely still, keep them still. Garment fidelity never justifies deleting a supporting person or freezing a moving interaction.

🪑 POSE SUPPORT & FRAMING LOCK (HIGH PRIORITY): If the reference pose depends on a supporting object — a chair, stool, armchair, sofa, bench, steps, ledge, wall or railing — that object IS part of the concept: the output must include an equivalent (not necessarily identical) piece and keep the same interaction. Seated stays seated on a clearly visible seat; leaning stays leaning; perching stays perching. Rendering the subject standing after a seated reference, or removing the seat from the frame, is a failed result. Match the reference's body coverage too: if the reference shows the full body with feet in frame, the output shows the full body with feet in frame — do not crop away feet, limbs or the seat.

🧍 POSE GEOMETRY MATCH (HIGH PRIORITY): Replicate the reference arrangement at roughly 90% fidelity — read every visible person as a skeleton and rebuild the SAME skeletons: each body orientation, weight distribution, limb configuration, hand placement, head tilt and gaze, plus the exact relative spacing, overlap, touch, support and interaction between people. Keep their scale and position within the frame. Only the micro-variation a photographer would capture between two consecutive shutter clicks is acceptable. Switching to a different pose family, removing a person, breaking their contact or flattening an interactive pair into an unrelated side-by-side lineup is a failed result.

🧩 GARMENT-FIT ADAPTATION — THE ONLY SANCTIONED EXCEPTION TO THE LOCKS ABOVE: First check whether the reference pose, crop and staging can properly present the USER'S product. If they can, follow the locks exactly. If they genuinely cannot — the crop would cut the product out of frame (e.g. waist-up reference but the product is trousers, a long skirt or shoes), the pose would hide or distort the product's key features (a hand or crossed arms covering the print/neckline/closure, a seated fold crushing a structured silhouette, a turned back hiding a front design), or the pose physically conflicts with the garment's construction — then ADAPT, but only MINIMALLY and only as much as the product requires: widen the crop just enough to include the product, move a hand just enough to reveal the covered detail, open the fold just enough to let the silhouette read. Everything not forced by the product stays locked to the reference: the same scene, light, grade, camera character, subject placement, pose energy and overall attitude. The adaptation must look like the SAME photographer adjusting the SAME shot for a different garment — never a new concept. Never use this exception to redesign the pose or composition wholesale.`;

    sections.push(`⚠️ STYLE REFERENCE MODE — STRICT DIRECTIVES

STYLE REFERENCE IMAGE: Among the attached images, ${refPointer} is the STYLE REFERENCE. It defines HOW the final photograph must look. Treat it as the single source of truth for staging and replicate from it, as faithfully as possible:
- the environment and location: the same KIND of place with its concept-defining elements (architecture, materials, surfaces, key furniture, background elements, depth layers) — a faithful new take on the SAME scene, never a different type of place,
- the exact lighting (direction, hardness/softness, time-of-day feel, shadow and highlight behavior),
- the exact color grade, contrast and overall atmosphere/mood — including any recognizable filter/preset recipe, reproduced like a fixed preset baked into the file,
- the exact camera language INCLUDING THE CAPTURE-DEVICE CHARACTER (a phone-shot look stays a phone-shot look, film stays film, medium format stays medium format), the camera angle, focal-length feel, framing, crop and body coverage,
${poseBullet}
…and NEVER the wardrobe: every reference person's clothing and accessories are completely ignored (see the WARDROBE SWAP rule below) — the PRIMARY/HERO model wears ONLY the user's attached product(s), while any composition-required supporting person wears a newly invented complementary outfit.${poseLocks}

🎯 THEME FIDELITY, NOT PIXEL COPY: The output does not have to duplicate the reference frame pixel by pixel, but the allowed variation budget applies ONLY to incidental scene texture (exact pavement stones, individual leaves, cloud shapes, background passersby). The ${hasUserPose || forceFreshPose ? "COMPOSITION and the FRAMING are" : "POSE, the COMPOSITION and the FRAMING are"} NOT part of that variation budget — they follow the reference tightly per the locks above. Every element that DEFINES the concept must survive: ${hasUserPose ? "the user's chosen pose, " : forceFreshPose ? "the deliberately new pose required for this repeated use, " : "the motion state, the pose geometry, the seat/support and its interaction, "}the framing and body coverage, the kind of location with its signature elements, the light and the mood. When unsure whether something is concept-defining, keep it.`);

    sections.push(`👥 EXACT SUBJECT-COUNT & INTERACTION LOCK (HIGHEST PRIORITY): Count the clearly visible people in the single style-reference photograph and reproduce that exact count. A solo reference produces one PRIMARY/HERO model. A two-person reference MUST produce exactly TWO clearly visible, newly cast people; preserve their relative placement, contact, support and interaction geometry as part of the pose, adapting it only as much as the user's garment or explicit primary-model pose requires. Never collapse a two-person reference into a solo portrait.

The PRIMARY/HERO person follows every user-selected age, gender, identity, ethnicity, hair, body and pose setting and wears the user's product. The supporting person remains secondary, is newly cast and age-appropriate for the visible relationship, and wears a newly invented complementary outfit suited to the scene and pose. The supporting person must not copy reference wardrobe, wear or duplicate the user's product, or cover its defining details. User model settings apply to the PRIMARY/HERO person, not automatically to the supporting person.`);
  }

  // 👗🎬 Sentez varsa ham analiz blokları (profil notları + DP spec'i) HİÇ
  // yazılmaz — anlamlandırılmış tek brief onların yerine geçer. Sentez yoksa
  // (fallback) eski ham bloklar aynen devam eder.
  if (synthesizedDirection) {
    sections.push(`CREATIVE DIRECTION (the reference's photographic identity, distilled by the creative director — follow it):
${synthesizedDirection}`);
  } else if (styleProfile?.stylePrompt) {
    sections.push(`STYLE PROFILE ANALYSIS (art-director notes distilled from the reference frames — follow them):
${sanitizeStylePromptForOutput(styleProfile.stylePrompt, studioLocked)}`);
  }

  // 🎯 Sadakat blokları — prompt'un geri kalanı ağırlıklı olarak YASAKLARDAN oluşuyor;
  // bu iki blok "neyi birebir taşı" tarafını dengeler (poz enerjisi ve grade/preset,
  // sonuçlarda en çok kaybedilen iki şeydi).
  if (styleProfile && hasUserPose) {
    // 🧍 Kullanıcı poz seçti: kolajın poz dili DEVRE DIŞI — kullanıcının pozu
    // uygulanır; stil yalnız grade/preset katmanını verir.
    sections.push(`🧍 USER POSE OVERRIDE (HIGHEST PRIORITY FOR THE HERO'S POSE): The user has explicitly chosen the PRIMARY/HERO model's pose — that instruction is the only source of the hero pose. Do NOT copy or blend the collage hero's limb geometry into it. If the collage consistently requires two people, keep the supporting person and stage them naturally around the user's hero pose with a compatible interaction; never remove the second person. Apply the style's lighting, grade and camera language to the full composition.

🎯 GRADE & PRESET ADHERENCE (HIGH PRIORITY): Apply the reference color treatment as if it were a fixed preset baked into the file: the same palette and saturation level, the same contrast curve and black level (lifted/matte vs crushed), the same white-balance bias, the same highlight roll-off, the same grain/texture and any fade. The exposure key must match too — if the references are high-key and airy, the output is high-key and airy. A technically clean but differently graded image is a failure.`);
  } else if (styleProfile) {
    sections.push(`🎯 POSE & ATTITUDE ADHERENCE (HIGH PRIORITY): The output must read as one more frame from the SAME shoot as the reference collage — a DIFFERENT frame, not a repeat of one. What you copy is the REGISTER, not the gesture:
- ENERGY & ATTITUDE — copy this exactly. If the reference subjects are playful, cheeky and relaxed, the model is playful, cheeky and relaxed; if they are still and cool, the model is still and cool. A neutral, stiff catalog pose is a failure whenever the references are not neutral.
- BODY-LANGUAGE RULES — copy these too: how casual the stance and weight shift are, whether the hands are busy/engaged or hanging, how much movement vs stillness there is, the head-tilt and shoulder habits, how direct or soft the gaze is.
- THE SPECIFIC GESTURES ARE EXAMPLES, NOT A TEMPLATE. A particular pose seen in a frame (a hand raised to the hair, a hand on the neck, a specific lean or hip pop) only demonstrates that this concept ALLOWS that kind of gesture. Do NOT reproduce it literally. Invent a DIFFERENT gesture from the same family — one that a photographer would naturally shoot next in this session, with the same attitude and the same level of looseness.
- Exception: if the SAME gesture clearly recurs across most of the frames, it is a signature of the concept and may be used; a gesture that appears in only one frame is a one-off sample and must be varied away from.

🎯 GRADE & PRESET ADHERENCE (HIGH PRIORITY): Apply the reference color treatment as if it were a fixed preset baked into the file: the same palette and saturation level, the same contrast curve and black level (lifted/matte vs crushed), the same white-balance bias, the same highlight roll-off, the same grain/texture and any fade. The exposure key must match too — if the references are high-key and airy, the output is high-key and airy. A technically clean but differently graded image is a failure.`);
  }

  if (technicalAnalysis && !synthesizedDirection) {
    sections.push(`TECHNICAL CAMERA & LIGHTING ANALYSIS (extracted from the style reference by a director of photography — follow these specs precisely):
${technicalAnalysis}`);
  }

  sections.push(`SCENE AND STAGING RULES:

👗 WARDROBE SWAP (NON-NEGOTIABLE — READ CAREFULLY): Every outfit worn in the style reference is COMPLETELY IGNORED. NOTHING from a reference wardrobe may appear in the output in recognizable form: not its silhouette, category, colors, fabric, neckline, sleeve or hem length, prints, buttons, shoes, bag, jewelry, glasses, hat or accessories. The PRIMARY/HERO model wears EXCLUSIVELY the user's attached product(s), fitted naturally into ${forceFreshPose ? "the mandatory new pose and the reference scene" : "the reference pose and scene"}, with the fabric draping and moving according to the USER'S product physics. If the reference composition requires a second person, that supporting person wears a NEWLY INVENTED, understated and complementary outfit appropriate to the scene, age and interaction — never the reference outfit and never the user's hero product. The supporting outfit must harmonize without competing with, duplicating or covering the hero garment. If any recognizable reference wardrobe leaks into the output, the result is FAILED. The style reference contributes ONLY ${
    styleProfile
      ? studioLocked
        ? "the photographic STYLE (light, grade, camera, posing language) and the plain studio backdrop itself — never a one-off background prop and never wardrobe"
        : "the photographic STYLE (light, grade, camera, posing language and environment FAMILY) — never a specific pictured location, never a one-off background prop and never wardrobe"
      : forceFreshPose
        ? "the scene, light, camera and posing energy — never the literal pose skeleton and never wardrobe"
        : "the scene, light, camera and pose — never wardrobe"
  }.

🚫 IDENTITY PROTECTION (NON-NEGOTIABLE): No person appearing in the style reference image or collage may reappear in the output. Generate completely NEW identities for the hero and every required supporting person: different faces, facial features and distinctive marks. No generated person may resemble or be mistaken for a reference person. Only broad non-identifying casting direction (fashion archetype, gaze and expression energy, attitude), plus ${forceFreshPose ? "the posing register and staging language" : "the body pose, stance, interaction and staging"}, may inspire the output; all reference likenesses are strictly off-limits.

GARMENT SOURCE OF TRUTH — HERO ONLY: The other attached product photo(s) are the ONLY source of what the PRIMARY/HERO model wears. Dress the hero EXCLUSIVELY in these product(s) and reproduce them with catalog-grade fidelity — exact colors, prints and pattern scale, fabric texture and weight, stitching, seams, trims, hardware, closures, labels and proportions. Do not invent, restyle, recolor or omit any visible product detail, and never blend the user's product with a reference outfit. A supporting person's newly designed outfit is allowed only because it is not the commercial product; it stays visually secondary.${
    isMultipleProducts
      ? " Multiple products are provided — the model wears them together as one coherent outfit, each piece reproduced faithfully."
      : ""
  }`);

  if (stamped) {
    sections.push(
      `CODE PLATE: The black code strip on the style reference exists only to mark which attached image is the style reference. It belongs to the input, not to the photograph — the output frame contains only the scene itself, with no added strip or band at any edge. Graphics printed on the garment are part of the product and remain untouched.`,
    );
  }

  // ── Kullanıcının seçim/detay girdileri ──
  if (hasModelReference) {
    sections.push(
      `PRIMARY/HERO MODEL IDENTITY: The FIRST attached image is the model identity reference provided by the user. Preserve THIS hero person's face, identity and skin tone exactly, while adopting ${forceFreshPose ? "the mandatory new pose and the staging language" : "the pose and staging"} of the style reference. The identity protection rule above still applies to every style-reference person, and any required supporting person must be newly cast — never blend a reference likeness into either person.`,
    );
  } else {
    const gender = typeof settings?.gender === "string" && settings.gender.trim()
      ? settings.gender.trim()
      : null;
    const age = settings?.age ? String(settings.age).trim() : null;
    sections.push(
      `PRIMARY/HERO MODEL: Create a brand-new, ${[age ? `${age}-year-old` : null, gender]
        .filter(Boolean)
        .join(" ")} AI-generated fashion model with natural, realistic skin texture — an entirely original person whose facial identity is clearly DIFFERENT from every person in the style reference.`.replace(/, +AI-generated/, " AI-generated"),
    );
  }

  if (twoPersonProfileLocked) {
    sections.push(`⚠️ REQUIRED TWO-PERSON COMPOSITION — HIGHEST PRIORITY, NON-NEGOTIABLE: The final photograph MUST show exactly TWO clearly visible, age-appropriate people together in the same frame. Preserve the reference's relationship and interaction language naturally — romantic partners only when the reference genuinely reads as romantic; otherwise siblings, friends, colleagues or another age-appropriate relationship. Do not impose a fixed woman/man pairing.

The PRIMARY/HERO person follows every user-selected model attribute and wears the user-provided garment. The second person supports the composition in a newly invented, complementary, style-appropriate outfit and must never cover, replace, duplicate or wear the hero garment. Keep both faces photorealistic and completely separate from every identity in the style-reference collage. ${
      hasModelReference
        ? "Preserve the separately supplied hero identity exactly; cast the supporting person as a completely new individual."
        : "Cast both people as completely new individuals."
    } This TWO-PERSON requirement overrides every singular use of “model”, “person”, or “subject” elsewhere in the prompt, while all user age, gender, ethnicity, hair and body settings apply specifically to the PRIMARY/HERO person.`);
  }

  const bodyShape =
    typeof settings?.bodyShape === "string" && settings.bodyShape.trim()
      ? settings.bodyShape.trim()
      : null;
  if (bodyShape) {
    sections.push(`BODY SHAPE: The model has a ${bodyShape} body shape.`);
  }

  if (settings?.productColor && settings.productColor !== "original") {
    sections.push(
      `🎨 PRODUCT COLOR REQUIREMENT (NON-NEGOTIABLE): Render the garment's base fabric in "${settings.productColor}" (if it is a hex code, use its closest natural color) while keeping every design element — prints, pattern scale, stitching, trims, hardware, labels, construction — exactly as in the product photo(s). The recolored fabric keeps realistic shading with natural tonal variation in highlights and folds.`,
    );
  }

  if (customDetail && String(customDetail).trim()) {
    sections.push(
      `⚠️ USER DETAIL DIRECTIVE (mandatory): ${String(customDetail).trim()}`,
    );
  }

  sections.push(
    `OUTPUT: One single hyper-realistic, professional fashion photograph, full-bleed edge to edge, with no added black bar or strip at any edge.${
      twoPersonProfileLocked
        ? " It contains exactly TWO clearly visible, age-appropriate people: the PRIMARY/HERO model and one supporting person; never collapse this composition to a solo model."
        : !styleProfile
          ? " It contains exactly the same number of clearly visible people as the single style-reference photograph; a two-person reference remains a two-person result."
          : " Follow the recurring subject count shown consistently across the style collage."
    } Natural skin texture, tack-sharp garment detail — every graphic, print and label that exists on the product is reproduced faithfully. ${
      hasModelReference
        ? twoPersonProfileLocked
          ? "The hero's face and identity come only from the separate user-provided model reference; the supporting person has a newly cast identity. Neither comes from a style-reference person."
          : "The face and identity come only from the separate user-provided model reference, never from a style-reference person."
        : "The hero face is a newly cast identity, unmistakably different from every style-reference person, while retaining only the requested campaign gaze and attitude; every required supporting person is independently newly cast as well."
    } ${forceFreshPose ? "Apart from the garment(s) and the deliberately different pose, the scene, light, camera, framing and mood match the style reference; the pose MUST follow the repeated-style variation rule and must not match the reference skeleton." : "Apart from the garment(s) (and the directives above), everything — scene, light, camera, framing, pose and mood — matches the style reference image."}`,
  );

  // En son söz bu olsun: teknik analiz veya ortak staging metni eski poz
  // iskeletini tekrar önceliklendiremesin.
  if (repeatPoseDirective && !hasUserPose) {
    sections.push(repeatPoseDirective);
  }

  return sections.join("\n\n");
}

// 🎬 Görselin altına "STYLE REFERENCE · CODE SR-1" siyah kod plakası basar (jpeg buffer döner).
// Hem tekil stil referansında hem stil profili grid'inde kullanılır.
async function stampStyleReferencePlate(rawBuf) {
  const flattened = await sharp(rawBuf)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .toBuffer();

  const meta = await sharp(flattened).metadata();
  const SW = meta.width || 800;
  const SH = meta.height || 1200;

  const PLATE_H = Math.min(72, Math.max(40, Math.round(SH * 0.045)));
  const withPlate = await sharp(flattened)
    .extend({ bottom: PLATE_H, background: { r: 10, g: 10, b: 12 } })
    .toBuffer();

  const plateFont = Math.max(
    16,
    Math.min(28, Math.round(PLATE_H * 0.4), Math.round(SW / 26)),
  );
  const horizontalPadding = Math.max(12, Math.round(SW * 0.025));
  const availableTextWidth = Math.max(1, SW - horizontalPadding * 2);
  const plateTextWidth = Math.min(
    availableTextWidth,
    Math.round(plateFont * 18.5),
  );
  const plateTextY = SH + Math.round(PLATE_H / 2);
  const plateSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH + PLATE_H}">
  <text x="${Math.round(SW / 2)}" y="${plateTextY}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-size="${plateFont}"
        font-weight="700"
        fill="#FFFFFF"
        letter-spacing="1"
        textLength="${plateTextWidth}"
        lengthAdjust="spacingAndGlyphs">STYLE REFERENCE · CODE SR-1</text>
</svg>
`);

  return sharp(withPlate)
    .composite([{ input: plateSvg, blend: "over" }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// 🎬 Stil profili fotoğraflarını tek bir beyaz zeminli grid kolaja birleştirir.
// En fazla 6 kare kullanılır; { buffer, count } döner.
async function buildStyleProfileGrid(imageUrls) {
  // Stil profili en fazla 3 fotoğraf tutar (styleProfileRoutes.MAX_IMAGES) —
  // eski profillerde daha fazlası olabildiği için üst sınır burada da uygulanır.
  const MAX_FRAMES = 3;
  const CELL_W = 512;
  const CELL_H = 640;
  const GAP = 6;

  const cells = [];
  for (const url of (imageUrls || []).slice(0, MAX_FRAMES)) {
    try {
      const resp = await axios.get(sanitizeImageUrl(url), {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      const buf = await sharp(Buffer.from(resp.data))
        .rotate()
        .resize(CELL_W, CELL_H, { fit: "cover" })
        .jpeg({ quality: 88 })
        .toBuffer();
      cells.push(buf);
    } catch (cellErr) {
      logger.warn(
        "🎬 [STYLE_PROFILE] Grid karesi indirilemedi, atlanıyor:",
        cellErr?.message,
      );
    }
  }
  if (cells.length === 0) {
    throw new Error("No style profile images could be loaded");
  }

  const cols = cells.length <= 1 ? 1 : cells.length <= 4 ? 2 : 3;
  const rows = Math.ceil(cells.length / cols);
  const W = cols * CELL_W + (cols + 1) * GAP;
  const H = rows * CELL_H + (rows + 1) * GAP;

  const composites = cells.map((buf, i) => ({
    input: buf,
    left: GAP + (i % cols) * (CELL_W + GAP),
    top: GAP + Math.floor(i / cols) * (CELL_H + GAP),
  }));

  const grid = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: grid, count: cells.length };
}

// 🎬 SIZINTI TEMİZLİĞİ — model bazen input'taki "STYLE REFERENCE · SR-1" siyah plakasını
// sonuç görselinin altına kopyalıyor. Bu helper sonucun alt bandını satır satır tarar:
// alttan başlayan bitişik koyu satır bloğu (H'nin %3-14'ü) VE hemen üstünde belirgin
// parlaklık sıçraması varsa plaka kabul edilip kırpılır. Normal koyu fotoğraflarda
// sınır sıçraması olmadığı için false-positive vermez. Plaka yoksa orijinal URL döner.
async function stripLeakedStylePlate(resultUrl, userId) {
  try {
    const resp = await axios.get(resultUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    const buf = Buffer.from(resp.data);
    const meta = await sharp(buf).metadata();
    const W = meta.width;
    const H = meta.height;
    if (!W || !H) return resultUrl;

    // Alt %16'lık bandı greyscale raw olarak al, satır ortalamalarını hesapla
    const bandH = Math.max(12, Math.round(H * 0.16));
    const band = await sharp(buf)
      .extract({ left: 0, top: H - bandH, width: W, height: bandH })
      .greyscale()
      .raw()
      .toBuffer();

    const rowMeans = [];
    for (let r = 0; r < bandH; r++) {
      let sum = 0;
      const off = r * W;
      for (let c = 0; c < W; c++) sum += band[off + c];
      rowMeans.push(sum / W);
    }

    // Alttan yukarı bitişik koyu satırları say (plaka zemini ~#0A0A0C)
    let darkRows = 0;
    for (let r = bandH - 1; r >= 0; r--) {
      if (rowMeans[r] < 38) darkRows++;
      else break;
    }

    const darkRatio = darkRows / H;
    if (darkRatio < 0.03 || darkRatio > 0.14) return resultUrl; // plaka boyutunda değil

    // Sınır kontrastı: koyu bloğun hemen üstündeki 4 satır belirgin şekilde açık olmalı
    const boundaryIdx = bandH - darkRows - 1;
    if (boundaryIdx < 3) return resultUrl;
    const above =
      (rowMeans[boundaryIdx] +
        rowMeans[boundaryIdx - 1] +
        rowMeans[boundaryIdx - 2] +
        rowMeans[boundaryIdx - 3]) / 4;
    if (above < 70) return resultUrl; // üstü de koyu → plaka değil, karanlık sahne

    // 🔍 YAZI İMZASI ŞARTI — sadece "altta koyu bant var" demek yeterli değil:
    // gece asfaltı, koyu stüdyo zemini veya alt kenara düşen derin gölge de bu
    // tarife uyuyor ve meşru fotoğraflar kırpılıyordu. Gerçek plakada ortalanmış
    // BEYAZ YAZI var; koyu bandın içinde parlak piksel kümesi arıyoruz.
    const plateBand = await sharp(buf)
      .extract({ left: 0, top: H - darkRows, width: W, height: darkRows })
      .greyscale()
      .raw()
      .toBuffer();

    let brightTotal = 0;
    let maxRowBright = 0;
    for (let r = 0; r < darkRows; r++) {
      let cnt = 0;
      const off = r * W;
      for (let c = 0; c < W; c++) {
        if (plateBand[off + c] > 200) cnt++;
      }
      brightTotal += cnt;
      if (cnt > maxRowBright) maxRowBright = cnt;
    }
    const brightRatio = brightTotal / (W * darkRows);

    // Yazı satırında genişliğin en az %2'si beyaz olmalı; toplam beyaz oranı da
    // yazı seviyesinde kalmalı (çok yüksekse bant zaten koyu değil demektir).
    if (maxRowBright < W * 0.02 || brightRatio < 0.0015 || brightRatio > 0.15) {
      return resultUrl; // koyu bant var ama yazı yok → meşru fotoğraf, DOKUNMA
    }

    const cropH = H - darkRows - 2; // 2px güvenlik payı
    logger.log(
      `🎬 [PLATE STRIP] Sonuçta sızmış kod plakası tespit edildi (${darkRows}px, %${Math.round(darkRatio * 100)}, yazı imzası: %${(brightRatio * 100).toFixed(2)}) — kırpılıyor`,
    );

    const cleaned = await sharp(buf)
      .extract({ left: 0, top: 0, width: W, height: cropH })
      .png()
      .toBuffer();

    const cleanFileName = `temp_${Date.now()}_plate_stripped_${userId || "anonymous"}_${uuidv4().substring(0, 8)}.png`;
    const { error: upErr } = await supabase.storage
      .from("reference")
      .upload(cleanFileName, cleaned, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(cleanFileName);
    logger.log("🎬 [PLATE STRIP] Temiz görsel upload OK:", urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    logger.warn(
      "🎬 [PLATE STRIP] Kontrol/kırpma başarısız, orijinal sonuç kullanılıyor:",
      err?.message,
    );
    return resultUrl;
  }
}

// 🖼️ Tek karelik stil profillerinin teknik analiz önbelleği (profil id → analiz).
// Aynı gizli stil tekrar seçildiğinde Gemini çağrısı tekrarlanmaz. Süreç içi,
// yeniden başlatmada sıfırlanır; üst sınır aşılırsa en eski kayıt düşer.
const singleProfileTechAnalysisCache = new Map();
const SINGLE_PROFILE_TECH_CACHE_MAX = 500;

router.post("/generate", async (req, res) => {
  // 🔎 Teşhis logu (21 Ağu): "polling 404: kayıt yok" vakalarında POST'un
  // sunucuya ULAŞIP ulaşmadığını ayırt etmek için handler'ın İLK satırı.
  // Başarısız generationId bu logda yoksa istek istemciden hiç çıkamamıştır.
  logger.log(
    `📥 [GENERATE] istek alındı gen:${String(req.body?.generationId || "-").slice(0, 8)} user:${String(req.body?.userId || "-").slice(0, 8)} imgs:${Array.isArray(req.body?.referenceImages) ? req.body.referenceImages.length : 0}`,
  );
  // Kredi kontrolü ve düşme (kalite versiyonuna göre dinamik)
  let creditDeducted = false;
  let actualCreditDeducted = 10; // Default v1 için 10 kredi
  let userId; // Scope için önceden tanımla
  let finalGenerationId = null; // Scope için önceden tanımla
  let temporaryFiles = []; // Silinecek geçici dosyalar
  // fal nano-banana güvenlik toleransı: "6" = en gevşek (varsayılan, gerçek kullanıcılar).
  // Güvenlik test hesabında (nodselemen) "1" = en katı'ya çekilir (çıplaklık üretimini zorlaştırır).
  let safetyTolerance = "6";

  try {
    let {
      ratio,
      promptText,
      referenceImages,
      settings,
      userId: requestUserId,
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleImages = false,
      isMultipleProducts: originalIsMultipleProducts,
      generationId, // Yeni parametre
      totalGenerations = 1, // Toplam generation sayısı (varsayılan 1)
      // Color change specific parameters
      isColorChange = false, // Bu bir renk değiştirme işlemi mi?
      targetColor = null, // Hedef renk bilgisi
      // Pose change specific parameters
      isPoseChange = false, // Bu bir poz değiştirme işlemi mi?
      customDetail = null, // Özel detay bilgisi
      // Edit mode specific parameters (EditScreen)
      isEditMode = false, // Bu EditScreen'den gelen bir edit işlemi mi?
      editPrompt = null, // EditScreen'den gelen özel prompt
      // Refiner mode specific parameters (RefinerScreen)
      isRefinerMode = false, // Bu RefinerScreen'den gelen refiner işlemi mi?
      upscaleMp = 4, // 🔍 Sonuç netleştirme kademesi (4 = kapalı)
      // Session deduplication
      sessionId = null, // Aynı batch request'leri tanımlıyor
      modelPhoto = null,
      sizeReferenceImage = null, // 📏 SizeEditor'dan gelen boyut referans görseli (canvas çıktısı)
      kombinOriginalImages = null, // 📸 Kombin: grid'e ek olarak orijinal tekil ürün resimleri
      kombinPieces = null, // 🏷️ Kombin: parça etiketleri [{cells:[1,..], category, subtype, color, pattern}] — hücreler 1-bazlı, kombinOriginalImages sırasıyla aynı
      angleOriginalImages = null, // 📐 Çoklu açı: grid'e ek olarak orijinal açı fotoğrafları (detay sadakati)
      isMultipleAnglesMode = false, // 📐 Aynı ürünün farklı açılarından oluşturulan grid
      multipleAnglesCount = 0, // 📐 Grid içindeki açı sayısı
      styleReferenceImage = null, // 🎬 Stil referansı: ortam/ışık/kamera/poz bu görselden birebir kopyalanır
      styleProfileId = null, // 🎬 Stil profili: kullanıcının kayıtlı marka stil preseti (grid kolaj olarak kullanılır)
      creationMode = null, // 🚪 CreateModelPhotoScreen giriş modu: crystal | canvas
      editorialMode = false, // 🎞️ Editorial mod: dahili stil kolajları her üretime eklenir
      enableAutomaticTrialVariation = false, // Trial ilk varyasyonu backend completion'da başlatır
    } = req.body;

    // Stil referansı/profili sahne, arka plan, ışık ve atmosferin tek kaynağıdır.
    // Eski client sürümleri SelectLocation mount olduğunda varsayılan #FFFFFF
    // gönderebildiği için backend'de de kesin koruma uygula: aktif stil kaynağı
    // varken hiçbir location/background kalıntısı final prompt'a ulaşmasın.
    const hasActiveStyleSource = Boolean(
      styleProfileId ||
        (styleReferenceImage &&
          (styleReferenceImage.base64 || styleReferenceImage.uri)),
    );
    if (hasActiveStyleSource) {
      settings = { ...(settings || {}) };
      [
        "location",
        "locationEnhancedPrompt",
        "locationId",
        "backgroundColorHex",
        "weather",
        "timeOfDay",
      ].forEach((key) => delete settings[key]);
      locationImage = null;
      logger.log(
        "🎬 [STYLE SOURCE] Location/background alanları backend'de temizlendi",
      );
    }

    isMultipleAnglesMode =
      Boolean(isMultipleAnglesMode) ||
      Boolean(settings?.isMultipleAnglesMode);
    multipleAnglesCount = Number(
      multipleAnglesCount || settings?.multipleAnglesCount || 0,
    );
    if (!Number.isFinite(multipleAnglesCount) || multipleAnglesCount < 0) {
      multipleAnglesCount = 0;
    }
    multipleAnglesCount = Math.floor(multipleAnglesCount);
    if (isMultipleAnglesMode && multipleAnglesCount > 6) {
      return res.status(400).json({
        success: false,
        result: {
          errorCode: "MAX_MULTIPLE_ANGLES",
          message: "At most 6 different-angle photos are allowed.",
        },
      });
    }

    // 🛡️ BOŞ GRID GUARD — kombin / çoklu açı modunda client'ın gönderdiği
    // kompozit grid bazen BEMBEYAZ gelebiliyor (ViewShot, resimler decode
    // edilmeden capture aldığında — canlıda görüldü: model kıyafeti uydurup
    // CGI görünümlü sonuç üretti). Neredeyse tek renk bir referansla üretime
    // hiç başlama: model çağrısından ve kayıttan ÖNCE reddet (kredi
    // pay-on-success olduğu için kredi de yanmaz).
    // Ortak util: utils/blankReferenceGuard — changePose ve backSideCloset de
    // aynı kontrolü kullanıyor.
    const isCompositeGridInput =
      isMultipleAnglesMode || Boolean(req.body.isKombinMode);
    if (
      isCompositeGridInput &&
      Array.isArray(referenceImages) &&
      referenceImages[0]
    ) {
      const blankGrid = await isBlankImage(
        referenceImages[0],
        sanitizeImageUrl,
        "BLANK GRID GUARD",
      );
      if (blankGrid === true) {
        return res.status(400).json(BLANK_REFERENCE_RESPONSE);
      }
    }

    // Kalite versiyonu kontrolü (settings'ten al) - Refiner modunda v1'e zorla
    const qualityVersion = isRefinerMode
      ? "v1"
      : settings?.qualityVersion || settings?.quality_version || "v1";
    const CREDIT_COST = qualityVersion === "v2" ? 35 : 10; // v2 için 35, v1 için 10 kredi
    actualCreditDeducted = CREDIT_COST;

    logger.log(
      `🎨 [QUALITY_VERSION] Settings'ten alınan kalite versiyonu: ${qualityVersion}`,
    );
    logger.log(
      `🎨 [QUALITY_VERSION] Settings objesi:`,
      JSON.stringify(settings || {}, null, 2),
    );

    modelPhoto = modelPhoto ? sanitizeImageUrl(modelPhoto) : modelPhoto;

    // ReferenceImages sanitization + model referansını yakala
    referenceImages = Array.isArray(referenceImages)
      ? referenceImages
          .map((img) => normalizeReferenceEntry(img))
          .filter(Boolean)
      : [];

    let modelReferenceImage = null;

    const existingModelIndex = referenceImages.findIndex((img) => {
      const type = (img?.type || img?.imageType || "").toLowerCase();
      return type === "model" || img?.isModelReference === true;
    });

    if (existingModelIndex !== -1) {
      modelReferenceImage = {
        ...referenceImages[existingModelIndex],
        uri: sanitizeImageUrl(
          referenceImages[existingModelIndex]?.uri ||
            referenceImages[existingModelIndex]?.url,
        ),
        type:
          referenceImages[existingModelIndex]?.type ||
          referenceImages[existingModelIndex]?.imageType ||
          "model",
        isModelReference: true,
      };
      referenceImages.splice(existingModelIndex, 1);
    }

    if (!modelReferenceImage && modelPhoto) {
      logger.log(
        "🧍 [BACKEND] Model referansı SelectAge'den alındı:",
        modelPhoto,
      );
      modelReferenceImage = {
        uri: modelPhoto,
        type: "model",
        isModelReference: true,
        source: "selectAge",
      };
    }

    // Yerel dosya path'lerini Supabase'e upload ederek URL'leri normalize et
    referenceImages = (
      await Promise.all(
        referenceImages.map((img) =>
          ensureRemoteReferenceImage(img, requestUserId),
        ),
      )
    ).filter(Boolean);

    modelReferenceImage = await ensureRemoteReferenceImage(
      modelReferenceImage,
      requestUserId,
    );

    // isMultipleProducts'ı değiştirilebilir hale getir (kombin modu için)
    let isMultipleProducts = originalIsMultipleProducts;

    // userId'yi scope için ata
    userId = requestUserId;

    // 🔒 İÇERİK GÜVENLİĞİ — SADECE güvenlik test hesapları için (ör. Google Play inceleme).
    // Çıplaklık/manipülasyon promptu gelirse sistemden geçirme (model çağrılmaz, kredi düşmez);
    // bu hesabın diğer isteklerinde promptu sertleştir. Gerçek kullanıcılar ETKİLENMEZ.
    try {
      const safetyCheckText = [promptText, editPrompt, customDetail]
        .filter(Boolean)
        .join("\n");
      const safety = await evaluateSafetyPrompt(userId, safetyCheckText);
      if (safety.blocked) {
        logger.log(
          `🔒 [SAFETY] Çıplaklık/manipülasyon promptu engellendi (test hesabı ${userId}): ${safety.reason}`,
        );
        return res.status(400).json({
          success: false,
          error: "content_policy_violation",
          message:
            "Bu içerik güvenlik politikalarına aykırı olduğu için oluşturulamaz.",
        });
      }
      if (safety.isTestUser) {
        promptText = hardenSafetyPrompt(promptText);
        safetyTolerance = "1"; // en katı fal güvenlik toleransı
        logger.log(
          `🔒 [SAFETY] Test hesabı ${userId} için prompt sertleştirildi + safety_tolerance="1" (en katı).`,
        );
      }
    } catch (safetyErr) {
      logger.log(
        "⚠️ [SAFETY] Guard çalışmadı (devam ediliyor):",
        safetyErr?.message || safetyErr,
      );
    }

    if (modelReferenceImage) {
      logger.log(
        "🧍 [BACKEND] Model referans görseli tespit edildi:",
        modelReferenceImage?.uri || modelReferenceImage,
      );
    } else {
      logger.log("🧍 [BACKEND] Model referans görseli bulunamadı");
    }

    const hasRequestField = (fieldName) =>
      Object.prototype.hasOwnProperty.call(req.body, fieldName);

    if (!isPoseChange && hasRequestField("hasProductPhotos")) {
      logger.log(
        "🕺 [BACKEND] ChangeModelPose payload tespit edildi (hasProductPhotos mevcut), isPoseChange true olarak işaretleniyor",
      );
      isPoseChange = true;
    }

    logger.log("🖼️ [BACKEND] isMultipleImages:", isMultipleImages);
    logger.log("🛍️ [BACKEND] isMultipleProducts:", isMultipleProducts);
    logger.log(
      "📐 [BACKEND] multiple angles:",
      isMultipleAnglesMode,
      multipleAnglesCount,
    );
    logger.log("🎨 [BACKEND] isColorChange:", isColorChange);
    logger.log("🎨 [BACKEND] targetColor:", targetColor);
    logger.log("🕺 [BACKEND] isPoseChange:", isPoseChange);
    logger.log("🕺 [BACKEND] customDetail:", customDetail);
    logger.log("✏️ [BACKEND] isEditMode:", isEditMode);
    logger.log("✏️ [BACKEND] editPrompt:", editPrompt);
    logger.log("🔧 [BACKEND] isRefinerMode:", isRefinerMode);
    const incomingReferenceCount = referenceImages?.length || 0;
    const totalReferenceCount =
      incomingReferenceCount + (modelReferenceImage ? 1 : 0);

    logger.log(
      "📤 [BACKEND] Gelen referenceImages:",
      incomingReferenceCount,
      "adet",
    );
    logger.log(
      "📤 [BACKEND] Toplam referans (model dahil):",
      totalReferenceCount,
    );

    // EditScreen modunda promptText boş olabilir (editPrompt kullanılacak)
    const hasValidPrompt =
      promptText || (isEditMode && editPrompt && editPrompt.trim());

    logger.log("🔍 [VALIDATION] promptText:", promptText ? "✅ Var" : "❌ Yok");
    logger.log("🔍 [VALIDATION] isEditMode:", isEditMode);
    logger.log("🔍 [VALIDATION] editPrompt:", editPrompt ? "✅ Var" : "❌ Yok");
    logger.log("🔍 [VALIDATION] hasValidPrompt:", hasValidPrompt);

    if (!hasValidPrompt || totalReferenceCount < 1) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Geçerli bir prompt (promptText veya editPrompt) ve en az 1 referenceImage sağlanmalıdır.",
        },
      });
    }

    // 💡 YENİ YAKLAŞIM: Kredi başlangıçta düşürülmüyor, başarılı tamamlamada düşürülecek
    logger.log(
      `💳 [NEW APPROACH] Kredi başlangıçta düşürülmüyor, başarılı tamamlamada düşürülecek`,
    );

    // Kredi kontrolü kaldırıldı - başarılı completion'da yapılacak

    // ✅ Eski kredi logic'i tamamen kaldırıldı
    if (false) {
      // Completely disabled - credit deduction moved to completion
      // Son 1 dakikadaki tüm generation'ları getir ve settings'te sessionId kontrolü yap
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: recentGenerations, error: sessionError } = await supabase
        .from("reference_results")
        .select("created_at, generation_id, settings")
        .eq("user_id", userId)
        .gte("created_at", oneMinuteAgo)
        .order("created_at", { ascending: false });

      // Client-side filtering: settings içinde sessionId'yi ara
      const sessionGenerations =
        recentGenerations?.filter((gen) => {
          try {
            return gen.settings && gen.settings.sessionId === sessionId;
          } catch (e) {
            return false;
          }
        }) || [];

      logger.log(
        `💳 [SESSION-DEDUP] SessionId ${sessionId} ile ${
          sessionGenerations.length
        } generation bulundu (${
          recentGenerations?.length || 0
        } recent'tan filtrelendi)`,
      );

      if (
        !sessionError &&
        sessionGenerations &&
        sessionGenerations.length >= 1
      ) {
        logger.log(
          `💳 [SESSION-DEDUP] Aynı session'da generation var, kredi düşürme atlanıyor (${sessionGenerations.length} generation)`,
        );
        // shouldDeductCredit = false; // Disabled
      } else {
        logger.log(
          `💳 [SESSION-DEDUP] Session'ın ilk generation'ı, kredi düşürülecek`,
        );
      }
    } else if (false) {
      // shouldDeductCredit disabled - was for time-based deduplication
      // SessionId yoksa time-based deduplication kullan
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
      const { data: recentGenerations, error: recentError } = await supabase
        .from("reference_results")
        .select("created_at, generation_id")
        .eq("user_id", userId)
        .gte("created_at", thirtySecondsAgo)
        .order("created_at", { ascending: false });

      logger.log(
        `💳 [TIME-DEDUP] Son 30 saniyede ${
          recentGenerations?.length || 0
        } generation bulundu`,
      );

      if (!recentError && recentGenerations && recentGenerations.length >= 1) {
        logger.log(
          `💳 [TIME-DEDUP] Son 30 saniyede generation var, kredi düşürme atlanıyor (${recentGenerations.length} generation)`,
        );
        // shouldDeductCredit = false; // Disabled
      } else {
        logger.log(`💳 [TIME-DEDUP] İlk generation, kredi düşürülecek`);
      }
    }

    logger.log(`💳 [CREDIT DEBUG] generationId: ${generationId}`);
    logger.log(`💳 [CREDIT DEBUG] totalGenerations: ${totalGenerations}`);
    logger.log(`💳 [NEW SYSTEM] Kredi işlemleri completion'da yapılacak`);

    // ✅ Eski kredi logic'i tamamen devre dışı - pay-on-success sistemi kullanılıyor
    if (false) {
      // shouldDeductCredit logic disabled
      // Toplam generation sayısına göre kredi hesapla
      const totalCreditCost = CREDIT_COST * totalGenerations;
      logger.log(
        `💳 [CREDIT DEBUG] totalCreditCost: ${totalCreditCost} (${CREDIT_COST} x ${totalGenerations})`,
      );

      try {
        logger.log(`💳 Kullanıcı ${userId} için kredi kontrolü yapılıyor...`);
        logger.log(
          `💳 Toplam ${totalGenerations} generation için ${totalCreditCost} kredi düşülecek`,
        );

        // Krediyi atomic olarak düş (row locking ile)
        const { data: updatedUsers, error: deductError } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        if (deductError) {
          console.error("❌ Kredi sorgulama hatası:", deductError);
          return res.status(500).json({
            success: false,
            result: {
              message: "Kredi sorgulama sırasında hata oluştu",
              error: deductError.message,
            },
          });
        }

        const currentCreditCheck = updatedUsers?.credit_balance || 0;
        if (currentCreditCheck < totalCreditCost) {
          return res.status(402).json({
            success: false,
            result: {
              message: "Yetersiz kredi. Lütfen kredi satın alın.",
              currentCredit: currentCreditCheck,
              requiredCredit: totalCreditCost,
            },
          });
        }

        // Toplam krediyi düş
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCreditCheck - totalCreditCost })
          .eq("id", userId)
          .eq("credit_balance", currentCreditCheck); // Optimistic locking

        if (updateError) {
          console.error("❌ Kredi düşme hatası:", updateError);
          return res.status(500).json({
            success: false,
            result: {
              message:
                "Kredi düşme sırasında hata oluştu (başka bir işlem krediyi değiştirdi)",
              error: updateError.message,
            },
          });
        }

        creditDeducted = true;
        logger.log(
          `✅ ${totalCreditCost} kredi başarıyla düşüldü (${totalGenerations} generation). Yeni bakiye: ${
            currentCreditCheck - totalCreditCost
          }`,
        );

        // Gerçekte düşülen kredi miktarını sakla (iade için)
        actualCreditDeducted = totalCreditCost;
      } catch (creditManagementError) {
        console.error("❌ Kredi yönetimi hatası:", creditManagementError);
        return res.status(500).json({
          success: false,
          result: {
            message: "Kredi yönetimi sırasında hata oluştu",
            error: creditManagementError.message,
          },
        });
      }
    }

    // 📋 Reference images'ları Supabase'e upload et (pending generation için)
    // 🚀 Bu fonksiyon artık hem URL'leri hem base64'leri döndürüyor (Gemini optimizasyonu)
    logger.log("📤 Reference images Supabase'e upload ediliyor...");
    const uploadResult = await uploadReferenceImagesToSupabase(
      referenceImages,
      userId,
    );
    const referenceImageUrls = uploadResult.urls;
    const referenceBase64Array = uploadResult.base64Array; // 🚀 Gemini için base64'ler
    logger.log(
      `🚀 [OPTIMIZE] ${
        referenceBase64Array.filter((b) => b).length
      } adet base64 Gemini için hazır`,
    );

    // 🆔 Generation ID oluştur (eğer client'ten gelmediyse)
    finalGenerationId = generationId || uuidv4();

    // 📝 Pending generation oluştur (işlem başlamadan önce)
    logger.log(`📝 Pending generation oluşturuluyor: ${finalGenerationId}`);
    logger.log(
      `🔍 [DEBUG] Generation ID uzunluğu: ${finalGenerationId?.length}`,
    );
    logger.log(`🔍 [DEBUG] Generation ID tipi: ${typeof finalGenerationId}`);

    // SessionId ve totalGenerations'ı settings'e ekle (completion'da kredi için gerekli)
    const settingsWithSession = {
      ...settings,
      totalGenerations: totalGenerations, // Pay-on-success için gerekli
      isMultipleAnglesMode,
      multipleAnglesCount,
      automaticTrialVariationRequested:
        enableAutomaticTrialVariation === true,
      // 🏷️ 27 Ağu 2026: sınıflandırılan ürün kategorisi kalıcı kayda girer
      // (shoes/clothing; takı rotası kendi damgasını basıyor). Geçmiş modalı
      // kit görünürlüğünü ve gelecekteki analizleri buna dayandırır.
      ...(req.body?.productCategory
        ? { productCategory: normalizeProductCategory(req.body.productCategory) }
        : {}),
      ...(sessionId && { sessionId: sessionId }),
    };

    // Kalite versiyonunu ayrı bir değişken olarak al
    const qualityVersionForDB = isRefinerMode
      ? "v1"
      : settings?.qualityVersion || settings?.quality_version || "v1";

    const pendingGeneration = await createPendingGeneration(
      userId,
      promptText,
      referenceImageUrls,
      settingsWithSession,
      locationImage,
      poseImage,
      hairStyleImage,
      ratio,
      isMultipleImages,
      isMultipleProducts,
      finalGenerationId,
      qualityVersionForDB, // Kalite versiyonunu parametre olarak geç
      styleProfileId || null,
      styleProfileId
        ? "profile"
        : styleReferenceImage &&
            (styleReferenceImage.base64 || styleReferenceImage.uri)
          ? "upload"
          : null,
      normalizeCreationMode(creationMode),
    );

    if (!pendingGeneration) {
      console.error("❌ Pending generation oluşturulamadı");

      // Kredi iade et
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
            })
            .eq("id", userId);

          logger.log(
            `💰 ${actualCreditDeducted} kredi iade edildi (Pending generation hatası)`,
          );
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "İşlem kaydı oluşturulamadı",
        },
      });
    }

    // 🔄 Status'u processing'e güncelle
    await updateGenerationStatus(finalGenerationId, userId, "processing");

    logger.log("🎛️ [BACKEND] Gelen settings parametresi:", settings);
    logger.log("🏞️ [BACKEND] Settings içindeki location:", settings?.location);
    logger.log(
      "🏞️ [BACKEND] Settings içindeki locationEnhancedPrompt:",
      settings?.locationEnhancedPrompt,
    );
    logger.log("📝 [BACKEND] Gelen promptText:", promptText);
    logger.log("🏞️ [BACKEND] Gelen locationImage:", locationImage);
    logger.log("🤸 [BACKEND] Gelen poseImage:", poseImage);
    logger.log("💇 [BACKEND] Gelen hairStyleImage:", hairStyleImage);

    // 🚀 OPTIMIZASYON: uploadReferenceImagesToSupabase'den gelen base64'ü Gemini için kullan
    // Bu sayede aynı resim iki kez indirilmez - tek indirme ile hem Supabase hem Gemini
    let originalBase64ForGemini = referenceBase64Array?.[0] || null;

    if (originalBase64ForGemini) {
      logger.log(
        "🚀 [BACKEND] Gemini için base64 hazır (upload sırasında alındı) - boyut:",
        Math.round(originalBase64ForGemini.length / 1024),
        "KB",
      );
    } else {
      logger.log(
        "⚠️ [BACKEND] Base64 bulunamadı - Gemini URL'den indirecek (fallback)",
      );
    }

    let finalImage;

    // Çoklu resim varsa her birini ayrı ayrı upload et, canvas birleştirme yapma
    if (isMultipleImages && referenceImages.length > 1) {
      // Back side analysis için özel upload işlemi
      if (req.body.isBackSideAnalysis) {
        logger.log(
          "🔄 [BACK_SIDE] Tüm resimleri Supabase'e upload ediliyor...",
        );

        // Her resmi Supabase'e upload et
        const uploadedUrls = [];
        for (let i = 0; i < referenceImages.length; i++) {
          const img = referenceImages[i];
          const imageSource = img.base64
            ? `data:image/jpeg;base64,${img.base64}`
            : img.uri;
          const uploadedUrl = await uploadReferenceImageToSupabase(
            imageSource,
            userId,
          );
          uploadedUrls.push(uploadedUrl);
          logger.log(
            `📤 [BACK_SIDE] Resim ${i + 1} upload edildi:`,
            uploadedUrl,
          );
        }

        // URL'leri referenceImages array'ine geri koy
        for (let i = 0; i < uploadedUrls.length; i++) {
          referenceImages[i] = { ...referenceImages[i], uri: uploadedUrls[i] };
        }

        logger.log("✅ [BACK_SIDE] Tüm resimler Supabase'e upload edildi");

        // Canvas birleştirme bypass et - direkt URL'leri kullan
        finalImage = null; // Canvas'a gerek yok
      } else {
        logger.log(
          "🖼️ [BACKEND] Çoklu resim modu - Her resim ayrı ayrı upload ediliyor...",
        );

        // Kombin modu kontrolü
        const isKombinMode = req.body.isKombinMode || false;
        logger.log("🛍️ [BACKEND] Kombin modu kontrolü:", isKombinMode);

        // Her resmi ayrı ayrı Supabase'e upload et
        const uploadedUrls = [];
        for (let i = 0; i < referenceImages.length; i++) {
          const img = referenceImages[i];
          const imageSource = img.base64
            ? `data:image/jpeg;base64,${img.base64}`
            : img.uri;
          const uploadedUrl = await uploadReferenceImageToSupabase(
            imageSource,
            userId,
          );
          uploadedUrls.push(uploadedUrl);
          logger.log(`📤 [BACKEND] Resim ${i + 1} upload edildi:`, uploadedUrl);
        }

        // URL'leri referenceImages array'ine geri koy
        for (let i = 0; i < uploadedUrls.length; i++) {
          referenceImages[i] = { ...referenceImages[i], uri: uploadedUrls[i] };
        }

        logger.log("✅ [BACKEND] Tüm resimler ayrı ayrı upload edildi");

        // Canvas birleştirme yapma - direkt ayrı resimleri kullan
        finalImage = null; // Canvas'a gerek yok

        // Kombin modunda MUTLAKA isMultipleProducts'ı true yap ki Gemini doğru prompt oluştursun
        if (isKombinMode) {
          logger.log(
            "🛍️ [BACKEND] Kombin modu için isMultipleProducts değeri:",
            `${originalIsMultipleProducts} → true`,
          );
          // Bu değişkeni lokal olarak override et
          isMultipleProducts = true;
        }
      } // Back side analysis else bloğu kapatma
    } else {
      // 🚀 OPTIMIZE: Tek resim için zaten uploadReferenceImagesToSupabase ile upload edildi
      // Tekrar upload yapmıyoruz - referenceImageUrls[0]'ı kullan
      logger.log(
        "🖼️ [BACKEND] Tek resim modu - önceden upload edilen URL kullanılıyor",
      );

      if (!referenceImageUrls?.[0]) {
        return res.status(400).json({
          success: false,
          result: {
            errorCode: "REFERENCE_IMAGE_REQUIRED",
            message: "Reference image is required.",
          },
        });
      }

      // Zaten upload edilmiş URL'yi kullan - tekrar upload YOK!
      finalImage = sanitizeImageUrl(referenceImageUrls[0]);
      logger.log(
        "🚀 [OPTIMIZE] Tek resim için önceden upload edilen URL kullanıldı (çift upload önlendi)",
      );
    }

    logger.log("Supabase'den alınan final resim URL'si:", finalImage);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    logger.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`,
    );

    // 🎬 STYLE REFERENCE — kullanıcının yüklediği stil referans görselini (ör. Pinterest'ten
    // beğenilen bir çekim) alt kenarına "STYLE REFERENCE · CODE SR-1" kod plakası basarak
    // Supabase'e yükle. Prompt bu kod üzerinden görseli işaret eder; nano-banana ortam/ışık/
    // kamera/pozu bu görselden kopyalar, kıyafetleri ise SADECE ürün fotoğraflarından alır.
    // Renk değiştirme / poz değiştirme / refiner / arka analiz modlarında devre dışıdır.
    let styleReferenceUrl = null;
    let styleReferenceStamped = false;
    let styleProfileMeta = null; // { name, stylePrompt, imageCount } — stil profili modunda dolar
    let editorialCollagesForRequest = []; // 🎞️ Editorial mod: bu istekte eklenecek kolaj URL'leri
    // 🌟 Otomatik global stil durumu:
    //   autoStyleMode "full" → styleProfileId doldurulur, mevcut stil hattı aynen çalışır
    //   autoStyleMode "soft" → Gemini prompt'u korunur, stil katmanı sona eklenir
    let autoStyleMode = null; // null | "full" | "soft"
    let autoStyleProfile = null; // seçilen global profil satırı
    let autoStyleGridUrl = null; // soft modda isteğe eklenen plakalı kolaj URL'i
    let autoStylePriorUseCount = 0; // aynı kullanıcı + aynı stil başarılı geçmişi
    let autoStyleRepeatPoseDirective = "";
    let autoStyleGenderDirective = "";
    // 🖼️ TEK fotoğraflık stil profili: kolaj "aynı aileden FARKLI mekân icat et"
    // kuralıyla değil, TEKİL REFERANS kurallarıyla işlenir (aynı tür mekân,
    // ~%90 poz iskeleti, kamera cihazı + preset birebir). Kırpılan (auto)
    // stillerin tamamı tek kare olduğu için asıl "referansa yakınlık" bu yoldan gelir.
    let singleImageStyleProfileId = null;
    const styleReferenceRequested =
      styleReferenceImage &&
      (styleReferenceImage.base64 || styleReferenceImage.uri) &&
      !isColorChange &&
      !isPoseChange &&
      !isRefinerMode &&
      !req.body.isBackSideAnalysis;

    if (styleReferenceRequested) {
      try {
        // 1) Raw buffer (base64 veya URL)
        let styleRawBuf;
        if (styleReferenceImage.base64) {
          const cleanB64 = String(styleReferenceImage.base64).replace(
            /^data:image\/\w+;base64,/,
            "",
          );
          styleRawBuf = Buffer.from(cleanB64, "base64");
        } else {
          const cleanStyleUrl = sanitizeImageUrl(
            styleReferenceImage.uri.split("?")[0],
          );
          const styleResp = await axios.get(cleanStyleUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          styleRawBuf = Buffer.from(styleResp.data);
        }

        // 2) Kod plakalı composite üret (ortak helper — siyah plaka, boyut referansının
        //    beyaz şeridinden bilinçli olarak farklı; model iki referansı karıştırmasın)
        const styleComposited = await stampStyleReferencePlate(styleRawBuf);

        // 4) Supabase'e yükle
        const styleFileName = `temp_${Date.now()}_style_reference_${userId || "anonymous"}_${uuidv4().substring(0, 8)}.jpg`;
        const { error: styleUpErr } = await supabase.storage
          .from("reference")
          .upload(styleFileName, styleComposited, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
          });
        if (styleUpErr) {
          throw new Error(`Supabase upload error: ${styleUpErr.message}`);
        }
        const { data: styleUrlData } = supabase.storage
          .from("reference")
          .getPublicUrl(styleFileName);
        styleReferenceUrl = styleUrlData.publicUrl;
        styleReferenceStamped = true;
        logger.log(
          "🎬 [STYLE REFERENCE] Kod plakalı composite upload OK:",
          styleReferenceUrl,
        );
      } catch (styleErr) {
        logger.warn(
          "🎬 [STYLE REFERENCE] Damgalama/upload hatası, ham görsel denenecek:",
          styleErr?.message,
        );
        // Fallback: damgasız ham görseli yüklemeyi dene — mod yine de çalışsın
        try {
          const rawSource = styleReferenceImage.base64
            ? `data:image/jpeg;base64,${String(styleReferenceImage.base64).replace(/^data:image\/\w+;base64,/, "")}`
            : sanitizeImageUrl(styleReferenceImage.uri);
          styleReferenceUrl = await uploadReferenceImageToSupabase(
            rawSource,
            userId,
          );
          styleReferenceStamped = false;
          logger.log(
            "🎬 [STYLE REFERENCE] Ham görsel upload OK (kod plakasız):",
            styleReferenceUrl,
          );
        } catch (rawErr) {
          logger.warn(
            "🎬 [STYLE REFERENCE] Ham upload da başarısız, stil referansı atlanıyor:",
            rawErr?.message,
          );
          styleReferenceUrl = null;
        }
      }
    }

    // 🌟 OTOMATİK GLOBAL STİL — kullanıcı hiçbir stil kaynağı seçmediyse, küratörlü
    // global çekim tarzlarından biri arka planda atanır ("house style"):
    //   FULL → kullanıcı mekân/arka plan seçmedi (poz/saç/hava/saat olsa bile):
    //          styleProfileId doldurulur, aşağıdaki MEVCUT stil hattı aynen çalışır.
    //   SOFT → kullanıcı mekân/arka plan seçti: Gemini prompt'u AYNEN korunur
    //          (kullanıcı seçimleri her zaman kazanır), stil yalnız ışık/grade/
    //          kamera/poz-enerjisi katmanı olarak prompt sonuna eklenir.
    // Editorial mod kullanıcının bilinçli tercihiyse ona dokunulmaz. Havuz boş
    // ya da erişilemezse üretim sessizce normal akışına döner.
    // 🚪 Ön kapı (CreateModelStartModal) kararı: kullanıcı "Sade"yi seçtiyse
    // istemci `autoStyleEnabled: false` gönderir ve gizli stil ATANMAZ.
    // ⚠️ Yalnızca AÇIK false devre dışı bırakır — undefined/eksik gelen istekler
    // (ön kapıyı görmeyen eski build'ler, deeplink, diğer ekranlar) eskisi gibi
    // davranmaya devam eder. Bu yüzden `!== false` kontrolü, truthy kontrolü değil.
    // 🎛️ Sunucu ana şalteri (app_config.auto_global_style_enabled).
    // false ise kullanıcı Kristal'i seçmiş olsa bile gizli stil ATANMAZ.
    const autoStyleMasterEnabled = await isAutoGlobalStyleEnabledForPlatform(
      req.body.platform || req.headers["x-platform"],
    );
    if (!autoStyleMasterEnabled) {
      console.log(
        "🎛️ [AUTO_STYLE] Ana şalter KAPALI (app_config.auto_global_style_enabled=false) → gizli stil atanmayacak",
      );
    }

    const autoStyleAllowedByClient = req.body.autoStyleEnabled !== false;
    if (!autoStyleAllowedByClient) {
      console.log(
        "🚪 [AUTO_STYLE] Kullanıcı ön kapıda 'Sade'yi seçti → gizli global stil atanmayacak",
      );
    }

    const autoStyleEligible =
      isAutoGlobalStyleEnabled() &&
      autoStyleMasterEnabled &&
      autoStyleAllowedByClient &&
      !styleReferenceUrl &&
      !styleReferenceImage &&
      !styleProfileId &&
      !editorialMode &&
      !isColorChange &&
      !isPoseChange &&
      !isRefinerMode &&
      !isEditMode &&
      !req.body.isBackSideAnalysis;
    if (autoStyleEligible) {
      const autoHasUserScene = Boolean(
        locationImage ||
          settings?.location ||
          settings?.locationEnhancedPrompt ||
          settings?.locationId ||
          settings?.backgroundColorHex,
      );
      const autoHasUserPose = Boolean(
        poseImage ||
          (typeof settings?.pose === "string" && settings.pose.trim()),
      );
      const autoHasUserHair = Boolean(
        hairStyleImage || settings?.hairStyle || settings?.hairColor,
      );
      // Yalnız mekân/arka plan seçimi SOFT moda geçirir. Poz, saç, hava ve saat
      // seçimleri FULL modda kalır ve kullanıcı kilitleriyle stilin üzerine yazılır.
      const resolvedAutoStyleMode = resolveAutoStyleMode({
        hasUserScene: autoHasUserScene,
      });
      // 👶 Yaş filtresi SADECE kullanıcı 18 altı yaş girdiyse devreye girer;
      // 18+ ve yaşsız üretimler her zaman genel havuzdan seçer.
      const autoUserAge = resolveUserAgeNumber(settings);
      try {
        const normalizedAutoCategory = normalizeProductCategory(
          req.body?.productCategory,
        );
        const normalizedAutoSubtype = normalizeProductSubtype(
          req.body?.productCategory,
          req.body?.productSubtype,
        );
        const normalizedAutoApproach = normalizeStyleApproach(
          req.body?.styleApproach,
        );
        logger.log(
          `🏷️ [AUTO_STYLE] Havuz isteği: category=${normalizedAutoCategory || "-"} subtype=${normalizedAutoSubtype || "-"} approach=${normalizedAutoApproach ?? "-"} gender=${settings?.gender || "-"}`,
        );
        autoStyleProfile = await pickAutoGlobalStyleProfile({
          // Stüdyo kilitli profillerin kimliği düz fon setinin kendisi —
          // yalnız kullanıcının gerçek bir sahne/mekân seçimiyle çelişir.
          // Poz veya saç seçimi tek başına stüdyo stillerini elememelidir.
          excludeStudioLocked: autoHasUserScene,
          userAge: autoUserAge,
          // 🏷️ İstemci fotoğrafı yükler yüklemez /api/product-type/classify'a
          // sorup tipi buraya yolluyor (shoes | jewelry | clothing). Gelmezse
          // veya havuz eşiğin altındaysa genel havuz kullanılır.
          productCategory: normalizedAutoCategory,
          productSubtype: normalizedAutoSubtype,
          styleApproach: normalizedAutoApproach,
          // 🚻 Zıt gender ETİKETLİ stiller (örn. man seçiliyken woman etiketli
          // Sokak Stili) havuz seçiminde elenir; etiketsiz stiller serbest.
          userGender: settings?.gender ?? null,
          // 🔁 Stil rotasyonu: bu kullanıcının daha önce kullandığı stiller
          // mümkün oldukça yeniden seçilmez (havuz bitince kademeli sıfırlanır).
          userId: pendingGeneration?.user_id || userId || null,
        });
        if (autoStyleProfile) {
          autoStyleMode = resolvedAutoStyleMode;
          autoStyleGenderDirective = buildAutoStyleGenderDirective({
            gender: settings?.gender,
            userAge: autoUserAge,
          });
          if (autoStyleMode === "full") {
            styleProfileId = autoStyleProfile.id;
          }

          // Pending satırı henüz stile bağlanmadan önce geçmiş başarılı
          // kullanımları say. Böylece mevcut pending kayıt kendini tekrar sanmaz.
          try {
            autoStylePriorUseCount = await countPriorSuccessfulAutoStyleUses({
              userId: pendingGeneration?.user_id || userId,
              styleProfileId: autoStyleProfile.id,
              excludeResultId: pendingGeneration?.id || null,
            });
            autoStyleRepeatPoseDirective =
              buildRepeatedAutoStylePoseDirective({
                priorUseCount: autoStylePriorUseCount,
                userHasPose: autoHasUserPose,
              });
            if (autoStyleRepeatPoseDirective) {
              logger.log(
                `🔁 [AUTO_STYLE] Aynı stil kullanıcıda ${autoStylePriorUseCount} kez başarılı kullanılmış — zorunlu yeni poz devrede`,
              );
            }
          } catch (repeatCheckErr) {
            autoStylePriorUseCount = 0;
            autoStyleRepeatPoseDirective = "";
            logger.warn(
              "🔁 [AUTO_STYLE] Geçmiş stil kullanımı okunamadı; normal poz akışı:",
              repeatCheckErr?.message,
            );
          }

          // Pending satırı otomatik seçimden önce açılıyor. Seçilen profile geri
          // bağlanmazsa admin kullanım sayıları ve önce/sonra örnekleri gizli
          // stilleri hiç görmüyor. Açıkça seçilen profillerle aynı izleme
          // semantiğini kullan; yazma hatası üretimi durdurmasın.
          const autoUsagePatch = buildAutoStyleUsagePatch(autoStyleProfile);
          if (autoUsagePatch && pendingGeneration?.id) {
            try {
              const { error: autoUsageErr } = await supabase
                .from("reference_results")
                .update(autoUsagePatch)
                .eq("id", pendingGeneration.id);
              if (autoUsageErr) {
                logger.warn(
                  "📊 [AUTO_STYLE] kullanım profili kaydedilemedi:",
                  autoUsageErr.message,
                );
              }
            } catch (autoUsageErr) {
              logger.warn(
                "📊 [AUTO_STYLE] kullanım profili yazılırken hata:",
                autoUsageErr?.message,
              );
            }
          }

          logger.log(
            `🌟 [AUTO_STYLE] "${resolveProfileDisplayName(autoStyleProfile.name) || autoStyleProfile.id}" ${autoStyleMode.toUpperCase()} modda atandı (pool:${autoStyleProfile.product_category || "-"}/${autoStyleProfile.product_subtype || "-"}+${autoStyleProfile.style_approach ?? "-"} scene:${autoHasUserScene} pose:${autoHasUserPose} hair:${autoHasUserHair} age:${autoUserAge ?? "yok"})`,
          );
        }
      } catch (autoErr) {
        autoStyleMode = null;
        autoStyleProfile = null;
        logger.warn(
          "🌟 [AUTO_STYLE] Otomatik stil seçilemedi, normal akışa devam:",
          autoErr?.message,
        );
      }
    }

    // 🎬 STİL PROFİLİ — kullanıcının kayıtlı marka stil preseti. Doğrudan stil referansı
    // yüklenmediyse ve styleProfileId geldiyse: profildeki TÜM fotoğraflar (en fazla 6)
    // tek bir grid kolaja birleştirilir, SR-1 kod plakası basılır ve stil referansı
    // olarak kullanılır; Gemini'nin profil analizi de prompta eklenir.
    const styleProfileRequested =
      !styleReferenceUrl &&
      styleProfileId &&
      !isColorChange &&
      !isPoseChange &&
      !isRefinerMode &&
      !req.body.isBackSideAnalysis;

    if (styleProfileRequested) {
      try {
        // style_profiles RLS'li (anon'a policy yok) — service role client şart.
        // Bu dosyanın genel client'ı lokalde anon'a düşebildiği için ayrı client kuruyoruz.
        const styleProfilesDb = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY ||
            process.env.SUPABASE_SERVICE_KEY ||
            process.env.SUPABASE_ANON_KEY,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data: styleProfileRow, error: spErr } = await styleProfilesDb
          .from("style_profiles")
          .select("*")
          .eq("id", styleProfileId)
          .maybeSingle();
        if (spErr || !styleProfileRow) {
          throw new Error("Style profile not found");
        }
        // Global (küratörlü) profiller herkese açık; 'auto' (gizli otomatik
        // havuz) profilleri de üretimde kullanılabilir — otomatik stil FULL
        // modda styleProfileId'yi bu havuzdan doldurur. Diğerlerinde sahiplik şart.
        if (
          String(styleProfileRow.user_id) !== String(userId) &&
          String(styleProfileRow.user_id) !== "global" &&
          String(styleProfileRow.user_id) !== "auto"
        ) {
          throw new Error("Style profile is not owned by this user");
        }
        const profileUrls = Array.isArray(styleProfileRow.image_urls)
          ? styleProfileRow.image_urls
          : [];
        if (profileUrls.length === 0) {
          throw new Error("Style profile has no images");
        }

        // 🎬 Plakalı kolaj ÖNBELLEĞİ — aynı profil için her üretimde yeniden
        // kolaj kurup plaka basmak ve yeni dosya yüklemek gereksiz. Bir kez
        // üretilir, URL'si profile yazılır; sonraki üretimler onu kullanır.
        // (Profile fotoğraf eklenip çıkarıldığında bu alan NULL'a çekiliyor.)
        let gridCount = profileUrls.length;
        let cachedGridUrl = isCurrentStyleReferencePlateUrl(
          styleProfileRow.stamped_grid_url,
        )
          ? styleProfileRow.stamped_grid_url
          : null;

        if (!cachedGridUrl) {
          const built = await buildStyleProfileGrid(profileUrls);
          gridCount = built.count;
          const stampedGrid = await stampStyleReferencePlate(built.buffer);

          const gridFileName = `style_profile_grid_${styleProfileRow.id}_${STYLE_REFERENCE_PLATE_VARIANT}_${uuidv4().substring(0, 8)}.jpg`;
          const { error: gridUpErr } = await supabase.storage
            .from("reference")
            .upload(gridFileName, stampedGrid, {
              contentType: "image/jpeg",
              cacheControl: "3600",
              upsert: true,
            });
          if (gridUpErr) {
            throw new Error(`Supabase upload error: ${gridUpErr.message}`);
          }
          const { data: gridUrlData } = supabase.storage
            .from("reference")
            .getPublicUrl(gridFileName);
          cachedGridUrl = gridUrlData.publicUrl;

          // Kalıcılaştır — başarısız olursa üretim yine de devam eder,
          // yalnızca bir sonraki sefer kolaj tekrar kurulur.
          const { error: cacheErr } = await styleProfilesDb
            .from("style_profiles")
            .update({ stamped_grid_url: cachedGridUrl })
            .eq("id", styleProfileRow.id);
          if (cacheErr) {
            logger.warn(
              "🎬 [STYLE_PROFILE] kolaj önbelleği yazılamadı:",
              cacheErr.message,
            );
          }
        } else {
          logger.log(
            `🎬 [STYLE_PROFILE] plakalı kolaj önbellekten kullanıldı: ${cachedGridUrl}`,
          );
        }

        styleReferenceUrl = cachedGridUrl;
        styleReferenceStamped = true;
        if (profileUrls.length === 1) {
          // 🖼️ TEK KARELİK PROFİL — kolaj modu yerine TEKİL REFERANS modu:
          // styleProfileMeta boş bırakılır ki kompakt prompt "exact replication"
          // dalına girsin (aynı tür mekân, ~%90 poz iskeleti, motion state,
          // kamera cihazı + preset kilitleri). Teknik analiz aşağıdaki blokta
          // üretilir ve profil bazında bellekte önbelleklenir.
          styleProfileMeta = null;
          singleImageStyleProfileId = styleProfileRow.id;
          logger.log(
            `🖼️ [STYLE_PROFILE] "${resolveStyleProfileNameForPrompt(styleProfileRow.name) || "?"}" TEK karelik — tekil referans modunda işlenecek:`,
            styleReferenceUrl,
          );
        } else {
          styleProfileMeta = {
            name: styleProfileRow.name || null,
            stylePrompt: styleProfileRow.style_prompt || null,
            imageCount: gridCount,
          };
          logger.log(
            `🎬 [STYLE_PROFILE] "${resolveStyleProfileNameForPrompt(styleProfileRow.name) || "?"}" grid kolajı (${gridCount} kare) upload OK:`,
            styleReferenceUrl,
          );
        }
      } catch (profileErr) {
        logger.warn(
          "🎬 [STYLE_PROFILE] Profil işlenemedi, normal akışa dönülüyor:",
          profileErr?.message,
        );
        styleReferenceUrl = null;
        styleProfileMeta = null;
      }
    }

    // 🌟 SOFT otomatik stil: plakalı kolajı hazırla (önbellekten ya da kurarak).
    // styleReferenceUrl BİLEREK doldurulmaz — aşağıdaki prompt dallanması normal
    // Gemini hattında kalmalı; kolaj yalnız istek görsellerinin sonuna eklenir.
    // Kolaj kurulamazsa soft blok metin-only devam eder (üretim asla bozulmaz).
    if (autoStyleMode === "soft" && autoStyleProfile) {
      try {
        autoStyleGridUrl = isCurrentStyleReferencePlateUrl(
          autoStyleProfile.stamped_grid_url,
        )
          ? autoStyleProfile.stamped_grid_url
          : null;
        if (!autoStyleGridUrl) {
          const builtAutoGrid = await buildStyleProfileGrid(
            autoStyleProfile.image_urls,
          );
          const stampedAutoGrid = await stampStyleReferencePlate(
            builtAutoGrid.buffer,
          );
          const autoGridFileName = `style_profile_grid_${autoStyleProfile.id}_${STYLE_REFERENCE_PLATE_VARIANT}_${uuidv4().substring(0, 8)}.jpg`;
          const { error: autoGridUpErr } = await supabase.storage
            .from("reference")
            .upload(autoGridFileName, stampedAutoGrid, {
              contentType: "image/jpeg",
              cacheControl: "3600",
              upsert: true,
            });
          if (autoGridUpErr) {
            throw new Error(`Supabase upload error: ${autoGridUpErr.message}`);
          }
          const { data: autoGridUrlData } = supabase.storage
            .from("reference")
            .getPublicUrl(autoGridFileName);
          autoStyleGridUrl = autoGridUrlData.publicUrl;

          // Kolaj önbelleğini profile yaz (style_profiles RLS'li — service role).
          // Başarısız olursa yalnızca bir sonraki üretimde yeniden kurulur.
          const autoStyleDb = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
              process.env.SUPABASE_SERVICE_KEY ||
              process.env.SUPABASE_ANON_KEY,
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          const { error: autoCacheErr } = await autoStyleDb
            .from("style_profiles")
            .update({ stamped_grid_url: autoStyleGridUrl })
            .eq("id", autoStyleProfile.id);
          if (autoCacheErr) {
            logger.warn(
              "🌟 [AUTO_STYLE] kolaj önbelleği yazılamadı:",
              autoCacheErr.message,
            );
          }
        }
        logger.log(
          `🌟 [AUTO_STYLE] Soft mod kolajı hazır: ${autoStyleGridUrl}`,
        );
      } catch (autoGridErr) {
        autoStyleGridUrl = null;
        logger.warn(
          "🌟 [AUTO_STYLE] Soft kolaj hazırlanamadı, metin-only devam:",
          autoGridErr?.message,
        );
      }
    }

    // 📊 Kullanım izleme: modele giden stil referansının NİHAİ adresi ancak
    // burada belli oluyor (yüklemede tek görsel, profilde plakalı grid kolajı,
    // otomatik soft stilde plakalı kolaj). Best-effort — yazılamazsa üretim
    // etkilenmez, yalnızca rapordaki önizleme eksik kalır. Satır zaten pending
    // olarak açılmış durumda.
    const trackedStyleReferenceUrl = styleReferenceUrl || autoStyleGridUrl;
    if (trackedStyleReferenceUrl && pendingGeneration?.id) {
      supabase
        .from("reference_results")
        .update({ style_reference_url: trackedStyleReferenceUrl })
        .eq("id", pendingGeneration.id)
        .then(({ error: styleUrlErr }) => {
          if (styleUrlErr) {
            logger.warn(
              "📊 [STYLE_USAGE] stil referans adresi yazılamadı:",
              styleUrlErr.message,
            );
          }
        });
    }

    // 🎬 TEKİL STİL REFERANSI TEKNİK ANALİZİ — profil modunda analiz zaten style_prompt'ta;
    // doğrudan yüklenen tekil referans için Gemini'den kamera/ışık/grade reçetesi çıkar.
    // Başarısız olursa sessizce devam edilir (nano-banana referansı yine de görüyor).
    let styleReferenceTechAnalysis = null;
    // 🖼️ Tek karelik profil: analiz daha önce üretildiyse önbellekten al
    if (
      singleImageStyleProfileId &&
      singleProfileTechAnalysisCache.has(singleImageStyleProfileId)
    ) {
      styleReferenceTechAnalysis = singleProfileTechAnalysisCache.get(
        singleImageStyleProfileId,
      );
      logger.log(
        `🖼️ [STYLE_PROFILE] Teknik analiz önbellekten kullanıldı (${singleImageStyleProfileId})`,
      );
    }
    if (styleReferenceUrl && !styleProfileMeta && !styleReferenceTechAnalysis) {
      try {
        const TECH_ANALYSIS_PROMPT = `You are a director of photography. Analyze the attached fashion/style reference photograph and output a compact TECHNICAL REPLICATION SPEC so an AI image model can recreate the exact same shot conditions. Ignore the black "STYLE REFERENCE" code plate at the bottom edge — it is a marker, not part of the photo.

Give concrete estimates in cinematographer language:
1. CAMERA & CAPTURE DEVICE — FIRST name the capture device outright, it changes everything downstream: modern smartphone (and which family it looks like — "iPhone-style computational capture", "Android flagship") / professional mirrorless or DSLR / compact point-and-shoot / analog 35mm film / medium format. Justify it in a few words from visible evidence (HDR-flattened shadows, phone-flash falloff, true optical bokeh, film grain/halation). Then estimated focal length (mm), estimated aperture & depth of field, camera height and angle relative to the subject, lens character (compression/distortion). A phone-shot look rebuilt as a studio camera shot misses the style completely — commit to a call.
2. FRAMING — crop (full-body/three-quarter/waist-up), headroom, negative space, composition. State explicitly whether the subject's feet are inside the frame.
3. LIGHTING — key direction & quality (hard/soft), fill & shadow density, rim/back light, natural vs studio, time-of-day feel.
4. COLOR GRADE / PRESET RECIPE — if a filter or preset is clearly applied, IDENTIFY IT BY NAME as "closest to <name>" using real ecosystem vocabulary (VSCO A6/C1/HB1, Kodak Portra 400, Fuji 400H, Cinestill 800T, iPhone Photographic Styles...), or say "no preset, straight capture". Then ALWAYS give the rebuildable recipe: palette, saturation, contrast curve and black level, white balance bias, shadow/highlight tints, highlight roll-off, grain amount, any fade/halation/vignette. The output must carry this EXACT grade — a clean but differently graded image misses the style.
5. POSE GEOMETRY — body orientation, weight distribution, limb placement, gaze direction (describe geometry only, never identity).
6. MOTION STATE & POSE SUPPORT — name the state outright: standing still / walking mid-stride / turning / stepping / seated / leaning. If the subject is in motion, specify the stride phase (which leg is forward, weight in transition, back heel lifting, natural opposite arm swing) and the motion cues visible in the frame (hair or fabric responding to movement). If the subject is seated, perching or leaning, NAME the supporting object (chair, stool, bench, steps, ledge, wall) — the support is part of the pose. This is a HIGH-VALUE detail — a walking reference rebuilt as static, or a seated reference rebuilt standing without its seat, misses the shot entirely; do not leave this section vague.
7. ENVIRONMENT INVENTORY — enumerate the CONCRETE visible elements of the location so the same place can be rebuilt, not merely a look-alike: the type of place, its architecture and materials (e.g. "weathered stone colonnade with Corinthian columns", "white brick wall, concrete floor"), surfaces underfoot, furniture and fixed objects with their position in frame (left/right/behind the subject), vegetation, depth layers from foreground to background, and any distinctive landmark features. Name each element in plain words — an element you do not name will be replaced by an invented one.
8. SUBJECT COUNT & INTERACTION — state the exact number of clearly visible people in the reference. If there are two or more, describe their relative placement, physical contact, support and interaction geometry without describing identity or wardrobe. Explicitly say that this subject count and interaction must be preserved while the primary garment-wearing person remains the commercial hero.

Do NOT describe any person's face/identity or garments. PLAIN TEXT only, numbered labels only, no markdown. There is no hard length cap — cover every section thoroughly; every sentence must add a concrete technical fact rather than repeating ideas.`;
        styleReferenceTechAnalysis = (
          await callGeminiFlash(TECH_ANALYSIS_PROMPT, [styleReferenceUrl], 2)
        )?.trim() || null;
        if (styleReferenceTechAnalysis) {
          logger.log(
            `🎬 [STYLE REFERENCE] Teknik analiz hazır (${styleReferenceTechAnalysis.length} karakter)`,
          );
          // 🖼️ Tek karelik profil analizini önbelleğe al — aynı gizli stil
          // tekrar seçildiğinde Gemini çağrısı tekrarlanmaz.
          if (singleImageStyleProfileId) {
            if (
              singleProfileTechAnalysisCache.size >=
              SINGLE_PROFILE_TECH_CACHE_MAX
            ) {
              const oldestKey = singleProfileTechAnalysisCache.keys().next().value;
              singleProfileTechAnalysisCache.delete(oldestKey);
            }
            singleProfileTechAnalysisCache.set(
              singleImageStyleProfileId,
              styleReferenceTechAnalysis,
            );
          }
        }
      } catch (techErr) {
        logger.warn(
          "🎬 [STYLE REFERENCE] Teknik analiz alınamadı, analizsiz devam:",
          techErr?.message,
        );
        styleReferenceTechAnalysis = null;
      }
    }

    // 🚀 Paralel işlemler başlat
    logger.log(
      "🚀 Paralel işlemler başlatılıyor: Gemini + Arkaplan silme + ControlNet hazırlığı...",
    );

    let enhancedPrompt, backgroundRemovedImage;

    if (isColorChange || isPoseChange || isRefinerMode) {
      // 🎨 COLOR CHANGE MODE, 🕺 POSE CHANGE MODE veya 🔧 REFINER MODE - Özel prompt'lar
      if (isColorChange) {
        logger.log(
          "🎨 Color change mode: Basit renk değiştirme prompt'u oluşturuluyor",
        );
        enhancedPrompt = `Change the main color of the product/item in this image to ${targetColor}. Keep all design details, patterns, textures, and shapes exactly the same. Only change the primary color to ${targetColor}. The result should be photorealistic with natural lighting.`;
      } else if (isRefinerMode) {
        logger.log(
          "🔧 Refiner mode: Profesyonel e-ticaret fotoğraf refiner prompt'u oluşturuluyor",
        );

        // Refiner modu için Gemini ile gelişmiş prompt oluştur
        logger.log(
          "🤖 [GEMINI CALL - REFINER] enhancePromptWithGemini parametreleri:",
        );
        logger.log("🤖 [GEMINI CALL - REFINER] - finalImage URL:", finalImage);
        logger.log(
          "🤖 [GEMINI CALL - REFINER] - isMultipleProducts:",
          isMultipleProducts,
        );

        enhancedPrompt = await enhancePromptWithGemini(
          promptText ||
            "Transform this amateur product photo into a professional high-end e-commerce product photo with invisible mannequin effect, perfect lighting, white background, and luxury presentation quality",
          finalImage,
          settings || {},
          locationImage,
          poseImage,
          hairStyleImage,
          isMultipleProducts,
          false, // isColorChange
          null, // targetColor
          false, // isPoseChange
          null, // customDetail
          false, // isEditMode
          null, // editPrompt
          isRefinerMode, // isRefinerMode - yeni parametre
          req.body.isBackSideAnalysis || false, // Arka taraf analizi modu mu?
          referenceImages, // Multi-product için tüm referans resimler
          false, // isMultipleImages
          userId, // Compress için userId
          originalBase64ForGemini, // 🚀 Orijinal base64 - URL indirmesi atlanacak
        );
      } else if (isPoseChange) {
        logger.log(
          "🕺 Pose change mode: Gemini ile poz değiştirme prompt'u oluşturuluyor",
        );

        // Poz değiştirme modunda Gemini ile prompt oluştur
        logger.log(
          "🤖 [GEMINI CALL - POSE] enhancePromptWithGemini parametreleri:",
        );
        logger.log("🤖 [GEMINI CALL - POSE] - finalImage URL:", finalImage);
        logger.log(
          "🤖 [GEMINI CALL - POSE] - isMultipleProducts:",
          isMultipleProducts,
        );
        logger.log(
          "🤖 [GEMINI CALL - POSE] - referenceImages sayısı:",
          referenceImages?.length || 0,
        );

        // EditScreen modunda editPrompt'u, normal modda promptText'i kullan
        const promptToUse =
          isEditMode && editPrompt && editPrompt.trim()
            ? editPrompt.trim()
            : promptText;

        logger.log(
          "📝 [GEMINI CALL - POSE] Kullanılacak prompt:",
          isEditMode ? "editPrompt" : "promptText",
        );
        logger.log("📝 [GEMINI CALL - POSE] Prompt içeriği:", promptToUse);

        // Pose change için sadece model fotoğrafını Gemini'ye gönder
        let modelImageForGemini;
        if (
          modelReferenceImage &&
          (modelReferenceImage.uri || modelReferenceImage.url)
        ) {
          modelImageForGemini = sanitizeImageUrl(
            modelReferenceImage.uri || modelReferenceImage.url,
          );
        } else if (referenceImages && referenceImages.length > 0) {
          const firstReference = referenceImages[0];
          modelImageForGemini = sanitizeImageUrl(
            firstReference && (firstReference.uri || firstReference.url)
              ? firstReference.uri || firstReference.url
              : firstReference,
          );
        } else {
          modelImageForGemini = finalImage;
        }

        logger.log(
          "🤖 [GEMINI CALL - POSE] Sadece model fotoğrafı gönderiliyor:",
          modelImageForGemini,
        );

        enhancedPrompt = await enhancePromptWithGemini(
          promptToUse, // EditScreen'de editPrompt, normal modda promptText
          modelImageForGemini, // Sadece model fotoğrafı (ilk resim)
          settings || {},
          locationImage,
          poseImage,
          hairStyleImage,
          false, // isMultipleProducts - pose change'de product yok
          false, // isColorChange
          null, // targetColor
          isPoseChange, // isPoseChange
          customDetail, // customDetail
          isEditMode, // isEditMode
          editPrompt, // editPrompt
          false, // isRefinerMode
          false, // isBackSideAnalysis - pose change'de arka analizi yok
          null, // referenceImages - Gemini'ye product photolar gönderilmez
          false, // isMultipleImages - Gemini'ye tek resim gönderiliyor
          userId, // Compress için userId
          originalBase64ForGemini, // 🚀 Orijinal base64 - URL indirmesi atlanacak
        );
      }
      backgroundRemovedImage = finalImage; // Orijinal image'ı kullan, arkaplan silme yok
      logger.log(
        isColorChange
          ? "🎨 Color change prompt:"
          : isRefinerMode
            ? "🔧 Refiner prompt:"
            : "🕺 Pose change prompt:",
        enhancedPrompt,
      );
    } else if (!isPoseChange && styleReferenceUrl) {
      // 🎬 STYLE REFERENCE MODE — Gemini enhanced-prompt hattı ATLANIR.
      // Ortam/ışık/kamera/poz referans görselden kopyalanacağı için kompakt,
      // deterministik prompt yeterli; sadece seçim/detay girdileri eklenir.

      // 🧍 Kullanıcı POZ GÖRSELİ seçtiyse (metin poz yok): normal moddaki Gemini
      // enhance atlandığı için poz görseli tarif edilmeden kalırdı — görsel fal'a
      // da eklenmiyor. Kısa bir analizle metne çevirip settings.pose'a yaz: hem
      // kompakt prompt'un USER POSE OVERRIDE bloğu hem sondaki instruction lock
      // bu metni kullanır.
      if (
        poseImage &&
        !(typeof settings?.pose === "string" && settings.pose.trim())
      ) {
        try {
          const poseDesc = (
            await callGeminiFlash(
              `Describe the pose of the person in this image as a compact, actionable pose instruction for a fashion model: body orientation toward camera, weight distribution, arm and leg positions, hand placement, head tilt and gaze direction. PLAIN TEXT only, 40-80 words. Never describe the person's identity, face or garments.`,
              [sanitizeImageUrl(String(poseImage).split("?")[0])],
              2,
            )
          )?.trim();
          if (poseDesc) {
            settings = { ...(settings || {}), pose: poseDesc };
            logger.log(
              `🧍 [STYLE+POSE] Poz görseli tarif edildi (${poseDesc.length} karakter) — kullanıcı pozu stil pozunu ezecek`,
            );
          }
        } catch (poseDescErr) {
          logger.warn(
            "🧍 [STYLE+POSE] Poz görseli tarif edilemedi, referans pozu kullanılacak:",
            poseDescErr?.message,
          );
        }
      }

      // 👗🎬 ANLAMLANDIRMA PASI: ham analiz/profil notları final prompt'a
      // yapıştırılmadan önce Gemini tek akıcı brief'e sentezler (jewelry V7
      // ile aynı desen). Başarısızsa null kalır → builder ham blok fallback'ini
      // kullanır, üretim asla bozulmaz.
      let garmentStyleSynthesizedDirection = null;
      try {
        garmentStyleSynthesizedDirection =
          await synthesizeGarmentStyleDirection({
            styleReferenceUrl,
            technicalAnalysis: styleReferenceTechAnalysis,
            styleProfile: styleProfileMeta,
            settings: settings || {},
            stamped: styleReferenceStamped,
          });
        if (garmentStyleSynthesizedDirection) {
          logger.log(
            `👗🎬 [GARMENT STYLE SYNTH] Anlamlandırılmış yaratıcı brief hazır (${garmentStyleSynthesizedDirection.length} karakter) — ham analiz final prompt'a girmeyecek`,
          );
        }
      } catch (synthErr) {
        garmentStyleSynthesizedDirection = null;
        logger.warn(
          "👗🎬 [GARMENT STYLE SYNTH] Sentez başarısız — ham analiz blokları (eski yol) kullanılacak:",
          synthErr?.message,
        );
      }

      enhancedPrompt = buildStyleReferencePrompt({
        settings: settings || {},
        customDetail,
        hasModelReference: !!modelReferenceImage,
        isMultipleProducts,
        stamped: styleReferenceStamped,
        styleProfile: styleProfileMeta,
        technicalAnalysis: styleReferenceTechAnalysis,
        synthesizedDirection: garmentStyleSynthesizedDirection,
        // 🧍 Kullanıcı poz seçtiyse kullanıcının pozu referans/kolaj pozunu ezer
        hasUserPose: Boolean(
          poseImage ||
            (typeof settings?.pose === "string" && settings.pose.trim()),
        ),
        repeatPoseDirective: autoStyleRepeatPoseDirective,
      });
      backgroundRemovedImage = finalImage;
      logger.log(
        `🎬 [STYLE REFERENCE] Kompakt prompt kullanılıyor (${enhancedPrompt.length} karakter${garmentStyleSynthesizedDirection ? ", stil sentezi gömülü" : ", ham analiz fallback"}) — Gemini enhancement atlandı`,
      );
    } else if (!isPoseChange) {
      // 🖼️ NORMAL MODE - Arkaplan silme işlemi (paralel)
      // Gemini prompt üretimini paralelde başlat
      logger.log("🤖 [GEMINI CALL] enhancePromptWithGemini parametreleri:");
      logger.log("🤖 [GEMINI CALL] - finalImage URL:", finalImage);
      logger.log("🤖 [GEMINI CALL] - isMultipleProducts:", isMultipleProducts);
      logger.log(
        "🤖 [GEMINI CALL] - referenceImages sayısı:",
        referenceImages?.length || 0,
      );

      // EditScreen modunda editPrompt'u, normal modda promptText'i kullan
      const promptToUse =
        isEditMode && editPrompt && editPrompt.trim()
          ? editPrompt.trim()
          : promptText;

      logger.log(
        "📝 [GEMINI CALL] Kullanılacak prompt:",
        isEditMode ? "editPrompt" : "promptText",
      );
      logger.log("📝 [GEMINI CALL] Prompt içeriği:", promptToUse);

      const geminiPromise = enhancePromptWithGemini(
        promptToUse, // EditScreen'de editPrompt, normal modda promptText
        finalImage, // Ham orijinal resim (kombin modunda birleştirilmiş grid)
        settings || {},
        locationImage,
        poseImage,
        hairStyleImage,
        isMultipleProducts, // Kombin modunda true olmalı
        isColorChange, // Renk değiştirme işlemi mi?
        targetColor, // Hedef renk bilgisi
        isPoseChange, // Poz değiştirme işlemi mi?
        customDetail, // Özel detay bilgisi
        isEditMode, // EditScreen modu mu?
        editPrompt, // EditScreen'den gelen prompt
        isRefinerMode, // RefinerScreen modu mu?
        req.body.isBackSideAnalysis || false, // Arka taraf analizi modu mu?
        referenceImages, // Multi-product için tüm referans resimler
        isMultipleImages, // Çoklu resim modu mu?
        userId, // Compress için userId
        originalBase64ForGemini, // 🚀 Orijinal base64 - URL indirmesi atlanacak
        Array.isArray(kombinOriginalImages) ? kombinOriginalImages.length : 0, // 🛍️ Kombin içindeki tekil ürün sayısı
        isMultipleAnglesMode ? multipleAnglesCount : 0, // 📐 Aynı ürünün farklı açı sayısı
        modelReferenceImage
          ? modelReferenceImage.uri || modelReferenceImage.url || null
          : null, // 👤 Model seçiliyse yüz icat edilmez, kimlik korunur (görsel Gemini'ye de gider)
      );

      // ⏳ Sadece Gemini prompt iyileştirme bekle
      logger.log("⏳ Gemini prompt iyileştirme bekleniyor...");
      enhancedPrompt = await geminiPromise;
    }

    logger.log("✅ Gemini prompt iyileştirme tamamlandı");

    // 🎯 Focus area — Gemini rewrite edip kaldırmış olabileceği için enhancedPrompt'un
    // EN BAŞINA pazarlıksız olarak yeniden yerleştir. Gemini direktifi bazen başa
    // koymak yerine kendi cümlesinin İÇİNE de kopyalıyor ("adhering strictly to the
    // framing directive: ⚠️ ..."); startsWith kontrolü bunu görmüyordu ve final
    // prompt'ta aynı blok İKİ kez geçiyordu. Artık: gövdedeki TÜM kopyalar
    // temizlenir, sonra direktif başa bir kez konur.
    {
      const focusDir = buildFocusAreaDirective(settings?.focusArea);
      if (focusDir) {
        let body = enhancedPrompt || "";
        const beforeLen = body.length;
        // Gemini direktifi genellikle birebir kopyalıyor — tam metin eşleşmesiyle
        // tüm kopyaları sök (başındaki/ortadaki fark etmez).
        body = body.split(focusDir.trim()).join("").trimStart();
        // Kalıntı bağlaç temizliği: "adhering strictly to the framing directive: "
        // gibi direktife işaret eden yarım kalmış ifadeler sorun değil — model
        // baştaki gerçek direktifi görecek.
        if (body.length !== beforeLen) {
          logger.log(
            "🎯 [FOCUS AREA] Gövdeye gömülü direktif kopyaları temizlendi",
          );
        }
        enhancedPrompt = `${focusDir}

${body}`;
        logger.log(
          "🎯 [FOCUS AREA] enhancedPrompt'un başına sert direktif (tek kopya) yerleştirildi:",
          settings?.focusArea,
        );
      }
    }

    // 🧴💃 Natural skin + Fashion pose direktifleri artık STATIK prepend
    // edilmiyor. Gemini bunları enhancePromptWithGemini içinde "Opening
    // Directives" talimatıyla alıyor ve kıyafete / ortama / atmosfere göre
    // enhanced versiyonlarını ⚠️ başlık formatında prompt'un başına yazıyor.

    // 📸 Kombin originals varsa prompt'a ek direktif koy — grid ve tekiller birlikte.
    if (
      Array.isArray(kombinOriginalImages) &&
      kombinOriginalImages.length > 0
    ) {
      enhancedPrompt += `

KOMBIN REFERENCE IMAGES: In addition to the main combined grid image, ${kombinOriginalImages.length} individual product photo(s) are attached — each showing one garment separately. Use the grid image to understand how the outfit pieces should appear together on the model, and use the individual photos for faithful per-item detail reproduction (exact colors, prints, stitching, trims, proportions). Do NOT invent or alter any garment detail that is not visible in the individual photos.`;

      // 🏷️ Parça etiketleri varsa hücreleri isimlendir — model hangi hücrenin
      // hangi ürün olduğunu (ve hangi hücrelerin AYNI ürünün farklı açıları
      // olduğunu) sayım yerine açık etiketten öğrenir.
      if (Array.isArray(kombinPieces) && kombinPieces.length > 0) {
        const describe = (p) => {
          const attrs = [p.color, p.pattern && p.pattern !== "solid" ? p.pattern : null]
            .filter(Boolean)
            .join(" ");
          const noun = p.subtype || p.category || "item";
          return attrs ? `${attrs} ${noun}` : noun;
        };
        const lines = kombinPieces
          .filter((p) => Array.isArray(p?.cells) && p.cells.length > 0)
          .map((p) => {
            const cellsTxt = p.cells.map((c) => `Cell ${c}`).join(" & ");
            return p.cells.length > 1
              ? `${cellsTxt}: ${p.cells.length} different angles of the SAME ${describe(p)} — one single item, shown from multiple views.`
              : `${cellsTxt}: ${describe(p)}.`;
          });
        if (lines.length > 0) {
          enhancedPrompt += `

GRID CELL MAP (cells numbered left-to-right, top-to-bottom):
${lines.join("\n")}
The outfit consists of exactly ${lines.length} distinct item(s). Dress the model in ALL of them together; never duplicate an item that appears in multiple cells.`;
          logger.log(
            `🏷️ [KOMBİN PIECES] ${lines.length} parça etiketi enhancedPrompt'a eklendi`,
          );
        }
      }
      logger.log(
        `📸 [KOMBİN ORIG] enhancedPrompt'a ${kombinOriginalImages.length} tekil ürün direktifi eklendi`,
      );
    }

    if (isMultipleAnglesMode && multipleAnglesCount > 1) {
      const hasAngleOriginals =
        Array.isArray(angleOriginalImages) && angleOriginalImages.length > 0;
      enhancedPrompt += `

MULTIPLE-ANGLE PRODUCT REFERENCE: The main composite grid contains ${multipleAnglesCount} views of the same single product. Use all cells only to reconstruct that one product faithfully from every visible side.${hasAngleOriginals
        ? ` In addition to the grid, ${angleOriginalImages.length} full-resolution individual photo(s) of the same product are attached — use these for faithful fine-detail reproduction (exact colors, prints, stitching, trims, fabric texture, proportions). Do NOT invent or alter any product detail that is not visible in these photos.`
        : ""} The final photograph contains one instance of the product, never multiple garments, duplicates, or a collage.`;
      logger.log(
        `📐 [MULTIPLE ANGLES] ${multipleAnglesCount} açılık tek ürün direktifi enhancedPrompt'a eklendi${hasAngleOriginals ? ` (+${angleOriginalImages.length} orijinal foto direktifi)` : ""}`,
      );
    }

    // 📏 Size reference image varsa, Gemini ve fallback'ten bağımsız olarak
    // kalibrasyon direktifini enhancedPrompt'a ekle (handler scope'unda erişilebiliyor).
    if (
      sizeReferenceImage &&
      (sizeReferenceImage.base64 || sizeReferenceImage.uri)
    ) {
      enhancedPrompt += `

SIZE REFERENCE IMAGE: An additional size/scale reference image is attached alongside the main product photo(s). This reference shows the product placed onto a generic mannequin silhouette — use it PURELY to calibrate how the product should appear on the final model in terms of proportion, vertical coverage on the body, and relative scale (e.g. whether the garment ends at the waist, hip, knee, or ankle). Do NOT replicate the mannequin's shape, pose, background, lighting, or any styling details from this reference. Treat it strictly as a size/placement guide, not a visual style source.`;
      logger.log(
        "📏 [SIZE REFERENCE] Kalibrasyon direktifi enhancedPrompt'a eklendi",
      );
    }

    // 🎞️ EDITORIAL MODE — kullanıcı stil profili/referansı SEÇMEDİYSE ve mod açıksa,
    // dahili editorial kolajları prompt'un EN SONUNA teknik repertuar olarak eklenir.
    //
    // Neden en son: blok "daha önce yazılan her talimat önceliklidir" diyor. Kombin,
    // çoklu açı ve size-reference direktifleri de enhancedPrompt'a ekleniyor; bu blok
    // onlardan ÖNCE gelirse kendi öncelik kuralını tersine çevirir ve "son eklenen
    // görseller" işaretçisi kombin/size görselleriyle karışabilir.
    //
    // Stil profili modundan farkı: normal Gemini prompt'u KORUNUR, yani kullanıcının
    // mekân/poz/kadraj/model seçimleri aynen geçerli kalır; kolajlar yalnızca
    // fotoğrafik ustalık (ışık, lens, kompozisyon, grade, yönetmenlik) katar.
    editorialCollagesForRequest = [];
    if (
      editorialMode &&
      // Kullanıcı bir stil kaynağı SEÇTİYSE editorial devreye GİRMEZ.
      // Üç kontrol de gerekli:
      //   styleReferenceUrl → yükleme/kolaj başarıyla tamamlandıysa dolu
      //   styleReferenceImage → yükleme HATA verse bile kullanıcı seçim yapmıştı
      //   styleProfileId → profil yüklenemese bile kullanıcı profil seçmişti
      // Aksi halde kullanıcı kendi stilini seçmişken sessizce generic editorial'e düşerdi.
      !styleReferenceUrl &&
      !styleReferenceImage &&
      !styleProfileId &&
      !isColorChange &&
      !isPoseChange &&
      !isRefinerMode &&
      !isEditMode &&
      !req.body.isBackSideAnalysis &&
      isEditorialAvailable()
    ) {
      try {
        // app_config.editorial_mode_visible = false → özellik tamamen kapalı.
        // Eski istemciler editorialMode:true gönderse bile burada durur.
        const remotelyEnabled = await isEditorialEnabledRemotely();
        if (!remotelyEnabled) {
          logger.log("🎞️ [EDITORIAL] app_config ile kapalı — atlanıyor");
          throw new EditorialDisabled();
        }
        const collages = getEditorialCollages();
        // Varsayılan: kolaj GÖRSELLERİ eklenmez, yalnızca metin repertuarı gider.
        // Kolajlardaki kişiler sonuç yüzlerine sızabildiği için (bkz. editorialStyle.js).
        const withImages = shouldAttachCollages();
        editorialCollagesForRequest = withImages
          ? collages.map((c) => c.url)
          : [];
        const variation = pickVariationDirective();
        const editorialBlock = buildEditorialPromptBlock({
          collageCount: collages.length,
          analyses: collages.map((c) => c.analysis),
          codes: collages.map((c) => c.code),
          variation,
          withImages,
        });
        enhancedPrompt = `${enhancedPrompt || ""}\n\n${editorialBlock}`;
        logger.log(
          `🎞️ [EDITORIAL] repertuar prompt'un sonuna eklendi | görsel: ${withImages ? `${editorialCollagesForRequest.length} kolaj` : "YOK (metin-only)"} | varyasyon: ${variation.slice(0, 55)}...`,
        );
      } catch (editorialErr) {
        // Editorial mod asla üretimi bozmamalı — hata olursa normal akış sürer.
        editorialCollagesForRequest = [];
        if (!(editorialErr instanceof EditorialDisabled)) {
          logger.warn(
            "🎞️ [EDITORIAL] Blok eklenemedi, normal akışa devam ediliyor:",
            editorialErr?.message,
          );
        }
      }
    }

    // 🌟 SOFT otomatik stil bloğu — kombin/açı/size direktiflerinden SONRA eklenir
    // (editorial ile aynı sıralama gerekçesi: blok "önceki her talimat önceliklidir"
    // diyor). Kullanıcının mekân/poz/saç/hava seçimleri Gemini prompt'unda aynen
    // duruyor; stil yalnız ışık/grade/kamera/poz-enerjisi katmanı olarak biner.
    if (autoStyleMode === "soft" && autoStyleProfile) {
      try {
        const softUserHasPose = Boolean(
          poseImage ||
            (typeof settings?.pose === "string" && settings.pose.trim()),
        );
        // 📍 Kullanıcı AÇIKÇA mekân seçtiyse: sahne o mekândır, stil o mekânın
        // üzerine "treatment" olarak uygulanır — soft blok mekânı İSİMLE bağlar
        // (adlandırılan öğe sürüklenmez).
        const softUserHasLocation = Boolean(
          locationImage ||
            (typeof settings?.location === "string" &&
              settings.location.trim()) ||
            settings?.locationEnhancedPrompt ||
            settings?.locationId,
        );
        const softUserLocationLabel =
          typeof settings?.location === "string" && settings.location.trim()
            ? settings.location.trim().slice(0, 120)
            : null;
        const softBlock = buildAutoStyleSoftBlock({
          profileName: resolveProfileDisplayName(autoStyleProfile.name),
          stylePrompt: autoStyleProfile.style_prompt,
          imageCount: Array.isArray(autoStyleProfile.image_urls)
            ? Math.min(autoStyleProfile.image_urls.length, 3)
            : 1,
          withImage: Boolean(autoStyleGridUrl),
          userHasPose: softUserHasPose,
          userHasLocation: softUserHasLocation,
          userLocationLabel: softUserLocationLabel,
        });
        enhancedPrompt = `${enhancedPrompt || ""}\n\n${softBlock}`;
        logger.log(
          `🌟 [AUTO_STYLE] Soft stil bloğu prompt sonuna eklendi (${softBlock.length} karakter, görsel: ${autoStyleGridUrl ? "kolaj" : "YOK"})`,
        );
      } catch (softBlockErr) {
        // Otomatik stil asla üretimi bozmamalı — blok eklenemezse normal devam.
        logger.warn(
          "🌟 [AUTO_STYLE] Soft blok eklenemedi, normal akışa devam:",
          softBlockErr?.message,
        );
      }
    }

    // 🧍 Otomatik stil kullanılan HER üretimde (FULL + SOFT) poz-kıyafet uyumu
    // sert kurala bağlanır; tarz 4 (Sokak Stili) ayrıca kimlik güvenlik duvarı
    // alır (19 Ağu 2026, kullanıcı isteği — telif/benzerlik riski sıfırlanacak).
    //
    // 👜 Aksesuar kuralı 1 Eyl 2026'da "birebir ayna"dan İKİ GRUPLU mantığa
    // geçti (kullanıcı isteği). Eski kural referanstaki her aksesuarı aynen
    // taşıyordu; bu, referans kişinin kırmızı tişörtünün üstündeki kemeri
    // kullanıcının hiç kemer istemediği yeni kıyafete de zorla giydiriyordu.
    // Yeni ayrım: (A) kişiye ait taşınan parçalar (gözlük, çanta, şapka, takı,
    // saat) HER ZAMAN taşınır ama kullanıcının ürününün stil DNA'sına göre
    // YENİDEN TASARLANIR; (B) kıyafete bağlı stil parçaları (kemer, kuşak,
    // kravat, kıyafete sokulmuş atkı, üste katlanan zincir) yalnız kullanıcının
    // ürünü gerçekten gerektiriyorsa gelir — gelmemesi hata değil, doğru sonuç.
    // Envanter dışı aksesuar ekleme yasağı ise aynen duruyor.
    if (autoStyleProfile) {
      enhancedPrompt = `${enhancedPrompt || ""}

🧍 POSE ↔ GARMENT COMPATIBILITY (NON-NEGOTIABLE, OVERRIDES ANY POSE-COPY INSTRUCTION): The poses in the style reference are a STARTING POINT, never a template to copy verbatim. Before posing the model, check every pose element against the USER'S actual garment: hands go into pockets ONLY if this garment really has pockets; a thumb hooks a belt loop ONLY if belt loops exist; popping a collar, tugging a hood, playing with a zipper, cuff or drawstring happens ONLY if the garment has that feature; a pose that would crush, fold or hide the garment's defining silhouette or details is FORBIDDEN. Whenever a reference pose element conflicts with the garment's real construction, REPLACE it with a natural, equally confident alternative (hand relaxed at the side, resting on the hip, adjusting a sleeve that does exist) while keeping the same energy and attitude. Reproducing a reference pose that is physically impossible or unflattering for THIS garment is a hard failure.`;
      if (Number(autoStyleProfile.style_approach) === 4) {
        enhancedPrompt = `${enhancedPrompt}

🚫 STREET-STYLE IDENTITY FIREWALL (ABSOLUTE, HIGHEST PRIORITY): This generation uses a street-style reference photograph of a REAL person. That person's face and identity are legally OFF-LIMITS. The output person must be a COMPLETELY DIFFERENT human being: rebuild every identity-bearing feature from scratch — face shape, facial proportions, eye shape and color, brows, nose, lips, cheekbones, jawline, hairline, skin tone may all differ, and the overall "type" must read as a different person entirely. The output must fail any same-person, look-alike or celebrity-match comparison with the reference person. If the user supplied their own model reference elsewhere in this prompt, THAT user-provided identity is the only allowed face source; otherwise cast a brand-new, unrecognizable photoreal person. Copying, approximating or subtly echoing the reference person's face is a hard failure with legal consequences — when in doubt, make the person MORE different, never less.

👜 STREET-STYLE ACCESSORY LOGIC (OVERRIDES ANY "IGNORE REFERENCE ACCESSORIES" RULE FOR THIS GENERATION): FIRST inventory exactly which accessories are ACTUALLY VISIBLE on the reference person (bag, jewelry, sunglasses/glasses, hat, scarf, belt, watch, headphones...). NOTHING outside that inventory may ever appear: ADDING an accessory the reference person is not visibly wearing is a hard failure — if the reference shows no sunglasses, the output has NO sunglasses; no hat means NO hat; no jewelry means NO jewelry. Never "complete" or "enrich" the look with extra styling. THEN sort every inventoried piece into one of the two groups below and treat the groups DIFFERENTLY.

(A) BODY-WORN / CARRIED PIECES — sunglasses or glasses, hat or cap, handbag, shoulder bag, tote, backpack, watch, earrings, necklace, bracelet, rings, headphones. These belong to the PERSON, so they ALWAYS carry over. Keep the same KIND of piece and the same way it is worn or carried (a shoulder bag stays a shoulder bag on the same side; sunglasses held in the hand stay in the hand and are NOT moved onto the face). But do NOT copy the reference object literally: REDESIGN each piece so it belongs to the NEW outfit — re-choose its color, material, finish, hardware tone, scale and level of polish from the style DNA of the user's garment (its palette, fabric, formality and attitude), so the accessory reads as deliberately styled with THIS product instead of borrowed from another look. Same kind, same placement, new design.

(B) GARMENT-DEPENDENT STYLING PIECES — belt, waist chain, belt bag worn across the outfit, tie, bow tie, suspenders, brooch or pin fastened to the fabric, scarf tied or tucked into the clothing, chain layered over a top, any piece that cinches, fastens to or sits on the clothing. These belong to the REFERENCE'S OUTFIT, not to the person, so they are CONDITIONAL. They carry over ONLY IF the user's garment genuinely invites them: a belt appears only if this garment actually has belt loops or a waist meant to be cinched AND the belt improves it; a tucked or tied scarf appears only if this garment's neckline and layering really support it. If the user's garment does not call for the piece, OMIT IT — leaving it out is the CORRECT result and never counts as removing an accessory. When in doubt, OMIT. Never force a reference belt, chain, tie or scarf onto a garment that was not designed for it, and never cinch, fold, cover or interrupt the product's silhouette just to make a reference styling piece fit.

ACROSS BOTH GROUPS: if the user's own product is itself an accessory of a category present in the inventory (the user's product IS the bag, the glasses, the hat or the jewelry), the user's product REPLACES that reference piece entirely — never show two pieces of the same category. Render every carried-over piece as a similar generic item — never a brand-identical copy with visible logos — and never let any accessory cover, crowd or compete with the user's product's defining details; if a piece would obscure them, scale it down, reposition it slightly, or drop it.

${
  autoStyleMode === "soft"
    ? // 📍 Kullanıcı MEKÂN seçti (20 Ağu, kullanıcı isteği): kompozisyon
      // referanstan DONDURULUR, sahne kullanıcının mekânı olur ve o mekân
      // kesinlikle amatör telefon çekimi dilinde işlenir. Eski fidelity lock
      // burada kullanılamazdı — "aynı tür sokak sahnesi" derken kullanıcının
      // mekân seçimiyle kafa kafaya çatışıyordu.
      `🎬 STREET-STYLE COMPOSITION LOCK × USER'S LOCATION (ABSOLUTE, NON-NEGOTIABLE, OVERRIDES EVERY SCENE CUE FROM THE REFERENCE): The user explicitly selected a location, so this street-style shot is RE-STAGED at the user's location while the reference's photography stays frozen. Two hard rules apply simultaneously and neither may soften the other:
(1) COMPOSITION IS FROZEN — copy the reference photograph's camera angle, camera height, focal-length feel, framing and crop, the subject's placement and scale in frame, the motion state, the foreground/background layering and the overall composition EXACTLY. Do not reframe, do not move the camera, do not "improve" or re-balance the composition in any way.
(2) THE SCENE IS THE USER'S LOCATION — the environment, background, architecture, surfaces and atmosphere come ONLY from the user's chosen location described earlier in this prompt, fully present and recognizable. NOTHING of the reference's own street, buildings, walls, pavement, signage or scenery may appear, blend in or "leak" into the frame. Relocating back to the reference's scene, mixing the two places, or watering the user's location down into a generic street is a HARD FAILURE.
(3) THE LOCATION IS SHOT STREET-STYLE — the user's location must be rendered in the SAME raw, candid, amateur smartphone language as the reference: handheld phone-camera realism, the reference's exact color grade, flash or natural-light character, grain, contrast and every visible photographic imperfection. It must look like someone spontaneously took THIS phone photo of the model AT the user's location — NEVER like a polished editorial, studio or cinematic rendering of that place.
The final image must read as the SAME street-style photograph — same person-in-frame geometry, same camera, same grade — re-shot AT the user's chosen location.`
    : `🎬 STREET-STYLE FIDELITY LOCK (EVERYTHING ELSE STAYS): Beyond the two sanctioned changes (the person's identity and the main garment) and the sanctioned pose adaptations for the garment, EVERYTHING that defines this photograph is preserved faithfully from the reference: the same theme and concept, the same kind of street/urban scene with its structural elements and depth, the same camera angle, focal-length feel, framing and crop, the same motion state and overall composition, the same lighting direction and quality, the same color grade, contrast, film/filter character and every visible photographic effect (grain, flare, motion blur of the background, bokeh character). The output must read as the SAME street-style shot re-taken with a different person wearing the user's product — never as a new concept, a new location type, a new camera setup or a differently graded photograph.`
}`;
      }
      logger.log(
        `🧍 [AUTO_STYLE] Poz-kıyafet uyum direktifi eklendi${Number(autoStyleProfile.style_approach) === 4 ? ` + Sokak Stili kimlik duvarı + ${autoStyleMode === "soft" ? "kompozisyon×kullanıcı-mekânı kilidi" : "fidelity lock"}` : ""}`,
      );
    }

    // FULL modda buildStyleReferencePrompt içine eklenir. SOFT modda (ve FULL
    // stil referansı kurulamadıysa) final promptta bulunmasını burada garanti et.
    if (
      autoStyleRepeatPoseDirective &&
      !String(enhancedPrompt || "").includes(
        "REPEATED HIDDEN STYLE — MANDATORY FRESH POSE",
      )
    ) {
      enhancedPrompt = `${enhancedPrompt || ""}\n\n${autoStyleRepeatPoseDirective}`;
      logger.log(
        `🔁 [AUTO_STYLE] Tekrar stil poz çeşitlendirme emri final prompt'a eklendi (önceki kullanım: ${autoStylePriorUseCount})`,
      );
    }

    // 📷 ORTAK FOTOĞRAFİK GERÇEKÇİLİK TABANI
    // Gemini'nin çıktısı, stil-referansı gibi Gemini'yi atlayan dallar ve tüm
    // fallback promptları aynı noktada birleşir. Böylece hangi kalite modeli
    // seçilirse seçilsin fiziksel gerçekçilik talimatı final promptta bulunur.
    enhancedPrompt = appendUniversalPhotorealism(enhancedPrompt);
    logger.log(
      "📷 [PHOTOREALISM] Model/cilt/kumaş/ortam/ışık/kamera gerçekçiliği final prompt'a eklendi",
    );

    // Gizli stil görselindeki kişinin cinsiyeti casting'i sürüklemesin. Bu blok
    // stil + teknik analizden sonra, genel kullanıcı kilidinden hemen önce gelir.
    if (autoStyleGenderDirective) {
      enhancedPrompt = `${enhancedPrompt || ""}\n\n${autoStyleGenderDirective}`;
      logger.log(
        `⚥ [AUTO_STYLE] Kullanıcı cinsiyeti gizli stilin üstüne kilitlendi: ${settings?.gender}`,
      );
    }

    // 🔒 ADD DETAIL + ADVANCED SETTINGS SON KİLİT
    // Gemini bu alanları doğal brief'e dönüştürüyor; ancak uzun/yaratıcı prompt
    // içinde bazılarını yumuşatabiliyor. Görüntü modeline giden metnin EN SONUNDA
    // kullanıcı seçimlerini tekrar, kompakt ve doğrulanabilir şekilde sabitle.
    // Explicit Add Detail değişiklikleri yalnız adı geçen noktada genel ürün
    // koruma kuralına istisnadır; kıyafetin geri kalanı aynen korunur.
    let userInstructionLock = buildUserInstructionLock({
      settings: settings || {},
      customDetail,
      hasLocationReference: Boolean(locationImage),
      // 🧍 Stil modunda poz görseli isteğe EKLENMİYOR ve metne çevrilmiş
      // durumda (settings.pose) — "attached pose reference" satırı orada
      // yanlış hedef gösterirdi (model stil referansını poz sanabilir).
      hasPoseReference: Boolean(poseImage) && !styleReferenceUrl,
      hasHairReference: Boolean(hairStyleImage),
      // Stil kompozisyonu ek insan gerektirebilir. Kullanıcının model ayarları
      // yalnız ürünü giyen ana/hero kişiye uygulanmalı; yardımcı kişiyi silmemeli.
      primaryModelOnly: Boolean(styleReferenceUrl || autoStyleGridUrl),
    });
    if (userInstructionLock) {
      enhancedPrompt = appendUserInstructionLock(
        enhancedPrompt,
        userInstructionLock,
      );
      logger.log(
        `🔒 [USER INSTRUCTION LOCK] Final prompt'a eklendi (${userInstructionLock.length} karakter):`,
        userInstructionLock,
      );
    }

    // Arkaplan silme kaldırıldı - direkt olarak finalImage kullanılacak
    backgroundRemovedImage = finalImage;

    // 🎨 Yerel ControlNet Canny çıkarma işlemi - Arkaplan silindikten sonra
    // logger.log("🎨 Yerel ControlNet Canny çıkarılıyor (Sharp ile)...");
    let cannyImage = null;
    // try {
    //   cannyImage = await generateLocalControlNetCanny(
    //     backgroundRemovedImage,
    //     userId
    //   );
    //   logger.log("✅ Yerel ControlNet Canny tamamlandı:", cannyImage);
    // } catch (controlNetError) {
    //   console.error(
    //     "❌ Yerel ControlNet Canny hatası:",
    //     controlNetError.message
    //   );
    //   logger.log(
    //     "⚠️ Yerel ControlNet hatası nedeniyle sadece arkaplanı silinmiş resim kullanılacak"
    //   );
    //   cannyImage = null;
    // }

    // 👤 Portrait generation kaldırıldı - Gemini kendi kendine hallediyor

    // 🖼️ Çoklu resim modunda ayrı resimleri kullan, tek resim modunda arkaplan kaldırılmış resmi kullan
    let combinedImageForReplicate;

    if (isMultipleImages && referenceImages.length > 1) {
      // Çoklu resim modunda ayrı resimleri kullan (canvas birleştirme yok)
      combinedImageForReplicate = null; // Ayrı resimler kullanılacak
      logger.log(
        "🖼️ [BACKEND] Çoklu resim modu: Ayrı resimler Gemini'ye gönderilecek",
      );
    } else {
      // Tek resim modunda arkaplan kaldırılmış resmi kullan
      // Back side analysis durumunda canvas kullanmıyoruz
      if (!req.body.isBackSideAnalysis) {
        combinedImageForReplicate = backgroundRemovedImage;
        logger.log(
          "🖼️ [BACKEND] Tek resim modu: Arkaplan kaldırılmış resim Gemini'ye gönderiliyor",
        );
      } else {
        combinedImageForReplicate = null; // Back side'da kullanılmıyor
        logger.log(
          "🔄 [BACK_SIDE] Canvas bypass edildi, direkt URL'ler kullanılacak",
        );
      }
    }
    // if (cannyImage) {
    //   try {
    //     logger.log(
    //       "🎨 Orijinal ve Canny resimleri birleştiriliyor (Replicate için)..."
    //     );
    //     combinedImageForReplicate = await combineTwoImagesWithBlackLine(
    //       backgroundRemovedImage,
    //       cannyImage,
    //       userId
    //     );
    //     logger.log(
    //       "✅ İki resim birleştirme tamamlandı:",
    //       combinedImageForReplicate
    //     );
    //   } catch (combineError) {
    //     console.error("❌ Resim birleştirme hatası:", combineError.message);
    //     logger.log(
    //       "⚠️ Birleştirme hatası nedeniyle sadece arkaplanı silinmiş resim kullanılacak"
    //     );
    //     combinedImageForReplicate = backgroundRemovedImage;
    //   }
    // } else {
    //   logger.log(
    //     "⚠️ ControlNet Canny mevcut değil, sadece arkaplanı silinmiş resim kullanılacak"
    //   );
    // }

    logger.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    logger.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // 🔧 REFINER MODE: Use GPT Image 1.5 instead of nano-banana
    if (isRefinerMode) {
      logger.log("🔧 [REFINER MODE] GPT Image 1.5 API kullanılacak...");
      logger.log("🔧 [REFINER MODE] Final Image URL:", finalImage);

      try {
        // GPT Image 1.5 ile görsel oluştur
        const gptImageResult = await callFalAiGptImageEditForRefiner(
          enhancedPrompt,
          finalImage,
        );

        logger.log("✅ [REFINER MODE] GPT Image 1.5 başarılı:", gptImageResult);

        // Generation'ı completed olarak güncelle (result_image_url ile - updateGenerationStatus içinde Supabase'e kaydediliyor)
        await updateGenerationStatus(finalGenerationId, userId, "completed", {
          result_image_url: gptImageResult,
          enhanced_prompt: enhancedPrompt,
        });

        logger.log("✅ [REFINER MODE] Generation completed olarak güncellendi");

        // Response döndür (imageUrl eklendi - RefinerScreen için)
        return res.json({
          success: true,
          result: {
            imageUrl: gptImageResult, // RefinerScreen bu format'ı bekliyor
            output: [gptImageResult], // Diğer client'lar için
            prompt: enhancedPrompt,
            generationId: finalGenerationId,
            isRefinerMode: true,
            apiUsed: "gpt-image-1.5",
          },
        });
      } catch (refinerError) {
        console.error(
          "❌ [REFINER MODE] GPT Image 1.5 hatası:",
          refinerError.message,
        );

        // Generation'ı failed olarak güncelle
        await updateGenerationStatus(finalGenerationId, userId, "failed");

        // Kredi iade et
        if (creditDeducted && userId && userId !== "anonymous_user") {
          try {
            const { data: currentUserCredit } = await supabase
              .from("users")
              .select("credit_balance")
              .eq("id", userId)
              .single();

            await supabase
              .from("users")
              .update({
                credit_balance:
                  (currentUserCredit?.credit_balance || 0) +
                  actualCreditDeducted,
              })
              .eq("id", userId);

            logger.log(
              `💰 ${actualCreditDeducted} kredi iade edildi (Refiner mode hatası)`,
            );
          } catch (refundError) {
            console.error("❌ Kredi iade hatası:", refundError);
          }
        }

        return res.status(500).json({
          success: false,
          result: {
            message: "Refiner işlemi başarısız oldu",
            error: refinerError.message,
          },
        });
      }
    }

    // 📸 Kombin originals — tekil ürün resimlerini Supabase'e upload edip nano-banana
    // image_urls listesine grid resminin yanında ek referans olarak ekleyeceğiz.
    let kombinOriginalUrls = [];
    if (
      Array.isArray(kombinOriginalImages) &&
      kombinOriginalImages.length > 0
    ) {
      logger.log(
        `📸 [KOMBİN ORIG] ${kombinOriginalImages.length} tekil ürün nano-banana için upload ediliyor...`,
      );
      for (let i = 0; i < kombinOriginalImages.length; i++) {
        const orig = kombinOriginalImages[i];
        try {
          let origSource = null;
          if (orig?.base64) {
            const cleanB64 = String(orig.base64).replace(
              /^data:image\/\w+;base64,/,
              "",
            );
            origSource = `data:image/jpeg;base64,${cleanB64}`;
          } else if (orig?.uri && /^https?:\/\//i.test(orig.uri)) {
            origSource = orig.uri;
          }
          if (!origSource) continue;
          const origUrl = await uploadReferenceImageToSupabase(
            origSource,
            userId,
          );
          kombinOriginalUrls.push(origUrl);
          logger.log(
            `📸 [KOMBİN ORIG] Tekil ürün ${i + 1}/${kombinOriginalImages.length} upload OK:`,
            origUrl,
          );
        } catch (origUpErr) {
          logger.warn(
            `📸 [KOMBİN ORIG] Tekil ürün ${i + 1} upload hatası:`,
            origUpErr?.message,
          );
        }
      }
    }

    // 📐 Çoklu açı originals — grid ~1024px/hücreye sıkıştığı için ince detaylar
    // (dikiş, baskı, doku) kayboluyordu; orijinal açı fotoğrafları da upload
    // edilip modele grid'in yanında ek referans olarak verilir (kombin pattern'ı)
    let angleOriginalUrls = [];
    if (
      Array.isArray(angleOriginalImages) &&
      angleOriginalImages.length > 0
    ) {
      logger.log(
        `📐 [ANGLE ORIG] ${angleOriginalImages.length} orijinal açı fotoğrafı upload ediliyor...`,
      );
      for (let i = 0; i < angleOriginalImages.length; i++) {
        const orig = angleOriginalImages[i];
        try {
          let origSource = null;
          if (orig?.base64) {
            const cleanB64 = String(orig.base64).replace(
              /^data:image\/\w+;base64,/,
              "",
            );
            origSource = `data:image/jpeg;base64,${cleanB64}`;
          } else if (orig?.uri && /^https?:\/\//i.test(orig.uri)) {
            origSource = orig.uri;
          }
          if (!origSource) continue;
          const origUrl = await uploadReferenceImageToSupabase(
            origSource,
            userId,
          );
          angleOriginalUrls.push(origUrl);
          logger.log(
            `📐 [ANGLE ORIG] Açı ${i + 1}/${angleOriginalImages.length} upload OK:`,
            origUrl,
          );
        } catch (origUpErr) {
          logger.warn(
            `📐 [ANGLE ORIG] Açı ${i + 1} upload hatası:`,
            origUpErr?.message,
          );
        }
      }
    }

    // Varyasyon üretimi daha sonra (Results veya History'den) yeniden
    // başlatıldığında tekil ürün/açı fotoğrafları kaybolmasın. Pending kayıt
    // başlangıçta yalnız ana/grid referanslarını içeriyordu; NB için sonradan
    // upload edilen kalıcı URL'leri de aynı generation'a ekle.
    const completeReferenceImageUrls = Array.from(
      new Set(
        [
          ...(Array.isArray(referenceImageUrls) ? referenceImageUrls : []),
          ...kombinOriginalUrls,
          ...angleOriginalUrls,
        ].filter((url) => typeof url === "string" && /^https?:\/\//i.test(url)),
      ),
    );
    if (completeReferenceImageUrls.length > 0) {
      const { error: referencePersistError } = await supabase
        .from("reference_results")
        .update({ reference_images: completeReferenceImageUrls })
        .eq("generation_id", generationId)
        .eq("user_id", userId);
      if (referencePersistError) {
        logger.warn(
          `⚠️ [VARIATION_REFS] Kalıcı referans listesi yazılamadı (${generationId}):`,
          referencePersistError.message,
        );
      } else {
        logger.log(
          `✅ [VARIATION_REFS] ${completeReferenceImageUrls.length} kalıcı referans generation'a yazıldı`,
        );
      }
    }

    // 📏 Size reference image — nano-banana için beyaz arka plan üzerine composite edip
    // altına "SIZE REFERENCE" başlıklı şerit ekleyip Supabase'e upload edip public URL al
    let sizeReferenceUrl = null;
    if (
      sizeReferenceImage &&
      (sizeReferenceImage.base64 || sizeReferenceImage.uri)
    ) {
      try {
        // 1) Raw buffer'ı çıkar (base64 veya URL)
        let rawBuf;
        if (sizeReferenceImage.base64) {
          const cleanBase64 = sizeReferenceImage.base64.replace(
            /^data:image\/\w+;base64,/,
            "",
          );
          rawBuf = Buffer.from(cleanBase64, "base64");
        } else {
          const cleanSizeUrl = sanitizeImageUrl(
            sizeReferenceImage.uri.split("?")[0],
          );
          const sizeResp = await axios.get(cleanSizeUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
          });
          rawBuf = Buffer.from(sizeResp.data);
        }

        // 2) Şeffaf alanları beyaza flatten et
        const flattened = await sharp(rawBuf)
          .rotate() // EXIF
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .toBuffer();

        const meta = await sharp(flattened).metadata();
        const W = meta.width || 800;
        const H = meta.height || 1200;

        // 3) Alta şerit ekle (resim yüksekliğinin %10'u, min 90 max 160 px)
        const LABEL_H = Math.min(160, Math.max(90, Math.round(H * 0.1)));
        const extendedH = H + LABEL_H;

        const withStrip = await sharp(flattened)
          .extend({
            bottom: LABEL_H,
            background: { r: 255, g: 255, b: 255 },
          })
          .toBuffer();

        // 4) SVG metin overlay'i — responsive font (çok uzun olmayan İngilizce metin)
        const fontSize = Math.min(72, Math.max(36, Math.round(W / 16)));
        const labelText = "SIZE REFERENCE";
        const textY = H + Math.round(LABEL_H / 2) + Math.round(fontSize / 3);
        const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${extendedH}">
  <text x="${Math.round(W / 2)}" y="${textY}"
        text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        fill="#111827"
        letter-spacing="2">${labelText}</text>
</svg>
`);

        const composited = await sharp(withStrip)
          .composite([{ input: svg, blend: "over" }])
          .jpeg({ quality: 90 })
          .toBuffer();

        // 5) Supabase'e direkt yükle (uploadReferenceImageToSupabase file:// ret ediyor,
        //    composite buffer'ı doğrudan upload ediyoruz)
        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `temp_${timestamp}_size_reference_${userId || "anonymous"}_${randomId}.jpg`;

        const { data: upData, error: upErr } = await supabase.storage
          .from("reference")
          .upload(fileName, composited, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
          });

        if (upErr) {
          throw new Error(`Supabase upload error: ${upErr.message}`);
        }

        const { data: urlData } = supabase.storage
          .from("reference")
          .getPublicUrl(fileName);

        sizeReferenceUrl = urlData.publicUrl;
        logger.log(
          "📏 [SIZE REFERENCE] Composite (beyaz bg + başlık) upload OK:",
          sizeReferenceUrl,
        );
      } catch (sizeUploadErr) {
        logger.warn(
          "📏 [SIZE REFERENCE] Composite/upload hatası, nano-banana'ya eklenmiyor:",
          sizeUploadErr?.message,
        );
      }
    }

    // Fal.ai nano-banana modeli ile istek gönder (NORMAL MODE - non-refiner)
    let replicateResponse;
    const maxRetries = 3;
    let totalRetryAttempts = 0;
    let retryReasons = [];
    // 🛡️ 422 güvenlik ağı: normal denemeler (aynı prompt) tükendikten sonra
    // içerik filtresine takılmaya devam ediyorsa, yaş/ten ibareleri temizlenmiş
    // prompt'la BİR ekstra deneme yapılır (maxRetries + 1. tur).
    let sanitizedRetryUsed = false;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        logger.log(
          `🔄 Fal.ai nano-banana API attempt ${attempt}/${maxRetries}`,
        );

        logger.log("🚀 Fal.ai nano-banana API çağrısı yapılıyor...");

        // Fal.ai API için request body hazırla
        let imageInputArray;

        // Back side analysis: 2 ayrı resim gönder
        if (
          req.body.isBackSideAnalysis &&
          referenceImages &&
          referenceImages.length >= 2
        ) {
          logger.log(
            "🔄 [BACK_SIDE] 2 ayrı resim Nano Banana'ya gönderiliyor...",
          );
          imageInputArray = [
            referenceImages[0].uri || referenceImages[0], // Ön resim - direkt string
            referenceImages[1].uri || referenceImages[1], // Arka resim - direkt string
          ];
          logger.log("📤 [BACK_SIDE] Image input array:", imageInputArray);
        } else if (
          (isMultipleImages && referenceImages.length > 1) ||
          (modelReferenceImage &&
            (referenceImages.length > 0 || combinedImageForReplicate))
        ) {
          const totalRefs =
            referenceImages.length + (modelReferenceImage ? 1 : 0);
          logger.log(
            `🖼️ [MULTIPLE] ${totalRefs} adet referans resmi Nano Banana'ya gönderiliyor...`,
          );

          const sortedImages = [];

          if (modelReferenceImage) {
            sortedImages.push({
              ...modelReferenceImage,
              uri: sanitizeImageUrl(
                modelReferenceImage.uri || modelReferenceImage,
              ),
              type: modelReferenceImage.type || "model",
            });
          }

          if (isMultipleImages && referenceImages.length > 1) {
            const normalizedProducts = referenceImages.map((img) => ({
              ...img,
              uri: sanitizeImageUrl(img.uri || img),
              type: img?.type || "product",
            }));
            sortedImages.push(...normalizedProducts);
          } else if (referenceImages.length > 0 || combinedImageForReplicate) {
            const productSource =
              typeof combinedImageForReplicate === "string" &&
              combinedImageForReplicate
                ? combinedImageForReplicate
                : referenceImages[0]?.uri || referenceImages[0];

            if (productSource) {
              sortedImages.push({
                uri: sanitizeImageUrl(productSource),
                type: "product",
                isModelReference: false,
              });
            }
          }

          imageInputArray = sortedImages.map((img) => img.uri || img);
          logger.log(
            "📤 [MULTIPLE] Sıralı image input array:",
            sortedImages.map((img, idx) => `${idx + 1}. ${img.type}`),
          );
          logger.log("📤 [MULTIPLE] Image URLs:", imageInputArray);
        } else {
          // Tek resim modu: Birleştirilmiş tek resim
          imageInputArray = [combinedImageForReplicate];
        }

        // 📸 Kombin originals — tekil ürün URL'lerini grid resminin yanına ek referans olarak ekle
        if (kombinOriginalUrls && kombinOriginalUrls.length > 0) {
          imageInputArray = [...(imageInputArray || []), ...kombinOriginalUrls];
          logger.log(
            `📸 [KOMBİN ORIG] ${kombinOriginalUrls.length} tekil ürün imageInputArray'e eklendi, toplam:`,
            imageInputArray.length,
          );
        }

        // 📐 Çoklu açı originals — orijinal açı fotoğraflarını grid'in yanına ek referans olarak ekle
        if (angleOriginalUrls && angleOriginalUrls.length > 0) {
          imageInputArray = [...(imageInputArray || []), ...angleOriginalUrls];
          logger.log(
            `📐 [ANGLE ORIG] ${angleOriginalUrls.length} orijinal açı fotoğrafı imageInputArray'e eklendi, toplam:`,
            imageInputArray.length,
          );
        }

        // 📏 Size reference image'ı nano-banana'nın image_urls listesine ek referans olarak koy
        if (sizeReferenceUrl) {
          imageInputArray = [...(imageInputArray || []), sizeReferenceUrl];
          logger.log(
            "📏 [SIZE REFERENCE] imageInputArray'e eklendi, toplam:",
            imageInputArray.length,
          );
        }

        // 💇 Kullanıcının saç referansı FULL modu bozmaz. Modelin bu seçimi
        // gerçekten görebilmesi için stil görselinden önce ayrıca eklenir;
        // böylece style reference yine prompt'ta tarif edildiği gibi SON görseldir.
        if (hairStyleImage) {
          const hairReferenceUrl = sanitizeImageUrl(
            String(hairStyleImage).split("?")[0],
          );
          if (/^https?:\/\//i.test(hairReferenceUrl)) {
            imageInputArray = [...(imageInputArray || []), hairReferenceUrl];
            logger.log(
              "💇 [HAIR REFERENCE] imageInputArray'e stil referansından önce eklendi, toplam:",
              imageInputArray.length,
            );
          }
        }

        // 🎬 Style reference image — prompt "LAST attached image" dediği için HER ZAMAN en sona
        if (styleReferenceUrl) {
          imageInputArray = [...(imageInputArray || []), styleReferenceUrl];
          logger.log(
            "🎬 [STYLE REFERENCE] imageInputArray'e SON sıraya eklendi, toplam:",
            imageInputArray.length,
          );
        }

        // 🌟 Soft otomatik stil kolajı — prompt "LAST attached image" dediği için en sona.
        // styleReferenceUrl ile aynı anda dolu olamaz (otomatik stil yalnız stil
        // kaynağı seçilmediğinde devreye girer).
        if (autoStyleGridUrl) {
          imageInputArray = [...(imageInputArray || []), autoStyleGridUrl];
          logger.log(
            "🌟 [AUTO_STYLE] Soft kolaj imageInputArray'e SON sıraya eklendi, toplam:",
            imageInputArray.length,
          );
        }

        // 🎞️ Editorial kolajları — prompt "LAST N attached images" dediği için en sona.
        // Not: editorial mod yalnızca styleReferenceUrl yokken devreye girdiği için
        // bu iki blok aynı anda çalışmaz.
        if (editorialCollagesForRequest.length > 0) {
          imageInputArray = [
            ...(imageInputArray || []),
            ...editorialCollagesForRequest,
          ];
          logger.log(
            `🎞️ [EDITORIAL] ${editorialCollagesForRequest.length} kolaj imageInputArray sonuna eklendi, toplam: ${imageInputArray.length}`,
          );
        }

        // Kalite versiyonu kontrolü (settings'ten al)
        const qualityVersion = isRefinerMode
          ? "v1"
          : settings?.qualityVersion || settings?.quality_version || "v1";
        const isV2 = qualityVersion === "v2";
        // Model seçimi:
        //   v1 (default)    → openai/gpt-image-2/edit (aşağıdaki branch'te handle edilir)
        //   v2 veya backSide → fal-ai/nano-banana-pro/edit
        const falModel = "fal-ai/nano-banana-pro/edit"; // v2/backSide için

        logger.log(
          `🎨 [QUALITY_VERSION] Seçilen versiyon: ${qualityVersion}, Model (v2/backSide fallback): ${falModel}`,
        );

        let requestBody;
        const aspectRatioForRequest = formattedRatio || "9:16";

        logger.log(
          `📋 [FAL_PROMPT] Fal.ai'ya giden prompt (${enhancedPrompt.length} karakter):`,
          enhancedPrompt,
        );

        // 🎨 Model dallanması:
        //   backSide analysis   → HER ZAMAN GPT Image 2 (v1 + v2, is_gpt bayrağından bağımsız)
        //   v1 (non-backside)   → app_config.is_gpt: true → GPT Image 2, false → nano-banana-2
        //   v2 (non-backside)   → aşağıdaki nano-banana-pro akışı devam eder.
        if (req.body.isBackSideAnalysis || !isV2) {
          const useGpt = req.body.isBackSideAnalysis
            ? true
            : await isGptEnabledForV1();
          logger.log(
            req.body.isBackSideAnalysis
              ? `⚙️ [MODEL_SWITCH] backSideAnalysis → GPT Image 2 (zorunlu)`
              : `⚙️ [V1 MODEL_SWITCH] app_config.is_gpt = ${useGpt} → ${useGpt ? "GPT Image 2" : "nano-banana-2"}`,
          );

          if (useGpt) {
            // ── GPT Image 2 yolu ──
            const gptImageSize = mapRatioToGptImage2Size(aspectRatioForRequest);

            logger.log(
              `🛡️ [V1 GPT2] Input aspect kontrolü başlıyor (${imageInputArray?.length || 0} resim)...`,
            );
            const sanitizedImageUrls = await ensureMaxAspectRatio3to1ForInput(
              imageInputArray,
              userId,
            );

            logger.log(
              `🎨 [V1 GPT2] Ratio: ${aspectRatioForRequest} → image_size: ${gptImageSize}, images: ${sanitizedImageUrls?.length || 0}`,
            );

            const gptResultUrl = await callFalAiGptImage2Edit(
              enhancedPrompt,
              sanitizedImageUrls,
              gptImageSize,
            );

            replicateResponse = {
              data: {
                id: `gpt2-${uuidv4()}`,
                status: "succeeded",
                output: [gptResultUrl],
                urls: { get: null },
              },
            };

            logger.log(
              `✅ [V1 GPT2] Başarılı, retry loop'tan çıkılıyor (attempt ${attempt})`,
            );
            break;
          } else {
            // ── nano-banana-2 yolu ──
            const nanoModel = "fal-ai/nano-banana-2/edit";
            // 🧠 Render öncesi muhakeme — app_config.nb2_thinking_level ile yönetilir
            const nb2ThinkingLevel = await getNb2ThinkingLevel();
            const nanoRequestBody = {
              prompt: enhancedPrompt,
              image_urls: imageInputArray,
              output_format: "png",
              aspect_ratio: aspectRatioForRequest,
              num_images: 1,
              resolution: "2K",
              safety_tolerance: safetyTolerance,
              enable_web_search: true,
              ...(nb2ThinkingLevel !== "off"
                ? { thinking_level: nb2ThinkingLevel }
                : {}),
            };
            logger.log(
              `🍌 [V1 NB2] fal.run/${nanoModel} çağrılıyor — images: ${imageInputArray?.length || 0}, aspect: ${aspectRatioForRequest}, thinking: ${nb2ThinkingLevel}`,
            );

            const nanoResponse = await axios.post(
              `https://fal.run/${nanoModel}`,
              nanoRequestBody,
              {
                headers: {
                  Authorization: `Key ${process.env.FAL_API_KEY}`,
                  "Content-Type": "application/json",
                },
                timeout: 300000,
              },
            );

            if (nanoResponse.data?.images?.length > 0) {
              // 🔎 Web search açık — modelin kendi anlatımı (description) arama
              // kullanımına dair tek görünür sinyal; fal groundingMetadata vermez.
              if (nanoResponse.data?.description) {
                logger.log(
                  "🔎 [V1 NB2] Model description:",
                  String(nanoResponse.data.description).substring(0, 500),
                );
              }
              const outputUrls = nanoResponse.data.images.map((img) => img.url);
              replicateResponse = {
                data: {
                  id: nanoResponse.data.request_id || `nb2-${uuidv4()}`,
                  status: "succeeded",
                  output: outputUrls,
                  urls: { get: null },
                },
              };
              logger.log(
                `✅ [V1 NB2] Başarılı, retry loop'tan çıkılıyor (attempt ${attempt})`,
              );
              break;
            }

            // Nano-banana-2 başarısız → throw et, retry loop kendi denesin
            const errMsg =
              nanoResponse.data?.detail ||
              nanoResponse.data?.error ||
              "nano-banana-2 returned no images";
            throw new Error(`nano-banana-2 failed: ${errMsg}`);
          }
        }

        // Back side analysis veya v2 modunda quality "2K" olarak ayarla (nano-banana-pro için)
        const qualityParam =
          isV2 || req.body.isBackSideAnalysis ? "2K" : undefined;

        const promptForNanoBananaPro = enhancedPrompt;

        if (isPoseChange) {
          // POSE CHANGE MODE - Farklı input parametreleri
          requestBody = {
            prompt: promptForNanoBananaPro,
            image_urls: imageInputArray,
            output_format: "png",
            aspect_ratio: aspectRatioForRequest,
            num_images: 1,
            resolution: "2K",
            enable_web_search: true,
            ...(qualityParam && { quality: qualityParam }), // nano-banana-pro için quality parametresi
            ...(isV2 || req.body.isBackSideAnalysis
              ? { safety_tolerance: safetyTolerance }
              : {}),
          };
          logger.log(
            `🕺 [POSE_CHANGE] fal.ai ${falModel} request body hazırlandı`,
          );
          logger.log(
            "🕺 [POSE_CHANGE] Prompt:",
            promptForNanoBananaPro.substring(0, 200) + "...",
          );
        } else {
          // NORMAL MODE
          requestBody = {
            prompt: promptForNanoBananaPro,
            image_urls: imageInputArray,
            output_format: "png",
            aspect_ratio: aspectRatioForRequest,
            num_images: 1,
            resolution: "2K",
            enable_web_search: true,
            ...(qualityParam && { quality: qualityParam }), // nano-banana-pro için quality parametresi
            ...(isV2 || req.body.isBackSideAnalysis
              ? { safety_tolerance: safetyTolerance }
              : {}),
          };
        }

        logger.log("📋 Fal.ai Request Body:", {
          prompt: enhancedPrompt.substring(0, 100) + "...",
          imageInput: req.body.isBackSideAnalysis
            ? "2 separate images"
            : isMultipleImages && referenceImages.length > 1
              ? `${referenceImages.length} separate images`
              : "single combined image",
          imageInputArray: imageInputArray,
          outputFormat: "png",
          aspectRatio: aspectRatioForRequest,
        });

        // Fal.ai API çağrısı
        const response = await axios.post(
          `https://fal.run/${falModel}`,
          requestBody,
          {
            headers: {
              Authorization: `Key ${process.env.FAL_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 300000, // 5 dakika timeout
          },
        );

        logger.log("📋 Fal.ai API Response Status:", response.status);
        logger.log("📋 Fal.ai API Response Data:", {
          request_id: response.data.request_id,
          hasImages: !!response.data.images,
          imagesCount: response.data.images?.length || 0,
        });

        // Fal.ai Response kontrolü - fal.ai returns images array directly
        if (response.data.images && response.data.images.length > 0) {
          logger.log(
            "✅ Fal.ai API başarılı, images alındı:",
            response.data.images.map((img) => img.url),
          );
          // 🔎 Web search açık — modelin kendi anlatımı (description) arama
          // kullanımına dair tek görünür sinyal; fal groundingMetadata vermez.
          if (response.data.description) {
            logger.log(
              "🔎 [NB] Model description:",
              String(response.data.description).substring(0, 500),
            );
          }

          // Fal.ai response'u Replicate formatına dönüştür (mevcut kod ile uyumluluk için)
          const outputUrls = response.data.images.map((img) => img.url);
          replicateResponse = {
            data: {
              id: response.data.request_id || `fal-${uuidv4()}`,
              status: "succeeded",
              output: outputUrls,
              urls: {
                get: null,
              },
            },
          };

          logger.log(`✅ Fal.ai nano-banana API başarılı (attempt ${attempt})`);
          break; // Başarılı olursa loop'tan çık
        } else if (response.data.detail || response.data.error) {
          // Fal.ai error response
          const errorMsg = response.data.detail || response.data.error;
          console.error("❌ Fal.ai API failed:", errorMsg);

          // Geçici hatalar için retry yap
          if (
            typeof errorMsg === "string" &&
            (errorMsg.includes("temporarily unavailable") ||
              errorMsg.includes("try again later") ||
              errorMsg.includes("rate limit") ||
              errorMsg.includes("timeout"))
          ) {
            logger.log(
              `🔄 Geçici fal.ai hatası tespit edildi (attempt ${attempt}), retry yapılacak:`,
              errorMsg,
            );
            retryReasons.push(`Attempt ${attempt}: ${errorMsg}`);
            throw new Error(`RETRYABLE_SERVICE_ERROR: ${errorMsg}`);
          }

          throw new Error(`Fal.ai API failed: ${errorMsg || "Unknown error"}`);
        } else {
          // No images returned - unexpected
          console.error(
            "❌ Fal.ai API unexpected response - no images:",
            response.data,
          );
          throw new Error(`Fal.ai API returned no images`);
        }
      } catch (apiError) {
        console.error(
          `❌ Fal.ai nano-banana API attempt ${attempt} failed:`,
          apiError.message,
        );

        // 120 saniye timeout hatası ise direkt failed yap ve retry yapma
        if (
          apiError.message.includes("timeout") ||
          apiError.code === "ETIMEDOUT" ||
          apiError.code === "ECONNABORTED"
        ) {
          console.error(
            `❌ 120 saniye timeout hatası, generation failed yapılıyor: ${apiError.message}`,
          );

          // Generation status'unu direkt failed yap
          await updateGenerationStatus(finalGenerationId, userId, "failed", {
            processing_time_seconds: 120,
          });

          throw apiError; // Timeout hatası için retry yok
        }

        // Son deneme değilse ve network hataları, geçici hatalar veya içerik
        // filtresi (422) ise AYNI prompt'la tekrar dene — 422 bazen aynı
        // prompt'un sonraki denemesinde geçebiliyor (filtre deterministik değil)
        if (
          attempt < maxRetries &&
          (apiError.code === "ECONNRESET" ||
            apiError.code === "ENOTFOUND" ||
            apiError.response?.status >= 500 ||
            apiError.message.includes("RETRYABLE_SERVICE_ERROR") ||
            isContentFilter422(apiError))
        ) {
          totalRetryAttempts++;
          if (isContentFilter422(apiError)) {
            retryReasons.push(`422 content filter (attempt ${attempt})`);
          }
          const waitTime = attempt * 2000; // 2s, 4s, 6s bekle
          logger.log(
            `⏳ ${waitTime}ms bekleniyor, sonra tekrar denenecek... (${attempt}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        // 🛡️ SON ŞANS — normal denemeler tükendi ama hata hâlâ 422 (içerik
        // filtresi): prompt'tan yaş ibareleri + ten tasvirli cümleler ayıklanıp
        // BİR kez daha denenir. Canlı örnek: "17 years old ... bare shoulders
        // and back" kombinasyonu filtreye takılıp üretimi tamamen düşürüyordu.
        if (isContentFilter422(apiError) && !sanitizedRetryUsed) {
          sanitizedRetryUsed = true;
          totalRetryAttempts++;
          retryReasons.push("422 content filter → sanitized prompt (final)");
          const before = enhancedPrompt.length;
          enhancedPrompt = sanitizePromptForContentFilter(enhancedPrompt);
          userInstructionLock = sanitizePromptForContentFilter(
            userInstructionLock,
          );
          logger.log(
            `🛡️ [422 SAFETY NET] İçerik filtresi ${maxRetries} denemede geçilemedi — prompt temizlendi (${before} → ${enhancedPrompt.length} karakter), son bir deneme yapılıyor`,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // Retry yapılamayan hatalar için log
        console.error(
          `❌ Retry yapılamayan hata türü (attempt ${attempt}/${maxRetries}):`,
          {
            code: apiError.code,
            message: apiError.message?.substring(0, 100),
            status: apiError.response?.status,
          },
        );

        // Son deneme veya farklı hata türü ise fırlat
        throw apiError;
      }
    }

    const initialResult = replicateResponse.data;
    logger.log("Fal.ai API başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error("Replicate prediction ID alınamadı:", initialResult);

      // 🗑️ Prediction ID hatası durumunda geçici dosyaları temizle
      logger.log(
        "🧹 Prediction ID hatası sonrası geçici dosyalar temizleniyor...",
      );
      await cleanupTemporaryFiles(temporaryFiles);

      // Kredi iade et
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
            })
            .eq("id", userId);

          logger.log(
            `💰 ${actualCreditDeducted} kredi iade edildi (Prediction ID hatası)`,
          );
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "Replicate prediction başlatılamadı",
          error: initialResult.error || "Prediction ID missing",
        },
      });
    }

    // Fal.ai nano-banana API - Status kontrolü (fal.ai genellikle sonucu direkt döner)
    const startTime = Date.now();
    let finalResult;
    let processingTime;
    const maxPollingRetries = 3; // Fallback retry

    // Status kontrolü
    if (initialResult.status === "succeeded") {
      // Direkt başarılı sonuç
      logger.log("🎯 Fal.ai nano-banana - başarılı sonuç, polling atlanıyor");
      finalResult = initialResult;
      processingTime = Math.round((Date.now() - startTime) / 1000);
    } else if (
      initialResult.status === "processing" ||
      initialResult.status === "starting"
    ) {
      // Processing durumunda polling yap (fal.ai için genellikle gerekmez)
      logger.log(
        "⏳ Fal.ai nano-banana - processing status, polling başlatılıyor",
      );

      try {
        finalResult = await pollReplicateResultWithRetry(
          initialResult.id,
          maxPollingRetries,
        );
        processingTime = Math.round((Date.now() - startTime) / 1000);
      } catch (pollingError) {
        console.error("❌ Polling hatası:", pollingError.message);

        // Polling hatası durumunda status'u failed'e güncelle
        await updateGenerationStatus(finalGenerationId, userId, "failed", {
          processing_time_seconds: Math.round((Date.now() - startTime) / 1000),
        });

        // 🗑️ Polling hatası durumunda geçici dosyaları temizle
        logger.log("🧹 Polling hatası sonrası geçici dosyalar temizleniyor...");
        await cleanupTemporaryFiles(temporaryFiles);

        // Error response'a generationId ekle ki client hangi generation'ın başarısız olduğunu bilsin
        return res.status(500).json({
          success: false,
          result: {
            message: "Görsel işleme işlemi başarısız oldu",
            error: pollingError.message.includes("PREDICTION_INTERRUPTED")
              ? "Sunucu kesintisi oluştu. Lütfen tekrar deneyin."
              : "İşlem sırasında teknik bir sorun oluştu. Lütfen tekrar deneyin.",
            generationId: finalGenerationId, // Client için generation ID ekle
            status: "failed",
          },
        });
      }
    } else {
      // Diğer durumlar (failed, vs) - retry mekanizmasıyla
      logger.log(
        "🎯 Fal.ai nano-banana - failed status, retry mekanizması başlatılıyor",
      );

      // Failed status için retry logic
      let retrySuccessful = false;
      for (
        let retryAttempt = 1;
        retryAttempt <= maxPollingRetries;
        retryAttempt++
      ) {
        logger.log(
          `🔄 Failed status retry attempt ${retryAttempt}/${maxPollingRetries}`,
        );

        try {
          // 2 saniye bekle, sonra yeni prediction başlat
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * retryAttempt),
          );

          // Aynı parametrelerle yeni prediction oluştur
          let retryImageInputArray;

          // Back side analysis: 2 ayrı resim gönder
          if (
            req.body.isBackSideAnalysis &&
            referenceImages &&
            referenceImages.length >= 2
          ) {
            logger.log(
              "🔄 [RETRY BACK_SIDE] 2 ayrı resim Nano Banana'ya gönderiliyor...",
            );
            retryImageInputArray = [
              referenceImages[0].uri || referenceImages[0], // Ön resim - direkt string
              referenceImages[1].uri || referenceImages[1], // Arka resim - direkt string
            ];
          } else if (
            (isMultipleImages && referenceImages.length > 1) ||
            (modelReferenceImage &&
              (referenceImages.length > 0 || combinedImageForReplicate))
          ) {
            const totalRefs =
              referenceImages.length + (modelReferenceImage ? 1 : 0);
            logger.log(
              `🔄 [RETRY MULTIPLE] ${totalRefs} ayrı resim Nano Banana'ya gönderiliyor...`,
            );

            const sortedImages = [];

            if (modelReferenceImage) {
              sortedImages.push(
                sanitizeImageUrl(
                  modelReferenceImage.uri || modelReferenceImage,
                ),
              );
            }

            if (isMultipleImages && referenceImages.length > 1) {
              referenceImages.forEach((img) =>
                sortedImages.push(sanitizeImageUrl(img.uri || img)),
              );
            } else {
              const productSource =
                typeof combinedImageForReplicate === "string" &&
                combinedImageForReplicate
                  ? combinedImageForReplicate
                  : referenceImages[0]?.uri || referenceImages[0];

              if (productSource) {
                sortedImages.push(sanitizeImageUrl(productSource));
              }
            }

            retryImageInputArray = sortedImages;
          } else {
            // Tek resim modu: Birleştirilmiş tek resim
            retryImageInputArray = [combinedImageForReplicate];
          }

          // 💇 Saç referansı retry'da da korunur ve stil görselinden önce kalır.
          if (hairStyleImage) {
            const retryHairReferenceUrl = sanitizeImageUrl(
              String(hairStyleImage).split("?")[0],
            );
            if (/^https?:\/\//i.test(retryHairReferenceUrl)) {
              retryImageInputArray = [
                ...retryImageInputArray,
                retryHairReferenceUrl,
              ];
            }
          }

          // 🎬 Style reference — retry'da da prompt "LAST attached image" dediği için en sona ekle
          if (styleReferenceUrl) {
            retryImageInputArray = [...retryImageInputArray, styleReferenceUrl];
          }

          // 🌟 Soft otomatik stil kolajı — retry'da da en sona
          if (autoStyleGridUrl) {
            retryImageInputArray = [...retryImageInputArray, autoStyleGridUrl];
          }

          const retryRequestBody = {
            prompt: enhancedPrompt,
            image_urls: retryImageInputArray,
            output_format: "png",
            aspect_ratio: formattedRatio || "9:16",
            num_images: 1,
            resolution: "2K",
            enable_web_search: true,
            ...(isV2 || req.body.isBackSideAnalysis
              ? { safety_tolerance: safetyTolerance }
              : {}),
          };

          logger.log(
            `🔄 Retry ${retryAttempt}: Yeni prediction oluşturuluyor... (Model: ${falModel})`,
          );

          const retryResponse = await axios.post(
            `https://fal.run/${falModel}`,
            retryRequestBody,
            {
              headers: {
                Authorization: `Key ${process.env.FAL_API_KEY}`,
                "Content-Type": "application/json",
              },
              timeout: 300000,
            },
          );

          logger.log(`🔄 Retry ${retryAttempt} Response:`, {
            request_id: retryResponse.data.request_id,
            hasImages: !!retryResponse.data.images,
            imagesCount: retryResponse.data.images?.length || 0,
          });

          // Retry response kontrolü - fal.ai returns images array directly
          if (
            retryResponse.data.images &&
            retryResponse.data.images.length > 0
          ) {
            if (retryResponse.data.description) {
              logger.log(
                "🔎 [NB-RETRY] Model description:",
                String(retryResponse.data.description).substring(0, 500),
              );
            }
            const outputUrls = retryResponse.data.images.map((img) => img.url);
            logger.log(
              `✅ Retry ${retryAttempt} başarılı! Images alındı:`,
              outputUrls,
            );
            // Fal.ai response'u mevcut format ile uyumlu hale getir
            finalResult = {
              id: retryResponse.data.request_id || `fal-retry-${uuidv4()}`,
              status: "succeeded",
              output: outputUrls,
            };
            retrySuccessful = true;
            break;
          } else if (retryResponse.data.detail || retryResponse.data.error) {
            console.error(
              `❌ Retry ${retryAttempt} başarısız:`,
              retryResponse.data.detail || retryResponse.data.error,
            );
            // Bu retry attempt başarısız, bir sonraki deneme yapılacak
          } else {
            console.error(
              `❌ Retry ${retryAttempt} başarısız - no images returned`,
            );
            // Bu retry attempt başarısız, bir sonraki deneme yapılacak
          }
        } catch (retryError) {
          console.error(
            `❌ Retry ${retryAttempt} exception:`,
            retryError.message,
          );
          // Bu retry attempt başarısız, bir sonraki deneme yapılacak
        }
      }

      if (!retrySuccessful) {
        console.error(
          `❌ Tüm retry attemptları başarısız oldu. Orijinal failed result kullanılıyor.`,
        );
        finalResult = initialResult;
      }

      processingTime = Math.round((Date.now() - startTime) / 1000);
    }

    logger.log("Fal.ai final result:", finalResult);

    // Flux-kontext-dev API'den gelen sonuç farklı format olabilir (Prefer: wait nedeniyle)
    const isFluxKontextDevResult =
      finalResult && !finalResult.status && finalResult.output;
    const isStandardResult =
      finalResult.status === "succeeded" && finalResult.output;

    // Dev API'ye fallback yapıldıktan sonra başarılı sonuç kontrolü
    if (isFluxKontextDevResult || isStandardResult) {
      logger.log("Replicate API işlemi başarılı");

      // 📊 Retry istatistiklerini logla
      if (totalRetryAttempts > 0) {
        logger.log(
          `📊 Retry İstatistikleri: ${totalRetryAttempts} retry yapıldı`,
        );
        logger.log(`📊 Retry Nedenleri: ${retryReasons.join(" | ")}`);
      } else {
        logger.log("📊 Retry İstatistikleri: İlk denemede başarılı");
      }

      // ✅ Status'u completed'e güncelle
      // fal.ai returns output as array, always use the first image
      let resultImageUrl = Array.isArray(finalResult.output)
        ? finalResult.output[0]
        : finalResult.output;

      // 🎬 Stil referansı / 🎞️ editorial / 🌟 otomatik soft stil modunda: sonuca
      // sızmış olabilecek kod plakasını tespit et/kırp. Akışların hepsi aynı plaka
      // formatını kullanıyor (koyu bant + ortalanmış beyaz yazı) ve tespit o yazı
      // imzasını arıyor.
      if (
        (styleReferenceUrl ||
          autoStyleGridUrl ||
          editorialCollagesForRequest.length > 0) &&
        resultImageUrl
      ) {
        resultImageUrl = await stripLeakedStylePlate(resultImageUrl, userId);
      }

      // 🔍 NETLEŞTİRME ADIMI — kullanıcı Results'ta 4 MP'den yüksek bir kademe
      // seçtiyse sonuç, kaydedilmeden önce o çözünürlüğe yükseltilir. Hata
      // durumunda orijinal sonuçla devam edilir (üretim asla kaybolmaz).
      let appliedUpscaleMp = null;
      // Netleştirme öncesi kare — SimpleImageModal'daki öncesi/sonrası sürgüsü
      // bu URL'yi kullanıyor. Yalnızca netleştirme uygulanırsa doldurulur.
      let preUpscaleImageUrl = null;
      if (
        resultImageUrl &&
        RESULT_UPSCALE_ALLOWED_MP.includes(Number(upscaleMp))
      ) {
        try {
          // Önce kredi: yetersizse netleştirme hiç başlatılmaz, üretim sonucu
          // olduğu gibi teslim edilir (kullanıcı üretimini kaybetmez).
          const upscaleCharge = await chargeUpscaleCredits(userId, upscaleMp);
          if (!upscaleCharge.ok) {
            throw new Error("UPSCALE_CREDIT_UNAVAILABLE");
          }
          logger.log(
            `🔍 [RESULT UPSCALE] Sonuç ${upscaleMp} MP'ye yükseltiliyor (${upscaleCharge.charged} kredi)...`,
          );
          // İstemci polling'i "Netleştiriliyor…" rozetini bu işaretten okur.
          // 64/128 MP'de bu adım dakikaya yaklaşabiliyor; kullanıcı ne
          // beklediğini görsün.
          await markGenerationStage(finalGenerationId, userId, "upscaling");
          const tUp = Date.now();
          const upscaled = await upscaleResultImage(resultImageUrl, upscaleMp);
          if (upscaled) {
            preUpscaleImageUrl = resultImageUrl;
            resultImageUrl = upscaled;
            appliedUpscaleMp = Number(upscaleMp);
            logger.log(
              `✅ [RESULT UPSCALE] ${appliedUpscaleMp} MP tamamlandı (${Date.now() - tUp}ms)`,
            );
          }
          // Aşama işaretini temizle — kart "Netleştiriliyor…" ile takılı kalmasın
          await markGenerationStage(finalGenerationId, userId, null);
        } catch (upErr) {
          logger.warn(
            "⚠️ [RESULT UPSCALE] Netleştirme başarısız, orijinal sonuç kullanılıyor:",
            upErr?.message,
          );
          await markGenerationStage(finalGenerationId, userId, null);
        }
      }

      const updatedGeneration = await updateGenerationStatus(
        finalGenerationId,
        userId,
        "completed",
        {
          enhanced_prompt: enhancedPrompt,
          result_image_url: resultImageUrl,
          replicate_prediction_id: initialResult.id,
          processing_time_seconds: processingTime,
          // Netleştirildiyse hangi kademede olduğunu kaydet (SimpleImageModal
          // bu bilgiye bakıp zoom aracını gösteriyor).
          ...(appliedUpscaleMp
            ? {
                upscaled_mp: appliedUpscaleMp,
                pre_upscale_image_url: preUpscaleImageUrl,
              }
            : {}),
        },
      );
      // updateGenerationStatus Supabase bucket'e kaydedip DB'yi günceller,
      // dönen kayıttaki result_image_url artık Supabase URL'sidir (fal.media değil)
      const finalResultImageUrl =
        updatedGeneration?.result_image_url || resultImageUrl;

      // 💳 KREDI GÜNCELLEME SIRASI
      // Kredi düşümü updateGenerationStatus içinde tetikleniyor (pay-on-success).
      // Bu nedenle güncel krediyi, status güncellemesinden SONRA okumalıyız.
      // 🔗 TEAM-AWARE: Team member için owner'ın kredisini döndür
      let currentCredit = null;
      if (userId && userId !== "anonymous_user") {
        try {
          const effectiveCredits =
            await teamService.getEffectiveCredits(userId);
          currentCredit = effectiveCredits.creditBalance || 0;
          logger.log(
            `💳 Güncel kredi balance (post-deduct, team-aware): ${currentCredit}`,
            effectiveCredits.isTeamCredit
              ? `(team owner: ${effectiveCredits.creditOwnerId})`
              : "",
          );
        } catch (creditError) {
          console.error(
            "❌ Güncel kredi sorgu hatası (post-deduct):",
            creditError,
          );
        }
      }

      const responseData = {
        success: true,
        result: {
          // Supabase bucket URL kullan (fal.media yerine)
          imageUrl: finalResultImageUrl,
          // Netleştirilmişse sunucuda üretilen küçük önizleme kullanılır;
          // 30 MB'lık kaynağı CDN küçültemiyor (403) ve kart boş kalıyordu.
          imageUrlThumbnail: (updatedGeneration?.result_thumb_url ||
            finalResultImageUrl)
            ? optimizeImageUrl(
                updatedGeneration?.result_thumb_url || finalResultImageUrl,
                { width: 500, height: 500, quality: 80 },
              )
            : null,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
          replicateData: finalResult,
          currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
          generationId: finalGenerationId, // 🆔 Generation ID'yi response'a ekle
          // 🔍 Uygulanan netleştirme kademesi (yoksa null) — istemci bu bilgiyle
          // SimpleImageModal'daki zoom kaydırıcısını gösteriyor.
          upscaledMp: appliedUpscaleMp || null,
          // Kalıcılaştırılmış (bucket) kare varsa o döner — fal URL'leri süreli.
          preUpscaleImageUrl:
            updatedGeneration?.pre_upscale_image_url ||
            preUpscaleImageUrl ||
            null,
        },
      };

      // Not: saveGenerationToDatabase artık gerekli değil çünkü updateGenerationStatus ile güncelliyoruz

      // 🗑️ İşlem başarıyla tamamlandı, geçici dosyaları hemen temizle
      logger.log("🧹 Başarılı işlem sonrası geçici dosyalar temizleniyor...");
      await cleanupTemporaryFiles(temporaryFiles);

      return res.status(200).json(responseData);
    } else {
      console.error("Replicate API başarısız:", finalResult);

      // ❌ Status'u failed'e güncelle
      await updateGenerationStatus(finalGenerationId, userId, "failed", {
        // error_message kolonu yok, bu yüzden genel field kullan
        processing_time_seconds: Math.round((Date.now() - startTime) / 1000),
      });

      // 🗑️ Replicate hata durumında geçici dosyaları temizle
      logger.log("🧹 Replicate hatası sonrası geçici dosyalar temizleniyor...");
      await cleanupTemporaryFiles(temporaryFiles);

      // Kredi iade et
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
            })
            .eq("id", userId);

          logger.log(
            `💰 ${actualCreditDeducted} kredi iade edildi (Replicate hatası)`,
          );
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "Replicate API işlemi başarısız oldu",
          error: finalResult.error || "Bilinmeyen hata",
          status: finalResult.status,
          generationId: finalGenerationId, // Client için generation ID ekle
        },
      });
    }
  } catch (error) {
    console.error("Resim oluşturma hatası:", error);

    // ❌ Status'u failed'e güncelle (genel hata durumu)
    if (finalGenerationId) {
      await updateGenerationStatus(finalGenerationId, userId, "failed", {
        // error_message kolonu yok, bu yüzden genel field kullan
        processing_time_seconds: 0,
      });
    }

    // 🗑️ Hata durumunda da geçici dosyaları temizle
    logger.log("🧹 Hata durumunda geçici dosyalar temizleniyor...");
    await cleanupTemporaryFiles(temporaryFiles);

    // Kredi iade et
    if (creditDeducted && userId && userId !== "anonymous_user") {
      try {
        const { data: currentUserCredit } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        await supabase
          .from("users")
          .update({
            credit_balance:
              (currentUserCredit?.credit_balance || 0) + actualCreditDeducted,
          })
          .eq("id", userId);

        logger.log(`💰 ${actualCreditDeducted} kredi iade edildi (Genel hata)`);
      } catch (refundError) {
        console.error("❌ Kredi iade hatası:", refundError);
      }
    }

    // Sensitive content hatasını özel olarak handle et
    if (error.message && error.message.startsWith("SENSITIVE_CONTENT:")) {
      return res.status(400).json({
        success: false,
        result: {
          message: "sensitiveContent.message", // i18n key
          title: "sensitiveContent.title", // i18n key
          shortMessage: "sensitiveContent.shortMessage", // i18n key
          error_type: "sensitive_content",
          user_friendly: true,
          i18n_keys: {
            message: "sensitiveContent.message",
            title: "sensitiveContent.title",
            shortMessage: "sensitiveContent.shortMessage",
            understood: "sensitiveContent.understood",
          },
        },
      });
    }

    // Prediction interrupted (PA) hatasını özel olarak handle et
    if (error.message && error.message.startsWith("PREDICTION_INTERRUPTED:")) {
      return res.status(503).json({
        success: false,
        result: {
          message:
            "Replicate sunucusunda geçici bir kesinti oluştu. Lütfen birkaç dakika sonra tekrar deneyin.",
          error_type: "prediction_interrupted",
          user_friendly: true,
          retry_after: 30, // 30 saniye sonra tekrar dene
        },
      });
    }

    // Timeout hatalarını özel olarak handle et
    if (
      error.message &&
      (error.message.includes("timeout") ||
        error.message.includes("Gemini API timeout") ||
        error.message.includes("120s"))
    ) {
      return res.status(503).json({
        success: false,
        result: {
          message:
            "İşlem 2 dakika zaman aşımına uğradı. Lütfen daha küçük bir resim deneyiniz veya tekrar deneyin.",
          error_type: "timeout",
          user_friendly: false,
          retry_after: 30, // 30 saniye sonra tekrar dene
        },
      });
    }

    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
        error: error.message,
        generationId: finalGenerationId, // Client için generation ID ekle
        status: "failed",
      },
    });
  }
});

// Kullanıcının reference browser sonuçlarını getiren endpoint
// Team üyesi ise tüm ekip üyelerinin sonuçlarını getirir (Shared Workspace)
router.get("/results/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } =
      await teamService.getTeamMemberIds(userId);

    logger.log(
      `📊 [RESULTS-V5] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(", ")}`,
    );

    const offset = (page - 1) * limit;

    // Kullanıcının (veya takım üyelerinin) sonuçlarını getir (en yeni önce)
    const { data: results, error } = await supabase
      .from("reference_results")
      .select("*")
      .in("user_id", memberIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("❌ Sonuçları getirme hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Sonuçları getirirken hata oluştu",
          error: error.message,
        },
      });
    }

    // Toplam sayıyı getir
    const { count, error: countError } = await supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true })
      .in("user_id", memberIds);

    if (countError) {
      console.error("❌ Toplam sayı getirme hatası:", countError);
    }

    return res.status(200).json({
      success: true,
      result: {
        data: results || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: offset + limit < (count || 0),
      },
    });
  } catch (error) {
    console.error("❌ Reference browser results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Tüm reference browser sonuçlarını getiren endpoint (admin için)
router.get("/results", async (req, res) => {
  try {
    const { page = 1, limit = 50, userId } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from("reference_results")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Eğer userId filter'ı varsa ekle
    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: results, error } = await query;

    if (error) {
      console.error("❌ Tüm sonuçları getirme hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Sonuçları getirirken hata oluştu",
          error: error.message,
        },
      });
    }

    // Toplam sayıyı getir
    let countQuery = supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true });

    if (userId) {
      countQuery = countQuery.eq("user_id", userId);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error("❌ Toplam sayı getirme hatası:", countError);
    }

    return res.status(200).json({
      success: true,
      result: {
        data: results || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: offset + limit < (count || 0),
      },
    });
  } catch (error) {
    console.error("❌ All reference browser results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının mevcut kredisini getiren endpoint
router.get("/credit/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || userId === "anonymous_user") {
      return res.status(200).json({
        success: true,
        result: {
          credit: 0, // Anonymous kullanıcılar için sınırsız (veya 0 göster)
          isAnonymous: true,
        },
      });
    }

    const { data: userCredit, error } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ Kredi sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Kredi sorgulama sırasında hata oluştu",
          error: error.message,
        },
      });
    }

    return res.status(200).json({
      success: true,
      result: {
        credit: userCredit?.credit_balance || 0,
        isAnonymous: false,
      },
    });
  } catch (error) {
    console.error("❌ Kredi endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Kredi bilgisi alınırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Pose açıklaması için Gemini'yi kullan (sadece pose tarifi)
async function generatePoseDescriptionWithGemini(
  poseTitle,
  poseImage,
  gender = "female",
  garmentType = "clothing",
) {
  try {
    logger.log("🤸 [GEMINI] Pose açıklaması oluşturuluyor...");
    logger.log("🤸 [GEMINI] Pose title:", poseTitle);
    logger.log("🤸 [GEMINI] Gender:", gender);
    logger.log("🤸 [GEMINI] Garment type:", garmentType);

    // Gender mapping
    const modelGenderText =
      gender.toLowerCase() === "male" || gender.toLowerCase() === "man"
        ? "male model"
        : "female model";

    // Pose açıklaması için özel prompt
    const posePrompt = `
    POSE DESCRIPTION TASK:
    
    You are a professional fashion photography director. Create a detailed, technical pose description for a ${modelGenderText} wearing ${garmentType}.
    
    POSE TITLE: "${poseTitle}"
    
    REQUIREMENTS:
    - Generate ONLY a detailed pose description/instruction
    - Do NOT create image generation prompts or visual descriptions
    - Focus on body positioning, hand placement, stance, and posture
    - Include specific technical directions for the model
    - Keep it professional and suitable for fashion photography
    - Make it clear and actionable for a model to follow
    - Consider how the pose will showcase the garment effectively
    
    OUTPUT FORMAT:
    Provide only the pose instruction in a clear, professional manner. Start directly with the pose description without any introductory text.
    
    EXAMPLE OUTPUT STYLE:
    "Stand with feet shoulder-width apart, weight shifted to the back leg. Turn torso slightly at a 45-degree angle to the camera. Place left hand on hip with thumb pointing backward, fingers curved naturally. Extend right arm down and slightly away from body. Keep shoulders relaxed and down. Tilt head slightly toward the raised shoulder. Maintain confident eye contact with camera."
    
    Generate a similar detailed pose instruction for the given pose title "${poseTitle}" for a ${modelGenderText}.
    `;

    logger.log("🤸 [GEMINI] Pose prompt hazırlandı:", posePrompt);

    // Replicate Gemini Flash API için resim URL'lerini hazırla
    const imageUrlsForPose = [];

    // Pose image'ını URL olarak ekle (eğer varsa)
    if (poseImage) {
      try {
        const cleanPoseImageUrl = sanitizeImageUrl(poseImage.split("?")[0]);
        if (
          cleanPoseImageUrl.startsWith("http://") ||
          cleanPoseImageUrl.startsWith("https://")
        ) {
          imageUrlsForPose.push(cleanPoseImageUrl);
          logger.log("🤸 [REPLICATE-GEMINI] Pose görseli eklendi");
        }
      } catch (imageError) {
        console.error("❌ Pose resim ekleme hatası:", imageError);
      }
    }

    // Prompt enhance (Google direkt veya Replicate — app_config seçimine göre)
    const poseDescription = await callGeminiFlash(
      posePrompt,
      imageUrlsForPose,
      3,
    );

    if (!poseDescription) {
      throw new Error("Gemini API response is empty");
    }

    logger.log(
      "🤸 [REPLICATE-GEMINI] Pose açıklaması alındı:",
      poseDescription.substring(0, 100) + "...",
    );

    const sanitizedDescription = sanitizePoseText(poseDescription);
    if (sanitizedDescription !== poseDescription) {
      logger.log("🤸 Pose açıklaması temizlendi:", sanitizedDescription);
    }

    return sanitizedDescription;
  } catch (error) {
    console.error("🤸 Replicate Gemini pose açıklaması hatası:", error);
    // Fallback: Basit pose açıklaması
    return sanitizePoseText(
      `Professional ${gender.toLowerCase()} model pose: ${poseTitle}. Stand naturally with good posture, position body to showcase the garment effectively.`,
    );
  }
}

// Pose açıklaması oluşturma endpoint'i
router.post("/generatePoseDescription", async (req, res) => {
  try {
    const {
      poseTitle,
      poseImage,
      gender = "female",
      garmentType = "clothing",
    } = req.body;

    logger.log("🤸 Pose açıklaması isteği alındı:");
    logger.log("🤸 Pose title:", poseTitle);
    logger.log("🤸 Gender:", gender);
    logger.log("🤸 Garment type:", garmentType);
    logger.log("🤸 Pose image:", poseImage ? "Mevcut" : "Yok");

    if (!poseTitle) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Pose title gereklidir",
        },
      });
    }

    // Gemini ile pose açıklaması oluştur
    const poseDescription = await generatePoseDescriptionWithGemini(
      poseTitle,
      poseImage,
      gender,
      garmentType,
    );

    logger.log("🤸 Pose açıklaması başarıyla oluşturuldu");

    return res.status(200).json({
      success: true,
      result: {
        poseTitle: poseTitle,
        poseDescription: poseDescription,
        gender: gender,
        garmentType: garmentType,
      },
    });
  } catch (error) {
    console.error("🤸 Pose açıklaması endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Pose açıklaması oluşturulurken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Generation status sorgulama endpoint'i (polling için)
router.get("/generation-status/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { userId } = req.query;

    if (!generationId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Generation ID gereklidir",
        },
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } =
      await teamService.getTeamMemberIds(userId);

    // Log'u sadece ilk sorgulamada yap (spam önlemek için)
    if (Math.random() < 0.1) {
      // %10 ihtimalle logla
      logger.log(
        `🔍 Generation status sorgusu: ${generationId.slice(
          0,
          8,
        )}... (User: ${userId.slice(0, 8)}..., Team: ${isTeamMember})`,
      );
    }

    // Generation'ı sorgula - Team üyeleri için .in() kullan
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("generation_id", generationId)
      .in("user_id", memberIds);

    // Debug: Bu user/team'in aktif generation'larını da kontrol et
    if (!generationArray || generationArray.length === 0) {
      const { data: userGenerations } = await supabase
        .from("reference_results")
        .select("generation_id, status, created_at, user_id")
        .in("user_id", memberIds)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (userGenerations && userGenerations.length > 0) {
        logger.log(
          `🔍 User/Team ${userId.slice(0, 8)} has ${
            userGenerations.length
          } active generations:`,
          userGenerations
            .map(
              (g) =>
                `${g.generation_id ? g.generation_id.slice(0, 8) : "null"}(${g.status})`,
            )
            .join(", "),
        );

        // 30 dakikadan eski pending/processing generation'ları temizle
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const expiredGenerations = userGenerations.filter(
          (g) => new Date(g.created_at) < thirtyMinutesAgo,
        );

        if (expiredGenerations.length > 0) {
          logger.log(
            `🧹 Cleaning ${
              expiredGenerations.length
            } expired generations for user/team ${userId.slice(0, 8)}`,
          );

          // Null generation_id'leri filtrele
          const validGenerationIds = expiredGenerations
            .map((g) => g.generation_id)
            .filter((id) => id !== null && id !== undefined);

          if (validGenerationIds.length > 0) {
            await supabase
              .from("reference_results")
              .update({ status: "failed" })
              .in("generation_id", validGenerationIds)
              .in("user_id", memberIds);
          }
        }
      }
    }

    if (error) {
      console.error("❌ Generation sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Generation sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    // Array'den ilk elemanı al veya yoksa null
    const generation =
      generationArray && generationArray.length > 0 ? generationArray[0] : null;

    if (!generation) {
      // Log'u daha sade yap (spam önlemek için)
      logger.log(
        `🔍 Generation not found: ${generationId.slice(
          0,
          8,
        )}... (could be completed or expired)`,
      );

      // Frontend'e generation'ın tamamlandığını veya süresi dolduğunu söyle
      return res.status(404).json({
        success: false,
        result: {
          message: "Generation not found (possibly completed or expired)",
          generationId: generationId,
          status: "not_found",
          shouldStopPolling: true, // Frontend'e polling'i durdurmayı söyle
        },
      });
    }

    // ⏰ Processing timeout kontrolü (15 dakika)
    const PROCESSING_TIMEOUT_MINUTES = 15;
    const createdAt = new Date(generation.created_at);
    const now = new Date();
    const minutesElapsed = (now - createdAt) / (1000 * 60);

    let finalStatus = generation.status;
    let shouldUpdateStatus = false;

    if (
      (generation.status === "processing" || generation.status === "pending") &&
      minutesElapsed > PROCESSING_TIMEOUT_MINUTES
    ) {
      logger.log(
        `⏰ Generation ${generationId} timeout (${Math.round(
          minutesElapsed,
        )} dakika), failed olarak işaretleniyor`,
      );
      finalStatus = "failed";
      shouldUpdateStatus = true;

      // Database'de status'u failed'e güncelle
      try {
        await updateGenerationStatus(generationId, userId, "failed", {
          processing_time_seconds: Math.round(minutesElapsed * 60),
        });
        logger.log(
          `✅ Timeout generation ${generationId} failed olarak güncellendi`,
        );
      } catch (updateError) {
        console.error(
          `❌ Timeout generation ${generationId} güncelleme hatası:`,
          updateError,
        );
      }
    }

    logger.log(
      `✅ Generation durumu: ${finalStatus}${
        shouldUpdateStatus ? " (timeout nedeniyle güncellendi)" : ""
      }`,
    );

    // 💳 Güncel kredi bilgisini de döndür (arka plandan dönüşte güncellensin)
    let currentCredit = null;
    if (userId && userId !== "anonymous_user") {
      try {
        const { data: userData } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();
        currentCredit = userData?.credit_balance ?? null;
      } catch (creditError) {
        console.error("❌ Kredi sorgu hatası (status endpoint):", creditError);
      }
    }

    // Netleştirilmiş sonuçlarda kaynak dosya CDN'in küçültebileceğinden büyük
    // (403). Bu yüzden varsa sunucuda üretilmiş önizleme kullanılır.
    const thumbnailSource =
      generation.result_thumb_url || generation.result_image_url;
    const thumbnailUrl = thumbnailSource
      ? optimizeImageUrl(thumbnailSource, {
          width: 500,
          height: 500,
          quality: 80,
        })
      : null;
    if (finalStatus === "completed") {
      logger.log(
        `🖼️ [THUMBNAIL] Generation ${generation.generation_id}: original=${generation.result_image_url?.substring(0, 60)} | thumbnail=${thumbnailUrl?.substring(0, 80)}`,
      );
    }

    return res.status(200).json({
      success: true,
      result: {
        generationId: generation.generation_id,
        qualityVersion:
          generation.quality_version ||
          generation.settings?.qualityVersion ||
          generation.settings?.quality_version ||
          "v1", // Kalite versiyonu
        status: finalStatus,
        resultImageUrl: generation.result_image_url,
        upscaledMp: generation.upscaled_mp || null,
        preUpscaleImageUrl: generation.pre_upscale_image_url || null,
        // ⏳ Ara aşama ("upscaling") — Results kartındaki durum rozeti için
        stage: generation.settings?.stage || null,
        resultImageThumbnail: thumbnailUrl,
        originalPrompt: generation.original_prompt,
        enhancedPrompt: generation.enhanced_prompt,
        settings: generation.settings || {}, // Settings bilgisini de ekle
        errorMessage: shouldUpdateStatus ? "İşlem zaman aşımına uğradı" : null,
        processingTimeSeconds: generation.processing_time_seconds,
        createdAt: generation.created_at,
        updatedAt: generation.updated_at,
        currentCredit: currentCredit, // 💳 Güncel kredi bilgisi
      },
    });
  } catch (error) {
    console.error("❌ Generation status endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Generation status sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının pending/processing generation'larını getiren endpoint
// Team üyesi ise tüm ekip üyelerinin pending generation'larını getirir (Shared Workspace)
// platform=mobile ise sadece kullanıcının kendi verilerini döndürür
router.get("/pending-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { platform } = req.query; // 'web' veya 'mobile'

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Mobile için sadece kullanıcının kendi verilerini döndür
    // Web için team üyelerinin verilerini de döndür (Shared Workspace)
    let memberIds = [userId];
    let isTeamMember = false;

    if (platform !== "mobile") {
      const teamData = await teamService.getTeamMemberIds(userId);
      memberIds = teamData.memberIds;
      isTeamMember = teamData.isTeamMember;
    }

    logger.log(
      `🔍 Pending generations sorgusu: ${userId} (platform: ${platform || "web"})`,
    );
    logger.log(
      `📊 [PENDING-V5] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(", ")}`,
    );

    // Pending ve processing durumundaki generation'ları getir (takım üyeleri dahil - sadece web)
    const { data: generations, error } = await supabase
      .from("reference_results")
      .select("*")
      .in("user_id", memberIds)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Pending generations sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Pending generations sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    logger.log(
      `✅ ${generations?.length || 0} pending/processing generation bulundu`,
    );

    // ⏰ Timeout kontrolü ve otomatik cleanup
    const PROCESSING_TIMEOUT_MINUTES = 15;
    const now = new Date();
    let validGenerations = [];
    let timeoutGenerations = [];

    if (generations && generations.length > 0) {
      for (const gen of generations) {
        const createdAt = new Date(gen.created_at);
        const minutesElapsed = (now - createdAt) / (1000 * 60);

        if (minutesElapsed > PROCESSING_TIMEOUT_MINUTES) {
          logger.log(
            `⏰ Generation ${gen.generation_id} timeout (${Math.round(
              minutesElapsed,
            )} dakika)`,
          );
          timeoutGenerations.push(gen);

          // Database'de failed olarak işaretle
          try {
            await updateGenerationStatus(gen.generation_id, userId, "failed", {
              processing_time_seconds: Math.round(minutesElapsed * 60),
            });
            logger.log(
              `✅ Timeout generation ${gen.generation_id} failed olarak güncellendi`,
            );
          } catch (updateError) {
            console.error(
              `❌ Timeout generation ${gen.generation_id} güncelleme hatası:`,
              updateError,
            );
          }
        } else {
          validGenerations.push(gen);
        }
      }

      logger.log(
        `🧹 ${timeoutGenerations.length} timeout generation temizlendi, ${validGenerations.length} aktif generation kaldı`,
      );
    }

    return res.status(200).json({
      success: true,
      result: {
        generations:
          validGenerations?.map((gen) => ({
            generationId: gen.generation_id,
            status: gen.status,
            resultImageUrl: gen.result_image_url,
            upscaledMp: gen.upscaled_mp || null,
            preUpscaleImageUrl: gen.pre_upscale_image_url || null,
            resultImageThumbnail: (gen.result_thumb_url || gen.result_image_url)
              ? optimizeImageUrl(gen.result_thumb_url || gen.result_image_url, {
                  width: 500,
                  height: 500,
                  quality: 80,
                })
              : null,
            originalPrompt: gen.original_prompt,
            enhancedPrompt: gen.enhanced_prompt,
            errorMessage: null, // error_message kolonu yok
            processingTimeSeconds: gen.processing_time_seconds,
            createdAt: gen.created_at,
            updatedAt: gen.updated_at,
          })) || [],
        count: validGenerations?.length || 0,
      },
    });
  } catch (error) {
    console.error("❌ Pending generations endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Pending generations sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının tüm generation'larını getiren endpoint (pending, processing, completed, failed)
// Team üyesi ise tüm ekip üyelerinin generation'larını getirir (Shared Workspace)
// platform=mobile ise sadece kullanıcının kendi verilerini döndürür
router.get("/user-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, platform } = req.query; // Opsiyonel: belirli statusleri filtrelemek için, platform: 'web' veya 'mobile'

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    // Mobile için sadece kullanıcının kendi verilerini döndür
    // Web için team üyelerinin verilerini de döndür (Shared Workspace)
    let memberIds = [userId];
    let isTeamMember = false;

    if (platform !== "mobile") {
      const teamData = await teamService.getTeamMemberIds(userId);
      memberIds = teamData.memberIds;
      isTeamMember = teamData.isTeamMember;
    }

    logger.log(
      `🔍 User generations sorgusu: ${userId}${
        status ? ` (status: ${status})` : ""
      } (platform: ${platform || "web"})`,
    );
    logger.log(
      `📊 [USER-GENERATIONS-V5] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(", ")}`,
    );

    // 🕐 Her zaman son 1 saatlik data'yı döndür
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const oneHourAgoISO = oneHourAgo.toISOString();

    logger.log(
      `🕐 [API_FILTER] Son 1 saatlik data döndürülüyor: ${oneHourAgoISO} sonrası`,
    );

    // Team üyeleri için .in() kullan
    // User email bilgisini de çekmek için join yap
    let query = supabase
      .from("reference_results")
      .select(
        `
        *,
        users:user_id (
          email
        )
      `,
      )
      .in("user_id", memberIds)
      .gte("created_at", oneHourAgoISO) // Her zaman 1 saatlik filtreleme
      .order("created_at", { ascending: false });

    // Status filtresi varsa uygula
    if (status) {
      if (status === "pending") {
        query = query.in("status", ["pending", "processing"]);
      } else {
        query = query.eq("status", status);
      }
    }

    const { data: generations, error } = await query;

    if (error) {
      console.error("❌ User generations sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "User generations sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    logger.log(
      `✅ ${generations?.length || 0} generation bulundu (${
        status || "all statuses"
      })`,
    );

    // Debug: Generation'ları logla
    if (generations && generations.length > 0) {
      logger.log(`🔍 [DEBUG] ${generations.length} generation bulundu:`);
      generations.forEach((gen, index) => {
        logger.log(
          `  ${index + 1}. ID: ${gen.generation_id}, Status: ${gen.status}`,
        );
      });
    }

    return res.status(200).json({
      success: true,
      result: {
        generations:
          generations?.map((gen) => ({
            id: gen.id,
            generationId: gen.generation_id,
            userId: gen.user_id,
            userEmail: gen.users?.email || null, // Team workspace için user email
            status: gen.status,
            resultImageUrl: gen.result_image_url,
            upscaledMp: gen.upscaled_mp || null,
            preUpscaleImageUrl: gen.pre_upscale_image_url || null,
            resultImageThumbnail: (gen.result_thumb_url || gen.result_image_url)
              ? optimizeImageUrl(gen.result_thumb_url || gen.result_image_url, {
                  width: 500,
                  height: 500,
                  quality: 80,
                })
              : null,
            originalPrompt: gen.original_prompt,
            enhancedPrompt: gen.enhanced_prompt,
            referenceImages: gen.reference_images,
            settings: gen.settings,
            locationImage: gen.location_image,
            poseImage: gen.pose_image,
            hairStyleImage: gen.hair_style_image,
            aspectRatio: gen.aspect_ratio,
            replicatePredictionId: gen.replicate_prediction_id,
            processingTimeSeconds: gen.processing_time_seconds,
            isMultipleImages: gen.is_multiple_images,
            isMultipleProducts: gen.is_multiple_products,
            errorMessage: null, // error_message kolonu yok
            qualityVersion:
              gen.quality_version ||
              gen.settings?.qualityVersion ||
              gen.settings?.quality_version ||
              "v1", // Kalite versiyonu
            createdAt: gen.created_at,
            updatedAt: gen.updated_at,
          })) || [],
        totalCount: generations?.length || 0,
        isTeamData: isTeamMember,
      },
    });
  } catch (error) {
    console.error("❌ User generations endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "User generations sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Belirli bir generation'ın reference_images'larını getiren endpoint
router.get("/generation/:generationId/reference-images", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { userId } = req.query;

    if (!generationId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "Generation ID gereklidir",
        },
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    logger.log(
      `🔍 [REFERENCE_IMAGES_ROUTE] Generation ${generationId.slice(
        0,
        8,
      )}... için reference images sorgusu (User: ${userId.slice(0, 8)}...)`,
    );
    logger.log(`📋 [REFERENCE_IMAGES_ROUTE] Request details:`, {
      method: req.method,
      path: req.path,
      generationId: generationId.slice(0, 8) + "...",
      userId: userId.slice(0, 8) + "...",
      fullUrl: req.originalUrl,
    });

    // Generation'ı sorgula
    const { data: generationArray, error } = await supabase
      .from("reference_results")
      .select("reference_images, settings, original_prompt, created_at")
      .eq("generation_id", generationId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "❌ [REFERENCE_IMAGES] Generation sorgulama hatası:",
        error,
      );
      return res.status(500).json({
        success: false,
        result: {
          message: "Generation sorgulanırken hata oluştu",
          error: error.message,
        },
      });
    }

    // Array'den ilk elemanı al
    const generation =
      generationArray && generationArray.length > 0 ? generationArray[0] : null;

    if (!generation) {
      logger.log(`🔍 [REFERENCE_IMAGES] Generation ${generationId} bulunamadı`);
      return res.status(404).json({
        success: false,
        result: {
          message: "Generation bulunamadı",
          generationId: generationId,
        },
      });
    }

    const referenceImages = generation.reference_images || [];
    logger.log(
      `✅ [REFERENCE_IMAGES] Generation ${generationId} için ${referenceImages.length} reference image bulundu`,
    );

    // Reference images'ları işle ve array formatında döndür
    const processedReferenceImages = Array.isArray(referenceImages)
      ? referenceImages.map((imageUrl, index) => ({
          uri: imageUrl,
          width: 1024,
          height: 1024,
          type: index === 0 ? "model" : "product", // İlk resim model, diğerleri product
        }))
      : [];

    return res.status(200).json({
      success: true,
      result: {
        generationId: generationId,
        referenceImages: processedReferenceImages,
        originalPrompt: generation.original_prompt,
        settings: generation.settings,
        createdAt: generation.created_at,
        hasReferenceImages: processedReferenceImages.length > 0,
        totalReferenceImages: processedReferenceImages.length,
      },
    });
  } catch (error) {
    console.error("❌ [REFERENCE_IMAGES] Endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Reference images sorgulanırken hata oluştu",
        error: error.message,
      },
    });
  }
});

// 🎬 Stil referansı geçmişi — kullanıcının daha önce üretimde KULLANDIĞI tekil
// stil referansı fotoğrafları (style_source='upload'; profil grid kolajları
// hariç). URL'ler üretim sırasında Supabase'e kalıcılaştırıldığı için geçmişten
// yeniden seçim her zaman çalışır. Tekrar eden URL'ler tekilleştirilir.
router.get("/style-reference-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === "anonymous_user") {
      return res.status(200).json({ success: true, items: [] });
    }

    const { data, error } = await supabase
      .from("reference_results")
      .select("style_reference_url, created_at")
      .eq("user_id", userId)
      .eq("style_source", "upload")
      .not("style_reference_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(60);

    if (error) throw error;

    const seen = new Set();
    const items = [];
    for (const row of data || []) {
      if (!row.style_reference_url || seen.has(row.style_reference_url)) continue;
      seen.add(row.style_reference_url);
      items.push({ url: row.style_reference_url, createdAt: row.created_at });
      if (items.length >= 24) break;
    }

    return res.status(200).json({ success: true, items });
  } catch (error) {
    console.error("❌ [STYLE_REF_HISTORY] Endpoint hatası:", error?.message);
    return res.status(500).json({
      success: false,
      items: [],
      error: error?.message,
    });
  }
});

module.exports = router;
