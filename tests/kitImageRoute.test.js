const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Stub @fal-ai/client + axios before loading the helper (no network in tests).
const calls = [];
let gptShouldFail = false;
let nbShouldFail = false;
const fakeFal = {
  config() {},
  queue: {
    async submit(model, { input }) { calls.push({ kind: 'gpt', model, input }); if (gptShouldFail) throw new Error('gpt down'); return { request_id: 'r1' }; },
    async status() { return { status: 'COMPLETED' }; },
    async result() { return { data: { images: [{ url: 'https://cdn/gpt.jpg' }] } }; },
  },
};
const fakeAxios = {
  async post(url, body) { calls.push({ kind: 'nb', url, body }); if (nbShouldFail) throw new Error('nb down'); return { data: { images: [{ url: 'https://cdn/nb.jpg' }] } }; },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@fal-ai/client') return { fal: fakeFal };
  if (request === 'axios') return fakeAxios;
  return origLoad.call(this, request, ...rest);
};
delete process.env.SUPABASE_URL; // no app_config lookup → default route
process.env.FAL_API_KEY = 'test';
const kit = require('../src/utils/kitImageRoute');
Module._load = origLoad;

test.beforeEach(() => { calls.length = 0; gptShouldFail = false; nbShouldFail = false; });

test('default route is gpt and uses GPT Image 2.5 with fixed medium quality and ~4 MP fixed image_size', async () => {
  assert.equal(kit.getKitRoute(), 'gpt');
  const url = await kit.generateKitImage({ prompt: 'p', imageUrls: ['a', null, 'b'], aspectRatio: '1024x1536' });
  assert.equal(url, 'https://cdn/gpt.jpg');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'gpt');
  assert.equal(calls[0].model, 'openai/gpt-image-2.5/sunburst/edit');
  assert.equal(calls[0].input.quality, 'medium'); // kitlerde kalite sabit medium
  assert.deepEqual(calls[0].input.image_size, { width: 1632, height: 2448 }); // 1024x1536 → 2:3 → ~4 MP sabit boyut (gpt25Edit)
  assert.deepEqual(calls[0].input.image_urls, ['a', 'b']);
});

test('falls back to Nano Banana 2 only when GPT fails', async () => {
  gptShouldFail = true;
  const url = await kit.generateKitImage({ prompt: 'p', imageUrls: ['a', 'b'], aspectRatio: '9:16' });
  assert.equal(url, 'https://cdn/nb.jpg');
  const kinds = calls.map(c => c.kind);
  assert.deepEqual(kinds, ['gpt', 'gpt', 'nb']); // 2 GPT attempts, then NB2
  assert.match(calls[2].url, /nano-banana-2\/edit/);
  assert.equal(calls[2].body.aspect_ratio, '9:16');
});

test('nb2 route tries Nano Banana first and falls back to GPT', async () => {
  nbShouldFail = true;
  const url = await kit.generateKitImage({ prompt: 'p', imageUrls: ['a', 'b'], aspectRatio: '2:3', route: 'nb2' });
  assert.equal(url, 'https://cdn/gpt.jpg');
  const kinds = calls.map(c => c.kind);
  assert.equal(kinds[0], 'nb');
  assert.equal(kinds[kinds.length - 1], 'gpt');
  assert.equal(calls[0].body.aspect_ratio, '2:3');
});

test('aspect mappings', () => {
  assert.equal(kit.toGptImageSize('9:16'), 'portrait_16_9');
  assert.equal(kit.toGptImageSize('1024x1536'), 'portrait_4_3');
  assert.equal(kit.toGptImageSize('16:9'), 'landscape_16_9');
  assert.equal(kit.toGptImageSize('portrait_16_9'), 'portrait_16_9');
  assert.equal(kit.toGptImageSize(undefined), 'portrait_16_9');
  assert.equal(kit.toAspectRatio('1024x1536'), '2:3');
  assert.equal(kit.toAspectRatio('portrait_16_9'), '9:16');
  assert.equal(kit.toAspectRatio('weird'), '9:16');
});
