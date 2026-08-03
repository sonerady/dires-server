// Varyasyon ("Yeni Pozlar") üretimi
//
// Tamamlanmış bir sonucun aynı ürün + aynı manken kimliğiyle FARKLI POZLARINI üretir.
// Modele o üretime ait TÜM görseller gider: ürün fotoğrafları, stil/mekân referansları
// ve tamamlanmış sonuç. Sonuç, kaynağın altında ayrı bir panelde gösterilir.
//
// Kredi kuralı: bir kaynak görselin İLK varyasyonu ÜCRETSİZ, sonrakiler 10 kredi.
// İstemci 2. üretimde kullanıcıya onay sorar; sunucu yine de kendi sayımını yapar
// (istemciye güvenilmez) ve krediyi yalnız başarı anında düşer.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { fal } = require("@fal-ai/client");
const { v4: uuidv4 } = require("uuid");
const teamService = require("../services/teamService");
const logger = require("../utils/logger");
const { callGeminiFlash } = require("../utils/promptEnhanceProvider");
const {
  calculateVariationAccess,
  canStartFreeOnlyVariation,
  shouldStartAutomaticTrialVariation,
} = require("../utils/variationFlow");
const { persistVariationImage } = require("../utils/variationStorage");
const { optimizeForThumbnail } = require("../utils/imageOptimizer");

fal.config({ credentials: process.env.FAL_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Hız ve maliyet odaklı Nano Banana Lite edit modeli.
const VARIATION_MODEL = "google/nano-banana-lite/edit";
const VARIATION_MODEL_SETTINGS = {
  num_images: 1,
  output_format: "jpeg",
  limit_generations: true,
};
const FREE_FIRST_VARIATION = true;
const VARIATION_CREDIT_COST = 10;
const TRIAL_VARIATION_BATCH_LIMIT = 5;
const MAX_POLLS = 90; // ~3 dk (2 sn aralık)
const POLL_INTERVAL_MS = 2000;
const SUPPORTED_VARIATION_ASPECT_RATIOS = new Set([
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
]);

const normalizeVariationAspectRatio = (value) => {
  const normalized = String(value || "").trim();
  return SUPPORTED_VARIATION_ASPECT_RATIOS.has(normalized)
    ? normalized
    : null;
};

const getVariationModelSettings = (aspectRatio) => ({
  ...VARIATION_MODEL_SETTINGS,
  ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
});

// Gemini yaratıcı pozu/kadrajı seçer; referanstaki kimlik, ürün ve sahne
// bütünlüğü ise modele giden HER promptta backend tarafından zorunlu tutulur.
const VARIATION_PRESERVATION_SUFFIX =
  "Edit the provided reference image. Preserve the exact identity, face, hair, " +
  "skin tone, body proportions, outfit, garment construction, print, colors, " +
  "fabric, seams and accessories from the reference. Preserve the existing " +
  "location, architecture, background objects, lighting direction and color " +
  "grade. Introduce no new clothing details, furniture or environmental elements. " +
  "Change only the model's pose, camera angle and framing. Do NOT preserve or closely " +
  "imitate the hero's stance, limb arrangement, hand placement, body orientation, gaze, " +
  "camera height or crop. The output must read instantly as a genuinely different shot, " +
  "not as a subtle adjustment or near-duplicate of the hero.";

const POSE_DIVERGENCE_SUFFIX =
  "\n\nMANDATORY POSE-DIVERGENCE RULE: Compare against reference image 1 before editing. " +
  "The new frame MUST be unmistakably different at first glance. Change at least FOUR " +
  "high-impact visual dimensions: body orientation, weight distribution, leg position, " +
  "arm/hand placement, head direction or gaze, movement state, camera viewpoint, camera " +
  "distance/subject scale, and framing/crop. The camera viewpoint AND camera distance must " +
  "both visibly differ from reference image 1, but choose those changes freely according " +
  "to the garment and scene; do not follow a fixed lens, zoom, crop or angle preset. A " +
  "small hand move, slight head turn, mirrored stance, or the same pose " +
  "with a different crop is NOT acceptable. Recreating the hero's silhouette or pose is " +
  "a failed edit. Preserve identity and garment exactly while directing a clearly new, " +
  "physically natural premium e-commerce fashion pose.";

// ─────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────

/** Bu kaynak için gerçek parti sayısını, trial limitini ve ücreti hesaplar. */
async function resolveVariationCost(userId, sourceGenerationId) {
  const [{ data: rows, error: rowsError }, { data: user, error: userError }] =
    await Promise.all([
      supabase
        .from("variation_generations")
        .select("generation_id, variation_index, settings")
        .eq("user_id", userId)
        .eq("source_generation_id", sourceGenerationId)
        .in("status", ["pending", "processing", "completed"]),
      supabase.from("users").select("is_in_trial").eq("id", userId).single(),
    ]);

  if (rowsError) {
    logger.error("❌ [VARIATION] Parti sayım hatası:", rowsError.message);
    throw new Error("variation_batch_count_failed");
  }
  if (userError || !user) {
    logger.error("❌ [VARIATION] Trial durumu okunamadı:", userError?.message);
    throw new Error("variation_user_status_failed");
  }

  // Her tıklama iki DB satırı üretir. Aynı settings.batchId değerine sahip
  // satırlar tek üretim partisidir; eski kayıtlarda variation_index fallback'tir.
  const batchKeys = new Set(
    (rows || []).map((row) =>
      String(
        row?.settings?.batchId ||
          `legacy-index-${row?.variation_index ?? row?.generation_id}`,
      ),
    ),
  );

  const access = calculateVariationAccess(batchKeys.size, {
    isInTrial: user.is_in_trial === true,
    trialBatchLimit: TRIAL_VARIATION_BATCH_LIMIT,
    freeFirstVariation: FREE_FIRST_VARIATION,
    variationCreditCost: VARIATION_CREDIT_COST,
  });
  const highestStoredIndex = Math.max(
    0,
    ...(rows || []).map((row) => Number(row?.variation_index) || 0),
  );
  return {
    ...access,
    // Eski kod iki DB satırını iki ayrı tur saydığı için indeksler 1,3,5
    // olabilir. Mevcut veriyle çakışmadan yeni partileri sona ekle.
    variationIndex: Math.max(access.variationIndex, highestStoredIndex + 1),
  };
}

/**
 * Hero dışındaki referanslarda aynı kıyafetin gerçek arka görünümü var mı?
 * Düşük güven veya geçersiz görsel numarası güvenli biçimde `false` sayılır.
 */
async function analyzeBackReference(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 2) {
    return {
      hasBackReference: false,
      backReferenceImageNumber: null,
      confidence: "high",
      reason: "No reference images beyond the hero image.",
    };
  }

  const instruction = `You are performing strict visual QA for a fashion e-commerce
image-editing workflow. The attached images are ordered and numbered starting at 1.
Image 1 is the finished HERO image and must never be classified as a back reference.
Inspect only images 2 through ${imageUrls.length}.

Determine whether any of those reference images clearly shows the REAR/BACK construction
of the SAME garment or product worn in image 1. A valid back reference must reveal useful
rear construction evidence such as the back silhouette, rear seams, closure, straps,
neckline, print continuation or back panel. A front image, side angle, model merely
turning slightly away, location reference, pose reference, unrelated garment or ambiguous
flat-lay is not sufficient. If several qualify, choose the clearest one.

Return ONLY valid JSON:
{"hasBackReference":true,"backReferenceImageNumber":2,"confidence":"high","reason":"brief visual evidence"}

Use hasBackReference=false and backReferenceImageNumber=null whenever uncertain.
confidence must be exactly "high", "medium" or "low".`;

  try {
    const raw = await callGeminiFlash(instruction, imageUrls, 2);
    console.log(`🔍 [VARIATION] Gemini back-reference analysis raw:\n${String(raw || "")}`);
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON bulunamadı");

    const parsed = JSON.parse(match[0]);
    const imageNumber = Number(parsed?.backReferenceImageNumber);
    const confidence = ["high", "medium", "low"].includes(parsed?.confidence)
      ? parsed.confidence
      : "low";
    const validImageNumber =
      Number.isInteger(imageNumber) && imageNumber >= 2 && imageNumber <= imageUrls.length;
    const hasBackReference =
      parsed?.hasBackReference === true && validImageNumber && confidence !== "low";

    const analysis = {
      hasBackReference,
      backReferenceImageNumber: hasBackReference ? imageNumber : null,
      confidence,
      reason: String(parsed?.reason || "").slice(0, 500),
    };
    console.log(`🔍 [VARIATION] Back-reference decision: ${JSON.stringify(analysis)}`);
    return analysis;
  } catch (err) {
    logger.warn("⚠️ [VARIATION] Arka referans analizi başarısız; normal pozlar kullanılacak:", err.message);
    return {
      hasBackReference: false,
      backReferenceImageNumber: null,
      confidence: "low",
      reason: `Analysis failed: ${err.message}`,
    };
  }
}

/**
 * İki varyasyonun promptunu GEMINI'ye yazdırır.
 *
 * Neden sabit poz talimatı vermiyoruz: hangi duruşun bu kıyafete, bu mekâna ve bu
 * ışığa yakışacağını görseli gören model bizden iyi biliyor. Biz yalnız kuralları
 * (kimlik/kıyafet/ışık sabit, yalnız poz ve kadraj değişir) ve ne tür bir çekim
 * dizisi istediğimizi söylüyoruz; hangi açı/kadraj seçileceğine Gemini karar veriyor.
 *
 * Gemini arka referans tespit ettiyse ikinci varyasyon ARKADAN çekim olur.
 */
async function buildVariationPrompts({ imageUrls, backAnalysis, note }) {
  const hasBackReference = backAnalysis?.hasBackReference === true;
  const backReferenceImageNumber = backAnalysis?.backReferenceImageNumber;
  const safeNote =
    !hasBackReference && requestsBackView(note) ? null : note;
  if (note && !safeNote) {
    logger.warn(
      "⚠️ [VARIATION] Kullanıcı notundaki arka poz talebi, doğrulanmış arka referans olmadığı için yok sayıldı"
    );
  }
  // Aynı kaynak yeniden çeşitlendirildiğinde Gemini'nin önceki kompozisyonlara
  // saplanmasını önleyen, yalnız yaratıcı çeşitlilik için kullanılan çağrı anahtarı.
  const creativeVariationKey = uuidv4().slice(0, 8);
  const instruction = `You are the senior art director and fashion photographer for a
world-class e-commerce fashion brand. Creative variation key: ${creativeVariationKey}.
Use that key only as an internal diversity cue; never print or mention it.

The FIRST image is the hero shot that was just produced. Any following images are
references from the same shoot (product photos, style/location references${
    hasBackReference
      ? `, including a confirmed BACK-SIDE garment reference at image ${backReferenceImageNumber}`
      : ""
  }).

Invent TWO fresh, premium e-commerce fashion-editorial frames from this exact same
photoshoot. They must be commercially useful on a product detail page and visually
strong enough for a current fashion lookbook. Do not reuse a fixed pose template and
do not default to the same familiar stance on every request.

First perform silent visual art direction: identify the garment category, silhouette,
construction details, drape, strongest selling features, model attitude, location,
lighting and the existing hero composition. Then independently design two shots that
best sell THIS garment. Make creative decisions across body language, weight shift,
hand placement, gaze, degree of movement, body orientation, camera height, lens
distance, crop and negative space. Choose natural, physically plausible fashion poses
that keep the garment readable rather than theatrical or generic influencer poses.
The pair must have clearly different silhouettes and framing rhythms, and both must
also differ substantially from the hero image. For EACH proposed shot, change at least
four high-impact dimensions relative to the hero: body orientation, weight distribution,
leg position, arm/hand placement, head direction or gaze, movement state, camera height
or viewpoint, camera distance/subject scale, and framing/crop. Independently art-direct
the camera strategy for each shot based on this garment and scene; do not use a fixed lens,
zoom level or angle template. Nevertheless, each shot MUST use a visibly different camera
distance and viewpoint from the hero, and the two prompts must also choose clearly distinct
camera strategies from each other. A minor hand movement, slight head turn, mirrored stance,
or the original pose with a new crop is forbidden. The difference must be obvious in a
one-second side-by-side comparison. ${
    hasBackReference
      ? `Prompt 1 must be a freely art-directed non-back view. Prompt 2 MUST be a rear-facing e-commerce pose that clearly sells the back of the garment, using image ${backReferenceImageNumber} as the exact rear-construction source of truth. Exactly one prompt must be a back view.`
      : `There is NO verified back-side garment reference. Therefore BOTH prompts MUST keep
the model front-facing or in a front three-quarter orientation. The face and the front
construction of the garment must remain clearly visible. Never request a rear-facing,
back-view, over-the-shoulder-away, turned-away or camera-from-behind composition. Do not
invent, infer or hallucinate the garment's back, even if the user note asks for it. Select
two complementary front-safe viewpoints and crop distances appropriate to this garment.`
  }

Each final prompt must be a self-contained Nano Banana Lite image-editing brief.
Explicitly anchor the edit to the reference person, garment and photoshoot. Preserve the
identical face, hair, skin tone, body proportions, garment colour, fabric, cut, pattern,
seams, closures and every product detail. Preserve the same location, set design, light
direction, light quality, colour grade and time of day. Change only pose, body angle,
camera viewpoint and framing. Keep important garment features visible and unobstructed,
with anatomically natural hands and limbs, realistic fabric behavior, photoreal skin,
crisp product detail and polished high-end e-commerce editorial finishing. Each output
is one single photograph with one subject, never a collage or composite.

Favor contemporary commercial fashion photography: intentional composition, confident
but believable model direction, clean product readability, premium lighting and a
camera choice that flatters the garment. Avoid placeholders such as “a different pose”;
specify the newly invented pose and camera composition concretely. Never mention the
creative variation key, this analysis process or alternative options in the prompts.
${safeNote ? `Additional direction from the user: ${safeNote}\n` : ""}

Write each prompt in fluent natural English as a concise but richly visual photographer's
brief. Do not put headings, bullets, numbering or meta-commentary inside either prompt.

Return ONLY valid JSON, nothing else:
{"prompts":["<first prompt>","<second prompt>"]}`;

  try {
    const raw = await callGeminiFlash(instruction, imageUrls, 2);
    console.log(
      `🧠 [VARIATION] Gemini raw response | key=${creativeVariationKey}:\n${String(raw || "")}`
    );
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const prompts = (parsed?.prompts || [])
        .filter((p) => typeof p === "string" && p.trim().length > 40)
        .slice(0, 2);
      if (prompts.length === 2) {
        if (!hasBackReference) {
          const safeFallbacks = fallbackPrompts(false, safeNote);
          const safePrompts = prompts.map((prompt, index) => {
            if (!requestsBackView(prompt)) return prompt;
            logger.warn(
              `⚠️ [VARIATION] Gemini prompt ${index + 1} arka poz istedi; arka referans olmadığı için güvenli fallback kullanılıyor`
            );
            return safeFallbacks[index];
          });
          logger.log("🤖 [VARIATION] Gemini iki front-safe prompt üretti");
          return safePrompts;
        }
        logger.log("🤖 [VARIATION] Gemini iki prompt üretti");
        return prompts;
      }
      if (prompts.length === 1) {
        logger.warn("⚠️ [VARIATION] Gemini tek prompt döndü, fallback ile tamamlanıyor");
        const safeFallbacks = fallbackPrompts(hasBackReference, safeNote);
        const firstPrompt =
          !hasBackReference && requestsBackView(prompts[0])
            ? safeFallbacks[0]
            : prompts[0];
        return [firstPrompt, safeFallbacks[1]];
      }
    }
    logger.warn("⚠️ [VARIATION] Gemini yanıtı ayrıştırılamadı, fallback kullanılıyor");
  } catch (err) {
    logger.warn("⚠️ [VARIATION] Gemini hatası, fallback kullanılıyor:", err.message);
  }

  return fallbackPrompts(hasBackReference, safeNote);
}

/** Arka referans yokken Gemini çıktısındaki açık arka-poz taleplerini yakalar. */
function requestsBackView(prompt) {
  return /\b(back[- ]?(?:view|facing)|rear[- ]?(?:view|facing)|from behind|camera (?:is )?behind|back to (?:the )?camera|show(?:ing)? (?:her|his|their|the model(?:'s)?) back|turned away|turning away|over[- ]the[- ]shoulder away)\b/i.test(
    String(prompt || "")
  );
}

/** Gemini ulaşılamazsa kullanılan yedek promptlar — yine iki farklı kare. */
function fallbackPrompts(hasBackReference, note) {
  const safeNote =
    !hasBackReference && requestsBackView(note) ? null : note;
  const shared =
    "Keep the SAME model (identical face, hair, skin tone and proportions) wearing the " +
    "SAME garment (identical colour, fabric, cut, pattern and every detail), in the SAME " +
    "location with the SAME light direction, quality and colour grade as the reference. " +
    "Photoreal editorial fashion photography, sharp focus, single subject, no text, " +
    "no watermark, no collage, no duplicated limbs.";

  // Birinci kare her durumda, iki kare de arka referans yokken front-safe olmalı.
  const directions = [
    "a relaxed front-facing walking beat with asymmetric arm movement and natural fabric motion",
    "a poised front three-quarter weight shift with an elongated silhouette and understated hand placement",
    "a subtle front three-quarter turn with the face and garment front still clearly visible",
    "a clean front-facing editorial stance with offset shoulders and a calm product-focused attitude",
    "a seated front three-quarter pose when physically appropriate to the existing set",
    "a restrained front-oriented pose that clearly reveals the garment's front silhouette",
  ];
  const framings = [
    "full-length at natural eye level with balanced product-page negative space",
    "three-quarter length from a subtly lower camera height that flatters the silhouette",
    "mid-length with a refined off-center composition emphasizing construction and drape",
    "full-length with a subtle diagonal composition and editorial depth",
  ];

  const firstDirection = directions[Math.floor(Math.random() * directions.length)];
  let secondDirection = directions[Math.floor(Math.random() * directions.length)];
  if (secondDirection === firstDirection) {
    secondDirection = directions[(directions.indexOf(firstDirection) + 1) % directions.length];
  }
  const firstFraming = framings[Math.floor(Math.random() * framings.length)];
  let secondFraming = framings[Math.floor(Math.random() * framings.length)];
  if (secondFraming === firstFraming) {
    secondFraming = framings[(framings.indexOf(firstFraming) + 1) % framings.length];
  }

  const first =
    `Create a fresh premium e-commerce fashion-editorial frame using ${firstDirection}, ` +
    `${firstFraming}. Keep the garment clearly readable and make the body language feel ` +
    `confident, contemporary and physically natural. ${shared}`;

  const second = hasBackReference
    ? "Create a premium e-commerce back-view frame with a naturally art-directed body " +
      "angle that clearly sells the rear construction of the garment. Match the back-side " +
      "reference exactly, including seams, closures, straps and pattern, while keeping the " +
      `pose elegant and physically natural; use ${secondFraming}. ${shared}`
    : `Create a complementary premium e-commerce fashion-editorial frame using ${secondDirection}, ` +
      `${secondFraming}. Ensure its silhouette, body angle and visual rhythm are clearly ` +
      `different from the other frame while keeping the garment unobstructed. ${shared}`;

  const withNote = (p) =>
    safeNote ? `${p} Additional direction: ${safeNote}` : p;
  return [withNote(first), withNote(second)];
}

/** Gemini/fallback çıktısını üretim modeline gidecek nihai prompta dönüştürür. */
function finalizeVariationPrompt(
  prompt,
  { forceBackView = false, forbidBackView = false, backReferenceImageNumber } = {}
) {
  const backViewSuffix = forceBackView
    ? `\n\nThis output MUST be a clear rear-facing e-commerce fashion photograph. ` +
      `Use reference image ${backReferenceImageNumber} as the exact source of truth for ` +
      "the garment's back construction, rear seams, closures, straps, neckline, print " +
      "continuation and silhouette. Keep the back of the garment fully visible and readable."
    : "";
  const noBackViewSuffix = forbidBackView
    ? `\n\nCRITICAL REFERENCE-SAFETY RULE: No verified photograph of this garment's back ` +
      `was supplied. The subject MUST NOT face away from the camera and the camera MUST ` +
      `NOT photograph the subject from behind. Keep the face and the FRONT of the garment ` +
      `clearly visible in a front-facing or front three-quarter orientation. Do not create ` +
      `a back view, rear-facing pose, turned-away pose, or invent any unseen rear garment ` +
      `construction. This rule overrides every earlier composition instruction or user note.`
    : "";
  return (
    `${String(prompt || "").trim()}\n\n${VARIATION_PRESERVATION_SUFFIX}` +
    POSE_DIVERGENCE_SUFFIX +
    backViewSuffix +
    noBackViewSuffix
  );
}

/** Bir üretime ait tüm görselleri toplayıp modele gidecek listeyi kurar. */
function collectInputImages({ sourceImageUrl, referenceImages, extraImages }) {
  const seen = new Set();
  const images = [];

  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const rawUrl =
      typeof value === "string"
        ? value
        : value?.uri || value?.url || value?.publicUrl || value?.imageUrl;
    if (!rawUrl || typeof rawUrl !== "string") return;
    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    images.push(url);
  };

  // Sonuç görseli EN BAŞA: modelin kimlik/kompozisyon çıpası bu kare
  push(sourceImageUrl);
  push(referenceImages);
  push(extraImages);

  // Kullanıcının yüklediği ürün fotoğraflarını sessizce kesme. UI yükleme
  // limitleri zaten havuzu sınırlıyor; burada tüm kalıcı referanslar NB Lite'a gider.
  return images;
}

/**
 * Client kartı eksik/hydrate edilmiş olsa bile kaynak generation'ın kalıcı
 * referanslarını backend'den tamamlar. Özellikle History ve yeniden çeşitlendirme
 * akışlarının yalnız hero görseli göndermesini önler.
 */
async function loadStoredSourceContext(userId, sourceGenerationId) {
  try {
    const { data, error } = await supabase
      .from("reference_results")
      .select(
        "reference_images, location_image, pose_image, hair_style_image, aspect_ratio, settings",
      )
      .eq("user_id", userId)
      .eq("generation_id", sourceGenerationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn(
        `⚠️ [VARIATION] Kaynak referansları okunamadı (${sourceGenerationId}):`,
        error.message,
      );
      return { inputs: [], aspectRatio: null };
    }

    let settings = data?.settings || {};
    if (typeof settings === "string") {
      try {
        settings = JSON.parse(settings);
      } catch {
        settings = {};
      }
    }

    return {
      inputs: [
        data?.reference_images,
        data?.location_image,
        data?.pose_image,
        data?.hair_style_image,
        settings?.backImage,
        settings?.backSideImage,
        settings?.styleReferenceImage,
        settings?.locationImage,
        settings?.poseImage,
      ],
      // "original" seçeneğinde alanı göndermemek gerekir; NB Lite bu durumda
      // edit kaynağının gerçek oranını varsayılan davranışıyla korur.
      aspectRatio: normalizeVariationAspectRatio(data?.aspect_ratio),
    };
  } catch (error) {
    logger.warn(
      `⚠️ [VARIATION] Kaynak referans istisnası (${sourceGenerationId}):`,
      error?.message || error,
    );
    return { inputs: [], aspectRatio: null };
  }
}

/** Başarı anında krediyi düşer. Ücretsiz varyasyonda hiç çağrılmaz. */
async function deductVariationCredit(generationId, userId, creditCost) {
  if (!creditCost || creditCost <= 0) return true;

  try {
    // Çift düşüm koruması
    const { data: row } = await supabase
      .from("variation_generations")
      .select("settings")
      .eq("generation_id", generationId)
      .single();

    if (row?.settings?.creditDeducted === true) {
      logger.log(`💳 [VARIATION] ${generationId} için kredi zaten düşülmüş`);
      return true;
    }

    // Takım üyesiyse sahibin kredisinden düş
    const effective = await teamService.getEffectiveCredits(userId);
    const creditOwnerId = effective.creditOwnerId || userId;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", creditOwnerId)
      .single();

    if (userError || !user) {
      logger.error(`❌ [VARIATION] Kredi sahibi bulunamadı: ${creditOwnerId}`);
      return false;
    }

    if ((user.credit_balance || 0) < creditCost) {
      logger.error(
        `❌ [VARIATION] Yetersiz kredi: ${user.credit_balance} < ${creditCost}`
      );
      return false;
    }

    const { error: rpcError } = await supabase.rpc("deduct_user_credit", {
      user_id: creditOwnerId,
      credit_amount: creditCost,
    });

    if (rpcError) {
      logger.error("❌ [VARIATION] Kredi düşme hatası:", rpcError.message);
      return false;
    }

    await supabase
      .from("variation_generations")
      .update({
        settings: { ...(row?.settings || {}), creditDeducted: true },
        updated_at: new Date().toISOString(),
      })
      .eq("generation_id", generationId);

    logger.log(`✅ [VARIATION] ${creditCost} kredi düşüldü (${creditOwnerId})`);
    return true;
  } catch (err) {
    logger.error("❌ [VARIATION] Kredi düşme istisnası:", err.message);
    return false;
  }
}

/** fal kuyruğunu üretim bitene kadar yoklar. */
async function runFalVariation(
  generationId,
  userId,
  sourceGenerationId,
  prompt,
  imageUrls,
  creditCost,
  aspectRatio,
) {
  const startedAt = Date.now();

  try {
    // Gemini'nin yazdığı ve Nano Banana Lite'a aynen gönderilen nihai prompt.
    console.log(
      `🍌 [VARIATION] Nano Banana Lite prompt | generation=${generationId} | ` +
        `model=${VARIATION_MODEL} | input_images=${imageUrls.length} | ` +
        `aspect_ratio=${aspectRatio || "source-default"}:\n${prompt}`
    );

    const { request_id } = await fal.queue.submit(VARIATION_MODEL, {
      input: {
        prompt,
        image_urls: imageUrls,
        ...getVariationModelSettings(aspectRatio),
      },
    });

    if (!request_id) throw new Error("fal request_id dönmedi");

    await supabase
      .from("variation_generations")
      .update({
        status: "processing",
        fal_request_id: request_id,
        updated_at: new Date().toISOString(),
      })
      .eq("generation_id", generationId);

    logger.log(`⏳ [VARIATION] ${generationId} fal kuyruğuna girdi (${request_id})`);

    for (let poll = 0; poll < MAX_POLLS; poll++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusResult = await fal.queue.status(VARIATION_MODEL, {
        requestId: request_id,
        logs: false,
      });

      if (statusResult.status === "COMPLETED") {
        const finalResult = await fal.queue.result(VARIATION_MODEL, {
          requestId: request_id,
        });
        const temporaryResultUrl = finalResult?.data?.images?.[0]?.url;
        if (!temporaryResultUrl) throw new Error("Sonuçta görsel yok");

        // fal.ai CDN adresi geçicidir. DB'ye yazmadan önce uygulamanın kalıcı
        // Supabase bucket'ına taşı; upload başarısızsa geçici URL'yi kaydetme.
        const persisted = await persistVariationImage({
          supabase,
          sourceUrl: temporaryResultUrl,
          userId,
          sourceGenerationId,
          generationId,
        });
        const resultUrl = persisted.publicUrl;

        const seconds = Math.round((Date.now() - startedAt) / 1000);
        const { error: completionUpdateError } = await supabase
          .from("variation_generations")
          .update({
            status: "completed",
            result_image_url: resultUrl,
            processing_time_seconds: seconds,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("generation_id", generationId);
        if (completionUpdateError) {
          throw new Error(
            `Variation completion could not be saved: ${completionUpdateError.message}`,
          );
        }

        logger.log(
          `✅ [VARIATION] ${generationId} tamamlandı (${seconds} sn) | ` +
            `bucket=${persisted.bucket} path=${persisted.storagePath}`,
        );

        // Kredi yalnız başarılı sonuçta düşer.
        await deductVariationCredit(generationId, userId, creditCost);
        return;
      }

      if (statusResult.status === "FAILED") {
        throw new Error("Nano Banana Lite üretimi başarısız");
      }
    }

    throw new Error("fal polling zaman aşımı");
  } catch (err) {
    logger.error(`❌ [VARIATION] ${generationId} hata:`, err.message);
    await supabase
      .from("variation_generations")
      .update({
        status: "failed",
        error_message: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq("generation_id", generationId);
  }
}

/**
 * Ana model üretimi tamamlandığı anda trial kullanıcısının İLK varyasyon
 * partisini backend'de başlatır. Deterministik generation id'leri ve UNIQUE
 * constraint aynı completion iki kez işlense bile ikinci fal üretimini engeller.
 */
async function startAutomaticTrialVariation({
  userId,
  sourceGenerationId,
  sourceImageUrl,
  referenceImages = [],
  extraImages = [],
}) {
  if (!userId || !sourceGenerationId || !sourceImageUrl) {
    return { started: false, reason: "missing_input" };
  }

  const access = await resolveVariationCost(userId, sourceGenerationId);
  if (!shouldStartAutomaticTrialVariation(access)) {
    return {
      started: false,
      reason: access.isInTrial ? "already_started" : "not_trial",
    };
  }

  const sourceContext = await loadStoredSourceContext(
    userId,
    sourceGenerationId,
  );
  const imageUrls = collectInputImages({
    sourceImageUrl,
    referenceImages,
    extraImages: [extraImages, sourceContext.inputs],
  });
  const sourceAspectRatio = sourceContext.aspectRatio;
  if (imageUrls.length === 0) {
    return { started: false, reason: "no_images" };
  }

  const stableSourceId = String(sourceGenerationId).replace(
    /[^a-zA-Z0-9_-]+/g,
    "_",
  );
  const batchId = `trial_auto_${stableSourceId}`;
  const generationIds = [
    `var_auto_${stableSourceId}_1`,
    `var_auto_${stableSourceId}_2`,
  ];
  // Önce deterministik pending satırlarını ayır. Prompt analizi uzun sürse bile
  // client processing kartını hemen görür; eşzamanlı ikinci worker UNIQUE'e takılır.
  const rows = generationIds.map((generationId, index) => ({
    user_id: userId,
    generation_id: generationId,
    source_generation_id: sourceGenerationId,
    source_image_url: sourceImageUrl,
    input_images: imageUrls,
    prompt: null,
    status: "pending",
    variation_index: access.variationIndex,
    credits_used: 0,
    settings: {
      model: VARIATION_MODEL,
      ...getVariationModelSettings(sourceAspectRatio),
      batchId,
      slot: index + 1,
      automaticTrial: true,
    },
  }));

  const { error: insertError } = await supabase
    .from("variation_generations")
    .insert(rows);
  if (insertError) {
    // generation_id UNIQUE koruması: başka worker önce başlattıysa başarı say.
    if (insertError.code === "23505") {
      logger.log(
        `🎭 [TRIAL_VARIATION] ${sourceGenerationId} otomatik parti zaten başlatılmış`,
      );
      return { started: false, reason: "already_started" };
    }
    throw insertError;
  }

  let prompts;
  let backAnalysis;
  try {
    backAnalysis = await analyzeBackReference(imageUrls);
    const creativePrompts = await buildVariationPrompts({
      imageUrls,
      backAnalysis,
      note: null,
    });
    prompts = creativePrompts.map((prompt, index) =>
      finalizeVariationPrompt(prompt, {
        forceBackView: backAnalysis.hasBackReference && index === 1,
        forbidBackView: !backAnalysis.hasBackReference,
        backReferenceImageNumber: backAnalysis.backReferenceImageNumber,
      }),
    );

    await Promise.all(
      prompts.map(async (prompt, index) => {
        const { error } = await supabase
          .from("variation_generations")
          .update({
            prompt,
            settings: {
              model: VARIATION_MODEL,
              ...getVariationModelSettings(sourceAspectRatio),
              batchId,
              slot: index + 1,
              automaticTrial: true,
              backReferenceAnalysis: backAnalysis,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("generation_id", generationIds[index]);
        if (error) throw error;
      }),
    );
  } catch (error) {
    await supabase
      .from("variation_generations")
      .update({
        status: "failed",
        error_message: error?.message || "automatic variation setup failed",
        updated_at: new Date().toISOString(),
      })
      .in("generation_id", generationIds);
    throw error;
  }

  prompts.forEach((prompt, index) => {
    runFalVariation(
      generationIds[index],
      userId,
      sourceGenerationId,
      prompt,
      imageUrls,
      0,
      sourceAspectRatio,
    );
  });

  logger.log(
    `🎭 [TRIAL_VARIATION] Backend otomatik parti başlattı | ` +
      `source=${sourceGenerationId} batch=${batchId}`,
  );
  return { started: true, batchId, generationIds };
}

// ─────────────────────────────────────────────────────────────
// Uçlar
// ─────────────────────────────────────────────────────────────

/**
 * Bu kaynak için varyasyonun ücretini önden bildirir.
 * İstemci onay modalını buna göre gösterir ("bu sefer 10 kredi").
 */
router.get("/quote", async (req, res) => {
  try {
    const { userId, sourceGenerationId } = req.query;
    if (!userId || !sourceGenerationId) {
      return res
        .status(400)
        .json({ success: false, error: "userId and sourceGenerationId required" });
    }

    const access = await resolveVariationCost(
      userId,
      sourceGenerationId
    );

    return res.json({
      success: true,
      ...access,
      isFree: access.creditCost === 0 && !access.limitReached,
    });
  } catch (err) {
    logger.error("❌ [VARIATION] quote hatası:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** Varyasyon üretimini başlatır; hemen döner, üretim arka planda sürer. */
router.post("/generate", async (req, res) => {
  try {
    const {
      userId,
      sourceGenerationId,
      sourceImageUrl,
      referenceImages = [],
      extraImages = [],
      note = null,
      freeOnly = false,
    } = req.body || {};

    if (!userId || !sourceGenerationId || !sourceImageUrl) {
      return res.status(400).json({
        success: false,
        error: "userId, sourceGenerationId and sourceImageUrl are required",
      });
    }

    const sourceContext = await loadStoredSourceContext(
      userId,
      sourceGenerationId,
    );
    const imageUrls = collectInputImages({
      sourceImageUrl,
      referenceImages,
      extraImages: [extraImages, sourceContext.inputs],
    });
    const sourceAspectRatio = sourceContext.aspectRatio;

    if (imageUrls.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "no usable image urls" });
    }

    const access = await resolveVariationCost(
      userId,
      sourceGenerationId
    );
    const { variationIndex, creditCost } = access;

    if (access.limitReached) {
      return res.status(409).json({
        success: false,
        error: "trial_variation_limit",
        ...access,
      });
    }

    // Trial'deki beş hakkın tamamı ve normal kullanıcının ücretsiz ilk hakkı
    // freeOnly çalışabilir. Quote/generate yarışında kredi harcanmasını önler.
    if (freeOnly === true && !canStartFreeOnlyVariation(creditCost)) {
      return res.status(409).json({
        success: false,
        error: "automatic_variation_not_free",
        creditCost,
      });
    }

    // Ücretliyse bakiyeyi ÖNDEN kontrol et — üretime girip sonra reddetmek kötü deneyim
    if (creditCost > 0) {
      const effective = await teamService.getEffectiveCredits(userId);
      const creditOwnerId = effective.creditOwnerId || userId;
      const { data: user } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", creditOwnerId)
        .single();

      if ((user?.credit_balance || 0) < creditCost) {
        return res.status(402).json({
          success: false,
          error: "insufficient_credits",
          creditCost,
          balance: user?.credit_balance || 0,
        });
      }
    }

    // 1) Gemini önce referans havuzunda gerçek bir arka kıyafet görünümü arar.
    // 2) Sonra bu karara göre iki editoryal prompt yazar.
    const backAnalysis = await analyzeBackReference(imageUrls);
    const creativePrompts = await buildVariationPrompts({
      imageUrls,
      backAnalysis,
      note,
    });
    // Bu dizi hem DB'ye yazılır hem fal çağrısına gider; loglanan ve
    // saklanan prompt ile üretim modelinin aldığı prompt birebir aynıdır.
    const prompts = creativePrompts.map((prompt, index) =>
      finalizeVariationPrompt(prompt, {
        // Arka referans bulunduysa ikinci üretimi backend seviyesinde de zorla.
        forceBackView: backAnalysis.hasBackReference && index === 1,
        // Referans yoksa iki üretimde de arka pozu backend seviyesinde yasakla.
        forbidBackView: !backAnalysis.hasBackReference,
        backReferenceImageNumber: backAnalysis.backReferenceImageNumber,
      })
    );

    const batchId = uuidv4();
    const generationIds = prompts.map(() => `var_${uuidv4()}`);

    const rows = prompts.map((prompt, i) => ({
      user_id: userId,
      generation_id: generationIds[i],
      source_generation_id: sourceGenerationId,
      source_image_url: sourceImageUrl,
      input_images: imageUrls,
      prompt,
      status: "pending",
      variation_index: variationIndex,
      // Kredi TÜM PARTİ için bir kez düşer; ikinci satır 0 taşır
      credits_used: i === 0 ? creditCost : 0,
      settings: {
        model: VARIATION_MODEL,
        ...getVariationModelSettings(sourceAspectRatio),
        batchId,
        slot: i + 1,
        backReferenceAnalysis: backAnalysis,
      },
    }));

    const { error: insertError } = await supabase
      .from("variation_generations")
      .insert(rows);

    if (insertError) {
      logger.error("❌ [VARIATION] Kayıt hatası:", insertError.message);
      return res
        .status(500)
        .json({ success: false, error: insertError.message });
    }

    logger.log(
      `🎬 [VARIATION] parti ${batchId} başlatıldı | kaynak ${sourceGenerationId} | ` +
        `${variationIndex}. tur | ${creditCost === 0 ? "ÜCRETSİZ" : creditCost + " kredi"} | ` +
        `${imageUrls.length} girdi görseli | ` +
        `back-reference=${backAnalysis.hasBackReference ? `image ${backAnalysis.backReferenceImageNumber}` : "none"}`
    );

    // İki üretim paralel başlar; kredi yalnız İLK satırda (yani parti başına) düşer
    prompts.forEach((prompt, i) => {
      runFalVariation(
        generationIds[i],
        userId,
        sourceGenerationId,
        prompt,
        imageUrls,
        i === 0 ? creditCost : 0,
        sourceAspectRatio,
      );
    });

    return res.json({
      success: true,
      batchId,
      generationIds,
      variationIndex,
      creditCost,
      isFree: creditCost === 0,
      batchCount: access.batchCount + 1,
      isInTrial: access.isInTrial,
      trialLimit: access.trialLimit,
      trialRemaining: access.isInTrial
        ? Math.max(0, access.trialRemaining - 1)
        : null,
      limitReached: access.isInTrial && access.trialRemaining <= 1,
      backReferenceAnalysis: backAnalysis,
      status: "pending",
    });
  } catch (err) {
    logger.error("❌ [VARIATION] generate hatası:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** İstemci polling ucu. */
router.get("/status/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { data, error } = await supabase
      .from("variation_generations")
      .select(
        "generation_id, source_generation_id, status, result_image_url, error_message, variation_index, credits_used, created_at"
      )
      .eq("generation_id", generationId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: "not found" });
    }

    return res.json({
      success: true,
      variation: {
        ...data,
        result_image_thumbnail: data.result_image_url
          ? optimizeForThumbnail(data.result_image_url)
          : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** Bir kaynağın tamamlanmış varyasyonları — SimpleImageModal panelini besler. */
router.get("/by-source/:sourceGenerationId", async (req, res) => {
  try {
    const { sourceGenerationId } = req.params;
    const { userId } = req.query;

    let q = supabase
      .from("variation_generations")
      .select(
        "generation_id, source_generation_id, source_image_url, status, result_image_url, variation_index, settings, created_at"
      )
      .eq("source_generation_id", sourceGenerationId)
      .order("created_at", { ascending: true });

    if (userId) q = q.eq("user_id", userId);

    const { data, error } = await q;
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const variations = (data || []).filter(
      (v) => v.status === "completed" && v.result_image_url
    );
    const pendingRows = (data || []).filter((v) =>
      ["pending", "processing"].includes(v.status),
    );
    const latestPending = pendingRows[pendingRows.length - 1] || null;
    const activeBatchKey = latestPending
      ? latestPending.settings?.batchId ||
        `legacy-index-${latestPending.variation_index}`
      : null;
    const activeBatch = activeBatchKey
      ? (data || [])
          .filter((row) => {
            const rowBatchKey =
              row.settings?.batchId || `legacy-index-${row.variation_index}`;
            return rowBatchKey === activeBatchKey;
          })
          .map((row) => ({
            generation_id: row.generation_id,
            status: row.status,
            result_image_url: row.result_image_url,
            result_image_thumbnail: row.result_image_url
              ? optimizeForThumbnail(row.result_image_url)
              : null,
            variation_index: row.variation_index,
            created_at: row.created_at,
          }))
      : [];

    return res.json({
      success: true,
      variations: variations.map(({ settings, ...variation }) => ({
        ...variation,
        result_image_thumbnail: optimizeForThumbnail(
          variation.result_image_url,
        ),
      })),
      activeBatch,
      sourceImageUrl: (data || []).find((v) => v.source_image_url)?.source_image_url || null,
      pending: pendingRows.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.startAutomaticTrialVariation = startAutomaticTrialVariation;
