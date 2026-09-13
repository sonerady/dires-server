const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bag = require('../src/utils/bagCampaignPrompt');
const fashion = require('../src/utils/fashionCampaignPrompt');
const source = fs.readFileSync(require.resolve('../src/routes/referenceBrowserRoutesV7'), 'utf8');
const context = {...bag, ...fashion, ...require('../src/utils/footwearPrompt'), ...require('../src/utils/modelHairDirection'), ...require('../src/utils/userInstructionLock'), logger: {log(){}}};
vm.runInNewContext(source.slice(source.indexOf('const PRODUCT_CATEGORIES ='), source.indexOf('async function callReplicateGeminiFlash(')), context);
vm.runInNewContext(source.slice(source.indexOf('const UNIVERSAL_PHOTOREALISM_DIRECTIVE ='), source.indexOf('// Replicate API üzerinden')) + '\n' + source.slice(source.indexOf('function finalizeGenerationPrompt('), source.indexOf('router.post("/generate"')), context);

test('only the primary detected bag selects the bag brief, never a supporting accessory or an edit', () => {
  assert.equal(bag.isBagShoot({productCategory:'clothing', productSubtype:'bag'}), true);
  assert.equal(bag.isBagShoot({productCategory:' Clothing ', productSubtype:' BAG '}), true);
  for(const s of [null, {}, {productCategory:'clothing', productSubtype:'top', accessories:'bag'}, {productCategory:'jewelry', productSubtype:'bag'}, {productCategory:'clothing', location:'Bag boutique'}]) assert.equal(bag.isBagShoot(s), false);
  for(const key of ['isColorChange','isPoseChange','isEditMode','isRefinerMode','isBackSideAnalysis']) assert.equal(bag.isBagShoot({productCategory:'clothing', productSubtype:'bag'}, {[key]:true}), false);
});

test('detector subtype reaches the actual shared settings and stale bag classification cannot leak', () => {
  const resolve=context.resolveGenerationProductSettings;
  const s=resolve({location:'Garden',productCategory:'clothing'}, {productCategory:'clothing',productSubtype:'bag'});
  assert.equal(s.productSubtype,'bag'); assert.equal(s.location,'Garden');
  assert.equal(resolve(s,{productCategory:'clothing',productSubtype:'top'}).productSubtype,'top');
  assert.equal(resolve(s,{productCategory:'clothing'}).productSubtype,null);
  assert.equal(resolve(s,{productCategory:'shoes',productSubtype:'bag'}).productSubtype,null);
  assert.equal(resolve(s,{}).productSubtype,'bag');
  assert.match(source,/settings = resolveGenerationProductSettings\(settings, req.body\)/);
});

test('bag brief keeps construction and creative freedom rather than encoding the garden example', () => {
  const p=bag.buildBagEnhanceInstruction({settings:{location:'Ballet studio'},originalPrompt:'Ballet studio, adult woman',customDetail:'Keep this strap and look down',multipleAnglesCount:2});
  for(const text of ['carrying options','one consistent action','No', 'never seated in one paragraph and standing in another', 'Keep this strap and look down','2 views of ONE bag','Ballet studio','No']) {
    // Case-insensitive for ordinary prose.
    assert.ok(p.toLowerCase().includes(text.toLowerCase()),text);
  }
  assert.match(p,/Never invent a strap, handle or logo/);
  assert.match(p,/Do not require sitting, a specific hand position, fixed gaze, garden, bench or ivory outfit/);
  assert.match(p,/for children use age-appropriate grooming/);
  assert.match(p,/camera-ready grooming and makeup/);
});

test('bag framing respects manual crops and does not ask to display an upper garment', () => {
  assert.match(bag.buildBagFocusDirective({focusArea:'upper_body'}),/including the complete bag/);
  const tight=bag.buildBagFocusDirective({focusArea:'upper_body',framing:'close_up'});
  assert.match(tight,/explicitly selected close_up/);
  assert.doesNotMatch(tight,/head, torso and hip/);
  assert.match(bag.buildBagFocusDirective({focusArea:'full_body'}),/both feet/);
});

test('actual finalizer uses bag rules without clothing transformation and keeps user locks last', () => {
  const p=context.finalizeGenerationPrompt('Accessories scene',{settings:{productCategory:'clothing',productSubtype:'bag',hijabMode:true,pose:'seated'}, customDetail:'No bench. Stand beside the wall.'});
  assert.match(p,/BAG FASHION CAMPAIGN/);
  assert.match(p,/No bench. Stand beside the wall./);
  assert.match(p,/MODEST HIJAB/);
  assert.match(p,/MODEL POSE INSPIRATION/);
  assert.doesNotMatch(p,/GARMENT-TO-BODY|FASHION PHOTOGRAPH — REFERENCE AND QUALITY RULES/);
  assert.ok(p.endsWith('without showing it.'));
});

test('style-directed bags retain the style photographic language and editing modes keep their former path', () => {
  const settings={productCategory:'clothing',productSubtype:'bag'};
  for(const options of [{styleDirected:true},{autoStyleGridUrl:'street.jpg'},{styleReferenceUrl:'style.jpg'},{editorialCollagesForRequest:['editorial.jpg']}]) {
    const p=context.finalizeGenerationPrompt('Explicit raw street photograph',{settings,...options});
    assert.match(p,/BAG PRODUCT FIDELITY/);
    assert.match(p,/BAG STYLE PRIORITY/);
    assert.doesNotMatch(p,/BAG FASHION CAMPAIGN/);
  }
  for(const key of ['isColorChange','isPoseChange','isEditMode','isRefinerMode','isBackSideAnalysis']) {
    const p=context.finalizeGenerationPrompt('Edit request',{settings,[key]:true});
    assert.match(p,/PHOTOGRAPHIC REALISM — NON-NEGOTIABLE/);
    assert.doesNotMatch(p,/BAG FASHION CAMPAIGN/);
  }
});

test('actual enhancer bag branch replaces generic fashion prompt while preserving input data', () => {
  const start=source.indexOf('    if (isBagShoot(settings,',source.indexOf('async function enhancePromptWithGemini('));
  const end=source.indexOf('    logger.log("🤖 [GEMINI] Prompt oluşturuluyor:',start);
  const c={...bag, buildFashionPoseContext:fashion.buildFashionPoseContext,settings:{productCategory:'clothing',productSubtype:'bag',pose:'Look left'},originalPrompt:'Garden',trimmedCustomDetail:'Do not change the sequins.',styleDirected:false,multipleAnglesCount:2,kombinItemCount:0,isMultipleProducts:false,hasUserPose:true,promptForGemini:'Generic garment instructions',isColorChange:false,isPoseChange:false,isEditMode:false,isRefinerMode:false,isBackSideAnalysis:false};
  for(const name of ['ageSection','childPromptSection','bodyShapeMeasurementsSection','settingsPromptSection','perspectivePromptSection','hairStylePromptSection','hairStyleTextSection','locationPromptSection','faceDescriptionSection']) c[name]=name;
  vm.runInNewContext(source.slice(start,end),c);
  assert.match(c.promptForGemini,/BAG \/ HANDBAG/);
  assert.match(c.promptForGemini,/Do not change the sequins/);
  assert.match(c.promptForGemini,/Look left/);
  assert.doesNotMatch(c.promptForGemini,/Generic garment instructions/);
});
