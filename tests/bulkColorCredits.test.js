const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const gpt25 = require('../src/utils/gpt25Edit');
const nb2 = require('../src/utils/nb2ToolEdit');
const source = fs.readFileSync(path.join(__dirname, '../src/routes/changeProductColor.js'), 'utf8');
const start = source.indexOf('async function processBulkColorItem(');
const end = source.indexOf('router.post("/generate-bulk",', start);

for (const [quality, fee, paid, expected] of [['v1', 40, true, 50], ['v2', 40, true, 75], ['v2', 0, true, 35], ['v1', 0, false, 0]]) {
  test(`bulk ${quality}, MP fee ${fee}, base paid ${paid}: correct item total`, async () => {
    const context = {
      ...gpt25, ...nb2, probeImageDims: async () => null,
      Date, console, process: { env: { FAL_API_KEY: 'test' } },
      uuidv4: () => 'generation', sanitizeImageUrl: url => url,
      logger: { log() {} }, createPendingGeneration: async () => {},
      updateGenerationStatus: async () => ({ result_image_url: 'https://test/stored.jpg' }),
      saveToColorChangeGenerations: async () => {}, updateColorChangeGeneration: async () => {},
      deductCreditOnSuccess: async () => paid,
      applyResultUpscale: async ({ ensureBaseCharge }) => {
        assert.equal(await ensureBaseCharge(), true);
        return { imageUrl: 'https://test/output.jpg', appliedMp: fee ? 16 : null, creditsCharged: fee };
      },
      axios: { post: async (url, input) => {
        assert.equal(url, 'https://fal.run/fal-ai/nano-banana-2/edit');
        assert.equal(input.resolution, '2K');
        assert.deepEqual(Array.from(input.image_urls), ['https://test/input.jpg']);
        return { data: { images: [{ url: 'https://test/generated.jpg' }] } };
      } },
      optimizeImageUrl: url => url,
    };
    const fn = vm.runInNewContext(source.slice(start, end) + '\nprocessBulkColorItem;', context);
    const result = await fn({ userId: 'user', imageUrl: 'https://test/input.jpg', targetColor: 'red', qualityVersion: quality, sessionId: 'session', index: 0 });
    assert.equal(result.status, paid ? 'succeeded' : 'failed');
    assert.equal(result.creditsCharged || 0, expected);
    if (paid) assert.equal(result.upscaledMp, fee ? 16 : null);
  });
}
