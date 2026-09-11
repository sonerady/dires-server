const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('../../client/node_modules/@babel/parser');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/refinerResultFinishing.js'), 'utf8');

function setup(failure) {
  const calls = [], stages = [], selected = [];
  const context = { module: {exports: {}}, require(name) {
    if (name === './logger') return {log() {}, warn() {}};
    if (name === './resultUpscale') return {
      markGenerationStage: async (_id, _user, stage) => { stages.push(stage); },
      upscaleResultImage: async (url, mp) => {
        calls.push({url, mp});
        if (failure === 'timeout') throw Error('provider timeout');
        return failure === 'empty' ? null : 'https://test/pruna4.jpg';
      },
      applyResultUpscale: async options => {
        selected.push(options);
        return Number(options.upscaleMp) > 4
          ? {imageUrl: 'https://test/selected16.jpg', appliedMp: 16, preUpscaleUrl: options.imageUrl, creditsCharged: 40}
          : {imageUrl: options.imageUrl, appliedMp: null, preUpscaleUrl: null, creditsCharged: 0};
      },
    };
    throw Error('Unexpected dependency ' + name);
  }};
  vm.runInNewContext(source, context);
  return { ...context.module.exports, calls, stages, selected };
}
const request = {isRefinerMode: true, settings: {productCategory: 'jewelry', productSubtype: 'ring'}};
const options = {request, imageUrl: 'https://test/gpt.jpg', userId: 'device-account', generationId: 'main', upscaleMp: 4};

test('non-garment classifier and staging categories opt in, including clothing/eyewear and clothing/accessory', () => {
  const {shouldFinishRefinerMain: eligible} = setup();
  for (const [category, subtype] of [['clothing','eyewear'], ['clothing','bag'], ['clothing','accessory'], ['shoes','sneakers'], ['jewelry','ring']]) {
    assert.equal(eligible({isRefinerMode: true, settings: {productCategory: category, productSubtype: subtype}}), true, `${category}/${subtype}`);
  }
  for (const category of ['eyewear', 'rings', 'earrings', 'necklaces', 'bracelets_chain', 'bracelets_bangle']) {
    assert.equal(eligible({isRefinerMode: true, productCategory: category}), true, category);
  }
});

test('all actual garments, unknown categories, non-Refiner requests and variants stay excluded', () => {
  const {shouldFinishRefinerMain: eligible} = setup();
  for (const subtype of ['dress', 'top', 'bottom', 'outerwear', 'knitwear', 'swimwear', 'lingerie', null]) {
    assert.equal(eligible({isRefinerMode: true, settings: {productCategory: 'clothing', productSubtype: subtype}}), false, subtype);
  }
  for (const req of [{}, {isRefinerMode:true}, {...request, isRefinerMode:false}, {...request, isVariant:true}, {...request, isVariation:true}, {...request, settings:{...request.settings, isVariation:true}}]) assert.equal(eligible(req), false);
});

test('main GPT output passes through Pruna exactly once at 4 MP with no extra fee', async () => {
  const h = setup();
  const result = await h.finishRefinerMainResult(options);
  assert.deepEqual(h.calls, [{url: options.imageUrl, mp:4}]);
  assert.equal(result.imageUrl, 'https://test/pruna4.jpg');
  assert.equal(result.appliedMp, 4);
  assert.equal(result.preUpscaleUrl, options.imageUrl);
  assert.equal(result.creditsCharged, 0);
  assert.deepEqual(h.stages, ['upscaling', null]);
});

for (const failure of ['timeout', 'empty']) test(`${failure}: first failure immediately delivers original GPT and skips any further Pruna pass`, async () => {
  const h = setup(failure);
  const result = await h.finishRefinerMainResult({...options, upscaleMp:16});
  assert.equal(h.calls.length, 1);
  assert.equal(h.selected.length, 0);
  assert.equal(result.imageUrl, options.imageUrl);
  assert.equal(result.appliedMp, null);
  assert.equal(result.creditsCharged, 0);
  assert.deepEqual(h.stages, ['upscaling', null]);
});

test('explicit higher MP choice remains available after successful included finishing', async () => {
  const h = setup();
  const result = await h.finishRefinerMainResult({...options, upscaleMp:16});
  assert.equal(h.selected[0].imageUrl, 'https://test/pruna4.jpg');
  assert.equal(result.imageUrl, 'https://test/selected16.jpg');
  assert.equal(result.appliedMp, 16);
  assert.equal(result.creditsCharged, 40);
});

test('garment results do not trigger automatic Pruna processing', async () => {
  const h = setup();
  const result = await h.finishRefinerMainResult({...options, request:{isRefinerMode:true, settings:{productCategory:'clothing', productSubtype:'dress'}}});
  assert.equal(h.calls.length, 0);
  assert.equal(result.imageUrl, options.imageUrl);
});

for (const name of ['createRefiner', 'createRefinerWeb']) test(`${name}: first Pruna failure is saved as completed and the client receives the stored GPT image`, async () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes', name+'.js'), 'utf8');
  const ast = parser.parse(route, {sourceType:'script'}), nodes = [];
  function visit(n) { if (!n || typeof n !== 'object') return; if (n.type) nodes.push(n); for (const [k,v] of Object.entries(n)) if(k!=='loc') Array.isArray(v) ? v.forEach(visit) : visit(v); }
  visit(ast);
  const h = setup('timeout'), saved = [];
  const context = {...h, req:{body:request}, gptImageResult:options.imageUrl, upscaleMp:4, userId:'device-account', finalGenerationId:'main', enhancedPrompt:'preserve product', deductCreditOnSuccess:async()=>true,
    updateGenerationStatus:async (id,user,status,updates) => { saved.push({status,updates}); return {result_image_url:'https://storage/gpt-copy.jpg'}; }};
  vm.createContext(context);
  for (const variable of ['upscaleOutcome','refinerUpdated','refinerFinalUrl']) {
    const n = nodes.find(n=>n.type==='VariableDeclarator' && n.id.name===variable);
    assert.ok(n, variable);
    context[variable] = await vm.runInContext('(async()=>('+route.slice(n.init.start,n.init.end)+'))()', context);
  }
  assert.equal(saved[0].status, 'completed');
  assert.equal(saved[0].updates.result_image_url, options.imageUrl);
  assert.equal(saved[0].updates.upscaled_mp, undefined);
  const resultObject = nodes.find(n=>n.type==='ObjectExpression' && n.properties.some(p=>p.key?.name==='imageUrl' && p.value?.name==='refinerFinalUrl'));
  assert.ok(resultObject, 'response contains the completed stored image');
  const imageProp = resultObject.properties.find(p=>p.key?.name==='imageUrl');
  assert.equal(vm.runInContext(route.slice(imageProp.value.start,imageProp.value.end),context),'https://storage/gpt-copy.jpg');
  assert.equal(h.calls.length,1);
});
