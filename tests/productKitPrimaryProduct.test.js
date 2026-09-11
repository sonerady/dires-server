const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PRIMARY = 'https://fixture/first-product-sweatshirt.jpg';
const STYLED = 'https://fixture/model-with-added-trousers.jpg';
const OTHER = 'https://fixture/second-product.jpg';
const unsafeGhostPrompt = 'Create a ghost mannequin of the sweatshirt and beige trousers.';

// Exercise the registered HTTP handlers and real scene assembly. Only external
// services, image transport and persistence are stubbed; no credits or API calls.
function setup(version, referenceImages = [PRIMARY, OTHER]) {
  const routes = {}, calls = [], saved = [];
  const router = { post(p, fn) { routes[p] = fn; }, get() {} };
  const record = { reference_images: referenceImages, kits: [] };
  const supabase = { from() {
    const q = { then(resolve, reject) { return Promise.resolve({ data: record }).then(resolve, reject); } };
    for (const name of ['select', 'update', 'insert', 'eq', 'order', 'limit']) q[name] = () => q;
    q.maybeSingle = q.single = async () => ({ data: record });
    return q;
  } };
  const promptResponse = version === 'v2'
    ? JSON.stringify({ change_pose_1: 'Pose one.', change_pose_2: 'Pose two.', studio_1: 'Studio one.', studio_2: 'Studio two.', detail_shot: 'Product detail.', ghost_mannequin: unsafeGhostPrompt })
    : `Change_Pose_1_Prompt: Pose one.\nChange_Pose_2_Prompt: Pose two.\nDetail_Shot_Prompt: Product detail.\nStudio_1_Prompt: Studio one.\nStudio_2_Prompt: Studio two.\nGhost_Mannequin_Prompt: ${unsafeGhostPrompt}`;
  const dependencies = {
    express: { Router: () => router }, axios: {}, sharp: () => { throw Error('Unexpected image IO'); },
    '@supabase/supabase-js': { createClient: () => supabase }, uuid: { v4: () => 'fixture-id' },
    '@fal-ai/client': { fal: { config() {} } }, '../services/teamService': {},
    '../utils/kitInputImages': { prepareKitInputImages: async urls => urls },
    '../utils/imageOptimizer': { optimizeKitImages: images => images },
    '../utils/kitImageRoute': { getKitRoute: () => 'gpt', generateKitImage: async input => {
      calls.push(JSON.parse(JSON.stringify(input))); return `https://fixture/scene-${calls.length}.jpg`;
    } },
    '../utils/promptEnhanceProvider': { callGeminiFlash: async () => promptResponse },
    '../utils/canonicalGenerationId': { resolveCanonicalGenerationId: async () => 'canonical-generation' },
  };
  const file = path.join(__dirname, '../src/routes', version === 'v2' ? 'generateProductKitRoutesV2.js' : 'generateProductKitRoutes.js');
  const sandbox = {
    require(name) {
      if (name === '../utils/productKitSceneInput') return require('../src/utils/productKitSceneInput');
      if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    module: { exports: {} }, process: { env: {} }, Buffer,
    console: { log() {}, warn() {}, error() {} },
    promptResponse, saved,
  };
  const ioOverrides = `
    getOptimizedImageUrl = async url => url;
    saveGeneratedImageToUserBucket = async url => url;
    ${version === 'v2' ? `
      callGeminiFlash = async () => promptResponse;
      ensureMaxAspectRatio3to1ForKitInput = async urls => urls;
      appendKitToRecord = async (id, url, index) => { saved.push({id, url, index}); return [url]; };
    ` : 'updateKitsForRecord = async (id, urls) => { saved.push({id, urls}); return true; };'}
  `;
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + ioOverrides, sandbox, { filename: file });
  async function run(retry = false, sceneIndex = 5) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const endpoint = retry ? '/retry-kit-scene' : version === 'v2' ? '/generate-product-kit-v2' : '/generate-product-kit';
    await routes[endpoint]({ body: { imageUrl: STYLED, recordId: 'source-generation', sceneIndex } }, response);
    // V2 replies before its background generation/persistence settles.
    await new Promise(resolve => setImmediate(resolve));
    return response;
  }
  return { calls, saved, run };
}

for (const version of ['v1', 'v2']) {
  test(`${version}: ghost receives only the first uploaded product, without the styled outfit prompt`, async () => {
    const h = setup(version);
    const response = await h.run();
    assert.equal(response.statusCode, 200);
    assert.equal(h.calls.length, 6);
    const ghost = h.calls[5];
    assert.deepEqual(ghost.imageUrls, [PRIMARY]);
    assert.doesNotMatch(ghost.prompt, /beige trousers/);
    assert.match(ghost.prompt, /one (?:single )?(?:primary )?(?:product|garment)/i);
    assert.match(ghost.prompt, /#FFFFFF/);
    assert.equal(ghost.generationProfile, 'refiner');
    assert.ok(ghost.prompt.includes(require('../src/utils/refinerGhostMannequinPrompt').REFINER_GHOST_MANNEQUIN_DIRECTIVE));
    // Pose, studio and detail still receive the existing styling references.
    for (const call of h.calls.slice(0, 5)) {
      assert.deepEqual(call.imageUrls, [STYLED, PRIMARY]);
      assert.equal(call.generationProfile, undefined);
    }
    assert.ok(h.saved.length, 'completed scenes must still be persisted');
  });

  test(`${version}: missing first product never substitutes the model photo or a later product for ghost`, async () => {
    for (const refs of [[], [null, OTHER]]) {
      const h = setup(version, refs);
      await h.run();
      assert.equal(h.calls.length, 5, 'other scenes may finish; ghost must not invent its primary input');
    }
  });
}

test('retry ghost uses the same single primary product and persists the original ghost slot', async () => {
  const h = setup('v2');
  const response = await h.run(true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(h.calls[0].imageUrls, [PRIMARY]);
  assert.equal(h.calls[0].generationProfile, 'refiner');
  assert.equal(h.saved[0].index, 5);
  assert.equal(h.saved[0].id, 'canonical-generation');
});

test('retry ghost without a product fails before generation or replacing the existing slot', async () => {
  const h = setup('v2', []);
  const response = await h.run(true);
  assert.equal(response.statusCode, 500);
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.length, 0);
});
