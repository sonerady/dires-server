const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");

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

// 🧩 nano-banana CDN'inde geçici tutulan grid resmini indirip kalıcı olarak
// Supabase "images" bucket'ına yükler. fal.ai URL'leri TTL'li → kalıcı
// link gerekiyor. Hata durumunda fallback olarak orijinal fal URL'i döner.
async function persistGridToSupabase(falUrl) {
  if (!falUrl || typeof falUrl !== "string") return falUrl;
  // Zaten Supabase URL'iyse passthrough
  if (falUrl.includes("supabase.co/storage/")) return falUrl;

  try {
    const response = await axios.get(falUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    // PNG olarak kaydet (nano-banana output_format: "png")
    const buffer = Buffer.from(response.data);
    const fileName = `preview_grid_${uuidv4()}.png`;

    const { error } = await supabase.storage
      .from("images")
      .upload(`generated/${fileName}`, buffer, { contentType: "image/png" });

    if (error) {
      console.warn("⚠️ [VIDEO_PREVIEW] Supabase upload hata:", error.message);
      return falUrl; // fallback
    }

    const { data } = await supabase.storage
      .from("images")
      .getPublicUrl(`generated/${fileName}`);

    return data?.publicUrl || falUrl;
  } catch (err) {
    console.warn("⚠️ [VIDEO_PREVIEW] Grid persist hata:", err?.message);
    return falUrl; // fallback
  }
}

// 🧩 Prompt — nano-banana-2'ye gönderilen 6 sahneli grid talimatı.
// userPrompt varsa o konuya göre 6 sahne; yoksa AI fotoğraftan en uygun
// fashion narrative'i türetir. "Scene N" METİN ETİKETİ RENDER EDİLMEZ —
// sadece görsel hücreler.
function buildGridPrompt(userPrompt) {
  const subject = (typeof userPrompt === "string" ? userPrompt.trim() : "");

  const subjectClause = subject
    ? `THEME / SUBJECT (provided by user): "${subject}". All 6 cells must visually narrate THIS subject in order — interpret the subject as the storyline, mood, and action vocabulary. Each cell is one beat of that story.`
    : `THEME / SUBJECT: NOT provided by the user. SILENTLY analyze the input photo (the model's outfit personality, fabric character, environment, light, mood) and choose the MOST FITTING fashion narrative that showcases this look at its best. Then build 6 sequential scenes that tell THAT chosen story.`;

  return `Create a single 9:16 vertical fashion video storyboard image arranged as a 2 columns × 3 rows grid (6 cells total). Each cell shows the SAME model from the input photo, wearing the EXACT SAME outfit (preserve identity, face, skin tone, hair, makeup, body type, garment colors, fabric, fit, length, prints, trims, logos — never alter).

${subjectClause}

The 6 cells together form ONE continuous fashion clip's storyboard, played top-left → top-right → middle-left → middle-right → bottom-left → bottom-right:
- Cell 1 (top-left): the OPENING beat — model's entrance / first hero stance establishing the subject
- Cell 2 (top-right): the SECOND beat — dynamic motion that develops the story (turn, stride, gesture aligned with the subject)
- Cell 3 (middle-left): the THIRD beat — a strong silhouette or hero frame matching the subject's mood
- Cell 4 (middle-right): the FOURTH beat — a detail / texture / fabric accent moment
- Cell 5 (bottom-left): the FIFTH beat — commanding stance / power moment
- Cell 6 (bottom-right): the CLOSING beat — resolution that lands the subject (gaze to camera, walk-out, back-view turn — whatever fits the chosen narrative)

CRITICAL FORMATTING RULES:
- The OUTPUT must be a SINGLE 9:16 vertical image with the 2×3 grid baked in (NOT 6 separate images, NOT animated, NOT layered).
- Cells are separated by a thin white gutter (~6px). NO TEXT, NO LABELS, NO SCENE NUMBERS rendered in any cell — purely visual photography in every cell.
- Background environment is CONSISTENT across all 6 cells (same scene, same lighting direction, same time of day) — only the model's pose and camera framing change between cells.
- Maintain editorial fashion-photography quality, sharp focus, professional lighting in every cell.
- ABSOLUTE PRESERVATION: the model's identity and the outfit are LOCKED — never substituted, never recolored, never restyled.

Render the full grid as ONE composite 9:16 photo with NO text overlays anywhere.`;
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

    // 3. nano-banana-2 çağrısı (referenceBrowserRoutesV7.js:5519-5543 ile aynı pattern)
    // userPrompt verildiyse o konuya göre 6 sahne; boşsa AI fotoğraftan en
    // uygun fashion narrative'i türetir.
    const prompt = buildGridPrompt(userPrompt);
    console.log(
      `🧩 [VIDEO_PREVIEW] nano-banana-2 çağrılıyor (preview ${previewId || "no-id"})`,
    );

    let nanoResponse;
    try {
      nanoResponse = await axios.post(
        "https://fal.run/fal-ai/nano-banana-2/edit",
        {
          prompt,
          image_urls: [sourceUrl],
          output_format: "png",
          aspect_ratio: "9:16",
          num_images: 1,
          resolution: "2K",
          safety_tolerance: "6",
        },
        {
          headers: {
            Authorization: `Key ${process.env.FAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 300000,
        },
      );
    } catch (falErr) {
      console.error(
        "❌ [VIDEO_PREVIEW] nano-banana hata:",
        falErr?.response?.data || falErr?.message,
      );
      if (previewId) {
        await supabase
          .from("video_preview_generations")
          .update({
            status: "failed",
            error_message: falErr?.message || "nano-banana failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", previewId);
      }
      return res.status(502).json({
        success: false,
        message: "Grid generation failed",
        detail: falErr?.message,
      });
    }

    const falGridUrl = nanoResponse.data?.images?.[0]?.url;
    const falRequestId = nanoResponse.data?.request_id || null;

    if (!falGridUrl) {
      if (previewId) {
        await supabase
          .from("video_preview_generations")
          .update({
            status: "failed",
            error_message: "nano-banana returned no image",
            updated_at: new Date().toISOString(),
          })
          .eq("id", previewId);
      }
      return res
        .status(502)
        .json({ success: false, message: "Grid generation returned empty" });
    }

    // 4. fal.ai geçici CDN'inden Supabase bucket'ına persist et (kalıcı link)
    console.log(`📤 [VIDEO_PREVIEW] Grid Supabase'e yükleniyor (preview ${previewId || "no-id"})`);
    const gridUrl = await persistGridToSupabase(falGridUrl);
    const isPersisted = gridUrl !== falGridUrl;
    console.log(
      isPersisted
        ? `✅ [VIDEO_PREVIEW] Supabase persist başarılı: ${gridUrl?.slice(0, 80)}...`
        : `⚠️ [VIDEO_PREVIEW] Persist başarısız, fal.ai URL kullanılacak (geçici)`,
    );

    // 5. DB row update — completed (kalıcı Supabase URL ile)
    if (previewId) {
      await supabase
        .from("video_preview_generations")
        .update({
          status: "completed",
          source_image_url: sourceUrl,
          preview_grid_url: gridUrl,
          fal_request_id: falRequestId,
          prompt_used: prompt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", previewId);
    }

    return res.json({
      success: true,
      previewId,
      gridImageUrl: gridUrl,        // kalıcı Supabase URL (veya persist fail'lerse fal.ai fallback)
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
