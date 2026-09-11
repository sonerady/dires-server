const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createStarterModels: makeService, designFor } = require('../src/services/starterModels');
const testNames = { woman: ['Ada','Mira','Lina'], man: ['Atlas','Aras','Ege'] };
const createStarterModels = (options) => makeService({ generateNames: async (gender) => testNames[gender], ...options });
const tick = () => new Promise((r) => setImmediate(r));
function database(existing = []) {
  const tables = { user_models: existing, model_starter_enrollments: [], model_starter_jobs: [] };
  let nextId = 100;
  function from(table) {
    let filters = [], values, op = 'select', single = false, select = '';
    const q = {
      select(s) { select = s || '*'; return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; },
      is(k, v) { filters.push((r) => v === null ? r[k] == null : r[k] === v); return q; },
      lt(k, v) { filters.push((r) => r[k] < v); return q; },
      order() { return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      update(v) { values = v; op = 'update'; return q; },
      upsert(v) { values = v; op = 'upsert'; return q; },
      then(resolve, reject) {
        try {
          let rows = tables[table].filter((r) => filters.every((f) => f(r)));
          if (op === 'update') rows.forEach((r) => Object.assign(r, values));
          if (op === 'upsert') {
            let row = tables[table].find((r) => r.replicate_id === values.replicate_id);
            if (!row) { row = { id: nextId++ }; tables[table].push(row); }
            Object.assign(row, values); rows = [row];
          }
          const data = rows.map((r) => ({ ...r, ...(select.includes('model:user_models') ? { model: tables.user_models.find((m) => m.id === r.model_id) || null } : {}) }));
          return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    }; return q;
  }
  return { tables, from, async rpc(_, { p_user_id: userId, p_gender: gender }) {
    let enrollment = tables.model_starter_enrollments.find((r) => r.user_id === userId);
    if (!enrollment) { enrollment = { user_id: userId, eligible: true }; tables.model_starter_enrollments.push(enrollment); }
    const flag = `eligible_${gender}`;
    enrollment[flag] = !tables.user_models.some((r) => r.user_id === userId && r.gender === gender);
    enrollment.eligible = enrollment.eligible_woman !== false || enrollment.eligible_man !== false;
    if (enrollment[flag]) for (const job of tables.model_starter_jobs.filter(j => j.user_id === userId && j.gender === gender && j.status === 'completed' && j.model_id == null)) Object.assign(job, { status: 'queued', attempts: 0, display_name: null });
    if (enrollment[flag]) for (let slot = 0; slot < 3; slot++) {
      if (!tables.model_starter_jobs.some((r) => r.user_id === userId && r.gender === gender && r.slot === slot)) tables.model_starter_jobs.push({ user_id: userId, gender, slot, status: 'queued', attempts: 0, updated_at: new Date().toISOString() });
    }
    return { data: enrollment[flag], error: null };
  } };
}
const log = { warn() {} };
test('a starter batch uses the original general casting brief and saves the actual prompts', async () => {
  const db = database();
  const prompts = [];
  const service = createStarterModels({ db, log, generate: async prompt => { prompts.push(prompt); return 'portrait'; } });
  await service.ensure('new-user', 'woman'); await tick();
  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts).size, 1);
  assert.match(prompts[0], /Vogue-style casting quality/);
  assert.doesNotMatch(prompts[0], /face shape:|skin tone:|hair texture:|nose shape:/);
  assert.deepEqual(db.tables.user_models.map(model => model.original_prompt).sort(), [...prompts].sort());
  assert.equal((await service.snapshot('new-user')).jobs.every(job => job.status === 'completed'), true);
});
test('only a current personal model blocks its gender; deletion allows creation', async () => {
  for (const existingGender of ['woman', 'man']) {
    const other = existingGender === 'woman' ? 'man' : 'woman';
    const db = database([{ id: 1, user_id: 'experienced', gender: existingGender }]);
    let calls = 0;
    const service = createStarterModels({ db, generate: async () => { calls++; return 'url'; }, log });
    const blocked = await service.ensure('experienced', existingGender);
    assert.equal(blocked.eligibleByGender[existingGender], false);
    assert.equal(blocked.jobs.length, 0);
    await service.ensure('experienced', other); await tick();
    assert.equal(calls, 3);
    db.tables.user_models.length = 0;
    await service.ensure('experienced', existingGender); await tick();
    assert.equal(calls, 6);
  }
});
test('legacy global exclusions do not block an untried gender', async () => {
  const db = database([{ id: 1, user_id: 'legacy', gender: 'man' }]);
  db.tables.model_starter_enrollments.push({ user_id: 'legacy', eligible: false, eligible_man: false });
  let calls = 0;
  const service = createStarterModels({ db, generate: async () => { calls++; return 'url'; }, log });
  await service.ensure('legacy', 'woman'); await tick();
  assert.equal(calls, 3);
  await service.ensure('legacy', 'man'); await tick();
  assert.equal(calls, 3);
});
test('concurrent retries/platforms reserve only three portraits; opposite gender gets its own trio', async () => {
  const db = database(); let calls = 0;
  const service = createStarterModels({ db, generate: async () => { calls++; return 'url'; }, log });
  await Promise.all(Array.from({ length: 8 }, () => service.ensure('new', 'woman'))); await tick();
  assert.equal(calls, 3); assert.equal(db.tables.user_models.length, 3);
  const result = await service.read('new');
  assert.deepEqual(result.jobs.map((j) => j.slot), [0, 1, 2]); assert(result.jobs.every((j) => j.model && j.status === 'completed'));
  await service.ensure('new', 'woman'); await service.ensure('new', 'man'); await tick();
  assert.equal(calls, 6); assert.equal(db.tables.user_models.length, 6);
  // Deleting all models reuses the same slots for a new trio.
  db.tables.user_models.length = 0;
  db.tables.model_starter_jobs.forEach((j) => { j.model_id = null; });
  await service.ensure('new', 'woman'); await tick(); assert.equal(calls, 9);
  await service.ensure('new', 'woman'); await tick(); assert.equal(calls, 9);
});
test('failed portraits retry only on demand and only the failed slot, at most three attempts', async () => {
  const db = database(); let calls = 0;
  const service = createStarterModels({ db, generate: async () => { calls++; throw new Error('provider'); }, log });
  await service.ensure('new', 'woman'); await tick(); assert.equal(calls, 3);
  await service.ensure('new', 'woman'); await tick(); assert.equal(calls, 3);
  await service.retry('new', 'woman', 1); await tick(); assert.equal(calls, 4);
  await service.retry('new', 'woman', 1); await tick(); assert.equal(calls, 5);
  await service.retry('new', 'woman', 1); await tick(); assert.equal(calls, 5);
  assert.equal((await service.read('new')).jobs[1].canRetry, false);
});
test('restart marks orphaned processing failed; saved model is recovered without a paid generation', async () => {
  const db = database(); let calls = 0;
  await db.rpc('', { p_user_id: 'new', p_gender: 'woman' });
  db.tables.model_starter_jobs.forEach((j) => Object.assign(j, { status: 'completed' }));
  const job = db.tables.model_starter_jobs[0];
  Object.assign(job, { status: 'processing', attempts: 1, updated_at: '2020-01-01T00:00:00Z' });
  db.tables.user_models.push({ id: 50, user_id: 'new', replicate_id: 'starter-v1-new-woman-0' });
  const service = createStarterModels({ db, generate: async () => { calls++; }, log });
  assert.equal((await service.read('new')).jobs[0].status, 'failed');
  await service.retry('new', 'woman', 0); await tick();
  assert.equal(calls, 0); assert.equal((await service.read('new')).jobs[0].model.id, 50);
});
test('starter prompts keep casting quality without assigning fixed identities to slots', () => {
  const portraits = ['woman', 'man'].flatMap((g) => [0, 1, 2].map((slot) => designFor(g, slot)));
  assert.equal(new Set(portraits.map((d) => d.prompt)).size, 2);
  portraits.forEach((d) => {
    assert.match(d.prompt, /entirely fictional adult/);
    assert.match(d.prompt, /exactly 22 years old/);
    assert.match(d.prompt, /professional high-fashion model/);
    assert.match(d.prompt, /Vogue-style/);
    assert.match(d.prompt, /cheekbones/);
    assert.match(d.prompt, /fresh, randomly imagined/);
    assert.doesNotMatch(d.prompt, /Fresh fictional identity direction|face shape:|skin tone:|nose shape:/);
    assert.match(d.prompt, /No jewelry/);
  });
  assert.throws(() => designFor('invalid', 0));
  assert.throws(() => designFor('woman', 3));
});
test('native and web use shared text provider and use NB2 1K for reference photos', () => {
  for (const name of ['createModelRoutes.js', 'createModelRoutesWeb.js']) {
    const source = fs.readFileSync(require.resolve('../src/routes/' + name), 'utf8');
    assert.match(source, /https:\/\/fal.run\/fal-ai\/nano-banana-2\/edit/);
    assert.match(source, /starterPortraitInput, MODEL_T2I_API_URL/);
    assert.doesNotMatch(source, /https:\/\/fal.run\/google\/nano-banana-lite"/);
    assert.match(source, /resolution: "1K"/);
    assert.doesNotMatch(source, /nano-banana-lite|openai\/gpt-image/);
  }
});

test('generated models are unnamed (11 Sep 2026): no naming call, empty name persists, a user rename is kept', async () => {
  const db = database(); const finish=[];
  const namingCalls=[];
  const service = createStarterModels({db,log,generateNames:async(gender,language)=>{namingCalls.push({gender,language});return testNames[gender];},generate:()=>new Promise(resolve=>finish.push(resolve))});
  await service.ensure('turkish', 'woman', 'tr-TR'); await tick();
  const pending = await service.snapshot('turkish');
  assert.deepEqual(namingCalls,[]);
  assert(pending.jobs.every(j=>j.status==='processing'));
  finish.forEach(resolve=>resolve('url')); await tick();
  const completed = await service.read('turkish', 'de-DE');
  assert.deepEqual(completed.jobs.map(j=>j.name), ['','','']);
  assert.deepEqual(db.tables.user_models.map(m=>m.name), ['','','']);
  db.tables.user_models[0].name='Custom name';
  assert.equal((await service.read('turkish','tr')).jobs[0].name,'Custom name');
});
test('explicit retries and process restarts keep models unnamed', async () => {
  const db=database(); let fail=true;
  const generate=async()=>{if(fail)throw Error('offline');return 'url';};
  await createStarterModels({db,generate,log}).ensure('retry','man','tr'); await tick();
  fail=false;
  const restarted=createStarterModels({db,generate,log});
  await restarted.retry('retry','man',1,'ja'); await tick();
  const result=await restarted.read('retry','ja');
  assert.deepEqual(result.jobs.map(j=>j.name),[null,'',null], 'only the retried slot has a (unnamed) model');
  assert.equal(db.tables.user_models[0].name,'');
});
test('interface language is preserved without restricting names to a predefined catalog',()=>{
  const {normalizeNameLanguage,buildStarterModelNamesPrompt}=require('../src/utils/starterModelNames');
  const locales=fs.readdirSync(require('node:path').resolve(__dirname,'../../client/locales')).filter(n=>/^[a-z]{2,3}\.json$/.test(n)&&n!=='web.json');
  for(const file of locales){
    const locale=file.replace('.json','');
    assert.equal(normalizeNameLanguage(locale),locale);
    assert(buildStarterModelNamesPrompt('woman',locale).includes(`selected interface language is ${locale}`));
  }
  assert.equal(normalizeNameLanguage('tr_TR'),'tr-TR');
  assert.equal(normalizeNameLanguage('bad input'),'en');
  assert.equal(normalizeNameLanguage('zh-Hant-TW'),'zh-Hant-TW');
});
test('a broken name provider cannot block portraits: naming is not part of the pipeline',async()=>{
  const db=database(); let portraitCalls=0;
  const service=createStarterModels({db,log,generateNames:async()=>['same','same','same'],generate:async()=>{portraitCalls++;return 'url';}});
  await service.ensure('bad-name','woman','tr'); await tick();
  assert.equal(portraitCalls,3);
  assert((await service.snapshot('bad-name')).jobs.every(j=>j.status==='completed'));
});

test('a stalled name provider is never awaited: portraits proceed', async () => {
  const db = database(); let portraits = 0;
  const service = createStarterModels({ db, log, nameTimeoutMs: 15,
    generateNames: () => new Promise(() => {}),
    generate: async () => { portraits++; return 'url'; },
  });
  await service.ensure('timeout', 'woman'); await tick();
  assert.equal(portraits, 3);
  assert(db.tables.model_starter_jobs.every(job => job.display_name == null));
});

test('stalled portraits become retryable and late results cannot create models', async () => {
  const db = database(); const requests = [];
  const service = createStarterModels({ db, log, portraitTimeoutMs: 15,
    generate: (_prompt, _userId, { signal }) => new Promise(resolve => requests.push({ resolve, signal })),
  });
  await service.ensure('timeout', 'man');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(requests.length, 3);
  assert(requests.every(request => request.signal.aborted));
  assert((await service.snapshot('timeout')).jobs.every(job => job.status === 'failed'));
  requests.forEach(request => request.resolve('late-url')); await tick();
  assert.equal(db.tables.user_models.length, 0);
});

test('heartbeats preserve live work, stopped workers expire without automatic paid retry', async () => {
  const db = database(); let time = Date.now(); const completions = [];
  const service = createStarterModels({ db, log, now: () => time, heartbeatMs: 5,
    generate: () => new Promise(resolve => completions.push(resolve)),
  });
  await service.ensure('lease', 'woman'); await tick();
  time += 120000;
  await new Promise(resolve => setTimeout(resolve, 12));
  assert((await service.read('lease')).jobs.every(job => job.status === 'processing'));
  completions.forEach(resolve => resolve('url')); await tick();
  assert((await service.snapshot('lease')).jobs.every(job => job.status === 'completed'));
  // Simulate the persisted job left by a process that no longer sends heartbeats.
  Object.assign(db.tables.model_starter_jobs[0], { status: 'processing', model_id: null, updated_at: new Date(time - 91000).toISOString() });
  assert.equal((await service.read('lease')).jobs[0].status, 'failed');
  assert.equal(completions.length, 3);
});

test('no naming request is made for new starter trios',async()=>{
  const db=database([{id:1,user_id:'user',gender:'man',name:'Marc'}]);
  const calls=[];
  const service=createStarterModels({db,log,generate:async()=> 'portrait',generateNames:async(gender,language,options)=>{
    calls.push({gender,language,options});return ['Lucía','Alba','Vega'];
  }});
  await service.ensure('user','woman','es');await tick();
  assert.equal(calls.length,0);
  assert.deepEqual(db.tables.user_models.filter(m=>m.gender==='woman').map(m=>m.name),['','','']);
});

test('automatic models save editable measurement presets without sending them to the portrait provider',async()=>{
  const {starterModelProfile}=require('../src/utils/starterModelProfile');
  const {normalizeModelProfile}=require('../src/utils/modelProfile');
  for(const gender of ['woman','man']) {
    const db=database();const inputs=[];
    const service=createStarterModels({db,log,generate:async(...args)=>{inputs.push(args);return 'portrait';}});
    await service.ensure('new-user',gender);await tick();
    const expected=starterModelProfile(gender);
    assert.deepEqual(normalizeModelProfile(expected),expected);
    assert.deepEqual(Object.keys(expected).sort(),['bustCm','heightCm','hipsCm','waistCm']);
    assert.equal(db.tables.user_models.length,3);
    for(const model of db.tables.user_models) assert.deepEqual(model.model_profile,expected);
    for(const [prompt,,options] of inputs) {
      assert.doesNotMatch(prompt,/heightCm|bustCm|waistCm|hipsCm|178|188|84|98|62|78|90|96/);
      assert.equal(options.modelProfile,undefined);
    }
    const snapshot=await service.snapshot('new-user');
    for(const job of snapshot.jobs) assert.deepEqual(job.model.model_profile,expected);
    const copy=starterModelProfile(gender);copy.heightCm=200;
    assert.deepEqual(starterModelProfile(gender),expected);
  }
});
test('recovering an existing model preserves its user-edited profile',async()=>{
  const db=database();const service=createStarterModels({db,log,generate:async()=> 'portrait'});
  await service.ensure('new-user','woman');await tick();
  const model=db.tables.user_models[0];
  model.model_profile={heightCm:175,waistCm:65,notes:'My settings'};
  const job=db.tables.model_starter_jobs.find(job=>job.slot===0);
  job.status='queued';
  await service.read('new-user');await tick();
  assert.deepEqual(model.model_profile,{heightCm:175,waistCm:65,notes:'My settings'});
});
