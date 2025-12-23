const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

// Replicate Gemini Flash API helper (copied from referenceBrowserRoutesV5.js)
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🤖 [PRODUCT_KIT_GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

            const requestBody = {
                input: {
                    top_p: 0.95,
                    images: imageUrls,
                    prompt: prompt,
                    videos: [],
                    temperature: 1,
                    dynamic_thinking: false,
                    max_output_tokens: 8192
                }
            };

            const response = await axios.post(
                "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
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

            console.log(`✅ [PRODUCT_KIT_GEMINI] Başarılı response (attempt ${attempt})`);
            return outputText.trim();

        } catch (error) {
            console.error(`❌ [PRODUCT_KIT_GEMINI] Attempt ${attempt} failed:`, error.message);

            if (attempt === maxRetries) {
                throw error;
            }

            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Optimize image for Fal.ai (resize to max 1024 on long side)
async function getOptimizedImageUrl(imageUrl) {
    if (!imageUrl) return null;
    try {
        console.log(`🖼️ [OPTIMIZE] Checking/optimizing image: ${imageUrl.substring(0, 80)}...`);

        // Fetch image
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });
        const buffer = Buffer.from(response.data);

        // Check dimensions
        const metadata = await sharp(buffer).metadata();
        const MAX_SIZE = 1024;

        if (metadata.width <= MAX_SIZE && metadata.height <= MAX_SIZE) {
            console.log(`✅ [OPTIMIZE] Image size is OK (${metadata.width}x${metadata.height})`);
            return imageUrl;
        }

        console.log(`🔄 [OPTIMIZE] Resizing image from ${metadata.width}x${metadata.height} to max ${MAX_SIZE}...`);

        // Resize
        const resizedBuffer = await sharp(buffer)
            .resize(MAX_SIZE, MAX_SIZE, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 90 })
            .toBuffer();

        // Upload resized version as a temporary file
        const timestamp = Date.now();
        const fileName = `temp_optimized/${timestamp}_${uuidv4().substring(0, 8)}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, resizedBuffer, {
                contentType: "image/jpeg",
                upsert: true
            });

        if (error) {
            console.error(`❌ [OPTIMIZE] Upload error:`, error);
            return imageUrl;
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [OPTIMIZE] Optimized image uploaded: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [OPTIMIZE] Error in optimization:`, error.message);
        return imageUrl;
    }
}

// @fal-ai/client import
const { fal } = require("@fal-ai/client");
fal.config({
    credentials: process.env.FAL_API_KEY,
});

// Fal.ai Reve Fast Edit API call using SDK (DEPRECATED - Using GPT Image 1.5 instead)
// async function callFalAiReveEdit(prompt, imageUrl, maxRetries = 3) {
//     for (let attempt = 1; attempt <= maxRetries; attempt++) {
//         try {
//             console.log(`🎨 [FAL_AI] Image generation attempt ${attempt}/${maxRetries}`);
//             console.log(`🎨 [FAL_AI] Prompt: ${prompt.substring(0, 100)}...`);
// 
//             // fal.queue.submit ile isteği gönder
//             const { request_id } = await fal.queue.submit("fal-ai/reve/fast/edit", {
//                 input: {
//                     prompt: prompt,
//                     image_url: imageUrl,
//                     num_images: 1,
//                     output_format: "jpeg"
//                 }
//             });
// 
//             if (!request_id) {
//                 throw new Error("Fal.ai did not return a request_id");
//             }
// 
//             console.log(`⏳ [FAL_AI] Request submitted, request_id: ${request_id}`);
// 
//             // Poll for completion
//             let maxPolls = 60;
//             for (let poll = 0; poll < maxPolls; poll++) {
//                 const statusResult = await fal.queue.status("fal-ai/reve/fast/edit", {
//                     requestId: request_id,
//                     logs: false
//                 });
// 
//                 console.log(`⏳ [FAL_AI] Poll ${poll + 1}/${maxPolls}, status: ${statusResult.status}`);
// 
//                 if (statusResult.status === "COMPLETED") {
//                     // Get the final result
//                     const finalResult = await fal.queue.result("fal-ai/reve/fast/edit", {
//                         requestId: request_id
//                     });
// 
//                     if (finalResult.data && finalResult.data.images && finalResult.data.images.length > 0) {
//                         console.log(`✅ [FAL_AI] Image generated successfully`);
//                         return finalResult.data.images[0].url;
//                     }
//                     throw new Error("No images in completed result");
//                 }
// 
//                 if (statusResult.status === "FAILED") {
//                     throw new Error("Fal.ai generation failed");
//                 }
// 
//                 // Wait before next poll
//                 await new Promise(resolve => setTimeout(resolve, 2000));
//             }
// 
//             throw new Error("Fal.ai polling timeout");
// 
//         } catch (error) {
//             console.error(`❌ [FAL_AI] Attempt ${attempt} failed:`, error.message);
// 
//             if (attempt === maxRetries) {
//                 throw error;
//             }
// 
//             const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
//             await new Promise(resolve => setTimeout(resolve, waitTime));
//         }
//     }
// }

// Fal.ai GPT Image 1.5 Edit API call using SDK
// Always sends BOTH result image and reference image together
async function callFalAiGptImageEdit(prompt, resultImageUrl, referenceImageUrl, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [FAL_AI_GPT] Image generation attempt ${attempt}/${maxRetries}`);
            console.log(`🎨 [FAL_AI_GPT] Prompt: ${prompt.substring(0, 100)}...`);

            // fal.queue.submit ile GPT Image 1.5'e istek gönder - HER ZAMAN 2 RESIM
            const { request_id } = await fal.queue.submit("fal-ai/gpt-image-1.5/edit", {
                input: {
                    prompt: prompt,
                    image_urls: [resultImageUrl, referenceImageUrl], // Both images together!
                    image_size: "1024x1536", // Exact size from docs (portrait)
                    quality: "low", // low, medium, high
                    input_fidelity: "high", // low, high  
                    num_images: 1,
                    output_format: "jpeg"
                }
            });

            if (!request_id) {
                throw new Error("Fal.ai did not return a request_id");
            }

            console.log(`⏳ [FAL_AI_GPT] Request submitted, request_id: ${request_id}`);

            // Poll for completion
            let maxPolls = 60;
            for (let poll = 0; poll < maxPolls; poll++) {
                const statusResult = await fal.queue.status("fal-ai/gpt-image-1.5/edit", {
                    requestId: request_id,
                    logs: false
                });

                console.log(`⏳ [FAL_AI_GPT] Poll ${poll + 1}/${maxPolls}, status: ${statusResult.status}`);

                if (statusResult.status === "COMPLETED") {
                    // Get the final result
                    const finalResult = await fal.queue.result("fal-ai/gpt-image-1.5/edit", {
                        requestId: request_id
                    });

                    if (finalResult.data && finalResult.data.images && finalResult.data.images.length > 0) {
                        console.log(`✅ [FAL_AI_GPT] Image generated successfully`);
                        return finalResult.data.images[0].url;
                    }
                    throw new Error("No images in completed result");
                }

                if (statusResult.status === "FAILED") {
                    throw new Error("Fal.ai GPT Image generation failed");
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            throw new Error("Fal.ai GPT Image polling timeout");

        } catch (error) {
            console.error(`❌ [FAL_AI_GPT] Attempt ${attempt} failed:`, error.message);

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
        console.log(`📤 [SAVE] Saving ${imageType} image to user bucket...`);

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const fileName = `${userId}/${timestamp}_productkit_${imageType}_${randomId}.jpg`;

        const { data, error } = await supabase.storage
            .from("user_image_results")
            .upload(fileName, imageBuffer, {
                contentType: "image/jpeg",
                cacheControl: "3600",
                upsert: false,
            });

        if (error) {
            console.error(`❌ [SAVE] Upload error:`, error);
            return imageUrl; // Fallback to original URL
        }

        const { data: urlData } = supabase.storage
            .from("user_image_results")
            .getPublicUrl(fileName);

        console.log(`✅ [SAVE] Image saved: ${urlData.publicUrl}`);
        return urlData.publicUrl;

    } catch (error) {
        console.error(`❌ [SAVE] Error saving image:`, error.message);
        return imageUrl;
    }
}

// Parse Gemini response to extract prompts
function parseGeminiPrompts(geminiResponse) {
    const prompts = {
        changePose1: null,
        changePose2: null,
        detailShot: null,
        studio1: null,
        studio2: null,
        ghostMannequin: null
    };

    try {
        // Change Pose 1 Prompt
        const changePose1Match = geminiResponse.match(/Change_Pose_1_Prompt:\s*(.+?)(?=\nChange_Pose_2_Prompt:|$)/is);
        if (changePose1Match) {
            prompts.changePose1 = changePose1Match[1].trim();
        }

        // Change Pose 2 Prompt
        const changePose2Match = geminiResponse.match(/Change_Pose_2_Prompt:\s*(.+?)(?=\nDetail_Shot_Prompt:|$)/is);
        if (changePose2Match) {
            prompts.changePose2 = changePose2Match[1].trim();
        }

        // Detail Shot Prompt
        const detailMatch = geminiResponse.match(/Detail_Shot_Prompt:\s*(.+?)(?=\nStudio_1_Prompt:|$)/is);
        if (detailMatch) {
            prompts.detailShot = detailMatch[1].trim();
        }

        // Studio 1 Prompt
        const studio1Match = geminiResponse.match(/Studio_1_Prompt:\s*(.+?)(?=\nStudio_2_Prompt:|$)/is);
        if (studio1Match) {
            prompts.studio1 = studio1Match[1].trim();
        }

        // Studio 2 Prompt
        const studio2Match = geminiResponse.match(/Studio_2_Prompt:\s*(.+?)(?=\nGhost_Mannequin_Prompt:|$)/is);
        if (studio2Match) {
            prompts.studio2 = studio2Match[1].trim();
        }

        // Ghost Mannequin Prompt
        const ghostMatch = geminiResponse.match(/Ghost_Mannequin_Prompt:\s*(.+?)$/is);
        if (ghostMatch) {
            prompts.ghostMannequin = ghostMatch[1].trim();
        }

        console.log("📝 [PARSE] Parsed prompts:", {
            changePose1: !!prompts.changePose1,
            changePose2: !!prompts.changePose2,
            detailShot: !!prompts.detailShot,
            studio1: !!prompts.studio1,
            studio2: !!prompts.studio2,
            ghostMannequin: !!prompts.ghostMannequin
        });

    } catch (error) {
        console.error("❌ [PARSE] Error parsing prompts:", error);
    }

    return prompts;
}

// Find reference_results record by recordId and update kits column
async function updateKitsForRecord(recordId, kitImages) {
    try {
        console.log("📦 [KITS] Updating kits for record...");
        console.log("📦 [KITS] Record ID:", recordId);
        console.log("📦 [KITS] Kit images count:", kitImages?.length);

        if (!recordId || !kitImages || kitImages.length === 0) {
            console.log("⚠️ [KITS] No images to save or missing recordId");
            return null;
        }

        // Find the record by generation_id (client generation_id gönderiyor)
        const { data: existingRecord, error: findError } = await supabase
            .from("reference_results")
            .select("id, kits")
            .eq("generation_id", recordId)
            .maybeSingle();

        if (findError) {
            console.log("⚠️ [KITS] Database lookup error (non-critical):", findError.message);
            return null;
        }

        if (!existingRecord) {
            console.log("⚠️ [KITS] No record found for this result_image_url - skipping kits update");
            return null;
        }

        console.log("✅ [KITS] Found record ID:", existingRecord.id);

        // Replace existing kits with new ones (not merge)
        console.log("📦 [KITS] Replacing existing kits with new generated kits");

        // Update the record with new kits (override, not append)
        const { data: updateData, error: updateError } = await supabase
            .from("reference_results")
            .update({ kits: kitImages })
            .eq("id", existingRecord.id)
            .select();

        if (updateError) {
            console.error("❌ [KITS] Error updating kits:", updateError);
            return null;
        }

        console.log("✅ [KITS] Kits updated successfully:", kitImages.length, "new kit images");
        return updateData;

    } catch (error) {
        console.error("❌ [KITS] Error:", error.message);
        return null;
    }
}

// Save product kit to database (new product_kits table)
async function saveProductKitToDatabase({
    userId,
    generationId,
    originalPhotos,
    kitImages,
    processingTimeSeconds,
    creditsUsed,
    isFreeTier
}) {
    try {
        console.log("💾 [SAVE_KIT] Saving product kit to database...");
        console.log("💾 [SAVE_KIT] User ID:", userId);
        console.log("💾 [SAVE_KIT] Generation ID:", generationId);
        console.log("💾 [SAVE_KIT] Original Photos:", originalPhotos?.length);
        console.log("💾 [SAVE_KIT] Kit Images:", kitImages?.length);

        if (!userId || !generationId) {
            console.log("⚠️ [SAVE_KIT] Missing userId or generationId, skipping save");
            return null;
        }

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
            console.error("❌ [SAVE_KIT] Database insert error:", error);
            return null;
        }

        console.log("✅ [SAVE_KIT] Product kit saved successfully, ID:", data.id);
        return data;

    } catch (error) {
        console.error("❌ [SAVE_KIT] Unexpected error:", error.message);
        return null;
    }
}

// Increment E-commerce Kit count in user_ecommerce_stats
async function incrementEcommerceKitCount(userId) {
    if (!userId) return;
    try {
        console.log(`📈 [STATS] Incrementing kit count for user: ${userId}`);

        // Use upsert to handle both first-time and repeated users
        // Note: In Supabase, we can use a raw RPC or just fetch and update if logic is simple
        const { data, error: selectError } = await supabase
            .from("user_ecommerce_stats")
            .select("ecommerce_kit_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (selectError) throw selectError;

        const newCount = (data?.ecommerce_kit_count || 0) + 1;

        const { error: upsertError } = await supabase
            .from("user_ecommerce_stats")
            .upsert({
                user_id: userId,
                ecommerce_kit_count: newCount,
                updated_at: new Date().toISOString()
            });

        if (upsertError) throw upsertError;
        console.log(`✅ [STATS] Increment successful. New count: ${newCount}`);
    } catch (error) {
        console.error("❌ [STATS] Error incrementing count:", error.message);
    }
}

// Helper: Check if user has enough credits
async function checkUserBalance(userId, cost) {
    if (!userId || userId === "anonymous_user") return true; // Anonymous users pass for now (or handle differently)

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

        if (error || !user) {
            console.error("❌ [CREDIT_CHECK] Error fetching user balance:", error);
            return false; // Fail safe
        }

        const balance = user.credit_balance || 0;
        console.log(`💳 [CREDIT_CHECK] User: ${userId}, Balance: ${balance}, Cost: ${cost}`);

        return balance >= cost;
    } catch (error) {
        console.error("❌ [CREDIT_CHECK] Unexpected error:", error);
        return false;
    }
}

// Helper: Deduct user credit using RPC
async function deductUserCredit(userId, cost) {
    if (!userId || userId === "anonymous_user") return true;

    try {
        console.log(`💳 [DEDUCT] Deducting ${cost} credits from user ${userId}...`);

        const { data, error } = await supabase.rpc("deduct_user_credit", {
            user_id: userId,
            credit_amount: cost
        });

        if (error) {
            console.error("❌ [DEDUCT] RPC Error:", error);
            return false;
        }

        console.log(`✅ [DEDUCT] Successfully deducted ${cost} credits. New balance: ${data?.new_balance}`);
        return true;
    } catch (error) {
        console.error("❌ [DEDUCT] Unexpected error:", error);
        return false;
    }
}

// Helper: Get user's kit generation count
async function getUserKitCount(userId) {
    if (!userId || userId === "anonymous_user") return 0;

    try {
        const { data, error } = await supabase
            .from("user_ecommerce_stats")
            .select("ecommerce_kit_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            console.error("❌ [KIT_COUNT] Error fetching count:", error);
            return 0; // Default to 0 on error (optimistic)
        }

        return data?.ecommerce_kit_count || 0;
    } catch (error) {
        console.error("❌ [KIT_COUNT] Unexpected error:", error);
        return 0;
    }
}

router.post("/generate-product-kit", async (req, res) => {
    const startTime = Date.now();
    const KIT_GENERATION_COST = 15; // Cost per kit generation

    try {
        const { imageUrl, recordId, userId } = req.body;

        console.log(`🎨 [PRODUCT_KIT] Request received for URL: ${imageUrl.substring(0, 50)}...`);
        console.log(`🎨 [PRODUCT_KIT] Record ID: ${recordId}, User ID: ${userId}`);

        if (!imageUrl) {
            return res.status(400).json({ success: false, error: "Missing imageUrl" });
        }

        // STEP -2: Check Free Tier Status
        let isFree = false;
        if (userId && userId !== "anonymous_user") {
            const kitCount = await getUserKitCount(userId);
            console.log(`📊 [PRODUCT_KIT] User kit count: ${kitCount}`);
            if (kitCount < 5) {
                isFree = true;
                console.log("🎁 [PRODUCT_KIT] User is within FREE TIER (count < 5). No credits will be deducted.");
            }
        }

        // STEP -1: Check Credit Balance (Only if NOT free)
        if (!isFree && userId && userId !== "anonymous_user") {
            const hasEnoughCredits = await checkUserBalance(userId, KIT_GENERATION_COST);
            if (!hasEnoughCredits) {
                console.warn(`⛔ [PRODUCT_KIT] Insufficient credits for user: ${userId}`);
                return res.status(402).json({
                    success: false,
                    error: "INSUFFICIENT_CREDITS",
                    message: "You do not have enough credits to generate a kit."
                });
            }
        }

        // STEP 0: Clear existing kits if this is a re-generation
        // This ensures the client knows we are in a "generating" state if it fetches from DB
        if (recordId) {
            console.log(`🧹 [PRODUCT_KIT] Clearing existing kits for record: ${recordId}`);
            await supabase
                .from("reference_results")
                .update({ kits: null }) // or []
                .eq("generation_id", recordId); // generation_id is what the client sends as recordId usually
        }

        // Step 1: Generate prompts with Gemini
        console.log("📝 [PRODUCT_KIT] Step 1: Generating prompts with Gemini...");

        const geminiPrompt = `
Analyze the following product image and generate 6 professional prompts for fashion e-commerce.
All prompts MUST be in ENGLISH.

1, 2) Change Pose (1, 2) – Prompts:
Generate 2 short, distinct ENERGETIC pose prompts with dynamic movement.
CRITICAL REQUIREMENTS:
- Each pose MUST be completely DIFFERENT from the other
- Use ENERGETIC, DYNAMIC poses with movement and life
- Natural, lively, high-fashion energy
- Preserve all garment details
- Keep prompts SHORT and CONCISE

EXAMPLE Change_Pose_1_Prompt:
"convert to dynamic high-fashion pose with energetic movement, natural lively stance, preserve all garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."

EXAMPLE Change_Pose_2_Prompt:
"convert to different energetic model pose, vibrant dynamic movement, fashion-forward stance, preserve garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."

3) Product Detail Shot (Macro) – Prompt:
A professional macro detail shot. Focus strictly on texture, craftsmanship, and fabric structure. 
IMPORTANT: Frame must be entirely filled with the textile. No background.

EXAMPLE Detail_Shot_Prompt:
"convert to extreme macro close-up, focus on fabric texture and intricate craftsmanship, frame entirely filled with garment details, no background, high-fashion clarity. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."

4, 5) Studio Poses (1, 2) – Prompts:
Generate 2 HIGHLY DISTINCT full-body white studio prompts.
Settings: Pure white background (#FFFFFF), PROFESSIONAL STUDIO LIGHTING.
CRITICAL REQUIREMENTS:
- Studio_1_Prompt: Use a classic standing high-fashion pose. 
- Studio_2_Prompt: Use a completely DIFFERENT pose (e.g., seated, walking, or dynamic 3/4 turn). 
- STYLE: One of these prompts MUST include a "Fujifilm/VSCO film preset" look with professional color grading, soft organic tones, and high-fashion aesthetic.
- REMOVE all outdoor/lifestyle/natural daylight/sun lighting completely. Use ONLY indoor studio lighting.
- Clean controlled artificial studio lighting environment.
IMPORTANT: 
- Start the prompt with the word "convert".
- Keep the prompt SHORT and CONCISE.
- DO NOT describe product color, fabric, or name.

EXAMPLE Studio_1_Prompt:
"convert to professional standing studio shot, pure white background #FFFFFF, professional indoor studio lighting, elegant model pose, high-fashion e-commerce. Apply a clean editorial color preset."

EXAMPLE Studio_2_Prompt:
"convert to professional seated or walking studio shot, pure white background #FFFFFF, professional indoor studio lighting, DIFFERENT POSE than first shot,  add VSCO  presets style with organic tones and soft contrast, high-fashion catalog look."

6) Ghost Mannequin – Prompt:
Generate a professional AMAZON-STYLE ghost mannequin (invisible mannequin) prompt.
CRITICAL REQUIREMENTS:
- COMPLETELY remove the model - NO face, NO hair, NO skin, NO hands, NO body parts visible AT ALL
- Create realistic internal garment structure showing natural 3D fit
- Clean hollow neckline with visible interior depth
- Preserve ALL garment details: fabric texture, stitching, seams, buttons, zippers, trims
- Pure white background (#FFFFFF) - absolutely NO shadows, NO reflections, NO gradients
- Soft, even, professional studio lighting
- Centered composition, catalog-ready
- Amazon e-commerce product photography standard

EXAMPLE Ghost_Mannequin_Prompt:
"convert to professional ghost mannequin product photo, completely remove all human parts - no model visible, create invisible mannequin effect with realistic internal garment structure, clean hollow neckline showing interior, preserve all fabric details and texture, pure white background #FFFFFF no shadows, centered, Amazon e-commerce catalog standard. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."

Respond in this EXACT format:
Change_Pose_1_Prompt: [your generated prompt]
Change_Pose_2_Prompt: [your generated prompt]
Detail_Shot_Prompt: [your generated prompt]
Studio_1_Prompt: [your generated prompt]
Studio_2_Prompt: [your generated prompt]
Ghost_Mannequin_Prompt: [your generated prompt]
`;

        const geminiResponse = await callReplicateGeminiFlash(geminiPrompt, [imageUrl]);
        console.log("✅ [PRODUCT_KIT] Gemini response received");
        console.log("📝 [PRODUCT_KIT] Raw response:", geminiResponse.substring(0, 500));

        // Parse prompts
        const prompts = parseGeminiPrompts(geminiResponse);

        // Step 2: Get reference_images from database for detail/ghost
        console.log("🔍 [PRODUCT_KIT] Step 2: Fetching reference_images from database...");

        let referenceImageUrl = imageUrl; // Fallback to original
        try {
            // recordId ile arama yap (daha güvenilir)
            if (recordId) {
                const { data: record, error: findError } = await supabase
                    .from("reference_results")
                    .select("reference_images")
                    .eq("generation_id", recordId)
                    .maybeSingle();

                if (!findError && record && record.reference_images && record.reference_images.length > 0) {
                    referenceImageUrl = record.reference_images[0];
                    console.log("✅ [PRODUCT_KIT] Found reference_image by ID:", referenceImageUrl.substring(0, 80) + "...");
                } else {
                    console.log("⚠️ [PRODUCT_KIT] No reference_images found for recordId:", recordId);
                }
            } else {
                console.log("⚠️ [PRODUCT_KIT] No recordId provided, using imageUrl as reference");
            }
        } catch (error) {
            console.log("⚠️ [PRODUCT_KIT] Reference image lookup error:", error.message);
        }

        // Step 3: Generate images with Fal.ai
        console.log("🎨 [PRODUCT_KIT] Step 3: Generating images with Fal.ai...");

        // Optimized URLs to prevent 422 errors (Reve API has size limits)
        console.log("🔄 [PRODUCT_KIT] Optimizing source images before generation...");
        const optimizedResultUrl = await getOptimizedImageUrl(imageUrl);
        const optimizedReferenceUrl = await getOptimizedImageUrl(referenceImageUrl);

        const generatedImages = [];
        const imageTypes = ["pose1", "pose2", "studio1", "studio2", "detail", "ghost"];

        const imagePrompts = [
            prompts.changePose1 || "convert to dynamic high-fashion pose with energetic movement, natural lively stance, preserve all garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.", // pose1
            prompts.changePose2 || "convert to different energetic model pose, vibrant dynamic movement, fashion-forward stance, preserve garment details. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.", // pose2
            prompts.studio1 || "convert to professional standing studio shot, pure white background #FFFFFF, professional indoor studio lighting - remove outdoor natural light completely, soft diffused artificial studio lights, high-fashion e-commerce style. Apply a clean editorial color preset with natural tones.",
            prompts.studio2 || "convert to professional seated or walking studio shot, pure white background #FFFFFF, DIFFERENT POSE than first shot, Fujifilm VSCO film preset style with organic tones and soft contrast, professional studio lighting setup, high-fashion e-commerce quality.",
            prompts.detailShot || "convert to extreme macro fabric detail shot, frame entirely filled with texture, no background. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects.",
            // Ghost Mannequin - Use Gemini-generated prompt or fallback
            prompts.ghostMannequin || "convert to professional ghost mannequin product photo: completely remove all model parts - no face, hair, skin, hands visible. Create realistic internal garment structure showing natural 3D fit with clean hollow neckline and interior depth. Preserve all garment details, fabric texture, stitching, seams, trims. Pure white background #FFFFFF, no shadows, no reflections. Soft even studio lighting. Amazon e-commerce catalog standard, centered. Apply a clean editorial color preset with natural tones, balanced contrast, soft highlights, accurate whites, and professional fashion color grading. Avoid heavy filters, oversaturation, or stylized effects."
        ];

        // Her kit generation'da HER ZAMAN iki resim birlikte gönderilir:
        // 1. optimizedResultUrl (client'ten gelen URL - modelli fotoğraf)
        // 2. optimizedReferenceUrl (reference image - ürün fotoğrafı)

        // Generate images in parallel
        const imageGenerationPromises = imagePrompts.map(async (prompt, index) => {
            try {
                console.log(`🎨 [PRODUCT_KIT] Generating ${imageTypes[index]} with BOTH result and reference images...`);
                const generatedUrl = await callFalAiGptImageEdit(prompt, optimizedResultUrl, optimizedReferenceUrl);

                // Save to user bucket
                const savedUrl = await saveGeneratedImageToUserBucket(
                    generatedUrl,
                    userId || "anonymous",
                    imageTypes[index]
                );

                return {
                    type: imageTypes[index],
                    url: savedUrl,
                    prompt: prompt
                };
            } catch (error) {
                console.error(`❌ [PRODUCT_KIT] Error generating ${imageTypes[index]}:`, error.message);
                return {
                    type: imageTypes[index],
                    url: null,
                    error: error.message
                };
            }
        });

        const results = await Promise.all(imageGenerationPromises);

        // Collect successful images
        results.forEach(result => {
            if (result.url) {
                generatedImages.push(result.url);
            }
        });

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [PRODUCT_KIT] Generation completed in ${processingTime.toFixed(1)}s`);
        console.log(`📊 [PRODUCT_KIT] Generated ${generatedImages.length}/6 images`);

        // Step 4: Save kit images to database (kits column)
        if (generatedImages.length > 0 && recordId) {
            console.log("📦 [PRODUCT_KIT] Step 4: Saving to database...");
            await updateKitsForRecord(recordId, generatedImages);
        }

        // Step 4.5: Save to product_kits table (new detailed record)
        if (generatedImages.length > 0 && userId && userId !== "anonymous_user") {
            console.log("💾 [PRODUCT_KIT] Step 4.5: Saving to product_kits table...");

            // Prepare original photos array (sonuç resmi + referans resim)
            const originalPhotos = [imageUrl];
            if (referenceImageUrl && referenceImageUrl !== imageUrl) {
                originalPhotos.push(referenceImageUrl);
            }

            // Prepare detailed kit images array with type, url, and prompt
            const kitImagesData = results
                .filter(r => r.url)
                .map(r => ({
                    type: r.type,
                    url: r.url,
                    prompt: r.prompt || null
                }));

            await saveProductKitToDatabase({
                userId: userId,
                generationId: recordId,
                originalPhotos: originalPhotos,
                kitImages: kitImagesData,
                processingTimeSeconds: processingTime,
                creditsUsed: isFree ? 0 : KIT_GENERATION_COST,
                isFreeTier: isFree
            });
        }

        // Step 5: Increment stats if successful
        if (generatedImages.length > 0 && userId) {
            await incrementEcommerceKitCount(userId);
        }

        // Step 6: Deduct Credits
        if (!isFree && generatedImages.length > 0 && userId && userId !== "anonymous_user") {
            console.log("💳 [PRODUCT_KIT] Step 6: Deducting credits...");
            const deducted = await deductUserCredit(userId, KIT_GENERATION_COST);
            if (!deducted) {
                console.error("❌ [PRODUCT_KIT] Credit deduction failed even after successful generation!");
                // Consider adding a "retry" or "debt" flag? Or enable logging for manual reconciliation.
            }
        }

        res.json({
            success: true,
            images: generatedImages,
            prompts: {
                Change_Pose_1_Prompt: prompts.changePose1 || "",
                Change_Pose_2_Prompt: prompts.changePose2 || "",
                Detail_Shot_Prompt: prompts.detailShot || "",
                Studio_1_Prompt: prompts.studio1 || "",
                Studio_2_Prompt: prompts.studio2 || ""
            },
            details: results,
            processingTimeSeconds: processingTime
        });

    } catch (error) {
        console.error("❌ [PRODUCT_KIT] Error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            processingTimeSeconds: (Date.now() - startTime) / 1000
        });
    }
});

// NEW: Fetch E-commerce Kit stats for a user
router.get("/ecommerce-stats/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from("user_ecommerce_stats")
            .select("ecommerce_kit_count")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) throw error;

        res.json({
            success: true,
            count: data?.ecommerce_kit_count || 0
        });
    } catch (error) {
        console.error("❌ [STATS_GET] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// NEW: Fetch user's product kits list
router.get("/user-kits/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        console.log(`📦 [USER_KITS] Fetching kits for user: ${userId}, limit: ${limit}, offset: ${offset}`);

        const { data, error, count } = await supabase
            .from("product_kits")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        console.log(`✅ [USER_KITS] Found ${data?.length || 0} kits for user`);

        res.json({
            success: true,
            kits: data || [],
            totalCount: count || 0,
            hasMore: (offset + limit) < (count || 0)
        });
    } catch (error) {
        console.error("❌ [USER_KITS] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
