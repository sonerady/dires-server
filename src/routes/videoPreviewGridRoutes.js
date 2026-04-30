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

// 🧵 Background grid generation — POST'tan fire-and-forget olarak çağrılır.
// Client uygulamadan çıksa bile devam eder; sonuç DB'ye yazılır, GET status
// endpoint'inden poll edilebilir.
async function runGridGenerationBackground({ previewId, sourceUrl, userPrompt }) {
  try {
    const result = await generateVideoGridPreview({
      supabase,
      sourceUrl,
      userPrompt,
      logTag: `VIDEO_PREVIEW ${previewId}`,
    });

    if (!result.success) {
      await supabase
        .from("video_preview_generations")
        .update({
          status: "failed",
          error_message: result.error || "grid generation failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", previewId);
      return;
    }

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
  } catch (err) {
    console.error(`❌ [VIDEO_PREVIEW ${previewId}] background error:`, err?.message);
    try {
      await supabase
        .from("video_preview_generations")
        .update({
          status: "failed",
          error_message: err?.message || "background pipeline failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", previewId);
    } catch (dbErr) {
      console.error(`❌ [VIDEO_PREVIEW ${previewId}] DB update error:`, dbErr?.message);
    }
  }
}

// POST — async kickoff: row insert + sourceUrl upload + previewId hemen döner.
// Grid generation arka planda runGridGenerationBackground'ta çalışır;
// client uygulamadan çıksa bile pipeline tamamlanır. Client status endpoint'i
// üzerinden poll ederek sonucu öğrenir.
router.post("/videoPreviewGrid/generate", async (req, res) => {
  try {
    const { userId, first_frame_image, prompt: userPrompt } = req.body;

    if (!userId || !first_frame_image) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId and first_frame_image",
      });
    }

    // 1. base64 → Supabase URL (URL geldiyse passthrough)
    const sourceUrl = first_frame_image.startsWith("data:image/")
      ? await uploadBase64ToSupabase(first_frame_image)
      : first_frame_image;

    // 2. Pending row insert et — sourceUrl'i de baştan kaydet ki polling
    // sırasında client önceden bilebilsin.
    const { data: insertRow, error: insertError } = await supabase
      .from("video_preview_generations")
      .insert({
        user_id: userId,
        status: "processing",
        source_image_url: sourceUrl,
      })
      .select("id")
      .single();

    if (insertError || !insertRow?.id) {
      console.error("❌ [VIDEO_PREVIEW] DB insert hata:", insertError?.message);
      return res.status(500).json({
        success: false,
        message: insertError?.message || "DB insert failed",
      });
    }

    const previewId = insertRow.id;

    // 3. Background grid generation — fire-and-forget. Client uygulamadan
    // çıksa bile bu callback execute olmaya devam eder (Node process içinde).
    runGridGenerationBackground({ previewId, sourceUrl, userPrompt }).catch(
      (err) => {
        console.error(
          `❌ [VIDEO_PREVIEW ${previewId}] unhandled background rejection:`,
          err?.message,
        );
      },
    );

    // 4. Client'a hemen previewId dön — gerisini polling ile takip eder.
    return res.status(202).json({
      success: true,
      previewId,
      sourceImageUrl: sourceUrl,
      status: "processing",
    });
  } catch (err) {
    console.error("❌ [VIDEO_PREVIEW] error:", err?.message);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error",
    });
  }
});

// GET — preview generation durumu poll'u. Client setInterval ile bu endpoint'i
// çağırarak processing → completed/failed geçişini takip eder.
router.get("/videoPreviewGrid/status/:previewId", async (req, res) => {
  try {
    const { previewId } = req.params;
    if (!previewId) {
      return res.status(400).json({ success: false, message: "Missing previewId" });
    }

    const { data: row, error } = await supabase
      .from("video_preview_generations")
      .select("id, status, source_image_url, preview_grid_url, error_message, updated_at")
      .eq("id", previewId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
    if (!row) {
      return res.status(404).json({ success: false, message: "Preview not found" });
    }

    return res.json({
      success: true,
      previewId: row.id,
      status: row.status, // "processing" | "completed" | "failed"
      gridImageUrl: row.preview_grid_url || null,
      sourceImageUrl: row.source_image_url || null,
      errorMessage: row.error_message || null,
      updatedAt: row.updated_at || null,
    });
  } catch (err) {
    console.error("❌ [VIDEO_PREVIEW] status error:", err?.message);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error",
    });
  }
});

module.exports = router;
