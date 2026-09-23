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
const {
  sanitizeBrief,
  isReferenceMode,
  identityClause,
  buildCommerceGeminiPrompt,
  buildCommerceFallbackPrompt,
} = require("../utils/commerceVideoPrompt");
const {
  SKILLS: VIDEO_SKILLS,
  sanitizeSkill,
  buildSkillGeminiPrompt,
  buildSkillFallbackPrompt,
  skillIdentityClause,
  skillStyleSuffix,
} = require("../utils/videoSkillPrompt");
const {
  enforceTrialVideoLimit,
  incrementTrialVideoCount,
} = require("../utils/trialVideoLimit");
const { callGeminiFlash } = require("../utils/promptEnhanceProvider");
const {
  evaluatePrompt: evaluateSafetyPrompt,
  hardenPrompt: hardenSafetyPrompt,
  SAFETY_SYSTEM_PROMPT,
} = require("../utils/nudityGuard");

fal.config({
  credentials: process.env.FAL_API_KEY,
});

const SEEDANCE_MODEL_ID = "bytedance/seedance-2.0/enterprise/image-to-video";
// 🛍️ E-ticaret "yeni sahne" modu (22 Eyl 2026): fotoğraf yalnız ürün referansı.
// Aynı fal uygulaması (bytedance/seedance-2.0) → queue status/result çağrıları
// SEEDANCE_MODEL_ID ile ortak çalışır; fiyat image-to-video ile aynı.
const SEEDANCE_REF_MODEL_ID = "bytedance/seedance-2.0/enterprise/reference-to-video";
// Referans modunda Seedance promptu her zaman @Image1 içerir → retry doğru modu bununla seçer
const isReferencePrompt = (prompt) => typeof prompt === "string" && prompt.includes("@Image1");
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 5) {
  // Prompt enhance artık merkezi dispatcher'a yönleniyor (app_config: gemini/replicate)
  return callGeminiFlash(prompt, imageUrls, maxRetries);
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

async function generateVideoPrompt(
  imageUrl,
  userPrompt,
  editMode = false,
  hasBackImage = false,
  brief = null
) {
  // 🛍️ Yeni client'lar brief gönderir → genel e-ticaret yönetmeni şablonu
  if (brief) {
    const clause = identityClause(brief, hasBackImage);
    try {
      const imageUrls = imageUrl && imageUrl.startsWith("http") ? [imageUrl] : [];
      const enhanced = await callReplicateGeminiFlash(buildCommerceGeminiPrompt(brief, userPrompt, hasBackImage), imageUrls, 3);
      console.log("🛍️ [VIDEO-V2] Commerce prompt:", `${String(enhanced).substring(0, 100)}...`);
      return `${String(enhanced).trim()} ${clause}`;
    } catch (error) {
      console.error("❌ [VIDEO-V2] Commerce prompt enhancement failed:", error.message);
      return `${buildCommerceFallbackPrompt(brief, userPrompt)} ${clause}`;
    }
  }
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

    // Eski (brief'siz) client'lar: moda kampanya şablonu
    const promptForGemini = `
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
    const enhancedPrompt = await callReplicateGeminiFlash(promptForGemini, imageUrls, 3);

    console.log("🎬 [VIDEO-V2] Enhanced prompt:", `${enhancedPrompt.substring(0, 100)}...`);

    return enhancedPrompt;
  } catch (error) {
    console.error("❌ [VIDEO-V2] Prompt enhancement failed:", error.message);
    const fallback = buildFallbackVideoPrompt(userPrompt);
    console.log("🛟 [VIDEO-V2] Using fallback fashion-clip template prompt");
    return fallback;
  }
}

/** 🎬 Video stüdyosu kartı → Gemini yönetmen talimatı (+ sabit ürün kimliği kuralı) */
async function generateSkillPrompt(skillBrief, imageUrls, ctx) {
  // Kalite kilidi (kart örneklerinin stil bloğu) + ürün kimliği kuralı her zaman sonda
  const clause = `${skillStyleSuffix(skillBrief)} ${skillIdentityClause(skillBrief, ctx.imageCount)}`;
  try {
    const visionUrls = (imageUrls || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
    const enhanced = await callReplicateGeminiFlash(buildSkillGeminiPrompt(skillBrief, ctx), visionUrls, 3);
    console.log("🎬 [VIDEO-SKILL] prompt:", `${String(enhanced).substring(0, 100)}...`);
    return `${String(enhanced).trim()} ${clause}`;
  } catch (error) {
    console.error("❌ [VIDEO-SKILL] prompt enhancement failed:", error.message);
    return `${buildSkillFallbackPrompt(skillBrief, ctx)} ${clause}`;
  }
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

// Video kredi maliyetleri UZAKTAN yönetilir: app_config.metadata.video_credits
// ("5"/"8"/"10" saniye bazları + "hd_surcharge" 1080p ek ücreti). 60 sn'lik
// in-memory cache ile her istekte DB'ye gidilmez; config okunamazsa ya da
// migration'sız ortamda DEFAULT tablo devreye girer (mevcut fiyatlar).
// 15 sn (23 Eyl 2026, kullanıcı kararı): 450 kredi; ses fal'da ek ücretsiz → fiyatı değiştirmez
const DEFAULT_VIDEO_CREDITS = { 5: 300, 8: 340, 10: 375, 15: 450, hd_surcharge: 60 };
let _videoCreditCache = { cfg: { ...DEFAULT_VIDEO_CREDITS }, at: 0 };

async function getVideoCreditConfig() {
  if (Date.now() - _videoCreditCache.at < 60_000) return _videoCreditCache.cfg;
  try {
    const { data } = await supabase
      .from("app_config")
      .select("metadata")
      .eq("platform", "ios") // video fiyatı platform bağımsız; ios satırı kanonik kaynak
      .maybeSingle();
    const raw = data?.metadata?.video_credits;
    const cfg = { ...DEFAULT_VIDEO_CREDITS };
    if (raw && typeof raw === "object") {
      for (const key of ["5", "8", "10", "15", "hd_surcharge"]) {
        const value = Number(raw[key]);
        if (Number.isFinite(value) && value >= 0) cfg[key] = value;
      }
    }
    _videoCreditCache = { cfg, at: Date.now() };
  } catch (err) {
    console.warn(
      "⚠️ [VIDEO-V2] video_credits config okunamadı, cache/default kullanılıyor:",
      err?.message || err,
    );
    _videoCreditCache.at = Date.now(); // hata döngüsünde DB'yi dövme
  }
  return _videoCreditCache.cfg;
}

function getCreditCost(duration, resolution = "720p", cfg = DEFAULT_VIDEO_CREDITS) {
  const baseCost =
    Number(cfg[Number(duration)]) || Number(cfg[10]) || DEFAULT_VIDEO_CREDITS[10];
  const surcharge = Number(cfg.hd_surcharge);
  return resolution === "1080p"
    ? baseCost + (Number.isFinite(surcharge) ? surcharge : 40)
    : baseCost;
}

function normalizeDuration(duration) {
  const parsedDuration = Number(duration);
  if ([5, 8, 10, 15].includes(parsedDuration)) {
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
  referenceMode = isReferencePrompt(prompt),
  imageUrls = null, // 🎬 video stüdyosu: tüm ürün görselleri (@Image1..N)
  videoUrls = null, // 🎬 remix: referans video (@Video1)
  generateAudio = false, // 🔊 fal'da ek ücretsiz; sesli kartlarda açık
}) {
  const requestBody = {
    prompt,
    duration: String(duration),
    aspect_ratio: aspectRatio,
    resolution,
    generate_audio: !!generateAudio,
    end_user_id: endUserId,
  };

  if (referenceMode) {
    // 🛍️ Ürün referansı (+ varsa ikinci açı @Image2); sahne yeniden kurulur
    requestBody.image_urls = Array.isArray(imageUrls) && imageUrls.length ? imageUrls.slice(0, 9) : [imageUrl, endImageUrl].filter(Boolean);
    if (Array.isArray(videoUrls) && videoUrls.length) requestBody.video_urls = videoUrls.slice(0, 3);
  } else {
    requestBody.image_url = imageUrl;
    // İkinci görsel (end_image_url) varsa ekle — video bu kareye doğru geçiş yapar.
    if (endImageUrl) {
      requestBody.end_image_url = endImageUrl;
    }
  }

  console.log("🎬 [VIDEO-V2] Submitting to Seedance 2.0:", JSON.stringify(requestBody, null, 2));

  const { request_id: requestId } = await fal.queue.submit(referenceMode ? SEEDANCE_REF_MODEL_ID : SEEDANCE_MODEL_ID, {
    input: requestBody,
    webhookUrl: null,
  });

  if (!requestId) {
    throw new Error("fal.ai did not return a request_id");
  }

  return requestId;
}

router.post("/generateImgToVidv2", async (req, res) => {
  let effectiveUserId = null;
  let creditCost = 0;

  try {
    let {
      userId,
      first_frame_image,
      back_image = null,
      prompt,
      duration = 10,
      resolution = "720p",
      aspect_ratio = "9:16",
      editMode = false,
      brief: rawBrief = null, // 🛍️ e-ticaret brief'i (tür/sahne/kamera/insan) — yoksa eski moda akışı
      // 🎬 Video stüdyosu kartları (23 Eyl 2026): skill + girdiler, ek ürün görselleri, referans video, ses
      skill = null,
      skillInputs = null,
      product_images = null,
      reference_video_url = null,
      generate_audio = false,
    } = req.body;
    const brief = sanitizeBrief(rawBrief);
    const skillBrief = sanitizeSkill(skill, skillInputs);
    const referenceVideoUrl =
      typeof reference_video_url === "string" && /^https?:\/\//i.test(reference_video_url) ? reference_video_url : null;
    // Remix referans videosuz olmaz — kredi düşmeden ÖNCE reddet
    if (skillBrief?.skill === "remix" && !referenceVideoUrl) {
      return res.status(400).json({ success: false, message: "Reference video is required for Video Remix" });
    }

    if (!userId || !first_frame_image) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId and first_frame_image",
      });
    }

    // 🔒 İÇERİK GÜVENLİĞİ — SADECE test hesabı (nodselemen). Kredi düşmeden ÖNCE.
    // Çıplaklık/manipülasyon promptu → 400 (video üretilmez, kredi düşmez). Gerçek kullanıcılar ETKİLENMEZ.
    try {
      const safety = await evaluateSafetyPrompt(userId, prompt || "");
      if (safety.blocked) {
        console.log(
          `🔒 [SAFETY][VIDEO] Çıplaklık/manipülasyon promptu engellendi (test hesabı ${userId}): ${safety.reason}`,
        );
        return res.status(400).json({
          success: false,
          message:
            "Bu içerik güvenlik politikalarına aykırı olduğu için oluşturulamaz.",
        });
      }
      if (safety.isTestUser && prompt && prompt.trim()) {
        prompt = `${SAFETY_SYSTEM_PROMPT}\n\n---\n${hardenSafetyPrompt(prompt)}`;
        console.log(
          `🔒 [SAFETY][VIDEO] Test hesabı ${userId}: prompt sertleştirildi + system prompt eklendi.`,
        );
      }
    } catch (safetyErr) {
      console.log(
        "⚠️ [SAFETY][VIDEO] Guard çalışmadı (devam ediliyor):",
        safetyErr?.message || safetyErr,
      );
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

    creditCost = getCreditCost(
      normalizedDuration,
      normalizedResolution,
      await getVideoCreditConfig(),
    );
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

    // 🎬 Video stüdyosu: ek ürün görselleri yüklenir (@Image2..N), toplam kart limitine kadar
    let skillImageUrls = null;
    if (skillBrief) {
      const extra = (Array.isArray(product_images) ? product_images : [])
        .filter((x) => typeof x === "string" && x.length > 0)
        .slice(0, VIDEO_SKILLS[skillBrief.skill].maxImages - 1);
      const uploaded = await Promise.all(extra.map(async (img) => {
        if (img.startsWith("data:image/")) {
          try { return await uploadImageToSupabase(img); } catch (err) { console.warn("⚠️ [VIDEO-SKILL] ek görsel yüklenemedi:", err?.message); return null; }
        }
        return /^https?:\/\//i.test(img) ? img : null;
      }));
      skillImageUrls = [imageUrl, ...uploaded.filter(Boolean)];
      console.log(`🎬 [VIDEO-SKILL] ${skillBrief.skill}: ${skillImageUrls.length} görsel${referenceVideoUrl ? " + referans video" : ""}${generate_audio ? " + ses" : ""}`);
    }

    const userPrompt =
      prompt ||
      (skillBrief ? [skillBrief.productName, skillBrief.sellingPoints, skillBrief.notes].filter(Boolean).join(" · ") : "") ||
      (brief
        ? ""
        : "Model highlights special details of the outfit, smiling while gently turning left and right to showcase product details from both sides.");

    // Storyboard grid akışı 22 Eyl 2026'da kaldırıldı: her istek doğrudan Seedance
    const enhancedPrompt = skillBrief
      ? await generateSkillPrompt(skillBrief, skillImageUrls, {
          audio: !!generate_audio,
          duration: normalizedDuration,
          imageCount: skillImageUrls.length,
        })
      : await generateVideoPrompt(
          imageUrl,
          userPrompt,
          editMode,
          !!backImageUrl,
          brief
        );

    const requestId = await submitSeedanceGeneration({
      imageUrl,
      prompt: enhancedPrompt,
      duration: normalizedDuration,
      aspectRatio: normalizedAspectRatio,
      resolution: normalizedResolution,
      endUserId: String(userId),
      endImageUrl: skillBrief ? null : backImageUrl,
      referenceMode: skillBrief ? true : isReferenceMode(brief),
      imageUrls: skillImageUrls,
      videoUrls: referenceVideoUrl ? [referenceVideoUrl] : null,
      generateAudio: skillBrief ? !!generate_audio : false,
    });

    console.log(`✅ [VIDEO-V2] Seedance request id: ${requestId}${isReferenceMode(brief) ? " (reference)" : ""}`);

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

    // fal_request_id yoksa (kaldırılan grid akışından kalma eski kayıt) fal'ı
    // boş requestId ile çağırma; "processing" döndür.
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

// 🧩 GERİYE UYUMLULUK (23 Eyl 2026): storyboard önizlemesi 22 Eyl'de kaldırıldı ve
// /api/videoPreviewGrid/* rotası silindi. Mağazadaki ESKİ uygulama sürümleri hâlâ
// "Önizleme" butonundan bu uçları çağırıyor; silinmiş rota Express'in HTML 404'ünü
// döndürdüğü için istemcide response.json() patlıyor ve kullanıcı hata görüyordu.
// Önizlemeyi geri getirmiyoruz (eski istemci ızgarayı ilk kare yapıp isGridPreview
// gönderirdi; yeni hat ızgarayı bir kolaj gibi canlandırırdı). Bunun yerine eski
// istemcinin anladığı biçimde düzgün JSON: generate → success:false + mesaj (eski
// istemci mesajı gösterir), status → failed + errorMessage. Kullanıcı "Oluştur" ile
// önizlemesiz devam eder. Yeni uygulamalar bu uçları çağırmaz.
const PREVIEW_REMOVED_MESSAGES = {
  tr: "Önizleme artık kullanılamıyor — videonu doğrudan oluşturabilirsin. En yeni özellikler için uygulamayı güncelle.",
  en: "Preview is no longer available — you can create your video directly. Update the app for the newest features.",
};
const previewRemovedMessage = (req) => {
  const lang = String(req.headers["accept-language"] || "").slice(0, 2).toLowerCase();
  return PREVIEW_REMOVED_MESSAGES[lang] || PREVIEW_REMOVED_MESSAGES.en;
};
router.post("/videoPreviewGrid/generate", (req, res) => {
  console.log(`🧩 [VIDEO-COMPAT] eski istemci önizleme istedi (kaldırıldı) user=${String(req.body?.userId || "-").slice(0, 8)}`);
  res.json({ success: false, deprecated: true, message: previewRemovedMessage(req) });
});
router.get("/videoPreviewGrid/status/:previewId", (req, res) => {
  res.json({ success: true, status: "failed", deprecated: true, errorMessage: previewRemovedMessage(req) });
});

module.exports = router;
