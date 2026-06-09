// routes/generateImgToVidv2.js - Seedance 2.0 Enterprise version
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fal } = require("@fal-ai/client");

const { supabase, supabaseAdmin } = require("../supabaseClient");
const teamService = require("../services/teamService");
const { generateVideoGridPreview } = require("../utils/videoGridPreview");
const {
  enforceTrialVideoLimit,
  incrementTrialVideoCount,
} = require("../utils/trialVideoLimit");

fal.config({
  credentials: process.env.FAL_API_KEY,
});

const SEEDANCE_MODEL_ID = "bytedance/seedance-2.0/enterprise/image-to-video";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 5) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  // Bu pattern'leri gördüğümüzde daha uzun bekleyip tekrar dene
  const TRANSIENT_PATTERNS = [
    /E004/i,
    /temporarily unavailable/i,
    /rate limit/i,
    /timeout/i,
    /502/,
    /503/,
    /504/,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
  ];

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      console.log(`🤖 [VIDEO-V2] Gemini Flash attempt ${attempt}/${maxRetries}`);

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
        {
          input: {
            top_p: 0.95,
            images: imageUrls,
            prompt,
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
      if (data.status !== "succeeded") {
        throw new Error(`Prediction failed: ${data.status}`);
      }

      const outputText = Array.isArray(data.output)
        ? data.output.join("")
        : data.output || "";

      if (!outputText.trim()) {
        throw new Error("Empty response");
      }

      return outputText.trim();
    } catch (error) {
      const msg = error?.message || String(error);
      console.error(`❌ [VIDEO-V2] Gemini attempt ${attempt} failed:`, msg);
      if (attempt === maxRetries) {
        throw error;
      }

      const isTransient = TRANSIENT_PATTERNS.some((p) => p.test(msg));
      // Transient hatalarda daha uzun bekle: 3s → 6s → 10s → 15s cap
      // Normal hatalarda klasik: 1s → 2s → 4s → 8s cap
      const base = isTransient ? 3000 : 1000;
      const cap = isTransient ? 15000 : 8000;
      const waitTime = Math.min(base * Math.pow(2, attempt - 1), cap);
      if (isTransient) {
        console.log(
          `⏳ [VIDEO-V2] Transient error, waiting ${waitTime}ms before retry…`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw new Error("Gemini prompt generation failed");
}

/**
 * Gemini'nin tamamen fail ettiği durumda kullanılacak default fashion-clip
 * template'i. Kullanıcının ham prompt'unu içine gömer, Seedance'a anlamlı
 * bir çıktı verebilecek bir iskelet sunar.
 */
function buildFallbackVideoPrompt(userPrompt) {
  const hint = (userPrompt || "").trim();
  const intentClause = hint
    ? ` Align with the user's intent: "${hint.substring(0, 200)}".`
    : "";
  return (
    "Short fashion campaign clip directed with intent: a professional model in the exact setting and outfit shown in the input image, preserving the environment, fabric, pattern, and existing lighting direction." +
    intentClause +
    " The camera moves with momentum — choose a motion that fits the garment and the space, such as a tracking shot alongside a confident stride, a low-angle dolly with forward drive, an orbit with a deliberate speed ramp at the midpoint, or a whip-pan that lands on a hero profile frame, never a slow default push-in on the outfit. The model performs two or three chained beats matched to the garment's personality — for example a confident stride into a sharp pivot, then a hair flick that settles into a held profile silhouette — with real presence and editorial attitude, never a static poised glance or sleeve adjusting. One authored detail accent cuts through the clip: fabric sweeping through the light, a rack focus pulling from a foreground texture to the silhouette, or a light flash catching a surface on the key beat. The lighting mirrors the image exactly, with motion interacting naturally with those existing shadows and highlights, and no outdoor sunlight, golden hour, sky, or lens flare is ever invented unless it is visibly present in the image. Ultra-realistic fashion campaign film grade, shallow depth of field, high-frame-rate with a deliberate speed ramp on the key beat, an editorial color palette that amplifies the outfit's tones against the room, runway after-movie × campaign teaser feel, 8k."
  );
}

/**
 * 🧩 Grid mode — Gemini'ye verilen director template'in 6-cut versiyonu.
 * Tek-sahne dili (single tracking shot, two-three chained beats, etc.)
 * BANNED. Gemini sıralı 6 cinematic cut'tan oluşan bir editli klip yazar.
 */
function buildGridGeminiPrompt(userPrompt, editModeInstructions = "", hasBackImage = false) {
  return `
You are a senior fashion film DIRECTOR + EDITOR writing shot notes for an AI Image-to-Video model. The INPUT IMAGE you receive is NOT a single scene — it is a 2×3 STORYBOARD GRID containing 6 separate scenes (cells) of the same model, same outfit, same environment. Each cell is one beat of a single fashion campaign clip, in this order: top-left → top-right → middle-left → middle-right → bottom-left → bottom-right.

User Theme / Subject: "${userPrompt || ""}" (May be empty. Use as the narrative throughline of the 6-cut sequence; if empty, infer the most fitting fashion narrative from the cells themselves.)

CORE DIRECTION:
You are NOT designing one continuous take with one camera move and one model performing 2-3 beats. You are designing a 6-CUT EDITED CLIP — six discrete shots cut together at speed, each shot lifted directly from one of the storyboard cells, played in order, transitioning into the next via cinematic cuts (whip-pan, match-cut, speed-ramp, dolly continuation, snap focus). Roughly equal time per cut (~clip_duration / 6 seconds each). The viewer must feel they are watching a campaign edit cut to rhythm, not a single take.

HOW TO READ THE STORYBOARD (silently):
- Cell 1 = the OPENING beat (entrance, hero stance establishing the subject)
- Cell 2 = the SECOND beat (dynamic motion that develops the story)
- Cell 3 = the THIRD beat (strong silhouette / hero frame)
- Cell 4 = the FOURTH beat (detail / texture / fabric accent)
- Cell 5 = the FIFTH beat (commanding stance / power moment)
- Cell 6 = the CLOSING beat (resolution that lands the subject)
For each cell you describe its specific framing, the model's pose/motion seen in that cell, and the cut that takes us into the next cell.

OUTPUT FORMAT — VERY IMPORTANT:
Output a SINGLE flowing prose paragraph in English. Walk through the 6 cuts in order, weaving each cell's framing + the cut that transitions out of it. NO headings, NO numbered sections, NO "Cut 1:" labels, NO bullet points. The output is ONE dense, cinematic prose paragraph.

WHAT THE PARAGRAPH MUST COVER (in flowing prose, naturally):
- The model and outfit painted briefly (fabric, cut, pattern, accents) and the room as a continuous set held across all 6 cuts (same lighting, same scene — only framing/pose changes).
- For EACH of the 6 cells: a specific framing (lens, angle, distance) + the model's beat from that cell + the cut/transition technique into the next cell. Six discrete shots — never collapse into "two or three chained beats".
- Lighting that MIRRORS the image's existing direction across all cuts (no invented sunlight, no golden hour unless visibly present).
- Editor's pass: rhythm of cuts, frame-rate feel, color grade amplifying the outfit's palette, depth-of-field choices that match each shot.

EMBRACE: "cuts to", "match-cuts into", "whip-pans into", "snap focus pull onto", "speed ramp through", "hard cut to", "transitions seamlessly into", "the edit lands on".

BANNED VOCABULARY (do NOT use — they collapse the 6-cut clip into a single take OR cause the grid to appear in the output):
"a single tracking shot", "one continuous take", "the camera moves through" (singular continuous-take phrasing), "two or three chained beats", "the model performs a, then b, then c" (suggests one continuous take), "preserve the exact setting" (already locked — don't reiterate as if treating the grid as one scene), "slow cinematic push-in", "poised", "minimal movement", "the camera pulls back to reveal the storyboard", "the grid fades into view", "the six cells appear", "split-screen", "picture-in-picture", "we see the grid", "starts on the storyboard", "zooms out from the grid", "transitions through the grid layout".

CRITICAL RENDER RULES (Seedance MUST follow):
- ⛔ The grid layout itself is NEVER visible in the output video. Frame 0 starts ALREADY ON Cell 1's content as a full-screen 9:16 single shot — the camera does NOT zoom out from one cell to reveal the grid, does NOT linger on the grid composite, does NOT fade through the grid layout. The 6-cell composite is a storyboard reference, never a filmed scene.
- Each of the 6 cuts renders as a FULL-SCREEN 9:16 single shot of that cell's action — never split-screen, never picture-in-picture, never a multi-cell composite.
- The grid lines / gutters / borders / cell numbers in the input image are STORYBOARD ANNOTATIONS only — NEVER render them in the output video.
- Identity, outfit, and environment continuity are LOCKED across all 6 cuts.
${editModeInstructions}${
    hasBackImage
      ? `

⭐ BACK-VIEW IMAGE PROVIDED — a SECOND reference of the back of the outfit. Seedance uses this as the END FRAME. Make the closing cut (Cell 6) resolve naturally to a back-view (180° pivot, walk-out, over-shoulder reveal).`
      : ""
  }
HARD CONSTRAINTS:
- Output ONLY the generated prompt text.
- Keep under 2300 characters.
- Walk through ALL 6 cuts. Never describe just 2-3 beats.
- Always 9:16 vertical, fashion campaign film grade.
`;
}

/**
 * 🧩 Grid mode — Gemini fail'lerse Seedance'a gönderilecek grid-aware
 * fallback. Mevcut buildFallbackVideoPrompt tek-sahne dili kullanıyor →
 * grid modunda kullanılamaz; bu fonksiyon 6-cut akışını anlatır.
 */
function buildGridFallbackPrompt(userPrompt) {
  const hint = (userPrompt || "").trim();
  const subjectClause = hint
    ? ` The 6 cuts together narrate the user's subject: "${hint.substring(0, 200)}".`
    : "";
  return (
    "Six-cut fashion campaign edit, 9:16 vertical, derived from the input storyboard grid (2×3, 6 cells, top-left through bottom-right in reading order). The grid layout itself is NEVER visible in the output video — frame zero starts already inside Cell 1's content rendered as a full-screen 9:16 single shot, never a multi-cell composite, never a zoom-out from one cell to the grid, never a slow reveal of the storyboard. Each cut is a discrete full-screen shot taken from one cell, played in sequence with rhythmic cinematic cuts (whip-pan, match-cut, speed-ramp, snap focus pull, hard cut) — roughly equal time per cut (~clip_duration / 6 seconds each)." +
    subjectClause +
    " The opening cut establishes the model's entrance and the room (Cell 1 full-screen from frame 0); the second cut catches dynamic motion; the third lands a strong silhouette; the fourth is a detail / texture beat; the fifth holds a commanding stance; the closing cut resolves the narrative (direct gaze to camera, a final held hero pose, or a confident step toward camera). Identity, outfit, and environment continuity are locked across all 6 cuts — same model, same clothing, same scene, same lighting direction. The grid gutters, cell borders, split-screen layouts, picture-in-picture frames, and any visual annotations from the storyboard input are NEVER rendered in the output video — render only the model, the outfit, and the action depicted in each cell, one cell at a time, full-screen. Ultra-realistic editorial fashion campaign film grade, shallow depth of field, high-frame-rate with deliberate speed ramps at the cut points, color grade amplifying the outfit's tones against the existing room light, runway after-movie × campaign teaser feel, 8k."
  );
}

async function generateVideoPrompt(
  imageUrl,
  userPrompt,
  editMode = false,
  hasBackImage = false,
  isGridPreview = false
) {
  try {
    const editModeInstructions = editMode
      ? `

    DIRECTOR'S EXTRA LAYER — Dynamic Campaign Mode:
    Add one signature editorial move that ELEVATES the clip without fighting the scene. Pick based on the outfit's personality and the room's character:
    - Structured / bold pattern outfit in an opulent interior → a deliberate orbit with a speed ramp at the midpoint revealing the silhouette.
    - Sportswear / streetwear in a raw space → a confident tracking walk with a whip-pan accent into a profile hero frame.
    - Flowy / eveningwear in a minimal set → a slow dolly-in that accelerates into a sharp sidestep pivot, catching fabric motion.
    - Tailored / suiting in a gallery or corridor → a low-angle dolly alongside the stride with a rack-focus beat to a detail (but not a product push-in).
    One signature move. One detail beat. Clear rhythm. Intent over clutter.
    `
      : "";

    // 🧩 Grid mode: tek-sahne template'i çakışıyor → grid-aware Gemini template kullan
    const promptForGemini = isGridPreview
      ? buildGridGeminiPrompt(userPrompt, editModeInstructions, hasBackImage)
      : `
    You are a senior fashion film DIRECTOR + EDITOR writing shot notes for an AI Image-to-Video model. Your job: READ the input image with care — the outfit's character, the fabric behavior, the environment, the light, the mood — and then design a clip that feels authored, not templated.

    User Input: "${userPrompt}" (May be short, empty, or in another language. The image is the primary source of truth; the user input only refines intent.)

    CORE DIRECTION:
    This is a short fashion campaign clip with real motion and intent. It must feel ALIVE and AUTHORED — like a director composed it and an editor cut it. NOT a product showcase, NOT a slow zoom onto the outfit, NOT a static "poised" tableau. But also NOT random kinetic chaos: every movement, every beat, every framing choice must be driven by what the outfit and the room actually call for.

    HOW TO READ THE IMAGE (do this first, silently):
    - Outfit personality: structured vs flowy, loud pattern vs minimal, tailored vs relaxed, couture vs streetwear. This dictates the model's motion vocabulary.
    - Environment character: intimate interior vs open space, luxurious vs raw, warm vs cool, busy vs clean. This dictates the camera motion and pace.
    - Light & mood: source direction, warmth, hardness, existing shadows. This is preserved exactly, never invented.

    OUTPUT FORMAT — VERY IMPORTANT:
    Output a SINGLE flowing prose paragraph in English. NO headings, NO numbered sections, NO "Scene Description:" / "Camera Movement:" / "Model Movement:" / "Lighting:" / "Visual Style:" labels. NO bullet points. Write as one continuous prompt, the way a prompt engineer would hand it to a video model — dense, descriptive, specific, cinematic, all ideas woven together.

    WHAT THE PARAGRAPH MUST COVER (in flowing prose, naturally, not as sections):
    - The model in context with the outfit painted briefly (fabric, cut, pattern, accents) and the room as a real set with atmosphere.
    - A camera motion that fits the space and the garment — specific lens feel (e.g. 35mm wide, 85mm compression), direction, speed, and a layered micro-beat (rack focus / whip into hero frame / speed ramp). INTENT and MOMENTUM, never a default slow push-in.
    - 2–3 chained model beats matched to the outfit's personality — confident stride + pivot for tailoring, fabric-sweeping turn + held silhouette for eveningwear, shoulder roll + hair flick + profile hold for streetwear. Real motion, real presence, real attitude. Never "she gently adjusts her cuff".
    - Lighting that MIRRORS the image exactly — describe how motion interacts with that light (fabric catching a highlight, silhouette crossing a shadow, color saturating into a grade).
    - Editor's pass woven in — frame-rate feel (high-frame-rate with a speed ramp, or clean constant rate), color grade amplifying the outfit's palette against the room, depth-of-field choice, any fitting texture/grain. Runway after-movie × editorial reel × campaign teaser feel.

    BANNED VOCABULARY (do not use — they flatten the clip):
    "poised", "serene", "quiet opulence", "editorial restraint", "calm glance", "she briefly glances down", "subtly adjusts her sleeve/cuff/collar", "minimal movement", "controlled stillness", "gentle rotation of the torso", "elegant and controlled", "quiet sophistication", "slow cinematic push-in on the jacket/dress/top/pattern/buttons".

    EMBRACE THIS VOCABULARY:
    "confident stride", "sharp pivot", "power pose hold", "hair flick", "shoulder roll", "fabric sweep", "commanding stance", "beat-driven cut", "snap focus", "speed ramp", "whip pan", "tracking alongside the model", "orbit with momentum", "dynamic reveal", "runway presence", "editorial attitude", "director's hero frame".
    ${editModeInstructions}${
      hasBackImage
        ? `

    ⭐ BACK-VIEW IMAGE PROVIDED — the user uploaded a SECOND reference image showing the BACK of the same outfit on the same model. Seedance will use this as the END FRAME of the clip. Your generated prompt MUST explicitly include a motion that NATURALLY RESOLVES to the back of the outfit — for example "the model turns to reveal the back of the outfit", "a graceful 180° pivot ending on a back-view silhouette", "the camera orbits around her as she turns, finishing on the detailed back of the garment". Make the transition feel editorial and intentional, not forced. The back view is the PAYOFF of the clip.`
        : ""
    }
    HARD CONSTRAINTS:
    - Output ONLY the generated prompt text.
    - Keep under 2300 characters.
    - ALWAYS apply the director/editor treatment, even when the user's input is short or empty. The image is always the source.
    - Never default to zooming in on the outfit, garment, chest, jacket, torso, or buttons. Never default to a poised static model.
    - Never invent outdoor sunlight, golden hour, sky, or lens flare unless visibly present in the image. Indoors stays indoors, studio stays studio, dark stays dark.
    - Match the motion energy to the outfit's personality — don't force hair flicks on couture gowns, don't force slow sweeps on sportswear.
    `;

    const imageUrls = imageUrl && imageUrl.startsWith("http") ? [imageUrl] : [];
    let enhancedPrompt = await callReplicateGeminiFlash(promptForGemini, imageUrls, 3);

    if (enhancedPrompt.length > 2400) {
      enhancedPrompt = enhancedPrompt.substring(0, 2400);
    }

    console.log("🎬 [VIDEO-V2] Enhanced prompt:", `${enhancedPrompt.substring(0, 100)}...`);

    // 🧩 Grid preview akışında, input image bir 6 sahneli storyboard. Seedance'e
    // grid'i sıralı kesitlerle animasyon yapması talimatını veren HARD direktifi
    // enhanced prompt'un BAŞINA ekliyoruz.
    if (isGridPreview) {
      enhancedPrompt = buildGridStoryboardDirective() + "\n\n" + enhancedPrompt;
      console.log("🧩 [VIDEO-V2] Grid storyboard direktifi prompt'un başına eklendi.");
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("❌ [VIDEO-V2] Prompt enhancement failed:", error.message);
    // Gemini tamamen çöktü — grid mode için grid-aware fallback,
    // normal mode için klasik fashion-clip fallback.
    let fallback = isGridPreview
      ? buildGridFallbackPrompt(userPrompt)
      : buildFallbackVideoPrompt(userPrompt);
    if (isGridPreview) {
      fallback = buildGridStoryboardDirective() + "\n\n" + fallback;
    }
    console.log(
      isGridPreview
        ? "🛟 [VIDEO-V2] Using GRID fallback template prompt"
        : "🛟 [VIDEO-V2] Using fallback fashion-clip template prompt"
    );
    return fallback;
  }
}

// 🧩 Grid preview akışında Seedance'e gönderilen sabit direktif. Input image
// 2×3 grid (6 sahne) — sıralı animasyon, kesintili cinematic geçişler, hücre
// metni yok (görsel sahneler).
function buildGridStoryboardDirective() {
  return `⚠️ GRID STORYBOARD INPUT — MANDATORY READING:
The input image is NOT a single scene and NOT the first frame of the video. It is a 2×3 STORYBOARD REFERENCE containing 6 cells (top-left → top-right → middle-left → middle-right → bottom-left → bottom-right). The output video MUST never visually show this grid layout in any frame.

⛔ THE GRID LAYOUT IS NEVER VISIBLE IN THE OUTPUT VIDEO:
- Frame 0 (the very first frame) is Cell 1's content ALREADY rendered as a full-screen 9:16 single shot — NOT the grid composite, NOT a zoom-out from one cell, NOT a slow reveal of the storyboard.
- The video MUST NEVER linger on, fade through, pull back to, zoom out from, or reveal the 2×3 grid layout. The grid lines, gutters, cell borders, and the multi-cell composite frame are STRICTLY INVISIBLE in every output frame.
- Treat the grid input the way a director treats a paper storyboard on the desk: a planning artifact, never something the camera films.

✅ HOW THE 6 CUTS PLAY:
Play the cells IN ORDER, allocating roughly equal time per cell (~clip_duration / 6 seconds each). Each cell renders as a FULL-SCREEN 9:16 single shot. Transitions between cells are real cinematic cuts (whip pan, match-cut, speed-ramp, dolly continuation, snap focus) — NOT dissolves through the grid, NOT split-screen, NOT picture-in-picture. The viewer feels they are watching ONE seamless campaign edit that flows: Cell-1-fullscreen → cut → Cell-2-fullscreen → cut → … → Cell-6-fullscreen.

Identity, outfit, and environment continuity are LOCKED across all 6 cuts — same model, same clothing, same scene, same lighting direction. Render only the model, the outfit, and the action depicted in each cell — never render the grid, gutters, borders, or any composite frame.`;
}

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

async function uploadImageToSupabase(base64String) {
  if (!base64String.startsWith("data:image/")) {
    return base64String;
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

/**
 * fal.ai CDN'inde geçici olarak tutulan video'yu indirip kalıcı olarak
 * Supabase "user_videos" bucket'ına yükler. Yapı: {user_id}/{generation_id}.mp4
 *
 * Herhangi bir hata durumunda fallback olarak orijinal fal.ai URL'ini döner
 * — böylece video kaybolmaz, en azından fal.ai'deki TTL'ine kadar oynayabilir.
 */
// Aynı generationId için paralel persistFalVideoToSupabase çağrılarını tekleştir
// (polling endpoint'i client tarafından paralel çağrılıyor → aynı videoyu
// defalarca indirip yüklemeyi engelle).
const videoPersistenceInflight = new Map();

// 🧵 Server-side background progression worker dedup — generationId bazlı.
// Submit endpoint'i her video için fire-and-forget bir worker tetikler; client
// modalı kapansa bile fal.ai durumu otomatik poll edilir, tamamlanınca persist
// + DB update yapılır. In-memory state → server restart'ta kaybolur, ama kalan
// "processing" satırlar için client polling yine tetikleyici görev görür (dual safety).
const backgroundProgressionInflight = new Map();

/**
 * fal.ai tarafındaki video işini arka planda poll ederek tamamlanınca Supabase'e
 * persist eden ve DB'yi "completed"/"failed" olarak güncelleyen worker.
 * Client polling'den bağımsız çalışır; dedup lock ile aynı generation için
 * sadece bir worker koşar.
 */
function startBackgroundProgression(generationId, opts = {}) {
  if (!generationId) return;
  if (backgroundProgressionInflight.has(generationId)) {
    return backgroundProgressionInflight.get(generationId);
  }

  const {
    maxAttempts = 120, // 120 × 10s = 20 dakika
    intervalMs = 10000,
  } = opts;

  const task = (async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { data: gen, error: dbErr } = await supabase
          .from("video_generations")
          .select("*")
          .eq("id", generationId)
          .single();

        if (dbErr || !gen) {
          console.warn(
            `⚠️ [VIDEO-V2-BG] ${generationId} not found in DB, stopping worker`
          );
          return;
        }
        if (gen.status === "completed" || gen.status === "failed") {
          return;
        }
        if (!gen.fal_request_id) {
          console.warn(
            `⚠️ [VIDEO-V2-BG] ${generationId} has no fal_request_id, stopping worker`
          );
          return;
        }

        const falStatus = await fal.queue.status(SEEDANCE_MODEL_ID, {
          requestId: gen.fal_request_id,
          logs: true,
        });
        console.log(
          `🧵 [VIDEO-V2-BG] ${generationId} (attempt ${attempt + 1}/${maxAttempts}) fal.ai status: ${falStatus.status}`
        );

        if (falStatus.status === "COMPLETED") {
          // Idempotent: DB'de zaten Supabase URL varsa sadece status'u güncelle
          if (
            gen.result_video_url &&
            /\/storage\/v1\/object\/public\/user_videos\//.test(
              gen.result_video_url
            )
          ) {
            await supabase
              .from("video_generations")
              .update({
                status: "completed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", generationId);
            console.log(
              `✅ [VIDEO-V2-BG] ${generationId} already persisted, status completed`
            );
            return;
          }

          const finalResult = await fal.queue.result(SEEDANCE_MODEL_ID, {
            requestId: gen.fal_request_id,
          });
          const falUrl = extractVideoUrl(finalResult);
          if (!falUrl) {
            await supabase
              .from("video_generations")
              .update({
                status: "failed",
                error_message: "No video output in result (bg)",
                updated_at: new Date().toISOString(),
              })
              .eq("id", generationId);
            console.warn(
              `⚠️ [VIDEO-V2-BG] ${generationId} no video URL in final result`
            );
            return;
          }

          const supabaseUrl = await persistFalVideoToSupabase(
            falUrl,
            gen.user_id,
            generationId
          );
          const processingTime = Math.round(
            (Date.now() - new Date(gen.created_at).getTime()) / 1000
          );
          await supabase
            .from("video_generations")
            .update({
              status: "completed",
              result_video_url: supabaseUrl,
              processing_time_seconds: processingTime,
              updated_at: new Date().toISOString(),
            })
            .eq("id", generationId);
          console.log(
            `🎉 [VIDEO-V2-BG] ${generationId} completed by background worker → ${supabaseUrl}`
          );
          return;
        }

        if (falStatus.status === "FAILED") {
          // Retry logic /videoStatusV2 endpoint'inde (client poll) kalsın;
          // worker sadece son durumu DB'ye yansıtır. Client poll'u RETRY:N prefix'li
          // error_message'ı görüp yeni submit tetikleyebilir.
          const errorMessage =
            falStatus.error ||
            (Array.isArray(falStatus?.logs)
              ? falStatus.logs.map((l) => l.message).filter(Boolean).join(" | ")
              : "") ||
            "fal.ai generation failed (bg)";
          await supabase
            .from("video_generations")
            .update({
              status: "failed",
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", generationId);
          console.warn(
            `⚠️ [VIDEO-V2-BG] ${generationId} marked failed (bg): ${errorMessage}`
          );
          return;
        }

        // IN_QUEUE / IN_PROGRESS → bekle, tekrar dene
      } catch (err) {
        console.error(
          `❌ [VIDEO-V2-BG] ${generationId} loop error (attempt ${attempt + 1}):`,
          err?.message
        );
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    console.warn(
      `⏱️ [VIDEO-V2-BG] ${generationId} max attempts reached, worker exiting (client polling will continue)`
    );
  })().finally(() => {
    backgroundProgressionInflight.delete(generationId);
  });

  backgroundProgressionInflight.set(generationId, task);
  return task;
}


/**
 * Supabase Storage'a TUS (resumable) protokolü ile CHUNKED upload.
 * 100MB+ dosyalar için kritik — tek POST ile göndermek HTTP body limitleri
 * nedeniyle backend'i çökertiyor. TUS protokolü dosyayı 6MB'lık parçalara
 * bölüp ayrı PATCH istekleriyle gönderir, memory baskısı minimal.
 */
async function tusUploadFileToSupabase({
  filePath,
  fileSize,
  bucket,
  objectPath,
  contentType,
  generationId,
  sizeMb,
}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — cannot use TUS upload"
    );
  }

  const encode = (s) => Buffer.from(String(s), "utf8").toString("base64");
  const metadata = [
    `bucketName ${encode(bucket)}`,
    `objectName ${encode(objectPath)}`,
    `contentType ${encode(contentType)}`,
    `cacheControl ${encode("max-age=31536000")}`,
  ].join(",");

  console.log(
    `📤 [VIDEO-V2] TUS create upload (${sizeMb} MB → ${bucket}/${objectPath})…`
  );
  const startUp = Date.now();

  // 1) Resumable upload oluştur
  const createRes = await fetch(`${SUPABASE_URL}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(fileSize),
      "Upload-Metadata": metadata,
      "x-upsert": "true",
    },
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(
      `TUS create failed: ${createRes.status} ${createRes.statusText} — ${body}`
    );
  }

  const locationHeader = createRes.headers.get("location");
  if (!locationHeader) {
    throw new Error("TUS create did not return a Location header");
  }
  // Location bazen relative olabilir, absolute'e çevir
  const uploadUrl = /^https?:\/\//.test(locationHeader)
    ? locationHeader
    : new URL(locationHeader, SUPABASE_URL).toString();

  console.log(`📤 [VIDEO-V2] TUS upload URL acquired, streaming chunks…`);

  // 2) Dosyayı 6MB'lık chunk'lar halinde PATCH et
  const CHUNK_SIZE = 6 * 1024 * 1024;
  let offset = 0;
  let lastLogPct = -10;

  while (offset < fileSize) {
    const chunkEnd = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunkLen = chunkEnd - offset;

    // Disk'ten chunk oku (file handle üzerinden)
    const chunkBuffer = Buffer.alloc(chunkLen);
    const fd = await fs.promises.open(filePath, "r");
    try {
      await fd.read(chunkBuffer, 0, chunkLen, offset);
    } finally {
      await fd.close();
    }

    const patchRes = await fetch(uploadUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
        "Content-Length": String(chunkLen),
      },
      body: chunkBuffer,
    });

    if (!patchRes.ok) {
      const body = await patchRes.text().catch(() => "");
      throw new Error(
        `TUS PATCH failed at offset ${offset}: ${patchRes.status} — ${body}`
      );
    }

    const newOffset = parseInt(
      patchRes.headers.get("upload-offset") || String(chunkEnd),
      10
    );
    offset = newOffset;

    const pct = Math.floor((offset / fileSize) * 100);
    if (pct - lastLogPct >= 10 || offset >= fileSize) {
      console.log(
        `📤 [VIDEO-V2] TUS progress ${pct}% (${(offset / 1024 / 1024).toFixed(1)} / ${sizeMb} MB)`
      );
      lastLogPct = pct;
    }
  }

  const upMs = Date.now() - startUp;
  console.log(`📤 [VIDEO-V2] TUS upload completed in ${upMs}ms`);

  // 3) Public URL oluştur (bucket public olduğu için path üzerinden)
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
  return publicUrl;
}

async function persistFalVideoToSupabase(videoUrl, userId, generationId) {
  if (!videoUrl || !userId || !generationId) {
    return videoUrl;
  }

  // Zaten Supabase URL'iyse tekrar yükleme
  if (/\/storage\/v1\/object\/public\/user_videos\//.test(videoUrl)) {
    return videoUrl;
  }

  // Paralel çağrı koruması: aynı generationId için devam eden bir upload
  // varsa yenisini başlatma, mevcut Promise'i bekle.
  if (videoPersistenceInflight.has(generationId)) {
    return videoPersistenceInflight.get(generationId);
  }

  const client = supabaseAdmin || supabase;
  if (!supabaseAdmin) {
    console.warn(
      "⚠️ [VIDEO-V2] SUPABASE_SERVICE_ROLE_KEY yok, anon client kullanılıyor — RLS sorun çıkarabilir."
    );
  }

  const task = (async () => {
    const startOverall = Date.now();
    const tmpFilePath = path.join(
      os.tmpdir(),
      `fal-video-${generationId}.mp4`
    );
    try {
      // 1) fal.ai'den STREAM download — 100MB+ buffer'ı memory'e yüklemiyoruz,
      //    direkt disk'e yazıyoruz.
      console.log(`📥 [VIDEO-V2] Streaming fal.ai video to temp file…`);
      const startDl = Date.now();
      const response = await axios.get(videoUrl, {
        responseType: "stream",
        timeout: 300000, // 5 dk
      });
      const contentType = response.headers?.["content-type"] || "video/mp4";

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tmpFilePath);
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
      });

      const stats = fs.statSync(tmpFilePath);
      const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
      const dlMs = Date.now() - startDl;
      console.log(
        `✅ [VIDEO-V2] Downloaded ${sizeMb} MB in ${dlMs}ms → ${tmpFilePath}`
      );

      const objectPath = `${userId}/${generationId}.mp4`;
      // 10MB üstü → TUS resumable (memory-safe, chunked)
      // 10MB altı → tek POST (daha hızlı, supabase-js client)
      const TUS_THRESHOLD = 10 * 1024 * 1024;
      let publicUrl;
      if (stats.size > TUS_THRESHOLD) {
        console.log(
          `📦 [VIDEO-V2] File > 10MB → using TUS resumable upload`
        );
        publicUrl = await tusUploadFileToSupabase({
          filePath: tmpFilePath,
          fileSize: stats.size,
          bucket: "user_videos",
          objectPath,
          contentType,
          generationId,
          sizeMb,
        });
      } else {
        console.log(
          `📦 [VIDEO-V2] File ≤ 10MB → using direct supabase-js upload`
        );
        const startUp = Date.now();
        const fileBuffer = await fs.promises.readFile(tmpFilePath);
        const { error: uploadError } = await client.storage
          .from("user_videos")
          .upload(objectPath, fileBuffer, {
            contentType,
            upsert: true,
            cacheControl: "31536000",
          });
        if (uploadError) {
          throw new Error(
            `Supabase direct upload failed: ${uploadError.message}`
          );
        }
        const upMs = Date.now() - startUp;
        console.log(
          `📤 [VIDEO-V2] Direct upload completed in ${upMs}ms`
        );
        const { data: publicUrlData } = await client.storage
          .from("user_videos")
          .getPublicUrl(objectPath);
        publicUrl = publicUrlData?.publicUrl;
        if (!publicUrl) {
          throw new Error("Supabase did not return a public URL");
        }
      }

      const totalMs = Date.now() - startOverall;
      console.log(
        `✅ [VIDEO-V2] Persisted to Supabase in ${totalMs}ms: ${publicUrl}`
      );
      return publicUrl;
    } catch (err) {
      const totalMs = Date.now() - startOverall;
      console.error(
        `❌ [VIDEO-V2] Failed to persist video to Supabase after ${totalMs}ms (falling back to fal.ai URL):`,
        err?.message || err
      );
      if (err?.stack) {
        console.error(err.stack);
      }
      return videoUrl;
    } finally {
      // Temp file cleanup
      fs.promises.unlink(tmpFilePath).catch(() => {});
      videoPersistenceInflight.delete(generationId);
    }
  })();

  videoPersistenceInflight.set(generationId, task);
  return task;
}

function getCreditCost(duration, resolution = "720p") {
  let baseCost;

  switch (Number(duration)) {
    case 5:
      baseCost = 200;
      break;
    case 8:
      baseCost = 225;
      break;
    case 10:
      baseCost = 250;
      break;
    default:
      baseCost = 250;
      break;
  }

  return resolution === "1080p" ? baseCost + 40 : baseCost;
}

function normalizeDuration(duration) {
  const parsedDuration = Number(duration);
  if ([5, 8, 10].includes(parsedDuration)) {
    return parsedDuration;
  }

  return 10;
}

function normalizeResolution(resolution) {
  return resolution === "1080p" ? "1080p" : "720p";
}

function normalizeAspectRatio(aspectRatio) {
  const allowedAspectRatios = new Set(["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  return allowedAspectRatios.has(aspectRatio) ? aspectRatio : "9:16";
}

function extractVideoUrl(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return (
    payload?.data?.video?.url ||
    payload?.video?.url ||
    payload?.data?.video_url ||
    payload?.video_url ||
    payload?.data?.output?.video?.url ||
    (Array.isArray(payload?.data?.videos) ? payload.data.videos[0]?.url : null) ||
    (Array.isArray(payload?.videos) ? payload.videos[0]?.url : null) ||
    null
  );
}

async function submitSeedanceGeneration({
  imageUrl,
  prompt,
  duration,
  aspectRatio,
  resolution,
  endUserId,
  endImageUrl,
}) {
  const requestBody = {
    prompt,
    image_url: imageUrl,
    duration: String(duration),
    aspect_ratio: aspectRatio,
    resolution,
    generate_audio: false,
    end_user_id: endUserId,
  };

  // Arka görünüm (end_image_url) varsa ekle — video bu frame'e doğru geçiş yapar.
  if (endImageUrl) {
    requestBody.end_image_url = endImageUrl;
  }

  console.log("🎬 [VIDEO-V2] Submitting to Seedance 2.0:", JSON.stringify(requestBody, null, 2));

  const { request_id: requestId } = await fal.queue.submit(SEEDANCE_MODEL_ID, {
    input: requestBody,
    webhookUrl: null,
  });

  if (!requestId) {
    throw new Error("fal.ai did not return a request_id");
  }

  return requestId;
}

// 🧩 Auto-grid pipeline: kullanıcı önizleme yapmadığında çağrılır.
// Sırayla:
//   1) nano-banana-2 ile 6-sahneli storyboard grid üretir (orijinal foto'dan)
//   2) Üretilen grid URL'ini DB'de original_image_url olarak persist eder
//   3) Grid-aware enhanced prompt üretir
//   4) Seedance'a grid resmiyle submit eder, fal_request_id'i DB'ye yazar
//   5) Mevcut startBackgroundProgression worker'ını başlatır (polling)
// Grid hata verirse orijinal foto ile fallback yapar (video iptal olmaz).
async function runGridThenSeedance(generationId, params) {
  const {
    userId,
    originalImageUrl,
    backImageUrl,
    userPrompt,
    normalizedDuration,
    normalizedAspectRatio,
    normalizedResolution,
    editMode,
  } = params;

  try {
    // 1) Grid üretimi (orijinal foto + opsiyonel kullanıcı promptu)
    const gridResult = await generateVideoGridPreview({
      supabase,
      sourceUrl: originalImageUrl,
      userPrompt,
      logTag: `VIDEO-V2-GRID ${generationId}`,
    });

    let videoSourceUrl = originalImageUrl;
    let isGridApplied = false;

    if (gridResult.success && gridResult.gridUrl) {
      videoSourceUrl = gridResult.gridUrl;
      isGridApplied = true;
      // 2) Grid URL'i DB'ye yaz — client polling original_image_url'i grid olarak görür
      await supabase
        .from("video_generations")
        .update({
          original_image_url: gridResult.gridUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationId);
      console.log(
        `✅ [VIDEO-V2-GRID] ${generationId} grid hazır, video pipeline başlıyor`,
      );
    } else {
      console.warn(
        `⚠️ [VIDEO-V2-GRID] ${generationId} grid başarısız (${gridResult.error}), orijinal foto ile devam`,
      );
    }

    // 3) Grid-aware enhanced prompt
    const enhancedPrompt = await generateVideoPrompt(
      videoSourceUrl,
      userPrompt,
      editMode,
      !!backImageUrl,
      isGridApplied,
    );

    // 4) Seedance submit
    const requestId = await submitSeedanceGeneration({
      imageUrl: videoSourceUrl,
      prompt: enhancedPrompt,
      duration: normalizedDuration,
      aspectRatio: normalizedAspectRatio,
      resolution: normalizedResolution,
      endUserId: String(userId),
      endImageUrl: backImageUrl,
    });

    console.log(`✅ [VIDEO-V2-GRID] ${generationId} Seedance request id: ${requestId}`);

    await supabase
      .from("video_generations")
      .update({
        fal_request_id: requestId,
        enhanced_prompt: enhancedPrompt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", generationId);

    // predictions row — Seedance request_id ile insert
    try {
      await supabase.from("predictions").insert({
        id: uuidv4(),
        user_id: userId,
        product_id: generationId,
        prediction_id: requestId,
        categories: "videos",
      });
    } catch (predErr) {
      console.warn(
        `⚠️ [VIDEO-V2-GRID] ${generationId} predictions insert hata:`,
        predErr?.message,
      );
    }

    // 5) Polling worker
    startBackgroundProgression(generationId);
  } catch (err) {
    console.error(
      `❌ [VIDEO-V2-GRID] ${generationId} pipeline failed:`,
      err?.message,
    );

    // Generation'ı failed olarak işaretle + krediyi iade et
    try {
      await supabase
        .from("video_generations")
        .update({
          status: "failed",
          error_message: err?.message || "Grid+Seedance pipeline failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationId);
    } catch (dbErr) {
      console.error(
        `❌ [VIDEO-V2-GRID] ${generationId} DB update hata:`,
        dbErr?.message,
      );
    }

    if (params.refundUserId && params.creditCost > 0) {
      try {
        const { data: currentUser } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", params.refundUserId)
          .single();
        if (currentUser) {
          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUser.credit_balance || 0) + params.creditCost,
            })
            .eq("id", params.refundUserId);
          console.log(
            `💰 [VIDEO-V2-GRID] ${generationId} ${params.creditCost} credits refunded to ${params.refundUserId}`,
          );
        }
      } catch (refundErr) {
        console.error(
          `❌ [VIDEO-V2-GRID] ${generationId} refund hata:`,
          refundErr?.message,
        );
      }
    }
  }
}

router.post("/generateImgToVidv2", async (req, res) => {
  let effectiveUserId = null;
  let creditCost = 0;

  try {
    const {
      userId,
      first_frame_image,
      back_image = null,
      prompt,
      duration = 10,
      resolution = "720p",
      aspect_ratio = "9:16",
      editMode = false,
      isGridPreview = false, // 🧩 Storyboard grid mod (input = 6-scene grid)
    } = req.body;

    if (!userId || !first_frame_image) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId and first_frame_image",
      });
    }

    // Trial-tier cap: 2 videos max per trial window. Enforced before any
    // credit deduction or Seedance dispatch so blocked requests cost nothing.
    const trialBlock = await enforceTrialVideoLimit({ supabase, userId });
    if (trialBlock) {
      return res.status(trialBlock.status).json(trialBlock.payload);
    }
    await incrementTrialVideoCount({ supabase, userId });

    const normalizedDuration = normalizeDuration(duration);
    const normalizedResolution = normalizeResolution(resolution);
    const normalizedAspectRatio = normalizeAspectRatio(aspect_ratio);

    creditCost = getCreditCost(normalizedDuration, normalizedResolution);
    effectiveUserId = userId;

    let effectiveCreditBalance = 0;
    let isTeamCredit = false;

    try {
      const effectiveCredits = await teamService.getEffectiveCredits(userId);
      effectiveCreditBalance = effectiveCredits.creditBalance || 0;
      isTeamCredit = effectiveCredits.isTeamCredit || false;

      if (isTeamCredit && effectiveCredits.creditOwnerId) {
        effectiveUserId = effectiveCredits.creditOwnerId;
        console.log(`👥 [VIDEO-V2] Team member - using owner credits (${effectiveUserId})`);
      }
    } catch (teamError) {
      console.log("⚠️ [VIDEO-V2] Team check failed, fallback:", teamError.message);
      const { data: userData } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();
      effectiveCreditBalance = userData?.credit_balance || 0;
    }

    if (effectiveCreditBalance < creditCost) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Required: ${creditCost}, Available: ${effectiveCreditBalance}`,
      });
    }

    const { error: creditError } = await supabase
      .from("users")
      .update({ credit_balance: effectiveCreditBalance - creditCost })
      .eq("id", effectiveUserId);

    if (creditError) {
      return res.status(500).json({ success: false, message: "Failed to deduct credits" });
    }

    console.log(`✅ [VIDEO-V2] ${creditCost} credits deducted from ${effectiveUserId}`);

    let imageUrl = first_frame_image;
    if (first_frame_image.startsWith("data:image/")) {
      imageUrl = await uploadImageToSupabase(first_frame_image);
    }

    // Arka görünüm opsiyonel — varsa Supabase'e yüklenir, Seedance'a
    // end_image_url olarak verilir
    let backImageUrl = null;
    if (back_image && typeof back_image === "string") {
      if (back_image.startsWith("data:image/")) {
        try {
          backImageUrl = await uploadImageToSupabase(back_image);
          console.log(
            "🔙 [VIDEO-V2] Back image uploaded:",
            backImageUrl
          );
        } catch (err) {
          console.error(
            "⚠️ [VIDEO-V2] Back image upload failed (continuing without it):",
            err?.message
          );
        }
      } else if (back_image.startsWith("http")) {
        backImageUrl = back_image;
      }
    }

    const userPrompt =
      prompt ||
      "Model highlights special details of the outfit, smiling while gently turning left and right to showcase product details from both sides.";

    // 🧩 Akış ayrımı:
    //   isGridPreview=true  → client zaten grid'i first_frame_image olarak gönderdi
    //                          (kullanıcı "Önizle" butonuna basmış); grid üretimi
    //                          atlanır, doğrudan Seedance.
    //   isGridPreview=false → kullanıcı önizlemedi; arka planda nano-banana ile
    //                          grid üretilir, sonra Seedance grid'i first_frame
    //                          olarak alır. HTTP yanıtı hemen 202 döner;
    //                          tüm pipeline runGridThenSeedance içinde.
    if (!isGridPreview) {
      const generationId = uuidv4();
      const insertPayload = {
        id: generationId,
        user_id: userId,
        fal_request_id: null, // grid + seedance bittikten sonra set edilir
        status: "processing",
        original_image_url: imageUrl, // önce orijinal foto, grid hazır olunca güncellenecek
        user_prompt: userPrompt,
        enhanced_prompt: null,
        duration: normalizedDuration,
        aspect_ratio: normalizedAspectRatio,
        resolution: normalizedResolution,
        credits_used: creditCost,
      };
      if (backImageUrl) insertPayload.back_image_url = backImageUrl;

      let { error: insertError } = await supabase
        .from("video_generations")
        .insert(insertPayload);

      if (
        insertError &&
        /back_image_url/i.test(insertError.message || "") &&
        insertPayload.back_image_url
      ) {
        console.warn(
          "⚠️ [VIDEO-V2] back_image_url column missing — inserting without it"
        );
        delete insertPayload.back_image_url;
        const retryInsert = await supabase
          .from("video_generations")
          .insert(insertPayload);
        insertError = retryInsert.error;
      }

      if (insertError) {
        console.error("❌ [VIDEO-V2] DB insert error:", insertError);
        throw insertError;
      }

      // Fire-and-forget — client'ın HTTP isteği 30-60s nano-banana çağrısını
      // beklemesin diye 202 hemen dönülür, pipeline arka planda çalışır.
      runGridThenSeedance(generationId, {
        userId,
        originalImageUrl: imageUrl,
        backImageUrl,
        userPrompt,
        normalizedDuration,
        normalizedAspectRatio,
        normalizedResolution,
        editMode,
        refundUserId: effectiveUserId,
        creditCost,
      }).catch((bgErr) => {
        console.error(
          `❌ [VIDEO-V2] runGridThenSeedance unhandled rejection (${generationId}):`,
          bgErr?.message,
        );
      });

      return res.status(202).json({
        success: true,
        message: "Video generation started (grid preview pipeline)",
        generationId,
        predictionId: null,
      });
    }

    // 🧩 isGridPreview=true: client'ın gönderdiği grid'i kullan, mevcut akış
    const enhancedPrompt = await generateVideoPrompt(
      imageUrl,
      userPrompt,
      editMode,
      !!backImageUrl,
      !!isGridPreview
    );

    const requestId = await submitSeedanceGeneration({
      imageUrl,
      prompt: enhancedPrompt,
      duration: normalizedDuration,
      aspectRatio: normalizedAspectRatio,
      resolution: normalizedResolution,
      endUserId: String(userId),
      endImageUrl: backImageUrl,
    });

    console.log(`✅ [VIDEO-V2] Seedance request id: ${requestId}`);

    const generationId = uuidv4();
    const insertPayload = {
      id: generationId,
      user_id: userId,
      fal_request_id: requestId,
      status: "processing",
      original_image_url: imageUrl,
      user_prompt: userPrompt,
      enhanced_prompt: enhancedPrompt,
      duration: normalizedDuration,
      aspect_ratio: normalizedAspectRatio,
      resolution: normalizedResolution,
      credits_used: creditCost,
    };
    if (backImageUrl) {
      insertPayload.back_image_url = backImageUrl;
    }
    let { error: insertError } = await supabase
      .from("video_generations")
      .insert(insertPayload);

    // back_image_url kolonu yoksa insert fail edebilir — fallback: kolon olmadan tekrar dene
    if (
      insertError &&
      /back_image_url/i.test(insertError.message || "") &&
      insertPayload.back_image_url
    ) {
      console.warn(
        "⚠️ [VIDEO-V2] back_image_url column missing — inserting without it (retry won't persist back image)"
      );
      delete insertPayload.back_image_url;
      const retryInsert = await supabase
        .from("video_generations")
        .insert(insertPayload);
      insertError = retryInsert.error;
    }

    if (insertError) {
      console.error("❌ [VIDEO-V2] DB insert error:", insertError);
      throw insertError;
    }

    await supabase.from("predictions").insert({
      id: uuidv4(),
      user_id: userId,
      product_id: generationId,
      prediction_id: requestId,
      categories: "videos",
    });

    // 🧵 Fire-and-forget background worker — client modalı kapatsa bile
    // fal.ai sonucu otomatik çekilip Supabase'e persist edilir, DB completed olur.
    startBackgroundProgression(generationId);

    return res.status(202).json({
      success: true,
      message: "Video generation started",
      generationId,
      predictionId: requestId,
    });
  } catch (error) {
    console.error("❌ [VIDEO-V2] Generation error:", error.message);

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
          console.log(`💰 [VIDEO-V2] ${creditCost} credits refunded to ${effectiveUserId}`);
        }
      } catch (refundError) {
        console.error("❌ [VIDEO-V2] Credit refund failed:", refundError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Video generation failed",
      error: error.message,
    });
  }
});

router.get("/videoStatusV2/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    const { data: generation, error: dbError } = await supabase
      .from("video_generations")
      .select("*")
      .eq("id", generationId)
      .single();

    if (dbError || !generation) {
      return res.status(404).json({ success: false, message: "Generation not found" });
    }

    if (generation.status === "completed" || generation.status === "failed") {
      return res.status(200).json({
        success: true,
        status: generation.status,
        videoUrl: generation.result_video_url,
        generation,
      });
    }

    // 🧩 Grid + Seedance pipeline: fal_request_id henüz set edilmemişse
    // arka planda nano-banana grid üretimi devam ediyordur. Client'a
    // "processing" döndür; fal API'sini boş requestId ile çağırma.
    if (!generation.fal_request_id) {
      return res.status(200).json({
        success: true,
        status: "processing",
        videoUrl: null,
        generation,
      });
    }

    // 🧵 Server restart sonrası in-memory worker kayboluyor. Processing durumundaki
    // video için client polling tetiklendiğinde worker'ı yeniden başlat (idempotent dedup).
    startBackgroundProgression(generationId);

    let status = "processing";
    let videoUrl = null;
    let errorMessage = null;

    try {
      const falStatus = await fal.queue.status(SEEDANCE_MODEL_ID, {
        requestId: generation.fal_request_id,
        logs: true,
      });

      console.log(
        `🔎 [VIDEO-V2] Seedance status for ${generation.fal_request_id}:`,
        falStatus.status
      );

      if (falStatus.status === "IN_QUEUE" || falStatus.status === "IN_PROGRESS") {
        status = "processing";
      } else if (falStatus.status === "COMPLETED") {
        // Eğer DB'de zaten Supabase URL varsa tekrar fal.ai'den çekmeye veya
        // yeniden yüklemeye gerek yok — idempotent kısa devre.
        if (
          generation.result_video_url &&
          /\/storage\/v1\/object\/public\/user_videos\//.test(
            generation.result_video_url
          )
        ) {
          videoUrl = generation.result_video_url;
          status = "completed";
          console.log(
            "✅ [VIDEO-V2] Already persisted to Supabase — reusing URL:",
            videoUrl
          );
        } else {
          const finalResult = await fal.queue.result(SEEDANCE_MODEL_ID, {
            requestId: generation.fal_request_id,
          });

          videoUrl = extractVideoUrl(finalResult);
          if (videoUrl) {
            status = "completed";
            console.log("✅ [VIDEO-V2] Video URL from fal.ai:", videoUrl);

            // Videoyu kalıcı olarak Supabase'e al — küçük dosyalar olduğu için
            // bunu senkron bekliyoruz, client doğrudan Supabase URL'i alır.
            videoUrl = await persistFalVideoToSupabase(
              videoUrl,
              generation.user_id,
              generationId
            );
          } else {
            status = "failed";
            errorMessage = "No video output in result";
          }
        }
      } else if (falStatus.status === "FAILED") {
        status = "failed";
        errorMessage =
          falStatus.error ||
          falStatus?.logs?.map((log) => log.message).filter(Boolean).join(" | ") ||
          "fal.ai generation failed";
      } else {
        status = "processing";
      }
    } catch (pollError) {
      console.error("❌ [VIDEO-V2] Polling error:", pollError.message);
      status = "failed";
      errorMessage = pollError.message || "fal.ai polling error";
    }

    const MAX_RETRIES = 3;
    const errStr = typeof errorMessage === "string" ? errorMessage : "";
    const isRetryableError =
      errStr.toLowerCase().includes("timeout") ||
      errStr.toLowerCase().includes("network") ||
      errStr.toLowerCase().includes("connection") ||
      errStr.toLowerCase().includes("temporar") ||
      errStr.toLowerCase().includes("unavailable") ||
      errStr.toLowerCase().includes("internal") ||
      errStr.toLowerCase().includes("gateway") ||
      errStr === "";

    if (status === "failed" && isRetryableError) {
      const existingMsg = generation.error_message || "";
      const retryMatch = existingMsg.match(/^RETRY:(\d+):/);
      const retryCount = retryMatch ? parseInt(retryMatch[1], 10) : 0;

      if (retryCount < MAX_RETRIES) {
        const nextRetry = retryCount + 1;
        console.log(`🔄 [VIDEO-V2] Retrying Seedance request (${nextRetry}/${MAX_RETRIES})`);

        try {
          const newRequestId = await submitSeedanceGeneration({
            imageUrl: generation.original_image_url,
            prompt: generation.enhanced_prompt || generation.user_prompt,
            duration: normalizeDuration(generation.duration),
            aspectRatio: normalizeAspectRatio(generation.aspect_ratio),
            resolution: normalizeResolution(generation.resolution),
            endUserId: String(generation.user_id),
            endImageUrl: generation.back_image_url || null,
          });

          await supabase
            .from("video_generations")
            .update({
              fal_request_id: newRequestId,
              status: "processing",
              error_message: `RETRY:${nextRetry}:${errorMessage}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", generationId);

          // 🧵 Retry sonrası background worker'ı yeniden başlat (client polling'inden bağımsız)
          startBackgroundProgression(generationId);

          return res.status(200).json({
            success: true,
            status: "processing",
            videoUrl: null,
            generation: { ...generation, status: "processing" },
          });
        } catch (retryError) {
          console.error("❌ [VIDEO-V2] Retry submission failed:", retryError.message);
          errorMessage = retryError.message;
        }
      } else {
        errorMessage = errorMessage.replace(/^RETRY:\d+:/, "");
      }
    }

    const processingTime = Math.round(
      (Date.now() - new Date(generation.created_at).getTime()) / 1000
    );
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "completed") {
      updateData.result_video_url = videoUrl;
      updateData.processing_time_seconds = processingTime;
    } else if (status === "failed") {
      updateData.error_message = errorMessage;

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
              .update({
                credit_balance: (currentUser.credit_balance || 0) + generation.credits_used,
              })
              .eq("id", generation.user_id);

            console.log(
              `💰 [VIDEO-V2] ${generation.credits_used} credits refunded to ${generation.user_id}`
            );
            updateData.credits_used = 0;
          }
        } catch (refundError) {
          console.error("❌ [VIDEO-V2] Credit refund failed:", refundError.message);
        }
      }
    }

    await supabase.from("video_generations").update(updateData).eq("id", generationId);

    return res.status(200).json({
      success: true,
      status,
      videoUrl,
      generation: { ...generation, ...updateData },
    });
  } catch (error) {
    console.error("❌ [VIDEO-V2] Status error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/videoGenerationsV2/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = 20 } = req.query;

    let query = supabase
      .from("video_generations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(parseInt(limit, 10));

    if (status) {
      const statuses = status
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (statuses.length > 1) {
        query = query.in("status", statuses);
      } else if (statuses.length === 1) {
        query = query.eq("status", statuses[0]);
      }
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        message: "DB error",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("❌ [VIDEO-V2] List error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
