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

// Replicate Gemini Flash API helper
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🤖 [FASHION_GEMINI] API call attempt ${attempt}/${maxRetries}`);

            const requestBody = {
                input: {
                    top_p: 0.95,
                    images: imageUrls,
                    prompt: prompt,
                    videos: [],
                    temperature: 1,
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

            console.log(`✅ [FASHION_GEMINI] Successful response (attempt ${attempt})`);
            return outputText.trim();

        } catch (error) {
            console.error(`❌ [FASHION_GEMINI] Attempt ${attempt} failed:`, error.message);

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
        console.log(`🖼️ [FASHION_OPTIMIZE] Checking/optimizing image: ${imageUrl.substring(0, 80)}...`);

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });
        const buffer = Buffer.from(response.data);
        const originalSize = buffer.length;

        if (originalSize <= MAX_FILE_SIZE) {
            console.log(`✅ [FASHION_OPTIMIZE] Image is OK (${(originalSize / 1024 / 1024).toFixed(1)}MB)`);
            return imageUrl;
        }

        const metadata = await sharp(buffer).metadata();
        console.log(`🔄 [FASHION_OPTIMIZE] Image is ${(originalSize / 1024 / 1024).toFixed(1)}MB (${metadata.width}x${metadata.height}), compressing to <7MB...`);

        let quality = 92;
        let optimizedBuffer;

        do {
            quality -= 5;
            optimizedBuffer = await sharp(buffer)
                .jpeg({ quality })
                .toBuffer();
            console.log(`🔄 [FASHION_OPTIMIZE] quality ${quality} → ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB`);
        } while (optimizedBuffer.length > MAX_FILE_SIZE && quality > 40);

        if (optimizedBuffer.length > MAX_FILE_SIZE) {
            const scale = 0.85;
            const newW = Math.round(metadata.width * scale);
            const newH = Math.round(metadata.height * scale);
            console.log(`🔄 [FASHION_OPTIMIZE] Still over 7MB, scaling to ${newW}x${newH}...`);
            optimizedBuffer = await sharp(buffer)
                .resize(newW, newH)
                .jpeg({ quality: 50 })
                .toBuffer();
        }

        console.log(`✅ [FASHION_OPTIMIZE] Final: ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB, quality ${quality}`);

        const timestamp = Date.now();
        const fileName = `temp_optimized/${timestamp}_${uuidv4().substring(0, 8)}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, optimizedBuffer, {
                contentType: "image/jpeg",
                upsert: true
            });

        if (error) {
            console.error(`❌ [FASHION_OPTIMIZE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [FASHION_OPTIMIZE] Optimized image uploaded: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [FASHION_OPTIMIZE] Error in optimization:`, error.message);
        return imageUrl;
    }
}

// Replicate GPT Image 1.5 Edit API call
async function callReplicateGptImageEdit(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3, imageSize = "1024x1536") {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [FASHION_REPLICATE] Image generation attempt ${attempt}/${maxRetries}`);
            console.log(`🎨 [FASHION_REPLICATE] Prompt: ${prompt.substring(0, 100)}...`);

            // Map size format to Replicate aspect_ratio
            const sizeToAspectRatio = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
            const aspectRatio = sizeToAspectRatio[imageSize] || "2:3";

            const response = await axios.post(
                "https://api.replicate.com/v1/models/openai/gpt-image-1.5/predictions",
                {
                    input: {
                        prompt: prompt,
                        input_images: [resultImageUrl, referenceImageUrl],
                        aspect_ratio: aspectRatio,
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

            if (!prediction.id) {
                throw new Error("Replicate did not return a prediction ID");
            }

            console.log(`⏳ [FASHION_REPLICATE] Prediction created, id: ${prediction.id}`);

            // Poll for result
            let maxPolls = 60;
            for (let poll = 0; poll < maxPolls; poll++) {
                const statusResponse = await axios.get(
                    `https://api.replicate.com/v1/predictions/${prediction.id}`,
                    {
                        headers: {
                            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                        timeout: 15000,
                    }
                );

                const result = statusResponse.data;
                console.log(`⏳ [FASHION_REPLICATE] Poll ${poll + 1}/${maxPolls}, status: ${result.status}`);

                if (result.status === "succeeded") {
                    // Replicate GPT Image returns output as URL string or array
                    const output = result.output;
                    if (output) {
                        const imageUrl = Array.isArray(output) ? output[0] : output;
                        if (imageUrl) {
                            console.log(`✅ [FASHION_REPLICATE] Image generated successfully`);
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
            console.error(`❌ [FASHION_REPLICATE] Attempt ${attempt} failed:`, error.message);

            if (attempt === maxRetries) {
                throw error;
            }

            const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Save generated image to user bucket
async function saveGeneratedImageToUserBucket(imageUrl, userId, imageType) {
    try {
        console.log(`📤 [FASHION_SAVE] Saving ${imageType} image to user bucket...`);

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `${userId}/${timestamp}_fashionkit_${imageType}_${randomId}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, imageBuffer, {
                contentType: "image/jpeg",
                cacheControl: "3600",
                upsert: false,
            });

        if (error) {
            console.error(`❌ [FASHION_SAVE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [FASHION_SAVE] Image saved: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [FASHION_SAVE] Error saving image:`, error.message);
        return imageUrl;
    }
}

// Parse Gemini response to extract 5 fashion scene prompts
function parseFashionPrompts(geminiResponse) {
    const prompts = {
        luxuryRedRoom: null,
        openRoad: null,
        retroVintage: null,
        cinematicPortrait: null,
        avantGardeStudio: null
    };

    try {
        const scene1Match = geminiResponse.match(/Scene_1:\s*(.+?)(?=\nScene_2:|$)/is);
        if (scene1Match) prompts.luxuryRedRoom = scene1Match[1].trim();

        const scene2Match = geminiResponse.match(/Scene_2:\s*(.+?)(?=\nScene_3:|$)/is);
        if (scene2Match) prompts.openRoad = scene2Match[1].trim();

        const scene3Match = geminiResponse.match(/Scene_3:\s*(.+?)(?=\nScene_4:|$)/is);
        if (scene3Match) prompts.retroVintage = scene3Match[1].trim();

        const scene4Match = geminiResponse.match(/Scene_4:\s*(.+?)(?=\nScene_5:|$)/is);
        if (scene4Match) prompts.cinematicPortrait = scene4Match[1].trim();

        const scene5Match = geminiResponse.match(/Scene_5:\s*(.+?)$/is);
        if (scene5Match) prompts.avantGardeStudio = scene5Match[1].trim();

        console.log("📝 [FASHION_PARSE] Parsed prompts:", {
            scene1: !!prompts.luxuryRedRoom,
            scene2: !!prompts.openRoad,
            scene3: !!prompts.retroVintage,
            scene4: !!prompts.cinematicPortrait,
            scene5: !!prompts.avantGardeStudio
        });

    } catch (error) {
        console.error("❌ [FASHION_PARSE] Error parsing prompts:", error);
    }

    return prompts;
}

// Update fashion_kits column in reference_results
async function updateFashionKitsForRecord(recordId, fashionImages) {
    try {
        console.log("👗 [FASHION_KITS] Updating fashion_kits for record...");

        if (!recordId || !fashionImages || fashionImages.length === 0) {
            console.log("⚠️ [FASHION_KITS] No images to save or missing recordId");
            return null;
        }

        const { data: existingRecord, error: findError } = await supabase
            .from("reference_results")
            .select("id, fashion_kits")
            .eq("generation_id", recordId)
            .maybeSingle();

        if (findError) {
            console.log("⚠️ [FASHION_KITS] Database lookup error (non-critical):", findError.message);
            return null;
        }

        if (!existingRecord) {
            console.log("⚠️ [FASHION_KITS] No record found - skipping fashion_kits update");
            return null;
        }

        console.log("✅ [FASHION_KITS] Found record ID:", existingRecord.id);

        const { data: updateData, error: updateError } = await supabase
            .from("reference_results")
            .update({ fashion_kits: fashionImages })
            .eq("id", existingRecord.id)
            .select();

        if (updateError) {
            console.error("❌ [FASHION_KITS] Error updating fashion_kits:", updateError);
            return null;
        }

        console.log("✅ [FASHION_KITS] Fashion kits updated successfully:", fashionImages.length, "images");
        return updateData;

    } catch (error) {
        console.error("❌ [FASHION_KITS] Error:", error.message);
        return null;
    }
}

// Save fashion kit to database (product_fashion_kits table)
async function saveFashionKitToDatabase({
    userId,
    generationId,
    originalPhotos,
    fashionKitImages,
    processingTimeSeconds,
    creditsUsed,
    isFreeTier
}) {
    try {
        console.log("💾 [SAVE_FASHION] Saving fashion kit to database...");

        if (!userId || !generationId) {
            console.log("⚠️ [SAVE_FASHION] Missing userId or generationId, skipping save");
            return null;
        }

        const { data, error } = await supabase
            .from("product_fashion_kits")
            .insert({
                user_id: userId,
                generation_id: generationId,
                original_photos: originalPhotos || [],
                fashion_kit_images: fashionKitImages || [],
                processing_time_seconds: Math.round(processingTimeSeconds),
                total_images_generated: fashionKitImages?.length || 0,
                credits_used: creditsUsed,
                is_free_tier: isFreeTier
            })
            .select()
            .single();

        if (error) {
            console.error("❌ [SAVE_FASHION] Database insert error:", error);
            return null;
        }

        console.log("✅ [SAVE_FASHION] Fashion kit saved successfully, ID:", data.id);
        return data;

    } catch (error) {
        console.error("❌ [SAVE_FASHION] Unexpected error:", error.message);
        return null;
    }
}

// Increment fashion kit count in user_fashion_stats
async function incrementFashionCount(userId) {
    if (!userId) return;
    try {
        console.log(`📈 [FASHION_STATS] Incrementing fashion kit count for user: ${userId}`);

        // First check if row exists
        const { data: existing, error: selectError } = await supabase
            .from("user_fashion_stats")
            .select("id, fashion_kit_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (selectError) throw selectError;

        if (existing) {
            // Update existing row
            const newCount = (existing.fashion_kit_count || 0) + 1;
            const { error: updateError } = await supabase
                .from("user_fashion_stats")
                .update({
                    fashion_kit_count: newCount,
                    updated_at: new Date().toISOString()
                })
                .eq("id", existing.id);

            if (updateError) throw updateError;
            console.log(`✅ [FASHION_STATS] Updated. New count: ${newCount}`);
        } else {
            // Insert new row
            const { error: insertError } = await supabase
                .from("user_fashion_stats")
                .insert({
                    user_id: userId,
                    fashion_kit_count: 1,
                    updated_at: new Date().toISOString()
                });

            if (insertError) throw insertError;
            console.log(`✅ [FASHION_STATS] Created new record. Count: 1`);
        }
    } catch (error) {
        console.error("❌ [FASHION_STATS] Error incrementing count:", error.message);
    }
}

// Check if user has enough credits
async function checkUserBalance(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

        if (error || !user) {
            console.error("❌ [FASHION_CREDIT] Error fetching user balance:", error);
            return false;
        }

        const balance = user.credit_balance || 0;
        console.log(`💳 [FASHION_CREDIT] User: ${userId}, Balance: ${balance}, Cost: ${cost}`);

        return balance >= cost;
    } catch (error) {
        console.error("❌ [FASHION_CREDIT] Unexpected error:", error);
        return false;
    }
}

// Deduct user credit using RPC
async function deductUserCredit(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        console.log(`💳 [FASHION_DEDUCT] Deducting ${cost} credits from user ${userId}...`);

        const { data, error } = await supabase.rpc("deduct_user_credit", {
            user_id: userId,
            credit_amount: cost
        });

        if (error) {
            console.error("❌ [FASHION_DEDUCT] RPC Error:", error);
            return false;
        }

        console.log(`✅ [FASHION_DEDUCT] Successfully deducted ${cost} credits.`);
        return true;
    } catch (error) {
        console.error("❌ [FASHION_DEDUCT] Unexpected error:", error);
        return false;
    }
}

// Get user's fashion kit generation count
async function getUserFashionCount(userId) {
    if (!userId || userId === "anonymous_user") return 0;

    try {
        const { data, error } = await supabase
            .from("user_fashion_stats")
            .select("fashion_kit_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            console.error("❌ [FASHION_COUNT] Error fetching count:", error);
            return 0;
        }

        return data?.fashion_kit_count || 0;
    } catch (error) {
        console.error("❌ [FASHION_COUNT] Unexpected error:", error);
        return 0;
    }
}

// ═══════════════════════════════════════════════════════
// POST /api/generate-fashion-kit
// ═══════════════════════════════════════════════════════
router.post("/generate-fashion-kit", async (req, res) => {
    const startTime = Date.now();
    const FASHION_GENERATION_COST = 20; // 5 scenes = 20 credits
    const FREE_TIER_LIMIT = 2; // First 2 generations free

    try {
        const { imageUrl, recordId, userId, teamAware } = req.body;

        console.log(`👗 [FASHION] Request received for URL: ${imageUrl?.substring(0, 50)}...`);
        console.log(`👗 [FASHION] Record ID: ${recordId}, User ID: ${userId}, teamAware: ${teamAware}`);

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
            console.log(`📊 [FASHION] Team-aware: creditOwnerId=${creditOwnerId}, isTeamCredit=${isTeamCredit}`);
        }

        // STEP -2: Check Free Tier Status
        let isFree = false;
        if (creditOwnerId && creditOwnerId !== "anonymous_user") {
            const fashionCount = await getUserFashionCount(creditOwnerId);
            console.log(`📊 [FASHION] Fashion kit count for ${creditOwnerId}: ${fashionCount}`);
            if (fashionCount < FREE_TIER_LIMIT) {
                isFree = true;
                console.log(`🎁 [FASHION] Within FREE TIER (count < ${FREE_TIER_LIMIT}). No credits will be deducted.`);
            }
        }

        // STEP -1: Check Credit Balance
        if (!isFree && creditOwnerId && creditOwnerId !== "anonymous_user") {
            const hasEnoughCredits = await checkUserBalance(creditOwnerId, FASHION_GENERATION_COST);
            if (!hasEnoughCredits) {
                console.warn(`⛔ [FASHION] Insufficient credits for creditOwnerId: ${creditOwnerId}`);
                return res.status(402).json({
                    success: false,
                    error: "INSUFFICIENT_CREDITS",
                    message: "You do not have enough credits to generate a fashion kit."
                });
            }
        }

        // STEP 0: Clear existing fashion_kits if re-generation
        if (recordId) {
            console.log(`🧹 [FASHION] Clearing existing fashion_kits for record: ${recordId}`);
            await supabase
                .from("reference_results")
                .update({ fashion_kits: null })
                .eq("generation_id", recordId);
        }

        // Step 0.5: Fetch user fashion preferences
        let userPreferences = null;
        try {
            const { data } = await supabase
                .from("user_fashion_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();
            if (data) {
                userPreferences = data;
                console.log(`📋 [FASHION] User preferences found for: ${userId}`);
            }
        } catch (e) {
            console.log("⚠️ [FASHION] Could not fetch user preferences:", e.message);
        }

        // Step 1: Generate prompts with Gemini
        console.log("📝 [FASHION] Step 1: Generating fashion kit prompts with Gemini...");

        const up = userPreferences || {};
        const generalNotesLine = up.general_notes ? `\nUser's global style note: ${up.general_notes}\n` : '';

        // Scene descriptions: user custom or defaults
        const scene1 = up.scene_1_instruction || 'Bold luxury interior with deep red walls, velvet sofa, baroque mirrors, patterned oriental rugs, vintage brass decor, warm editorial campaign atmosphere';
        const scene2 = up.scene_2_instruction || 'Cinematic open road or dramatic highway, wide landscape, distant mountains, bright natural sunlight, adventurous designer campaign feel';
        const scene3 = up.scene_3_instruction || 'Vintage-inspired rich interior, dramatic patterned curtains, warm-toned textures, antique furniture, eclectic cultural styling, retro film color grading';
        const scene4 = up.scene_4_instruction || 'Dramatic cinematic portrait, vast minimal or atmospheric setting, strong directional light, soft shadows, muted film-like color grading, powerful editorial mood';
        const scene5 = up.scene_5_instruction || 'Avant-garde unconventional studio, industrial textures, creative artistic props, experimental fashion photography, bold contemporary designer campaign';

        const geminiPrompt = `You are the creative director for Gucci Dapper Dan, Versace, and Vogue Italia campaigns. You create BOLD, STORY-DRIVEN fashion editorials — not generic studio shots. Every scene tells a VISUAL STORY with unexpected settings, dramatic cultural elements, and cinematic atmosphere.

TASK: Analyze this product photo and write 5 "Transform the image into..." prompts. Each prompt creates a completely different HIGH-FASHION EDITORIAL world around the garment.

INSPIRATION EXAMPLES (understand this VIBE):
- Model standing powerfully between two dark horses in a misty desert, wearing ethnic jewelry, tribal editorial atmosphere
- Model sitting elegantly on a rustic wooden chair in front of colorful hanging traditional rugs in a village courtyard, chickens walking around, editorial meets authentic culture
- Close-up portrait with oversized designer sunglasses, bold gold chain necklace, giant dollar bill backdrop, Gucci Dapper Dan maximalist pop-art energy
- Model lounging on deep red velvet sofa surrounded by baroque mirrors and oriental rugs, warm editorial lighting, luxury campaign atmosphere
- Model walking confidently on an open highway with distant mountains, bright sunlight, cinematic adventure editorial

STRICT PROMPT STRUCTURE (follow this exact pattern for EVERY prompt):
1. "Transform the image into [bold scene concept]."
2. "Preserve the clothing, garment details, color, texture, and fabric exactly as they are."
3. Describe a SPECIFIC DYNAMIC POSE that tells a story (sitting on a chair, standing between animals, leaning on a vintage car, walking on a road, lounging on furniture — each scene DIFFERENT)
4. Describe a VIVID, UNEXPECTED ENVIRONMENT with concrete props and textures (not generic — use horses, rugs, vintage cars, money backdrops, desert sand, village stones, baroque furniture, neon signs, etc.)
5. Describe CINEMATIC LIGHTING and COLOR GRADING (film-like, editorial, dramatic)
6. End with: "The final image should resemble [quality target]"

RULES:
- Each prompt MUST be 80-120 words, written as ONE flowing paragraph
- ALWAYS start with "Transform the image into"
- ALWAYS include "Preserve the clothing, garment details, color, texture, and fabric exactly as they are."
- Each scene MUST have a COMPLETELY DIFFERENT POSE — sitting, standing, walking, lounging, close-up, etc.
- NEVER say "preserve the pose" — the pose MUST change, only clothing stays the same
- Environments must be BOLD and STORY-DRIVEN — not generic. Think: cultural locations, dramatic natural settings, maximalist interiors, pop-art backdrops, rustic villages
- ALWAYS end with "The final image should resemble..." quality statement
- Each scene must feel like a DIFFERENT WORLD — different mood, setting, pose, color palette, and story
- Write in ENGLISH only
- CONTENT SAFETY: No alcohol, bars, cocktails, nightclubs, smoking, drugs. No suggestive or provocative body descriptions — focus ONLY on garment and scene. Always add "professional fashion photography, editorial style". Keep prompts safe for AI content moderation.
${generalNotesLine}
Scene concepts (may be in any language — understand them, write prompt in English):
Scene 1 (Luxury Red Room): ${scene1}
Scene 2 (Open Road Campaign): ${scene2}
Scene 3 (Retro Vintage): ${scene3}
Scene 4 (Cinematic Portrait): ${scene4}
Scene 5 (Avant-Garde Studio): ${scene5}

Respond EXACTLY in this format (nothing else):
Scene_1: [prompt]
Scene_2: [prompt]
Scene_3: [prompt]
Scene_4: [prompt]
Scene_5: [prompt]`;

        // Optimize image for Gemini (max 1024px, <7MB)
        const optimizedGeminiUrl = await getOptimizedImageUrl(imageUrl);
        const geminiResponse = await callReplicateGeminiFlash(geminiPrompt, [optimizedGeminiUrl || imageUrl]);
        console.log("✅ [FASHION] Gemini response received");
        console.log("📝 [FASHION] Raw response:", geminiResponse.substring(0, 500));

        // Parse prompts
        const prompts = parseFashionPrompts(geminiResponse);

        // Step 2: Get reference_images from database
        console.log("🔍 [FASHION] Step 2: Fetching reference_images from database...");

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
                    console.log("✅ [FASHION] Found reference_image:", referenceImageUrl.substring(0, 80) + "...");
                } else {
                    console.log("⚠️ [FASHION] No reference_images found for recordId:", recordId);
                }
            }
        } catch (error) {
            console.log("⚠️ [FASHION] Reference image lookup error:", error.message);
        }

        // Step 3: Generate images with Fal.ai
        console.log("🎨 [FASHION] Step 3: Generating 5 fashion scenes with Fal.ai...");

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedImages = [];
        const sceneTypes = ["luxuryRedRoom", "openRoad", "retroVintage", "cinematicPortrait", "avantGardeStudio"];

        const scenePrompts = [
            prompts.luxuryRedRoom || "Transform the image into a bold luxury fashion editorial scene set in a dramatic interior. Preserve the clothing, garment details, color, texture, and fabric exactly as they are. Place the subject within an opulent room with deep red walls and a plush velvet sofa, creating a striking monochrome environment. Add rich interior elements such as patterned rugs, vintage decor, and stylish objects to create a playful high-fashion campaign atmosphere. Use strong directional editorial lighting, deep shadows, and vibrant cinematic color grading. The final image should resemble a premium luxury fashion campaign photographed for a high-end designer brand, with dramatic styling, polished magazine-quality lighting, and ultra-realistic detail.",
            prompts.openRoad || "Transform the image into a cinematic luxury fashion campaign photographed on an open road. Preserve the clothing, garment details, color, texture, and fabric exactly as they are. Enhance the environment into a dramatic highway setting with wide open space, distant mountains, and towering infrastructure elements in the background. The scene should feel adventurous and editorial, as if captured for a designer fashion campaign. Use bright natural sunlight, crisp shadows, and cinematic color grading to enhance the atmosphere. The final image should resemble a high-end fashion advertisement with strong editorial styling and magazine-quality realism.",
            prompts.retroVintage || "Transform the image into a vintage-inspired luxury editorial photoshoot set inside a richly textured interior environment. Preserve the clothing, garment details, color, texture, and fabric exactly as they are. Enhance the surroundings with dramatic patterned curtains, warm-toned interior textures, vintage furniture, and eclectic styling details. Use bold editorial lighting with rich color contrast and slightly retro color grading reminiscent of classic fashion campaigns. The final image should resemble a high-fashion magazine editorial with strong art direction, stylized atmosphere, and ultra-realistic photographic quality.",
            prompts.cinematicPortrait || "Transform the image into a cinematic fashion portrait with a dramatic and artistic atmosphere. Preserve the clothing, garment details, color, texture, and fabric exactly as they are. Enhance the surrounding environment to feel vast, minimal, and atmospheric, with cinematic lighting and subtle depth. Introduce strong directional light, soft shadows, and muted cinematic color grading to create a powerful editorial mood. The final image should resemble a striking fashion campaign visual with strong art direction, elegant composition, and ultra-realistic detail.",
            prompts.avantGardeStudio || "Transform the image into an avant-garde fashion editorial scene set inside an unconventional studio environment. Preserve the clothing, garment details, color, texture, and fabric exactly as they are. Enhance the location with industrial textures, creative props, and artistic studio elements that give the scene a playful and experimental fashion photography atmosphere. Use bold studio lighting, high contrast, and strong color styling to emphasize a contemporary designer campaign aesthetic. The final image should resemble an experimental high-fashion editorial photographed for a modern luxury brand, with conceptual art direction and ultra-realistic photographic quality."
        ];

        // Generate all 5 scenes in parallel
        const imageGenerationPromises = scenePrompts.map(async (prompt, index) => {
            try {
                console.log(`🎨 [FASHION] Generating scene ${index + 1} (${sceneTypes[index]})...`);
                const userImageSize = up.aspect_ratio || "1024x1536";
                const generatedUrl = await callReplicateGptImageEdit(prompt, optimizedResultUrl, optimizedReferenceUrl, 3, userImageSize);

                const savedUrl = await saveGeneratedImageToUserBucket(
                    generatedUrl,
                    userId || "anonymous",
                    sceneTypes[index]
                );

                return {
                    type: sceneTypes[index],
                    url: savedUrl,
                    prompt: prompt
                };
            } catch (error) {
                console.error(`❌ [FASHION] Error generating scene ${sceneTypes[index]}:`, error.message);
                return {
                    type: sceneTypes[index],
                    url: null,
                    error: error.message
                };
            }
        });

        const results = await Promise.all(imageGenerationPromises);

        results.forEach(result => {
            if (result.url) {
                generatedImages.push(result.url);
            }
        });

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [FASHION] Generation completed in ${processingTime.toFixed(1)}s`);
        console.log(`📊 [FASHION] Generated ${generatedImages.length}/5 scenes`);

        // Step 4: Save fashion kit images to reference_results.fashion_kits
        if (generatedImages.length > 0 && recordId) {
            console.log("👗 [FASHION] Step 4: Saving to reference_results.fashion_kits...");
            await updateFashionKitsForRecord(recordId, generatedImages);
        }

        // Step 4.5: Save to product_fashion_kits table
        if (generatedImages.length > 0 && userId && userId !== "anonymous_user") {
            console.log("💾 [FASHION] Step 4.5: Saving to product_fashion_kits table...");

            const originalPhotos = [imageUrl];
            if (referenceImageUrl && referenceImageUrl !== imageUrl) {
                originalPhotos.push(referenceImageUrl);
            }

            const fashionKitImagesData = results
                .filter(r => r.url)
                .map(r => ({
                    type: r.type,
                    url: r.url,
                    prompt: r.prompt || null
                }));

            await saveFashionKitToDatabase({
                userId: userId,
                generationId: recordId,
                originalPhotos: originalPhotos,
                fashionKitImages: fashionKitImagesData,
                processingTimeSeconds: processingTime,
                creditsUsed: isFree ? 0 : FASHION_GENERATION_COST,
                isFreeTier: isFree
            });
        }

        // Step 5: Increment stats
        if (generatedImages.length > 0 && creditOwnerId) {
            await incrementFashionCount(creditOwnerId);
            console.log(`📊 [FASHION] Stats incremented for: ${creditOwnerId}`);
        }

        // Step 6: Deduct Credits
        if (!isFree && generatedImages.length > 0 && creditOwnerId && creditOwnerId !== "anonymous_user") {
            console.log(`💳 [FASHION] Step 6: Deducting credits from: ${creditOwnerId}...`);
            const deducted = await deductUserCredit(creditOwnerId, FASHION_GENERATION_COST);
            if (!deducted) {
                console.error("❌ [FASHION] Credit deduction failed even after successful generation!");
            }
        }

        res.json({
            success: true,
            images: generatedImages,
            prompts: {
                Scene_1_LuxuryRedRoom_Prompt: prompts.luxuryRedRoom || "",
                Scene_2_OpenRoad_Prompt: prompts.openRoad || "",
                Scene_3_RetroVintage_Prompt: prompts.retroVintage || "",
                Scene_4_CinematicPortrait_Prompt: prompts.cinematicPortrait || "",
                Scene_5_AvantGardeStudio_Prompt: prompts.avantGardeStudio || ""
            },
            details: results,
            processingTimeSeconds: processingTime
        });

    } catch (error) {
        console.error("❌ [FASHION] Error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            processingTimeSeconds: (Date.now() - startTime) / 1000
        });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/fashion-stats/:userId
// ═══════════════════════════════════════════════════════
router.get("/fashion-stats/:userId", async (req, res) => {
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
            .from("user_fashion_stats")
            .select("fashion_kit_count")
            .eq("user_id", effectiveUserId)
            .maybeSingle();

        if (error) throw error;

        res.json({
            success: true,
            count: data?.fashion_kit_count || 0,
            isTeamData
        });
    } catch (error) {
        console.error("❌ [FASHION_STATS] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/user-fashion-kits/:userId
// ═══════════════════════════════════════════════════════
router.get("/user-fashion-kits/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

        console.log(`👗 [USER_FASHION] Fetching fashion kits for user: ${userId}, limit: ${limit}, offset: ${offset}`);

        const { data, error, count } = await supabase
            .from("product_fashion_kits")
            .select("*", { count: "exact" })
            .in("user_id", memberIds)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        console.log(`✅ [USER_FASHION] Found ${data?.length || 0} fashion kits`);

        res.json({
            success: true,
            fashionKits: data || [],
            totalCount: count || 0,
            hasMore: (offset + limit) < (count || 0),
            isTeamData: isTeamMember
        });
    } catch (error) {
        console.error("❌ [USER_FASHION] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/fashion-preferences/:userId
// ═══════════════════════════════════════════════════════
router.get("/fashion-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from("user_fashion_preferences")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) throw error;

        res.json({ success: true, data: data || null });
    } catch (error) {
        console.error("❌ [FASHION_PREFS] GET error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/fashion-preferences/:userId
// ═══════════════════════════════════════════════════════
router.post("/fashion-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            scene_1_instruction, scene_2_instruction, scene_3_instruction,
            scene_4_instruction, scene_5_instruction, general_notes, aspect_ratio
        } = req.body;

        const { data, error } = await supabase
            .from("user_fashion_preferences")
            .upsert({
                user_id: userId,
                scene_1_instruction: scene_1_instruction || '',
                scene_2_instruction: scene_2_instruction || '',
                scene_3_instruction: scene_3_instruction || '',
                scene_4_instruction: scene_4_instruction || '',
                scene_5_instruction: scene_5_instruction || '',
                general_notes: general_notes || '',
                aspect_ratio: aspect_ratio || '1024x1536',
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" })
            .select()
            .single();

        if (error) throw error;

        console.log(`✅ [FASHION_PREFS] Saved preferences for user: ${userId}`);
        res.json({ success: true, data });
    } catch (error) {
        console.error("❌ [FASHION_PREFS] POST error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/fashion-suggest-scene
// ═══════════════════════════════════════════════════════
router.post("/fashion-suggest-scene", async (req, res) => {
    try {
        const { imageUrl, sceneIndex, otherScenes, currentSceneText } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        console.log(`💡 [FASHION_SUGGEST] Requesting suggestion for scene ${sceneIndex}`);

        const otherScenesText = otherScenes && otherScenes.length > 0
            ? otherScenes.map((s, i) => `Scene ${i + 1}: "${s}"`).filter(s => !s.includes('""')).join('\n')
            : '';

        const suggestPrompt = `You are a creative high-fashion editorial director. Look at this product/fashion photo and suggest a SHORT, creative HIGH-FASHION scene idea for a luxury editorial photo.

CONTEXT — WHAT ARE "FASHION KITS":
Fashion Kits transform a product photo into stunning high-fashion editorial scenes. The AI takes the original product photo and CONVERTS it into a new scene — the model wearing the same outfit but in a completely different HIGH-FASHION setting. Think of it as "what would this outfit look like on a Gucci campaign, a Vogue cover, a fashion runway, an avant-garde editorial, etc."

The user needs a creative idea for Scene ${sceneIndex}. Your suggestion should describe a HIGH-FASHION SETTING/SCENARIO — not the outfit itself (the outfit stays the same).

${currentSceneText ? `IMPORTANT — The user currently has this written for Scene ${sceneIndex}: "${currentSceneText}"
You MUST suggest something COMPLETELY DIFFERENT from this. Do NOT repeat or rephrase this idea. Come up with an entirely new, unrelated scene concept.
` : ''}${otherScenesText ? `The user already has these other scenes planned (DO NOT repeat or suggest anything similar to these):
${otherScenesText}
` : ''}
RULES:
- Respond with ONLY the suggestion text, nothing else — no quotes, no prefix, no explanation
- Maximum 8 words
- Be specific and creative — not generic
- Describe a HIGH-FASHION PLACE, SET, or CONCEPT, not clothing
- Think luxury editorial, fashion campaigns, runway shows, art-fashion crossovers
- Examples of good suggestions: "Dramatic neon-lit Tokyo alley runway", "Baroque palace grand staircase editorial", "Industrial warehouse with smoke machines", "Desert dunes golden hour Vogue shoot", "Mirrored infinity room avant-garde"
- Make it different from the other scenes listed above
- Write in the same language as the user's other scenes. If other scenes are empty or in English, write in English.

Your suggestion (max 8 words):`;

        const optimizedUrl = await getOptimizedImageUrl(imageUrl);
        const suggestion = await callReplicateGeminiFlash(suggestPrompt, [optimizedUrl || imageUrl]);
        const cleanSuggestion = suggestion.trim().replace(/^["']|["']$/g, '').replace(/^Scene \d+:\s*/i, '');

        console.log(`✅ [FASHION_SUGGEST] Suggestion: ${cleanSuggestion}`);

        res.json({ success: true, suggestion: cleanSuggestion });
    } catch (error) {
        console.error("❌ [FASHION_SUGGEST] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
