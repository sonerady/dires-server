const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { textModelCastingDirection, REFERENCE_ID_PHOTO_PROMPT } = require('../src/utils/modelPortraitPrompts');
const quiet = { log() {}, error() {} };

test('casting defaults respect age and explicit user appearance', () => {
  for (const age of [24, '35', 'young', 'middle', 'elderly']) {
    assert.match(textModelCastingDirection(age), /Vogue-style/);
    assert.match(textModelCastingDirection(age), /must not override/);
    assert.match(textModelCastingDirection(age), /passport-photo/);
  }
  for (const age of ['newborn', 'baby', 'child', 0, 12, 17, undefined]) {
    assert.doesNotMatch(textModelCastingDirection(age), /Vogue|sculptural|jawline/);
    assert.match(textModelCastingDirection(age), /appropriate to the requested age/);
  }
});

for (const route of ['createModelRoutes.js', 'createModelRoutesWeb.js']) {
  const source = fs.readFileSync(`${__dirname}/../src/routes/${route}`, 'utf8');
  const extract = (name) => {
    const start = source.indexOf(`async function ${name}(`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  test(`${route}: text enhancement and provider-error fallback include casting quality`, async () => {
    for (const fail of [false, true]) {
      let instruction;
      const enhance = vm.runInNewContext(`${extract('enhanceModelPromptWithGemini2')}; enhanceModelPromptWithGemini2`, {
        logger: quiet, console: quiet, textModelCastingDirection,
        callReplicateGeminiFlash: async (prompt) => { instruction = prompt; if (fail) throw Error('offline'); return prompt; },
      });
      const prompt = await enhance('round face and curly hair', 'woman', 26);
      assert.match(instruction, /Vogue-style.*passport-photo/);
      assert.match(prompt, /sculptural cheekbones/);
      assert.match(prompt, /round face and curly hair/);
      assert.match(prompt, /must not override/);
      assert.doesNotMatch(prompt, /Fresh fictional identity direction|face shape:|skin tone:|nose shape:/);
    }
  });
  test(`${route}: actual reference request preserves identity and never adds casting defaults`, async () => {
    let body;
    const transform = vm.runInNewContext(`${extract('transformImageToIDPhoto')}; transformImageToIDPhoto`, {
      REFERENCE_ID_PHOTO_PROMPT, logger: quiet, console: quiet, process: { env: {} },
      NANO_BANANA_API_URL: 'https://fal.run/fal-ai/nano-banana-2/edit',
      fetch: async () => ({ status: 200 }),
      axios: { post: async (url, payload) => { assert.equal(url, 'https://fal.run/fal-ai/nano-banana-2/edit'); body = payload; return { data: { images: [{ url: 'result.jpg' }] } }; } },
      uploadModelImageToSupabaseStorage: async () => ({ publicUrl: 'saved.jpg' }),
    });
    await transform('reference.jpg', 'user');
    assert.deepEqual(Array.from(body.image_urls), ['reference.jpg']);
    assert.equal(body.resolution, '1K');
    assert.equal(body.aspect_ratio, '3:4');
    assert.match(body.prompt, /SAME person/);
    assert.match(body.prompt, /sole source of their identity/);
    assert.doesNotMatch(body.prompt, /Vogue|sculptural cheekbones|refined jawline|fashion casting/);
  });
  test(`${route}: uploaded-photo edit failure cannot fall back to text generation`, async () => {
    const start = source.indexOf('    if (selectedImage) {\n      // Image upload');
    const end = source.indexOf('    // Supabase\'e kaydet (resim upload', start);
    assert(start > 0 && end > start);
    let textCalls = 0, editCalls = 0;
    const context = {
      selectedImage: { uri: 'source.jpg' }, actualUserId: 'user', modelName: 'Custom',
      languageCode: 'tr', regionCode: 'TR', hijabPrompt: null,
      prompt: 'new face with angular cheekbones', gender: 'woman', finalAge: 25,
      logger: quiet, console: quiet,
      uploadImageToSupabase: async () => 'uploaded.jpg', getUserExistingModelNames: async () => [],
      analyzeImageAndGeneratePrompt: async () => ({ detectedGender: 'woman', detectedAge: 25, enhancedPrompt: 'invented face' }),
      transformImageToIDPhoto: async (url) => { editCalls++; assert.equal(url, 'uploaded.jpg'); throw Error('edit unavailable'); },
      generateModelPortrait: async () => { textCalls++; return {}; },
    };
    const run = () => vm.runInNewContext(`(async () => { let uploadedImageUrl, analysisResult, imagenResult; ${source.slice(start, end)} return imagenResult; })()`, context);
    await assert.rejects(run(), /edit unavailable/);
    assert.equal(editCalls, 1); assert.equal(textCalls, 0);
    context.selectedImage = null;
    await run();
    assert.equal(textCalls, 1);
  });
}
