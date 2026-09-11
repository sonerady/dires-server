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
function harness({ failPrimary = false } = {}) {
  const calls = [], updates = [], charges = [];
  const queue = {
    submit: async (model, options) => { calls.push({ action: 'submit', model, options }); if (failPrimary && model === SUNBURST) throw new Error('temporary provider outage'); return { request_id: 'job' }; },
    status: async (model, options) => { calls.push({ action: 'status', model, options }); return { status: 'COMPLETED' }; },
    result: async (model, options) => { calls.push({ action: 'result', model, options }); return { data: { images: [{ url: 'https://example.com/output.jpg' }] } }; },
  };
  const noop = () => {};
  const exports = vm.runInNewContext(`${constants}\n${settings}\n${run}\n({runFalVariation, getVariationModelSettings})`, {
    fal: { queue }, logger: { log: noop, warn: noop, error: noop }, console: { log: noop },
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
  assert.equal(input.image_size, 'portrait_16_9');
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
  for (const [ratio, size] of [['1:1','square_hd'], ['4:3','landscape_4_3'], ['16:9','landscape_16_9'], ['3:4','portrait_4_3'], ['9:16','portrait_16_9']]) {
    assert.equal(h.getVariationModelSettings(ratio).image_size, size);
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
