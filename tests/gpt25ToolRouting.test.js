const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const parser = require('../../client/node_modules/@babel/parser');
const api = require('../src/utils/gpt25Edit');
function read(name) {
 const source=fs.readFileSync(path.join(__dirname,'../src/routes',name+'.js'),'utf8');
 const ast=parser.parse(source,{sourceType:'script'}), nodes=[];
 function visit(n){if(!n||typeof n!=='object')return;if(n.type)nodes.push(n);for(const [k,v] of Object.entries(n))if(k!=='loc')Array.isArray(v)?v.forEach(visit):visit(v);}
 visit(ast);return {source,nodes,code:n=>source.slice(n.start,n.end)};
}
const original={prompt:'Preserve source; use selected pose',image_urls:['https://test/source','https://test/product'],aspect_ratio:'9:16',resolution:'2K',input_fidelity:'high',safety_tolerance:'6',enable_web_search:true,num_images:1,output_format:'png'};
function assertGpt(input){assert.equal(input.quality,'medium');assert.deepEqual(Array.from(input.image_urls),original.image_urls);for(const key of ['input_fidelity','resolution','aspect_ratio','enable_web_search','safety_tolerance'])assert.equal(key in input,false,key);assert.equal(input.prompt,original.prompt);assert.equal(input.image_size.width/input.image_size.height,9/16);}
for(const name of ['changePose','changePoseWeb','changeProductColor','changeProductColorWeb']){
 const route=read(name);
 test(`${name}: main and retry go to GPT 2.5 first (all versions), fall back to NB2 on error`,async()=>{
  const selectors=route.nodes.filter(n=>n.type==='VariableDeclarator'&&n.id.name==='falModel'&&n.init);
  assert.ok(selectors.length>=1);
  for(const version of ['v1','v2'])for(const node of selectors){
   const ctx={...api,settings:{qualityVersion:version},qualityVersion:version,isV2:version==='v2',req:{body:{isBackSideAnalysis:version==='v2'}},process:{env:{FAL_API_KEY:'fixture'}},requestBody:original,retryRequestBody:original,NB2_FALLBACK_MODEL:'fal-ai/nano-banana-2/edit'};
   const model=vm.runInNewContext(route.code(node.init),ctx);
   assert.equal(model,api.GPT25_EDIT_MODEL);
   const calls=route.nodes.filter(n=>n.type==='CallExpression'&&n.callee?.object?.name==='axios'&&n.callee?.property?.name==='post'&&route.code(n.arguments[0]).includes('${falModel}'));
   assert.ok(calls.length>=1);
   for(const fm of [api.GPT25_EDIT_MODEL,'fal-ai/nano-banana-2/edit'])for(const call of calls){let sent;await vm.runInNewContext(route.code(call),{...ctx,falModel:fm,axios:{post:async(url,input)=>{sent={url,input};}}});assert.equal(sent.url,'https://fal.run/'+fm);fm===api.GPT25_EDIT_MODEL?assertGpt(sent.input):assert.equal(sent.input,original);}
  }
  // hata durumunda NB2'ye düşüş catch bloğunda
  assert.ok(route.source.includes('falModel = NB_FALLBACK_MODEL'),'nb fallback switch');
  // v2 → yedek nano-banana-pro, v1 → nano-banana-2
  assert.ok(route.source.includes('isV2Request ? NBPRO_FALLBACK_MODEL : NB2_FALLBACK_MODEL'),'v2 nbpro fallback');
 });
}
for(const name of ['backSideCloset','backSideClosetWeb']){
 const route=read(name);
 test(`${name}: GPT 2.5 first, nano banana fallback on error`,async()=>{
  const selectors=route.nodes.filter(n=>n.type==='VariableDeclarator'&&n.id.name==='falModel'&&n.init&&route.code(n.init).includes('GPT25_EDIT_MODEL'));
  assert.equal(selectors.length,1);
  const node=selectors[0];
  const base={...api,isV2:false,req:{body:{}},process:{env:{FAL_API_KEY:'fixture'}},NB2_FALLBACK_MODEL:'fal-ai/nano-banana-2/edit',nbFallbackModel:'fal-ai/nano-banana-2/edit'};
  assert.equal(vm.runInNewContext(route.code(node.init),{...base,useNbFallback:false}),api.GPT25_EDIT_MODEL);
  assert.equal(vm.runInNewContext(route.code(node.init),{...base,useNbFallback:true}),'fal-ai/nano-banana-2/edit');
  const calls=route.nodes.filter(n=>n.type==='CallExpression'&&n.callee?.object?.name==='axios'&&n.callee?.property?.name==='post'&&route.code(n.arguments[0]).includes('${falModel}'));
  assert.ok(calls.length>=1);
  for(const fm of [api.GPT25_EDIT_MODEL,'fal-ai/nano-banana-2/edit'])for(const call of calls){let sent;await vm.runInNewContext(route.code(call),{...base,falModel:fm,requestBody:original,axios:{post:async(url,input)=>{sent={url,input};}}});assert.equal(sent.url,'https://fal.run/'+fm);fm===api.GPT25_EDIT_MODEL?assertGpt(sent.input):assert.equal(sent.input,original);}
  assert.ok(route.source.includes('useNbFallback = true'),'nb fallback switch');
 });
}
for(const name of ['createRefiner','createRefinerWeb'])test(`${name}: reference images and ratio survive medium GPT queue submit/status/result`,async()=>{
 const route=read(name);const fn=route.nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='callFalAiGptImageEditForRefiner');
 const calls=[];const ctx={...api,normalizeRefinerRatio:r=>r,DEFAULT_REFINER_RATIO:'3:4',console,logger:{log(){}},isNewRefinerEnabled:()=>{throw Error('Old model switch must not run');},fal:{queue:{submit:async(model,{input})=>{calls.push({model,input});return{request_id:'fixture'};},status:async(model)=>{assert.equal(model,api.GPT25_EDIT_MODEL);return{status:'COMPLETED'};},result:async(model)=>{assert.equal(model,api.GPT25_EDIT_MODEL);return{data:{images:[{url:'https://test/output'}]}};}}}};
 vm.createContext(ctx);vm.runInContext(route.code(fn),ctx);
 const urls=['https://test/product','https://test/style','https://test/color','https://test/layout'];
 const result= name==='createRefiner'?await ctx.callFalAiGptImageEditForRefiner('prompt',urls,'16:9',1):await ctx.callFalAiGptImageEditForRefiner('prompt',urls,1,'16:9');
 assert.equal(result,'https://test/output');assert.equal(calls[0].model,api.GPT25_EDIT_MODEL);assert.deepEqual(Array.from(calls[0].input.image_urls),urls);assert.equal(calls[0].input.quality,'medium');assert.equal(calls[0].input.image_size.width/calls[0].input.image_size.height,16/9);assert.equal('input_fidelity'in calls[0].input,false);
 if(name==='createRefiner'){
  const dispatch=route.nodes.find(n=>n.type==='VariableDeclarator'&&n.id.name==='gptImageResult'&&route.code(n.init).includes('refinerFinalPrompt'));
  let passed;await vm.runInNewContext('(async()=>'+route.code(dispatch.init)+')()', {refinerFinalPrompt:'staging',refinerInputs:urls,refinerOutputRatio:'16:9',callFalAiGptImageEditForRefiner:async(...args)=>{passed=args;}});assert.equal(passed[1],urls);
 }
});
test('Edit room V4 forces GPT 2.5 for editing even when a legacy V2 flag is present',()=>{
 const r=read('referenceBrowserRoutesV4'),selector=r.nodes.find(n=>n.type==='VariableDeclarator'&&n.id.name==='falModel');
 for(const isV2 of [false,true])assert.equal(vm.runInNewContext(r.code(selector.init),{...api,isV2,isEditMode:true}),api.GPT25_EDIT_MODEL);
});
for(const name of ['chatEditRoutes','editRoomRoutes'])test(`${name}: actual Fal call uses medium Sunburst and retains image inputs`,async()=>{
 const r=read(name),call=r.nodes.find(n=>n.type==='CallExpression'&&n.callee?.object?.name==='axios'&&n.callee?.property?.name==='post'&&r.code(n.arguments[0]).includes('GPT25_EDIT_MODEL'));
 let sent;await vm.runInNewContext(r.code(call),{...api,process:{env:{FAL_API_KEY:'fixture'}},falRequestBody:original,enhancedPrompt:original.prompt,referenceImageUrl:original.image_urls[0],formattedRatio:'9:16',match_input_image:false,sourceSize:null,axios:{post:async(url,input)=>{sent={url,input};return{};}}});
 assert.equal(sent.url,'https://fal.run/'+api.GPT25_EDIT_MODEL);assert.equal(sent.input.quality,'medium');assert.equal('input_fidelity'in sent.input,false);assert.equal(sent.input.image_urls[0],original.image_urls[0]);if(name==='chatEditRoutes')assert.equal(sent.input.image_urls.length,2);
});

// V2 model üretimi: GPT 2.5 Sunburst high önce, hata → nano-banana-pro (app_config.v2_model ile seçilebilir)
for(const name of ['referenceBrowserRoutesV7','referenceJewelryBrowserRoutesV7'])test(`${name}: V2 goes to Sunburst with gpt25_quality_v2 first, nano-banana-pro stays as fallback`,async()=>{
 const r=read(name);
 assert.ok(r.source.includes('getV2Model() === "gpt25"'),'v2 model switch');
 assert.ok(r.source.includes('v2GptFailed = true'),'v2 fallback flag');
 assert.ok(r.source.includes('const falModel = "fal-ai/nano-banana-pro/edit"'),'nb pro retained');
 const fn=r.nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='callFalAiGptImage2Edit');
 const calls=[];const ctx={...api,SUNBURST_EDIT_MODEL:api.GPT25_EDIT_MODEL,isSunburstContentRejection:()=>false,logger:{log(){}},console:{error(){}},setTimeout:(cb)=>{cb();return 0;},fal:{queue:{submit:async(model,{input})=>{calls.push({model,input});return{request_id:'x'};},status:async()=>({status:'COMPLETED'}),result:async()=>({data:{images:[{url:'https://test/out'}]}})}}};
 vm.createContext(ctx);vm.runInContext(r.code(fn),ctx);
 await ctx.callFalAiGptImage2Edit('p',['https://test/a'],'portrait_16_9',1,api.GPT25_EDIT_MODEL,'9:16','high');
 assert.equal(calls[0].input.quality,'high');assert.deepEqual(calls[0].input.image_size,{width:1440,height:2560});
 assert.equal(api.GPT25_DEFAULT_QUALITY_V2,'high');assert.equal(api.V2_DEFAULT_MODEL,'gpt25');
});
