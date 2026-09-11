const { validateStarterModelNames } = require('../utils/starterModelNames');
const { starterModelProfile } = require('../utils/starterModelProfile');
const MAX_ATTEMPTS = 3;
const STALE_MS = 90 * 1000;
const TABLE = 'model_starter_jobs';
function designFor(gender, slot) {
  if (!['woman', 'man'].includes(gender) || !Number.isInteger(slot) || slot < 0 || slot > 2) throw new Error('Invalid starter portrait');
  return { prompt: `Create one photorealistic fashion casting portrait of an entirely fictional adult ${gender === 'woman' ? 'woman' : 'man'}, exactly 22 years old. The face must clearly look 22 years old and have the distinctive beauty and facial presence of a professional high-fashion model chosen for a premium fashion agency. Cast an exceptional editorial runway face with striking sculptural cheekbones, well-defined facial structure, a refined jawline and a captivating gaze; the face itself must read as a high-fashion campaign model, not a generic everyday stock-photo subject. Keep the requested neutral expression and natural photographic realism. Invent a fresh, randomly imagined model identity for this generation. Vogue-style casting quality, striking high cheekbones, distinctive defined bone structure and a refined jawline, with believable natural proportions. Freely choose the remaining facial features, skin tone, eyes and hair instead of following a fixed appearance template. The identity is synthetic, not a real person, public figure or celebrity likeness. Straight-on passport-style head-and-shoulders portrait, eye-level camera, entire head visible, plain opaque white T-shirt and clean white studio background. Soft even studio lighting, sharp eyes, realistic skin texture, natural grooming and a neutral expression. One person only, photo fills the canvas edge to edge. No jewelry, eyewear, props, frame, border, logos, text, watermark, collage, nudity or suggestive content.` };
}
const keyFor = (job) => `starter-v1-${job.user_id}-${job.gender}-${job.slot}`;
function checked(result) { if (result.error) throw result.error; return result.data; }
async function withDeadline(work, milliseconds, code) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = Object.assign(new Error(code), { code });
          controller.abort(error);
          reject(error);
        }, milliseconds);
        timer.unref?.();
      }),
    ]);
  } finally { clearTimeout(timer); }
}
function createStarterModels({ db, generate, generateNames, log = console, now = () => Date.now(), nameTimeoutMs = 60000, portraitTimeoutMs = 330000, heartbeatMs = 20000 }) {
  const scope = (query, job) => query.eq('user_id', job.user_id).eq('gender', job.gender).eq('slot', job.slot);
  async function snapshot(userId) {
    const enrollment = checked(await db.from('model_starter_enrollments').select('eligible,eligible_woman,eligible_man').eq('user_id', userId).maybeSingle());
    const rows = checked(await db.from(TABLE).select('*, model:user_models(id,name,image_url,gender,age,created_at,model_profile)').eq('user_id', userId).order('slot')) || [];
    return { eligible: enrollment?.eligible ?? null, eligibleByGender: { woman: enrollment?.eligible_woman ?? null, man: enrollment?.eligible_man ?? null }, jobs: rows.map(({ model, ...job }) => ({
      // Model hazırsa ismi (boş = isimsiz) aynen gider; hazır değilse eski display_name/null.
      gender: job.gender, slot: job.slot, status: job.status, name: model ? (model.name || '') : (job.display_name || null),
      canRetry: job.status === 'failed' && job.attempts < MAX_ATTEMPTS, model,
    })) };
  }
  const namingBatches = new Map();
  async function nameFor(job, languageCode) {
    const readName = async () => checked(await scope(db.from(TABLE).select('display_name'), job).maybeSingle())?.display_name;
    const existing = await readName();
    if (existing) return existing;
    const key = `${job.user_id}:${job.gender}`;
    if (!namingBatches.has(key)) {
      const batch = (async () => {
        const personalModels = checked(await db.from('user_models').select('name').eq('user_id', job.user_id)) || [];
        const previousJobs = checked(await db.from(TABLE).select('display_name').eq('user_id', job.user_id)) || [];
        const excludeNames = [...personalModels.map(model => model.name), ...previousJobs.map(row => row.display_name)].filter(Boolean);
        const names = validateStarterModelNames(await withDeadline(signal => generateNames(job.gender, languageCode, { signal, excludeNames, scope: job.user_id }), nameTimeoutMs, 'naming_timeout'));
        // Persist the complete trio before portraits start; retries/restarts reuse it.
        for (let slot = 0; slot < 3; slot++) {
          checked(await scope(db.from(TABLE).update({ display_name: names[slot] }), { ...job, slot }).is('display_name', null));
        }
      })();
      namingBatches.set(key, batch);
      batch.finally(() => { if (namingBatches.get(key) === batch) namingBatches.delete(key); }).catch(() => {});
    }
    await namingBatches.get(key);
    const name = await readName();
    if (!name) throw new Error('Model name unavailable');
    return name;
  }
  async function run(job, languageCode = 'en') {
    const claim = checked(await scope(db.from(TABLE).update({ status: 'processing', attempts: job.attempts + 1, updated_at: new Date(now()).toISOString() }), job)
      .eq('status', 'queued').eq('attempts', job.attempts).select().maybeSingle());
    if (!claim) return;
    const finish = (values) => scope(db.from(TABLE).update({ ...values, updated_at: new Date(now()).toISOString() }), claim)
      .eq('status', 'processing').eq('attempts', claim.attempts);
    // A stopped server no longer renews this lease. Polling can then expose a
    // retry within 90 seconds without duplicating another worker's live task.
    const heartbeat = setInterval(() => {
      Promise.resolve(finish({})).catch(() => {});
    }, heartbeatMs);
    heartbeat.unref?.();
    const assertClaim = async () => {
      const current = checked(await scope(db.from(TABLE).select('status,attempts'), claim).maybeSingle());
      if (current?.status !== 'processing' || current?.attempts !== claim.attempts) throw Object.assign(new Error('Claim expired'), { code: 'claim_expired' });
    };
    let stage = 'recovery';
    try {
      const design = designFor(job.gender, job.slot);
      // A previous storage/DB completion may have succeeded before a process restart.
      let model = checked(await db.from('user_models').select('id').eq('replicate_id', keyFor(job)).maybeSingle());
      if (!model) {
        // 11 Eyl 2026 (kullanıcı kararı): üretilen modeller isimsiz — LLM adlandırması yok.
        const displayName = '';
        await assertClaim();
        stage = 'portrait';
        const imageUrl = await withDeadline(signal => generate(design.prompt, job.user_id, { signal }), portraitTimeoutMs, 'portrait_timeout');
        await assertClaim();
        stage = 'saving';
        model = checked(await db.from('user_models').upsert({
          user_id: job.user_id, name: displayName, gender: job.gender, age: 'young',
          model_profile: starterModelProfile(job.gender),
          original_prompt: design.prompt, enhanced_prompt: design.prompt, image_url: imageUrl,
          replicate_id: keyFor(job), is_public: false, status: 'completed',
        }, { onConflict: 'replicate_id' }).select('id').single());
      }
      checked(await finish({ status: 'completed', model_id: model.id }));
    } catch (error) {
      log.warn('[Starter models] Portrait failed', { gender: job.gender, slot: job.slot, stage, code: error.code || error.response?.status || 'generation_failed' });
      await finish({ status: 'failed' });
    } finally { clearInterval(heartbeat); }
  }
  async function resume(userId, languageCode = 'en') {
    // Interrupted requests become retryable, never automatically incur a second generation.
    checked(await db.from(TABLE).update({ status: 'failed', updated_at: new Date(now()).toISOString() })
      .eq('user_id', userId).eq('status', 'processing').lt('updated_at', new Date(now() - STALE_MS).toISOString()));
    const jobs = checked(await db.from(TABLE).select('*').eq('user_id', userId).eq('status', 'queued')) || [];
    for (const job of jobs) void run(job, languageCode).catch((e) => log.warn('[Starter models] Claim unavailable', e.code || 'database_error'));
  }
  return {
    snapshot,
    async read(userId, languageCode = 'en') { await resume(userId, languageCode); return snapshot(userId); },
    async ensure(userId, gender, languageCode = 'en') {
      checked(await db.rpc('ensure_starter_models', { p_user_id: userId, p_gender: gender }));
      await resume(userId, languageCode);
      return snapshot(userId);
    },
    async retry(userId, gender, slot, languageCode = 'en') {
      checked(await scope(db.from(TABLE).update({ status: 'queued', updated_at: new Date(now()).toISOString() }), { user_id: userId, gender, slot })
        .eq('status', 'failed').lt('attempts', MAX_ATTEMPTS));
      await resume(userId, languageCode);
      return snapshot(userId);
    },
  };
}
module.exports = { createStarterModels, designFor, MAX_ATTEMPTS };
