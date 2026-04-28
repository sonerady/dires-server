const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const teamService = require("../services/teamService");

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

// @fal-ai/client for GPT Image 2 (queue-based edit API)
const { fal } = require("@fal-ai/client");
fal.config({ credentials: process.env.FAL_API_KEY });

// ─── GPT Image 2 helpers (same pattern as V7 referenceBrowserRoutes) ──────────
function mapRatioToGptImage2Size(ratio) {
    const mapping = {
        "21:9": "landscape_16_9",
        "16:9": "landscape_16_9",
        "3:2": "landscape_4_3",
        "4:3": "landscape_4_3",
        "5:4": "landscape_4_3",
        "1:1": "square_hd",
        "4:5": "portrait_4_3",
        "3:4": "portrait_4_3",
        "2:3": "portrait_4_3",
        "9:16": "portrait_16_9",
    };
    return mapping[ratio] || "portrait_16_9"; // default 9:16 — street icon is vertical editorial
}

// GPT Image 2 rejects input images with aspect ratio > 3:1 (even close like 2.997).
// Trigger 2.9, target 2.5 for safety buffer. Pads the short edge with white.
async function ensureMaxAspectRatio3to1ForInput(imageUrls, userId) {
    const TRIGGER_RATIO = 2.9;
    const TARGET_RATIO = 2.5;
    const processed = [];

    for (const url of imageUrls || []) {
        if (!url || typeof url !== "string") { processed.push(url); continue; }
        try {
            const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
            const buf = Buffer.from(resp.data);
            const meta = await sharp(buf).metadata();
            const W = meta.width || 0;
            const H = meta.height || 0;
            if (!W || !H) { processed.push(url); continue; }

            const ratio = W >= H ? W / H : H / W;
            if (ratio <= TRIGGER_RATIO) { processed.push(url); continue; }

            console.log(`📐 [STREET_ICON_GPT2] ${W}x${H} (ratio ${ratio.toFixed(3)}:1) > ${TRIGGER_RATIO}:1 — padding to ${TARGET_RATIO}:1`);

            let padTop = 0, padBottom = 0, padLeft = 0, padRight = 0;
            let newW = W, newH = H;
            if (W > H) {
                newH = Math.ceil(W / TARGET_RATIO);
                const pad = newH - H;
                padTop = Math.floor(pad / 2);
                padBottom = pad - padTop;
            } else {
                newW = Math.ceil(H / TARGET_RATIO);
                const pad = newW - W;
                padLeft = Math.floor(pad / 2);
                padRight = pad - padLeft;
            }

            const padded = await sharp(buf)
                .extend({ top: padTop, bottom: padBottom, left: padLeft, right: padRight, background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 90 })
                .toBuffer();

            const timestamp = Date.now();
            const fileName = `temp_optimized/${timestamp}_streetgpt2pad_${userId || "anon"}_${uuidv4().substring(0, 8)}.jpg`;
            const { error: upErr } = await supabase.storage.from("user_image_results").upload(fileName, padded, { contentType: "image/jpeg", upsert: true });
            if (upErr) { console.warn(`❌ [STREET_ICON_GPT2] Pad upload failed:`, upErr.message); processed.push(url); continue; }
            const { data: urlData } = supabase.storage.from("user_image_results").getPublicUrl(fileName);
            console.log(`✅ [STREET_ICON_GPT2] Padded: ${newW}x${newH} → ${urlData.publicUrl}`);
            processed.push(urlData.publicUrl);
        } catch (err) {
            console.warn(`⚠️ [STREET_ICON_GPT2] Preprocess error for ${url.substring(0, 60)}:`, err.message);
            processed.push(url);
        }
    }
    return processed;
}

// Fal.ai GPT Image 2 Edit — queue submit + poll until complete
async function callFalAiGptImage2Edit(prompt, imageUrls, imageSize = "portrait_16_9", maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [STREET_ICON_GPT2] attempt ${attempt}/${maxRetries}, image_size: ${imageSize}, images: ${imageUrls?.length || 0}`);
            console.log(`🎨 [STREET_ICON_GPT2] Prompt: ${prompt.substring(0, 100)}...`);

            const { request_id } = await fal.queue.submit("openai/gpt-image-2/edit", {
                input: {
                    prompt,
                    image_urls: imageUrls,
                    image_size: imageSize,
                    quality: "medium",
                    num_images: 1,
                    output_format: "jpeg",
                },
            });

            if (!request_id) throw new Error("Fal.ai did not return a request_id");
            console.log(`⏳ [STREET_ICON_GPT2] request_id: ${request_id}`);

            const maxPolls = 60;
            for (let poll = 0; poll < maxPolls; poll++) {
                const status = await fal.queue.status("openai/gpt-image-2/edit", { requestId: request_id, logs: false });
                console.log(`⏳ [STREET_ICON_GPT2] poll ${poll + 1}/${maxPolls}: ${status.status}`);

                if (status.status === "COMPLETED") {
                    const final = await fal.queue.result("openai/gpt-image-2/edit", { requestId: request_id });
                    if (final.data?.images?.length > 0) {
                        console.log(`✅ [STREET_ICON_GPT2] Image generated`);
                        return final.data.images[0].url;
                    }
                    throw new Error("No images in completed GPT Image 2 result");
                }
                if (status.status === "FAILED") throw new Error("Fal.ai GPT Image 2 generation failed");
                await new Promise((r) => setTimeout(r, 2000));
            }
            throw new Error("Fal.ai GPT Image 2 polling timeout");
        } catch (error) {
            console.error(`❌ [STREET_ICON_GPT2] attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            const wait = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
}

// ─── Scene definitions ───────────────────────────────────────────────────────
// 6 candid smartphone-style scenes. Locations & poses are GENERATED FRESH per
// garment by Gemini — we don't lock them to any specific city/concept. These
// slot names are just internal DB identifiers.
const SCENE_COUNT = 6;
const SCENE_TYPES = [
    "candidShot1",
    "candidShot2",
    "candidShot3",
    "candidShot4",
    "candidShot5",
    "candidShot6",
];

// Default instructions are intentionally EMPTY — Gemini picks locations + poses
// from scratch each time based on the actual garment. The user can override any
// scene slot via `user_street_icon_preferences` to lock a specific vibe.
const DEFAULT_SCENE_INSTRUCTIONS = ["", "", "", "", "", ""];

// Low-opinion fallbacks used only if Gemini totally fails. Structured
// amateur-smartphone format with NO phone/screen in hands.
const DEFAULT_FALLBACK_PROMPTS = [
    `Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio. Setting: sun-bleached wall of a small local shop with a graffitied metal shutter and worn pavement. Outfit: the exact same garment from the source image, preserving color, texture, pattern, fit, fabric, stitching and drape, naturally worn with realistic fabric folds. Pose: the girl leaning back against the wall with one foot propped up and hands relaxed at her sides, glancing slightly off-camera. Lighting: soft overcast afternoon daylight, gentle diffused shadows. Camera style: slight handheld feel, subtle grain, natural smartphone lens. Composition: full-body, slightly off-center, lived-in background visible. Model styling: minimal makeup, natural skin texture, hair slightly tousled. DO NOT add studio lighting, phones/screens in hands, watermarks, or overly polished skin. Preserve all garment details exactly.`,
    `Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio. Setting: cobblestone alley between old stone buildings with a mailbox and a bicycle leaning nearby. Outfit: the exact same garment from the source image, preserving color, texture, pattern, fit, fabric, stitching and drape, naturally worn with realistic fabric folds. Pose: the girl mid-stride walking past the camera with weight on one leg, looking slightly sideways. Lighting: warm late-afternoon golden sun hitting the stone wall from camera-left. Camera style: slight handheld feel, tiny motion blur in the step, natural smartphone lens, slight grain. Composition: mid-body to full-body, slightly off-center framing. Model styling: minimal makeup, natural skin texture, unexaggerated expression. DO NOT add studio lighting, phones/screens in hands, watermarks, or hyper-smooth skin. Preserve all garment details exactly.`,
    `Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio. Setting: apartment doorway with worn stone steps, a potted plant and textured plaster wall. Outfit: the exact same garment from the source image, preserving color, texture, pattern, fit, fabric, stitching and drape. Pose: the girl sitting on the step with one knee up and a hand resting on it, relaxed and unposed. Lighting: morning natural daylight bouncing off the pavement, soft highlights. Camera style: slight handheld feel, natural smartphone perspective, slight grain, not overly sharp. Composition: three-quarter framing, slightly off-center, lived-in surroundings visible. Model styling: minimal makeup, natural skin texture, calm expression, hair naturally moved. DO NOT add cinematic lighting, phones/screens in hands, watermarks, or overly polished retouching. Preserve all garment details exactly.`,
    `Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio. Setting: quiet side street with parked cars, a crosswalk line in the frame and a lamppost off to the side. Outfit: the exact same garment from the source image, preserving color, texture, pattern, fit, fabric, stitching and drape. Pose: the girl caught stepping off the curb, weight mid-transfer, looking forward, hands free and relaxed. Lighting: flat overcast daylight, even diffused shadows. Camera style: slight handheld feel, subtle motion, natural smartphone lens with a touch of noise. Composition: full-body, slightly off-center, real street depth in the background. Model styling: minimal makeup, natural skin, relaxed expression, slightly tousled hair. DO NOT add studio lighting, phones/screens in hands, exaggerated poses, or watermarks. Preserve all garment details exactly.`,
    `Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio. Setting: small café terrace with a wooden bench, a coffee cup on a saucer nearby and textured concrete floor. Outfit: the exact same garment from the source image, preserving color, texture, pattern, fit, fabric, stitching and drape. Pose: the girl sitting sideways on the bench, one arm resting along the back, gazing off-camera. Lighting: warm window-reflected afternoon light, gentle highlights on the wall. Camera style: slight handheld feel, natural smartphone perspective, slight grain, not hyper-detailed. Composition: mid-body framing, slightly off-center, lived-in café textures in the background. Model styling: minimal makeup, natural skin texture with slight imperfections, hair naturally moved. DO NOT add studio lighting, phones/screens in hands, cinematic grading, or watermarks. Preserve all garment details exactly.`,
    `Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio. Setting: quiet park path lined with low hedges, a wooden bench and a pebbled walkway, autumn leaves scattered nearby. Outfit: the exact same garment from the source image, preserving color, texture, pattern, fit, fabric, stitching and drape. Pose: the girl crouched next to the bench adjusting the cuff of her sleeve, head tilted slightly down, hands busy with the fabric. Lighting: cool cloudy late-morning daylight, soft flat shadows. Camera style: slight handheld feel, natural smartphone perspective, subtle grain. Composition: three-quarter framing, slightly off-center, park depth visible behind. Model styling: minimal makeup, natural skin texture, hair naturally fallen over one shoulder. DO NOT add studio lighting, phones/screens in hands, watermarks, or cinematic retouching. Preserve all garment details exactly.`,
];

// Replicate Gemini Flash API helper
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🤖 [STREET_ICON_GEMINI] API call attempt ${attempt}/${maxRetries}`);

            const requestBody = {
                input: {
                    top_p: 0.9,
                    images: imageUrls,
                    prompt: prompt,
                    videos: [],
                    temperature: 0.85,
                    thinking_level: "low",
                    max_output_tokens: 8192
                }
            };

            const response = await axios.post(
                "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
                requestBody,
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

            if (data.error) {
                throw new Error(data.error);
            }

            if (data.status !== "succeeded") {
                throw new Error(`Prediction failed with status: ${data.status}`);
            }

            let outputText = "";
            if (Array.isArray(data.output)) {
                outputText = data.output.join("");
            } else if (typeof data.output === "string") {
                outputText = data.output;
            }

            if (!outputText || outputText.trim() === "") {
                throw new Error("Replicate Gemini response is empty");
            }

            console.log(`✅ [STREET_ICON_GEMINI] Successful response (attempt ${attempt})`);
            return outputText.trim();

        } catch (error) {
            console.error(`❌ [STREET_ICON_GEMINI] Attempt ${attempt} failed:`, error.message);

            if (attempt === maxRetries) {
                throw error;
            }

            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Optimize image: ensure under 7MB while preserving original dimensions as much as possible
const MAX_FILE_SIZE = 7 * 1024 * 1024; // 7MB

async function getOptimizedImageUrl(imageUrl) {
    if (!imageUrl) return null;
    try {
        console.log(`🖼️ [STREET_ICON_OPTIMIZE] Checking/optimizing image: ${imageUrl.substring(0, 80)}...`);

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });
        const buffer = Buffer.from(response.data);
        const originalSize = buffer.length;

        if (originalSize <= MAX_FILE_SIZE) {
            console.log(`✅ [STREET_ICON_OPTIMIZE] Image is OK (${(originalSize / 1024 / 1024).toFixed(1)}MB)`);
            return imageUrl;
        }

        const metadata = await sharp(buffer).metadata();
        console.log(`🔄 [STREET_ICON_OPTIMIZE] Image is ${(originalSize / 1024 / 1024).toFixed(1)}MB (${metadata.width}x${metadata.height}), compressing to <7MB...`);

        let quality = 92;
        let optimizedBuffer;

        do {
            quality -= 5;
            optimizedBuffer = await sharp(buffer)
                .jpeg({ quality })
                .toBuffer();
            console.log(`🔄 [STREET_ICON_OPTIMIZE] quality ${quality} → ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB`);
        } while (optimizedBuffer.length > MAX_FILE_SIZE && quality > 40);

        if (optimizedBuffer.length > MAX_FILE_SIZE) {
            const scale = 0.85;
            const newW = Math.round(metadata.width * scale);
            const newH = Math.round(metadata.height * scale);
            console.log(`🔄 [STREET_ICON_OPTIMIZE] Still over 7MB, scaling to ${newW}x${newH}...`);
            optimizedBuffer = await sharp(buffer)
                .resize(newW, newH)
                .jpeg({ quality: 50 })
                .toBuffer();
        }

        console.log(`✅ [STREET_ICON_OPTIMIZE] Final: ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB, quality ${quality}`);

        const timestamp = Date.now();
        const fileName = `temp_optimized/${timestamp}_${uuidv4().substring(0, 8)}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, optimizedBuffer, {
                contentType: "image/jpeg",
                upsert: true
            });

        if (error) {
            console.error(`❌ [STREET_ICON_OPTIMIZE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [STREET_ICON_OPTIMIZE] Optimized image uploaded: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [STREET_ICON_OPTIMIZE] Error in optimization:`, error.message);
        return imageUrl;
    }
}

// GPT Image 2 → nano-banana-2 fallback wrapper.
// Strategy: GPT Image 2 gets 2 attempts. If both fail, fall back to
// `callReplicateNanoBananaPro` (which itself tries nano-banana-2 first,
// nano-banana-pro as its own secondary fallback).
async function callGptImage2WithNanoFallback(prompt, imageUrls, gptImageSize, aspectRatio) {
    try {
        return await callFalAiGptImage2Edit(prompt, imageUrls, gptImageSize, 2);
    } catch (gptErr) {
        console.warn(
            `⚠️ [STREET_ICON_FALLBACK] GPT Image 2 failed after 2 attempts — falling back to nano-banana-2: ${gptErr.message}`
        );
        const resultUrl = imageUrls[0];
        const referenceUrl = imageUrls[1] || imageUrls[0];
        return await callReplicateNanoBananaPro(prompt, resultUrl, referenceUrl, 2, aspectRatio);
    }
}

// Fal.ai Nano Banana Pro (Google Gemini 3 Pro Image) call — same model as Real Life Kit
async function callReplicateNanoBananaPro(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3, imageSize = "9:16") {
    const FAL_API_KEY = process.env.FAL_API_KEY;
    if (!FAL_API_KEY) throw new Error("FAL_API_KEY environment variable is not set");

    const legacyMap = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
    const aspectRatio = legacyMap[imageSize] || imageSize || "9:16";

    const models = [
        { name: "nano-banana-2", url: "https://fal.run/fal-ai/nano-banana-2/edit" },
        { name: "nano-banana-pro", url: "https://fal.run/fal-ai/nano-banana-pro/edit" },
    ];

    for (const model of models) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🍌 [STREET_ICON_FAL] ${model.name} attempt ${attempt}/${maxRetries}`);
                console.log(`🍌 [STREET_ICON_FAL] Prompt: ${prompt.substring(0, 100)}...`);

                const response = await axios.post(
                    model.url,
                    {
                        prompt: prompt,
                        image_urls: [resultImageUrl, referenceImageUrl],
                        aspect_ratio: aspectRatio,
                        resolution: "1K",
                        output_format: "jpeg",
                        safety_tolerance: "4",
                        num_images: 1,
                    },
                    {
                        headers: {
                            "Authorization": `Key ${FAL_API_KEY}`,
                            "Content-Type": "application/json",
                        },
                        timeout: 300000,
                    }
                );

                const output = response.data;
                if (output.images && output.images.length > 0 && output.images[0].url) {
                    console.log(`✅ [STREET_ICON_FAL] ${model.name} image generated successfully`);
                    return output.images[0].url;
                }

                throw new Error("No image URL in Fal.ai response");
            } catch (error) {
                const errMsg = error.response?.data?.detail || error.message || "unknown error";
                console.error(`❌ [STREET_ICON_FAL] ${model.name} attempt ${attempt} failed:`, errMsg);
                const isCapacityError = typeof errMsg === "string" && (errMsg.includes("E003") || errMsg.includes("unavailable") || errMsg.includes("capacity") || errMsg.includes("overloaded"));
                if (isCapacityError) {
                    console.log(`⚡ [STREET_ICON_FAL] ${model.name} capacity error, skipping to fallback immediately`);
                    break;
                }
                if (attempt === maxRetries) break;
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        console.log(`⚠️ [STREET_ICON_FAL] ${model.name} failed, trying next model...`);
    }

    throw new Error("All Nano Banana models failed on Fal.ai (nano-banana-2 and nano-banana-pro)");
}

// Save generated image to user bucket
async function saveGeneratedImageToUserBucket(imageUrl, userId, imageType) {
    try {
        console.log(`📤 [STREET_ICON_SAVE] Saving ${imageType} image to user bucket...`);

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `${userId}/${timestamp}_streeticon_${imageType}_${randomId}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, imageBuffer, {
                contentType: "image/jpeg",
                cacheControl: "3600",
                upsert: false,
            });

        if (error) {
            console.error(`❌ [STREET_ICON_SAVE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [STREET_ICON_SAVE] Image saved: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [STREET_ICON_SAVE] Error saving image:`, error.message);
        return imageUrl;
    }
}

// Parse Gemini response to extract 6 scene prompts. Returns an array indexed
// 0..5 — each entry is either a prompt string or null if missing.
function parseStreetIconPrompts(geminiResponse) {
    const prompts = [null, null, null, null, null, null];

    try {
        let cleaned = geminiResponse.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

        const json = JSON.parse(cleaned);
        for (let i = 0; i < SCENE_COUNT; i++) {
            const key = `scene_${i + 1}`;
            if (json[key]) prompts[i] = json[key];
        }
        console.log("✅ [STREET_ICON_PARSE] JSON parsed successfully");
    } catch (jsonError) {
        console.warn("⚠️ [STREET_ICON_PARSE] JSON parse failed, trying fallback:", jsonError.message);
        try {
            const jsonMatch = geminiResponse.match(/\{[\s\S]*"scene_1"[\s\S]*\}/);
            if (jsonMatch) {
                const json = JSON.parse(jsonMatch[0]);
                for (let i = 0; i < SCENE_COUNT; i++) {
                    const key = `scene_${i + 1}`;
                    if (json[key]) prompts[i] = json[key];
                }
                console.log("✅ [STREET_ICON_PARSE] JSON extracted from text");
            } else {
                // Regex fallback per scene
                for (let i = 0; i < SCENE_COUNT; i++) {
                    const n = i + 1;
                    const nextSentinel = n < SCENE_COUNT ? `Scene_${n + 1}` : "$";
                    const re = new RegExp(`\\*?\\*?Scene_${n}:?\\*?\\*?\\s*(.+?)(?=\\n\\*?\\*?${nextSentinel}|$)`, "is");
                    const m = geminiResponse.match(re);
                    if (m) prompts[i] = m[1].trim();
                }
                console.log("✅ [STREET_ICON_PARSE] Regex fallback used");
            }
        } catch (fallbackError) {
            console.error("❌ [STREET_ICON_PARSE] All parsing failed:", fallbackError.message);
        }
    }

    console.log("📝 [STREET_ICON_PARSE] Parsed prompts:", prompts.map((p, i) => `scene${i + 1}:${!!p}`).join(" "));
    return prompts;
}

// Update stories column in reference_results (reuse same column — multi-kit safe since recordId scoped)
async function updateStoriesForRecord(recordId, storyImages) {
    try {
        console.log("📖 [STREET_ICON] Updating stories for record...");

        if (!recordId || !storyImages || storyImages.length === 0) {
            console.log("⚠️ [STREET_ICON] No images to save or missing recordId");
            return null;
        }

        const { data: existingRecord, error: findError } = await supabase
            .from("reference_results")
            .select("id, stories")
            .eq("generation_id", recordId)
            .maybeSingle();

        if (findError) {
            console.log("⚠️ [STREET_ICON] Database lookup error (non-critical):", findError.message);
            return null;
        }

        if (!existingRecord) {
            console.log("⚠️ [STREET_ICON] No record found - skipping stories update");
            return null;
        }

        console.log("✅ [STREET_ICON] Found record ID:", existingRecord.id);

        const { data: updateData, error: updateError } = await supabase
            .from("reference_results")
            .update({ stories: storyImages })
            .eq("id", existingRecord.id)
            .select();

        if (updateError) {
            console.error("❌ [STREET_ICON] Error updating stories:", updateError);
            return null;
        }

        console.log("✅ [STREET_ICON] Stories updated successfully:", storyImages.length, "images");
        return updateData;

    } catch (error) {
        console.error("❌ [STREET_ICON] Error:", error.message);
        return null;
    }
}

async function appendStoryToRecord(recordId, imageUrl, sceneIndex) {
    const { data: existing, error: findError } = await supabase
        .from("reference_results")
        .select("id, stories")
        .eq("generation_id", recordId)
        .maybeSingle();

    if (findError || !existing) return null;

    let currentStories = Array.isArray(existing.stories) ? [...existing.stories] : [];

    if (sceneIndex !== undefined && sceneIndex !== null) {
        while (currentStories.length <= sceneIndex) currentStories.push(null);
        currentStories[sceneIndex] = imageUrl;
    } else {
        if (currentStories.includes(imageUrl)) return null;
        currentStories.push(imageUrl);
    }

    await supabase
        .from("reference_results")
        .update({ stories: currentStories })
        .eq("id", existing.id);

    return currentStories;
}

// Save record to product_street_icon_kits table
async function saveStreetIconKitToDatabase({
    userId,
    generationId,
    originalPhotos,
    storyImages,
    processingTimeSeconds,
    creditsUsed,
    isFreeTier,
}) {
    try {
        console.log("💾 [SAVE_STREET_ICON] Saving street icon kit to database...");

        if (!userId || !generationId) {
            console.log("⚠️ [SAVE_STREET_ICON] Missing userId or generationId, skipping save");
            return null;
        }

        const { data, error } = await supabase
            .from("product_street_icon_kits")
            .insert({
                user_id: userId,
                generation_id: generationId,
                original_photos: originalPhotos || [],
                story_images: storyImages || [],
                processing_time_seconds: Math.round(processingTimeSeconds),
                total_images_generated: storyImages?.length || 0,
                credits_used: creditsUsed,
                is_free_tier: isFreeTier
            })
            .select()
            .single();

        if (error) {
            console.error("❌ [SAVE_STREET_ICON] Database insert error:", error);
            return null;
        }

        console.log("✅ [SAVE_STREET_ICON] Street icon kit saved successfully, ID:", data.id);
        return data;

    } catch (error) {
        console.error("❌ [SAVE_STREET_ICON] Unexpected error:", error.message);
        return null;
    }
}

// Increment street-icon generation count
async function incrementStreetIconCount(userId) {
    if (!userId) return;
    try {
        console.log(`📈 [STREET_ICON_STATS] Incrementing count for user: ${userId}`);

        const { data, error: selectError } = await supabase
            .from("user_street_icon_stats")
            .select("street_icon_generation_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (selectError) throw selectError;

        const newCount = (data?.street_icon_generation_count || 0) + 1;

        const { error: upsertError } = await supabase
            .from("user_street_icon_stats")
            .upsert({
                user_id: userId,
                street_icon_generation_count: newCount,
                updated_at: new Date().toISOString()
            });

        if (upsertError) throw upsertError;
        console.log(`✅ [STREET_ICON_STATS] Increment successful. New count: ${newCount}`);
    } catch (error) {
        console.error("❌ [STREET_ICON_STATS] Error incrementing count:", error.message);
    }
}

async function checkUserBalance(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

        if (error || !user) {
            console.error("❌ [STREET_ICON_CREDIT] Error fetching user balance:", error);
            return false;
        }

        const balance = user.credit_balance || 0;
        console.log(`💳 [STREET_ICON_CREDIT] User: ${userId}, Balance: ${balance}, Cost: ${cost}`);

        return balance >= cost;
    } catch (error) {
        console.error("❌ [STREET_ICON_CREDIT] Unexpected error:", error);
        return false;
    }
}

async function deductUserCredit(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        console.log(`💳 [STREET_ICON_DEDUCT] Deducting ${cost} credits from user ${userId}...`);

        const { data, error } = await supabase.rpc("deduct_user_credit", {
            user_id: userId,
            credit_amount: cost
        });

        if (error) {
            console.error("❌ [STREET_ICON_DEDUCT] RPC Error:", error);
            return false;
        }

        console.log(`✅ [STREET_ICON_DEDUCT] Successfully deducted ${cost} credits.`);
        return true;
    } catch (error) {
        console.error("❌ [STREET_ICON_DEDUCT] Unexpected error:", error);
        return false;
    }
}

async function getUserStreetIconCount(userId) {
    if (!userId || userId === "anonymous_user") return 0;

    try {
        const { data, error } = await supabase
            .from("user_street_icon_stats")
            .select("street_icon_generation_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            console.error("❌ [STREET_ICON_COUNT] Error fetching count:", error);
            return 0;
        }

        return data?.street_icon_generation_count || 0;
    } catch (error) {
        console.error("❌ [STREET_ICON_COUNT] Unexpected error:", error);
        return 0;
    }
}

// ═══════════════════════════════════════════════════════
// POST /api/generate-street-icon
// ═══════════════════════════════════════════════════════
router.post("/generate-street-icon", async (req, res) => {
    const startTime = Date.now();
    const STREET_ICON_GENERATION_COST = 60; // 6 scenes = 60 credits
    const FREE_TIER_LIMIT = 2; // First 2 generations free

    try {
        const { imageUrl, recordId, userId, teamAware } = req.body;

        console.log(`🏙️ [STREET_ICON] Request received for URL: ${imageUrl?.substring(0, 50)}...`);
        console.log(`🏙️ [STREET_ICON] Record ID: ${recordId}, User ID: ${userId}, teamAware: ${teamAware}`);

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        // Determine effective user for credits/stats (team-aware)
        let creditOwnerId = userId;
        let isTeamCredit = false;

        if (teamAware && userId && userId !== "anonymous_user") {
            const effectiveCredits = await teamService.getEffectiveCredits(userId);
            creditOwnerId = effectiveCredits.creditOwnerId;
            isTeamCredit = effectiveCredits.isTeamCredit;
            console.log(`📊 [STREET_ICON] Team-aware: creditOwnerId=${creditOwnerId}, isTeamCredit=${isTeamCredit}`);
        }

        // STEP -2: Free tier check
        let isFree = false;
        if (creditOwnerId && creditOwnerId !== "anonymous_user") {
            const count = await getUserStreetIconCount(creditOwnerId);
            console.log(`📊 [STREET_ICON] Generation count for ${creditOwnerId}: ${count}`);
            if (count < FREE_TIER_LIMIT) {
                isFree = true;
                console.log(`🎁 [STREET_ICON] Within FREE TIER (count < ${FREE_TIER_LIMIT}).`);
            }
        }

        // STEP -1: Credit check
        if (!isFree && creditOwnerId && creditOwnerId !== "anonymous_user") {
            const hasEnoughCredits = await checkUserBalance(creditOwnerId, STREET_ICON_GENERATION_COST);
            if (!hasEnoughCredits) {
                console.warn(`⛔ [STREET_ICON] Insufficient credits for: ${creditOwnerId}`);
                return res.status(402).json({
                    success: false,
                    error: "INSUFFICIENT_CREDITS",
                    message: "You do not have enough credits to generate a Street Icon Kit."
                });
            }
        }

        // STEP 0: Preserve other kits — only strip previous Street Icon URLs, keep Real Life / others.
        // baseIndex = remaining stories length → new scenes append at the tail.
        let baseIndex = 0;
        if (recordId) {
            console.log(`🧹 [STREET_ICON] Filtering previous Street Icon URLs for record: ${recordId}`);
            const { data: existingRec } = await supabase
                .from("reference_results")
                .select("id, stories")
                .eq("generation_id", recordId)
                .maybeSingle();

            if (existingRec) {
                const prior = Array.isArray(existingRec.stories) ? existingRec.stories : [];
                const filtered = prior.filter(
                    (url) => !(typeof url === "string" && url.indexOf("_streeticon_") !== -1)
                );
                if (filtered.length !== prior.length) {
                    await supabase
                        .from("reference_results")
                        .update({ stories: filtered })
                        .eq("id", existingRec.id);
                    console.log(`🧹 [STREET_ICON] Removed ${prior.length - filtered.length} prior Street Icon entries, kept ${filtered.length} other-kit entries`);
                }
                baseIndex = filtered.length;
            }
        }

        // Step 0.5: Fetch user preferences
        let userPreferences = null;
        try {
            const { data } = await supabase
                .from("user_street_icon_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();
            if (data) {
                userPreferences = data;
                console.log(`📋 [STREET_ICON] User preferences found for: ${userId}`);
            }
        } catch (e) {
            console.log("⚠️ [STREET_ICON] Could not fetch user preferences:", e.message);
        }

        // Step 1: Generate prompts with Gemini
        console.log("📝 [STREET_ICON] Step 1: Generating 6 scene prompts with Gemini...");

        const up = userPreferences || {};
        const generalNotesLine = up.general_notes ? `\nUser's global style note: ${up.general_notes}\n` : '';

        const scene1 = up.scene_1_instruction || '';
        const scene2 = up.scene_2_instruction || '';
        const scene3 = up.scene_3_instruction || '';
        const scene4 = up.scene_4_instruction || '';
        const scene5 = up.scene_5_instruction || '';
        const scene6 = up.scene_6_instruction || '';

        const hasAnyUserScene = !!(scene1 || scene2 || scene3 || scene4 || scene5 || scene6);
        const userScenesBlock = hasAnyUserScene
            ? `User preferences for specific scenes (fill these in, leave others for you to invent):
Scene 1: ${scene1 || "(you choose — must fit the garment's vibe)"}
Scene 2: ${scene2 || "(you choose — must fit the garment's vibe)"}
Scene 3: ${scene3 || "(you choose — must fit the garment's vibe)"}
Scene 4: ${scene4 || "(you choose — must fit the garment's vibe)"}
Scene 5: ${scene5 || "(you choose — must fit the garment's vibe)"}
Scene 6: ${scene6 || "(you choose — must fit the garment's vibe)"}
`
            : `No user preferences — invent all 6 scenes from scratch based on a careful analysis of the garment.`;

        const geminiPrompt = `You write AI image-edit prompts. Analyze the garment in the product image, then produce 6 structured prompts that each generate a realistic street-style photo that looks like it was shot spontaneously on a smartphone — not a studio.

Every prompt MUST follow the STRUCTURED TEMPLATE below, filling in the bracketed sections with specific details that fit the garment. Output each prompt as one long block with all sections present (Setting, Outfit, Pose, Lighting, Camera style, Composition, Model styling, DO NOT, closing line).

═══════════════════════════════════════════════════════════
STRUCTURED TEMPLATE — every scene must hit every section:
═══════════════════════════════════════════════════════════

Create a realistic street-style fashion photo, shot as if captured with a smartphone camera (iPhone-like), not a professional studio.

Setting: [Specific real urban/everyday location chosen to fit THIS garment's vibe. Examples: sun-bleached wall of a local shop with graffitied metal shutter, cobblestone alley between stone buildings, apartment doorway with worn stone steps, quiet side street with parked cars and mailbox, market pavement with fruit crates nearby, small café terrace with wooden bench. Be concrete about textures, wall colors, street fixtures, lived-in details visible in frame.]

Outfit: [Describe the exact same garment from the source image — color, texture, pattern, fit, fabric, stitching, drape.] The clothing looks naturally worn on the body with realistic fabric folds, slight imperfections, and authentic street styling.

Pose: [A natural, slightly imperfect, effortless pose chosen to fit the location. She is not posed. Examples: leaning back against the wall with one foot up, mid-stride on the pavement looking slightly off-camera, sitting on a low stone step with one knee up and hands resting, standing with weight on one hip glancing sideways, crouched adjusting her boot, walking past a shop front with hair mid-motion. Never stiff catalog. Never runway.]

Lighting: [Natural daylight only — specify the exact quality: slightly overcast soft diffused, harsh midday sun with hard shadows, warm late-afternoon golden light hitting the wall, blue-hour dusk cool pavement, morning window-bounced glow. Mention direction. NO studio fill, NO artificial lighting.]

Camera style: Slight handheld feel, very subtle motion blur or micro imperfection, natural smartphone lens perspective, slight grain and noise like a real phone photo, not overly sharp or hyper-detailed.

Composition: Full body or mid-body framing. Slightly off-center framing, not perfectly symmetrical. Realistic background depth but not heavily blurred. Background feels real and lived-in — real street textures, wall marks, everyday fixtures visible in the frame.

Model styling: Minimal makeup, natural skin texture (NOT overly smooth), slight skin imperfections allowed, relaxed unexaggerated expression, hair slightly tousled or naturally moved by the wind.

DO NOT:
- Do not make it look like a studio shoot
- Do not over-smooth the skin
- Do not add cinematic or fashion-editorial lighting
- Do not make it overly polished or commercial
- Do not put a phone, tablet, laptop, camera, or any screen in her hands
- Do not add watermarks, logos, or caption text
- Do not describe skin, cleavage, legs, or body shape

Preserve all garment details exactly. Final result must look like an authentic Instagram street-fashion photo taken spontaneously on a phone.

═══════════════════════════════════════════════════════════

STEP 1 — SILENTLY ANALYZE THE GARMENT (do not output):
- What is it? (top, dress, jeans, jacket, full outfit, accessory)
- Vibe: casual-everyday, elegant, sporty, streetwear, boho, grunge, preppy, vintage, minimalist, Y2K...
- Season/weather: light summer, mid-season, warm winter, rainy, beach...
- Color palette & mood
- What kind of real location matches this specific garment?

STEP 2 — WRITE 6 SCENES, EACH FOLLOWING THE STRUCTURED TEMPLATE:
- Each scene must differ in SETTING, POSE, TIME OF DAY, and LIGHTING from the other 5. No repetition.
- All 6 Settings must match THE SPECIFIC garment's vibe (resort-wear → boardwalk/sunny-terrace; cozy knit → autumn-park/doorway; streetwear → skate-park/bus-stop; smart casual → museum-courtyard/quiet-alley; party → dim-stairway/rooftop-dusk).
- The Outfit section stays faithful to the source garment in all 6.
- The Pose section is different in each: leaning / mid-step / sitting / glancing / crouching / walking-past / hair-adjust / looking-up / adjusting-sleeve. NEVER include phones, tablets, laptops, or any screens in her hands. Acceptable hand items: empty hands, coffee cup, shopping bag, keys, sunglasses, scarf, small handbag.

UNPOSED / ANTI-POSE RULE (this is the foundation of every scene — follow it strictly):
This is NOT a fashion shoot. The girl is NOT posing for the camera. Her friend snapped a quick phone photo while they were just existing — walking, standing, waiting, hanging out. She may not even know the photo is being taken. Every pose description you write must pass this test: "Could a regular girl actually be caught in this position mid-life, not aware of a camera?"

Core anti-pose rules:
- She does NOT have to face the camera. Profile, three-quarter turned away, shoulder-toward-camera, or even half-back-to-camera are all good and often BETTER than frontal.
- Her gaze does NOT have to land on the lens. Looking off to the side, looking down, eyes mid-blink, eyes closed for a fraction of a second, glancing past the camera, looking at a friend out of frame — all MORE natural than "looking at camera".
- Her body does NOT have to be symmetric, centered, or "flattering-angled". Slouched a bit, weight dumped lazily on one hip, slight hunch, shoulders a touch raised, one leg a little forward the other a little back — these are real bodies in real life.
- She should be DOING something small, not "striking a pose". She is mid-action: tucking hair behind her ear, squinting into the sun, mid-sip of something, turning to say something to someone off-camera, digging in her bag, shifting weight, adjusting a sleeve, just standing waiting.
- Slight awkwardness is GOOD. A real friend-photo often has an imperfect body alignment, mouth slightly open mid-sentence, weight not yet settled, one arm half-raised. Write these in.

AVOID THESE MODEL-POSE PATTERNS AT ALL COSTS (these make it look professional and break the whole vibe):
  ✗ Hands on hips catalog stance
  ✗ Confident three-quarter turn with chin tilted down (classic fashion editorial)
  ✗ Smooth confident direct-to-lens gaze
  ✗ Legs crossed ballerina stance
  ✗ Arms symmetrically placed at sides
  ✗ "Runway walk" mid-stride with perfect posture
  ✗ "Model smolder" / intense stare
  ✗ Hand delicately placed on jaw/hair/collarbone like a perfume ad
  ✗ Perfectly arched back, legs elongated
  ✗ "Power pose" with shoulders squared
  ✗ Frozen mid-twirl with perfectly flowing fabric like a dress commercial
    (NOTE: a genuine joy-spin during a real laugh is fine — the difference is
    whether the motion looks choreographed for the camera or truly spontaneous)

Instead of those, write poses that feel like real candid life. Default toward "she's just there, existing", NOT "she is being photographed".

PLAYFUL ENERGY (OPTIONAL — do not force this, only use when it fits):
A couple of the 6 scenes can carry a cheeky, unexpected, "off-the-cuff" energy — the kind of spontaneous street moment that makes an Instagram feed feel alive instead of curated. This is NOT a rule. Only reach for a playful beat when the garment's vibe invites it (casual/streetwear/resort = more room; elegant/formal = stays restrained or zero playful scenes).

IMPORTANT — playful energy is STILL unposed. It is NOT a "fun pose". It is a split-second real moment a friend's phone happens to catch. She is not performing for the camera; she is just living her day, and one fraction of that day happened to be a little cheeky or off-beat.

You must THINK IN CATEGORIES OF CANDID MOMENTS, not specific props. For each playful beat you add, choose ONE category below and INVENT a totally fresh moment for THIS user's garment + setting. DO NOT pull from a fixed list — every generation should feel different.

Candid playful-moment categories (NOT poses, NOT a menu — think "real-life micro-events"):
  • Micro-gesture — a small natural hand/body movement caught by chance (mid-wave to a friend out of frame, mid-scratch of the neck, mid-adjust of a shoe strap)
  • Real emotion spilling out — a subtle genuine facial flicker mid-motion (sudden laugh, mischievous half-smile, eye-roll at something off-camera, wincing at the sun)
  • Small interaction with surroundings — touching / holding / brushing past something in a completely natural way, not staged (fingertips grazing a wall while walking past, crouched briefly to look at something on the ground, lifting a foot a bit to look at her shoe)
  • Body-in-motion caught off-beat — the instant between two actions, never a pose: mid-turn to look behind, mid-step with weight still shifting, hair flipping as she turns her head, just stood up from sitting
  • Goofy-human moments — tiny unflattering truths of real life: yawning, sneezing, eyes closed in a laugh, squinting hard at the sun, hair partially across her face from wind
  • BIG JOYFUL EXPLOSION — a full-bodied, uncontained moment of joy that looks completely unposed. This is the opposite of a "model shot". Think: head thrown back in a hard belly-laugh with eyes squeezed shut and mouth wide open, hair flying as she laughs; doubled over laughing with a hand slapping her thigh or covering her face; mid-spin with the fabric catching the motion and a huge grin; jumping a little in place with both arms out; dancing a quick step on the pavement with shoulders shaking. The girl is lost in the moment and the camera happened to be pointing at her. Slight blur from motion is good. Face can be partially hidden by hair or a hand — that adds to the realness.

WHEN THE GARMENT ALLOWS IT, at least ONE of your 6 scenes SHOULD be a BIG JOYFUL EXPLOSION moment (a real, wild, uncomposed burst of happiness or movement). This breaks the pattern of everyone looking serene and makes the set feel like a real life feed. Use this freely for casual/streetwear/resort/party outfits. For elegant/formal garments, soften it to a genuine warm laugh rather than a wild one.

HARD VARIETY RULES (critical — this service runs for many different users):
- DO NOT reuse the same playful props across generations. If one call used "fruit from a market" or "foot on a street pole" or "parked scooter" or "fountain edge" — the NEXT call MUST use entirely different objects and interactions.
- Each call: invent the playful moment fresh from the ground up based on THIS garment and THIS setting. Think like you've never written these prompts before.
- BANNED AS A RECURRING PATTERN: fruit/market bite, scooter-sit, fountain-edge-sit, lamp-post foot, mid-laugh-head-back. These are clichés — you may use ONE of them at most, and only if it genuinely fits. Preferably invent something fresher.

BALANCE:
- Max 2 of the 6 scenes carry explicit playful energy. The other 4 stay quiet, natural, unstaged — just standing, walking, sitting, leaning.
- If every scene feels like a "moment" the whole set looks staged. Let calmness be the default and surprise come from ONE or TWO picks only.
- If the garment is elegant/formal, zero playful scenes is perfectly fine.

HARD LANGUAGE RULES:
- Call the person "the girl" / "she" — NEVER "the model"
- NEVER use: "editorial", "Vogue", "campaign", "shoot", "photoshoot", "model", "studio", "professional photography", "Hasselblad", "85mm", "Portra", "cinematic", "fashion photograph"
- DO use: "smartphone", "iPhone-like", "candid", "handheld feel", "natural daylight", "lived-in", "slight grain"

CONTENT SAFETY:
- No alcohol, bars, smoking, drugs, or party scenes
- No suggestive or revealing body descriptions
- Focus ONLY on the garment, scene, and pose
- Family-friendly, safe for AI content moderation
${generalNotesLine}
${userScenesBlock}

CRITICAL: Respond ONLY with a valid JSON object. No markdown, no code blocks, no extra text. Each value must be the FULL structured prompt following the template above, starting with "Create a realistic street-style fashion photo". JSON structure:
{"scene_1":"Create a realistic street-style fashion photo...","scene_2":"Create a realistic street-style fashion photo...","scene_3":"Create a realistic street-style fashion photo...","scene_4":"Create a realistic street-style fashion photo...","scene_5":"Create a realistic street-style fashion photo...","scene_6":"Create a realistic street-style fashion photo..."}`;

        const optimizedGeminiUrl = await getOptimizedImageUrl(imageUrl);

        // Gemini Flash can return empty output when a safety filter fires or
        // when the prompt is very long. Wrap in try/catch so a failure just
        // falls back to the structured DEFAULT_FALLBACK_PROMPTS — generation
        // continues instead of aborting the whole request.
        let prompts = [null, null, null, null, null, null];
        try {
            const geminiResponse = await callReplicateGeminiFlash(geminiPrompt, [optimizedGeminiUrl || imageUrl]);
            console.log("✅ [STREET_ICON] Gemini response received");
            console.log("📝 [STREET_ICON] Raw response:", geminiResponse.substring(0, 500));
            prompts = parseStreetIconPrompts(geminiResponse);
        } catch (gemErr) {
            console.warn("⚠️ [STREET_ICON] Gemini prompt generation failed — falling back to default scene prompts:", gemErr.message);
            // prompts stays [null × 6], scenePrompts below will fill with DEFAULT_FALLBACK_PROMPTS
        }

        // Step 2: Get reference image
        console.log("🔍 [STREET_ICON] Step 2: Fetching reference_images from database...");

        let referenceImageUrl = imageUrl;
        try {
            if (recordId) {
                const { data: record, error: findError } = await supabase
                    .from("reference_results")
                    .select("reference_images")
                    .eq("generation_id", recordId)
                    .maybeSingle();

                if (!findError && record && record.reference_images && record.reference_images.length > 0) {
                    referenceImageUrl = record.reference_images[0];
                    console.log("✅ [STREET_ICON] Found reference_image:", referenceImageUrl.substring(0, 80) + "...");
                } else {
                    console.log("⚠️ [STREET_ICON] No reference_images found for recordId:", recordId);
                }
            }
        } catch (error) {
            console.log("⚠️ [STREET_ICON] Reference image lookup error:", error.message);
        }

        // Step 3: Generate 6 scenes in parallel
        console.log(`🎨 [STREET_ICON] Step 3: Generating ${SCENE_COUNT} scenes...`);

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedImages = [];

        // `prompts` is now an array [scene1, scene2, ..., scene6] from the parser.
        // Fall back to the structured default per slot if any slot is null.
        const scenePrompts = Array.from({ length: SCENE_COUNT }, (_, i) =>
            prompts[i] || DEFAULT_FALLBACK_PROMPTS[i]
        );

        // GPT Image 2 (fal queue) — input images must be ≤ 3:1, so pad once,
        // reuse for all 6 scenes. Aspect ratio string maps to the enum.
        const inputUrls = [optimizedResultUrl, optimizedReferenceUrl].filter(Boolean);
        const sanitizedInputUrls = await ensureMaxAspectRatio3to1ForInput(inputUrls, userId);
        const userImageSize = up.aspect_ratio || "9:16";
        const gptImageSize = mapRatioToGptImage2Size(userImageSize);
        console.log(`🎨 [STREET_ICON] Using GPT Image 2, image_size: ${gptImageSize}, inputs: ${sanitizedInputUrls.length}`);

        const imageGenerationPromises = scenePrompts.map(async (prompt, index) => {
            try {
                console.log(`🎨 [STREET_ICON] Generating scene ${index + 1} (${SCENE_TYPES[index]})...`);
                const generatedUrl = await callGptImage2WithNanoFallback(prompt, sanitizedInputUrls, gptImageSize, userImageSize);

                const savedUrl = await saveGeneratedImageToUserBucket(
                    generatedUrl,
                    userId || "anonymous",
                    SCENE_TYPES[index]
                );

                if (savedUrl && recordId) {
                    try {
                        const absIndex = baseIndex + index;
                        await appendStoryToRecord(recordId, savedUrl, absIndex);
                        console.log(`🏙️ [STREET_ICON] Scene ${index + 1} (${SCENE_TYPES[index]}) saved to DB at slot ${absIndex}`);
                    } catch (e) {
                        console.warn(`⚠️ [STREET_ICON] Progressive save failed for scene ${index + 1}:`, e.message);
                    }
                }

                return {
                    type: SCENE_TYPES[index],
                    url: savedUrl,
                    prompt: prompt
                };
            } catch (error) {
                console.error(`❌ [STREET_ICON] Error generating scene ${SCENE_TYPES[index]}:`, error.message);
                return {
                    type: SCENE_TYPES[index],
                    url: null,
                    error: error.message
                };
            }
        });

        const results = await Promise.all(imageGenerationPromises);

        const orderedImages = results.map(result => result.url || null);
        results.forEach(result => {
            if (result.url) {
                generatedImages.push(result.url);
            }
        });

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [STREET_ICON] Generation completed in ${processingTime.toFixed(1)}s`);
        console.log(`📊 [STREET_ICON] Generated ${generatedImages.length}/${SCENE_COUNT} scenes`);

        // Step 4: Final reconcile — write orderedImages at [baseIndex..baseIndex+5] without clobbering other kits.
        // Progressive appends already persisted each scene; this is a safety net if any append failed mid-flight.
        if (generatedImages.length > 0 && recordId) {
            console.log("🏙️ [STREET_ICON] Step 4: Final reconcile to reference_results.stories (preserve other kits)...");
            try {
                const { data: current } = await supabase
                    .from("reference_results")
                    .select("id, stories")
                    .eq("generation_id", recordId)
                    .maybeSingle();

                if (current) {
                    const merged = Array.isArray(current.stories) ? [...current.stories] : [];
                    for (let i = 0; i < orderedImages.length; i++) {
                        const absIdx = baseIndex + i;
                        while (merged.length <= absIdx) merged.push(null);
                        // Only set if we have a URL; leave existing value otherwise (keeps progressive writes intact)
                        if (orderedImages[i]) merged[absIdx] = orderedImages[i];
                    }
                    await supabase
                        .from("reference_results")
                        .update({ stories: merged })
                        .eq("id", current.id);
                }
            } catch (e) {
                console.warn("⚠️ [STREET_ICON] Final reconcile failed (non-fatal):", e.message);
            }
        }

        // Step 4.5: Save to product_street_icon_kits table
        if (generatedImages.length > 0 && userId && userId !== "anonymous_user") {
            console.log("💾 [STREET_ICON] Step 4.5: Saving to product_street_icon_kits table...");

            const originalPhotos = [imageUrl];
            if (referenceImageUrl && referenceImageUrl !== imageUrl) {
                originalPhotos.push(referenceImageUrl);
            }

            const storyImagesData = results
                .filter(r => r.url)
                .map(r => ({
                    type: r.type,
                    url: r.url,
                    prompt: r.prompt || null
                }));

            await saveStreetIconKitToDatabase({
                userId: userId,
                generationId: recordId,
                originalPhotos: originalPhotos,
                storyImages: storyImagesData,
                processingTimeSeconds: processingTime,
                creditsUsed: isFree ? 0 : STREET_ICON_GENERATION_COST,
                isFreeTier: isFree
            });
        }

        // Step 5: Increment stats
        if (generatedImages.length > 0 && creditOwnerId) {
            await incrementStreetIconCount(creditOwnerId);
            console.log(`📊 [STREET_ICON] Stats incremented for: ${creditOwnerId}`);
        }

        // Step 6: Deduct credits
        if (!isFree && generatedImages.length > 0 && creditOwnerId && creditOwnerId !== "anonymous_user") {
            console.log(`💳 [STREET_ICON] Step 6: Deducting credits from: ${creditOwnerId}...`);
            const deducted = await deductUserCredit(creditOwnerId, STREET_ICON_GENERATION_COST);
            if (!deducted) {
                console.error("❌ [STREET_ICON] Credit deduction failed even after successful generation!");
            }
        }

        res.json({
            success: true,
            images: orderedImages,
            prompts: {
                Scene_1_Prompt: prompts[0] || "",
                Scene_2_Prompt: prompts[1] || "",
                Scene_3_Prompt: prompts[2] || "",
                Scene_4_Prompt: prompts[3] || "",
                Scene_5_Prompt: prompts[4] || "",
                Scene_6_Prompt: prompts[5] || "",
            },
            details: results,
            processingTimeSeconds: processingTime
        });

    } catch (error) {
        console.error("❌ [STREET_ICON] Error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            processingTimeSeconds: (Date.now() - startTime) / 1000
        });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/retry-street-icon-scene — Retry a single failed scene
// ═══════════════════════════════════════════════════════
router.post("/retry-street-icon-scene", async (req, res) => {
    const startTime = Date.now();
    try {
        const { imageUrl, recordId, userId, sceneIndex } = req.body;

        if (!imageUrl || !recordId || sceneIndex === undefined) {
            return res.status(400).json({ success: false, error: "Missing imageUrl, recordId, or sceneIndex" });
        }

        // sceneIndex is the absolute position in reference_results.stories (may be >5 when kits coexist).
        // For prompt / prefs / SCENE_TYPES lookup we need the local scene index (0..5) within this kit.
        const localSceneIndex = ((sceneIndex % 6) + 6) % 6;
        const sceneType = SCENE_TYPES[localSceneIndex];
        if (!sceneType) {
            return res.status(400).json({ success: false, error: "Invalid sceneIndex" });
        }

        console.log(`🔄 [STREET_ICON_RETRY] Retrying scene ${localSceneIndex + 1} (${sceneType}) at absolute slot ${sceneIndex} for record ${recordId}`);

        const { data: refResult } = await supabase
            .from("reference_results")
            .select("reference_image")
            .eq("generation_id", recordId)
            .maybeSingle();

        const referenceImageUrl = refResult?.reference_image || imageUrl;

        // Load user preferences for this scene
        let scenePrompt = null;
        if (userId && userId !== "anonymous_user") {
            const { data: prefs } = await supabase
                .from("user_street_icon_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();

            if (prefs) {
                const prefKey = `scene_${localSceneIndex + 1}_instruction`;
                if (prefs[prefKey]) {
                    scenePrompt = prefs[prefKey];
                }
            }
        }

        const prompt = scenePrompt || DEFAULT_FALLBACK_PROMPTS[localSceneIndex];

        let aspectRatio = "9:16";
        if (userId && userId !== "anonymous_user") {
            const { data: prefs } = await supabase
                .from("user_street_icon_preferences")
                .select("aspect_ratio")
                .eq("user_id", userId)
                .maybeSingle();
            if (prefs?.aspect_ratio) {
                aspectRatio = prefs.aspect_ratio;
            }
        }

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        // GPT Image 2 edit — pad inputs to ≤ 3:1, map ratio to enum
        const retryInputs = [optimizedResultUrl, optimizedReferenceUrl].filter(Boolean);
        const sanitizedRetryInputs = await ensureMaxAspectRatio3to1ForInput(retryInputs, userId);
        const gptRetrySize = mapRatioToGptImage2Size(aspectRatio);

        const generatedUrl = await callGptImage2WithNanoFallback(prompt, sanitizedRetryInputs, gptRetrySize, aspectRatio);

        const savedUrl = await saveGeneratedImageToUserBucket(
            generatedUrl,
            userId || "anonymous",
            sceneType
        );

        if (!savedUrl) {
            return res.status(500).json({ success: false, error: "Failed to save generated image" });
        }

        if (recordId) {
            await appendStoryToRecord(recordId, savedUrl, sceneIndex);
        }

        if (userId && userId !== "anonymous_user") {
            try {
                const { data: existingKit } = await supabase
                    .from("product_street_icon_kits")
                    .select("id, story_images")
                    .eq("generation_id", recordId)
                    .maybeSingle();

                if (existingKit) {
                    const currentImages = Array.isArray(existingKit.story_images) ? existingKit.story_images : [];
                    currentImages.push({ type: sceneType, url: savedUrl, prompt: prompt });
                    await supabase
                        .from("product_street_icon_kits")
                        .update({ story_images: currentImages })
                        .eq("id", existingKit.id);
                }
            } catch (e) {
                console.warn("⚠️ [STREET_ICON_RETRY] product_street_icon_kits update failed:", e.message);
            }
        }

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [STREET_ICON_RETRY] Scene ${sceneIndex + 1} retried in ${processingTime.toFixed(1)}s`);

        res.json({
            success: true,
            url: savedUrl,
            sceneIndex: sceneIndex,
            sceneType: sceneType
        });

    } catch (error) {
        console.error("❌ [STREET_ICON_RETRY] Error:", error);
        const isSensitive = error.message && (error.message.includes("flagged") || error.message.includes("sensitive"));
        res.status(isSensitive ? 422 : 500).json({
            success: false,
            error: error.message,
            errorCode: isSensitive ? "CONTENT_FLAGGED" : "GENERATION_FAILED"
        });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/street-icon-stats/:userId
// ═══════════════════════════════════════════════════════
router.get("/street-icon-stats/:userId", async (req, res) => {
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
            .from("user_street_icon_stats")
            .select("street_icon_generation_count")
            .eq("user_id", effectiveUserId)
            .maybeSingle();

        if (error) throw error;

        res.json({
            success: true,
            count: data?.street_icon_generation_count || 0,
            isTeamData
        });
    } catch (error) {
        console.error("❌ [STREET_ICON_STATS] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/user-street-icons/:userId
// ═══════════════════════════════════════════════════════
router.get("/user-street-icons/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

        console.log(`🏙️ [USER_STREET_ICONS] Fetching kits for user: ${userId}, limit: ${limit}, offset: ${offset}`);

        const { data, error, count } = await supabase
            .from("product_street_icon_kits")
            .select("*", { count: "exact" })
            .in("user_id", memberIds)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        console.log(`✅ [USER_STREET_ICONS] Found ${data?.length || 0} kits`);

        res.json({
            success: true,
            kits: data || [],
            totalCount: count || 0,
            hasMore: (offset + limit) < (count || 0),
            isTeamData: isTeamMember
        });
    } catch (error) {
        console.error("❌ [USER_STREET_ICONS] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/street-icon-preferences/:userId
// ═══════════════════════════════════════════════════════
router.get("/street-icon-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from("user_street_icon_preferences")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) throw error;

        res.json({ success: true, data: data || null });
    } catch (error) {
        console.error("❌ [STREET_ICON_PREFS] GET error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/street-icon-preferences/:userId
// ═══════════════════════════════════════════════════════
router.post("/street-icon-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            scene_1_instruction, scene_2_instruction, scene_3_instruction,
            scene_4_instruction, scene_5_instruction, scene_6_instruction,
            general_notes, aspect_ratio
        } = req.body;

        const { data, error } = await supabase
            .from("user_street_icon_preferences")
            .upsert({
                user_id: userId,
                scene_1_instruction: scene_1_instruction || '',
                scene_2_instruction: scene_2_instruction || '',
                scene_3_instruction: scene_3_instruction || '',
                scene_4_instruction: scene_4_instruction || '',
                scene_5_instruction: scene_5_instruction || '',
                scene_6_instruction: scene_6_instruction || '',
                general_notes: general_notes || '',
                aspect_ratio: aspect_ratio || '9:16',
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" })
            .select()
            .single();

        if (error) throw error;

        console.log(`✅ [STREET_ICON_PREFS] Saved preferences for user: ${userId}`);
        res.json({ success: true, data });
    } catch (error) {
        console.error("❌ [STREET_ICON_PREFS] POST error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/street-icon-suggest-scene
// Gemini'den belirli bir sahne için kısa öneri al
// ═══════════════════════════════════════════════════════
router.post("/street-icon-suggest-scene", async (req, res) => {
    try {
        const { imageUrl, sceneIndex, otherScenes, currentSceneText } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        console.log(`💡 [STREET_ICON_SUGGEST] Requesting suggestion for scene ${sceneIndex}`);

        const otherScenesText = otherScenes && otherScenes.length > 0
            ? otherScenes.map((s, i) => `Scene ${i + 1}: "${s}"`).filter(s => !s.includes('""')).join('\n')
            : '';

        const suggestPrompt = `You are a creative Instagram content advisor. Look at this product/fashion photo and suggest a SHORT, candid real-life scene idea that WOULD FIT THIS SPECIFIC GARMENT.

CONTEXT — WHAT ARE "STREET ICON KITS":
Street Icon Kits transform a product photo into 5 real-life iPhone-candid Instagram scenes — the kind of photos a stylish girl would post on her personal feed. The aesthetic is: amateur iPhone, natural daylight, candid not posed, "my friend took this" vibe. NOT editorial Vogue, NOT studio photography.

The user needs a creative idea for Scene ${sceneIndex}. Your suggestion should describe a LOCATION + MOMENT that matches this garment's vibe — not the outfit itself.

THINK ABOUT THE GARMENT FIRST:
- Is it summer-light, mid-season, winter-warm? → pick a location that fits
- Casual, elegant, sporty, streetwear, boho? → pick an activity/setting that matches
- The location + moment must FEEL right for what the girl is wearing

${currentSceneText ? `IMPORTANT — The user currently has this written for Scene ${sceneIndex}: "${currentSceneText}"
You MUST suggest something COMPLETELY DIFFERENT. Do NOT repeat or rephrase this idea.
` : ''}${otherScenesText ? `The user already has these other scenes planned (DO NOT repeat or suggest anything similar):
${otherScenesText}
` : ''}
RULES:
- Respond with ONLY the suggestion text, nothing else — no quotes, no prefix, no explanation
- Maximum 8 words
- Be specific and creative — not generic
- Describe a PLACE + small moment/activity, not clothing
- iPhone-candid Instagram vibe — NOT editorial/Vogue
- Examples of good candid scenes: "Sitting on café bench with coffee", "Leaning on sunny window frame", "Walking through flea-market stalls", "Stepping off curb mid-stride", "Sitting on apartment stairs"
- NEVER suggest a scene where she holds a phone, tablet, laptop, or any screen
- Make it different from the other scenes listed above
- Write in the same language as the user's other scenes (or English if empty)

Your suggestion (max 8 words):`;

        const optimizedUrl = await getOptimizedImageUrl(imageUrl);
        const suggestion = await callReplicateGeminiFlash(suggestPrompt, [optimizedUrl || imageUrl]);
        const cleanSuggestion = suggestion.trim().replace(/^["']|["']$/g, '').replace(/^Scene \d+:\s*/i, '');

        console.log(`✅ [STREET_ICON_SUGGEST] Suggestion: ${cleanSuggestion}`);

        res.json({ success: true, suggestion: cleanSuggestion });
    } catch (error) {
        console.error("❌ [STREET_ICON_SUGGEST] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
