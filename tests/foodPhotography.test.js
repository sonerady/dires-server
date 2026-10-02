const test=require('node:test'),assert=require('node:assert/strict');
const {getTool,validateOptions,buildPrompt,publicSpec,resolveRatio}=require('../src/utils/studioTools');
const tool=getTool('food-photography');
test('food presets preserve dish, tableware and fixed selected angle through all variants',()=>{
 for(const purpose of ['menu','restaurant','social'])for(const angle of ['auto','source','top','three_quarter','eye'])for(let i=0;i<4;i++){
  const v=validateOptions(tool,{purpose,angle,styling:'table'});
  const prompt=buildPrompt(tool,{...v,productCount:2,refs:[{id:'style',count:1}],variantIndex:i,variantTotal:4});
  assert.match(prompt,/exact ingredient types/);assert.match(prompt,/number of servings/);assert.match(prompt,/MENU\/DELIVERY priority: no props/);assert.match(prompt,/Never copy its food/);assert.match(prompt,/Never invent fillings|camera angle|camera|Camera/);assert.doesNotMatch(prompt,/TOOL: Food Presentation/);assert.ok(!prompt.includes('undefined'));
 }
 assert.throws(()=>validateOptions(tool,{portion:'double'}),/invalid_input/);
 assert.throws(()=>validateOptions(tool,{angle:'invent'}),/invalid_input/);
 assert.equal(resolveRatio(tool,{},'4:5'),'4:5');
});
test('food page has correct upload, optional reference and private instructions',()=>{
 const spec=publicSpec(tool);assert.equal(spec.upload.max,4);assert.equal(spec.refs[0].required,false);assert.equal(spec.controls.length,5);assert.equal(spec.cost,10);
 assert.doesNotMatch(JSON.stringify(spec),/FOOD FIDELITY|Do not reveal|STYLE ONLY/);
 for(const file of ['../../client/commerce/studioToolsSpec.json','../../web-dashboard/lib/studioToolsSpec.json'])assert.ok(require(file).tools.some(t=>t.id===tool.id));
 const examples=require('../../client/commerce/toolIntroExamples.json')[tool.id];assert.equal(examples.samples.length,3);assert.equal(new Set(examples.samples.flatMap(p=>[p.beforeUrl,p.afterUrl])).size,6);
});
