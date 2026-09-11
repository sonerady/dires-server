const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { supabaseAdmin } = require('../supabaseClient');
const { createStarterModels } = require('../services/starterModels');
const { createModelPool } = require('../services/modelPool');
const { normalizeNameLanguage } = require('../utils/starterModelNames');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * 🧑‍🤝‍🧑 Model havuzu (10 Eyl 2026): havuzda o cinsiyet için ≥3 model varsa yeni
 * kullanıcıya fal ile portre ÜRETİLMEZ; 3 rastgele havuz modeli kalıcı atanır ve
 * snapshot'a sanal slot 3..5 "completed" işler olarak eklenir. Havuz boşsa eski
 * üretim akışı aynen çalışır (geri uyumluluk).
 */
module.exports = function starterModelRoutes({ generate, generateNames, createPortrait = null, regeneratePortrait = null, generatePoolNames = null, pool: poolOverride = null }) {
  const router = express.Router();
  const service = supabaseAdmin && createStarterModels({ db: supabaseAdmin, generate, generateNames });
  // İsimler Replicate üzerinden Gemini ile (kullanıcı kararı, 11 Eyl 2026): DeepSeek
  // 70 dili eksik/bozuk döndürüyordu. Gemini başarısız olursa DeepSeek yedek.
  const poolNames = generatePoolNames && ((input) => generatePoolNames({
    ...input,
    callText: (prompt) => require('../utils/poolModelNames').callPoolNamesText(prompt),
  }));
  const pool = poolOverride || (supabaseAdmin && createModelPool({ db: supabaseAdmin, createPortrait, regeneratePortrait, generateNames: poolNames }));
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
  const withPool = async (userId, data, languageCode = null) => {
    if (!pool) return data;
    try {
      const rows = [];
      for (const gender of ['woman', 'man']) {
        if (await pool.available(gender)) rows.push(...(await pool.ensure(userId, gender, languageCode)));
      }
      return { ...data, poolAvailable: true, jobs: [...(data.jobs || []), ...pool.toJobs(rows, languageCode)] };
    } catch (error) {
      console.warn('[Model pool] unavailable', error.message);
      return data;
    }
  };
  // Eklenti: havuza model ekle (kullanıcı kimliği gerekmez; yalnız native router'da açık,
  // web router requireAuth arkasında). Elle model oluşturma akışıyla aynı üretim yolu.
  const clipLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  router.post('/starter-models/pool/clip', clipLimiter, async (req, res) => {
    if (!pool || !createPortrait) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    const { imageBase64, imageUrl, gender = null, languageCode = 'en', regionCode = 'US', fingerprint = null } = req.body || {};
    const imageUri = typeof imageBase64 === 'string' && imageBase64 ? (imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`) : imageUrl;
    if (!imageUri) return res.status(400).json({ success: false, error: 'imageBase64 or imageUrl required' });
    if (gender && !['woman', 'man'].includes(gender)) return res.status(400).json({ success: false, error: 'Invalid gender' });
    try {
      const result = await pool.clip({ imageUri, gender, languageCode: normalizeNameLanguage(languageCode), regionCode, fingerprint: typeof fingerprint === 'string' ? fingerprint.slice(0, 200) : null });
      res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, model: result.model, counts: { woman: await pool.count('woman'), man: await pool.count('man') } });
    } catch (error) {
      console.error('[Model pool] clip failed', error.message);
      res.status(502).json({ success: false, error: error.message || 'Model pool clip failed' });
    }
  });
  // 🔁 Yönetim: mevcut havuz kayıtlarını yeniden işle (yeni portre + 70 dil isim + boş profil).
  // Koruma: MODEL_POOL_ADMIN_KEY tanımlıysa x-pool-admin-key başlığı; değilse yalnız yerel/özel ağ.
  const adminOk = (req) => {
    const key = process.env.MODEL_POOL_ADMIN_KEY;
    if (key) return req.get('x-pool-admin-key') === key;
    const ip = String(req.ip || '').replace('::ffff:', '');
    return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|localhost$)/.test(ip);
  };
  router.post('/starter-models/pool/reprocess', async (req, res) => {
    if (!pool) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    if (!adminOk(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const { ids = null, portrait = true, names = true, onlyPending = false } = req.body || {};
    const state = pool.reprocess({ ids: Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : null, portrait: portrait !== false, names: names !== false, onlyPending: onlyPending === true });
    res.status(202).json({ success: true, state });
  });
  router.get('/starter-models/pool/reprocess', async (req, res) => {
    if (!pool) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    if (!adminOk(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    res.json({ success: true, state: pool.reprocessState });
  });
  router.get('/starter-models/pool/stats', async (_req, res) => {
    if (!pool) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    try { res.json({ success: true, counts: { woman: await pool.count('woman'), man: await pool.count('man') } }); }
    catch (_) { res.status(503).json({ success: false, error: 'Model pool unavailable' }); }
  });
  router.use('/starter-models', limiter, async (req, res, next) => {
    const userId = req.method === 'GET' ? req.query.userId : req.body?.userId;
    if (!uuid.test(userId || '')) return res.status(400).json({ success: false, error: 'Invalid user ID' });
    if (!service) return res.status(503).json({ success: false, error: 'Starter models unavailable' });
    try {
      // Native anonymous identities live in public.users, as in /create-model.
      const { data, error } = await supabaseAdmin.from('users').select('id,supabase_user_id').eq('id', userId).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'User not registered' });
      if (req.user && req.user.id !== data.supabase_user_id) return res.status(403).json({ success: false, error: 'User mismatch' });
      req.starterUserId = userId;
      req.starterLanguage = normalizeNameLanguage(req.method === 'GET' ? req.query.languageCode : req.body?.languageCode);
      next();
    } catch (_) { res.status(503).json({ success: false, error: 'Starter models unavailable' }); }
  });
  router.get('/starter-models', async (req, res) => {
    try { res.json({ success: true, ...(await withPool(req.starterUserId, await service.read(req.starterUserId, req.starterLanguage), req.starterLanguage)) }); }
    catch (_) { res.status(503).json({ success: false, error: 'Starter models unavailable' }); }
  });
  router.post('/starter-models', async (req, res) => {
    const { gender, retrySlot } = req.body;
    if (!['woman', 'man'].includes(gender) || (retrySlot !== undefined && (!Number.isInteger(retrySlot) || retrySlot < 0 || retrySlot > 2))) {
      return res.status(400).json({ success: false, error: 'Invalid starter model selection' });
    }
    try {
      // Havuz doluysa üretim yok: atama + snapshot. Havuz boşsa eski akış.
      let poolReady = false;
      try { poolReady = !!pool && retrySlot === undefined && await pool.available(gender); } catch (_) { poolReady = false; }
      const result = poolReady
        ? await service.read(req.starterUserId, req.starterLanguage)
        : retrySlot === undefined ? await service.ensure(req.starterUserId, gender, req.starterLanguage) : await service.retry(req.starterUserId, gender, retrySlot, req.starterLanguage);
      res.status(202).json({ success: true, ...(await withPool(req.starterUserId, result, req.starterLanguage)) });
    } catch (_) { res.status(503).json({ success: false, error: 'Starter models unavailable' }); }
  });
  // 🔀 Karıştır: o cinsiyetteki 3 havuz modelini görülmemiş rastgele modellerle değiştir.
  router.post('/starter-models/shuffle', async (req, res) => {
    const { gender } = req.body;
    if (!['woman', 'man'].includes(gender)) return res.status(400).json({ success: false, error: 'Invalid gender' });
    if (!pool) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    try {
      const { changed } = await pool.reshuffle(req.starterUserId, gender, req.starterLanguage);
      res.json({ success: true, changed, ...(await withPool(req.starterUserId, await service.read(req.starterUserId, req.starterLanguage), req.starterLanguage)) });
    } catch (error) { console.error('[Model pool] shuffle failed', error.message); res.status(503).json({ success: false, error: 'Model pool unavailable' }); }
  });
  // 📚 Tüm havuz modelleri (cinsiyete göre, sayfalı).
  router.get('/starter-models/pool', async (req, res) => {
    if (!pool) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    const gender = ['woman', 'man'].includes(req.query.gender) ? req.query.gender : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(120, Math.max(1, parseInt(req.query.limit, 10) || 60));
    try {
      const seed = typeof req.query.seed === 'string' ? req.query.seed.slice(0, 64) : null;
      const data = await pool.list({ gender, page, limit, languageCode: req.starterLanguage, seed });
      const assigned = await pool.assignments(req.starterUserId, gender);
      res.json({ success: true, ...data, assignedPoolIds: assigned.map(a => a.pool_model_id) });
    } catch (_) { res.status(503).json({ success: false, error: 'Model pool unavailable' }); }
  });
  // ✅ Listeden seç: kitaplığa kopyala ve modeli döndür (istemci seçer).
  router.post('/starter-models/pick', async (req, res) => {
    const poolModelId = Number(req.body?.poolModelId);
    if (!Number.isInteger(poolModelId) || poolModelId <= 0) return res.status(400).json({ success: false, error: 'Invalid pool model' });
    if (!pool) return res.status(503).json({ success: false, error: 'Model pool unavailable' });
    try {
      const model = await pool.pick(req.starterUserId, poolModelId, req.starterLanguage);
      if (!model) return res.status(404).json({ success: false, error: 'Pool model not found' });
      res.json({ success: true, model: { ...model, name: pool.localizedName(model, req.starterLanguage) } });
    } catch (_) { res.status(503).json({ success: false, error: 'Model pool unavailable' }); }
  });
  return router;
};
