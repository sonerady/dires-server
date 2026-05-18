// routes/generateImgToVidv3.js - Veo 3.1 Fast (Replicate) version
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const sharp = require("sharp");

// Supabase client
const { supabase } = require("../supabaseClient");
// Team service for team-aware credit operations
const teamService = require("../services/teamService");
// Trial video creation cap (production-side, no client change needed)
const { enforceTrialVideoLimit } = require("../utils/trialVideoLimit");

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_HEADERS = {
  Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
  "Content-Type": "application/json",
};

// Gemini for prompt enhancement
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Replicate Gemini Flash for prompt generation
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [VIDEO-V3] Gemini Flash attempt ${attempt}/${maxRetries}`);

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
            max_output_tokens: 65535,
          },
        },
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
      if (data.error) throw new Error(data.error);
      if (data.status !== "succeeded") throw new Error(`Prediction failed: ${data.status}`);

      let outputText = Array.isArray(data.output) ? data.output.join("") : data.output || "";
      if (!outputText.trim()) throw new Error("Empty response");

      return outputText.trim();
    } catch (error) {
      console.error(`❌ [VIDEO-V3] Gemini attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 5000)));
    }
  }
}

// Generate enhanced video prompt using Gemini
async function generateVideoPrompt(imageUrl, userPrompt, editMode = false) {
  try {
    const editModeInstructions = editMode ? `

    IMPORTANT - CINEMATIC EDIT MODE ENABLED:
    Carefully analyze the image — the model's outfit, fabric texture, setting, visible lighting, and mood — then craft post-production editing effects that specifically complement what you actually see.

    CRITICAL RULE:
    The effect ideas below are examples only. They are NOT required instructions, NOT a default style, and must NOT be copied blindly. Use them only if they naturally fit the actual image and the user's request.

    NEVER invent outdoor sunlight, golden hour, sun rays, lens flare, daylight, sky, or open-air atmosphere unless those elements are clearly visible in the image or explicitly requested by the user.
    If the image is indoors, studio-lit, dark, neutral, flat-lit, or does not contain sunlight, keep the lighting treatment consistent with that reality.

    Example effect ideas (adapt only when relevant):
    - Camera cuts & transitions tailored to the outfit (e.g., whip pan to reveal flowing fabric, match cut on accessories)
    - Lighting effects that enhance the garment when appropriate to the real scene
    - Color grading that amplifies the outfit's palette (e.g., desaturated tones for monochrome, rich warm tones for earthy fabrics)
    - Slow-motion on the most compelling detail (e.g., fabric drape, jewelry shimmer, texture close-up)
    - Focus pulls and depth transitions that draw attention to key design elements
    - Rhythm and pacing that match the outfit's energy (e.g., slow elegance for evening wear, upbeat cuts for streetwear)

    Do NOT use all effects. Select only the 3-4 effects that genuinely fit this specific image and setting. If a listed example does not fit, ignore it completely and invent a better-fitting effect.
    ` : "";

    const promptForGemini = `
    Act as an expert AI Video Director. Convert the user's input into a professional technical prompt for an AI Image-to-Video model.

    User Input: "${userPrompt}" (May be simple or in another language. Analyze the provided image to fill in details).

    Create a structured, cinematic prompt in English:
    1. Scene Description: Model, outfit (fabric, texture, style), environment.
    2. Camera Movement: "slow cinematic push-in", "subtle parallax", "gentle orbit", "low-angle".
    3. Model Movement: Natural, minimal, elegant movements. Avoid exaggerated actions.
    4. Lighting & Mood: Atmosphere description.
    5. Visual Style: "Ultra-realistic fashion film", "shallow depth of field", "smooth motion", "8k".
    ${editModeInstructions}
    Constraints:
    - Output ONLY the generated prompt text.
    - Keep under 2300 characters.
    - If user request is very short, generate a standard luxury fashion look based on the image.
    - Do not treat any example as mandatory. Examples are illustrative only.
    - Do not add sunlight, outdoor atmosphere, sky, golden hour, or lens flare unless the input image or user request supports it.
    `;

    const imageUrls = imageUrl && imageUrl.startsWith("http") ? [imageUrl] : [];
    let enhancedPrompt = await callReplicateGeminiFlash(promptForGemini, imageUrls, 3);

    if (enhancedPrompt.length > 2400) {
      enhancedPrompt = enhancedPrompt.substring(0, 2400);
    }

    console.log("🎬 [VIDEO-V3] Enhanced prompt:", enhancedPrompt.substring(0, 100) + "...");
    return enhancedPrompt;
  } catch (error) {
    console.error("❌ [VIDEO-V3] Prompt enhancement failed:", error.message);
    return userPrompt;
  }
}

// Compress image before upload
async function compressImage(buffer, maxSizeBytes = 9 * 1024 * 1024) {
  let quality = 90;
  const metadata = await sharp(buffer).metadata();

  let targetWidth = metadata.width;
  let targetHeight = metadata.height;
  const maxDimension = 2048;

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((maxDimension / targetWidth) * targetHeight);
      targetWidth = maxDimension;
    } else {
      targetWidth = Math.round((maxDimension / targetHeight) * targetWidth);
      targetHeight = maxDimension;
    }
  }

  let compressedBuffer = await sharp(buffer)
    .resize(targetWidth, targetHeight, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (compressedBuffer.length > maxSizeBytes && quality > 30) {
    quality -= 10;
    compressedBuffer = await sharp(buffer)
      .resize(targetWidth, targetHeight, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  return compressedBuffer;
}

// Upload base64 image to Supabase and return public URL
async function uploadImageToSupabase(base64String) {
  if (!base64String.startsWith("data:image/")) {
    return base64String; // Already a URL
  }

  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
  let buffer = Buffer.from(base64Data, "base64");
  buffer = await compressImage(buffer);

  const fileName = `video_frame_${uuidv4()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(`generated/${fileName}`, buffer, { contentType: "image/jpeg" });

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  const { data: publicUrlData } = await supabase.storage
    .from("images")
    .getPublicUrl(`generated/${fileName}`);

  return publicUrlData.publicUrl;
}

// Credit cost calculation
// 720p/1080p: $0.10/s → base credits
// 4k: $0.30/s → 3x base credits
function getCreditCost(duration) {
  switch (duration) {
    case 4: return 150;
    case 6: return 160;
    case 8: return 180;
    default: return 180;
  }
}

// ============================================================
// POST /api/generateImgToVidv3 - Start video generation
// ============================================================
router.post("/generateImgToVidv3", async (req, res) => {
  let effectiveUserId = null;
  let creditCost = 0;

  try {
    const {
      userId,
      first_frame_image,
      prompt,
      duration = 8,
      editMode = false,
    } = req.body;

    const resolution = "1080p";

    // Validate
    if (!userId || !first_frame_image) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId and first_frame_image",
      });
    }

    // Trial-tier cap: 2 videos max per trial window. Enforced before any
    // credit deduction or Replicate dispatch so blocked requests cost nothing.
    const trialBlock = await enforceTrialVideoLimit({ supabase, userId });
    if (trialBlock) {
      return res.status(trialBlock.status).json(trialBlock.payload);
    }

    creditCost = getCreditCost(duration);
    effectiveUserId = userId;

    // Team-aware credit check
    let effectiveCreditBalance = 0;
    let isTeamCredit = false;

    try {
      const effectiveCredits = await teamService.getEffectiveCredits(userId);
      effectiveCreditBalance = effectiveCredits.creditBalance || 0;
      isTeamCredit = effectiveCredits.isTeamCredit || false;

      if (isTeamCredit && effectiveCredits.creditOwnerId) {
        effectiveUserId = effectiveCredits.creditOwnerId;
        console.log(`👥 [VIDEO-V3] Team member - using owner credits (${effectiveUserId})`);
      }
    } catch (teamError) {
      console.log(`⚠️ [VIDEO-V3] Team check failed, fallback:`, teamError.message);
      const { data: userData } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();
      effectiveCreditBalance = userData?.credit_balance || 0;
    }

    // Check credits
    if (effectiveCreditBalance < creditCost) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Required: ${creditCost}, Available: ${effectiveCreditBalance}`,
      });
    }

    // Deduct credits
    const { error: creditError } = await supabase
      .from("users")
      .update({ credit_balance: effectiveCreditBalance - creditCost })
      .eq("id", effectiveUserId);

    if (creditError) {
      return res.status(500).json({ success: false, message: "Failed to deduct credits" });
    }

    console.log(`✅ [VIDEO-V3] ${creditCost} credits deducted from ${effectiveUserId}`);

    // Upload image to Supabase
    let imageUrl = first_frame_image;
    if (first_frame_image.startsWith("data:image/")) {
      imageUrl = await uploadImageToSupabase(first_frame_image);
    }

    // Enhance prompt with Gemini
    const userPrompt = prompt ||
      "Model highlights special details of the outfit, smiling while gently turning left and right to showcase product details from both sides.";
    const enhancedPrompt = await generateVideoPrompt(imageUrl, userPrompt, editMode);

    // Submit to Replicate Veo 3.1 Fast
    console.log("🎬 [VIDEO-V3] Submitting to Replicate Veo 3.1 Fast...");

    const replicateResponse = await axios.post(
      "https://api.replicate.com/v1/models/google/veo-3.1-fast/predictions",
      {
        input: {
          prompt: enhancedPrompt,
          image: imageUrl,
          duration: duration,
          aspect_ratio: "9:16",
          resolution: resolution,
          generate_audio: false,
        },
      },
      { headers: REPLICATE_HEADERS, timeout: 60000 }
    );

    const prediction = replicateResponse.data;
    const request_id = prediction?.id;

    if (!request_id) {
      throw new Error("Replicate did not return a prediction id");
    }

    console.log(`✅ [VIDEO-V3] Replicate prediction id: ${request_id}`);

    // Save to video_generations table
    const generationId = uuidv4();
    const { error: insertError } = await supabase
      .from("video_generations")
      .insert({
        id: generationId,
        user_id: userId,
        fal_request_id: request_id,
        status: "processing",
        original_image_url: imageUrl,
        user_prompt: userPrompt,
        enhanced_prompt: enhancedPrompt,
        duration: duration,
        aspect_ratio: "9:16",
        resolution: resolution,
        credits_used: creditCost,
      });

    if (insertError) {
      console.error("❌ [VIDEO-V3] DB insert error:", insertError);
      throw insertError;
    }

    // Also save to predictions table for backward compatibility
    await supabase.from("predictions").insert({
      id: uuidv4(),
      user_id: userId,
      product_id: generationId,
      prediction_id: request_id,
      categories: "videos",
    });

    return res.status(202).json({
      success: true,
      message: "Video generation started",
      generationId,
      predictionId: request_id,
    });
  } catch (error) {
    console.error("❌ [VIDEO-V3] Generation error:", error.message);

    // Kredi iade et - kredi düşüldükten sonra hata olduysa
    if (effectiveUserId && creditCost > 0) {
      try {
        const { data: currentUser } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", effectiveUserId)
          .single();

        if (currentUser) {
          await supabase
            .from("users")
            .update({ credit_balance: (currentUser.credit_balance || 0) + creditCost })
            .eq("id", effectiveUserId);
          console.log(`💰 [VIDEO-V3] ${creditCost} credits refunded to ${effectiveUserId}`);
        }
      } catch (refundError) {
        console.error("❌ [VIDEO-V3] Credit refund failed:", refundError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Video generation failed",
      error: error.message,
    });
  }
});

// ============================================================
// GET /api/videoStatus/:generationId - Poll generation status
// ============================================================
router.get("/videoStatus/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    // Get record from video_generations
    const { data: generation, error: dbError } = await supabase
      .from("video_generations")
      .select("*")
      .eq("id", generationId)
      .single();

    if (dbError || !generation) {
      return res.status(404).json({ success: false, message: "Generation not found" });
    }

    // If already completed or failed, return cached result
    if (generation.status === "completed" || generation.status === "failed") {
      return res.status(200).json({
        success: true,
        status: generation.status,
        videoUrl: generation.result_video_url,
        generation,
      });
    }

    // Poll Replicate
    const replicatePredictionId = generation.fal_request_id;
    let status = "processing";
    let videoUrl = null;
    let errorMessage = null;

    try {
      const pollResponse = await axios.get(
        `https://api.replicate.com/v1/predictions/${replicatePredictionId}`,
        { headers: REPLICATE_HEADERS, timeout: 30000 }
      );

      const prediction = pollResponse.data;
      console.log(`🔎 [VIDEO-V3] Replicate status for ${replicatePredictionId}:`, prediction.status);

      if (prediction.status === "starting" || prediction.status === "processing") {
        status = "processing";
      } else if (prediction.status === "succeeded") {
        // output is a direct URL string
        const output = prediction.output;
        if (output) {
          videoUrl = typeof output === "string" ? output : output[0] || null;
          status = "completed";
          console.log("✅ [VIDEO-V3] Video URL:", videoUrl);
        } else {
          console.log("⚠️ [VIDEO-V3] succeeded but no output. Full prediction:", JSON.stringify(prediction));
          status = "failed";
          errorMessage = "No video output in result";
        }
      } else if (prediction.status === "failed" || prediction.status === "canceled") {
        status = "failed";
        errorMessage = prediction.error || "Replicate generation failed";
        console.log("❌ [VIDEO-V3] Replicate failed:", errorMessage);
      }
    } catch (pollError) {
      console.error("❌ [VIDEO-V3] Polling error:", pollError.message);
      status = "failed";
      errorMessage = pollError.message || "Replicate polling error";
    }

    // Retry logic — E005 (sensitive) veya httpx.ReadError gibi geçici Replicate hataları
    const MAX_RETRIES = 3;
    const errStr = typeof errorMessage === "string" ? errorMessage : "";
    const isRetryableError =
      errStr.includes("E005") ||
      errStr.toLowerCase().includes("sensitive") ||
      errStr.toLowerCase().includes("httpx") ||
      errStr.toLowerCase().includes("readerror") ||
      errStr === "" || // Replicate bazen boş error ile failed döner
      errStr.toLowerCase().includes("network") ||
      errStr.toLowerCase().includes("timeout") ||
      errStr.toLowerCase().includes("connection");

    if (status === "failed" && isRetryableError) {
      // Mevcut retry sayısını çıkar (RETRY:N: prefix)
      const existingMsg = generation.error_message || "";
      const retryMatch = existingMsg.match(/^RETRY:(\d+):/);
      const retryCount = retryMatch ? parseInt(retryMatch[1], 10) : 0;

      if (retryCount < MAX_RETRIES) {
        const nextRetry = retryCount + 1;
        console.log(`🔄 [VIDEO-V3] E005 error - retrying (attempt ${nextRetry}/${MAX_RETRIES})`);

        try {
          // Yeni Replicate prediction oluştur
          const retryResponse = await axios.post(
            "https://api.replicate.com/v1/models/google/veo-3.1-fast/predictions",
            {
              input: {
                prompt: generation.enhanced_prompt || generation.user_prompt,
                image: generation.original_image_url,
                duration: generation.duration || 8,
                aspect_ratio: generation.aspect_ratio || "9:16",
                resolution: generation.resolution || "1080p",
                generate_audio: false,
              },
            },
            { headers: REPLICATE_HEADERS, timeout: 60000 }
          );

          const newPrediction = retryResponse.data;
          const newPredictionId = newPrediction?.id;

          if (newPredictionId) {
            console.log(`✅ [VIDEO-V3] Retry prediction id: ${newPredictionId}`);
            await supabase
              .from("video_generations")
              .update({
                fal_request_id: newPredictionId,
                status: "processing",
                error_message: `RETRY:${nextRetry}:${errorMessage}`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", generationId);

            return res.status(200).json({
              success: true,
              status: "processing",
              videoUrl: null,
              generation: { ...generation, status: "processing" },
            });
          }
        } catch (retryError) {
          console.error("❌ [VIDEO-V3] Retry submission failed:", retryError.message);
        }
      } else {
        console.log(`❌ [VIDEO-V3] Max retries (${MAX_RETRIES}) reached for E005, failing permanently`);
        // retry sayısını temizle, gerçek hata mesajını yaz
        errorMessage = errorMessage.replace(/^RETRY:\d+:/, "");
      }
    }

    // Update DB
    const processingTime = Math.round((Date.now() - new Date(generation.created_at).getTime()) / 1000);
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "completed") {
      updateData.result_video_url = videoUrl;
      updateData.processing_time_seconds = processingTime;
    } else if (status === "failed") {
      updateData.error_message = errorMessage;

      // Kredi iade et
      if (generation.credits_used > 0) {
        try {
          const { data: currentUser } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", generation.user_id)
            .single();

          if (currentUser) {
            await supabase
              .from("users")
              .update({ credit_balance: (currentUser.credit_balance || 0) + generation.credits_used })
              .eq("id", generation.user_id);
            console.log(`💰 [VIDEO-V3] ${generation.credits_used} credits refunded to ${generation.user_id} (failed generation)`);

            // credits_used'ı 0 yap ki tekrar iade olmasın
            updateData.credits_used = 0;
          }
        } catch (refundError) {
          console.error("❌ [VIDEO-V3] Credit refund failed:", refundError.message);
        }
      }
    }

    await supabase
      .from("video_generations")
      .update(updateData)
      .eq("id", generationId);

    return res.status(200).json({
      success: true,
      status,
      videoUrl,
      generation: { ...generation, ...updateData },
    });
  } catch (error) {
    console.error("❌ [VIDEO-V3] Status error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// GET /api/videoGenerations/:userId - List user's video generations
// ============================================================
router.get("/videoGenerations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = 20 } = req.query;

    let query = supabase
      .from("video_generations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(parseInt(limit));

    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 1) {
        query = query.in("status", statuses);
      } else {
        query = query.eq("status", statuses[0]);
      }
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ success: false, message: "DB error", error: error.message });
    }

    return res.status(200).json({
      success: true,
      data: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("❌ [VIDEO-V3] List error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
