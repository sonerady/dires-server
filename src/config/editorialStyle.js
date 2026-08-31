// 🎞️ EDITORIAL MODE — dahili stil referans havuzu.
//
// Kullanıcı bir stil profili veya stil referansı SEÇMESE bile, "Editorial Mod"
// açıkken her üretime elle seçilmiş profesyonel moda çekimlerinden oluşan
// kolajlar eklenir. Amaç, modele bir TEKNİK REPERTUAR (ışık, kompozisyon,
// objektif, grade, yönetmenlik) sunmak — kopyalanacak bir sahne değil.
//
// Kolajlar ve analiz metinleri `scripts/build_editorial_style.js` tarafından
// üretilip `editorialStyle.json` dosyasına yazılır. Bu modül o dosyayı okur;
// dosya yoksa editorial mod sessizce devre dışı kalır (üretim normal akar).

const path = require("path");
const logger = require("../utils/logger");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const data = require(path.join(__dirname, "editorialStyle.json"));
    const collages = Array.isArray(data?.collages)
      ? data.collages.filter((c) => c && typeof c.url === "string" && c.url)
      : [];
    cache = { ...data, collages };
    if (collages.length === 0) {
      logger.warn("🎞️ [EDITORIAL] editorialStyle.json var ama kullanılabilir kolaj yok");
    }
  } catch (err) {
    // Hatayı KALICI olarak önbelleğe alma: script sonradan çalıştırılıp dosya
    // oluşturulduğunda, sunucuyu yeniden başlatmadan da devreye girebilsin.
    cache = null;
    logger.warn(
      "🎞️ [EDITORIAL] editorialStyle.json okunamadı — editorial mod devre dışı:",
      err?.message,
    );
    return { collages: [] };
  }
  return cache;
}


// ─────────────────────────────────────────────────────────────
// Uzaktan kill switch — app_config.editorial_mode_visible
//
// Butonu istemcide gizlemek yeterli değil: eski sürümdeki istemciler hâlâ
// editorialMode:true gönderebilir. Bu yüzden sunucu da aynı anahtarı okuyor.
// 60 sn cache — her üretimde DB'ye gitmesin.
// ─────────────────────────────────────────────────────────────
let remoteFlagCache = { value: true, at: 0 };
const REMOTE_FLAG_TTL_MS = 60 * 1000;

async function isEditorialEnabledRemotely() {
  const now = Date.now();
  if (now - remoteFlagCache.at < REMOTE_FLAG_TTL_MS) {
    return remoteFlagCache.value;
  }
  try {
    // eslint-disable-next-line global-require
    const { supabase } = require("../supabaseClient");
    const { data, error } = await supabase
      .from("app_config")
      .select("platform, editorial_mode_visible");
    if (error) throw new Error(error.message);
    // Sunucu isteğin platformunu bilmiyor; bu yüzden burası GLOBAL kill switch:
    // yalnızca TÜM satırlar false olduğunda kapanır. Tek platformu kapatmak
    // istemci tarafında (buton gizlenir) hallediliyor.
    const rows = Array.isArray(data) ? data : [];
    const value =
      rows.length === 0 ||
      rows.some((row) => row?.editorial_mode_visible !== false);
    remoteFlagCache = { value, at: now };
    return value;
  } catch (err) {
    logger.warn(
      "🎞️ [EDITORIAL] app_config okunamadı, özellik açık kabul ediliyor:",
      err?.message,
    );
    remoteFlagCache = { value: true, at: now };
    return true;
  }
}

/**
 * Kolaj GÖRSELLERİ isteğe eklensin mi?
 *
 * Varsayılan: HAYIR (yalnızca metin repertuarı gönderilir).
 * Neden: kolajlarda onlarca kişi var ve görüntü modelleri ekli fotoğraflardaki
 * yüzleri yeniden kullanmaya meyilli — prompt bunu azaltıyor ama sıfırlamıyor.
 * Sonuçlarda tekrar eden yüzler bu yüzden çıkıyordu. Metin repertuarı somut
 * sayılarla (mm, diyafram, Kelvin, grain) yazıldığı için ustalık kazancının
 * çoğunu görselsiz de sağlıyor.
 *
 * Açmak için: editorialStyle.json içine "attachCollages": true
 * ya da ortam değişkeni EDITORIAL_ATTACH_COLLAGES=true
 */
function shouldAttachCollages() {
  const env = process.env.EDITORIAL_ATTACH_COLLAGES;
  if (typeof env === "string" && env.trim() !== "") {
    return env.trim().toLowerCase() === "true";
  }
  return load().attachCollages === true;
}

/** Editorial mod için kullanılabilir kolajlar var mı? */
function isEditorialAvailable() {
  return load().collages.length > 0;
}

/** Kolaj kayıtları: [{ index, url, frameCount, analysis }] */
function getEditorialCollages() {
  return load().collages;
}

// ─────────────────────────────────────────────────────────────
// Varyasyon direktifleri
//
// Aynı kolajlar HER üretimde gönderildiği için model, zamanla aynı birkaç
// "güvenli" yoruma yakınsıyor. Her istekte rastgele bir yaratıcı yön seçip
// prompt'a eklemek bu yakınsamayı kırar.
// ─────────────────────────────────────────────────────────────
const VARIATION_DIRECTIVES = [
  "Pick a WIDE, environmental treatment this time: shorter focal length feel (28-35mm), the subject placed within a larger scene, generous negative space.",
  "Pick a COMPRESSED treatment this time: long-lens feel (85-135mm), flattened perspective, tight background separation and creamy falloff.",
  "Pick a HARD-LIGHT treatment this time: a single crisp key with defined shadow edges, strong shape and contrast on the subject.",
  "Pick a SOFT, diffused treatment this time: broad wrapping light, gentle shadow transitions, low-contrast elegance.",
  "Pick a BACKLIT treatment this time: light behind the subject, rim separation, some atmospheric haze or flare handled tastefully.",
  "Pick a LOW-ANGLE treatment this time: camera below eye level, powerful and statuesque framing.",
  "Pick a HIGH-ANGLE or eye-level candid treatment this time: relaxed, documentary-flavoured editorial energy.",
  "Pick a MOVEMENT-driven treatment this time: mid-step, turning, fabric and hair in motion, a caught-in-the-moment feel.",
  "Pick a STILL, sculptural treatment this time: composed stance, deliberate hands, quiet tension, poster-like stillness.",
  "Pick a COOL, desaturated grade this time: restrained palette, controlled contrast, modern minimal finish.",
  "Pick a WARM, film-like grade this time: warm neutrals, gentle highlight roll-off, subtle grain.",
  "Pick a HIGH-CONTRAST graphic treatment this time: deep blacks, decisive geometry in the composition.",
  "Pick a TIGHT editorial crop this time: waist-up or three-quarter framing that emphasises garment detail and attitude.",
  "Pick a FULL-BODY treatment this time: complete silhouette, feet in frame, strong posture line.",
];

/** İstek başına rastgele bir yaratıcı yön seçer. */
function pickVariationDirective() {
  const i = Math.floor(Math.random() * VARIATION_DIRECTIVES.length);
  return VARIATION_DIRECTIVES[i];
}

/**
 * Editorial mod prompt bloğu.
 *
 * ÖNEMLİ: Bu blok, stil profili modundan FARKLI olarak normal (Gemini ile
 * zenginleştirilmiş) prompt'un SONUNA eklenir. Böylece kullanıcının seçtiği
 * mekân, poz, kadraj, hava durumu, model parametreleri vb. AYNEN geçerli kalır;
 * kolajlar yalnızca fotoğrafik ustalık katar.
 *
 * @param {number} collageCount  Eklenen kolaj sayısı (prompt'ta işaret etmek için)
 * @param {string[]} analyses    Kolaj başına Gemini analizi (varsa)
 * @param {string} variation     pickVariationDirective() çıktısı
 */
function buildEditorialPromptBlock({
  collageCount = 1,
  analyses = [],
  variation = "",
  codes = [],
  withImages = false, // kolaj görselleri isteğe ekleniyor mu?
} = {}) {
  // Kolajların altında kendi kod plakaları var ("EDITORIAL REFERENCE · CODE ER-1").
  // Prompt bunlara konumla DEĞİL, isimle atıf yapıyor — stil referansı akışındaki
  // SR-1 deseniyle aynı mantık; model hangi görselin ne olduğunu şaşırmasın.
  const codeList = (codes || []).filter(Boolean);
  const named =
    codeList.length > 0
      ? codeList.map((c) => `"${c}"`).join(" and ")
      : null;

  const pointer = named
    ? `The attached image${codeList.length > 1 ? "s" : ""} carrying a solid BLACK plate along the bottom edge with the printed text "EDITORIAL REFERENCE · CODE ${codeList.join('" and "EDITORIAL REFERENCE · CODE ')}" (${codeList.length > 1 ? `they are the LAST ${collageCount} attached images` : "it is the LAST attached image"})`
    : collageCount > 1
      ? `The LAST ${collageCount} attached images (each is a white-background grid of many small photographs)`
      : `The LAST attached image (a white-background grid of many small photographs)`;

  // 🚫 + 🎭 Kimlik duvarı ve casting yönü (20 Ağu 2026, kullanıcı isteği):
  // Sokak Stili'ndeki IDENTITY FIREWALL editoryalde de birebir uygulanır —
  // kullanıcının ürün fotoğrafındaki kişi dahil hiçbir referans yüzü çıktıya
  // taşınamaz. Casting: editoryal karaktere uygun çarpıcı, güzel kemik yapılı,
  // vahşi bakışlı GERÇEKÇİ yüzler (jenerik katalog güzelliği değil).
  const IDENTITY_FIREWALL = `🚫 EDITORIAL IDENTITY FIREWALL (ABSOLUTE, HIGHEST PRIORITY): Any person visible in ANY attached reference image — including the person wearing the garment in the USER'S OWN product photo — is legally OFF-LIMITS as a face source. The output model must be a COMPLETELY DIFFERENT human being: rebuild every identity-bearing feature from scratch — face shape, facial proportions, eye shape and colour, brows, nose, lips, cheekbones, jawline, hairline — so the output fails any same-person, look-alike or celebrity-match comparison with every reference person. If the user supplied an explicit MODEL REFERENCE elsewhere in this prompt, that user-provided identity is the ONLY allowed face source; otherwise cast a brand-new, unrecognizable photoreal person. Copying, approximating or subtly echoing a reference person's face is a hard failure with legal consequences — when in doubt, make the person MORE different, never less.`;

  const EDITORIAL_CASTING = `🎭 EDITORIAL CASTING — FIERCE, SCULPTED FACES: Cast the new model the way a top editorial casting director would: a striking, memorable, high-fashion face with beautiful, strong bone structure — sculpted cheekbones, a defined jawline, an elegant brow line and an intense, magnetic gaze with real attitude. Avoid safe, generic, commercial "catalog prettiness"; the face must read as a discovered runway model in a serious campaign. Keep it fully PHOTOREALISTIC — real skin texture with visible pores and natural micro-detail, no beautification blur, no plastic smoothness — and always obey the user's explicit gender, age and model-attribute selections stated earlier in this prompt; this casting direction shapes the CHARACTER of the face, never those selections.`;

  const sections = [];

  // ── GÖRSELSİZ MOD ──────────────────────────────────────────────
  // Kolajlar eklenmiyor; yalnızca yönetmen notları gidiyor. Kimlik/kıyafet/mekân
  // sızıntısı riski sıfır olduğu için yasak listesine de gerek kalmıyor.
  if (!withImages) {
    const notes = (analyses || []).map((a) => (a || "").trim()).filter(Boolean);
    sections.push(`🎬 EDITORIAL CRAFT STANDARD — HOW TO PHOTOGRAPH THIS SCENE

Shoot the scene described above to the craft standard of high-end fashion editorial. The notes below were distilled by a director of photography from a curated library of professional fashion photographs. They describe TECHNIQUE ONLY — no scene, no wardrobe, no person, nothing to copy.`);

    if (notes.length > 0) {
      sections.push(`EDITORIAL TECHNIQUE REPERTOIRE (draw from this library, do not average it):
${notes.join("\n\n")}`);
    }

    sections.push(`⚠️ USER'S CHOICES OUTRANK THESE NOTES (NON-NEGOTIABLE): Every instruction stated earlier in this prompt — the garment(s), location/background, pose, framing, model attributes, colours, weather, time of day and any user detail directive — takes ABSOLUTE priority. These notes may only influence HOW the scene is photographed (light, lens, composition, grade, direction), never WHAT is photographed.`);

    sections.push(`🎲 VARY EVERY TIME (IMPORTANT): This same repertoire is applied to EVERY generation, so there is a strong risk of converging on the same handful of looks. Deliberately choose a DIFFERENT combination of techniques than the most obvious or most average one.${variation ? `\n${variation}` : ""}
Whatever you choose must still serve the user's garment and the user's stated choices — variety in CRAFT, never in CONTENT.`);

    sections.push(IDENTITY_FIREWALL);
    sections.push(EDITORIAL_CASTING);

    return sections.join("\n\n");
  }

  // ── GÖRSELLİ MOD ───────────────────────────────────────────────
  sections.push(`⚠️ EDITORIAL CRAFT REFERENCE — READ CAREFULLY

${pointer} ${collageCount > 1 ? "are" : "is"} an EDITORIAL CRAFT REFERENCE: a collage of many unrelated professional fashion photographs. ${collageCount > 1 ? "They are" : "It is"} NOT a scene to rebuild and NOT a brand look to copy. Treat ${collageCount > 1 ? "them" : "it"} strictly as a LIBRARY OF PHOTOGRAPHIC TECHNIQUE — the way a director of photography studies references before a shoot.

TAKE ONLY THIS from the reference frames:
- lighting design (key direction, hardness, fill ratio, rim/backlight, how shadows fall),
- camera craft (focal-length feel, aperture/depth-of-field behaviour, camera height, angle, crop),
- composition and framing discipline (subject placement, negative space, lines, balance),
- colour grade and finish (palette, contrast curve, white-balance bias, grain, highlight roll-off),
- posing direction, body language, weight, gesture and gaze,
- overall art direction and editorial polish.

🚫 NEVER TAKE THESE (NON-NEGOTIABLE):
- PEOPLE. No person from any reference frame may appear in the output. Do not copy any face, facial structure, hair, body, skin tone, tattoo, mole or distinctive feature. The model in the output must be a completely NEW, original person who could not be mistaken for anyone in the reference.
- GARMENTS. No clothing, shoe, bag, jewellery or accessory from the reference frames. The attached product photo(s) are the ONLY source of what the model wears.
- LOCATIONS. Do not rebuild, mirror or lightly remix any pictured street, building, room, shopfront or backdrop.
- ONE-OFF PROPS. Motorcycles, scooters, parked cars, bicycles, signage, graffiti, specific chairs, plants, storefronts and similar incidental objects are coincidences of those shoots, not part of the craft. Never carry them over.
- SCREENSHOT CHROME. Some frames were captured from web shops and still show interface leftovers — carousel arrows, pagination dots, small overlay icons, cursors, thin white gutters between frames. These are capture artefacts, not photography. Never reproduce any arrow, dot, icon, button or UI element.
- THE CODE PLATE. The black "EDITORIAL REFERENCE · CODE ER-n" bar is an INPUT-ONLY marker that tells you which attached images are references. It must NEVER appear in the output — no plate, bar, text, watermark or label at any edge.
- THE GRID ITSELF. Never render a collage, grid, contact sheet, split frame, border or caption in the output. The result must be ONE single clean, full-bleed photograph with no text or watermark at any edge.`);

  sections.push(`⚠️ USER'S CHOICES OUTRANK THE REFERENCE (NON-NEGOTIABLE): Every instruction stated earlier in this prompt — the garment(s), location/background, pose, framing, model attributes, colours, weather, time of day and any user detail directive — takes ABSOLUTE priority. The editorial reference may only influence HOW the scene is photographed (light, lens, composition, grade, direction), never WHAT is photographed. If a reference frame suggests anything that conflicts with the user's choices, discard the reference and follow the user.`);

  const cleanedAnalyses = (analyses || []).map((a) => (a || "").trim()).filter(Boolean);
  if (cleanedAnalyses.length > 0) {
    sections.push(`EDITORIAL TECHNIQUE REPERTOIRE (a director of photography's notes distilled from the plated reference frames — draw from this library, do not average it):
${cleanedAnalyses.join("\n\n")}`);
  }

  sections.push(`🎲 VARY EVERY TIME (IMPORTANT): These exact reference collages are attached to EVERY generation, so there is a strong risk of converging on the same handful of looks. Deliberately choose a DIFFERENT combination of techniques from the repertoire than the most obvious or most average one. Do not default to the same lighting, lens and pose you would usually pick.${variation ? `\n${variation}` : ""}
Whatever you choose must still serve the user's garment and the user's stated choices — variety in CRAFT, never in CONTENT.`);

  sections.push(IDENTITY_FIREWALL);
  sections.push(EDITORIAL_CASTING);

  return sections.join("\n\n");
}


module.exports = {
  isEditorialAvailable,
  isEditorialEnabledRemotely,
  shouldAttachCollages,
  getEditorialCollages,
  pickVariationDirective,
  buildEditorialPromptBlock,
  EDITORIAL_VARIATION_DIRECTIVES: VARIATION_DIRECTIVES,
};
