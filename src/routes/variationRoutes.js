// Varyasyon ("Yeni Pozlar") üretimi
//
// Tamamlanmış bir sonucun aynı ürün + aynı manken kimliğiyle FARKLI POZLARINI üretir.
// Modele tamamlanmış sonuç ile ürün/kimlik için gerekli referanslar gider.
// Ayrı location görseli özellikle gönderilmez; mevcut mekân hero görselinden ve
// prompttaki sahne koruma talimatından devam ettirilir.
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
const { collectInputImages } = require("../utils/variationInputImages");

fal.config({ credentials: process.env.FAL_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// 🎨 Varyasyon modeli — GPT Image 2, quality "low" (28 Ağu 2026). TÜM ekranlar:
// hem Refiner'ın ürün varyantları hem CreateModelPhoto'nun poz varyantları.
//
// Model turu ve gerekçe: Nano Banana Lite → GPT "high" (çok yavaş/pahalı, geri
// alındı) → nano-banana-2 (geri alındı) → Lite → Refiner'da GPT "low" → şimdi
// her yerde GPT "low". Karar maliyetle de destekleniyor: fal fiyat tablosunda
// GPT "low" 1024x1536 için $0,018/görsel; Lite ise token bazlı ($37,50/1M
// görsel çıktı tokenı × 1K başına ~1.120 token) ≈ $0,042/görsel.
//
// ⚠️ ALAN ŞEMASI Lite'tan FARKLI: `aspect_ratio` ve `limit_generations` YOK;
// yerine `image_size` (enum) ve `quality` var.
// 🛟 GPT Image 2 zaman zaman 422 "Unprocessable Entity" dönüyor (girdi
// görselinin en-boy oranı, boyutu ya da prompt uzunluğu yüzünden). O durumda
// parti boş kalmasın diye ÜRETİM Nano Banana Lite ile tekrarlanır — kullanıcı
// kararı, 28 Ağu 2026. Lite'ın alan şeması farklı, ayarları ayrı tutuluyor.
const VARIATION_FALLBACK_MODEL = "google/nano-banana-lite/edit";
const VARIATION_FALLBACK_SETTINGS = {
  num_images: 1,
  output_format: "jpeg",
  limit_generations: true,
};
const getVariationFallbackSettings = (aspectRatio) => ({
  ...VARIATION_FALLBACK_SETTINGS,
  ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
});

const VARIATION_MODEL = "openai/gpt-image-2/edit";
const VARIATION_QUALITY = "low";
const VARIATION_MODEL_SETTINGS = {
  num_images: 1,
  output_format: "jpeg",
  quality: VARIATION_QUALITY,
};

// GPT Image 2 oranı ENUM olarak alıyor; en yakın şekle yuvarlanır.
// Tablo createRefiner.js'tekiyle BİREBİR aynı — iki yerde ayrışmasın.
const mapRatioToGptImage2Size = (ratio) =>
  ({
    "21:9": "landscape_16_9",
    "16:9": "landscape_16_9",
    "3:2": "landscape_4_3",
    "4:3": "landscape_4_3",
    "5:4": "landscape_4_3",
    "1:1": "square_hd",
    "4:5": "portrait_4_3",
    "3:4": "portrait_4_3",
    "2:3": "portrait_4_3",
    "9:16": "portrait_16_9",
  })[String(ratio || "")] || "portrait_4_3";
// 🔢 Parti başına üretilen kare sayısı. 28 Ağu 2026'da 2 → 3 çıkarıldı:
// GPT Image 2 "low" görsel başı $0,018'e indiği için üçüncü kare partiyi
// ~$0,054'e getiriyor — Lite'lı iki karelik eski partiden ($0,084) hâlâ ucuz.
// ⚠️ Prompt üreticiler, yedek promptlar ve Results kart düzeni bu sayıya bağlı.
const VARIATIONS_PER_BATCH = 3;

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

// Model ürün tipinden BAĞIMSIZ (bkz. VARIATION_MODEL notu); takıya özel olan
// yalnız PROMPT tarafı — iki kare de makro, her biri farklı bir detayda.
const getVariationModelSettings = (aspectRatio) => ({
  ...VARIATION_MODEL_SETTINGS,
  image_size: mapRatioToGptImage2Size(aspectRatio),
});

// Gemini yaratıcı pozu/kadrajı seçer; referanstaki kimlik, ürün ve sahne
// bütünlüğü ise modele giden HER promptta backend tarafından zorunlu tutulur.
const VARIATION_PRESERVATION_SUFFIX =
  "REFERENCE ROLES — READ BEFORE EDITING: Reference image 1 is the hero photograph and the " +
  "ONLY source of the scene. The location, background, set, props, floor, walls, surfaces, " +
  "weather, time of day, lighting setup, light direction, shadows and colour grade all come " +
  "from reference image 1 and from nothing else. Every additional reference image is a " +
  "PRODUCT-TRUTH reference: it is supplied so the garment stays accurate when the camera moves, " +
  "so study it closely and read the real construction, cut, seams, closures, colour, pattern, " +
  "print placement, trims, hardware and the side and back detail from it — then render those " +
  "details correctly from the new angle. Read ONLY the garment from it. Never carry over its background, " +
  "room, shop interior, rails, hangers, shelves, mirrors, mannequins, other people, floor, " +
  "wall, table, daylight, artificial or flash lighting, colour cast or amateur snapshot look. " +
  "If a product reference was photographed somewhere else, that place must not appear anywhere " +
  "in the output, not even partially, softly, reflected or out of focus.\n\n" +
  "Edit the provided reference image. Preserve the exact identity, face, hair, " +
  "skin tone, body proportions, outfit, garment construction, print, colors, " +
  "fabric, seams and accessories from the reference. Preserve the identity of the " +
  "existing location, its architecture, materials, established objects, physical " +
  "light sources, atmosphere, time of day and color grade. Re-photograph that same " +
  "place from a genuinely different, physically coherent spatial viewpoint; do not " +
  "copy the hero's exact background projection, object overlap or environmental " +
  "composition. Introduce no new clothing details, furniture or environmental elements. " +
  "Change only the model's pose, camera angle and framing. Do NOT preserve or closely " +
  "imitate the hero's stance, limb arrangement, hand placement, body orientation, gaze, " +
  "camera height or crop. Keep the garment or product visually dominant and large enough " +
  "for its construction, material and selling details to be immediately readable. Use a " +
  "product-led close framing chosen specifically for this garment; never default to a " +
  "head-to-toe full-body composition. The output must read instantly as a genuinely different shot, " +
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

const ENVIRONMENT_PERSPECTIVE_SUFFIX =
  "\n\nMANDATORY SAME-LOCATION PERSPECTIVE VARIATION: Keep the location unmistakably " +
  "the same place, with the same architecture, materials, set identity, established " +
  "objects, atmosphere and physical lighting setup. However, the camera must occupy a " +
  "meaningfully different spatial viewpoint from reference image 1, so perspective, " +
  "parallax, background layering, relative scale, visible surface planes, occlusion and " +
  "negative space are naturally recomposed. Do not reuse the hero background as a flat " +
  "plate and do not merely move or crop the model over an unchanged backdrop. Let the " +
  "new camera position determine which existing environmental elements are visible and " +
  "how they relate in frame, without inventing a new place or following a fixed angle. " +
  "The two variations must also use clearly different environmental perspectives from " +
  "each other while remaining physically consistent with the same location.";

// 💍 ÜRÜN MODU (27 Ağu 2026, kullanıcı isteği) — Refiner çıktıları için.
// Refiner karesinde manken yok: ortada temizlenmiş bir ÜRÜN var. Poz/mekân
// çeşitlendirmesi burada anlamsız; kullanıcının istediği, ürün sayfasını
// zenginleştiren İKİNCİ AÇI ve DETAY MAKRO kareleri.
//   • Varyasyon 1 → aynı ürün, gerçekten farklı bir kamera açısı, daha yakın
//   • Varyasyon 2 → ürünün en değerli detayına makro yakınlaşma
// İkisinin birbirinden farklı olması zorunlu (aşağıdaki divergence bloğu).
const PRODUCT_VARIATION_PRESERVATION_SUFFIX =
  "REFERENCE ROLES — READ BEFORE EDITING: every reference image after the first one is the " +
  "seller's own source photograph of the same product, useful only as extra evidence of its " +
  "real construction, materials, texture and details. Its background, surface, table, floor, " +
  "packaging, lighting, shadows, colour cast and snapshot quality are irrelevant and must " +
  "never appear in the output. The background, lighting and colour grade come from the FIRST " +
  "image alone.\n\n" +
  "Edit the provided reference image. The FIRST image is the finished catalog photograph of " +
  "the product; it is the single source of truth for the product's identity. Preserve that " +
  "product EXACTLY: the same object, same silhouette and proportions, same materials and " +
  "finish, same colors and color temperature, same metal tone, same stones, same texture, " +
  "same pattern, same stitching, same hardware, same engraving and the same branding. Do not " +
  "restyle, redesign, simplify, embellish, resize or replace any part of the product, and do " +
  "not invent details that are not visible in the references. Keep the same clean studio " +
  "background, the same background color, the same soft even lighting and the same color " +
  "grade as the reference. No people, no hands, no fingers, no model, no ears, no necks, no " +
  "mannequin parts, no display busts, no stands, no props, no packaging, no fabric, no text, " +
  "no logos of other brands, no watermark, no collage and no split frames. The output is one " +
  "single photograph of that one product, finished to flawless high-end e-commerce retouch " +
  "quality: razor-sharp focus on the product, crisp edges, clean surfaces free of dust, lint, " +
  "scratches and fingerprints, and true-to-life color.\n\n" +
  "BACKGROUND FIDELITY — REPRODUCE THE HERO'S BACKGROUND EXACTLY: The hero image already carries " +
  "a finished catalog background; the output must show the SAME background, edge to edge. If it is " +
  "pure white, the output background is the same pure, even, seamless white (#FFFFFF) across the " +
  "whole frame — never grey, never cream, never beige, never washed-out or dulled, never a gradient, " +
  "never vignetted or darker in the corners, with no visible seam, no horizon line, no dust, no " +
  "noise and no soft falloff. If the hero background is a colour, reproduce that EXACT colour with " +
  "the same hue, saturation and brightness across the entire frame — never faded, muted, darkened, " +
  "pastelled, tinted by the product's reflections or shifted toward a neighbouring shade. This rule " +
  "matters most in a close-up frame, where a near camera and shallow depth of field tend to grey " +
  "down, blur or contaminate the background: keep it perfectly clean, uniform and fully saturated " +
  "there too. Do not introduce any surface, table, floor, wall, backdrop edge, prop shadow or " +
  "environmental colour cast that the hero image does not have.";

const PRODUCT_DIVERGENCE_SUFFIX =
  "\n\nMANDATORY SHOT-DIVERGENCE RULE: Compare against reference image 1 before editing. " +
  "This frame must be unmistakably a DIFFERENT photograph of the same product, not a subtle " +
  "adjustment or a re-crop of the hero. Change the camera position in three-dimensional space: " +
  "the viewing angle, the rotation of the product relative to the lens, the camera height and " +
  "the camera distance must all visibly differ from the hero, with physically coherent " +
  "perspective, foreshortening and specular highlights for the new viewpoint. Simply zooming " +
  "into the hero pixels, mirroring it, or nudging the crop is a failed edit. The product stays " +
  "the visual subject and fills the frame confidently.";

// ─────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────

/**
 * 💎 Takı sayılan kaynak kategorileri. Refiner kalıcı kayda sınıflandırıcının
 * ÜST TİPİNİ ("jewelry") yazıyor; sahneleme kategorileri (earrings/rings/…)
 * eski kayıtlarda görülebildiği için onlar da kabul ediliyor.
 */
const JEWELRY_SOURCE_CATEGORIES = new Set([
  "jewelry",
  "earrings",
  "rings",
  "necklaces",
  "bracelets_chain",
  "bracelets_bangle",
]);

/**
 * 💎 Kayıtta kategori YOKSA (28 Ağu öncesi üretimler) ürünün takı olup
 * olmadığını kaydın kendi prompt metninden çıkarır. Refiner prompt'ları ürünü
 * adıyla anıyor ("every earring in the output…", "the prong setting…"), bu
 * yüzden metin güvenilir bir ikinci kaynak.
 *
 * "ring" tek başına yanıltıcı (ring light, during…), o yüzden GÜÇLÜ sözcükler
 * tek başına yeter; ZAYIF olanlar en az iki tane olmalı.
 */
const JEWELRY_STRONG = /\b(earrings?|necklaces?|pendants?|bracelets?|bangles?|anklets?|brooch(?:es)?|cufflinks?|jewell?ery|jewelry|gemstones?|milgrain|solitaire|leverback)\b/i;
const JEWELRY_WEAK = /\b(rings?|bands?|clasp|bail|bezel|prongs?|carat|karat|facets?)\b/i;

function looksLikeJewelryText(text) {
  const raw = String(text || "").slice(0, 6000);
  if (!raw) return false;
  if (JEWELRY_STRONG.test(raw)) return true;
  const weakHits = new Set(
    (raw.match(new RegExp(JEWELRY_WEAK.source, "gi")) || []).map((w) =>
      w.toLowerCase(),
    ),
  );
  return weakHits.size >= 2;
}

/** İstek gövdesi ya da kaynak kaydın ayarları ürün modunu söyler. */
function resolveProductVariationMode({ requested, sourceIsProductShot }) {
  const raw = String(requested || "").trim().toLowerCase();
  if (raw === "product") return true;
  if (raw === "pose") return false;
  // İstemci bir şey söylemediyse kaynak kaydın kendisi karar verir: Refiner
  // çıktılarında settings.isRefinerMode === true.
  return sourceIsProductShot === true;
}

/** Ürün modunda promptun sonuna korunum + ayrışma kuralları eklenir. */
function finalizeProductVariationPrompt(prompt, { slot, jewelry = false } = {}) {
  // 💎 TAKI: iki kare de MAKRO, her biri BAŞKA bir detayda (28 Ağu 2026,
  // kullanıcı kararı). Takıda "ikinci katalog açısı" ticari olarak zayıf —
  // alıcı taşı, montürü, kilidi, işçiliği yakından görmek istiyor.
  const jewelrySlotSuffix =
    slot === 3
      ? "\n\nTHIS FRAME IS THE THIRD DETAIL MACRO: it closes in on yet another area, different from " +
        "BOTH earlier macros — a different part, a different angle and a different crop. If the first " +
        "two covered the stone and the clasp, this one goes to the chain links, the band profile, the " +
        "gallery, the engraving or the pavé work. Nothing already shown may be repeated."
      : slot === 2
      ? "\n\nTHIS FRAME IS THE SECOND DETAIL MACRO: it must close in on a COMPLETELY DIFFERENT part of the piece than the first macro. If the first frame goes to the stone and its setting, this one goes elsewhere — the clasp or closure, the hinge, the post or back fitting, the bail, the gallery under the stone, the chain links, the band profile, the engraving or hallmark, the pavé or milgrain work. The two macros must never show the same area, the same angle or the same crop; a shopper should learn something new from this frame."
      : "\n\nTHIS FRAME IS THE FIRST DETAIL MACRO: close in on the single most commercially valuable part of the piece — usually the main stone with its setting and prongs, or the signature design element that defines this product — and let that area fill the frame.";
  const slotSuffix =
    slot === 3
      ? "\n\nTHIS FRAME IS THE THIRD ANGLE: one more genuinely different photograph of the same " +
        "product — a viewing angle, camera height and distance that neither the hero nor the other " +
        "two frames used. It must add information the others could not show."
      : slot === 2
      ? "\n\nTHIS FRAME IS THE DETAIL MACRO: move the camera genuinely close to the single " +
        "most commercially valuable part of this product and let that area fill the frame. The " +
        "whole product does not need to be visible. Render that area with real macro optics — " +
        "true material texture, believable micro-reflections and crisp micro-detail — never an " +
        "upscaled crop of the hero image. Keep the same background and lighting identity."
      : "\n\nTHIS FRAME IS THE SECOND CATALOG ANGLE: show the whole product, or almost all of " +
        "it, from a clearly different viewing angle than the hero and from a closer camera " +
        "distance, so a shopper reads the shape, depth and construction the hero could not show.";
  const jewelryMacroRule = jewelry
    ? "\n\nMACRO REQUIREMENT — BOTH FRAMES OF THIS SET ARE MACRO: this is a true macro photograph taken with a real macro lens, not a digital zoom or an upscaled crop of the hero image. The camera physically moves close to the piece; the chosen detail fills the frame and the rest of the product may fall outside the crop or out of the plane of focus. Render real macro optics: genuine material texture, believable micro-reflections, crisp micro-detail on metal grain, facet edges, prong tips, solder seams, milgrain beads and engraving. Never a wide catalog shot."
    : "";
  return (
    `${String(prompt || "").trim()}\n\n${PRODUCT_VARIATION_PRESERVATION_SUFFIX}` +
    PRODUCT_DIVERGENCE_SUFFIX +
    (jewelry ? jewelryMacroRule + jewelrySlotSuffix : slotSuffix)
  );
}

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
 *
 * 📍 Aynı çağrı ayrıca SAHNE KİLİDİ verisini de çıkarır (1 Eyl 2026): hero'nun
 * mekânını tek cümlede tarif eder ve BAŞKA bir yerde çekilmiş referansları
 * numaralarıyla işaretler. Ürün fotoğrafları modele girdi olarak gitmeye devam
 * ediyor (yan/arka detaylar için şart), fakat nihai prompt artık hem hero'nun
 * mekânını metinle sabitliyor hem de hangi karelerin ortamının çıktıya
 * girmesinin yasak olduğunu numarayla söylüyor.
 */
async function analyzeBackReference(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 2) {
    return {
      hasBackReference: false,
      backReferenceImageNumber: null,
      confidence: "high",
      reason: "No reference images beyond the hero image.",
      heroScene: null,
      offSceneImageNumbers: [],
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

SECOND TASK — SCENE LOCK. Describe the location of image 1 in ONE dense sentence: the
place, its defining architecture or landscape, the surfaces and objects around the subject,
the light source, the time of day and the colour grade. Write it as a photographer would
brief it, so an image model can rebuild that same place from the sentence alone.

THIRD TASK — OFF-SCENE REFERENCES. List the numbers of every image from 2 to ${imageUrls.length}
that was NOT photographed in the location of image 1 — typically the seller's own product
shots taken in a shop, a stockroom, a studio, on a hanger, on a flat surface or against a
plain wall. Judge by the background, the lighting and the colour cast, not by the garment.
If an image shares image 1's location, leave it out of the list. When uncertain, include it.

Return ONLY valid JSON:
{"hasBackReference":true,"backReferenceImageNumber":2,"confidence":"high","reason":"brief visual evidence","heroScene":"one dense sentence describing image 1's location and light","offSceneImageNumbers":[2,3]}

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

    // Sahne kilidi: hero'nun mekânı + ortamı çıktıya girmesi YASAK referanslar.
    const heroScene = String(parsed?.heroScene || "").trim().slice(0, 600) || null;
    const offSceneImageNumbers = Array.from(
      new Set(
        (Array.isArray(parsed?.offSceneImageNumbers)
          ? parsed.offSceneImageNumbers
          : []
        )
          .map((n) => Number(n))
          .filter(
            (n) => Number.isInteger(n) && n >= 2 && n <= imageUrls.length,
          ),
      ),
    ).sort((a, b) => a - b);

    const analysis = {
      hasBackReference,
      backReferenceImageNumber: hasBackReference ? imageNumber : null,
      confidence,
      reason: String(parsed?.reason || "").slice(0, 500),
      heroScene,
      offSceneImageNumbers,
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
      heroScene: null,
      // Analiz yoksa TÜM ek referanslar "başka yerde çekilmiş" sayılır:
      // sahne kaçağına karşı güvenli taraf budur.
      offSceneImageNumbers: Array.from(
        { length: imageUrls.length - 1 },
        (_, i) => i + 2,
      ),
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

The FIRST image is the hero shot that was just produced, and it is the ONLY source of the
scene: the location, background, set, props, weather, time of day, lighting setup and colour
grade of all three frames come from it. Any following images are the seller's own product
photographs of the same garment${
    hasBackReference
      ? `, including a confirmed BACK-SIDE garment reference at image ${backReferenceImageNumber}`
      : ""
}. They exist so the garment stays truthful when the camera moves, so study them: they show
the real construction, seams, closures, trims, hardware, print placement and the side and back
of the piece, and your prompts should describe those details concretely so a side or rear angle
comes out accurate rather than invented. But they were usually shot somewhere else — in a shop,
a stockroom or on a hanger, under different, amateur lighting. Read ONLY the garment from them.
Never let their room, background, rails, hangers, mannequins, floor, lighting or colour cast
enter your prompts; never describe the scene of a following image as if it were the shoot's
location. Every prompt you write must keep the hero's place and light, and must state that
location and its light explicitly.

Invent THREE fresh, premium e-commerce fashion-editorial frames from this exact same
photoshoot. Each frame must have its OWN SUBJECT — not three versions of the same idea:
one carries the full look, one carries the attitude and movement, and one carries the
product's craftsmanship up close. Same shoot, same place, same light — different story. They must be commercially useful on a product detail page and visually
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
one-second side-by-side comparison.

PRODUCT-LED CAMERA PROXIMITY: In both variations, the garment is the primary visual subject,
not the model's full figure or the surrounding set. Silently determine the most commercially
valuable visible area of this specific product, then bring the camera close enough that its
material, construction, fit and distinctive selling features carry the frame. Do not use a
head-to-toe full-body composition. The two images must still choose meaningfully different
proximities, viewpoints, crops and model direction from each other, without adopting a fixed
lens, crop, body gesture or product-interaction formula. When physically natural, art-direct
the model's relationship to the garment in a way that adds product information and visual
interest while keeping important details unobstructed; make this decision uniquely from the
actual garment rather than repeating a standard pose.

SAME-LOCATION PERSPECTIVE VARIATION: Preserve the location's recognizable identity,
architecture, materials, established objects, atmosphere, time of day and physical light
sources, but do not reproduce the hero's background as a fixed flat plate. For each shot,
choose a genuinely different camera position within that same place and reconstruct the
environment with physically coherent perspective, parallax, background layering, relative
scale, surface visibility, occlusion and negative space. The two variations must also show
clearly different environmental viewpoints from each other. Let the chosen camera position
determine the new background composition naturally; do not prescribe or repeat a fixed angle,
and do not invent a different location.

${
    hasBackReference
      ? `Prompt 1 must be a freely art-directed non-back view. Prompt 2 MUST be a rear-facing e-commerce pose that clearly sells the back of the garment, using image ${backReferenceImageNumber} as the exact rear-construction source of truth. Exactly one prompt must be a back view.`
      : `There is NO verified back-side garment reference. Therefore BOTH prompts MUST keep
the model front-facing or in a front three-quarter orientation. The face and the front
construction of the garment must remain clearly visible. Never request a rear-facing,
back-view, over-the-shoulder-away, turned-away or camera-from-behind composition. Do not
invent, infer or hallucinate the garment's back, even if the user note asks for it. Select
two complementary front-safe viewpoints and crop distances appropriate to this garment.`
  }

FRAME 3 IS A CLOSE, IN-SCENE PRODUCT DETAIL: the third prompt moves the camera in close on the
garment as it is worn — the fabric falling at the shoulder, the collar and its stitching, a cuff, a
pocket, a button placket, the hem, a belt or a strap — whatever detail genuinely sells this piece.
It is a CLOSE-UP, not an extreme macro: the crop must still read as a photograph of a person wearing
the garment, keeping a hand, a shoulder line, part of the torso or the fall of the fabric in frame,
never an abstract wall of texture.
CRITICAL — IT STAYS IN THE SAME SCENE: the third frame keeps the hero's environment, daylight,
weather, colour grade and atmosphere. If the hero was shot outdoors, this close-up is still outdoors
with that same background softly present behind the detail; if it was shot in a room, it stays in
that room. Never a studio, never a white sweep, never a flat backdrop, never relit indoors.

Each final prompt must be a self-contained image-editing brief for an image-to-image model.
Explicitly anchor the edit to the reference person, garment and photoshoot. Preserve the
identical face, hair, skin tone, body proportions, garment colour, fabric, cut, pattern,
seams, closures and every product detail. Preserve the same location, set design, physical
lighting setup, light quality, colour grade and time of day while recomposing the space from
a new camera position. Change only pose, body angle,
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

Write each prompt in fluent natural English as a complete and richly visual photographer's
brief. Do not put headings, bullets, numbering or meta-commentary inside either prompt.

Return ONLY valid JSON, nothing else:
{"prompts":["<first prompt>","<second prompt>","<third prompt — the close, in-scene product detail>"]}`;

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
        .slice(0, VARIATIONS_PER_BATCH);
      if (prompts.length === VARIATIONS_PER_BATCH) {
        if (!hasBackReference) {
          const safeFallbacks = fallbackPrompts(false, safeNote);
          const safePrompts = prompts.map((prompt, index) => {
            if (!requestsBackView(prompt)) return prompt;
            logger.warn(
              `⚠️ [VARIATION] Gemini prompt ${index + 1} arka poz istedi; arka referans olmadığı için güvenli fallback kullanılıyor`
            );
            return safeFallbacks[index];
          });
          logger.log(`🤖 [VARIATION] Gemini ${VARIATIONS_PER_BATCH} front-safe prompt üretti`);
          return safePrompts;
        }
        logger.log(`🤖 [VARIATION] Gemini ${VARIATIONS_PER_BATCH} prompt üretti`);
        return prompts;
      }
      if (prompts.length > 0) {
        // Eksik kalan slotlar yedek promptlarla tamamlanır (Gemini bazen 1-2
        // prompt dönüyor; parti hep VARIATIONS_PER_BATCH kare olmalı).
        logger.warn(
          `⚠️ [VARIATION] Gemini ${prompts.length} prompt döndü, ${VARIATIONS_PER_BATCH}'e fallback ile tamamlanıyor`,
        );
        const safeFallbacks = fallbackPrompts(hasBackReference, safeNote);
        return Array.from({ length: VARIATIONS_PER_BATCH }, (_, i) => {
          const p = prompts[i];
          if (!p) return safeFallbacks[i];
          return !hasBackReference && requestsBackView(p) ? safeFallbacks[i] : p;
        });
      }
    }
    logger.warn("⚠️ [VARIATION] Gemini yanıtı ayrıştırılamadı, fallback kullanılıyor");
  } catch (err) {
    logger.warn("⚠️ [VARIATION] Gemini hatası, fallback kullanılıyor:", err.message);
  }

  return fallbackPrompts(hasBackReference, safeNote);
}

/**
 * 💍 ÜRÜN MODU promptları (Refiner çıktıları).
 *
 * Sabit bir açı tarif etmiyoruz: hangi açının bu ürünü sattığını ve hangi
 * detayın "en değerli" olduğunu görseli gören model bizden iyi biliyor. Biz
 * yalnız iki karenin ROLÜNÜ (ikinci katalog açısı / detay makro) ve birbirinden
 * farklı olma zorunluluğunu söylüyoruz.
 */
async function buildProductVariationPrompts({ imageUrls, note, jewelry = false }) {
  const creativeVariationKey = uuidv4().slice(0, 8);
  // 💎 Takıda iki kare de MAKRO ve BAŞKA BİR DETAY (28 Ağu 2026, kullanıcı
  // kararı): ikinci katalog açısı takıda ticari olarak zayıf — alıcı taşı,
  // montürü, kilidi ve işçiliği yakından görmek istiyor.
  const roleBrief = jewelry
    ? `PROMPT 1 — FIRST DETAIL MACRO: a true macro photograph of the single most valuable detail you
identified (usually the main stone with its setting and prongs, or the signature design element
that defines this piece). The camera physically moves close and that area fills the frame; the rest
of the piece may fall outside the crop or out of focus. Describe the craftsmanship concretely —
facet edges, prong tips, metal grain, micro-reflections — so it reads as a real macro shot taken on
set, never a digital zoom.

PROMPT 2 — SECOND DETAIL MACRO: another true macro, but on a COMPLETELY DIFFERENT part of the same
piece. Pick from what this product actually has: the clasp or closure, the hinge, the earring post
or butterfly back, the leverback, the bail, the gallery under the stone, the chain links, the band
profile or its inner surface, the engraving or hallmark, the pavé or milgrain work, the side stones.
It must not repeat the area, the angle or the crop of PROMPT 1.

PROMPT 3 — THIRD DETAIL MACRO: a third true macro on yet another distinct area of the same piece,
different from both PROMPT 1 and PROMPT 2 in the area shown, the angle and the crop.

ALL THREE PROMPTS ARE MACRO. None may be a wide catalog shot of the whole piece. The three must
close in on three different areas so the set teaches a shopper three different things about the
craftsmanship.`
    : `PROMPT 1 — SECOND CATALOG ANGLE: the same product photographed from a genuinely different
camera position than the hero: a different viewing angle, a different rotation of the object
relative to the lens, a different camera height and a closer camera distance, so the shopper
finally reads the depth, the profile and the construction the hero angle could not show.
Almost the whole product stays in frame. Choose the angle from this specific product; do not
apply a fixed template.

PROMPT 2 — DETAIL MACRO: a true macro photograph of the single most valuable detail you
identified. The camera moves physically close to that area and it fills the frame; the rest
of the product may fall outside the crop or out of the plane. Describe that detail
concretely — the material texture, the micro-reflections, the craftsmanship — so the result
reads as a real macro shot taken on set, never as a digital zoom into the hero image.

PROMPT 3 — THIRD ANGLE OR SECOND DETAIL: one more genuinely different frame of the same product —
either another catalog angle that shows a side neither the hero nor PROMPT 1 could show, or a macro
on a DIFFERENT part than PROMPT 2. Pick whichever actually adds information for this product. It
must not repeat the area, angle or crop of the other two.`;
  const instruction = `You are the senior product photographer and retoucher for a
world-class online store. Creative variation key: ${creativeVariationKey}. Use that key
only as an internal diversity cue; never print or mention it.

The FIRST image is the finished catalog photograph of a single product that was just
produced, and it is the ONLY source of the background, lighting and colour grade. Any
following images are the seller's own source photographs of the SAME product, useful only as
extra evidence of its real construction, materials and details. Their backgrounds, surfaces,
tables, packaging, shadows, lighting and snapshot quality are irrelevant and must never enter
the prompts or the output.

Write TWO fresh product photographs of THAT EXACT SAME product, for the same product
detail page. There is no model, no hands and no scene to art-direct — the product itself
is the entire subject.

First perform silent visual analysis: identify what the product is, its category, its
silhouette, its materials and finish, its construction, and — most importantly — which
single area carries the most commercial value for a buyer (the stone and its setting, the
clasp or mechanism, the buckle, the sole unit, the weave or grain of the material, the
engraving, the hinge, the stitching, the logo plate, whatever genuinely sells this piece).

${roleBrief}

THE TWO PROMPTS MUST BE UNMISTAKABLY DIFFERENT FROM EACH OTHER AND FROM THE HERO: different
camera distance, different viewing angle, different visible area of the product and a
different reason for a shopper to look. Two similar angles, or a wide shot plus its own crop,
is a failure.

Both prompts must explicitly command that the hero's background be reproduced EXACTLY: the same
background colour across the whole frame, edge to edge. If it is pure white it must stay pure,
even, seamless white — never grey, cream, washed-out, gradient or vignetted; if it is a colour it
must keep the exact same hue, saturation and brightness — never faded, muted or tinted. Say this in
the macro prompt too, and there especially: a close camera and shallow depth of field must not grey
down, blur or contaminate the background. Neither prompt may introduce a table, surface, backdrop
edge or environmental colour cast that the hero does not have.

Both prompts must preserve the product with absolute fidelity: the same object, silhouette,
proportions, materials, finish, colors, metal tone, stones, texture, pattern, stitching,
hardware, engraving and branding, with nothing added, removed, restyled or invented. Both
keep the hero's clean studio background, background color, soft even lighting and color
grade. Neither may introduce a person, hand, ear, neck, mannequin, display bust, stand, prop,
packaging, fabric, text or watermark. Each output is one single photograph of that one
product, finished to flawless high-end e-commerce retouch quality: razor-sharp focus, crisp
edges, clean surfaces free of dust, lint, scratches and fingerprints, true-to-life color.

Each final prompt must be a self-contained image-editing brief for an image-to-image model, written in
fluent natural English as a complete and richly visual photographer's brief. Avoid
placeholders such as "a different angle": specify the newly chosen camera position, framing
and visible detail concretely. No headings, bullets, numbering or meta-commentary inside
either prompt. Never mention the creative variation key or this analysis process.
${note ? `Additional direction from the user: ${note}\n` : ""}
Return ONLY valid JSON, nothing else:
{"prompts":["<first prompt>","<second prompt>","<third prompt>"]}`;

  try {
    const raw = await callGeminiFlash(instruction, imageUrls, 2);
    console.log(
      `🧠 [VARIATION/PRODUCT] Gemini raw response | key=${creativeVariationKey}:\n${String(raw || "")}`,
    );
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const prompts = (parsed?.prompts || [])
        .filter((p) => typeof p === "string" && p.trim().length > 40)
        .slice(0, VARIATIONS_PER_BATCH);
      if (prompts.length === VARIATIONS_PER_BATCH) {
        logger.log(
          `🤖 [VARIATION/PRODUCT] Gemini ${VARIATIONS_PER_BATCH} ürün promptu üretti`,
        );
        return prompts;
      }
      if (prompts.length > 0) {
        logger.warn(
          `⚠️ [VARIATION/PRODUCT] Gemini ${prompts.length} prompt döndü, ${VARIATIONS_PER_BATCH}'e tamamlanıyor`,
        );
        const fb = productFallbackPrompts(note, jewelry);
        return Array.from(
          { length: VARIATIONS_PER_BATCH },
          (_, i) => prompts[i] || fb[i],
        );
      }
    }
    logger.warn(
      "⚠️ [VARIATION/PRODUCT] Gemini yanıtı ayrıştırılamadı, fallback kullanılıyor",
    );
  } catch (err) {
    logger.warn(
      "⚠️ [VARIATION/PRODUCT] Gemini hatası, fallback kullanılıyor:",
      err.message,
    );
  }
  return productFallbackPrompts(note, jewelry);
}

/** Gemini ulaşılamazsa: yine iki FARKLI kare — ikinci açı + detay makro. */
function productFallbackPrompts(note, jewelry = false) {
  const shared =
    "Photograph the SAME product from reference image 1 with absolute fidelity — identical " +
    "object, silhouette, proportions, materials, finish, colors, texture, pattern, hardware " +
    "and branding — on the SAME clean studio background with the SAME soft even lighting and " +
    "color grade. No people, hands, mannequin parts, stands, props, packaging, text or " +
    "watermark. Reproduce the hero's background EXACTLY, edge to edge: if it is pure white keep it " +
    "pure, even, seamless white, and if it is a colour keep that exact hue, saturation and brightness " +
    "— never grey, faded, washed-out, gradient or vignetted, not even behind a close macro subject. " +
    "One single photorealistic product photograph, razor-sharp focus, crisp edges, clean dust-free " +
    "surfaces, flawless high-end e-commerce retouch.";

  const angles = [
    "a three-quarter view from slightly above, with the product rotated so its depth and profile read clearly",
    "a low three-quarter view close to the surface line, revealing the product's thickness and construction",
    "a near-profile side view that shows the silhouette the frontal hero angle flattened",
    "an elevated angled view that opens up the product's top surface and its interior construction",
  ];
  const details = [
    "the product's most intricate craftsmanship area, filling the frame with true material texture and micro-reflections",
    "the closure, setting or mechanism of the product, rendered in macro with crisp micro-detail",
    "the surface material of the product in macro, where grain, weave, polish or facets become fully readable",
  ];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // 💎 Takıda iki kare de makro; iki FARKLI bölge garantiye alınır.
  if (jewelry) {
    const details = [
      "the main stone with its setting and prongs, filling the frame with crisp facet edges and bright light return",
      "the clasp, closure or hinge of the piece, with the mechanism and polished metal grain fully readable",
      "the chain links, band profile or inner surface, where the metal texture and finishing marks become fully readable",
      "the pavé, milgrain, engraving or hallmark work, shot so the micro-craftsmanship reads clearly",
    ];
    const i = Math.floor(Math.random() * details.length);
    const j = (i + 1) % details.length;
    const k = (i + 2) % details.length;
    const macro = (d) =>
      `Shoot a true macro photograph of ${d}. The camera moves physically close so that area fills ` +
      `the frame; the rest of the piece may fall outside the crop or out of focus. Real macro optics, ` +
      `never a digital zoom of the hero image. ${shared}`;
    const noted = (p) => (note ? `${p} Additional direction: ${note}` : p);
    return [noted(macro(details[i])), noted(macro(details[j])), noted(macro(details[k]))];
  }

  const first =
    `Re-photograph the product as a second catalog angle: ${pick(angles)}, with the camera ` +
    `moved to a genuinely new position and brought closer than the hero shot, so perspective, ` +
    `foreshortening and specular highlights are physically consistent with that new viewpoint. ` +
    `Almost the whole product stays in frame. ${shared}`;

  const second =
    `Shoot a true macro detail of the product: ${pick(details)}. The camera moves physically ` +
    `close so that area fills the frame; the rest of the product may fall outside the crop. ` +
    `Render it with real macro optics rather than a digital zoom of the hero image. ${shared}`;

  // 3. kare: bir başka açı — ilk ikisinin ne açısını ne kadrajını tekrarlar.
  const third =
    `Re-photograph the product from one more genuinely different camera position: ${pick(angles)}, ` +
    `at a camera height and distance that differ from both other frames, so a shopper sees a side ` +
    `neither of them showed. Almost the whole product stays in frame. ${shared}`;

  const withNote = (p) => (note ? `${p} Additional direction: ${note}` : p);
  return [withNote(first), withNote(second), withNote(third)];
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
    "location with the SAME physical lighting setup, quality and colour grade as the reference, " +
    "but reconstruct the same place from a clearly different, physically coherent camera " +
    "position with new perspective, parallax, background layering and object relationships. " +
    "Use a close, product-led composition in which the garment dominates the frame; do not " +
    "use a head-to-toe full-body view. " +
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
    "a close product-dominant crop with balanced product-page negative space",
    "a garment-led viewpoint that fills the frame while preserving natural proportions",
    "a detail-conscious crop with a refined off-center composition",
    "an intimate product-first composition with controlled editorial depth",
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

  // 3. kare: SAHNEDE KALAN yakın ürün detayı (28 Ağu 2026). Stüdyoya kaçmaz,
  // makroya boğulmaz — hâlâ "giyen birinin fotoğrafı" gibi okunur.
  const details = [
    "the collar and shoulder line, with the stitching and the way the fabric falls",
    "a cuff and the wearer's hand, showing the sleeve construction and the fabric's weight",
    "the button placket and chest area, where the fabric texture and the seams read clearly",
    "the hem or waist, showing how the garment drapes and finishes on the body",
  ];
  const third =
    `Move the camera in CLOSE on ${details[Math.floor(Math.random() * details.length)]}. ` +
    "This is a close-up, NOT an extreme macro: the crop must still read as a photograph of a " +
    "person wearing the garment — keep a hand, a shoulder line, part of the torso or the fall of " +
    "the fabric in frame, never an abstract wall of texture. It stays in the SAME environment as " +
    "the reference: same location, same daylight or lamp light, same weather, same colour grade, " +
    "with that background still softly present behind the detail. Never a studio, never a white " +
    `sweep, never a flat backdrop, never relit indoors. ${shared}`;

  const withNote = (p) =>
    safeNote ? `${p} Additional direction: ${safeNote}` : p;
  return [withNote(first), withNote(second), withNote(third)];
}

/**
 * 📍 SAHNE KİLİDİ bloğu. Ürün fotoğrafları modele girdi olarak gitmeye devam
 * ettiği için (yan/arka pozlarda kıyafetin gerçek detayı onlardan okunuyor),
 * mekân kaçağını bu blok kesiyor: hero'nun mekânı metinle sabitleniyor ve
 * başka yerde çekilmiş referanslar NUMARALARIYLA "ortamı yasak" ilan ediliyor.
 * Modele "şu görsellere bakma" değil, "şu görsellerden yalnız kumaşı oku,
 * mekânını okuma" deniyor — kıyafet doğruluğu korunuyor, sahne sızmıyor.
 */
function buildSceneLockSuffix({ heroScene, offSceneImageNumbers, imageCount }) {
  const referenceCount = Math.max(0, Number(imageCount) || 0) - 1;
  if (referenceCount <= 0) return "";

  const offScene = Array.isArray(offSceneImageNumbers)
    ? offSceneImageNumbers.filter((n) => Number.isInteger(n) && n >= 2)
    : [];
  const offSceneLabel =
    offScene.length === 0
      ? null
      : offScene.length === 1
        ? `reference image ${offScene[0]}`
        : `reference images ${offScene.slice(0, -1).join(", ")} and ${
            offScene[offScene.length - 1]
          }`;

  return (
    "\n\nMANDATORY SCENE LOCK — WHERE THIS PHOTOGRAPH IS TAKEN: " +
    (heroScene
      ? `The shoot happens here and nowhere else: ${
          /[.!?]$/.test(heroScene.trim()) ? heroScene.trim() : `${heroScene.trim()}.`
        } `
      : "The shoot happens in the location of reference image 1 and nowhere else. ") +
    "Reference image 1 is the ONLY source of the location, background, set, props, floor, " +
    "walls, surfaces, weather, time of day, light sources, light direction, shadows and " +
    `colour grade. Reference images 2 to ${referenceCount + 1} are PRODUCT-TRUTH references ` +
    "and they are essential: read the garment's real construction, cut, seams, closures, " +
    "trims, hardware, print placement, colour and its side and back detail from them, and " +
    "use that knowledge to render the garment correctly from the new angle. But read ONLY " +
    "the garment from them. " +
    (offSceneLabel
      ? `${offSceneLabel.charAt(0).toUpperCase()}${offSceneLabel.slice(1)} ` +
        `${offScene.length === 1 ? "was" : "were"} photographed somewhere else entirely; ` +
        `that place must not appear in the output. `
      : "") +
    "Never import a shop interior, stockroom, studio, plain wall, seamless sweep, table, " +
    "hanger, rail, shelf, mirror, mannequin, bystander, packaging, floor, artificial or " +
    "flash lighting, or colour cast from any reference other than image 1 — not in the " +
    "background, not at the frame edges, not reflected, not blurred behind the subject and " +
    "not as a change of light on the garment. If the finished frame could be mistaken for a " +
    "photograph taken where the product references were taken, the edit has failed."
  );
}

/** Gemini/fallback çıktısını üretim modeline gidecek nihai prompta dönüştürür. */
function finalizeVariationPrompt(
  prompt,
  {
    forceBackView = false,
    forbidBackView = false,
    backReferenceImageNumber,
    inSceneDetail = false,
    heroScene = null,
    offSceneImageNumbers = [],
    imageCount = 0,
  } = {}
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
  // 🔍 3. kare SAHNEDE KALAN yakın detay (28 Ağu 2026): Gemini'nin yazdığı
  // metin ne olursa olsun backend "stüdyoya kaçma, aynı mekânda kal" diyor.
  const inSceneDetailSuffix = inSceneDetail
    ? "\n\nTHIS FRAME IS THE CLOSE, IN-SCENE PRODUCT DETAIL: move the camera in close on the garment " +
      "as it is worn — the collar and its stitching, a cuff with the wearer's hand, the button placket, " +
      "a pocket, the hem, a belt or a strap. It is a CLOSE-UP, not an extreme macro: the crop must still " +
      "read as a photograph of a person wearing the garment, keeping a hand, a shoulder line, part of the " +
      "torso or the fall of the fabric in frame — never an abstract wall of texture. " +
      "IT STAYS IN THE SAME SCENE: same location, same daylight or lamp light, same weather, same colour " +
      "grade and atmosphere as the reference, with that background still softly present behind the detail. " +
      "If the reference was shot outdoors, this frame is still outdoors. Never a studio, never a white " +
      "sweep, never a flat backdrop, never relit indoors, never a product-only packshot."
    : "";
  return (
    `${String(prompt || "").trim()}\n\n${VARIATION_PRESERVATION_SUFFIX}` +
    POSE_DIVERGENCE_SUFFIX +
    ENVIRONMENT_PERSPECTIVE_SUFFIX +
    buildSceneLockSuffix({ heroScene, offSceneImageNumbers, imageCount }) +
    inSceneDetailSuffix +
    backViewSuffix +
    noBackViewSuffix
  );
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
        "reference_images, location_image, pose_image, hair_style_image, aspect_ratio, settings, original_prompt, enhanced_prompt",
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
      return {
        inputs: [],
        excludedLocationImages: [],
        aspectRatio: null,
        isProductShot: false,
        isJewelry: false,
      };
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
        data?.pose_image,
        data?.hair_style_image,
        settings?.backImage,
        settings?.backSideImage,
        settings?.styleReferenceImage,
        settings?.poseImage,
      ],
      // Client aynı location URL'sini generic referenceImages içinde yeniden
      // gönderebilir. Toplayıcı bu listeyi URL query/hash farklarından bağımsız
      // olarak filtreler; konum görseli NB Lite'a hiçbir akıştan ulaşmaz.
      excludedLocationImages: [
        data?.location_image,
        settings?.locationImage,
      ],
      // "original" seçeneğinde alanı göndermemek gerekir; NB Lite bu durumda
      // edit kaynağının gerçek oranını varsayılan davranışıyla korur.
      aspectRatio: normalizeVariationAspectRatio(data?.aspect_ratio),
      // 💍 Refiner çıktısı mı? Öyleyse çeşitlendirme ÜRÜN modunda çalışır
      // (poz/mekân değil, ikinci açı + detay makro).
      isProductShot: settings?.isRefinerMode === true,
      // 💎 Takı mı? Takıda İKİ varyant da MAKRO olur (28 Ağu 2026, kullanıcı
      // isteği): ikinci katalog açısı yerine iki FARKLI detayın makrosu.
      // Önce kayıtlı kategori, o yoksa (eski üretimler) prompt metni.
      isJewelry:
        JEWELRY_SOURCE_CATEGORIES.has(
          String(settings?.productCategory || "").toLowerCase(),
        ) ||
        JEWELRY_SOURCE_CATEGORIES.has(
          String(settings?.productSubtype || "").toLowerCase(),
        ) ||
        looksLikeJewelryText(
          `${settings?.productSubtype || ""} ${data?.enhanced_prompt || ""} ${data?.original_prompt || ""}`,
        ),
    };
  } catch (error) {
    logger.warn(
      `⚠️ [VARIATION] Kaynak referans istisnası (${sourceGenerationId}):`,
      error?.message || error,
    );
    return {
      inputs: [],
      excludedLocationImages: [],
      aspectRatio: null,
      isProductShot: false,
      isJewelry: false,
    };
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
    // Gemini'nin yazdığı ve modele aynen gönderilen nihai prompt.
    console.log(
      `🎨 [VARIATION] GPT Image 2 prompt | generation=${generationId} | ` +
        `model=${VARIATION_MODEL} | input_images=${imageUrls.length} | ` +
        `image_size=${mapRatioToGptImage2Size(aspectRatio)} quality=${VARIATION_QUALITY}` +
        ` (kaynak oran ${aspectRatio || "varsayılan"}):\n${prompt}`
    );

    // 🛟 Önce GPT Image 2; HERHANGİ bir hata gelirse AYNI prompt Nano Banana
    // Lite ile bir kez tekrarlanır.
    // ⚠️ 30 Ağu 2026 — eskiden yedek yalnız İKİ noktada devreye giriyordu:
    // submit'in kendisi patlarsa ve kuyruk durumu FAILED dönerse. GPT Image 2'nin
    // 422 "Unprocessable Entity"si ise çoğunlukla `queue.status`/`queue.result`
    // çağrısından fırlıyor; o yol yedeğe UĞRAMADAN dış catch'e düşüyor ve
    // varyant "failed" kalıyordu (kullanıcı raporu: parti yarım kalıyor).
    // Artık submit + polling + sonuç okuma TEK denemede toplandı; bu denemenin
    // her hatası yedeğe geçiriyor.
    const submitAndWait = async (model, settings) => {
      const { request_id } = await fal.queue.submit(model, {
        input: {
          prompt,
          image_urls: imageUrls,
          ...settings,
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

      logger.log(
        `⏳ [VARIATION] ${generationId} fal kuyruğuna girdi (${request_id}) | model=${model}`,
      );

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const statusResult = await fal.queue.status(model, {
          requestId: request_id,
          logs: false,
        });

        if (statusResult.status === "COMPLETED") {
          const finalResult = await fal.queue.result(model, {
            requestId: request_id,
          });
          const url = finalResult?.data?.images?.[0]?.url;
          if (!url) throw new Error("Sonuçta görsel yok");
          return url;
        }

        if (statusResult.status === "FAILED" || statusResult.status === "ERROR") {
          throw new Error("varyasyon üretimi başarısız");
        }
      }

      throw new Error("fal polling zaman aşımı");
    };

    let temporaryResultUrl;
    try {
      temporaryResultUrl = await submitAndWait(
        VARIATION_MODEL,
        getVariationModelSettings(aspectRatio),
      );
    } catch (gptError) {
      const detail =
        gptError?.body?.detail ||
        gptError?.response?.data?.detail ||
        gptError?.message ||
        "bilinmeyen hata";
      logger.warn(
        `🛟 [VARIATION] GPT Image 2 başarısız (${String(detail).slice(0, 140)}) — ` +
          `${generationId} Nano Banana Lite ile tekrarlanıyor`,
      );
      temporaryResultUrl = await submitAndWait(
        VARIATION_FALLBACK_MODEL,
        getVariationFallbackSettings(aspectRatio),
      );
    }

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
    excludedImages: sourceContext.excludedLocationImages,
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
  // Deterministik id'ler: aynı completion iki kez işlense bile UNIQUE ikinci
  // fal üretimini engelliyor. Sayı VARIATIONS_PER_BATCH'e bağlı.
  const generationIds = Array.from(
    { length: VARIATIONS_PER_BATCH },
    (_, i) => `var_auto_${stableSourceId}_${i + 1}`,
  );
  // 💍 Refiner çıktısında ÜRÜN modu: manken/poz/arka-görünüm talimatları
  // geçersiz — iki kare "ikinci katalog açısı" + "detay makro" olur. Model
  // seçimi de buna bağlı (Refiner → GPT Image 2 "low"), o yüzden satırlar
  // yazılmadan ÖNCE hesaplanmalı.
  const productMode = sourceContext.isProductShot === true;

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
  let backAnalysis = null;
  try {
    if (productMode) {
      logger.log(
        `💍 [TRIAL_VARIATION] Ürün modu (Refiner kalıbı)${
          sourceContext.isJewelry ? " · TAKI: iki kare de makro" : ""
        } — kaynak: ${sourceGenerationId}`,
      );
      const jewelrySource = sourceContext.isJewelry === true;
      const creativePrompts = await buildProductVariationPrompts({
        imageUrls,
        note: null,
        jewelry: jewelrySource,
      });
      prompts = creativePrompts.map((prompt, index) =>
        finalizeProductVariationPrompt(prompt, {
          slot: index + 1,
          jewelry: jewelrySource,
        }),
      );
    } else {
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
          // 3. kare: sahnede kalan yakın ürün detayı
          inSceneDetail: index === 2,
          // 📍 Sahne kilidi: mekân hero'dan, kumaş ürün karelerinden.
          heroScene: backAnalysis.heroScene,
          offSceneImageNumbers: backAnalysis.offSceneImageNumbers,
          imageCount: imageUrls.length,
        }),
      );
    }

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
              variationMode: productMode ? "product" : "pose",
              ...(backAnalysis ? { backReferenceAnalysis: backAnalysis } : {}),
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
      // 💍 "product" → Refiner kalıbı (ikinci açı + detay makro).
      // Gönderilmezse kaynak kaydın settings.isRefinerMode'u karar verir.
      variationMode = null,
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
      excludedImages: sourceContext.excludedLocationImages,
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

    // 💍 ÜRÜN MODU (Refiner) — manken yok, poz/arka-görünüm analizi anlamsız.
    // Doğrudan iki ürün karesi yazılır: ikinci katalog açısı + detay makro.
    const productMode = resolveProductVariationMode({
      requested: variationMode,
      sourceIsProductShot: sourceContext.isProductShot,
    });

    let backAnalysis = null;
    let prompts;
    if (productMode) {
      logger.log(
        `💍 [VARIATION] Ürün modu (Refiner kalıbı)${
          sourceContext.isJewelry ? " · TAKI: iki kare de makro" : ""
        } — kaynak: ${sourceGenerationId}`,
      );
      // 💎 Takıda iki kare de MAKRO (28 Ağu 2026): ikinci katalog açısı yerine
      // iki FARKLI detayın makrosu.
      const jewelrySource = sourceContext.isJewelry === true;
      const creativePrompts = await buildProductVariationPrompts({
        imageUrls,
        note,
        jewelry: jewelrySource,
      });
      prompts = creativePrompts.map((prompt, index) =>
        finalizeProductVariationPrompt(prompt, {
          slot: index + 1,
          jewelry: jewelrySource,
        }),
      );
    } else {
      // 1) Gemini önce referans havuzunda gerçek bir arka kıyafet görünümü arar.
      // 2) Sonra bu karara göre iki editoryal prompt yazar.
      backAnalysis = await analyzeBackReference(imageUrls);
      const creativePrompts = await buildVariationPrompts({
        imageUrls,
        backAnalysis,
        note,
      });
      // Bu dizi hem DB'ye yazılır hem fal çağrısına gider; loglanan ve
      // saklanan prompt ile üretim modelinin aldığı prompt birebir aynıdır.
      prompts = creativePrompts.map((prompt, index) =>
        finalizeVariationPrompt(prompt, {
          // Arka referans bulunduysa ikinci üretimi backend seviyesinde de zorla.
          forceBackView: backAnalysis.hasBackReference && index === 1,
          // Referans yoksa arka pozu backend seviyesinde yasakla.
          forbidBackView: !backAnalysis.hasBackReference,
          backReferenceImageNumber: backAnalysis.backReferenceImageNumber,
          // 3. kare: sahnede kalan yakın ürün detayı
          inSceneDetail: index === 2,
          // 📍 Sahne kilidi: mekân hero'dan, kumaş ürün karelerinden.
          heroScene: backAnalysis.heroScene,
          offSceneImageNumbers: backAnalysis.offSceneImageNumbers,
          imageCount: imageUrls.length,
        }),
      );
    }

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
        variationMode: productMode ? "product" : "pose",
        ...(backAnalysis ? { backReferenceAnalysis: backAnalysis } : {}),
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
        `mod=${
          productMode
            ? sourceContext.isJewelry
              ? "ürün · TAKI (iki farklı detay makrosu)"
              : "ürün (ikinci açı + detay makro)"
            : "poz"
        } | ` +
        `back-reference=${
          !backAnalysis
            ? "yok (ürün modu)"
            : backAnalysis.hasBackReference
              ? `image ${backAnalysis.backReferenceImageNumber}`
              : "none"
        }` +
        `${
          backAnalysis
            ? ` | sahne kilidi=${backAnalysis.heroScene ? "var" : "yok"} · ` +
              `ortamı yasak görseller=${
                backAnalysis.offSceneImageNumbers?.length
                  ? backAnalysis.offSceneImageNumbers.join(",")
                  : "yok"
              }`
            : ""
        }`
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
