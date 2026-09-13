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

test('front-product visibility reaches both enhancement and rendering without fixing a single pose', () => {
  const settings = {productCategory: 'clothing', productSubtype: 'dress', location: 'Ornate White Marble Grand Palace Staircase', hairStyle: 'side_bun_with_curls'};
  const enhanced = fashion.buildFashionCampaignEnhanceInstruction({settings});
  // Regression: the reported generation invented a look-back pose despite a front product photo.
  const rendered = finalize('She gazes back toward the camera, her torso turned away.', {settings});
  for (const prompt of [enhanced, rendered]) {
    assert.match(prompt, /PRODUCT VIEWPOINT PRIORITY/);
    assert.match(prompt, /DEFAULT FRONT-FACING GARMENT/);
    assert.match(prompt, /overrides an automatically invented pose/);
    assert.match(prompt, /do not impose a rigid frontal stance or direct eye contact/);
    assert.match(prompt, /Hairstyle or identity references do not independently request a side- or rear-facing composition/);
    assert.match(prompt, /primary product reference itself shows the back, preserve that view/);
  }
});

test('explicit rear-view requests survive the visibility guard; specialized modes remain unaffected', () => {
  const settings = {productCategory: 'clothing', pose: 'Back view'};
  const customDetail = 'Arkadan çek, elbisenin sırt detayları görünsün.';
  for (const p of [fashion.buildFashionCampaignEnhanceInstruction({settings, customDetail}), finalize('Requested back view', {settings, customDetail})]) {
    assert.ok(p.includes(customDetail));
    assert.match(p, /deliberately selected poses specifying a side or rear view take precedence/);
  }
  for (const options of [{isBackSideAnalysis: true}, {isPoseChange: true}, {styleDirected: true}, {styleReferenceUrl: 'style.jpg'}, {settings: {productCategory: 'clothing', productSubtype: 'bag'}}]) {
    assert.doesNotMatch(finalize('Specialized requested view', options), /PRODUCT VIEWPOINT PRIORITY/);
  }
});

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

// Actual regression: two Galata requests had four product views, no requested
// pose, and generated lateral mid-stride directions. Exercise both stages.
test('Galata multi-angle requests retain frontal output while preserving product evidence and crop', () => {
  const settings = {productCategory: 'clothing', location: 'Magnificent Galata Tower in Historic Istanbul', gender: 'woman', numericAge: 22, focusArea: 'auto', isMultipleAnglesMode: true, multipleAnglesCount: 4, totalGenerations: 2};
  const originalPrompt = 'Person will be in environment and background: Magnificent Galata Tower in Historic Istanbul. Age range: young (teenage model). Gender: woman';
  const enhanced = fashion.buildFashionCampaignEnhanceInstruction({settings, originalPrompt, multipleAnglesCount: 4});
  assert.ok(enhanced.includes(originalPrompt));
  assert.match(enhanced, /4 views of ONE product/);
  for (const draft of ['She is captured mid-stride, her body angled dynamically while her gaze remains fixed on the lens.', 'She pauses mid-stride and turns her head toward the lens.']) {
    const rendered = finalize(draft, {settings, modelReferenceImage: 'identity.jpg'});
    for (const p of [enhanced, rendered]) {
      assert.match(p, /torso and the garment's front facing the camera/);
      assert.match(p, /face looking toward the lens is not sufficient/);
      assert.match(p, /not a request for alternate output viewpoints/);
      assert.match(p, /multiple output images must retain the default front-facing direction/);
      assert.match(p, /Honor the user's camera crop and focus area/);
    }
    assert.match(rendered, /MODEL HAIRSTYLING/);
    assert.match(rendered, /PROFESSIONAL FASHION PRESENTATION/);
    assert.match(rendered, /ON-LOCATION PHOTOGRAPHIC INTEGRATION/);
  }
  const side = finalize('User-requested side profile', {settings: {...settings, pose: 'Side profile', framing: 'close_up'}, customDetail: 'Yandan çek; yalnızca yaka detayı görünsün.'});
  assert.match(side, /Yandan çek; yalnızca yaka detayı görünsün/);
  assert.match(side, /deliberately selected poses specifying a side or rear view take precedence/);
});
