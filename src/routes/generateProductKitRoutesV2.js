const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const teamService = require("../services/teamService");
const { optimizeKitImages } = require("../utils/imageOptimizer");

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
const KIT_GENERATION_COST_OLD = 15;  // Users registered before cutoff date
const KIT_GENERATION_COST_NEW = 50;  // Users registered on/after cutoff date
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

// ─── Replicate Nano Banana 2 API call (for editorial & studio scenes) ───
async function callReplicateNanoBanana2(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3, aspectRatio = "9:16") {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN environment variable is not set");

    // Support legacy format
    const legacyMap = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
    const resolvedAspectRatio = legacyMap[aspectRatio] || aspectRatio || "2:3";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🍌 [KIT_V2_BANANA] Image generation attempt ${attempt}/${maxRetries}`);

            const response = await axios.post(
                "https://api.replicate.com/v1/models/google/nano-banana-2/predictions",
                {
                    input: {
                        prompt: prompt,
                        image_input: [resultImageUrl, referenceImageUrl],
                        aspect_ratio: resolvedAspectRatio,
                        resolution: "1K",
                        output_format: "jpg",
                        safety_filter_level: "block_only_high",
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

            console.log(`⏳ [KIT_V2_BANANA] Prediction created, id: ${prediction.id}`);

            let maxPolls = 90;
            for (let poll = 0; poll < maxPolls; poll++) {
                const statusResponse = await axios.get(
                    `https://api.replicate.com/v1/predictions/${prediction.id}`,
                    {
                        headers: {
                            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                        timeout: 30000,
                    }
                );

                const result = statusResponse.data;
                if (result.status === "succeeded") {
                    const output = result.output;
                    if (output) {
                        const imageUrl = Array.isArray(output) ? output[0] : output;
                        if (imageUrl) {
                            console.log(`✅ [KIT_V2_BANANA] Image generated successfully`);
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

            throw new Error("Replicate Nano Banana 2 polling timeout");
        } catch (error) {
            console.error(`❌ [KIT_V2_BANANA] Attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Scenes that use Nano Banana 2 (editorial poses + studio + detail)
const nanoBanana2Scenes = new Set([0, 1, 2, 3, 4]); // pose1, pose2, studio1, studio2, detail
// Scene 5 (ghost mannequin) uses GPT Image 1.5

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

// ─── Progressive save: append a single kit image URL to reference_results.kits ───
async function appendKitToRecord(recordId, imageUrl, sceneIndex) {
    try {
        const { data: existing, error: findError } = await supabase
            .from("reference_results")
            .select("id, kits")
            .eq("generation_id", recordId)
            .maybeSingle();

        if (findError || !existing) return null;

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

        await supabase
            .from("reference_results")
            .update({ kits: currentKits })
            .eq("id", existing.id);

        const filledCount = currentKits.filter(Boolean).length;
        console.log(`📦 [KIT_V2] Progressive save: ${filledCount} kits now in DB (slot ${sceneIndex ?? 'append'})`);
        return currentKits;
    } catch (error) {
        console.error(`❌ [KIT_V2] Progressive save error:`, error.message);
        return null;
    }
}

// ─── Parse Gemini response to extract prompts ───
function parseGeminiPrompts(geminiResponse) {
    const prompts = {
        changePose1: null, changePose2: null, detailShot: null,
        studio1: null, studio2: null, ghostMannequin: null
    };

    try {
        const changePose1Match = geminiResponse.match(/Change_Pose_1_Prompt:\s*(.+?)(?=\nChange_Pose_2_Prompt:|$)/is);
        if (changePose1Match) prompts.changePose1 = changePose1Match[1].trim();

        const changePose2Match = geminiResponse.match(/Change_Pose_2_Prompt:\s*(.+?)(?=\nDetail_Shot_Prompt:|$)/is);
        if (changePose2Match) prompts.changePose2 = changePose2Match[1].trim();

        const detailMatch = geminiResponse.match(/Detail_Shot_Prompt:\s*(.+?)(?=\nStudio_1_Prompt:|$)/is);
        if (detailMatch) prompts.detailShot = detailMatch[1].trim();

        const studio1Match = geminiResponse.match(/Studio_1_Prompt:\s*(.+?)(?=\nStudio_2_Prompt:|$)/is);
        if (studio1Match) prompts.studio1 = studio1Match[1].trim();

        const studio2Match = geminiResponse.match(/Studio_2_Prompt:\s*(.+?)(?=\nGhost_Mannequin_Prompt:|$)/is);
        if (studio2Match) prompts.studio2 = studio2Match[1].trim();

        const ghostMatch = geminiResponse.match(/Ghost_Mannequin_Prompt:\s*(.+?)$/is);
        if (ghostMatch) prompts.ghostMannequin = ghostMatch[1].trim();
    } catch (error) {
        console.error("❌ [KIT_V2_PARSE] Error:", error);
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
    changePose1: "convert to dynamic high-fashion pose with energetic movement, natural lively stance, preserve all garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.",
    changePose2: "convert to different energetic model pose, vibrant dynamic movement, fashion-forward stance, preserve garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.",
    studio1: "convert to professional standing studio shot, pure white background #FFFFFF, professional indoor studio lighting - remove outdoor natural light completely, soft diffused artificial studio lights, high-fashion e-commerce style. Apply a clean editorial color preset with natural tones.",
    studio2: "convert to professional seated or walking studio shot, pure white background #FFFFFF, DIFFERENT POSE than first shot, Fujifilm VSCO film preset style with organic tones and soft contrast, professional studio lighting setup, high-fashion e-commerce quality.",
    detailShot: "convert to extreme macro fabric detail shot, frame entirely filled with texture, no background. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.",
    ghostMannequin: "convert to professional ghost mannequin product photo: completely remove all human parts - no model visible, create invisible mannequin effect with realistic internal garment structure, clean hollow neckline showing interior, preserve all fabric details and texture, pure white background #FFFFFF no shadows, centered, Amazon e-commerce catalog standard. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."
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

        // Clear existing kits (set to empty array so client knows generation started)
        if (recordId) {
            console.log(`🧹 [KIT_V2] Clearing existing kits for record: ${recordId}`);
            await supabase
                .from("reference_results")
                .update({ kits: [] })
                .eq("generation_id", recordId);
        }

        // Respond immediately — generation happens in background
        res.json({ success: true, message: "Kit generation started", generationId: recordId });

        // ─── Background generation ───
        (async () => {
            try {
                // Step 1: Generate prompts with Gemini
                console.log("📝 [KIT_V2] Step 1: Generating prompts with Gemini...");

                const geminiPrompt = `You are an elite fashion e-commerce photographer and creative director. Analyze the following product image and generate 6 professional prompts for fashion e-commerce photography.
All prompts MUST be in ENGLISH.

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

3) Product Detail Shot (Full-Frame Macro) – 1 Prompt:
An extreme close-up detail shot where the ENTIRE frame is filled with the product's fabric and details — ZERO background visible.
- THE ENTIRE CAMERA FRAME MUST BE 100% COVERED BY THE PRODUCT. No white space, no studio background, no surface, no edges, no gaps — NOTHING except the garment's material filling every pixel of the image.
- FULL-BLEED composition: the fabric/textile must extend beyond all four edges of the frame, as if the camera is pressed right against the product
- Show the richness of the material: weave pattern, thread texture, stitching quality, fabric grain, button details, zipper teeth, label embossing, seam construction
- Macro lens photography: 100mm macro lens, f/2.8-f/4, extremely shallow depth of field with tack-sharp focus on texture details
- Professional textile photography lighting: soft directional side-lighting to reveal fabric dimension and surface texture
- Color accuracy is CRITICAL — true-to-life product color as seen in premium e-commerce (Shopify, ASOS, Net-a-Porter)
- Think extreme close-up fabric swatches used in luxury fashion product pages
- NO background, NO surface, NO negative space — the product texture IS the entire image

4, 5) Studio Poses (White Background) – 2 Prompts:
Generate 2 white studio prompts. Each prompt must produce EXACTLY ONE single photo of ONE person — NEVER a collage, grid, multi-panel, split-screen, or multiple views. ONE image, ONE pose, ONE person.
- Pure white background (#FFFFFF), PROFESSIONAL STUDIO LIGHTING only
- Studio_1: Classic standing full-body high-fashion pose with editorial attitude
- Studio_2: CLOSE-UP / MEDIUM CLOSE-UP product detail showcase — the model is actively showing off or highlighting a specific feature of the garment (pulling fabric to show stretch, adjusting a zipper, holding a collar, tugging a hem, flipping a pocket, touching a button, demonstrating a hidden compartment). Camera zoomed in tight on the torso/waist/detail area. The model's hands and the garment detail are the hero of the shot — like a product feature demonstration photo. Think: Organic Basics, Girlfriend Collective, or Lululemon product feature close-ups where models show fabric quality, hidden pockets, adjustable straps, etc.
- REMOVE all outdoor/natural daylight. Indoor studio lighting only.
- Describe the studio lighting setup in detail (key light, fill, rim, reflectors)
- CRITICAL: Each prompt generates a SINGLE photograph — NOT a mood board, NOT a lookbook page, NOT multiple angles side by side

6) Ghost Mannequin – 1 Prompt:
Professional AMAZON-STYLE ghost mannequin (invisible mannequin).
- COMPLETELY remove the model - NO face, NO hair, NO skin, NO hands visible
- Realistic internal garment structure with natural 3D fit
- Clean hollow neckline with visible interior depth
- Pure white background (#FFFFFF) - NO shadows, NO reflections
- Centered, catalog-ready, Amazon e-commerce standard
- Even, diffused studio lighting for clean product photography

Start each prompt with "convert". Respond in this EXACT format:
Change_Pose_1_Prompt: [your generated prompt]
Change_Pose_2_Prompt: [your generated prompt]
Detail_Shot_Prompt: [your generated prompt]
Studio_1_Prompt: [your generated prompt]
Studio_2_Prompt: [your generated prompt]
Ghost_Mannequin_Prompt: [your generated prompt]
`;

                const geminiResponse = await callReplicateGeminiFlash(geminiPrompt, [imageUrl]);
                console.log("✅ [KIT_V2] Gemini response received");

                const prompts = parseGeminiPrompts(geminiResponse);

                // Step 2: Get reference image
                let referenceImageUrl = imageUrl;
                if (recordId) {
                    const { data: record } = await supabase
                        .from("reference_results")
                        .select("reference_images")
                        .eq("generation_id", recordId)
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

                const imageGenerationPromises = imagePrompts.map(async (prompt, index) => {
                    try {
                        const useNanoBanana = nanoBanana2Scenes.has(index);
                        console.log(`🎨 [KIT_V2] Generating ${sceneTypes[index]} via ${useNanoBanana ? 'Nano Banana 2' : 'GPT'}...`);
                        const generatedUrl = useNanoBanana
                            ? await callReplicateNanoBanana2(prompt, optimizedResultUrl, optimizedReferenceUrl)
                            : await callReplicateGptImageEdit(prompt, optimizedResultUrl, optimizedReferenceUrl);

                        const savedUrl = await saveGeneratedImageToUserBucket(
                            generatedUrl,
                            userId || "anonymous",
                            sceneTypes[index]
                        );

                        // Progressive save: immediately save to DB at correct position
                        if (savedUrl && recordId) {
                            try {
                                await appendKitToRecord(recordId, savedUrl, index);
                                console.log(`📦 [KIT_V2] Scene ${index + 1} (${sceneTypes[index]}) saved progressively at slot ${index}`);
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
                        userId, generationId: recordId, originalPhotos,
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

        console.log(`🔄 [KIT_V2_RETRY] Retrying scene ${sceneIndex} (${sceneType}) for record: ${recordId}`);

        // Get reference image
        let referenceImageUrl = imageUrl;
        if (recordId) {
            const { data: record } = await supabase
                .from("reference_results")
                .select("reference_images")
                .eq("generation_id", recordId)
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
        const prompt = promptMap[sceneIndex] || defaultPrompts.changePose1;

        // Generate the image (Nano Banana 2 for editorial/studio/detail, GPT for ghost)
        const useNanoBanana = nanoBanana2Scenes.has(sceneIndex);
        console.log(`🔄 [KIT_V2_RETRY] Using ${useNanoBanana ? 'Nano Banana 2' : 'GPT'} for scene ${sceneIndex} (${sceneType})`);
        const generatedUrl = useNanoBanana
            ? await callReplicateNanoBanana2(prompt, optimizedResultUrl, optimizedReferenceUrl)
            : await callReplicateGptImageEdit(prompt, optimizedResultUrl, optimizedReferenceUrl);
        const savedUrl = await saveGeneratedImageToUserBucket(generatedUrl, userId || "anonymous", sceneType);

        // Save to reference_results.kits at correct position
        if (savedUrl && recordId) {
            await appendKitToRecord(recordId, savedUrl, sceneIndex);
        }

        // Also update product_kits table
        if (savedUrl && userId && userId !== "anonymous_user") {
            const { data: existingKit } = await supabase
                .from("product_kits")
                .select("id, kit_images")
                .eq("generation_id", recordId)
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
