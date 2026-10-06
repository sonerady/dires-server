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
const { GPT25_EDIT_MODEL, buildEditInput } = require("./gpt25Edit");
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

// 🛍️ 24 Eyl 2026: e-ticaret ürün videosu storyboard'u (Video Stüdyosu kartları + serbest video brief'i).
// Eski moda istemi ("aynı model, aynı kıyafet") kupa/parfüm/çanta gibi ürünlere uymuyordu.
// `direction` = kartın yönetmen kuralı (videoSkillPrompt craft) ya da brief cümleleri.
const GRID_LAYOUT = { "9:16": "2 columns × 3 rows", "3:4": "2 columns × 3 rows", "1:1": "3 columns × 2 rows", "4:3": "3 columns × 2 rows", "16:9": "3 columns × 2 rows", "21:9": "3 columns × 2 rows" };
function buildCommerceGridPrompt({ direction = "", notes = "", aspectRatio = "9:16", productCount = 1, duration = 10, presenterImageIndex = null, locationImageIndex = null } = {}) {
  const ratio = GRID_LAYOUT[aspectRatio] ? aspectRatio : "9:16";
  const productRefs = productCount > 1 ? `The ${productCount} input photos show the SAME product from different angles` : "The input photo shows the product";
  const refs = locationImageIndex ? `The first ${productCount} input photo(s) show the product. Input photo ${locationImageIndex} is ONLY the selected location/background reference, not a product photo. Preserve that environment` : presenterImageIndex ? `The first ${productCount} input photo(s) show the product. Input photo ${presenterImageIndex} is ONLY the chosen presenter identity reference, not a product photo` : productRefs;
  const safeNotes = String(notes || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return `Create a single ${ratio} storyboard image for a ${duration}-second e-commerce product video, arranged as a ${GRID_LAYOUT[ratio]} grid (6 cells), read left→right, top→bottom. ${refs}. Ignore the messy backgrounds of the product reference photos only.

DIRECTION FOR THE VIDEO (follow it): ${direction || "Choose the single most effective product-video concept for this product and commit to it."}
${safeNotes ? `SELLER NOTES (context only, never render as text): ${safeNotes}\n` : ""}
The 6 cells are the 6 key shots of that video in order: cell 1 = the opening hook, cells 2–5 = the development (product in use / details / hero moments, as the direction requires), cell 6 = the closing hero shot. Each cell is a finished, photoreal frame of that shot, with varied framing (wide, medium, close-up, macro) where the direction allows.

PRODUCT LOCK: the product in every cell is IDENTICAL to the product reference photos — same shape, color, material, logo, label, print, proportions and details. Never redesign it, never add text, prices, badges or fake claims.
FORMAT: ONE composite image with the grid baked in, thin white gutters (~6px) between cells, NO text, NO numbers, NO captions or labels anywhere. Consistent lighting and art direction across cells, premium commercial photography quality.`;
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

// 🧩 Komple pipeline — GPT Image 2.5 (yedek nano-banana-2) çağrısı + Supabase persist + log.
// Hata durumunda { success:false, error } döner (caller fallback yapabilir).
const NB2_EDIT_MODEL = "google/nano-banana-2.1/edit";
/** "nano-banana-2" | "gpt-image-2.5" → denenecek modeller (24 Eyl 2026: Ürün satış videosu NB2, diğerleri GPT 2.5).
 *  26 Eyl 2026 (kullanıcı kararı): satış DIŞI kartlar yalnız GPT 2.5 medium'a gider — NB2'ye yedek düşmez
 *  (GPT hata verirse önizleme hata döner, kullanıcı "Tekrar dene"yi kullanır). Satış videosu NB2, yedeği GPT 2.5. */
function previewModelOrder(preferred) {
  return preferred === "nano-banana-2" ? [NB2_EDIT_MODEL, GPT25_EDIT_MODEL] : [GPT25_EDIT_MODEL];
}
// Storyboard önizlemesi GPT 2.5'te sabit "medium" (app_config.gpt25_quality genel üretim içindir, burada kullanılmaz)
const PREVIEW_GPT25_QUALITY = "medium";

async function generateVideoGridPreview({
  supabase,
  sourceUrl,
  sourceUrls = null, // 🛍️ ürün açıları (ilk = ana ürün)
  userPrompt = "",
  prompt: promptOverride = null, // 🛍️ buildCommerceGridPrompt çıktısı; yoksa eski moda istemi
  aspectRatio = "9:16",
  preferredModel = "gpt-image-2.5",
  falApiKey = process.env.FAL_API_KEY,
  logTag = "VIDEO_GRID",
}) {
  const images = (Array.isArray(sourceUrls) && sourceUrls.length ? sourceUrls : [sourceUrl]).filter(Boolean).slice(0, 6);
  if (!images.length) {
    return { success: false, error: "missing sourceUrl" };
  }
  if (!falApiKey) {
    return { success: false, error: "missing FAL_API_KEY" };
  }

  const prompt = promptOverride || buildGridPrompt(userPrompt);
  const ratio = GRID_LAYOUT[aspectRatio] ? aspectRatio : "9:16";

  // 🎨 GPT Image 2.5 Sunburst (kalite: PREVIEW_GPT25_QUALITY = medium) ya da nano-banana-2/edit;
  // yalnız satış videosunda NB2 → GPT 2.5 yedeği var (26 Eyl 2026).
  const requestBody = {
    prompt,
    image_urls: images,
    output_format: "png",
    aspect_ratio: ratio,
    num_images: 1,
    resolution: "2K",
    safety_tolerance: "6",
  };
  const headers = { Authorization: `Key ${falApiKey}`, "Content-Type": "application/json" };
  let nanoResponse;
  let usedModel = null;
  let lastError = null;
  for (const model of previewModelOrder(preferredModel)) {
    try {
      console.log(`🧩 [${logTag}] ${model} çağrılıyor (${images.length} görsel, ${ratio})`);
      const body = model === GPT25_EDIT_MODEL ? buildEditInput(GPT25_EDIT_MODEL, { ...requestBody, quality: PREVIEW_GPT25_QUALITY }) : requestBody;
      nanoResponse = await axios.post(`https://fal.run/${model}`, body, { headers, timeout: 300000 });
      if (!nanoResponse?.data?.images?.[0]?.url) throw new Error(`${model} returned no image`);
      usedModel = model;
      break;
    } catch (err) {
      lastError = err;
      console.warn(`🛟 [${logTag}] ${model} başarısız (${err?.response?.data?.detail ? JSON.stringify(err.response.data.detail).slice(0, 200) : err?.message})`);
    }
  }
  if (!usedModel) {
    return { success: false, error: lastError?.message || "preview generation failed" };
  }
  console.log(`🧩 [${logTag}] grid modeli: ${usedModel}`);

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
    model: usedModel,
  };
}

module.exports = {
  buildCommerceGridPrompt,
  previewModelOrder,
  buildGridPrompt,
  persistGridToSupabase,
  generateVideoGridPreview,
};
