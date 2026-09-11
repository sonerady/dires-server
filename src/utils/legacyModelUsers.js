/**
 * "Eski model" kullanıcı filtresi (11 Eyl 2026).
 *
 * Bazı kurumsal kullanıcılar yeni modelin çıktılarını beğenmedi ve önceki
 * davranışta kalmak istedi. `legacy_model_users` tablosuna e-posta ile eklenen
 * kullanıcılar için:
 *   • use_nbpro_v2          → V2 üretimleri GPT 2.5 Sunburst yerine
 *                             nano-banana-pro 2K ile yapılır.
 *   • skip_auto_pool_model  → "Yapay Zekaya Bırak" seçiliyken `model_pool`
 *                             tablosundan otomatik model ATANMAZ (eski davranış:
 *                             modeli görsel üretim modeli kendisi kurgular).
 *
 * Liste admin panelinden (Admin → Legacy Users) yönetilir. Okuma 60 sn boyunca
 * bellekte önbelleklenir; her üretim isteğinde tabloya gidilmez.
 */
const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, byEmail: new Map() };

const normalize = (email) => String(email || "").trim().toLowerCase();

/** Tüm listeyi (e-posta → bayraklar) önbellekli döndürür. */
async function loadLegacyMap(supabase, logger = console) {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.byEmail;
  const { data, error } = await supabase
    .from("legacy_model_users")
    .select("email,use_nbpro_v2,skip_auto_pool_model");
  if (error) {
    logger.warn?.("[LEGACY USERS] liste okunamadı:", error.message);
    return cache.byEmail; // eski önbellek neyse onunla devam
  }
  const byEmail = new Map();
  for (const row of data || []) {
    byEmail.set(normalize(row.email), {
      useNbproV2: row.use_nbpro_v2 !== false,
      skipAutoPoolModel: row.skip_auto_pool_model !== false,
    });
  }
  cache = { at: Date.now(), byEmail };
  return byEmail;
}

/** Önbelleği hemen geçersiz kılar (admin ekleme/silme sonrası). */
function invalidateLegacyCache() {
  cache = { at: 0, byEmail: cache.byEmail };
}

const NO_FLAGS = { useNbproV2: false, skipAutoPoolModel: false, isLegacy: false };

/** E-posta biliniyorsa tek sorgu bile gerekmez. */
async function getLegacyFlagsByEmail(supabase, email, logger = console) {
  const key = normalize(email);
  if (!key) return NO_FLAGS;
  const map = await loadLegacyMap(supabase, logger);
  const flags = map.get(key);
  return flags ? { ...flags, isLegacy: true } : NO_FLAGS;
}

/** Kullanıcı id'sinden bayrakları çözer (e-postayı kendisi okur). */
async function getLegacyFlags(supabase, userId, logger = console) {
  if (!userId) return NO_FLAGS;
  try {
    const map = await loadLegacyMap(supabase, logger);
    if (!map.size) return NO_FLAGS;
    const { data } = await supabase.from("users").select("email").eq("id", userId).maybeSingle();
    return getLegacyFlagsByEmail(supabase, data?.email, logger);
  } catch (error) {
    logger.warn?.("[LEGACY USERS] bayraklar çözülemedi:", error.message);
    return NO_FLAGS;
  }
}

module.exports = { getLegacyFlags, getLegacyFlagsByEmail, invalidateLegacyCache, NO_FLAGS };
