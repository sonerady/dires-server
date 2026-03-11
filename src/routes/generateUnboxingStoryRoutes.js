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
            console.log(`🤖 [UNBOXING_GEMINI] API call attempt ${attempt}/${maxRetries}`);

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

            console.log(`✅ [UNBOXING_GEMINI] Successful response (attempt ${attempt})`);
            return outputText.trim();

        } catch (error) {
            console.error(`❌ [UNBOXING_GEMINI] Attempt ${attempt} failed:`, error.message);

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
        console.log(`🖼️ [UNBOXING_OPTIMIZE] Checking/optimizing image: ${imageUrl.substring(0, 80)}...`);

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });
        const buffer = Buffer.from(response.data);
        const originalSize = buffer.length;

        if (originalSize <= MAX_FILE_SIZE) {
            console.log(`✅ [UNBOXING_OPTIMIZE] Image is OK (${(originalSize / 1024 / 1024).toFixed(1)}MB)`);
            return imageUrl;
        }

        const metadata = await sharp(buffer).metadata();
        console.log(`🔄 [UNBOXING_OPTIMIZE] Image is ${(originalSize / 1024 / 1024).toFixed(1)}MB (${metadata.width}x${metadata.height}), compressing to <7MB...`);

        let quality = 92;
        let optimizedBuffer;

        do {
            quality -= 5;
            optimizedBuffer = await sharp(buffer)
                .jpeg({ quality })
                .toBuffer();
            console.log(`🔄 [UNBOXING_OPTIMIZE] quality ${quality} → ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB`);
        } while (optimizedBuffer.length > MAX_FILE_SIZE && quality > 40);

        if (optimizedBuffer.length > MAX_FILE_SIZE) {
            const scale = 0.85;
            const newW = Math.round(metadata.width * scale);
            const newH = Math.round(metadata.height * scale);
            console.log(`🔄 [UNBOXING_OPTIMIZE] Still over 7MB, scaling to ${newW}x${newH}...`);
            optimizedBuffer = await sharp(buffer)
                .resize(newW, newH)
                .jpeg({ quality: 50 })
                .toBuffer();
        }

        console.log(`✅ [UNBOXING_OPTIMIZE] Final: ${(optimizedBuffer.length / 1024 / 1024).toFixed(1)}MB, quality ${quality}`);

        const timestamp = Date.now();
        const fileName = `temp_optimized/${timestamp}_${uuidv4().substring(0, 8)}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, optimizedBuffer, {
                contentType: "image/jpeg",
                upsert: true
            });

        if (error) {
            console.error(`❌ [UNBOXING_OPTIMIZE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [UNBOXING_OPTIMIZE] Optimized image uploaded: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [UNBOXING_OPTIMIZE] Error in optimization:`, error.message);
        return imageUrl;
    }
}

// Add a text label below an image using sharp (for brand logo / custom package)
async function addLabelToImage(imageUrl, labelText) {
    try {
        console.log(`🏷️ [UNBOXING_LABEL] Adding label "${labelText}" to image...`);
        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Get image dimensions
        const metadata = await sharp(imageBuffer).metadata();
        const imgWidth = metadata.width || 400;
        const imgHeight = metadata.height || 400;

        // Label bar dimensions
        const labelHeight = 40;
        const fontSize = 20;
        const totalHeight = imgHeight + labelHeight;

        // Create SVG text label
        const svgLabel = Buffer.from(`
            <svg width="${imgWidth}" height="${labelHeight}">
                <rect width="${imgWidth}" height="${labelHeight}" fill="white"/>
                <text x="${imgWidth / 2}" y="${labelHeight / 2 + fontSize / 3}"
                      font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold"
                      fill="#333333" text-anchor="middle">${labelText}</text>
            </svg>
        `);

        // Composite: original image on top, label below
        const result = await sharp({
            create: {
                width: imgWidth,
                height: totalHeight,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        })
        .composite([
            { input: await sharp(imageBuffer).resize(imgWidth, imgHeight, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).toBuffer(), top: 0, left: 0 },
            { input: await sharp(svgLabel).png().toBuffer(), top: imgHeight, left: 0 }
        ])
        .jpeg({ quality: 85 })
        .toBuffer();

        // Upload labeled image to storage
        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `labeled/${timestamp}_${labelText.replace(/\s+/g, '_').toLowerCase()}_${randomId}.jpg`;

        const { error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, result, {
                contentType: "image/jpeg",
                cacheControl: "3600",
                upsert: false,
            });

        if (error) {
            console.error(`❌ [UNBOXING_LABEL] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [UNBOXING_LABEL] Labeled image uploaded: ${urlData.publicUrl}`);
        return urlData.publicUrl;
    } catch (error) {
        console.error(`❌ [UNBOXING_LABEL] Error:`, error.message);
        return imageUrl;
    }
}

// Fal.ai Nano Banana API call with fallback (Nano Banana 2 → Nano Banana Pro)
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
                console.log(`🍌 [UNBOXING_FAL] ${model.name} attempt ${attempt}/${maxRetries}`);
                console.log(`🍌 [UNBOXING_FAL] Prompt: ${prompt.substring(0, 100)}...`);

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
                    console.log(`✅ [UNBOXING_FAL] ${model.name} image generated successfully`);
                    return output.images[0].url;
                }

                throw new Error("No image URL in Fal.ai response");
            } catch (error) {
                const errMsg = error.response?.data?.detail || error.message || "unknown error";
                console.error(`❌ [UNBOXING_FAL] ${model.name} attempt ${attempt} failed:`, errMsg);
                const isCapacityError = typeof errMsg === "string" && (errMsg.includes("E003") || errMsg.includes("unavailable") || errMsg.includes("capacity") || errMsg.includes("overloaded"));
                if (isCapacityError) {
                    console.log(`⚡ [UNBOXING_FAL] ${model.name} capacity error, skipping to fallback immediately`);
                    break;
                }
                if (attempt === maxRetries) break;
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        console.log(`⚠️ [UNBOXING_FAL] ${model.name} failed, trying next model...`);
    }

    throw new Error("All Nano Banana models failed on Fal.ai (nano-banana-2 and nano-banana-pro)");
}

// Save generated image to user bucket
async function saveGeneratedImageToUserBucket(imageUrl, userId, imageType) {
    try {
        console.log(`📤 [UNBOXING_SAVE] Saving ${imageType} image to user bucket...`);

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `${userId}/${timestamp}_unboxingstory_${imageType}_${randomId}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, imageBuffer, {
                contentType: "image/jpeg",
                cacheControl: "3600",
                upsert: false,
            });

        if (error) {
            console.error(`❌ [UNBOXING_SAVE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [UNBOXING_SAVE] Image saved: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [UNBOXING_SAVE] Error saving image:`, error.message);
        return imageUrl;
    }
}

// Parse Gemini response to extract 6 unboxing story scene prompts
function parseUnboxingPrompts(geminiResponse) {
    const prompts = {
        packageArrived: null,
        unboxing: null,
        firstTryOn: null,
        ootdShot: null,
        closeUpDetail: null,
        readyToGo: null
    };

    const sceneMap = { scene_1: "packageArrived", scene_2: "unboxing", scene_3: "firstTryOn", scene_4: "ootdShot", scene_5: "closeUpDetail", scene_6: "readyToGo" };

    try {
        let cleaned = geminiResponse.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

        const json = JSON.parse(cleaned);
        for (const [key, field] of Object.entries(sceneMap)) {
            if (json[key]) prompts[field] = json[key];
        }
        console.log("✅ [UNBOXING_PARSE] JSON parsed successfully");
    } catch (jsonError) {
        console.warn("⚠️ [UNBOXING_PARSE] JSON parse failed, trying fallback:", jsonError.message);
        try {
            const jsonMatch = geminiResponse.match(/\{[\s\S]*"scene_1"[\s\S]*\}/);
            if (jsonMatch) {
                const json = JSON.parse(jsonMatch[0]);
                for (const [key, field] of Object.entries(sceneMap)) {
                    if (json[key]) prompts[field] = json[key];
                }
                console.log("✅ [UNBOXING_PARSE] JSON extracted from text");
            } else {
                const s1 = geminiResponse.match(/\*?\*?Scene_1:?\*?\*?\s*(.+?)(?=\n\*?\*?Scene_2|$)/is);
                if (s1) prompts.packageArrived = s1[1].trim();
                const s2 = geminiResponse.match(/\*?\*?Scene_2:?\*?\*?\s*(.+?)(?=\n\*?\*?Scene_3|$)/is);
                if (s2) prompts.unboxing = s2[1].trim();
                const s3 = geminiResponse.match(/\*?\*?Scene_3:?\*?\*?\s*(.+?)(?=\n\*?\*?Scene_4|$)/is);
                if (s3) prompts.firstTryOn = s3[1].trim();
                const s4 = geminiResponse.match(/\*?\*?Scene_4:?\*?\*?\s*(.+?)(?=\n\*?\*?Scene_5|$)/is);
                if (s4) prompts.ootdShot = s4[1].trim();
                const s5 = geminiResponse.match(/\*?\*?Scene_5:?\*?\*?\s*(.+?)(?=\n\*?\*?Scene_6|$)/is);
                if (s5) prompts.closeUpDetail = s5[1].trim();
                const s6 = geminiResponse.match(/\*?\*?Scene_6:?\*?\*?\s*(.+?)$/is);
                if (s6) prompts.readyToGo = s6[1].trim();
                console.log("✅ [UNBOXING_PARSE] Regex fallback used");
            }
        } catch (fallbackError) {
            console.error("❌ [UNBOXING_PARSE] All parsing failed:", fallbackError.message);
        }
    }

    console.log("📝 [UNBOXING_PARSE] Parsed prompts:", {
        scene1: !!prompts.packageArrived, scene2: !!prompts.unboxing, scene3: !!prompts.firstTryOn,
        scene4: !!prompts.ootdShot, scene5: !!prompts.closeUpDetail, scene6: !!prompts.readyToGo
    });

    return prompts;
}

// Update unboxing_stories column in reference_results
async function updateUnboxingStoriesForRecord(recordId, storyImages) {
    try {
        console.log("📦 [UNBOXING_STORIES] Updating unboxing_stories for record...");

        if (!recordId || !storyImages || storyImages.length === 0) {
            console.log("⚠️ [UNBOXING_STORIES] No images to save or missing recordId");
            return null;
        }

        const { data: existingRecord, error: findError } = await supabase
            .from("reference_results")
            .select("id, unboxing_stories")
            .eq("generation_id", recordId)
            .maybeSingle();

        if (findError) {
            console.log("⚠️ [UNBOXING_STORIES] Database lookup error (non-critical):", findError.message);
            return null;
        }

        if (!existingRecord) {
            console.log("⚠️ [UNBOXING_STORIES] No record found - skipping update");
            return null;
        }

        console.log("✅ [UNBOXING_STORIES] Found record ID:", existingRecord.id);

        const { data: updateData, error: updateError } = await supabase
            .from("reference_results")
            .update({ unboxing_stories: storyImages })
            .eq("id", existingRecord.id)
            .select();

        if (updateError) {
            console.error("❌ [UNBOXING_STORIES] Error updating:", updateError);
            return null;
        }

        console.log("✅ [UNBOXING_STORIES] Updated successfully:", storyImages.length, "images");
        return updateData;

    } catch (error) {
        console.error("❌ [UNBOXING_STORIES] Error:", error.message);
        return null;
    }
}

// Append a single unboxing image URL to reference_results.unboxing_stories (progressive save)
async function appendUnboxingToRecord(recordId, imageUrl, sceneIndex) {
    const { data: existing, error: findError } = await supabase
        .from("reference_results")
        .select("id, unboxing_stories")
        .eq("generation_id", recordId)
        .maybeSingle();

    if (findError || !existing) return null;

    let current = Array.isArray(existing.unboxing_stories) ? [...existing.unboxing_stories] : [];

    if (sceneIndex !== undefined && sceneIndex !== null) {
        // Position-preserved: place at correct slot
        while (current.length <= sceneIndex) current.push(null);
        current[sceneIndex] = imageUrl;
    } else {
        // Legacy fallback: append
        if (current.includes(imageUrl)) return null;
        current.push(imageUrl);
    }

    await supabase
        .from("reference_results")
        .update({ unboxing_stories: current })
        .eq("id", existing.id);

    return current;
}

// Save product unboxing story to database
async function saveProductUnboxingStoryToDatabase({
    userId,
    generationId,
    originalPhotos,
    storyImages,
    processingTimeSeconds,
    creditsUsed,
    isFreeTier
}) {
    try {
        console.log("💾 [SAVE_UNBOXING] Saving unboxing story to database...");

        if (!userId || !generationId) {
            console.log("⚠️ [SAVE_UNBOXING] Missing userId or generationId, skipping save");
            return null;
        }

        const { data, error } = await supabase
            .from("product_unboxing_stories")
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
            console.error("❌ [SAVE_UNBOXING] Database insert error:", error);
            return null;
        }

        console.log("✅ [SAVE_UNBOXING] Saved successfully, ID:", data.id);
        return data;

    } catch (error) {
        console.error("❌ [SAVE_UNBOXING] Unexpected error:", error.message);
        return null;
    }
}

// Increment unboxing count in user_unboxing_stats
async function incrementUnboxingCount(userId) {
    if (!userId) return;
    try {
        console.log(`📈 [UNBOXING_STATS] Incrementing count for user: ${userId}`);

        const { data, error: selectError } = await supabase
            .from("user_unboxing_stats")
            .select("story_generation_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (selectError) throw selectError;

        const newCount = (data?.story_generation_count || 0) + 1;

        const { error: upsertError } = await supabase
            .from("user_unboxing_stats")
            .upsert({
                user_id: userId,
                story_generation_count: newCount,
                updated_at: new Date().toISOString()
            });

        if (upsertError) throw upsertError;
        console.log(`✅ [UNBOXING_STATS] Increment successful. New count: ${newCount}`);
    } catch (error) {
        console.error("❌ [UNBOXING_STATS] Error incrementing count:", error.message);
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
            console.error("❌ [UNBOXING_CREDIT] Error fetching user balance:", error);
            return false;
        }

        const balance = user.credit_balance || 0;
        console.log(`💳 [UNBOXING_CREDIT] User: ${userId}, Balance: ${balance}, Cost: ${cost}`);

        return balance >= cost;
    } catch (error) {
        console.error("❌ [UNBOXING_CREDIT] Unexpected error:", error);
        return false;
    }
}

// Deduct user credit using RPC
async function deductUserCredit(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        console.log(`💳 [UNBOXING_DEDUCT] Deducting ${cost} credits from user ${userId}...`);

        const { data, error } = await supabase.rpc("deduct_user_credit", {
            user_id: userId,
            credit_amount: cost
        });

        if (error) {
            console.error("❌ [UNBOXING_DEDUCT] RPC Error:", error);
            return false;
        }

        console.log(`✅ [UNBOXING_DEDUCT] Successfully deducted ${cost} credits.`);
        return true;
    } catch (error) {
        console.error("❌ [UNBOXING_DEDUCT] Unexpected error:", error);
        return false;
    }
}

// Get user's unboxing generation count
async function getUserUnboxingCount(userId) {
    if (!userId || userId === "anonymous_user") return 0;

    try {
        const { data, error } = await supabase
            .from("user_unboxing_stats")
            .select("story_generation_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            console.error("❌ [UNBOXING_COUNT] Error fetching count:", error);
            return 0;
        }

        return data?.story_generation_count || 0;
    } catch (error) {
        console.error("❌ [UNBOXING_COUNT] Unexpected error:", error);
        return 0;
    }
}

// ═══════════════════════════════════════════════════════
// POST /api/generate-unboxing-story
// ═══════════════════════════════════════════════════════
router.post("/generate-unboxing-story", async (req, res) => {
    const startTime = Date.now();
    const UNBOXING_GENERATION_COST = 80; // 6 scenes = 80 credits
    const FREE_TIER_LIMIT = 2; // First 2 generations free

    try {
        const { imageUrl, recordId, userId, teamAware } = req.body;

        console.log(`📦 [UNBOXING] Request received for URL: ${imageUrl?.substring(0, 50)}...`);
        console.log(`📦 [UNBOXING] Record ID: ${recordId}, User ID: ${userId}, teamAware: ${teamAware}`);

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
            console.log(`📊 [UNBOXING] Team-aware: creditOwnerId=${creditOwnerId}, isTeamCredit=${isTeamCredit}`);
        }

        // STEP -2: Check Free Tier Status
        let isFree = false;
        if (creditOwnerId && creditOwnerId !== "anonymous_user") {
            const unboxingCount = await getUserUnboxingCount(creditOwnerId);
            console.log(`📊 [UNBOXING] Unboxing count for ${creditOwnerId}: ${unboxingCount}`);
            if (unboxingCount < FREE_TIER_LIMIT) {
                isFree = true;
                console.log(`🎁 [UNBOXING] Within FREE TIER (count < ${FREE_TIER_LIMIT}). No credits will be deducted.`);
            }
        }

        // STEP -1: Check Credit Balance
        if (!isFree && creditOwnerId && creditOwnerId !== "anonymous_user") {
            const hasEnoughCredits = await checkUserBalance(creditOwnerId, UNBOXING_GENERATION_COST);
            if (!hasEnoughCredits) {
                console.warn(`⛔ [UNBOXING] Insufficient credits for creditOwnerId: ${creditOwnerId}`);
                return res.status(402).json({
                    success: false,
                    error: "INSUFFICIENT_CREDITS",
                    message: "You do not have enough credits to generate an unboxing story."
                });
            }
        }

        // STEP 0: Clear existing unboxing_stories if re-generation
        if (recordId) {
            console.log(`🧹 [UNBOXING] Clearing existing unboxing_stories for record: ${recordId}`);
            await supabase
                .from("reference_results")
                .update({ unboxing_stories: null })
                .eq("generation_id", recordId);
        }

        // Step 0.5: Fetch user unboxing preferences
        let userPreferences = null;
        try {
            const { data } = await supabase
                .from("user_unboxing_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();
            if (data) {
                userPreferences = data;
                console.log(`📋 [UNBOXING] User preferences found for: ${userId}`);
            }
        } catch (e) {
            console.log("⚠️ [UNBOXING] Could not fetch user preferences:", e.message);
        }

        // Step 1: Generate prompts with Gemini
        console.log("📝 [UNBOXING] Step 1: Generating unboxing story prompts with Gemini...");

        const up = userPreferences || {};
        const generalNotesLine = up.general_notes ? `\nUser's global style note: ${up.general_notes}\n` : '';
        const brandName = up.brand_name || '';
        const brandLogoUrl = up.brand_logo_url || '';
        const customPackageUrl = up.custom_package_url || '';
        console.log(`🏷️ [UNBOXING] Brand info — name: "${brandName}", logo: ${brandLogoUrl ? 'YES' : 'NO'}, package: ${customPackageUrl ? 'YES' : 'NO'}`);
        if (brandLogoUrl) console.log(`🏷️ [UNBOXING] Logo URL: ${brandLogoUrl.substring(0, 80)}...`);
        if (customPackageUrl) console.log(`🏷️ [UNBOXING] Package URL: ${customPackageUrl.substring(0, 80)}...`);
        let brandLine = '';
        if (brandName) brandLine += `\nBrand name: "${brandName}" — incorporate this brand name naturally on the package box design, printed label, or tissue paper in scenes that show the packaging.\n`;
        if (brandLogoUrl) brandLine += `\nA brand logo image is provided (labeled "BRAND LOGO"). Use this logo design on the package box in packaging scenes.\n`;
        if (customPackageUrl) brandLine += `\nA custom package box image is provided (labeled "CUSTOM PACKAGE BOX"). Use this exact package box design in scenes that show the packaging. The box in the generated images should match this design.\n`;
        if (brandLogoUrl || customPackageUrl) brandLine += `\nIMPORTANT: Use this brand packaging design in scenes that show the delivery box.\n`;
        if (brandLogoUrl) brandLine += `CRITICAL: The brand logo design, colors, typography, and layout MUST be preserved EXACTLY as provided. Do NOT alter, simplify, redesign, or reimagine the logo in any way. It must look identical to the original.\n`;
        if (customPackageUrl) brandLine += `CRITICAL: The custom package box design, colors, shape, patterns, and branding MUST be preserved EXACTLY as provided. Do NOT alter, simplify, redesign, or reimagine the package. It must look identical to the original box image.\n`;

        // Scene descriptions: user custom or defaults
        const scene1 = up.scene_1_instruction || 'Hands holding a clothing package box at home on the couch or bed, excited unboxing moment, cozy indoor setting';
        const scene2 = up.scene_2_instruction || 'Flat lay of opened clothing box on bed, garment folded with tissue paper, with a cute handwritten-style text on the photo saying my order arrived thank you so much';
        const scene3 = up.scene_3_instruction || 'Mirror selfie, first try-on, phone covering face, warm indoor light';
        const scene4 = up.scene_4_instruction || 'Casual fun moment at home wearing the garment, laughing or dancing in living room, candid amateur phone shot';
        const scene5 = up.scene_5_instruction || 'Close-up detail shot of fabric texture, soft natural light';
        const scene5TextOverlay = up.scene_5_text_overlay || 'yesss its finally hereee 😍';
        const scene6 = up.scene_6_instruction || 'Person at home in casual loungewear like t-shirt and sweatpants, excitedly holding up the garment to show it off, showing a detail of the product, sassy spoiled expression looking at camera with a big smile';
        const scene6TextOverlay = up.scene_6_text_overlay || 'omg just tried it onnn 😍';

        const geminiPrompt = `You are a social media content creator specializing in authentic unboxing and "my order arrived" Instagram Stories. Analyze the product image and generate 6 AI image edit prompts for an unboxing narrative story.

TASK: Write 6 "Convert to..." prompts that tell the story of receiving and trying on this garment — ALL scenes take place INDOORS at HOME. Each prompt tells an AI image editor how to transform this product photo into a realistic, no-filter phone camera scene. The model must wear the EXACT same garment — perfectly preserved.

STYLE: Authentic phone camera quality. NO professional studio lighting. NO filters. Think real Instagram Stories — slightly imperfect, genuine, candid. The kind of photos real people post when they receive a new outfit. ALL scenes must be indoor home settings — bedroom, living room, couch, bed, mirror — NEVER outdoors, never street, never park, never outside.

Each prompt should be 80-120 words, written as one flowing paragraph. Cover these aspects naturally:
- Setting & environment (INDOOR HOME ONLY — bedroom, living room, couch, bed, kitchen)
- Lighting (warm indoor ambient light, window light — NOT studio, NOT outdoor)
- Phone camera quality (slightly grainy, real, no post-processing)
- Model pose & expression (natural, candid, excited, not stiff)
- Camera angle (selfie angles, overhead shots, mirror shots — like real people take)
- Preserve ALL garment details exactly (color, texture, pattern, fit, fabric)

CRITICAL VISUAL RULES:
- NEVER include any social media UI elements, buttons, icons, hearts, like buttons, story UI, Instagram interface, app screenshots, or phone screen overlays in the prompt
- The image should look like a RAW PHOTO taken with a phone camera — NOT a screenshot of a social media app
- NO text overlays, captions, watermarks, or UI graphics EXCEPT for Scene 2, Scene 5, and Scene 6 which should each have a cute handwritten-style text overlay as specified in the scene concepts

IMPORTANT CONTENT SAFETY RULES — strictly follow these:
- No alcohol, bars, cocktails, drinks, wine, beer, nightclubs, or party scenes
- No smoking, drugs, or any substance references
- No suggestive, revealing, or provocative descriptions of the model's body
- Do NOT describe skin, cleavage, legs, or body shape — focus ONLY on the garment and scene
- Always describe the model as "wearing the garment" — never describe what the garment reveals
- Keep all scenes family-friendly, professional, and safe for AI image generation content moderation

Start each prompt with "Convert to". Write in ENGLISH only. Make each scene feel like a continuous story — from delivery to having fun at home.
${generalNotesLine}${brandLine}
Scene concepts (may be in any language — understand them, write prompt in English):
Scene 1: ${scene1}
Scene 2: ${scene2}
Scene 3: ${scene3}
Scene 4: ${scene4}
Scene 5: ${scene5} — MUST include a cute handwritten-style text overlay on the photo saying: "${scene5TextOverlay}"
Scene 6: ${scene6} — MUST include a cute handwritten-style text overlay on the photo saying: "${scene6TextOverlay}"

Start each prompt with "transform".

CRITICAL: Respond ONLY with a valid JSON object. No markdown, no code blocks, no extra text. Just pure JSON in this EXACT structure:
{"scene_1":"transform ...","scene_2":"transform ...","scene_3":"transform ...","scene_4":"transform ...","scene_5":"transform ...","scene_6":"transform ..."}`;

        // Optimize image for Gemini (max 1024px, <7MB)
        const optimizedGeminiUrl = await getOptimizedImageUrl(imageUrl);
        const geminiImages = [optimizedGeminiUrl || imageUrl];
        // Include brand images for Gemini context (labeled so it understands what they are)
        if (brandLogoUrl) {
            const labeledLogo = await addLabelToImage(brandLogoUrl, "BRAND LOGO");
            geminiImages.push(labeledLogo);
        }
        if (customPackageUrl) {
            const labeledPkg = await addLabelToImage(customPackageUrl, "CUSTOM PACKAGE BOX");
            geminiImages.push(labeledPkg);
        }
        const geminiResponse = await callReplicateGeminiFlash(geminiPrompt, geminiImages);
        console.log("✅ [UNBOXING] Gemini response received");
        console.log("📝 [UNBOXING] Raw response:", geminiResponse.substring(0, 500));

        // Parse prompts
        const prompts = parseUnboxingPrompts(geminiResponse);

        // Step 2: Get reference_images from database
        console.log("🔍 [UNBOXING] Step 2: Fetching reference_images from database...");

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
                    console.log("✅ [UNBOXING] Found reference_image:", referenceImageUrl.substring(0, 80) + "...");
                } else {
                    console.log("⚠️ [UNBOXING] No reference_images found for recordId:", recordId);
                }
            }
        } catch (error) {
            console.log("⚠️ [UNBOXING] Reference image lookup error:", error.message);
        }

        // Step 3: Generate images
        console.log("🎨 [UNBOXING] Step 3: Generating 6 unboxing scenes...");

        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedImages = [];
        const sceneTypes = ["packageArrived", "unboxing", "firstTryOn", "ootdShot", "closeUpDetail", "readyToGo"];

        const brandPackageNote = brandName ? `, the package box has "${brandName}" branding printed on it` : '';

        const scenePrompts = [
            prompts.packageArrived || `convert to hands holding a medium-sized elegant clothing package box sitting on couch or bed at home, a proper garment-sized fashion box like a shirt or dress box with minimalist premium branding and satin ribbon${brandPackageNote}, NOT a tiny jewelry box and NOT an oversized shipping carton, the box should fit a folded garment inside, excited moment, cozy home interior background, warm indoor ambient lighting, authentic phone camera quality, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`,
            prompts.unboxing || `convert to flat lay overhead shot of opened clothing delivery box on bed${brandPackageNote}, the garment neatly folded inside with tissue paper wrapping, a cute handwritten-style white text overlay on the photo saying siparisim geldi cok tesekkurler with a heart emoji, phone camera from above, warm indoor lighting, authentic unboxing moment, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`,
            prompts.firstTryOn || "convert to mirror selfie wearing the garment for the first time, phone covering face, full length bedroom mirror, warm indoor lighting, authentic mirror selfie style, casual excited energy, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly",
            prompts.ootdShot || "convert to casual fun moment at home wearing the garment, laughing or playfully dancing in cozy living room, candid amateur phone camera shot taken by a friend, warm indoor ambient lighting, relaxed happy energy, slightly blurry natural movement, authentic phone camera quality, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly",
            prompts.closeUpDetail || `convert to close-up detail shot of the garment fabric and texture while being worn, hand gently touching the material, soft natural window light, macro phone camera quality, showing craftsmanship, with a cute handwritten-style white text overlay on the photo saying ${scene5TextOverlay}, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`,
            prompts.readyToGo || `convert to person standing at home in their cozy living room or bedroom wearing casual everyday loungewear like a simple t-shirt and sweatpants or hoodie NOT the garment, excitedly holding up the garment in their hands to show it off to the camera, showing a detail or part of the product with pride, sassy spoiled confident expression looking at the camera with a big cheerful excited smile, with a cute handwritten-style white text overlay on the photo saying ${scene6TextOverlay}, cozy home interior background with sofa or bed visible, warm indoor ambient light, authentic phone camera selfie quality, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`
        ];

        // Prepare labeled brand images if available (for Scene 6)
        let labeledLogoUrl = null;
        let labeledPackageUrl = null;
        if (brandLogoUrl || customPackageUrl) {
            console.log("🏷️ [UNBOXING] Preparing labeled brand images...");
            const labelPromises = [];
            if (brandLogoUrl) {
                labelPromises.push(
                    addLabelToImage(brandLogoUrl, "BRAND LOGO").then(url => { labeledLogoUrl = url; })
                );
            }
            if (customPackageUrl) {
                labelPromises.push(
                    addLabelToImage(customPackageUrl, "CUSTOM PACKAGE BOX").then(url => { labeledPackageUrl = url; })
                );
            }
            await Promise.all(labelPromises);
            console.log("✅ [UNBOXING] Labeled brand images ready");
        }

        // Generate all 6 scenes in parallel — save each to DB progressively as it completes
        const imageGenerationPromises = scenePrompts.map(async (prompt, index) => {
            try {
                console.log(`🎨 [UNBOXING] Generating scene ${index + 1} (${sceneTypes[index]})...`);
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
                        await appendUnboxingToRecord(recordId, savedUrl, index);
                        console.log(`📦 [UNBOXING] Scene ${index + 1} (${sceneTypes[index]}) saved to DB at slot ${index}`);
                    } catch (e) {
                        console.warn(`⚠️ [UNBOXING] Progressive save failed for scene ${index + 1}:`, e.message);
                    }
                }

                return {
                    type: sceneTypes[index],
                    url: savedUrl,
                    prompt: prompt
                };
            } catch (error) {
                console.error(`❌ [UNBOXING] Error generating scene ${sceneTypes[index]}:`, error.message);
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
        console.log(`✅ [UNBOXING] Generation completed in ${processingTime.toFixed(1)}s`);
        console.log(`📊 [UNBOXING] Generated ${generatedImages.length}/6 scenes`);

        // Step 4: Final save — position-preserved array (null for failed scenes)
        if (generatedImages.length > 0 && recordId) {
            console.log("📦 [UNBOXING] Step 4: Final save to reference_results.unboxing_stories...");
            await updateUnboxingStoriesForRecord(recordId, orderedImages);
        }

        // Step 4.5: Save to product_unboxing_stories table
        if (generatedImages.length > 0 && userId && userId !== "anonymous_user") {
            console.log("💾 [UNBOXING] Step 4.5: Saving to product_unboxing_stories table...");

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

            await saveProductUnboxingStoryToDatabase({
                userId: userId,
                generationId: recordId,
                originalPhotos: originalPhotos,
                storyImages: storyImagesData,
                processingTimeSeconds: processingTime,
                creditsUsed: isFree ? 0 : UNBOXING_GENERATION_COST,
                isFreeTier: isFree
            });
        }

        // Step 5: Increment stats
        if (generatedImages.length > 0 && creditOwnerId) {
            await incrementUnboxingCount(creditOwnerId);
            console.log(`📊 [UNBOXING] Stats incremented for: ${creditOwnerId}`);
        }

        // Step 6: Deduct Credits
        if (!isFree && generatedImages.length > 0 && creditOwnerId && creditOwnerId !== "anonymous_user") {
            console.log(`💳 [UNBOXING] Step 6: Deducting credits from: ${creditOwnerId}...`);
            const deducted = await deductUserCredit(creditOwnerId, UNBOXING_GENERATION_COST);
            if (!deducted) {
                console.error("❌ [UNBOXING] Credit deduction failed even after successful generation!");
            }
        }

        res.json({
            success: true,
            images: orderedImages,
            prompts: {
                Scene_1_PackageArrived_Prompt: prompts.packageArrived || "",
                Scene_2_Unboxing_Prompt: prompts.unboxing || "",
                Scene_3_FirstTryOn_Prompt: prompts.firstTryOn || "",
                Scene_4_OOTDShot_Prompt: prompts.ootdShot || "",
                Scene_5_CloseUpDetail_Prompt: prompts.closeUpDetail || "",
                Scene_6_ReadyToGo_Prompt: prompts.readyToGo || ""
            },
            details: results,
            processingTimeSeconds: processingTime
        });

    } catch (error) {
        console.error("❌ [UNBOXING] Error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            processingTimeSeconds: (Date.now() - startTime) / 1000
        });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/retry-unboxing-scene — Retry a single failed scene
// ═══════════════════════════════════════════════════════
router.post("/retry-unboxing-scene", async (req, res) => {
    const startTime = Date.now();
    try {
        const { imageUrl, recordId, userId, sceneIndex } = req.body;

        if (!imageUrl || !recordId || sceneIndex === undefined) {
            return res.status(400).json({ success: false, error: "Missing imageUrl, recordId, or sceneIndex" });
        }

        const sceneTypes = ["packageArrived", "unboxing", "firstTryOn", "ootdShot", "closeUpDetail", "readyToGo"];
        const sceneType = sceneTypes[sceneIndex];
        if (!sceneType) {
            return res.status(400).json({ success: false, error: "Invalid sceneIndex" });
        }

        console.log(`🔄 [UNBOXING_RETRY] Retrying scene ${sceneIndex + 1} (${sceneType}) for record ${recordId}`);

        // Get reference image from reference_results
        const { data: refResult } = await supabase
            .from("reference_results")
            .select("reference_image")
            .eq("generation_id", recordId)
            .maybeSingle();

        const referenceImageUrl = refResult?.reference_image || imageUrl;

        // Load user preferences for this scene
        let scenePrompt = null;
        let scene5Text = 'yesss its finally hereee 😍';
        let scene6Text = 'omg just tried it onnn 😍';
        if (userId && userId !== "anonymous_user") {
            const { data: prefs } = await supabase
                .from("user_unboxing_preferences")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();

            if (prefs) {
                const prefKey = `scene_${sceneIndex + 1}_instruction`;
                if (prefs[prefKey]) {
                    scenePrompt = prefs[prefKey];
                }
                if (prefs.scene_5_text_overlay) scene5Text = prefs.scene_5_text_overlay;
                if (prefs.scene_6_text_overlay) scene6Text = prefs.scene_6_text_overlay;
            }
        }

        // Brand info for retry
        let retryBrandNote = '';
        let retryBrandLogoUrl = '';
        let retryCustomPackageUrl = '';
        if (userId && userId !== "anonymous_user") {
            const { data: brandPrefs } = await supabase
                .from("user_unboxing_preferences")
                .select("brand_name, brand_logo_url, custom_package_url")
                .eq("user_id", userId)
                .maybeSingle();
            if (brandPrefs?.brand_name) {
                retryBrandNote = `, the package box has "${brandPrefs.brand_name}" branding printed on it`;
            }
            if (brandPrefs?.brand_logo_url) retryBrandLogoUrl = brandPrefs.brand_logo_url;
            if (brandPrefs?.custom_package_url) retryCustomPackageUrl = brandPrefs.custom_package_url;
        }

        // Fallback prompts
        const defaultPrompts = [
            `convert to hands holding a medium-sized elegant clothing package box sitting on couch or bed at home, a proper garment-sized fashion box like a shirt or dress box with minimalist premium branding and satin ribbon${retryBrandNote}, NOT a tiny jewelry box and NOT an oversized shipping carton, the box should fit a folded garment inside, excited moment, cozy home interior background, warm indoor ambient lighting, authentic phone camera quality, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`,
            `convert to flat lay overhead shot of opened clothing delivery box on bed${retryBrandNote}, the garment neatly folded inside with tissue paper wrapping, a cute handwritten-style white text overlay on the photo saying siparisim geldi cok tesekkurler with a heart emoji, phone camera from above, warm indoor lighting, authentic unboxing moment, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`,
            "convert to mirror selfie wearing the garment for the first time, phone covering face, full length bedroom mirror, warm indoor lighting, authentic mirror selfie style, casual excited energy, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly",
            "convert to casual fun moment at home wearing the garment, laughing or playfully dancing in cozy living room, candid amateur phone camera shot taken by a friend, warm indoor ambient lighting, relaxed happy energy, slightly blurry natural movement, authentic phone camera quality, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly",
            `convert to close-up detail shot of the garment fabric and texture while being worn, hand gently touching the material, soft natural window light, macro phone camera quality, showing craftsmanship, with a cute handwritten-style white text overlay on the photo saying ${scene5Text}, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`,
            `convert to person standing at home in their cozy living room or bedroom wearing casual everyday loungewear like a simple t-shirt and sweatpants or hoodie NOT the garment, excitedly holding up the garment in their hands to show it off to the camera, showing a detail or part of the product with pride, sassy spoiled confident expression looking at the camera with a big cheerful excited smile, with a cute handwritten-style white text overlay on the photo saying ${scene6Text}, cozy home interior background with sofa or bed visible, warm indoor ambient light, authentic phone camera selfie quality, raw photo only NO social media UI NO buttons NO icons NO app interface, preserve all garment details exactly`
        ];

        const prompt = scenePrompt || defaultPrompts[sceneIndex];

        // Get aspect ratio from user preferences
        let aspectRatio = "9:16";
        if (userId && userId !== "anonymous_user") {
            const { data: prefs } = await supabase
                .from("user_unboxing_preferences")
                .select("aspect_ratio")
                .eq("user_id", userId)
                .maybeSingle();
            if (prefs?.aspect_ratio) {
                aspectRatio = prefs.aspect_ratio;
            }
        }

        let optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        let optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedUrl = await callReplicateNanoBananaPro(prompt, optimizedResultUrl, optimizedReferenceUrl, 3, aspectRatio);

        const savedUrl = await saveGeneratedImageToUserBucket(
            generatedUrl,
            userId || "anonymous",
            sceneType
        );

        if (!savedUrl) {
            return res.status(500).json({ success: false, error: "Failed to save generated image" });
        }

        // Save to reference_results.unboxing_stories at correct position
        if (recordId) {
            await appendUnboxingToRecord(recordId, savedUrl, sceneIndex);
        }

        // Also update product_unboxing_stories table
        if (userId && userId !== "anonymous_user") {
            try {
                const { data: existingStory } = await supabase
                    .from("product_unboxing_stories")
                    .select("id, story_images")
                    .eq("generation_id", recordId)
                    .maybeSingle();

                if (existingStory) {
                    const currentImages = Array.isArray(existingStory.story_images) ? existingStory.story_images : [];
                    currentImages.push({ type: sceneType, url: savedUrl, prompt: prompt });
                    await supabase
                        .from("product_unboxing_stories")
                        .update({ story_images: currentImages })
                        .eq("id", existingStory.id);
                }
            } catch (e) {
                console.warn("⚠️ [UNBOXING_RETRY] product_unboxing_stories update failed:", e.message);
            }
        }

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [UNBOXING_RETRY] Scene ${sceneIndex + 1} retried in ${processingTime.toFixed(1)}s`);

        res.json({
            success: true,
            url: savedUrl,
            sceneIndex: sceneIndex,
            sceneType: sceneType
        });

    } catch (error) {
        console.error("❌ [UNBOXING_RETRY] Error:", error);
        const isSensitive = error.message && (error.message.includes("flagged") || error.message.includes("sensitive"));
        res.status(isSensitive ? 422 : 500).json({
            success: false,
            error: error.message,
            errorCode: isSensitive ? "CONTENT_FLAGGED" : "GENERATION_FAILED"
        });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/unboxing-stats/:userId
// ═══════════════════════════════════════════════════════
router.get("/unboxing-stats/:userId", async (req, res) => {
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
            .from("user_unboxing_stats")
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
        console.error("❌ [UNBOXING_STATS] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/user-unboxing-stories/:userId
// ═══════════════════════════════════════════════════════
router.get("/user-unboxing-stories/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

        console.log(`📦 [USER_UNBOXING] Fetching unboxing stories for user: ${userId}, limit: ${limit}, offset: ${offset}`);

        const { data, error, count } = await supabase
            .from("product_unboxing_stories")
            .select("*", { count: "exact" })
            .in("user_id", memberIds)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        console.log(`✅ [USER_UNBOXING] Found ${data?.length || 0} unboxing stories`);

        res.json({
            success: true,
            stories: data || [],
            totalCount: count || 0,
            hasMore: (offset + limit) < (count || 0),
            isTeamData: isTeamMember
        });
    } catch (error) {
        console.error("❌ [USER_UNBOXING] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// GET /api/unboxing-preferences/:userId
// ═══════════════════════════════════════════════════════
router.get("/unboxing-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from("user_unboxing_preferences")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) throw error;

        res.json({ success: true, data: data || null });
    } catch (error) {
        console.error("❌ [UNBOXING_PREFS] GET error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/unboxing-preferences/:userId
// ═══════════════════════════════════════════════════════
router.post("/unboxing-preferences/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            scene_1_instruction, scene_2_instruction, scene_3_instruction,
            scene_4_instruction, scene_5_instruction, scene_6_instruction,
            general_notes, aspect_ratio,
            scene_5_text_overlay, scene_6_text_overlay,
            brand_name, brand_logo_url, custom_package_url
        } = req.body;

        const { data, error } = await supabase
            .from("user_unboxing_preferences")
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
                scene_5_text_overlay: scene_5_text_overlay || 'yesss its finally hereee 😍',
                scene_6_text_overlay: scene_6_text_overlay || 'omg just tried it onnn 😍',
                brand_name: brand_name || '',
                brand_logo_url: brand_logo_url || '',
                custom_package_url: custom_package_url || '',
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" })
            .select()
            .single();

        if (error) throw error;

        console.log(`✅ [UNBOXING_PREFS] Saved preferences for user: ${userId}`);
        res.json({ success: true, data });
    } catch (error) {
        console.error("❌ [UNBOXING_PREFS] POST error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════
// POST /api/unboxing-suggest-scene
// ═══════════════════════════════════════════════════════
router.post("/unboxing-suggest-scene", async (req, res) => {
    try {
        const { imageUrl, sceneIndex, otherScenes, currentSceneText } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        console.log(`💡 [UNBOXING_SUGGEST] Requesting suggestion for scene ${sceneIndex}`);

        const otherScenesText = otherScenes && otherScenes.length > 0
            ? otherScenes.map((s, i) => `Scene ${i + 1}: "${s}"`).filter(s => !s.includes('""')).join('\n')
            : '';

        const suggestPrompt = `You are a creative social media content advisor specializing in unboxing and "my order arrived" content. Look at this product/fashion photo and suggest a SHORT, creative scene idea for an Instagram Story unboxing narrative.

CONTEXT — WHAT ARE "UNBOXING STORY KITS":
Unboxing Story Kits tell the visual story of receiving an online order — from the package arriving at the door, to unboxing, trying it on for the first time, and going out. The AI takes the original product photo and CONVERTS it into realistic scenes. Think of it as "what would it look like when my order arrives and I wear it for the first time."

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
- Think authentic Instagram unboxing content
- Examples of good suggestions: "Opening package on doorstep with excitement", "Tissue paper reveal on bedroom floor", "Quick mirror check before heading out", "Walking to meet friends downtown", "Close-up fabric detail in natural light"
- Make it different from the other scenes listed above
- Write in the same language as the user's other scenes. If other scenes are empty or in English, write in English.

Your suggestion (max 8 words):`;

        const optimizedUrl = await getOptimizedImageUrl(imageUrl);
        const suggestion = await callReplicateGeminiFlash(suggestPrompt, [optimizedUrl || imageUrl]);
        const cleanSuggestion = suggestion.trim().replace(/^["']|["']$/g, '').replace(/^Scene \d+:\s*/i, '');

        console.log(`✅ [UNBOXING_SUGGEST] Suggestion: ${cleanSuggestion}`);

        res.json({ success: true, suggestion: cleanSuggestion });
    } catch (error) {
        console.error("❌ [UNBOXING_SUGGEST] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
