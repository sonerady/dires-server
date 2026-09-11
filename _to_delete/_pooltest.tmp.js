require('dotenv').config();
const { supabaseAdmin } = require('./src/supabaseClient');
const { createModelPool } = require('./src/services/modelPool');
(async () => {
  const pool = createModelPool({ db: supabaseAdmin, createPortrait: async () => ({}) });
  const uid = '77edfa11-eedc-4ceb-8549-0da0d66955ed';
  console.log('available woman', await pool.available('woman'), 'man', await pool.available('man'));
  const rows = await pool.assignments(uid, 'woman');
  console.log('assignments', JSON.stringify(rows.map(r => ({ slot: r.slot, pool: r.pool_model_id, model: r.model && { id: r.model.id, name: r.model.name, age: r.model.age, gender: r.model.gender, img: (r.model.image_url||'').slice(0,60) } }))));
  console.log('jobs', JSON.stringify(pool.toJobs(rows).map(j => ({ slot: j.slot, status: j.status, id: j.model?.id }))));
  const list = await pool.list({ gender: 'woman', page: 1, limit: 5 });
  console.log('list total', list.total, list.models.map(m => [m.id, m.name, m.age]));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
