const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelPool } = require('../src/services/modelPool');

// Minimal in-memory Supabase query builder covering the calls modelPool makes.
function fakeDb() {
  const tables = { model_pool: [], model_pool_assignments: [], model_pool_history: [], user_models: [] };
  let seq = { model_pool: 1, user_models: 100 };
  const pk = { model_pool_assignments: ['user_id', 'gender', 'slot'], model_pool_history: ['user_id', 'pool_model_id'], user_models: ['replicate_id'] };
  const join = (table, row) => table === 'model_pool_assignments' ? { ...row, model: tables.user_models.find(m => m.id === row.user_model_id) || null } : row;
  function from(table) {
    const filters = []; let op = 'select'; let payload = null; let head = false; let single = false; let maybe = false; let rangeArg = null; let opts = {};
    const b = {
      select(_f, o = {}) { head = !!o.head; if (op !== 'insert' && op !== 'upsert' && op !== 'delete') op = 'select'; return b; },
      insert(v) { op = 'insert'; payload = v; return b; }, upsert(v, o = {}) { op = 'upsert'; payload = v; opts = o; return b; }, delete() { op = 'delete'; return b; },
      eq(k, v) { filters.push(r => String(r[k]) === String(v)); return b; }, in(k, vs) { filters.push(r => vs.map(String).includes(String(r[k]))); return b; },
      like(k, p) { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); filters.push(r => re.test(String(r[k] || ''))); return b; },
      order() { return b; }, range(a, z) { rangeArg = [a, z]; return b; }, limit() { return b; }, maybeSingle() { maybe = true; return b; }, single() { single = true; return b; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject ? reject(e) : resolve({ error: e }); } },
    };
    function run() {
      let rows = tables[table];
      const match = r => filters.every(f => f(r));
      if (op === 'insert') { const row = { id: seq[table]++, created_at: new Date().toISOString(), ...(table === 'model_pool' ? { active: true } : {}), ...payload }; tables[table].push(row); return { data: single ? row : [row], error: null }; }
      if (op === 'upsert') {
        const keys = pk[table]; const idx = tables[table].findIndex(r => keys.every(k => String(r[k]) === String(payload[k])));
        if (idx >= 0) { if (!opts.ignoreDuplicates) Object.assign(tables[table][idx], payload); return { data: single ? tables[table][idx] : [tables[table][idx]], error: null }; }
        const row = { id: seq[table] ? seq[table]++ : undefined, created_at: new Date().toISOString(), ...payload }; tables[table].push(row); return { data: single ? row : [row], error: null };
      }
      if (op === 'delete') { const kept = rows.filter(r => !match(r)); const n = rows.length - kept.length; tables[table] = kept; return { data: null, error: null, count: n }; }
      let out = rows.filter(match).map(r => join(table, r));
      const count = out.length;
      if (rangeArg) out = out.slice(rangeArg[0], rangeArg[1] + 1);
      if (head) return { data: null, error: null, count };
      if (maybe || single) return { data: out[0] || null, error: null };
      return { data: out, error: null, count };
    }
    return b;
  }
  return { from, tables };
}
// update() support for the fake builder
const _from = fakeDb;
const seed = (db, gender, n) => { for (let i = 0; i < n; i++) db.tables.model_pool.push({ id: db.tables.model_pool.length + 1, name: `${gender}${i}`, gender, age: 'young', image_url: `https://x/${gender}${i}.jpg`, model_profile: {}, active: true, created_at: new Date().toISOString() }); };
const U = '11111111-1111-4111-8111-111111111111';

test('ensure assigns six random models once and keeps them stable', async () => {
  const db = fakeDb(); seed(db, 'woman', 12); seed(db, 'man', 2);
  const pool = createModelPool({ db, createPortrait: async () => ({}), random: l => l });
  assert.equal(await pool.available('woman'), true);
  assert.equal(await pool.available('man'), false);
  const first = await pool.ensure(U, 'woman');
  assert.equal(first.length, 6);
  assert.equal(db.tables.user_models.length, 6);
  assert.ok(db.tables.user_models.every(m => m.user_id === U && m.status === 'completed' && m.replicate_id.startsWith('pool:')));
  const again = await pool.ensure(U, 'woman');
  assert.deepEqual(again.map(a => a.pool_model_id), first.map(a => a.pool_model_id));
  assert.equal(db.tables.user_models.length, 6, 'no duplicate copies');
  const jobs = pool.toJobs(again);
  assert.deepEqual(jobs.map(j => j.slot), [3, 4, 5, 6, 7, 8]);
  assert.ok(jobs.every(j => j.status === 'completed' && j.pool && j.model?.image_url));
});

test('reshuffle replaces the set with unseen models and removes only pool copies', async () => {
  const db = fakeDb(); seed(db, 'woman', 13);
  db.tables.user_models.push({ id: 5, user_id: U, name: 'Own', gender: 'woman', replicate_id: 'fal-own', status: 'completed', image_url: 'https://x/own.jpg' });
  const pool = createModelPool({ db, createPortrait: async () => ({}), random: l => l });
  const first = (await pool.ensure(U, 'woman')).map(a => a.pool_model_id);
  const { changed, assignments } = await pool.reshuffle(U, 'woman');
  assert.equal(changed, true);
  const second = assignments.map(a => a.pool_model_id);
  assert.equal(second.length, 6);
  assert.ok(second.every(id => !first.includes(id)), 'all six differ from the first set');
  assert.ok(db.tables.user_models.some(m => m.id === 5), "user's own model survives");
  assert.equal(db.tables.user_models.filter(m => String(m.replicate_id).startsWith('pool:')).length, 6, 'old copies removed');
  // Pool exhausted (13 models, 12 seen): history resets and only the current set is excluded.
  const third = (await pool.reshuffle(U, 'woman')).assignments.map(a => a.pool_model_id);
  assert.ok(third.every(id => !second.includes(id)));
});

test('pick copies a pool model into the library once', async () => {
  const db = fakeDb(); seed(db, 'man', 3);
  const pool = createModelPool({ db, createPortrait: async () => ({}), random: l => l });
  const a = await pool.pick(U, 2); const b = await pool.pick(U, 2);
  assert.equal(a.id, b.id);
  assert.equal(db.tables.user_models.length, 1);
  assert.equal(await pool.pick(U, 99), null);
});

test('clip stores the portrait with the detected or requested gender and dedupes by fingerprint', async () => {
  const db = fakeDb();
  const pool = createModelPool({ db, createPortrait: async () => ({ name: 'Ada', gender: 'woman', age: '24', imageUrl: 'https://x/p.jpg', originalImageUrl: 'https://x/o.jpg', modelProfile: { heightCm: 178 } }) });
  const r1 = await pool.clip({ imageUri: 'data:image/jpeg;base64,AAA', fingerprint: 'pin-1' });
  assert.equal(r1.duplicate, false); assert.equal(r1.model.gender, 'woman');
  assert.equal(r1.model.name, '', 'pool models are unnamed even when the analyzer suggests a name');
  const r2 = await pool.clip({ imageUri: 'data:image/jpeg;base64,AAA', fingerprint: 'pin-1' });
  assert.equal(r2.duplicate, true); assert.equal(db.tables.model_pool.length, 1);
  const r3 = await pool.clip({ imageUri: 'x', gender: 'man', fingerprint: 'pin-2' });
  assert.equal(r3.model.gender, 'man', 'explicit gender wins over detection');
  const list = await pool.list({ gender: 'woman' });
  assert.equal(list.total, 1); assert.equal(list.models[0].name, '');
});

test('unnamed pool models (11 Sep 2026): copies are unnamed with age 22, legacy names are hidden, a user rename survives', async () => {
  const db = fakeDb(); seed(db, 'woman', 6);
  db.tables.model_pool[0].names = { en: 'Ava', tr: 'Defne', ja: '葵' };
  const pool = createModelPool({ db, createPortrait: async () => ({}), random: l => l });
  const rows = await pool.ensure(U, 'woman', 'tr-TR');
  const jobs = pool.toJobs(rows, 'ja');
  const first = jobs.find(j => j.poolModelId === 1);
  assert.equal(first.model.name, ''); assert.deepEqual(first.model.names, {}); assert.equal(first.model.age, '22');
  const copy = db.tables.user_models.find(m => m.replicate_id.startsWith('pool:1:'));
  assert.equal(copy.name, ''); assert.equal(copy.age, '22');
  assert.deepEqual(copy.model_profile, {}, 'no height/measurements preset');
  copy.name = 'Benim modelim';
  assert.equal(pool.toJobs(await pool.assignments(U, 'woman'), 'tr').find(j => j.poolModelId === 1).model.name, 'Benim modelim', 'a user-given name is kept');
  assert.equal((await pool.list({ gender: 'woman' })).models.every(m => m.name === ''), true, 'the all-models list never shows names');
});

test('clip never asks for names and stores an empty profile', async () => {
  const db = fakeDb(); seed(db, 'woman', 1);
  const calls = [];
  const pool = createModelPool({ db, createPortrait: async () => ({ name: 'X', gender: 'woman', age: '24', imageUrl: 'https://x/p.jpg', modelProfile: { heightCm: 178 } }),
    generateNames: async (input) => { calls.push(input); return { en: 'Mia', tr: 'Ela' }; } });
  const { model } = await pool.clip({ imageUri: 'x' });
  assert.equal(calls.length, 0);
  assert.equal(model.name, ''); assert.deepEqual(model.names, {}); assert.deepEqual(model.model_profile, {});
});
