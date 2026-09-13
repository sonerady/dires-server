const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildOutfitReferencePrompt } = require('../src/utils/productReferencePrompt');
const { buildFashionCampaignEnhanceInstruction } = require('../src/utils/fashionCampaignPrompt');
const { buildUserInstructionLock } = require('../src/utils/userInstructionLock');

const pieces = [1, 2].map(cell => ({cells: [cell], category: 'clothing', subtype: 'dress', color: 'pink', pattern: 'floral'}));
test('two photos with the same mistaken dress label do not demand two garments or repeat the wrong noun', () => {
  const prompt = buildOutfitReferencePrompt({photoCount: 2, pieces});
  assert.match(prompt, /2 individual reference photo/);
  assert.match(prompt, /Photo\/cell count is NOT a distinct-item count/);
  assert.match(prompt, /Cell 1: pink floral/);
  assert.match(prompt, /Cell 2: pink floral/);
  assert.doesNotMatch(prompt, /pink floral dress|exactly 2 distinct|2 separate garment/);
  assert.match(prompt, /user clarification of the product type takes precedence/);
});

test('real outfits remain complete; same-color pieces are not silently merged', () => {
  const prompt = buildOutfitReferencePrompt({photoCount: 3, pieces: [
    {cells: [1, 2], subtype: 'jacket', color: 'black'},
    {cells: [3], subtype: 'trousers', color: 'black'},
  ]});
  assert.match(prompt, /Cell 1 & Cell 2/);
  assert.match(prompt, /Cell 3/);
  assert.match(prompt, /matching names, colors or patterns alone do NOT prove two products are identical/);
  assert.match(prompt, /preserve all genuinely distinct outfit pieces and their intended layering/);
  assert.match(prompt, /front, back and detail views of one item describe one product, worn once/);
});

test('multilingual user clarifications reach both enhancement and final requirements with priority', () => {
  const detail = 'パンツドレスです。パンツスタイルだと分かるように。足元はサンダルを履いて下さい。';
  const enhanced = buildFashionCampaignEnhanceInstruction({customDetail: detail, kombinItemCount: 2, isMultipleProducts: true});
  const lock = buildUserInstructionLock({customDetail: detail});
  assert.ok(enhanced.includes(detail));
  assert.ok(lock.includes(detail));
  assert.match(enhanced, /including how the garment silhouette and requested footwear must read/);
  assert.match(enhanced, /Photo\/cell count is NOT a distinct-item count/);
  assert.match(lock, /User clarification of the product type overrides automatic classification and cell labels/);
  assert.match(lock, /preserve every other unmentioned product detail exactly/);
});

test('missing or invalid metadata never creates an item count, bogus cell or crash', () => {
  assert.equal(buildOutfitReferencePrompt(), '');
  assert.equal(buildOutfitReferencePrompt({photoCount: -1}), '');
  for (const metadata of [null, [], [null, {cells: [0, -1, 10, '1']}]] ) {
    const p = buildOutfitReferencePrompt({photoCount: 2, pieces: metadata});
    assert.match(p, /2 individual reference photo/);
    assert.doesNotMatch(p, /REFERENCE CELL MAP/);
  }
});

for (const name of ['referenceBrowserRoutesV7', 'referenceJewelryBrowserRoutesV7', 'referenceBrowserRoutesWeb']) {
  test(`${name} uses the corrected reference block even when enhancement was bypassed`, () => {
    const source = fs.readFileSync(require.resolve('../src/routes/' + name), 'utf8');
    const start = source.indexOf('    // 📸 Kombin originals varsa prompt');
    const end = source.indexOf('\n    if (', source.indexOf('`📸 [KOMBİN ORIG]', start));
    assert.ok(start > 0 && end > start);
    const c = {enhancedPrompt: 'Scene narrative.', kombinOriginalImages: ['front.jpg', 'back.jpg'], kombinPieces: pieces, buildOutfitReferencePrompt, logger: {log(){}}};
    vm.runInNewContext(source.slice(start, end), c);
    assert.match(c.enhancedPrompt, /Photo\/cell count is NOT a distinct-item count/);
    assert.doesNotMatch(c.enhancedPrompt, /pink floral dress|exactly 2 distinct|each showing one garment separately/);
    assert.doesNotMatch(source, /These are NOT one single garment|The outfit consists of exactly \$\{lines.length\}/);
  });
}
