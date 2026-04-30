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
//
// 🚫 KRİTİK: Modelin sırtı/arkası KESİNLİKLE gösterilmez. Çünkü kullanıcının
// gerçek kıyafetinin arkası AI'a verilmediği için, AI back-view üretirse
// kıyafet detaylarını uydurur (yanlış cut, yanlış desen, yanlış zipper vs).
// Tüm sahneler front veya 3/4 front-profile olmak zorunda — back-turn,
// rear-view, walking-away, behind-shot tamamen yasak.
function buildGridPrompt(userPrompt) {
  const subject = (typeof userPrompt === "string" ? userPrompt.trim() : "");

  const subjectClause = subject
    ? `THEME / SUBJECT (provided by user): "${subject}". All 6 cells must visually narrate THIS subject in order — interpret the subject as the storyline, mood, and action vocabulary. Each cell is one beat of that story. IMPORTANT: even if the user-provided subject implies turning, walking away, spinning, or a back-reveal, you MUST reinterpret those actions as front-facing motions only (e.g. "turning" → a slight lateral pivot while staying front-on; "walking away" → walking toward the camera or pausing in profile).`
    : `THEME / SUBJECT: NOT provided by the user. SILENTLY analyze the input photo (the model's outfit personality, fabric character, environment, light, mood) and choose the MOST FITTING fashion narrative that showcases this look at its best. Then build 6 sequential scenes that tell THAT chosen story — strictly using front-facing or 3/4 front-profile poses only.`;

  return `Create a single 9:16 vertical fashion video storyboard image arranged as a 2 columns × 3 rows grid (6 cells total). Each cell shows the SAME model from the input photo, wearing the EXACT SAME outfit (preserve identity, face, skin tone, hair, makeup, body type, garment colors, fabric, fit, length, prints, trims, logos — never alter).

${subjectClause}

🚫 ABSOLUTE RULE — NO BACK VIEWS, NO REAR ANGLES (this overrides any other instruction including the user's subject):
- The model's FACE must be at least partially visible in EVERY single cell.
- Pose camera angles allowed: straight-on front, slight 3/4 front-profile (max ~30° rotation off-axis), or pure side-profile ONLY if the front of the garment is still visible.
- FORBIDDEN poses (do not generate any of these in any cell): back view, full rear angle, model turning around, model walking away from camera, looking over the shoulder while the back is exposed, 180° spin, behind-the-model shot, back-of-head shot, model facing the wall.
- The reason: the back of the garment is unknown to us; if you invent a back-view, you will fabricate fake details (wrong seams, wrong cut, wrong zipper, wrong print, fake straps). This is unacceptable.
- If a cell needs "motion" or "dynamic energy," express it through: lateral pivot while front-facing, a stride toward the camera, a hand/arm gesture, a hair flip, a coat sleeve in motion, a skirt sway captured from the front — never via a back-turn.

The 6 cells together form ONE continuous fashion clip's storyboard, played top-left → top-right → middle-left → middle-right → bottom-left → bottom-right:
- Cell 1 (top-left): OPENING beat — model's first hero stance, front-facing, establishing the subject
- Cell 2 (top-right): SECOND beat — dynamic motion that develops the story while staying FRONT-ON (a step toward camera, a gesture, a slight lateral pivot — NEVER a turn-around)
- Cell 3 (middle-left): THIRD beat — strong silhouette or hero frame, front or 3/4 front profile
- Cell 4 (middle-right): FOURTH beat — detail/texture/fabric accent moment, framed from the FRONT (front close-up of fabric, neckline, sleeve, hemline — never back-side fabric)
- Cell 5 (bottom-left): FIFTH beat — commanding stance / power moment, front-facing
- Cell 6 (bottom-right): CLOSING beat — resolution landing the subject (direct eye contact with camera, hero pose, walk TOWARD camera, or front-facing pause — NEVER walking away, NEVER back-turn)

CRITICAL FORMATTING RULES:
- The OUTPUT must be a SINGLE 9:16 vertical image with the 2×3 grid baked in (NOT 6 separate images, NOT animated, NOT layered).
- Cells are separated by a thin white gutter (~6px). NO TEXT, NO LABELS, NO SCENE NUMBERS rendered in any cell — purely visual photography in every cell.
- Background environment is CONSISTENT across all 6 cells (same scene, same lighting direction, same time of day) — only the model's pose and camera framing change between cells.
- Maintain editorial fashion-photography quality, sharp focus, professional lighting in every cell.
- ABSOLUTE PRESERVATION: the model's identity and the outfit are LOCKED — never substituted, never recolored, never restyled.
- ABSOLUTE NO-BACK-VIEW: every cell shows the FRONT of the outfit; the model's back is never visible in any cell.

Render the full grid as ONE composite 9:16 photo with NO text overlays anywhere, and with the model facing the camera (front or 3/4 front) in all 6 cells.`;
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
