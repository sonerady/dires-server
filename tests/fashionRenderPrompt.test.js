const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fashion = require('../src/utils/fashionCampaignPrompt');
const footwear = require('../src/utils/footwearPrompt');
const hair = require('../src/utils/modelHairDirection');
const locks = require('../src/utils/userInstructionLock');

// Exercise the production assembler without starting the server, database,
// background jobs or a paid image generation.
const source = fs.readFileSync(require.resolve('../src/routes/referenceBrowserRoutesV7'), 'utf8');
const realism = source.slice(source.indexOf('const UNIVERSAL_PHOTOREALISM_DIRECTIVE ='), source.indexOf('// Replicate API üzerinden'));
const finalizer = source.slice(source.indexOf('function finalizeGenerationPrompt('), source.indexOf('router.post("/generate"'));
assert.ok(realism && finalizer.startsWith('function finalizeGenerationPrompt('));
const context = {...require('../src/utils/bagCampaignPrompt'), ...fashion, ...footwear, ...hair, ...locks, logger: {log() {}}};
vm.runInNewContext(`${realism}\n${finalizer}\nthis.finalize = finalizeGenerationPrompt; this.universal = appendUniversalPhotorealism;`, context);
const finalize = context.finalize;

test('standard generation restores full realism and campaign appendices in the original order', () => {
  const narrative = 'Create a new fashion campaign photograph. Preserve the exact product.';
  const settings = {productCategory: 'clothing', location: 'White studio', framing: 'close_up', gender: 'woman', age: '22'};
  const customDetail = 'パンツスタイルだと分かるように。足元はサンダルを履いて下さい。';
  const p = finalize(narrative, {settings, customDetail});
  const userLock = locks.buildUserInstructionLock({settings, customDetail, locationDescriptionIsSceneContext: true, allowFashionPoseInterpretation: true});
  const fullCampaign = fashion.buildFashionCampaignDirection({settings});
  assert.equal(p, `${context.universal(narrative)}\n\n${userLock}\n\n${fullCampaign}`);
  for (const section of ['PHOTOGRAPHIC REALISM — NON-NEGOTIABLE', 'GARMENT-TO-BODY', 'FINISHED FASHION CAMPAIGN', 'FASHION BODY LANGUAGE', 'PROFESSIONAL FASHION PRESENTATION', 'EXPOSURE AND COLOR VITALITY', 'ON-LOCATION PHOTOGRAPHIC INTEGRATION', 'CLEAN WHITE BACKDROP']) assert.ok(p.includes(section));
  assert.match(p, /User clarification of the product type overrides automatic classification/);
  assert.doesNotMatch(p, /FASHION PHOTOGRAPH — REFERENCE AND QUALITY RULES/);
});

test('automatic/street/editorial/reference styles and other editing modes keep their existing instructions', () => {
  const styleOptions = [{styleDirected: true}, {styleReferenceUrl: 'style.jpg'}, {autoStyleGridUrl: 'grid.jpg'}, {editorialCollagesForRequest: ['editorial.jpg']}];
  const editOptions = ['isColorChange', 'isPoseChange', 'isEditMode', 'isRefinerMode', 'isBackSideAnalysis'].map(key => ({[key]: true}));
  for (const options of [...styleOptions, ...editOptions, {settings: {productCategory: 'jewelry'}}]) {
    const p = finalize('SPECIALIZED BRIEF: Preserve the requested style.', options);
    assert.match(p, /PHOTOGRAPHIC REALISM — NON-NEGOTIABLE/);
    assert.match(p, /SPECIALIZED BRIEF: Preserve the requested style\./);
    assert.doesNotMatch(p, /FASHION PHOTOGRAPH — REFERENCE AND QUALITY RULES|PROFESSIONAL FASHION PRESENTATION/);
  }
  const shoes = finalize('Shoe photograph', {settings: {productCategory: 'shoes'}});
  assert.match(shoes, /FOOTWEAR/);
  assert.doesNotMatch(shoes, /FASHION PHOTOGRAPH — REFERENCE AND QUALITY RULES/);
});

test('reference instructions and long multilingual user details are never truncated; explicit hair disables automatic hair', () => {
  const input = 'NARRATIVE\nMULTIPLE-ANGLE PRODUCT REFERENCE: four views of ONE product.\nGRID CELL MAP: jacket and trousers, both required.\n' + 'Important reference detail. '.repeat(600);
  const customDetail = 'Tesettür korunsun. 保留所有細節。 '.repeat(200) + 'FINAL USER REQUIREMENT';
  const settings = {hijabMode: true, hairColor: 'brown', accessories: 'bag', framing: 'full_body', measurements: {height: 178, waist: 64}, weather: 'rain', timeOfDay: 'night'};
  const p = finalize(input, {settings, customDetail, modelReferenceImage: 'identity.jpg'});
  assert.ok(p.startsWith(input.trimEnd()));
  assert.ok(p.includes(customDetail));
  for (const choice of ['brown', 'bag', '178', '64', 'rain', 'night', 'head-to-toe', 'MODEST HIJAB']) assert.ok(p.includes(choice));
  assert.doesNotMatch(p, /MODEL HAIRSTYLING:/);
  assert.match(finalize('Fallback product description', {}), /FINISHED FASHION CAMPAIGN/);
});
