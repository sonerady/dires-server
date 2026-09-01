// 🌟 AUTO GLOBAL STYLE — stil seçmeyen üretimlere gizli "house style" katmanı.
//
// Kullanıcı bir stil profili/referansı SEÇMEDİĞİNDE, küratörlü global çekim
// tarzlarından (style_profiles.user_id = 'global') biri arka planda atanır:
//
//   FULL mod — kullanıcı bir mekân/arka plan seçmediyse: route styleProfileId'yi
//     doldurur ve MEVCUT stil pipeline'ı aynen
//     çalışır (kolaj + kompakt prompt). Poz ve saç seçimleri FULL modu bozmaz;
//     hava ve saat de dahil tüm diğer seçimler kendi kullanıcı kilitleriyle stil
//     referansının üzerine yazılır.
//
//   SOFT mod — kullanıcı mekân/arka plan seçtiyse: normal Gemini enhanced
//     prompt AYNEN korunur (kullanıcı seçimleri her zaman kazanır), bu modül
//     yalnızca stilin ışık/grade/kamera/poz-enerjisi katmanını prompt sonuna
//     ekler; mekân bilgisi stil analizinden bilinçli olarak AYIKLANIR.
//
// Kill switch: AUTO_GLOBAL_STYLE=false (env). Havuz boşsa/erişilemezse üretim
// sessizce normal akışına döner — bu özellik asla üretimi bozmamalı.

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const logger = require("./logger");
const { PRODUCT_SHOT_STYLE_APPROACH } = require("./jewelryCleanStyleImage");

let serviceClient = null;
function getServiceClient() {
  if (serviceClient) return serviceClient;
  serviceClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return serviceClient;
}

function isAutoGlobalStyleEnabled() {
  const env = process.env.AUTO_GLOBAL_STYLE;
  if (typeof env === "string" && env.trim() !== "") {
    return !["false", "0", "off"].includes(env.trim().toLowerCase());
  }
  return true;
}

// 🎛️ DB ana şalteri — app_config.auto_global_style_enabled
//
// env AUTO_GLOBAL_STYLE acil kill switch'tir ve AÇIKÇA ayarlandığında kazanır
// (Railway'den deploy'suz kapatmak için). DB kolonu normal operasyon içindir.
//
// 30 sn'lik önbellek: bu fonksiyon her üretim isteğinde çağrılıyor, her seferinde
// DB'ye gitmek gereksiz gecikme olurdu. Şalteri çevirdikten sonra en geç 30 sn
// içinde her yerde etkili olur.
const AUTO_STYLE_CONFIG_TTL_MS = 30 * 1000;
let autoStyleConfigCache = { value: true, at: 0 };

async function isAutoGlobalStyleEnabledForPlatform(platform) {
  // Env açıkça ayarlıysa DB'ye hiç bakma — acil şalter her şeyi ezer.
  const env = process.env.AUTO_GLOBAL_STYLE;
  if (typeof env === "string" && env.trim() !== "") {
    return isAutoGlobalStyleEnabled();
  }

  const now = Date.now();
  if (now - autoStyleConfigCache.at < AUTO_STYLE_CONFIG_TTL_MS) {
    return autoStyleConfigCache.value;
  }

  try {
    const client = getServiceClient();
    const { data } = await client
      .from("app_config")
      .select("auto_global_style_enabled")
      .eq("platform", platform === "android" ? "android" : "ios")
      .order("updated_at", { ascending: false, nullsLast: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Kolon yoksa (undefined) veya satır yoksa AÇIK kabul et — mevcut davranış.
    const value = data?.auto_global_style_enabled !== false;
    autoStyleConfigCache = { value, at: now };
    return value;
  } catch (err) {
    console.warn(
      "⚠️ [AUTO_STYLE] app_config okunamadı, açık kabul ediliyor:",
      err?.message || err,
    );
    return true;
  }
}

// referenceBrowserRoutesV7 içindeki kilit tespitlerinin birebir kopyası —
// route dosyası yalnız router export ettiği için burada kendi kendine yeterli.
const STUDIO_LOCK_HINT_RE =
  /\b(studio|seamless|cyclorama|infinity wall|blank wall|blank backdrop|neutral backdrop|white backdrop|(?:plain|bare|empty|clean|white|off-white|neutral) (?:white |off-white |neutral )?(?:wall|walls)|minimal(?:ist)? (?:white )?(?:set|interior|interiors|room|space|backdrop))\b/i;

function isStudioLockedStylePrompt(stylePrompt) {
  if (!stylePrompt) return false;
  const marker = /ENVIRONMENT_LOCK:\s*([A-Z_]+)/i.exec(stylePrompt);
  if (marker) return marker[1].toUpperCase() === "STUDIO";
  return STUDIO_LOCK_HINT_RE.test(stylePrompt);
}

function isCoupleLockedStylePrompt(stylePrompt) {
  return /SUBJECT_COUNT_LOCK:\s*COUPLE_FEMALE_MALE/i.test(
    String(stylePrompt || ""),
  );
}

// name alanı JSON i18n objesi olabilir ({ en, tr, ... }) — görünen ad çöz.
function resolveProfileDisplayName(raw) {
  if (!raw) return null;
  let val = raw;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("{")) return trimmed;
    try {
      val = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (val && typeof val === "object") {
    const pick =
      val.en ||
      val.tr ||
      Object.values(val).find((v) => typeof v === "string" && v.trim());
    return typeof pick === "string" && pick.trim() ? pick.trim() : null;
  }
  return null;
}

// Havuz kaynakları:
//   'global' → kullanıcıya görünen küratörlü çekim tarzları
//   'auto'   → SADECE otomatik havuz için admin'in eklediği gizli stiller
//              (admin dashboard → Auto styles; uygulamada hiçbir yerde görünmez)
// İkisi ORTAK havuzdur — kategori/tag şimdilik yalnız kayıt altında tutulur.
const AUTO_POOL_USER_IDS = ["auto", "global"];

// 🚶 Sokak Stili tarz enum'u — istemcideki StyleApproachPicker (id 4) ve
// havuzdaki style_approach etiketiyle sözleşme.
const STREET_STYLE_APPROACH = 4;

// 👶 Yaş eşleşmesi (eşik 15 — kullanıcı kararı 14 Ağu):
//   <15 yaş girildi → kidswear bandı: girilen yaşa yakın (±2) tahmini yaşlı
//     stiller aranır; aralık boşsa genel havuza düşülür (çocuk stilleri dahil).
//   15+ veya yaş seçilmemiş → kidswear stilleri (estimated_age < 15) HER
//     kademede DIŞLANIR; yalnız yetişkin + yaş tahminsiz stiller seçilebilir.

/**
 * Client'ın settings objesinden SAYISAL yaş çözer. settings.age sayı ("5",
 * "23") ya da anahtar kelime ("baby", "bebek", "child", "çocuk", "newborn",
 * "young", "adult"...) olabilir — enhancePromptWithGemini'deki eşlemeyle
 * uyumlu. Yaş yok/çözülemedi → null (filtre uygulanmaz).
 */
function resolveUserAgeNumber(settings = {}) {
  // 🎯 Client zaten sayısal karşılığı gönderiyor (settings.numericAge:
  // newborn→0, baby→1, child→5, young→22, adult→45, custom→N). Varsa ONU
  // kullan — anahtar kelime eşlemesindeki ufak sapmalar (ör. child 5 vs 7)
  // ortadan kalkar, custom yaşlar da birebir gelir. Aşağıdaki kelime eşlemesi
  // yalnız numericAge göndermeyen eski istemciler için fallback.
  const numeric = Number(settings?.numericAge);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const raw = settings?.age;
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return null;
  }
  const str = String(raw).trim().toLowerCase();
  const num = parseInt(str, 10);
  if (!Number.isNaN(num)) return num;
  if (/newborn|yenido|infant|baby|bebek/.test(str)) return 1;
  if (/child|çocuk|cocuk|kid/.test(str)) return 7;
  if (/teen|ergen/.test(str)) return 15;
  if (/young|genç|genc/.test(str)) return 22;
  if (/adult|yetişkin|yetiskin/.test(str)) return 45;
  return null; // bilinmeyen ifade → filtre uygulanmaz
}

function shouldUseAgeBand(userAge) {
  // 🎯 Eşik 15 (kullanıcı kararı 14 Ağu): 15 yaş altı = kidswear bandı (±2);
  // 15 ve üzeri genel/yetişkin havuza gider, çocuk stilleri dışlanır.
  return Number.isFinite(userAge) && userAge < 15;
}

// Route'taki FULL/SOFT kararını tek yerde tut. Yalnız sahne seçimi SOFT moda
// geçirir; poz ve saç seçimleri FULL mod içindeki kullanıcı kilitleriyle korunur.
function resolveAutoStyleMode({ hasUserScene = false } = {}) {
  return hasUserScene ? "soft" : "full";
}

// reference_results.style_source mevcut raporlarda "profile" ve "upload"
// semantiğini kullanıyor. Otomatik seçilen stil de bir style_profiles kaydıdır;
// aynı kaynak türüyle yazılırsa mevcut runs/samples raporları onu ayrıca şema
// değişikliği gerektirmeden doğru profile bağlar.
function buildAutoStyleUsagePatch(profile) {
  if (!profile?.id) return null;
  return {
    style_profile_id: profile.id,
    style_source: "profile",
  };
}

async function countPriorSuccessfulAutoStyleUses({
  userId,
  styleProfileId,
  excludeResultId = null,
} = {}) {
  if (!userId || !styleProfileId) return 0;
  let query = getServiceClient()
    .from("reference_results")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("style_profile_id", styleProfileId)
    // ⚠️ reference_results başarı değeri "completed"dır (21 Ağu bulgusu:
    // "succeeded" ile bu sayaç HEP 0 dönüyordu, tekrar-poz direktifi hiç
    // ateşlenmemişti). "succeeded" geriye dönük uyumluluk için tutuluyor.
    .in("status", ["completed", "succeeded"]);
  if (excludeResultId) query = query.neq("id", excludeResultId);
  const { count, error } = await query;
  if (error) throw error;
  return Math.max(0, Number(count) || 0);
}

function buildRepeatedAutoStylePoseDirective({
  priorUseCount = 0,
  userHasPose = false,
} = {}) {
  if (userHasPose || !Number.isFinite(priorUseCount) || priorUseCount < 1) {
    return "";
  }
  return `🔁 REPEATED HIDDEN STYLE — MANDATORY FRESH POSE (HIGHEST PRIORITY FOR POSE): This same hidden style has already produced ${Math.floor(priorUseCount)} successful image(s) for this user. Preserve the style's lighting, color grade, camera character, environment language, attitude AND the reference's recurring number of people, but DO NOT rebuild or approximate the pose skeleton from the style reference, its technical analysis, or a prior result. Create a clearly different professional fashion pose arrangement for the entire frame.

Use your own visual judgment to invent a fresh, natural and editorially appropriate pose that suits the garment, primary model, any supporting person and the scene. Do not choose from a predefined pose list and do not repeat a familiar template. The overall body silhouettes, interaction geometry and pose skeletons must be visibly different while remaining anatomically believable and keeping the garment's important design details visible. If the reference requires two people, keep exactly two and invent a new compatible two-person interaction instead of collapsing it to a solo model. Any explicit user-selected pose would outrank this rule for the primary model, but no user pose was selected for this generation.`;
}

// Kullanıcının gender seçimini tablo etiketi sözlüğüne ('woman'|'man') indirger.
// style_profiles.gender salt etiket kolonudur (prompta girmez); havuz seçiminde
// zıt etiketli stilleri elemek için kullanılır. Çözülemezse null → filtre yok.
function resolveUserGenderLabel(gender) {
  const normalized = String(gender || "").trim().toLowerCase();
  if (["male", "man", "boy", "erkek"].includes(normalized)) return "man";
  if (
    ["female", "woman", "girl", "kadın", "kadin", "kız", "kiz"].includes(
      normalized,
    )
  ) {
    return "woman";
  }
  return null;
}

function buildAutoStyleGenderDirective({ gender, userAge = null } = {}) {
  const normalized = String(gender || "").trim().toLowerCase();
  const isMale = ["male", "man", "boy", "erkek"].includes(normalized);
  const isFemale = [
    "female",
    "woman",
    "girl",
    "kadın",
    "kadin",
    "kız",
    "kiz",
  ].includes(normalized);
  if (!isMale && !isFemale) return "";

  const isChild = Number.isFinite(userAge) && userAge < 18;
  const modelLabel = isChild
    ? isMale
      ? "an age-appropriate boy"
      : "an age-appropriate girl"
    : isMale
      ? "a male fashion model"
      : "a female fashion model";

  const genderLock = `⚠️ USER-SELECTED GENDER LOCK — HIGHEST PRIORITY CASTING REQUIREMENT FOR THE HERO: The PRIMARY/HERO model who wears the user's product MUST be ${modelLabel}. This is the user's explicit selection and it overrides every casting cue, body cue, gender presentation, pronoun or description assigned to the primary garment-wearing person by the hidden style reference, collage, profile analysis or technical analysis. Treat every reference person as mood-board talent only and never copy an identity. If the reference composition visibly requires an additional supporting person, KEEP that person and the interaction instead of deleting them; this gender lock applies to the PRIMARY/HERO model only. Cast each supporting person as a new, age-appropriate individual whose role and presentation fit the reference composition, while the user's selected gender remains absolute for the hero.`;

  // 👖 ERKEK ÜRETİMLERİNE ÖZEL KIYAFET-UYUMU TALİMATI (20 Ağu, kullanıcı
  // isteği): man havuzundaki sokak stili referanslarında modellere abartılı /
  // statement parçalar (özellikle pantolonlar) giydirilmiş durumda. Kullanıcı
  // basit bir tişört üretirken referanstaki abartılı pantolon aynen modele
  // taşınıyordu. Bu blok, ürün DIŞINDAKİ her parçanın referanstan değil,
  // kullanıcının ürününe ve tarzına göre yeniden stillenmesini zorlar.
  const complementaryOutfitDirective = isMale
    ? `\n\n👖 COMPLEMENTARY OUTFIT MUST MATCH THE USER'S PRODUCT — NOT THE REFERENCE WARDROBE (HIGH PRIORITY STYLING RULE): The people in the style reference frames often wear exaggerated statement garments — extremely baggy, wide-leg, heavily decorated, cargo-strapped or otherwise attention-grabbing trousers and pieces. Those garments belong to the reference shoots ONLY and must NEVER be transferred, approximated or "toned-down copied" onto the hero model. Dress the hero like a professional stylist building an outfit AROUND the user's product: every garment other than the user's product (the trousers/bottoms when the product is a top, the top layer when the product is bottoms, plus shoes, belts and layers) must be newly chosen to genuinely complement the user's product in formality, fit logic, color palette and overall energy. If the user's product is a simple, casual or minimal piece (e.g. a plain t-shirt), pair it with equally clean, well-fitting, understated pieces (e.g. straight or slim trousers or dark denim in a neutral tone) so the product remains the clear hero of the outfit. Take from the style reference ONLY the photographic treatment — light, grade, camera, composition, attitude — never its wardrobe choices.`
    : "";

  return `${genderLock}${complementaryOutfitDirective}`;
}

/**
 * Ortak havuzdan (auto + global) rastgele bir stil profili seçer.
 *
 * Her zaman dışlananlar: analizsiz/fotoğrafsız profiller ve admin'in
 * auto_pool=false ile havuz dışına aldığı profiller. Çift/çok kişili stiller
 * serbesttir; ana karakter kullanıcı ürününü giyer, yardımcı karakter kendi
 * uyumlu kıyafetiyle referans kompozisyonunu tamamlar.
 * excludeStudioLocked: kullanıcı sahne/mekân seçtiyse stüdyo kilitli profiller
 * de dışlanır — o profillerin kimliği düz fon setinin kendisi, mekânla çelişir.
 * Yalnız poz veya saç seçimi bu filtreyi açmamalıdır.
 *
 * Jewelry isteklerinde `image_urls`, backfill ile üretilmiş takısız
 * `jewelry_clean_image_urls` sürümüne çevrilir. Böylece route'lar yanlışlıkla
 * referans modelin kendi takısını ürün içeriği gibi modele taşımaz.
 *
 * @returns {Promise<null | { id, user_id, name, style_prompt, image_urls, stamped_grid_url, uses_jewelry_clean_images?, tags?, product_category?, auto_pool? }>} 
 */
// Seçim sorgusunun kolonları ve rastgele pencere genişliği. Havuz binlerce
// satıra ulaştığı için TÜM satırları çekmek hem Supabase'in 1000 satır
// limitine takılır (sonradan eklenen stiller ASLA seçilemezdi) hem de her
// üretimde megabaytlarca analiz metni taşırdı. Bunun yerine: uygun satırlar
// SAYILIR → rastgele bir konuma atlanır → küçük bir pencere çekilir → metin
// bazlı filtreler (stüdyo kilidi) pencere içinde uygulanır.
const PICK_SELECT_COLS =
  "id, user_id, name, style_prompt, image_urls, stamped_grid_url, jewelry_clean_image_urls, jewelry_clean_stamped_grid_url, jewelry_clean_source_fingerprint, auto_tags, product_category, product_subtype, style_approach, auto_pool, estimated_age, gender";
const PICK_WINDOW = 40;
const PICK_ATTEMPTS = 3;
// Kategori filtresinin devreye girmesi için gereken en az stil sayısı.
// Havuz bunun altındaysa filtre atlanır (çeşitlilik > kategori isabeti).
const CATEGORY_MIN_POOL = 40;
// Alt tür havuzu doğal olarak daha küçük; eşik de daha düşük tutulur.
const SUBTYPE_MIN_POOL = 15;
// Alt tür süzmesi ürün-kadraj uyumu için zorunludur. Özellikle jewelry içinde
// earring/necklace/ring birbirinin yerine kullanılamaz; yanlış alt tür ürünün
// kadraj dışında kalmasına yol açar. Havuz küçükse aşağıdaki eşik kontrollü
// biçimde bir üst kademeye düşürür.
const SUBTYPE_FILTER_ENABLED = true;
// Çekim tarzı havuzu kategori havuzunun bir bölümü; eşik orta seviyede.
const APPROACH_MIN_POOL = 20;
// 🔁 Kullanıcı-bazlı stil rotasyonu (20 Ağu, kullanıcı isteği): aynı kullanıcı
// için daha önce KULLANILMIŞ stiller her kademede dışlanır — mümkün mertebe hep
// kullanılmamış stil seçilir. Kullanılmamış havuz biterse dışlama, "en az
// kullanılanlara izin ver" kademesine gevşer (yumuşak sıfırlama: yeni tur en az
// kullanılanlardan başlar); o da boşsa rotasyonsuz seçilir. reference_results
// satırları SİLİNMEZ — sıfırlama yalnız seçim filtresinin gevşemesidir.
const ROTATION_USED_FETCH_LIMIT = 1000; // kullanıcının okunan son başarılı üretim satırı
const ROTATION_EXCLUDE_MAX = 200; // PostgREST URL uzunluğu için dışlama listesi tavanı

async function pickAutoGlobalStyleProfile({
  excludeStudioLocked = false,
  userAge = null, // resolveUserAgeNumber çıktısı — null = yaş seçilmemiş
  productCategory: rawProductCategory = null, // "shoes" | "jewelry" | "clothing" | null
  productSubtype: rawProductSubtype = null, // "ring" | "sneakers" | ... | null
  styleApproach = null, // "editorial" | "ecommerce" | "lifestyle" | "studio" | null
  userGender = null, // settings.gender ham değeri — burada etikete çözülür
  userId = null, // 🔁 stil rotasyonu için: bu kullanıcının kullandıkları dışlanır
} = {}) {
  // 👟 AYAKKABI → KIYAFET HAVUZU (1 Eyl 2026, kullanıcı kararı): ayakkabının
  // AYRI bir otomatik stil havuzu yok. 'shoes' etiketli havuz 11 stilde kalmıştı
  // ve CATEGORY_MIN_POOL (40) eşiğini hiçbir zaman geçemediği için zaten her
  // üretimde genel havuza düşüyordu — yani ayakkabı isteği pratikte rastgele bir
  // kıyafet stili alıyordu. Artık bu KURAL: ayakkabı doğrudan kıyafet havuzundan
  // seçer. Alt tür (sneakers/heels/...) kıyafet sözlüğünde karşılığı olmadığı için
  // düşürülür; ürünün gerçek tipi (settings.productCategory) değişmez, burada
  // yalnız stil havuzu seçimi kıyafete kayar.
  const isShoesRequest =
    String(rawProductCategory || "").trim().toLowerCase() === "shoes";
  const productCategory = isShoesRequest ? "clothing" : rawProductCategory;
  const productSubtype = isShoesRequest ? null : rawProductSubtype;
  if (isShoesRequest) {
    logger.log(
      "👟 [AUTO_STYLE] 'shoes' isteği kıyafet havuzuna yönlendirildi (ayakkabıya özel havuz yok)",
    );
  }
  const db = getServiceClient();
  // 🚻 Gender ETİKET eşleşmesi: kullanıcı man seçtiyse woman etiketli stil,
  // woman seçtiyse man etiketli stil hiçbir kademede (fallback dahil)
  // seçilemez. Etiketsiz (NULL) stiller serbesttir — havuz yetersizse üretim
  // stilsiz kalmaz, etiketsiz genel havuza düşer.
  // (27 Ağu) Filtre eskiden yalnız clothing + tarz 4 isteklerinde çalışıyordu;
  // etiketli bir woman Editorial stili erkek seçilen üretime düşebiliyordu.
  // Artık her kategori/tarzda uygulanıyor: etiketsiz satırlar için davranış
  // değişmez, etiketli satırlarda zıt cinsiyet artık sızmaz.
  const normalizedUserGender = resolveUserGenderLabel(userGender);
  const requiresJewelryClean =
    String(productCategory || "").trim().toLowerCase() === "jewelry";
  // 🚶 TARZ SIZINTISI KORUMASI (20 Ağu bug'ı): Editoryal (1) seçen kullanıcıya
  // Sokak Stili (4) referansı gidiyordu. Neden: tarz-eşitlikli kademe
  // ('clothing+1') havuzda 1 etiketli stil yok/az diye boş dönüyor, akış
  // kategori/genel kademeye düşüyor ve o kademelerde tarz filtresi hiç
  // olmadığı için 4 etiketli sokak klipleri de kuraya giriyordu. Kural:
  // fallback kademelerinde yalnız ETİKETSİZ stiller + istenen tarzın kendi
  // etiketi havuzda kalır; tarz istenmemişse etiketli özel havuzlardan Sokak
  // Stili (4) her kademede dışlanır (o klipler yalnız Sokak Stili kartına ait).
  const requestedApproach = (() => {
    const n = Number(styleApproach);
    return Number.isInteger(n) && n >= 1 ? n : null;
  })();
  const sourceFingerprint = (urls) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify(urls))
      .digest("hex");

  const preparePickedProfile = (row) => {
    if (!row || !requiresJewelryClean) return row;
    // 💎 Ürün çekimi (tarz 2) stillerinde takı bilerek silinmez — o karelerde
    // konu ürünün kendisi. Temiz sürüm yoksa orijinal kare aynen kullanılır ve
    // route'a "bu referanstaki takı ÜRÜN DEĞİL" talimatı için işaret bırakılır.
    if (
      !Array.isArray(row.jewelry_clean_image_urls) ||
      row.jewelry_clean_image_urls.length === 0
    ) {
      return { ...row, uses_jewelry_clean_images: false, jewelry_swap_required: true };
    }
    return {
      ...row,
      // Route'ların mevcut grid/prompt hattı image_urls kullandığı için temiz
      // diziyi burada standart alanın yerine koyuyoruz; DB'deki orijinal alan
      // kesinlikle değiştirilmez.
      image_urls: row.jewelry_clean_image_urls,
      stamped_grid_url: row.jewelry_clean_stamped_grid_url || null,
      uses_jewelry_clean_images: true,
    };
  };

  // 🔁 Rotasyon dışlama listesi — kademeli gevşetme planları arasında değişir.
  // applyBaseFilters closure'dan okur; plan döngüsü seçime başlamadan atar.
  let rotationExcludedIds = [];

  // Kullanıcının geçmişte kullandığı stil profillerini kullanım sayısıyla okur.
  // style_profile_id hem otomatik havuz atamalarında hem kullanıcının açıkça
  // seçtiği stillerde yazılır — ikisi de "bu stili gördü" sayılır. En yeni
  // satırlardan okunur; böylece dışlama tavanına takılırsak en YENİ kullanımlar
  // dışlanmış olur (en eskiler zaten unutulmuş sayılır).
  const loadAutoStyleUsageCounts = async () => {
    if (!userId) return null;
    const { data, error } = await db
      .from("reference_results")
      .select("style_profile_id")
      .eq("user_id", userId)
      // ⚠️ başarı değeri "completed" (21 Ağu bulgusu) — "succeeded" ile
      // rotasyon sessizce NO-OP kalıyordu.
      .in("status", ["completed", "succeeded"])
      .not("style_profile_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(ROTATION_USED_FETCH_LIMIT);
    if (error) throw error;
    const counts = new Map();
    for (const row of data || []) {
      const id = row?.style_profile_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  };

  // SQL tarafında uygulanabilen temel filtreler. Metin bazlı stüdyo kilidi
  // pencere içinde JS ile elenir; çift stiller bilinçli olarak elenmez.
  const applyBaseFilters = (
    query,
    { withAgeBand, withCategory = false, withSubtype = false, withApproach = false },
  ) => {
    let q = query
      .in("user_id", AUTO_POOL_USER_IDS)
      .not("style_prompt", "is", null)
      .neq("style_prompt", "")
      .not("image_urls", "is", null)
      .or("auto_pool.is.null,auto_pool.eq.true");
    if (requiresJewelryClean) {
      // Jewelry isteği genel havuza düşse bile kıyafet/ayakkabı referansı veya
      // henüz temizlenmemiş jewelry karesi seçilmesin. TEK İSTİSNA: ürün çekimi
      // (tarz 2) stilleri bilerek temizlenmez — onlarda temiz sürüm aranmaz.
      q = q
        .eq("product_category", "jewelry")
        .or(
          `jewelry_clean_image_urls.not.is.null,style_approach.eq.${PRODUCT_SHOT_STYLE_APPROACH}`,
        );
    } else {
      // 🚫 TERS YÖN KORUMASI (14 Ağu bug'ı): kıyafet/ayakkabı/tip-bilinmeyen
      // istek, kategori havuzu eşiğin altında kalıp YAŞ veya GENEL kademeye
      // düştüğünde takı stilleri de seçilebiliyordu (el/boyun kırpmalı takı
      // referansı kıyafet üretimine sızıyordu). Takı etiketli stiller yalnız
      // takı isteklerine — her kademede dışlanır. (.neq NULL satırları da
      // elediği için NULL kategoriyi açıkça dahil eden .or gerekli.)
      q = q.or("product_category.is.null,product_category.neq.jewelry");
    }
    if (!withApproach) {
      // Tarz-eşitlikli kademe değilse (fallback): etiketli stiller yalnız
      // istenen tarza aitse havuzda kalır. (.neq NULL satırları da elediği
      // için etiketsizleri açıkça dahil eden .or kalıbı — yukarıyla aynı.)
      if (requestedApproach) {
        q = q.or(
          `style_approach.is.null,style_approach.eq.${requestedApproach}`,
        );
      } else {
        q = q.or(
          `style_approach.is.null,style_approach.neq.${STREET_STYLE_APPROACH}`,
        );
      }
    }
    if (withAgeBand) {
      q = q
        .gte("estimated_age", userAge - 2)
        .lte("estimated_age", userAge + 2);
    } else if (!shouldUseAgeBand(userAge)) {
      // 🚫 ÇOCUK STİLİ KORUMASI (14 Ağu, kullanıcı kararı): çocuk yaşı (<15)
      // SEÇİLİ DEĞİLSE kidswear stilleri (estimated_age < 15) HİÇBİR kademede
      // seçilemez. Eskiden yetişkin/yaşsız isteklerde yaş filtresi hiç yoktu ve
      // havuzdaki ~300 çocuk stili yetişkin üretimlerine sızıyordu. Yaş tahmini
      // OLMAYAN stiller (NULL) havuzda kalır — onlar sahne/kişisiz kareler.
      // (Çocuk isteğinin bant-boş fallback'i bu daldan etkilenmez: orada
      // shouldUseAgeBand true olduğu için filtre uygulanmaz, çocuk kullanıcı
      // genel havuzdan çocuk stili de çekebilir.)
      q = q.or("estimated_age.is.null,estimated_age.gte.15");
    }
    if (withCategory) q = q.eq("product_category", productCategory);
    if (withSubtype) q = q.eq("product_subtype", productSubtype);
    if (withApproach) q = q.eq("style_approach", styleApproach);
    if (rotationExcludedIds.length > 0) {
      // 🔁 Bu kullanıcının kullandığı stiller (aktif plana göre) havuz dışı.
      q = q.not("id", "in", `(${rotationExcludedIds.join(",")})`);
    }
    if (normalizedUserGender) {
      // Zıt etiket dışlanır, etiketsiz stiller havuzda kalır.
      q = q.or(`gender.is.null,gender.eq.${normalizedUserGender}`);
    }
    return q;
  };

  const rowEligible = (row) => {
    const sp = row?.style_prompt;
    const originalUrls = Array.isArray(row?.image_urls)
      ? row.image_urls.filter(Boolean)
      : [];
    if (!sp || !String(sp).trim()) return false;
    if (originalUrls.length === 0) return false;
    // Ürün çekimi stilinde temiz sürüm beklenmez; bayatlık kontrolü atlanır.
    // ⚠️ style_approach PostgREST'ten METİN gelir ("2"), sayıyla doğrudan
    // karşılaştırma HER ZAMAN false döner ve tarz-2 stilleri sessizce elenirdi
    // (17 Ağu bug'ı: kullanıcı "Ürün çekimi" seçtiği hâlde editoryal sonuç).
    const isProductShotRow =
      Number(row?.style_approach) === PRODUCT_SHOT_STYLE_APPROACH;
    if (
      requiresJewelryClean &&
      !isProductShotRow &&
      (!Array.isArray(row.jewelry_clean_image_urls) ||
        row.jewelry_clean_image_urls.length !== originalUrls.length ||
        row.jewelry_clean_source_fingerprint !==
          sourceFingerprint(originalUrls) ||
        row.jewelry_clean_image_urls.some(
          (url) => typeof url !== "string" || !/^https?:\/\//i.test(url),
        ))
    ) {
      return false;
    }
    if (excludeStudioLocked && isStudioLockedStylePrompt(sp)) return false;
    return true;
  };

  // Say → rastgele konum → pencere → JS filtresi → pencereden rastgele seç.
  // Pencere tamamen elenirse (art arda kilitli stiller) yeni konum denenir.
  const tryPick = async (
    withAgeBand,
    withCategory = false,
    withSubtype = false,
    withApproach = false,
  ) => {
    const { count, error: countErr } = await applyBaseFilters(
      db.from("style_profiles").select("id", { count: "exact", head: true }),
      { withAgeBand, withCategory, withSubtype, withApproach },
    );
    if (countErr) throw countErr;
    if (!count) return null;
    // ⚠️ Kategori havuzu ÇOK KÜÇÜKSE kullanılmaz: birkaç stilden dönen üretimler
    // hızla tekrara düşüyor ("hep aynı sahne"). Eşik altında genel havuza inilir.
    const minPool = withSubtype
      ? SUBTYPE_MIN_POOL
      : withApproach
        ? APPROACH_MIN_POOL
        : CATEGORY_MIN_POOL;
    if (withCategory && count < minPool) {
      const label = withSubtype
        ? `${productCategory}/${productSubtype}${withApproach ? `+${styleApproach}` : ""}`
        : withApproach
          ? `${productCategory}+${styleApproach}`
          : productCategory;
      logger.log(
        `🌟 [AUTO_STYLE] '${label}' havuzu küçük (${count}) → bir üst kademeye düşülüyor`,
      );
      return null;
    }

    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      // 🎲 HEDEF SATIR ÖNCE seçilir, pencere yalnızca ucuz bir YEDEK havuzudur.
      // ⚠️ Eskiden pencere başlangıcı rastgeleydi ve seçim pencere İÇİNDEN
      // yapılıyordu; bu iki yönlü sapma üretiyordu (17 Ağu ölçümü):
      //   • baş açlığı: i. satır yalnız offset ∈ [i-39, i] iken pencereye girer,
      //     dolayısıyla EN ESKİ ~19 stil idealin %3-50'si kadar şans alıyordu,
      //     en eskisi pratikte hiç seçilmiyordu;
      //   • kuyruk yığılması: sona yaklaşınca pencere daralıyor (1/size büyüyor),
      //     en yeni satırlar idealin ~4,3 katı şans alıyordu.
      // Hedefi doğrudan kurayla seçmek dağılımı düzleştirir; pencere sadece
      // hedef elenirse (stüdyo kilidi, bayat jewelry-clean) ek istek atmadan
      // yedek bulmaya yarar.
      const target = Math.floor(Math.random() * count);
      const start = Math.max(0, Math.min(target, count - PICK_WINDOW));
      const end = Math.min(start + PICK_WINDOW - 1, count - 1);
      const { data, error: windowErr } = await applyBaseFilters(
        db.from("style_profiles").select(PICK_SELECT_COLS),
        { withAgeBand, withCategory, withSubtype, withApproach },
      )
        // Offset tabanlı rastgele erişim için sıralama DETERMİNİSTİK olmalı.
        .order("created_at", { ascending: true })
        .range(start, end);
      if (windowErr) throw windowErr;
      const rows = data || [];
      const targetRow = rows[target - start];
      if (targetRow && rowEligible(targetRow)) {
        return preparePickedProfile(targetRow);
      }
      const pool = rows.filter(rowEligible);
      if (pool.length > 0) {
        return preparePickedProfile(
          pool[Math.floor(Math.random() * pool.length)],
        );
      }
    }
    return null;
  };

  // 👶 Yaş filtresi — SADECE kullanıcı 18 ALTI yaş girdiyse: girilen yaşa
  // ±2 yakınlıkta tahmini yaşlı stiller aranır; YOKSA DOĞRUDAN genel havuz.
  // (Ara kademe bilinçli yok: 17 girene 3 yaş bebek stili düşmesin.)
  // 🏷️ Ürün tipi filtresi — yaş bandından ÖNCE denenir (kullanıcının ürünü
  // neyse stil de ona ait olsun). Havuz eşiğin altındaysa tryPick null döner
  // ve aşağıdaki normal zincir çalışır.
  // 🎯 Tam hiyerarşi: kategori → alt tür → çekim tarzı. Örn. Luna
  // jewelry/earring tespit etti ve kullanıcı 3 (e-ticaret) seçtiyse önce
  // YALNIZ jewelry/earring/3 havuzu denenir. Böylece jewelry/necklace/3 gibi
  // ürünün görünmesini fiziksel olarak bozan bir referans seçilemez.
  const runCascade = async () => {
    if (
      SUBTYPE_FILTER_ENABLED &&
      productCategory &&
      productSubtype &&
      styleApproach
    ) {
      const bySubtypeAndApproach = await tryPick(
        shouldUseAgeBand(userAge),
        true,
        true,
        true,
      );
      if (bySubtypeAndApproach) {
        logger.log(
          `🎯 [AUTO_STYLE] Tam hiyerarşi eşleşmesi: '${productCategory}/${productSubtype}+${styleApproach}' havuzundan stil seçildi`,
        );
        return bySubtypeAndApproach;
      }
    }

    // Tam kombinasyon eşik altındaysa önce ürün doğruluğunu koru: aynı alt
    // türün diğer çekim tarzları, yanlış bir ürün alt türünden daha güvenlidir.
    if (SUBTYPE_FILTER_ENABLED && productCategory && productSubtype) {
      const bySubtype = await tryPick(shouldUseAgeBand(userAge), true, true);
      if (bySubtype) {
        logger.log(
          `🏷️ [AUTO_STYLE] Alt tür eşleşmesi: '${productCategory}/${productSubtype}' havuzundan stil seçildi`,
        );
        return bySubtype;
      }
    }

    // 🎨 Aynı alt tür havuzu da yetersizse kategori+tarz denenir.
    if (productCategory && styleApproach) {
      const byApproach = await tryPick(shouldUseAgeBand(userAge), true, false, true);
      if (byApproach) {
        logger.log(
          `🎨 [AUTO_STYLE] Tarz eşleşmesi: '${productCategory}+${styleApproach}' havuzundan stil seçildi`,
        );
        return byApproach;
      }
    }

    if (productCategory) {
      const byCategory = await tryPick(shouldUseAgeBand(userAge), true);
      if (byCategory) {
        logger.log(
          `🏷️ [AUTO_STYLE] Ürün tipi eşleşmesi: '${productCategory}' havuzundan stil seçildi`,
        );
        return byCategory;
      }
    }

    if (shouldUseAgeBand(userAge)) {
      const aged = await tryPick(true);
      if (aged) {
        logger.log(
          `👶 [AUTO_STYLE] Yaş eşleşmesi: kullanıcı yaşı=${userAge} → ±2 bandından stil seçildi`,
        );
        return aged;
      }
      logger.log(
        `👶 [AUTO_STYLE] yaş=${userAge} için ±2 bandında stil yok — genel havuz kullanılıyor`,
      );
    }

    return tryPick(false);
  };

  try {
    // 🔁 Rotasyon planları: [tüm kullanılanlar dışla] → [en az kullanılanlara
    // izin ver] → [rotasyonsuz]. Geçmiş okunamazsa rotasyonsuz devam edilir —
    // rotasyon bir iyileştirmedir, üretimi asla bloklamaz.
    let rotationPlans = [[]];
    try {
      const usage = await loadAutoStyleUsageCounts();
      if (usage && usage.size > 0) {
        const allUsed = [...usage.keys()];
        const minCount = Math.min(...usage.values());
        // Yeni turda önce en az kullanılanlar açılır; daha çok kullanılanlar
        // hâlâ dışta kalır. Hepsi eşit sayıda kullanıldıysa bu ara plan boş
        // kalır ve doğrudan rotasyonsuz plana düşülür (tam sıfırlama).
        const heavierUsed = allUsed.filter((id) => usage.get(id) > minCount);
        rotationPlans = [allUsed.slice(0, ROTATION_EXCLUDE_MAX)];
        if (heavierUsed.length > 0 && heavierUsed.length < allUsed.length) {
          rotationPlans.push(heavierUsed.slice(0, ROTATION_EXCLUDE_MAX));
        }
        rotationPlans.push([]);
      }
    } catch (usageErr) {
      logger.warn(
        "🔁 [AUTO_STYLE] Rotasyon geçmişi okunamadı — rotasyonsuz devam:",
        usageErr?.message,
      );
      rotationPlans = [[]];
    }

    for (let planIdx = 0; planIdx < rotationPlans.length; planIdx++) {
      rotationExcludedIds = rotationPlans[planIdx];
      const picked = await runCascade();
      if (picked) {
        if (rotationPlans.length > 1) {
          logger.log(
            planIdx === 0
              ? `🔁 [AUTO_STYLE] Rotasyon: kullanılmamış stil seçildi (dışlanan: ${rotationExcludedIds.length})`
              : rotationExcludedIds.length > 0
                ? `🔁 [AUTO_STYLE] Rotasyon: kullanılmamışlar bitti → en az kullanılanlardan seçildi (dışlanan: ${rotationExcludedIds.length})`
                : "🔁 [AUTO_STYLE] Rotasyon: havuz tamamen tüketilmiş → sıfırlandı, rotasyonsuz seçildi",
          );
        }
        return picked;
      }
      if (rotationExcludedIds.length > 0) {
        logger.log(
          "🔁 [AUTO_STYLE] Bu dışlama planıyla stil bulunamadı → rotasyon gevşetiliyor",
        );
      }
    }

    logger.warn(
      "🌟 [AUTO_STYLE] Uygun stil profili yok (auto+global) — otomatik stil atlanıyor",
    );
    return null;
  } catch (err) {
    // Metadata kolonları migration'a bağlı (add_auto_style_pool_columns.sql) —
    // migration henüz çalıştırılmadıysa eski kolon setiyle geriye uyumlu devam.
    logger.warn(
      "🌟 [AUTO_STYLE] Pencereli seçim başarısız (migration bekliyor olabilir), eski şemayla devam:",
      err?.message,
    );
    // Jewelry'de eski şemaya dönmek, tam da engellediğimiz üzerinde takı olan
    // referansı yeniden üretime sokar. Migration/backfill hazır değilse otomatik
    // stil atlanır; kullanıcı üretimi normal jewelry hattında devam eder.
    if (requiresJewelryClean) return null;
    const { data, error } = await db
      .from("style_profiles")
      .select("id, user_id, name, style_prompt, image_urls, stamped_grid_url")
      .in("user_id", AUTO_POOL_USER_IDS);
    if (error) throw new Error(error.message);
    const pool = (data || []).filter(rowEligible);
    if (pool.length === 0) return null;
    return preparePickedProfile(pool[Math.floor(Math.random() * pool.length)]);
  }
}

/**
 * Soft mod için stil analizinden MEKÂN bilgisini ayıklar: "5. LOCATIONS / SET
 * DESIGN" bölümü, ENVIRONMENT_LOCK makine işareti ve "New shoots must use a
 * different location..." cümlesi çıkarılır. Bölüm sınırı bulunamazsa metin
 * olduğu gibi bırakılır (soft bloktaki NEVER TAKE kuralları yine korur).
 */
function stripEnvironmentFromStylePrompt(stylePrompt) {
  if (!stylePrompt) return stylePrompt;
  let out = String(stylePrompt).replace(/^\s*ENVIRONMENT_LOCK:.*$/gim, "");
  out = out.replace(
    /New shoots must use a different location from any sample frame[^.]*\.[ \t]*/gi,
    "",
  );
  const sectionRe = /(^|\n)\s*5[.)]\s*LOCATIONS?[\s\S]*?(?=\n\s*6[.)])/i;
  if (sectionRe.test(out)) {
    out = out.replace(sectionRe, "\n");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * SOFT mod prompt bloğu — normal (Gemini ile zenginleştirilmiş) prompt'un
 * SONUNA eklenir. Editorial moddaki "USER'S CHOICES OUTRANK" desenini izler:
 * stil yalnız NASIL çekildiğini etkiler (ışık, grade, kamera, poz enerjisi),
 * NEYİN çekildiğini asla — mekân/hava/saat/poz/saç kullanıcınındır.
 *
 * @param {object} p
 * @param {string|null} p.profileName   Görünen stil adı (çözülmüş)
 * @param {string} p.stylePrompt        Profil analizi (HAM — burada ayıklanır)
 * @param {number} p.imageCount         Kolajdaki kare sayısı
 * @param {boolean} p.withImage         Kolaj görseli isteğe ekleniyor mu?
 * @param {boolean} p.userHasPose       Kullanıcı poz seçtiyse poz-enerjisi bullet'ı çıkar
 * @param {boolean} p.userHasLocation   Kullanıcı AÇIKÇA mekân seçtiyse mekân-evlilik bloğu eklenir
 * @param {string|null} p.userLocationLabel  Seçilen mekânın ham etiketi (örn. "İstanbul Boğazı") — isimle bağlamak sürüklenmeyi keser
 */
function buildAutoStyleSoftBlock({
  profileName = null,
  stylePrompt = "",
  imageCount = 1,
  withImage = true,
  userHasPose = false,
  userHasLocation = false,
  userLocationLabel = null,
} = {}) {
  const cleanedAnalysis = stripEnvironmentFromStylePrompt(stylePrompt);
  const nameSuffix = profileName ? ` ("${profileName}")` : "";

  const takeBullets = [
    `- the shared LIGHTING LANGUAGE — key direction, hardness/softness, fill and shadow behavior, highlight quality — applied onto the user's scene and its own light sources,`,
    `- the shared COLOR GRADE & FINISH — palette, saturation level, contrast curve and black level, white-balance bias, highlight roll-off, grain/texture — apply it like a fixed preset baked into the file,`,
    `- the shared CAMERA LANGUAGE — focal-length feel, aperture/depth-of-field behavior, camera height and angles,`,
    `- the shared COMPOSITION & FRAMING DISCIPLINE — subject placement in frame, headroom and negative-space habits, crop choices (full-body / three-quarter / waist-up), foreground-background layering${userHasPose ? "." : ","}`,
  ];
  if (!userHasPose) {
    takeBullets.push(
      `- the shared POSING ENERGY & ATTITUDE — how loose, still, playful or confident the subjects are. Copy the REGISTER only, never a literal gesture; invent a fresh pose with the same energy.`,
    );
  }

  // 📍 Mekân-evlilik direktifi: kullanıcı açıkça mekân seçtiyse sahne O yerdir;
  // stil o mekânın ÜZERİNE bir "fotoğrafçı treatment'ı" olarak uygulanır.
  const locationMarriage = userHasLocation
    ? `📍 SCENE = USER'S LOCATION, STYLE = TREATMENT (HIGH PRIORITY): The photograph is taken AT the user's chosen location described earlier in this prompt${
        userLocationLabel ? ` ("${userLocationLabel}")` : ""
      } — that place, its architecture, signature elements and atmosphere ARE the scene, fully present and recognizable. Apply the style layer ONTO this location like a photographer's treatment: shoot THIS place with the style's composition discipline, framing habits, lighting language, color grade and camera vocabulary. Do NOT relocate the shoot, do NOT generalize or water down the location, and do NOT let the style's original setting bleed into the frame. The result must read unmistakably as "the user's chosen location, photographed in this signature style" — theme and composition from the style, place from the user.`
    : null;

  const sections = [];

  if (withImage) {
    sections.push(`🎬 HOUSE STYLE TREATMENT — PHOTOGRAPHIC TECHNIQUE LAYER

The attached image that carries a solid BLACK code plate along its bottom edge with the printed text "STYLE REFERENCE · CODE SR-1" (it is the LAST attached image) is a STYLE REFERENCE COLLAGE of ${imageCount} separate photoshoot frames that share ONE professional brand aesthetic${nameSuffix}. It is attached ONLY to raise the photographic craft of this shot. Treat it strictly as a TECHNIQUE reference — never as content to rebuild.

TAKE ONLY THIS from the reference frames:
${takeBullets.join("\n")}

🚫 NEVER TAKE THESE (NON-NEGOTIABLE):
- ENVIRONMENTS. The scene, location, background, weather and time of day come ONLY from the instructions stated earlier in this prompt. Do not rebuild, mirror or lightly remix any pictured street, room, wall, backdrop or set — not even partially.
- IDENTITIES. No reference person may reappear in the output. Do not copy any face, facial structure, hair, skin marks or distinctive features. Every generated person must be a completely NEW identity.
- REFERENCE WARDROBE & PROPS. The PRIMARY/HERO model wears the user's attached product(s), which are the only source of the hero wardrobe. Never copy clothing, shoes, bags, jewelry or accessories worn by reference people. If the recurring composition requires a supporting person, give that person a newly invented, understated outfit that fits the setting, age, relationship and pose, complements the hero garment, and never duplicates or obscures the user's product. One-off incidental objects (vehicles, signage, furniture, plants, graffiti) are coincidences of those shoots and never carry over.
- THE CODE PLATE & THE GRID. The black "STYLE REFERENCE · CODE SR-1" bar is an INPUT-ONLY marker. The output is ONE single clean, full-bleed photograph — no added band, strip, collage, grid or text at any edge.`);
  } else {
    sections.push(`🎬 HOUSE STYLE TREATMENT — PHOTOGRAPHIC TECHNIQUE LAYER

The notes below are a director of photography's technique recipe distilled from a curated professional brand aesthetic${nameSuffix}. They describe TECHNIQUE ONLY — no scene, no wardrobe, no person, nothing to copy literally. Use them to raise the photographic craft of this shot:
${takeBullets.join("\n")}`);
  }

  if (locationMarriage) {
    sections.push(locationMarriage);
  }

  sections.push(`👥 SUBJECT COUNT & INTERACTION CONTINUITY (HIGH PRIORITY): Treat the recurring number of people and their relationship geometry as part of the composition, not as identity. If the reference frame — or every relevant frame in the collage — consistently shows TWO people together, the output must also show exactly TWO clearly visible, newly cast people and preserve the same kind of interaction (standing together, leaning, embracing, hand-on-shoulder, walking together, etc.), adapted naturally to the user's garment and selected pose. The PRIMARY/HERO person follows all user-selected model attributes and wears the user's product. The supporting person must remain secondary, must not wear or duplicate the user's product, and wears a newly designed, scene-appropriate complementary outfit. If the references are consistently solo, keep a solo hero. Never remove a required supporting person merely because another instruction uses the singular word “model”.`);

  sections.push(`⚠️ USER'S CHOICES OUTRANK THIS STYLE (NON-NEGOTIABLE): Every instruction stated earlier in this prompt — the garment(s), location/background, weather, time of day, pose, hair, framing, model attributes, colors and any user detail directive — takes ABSOLUTE priority. The style layer shapes HOW the photograph is made (light quality, grade, lens, craft), never WHAT is photographed. If anything in the style conflicts with the user's choices, discard the style and follow the user. In particular, if the user's scene implies different natural light (night, rain, golden hour, indoor), keep the user's light SOURCES and adapt only the style's QUALITY of light and its grade onto them.`);

  if (cleanedAnalysis) {
    sections.push(`HOUSE STYLE ANALYSIS (a director of photography's notes distilled from the reference aesthetic — environment notes intentionally removed; apply only the camera, light, grade${userHasPose ? "" : " and posing-energy"} guidance onto the user's scene):
${cleanedAnalysis}`);
  }

  return sections.join("\n\n");
}

module.exports = {
  isAutoGlobalStyleEnabled,
  isAutoGlobalStyleEnabledForPlatform,
  pickAutoGlobalStyleProfile,
  buildAutoStyleSoftBlock,
  stripEnvironmentFromStylePrompt,
  resolveProfileDisplayName,
  resolveUserAgeNumber,
  shouldUseAgeBand,
  resolveAutoStyleMode,
  buildAutoStyleUsagePatch,
  countPriorSuccessfulAutoStyleUses,
  buildRepeatedAutoStylePoseDirective,
  buildAutoStyleGenderDirective,
  resolveUserGenderLabel,
  isStudioLockedStylePrompt,
  isCoupleLockedStylePrompt,
};
