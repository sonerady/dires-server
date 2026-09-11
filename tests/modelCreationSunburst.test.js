const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SUNBURST_EDIT_MODEL, usesNb2ForModelCreation, usesSunburstForModelCreation, isSunburstContentRejection } = require('../src/utils/modelCreationModel');
const noop = () => {};

test('creation V1 selects Sunburst; V2 and separate editing workflows retain their model', () => {
  assert.equal(usesSunburstForModelCreation(), true);
  assert.equal(usesNb2ForModelCreation(), false);
  assert.equal(usesSunburstForModelCreation({qualityVersion: 'v1'}), true);
  assert.equal(usesNb2ForModelCreation({qualityVersion: 'v2'}), false);
  assert.equal(usesSunburstForModelCreation({qualityVersion: 'v2'}), false);
  for (const flag of ['isBackSideAnalysis', 'isPoseChange', 'isColorChange', 'isEditMode', 'isRefinerMode']) {
    assert.equal(usesSunburstForModelCreation({[flag]: true}), false, flag);
    assert.equal(usesNb2ForModelCreation({[flag]: true}), false, flag);
  }
});

for (const route of ['referenceBrowserRoutesV7.js', 'referenceJewelryBrowserRoutesV7.js']) {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes', route), 'utf8');
  const start = source.indexOf('async function callFalAiGptImage2Edit(');
  const helper = source.slice(start, source.indexOf('// App-level config', start));
  function load(queue) {
    return vm.runInNewContext(`${helper}; callFalAiGptImage2Edit`, {
      ...require('../src/utils/gpt25Edit'), fal: {queue}, SUNBURST_EDIT_MODEL, isSunburstContentRejection,
      logger: {log: noop}, console: {error: noop},
      setTimeout: callback => {callback(); return 0;},
    });
  }
  test(`${route}: V1 bypasses a disabled legacy GPT flag and sends Sunburst`, async () => {
    const start = source.indexOf('          const useSunburst =');
    const snippet = source.slice(start, source.indexOf('          logger.log(', start));
    let reads = 0;
    const result = await vm.runInNewContext(`(async()=>{${snippet};return {useSunburst,useGpt}})()`, {
      modelCreationOptions: {qualityVersion: 'v1'}, modelCreationProvider: 'gpt',
      qualityVersion: 'v1', req: {body: {}}, isPoseChange: false, isColorChange: false,
      isEditMode: false, isRefinerMode: false, usesSunburstForModelCreation, usesNb2ForModelCreation,
      isGptEnabledForV1: async () => {reads++; return false;},
    });
    assert.equal(result.useSunburst, true);
    assert.equal(result.useGpt, true);
    assert.equal(reads, 0);
  });
  test(`${route}: submit, polling and result all use Sunburst and preserve references`, async () => {
    const calls = [];
    const queue = {
      submit: async (model, options) => {calls.push({method:'submit',model,options}); return {request_id:'job-1'};},
      status: async (model, options) => {calls.push({method:'status',model,options}); return {status:'COMPLETED'};},
      result: async (model, options) => {calls.push({method:'result',model,options}); return {data:{images:[{url:'https://example.com/result.jpg'}]}};},
    };
    const refs = ['https://example.com/product.jpg','https://example.com/style.jpg'];
    const result = await load(queue)('Preserve the product and model.', refs, 'portrait_16_9', 1, SUNBURST_EDIT_MODEL, '9:16');
    assert.equal(result, 'https://example.com/result.jpg');
    assert.deepEqual(calls.map(c=>c.model), Array(3).fill(SUNBURST_EDIT_MODEL));
    assert.deepEqual(calls[0].options.input.image_urls, refs);
    assert.deepEqual(calls[0].options.input.image_size, {width: 1440, height: 2560}); // 9:16 → ~4 MP sabit boyut
    assert.equal(calls[0].options.input.quality, 'medium');
    assert.equal(calls[0].options.input.output_format, 'jpeg');
    assert.equal(calls[0].options.input.num_images, 1);
    assert.equal(calls[0].options.input.aspect_ratio, undefined);
    assert.equal(calls[0].options.input.thinking_level, undefined);
    assert.equal(calls[2].options.requestId, 'job-1');
  });
  test(`${route}: content checker rejection exits GPT on the first error`, async () => {
    for (const stage of ['submit', 'result']) {
      const error = Object.assign(new Error('Error validating the input'), {status: 422,
        body: {detail: [{loc: ['body', 'prompt'], msg: 'The content could not be processed because it contained material flagged by a content checker.'}]}});
      let submits = 0;
      const run = load({
        submit: async () => {submits++; if (stage === 'submit') throw error; return {request_id: 'job'};},
        status: async () => ({status: 'COMPLETED'}),
        result: async () => {throw error;},
      });
      await assert.rejects(run('product photo', ['https://example.com/product.jpg'], 'auto', 3, SUNBURST_EDIT_MODEL), e => e === error);
      assert.equal(submits, 1);
    }
  });
  test(`${route}: content rejection switches immediately to NB2; retries stay on NB2`, async () => {
    const start = source.indexOf('        if (req.body.isBackSideAnalysis || !isV2) {');
    const end = source.indexOf('        // Back side analysis veya v2 modunda quality', start);
    const branch = source.slice(start, end);
    let gptCalls = 0, nbCalls = 0;
    const refs = ['https://example.com/product.jpg'];
    const result = await vm.runInNewContext(`(async()=>{
      let replicateResponse, sunburstRejected = false; const retryReasons = [];
      for(let attempt=1; attempt<=3; attempt++) { try {${branch}} catch(e) {if(attempt===3)throw e;} }
      return replicateResponse;
    })()`, {
      modelCreationOptions: {qualityVersion: 'v1'}, modelCreationProvider: 'gpt',
      isTrialUser: false, // 🎁 trial kullanıcıda kalite xhigh'a çıkar; bu senaryo normal kullanıcı
      req: {body: {}}, isV2: false, qualityVersion: 'v1', isPoseChange: false,
      isColorChange: false, isEditMode: false, isRefinerMode: false,
      usesSunburstForModelCreation, usesNb2ForModelCreation, isSunburstContentRejection, SUNBURST_EDIT_MODEL,
      logger: {log: noop}, enhancedPrompt: 'product photo', imageInputArray: refs,
      aspectRatioForRequest: '3:4', userId: 'test', safetyTolerance: '4',
      mapRatioToGptImage2Size: () => 'portrait_4_3', ensureMaxAspectRatio3to1ForInput: async r => r,
      callFalAiGptImage2Edit: async () => {gptCalls++; throw Object.assign(new Error('material flagged by a content checker'), {status: 422});},
      getNb2ThinkingLevel: async () => 'off', process: {env: {FAL_API_KEY: 'test'}}, uuidv4: () => 'test',
      axios: {post: async (url, body) => {
        nbCalls++;
        assert.equal(url, 'https://fal.run/fal-ai/nano-banana-2/edit');
        assert.equal(body.prompt, 'product photo'); assert.deepEqual(body.image_urls, refs);
        assert.equal(body.safety_tolerance, '4'); assert.equal(body.aspect_ratio, '3:4');
        if(nbCalls===1) throw new Error('temporary NB2 failure');
        return {data: {images: [{url: 'https://example.com/nb2.png'}]}};
      }},
    });
    assert.equal(gptCalls, 1); assert.equal(nbCalls, 2);
    assert.equal(result.data.output[0], 'https://example.com/nb2.png');
  });
  test(`${route}: rejects excess references without silently dropping product data`, async () => {
    let calls = 0;
    const run = load({submit: async()=>{calls++;}});
    await assert.rejects(run('test',Array(17).fill('https://example.com/product.jpg'),'auto',1,SUNBURST_EDIT_MODEL),/1–16/);
    assert.equal(calls,0);
  });
  test(`${route}: retries failed jobs on Sunburst, never Nano Banana`, async () => {
    const models=[];let submitted=0;
    const run=load({
      submit: async model=>{models.push(model);return {request_id:`job-${++submitted}`};},
      status: async()=>({status: submitted===1?'FAILED':'COMPLETED'}),
      result: async()=>({data:{images:[{url:'https://example.com/retry.jpg'}]}}),
    });
    assert.equal(await run('test',['https://example.com/product.jpg'],'square_hd',2,SUNBURST_EDIT_MODEL),'https://example.com/retry.jpg');
    assert.deepEqual(models,[SUNBURST_EDIT_MODEL,SUNBURST_EDIT_MODEL]);
  });
}

test('fallback distinguishes content refusals from unrelated validation or network errors', () => {
  assert.equal(isSunburstContentRejection({response: {status: 422, data: {detail: [{type: 'content_policy_violation'}]}}}), true);
  assert.equal(isSunburstContentRejection({status: 422, body: {detail: 'Invalid image size'}}), false);
  assert.equal(isSunburstContentRejection({status: 500, message: 'content checker unavailable'}), false);
});
