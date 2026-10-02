const test = require('node:test');
const assert = require('node:assert/strict');
const {resolveFoodStyle} = require('../src/utils/foodStyleSelection');
const {getTool, validateOptions, buildPrompt, publicSpec} = require('../src/utils/studioTools');
const id = '11111111-2222-3333-4444-555555555555';
const profile = {id, user_id: 'owner', status: 'ready', image_urls: ['https://example.com/food.webp'], style_prompt: 'Warm sculpted side light on oxblood marble.'};
function database(row, error = null) {
  return {from(table) {
    assert.equal(table, 'food_style_profiles');
    return {select() { return {eq(column, value) {
      assert.equal(column, 'id'); assert.equal(value, id);
      return {maybeSingle: async () => ({data: row, error})};
    }}; }};
  }};
}
test('food styles allow ready global or own profiles, reject other owners and unfinished rows', async () => {
  assert.equal((await resolveFoodStyle(database(profile), id, 'owner')).prompt, profile.style_prompt);
  assert.equal((await resolveFoodStyle(database({...profile, user_id: 'global'}), id, 'viewer')).id, id);
  await assert.rejects(resolveFoodStyle(database(profile), id, 'stranger'), /food_style_unavailable/);
  await assert.rejects(resolveFoodStyle(database({...profile, status: 'processing'}), id, 'owner'), /food_style_unavailable/);
  await assert.rejects(resolveFoodStyle(database(null), id, 'owner'), /food_style_unavailable/);
  await assert.rejects(resolveFoodStyle(database(null), '-'.repeat(36), 'owner'), /food_style_id/);
});
test('style inputs use canonical safe images, a bounded prompt and propagate database failures', async () => {
  const row = {...profile, image_urls: ['file:///tmp/food.jpg', 'http://example.com/x.jpg', ...[1,2,3,4].map(n => `https://example.com/${n}.jpg`)], style_prompt: 'x'.repeat(6000)};
  const result = await resolveFoodStyle(database(row), id, 'owner');
  assert.equal(result.images.length, 3); assert.equal(result.prompt.length, 5000);
  assert.ok(result.images.every(url => url.startsWith('https://')));
  await assert.rejects(resolveFoodStyle(database({...profile, image_urls: []}), id, 'owner'), /food_style_images/);
  await assert.rejects(resolveFoodStyle(database(null, new Error('db unavailable')), id, 'owner'), /db unavailable/);
});
test('food style guides only aesthetics and keeps dish and menu constraints authoritative', () => {
  const tool = getTool('food-photography');
  const prompt = buildPrompt(tool, {...validateOptions(tool, {purpose: 'menu', lighting: 'reference', scene: 'reference'}), productCount: 1, refs: [{id:'style', count:1}], foodStylePrompt: profile.style_prompt});
  assert.ok(prompt.includes(profile.style_prompt));
  assert.match(prompt, /explicit light\/scene overrides win/);
  assert.match(prompt, /MENU\/DELIVERY priority: no props/);
  assert.match(prompt, /exact ingredient types/);
  assert.doesNotMatch(JSON.stringify(publicSpec(tool)), /FOOD PHOTOGRAPHIC STYLE|style_prompt/);
});
