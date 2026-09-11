/**
 * "Yapay Zekaya Bırak" (model seçilmemiş) üretimlerde otomatik havuz modeli.
 *
 * 12 Eyl 2026: automatic pool assignment is disabled for everyone, in V1 and V2.
 * Explicitly selected models are handled by the routes and remain unchanged.
 *
 * Önceki davranış — 11 Eyl 2026: kullanıcı model seçmeyip "Yapay Zekaya Bırak"
 * derse ve istenen yaş 18+ ise, model KESİNLİKLE `model_pool` tablosundan
 * seçilir — kullanıcının kendi oluşturduğu modellerden değil. Seçim, o cinsiyete
 * uygun havuz satırları arasından RASTGELE yapılır. 18 yaş altında havuz
 * kullanılmaz (havuzun tamamı yetişkin portrelerden oluşur); o durumda eski
 * davranış korunur ve modeli görsel üretim modeli kendisi kurgular.
 */
const POOL_MIN_AGE = 18;
const AUTO_POOL_MODEL_ENABLED = false;

/** "22" | "young" | "adult" | "child" → sayı; çözülemezse null. */
function parseAge(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = raw.match(/(\d{1,3})/);
  if (digits) {
    const n = parseInt(digits[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  if (/newborn|yenidoğan|bebek|baby/i.test(raw)) return 1;
  if (/child|çocuk|kid/i.test(raw)) return 5;
  if (/teen|ergen/i.test(raw)) return 16;
  if (/young|genç/i.test(raw)) return 22;
  if (/adult|yetişkin|mature|orta yaş/i.test(raw)) return 45;
  if (/senior|yaşlı|elderly/i.test(raw)) return 70;
  return null;
}

/** İstemci "woman|man" gönderir; eski sürümler "female|male" gönderebiliyor. */
function normalizeGender(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^(man|male|erkek|boy)$/.test(raw)) return "man";
  if (/^(woman|female|kadın|kadin|girl)$/.test(raw)) return "woman";
  return null;
}

/**
 * Havuzdan rastgele bir model döndürür (o cinsiyete uygun, 18+).
 * @returns {Promise<{id, image_url, age, model_profile}|null>}
 */
async function pickRandomPoolModel({ supabase, gender, logger = console }) {
  const poolGender = normalizeGender(gender) || "woman";
  const { data, error } = await supabase
    .from("model_pool")
    .select("id,image_url,age,gender,model_profile")
    .eq("gender", poolGender)
    .limit(1000);
  if (error) {
    logger.warn?.("[AUTO POOL MODEL] havuz okunamadı:", error.message);
    return null;
  }
  const usable = (data || []).filter((row) => {
    if (!row?.image_url) return false;
    const age = parseAge(row.age);
    return age == null || age >= POOL_MIN_AGE;
  });
  if (!usable.length) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * Model seçilmemiş bir üretim isteği için havuz modeli uygular.
 * @returns {Promise<{modelPhoto, modelProfile, poolModelId}|null>} uygulanmadıysa null
 */
async function applyAutoPoolModel({ supabase, gender, age, logger = console }) {
  // Temporary global pause: do not even query model_pool.
  if (!AUTO_POOL_MODEL_ENABLED) return null;
  const parsed = parseAge(age);
  // Yaş çözülemiyorsa yetişkin varsayılır: 18 altı yalnızca kullanıcı AÇIKÇA
  // küçük bir yaş seçtiğinde oluşur; aksi halde havuz devreye girmeli.
  if (parsed != null && parsed < POOL_MIN_AGE) {
    logger.log?.(`🎲 [AUTO POOL MODEL] atlandı — istenen yaş ${parsed} (< ${POOL_MIN_AGE})`);
    return null;
  }
  const model = await pickRandomPoolModel({ supabase, gender, logger });
  if (!model) return null;
  return {
    modelPhoto: model.image_url,
    modelProfile: model.model_profile && typeof model.model_profile === "object" ? model.model_profile : {},
    poolModelId: model.id,
  };
}

module.exports = { applyAutoPoolModel, pickRandomPoolModel, parseAge, normalizeGender, POOL_MIN_AGE };
