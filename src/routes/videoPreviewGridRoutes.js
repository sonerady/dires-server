const express = require("express");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const { generateVideoGridPreview } = require("../utils/videoGridPreview");

const router = express.Router();

// Lokal helper — generateImgToVidv2.js:243 uploadImageToSupabase ile aynı
// pattern. Preview pipeline'ının bağımsız olması için duplicate edildi.
async function uploadBase64ToSupabase(base64String) {
  if (!base64String?.startsWith("data:image/")) return base64String;

  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
  const buffer = await sharp(Buffer.from(base64Data, "base64"))
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const fileName = `preview_source_${uuidv4()}.jpg`;
  const { error } = await supabase.storage
    .from("images")
    .upload(`generated/${fileName}`, buffer, { contentType: "image/jpeg" });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = await supabase.storage
    .from("images")
    .getPublicUrl(`generated/${fileName}`);

  return data.publicUrl;
}

router.post("/videoPreviewGrid/generate", async (req, res) => {
  try {
    const { userId, first_frame_image, prompt: userPrompt } = req.body;

    if (!userId || !first_frame_image) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId and first_frame_image",
      });
    }

    // 1. Insert pending row (history için)
    let previewId = null;
    try {
      const { data: insertRow, error: insertError } = await supabase
        .from("video_preview_generations")
        .insert({ user_id: userId, status: "processing" })
        .select("id")
        .single();
      if (insertError) {
        console.warn("⚠️ [VIDEO_PREVIEW] DB insert hata:", insertError.message);
      } else {
        previewId = insertRow?.id || null;
      }
    } catch (dbErr) {
      console.warn("⚠️ [VIDEO_PREVIEW] DB insert exception:", dbErr?.message);
    }

    // 2. Upload base64 → Supabase URL (URL geldiyse passthrough)
    const sourceUrl = first_frame_image.startsWith("data:image/")
      ? await uploadBase64ToSupabase(first_frame_image)
      : first_frame_image;

    // 3. Ortak grid pipeline — nano-banana-2 + Supabase persist
    const result = await generateVideoGridPreview({
      supabase,
      sourceUrl,
      userPrompt,
      logTag: "VIDEO_PREVIEW",
    });

    if (!result.success) {
      if (previewId) {
        await supabase
          .from("video_preview_generations")
          .update({
            status: "failed",
            error_message: result.error || "grid generation failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", previewId);
      }
      return res.status(502).json({
        success: false,
        message: "Grid generation failed",
        detail: result.error,
      });
    }

    // 4. DB row update — completed
    if (previewId) {
      await supabase
        .from("video_preview_generations")
        .update({
          status: "completed",
          source_image_url: sourceUrl,
          preview_grid_url: result.gridUrl,
          fal_request_id: result.falRequestId,
          prompt_used: result.promptUsed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", previewId);
    }

    return res.json({
      success: true,
      previewId,
      gridImageUrl: result.gridUrl,
      sourceImageUrl: sourceUrl,
    });
  } catch (err) {
    console.error("❌ [VIDEO_PREVIEW] error:", err?.message);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error",
    });
  }
});

module.exports = router;
