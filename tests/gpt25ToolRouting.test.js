const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const parser = require('../../client/node_modules/@babel/parser');
const api = { ...require('../src/utils/gpt25Edit'), ...require('../src/utils/nb2ToolEdit') };
function read(name) {
 const source=fs.readFileSync(path.join(__dirname,'../src/routes',name+'.js'),'utf8');
 const ast=parser.parse(source,{sourceType:'script'}), nodes=[];
 function visit(n){if(!n||typeof n!=='object')return;if(n.type)nodes.push(n);for(const [k,v] of Object.entries(n))if(k!=='loc')Array.isArray(v)?v.forEach(visit):visit(v);}
 visit(ast);return {source,nodes,code:n=>source.slice(n.start,n.end)};
}
const original={prompt:'Preserve source; use selected pose',image_urls:['https://test/source','https://test/product'],aspect_ratio:'9:16',resolution:'2K',input_fidelity:'high',safety_tolerance:'6',enable_web_search:true,num_images:1,output_format:'png'};
function assertGpt(input){assert.equal(input.quality,'high'); // V1 genel kalite (app_config.gpt25_quality varsayılanı) 11 Eyl 2026'da high oldu
 assert.deepEqual(Array.from(input.image_urls),original.image_urls);for(const key of ['input_fidelity','resolution','aspect_ratio','enable_web_search','safety_tolerance'])assert.equal(key in input,false,key);assert.equal(input.prompt,original.prompt);assert.equal(input.image_size.width/input.image_size.height,9/16);}
for (const name of ['changePose', 'changePoseWeb', 'changeProductColor', 'changeProductColorWeb', 'backSideCloset', 'backSideClosetWeb']) {
 const route = read(name);
 test(`${name}: single, bulk and retry calls use NB2 directly for both quality versions`, async () => {
  const selectors = route.nodes.filter(n => n.type === 'VariableDeclarator' && n.id.name === 'falModel' && n.init);
  assert.ok(selectors.length);
  const calls = route.nodes.filter(n => n.type === 'CallExpression' && n.callee?.object?.name === 'axios' && n.callee?.property?.name === 'post' && /\$\{(?:falModel|retryModel)\}/.test(route.code(n.arguments[0])));
  assert.equal(calls.length, name.startsWith('changeProductColor') ? 3 : 2, 'main, failed-status retry, and bulk where applicable');
  for (const qualityVersion of ['v1', 'v2']) {
   const ctx = {...api, qualityVersion, settings: {qualityVersion}, isV2: qualityVersion === 'v2', req: {body: {}}, process: {env: {FAL_API_KEY: 'fixture'}}, requestBody: original, retryRequestBody: original};
   for (const node of selectors) assert.equal(vm.runInNewContext(route.code(node.init), ctx), api.NB2_EDIT_MODEL);
   const retries = route.nodes.filter(n => n.type === 'VariableDeclarator' && n.id.name === 'retryModel');
   for (const node of retries) for (const selectedFalModel of [null, api.NB2_EDIT_MODEL]) assert.equal(vm.runInNewContext(route.code(node.init), {...ctx, selectedFalModel}), api.NB2_EDIT_MODEL);
   for (const call of calls) {
    let sent;
    await vm.runInNewContext(route.code(call), {...ctx, falModel: api.NB2_EDIT_MODEL, retryModel: api.NB2_EDIT_MODEL, axios: {post: async (url, input) => {sent = {url, input};}}});
    assert.equal(sent.url, 'https://fal.run/fal-ai/nano-banana-2/edit');
    assert.deepEqual(Array.from(sent.input.image_urls), original.image_urls);
    assert.equal(sent.input.prompt, original.prompt);
    assert.equal(sent.input.aspect_ratio, '9:16');
    assert.equal(sent.input.resolution, '2K');
    for (const key of ['quality', 'image_size', 'input_fidelity', 'source_size']) assert.equal(key in sent.input, false, key);
   }
  }
  assert.equal(route.nodes.filter(n => n.type === 'AssignmentExpression' && n.left.name === 'falModel').length, 0, 'errors cannot switch to a different provider');
 });
}
for(const name of ['createRefiner','createRefinerWeb'])test(`${name}: reference images and ratio survive medium GPT queue submit/status/result`,async()=>{
 const route=read(name);const fn=route.nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='callFalAiGptImageEditForRefiner');
 const calls=[];const ctx={...api,normalizeRefinerRatio:r=>r,DEFAULT_REFINER_RATIO:'3:4',console,logger:{log(){}},isNewRefinerEnabled:()=>{throw Error('Old model switch must not run');},fal:{queue:{submit:async(model,{input})=>{calls.push({model,input});return{request_id:'fixture'};},status:async(model)=>{assert.equal(model,api.GPT25_EDIT_MODEL);return{status:'COMPLETED'};},result:async(model)=>{assert.equal(model,api.GPT25_EDIT_MODEL);return{data:{images:[{url:'https://test/output'}]}};}}}};
 vm.createContext(ctx);vm.runInContext(route.code(fn),ctx);
 const urls=['https://test/product','https://test/style','https://test/color','https://test/layout'];
 const result= name==='createRefiner'?await ctx.callFalAiGptImageEditForRefiner('prompt',urls,'16:9',1):await ctx.callFalAiGptImageEditForRefiner('prompt',urls,1,'16:9');
 assert.equal(result,'https://test/output');assert.equal(calls[0].model,api.GPT25_EDIT_MODEL);assert.deepEqual(Array.from(calls[0].input.image_urls),urls);assert.equal(calls[0].input.quality,'high');assert.equal(calls[0].input.image_size.width/calls[0].input.image_size.height,16/9);assert.equal('input_fidelity'in calls[0].input,false);
 if(name==='createRefiner'){
  const dispatch=route.nodes.find(n=>n.type==='VariableDeclarator'&&n.id.name==='gptImageResult'&&route.code(n.init).includes('refinerFinalPrompt'));
  let passed;await vm.runInNewContext('(async()=>'+route.code(dispatch.init)+')()', {refinerFinalPrompt:'staging',refinerInputs:urls,refinerOutputRatio:'16:9',callFalAiGptImageEditForRefiner:async(...args)=>{passed=args;}});assert.equal(passed[1],urls);
 }
});
test('Edit room V4 uses NB2 for tools and retains other generation routes', async () => {
 const r = read('referenceBrowserRoutesV4');
 const toolSelector = r.nodes.find(n => n.type === 'VariableDeclarator' && n.id.name === 'isNb2Tool');
 const modelSelector = r.nodes.find(n => n.type === 'VariableDeclarator' && n.id.name === 'falModel');
 for (const isV2 of [false, true]) {
  for (const mode of ['edit', 'pose', 'color', 'backside', 'normal']) {
   const ctx = {...api, isV2, isEditMode: mode === 'edit', isPoseChange: mode === 'pose', isColorChange: mode === 'color', req: {body: {isBackSideAnalysis: mode === 'backside'}}};
   const isNb2Tool = vm.runInNewContext(r.code(toolSelector.init), ctx);
   const model = vm.runInNewContext(r.code(modelSelector.init), {...ctx, isNb2Tool});
   assert.equal(model, mode === 'normal' ? (isV2 ? 'fal-ai/nano-banana-pro/edit' : 'google/nano-banana-lite/edit') : api.NB2_EDIT_MODEL);
  }
 }
 const call = r.nodes.find(n => n.type === 'CallExpression' && n.callee?.object?.name === 'axios' && n.callee?.property?.name === 'post' && r.code(n.arguments[0]).includes('${falModel}'));
 let sent;
 await vm.runInNewContext(r.code(call), {...api, falModel: api.NB2_EDIT_MODEL, requestBody: original, process: {env: {FAL_API_KEY: 'fixture'}}, axios: {post: async (url, input) => {sent = {url, input};}}});
 assert.equal(sent.url, 'https://fal.run/'+api.NB2_EDIT_MODEL);
 assert.equal(sent.input.resolution, '2K');
 assert.deepEqual(sent.input.image_urls, original.image_urls);
});
for (const name of ['chatEditRoutes', 'editRoomRoutes']) test(`${name}: NB2 receives edit references and original or selected ratio`, async () => {
 const r = read(name), call = r.nodes.find(n => n.type === 'CallExpression' && n.callee?.object?.name === 'axios' && n.callee?.property?.name === 'post' && r.code(n.arguments[0]).includes('NB2_EDIT_MODEL'));
 assert.ok(call);
 for (const originalRatio of [false, true]) {
  let sent;
  await vm.runInNewContext(r.code(call), {...api, process: {env: {FAL_API_KEY: 'fixture'}}, falRequestBody: {...original, aspect_ratio: originalRatio ? 'auto' : '9:16'}, enhancedPrompt: original.prompt, referenceImageUrl: original.image_urls[0], formattedRatio: '9:16', match_input_image: originalRatio, axios: {post: async (url, input) => {sent = {url, input}; return {};}}});
  assert.equal(sent.url, 'https://fal.run/'+api.NB2_EDIT_MODEL);
  assert.equal(sent.input.resolution, '2K');
  assert.equal(sent.input.aspect_ratio, originalRatio ? 'auto' : '9:16');
  assert.equal('quality' in sent.input, false);
  assert.deepEqual(Array.from(sent.input.image_urls), name === 'chatEditRoutes' ? original.image_urls : original.image_urls.slice(0, 1));
 }
});

test('NB2 input strips GPT sizing/quality without mutating edit images or source ratio choice', () => {
 const input = {...original, aspect_ratio: 'original', quality: 'high', source_size: {width: 1800, height: 2400}, image_size: {width: 1440, height: 2560}};
 const output = api.buildNb2EditInput(input);
 assert.equal(output.aspect_ratio, 'auto');
 assert.equal(output.resolution, '2K');
 assert.deepEqual(output.image_urls, input.image_urls);
 assert.equal(output.enable_web_search, true);
 for (const key of ['quality', 'source_size', 'image_size', 'input_fidelity']) assert.equal(key in output, false);
 assert.equal(input.quality, 'high');
 assert.equal(input.aspect_ratio, 'original');
});

// Execute the actual dispatch through the HTTP request, including retry attempts.
for (const name of ['referenceBrowserRoutesV7', 'referenceJewelryBrowserRoutesV7']) test(`${name}: all V2 users submit directly to NB Pro 2K`, async () => {
 const r = read(name);
 const model = r.nodes.find(n => n.type === 'VariableDeclarator' && n.id.name === 'falModel' && n.init?.value === 'fal-ai/nano-banana-pro/edit');
 const send = r.nodes.find(n => n.type === 'CallExpression' && n.callee.object?.name === 'axios' && n.callee.property?.name === 'post' && r.code(n.arguments[0]).includes('${falModel}'));
 const start = r.source.lastIndexOf('const falModel', model.start);
 const dispatch = r.source.slice(start, send.end) + ';';
 for (const legacy of [false, true]) for (const attempt of [1, 2]) {
  const calls = [];
  const ctx = {
   isV2: true, qualityVersion: 'v2', req: {body: {}}, attempt,
   legacyFlags: {useNbproV2: legacy, skipAutoPoolModel: legacy},
   getV2Model: () => {throw Error('Global GPT configuration must not route V2');},
   callFalAiGptImage2Edit: () => {throw Error('V2 must not submit GPT');},
   isPoseChange: false, isMultipleImages: false, referenceImages: [],
   enhancedPrompt: 'Preserve product and selected scene', imageInputArray: original.image_urls,
   formattedRatio: '9:16', safetyTolerance: '4',
   logger: {log() {}}, process: {env: {FAL_API_KEY: 'fixture'}},
   axios: {post: async (url, input) => {calls.push({url, input}); return {}; }},
  };
  await vm.runInNewContext(`(async()=>{let requestBody;for(let once=0;once<1;once++){${dispatch}}})()`, ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fal.run/fal-ai/nano-banana-pro/edit');
  assert.equal(calls[0].input.resolution, '2K');
  assert.equal(calls[0].input.aspect_ratio, '9:16');
  assert.deepEqual(calls[0].input.image_urls, original.image_urls);
  assert.equal(calls[0].input.prompt, ctx.enhancedPrompt);
 }
});

for (const name of ['referenceBrowserRoutesV7', 'referenceJewelryBrowserRoutesV7']) test(`${name}: V1 uses NB2 1K for trial, paid and legacy users`, async () => {
 const r = read(name);
 const provider = r.nodes.find(n => n.type === 'VariableDeclarator' && n.id.name === 'modelCreationProvider');
 const branch = r.nodes.find(n => n.type === 'IfStatement' && r.code(n.test) === 'req.body.isBackSideAnalysis || !isV2');
 for (const isTrialUser of [false, true]) for (const legacy of [false, true]) {
  const calls = [];
  const ctx = {
   ...require('../src/utils/modelCreationModel'),
   isV2: false, isTrialUser, req: {body: {}},
   modelCreationOptions: {qualityVersion: 'v1'},
   modelCreationProvider: vm.runInNewContext(r.code(provider.init)),
   legacyFlags: {useNbproV2: legacy},
   isGptEnabledForV1: () => {throw Error('V1 must not read the legacy GPT switch');},
   callFalAiGptImage2Edit: () => {throw Error('V1 must not submit GPT');},
   getNb2ThinkingLevel: async () => 'off',
   enhancedPrompt: original.prompt, imageInputArray: original.image_urls,
   aspectRatioForRequest: '9:16', safetyTolerance: '4', uuidv4: () => 'fixture',
   logger: {log() {}}, process: {env: {FAL_API_KEY: 'fixture'}},
   axios: {post: async (url, input) => {calls.push({url, input}); return {data: {images: [{url: 'https://test/result'}]}};}},
  };
  await vm.runInNewContext(`(async()=>{let replicateResponse;for(let attempt=1;attempt<=1;attempt++){${r.code(branch)}}})()`, ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fal.run/fal-ai/nano-banana-2/edit');
  assert.equal(calls[0].input.resolution, '1K');
  assert.equal(calls[0].input.aspect_ratio, '9:16');
  assert.deepEqual(calls[0].input.image_urls, original.image_urls);
  assert.equal(calls[0].input.prompt, original.prompt);
 }
});
