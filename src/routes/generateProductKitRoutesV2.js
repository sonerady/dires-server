const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const { fal } = require("@fal-ai/client");
const teamService = require("../services/teamService");
const { optimizeKitImages } = require("../utils/imageOptimizer");
const { callOpenRouterGeminiFlash } = require("../utils/promptEnhanceProvider");

// Fal.ai client config (detail + ghost sahneleri için GPT Image 2 queue SDK)
fal.config({
  credentials: process.env.FAL_API_KEY,
});

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

// ─── Constants ───
const KIT_GENERATION_COST_OLD = 50;  // Users registered before cutoff date
const KIT_GENERATION_COST_NEW = 80;  // Users registered on/after cutoff date
const NEW_PRICING_CUTOFF = new Date("2026-03-07T00:00:00Z");
const FREE_TIER_LIMIT = 2;
const sceneTypes = ["pose1", "pose2", "studio1", "studio2", "detail", "ghost"];

// ─── Get kit cost based on user registration date ───
async function getKitCostForUser(userId) {
    if (!userId || userId === "anonymous_user") return KIT_GENERATION_COST_OLD;
    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("created_at")
            .eq("id", userId)
            .single();
        if (error || !user || !user.created_at) return KIT_GENERATION_COST_OLD;
        const userCreatedAt = new Date(user.created_at);
        return userCreatedAt >= NEW_PRICING_CUTOFF ? KIT_GENERATION_COST_NEW : KIT_GENERATION_COST_OLD;
    } catch (error) {
        console.error("❌ [KIT_V2_COST] Error:", error.message);
        return KIT_GENERATION_COST_OLD;
    }
}

// ─── Replicate Gemini Flash API helper ───
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN environment variable is not set");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🤖 [KIT_V2_GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

            const response = await axios.post(
                "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
                {
                    input: {
                        top_p: 0.95,
                        images: imageUrls,
                        prompt: prompt,
                        videos: [],
                        temperature: 1,
                        thinking_level: "low",
                        max_output_tokens: 8192
                    }
                },
                {
                    headers: {
                        "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
                        "Content-Type": "application/json",
                        "Prefer": "wait"
                    },
                    timeout: 120000
                }
            );

            const data = response.data;
            if (data.error) throw new Error(data.error);
            if (data.status !== "succeeded") throw new Error(`Prediction failed with status: ${data.status}`);

            let outputText = "";
            if (Array.isArray(data.output)) outputText = data.output.join("");
            else if (typeof data.output === "string") outputText = data.output;

            if (!outputText || outputText.trim() === "") throw new Error("Replicate Gemini response is empty");

            console.log(`✅ [KIT_V2_GEMINI] Başarılı response (attempt ${attempt})`);
            return outputText.trim();
        } catch (error) {
            console.error(`❌ [KIT_V2_GEMINI] Attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// ─── Prompt enhance sağlayıcısını app_config'ten oku: "gemini" (OpenRouter) | "replicate" (default: gemini) ───
async function getPromptEnhanceProvider() {
    try {
        const { data } = await supabase.from("app_config").select("prompt_enhance_provider").limit(1).maybeSingle();
        if (data && typeof data.prompt_enhance_provider === "string" && data.prompt_enhance_provider.trim()) {
            return data.prompt_enhance_provider.trim().toLowerCase();
        }
    } catch (e) {}
    try {
        const { data } = await supabase.from("app_config").select("value").eq("key", "prompt_enhance_provider").maybeSingle();
        if (data && typeof data.value === "string" && data.value.trim()) {
            return data.value.trim().toLowerCase();
        }
    } catch (e) {}
    return "gemini";
}

// ─── Prompt enhance dispatcher — sağlayıcı SABİT OpenRouter (13 Ağu, config yok sayılır) ───
// Replicate yalnız OpenRouter başarısız olursa fallback (referenceBrowserRoutesV7 ile aynı mantık).
async function callGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  // 17 Ağu 2026 (kullanıcı kararı): app_config.prompt_enhance_provider YENİDEN
  // OKUNUYOR. 13 Ağu'da OpenRouter'a sabitlenmişti; bakiye bitince (402) her
  // çağrı boşuna deneyip fallback'e düşüyordu. Artık config neredeyse oraya
  // gidilir, diğeri yedektir.
  const provider = await getPromptEnhanceProvider();
  const useReplicateFirst = provider === "replicate";
  console.log(`🔀 [KIT_V2_PROMPT_ENHANCE] Provider: ${useReplicateFirst ? "Replicate gemini-3-flash" : "OpenRouter gemini-3.7-flash"} — app_config: "${provider}"`);
  if (useReplicateFirst) {
    try {
      return await callReplicateGeminiFlash(prompt, imageUrls, maxRetries);
    } catch (err) {
      console.error(
        "⚠️ [KIT_V2_PROMPT_ENHANCE] Replicate Gemini başarısız, OpenRouter'a fallback:",
        err.message,
      );
      return callOpenRouterGeminiFlash(prompt, imageUrls, maxRetries);
    }
  }
  try {
    return await callOpenRouterGeminiFlash(prompt, imageUrls, maxRetries);
  } catch (err) {
    console.error(
      "⚠️ [KIT_V2_PROMPT_ENHANCE] OpenRouter Gemini başarısız, Replicate'e fallback:",
      err.message,
    );
    return callReplicateGeminiFlash(prompt, imageUrls, maxRetries);
  }
}

// ─── Optimize image (resize to fit under 7MB) ───
const MAX_FILE_SIZE = 7 * 1024 * 1024;

async function getOptimizedImageUrl(imageUrl) {
    if (!imageUrl) return null;
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const buffer = Buffer.from(response.data);
        if (buffer.length <= MAX_FILE_SIZE) return imageUrl;

        const metadata = await sharp(buffer).metadata();
        let quality = 92;
        let optimizedBuffer;

        do {
            quality -= 5;
            optimizedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
        } while (optimizedBuffer.length > MAX_FILE_SIZE && quality > 40);

        if (optimizedBuffer.length > MAX_FILE_SIZE) {
            const scale = 0.85;
            optimizedBuffer = await sharp(buffer)
                .resize(Math.round(metadata.width * scale), Math.round(metadata.height * scale))
                .jpeg({ quality: 50 })
                .toBuffer();
        }

        const fileName = `temp_optimized/${Date.now()}_${uuidv4().substring(0, 8)}.jpg`;
        const { error } = await supabase.storage.from("user_image_results").upload(fileName, optimizedBuffer, { contentType: "image/jpeg", upsert: true });
        if (error) return imageUrl;

        const { data: urlData } = supabase.storage.from("user_image_results").getPublicUrl(fileName);
        return urlData.publicUrl;
    } catch (error) {
        console.error(`❌ [KIT_V2_OPTIMIZE] Error:`, error.message);
        return imageUrl;
    }
}

// ─── GPT Image 2: aspect ratio sanitizer (3:1 limitini aşan input resimleri pad'ler) ───
// fal.ai 3:1'e çok yakın oranlarda bile (ör. 2.997) reddedebiliyor — trigger 2.9, hedef 2.5.
async function ensureMaxAspectRatio3to1ForKitInput(imageUrls, userId) {
    const TRIGGER_RATIO = 2.9;
    const TARGET_RATIO = 2.5;
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
                processedUrls.push(url);
                continue;
            }

            const ratio = W >= H ? W / H : H / W;
            if (ratio <= TRIGGER_RATIO) {
                processedUrls.push(url);
                continue;
            }

            console.log(`📐 [KIT_V2_GPT2_ASPECT] ${W}x${H} (ratio ${ratio.toFixed(3)}:1) > ${TRIGGER_RATIO}:1, padding uygulanıyor (hedef ${TARGET_RATIO}:1)...`);

            let padTop = 0, padBottom = 0, padLeft = 0, padRight = 0;
            let newW = W, newH = H;
            if (W > H) {
                newH = Math.ceil(W / TARGET_RATIO);
                const totalPadV = newH - H;
                padTop = Math.floor(totalPadV / 2);
                padBottom = totalPadV - padTop;
            } else {
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

            const timestamp = Date.now();
            const randomId = uuidv4().substring(0, 8);
            const fileName = `temp_${timestamp}_kit_gpt2_pad_${userId || "anonymous"}_${randomId}.jpg`;

            const { error: upErr } = await supabase.storage
                .from("reference")
                .upload(fileName, padded, { contentType: "image/jpeg" });

            if (upErr) {
                console.warn(`❌ [KIT_V2_GPT2_ASPECT] Supabase upload failed:`, upErr.message);
                processedUrls.push(url);
                continue;
            }

            const { data: urlData } = supabase.storage.from("reference").getPublicUrl(fileName);
            console.log(`✅ [KIT_V2_GPT2_ASPECT] Padded: ${newW}x${newH}, URL: ${urlData.publicUrl}`);
            processedUrls.push(urlData.publicUrl);
        } catch (err) {
            console.warn(`⚠️ [KIT_V2_GPT2_ASPECT] Preprocess error:`, err.message);
            processedUrls.push(url);
        }
    }

    return processedUrls;
}

// ─────────────────────────────────────────────────────────────────────
// 🧩 REFINER SÖZLEŞMESİ (28 Ağu 2026, kullanıcı isteği)
//
// Refiner'ın çeşitlendirme tarafındaki "detay makro" kareleri belirgin biçimde
// daha iyi çıkıyordu. Fark modelde değildi — kit zaten AYNI uca gidiyor
// (openai/gpt-image-2/edit) — PROMPT YAPISINDAYDI. Oradaki üç blok buraya
// birebir taşındı ve `detail` + `ghost` sahnelerinin sonuna ekleniyor:
//   1) ÜRÜN KİMLİĞİ korunumu (variationRoutes.PRODUCT_VARIATION_PRESERVATION_SUFFIX)
//   2) ZEMİN SADAKATİ (beyaz saf kalsın, renkli solmasın — makroda kritik)
//   3) GERÇEK MAKRO / HAYALET MANKEN inşa kuralı
// Böylece Gemini ne yazarsa yazsın, modele giden nihai metin aynı disiplini
// taşıyor. ⚠️ Değiştirirken variationRoutes.js ile birlikte düşün.
// ─────────────────────────────────────────────────────────────────────
const KIT_PRODUCT_PRESERVATION_SUFFIX =
    "Edit the provided reference image. The FIRST image is the finished photograph of the product; it is the " +
    "single source of truth for the product's identity. Preserve that product EXACTLY: the same object, same " +
    "silhouette and proportions, same materials and finish, same colors and color temperature, same texture, same " +
    "pattern, same weave, same stitching, same hardware, same print placement, same engraving and the same " +
    "branding. Do not restyle, redesign, simplify, embellish, resize or replace any part of the product, and do " +
    "not invent details that are not visible in the reference. The output is one single photograph of that one " +
    "product, finished to flawless high-end e-commerce retouch quality: razor-sharp focus, crisp edges, clean " +
    "surfaces free of dust, lint, scratches and fingerprints, and true-to-life color. No text, no logos of other " +
    "brands, no watermark, no collage and no split frames.";

const KIT_BACKGROUND_FIDELITY_SUFFIX =
    "\n\nBACKGROUND FIDELITY: whatever background this shot calls for, it must be clean and uniform edge to edge. " +
    "If it is pure white, it is the same pure, even, seamless white (#FFFFFF) across the whole frame — never grey, " +
    "never cream, never beige, never washed-out or dulled, never a gradient, never vignetted or darker in the " +
    "corners, with no visible seam, no horizon line, no dust, no noise and no soft falloff. If it is a colour, it " +
    "keeps the exact same hue, saturation and brightness across the entire frame — never faded, muted, darkened, " +
    "pastelled or tinted by the product's reflections. This matters most in a close-up frame, where a near camera " +
    "and shallow depth of field tend to grey down, blur or contaminate the background: keep it perfectly clean, " +
    "uniform and fully saturated there too. Do not introduce any surface, table, floor, wall, backdrop edge, prop " +
    "shadow or environmental colour cast the shot does not call for.";

const KIT_MACRO_SUFFIX =
    "\n\nMACRO REQUIREMENT — THIS IS A TRUE MACRO PHOTOGRAPH taken with a real macro lens, not a digital zoom and " +
    "not an upscaled crop of the source image. The camera physically moves close to the product; the chosen area " +
    "fills the frame and the rest of the product may fall outside the crop or out of the plane of focus. Render " +
    "real macro optics: genuine material texture, believable micro-reflections and crisp micro-detail on weave, " +
    "thread, grain, stitching, seam construction, button edges, zipper teeth and label embossing. Choose the " +
    "single most commercially valuable area of THIS specific product and let it carry the frame. Never a wide " +
    "catalog shot of the whole product." +
    "\n\nMANDATORY SHOT-DIVERGENCE RULE: compare against the source image before editing. This frame must be " +
    "unmistakably a DIFFERENT photograph of the same product, not a subtle adjustment or a re-crop. Change the " +
    "camera position in three-dimensional space: viewing angle, rotation of the product relative to the lens, " +
    "camera height and camera distance must all visibly differ, with physically coherent perspective, " +
    "foreshortening and specular highlights for the new viewpoint. Simply zooming into the source pixels, " +
    "mirroring it or nudging the crop is a failed edit.";

const KIT_GHOST_SUFFIX =
    "\n\nGHOST MANNEQUIN CONSTRUCTION: the garment is filled by an INVISIBLE body and holds its full " +
    "three-dimensional form — shoulders shaped, chest with real depth, collar standing open with a clean hollow " +
    "neckline that shows the interior, hem falling naturally. For any garment with sleeves, construct the sleeves " +
    "as if naturally supported by invisible arms: clear internal volume, hollow tubular structure, a subtle bend " +
    "around the elbow, cuffs preserving a realistic circular opening, and natural spacing between the sleeves and " +
    "the torso. The sleeves must never look flat, collapsed, empty or stuck against the body. Preserve the " +
    "garment's original sleeve length, width, cuffs, seams, fabric texture, construction and proportions. " +
    "COMPLETELY remove every human part — no face, no hair, no skin, no hands, no neck, no mannequin pieces " +
    "anywhere in the frame. The result must read as professional e-commerce ghost mannequin photography: " +
    "symmetrical, structured, dimensional, clean and naturally shaped by an invisible human form.";

/** Refiner disiplinini sahne tipine göre prompt'un sonuna ekler. */
function applyKitRefinerContract(prompt, sceneType) {
    const base = String(prompt || "").trim();
    if (sceneType === "detail") {
        return `${base}\n\n${KIT_PRODUCT_PRESERVATION_SUFFIX}${KIT_BACKGROUND_FIDELITY_SUFFIX}${KIT_MACRO_SUFFIX}`;
    }
    if (sceneType === "ghost") {
        return `${base}\n\n${KIT_PRODUCT_PRESERVATION_SUFFIX}${KIT_BACKGROUND_FIDELITY_SUFFIX}${KIT_GHOST_SUFFIX}`;
    }
    return base;
}

// ─── Fal.ai GPT Image 2 Edit API call (detail + ghost sahneleri için) ───
async function callFalAiGptImage2ForKit(prompt, resultImageUrl, referenceImageUrl, userId, maxRetries = 2) {
    // GPT Image 2'nin 3:1 aspect constraint'i — input resimleri pad'le
    const sanitizedUrls = await ensureMaxAspectRatio3to1ForKitInput(
        [resultImageUrl, referenceImageUrl],
        userId
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [KIT_V2_GPT2] attempt ${attempt}/${maxRetries}, images: ${sanitizedUrls.length}`);

            const { request_id } = await fal.queue.submit("openai/gpt-image-2/edit", {
                input: {
                    prompt: prompt,
                    image_urls: sanitizedUrls,
                    image_size: "portrait_16_9", // 9:16 dikey (detail + ghost default)
                    quality: "medium",
                    num_images: 1,
                    output_format: "jpeg",
                },
            });

            if (!request_id) throw new Error("Fal.ai did not return a request_id");
            console.log(`⏳ [KIT_V2_GPT2] Request submitted, request_id: ${request_id}`);

            const maxPolls = 60;
            for (let poll = 0; poll < maxPolls; poll++) {
                const statusResult = await fal.queue.status("openai/gpt-image-2/edit", {
                    requestId: request_id,
                    logs: false,
                });

                if (statusResult.status === "COMPLETED") {
                    const finalResult = await fal.queue.result("openai/gpt-image-2/edit", {
                        requestId: request_id,
                    });
                    if (finalResult.data?.images?.length > 0) {
                        console.log(`✅ [KIT_V2_GPT2] Image generated successfully`);
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
            console.error(`❌ [KIT_V2_GPT2] Attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
    }
}

// ─── Replicate GPT Image 1.5 Edit API call ───
async function callReplicateGptImageEdit(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3) {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN environment variable is not set");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [KIT_V2] Image generation attempt ${attempt}/${maxRetries}`);

            const response = await axios.post(
                "https://api.replicate.com/v1/models/openai/gpt-image-1.5/predictions",
                {
                    input: {
                        prompt: prompt,
                        input_images: [resultImageUrl, referenceImageUrl],
                        aspect_ratio: "2:3",
                        quality: "low",
                        number_of_images: 1,
                    }
                },
                {
                    headers: {
                        "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 30000,
                }
            );

            const prediction = response.data;
            if (!prediction.id) throw new Error("Replicate did not return a prediction ID");

            console.log(`⏳ [KIT_V2] Prediction created, id: ${prediction.id}`);

            let maxPolls = 60;
            for (let poll = 0; poll < maxPolls; poll++) {
                const statusResponse = await axios.get(
                    `https://api.replicate.com/v1/predictions/${prediction.id}`,
                    {
                        headers: { "Authorization": `Bearer ${REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
                        timeout: 30000,
                    }
                );

                const result = statusResponse.data;
                if (result.status === "succeeded") {
                    const output = result.output;
                    if (output) {
                        const imageUrl = Array.isArray(output) ? output[0] : output;
                        if (imageUrl) {
                            console.log(`✅ [KIT_V2] Image generated successfully`);
                            return imageUrl;
                        }
                    }
                    throw new Error("No image URL in succeeded result");
                }

                if (result.status === "failed" || result.status === "canceled") {
                    throw new Error(`Replicate prediction ${result.status}: ${result.error || "unknown error"}`);
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            throw new Error("Replicate GPT Image polling timeout");
        } catch (error) {
            console.error(`❌ [KIT_V2] Attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// ─── Fal.ai Nano Banana 2 API call with fallback (nano-banana-2 → nano-banana-pro) ───
async function callNanoBanana2(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3, aspectRatio = "9:16") {
    const FAL_API_KEY = process.env.FAL_API_KEY;
    if (!FAL_API_KEY) throw new Error("FAL_API_KEY environment variable is not set");

    const legacyMap = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
    const resolvedAspectRatio = legacyMap[aspectRatio] || aspectRatio || "2:3";

    const models = [
        { name: "nano-banana-2", url: "https://fal.run/fal-ai/nano-banana-2/edit" },
        { name: "nano-banana-pro", url: "https://fal.run/fal-ai/nano-banana-pro/edit" },
    ];

    for (const model of models) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🍌 [KIT_V2_FAL] ${model.name} attempt ${attempt}/${maxRetries}`);

                const response = await axios.post(
                    model.url,
                    {
                        prompt: prompt,
                        image_urls: [resultImageUrl, referenceImageUrl],
                        aspect_ratio: resolvedAspectRatio,
                        resolution: "1K",
                        output_format: "jpeg",
                        safety_tolerance: "6",
                        num_images: 1,
                    },
                    {
                        headers: {
                            "Authorization": `Key ${FAL_API_KEY}`,
                            "Content-Type": "application/json",
                        },
                        timeout: 300000, // 5 min — fal.run is synchronous
                    }
                );

                const output = response.data;
                if (output.images && output.images.length > 0 && output.images[0].url) {
                    console.log(`✅ [KIT_V2_FAL] ${model.name} image generated successfully`);
                    return output.images[0].url;
                }

                throw new Error("No image URL in Fal.ai response");
            } catch (error) {
                const errMsg = error.response?.data?.detail || error.message || "unknown error";
                console.error(`❌ [KIT_V2_FAL] ${model.name} attempt ${attempt} failed:`, errMsg);
                const isCapacityError = typeof errMsg === "string" && (errMsg.includes("E003") || errMsg.includes("unavailable") || errMsg.includes("capacity") || errMsg.includes("overloaded"));
                if (isCapacityError) {
                    console.log(`⚡ [KIT_V2_FAL] ${model.name} capacity error, skipping to fallback immediately`);
                    break;
                }
                if (attempt === maxRetries) break;
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        console.log(`⚠️ [KIT_V2_FAL] ${model.name} failed, trying next model...`);
    }

    throw new Error("All Nano Banana models failed on Fal.ai (nano-banana-2 and nano-banana-pro)");
}

// Scene dağılımı:
//   0, 1 (pose1, pose2), 2, 3 (studio1, studio2) → Nano Banana 2 (fal.ai)
//   4 (detail), 5 (ghost) → GPT Image 2 (fal.ai)
const nanoBanana2Scenes = new Set([0, 1, 2, 3]); // pose1, pose2, studio1, studio2

// ─── Save generated image to user bucket ───
async function saveGeneratedImageToUserBucket(imageUrl, userId, imageType) {
    try {
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 });
        const imageBuffer = Buffer.from(imageResponse.data);

        const fileName = `${userId}/${Date.now()}_productkit_${imageType}_${uuidv4().substring(0, 8)}.jpg`;
        const { error } = await supabase.storage.from("user_image_results").upload(fileName, imageBuffer, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
        });

        if (error) return imageUrl;

        const { data: urlData } = supabase.storage.from("user_image_results").getPublicUrl(fileName);
        return urlData.publicUrl;
    } catch (error) {
        console.error(`❌ [KIT_V2_SAVE] Error:`, error.message);
        return imageUrl;
    }
}

const { resolveCanonicalGenerationId } = require("../utils/canonicalGenerationId");

// ─── Progressive save: append a single kit image URL to reference_results.kits ───
// 🔁 Retry'lı: geçici ağ hataları (fetch failed / stream aborted) kit slotunu
// kaybettirmesin. "Kayıt gerçekten yok" ile "sorgu ağ hatasıyla düştü" ayrı loglanır.
async function appendKitToRecord(recordId, imageUrl, sceneIndex) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const { data: existing, error: findError } = await supabase
                .from("reference_results")
                .select("id, kits")
                .eq("generation_id", recordId)
                .maybeSingle();

            if (findError) throw new Error(`lookup failed: ${findError.message}`);

            if (!existing) {
                console.warn(`⚠️ [APPEND_KIT] reference_results'ta kayıt GERÇEKTEN yok (recordId=${recordId}) — kit slot ${sceneIndex} polling'e görünmeyecek`);
                return null; // kayıt yoksa retry anlamsız
            }

            // Maintain position-preserved array (6 slots, null for pending/failed)
            let currentKits = Array.isArray(existing.kits) ? [...existing.kits] : [];

            if (sceneIndex !== undefined && sceneIndex !== null) {
                // Ensure array is at least sceneIndex+1 long
                while (currentKits.length <= sceneIndex) currentKits.push(null);
                currentKits[sceneIndex] = imageUrl;
            } else {
                // Legacy fallback: append
                if (currentKits.includes(imageUrl)) return null;
                currentKits.push(imageUrl);
            }

            const { error: updateError } = await supabase
                .from("reference_results")
                .update({ kits: currentKits })
                .eq("id", existing.id);

            if (updateError) throw new Error(`update failed: ${updateError.message}`);

            const filledCount = currentKits.filter(Boolean).length;
            console.log(`📦 [KIT_V2] Progressive save: ${filledCount} kits now in DB (slot ${sceneIndex ?? 'append'})`);
            return currentKits;
        } catch (error) {
            if (attempt === MAX_ATTEMPTS) {
                console.error(`❌ [APPEND_KIT] ${MAX_ATTEMPTS} deneme başarısız (recordId=${recordId}, slot ${sceneIndex}) — muhtemel geçici ağ hatası: ${error.message}`);
                return null;
            }
            console.warn(`🔁 [APPEND_KIT] attempt ${attempt} failed (${error.message}) — ${attempt}sn sonra tekrar...`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
    }
    return null;
}

// ─── Parse Gemini response to extract prompts (JSON format) ───
function parseGeminiPrompts(geminiResponse) {
    const prompts = {
        changePose1: null, changePose2: null, detailShot: null,
        studio1: null, studio2: null, ghostMannequin: null
    };

    try {
        // Strip markdown code blocks if Gemini wraps in ```json ... ```
        let cleaned = geminiResponse.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

        // Try JSON parse first
        const json = JSON.parse(cleaned);
        prompts.changePose1 = json.change_pose_1 || null;
        prompts.changePose2 = json.change_pose_2 || null;
        prompts.detailShot = json.detail_shot || null;
        prompts.studio1 = json.studio_1 || null;
        prompts.studio2 = json.studio_2 || null;
        prompts.ghostMannequin = json.ghost_mannequin || null;

        console.log("✅ [KIT_V2_PARSE] JSON parsed successfully");
    } catch (jsonError) {
        console.warn("⚠️ [KIT_V2_PARSE] JSON parse failed, trying regex fallback:", jsonError.message);

        // Fallback: try to extract JSON from response text
        try {
            const jsonMatch = geminiResponse.match(/\{[\s\S]*"change_pose_1"[\s\S]*\}/);
            if (jsonMatch) {
                const json = JSON.parse(jsonMatch[0]);
                prompts.changePose1 = json.change_pose_1 || null;
                prompts.changePose2 = json.change_pose_2 || null;
                prompts.detailShot = json.detail_shot || null;
                prompts.studio1 = json.studio_1 || null;
                prompts.studio2 = json.studio_2 || null;
                prompts.ghostMannequin = json.ghost_mannequin || null;
                console.log("✅ [KIT_V2_PARSE] JSON extracted from text successfully");
            } else {
                // Last resort: old regex parsing with ** markdown support
                const cp1 = geminiResponse.match(/\*?\*?Change_Pose_1_Prompt:?\*?\*?\s*(.+?)(?=\n\*?\*?Change_Pose_2|$)/is);
                if (cp1) prompts.changePose1 = cp1[1].trim();
                const cp2 = geminiResponse.match(/\*?\*?Change_Pose_2_Prompt:?\*?\*?\s*(.+?)(?=\n\*?\*?Detail_Shot|$)/is);
                if (cp2) prompts.changePose2 = cp2[1].trim();
                const det = geminiResponse.match(/\*?\*?Detail_Shot_Prompt:?\*?\*?\s*(.+?)(?=\n\*?\*?Studio_1|$)/is);
                if (det) prompts.detailShot = det[1].trim();
                const st1 = geminiResponse.match(/\*?\*?Studio_1_Prompt:?\*?\*?\s*(.+?)(?=\n\*?\*?Studio_2|$)/is);
                if (st1) prompts.studio1 = st1[1].trim();
                const st2 = geminiResponse.match(/\*?\*?Studio_2_Prompt:?\*?\*?\s*(.+?)(?=\n\*?\*?Ghost_Mannequin|$)/is);
                if (st2) prompts.studio2 = st2[1].trim();
                const gh = geminiResponse.match(/\*?\*?Ghost_Mannequin_Prompt:?\*?\*?\s*(.+?)$/is);
                if (gh) prompts.ghostMannequin = gh[1].trim();
                console.log("✅ [KIT_V2_PARSE] Regex fallback used");
            }
        } catch (fallbackError) {
            console.error("❌ [KIT_V2_PARSE] All parsing failed:", fallbackError.message);
        }
    }

    return prompts;
}

// ─── Save product kit to database ───
async function saveProductKitToDatabase({ userId, generationId, originalPhotos, kitImages, processingTimeSeconds, creditsUsed, isFreeTier }) {
    try {
        if (!userId || !generationId) return null;

        const { data, error } = await supabase
            .from("product_kits")
            .insert({
                user_id: userId,
                generation_id: generationId,
                original_photos: originalPhotos || [],
                kit_images: kitImages || [],
                processing_time_seconds: processingTimeSeconds,
                total_images_generated: kitImages?.length || 0,
                credits_used: creditsUsed,
                is_free_tier: isFreeTier
            })
            .select()
            .single();

        if (error) {
            console.error("❌ [KIT_V2_DB] Insert error:", error);
            return null;
        }
        console.log("✅ [KIT_V2_DB] Product kit saved, ID:", data.id);
        return data;
    } catch (error) {
        console.error("❌ [KIT_V2_DB] Error:", error.message);
        return null;
    }
}

// ─── Increment E-commerce Kit count ───
async function incrementEcommerceKitCount(userId) {
    if (!userId) return;
    try {
        const { data, error: selectError } = await supabase
            .from("user_ecommerce_stats")
            .select("ecommerce_kit_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (selectError) throw selectError;

        const newCount = (data?.ecommerce_kit_count || 0) + 1;
        const { error: upsertError } = await supabase
            .from("user_ecommerce_stats")
            .upsert({ user_id: userId, ecommerce_kit_count: newCount, updated_at: new Date().toISOString() });

        if (upsertError) throw upsertError;
        console.log(`✅ [KIT_V2_STATS] New count: ${newCount}`);
    } catch (error) {
        console.error("❌ [KIT_V2_STATS] Error:", error.message);
    }
}

// ─── Credit helpers ───
async function checkUserBalance(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;
    try {
        const { data: user, error } = await supabase.from("users").select("credit_balance").eq("id", userId).single();
        if (error || !user) return false;
        return (user.credit_balance || 0) >= cost;
    } catch (error) { return false; }
}

async function deductUserCredit(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;
    try {
        const { error } = await supabase.rpc("deduct_user_credit", { user_id: userId, credit_amount: cost });
        if (error) return false;
        return true;
    } catch (error) { return false; }
}

async function getUserKitCount(userId) {
    if (!userId || userId === "anonymous_user") return 0;
    try {
        const { data, error } = await supabase.from("user_ecommerce_stats").select("ecommerce_kit_count").eq("user_id", userId).maybeSingle();
        if (error) return 0;
        return data?.ecommerce_kit_count || 0;
    } catch (error) { return 0; }
}

// ─── Default prompts (fallbacks) ───
const defaultPrompts = {
    changePose1: "transform to dynamic high-fashion pose with energetic movement, natural lively stance, preserve all garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.",
    changePose2: "transform to different energetic model pose, vibrant dynamic movement, fashion-forward stance, preserve garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.",
    studio1: "transform to professional standing studio shot, pure white background #FFFFFF, professional indoor studio lighting - remove outdoor natural light completely, soft diffused artificial studio lights, high-fashion e-commerce style. Apply a clean editorial color preset with natural tones.",
    studio2: "transform to close-up medium shot on pure white background #FFFFFF, model actively showcasing a specific garment detail — pulling fabric to show stretch, adjusting a zipper, holding a collar, or demonstrating a feature. Camera zoomed in tight on the torso/detail area. Professional studio lighting, product feature demonstration style like Organic Basics or Lululemon close-ups.",
    detailShot: "transform into a true macro photograph of the single most commercially valuable detail of this exact product — the weave or grain of the material, the stitching and seam work, the collar or cuff construction, the zipper, button, label or hardware, whichever genuinely sells this piece. The camera moves physically close with a 100mm macro lens at f/2.8–f/4 and that area fills the frame; the rest of the product may fall outside the crop or out of focus. Real macro optics, never a digital zoom of the source. Preserve the original colour, pattern, texture and every detail identically; do NOT alter or redesign the product in any way. Soft directional side-lighting, true-to-life colour, no filters.",
    ghostMannequin: "transform to professional ghost mannequin product photo: completely remove all human parts - no face, no hair, no skin, no hands, no neck, no mannequin pieces. The garment is filled by an invisible body and holds full three-dimensional form: shoulders shaped, chest with real depth, collar standing open with a clean hollow neckline showing the interior, hem falling naturally, and sleeves carrying hollow tubular volume with a soft bend at the elbow and cuffs keeping their round opening, held slightly away from the torso — never flat or collapsed. Preserve all fabric details, texture, print placement, seams and proportions, pure white background #FFFFFF no shadows, centered, Amazon e-commerce catalog standard. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."
};

// ═══════════════════════════════════════════════════════════════
// POST /api/generate-product-kit-v2
// Progressive generation: each scene saved to DB as it completes
// ═══════════════════════════════════════════════════════════════
router.post("/generate-product-kit-v2", async (req, res) => {
    const startTime = Date.now();

    try {
        const { imageUrl, recordId, userId, teamAware } = req.body;

        console.log(`🎨 [KIT_V2] Request received for URL: ${imageUrl?.substring(0, 50)}...`);
        console.log(`🎨 [KIT_V2] Record ID: ${recordId}, User ID: ${userId}`);

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        // Team-aware credit resolution
        let creditOwnerId = userId;
        let isTeamCredit = false;

        if (teamAware && userId && userId !== "anonymous_user") {
            const effectiveCredits = await teamService.getEffectiveCredits(userId);
            creditOwnerId = effectiveCredits.creditOwnerId;
            isTeamCredit = effectiveCredits.isTeamCredit;
        }

        // Determine kit cost based on user registration date
        const kitCost = await getKitCostForUser(creditOwnerId);
        console.log(`💰 [KIT_V2] Kit cost for user: ${kitCost} credits`);

        // Free tier check
        let isFree = false;
        if (creditOwnerId && creditOwnerId !== "anonymous_user") {
            const kitCount = await getUserKitCount(creditOwnerId);
            if (kitCount < FREE_TIER_LIMIT) {
                isFree = true;
                console.log("🎁 [KIT_V2] Within FREE TIER. No credits will be deducted.");
            }
        }

        // Credit balance check
        if (!isFree && creditOwnerId && creditOwnerId !== "anonymous_user") {
            const hasEnoughCredits = await checkUserBalance(creditOwnerId, kitCost);
            if (!hasEnoughCredits) {
                return res.status(402).json({
                    success: false,
                    error: "INSUFFICIENT_CREDITS",
                    message: "You do not have enough credits to generate a kit."
                });
            }
        }

        // Album'den açılan item'larda recordId v5 UUID olabiliyor; URL fallback ile
        // gerçek generation_id'yi resolve ediyoruz, kits her durumda doğru kayda yazılır.
        const canonicalRecordId = await resolveCanonicalGenerationId(recordId, imageUrl);
        if (canonicalRecordId !== recordId) {
            console.log(`🔄 [KIT_V2] Using canonical record ID: ${canonicalRecordId} (was: ${recordId})`);
        }

        // Clear existing kits (set to empty array so client knows generation started)
        if (canonicalRecordId) {
            console.log(`🧹 [KIT_V2] Clearing existing kits for record: ${canonicalRecordId}`);
            await supabase
                .from("reference_results")
                .update({ kits: [] })
                .eq("generation_id", canonicalRecordId);
        }

        // Respond immediately — generation happens in background
        // generationId döndürürken canonical olanı veriyoruz; client polling'te kullanabilir
        res.json({ success: true, message: "Kit generation started", generationId: canonicalRecordId, originalRecordId: recordId });

        // ─── Background generation ───
        (async () => {
            try {
                // Step 1: Generate prompts with Gemini
                console.log("📝 [KIT_V2] Step 1: Generating prompts with Gemini...");

                const geminiPrompt = `You are an elite fashion e-commerce photographer and creative director. Analyze the following product image and generate 6 professional prompts for fashion e-commerce photography.
All prompts MUST be in ENGLISH.

TARGET MODEL CONTEXT: Your prompts will be executed by a state-of-the-art AI image editing model that responds best to flowing NARRATIVE descriptions — connected, specific sentences like a photographer's shoot brief, not keyword lists. Prefer POSITIVE framing: describe what IS in the frame; reserve negations for the safety rules below.

CRITICAL FASHION PHOTOGRAPHY RULES — apply to ALL prompts:
1. THE GARMENT IS THE STAR. Every prompt must keep the garment as the central visual focus. The outfit must be clearly visible, well-lit, and prominent in the frame.
2. NO distant wide-angle shots where the garment details are lost. The garment must always be clearly readable. You are free to choose any framing as long as the outfit remains the hero.
3. Preserve ALL garment details exactly: color, texture, pattern, fit, fabric, stitching, drape.
4. Model poses should be DYNAMIC, CONFIDENT, and EDITORIAL — not stiff catalog poses. Think bold, fashion-forward, expressive.
5. EVERY prompt must produce EXACTLY ONE single photograph. NEVER generate collages, grids, multi-panel layouts, split-screens, side-by-side comparisons, mood boards, or multiple views in one image. One photo per prompt — always.

PROFESSIONAL CAMERA & TECHNICAL DETAILS — include these in EVERY prompt:
- Choose the BEST lens type, focal length, and aperture for each specific scene — you are the expert, pick what works best
- Include depth of field description that serves the scene
- Add shutter speed feel when it enhances the mood
- Describe the lighting setup as a fashion photographer would brief their team
- Choose a fitting film stock, color science, or digital camera aesthetic that matches the scene
- Set the right white balance tone for the atmosphere
Each prompt should have its own unique photographic identity — do NOT repeat the same technical choices.

THERE IS NO WORD LIMIT. Write each prompt as detailed and descriptive as needed. More detail = better results.

CONTENT SAFETY — STRICTLY FOLLOW (prompts will be rejected if violated):
- NEVER describe the model's body, skin, physique, curves, or body shape — describe ONLY the garment and how it fits
- NEVER use words like "revealing", "seductive", "sensual", "sultry", "provocative", "alluring", "sexy", "bare", "exposed", "tight-fitting on body", "clinging to curves", "showing skin", "low-cut"
- NEVER describe cleavage, legs, thighs, midriff, shoulders as focal points — if visible, describe the GARMENT covering them, not the body parts
- Instead of body-focused language, use GARMENT-focused language: "the blazer's structured shoulders", "the dress falls elegantly", "relaxed oversized silhouette"
- NO alcohol, bars, cocktails, drinks, smoking, drugs, nightclub references
- ALL descriptions must be professional fashion catalog language — the kind used by Zara, H&M, or Net-a-Porter
- When describing model poses, use fashion terminology: "contrapposto stance", "editorial lean", "three-quarter turn" — NOT body-descriptive language
- Keep everything family-friendly and safe for AI image generation content moderation systems

─── SCENE TYPES ───

1, 2) Change Pose (Editorial) – 2 Prompts:
Generate 2 distinct ENERGETIC editorial pose prompts with dynamic movement.
- Each pose MUST be completely DIFFERENT from the other
- Bold, confident, fashion-forward energy
- Natural, lively, high-fashion editorial feel
- Describe specific pose details (hand placement, body angle, expression, attitude)
- Include professional fashion color grading
- CRITICAL: PRESERVE the original environment/location/background from the source image. The model's surroundings, setting, and backdrop must remain the same — only the pose changes. Do NOT invent a new location or background.

3) Product Detail Shot (True Macro) – 1 Prompt:
A true macro photograph of the single most commercially valuable detail of THIS specific product.
- First decide silently WHICH area actually sells this product — the weave or grain of the material, the collar or cuff construction, the stitching and seam work, the zipper or button, the label or logo embossing, the print at its sharpest point, the hardware — then close in on THAT area and let it fill the frame.
- This is a REAL macro shot taken on set with a macro lens (100mm, f/2.8–f/4), NOT a digital zoom and NOT an upscaled crop of the source image. The camera physically moves close; the rest of the product may fall outside the crop or out of the plane of focus.
- CRITICAL: PRESERVE THE EXACT ORIGINAL PRODUCT. Colour, pattern, texture, stitching, design, logo and every visual detail stay 100% identical to the source image. Do NOT alter, reinterpret, redesign or reimagine anything, and do not invent details that are not visible in the source.
- Describe the craftsmanship concretely: genuine material texture, believable micro-reflections, crisp micro-detail on thread, grain, seam construction, button edges, zipper teeth, label embossing.
- The frame must be unmistakably a DIFFERENT photograph from the source: a different viewing angle, a different rotation of the product relative to the lens, a different camera height and a much closer camera distance, with physically coherent perspective and specular highlights for that new viewpoint.
- Professional textile lighting: soft directional side-light that reveals dimension and surface texture. Colour accuracy is CRITICAL — the exact same colour as the original, no shift, no filter.
- The background stays clean and uniform wherever it is visible; never grey, washed-out, gradient or vignetted, and never contaminated by the close camera.

4, 5) Studio Poses (White Background) – 2 Prompts:
Generate 2 white studio prompts. Each prompt must produce EXACTLY ONE single photo of ONE person — NEVER a collage, grid, multi-panel, split-screen, or multiple views. ONE image, ONE pose, ONE person.
- Pure white background (#FFFFFF), PROFESSIONAL STUDIO LIGHTING only
- Studio_1: Classic standing full-body high-fashion pose with editorial attitude
- Studio_2: CLOSE-UP / MEDIUM CLOSE-UP product detail showcase — the model is actively showing off or highlighting a specific feature of the garment (pulling fabric to show stretch, adjusting a zipper, holding a collar, tugging a hem, flipping a pocket, touching a button, demonstrating a hidden compartment). Camera zoomed in tight on the torso/waist/detail area. The model's hands and the garment detail are the hero of the shot — like a product feature demonstration photo. Think: Organic Basics, Girlfriend Collective, or Lululemon product feature close-ups where models show fabric quality, hidden pockets, adjustable straps, etc.
- REMOVE all outdoor/natural daylight. Indoor studio lighting only.
- Describe the studio lighting setup in detail (key light, fill, rim, reflectors)
- CRITICAL: Each prompt generates a SINGLE photograph — NOT a mood board, NOT a lookbook page, NOT multiple angles side by side

6) Ghost Mannequin – 1 Prompt:
Professional AMAZON-STYLE ghost mannequin (invisible mannequin), built the way a real e-commerce studio builds it.
- COMPLETELY remove the model — NO face, NO hair, NO skin, NO hands, NO neck, NO mannequin pieces anywhere.
- The garment is filled by an INVISIBLE body and holds full three-dimensional form: shoulders shaped, chest with real depth, collar standing open with a clean hollow neckline showing the interior, hem falling naturally.
- SLEEVE CONSTRUCTION (state this explicitly): sleeves are supported by invisible arms — clear internal volume, hollow tubular structure, a subtle bend at the elbow, cuffs keeping a realistic circular opening, natural spacing between the sleeves and the torso. Sleeves must never look flat, collapsed, empty or stuck against the body.
- Preserve the garment's original colour, fabric, weave, print placement, sleeve length and width, cuffs, seams, construction and proportions exactly as in the source image.
- Pure white background (#FFFFFF), even and seamless edge to edge — NO shadows, NO reflections, no gradient, no vignette.
- Centred, catalog-ready, Amazon e-commerce standard, even diffused studio lighting.

Start each prompt with "transform".

CRITICAL: Respond ONLY with a valid JSON object. No markdown, no code blocks, no extra text. Just pure JSON in this EXACT structure:
{"change_pose_1":"transform ...","change_pose_2":"transform ...","detail_shot":"transform ...","studio_1":"transform ...","studio_2":"transform ...","ghost_mannequin":"transform ..."}
`;

                // Optimize image before sending to Gemini (compress if > 7MB)
                const geminiImageUrl = await getOptimizedImageUrl(imageUrl);
                const geminiResponse = await callGeminiFlash(geminiPrompt, [geminiImageUrl]);
                console.log("✅ [KIT_V2] Gemini response received");

                const prompts = parseGeminiPrompts(geminiResponse);

                // Step 2: Get reference image
                let referenceImageUrl = imageUrl;
                if (canonicalRecordId) {
                    const { data: record } = await supabase
                        .from("reference_results")
                        .select("reference_images")
                        .eq("generation_id", canonicalRecordId)
                        .maybeSingle();

                    if (record?.reference_images?.length > 0) {
                        referenceImageUrl = record.reference_images[0];
                    }
                }

                // Step 3: Optimize images
                const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
                const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

                // Step 4: Generate images in parallel — save each progressively
                const imagePrompts = [
                    prompts.changePose1 || defaultPrompts.changePose1,
                    prompts.changePose2 || defaultPrompts.changePose2,
                    prompts.studio1 || defaultPrompts.studio1,
                    prompts.studio2 || defaultPrompts.studio2,
                    prompts.detailShot || defaultPrompts.detailShot,
                    prompts.ghostMannequin || defaultPrompts.ghostMannequin,
                ];

                const imageGenerationPromises = imagePrompts.map(async (rawPrompt, index) => {
                    try {
                        // 🧩 detail + ghost sahneleri Refiner sözleşmesini alır
                        // (kimlik korunumu + zemin sadakati + makro/hayalet inşası).
                        const prompt = applyKitRefinerContract(rawPrompt, sceneTypes[index]);
                        const useNanoBanana = nanoBanana2Scenes.has(index);
                        console.log(`🎨 [KIT_V2] Generating ${sceneTypes[index]} via ${useNanoBanana ? 'Nano Banana 2' : 'GPT Image 2 (fal.ai, 9:16)'}...`);
                        const generatedUrl = useNanoBanana
                            ? await callNanoBanana2(prompt, optimizedResultUrl, optimizedReferenceUrl)
                            : await callFalAiGptImage2ForKit(prompt, optimizedResultUrl, optimizedReferenceUrl, userId);

                        const savedUrl = await saveGeneratedImageToUserBucket(
                            generatedUrl,
                            userId || "anonymous",
                            sceneTypes[index]
                        );

                        // Progressive save: immediately save to DB at correct position
                        if (savedUrl && canonicalRecordId) {
                            try {
                                const result = await appendKitToRecord(canonicalRecordId, savedUrl, index);
                                if (result === null) {
                                    console.warn(`⚠️ [KIT_V2] Scene ${index + 1} (${sceneTypes[index]}) — no reference_results row matched generation_id=${canonicalRecordId}`);
                                } else {
                                    console.log(`📦 [KIT_V2] Scene ${index + 1} (${sceneTypes[index]}) saved progressively at slot ${index}`);
                                }
                            } catch (e) {
                                console.warn(`⚠️ [KIT_V2] Progressive save failed for scene ${index + 1}:`, e.message);
                            }
                        }

                        return { type: sceneTypes[index], url: savedUrl, prompt: prompt };
                    } catch (error) {
                        console.error(`❌ [KIT_V2] Error generating ${sceneTypes[index]}:`, error.message);
                        return { type: sceneTypes[index], url: null, error: error.message };
                    }
                });

                const results = await Promise.all(imageGenerationPromises);

                const generatedImages = results.filter(r => r.url).map(r => r.url);
                const processingTime = (Date.now() - startTime) / 1000;
                console.log(`✅ [KIT_V2] Generation completed in ${processingTime.toFixed(1)}s — ${generatedImages.length}/6 images`);

                // Step 5: Save to product_kits table
                if (generatedImages.length > 0 && userId && userId !== "anonymous_user") {
                    const originalPhotos = [imageUrl];
                    if (referenceImageUrl && referenceImageUrl !== imageUrl) originalPhotos.push(referenceImageUrl);

                    const kitImagesData = results.filter(r => r.url).map(r => ({
                        type: r.type, url: r.url, prompt: r.prompt || null
                    }));

                    await saveProductKitToDatabase({
                        userId, generationId: canonicalRecordId, originalPhotos,
                        kitImages: kitImagesData, processingTimeSeconds: processingTime,
                        creditsUsed: isFree ? 0 : kitCost, isFreeTier: isFree
                    });
                }

                // Step 6: Increment stats
                if (generatedImages.length > 0 && creditOwnerId) {
                    await incrementEcommerceKitCount(creditOwnerId);
                }

                // Step 7: Deduct credits
                if (!isFree && generatedImages.length > 0 && creditOwnerId && creditOwnerId !== "anonymous_user") {
                    const deducted = await deductUserCredit(creditOwnerId, kitCost);
                    if (!deducted) console.error("❌ [KIT_V2] Credit deduction failed!");
                }

            } catch (error) {
                console.error("❌ [KIT_V2] Background generation error:", error.message);
            }
        })();

    } catch (error) {
        console.error("❌ [KIT_V2] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/retry-kit-scene
// Retry a single failed scene
// ═══════════════════════════════════════════════════════════════
router.post("/retry-kit-scene", async (req, res) => {
    const startTime = Date.now();
    try {
        const { imageUrl, recordId, userId, sceneIndex } = req.body;

        if (!imageUrl || sceneIndex === undefined || sceneIndex === null) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const sceneType = sceneTypes[sceneIndex];
        if (!sceneType) {
            return res.status(400).json({ success: false, error: "Invalid sceneIndex" });
        }

        // Modal bir pose varyantındayken eski client'lar varyant ID'sini
        // gönderebilir. Kit slotu her zaman ana reference_results kaydına yazılır.
        const canonicalRecordId = await resolveCanonicalGenerationId(recordId, imageUrl);
        if (!canonicalRecordId) {
            throw new Error("Canonical generation record could not be resolved");
        }

        console.log(`🔄 [KIT_V2_RETRY] Retrying scene ${sceneIndex} (${sceneType}) for record: ${canonicalRecordId}`);

        // Get reference image
        let referenceImageUrl = imageUrl;
        if (canonicalRecordId) {
            const { data: record } = await supabase
                .from("reference_results")
                .select("reference_images")
                .eq("generation_id", canonicalRecordId)
                .maybeSingle();

            if (record?.reference_images?.length > 0) {
                referenceImageUrl = record.reference_images[0];
            }
        }

        // Optimize images
        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        // Use default prompt for the scene type
        const promptMap = {
            0: defaultPrompts.changePose1,
            1: defaultPrompts.changePose2,
            2: defaultPrompts.studio1,
            3: defaultPrompts.studio2,
            4: defaultPrompts.detailShot,
            5: defaultPrompts.ghostMannequin,
        };
        // 🧩 detail + ghost burada da Refiner sözleşmesini alır — yeniden
        // deneme yolu ana akıştan ayrı, atlanırsa iki kalite ortaya çıkardı.
        const prompt = applyKitRefinerContract(
            promptMap[sceneIndex] || defaultPrompts.changePose1,
            sceneType,
        );

        // Generate the image — pose1/pose2/studio1/studio2 → Nano Banana 2, detail/ghost → GPT Image 2 (fal.ai, 9:16)
        const useNanoBanana = nanoBanana2Scenes.has(sceneIndex);
        console.log(`🔄 [KIT_V2_RETRY] Using ${useNanoBanana ? 'Nano Banana 2' : 'GPT Image 2 (fal.ai, 9:16)'} for scene ${sceneIndex} (${sceneType})`);
        const generatedUrl = useNanoBanana
            ? await callNanoBanana2(prompt, optimizedResultUrl, optimizedReferenceUrl)
            : await callFalAiGptImage2ForKit(prompt, optimizedResultUrl, optimizedReferenceUrl, userId);
        const savedUrl = await saveGeneratedImageToUserBucket(generatedUrl, userId || "anonymous", sceneType);

        // Save to reference_results.kits at correct position
        if (savedUrl && canonicalRecordId) {
            const persistedKits = await appendKitToRecord(
                canonicalRecordId,
                savedUrl,
                sceneIndex,
            );
            if (!persistedKits) {
                throw new Error("Retried kit scene could not be persisted");
            }
        }

        // Also update product_kits table
        if (savedUrl && userId && userId !== "anonymous_user") {
            const { data: existingKit } = await supabase
                .from("product_kits")
                .select("id, kit_images")
                .eq("generation_id", canonicalRecordId)
                .maybeSingle();

            if (existingKit) {
                const currentImages = Array.isArray(existingKit.kit_images) ? existingKit.kit_images : [];
                currentImages.push({ type: sceneType, url: savedUrl, prompt: prompt });
                await supabase
                    .from("product_kits")
                    .update({ kit_images: currentImages, total_images_generated: currentImages.length })
                    .eq("id", existingKit.id);
            }
        }

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [KIT_V2_RETRY] Scene ${sceneIndex} retried in ${processingTime.toFixed(1)}s`);

        res.json({
            success: true,
            url: savedUrl,
            sceneIndex: sceneIndex,
            sceneType: sceneType,
            processingTimeSeconds: processingTime
        });

    } catch (error) {
        console.error("❌ [KIT_V2_RETRY] Error:", error.message);
        const isSensitive = error.message && (error.message.includes("flagged") || error.message.includes("sensitive"));
        res.status(isSensitive ? 422 : 500).json({
            success: false,
            error: error.message,
            errorCode: isSensitive ? "CONTENT_FLAGGED" : "GENERATION_FAILED"
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/ecommerce-stats-v2/:userId
// ═══════════════════════════════════════════════════════════════
router.get("/ecommerce-stats-v2/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const teamAware = req.query.teamAware === 'true';

        let effectiveUserId = userId;
        let isTeamData = false;

        if (teamAware && userId && userId !== "anonymous_user") {
            const { creditOwnerId, isTeamCredit } = await teamService.getEffectiveCredits(userId);
            effectiveUserId = creditOwnerId;
            isTeamData = isTeamCredit;
        }

        const { data, error } = await supabase
            .from("user_ecommerce_stats")
            .select("ecommerce_kit_count")
            .eq("user_id", effectiveUserId)
            .maybeSingle();

        if (error) throw error;

        // Get kit cost for this user
        const kitCost = await getKitCostForUser(effectiveUserId);

        res.json({ success: true, count: data?.ecommerce_kit_count || 0, isTeamData, kitCost });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/user-kits-v2/:userId
// ═══════════════════════════════════════════════════════════════
router.get("/user-kits-v2/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

        const { data, error, count } = await supabase
            .from("product_kits")
            .select("*", { count: "exact" })
            .in("user_id", memberIds)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            success: true,
            kits: optimizeKitImages(data || []),
            totalCount: count || 0,
            hasMore: (offset + limit) < (count || 0),
            isTeamData: isTeamMember
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
