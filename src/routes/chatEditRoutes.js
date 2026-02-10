const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

// Supabase client
const supabaseUrl =
  process.env.SUPABASE_URL || "https://halurilrsdzgnieeajxm.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const CREDIT_COST = 5;

// ─── Replicate Gemini 2.5 Flash - Prompt Enhancement ───
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🤖 [CHAT-EDIT-GEMINI] API call attempt ${attempt}/${maxRetries}`
      );

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls,
          prompt: prompt,
          videos: [],
          temperature: 1,
          dynamic_thinking: false,
          max_output_tokens: 65535,
        },
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 120000,
        }
      );

      const data = response.data;

      if (data.error) {
        console.error(`❌ [CHAT-EDIT-GEMINI] API error:`, data.error);
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

      console.log(
        `✅ [CHAT-EDIT-GEMINI] Success (attempt ${attempt})`
      );

      return outputText.trim();
    } catch (error) {
      console.error(
        `❌ [CHAT-EDIT-GEMINI] Attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [CHAT-EDIT-GEMINI] Waiting ${waitTime}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ─── Compress image buffer with sharp (for mask images) ───
const MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024; // 6MB

async function compressImageBuffer(imageBuffer) {
  const originalSize = imageBuffer.length;
  if (originalSize <= MAX_IMAGE_SIZE_BYTES) {
    console.log(`📐 [CHAT-EDIT] Image size ${(originalSize / 1024 / 1024).toFixed(2)}MB - no compression needed`);
    return imageBuffer;
  }

  console.log(`📐 [CHAT-EDIT] Image size ${(originalSize / 1024 / 1024).toFixed(2)}MB - compressing...`);

  const qualities = [85, 70, 55, 40];
  for (const quality of qualities) {
    const compressed = await sharp(imageBuffer)
      .jpeg({ quality })
      .toBuffer();

    console.log(`📐 [CHAT-EDIT] Compressed to ${(compressed.length / 1024 / 1024).toFixed(2)}MB (JPEG q${quality})`);

    if (compressed.length <= MAX_IMAGE_SIZE_BYTES) {
      return compressed;
    }
  }

  const metadata = await sharp(imageBuffer).metadata();
  const resized = await sharp(imageBuffer)
    .resize(Math.round(metadata.width * 0.5), Math.round(metadata.height * 0.5))
    .jpeg({ quality: 70 })
    .toBuffer();

  console.log(`📐 [CHAT-EDIT] Resized + compressed to ${(resized.length / 1024 / 1024).toFixed(2)}MB`);
  return resized;
}

// ─── Download image from URL and return buffer ───
async function downloadImageBuffer(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });
  return Buffer.from(response.data);
}

// ─── Upload image buffer to Supabase (temporary) ───
async function uploadImageBufferToSupabase(imageBuffer, prefix = "mask") {
  // Compress if needed (mask images can be 10+ MB)
  const compressed = await compressImageBuffer(imageBuffer);

  const isJpeg = compressed[0] === 0xFF && compressed[1] === 0xD8;
  const ext = isJpeg ? "jpg" : "png";
  const contentType = isJpeg ? "image/jpeg" : "image/png";

  const fileName = `temp_${Date.now()}_chat_edit_${prefix}_${uuidv4()}.${ext}`;
  const remotePath = `references/${fileName}`;

  const { error } = await supabase.storage
    .from("reference")
    .upload(remotePath, compressed, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error(`❌ [CHAT-EDIT] ${prefix} image upload error:`, error);
    throw error;
  }

  const { data: publicUrlData } = supabase.storage
    .from("reference")
    .getPublicUrl(remotePath);

  console.log(`✅ [CHAT-EDIT] ${prefix} image uploaded: ${publicUrlData.publicUrl}`);
  return { url: publicUrlData.publicUrl, remotePath };
}

// ─── Cleanup temporary files from Supabase ───
async function cleanupTemporaryFiles(remotePaths) {
  if (!remotePaths || remotePaths.length === 0) return;
  try {
    const { error } = await supabase.storage
      .from("reference")
      .remove(remotePaths);
    if (error) {
      console.error("❌ [CHAT-EDIT] Cleanup error:", error);
    } else {
      console.log(`✅ [CHAT-EDIT] ${remotePaths.length} temp files cleaned up`);
    }
  } catch (err) {
    console.error("❌ [CHAT-EDIT] Cleanup exception:", err);
  }
}

// ─── POST /generate ───
router.post("/generate", async (req, res) => {
  let creditDeducted = false;
  let userId;
  let tempFilePaths = [];
  let editRecordId = null;
  const timings = { start: Date.now(), geminiStart: 0, geminiEnd: 0, falStart: 0, falEnd: 0, falAttempts: 0 };

  try {
    const {
      userId: requestUserId,
      prompt,
      originalImageUrl,
      selections,
      displayDimensions,
      aspectRatio,
    } = req.body;

    userId = requestUserId;

    // ── 1. Validate inputs ──
    if (!prompt || !originalImageUrl || !userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "prompt, originalImageUrl and userId are required.",
        },
      });
    }

    if (!selections || selections.length === 0) {
      return res.status(400).json({
        success: false,
        result: {
          message: "selections are required. Please select an area to edit.",
        },
      });
    }

    console.log(`\n🎨 [CHAT-EDIT] New request from user ${userId}`);
    console.log(`📝 [CHAT-EDIT] Prompt: "${prompt}"`);

    // ── 2. Credit check ──
    if (userId && userId !== "anonymous_user") {
      console.log(`💳 [CHAT-EDIT] Checking credits for user ${userId}...`);

      const { data: userData, error: creditQueryError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();

      if (creditQueryError) {
        console.error("❌ [CHAT-EDIT] Credit query error:", creditQueryError);
        return res.status(500).json({
          success: false,
          result: {
            message: "Credit query failed",
            error: creditQueryError.message,
          },
        });
      }

      const currentCredit = userData?.credit_balance || 0;
      if (currentCredit < CREDIT_COST) {
        return res.status(402).json({
          success: false,
          result: {
            message: "Insufficient credits. Please purchase credits.",
            currentCredit,
            requiredCredit: CREDIT_COST,
          },
        });
      }

      // ── 3. Deduct credits (optimistic locking) ──
      const { error: deductError } = await supabase
        .from("users")
        .update({ credit_balance: currentCredit - CREDIT_COST })
        .eq("id", userId)
        .eq("credit_balance", currentCredit);

      if (deductError) {
        console.error("❌ [CHAT-EDIT] Credit deduction error:", deductError);
        return res.status(500).json({
          success: false,
          result: {
            message: "Credit deduction failed",
            error: deductError.message,
          },
        });
      }

      creditDeducted = true;
      console.log(
        `✅ [CHAT-EDIT] ${CREDIT_COST} credits deducted. New balance: ${currentCredit - CREDIT_COST}`
      );

      // ── Insert chat_edits record ──
      try {
        const { data: insertData } = await supabase
          .from("chat_edits")
          .insert({
            user_id: userId,
            user_prompt: prompt,
            original_image_url: originalImageUrl,
            selection_count: selections.length,
            selections_json: selections,
            display_dimensions: displayDimensions || null,
            aspect_ratio: aspectRatio || null,
            status: "processing",
            credits_cost: CREDIT_COST,
            credits_deducted: true,
            credit_balance_before: currentCredit,
            credit_balance_after: currentCredit - CREDIT_COST,
          })
          .select("id")
          .single();
        editRecordId = insertData?.id || null;
        console.log(`📊 [CHAT-EDIT] Record created: ${editRecordId}`);
      } catch (dbErr) {
        console.warn("⚠️ [CHAT-EDIT] Failed to insert chat_edits record:", dbErr.message);
      }
    }

    // ── 4. Download original image & compose masked image ──
    console.log("📐 [CHAT-EDIT] Downloading original image...");
    const origBuffer = await downloadImageBuffer(originalImageUrl);
    console.log(`📐 [CHAT-EDIT] Original image: ${(origBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // 4a. Compose masked image server-side from selection paths
    console.log(`🎭 [CHAT-EDIT] Composing masked image from ${selections.length} selections...`);
    const metadata = await sharp(origBuffer).metadata();
    const dims = displayDimensions || { width: 0, height: 0 };
    const scaleX = metadata.width / (dims.width || metadata.width);
    const scaleY = metadata.height / (dims.height || metadata.height);

    const pathsStr = selections
      .map((sel) => `<path d="${sel.path}" fill="rgba(128, 0, 128, 0.4)" stroke="none" transform="scale(${scaleX}, ${scaleY})"/>`)
      .join("\n    ");

    const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}" height="${metadata.height}">
    ${pathsStr}
  </svg>`;

    const maskedBuffer = await sharp(origBuffer)
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toBuffer();

    console.log(`🎭 [CHAT-EDIT] Masked image: ${(maskedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    const maskedUpload = await uploadImageBufferToSupabase(maskedBuffer, "mask");
    const maskedImageUrl = maskedUpload.url;
    tempFilePaths.push(maskedUpload.remotePath);

    // ── 5. Enhance prompt with Replicate Gemini 2.5 Flash ──
    console.log("🤖 [CHAT-EDIT] Enhancing prompt with Gemini...");
    timings.geminiStart = Date.now();

    const geminiPrompt = `You are an expert AI image editing prompt engineer. Your task is to create a precise, detailed English prompt for an AI image editor that produces PHYSICALLY REALISTIC and COHERENT edits.

The user wrote this edit instruction (may be in any language): "${prompt}"

You are given two images:
1. The ORIGINAL image (first image)
2. The SAME image with the area to be edited marked with a semi-transparent PURPLE overlay (second image)

Based on the user's instruction and the marked area, write a single, clear, detailed English prompt that:
- Describes exactly what changes should be made to the purple-marked area
- Specifies what the marked area should look like AFTER the edit
- Emphasizes that the rest of the image must remain COMPLETELY UNCHANGED
- Is written as a direct instruction (e.g., "Replace the... with...", "Change the... to...", "Add... in the marked area...")

CRITICAL REALISM RULES — the edit MUST obey these:
- PHYSICS & GRAVITY: Objects must sit, hang, or rest naturally. No floating items, defying gravity, or impossible placements.
- LIGHTING & SHADOWS: Added/changed elements must match the existing light source direction, intensity, color temperature, and cast accurate shadows and reflections.
- PERSPECTIVE & SCALE: New elements must follow the same vanishing points, camera angle, depth of field, and be correctly sized relative to surrounding objects.
- MATERIAL & TEXTURE: Surfaces must look real — fabric should drape naturally, metal should reflect, glass should refract, skin should have pores and natural tones.
- SPATIAL COHERENCE: Elements must interact logically with the environment — objects behind others should be occluded, items on surfaces should show contact shadows, reflections should appear where expected.
- ANATOMY & PROPORTIONS: If editing a person or body part, maintain correct human anatomy, natural proportions, and realistic posture. No extra fingers, distorted limbs, or unnatural body shapes.
- CONTEXT CONSISTENCY: The edit must make sense within the scene — e.g., winter clothing in a snow scene, appropriate accessories for the setting, objects that belong in the environment.

The goal is a photorealistic result that looks like it was captured by a camera, NOT a pasted-on overlay or collage. Every added element must be INTEGRATED into the scene as if it was always there.

IMPORTANT: Output ONLY the enhanced prompt text, nothing else. No explanations, no prefixes, no quotes.`;

    const enhancedPrompt = await callReplicateGeminiFlash(
      geminiPrompt,
      [originalImageUrl, maskedImageUrl]
    );

    timings.geminiEnd = Date.now();
    console.log(`✨ [CHAT-EDIT] Enhanced prompt: "${enhancedPrompt.substring(0, 200)}..."`);

    // ── 6. Call fal.ai nano-banana-pro API ──
    console.log("🎯 [CHAT-EDIT] Calling fal.ai nano-banana-pro...");
    timings.falStart = Date.now();

    const truncatedPrompt =
      enhancedPrompt.length > 4900
        ? enhancedPrompt.substring(0, 4900)
        : enhancedPrompt;

    const falRequestBody = {
      prompt: truncatedPrompt,
      image_urls: [originalImageUrl, maskedImageUrl],
      output_format: "png",
      aspect_ratio: aspectRatio || "9:16",
      num_images: 1,
      resolution: "2K",
      quality: "2K",
    };

    let resultImageUrl = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        timings.falAttempts = attempt;
        console.log(
          `🎯 [CHAT-EDIT] fal.ai attempt ${attempt}/3`
        );

        const falResponse = await axios.post(
          "https://fal.run/fal-ai/nano-banana-pro/edit",
          falRequestBody,
          {
            headers: {
              Authorization: `Key ${process.env.FAL_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 300000,
          }
        );

        if (falResponse.data.images && falResponse.data.images.length > 0) {
          resultImageUrl = falResponse.data.images[0].url;
          console.log(`✅ [CHAT-EDIT] fal.ai success! Image: ${resultImageUrl}`);
          break;
        } else if (falResponse.data.detail || falResponse.data.error) {
          const errorMsg = falResponse.data.detail || falResponse.data.error;
          console.error(`❌ [CHAT-EDIT] fal.ai error:`, errorMsg);

          if (
            typeof errorMsg === "string" &&
            (errorMsg.includes("temporarily unavailable") ||
              errorMsg.includes("rate limit") ||
              errorMsg.includes("timeout"))
          ) {
            if (attempt < 3) {
              const waitTime = attempt * 2000;
              console.log(`⏳ [CHAT-EDIT] Retrying in ${waitTime}ms...`);
              await new Promise((r) => setTimeout(r, waitTime));
              continue;
            }
          }
          throw new Error(`fal.ai API error: ${errorMsg}`);
        } else {
          throw new Error("fal.ai returned unexpected response format");
        }
      } catch (falError) {
        if (attempt === 3) {
          throw falError;
        }
        console.error(
          `❌ [CHAT-EDIT] fal.ai attempt ${attempt} failed:`,
          falError.message
        );
        const waitTime = attempt * 2000;
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    timings.falEnd = Date.now();

    if (!resultImageUrl) {
      throw new Error("Failed to generate edited image after 3 attempts");
    }

    // ── 7. Upload result image to Supabase ──
    console.log("📤 [CHAT-EDIT] Uploading result image to Supabase...");
    const resultBuffer = await downloadImageBuffer(resultImageUrl);
    const resultUpload = await uploadImageBufferToSupabase(resultBuffer, "result");
    const supabaseResultUrl = resultUpload.url;
    console.log(`✅ [CHAT-EDIT] Result uploaded: ${supabaseResultUrl}`);

    // ── 8. Get updated credit balance ──
    let currentCredit = 0;
    if (userId && userId !== "anonymous_user") {
      const { data: updatedUser } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();
      currentCredit = updatedUser?.credit_balance || 0;
    }

    // ── 9. Update chat_edits record ──
    if (editRecordId) {
      try {
        await supabase.from("chat_edits").update({
          enhanced_prompt: enhancedPrompt,
          masked_image_url: maskedImageUrl,
          result_image_url: supabaseResultUrl,
          original_image_size_bytes: origBuffer.length,
          masked_image_size_bytes: maskedBuffer.length,
          result_image_size_bytes: resultBuffer.length,
          original_resolution: { width: metadata.width, height: metadata.height },
          status: "completed",
          processing_time_ms: Date.now() - timings.start,
          gemini_time_ms: timings.geminiEnd - timings.geminiStart,
          fal_time_ms: timings.falEnd - timings.falStart,
          fal_attempts: timings.falAttempts,
          completed_at: new Date().toISOString(),
        }).eq("id", editRecordId);
      } catch (dbErr) {
        console.warn("⚠️ [CHAT-EDIT] Failed to update chat_edits record:", dbErr.message);
      }
    }

    // ── 10. Return success ──
    console.log(`🎉 [CHAT-EDIT] Complete! Result: ${supabaseResultUrl}`);

    return res.json({
      success: true,
      result: {
        imageUrl: supabaseResultUrl,
        enhancedPrompt: enhancedPrompt,
        currentCredit,
        creditsDeducted: CREDIT_COST,
      },
    });
  } catch (error) {
    console.error("❌ [CHAT-EDIT] Error:", error.message);

    // Refund credits on failure
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
              (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
          })
          .eq("id", userId);

        console.log(`💰 [CHAT-EDIT] ${CREDIT_COST} credits refunded`);
      } catch (refundError) {
        console.error("❌ [CHAT-EDIT] Credit refund error:", refundError);
      }
    }

    // Update chat_edits record with failure
    if (editRecordId) {
      try {
        await supabase.from("chat_edits").update({
          status: creditDeducted ? "refunded" : "failed",
          error_message: error.message,
          credits_refunded: creditDeducted,
          processing_time_ms: Date.now() - timings.start,
          gemini_time_ms: timings.geminiEnd > 0 ? timings.geminiEnd - timings.geminiStart : null,
          fal_time_ms: timings.falEnd > 0 ? timings.falEnd - timings.falStart : null,
          fal_attempts: timings.falAttempts,
        }).eq("id", editRecordId);
      } catch (dbErr) {
        console.warn("⚠️ [CHAT-EDIT] Failed to update chat_edits record on error:", dbErr.message);
      }
    }

    return res.status(500).json({
      success: false,
      result: {
        message: error.message || "Image editing failed",
      },
    });
  }
});

// ─── GET /credit/:userId ───
router.get("/credit/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      credit: data?.credit_balance || 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
