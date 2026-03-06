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

// Replicate GPT Image 1.5 Edit API call
async function callReplicateGptImageEdit(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3, imageSize = "1024x1536") {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [STORY_REPLICATE] Image generation attempt ${attempt}/${maxRetries}`);
            console.log(`🎨 [STORY_REPLICATE] Prompt: ${prompt.substring(0, 100)}...`);

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

            console.log(`⏳ [STORY_REPLICATE] Prediction created, id: ${prediction.id}`);

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
                console.log(`⏳ [STORY_REPLICATE] Poll ${poll + 1}/${maxPolls}, status: ${result.status}`);

                if (result.status === "succeeded") {
                    const output = result.output;
                    if (output) {
                        const imageUrl = Array.isArray(output) ? output[0] : output;
                        if (imageUrl) {
                            console.log(`✅ [STORY_REPLICATE] Image generated successfully`);
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
            console.error(`❌ [STORY_REPLICATE] Attempt ${attempt} failed:`, error.message);

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
        weekendVibes: null
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

        const scene5Match = geminiResponse.match(/Scene_5:\s*(.+?)$/is);
        if (scene5Match) prompts.weekendVibes = scene5Match[1].trim();

        console.log("📝 [STORY_PARSE] Parsed prompts:", {
            scene1: !!prompts.mirrorSelfie,
            scene2: !!prompts.coffeeDate,
            scene3: !!prompts.friendsNight,
            scene4: !!prompts.streetStyle,
            scene5: !!prompts.weekendVibes
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
    const STORY_GENERATION_COST = 20; // 5 scenes = 20 credits
    const FREE_TIER_LIMIT = 3; // First 3 generations free

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
        const scene2 = up.scene_2_instruction || 'Cozy cafe scene, sitting with coffee, natural window light, relaxed lifestyle vibe';
        const scene3 = up.scene_3_instruction || 'Night out at a trendy bar or restaurant, warm ambient lights, social energetic mood';
        const scene4 = up.scene_4_instruction || 'Street style city walk, golden hour sunlight, confident mid-stride, urban background';
        const scene5 = up.scene_5_instruction || 'Weekend leisure outdoors — park, waterfront, or garden, soft natural light, carefree mood';

        const geminiPrompt = `You are a fashion photographer and creative director. Analyze the product image and generate 5 AI image edit prompts for Instagram Story scenes.

TASK: Write 5 "Convert to..." prompts. Each prompt tells an AI image editor how to transform this product photo into a new real-life scene. The model must wear the EXACT same garment — perfectly preserved.

Each prompt should be 80-120 words, written as one flowing paragraph. Cover these aspects naturally:
- Setting & environment (specific location details, textures, objects)
- Lighting (direction, warmth/coolness, sources, shadows)
- Mood & color tone
- Model pose & expression (natural, candid, not stiff)
- Camera angle & depth of field
- Preserve ALL garment details exactly (color, texture, pattern, fit, fabric)

Start each prompt with "Convert to". Write in ENGLISH only. Make each scene feel completely different.
${generalNotesLine}
Scene concepts (may be in any language — understand them, write prompt in English):
Scene 1: ${scene1}
Scene 2: ${scene2}
Scene 3: ${scene3}
Scene 4: ${scene4}
Scene 5: ${scene5}

Respond EXACTLY in this format:
Scene_1: [prompt]
Scene_2: [prompt]
Scene_3: [prompt]
Scene_4: [prompt]
Scene_5: [prompt]`;

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
        console.log("🎨 [STORY] Step 3: Generating 5 story scenes with Fal.ai...");

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedImages = [];
        const sceneTypes = ["mirrorSelfie", "coffeeDate", "friendsNight", "streetStyle", "weekendVibes"];

        const scenePrompts = [
            prompts.mirrorSelfie || "convert to model taking a stylish mirror selfie wearing the garment, full-length mirror in a chic bedroom, holding phone, warm natural indoor lighting, authentic Instagram selfie vibe, preserve all garment details",
            prompts.coffeeDate || "convert to model sitting at a cozy cafe wearing the garment, holding a cappuccino, warm natural light through windows, relaxed effortless style, lifestyle photography, preserve all garment details",
            prompts.friendsNight || "convert to model laughing with friends at a trendy bar wearing the garment, warm string lights, vibrant social atmosphere, candid fun moment, evening lighting, preserve all garment details",
            prompts.streetStyle || "convert to model confidently walking down a vibrant city street wearing the garment, candid street style moment, golden hour daylight, fashion editorial feel, preserve all garment details",
            prompts.weekendVibes || "convert to model wearing the garment enjoying a golden hour sunset walk in a scenic park, relaxed happy expression, soft warm sunlight, effortlessly stylish weekend vibe, preserve all garment details"
        ];

        // Generate all 5 scenes in parallel
        const imageGenerationPromises = scenePrompts.map(async (prompt, index) => {
            try {
                console.log(`🎨 [STORY] Generating scene ${index + 1} (${sceneTypes[index]})...`);
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
                console.error(`❌ [STORY] Error generating scene ${sceneTypes[index]}:`, error.message);
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
        console.log(`✅ [STORY] Generation completed in ${processingTime.toFixed(1)}s`);
        console.log(`📊 [STORY] Generated ${generatedImages.length}/5 scenes`);

        // Step 4: Save story images to reference_results.stories
        if (generatedImages.length > 0 && recordId) {
            console.log("📖 [STORY] Step 4: Saving to reference_results.stories...");
            await updateStoriesForRecord(recordId, generatedImages);
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
            images: generatedImages,
            prompts: {
                Scene_1_MirrorSelfie_Prompt: prompts.mirrorSelfie || "",
                Scene_2_CoffeeDate_Prompt: prompts.coffeeDate || "",
                Scene_3_FriendsNight_Prompt: prompts.friendsNight || "",
                Scene_4_StreetStyle_Prompt: prompts.streetStyle || "",
                Scene_5_WeekendVibes_Prompt: prompts.weekendVibes || ""
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
            scene_4_instruction, scene_5_instruction, general_notes, aspect_ratio
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
                general_notes: general_notes || '',
                aspect_ratio: aspect_ratio || '1024x1536',
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
