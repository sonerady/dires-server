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
            console.log(`🤖 [STORY_GEMINI] API call attempt ${attempt}/${maxRetries}`);

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

            console.log(`✅ [STORY_GEMINI] Successful response (attempt ${attempt})`);
            return outputText.trim();

        } catch (error) {
            console.error(`❌ [STORY_GEMINI] Attempt ${attempt} failed:`, error.message);

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
        console.log(`🖼️ [STORY_OPTIMIZE] Checking/optimizing image: ${imageUrl.substring(0, 80)}...`);

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });
        const buffer = Buffer.from(response.data);
        const originalSize = buffer.length;

        // Already under 7MB — no optimization needed
        if (originalSize <= MAX_FILE_SIZE) {
            console.log(`✅ [STORY_OPTIMIZE] Image is OK (${(originalSize / 1024 / 1024).toFixed(1)}MB)`);
            return imageUrl;
        }

        const metadata = await sharp(buffer).metadata();
        console.log(`🔄 [STORY_OPTIMIZE] Image is ${(originalSize / 1024 / 1024).toFixed(1)}MB (${metadata.width}x${metadata.height}), compressing to <7MB...`);

        // Step 1: Keep original dimensions, just lower JPEG quality progressively
        let quality = 92;
        let optimizedBuffer;

        do {
            quality -= 5;
            optimizedBuffer = await sharp(buffer)
                .jpeg({ quality })
                .toBuffer();
            console.log(`🔄 [STORY_OPTIMIZE] quality ${quality} → ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB`);
        } while (optimizedBuffer.length > MAX_FILE_SIZE && quality > 40);

        // Step 2: If still over 7MB after quality reduction, scale down slightly
        if (optimizedBuffer.length > MAX_FILE_SIZE) {
            const scale = 0.85;
            const newW = Math.round(metadata.width * scale);
            const newH = Math.round(metadata.height * scale);
            console.log(`🔄 [STORY_OPTIMIZE] Still over 7MB, scaling to ${newW}x${newH}...`);
            optimizedBuffer = await sharp(buffer)
                .resize(newW, newH)
                .jpeg({ quality: 50 })
                .toBuffer();
        }

        console.log(`✅ [STORY_OPTIMIZE] Final: ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB, quality ${quality}`);

        const timestamp = Date.now();
        const fileName = `temp_optimized/${timestamp}_${uuidv4().substring(0, 8)}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, optimizedBuffer, {
                contentType: "image/jpeg",
                upsert: true
            });

        if (error) {
            console.error(`❌ [STORY_OPTIMIZE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [STORY_OPTIMIZE] Optimized image uploaded: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [STORY_OPTIMIZE] Error in optimization:`, error.message);
        return imageUrl;
    }
}

// Replicate Nano Banana Pro (Google Gemini 3 Pro Image) API call
async function callReplicateNanoBananaPro(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3, imageSize = "1024x1536") {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    const legacyMap = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
    const aspectRatio = legacyMap[imageSize] || imageSize || "9:16";

    const models = [
        { name: "nano-banana-2", url: "https://api.replicate.com/v1/models/google/nano-banana-2/predictions" },
        { name: "nano-banana-pro", url: "https://api.replicate.com/v1/models/google/nano-banana-pro/predictions" },
    ];

    for (const model of models) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🍌 [STORY_BANANA] ${model.name} attempt ${attempt}/${maxRetries}`);
                console.log(`🍌 [STORY_BANANA] Prompt: ${prompt.substring(0, 100)}...`);

                const response = await axios.post(
                    model.url,
                    {
                        input: {
                            prompt: prompt,
                            image_input: [resultImageUrl, referenceImageUrl],
                            aspect_ratio: aspectRatio,
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

                console.log(`⏳ [STORY_BANANA] ${model.name} prediction created, id: ${prediction.id}`);

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
                                console.log(`✅ [STORY_BANANA] ${model.name} image generated successfully`);
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

                throw new Error(`${model.name} polling timeout`);
            } catch (error) {
                console.error(`❌ [STORY_BANANA] ${model.name} attempt ${attempt} failed:`, error.message);
                const isCapacityError = error.message && (error.message.includes("E003") || error.message.includes("unavailable due to high demand"));
                if (isCapacityError) {
                    console.log(`⚡ [STORY_BANANA] ${model.name} capacity error, skipping to fallback immediately`);
                    break;
                }
                if (attempt === maxRetries) break;
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        console.log(`⚠️ [STORY_BANANA] ${model.name} failed, trying next model...`);
    }

    throw new Error("All Nano Banana models failed (nano-banana-2 and nano-banana-pro)");
}

// Save generated image to user bucket
async function saveGeneratedImageToUserBucket(imageUrl, userId, imageType) {
    try {
        console.log(`📤 [STORY_SAVE] Saving ${imageType} image to user bucket...`);

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `${userId}/${timestamp}_productstory_${imageType}_${randomId}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, imageBuffer, {
                contentType: "image/jpeg",
                cacheControl: "3600",
                upsert: false,
            });

        if (error) {
            console.error(`❌ [STORY_SAVE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [STORY_SAVE] Image saved: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [STORY_SAVE] Error saving image:`, error.message);
        return imageUrl;
    }
}

// Parse Gemini response to extract 5 story scene prompts
function parseStoryPrompts(geminiResponse) {
    const prompts = {
        mirrorSelfie: null,
        coffeeDate: null,
        friendsNight: null,
        streetStyle: null,
        weekendVibes: null,
        friendsGroup: null
    };

    try {
        const scene1Match = geminiResponse.match(/Scene_1:\s*(.+?)(?=\nScene_2:|$)/is);
        if (scene1Match) prompts.mirrorSelfie = scene1Match[1].trim();

        const scene2Match = geminiResponse.match(/Scene_2:\s*(.+?)(?=\nScene_3:|$)/is);
        if (scene2Match) prompts.coffeeDate = scene2Match[1].trim();

        const scene3Match = geminiResponse.match(/Scene_3:\s*(.+?)(?=\nScene_4:|$)/is);
        if (scene3Match) prompts.friendsNight = scene3Match[1].trim();

        const scene4Match = geminiResponse.match(/Scene_4:\s*(.+?)(?=\nScene_5:|$)/is);
        if (scene4Match) prompts.streetStyle = scene4Match[1].trim();

        const scene5Match = geminiResponse.match(/Scene_5:\s*(.+?)(?=\nScene_6:|$)/is);
        if (scene5Match) prompts.weekendVibes = scene5Match[1].trim();

        const scene6Match = geminiResponse.match(/Scene_6:\s*(.+?)$/is);
        if (scene6Match) prompts.friendsGroup = scene6Match[1].trim();

        console.log("📝 [STORY_PARSE] Parsed prompts:", {
            scene1: !!prompts.mirrorSelfie,
            scene2: !!prompts.coffeeDate,
            scene3: !!prompts.friendsNight,
            scene4: !!prompts.streetStyle,
            scene5: !!prompts.weekendVibes,
            scene6: !!prompts.friendsGroup
        });

    } catch (error) {
        console.error("❌ [STORY_PARSE] Error parsing prompts:", error);
    }

    return prompts;
}

// Update stories column in reference_results
async function updateStoriesForRecord(recordId, storyImages) {
    try {
        console.log("📖 [STORIES] Updating stories for record...");

        if (!recordId || !storyImages || storyImages.length === 0) {
            console.log("⚠️ [STORIES] No images to save or missing recordId");
            return null;
        }

        const { data: existingRecord, error: findError } = await supabase
            .from("reference_results")
            .select("id, stories")
            .eq("generation_id", recordId)
            .maybeSingle();

        if (findError) {
            console.log("⚠️ [STORIES] Database lookup error (non-critical):", findError.message);
            return null;
        }

        if (!existingRecord) {
            console.log("⚠️ [STORIES] No record found - skipping stories update");
            return null;
        }

        console.log("✅ [STORIES] Found record ID:", existingRecord.id);

        const { data: updateData, error: updateError } = await supabase
            .from("reference_results")
            .update({ stories: storyImages })
            .eq("id", existingRecord.id)
            .select();

        if (updateError) {
            console.error("❌ [STORIES] Error updating stories:", updateError);
            return null;
        }

        console.log("✅ [STORIES] Stories updated successfully:", storyImages.length, "story images");
        return updateData;

    } catch (error) {
        console.error("❌ [STORIES] Error:", error.message);
        return null;
    }
}

// Append a single story image URL to reference_results.stories (progressive save)
async function appendStoryToRecord(recordId, imageUrl, sceneIndex) {
    const { data: existing, error: findError } = await supabase
        .from("reference_results")
        .select("id, stories")
        .eq("generation_id", recordId)
        .maybeSingle();

    if (findError || !existing) return null;

    let currentStories = Array.isArray(existing.stories) ? [...existing.stories] : [];

    if (sceneIndex !== undefined && sceneIndex !== null) {
        // Position-preserved: place at correct slot
        while (currentStories.length <= sceneIndex) currentStories.push(null);
        currentStories[sceneIndex] = imageUrl;
    } else {
        // Legacy fallback: append
        if (currentStories.includes(imageUrl)) return null;
        currentStories.push(imageUrl);
    }

    await supabase
        .from("reference_results")
        .update({ stories: currentStories })
        .eq("id", existing.id);

    return currentStories;
}

// Save product story to database (product_stories table)
async function saveProductStoryToDatabase({
    userId,
    generationId,
    originalPhotos,
    storyImages,
    processingTimeSeconds,
    creditsUsed,
    isFreeTier
}) {
    try {
        console.log("💾 [SAVE_STORY] Saving product story to database...");

        if (!userId || !generationId) {
            console.log("⚠️ [SAVE_STORY] Missing userId or generationId, skipping save");
            return null;
        }

        const { data, error } = await supabase
            .from("product_stories")
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
            console.error("❌ [SAVE_STORY] Database insert error:", error);
            return null;
        }

        console.log("✅ [SAVE_STORY] Product story saved successfully, ID:", data.id);
        return data;

    } catch (error) {
        console.error("❌ [SAVE_STORY] Unexpected error:", error.message);
        return null;
    }
}

// Increment story count in user_story_stats
async function incrementStoryCount(userId) {
    if (!userId) return;
    try {
        console.log(`📈 [STORY_STATS] Incrementing story count for user: ${userId}`);

        const { data, error: selectError } = await supabase
            .from("user_story_stats")
            .select("story_generation_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (selectError) throw selectError;

        const newCount = (data?.story_generation_count || 0) + 1;

        const { error: upsertError } = await supabase
            .from("user_story_stats")
            .upsert({
                user_id: userId,
                story_generation_count: newCount,
                updated_at: new Date().toISOString()
            });

        if (upsertError) throw upsertError;
        console.log(`✅ [STORY_STATS] Increment successful. New count: ${newCount}`);
    } catch (error) {
        console.error("❌ [STORY_STATS] Error incrementing count:", error.message);
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
            console.error("❌ [STORY_CREDIT] Error fetching user balance:", error);
            return false;
        }

        const balance = user.credit_balance || 0;
        console.log(`💳 [STORY_CREDIT] User: ${userId}, Balance: ${balance}, Cost: ${cost}`);

        return balance >= cost;
    } catch (error) {
        console.error("❌ [STORY_CREDIT] Unexpected error:", error);
        return false;
    }
}

// Deduct user credit using RPC
async function deductUserCredit(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        console.log(`💳 [STORY_DEDUCT] Deducting ${cost} credits from user ${userId}...`);

        const { data, error } = await supabase.rpc("deduct_user_credit", {
            user_id: userId,
            credit_amount: cost
        });

        if (error) {
            console.error("❌ [STORY_DEDUCT] RPC Error:", error);
            return false;
        }

        console.log(`✅ [STORY_DEDUCT] Successfully deducted ${cost} credits.`);
        return true;
    } catch (error) {
        console.error("❌ [STORY_DEDUCT] Unexpected error:", error);
        return false;
    }
}

// Get user's story generation count
async function getUserStoryCount(userId) {
    if (!userId || userId === "anonymous_user") return 0;

    try {
        const { data, error } = await supabase
            .from("user_story_stats")
            .select("story_generation_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            console.error("❌ [STORY_COUNT] Error fetching count:", error);
            return 0;
        }

        return data?.story_generation_count || 0;
    } catch (error) {
        console.error("❌ [STORY_COUNT] Unexpected error:", error);
        return 0;
    }
}

// ═══════════════════════════════════════════════════════
// POST /api/generate-product-story
// ═══════════════════════════════════════════════════════
router.post("/generate-product-story", async (req, res) => {
    const startTime = Date.now();
    const STORY_GENERATION_COST = 80; // 6 scenes = 80 credits
    const FREE_TIER_LIMIT = 2; // First 2 generations free

    try {
        const { imageUrl, recordId, userId, teamAware } = req.body;

        console.log(`📖 [STORY] Request received for URL: ${imageUrl?.substring(0, 50)}...`);
        console.log(`📖 [STORY] Record ID: ${recordId}, User ID: ${userId}, teamAware: ${teamAware}`);

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
            console.log(`📊 [STORY] Team-aware: creditOwnerId=${creditOwnerId}, isTeamCredit=${isTeamCredit}`);
        }

        // STEP -2: Check Free Tier Status
        let isFree = false;
        if (creditOwnerId && creditOwnerId !== "anonymous_user") {
            const storyCount = await getUserStoryCount(creditOwnerId);
            console.log(`📊 [STORY] Story count for ${creditOwnerId}: ${storyCount}`);
            if (storyCount < FREE_TIER_LIMIT) {
                isFree = true;
                console.log(`🎁 [STORY] Within FREE TIER (count < ${FREE_TIER_LIMIT}). No credits will be deducted.`);
            }
        }

        // STEP -1: Check Credit Balance
        if (!isFree && creditOwnerId && creditOwnerId !== "anonymous_user") {
            const hasEnoughCredits = await checkUserBalance(creditOwnerId, STORY_GENERATION_COST);
            if (!hasEnoughCredits) {
                console.warn(`⛔ [STORY] Insufficient credits for creditOwnerId: ${creditOwnerId}`);
                return res.status(402).json({
                    success: false,
                    error: "INSUFFICIENT_CREDITS",
                    message: "You do not have enough credits to generate a story."
                });
            }
        }

        // STEP 0: Clear existing stories if re-generation
        if (recordId) {
            console.log(`🧹 [STORY] Clearing existing stories for record: ${recordId}`);
            await supabase
                .from("reference_results")
                .update({ stories: null })
                .eq("generation_id", recordId);
        }

        // Step 0.5: Fetch user story preferences
        let userPreferences = null;
        try {
            const { data } = await supabase
                .from("user_story_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();
            if (data) {
                userPreferences = data;
                console.log(`📋 [STORY] User preferences found for: ${userId}`);
            }
        } catch (e) {
            console.log("⚠️ [STORY] Could not fetch user preferences:", e.message);
        }

        // Step 1: Generate prompts with Gemini
        console.log("📝 [STORY] Step 1: Generating story prompts with Gemini...");

        // Build scene descriptions — use user preferences if available, otherwise defaults
        const up = userPreferences || {};
        const generalNotesLine = up.general_notes ? `\nUser's global style note: ${up.general_notes}\n` : '';

        // Scene descriptions: user custom or defaults
        const scene1 = up.scene_1_instruction || 'Mirror selfie in a stylish bedroom or fitting room, holding phone, warm indoor light';
        const scene2 = up.scene_2_instruction || 'Tropical poolside scene, standing by a lush green garden pool, golden warm sunlight, sassy spoiled confident pose facing the camera with a big cheerful smile and cheeky playful expression, bold fun body language, resort vacation lifestyle, warm editorial color grading with organic tones';
        const scene3 = up.scene_3_instruction || 'Elegant dinner at a beautiful restaurant, warm ambient lights, sophisticated evening mood';
        const scene4 = up.scene_4_instruction || 'Laughing with friends in a car, fun road trip vibes, candid joyful moment';
        const scene5 = up.scene_5_instruction || 'Standing and chatting with friends, laughing together, casual hangout vibes, natural light';
        const scene6 = up.scene_6_instruction || '3 different people wearing the exact same garment but in different colors, standing together as friends, warm friendly poses, candid group photo, natural light';

        const geminiPrompt = `You are an elite fashion photographer and creative director specializing in real-life editorial fashion photography. Analyze the product image and generate 6 detailed AI image edit prompts for Instagram Story scenes.

TASK: Write 6 "Convert to..." prompts. Each prompt tells an AI image editor how to transform this product photo into a new real-life lifestyle scene. The model must wear the EXACT same garment — perfectly preserved.

CRITICAL FASHION PHOTOGRAPHY RULES — these are non-negotiable:
1. THE GARMENT IS THE STAR. Every prompt must keep the garment as the central visual focus. The outfit must be clearly visible, well-lit, and occupy a significant portion of the frame.
2. NO distant wide-angle shots where the person becomes small in the frame. The garment must always be clearly visible and prominent. You are free to choose any framing — full body, three-quarter, medium, close-up — as long as the outfit remains the hero of the image and garment details are not lost.
3. Think like a real-life fashion editorial — the kind you see in Vogue, Elle, or high-end Instagram fashion influencer content. Natural, aspirational, stylish.
4. Describe camera framing naturally for each scene — vary it across scenes for visual diversity. Don't always use the same framing.
5. Every scene must have a distinct color mood, lighting style, and editorial feel. Be very specific about color grading (e.g., "warm golden hour tones with soft amber highlights" or "cool blue-toned evening light with desaturated shadows").
6. Model poses should be DYNAMIC, CONFIDENT, and EDITORIAL — not stiff catalog poses. Think bold, sassy, playful, fashion-forward. Describe specific pose details (hand placement, body angle, expression, attitude).
7. Preserve ALL garment details exactly: color, texture, pattern, fit, fabric, stitching, drape.

PROFESSIONAL CAMERA & TECHNICAL DETAILS — include these in EVERY prompt like a real fashion shoot director:
- Choose the BEST lens type, focal length, and aperture for each specific scene — you are the expert, pick what works best for the mood and setting
- Include depth of field description that serves the scene
- Add shutter speed feel when it enhances the mood (frozen crisp vs dynamic motion)
- Describe the lighting setup as a fashion photographer would brief their team — be specific about light direction, quality, and sources
- Choose a fitting film stock, color science, or digital camera aesthetic that matches the scene's mood
- Set the right white balance tone for the atmosphere
Do NOT use the same technical choices across scenes — each scene should have its own unique photographic identity.

THERE IS NO WORD LIMIT. Write each prompt as detailed and descriptive as needed — be generous with details about lighting, mood, color grading, pose, expression, camera angle, lens choice, aperture, environment textures, and styling. More detail = better results. Aim for rich, vivid, cinematic descriptions that read like a professional fashion shoot brief.

IMPORTANT CONTENT SAFETY RULES — strictly follow these:
- No alcohol, bars, cocktails, drinks, wine, beer, nightclubs, or party scenes
- No smoking, drugs, or any substance references
- No suggestive, revealing, or provocative descriptions of the model's body
- Do NOT describe skin, cleavage, legs, or body shape — focus ONLY on the garment and scene
- Always describe the model as "wearing the garment" — never describe what the garment reveals
- Keep all scenes family-friendly, professional, and safe for AI image generation content moderation
- Add "professional fashion photography, editorial style" to every prompt

Start each prompt with "Convert to". Write in ENGLISH only. Make each scene feel completely different in mood, setting, and color palette.
${generalNotesLine}
Scene concepts (may be in any language — understand them, write prompt in English):
Scene 1: ${scene1}
Scene 2: ${scene2}
Scene 3: ${scene3}
Scene 4: ${scene4}
Scene 5: ${scene5}
Scene 6: ${scene6}

Respond EXACTLY in this format:
Scene_1: [prompt]
Scene_2: [prompt]
Scene_3: [prompt]
Scene_4: [prompt]
Scene_5: [prompt]
Scene_6: [prompt]`;

        // Optimize image for Gemini (max 1024px, <7MB)
        const optimizedGeminiUrl = await getOptimizedImageUrl(imageUrl);
        const geminiResponse = await callReplicateGeminiFlash(geminiPrompt, [optimizedGeminiUrl || imageUrl]);
        console.log("✅ [STORY] Gemini response received");
        console.log("📝 [STORY] Raw response:", geminiResponse.substring(0, 500));

        // Parse prompts
        const prompts = parseStoryPrompts(geminiResponse);

        // Step 2: Get reference_images from database
        console.log("🔍 [STORY] Step 2: Fetching reference_images from database...");

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
                    console.log("✅ [STORY] Found reference_image:", referenceImageUrl.substring(0, 80) + "...");
                } else {
                    console.log("⚠️ [STORY] No reference_images found for recordId:", recordId);
                }
            }
        } catch (error) {
            console.log("⚠️ [STORY] Reference image lookup error:", error.message);
        }

        // Step 3: Generate images with Fal.ai
        console.log("🎨 [STORY] Step 3: Generating 6 story scenes...");

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedImages = [];
        const sceneTypes = ["mirrorSelfie", "coffeeDate", "friendsNight", "streetStyle", "weekendVibes", "friendsGroup"];

        const scenePrompts = [
            prompts.mirrorSelfie || "convert to model taking a stylish mirror selfie wearing the garment, full-length mirror in a chic bedroom, holding phone, warm natural indoor lighting, authentic Instagram selfie vibe, preserve all garment details",
            prompts.coffeeDate || "convert to model sitting at a cozy cafe wearing the garment, holding a cappuccino, warm natural light through windows, relaxed effortless style, lifestyle photography, preserve all garment details",
            prompts.friendsNight || "convert to model enjoying an elegant dinner at a beautiful restaurant wearing the garment, warm ambient lighting, candles on table, sophisticated evening atmosphere, candid joyful moment, preserve all garment details",
            prompts.streetStyle || "convert to model laughing with friends inside a car wearing the garment, fun road trip vibes, candid joyful moment, natural light through car windows, preserve all garment details",
            prompts.weekendVibes || "convert to model standing and chatting with friends wearing the garment, laughing together in a casual hangout, candid joyful group moment, natural light, preserve all garment details",
            prompts.friendsGroup || "convert to 3 different people standing together as close friends, each wearing the exact same garment but in a different color variation, warm friendly poses, arms around each other, candid group photo with genuine smiles, natural outdoor light, preserve all garment details exactly"
        ];

        // Generate all 6 scenes in parallel — save each to DB progressively as it completes
        const imageGenerationPromises = scenePrompts.map(async (prompt, index) => {
            try {
                console.log(`🎨 [STORY] Generating scene ${index + 1} (${sceneTypes[index]})...`);
                const userImageSize = up.aspect_ratio || "9:16";
                const generatedUrl = await callReplicateNanoBananaPro(prompt, optimizedResultUrl, optimizedReferenceUrl, 3, userImageSize);

                const savedUrl = await saveGeneratedImageToUserBucket(
                    generatedUrl,
                    userId || "anonymous",
                    sceneTypes[index]
                );

                // Progressive save: immediately save this scene to DB at correct position
                if (savedUrl && recordId) {
                    try {
                        await appendStoryToRecord(recordId, savedUrl, index);
                        console.log(`📖 [STORY] Scene ${index + 1} (${sceneTypes[index]}) saved to DB at slot ${index}`);
                    } catch (e) {
                        console.warn(`⚠️ [STORY] Progressive save failed for scene ${index + 1}:`, e.message);
                    }
                }

                return {
                    type: sceneTypes[index],
                    url: savedUrl,
                    prompt: prompt
                };
            } catch (error) {
                console.error(`❌ [STORY] Error generating scene ${sceneTypes[index]}:`, error.message);
                return {
                    type: sceneTypes[index],
                    url: null,
                    error: error.message
                };
            }
        });

        const results = await Promise.all(imageGenerationPromises);

        // Build position-preserved array (null for failed scenes)
        const orderedImages = results.map(result => result.url || null);
        results.forEach(result => {
            if (result.url) {
                generatedImages.push(result.url);
            }
        });

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [STORY] Generation completed in ${processingTime.toFixed(1)}s`);
        console.log(`📊 [STORY] Generated ${generatedImages.length}/6 scenes`);

        // Step 4: Final save — position-preserved array (null for failed scenes)
        if (generatedImages.length > 0 && recordId) {
            console.log("📖 [STORY] Step 4: Final save to reference_results.stories...");
            await updateStoriesForRecord(recordId, orderedImages);
        }

        // Step 4.5: Save to product_stories table
        if (generatedImages.length > 0 && userId && userId !== "anonymous_user") {
            console.log("💾 [STORY] Step 4.5: Saving to product_stories table...");

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

            await saveProductStoryToDatabase({
                userId: userId,
                generationId: recordId,
                originalPhotos: originalPhotos,
                storyImages: storyImagesData,
                processingTimeSeconds: processingTime,
                creditsUsed: isFree ? 0 : STORY_GENERATION_COST,
                isFreeTier: isFree
            });
        }

        // Step 5: Increment stats
        if (generatedImages.length > 0 && creditOwnerId) {
            await incrementStoryCount(creditOwnerId);
            console.log(`📊 [STORY] Stats incremented for: ${creditOwnerId}`);
        }

        // Step 6: Deduct Credits
        if (!isFree && generatedImages.length > 0 && creditOwnerId && creditOwnerId !== "anonymous_user") {
            console.log(`💳 [STORY] Step 6: Deducting credits from: ${creditOwnerId}...`);
            const deducted = await deductUserCredit(creditOwnerId, STORY_GENERATION_COST);
            if (!deducted) {
                console.error("❌ [STORY] Credit deduction failed even after successful generation!");
            }
        }

        res.json({
            success: true,
            images: orderedImages,
            prompts: {
                Scene_1_MirrorSelfie_Prompt: prompts.mirrorSelfie || "",
                Scene_2_CoffeeDate_Prompt: prompts.coffeeDate || "",
                Scene_3_FriendsNight_Prompt: prompts.friendsNight || "",
                Scene_4_StreetStyle_Prompt: prompts.streetStyle || "",
                Scene_5_WeekendVibes_Prompt: prompts.weekendVibes || "",
                Scene_6_FriendsGroup_Prompt: prompts.friendsGroup || ""
            },
            details: results,
            processingTimeSeconds: processingTime
        });

    } catch (error) {
        console.error("❌ [STORY] Error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            processingTimeSeconds: (Date.now() - startTime) / 1000
        });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/retry-story-scene — Retry a single failed scene
// ═══════════════════════════════════════════════════════
router.post("/retry-story-scene", async (req, res) => {
    const startTime = Date.now();
    try {
        const { imageUrl, recordId, userId, sceneIndex } = req.body;

        if (!imageUrl || !recordId || sceneIndex === undefined) {
            return res.status(400).json({ success: false, error: "Missing imageUrl, recordId, or sceneIndex" });
        }

        const sceneTypes = ["mirrorSelfie", "coffeeDate", "friendsNight", "streetStyle", "weekendVibes", "friendsGroup"];
        const sceneType = sceneTypes[sceneIndex];
        if (!sceneType) {
            return res.status(400).json({ success: false, error: "Invalid sceneIndex" });
        }

        console.log(`🔄 [STORY_RETRY] Retrying scene ${sceneIndex + 1} (${sceneType}) for record ${recordId}`);

        // Get reference image from reference_results
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
                .from("user_story_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();

            if (prefs) {
                const prefKey = `scene_${sceneIndex + 1}_instruction`;
                if (prefs[prefKey]) {
                    scenePrompt = prefs[prefKey];
                }
            }
        }

        // Fallback prompts
        const defaultPrompts = [
            "convert to model taking a stylish mirror selfie wearing the garment, full-length mirror in a chic bedroom, holding phone, warm natural indoor lighting, authentic Instagram selfie vibe, preserve all garment details",
            "convert to model sitting at a cozy cafe wearing the garment, holding a cappuccino, warm natural light through windows, relaxed effortless style, lifestyle photography, preserve all garment details",
            "convert to model enjoying an elegant dinner at a beautiful restaurant wearing the garment, warm ambient lighting, candles on table, sophisticated evening atmosphere, candid joyful moment, preserve all garment details",
            "convert to model laughing with friends inside a car wearing the garment, fun road trip vibes, candid joyful moment, natural light through car windows, preserve all garment details",
            "convert to model standing and chatting with friends wearing the garment, laughing together in a casual hangout, candid joyful group moment, natural light, preserve all garment details",
            "convert to 3 different people standing together as close friends, each wearing the exact same garment but in a different color variation, warm friendly poses, arms around each other, candid group photo with genuine smiles, natural outdoor light, preserve all garment details exactly"
        ];

        const prompt = scenePrompt || defaultPrompts[sceneIndex];

        // Get aspect ratio from user preferences
        let aspectRatio = "9:16";
        if (userId && userId !== "anonymous_user") {
            const { data: prefs } = await supabase
                .from("user_story_preferences")
                .select("aspect_ratio")
                .eq("user_id", userId)
                .maybeSingle();
            if (prefs?.aspect_ratio) {
                aspectRatio = prefs.aspect_ratio;
            }
        }

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedUrl = await callReplicateNanoBananaPro(prompt, optimizedResultUrl, optimizedReferenceUrl, 3, aspectRatio);

        const savedUrl = await saveGeneratedImageToUserBucket(
            generatedUrl,
            userId || "anonymous",
            sceneType
        );

        if (!savedUrl) {
            return res.status(500).json({ success: false, error: "Failed to save generated image" });
        }

        // Save to reference_results.stories at correct position
        if (recordId) {
            await appendStoryToRecord(recordId, savedUrl, sceneIndex);
        }

        // Also update product_stories table
        if (userId && userId !== "anonymous_user") {
            try {
                const { data: existingStory } = await supabase
                    .from("product_stories")
                    .select("id, story_images")
                    .eq("generation_id", recordId)
                    .maybeSingle();

                if (existingStory) {
                    const currentImages = Array.isArray(existingStory.story_images) ? existingStory.story_images : [];
                    currentImages.push({ type: sceneType, url: savedUrl, prompt: prompt });
                    await supabase
                        .from("product_stories")
                        .update({ story_images: currentImages })
                        .eq("id", existingStory.id);
                }
            } catch (e) {
                console.warn("⚠️ [STORY_RETRY] product_stories update failed:", e.message);
            }
        }

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [STORY_RETRY] Scene ${sceneIndex + 1} retried in ${processingTime.toFixed(1)}s`);

        res.json({
            success: true,
            url: savedUrl,
            sceneIndex: sceneIndex,
            sceneType: sceneType
        });

    } catch (error) {
        console.error("❌ [STORY_RETRY] Error:", error);
        const isSensitive = error.message && (error.message.includes("flagged") || error.message.includes("sensitive"));
        res.status(isSensitive ? 422 : 500).json({
            success: false,
            error: error.message,
            errorCode: isSensitive ? "CONTENT_FLAGGED" : "GENERATION_FAILED"
        });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/story-stats/:userId
// ═══════════════════════════════════════════════════════
router.get("/story-stats/:userId", async (req, res) => {
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
            .from("user_story_stats")
            .select("story_generation_count")
            .eq("user_id", effectiveUserId)
            .maybeSingle();

        if (error) throw error;

        res.json({
            success: true,
            count: data?.story_generation_count || 0,
            isTeamData
        });
    } catch (error) {
        console.error("❌ [STORY_STATS] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/user-stories/:userId
// ═══════════════════════════════════════════════════════
router.get("/user-stories/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

        console.log(`📖 [USER_STORIES] Fetching stories for user: ${userId}, limit: ${limit}, offset: ${offset}`);

        const { data, error, count } = await supabase
            .from("product_stories")
            .select("*", { count: "exact" })
            .in("user_id", memberIds)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        console.log(`✅ [USER_STORIES] Found ${data?.length || 0} stories`);

        res.json({
            success: true,
            stories: data || [],
            totalCount: count || 0,
            hasMore: (offset + limit) < (count || 0),
            isTeamData: isTeamMember
        });
    } catch (error) {
        console.error("❌ [USER_STORIES] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/story-preferences/:userId
// ═══════════════════════════════════════════════════════
router.get("/story-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from("user_story_preferences")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) throw error;

        res.json({ success: true, data: data || null });
    } catch (error) {
        console.error("❌ [STORY_PREFS] GET error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/story-preferences/:userId
// ═══════════════════════════════════════════════════════
router.post("/story-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            scene_1_instruction, scene_2_instruction, scene_3_instruction,
            scene_4_instruction, scene_5_instruction, scene_6_instruction, general_notes, aspect_ratio
        } = req.body;

        const { data, error } = await supabase
            .from("user_story_preferences")
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

        console.log(`✅ [STORY_PREFS] Saved preferences for user: ${userId}`);
        res.json({ success: true, data });
    } catch (error) {
        console.error("❌ [STORY_PREFS] POST error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/story-suggest-scene
// Gemini'den belirli bir sahne için kısa öneri al
// ═══════════════════════════════════════════════════════
router.post("/story-suggest-scene", async (req, res) => {
    try {
        const { imageUrl, sceneIndex, otherScenes, currentSceneText } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        console.log(`💡 [STORY_SUGGEST] Requesting suggestion for scene ${sceneIndex}`);

        // Build context about other scenes
        const otherScenesText = otherScenes && otherScenes.length > 0
            ? otherScenes.map((s, i) => `Scene ${i + 1}: "${s}"`).filter(s => !s.includes('""')).join('\n')
            : '';

        const suggestPrompt = `You are a creative social media content advisor. Look at this product/fashion photo and suggest a SHORT, creative real-life scene idea for an Instagram Story photo.

CONTEXT — WHAT ARE "REAL LIFE KITS":
Real Life Kits transform a product photo into realistic lifestyle Instagram Story scenes. The AI takes the original product photo and CONVERTS it into a new scene — the model wearing the same outfit but in a completely different real-life setting. Think of it as "what would this outfit look like if I wore it to a café, on a city walk, at a rooftop party, etc."

The user needs a creative idea for Scene ${sceneIndex}. Your suggestion should describe a SETTING/SCENARIO — not the outfit itself (the outfit stays the same).

${currentSceneText ? `IMPORTANT — The user currently has this written for Scene ${sceneIndex}: "${currentSceneText}"
You MUST suggest something COMPLETELY DIFFERENT from this. Do NOT repeat or rephrase this idea. Come up with an entirely new, unrelated scene concept.
` : ''}${otherScenesText ? `The user already has these other scenes planned (DO NOT repeat or suggest anything similar to these):
${otherScenesText}
` : ''}
RULES:
- Respond with ONLY the suggestion text, nothing else — no quotes, no prefix, no explanation
- Maximum 8 words
- Be specific and creative — not generic
- Describe a PLACE or ACTIVITY, not clothing
- Think Instagram-worthy, aspirational lifestyle moments
- Examples of good suggestions: "Sunset rooftop dinner with city view", "Morning yoga session in garden", "Vintage bookstore browsing afternoon", "Beach boardwalk golden hour walk", "Cozy rainy day window café"
- Make it different from the other scenes listed above
- Write in the same language as the user's other scenes. If other scenes are empty or in English, write in English.

Your suggestion (max 8 words):`;

        // Optimize image for Gemini (<7MB)
        const optimizedUrl = await getOptimizedImageUrl(imageUrl);
        const suggestion = await callReplicateGeminiFlash(suggestPrompt, [optimizedUrl || imageUrl]);
        const cleanSuggestion = suggestion.trim().replace(/^["']|["']$/g, '').replace(/^Scene \d+:\s*/i, '');

        console.log(`✅ [STORY_SUGGEST] Suggestion: ${cleanSuggestion}`);

        res.json({ success: true, suggestion: cleanSuggestion });
    } catch (error) {
        console.error("❌ [STORY_SUGGEST] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
