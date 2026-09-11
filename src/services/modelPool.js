/**
 * Model havuzu (10 Eyl 2026).
 *
 * Kaynak: Chrome eklentisi (auto-style-clipper, hedef "Model havuzu") Pinterest'ten
 * bir kişi fotoğrafı kırpar → sunucu, elle model oluşturma akışıyla AYNI yoldan
 * (yükle → Gemini analiz: isim/yaş/cinsiyet → nano-banana edit ile vesikalık
 * portre) ortak `model_pool` tablosuna bir model yazar.
 *
 * Atama: her kullanıcıya cinsiyet başına 3 havuz modeli RASTGELE ve KALICI olarak
 * atanır (`model_pool_assignments`). Atanan model kullanıcının `user_models`
 * kitaplığına kopyalanır; böylece üretim boru hattı, seçim ve silme mevcut
 * model altyapısıyla aynen çalışır. Kullanıcının kendi modelleri silinmez;
 * kopyalar sonradan oluştuğu için listede onların ARDINDAN gelir.
 *
 * Karıştır: o cinsiyetteki 3 atama, daha önce gösterilmemiş (history) rastgele
 * modellerle değiştirilir; eski kopyalar (kullanıcı seçili değilse bile) kaldırılır.
 * Havuz tükenince history sıfırlanır. Seç (pick): "tüm modeller" listesinden
 * seçilen model kitaplığa kopyalanır (varsa yeniden kullanılır).
 */
// 11 Eyl 2026: her kullanıcıya cinsiyet başına havuzdan 6 model atanır (eskiden 3).
const POOL_SLOTS = 6;
// Starter (üretilen) üçlü slot 0..2'yi kullanır; havuz kopyaları istemcide bunun ardından sıralanır.
const STARTER_SLOTS = 3;
const copyKey = (poolId, userId, tag) => `pool:${poolId}:${userId}:${tag}`;
const checked = (result) => { if (result.error) throw result.error; return result.data; };
/** Tohumlu, deterministik karıştırma (mulberry32 + Fisher–Yates). */
function seededShuffle(list, seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h >>> 0) || 1;
  const rand = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const shuffle = (list) => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };

/**
 * 11 Eyl 2026 (kullanıcı kararı): havuz modelleri İSİMSİZ. Havuz kayıtları ve
 * kullanıcıya verilen kopyalar boş isimle ("") gider; istemci "İsimsiz" yazar.
 * Kullanıcı kopyasını kendisi adlandırırsa (update-model) o isim kalır.
 * Varsayılan yaş 22.
 */
const POOL_DEFAULT_AGE = '22';
/** Dil koduna göre isim: names[tr-TR→tr] → names.en → name ("" → isimsiz). */
function localizedName(row, languageCode) {
  const names = row?.names && typeof row.names === 'object' ? row.names : {};
  const lang = String(languageCode || '').toLowerCase().replace('_', '-').split('-')[0];
  return (lang && names[lang]) || names.en || row?.name || '';
}
/** Havuz satırı (model_pool): her zaman isimsiz. */
function toModel(row, languageCode = null) {
  if (!row) return null;
  return { id: row.id, name: '', names: {}, image_url: row.image_url, gender: row.gender, age: row.age || POOL_DEFAULT_AGE, created_at: row.created_at, model_profile: row.model_profile || {} };
}
/** Kullanıcı kopyası (user_models): kullanıcı adlandırdıysa ismi kalır, yoksa isimsiz. */
function toUserCopy(row) {
  if (!row) return null;
  return { id: row.id, name: row.name || '', names: {}, image_url: row.image_url, gender: row.gender, age: row.age || POOL_DEFAULT_AGE, created_at: row.created_at, model_profile: row.model_profile || {} };
}

function createModelPool({ db, createPortrait, regeneratePortrait = null, generateNames = null, log = console, random = shuffle }) {
  const MODEL_FIELDS = 'id,name,names,image_url,gender,age,created_at,model_profile,replicate_id';

  /** Havuzdaki mevcut isimler (dil → isimler) — yeni isimler bunlardan farklı olur. */
  async function takenNames(gender, excludeId = null) {
    const rows = checked(await db.from('model_pool').select('id,name,names').eq('gender', gender)) || [];
    const byLang = {};
    for (const r of rows) {
      if (excludeId != null && r.id === excludeId) continue;
      const names = r.names && typeof r.names === 'object' ? r.names : {};
      for (const [lang, n] of Object.entries(names)) { (byLang[lang] ||= []).push(n); }
      if (r.name) { (byLang.en ||= []).push(r.name); (byLang.tr ||= []).push(r.name); }
    }
    return byLang;
  }
  async function namesFor({ gender, age, excludeId = null }) {
    if (!generateNames) return {};
    try { return await generateNames({ gender, age, exclude: await takenNames(gender, excludeId) }); }
    catch (error) { log.warn('[Model pool] naming failed', error.message); return {}; }
  }

  async function count(gender) {
    const { count: n, error } = await db.from('model_pool').select('id', { count: 'exact', head: true }).eq('gender', gender).eq('active', true);
    if (error) throw error;
    return n || 0;
  }
  async function available(gender) { return (await count(gender)) >= POOL_SLOTS; }

  /** Eklenti: fotoğraftan havuz modeli üret. */
  async function clip({ imageUri, gender = null, languageCode = 'en', regionCode = 'US', fingerprint = null }) {
    if (fingerprint) {
      const existing = checked(await db.from('model_pool').select('*').eq('source_fingerprint', fingerprint).maybeSingle());
      if (existing) return { model: existing, duplicate: true };
    }
    const portrait = await createPortrait({ imageUri, languageCode, regionCode });
    const finalGender = ['woman', 'man'].includes(gender) ? gender : portrait.gender;
    if (!['woman', 'man'].includes(finalGender)) throw new Error('Gender could not be determined');
    // İsim üretilmez: havuz modelleri isimsiz (kullanıcı kararı, 11 Eyl 2026).
    const row = checked(await db.from('model_pool').insert({
      name: '', names: {}, gender: finalGender, age: portrait.age || POOL_DEFAULT_AGE, image_url: portrait.imageUrl,
      original_image_url: portrait.originalImageUrl || null,
      // Boy/beden otomatik girilmez; kullanıcı isterse kendi kopyasında doldurur.
      model_profile: {},
      source: 'clipper', source_fingerprint: fingerprint || null,
    }).select('*').single());
    return { model: row, duplicate: false };
  }

  /**
   * Havuz listesi. `seed` verilirse (11 Eyl 2026: modal her açılışta karışık gelsin) sıra
   * tohuma göre deterministik karıştırılır → sayfalama aynı açılışta tutarlı kalır.
   */
  async function list({ gender = null, page = 1, limit = 60, languageCode = null, seed = null } = {}) {
    const from = (Math.max(1, page) - 1) * limit;
    if (seed != null && seed !== '') {
      let q = db.from('model_pool').select('id,name,names,image_url,gender,age,model_profile,created_at').eq('active', true).order('id', { ascending: false });
      if (gender) q = q.eq('gender', gender);
      const { data, error } = await q;
      if (error) throw error;
      const rows = seededShuffle(data || [], String(seed));
      const pageRows = rows.slice(from, from + limit);
      return { models: pageRows.map((r) => toModel(r, languageCode)), total: rows.length, page, hasMore: from + pageRows.length < rows.length, seed: String(seed) };
    }
    let q = db.from('model_pool').select('id,name,names,image_url,gender,age,model_profile,created_at', { count: 'exact' }).eq('active', true).order('id', { ascending: false }).range(from, from + limit - 1);
    if (gender) q = q.eq('gender', gender);
    const { data, error, count: total } = await q;
    if (error) throw error;
    return { models: (data || []).map((r) => toModel(r, languageCode)), total: total || 0, page, hasMore: from + (data || []).length < (total || 0) };
  }

  async function copyToLibrary(userId, pool, tag, languageCode = null) {
    const key = copyKey(pool.id, userId, tag);
    const existing = checked(await db.from('user_models').select(MODEL_FIELDS).eq('replicate_id', key).maybeSingle());
    if (existing) return existing;
    return checked(await db.from('user_models').upsert({
      user_id: userId, name: '', names: {}, gender: pool.gender, age: POOL_DEFAULT_AGE,
      model_profile: {}, original_prompt: 'model pool', enhanced_prompt: `pool model #${pool.id}`,
      image_url: pool.image_url, original_image_url: pool.original_image_url || null,
      replicate_id: key, is_public: false, status: 'completed',
    }, { onConflict: 'replicate_id' }).select(MODEL_FIELDS).single());
  }

  /**
   * 🔁 Mevcut havuz kayıtlarını yeni kurallarla yeniden işle: orijinal fotoğraftan
   * saç/yüz farklı YENİ portre, 70 dilde isim, boş profil; kullanıcı kopyaları da
   * güncellenir (görsel + isimler + profil). Arka planda sırayla çalışır.
   */
  const reprocessState = { running: false, total: 0, done: 0, failed: 0, startedAt: null, finishedAt: null, lastError: null };
  async function reprocessOne(row, { portrait = true, names = true } = {}) {
    // Profil yalnız portre yenilenirken sıfırlanır; sadece-isim onarımı kullanıcının
    // kopyasında doldurduğu boy/beden bilgisine dokunmaz.
    const update = { reprocessed_at: new Date().toISOString() };
    if (portrait) update.model_profile = {};
    if (portrait && regeneratePortrait && row.original_image_url) update.image_url = await regeneratePortrait({ imageUrl: row.original_image_url });
    // İsim yeniden üretimi yok: havuz modelleri isimsiz. `names` bayrağı geriye uyum için kalıyor.
    if (names) { update.names = {}; update.name = ''; }
    checked(await db.from('model_pool').update(update).eq('id', row.id));
    const copyUpdate = {};
    if (portrait) copyUpdate.model_profile = {};
    if (update.image_url) copyUpdate.image_url = update.image_url;
    if (update.names) { copyUpdate.names = {}; copyUpdate.name = ''; }
    if (Object.keys(copyUpdate).length) checked(await db.from('user_models').update(copyUpdate).like('replicate_id', `pool:${row.id}:%`));
    return update;
  }
  function reprocess({ ids = null, portrait = true, names = true, onlyPending = false } = {}) {
    if (reprocessState.running) return reprocessState;
    Object.assign(reprocessState, { running: true, total: 0, done: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: null, lastError: null });
    (async () => {
      try {
        let q = db.from('model_pool').select('*').eq('active', true).order('id');
        if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
        if (onlyPending) q = q.is('reprocessed_at', null);
        const rows = checked(await q) || [];
        reprocessState.total = rows.length;
        for (const row of rows) {
          try { await reprocessOne(row, { portrait, names }); reprocessState.done++; }
          catch (error) { reprocessState.failed++; reprocessState.lastError = `${row.id}: ${error.message}`; log.warn('[Model pool] reprocess failed', row.id, error.message); }
        }
      } catch (error) { reprocessState.lastError = error.message; }
      finally { reprocessState.running = false; reprocessState.finishedAt = new Date().toISOString(); }
    })();
    return reprocessState;
  }

  async function pickRandom(userId, gender, exclude = new Set(), n = POOL_SLOTS) {
    const rows = checked(await db.from('model_pool').select('*').eq('gender', gender).eq('active', true)) || [];
    if (rows.length < n) return null;
    const seen = new Set((checked(await db.from('model_pool_history').select('pool_model_id').eq('user_id', userId)) || []).map(r => r.pool_model_id));
    let candidates = rows.filter(r => !exclude.has(r.id) && !seen.has(r.id));
    if (candidates.length < n) {
      // Havuz tükendi: geçmişi sıfırla, yalnız şu an gösterilenleri dışla.
      checked(await db.from('model_pool_history').delete().eq('user_id', userId));
      candidates = rows.filter(r => !exclude.has(r.id));
      if (candidates.length < n) candidates = rows;
    }
    return random(candidates).slice(0, n);
  }

  async function assignments(userId, gender = null) {
    let q = db.from('model_pool_assignments').select('gender,slot,pool_model_id,assigned_at,model:user_models(id,name,names,image_url,gender,age,created_at,model_profile)').eq('user_id', userId).order('gender').order('slot');
    if (gender) q = q.eq('gender', gender);
    return checked(await q) || [];
  }

  /** Kullanıcıda o cinsiyet için eksik atama varsa POOL_SLOTS'a (6) tamamlayacak kadar rastgele model ata (kalıcı). */
  async function ensure(userId, gender, languageCode = null) {
    const current = await assignments(userId, gender);
    if (current.length >= POOL_SLOTS) return current;
    const picked = await pickRandom(userId, gender, new Set(current.map(a => a.pool_model_id)), POOL_SLOTS - current.length);
    if (!picked) return current;
    const usedSlots = new Set(current.map(a => a.slot));
    const freeSlots = Array.from({ length: POOL_SLOTS }, (_, s) => s).filter(s => !usedSlots.has(s));
    for (let i = 0; i < picked.length; i++) {
      const slot = freeSlots[i];
      const copy = await copyToLibrary(userId, picked[i], `s${slot}`, languageCode);
      checked(await db.from('model_pool_assignments').upsert({ user_id: userId, gender, slot, pool_model_id: picked[i].id, user_model_id: copy.id, assigned_at: new Date().toISOString() }, { onConflict: 'user_id,gender,slot' }));
      checked(await db.from('model_pool_history').upsert({ user_id: userId, pool_model_id: picked[i].id }, { onConflict: 'user_id,pool_model_id', ignoreDuplicates: true }));
    }
    return assignments(userId, gender);
  }

  /** Karıştır: 3 atamayı görülmemiş rastgele modellerle değiştir. */
  async function reshuffle(userId, gender, languageCode = null) {
    const current = await assignments(userId, gender);
    const picked = await pickRandom(userId, gender, new Set(current.map(a => a.pool_model_id)), POOL_SLOTS);
    if (!picked) return { changed: false, assignments: current };
    // Eski kopyaları kaldır (kullanıcının kendi modelleri değil, yalnız havuz kopyaları).
    const oldCopyIds = current.map(a => a.model?.id).filter(Boolean);
    if (oldCopyIds.length) checked(await db.from('user_models').delete().in('id', oldCopyIds).like('replicate_id', `pool:%:${userId}:s%`));
    for (let slot = 0; slot < POOL_SLOTS; slot++) {
      // Aynı slot anahtarı tekrar kullanılabilir: eski kopya silindi, yeni kopya farklı pool id taşır.
      const copy = await copyToLibrary(userId, picked[slot], `s${slot}`, languageCode);
      checked(await db.from('model_pool_assignments').upsert({ user_id: userId, gender, slot, pool_model_id: picked[slot].id, user_model_id: copy.id, assigned_at: new Date().toISOString() }, { onConflict: 'user_id,gender,slot' }));
      checked(await db.from('model_pool_history').upsert({ user_id: userId, pool_model_id: picked[slot].id }, { onConflict: 'user_id,pool_model_id', ignoreDuplicates: true }));
    }
    return { changed: true, assignments: await assignments(userId, gender) };
  }

  /** "Tüm modeller"den seçim: kitaplığa kopyala (varsa yeniden kullan) ve döndür. */
  async function pick(userId, poolModelId, languageCode = null) {
    const pool = checked(await db.from('model_pool').select('*').eq('id', poolModelId).eq('active', true).maybeSingle());
    if (!pool) return null;
    // Zaten atanmış/kopyalanmışsa o kopyayı döndür.
    const existing = checked(await db.from('user_models').select(MODEL_FIELDS).eq('user_id', userId).like('replicate_id', `pool:${pool.id}:${userId}:%`).limit(1).maybeSingle());
    const copy = existing || await copyToLibrary(userId, pool, 'pick', languageCode);
    checked(await db.from('model_pool_history').upsert({ user_id: userId, pool_model_id: pool.id }, { onConflict: 'user_id,pool_model_id', ignoreDuplicates: true }));
    return copy;
  }

  /** Starter snapshot ile aynı şekil: slot 3..8 sanal (STARTER_SLOTS + havuz slotu); status daima completed. */
  function toJobs(rows, languageCode = null) {
    return rows.filter(a => a.model).map(a => { const model = toUserCopy(a.model); return { gender: a.gender, slot: STARTER_SLOTS + a.slot, status: 'completed', name: model.name, canRetry: false, pool: true, poolModelId: a.pool_model_id, model }; });
  }

  return { POOL_SLOTS, count, available, clip, list, ensure, reshuffle, pick, assignments, toJobs, copyKey, localizedName, reprocess, reprocessOne, reprocessState, takenNames };
}

module.exports = { createModelPool, POOL_SLOTS, copyKey, localizedName };
