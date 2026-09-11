const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { starterPortraitInput, MODEL_T2I_API_URL } = require('../src/utils/starterPortraitInput');

function assertInput(input) {
  assert.equal(input.num_images, 1);
  assert.equal(input.aspect_ratio, '3:4');
  assert.equal(input.resolution, '1K');
  assert(Number.isInteger(input.seed));
  assert(input.seed >= 0 && input.seed < 2147483648);
  assert.equal(input.output_format, 'jpeg');
  for (const key of ['image_urls', 'image_size', 'quality', 'input_fidelity']) assert.equal(input[key], undefined);
}

test('native and web starter requests use Nano Banana 2 1K text endpoint and its supported schema', async () => {
  assert.equal(MODEL_T2I_API_URL, 'https://fal.run/fal-ai/nano-banana-2');
  for (const route of ['createModelRoutes.js', 'createModelRoutesWeb.js']) {
    const source = fs.readFileSync(require.resolve('../src/routes/' + route), 'utf8');
    const start = source.indexOf('router.use(require("./starterModelRoutes")({');
    const end = source.indexOf('\n}));', start) + '\n}));'.length;
    assert(start >= 0 && end > start);
    let handlers;
    const inputs = [];
    vm.runInNewContext(source.slice(start, end), {
      starterPortraitInput, MODEL_T2I_API_URL, process: { env: {} },
      router: { use: value => { handlers = value; } },
      require: name => name === './starterModelRoutes' ? value => value : { randomUUID: () => 'fixture' },
      axios: { post: async (url, body, options) => { assert.equal(url, MODEL_T2I_API_URL); assert(options.signal); inputs.push(body); return { data: { images: [{ url: 'portrait' }] } }; } },
      uploadModelImageToSupabaseStorage: async () => ({ publicUrl: 'saved' }),
    });
    const directions = Array(3).fill('General Vogue-style fashion model portrait');
    for (const prompt of directions) assert.equal(await handlers.generate(prompt, 'user', { signal: new AbortController().signal }), 'saved');
    assert.deepEqual(inputs.map(input => input.prompt), directions);
    inputs.forEach(assertInput);
  }
});

for (const route of ['createModelRoutes.js', 'createModelRoutesWeb.js']) {
  test(`${route}: manual text uses Nano Banana 2 1K and retains user details and hijab instructions`, async () => {
    const source = fs.readFileSync(require.resolve('../src/routes/' + route), 'utf8');
    const start = source.indexOf('async function generateModelPortrait(');
    const functionText = source.slice(start, source.indexOf('\n}', start) + 2);
    let input;
    const generate = vm.runInNewContext(`${functionText}; generateModelPortrait`, {
      starterPortraitInput, MODEL_T2I_API_URL, process: { env: {} },
      logger: { log() {} }, console: { error() {} },
      enhanceModelPromptWithGemini2: async (prompt, gender, age) => `${prompt}, ${gender}, age ${age}`,
      axios: { post: async (url, body) => { assert.equal(url, MODEL_T2I_API_URL); input = body; return { data: { images: [{ url: 'portrait' }] } }; } },
      uploadModelImageToSupabaseStorage: async () => ({ publicUrl: 'saved' }),
    });
    assert.equal((await generate('curly hair', 'woman', 32, 'user', 'wear a hijab')).imageUrl, 'saved');
    assertInput(input);
    assert.match(input.prompt, /curly hair, woman, age 32 wear a hijab/);
  });
}
