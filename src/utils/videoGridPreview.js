/**
 * 🧩 Video Grid Preview Utility
 *
 * nano-banana-2 ile fotoğraftan 6 sahneli (2×3) storyboard grid resmi üretir
 * ve kalıcı olarak Supabase "images" bucket'ına yükler.
 *
 * Kullanım:
 *   - videoPreviewGridRoutes.js (kullanıcının "Önizle" butonu — eşzamanlı)
 *   - generateImgToVidv2.js (kullanıcı önizlemese bile arka planda çalışır
 *     ve grid'i video'nun first_frame'i olarak kullanılır)
 */

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

// 🧩 Prompt — nano-banana-2'ye gönderilen 6 sahneli grid talimatı.
// userPrompt varsa o konuya göre 6 sahne; yoksa AI fotoğraftan en uygun
// fashion narrative'i türetir. "Scene N" METİN ETİKETİ RENDER EDİLMEZ.
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

// 🧩 fal.ai geçici CDN'inden Supabase "images" bucket'ına persist eder.
// Hata durumunda fallback olarak orijinal fal URL'i döner.
async function persistGridToSupabase(supabase, falUrl) {
  if (!falUrl || typeof falUrl !== "string") return falUrl;
  if (falUrl.includes("supabase.co/storage/")) return falUrl;

  try {
    const response = await axios.get(falUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    const buffer = Buffer.from(response.data);
    const fileName = `preview_grid_${uuidv4()}.png`;

    const { error } = await supabase.storage
      .from("images")
      .upload(`generated/${fileName}`, buffer, { contentType: "image/png" });

    if (error) {
      console.warn("⚠️ [VIDEO_GRID] Supabase upload hata:", error.message);
      return falUrl;
    }

    const { data } = await supabase.storage
      .from("images")
      .getPublicUrl(`generated/${fileName}`);

    return data?.publicUrl || falUrl;
  } catch (err) {
    console.warn("⚠️ [VIDEO_GRID] persist hata:", err?.message);
    return falUrl;
  }
}

// 🧩 Komple pipeline — nano-banana-2 çağrısı + Supabase persist + log.
// Hata durumunda { success:false, error } döner (caller fallback yapabilir).
async function generateVideoGridPreview({
  supabase,
  sourceUrl,
  userPrompt = "",
  falApiKey = process.env.FAL_API_KEY,
  logTag = "VIDEO_GRID",
}) {
  if (!sourceUrl) {
    return { success: false, error: "missing sourceUrl" };
  }
  if (!falApiKey) {
    return { success: false, error: "missing FAL_API_KEY" };
  }

  const prompt = buildGridPrompt(userPrompt);

  let nanoResponse;
  try {
    console.log(`🧩 [${logTag}] nano-banana-2 çağrılıyor`);
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
          Authorization: `Key ${falApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 300000,
      },
    );
  } catch (err) {
    console.error(
      `❌ [${logTag}] nano-banana hata:`,
      err?.response?.data || err?.message,
    );
    return {
      success: false,
      error: err?.message || "nano-banana failed",
    };
  }

  const falGridUrl = nanoResponse?.data?.images?.[0]?.url;
  const falRequestId = nanoResponse?.data?.request_id || null;

  if (!falGridUrl) {
    return { success: false, error: "nano-banana returned no image" };
  }

  console.log(`📤 [${logTag}] Grid Supabase'e yükleniyor`);
  const gridUrl = await persistGridToSupabase(supabase, falGridUrl);
  const isPersisted = gridUrl !== falGridUrl;
  console.log(
    isPersisted
      ? `✅ [${logTag}] Supabase persist başarılı: ${gridUrl?.slice(0, 80)}...`
      : `⚠️ [${logTag}] Persist başarısız, fal.ai URL geçici fallback`,
  );

  return {
    success: true,
    gridUrl,
    falRequestId,
    promptUsed: prompt,
  };
}

module.exports = {
  buildGridPrompt,
  persistGridToSupabase,
  generateVideoGridPreview,
};
