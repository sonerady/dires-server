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

test('standard final prompt replaces repeated briefs with one compact rule block and ends in user choices', () => {
  const narrative = 'Create a new fashion campaign photograph. Garment and scene narrative.';
  const settings = {productCategory: 'clothing', location: 'Coastal terrace', pose: 'Sideways gaze', gender: 'woman', age: '22'};
  const customDetail = 'パンツスタイルだと分かるように。足元はサンダルを履いて下さい。';
  const p = finalize(narrative, {settings, customDetail, modelReferenceImage: 'identity.jpg'});
  const oldLength = context.universal(narrative).length + fashion.buildFashionCampaignDirection({settings}).length + locks.buildUserInstructionLock({settings, customDetail}).length;
  assert.ok(p.length < oldLength * 0.65, 'remove redundancy rather than merely rename headings');
  assert.ok(p.startsWith(narrative));
  assert.equal(p.split('FASHION PHOTOGRAPH — REFERENCE AND QUALITY RULES:').length - 1, 1);
  assert.doesNotMatch(p, /PHOTOGRAPHIC REALISM — NON-NEGOTIABLE|FINISHED FASHION CAMPAIGN/);
  assert.ok(p.includes(customDetail));
  assert.match(p, /MODEL HAIRSTYLING/);
  assert.ok(p.indexOf('USER-LOCKED REQUIREMENTS') > p.indexOf('MODEL HAIRSTYLING'));
  assert.ok(p.endsWith('without showing it.'));
});

test('compact safeguards retain deliberately added fashion, fidelity, exposure and user exceptions', () => {
  const p = fashion.buildFashionRenderDirection();
  for (const phrase of [
    'original fit and hem length', 'tiny emblems without inventing lettering',
    'Do not tighten, tuck, cinch', 'fabric curvature', 'contact shadows',
    'recognizable identity', 'No fixed pose recipe', 'selected mood prevail',
    'explicitly broad smile or laugh', 'babies must be safely supported',
    'camera-ready makeup', 'fine skin texture', 'Children receive age-appropriate grooming',
    'hijab requirements', 'Do not invent a companion', 'adjacent surfaces coherently',
    'explicitly requested dark or muted', 'white/cream distinctions',
    "dark venue's character", 'No automatic warm grade', 'one horizon',
    'without artificial blur masks', 'CGI surfaces', 'named changes; preserve everything else',
  ]) assert.ok(p.includes(phrase), phrase);
});

test('white studio and close-up safeguards stay conditional', () => {
  const p = fashion.buildFashionRenderDirection({settings: {location: 'White studio', framing: 'close_up'}});
  assert.match(p, /CLEAN WHITE BACKDROP/);
  assert.match(p, /including their reflections/);
  assert.match(p, /behind-the-scenes equipment take precedence/);
  assert.match(p, /without widening it/);
  assert.doesNotMatch(p, /breathing room/);
  assert.doesNotMatch(fashion.buildFashionRenderDirection({settings: {location: 'White House Garden'}}), /CLEAN WHITE BACKDROP/);
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
  assert.ok(p.startsWith(input));
  assert.ok(p.includes(customDetail));
  for (const choice of ['brown', 'bag', '178', '64', 'rain', 'night', 'head-to-toe', 'MODEST HIJAB']) assert.ok(p.includes(choice));
  assert.doesNotMatch(p, /MODEL HAIRSTYLING:/);
  assert.match(finalize('Fallback product description', {}), /FASHION PHOTOGRAPH — REFERENCE AND QUALITY RULES/);
});
