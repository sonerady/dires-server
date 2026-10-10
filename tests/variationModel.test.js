const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/routes/variationRoutes.js'), 'utf8');
const constants = source.slice(source.indexOf('const VARIATION_FALLBACK_MODEL'), source.indexOf('const SUPPORTED_VARIATION_ASPECT_RATIOS'));
const settings = source.slice(source.indexOf('const getVariationModelSettings'), source.indexOf('// Gemini yaratıcı'));
const start = source.indexOf('async function runFalVariation(');
const run = source.slice(start, source.indexOf('/**\n * Ana model üretimi', start));
const SUNBURST = 'openai/gpt-image-2.5/sunburst/edit';
const NB21 = 'google/nano-banana-2.1/edit';
// 10 Eki 2026: bu kullanıcının Çeşitlendir'i NB 2.1'e gider, diğerleri Sunburst'te kalır.
const NB21_USER = 'ae008ffe-039b-4389-a1e4-f3b344556f46';
// Varyantlar 11 Eyl 2026'dan beri diğer üretimlerle aynı ~4 MP boyut tablosunu kullanıyor.
const { gpt25ImageSize, gpt25NearestRatio, probeImageDims } = require('../src/utils/gpt25Edit');
function harness({ failPrimary = false, env = {} } = {}) {
  const calls = [], updates = [], charges = [];
  const queue = {
    submit: async (model, options) => { calls.push({ action: 'submit', model, options }); if (failPrimary && (model === SUNBURST || model === NB21)) throw new Error('temporary provider outage'); return { request_id: 'job' }; },
    status: async (model, options) => { calls.push({ action: 'status', model, options }); return { status: 'COMPLETED' }; },
    result: async (model, options) => { calls.push({ action: 'result', model, options }); return { data: { images: [{ url: 'https://example.com/output.jpg' }] } }; },
  };
  const noop = () => {};
  const exports = vm.runInNewContext(`${constants}\n${settings}\n${run}\n({runFalVariation, getVariationModelSettings, selectVariationModel})`, {
    process: { env }, fal: { queue }, logger: { log: noop, warn: noop, error: noop }, console: { log: noop },
    gpt25ImageSize, gpt25NearestRatio, probeImageDims,
    setTimeout: cb => { cb(); return 0; },
    supabase: { from: () => ({ update: value => { updates.push(value); return { eq: async () => ({ error: null }) }; } }) },
    persistVariationImage: async () => ({ publicUrl: 'https://example.com/saved.jpg', bucket: 'test', storagePath: 'test.jpg' }),
    deductVariationCredit: async (...args) => charges.push(args),
  });
  return { ...exports, calls, updates, charges };
}
test('variation submit, status and result use Sunburst with quality low and preserve references', async () => {
  const h = harness();
  const refs = ['https://example.com/model.jpg', 'https://example.com/product.jpg'];
  await h.runFalVariation('variation', 'user', 'source', 'Another editorial pose, same model and outfit.', refs, 10, '9:16');
  assert.deepEqual(h.calls.map(c => c.model), [SUNBURST, SUNBURST, SUNBURST]);
  const input = h.calls[0].options.input;
  assert.equal(input.quality, 'low');
  assert.deepEqual(input.image_size, { width: 1440, height: 2560 }); // 9:16 → ~3,7 MP
  assert.equal(input.num_images, 1);
  assert.equal(input.output_format, 'jpeg');
  assert.equal(input.input_fidelity, undefined, 'Sunburst has no input_fidelity field in its schema');
  assert.deepEqual(input.image_urls, refs);
  assert.equal(h.updates.at(-1).status, 'completed');
  assert.equal(h.updates.at(-1).result_image_url, 'https://example.com/saved.jpg');
  assert.deepEqual(h.charges, [['variation', 'user', 10]]);
});
test('source aspect ratio mapping and low quality are retained in every saved variation setting in every saved variation setting', () => {
  const h = harness();
  for (const [ratio, size] of [['1:1',{width:2000,height:2000}], ['4:3',{width:2304,height:1728}], ['16:9',{width:2560,height:1440}], ['3:4',{width:1728,height:2304}], ['9:16',{width:1440,height:2560}]]) {
    assert.deepEqual(h.getVariationModelSettings(ratio).image_size, size);
    assert.equal(h.getVariationModelSettings(ratio).quality, 'low');
  }
});
test('existing outage fallback keeps its own Lite schema', async () => {
  const h = harness({ failPrimary: true });
  await h.runFalVariation('variation', 'user', 'source', 'Product photo', ['https://example.com/product.jpg'], 0, '3:4');
  assert.deepEqual(h.calls.map(c => c.model), [SUNBURST, 'google/nano-banana-lite/edit', 'google/nano-banana-lite/edit', 'google/nano-banana-lite/edit']);
  const input = h.calls[1].options.input;
  assert.equal(input.aspect_ratio, '3:4');
  assert.equal(input.quality, undefined);
  assert.equal(input.image_size, undefined);
  assert.equal(input.limit_generations, true);
  assert.equal(h.updates.at(-1).status, 'completed');
});
test('listed user variations go to NB 2.1 with high thinking; everyone else stays on Sunburst', async () => {
  const h = harness();
  const refs = ['https://example.com/model.jpg', 'https://example.com/product.jpg'];
  await h.runFalVariation('variation', NB21_USER, 'source', 'Another pose.', refs, 10, '3:4', '3:4');
  assert.deepEqual(h.calls.map(c => c.model), [NB21, NB21, NB21]);
  const input = h.calls[0].options.input;
  assert.equal(input.aspect_ratio, '3:4');
  assert.equal(input.resolution, '2K');
  assert.equal(input.thinking_level, 'high');
  assert.equal(input.enable_web_search, false);
  assert.equal(input.limit_generations, true);
  assert.equal(input.quality, undefined, 'NB 2.1 has no quality field');
  assert.equal(input.image_size, undefined, 'NB 2.1 takes aspect_ratio, not image_size');
  assert.deepEqual(input.image_urls, refs);
  assert.equal(h.updates.at(-1).status, 'completed');
  assert.deepEqual(h.charges, [['variation', NB21_USER, 10]]);
  // "Orijinal" (oran yok) → auto; kayıtlı ayar da gerçek modeli yazar.
  assert.equal(h.selectVariationModel(NB21_USER, null, null).settings.aspect_ratio, 'auto');
  assert.equal(h.selectVariationModel(NB21_USER, '3:4', '3:4').model, NB21);
  assert.equal(h.selectVariationModel('someone-else', '3:4', '3:4').model, SUNBURST);
  assert.equal(h.selectVariationModel(undefined, '3:4', '3:4').model, SUNBURST);
});
test('NB 2.1 user still falls back to Lite when NB 2.1 fails', async () => {
  const h = harness({ failPrimary: true });
  await h.runFalVariation('variation', NB21_USER, 'source', 'Another pose.', ['https://example.com/a.jpg'], 0, '9:16');
  assert.deepEqual(h.calls.map(c => c.model), [NB21, 'google/nano-banana-lite/edit', 'google/nano-banana-lite/edit', 'google/nano-banana-lite/edit']);
  assert.equal(h.calls[1].options.input.thinking_level, undefined);
  assert.equal(h.updates.at(-1).status, 'completed');
});
test('extra NB 2.1 users can be added via VARIATION_NB21_USER_IDS', () => {
  const h = harness({ env: { VARIATION_NB21_USER_IDS: ' aaa , bbb ' } });
  assert.equal(h.selectVariationModel('bbb', '1:1', '1:1').model, NB21);
  assert.equal(h.selectVariationModel(NB21_USER, '1:1', '1:1').model, NB21);
  assert.equal(h.selectVariationModel('ccc', '1:1', '1:1').model, SUNBURST);
});
