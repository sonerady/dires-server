const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeDraft,catalogCard,accessibleTool}=require('../src/utils/productStudioCatalog');
const {normalizeSchema,validateSelections,generationPrompt}=require('../src/utils/customToolSchema');
const screen={version:1,instruction:'Create a clear commercial packshot.',controls:[{id:'style',type:'choice',label:'Style',required:false,default:'',options:[{id:'a',label:'A',instruction:'Soft light'},{id:'b',label:'B',instruction:'Hard light'}]},{id:'room',type:'image',label:'Room',required:false,role:'Reference room'}],layout:{sectionOrder:['controls','upload','details']},detailsRequired:true};
const draft={version:1,title:'Test tool',description:'A test product photography tool.',language:'en',translations:{tr:{title:'Deneme',description:'Deneme açıklaması'}},buttonHue:38,beforeUrl:'https://example.com/b.webp',afterUrl:'https://example.com/a.webp',introExamples:Array.from({length:3},()=>({beforeUrl:'https://example.com/b.webp',afterUrl:'https://example.com/a.webp'})),screen};
test('publish requires complete assets and valid declarative controls',()=>{
 assert.equal(normalizeDraft(draft,{publish:true}).screen.layout.sectionOrder[0],'controls');
 assert.throws(()=>normalizeDraft({...draft,introExamples:[]},{publish:true}),/publish_incomplete/);
 assert.throws(()=>normalizeDraft({...draft,beforeUrl:'javascript:alert(1)'}));
 assert.throws(()=>normalizeDraft({...draft,screen:{...screen,controls:[{id:'x',label:'X',type:'script'}]}}));
 assert.throws(()=>normalizeSchema({...screen,layout:{sectionOrder:['upload','upload','details']}}));
});
test('optional choice may be omitted without injecting a prompt, required choice cannot',()=>{
 assert.deepEqual(validateSelections(screen,{}),{style:''});
 assert(!generationPrompt(screen,{selections:{},details:'test',angleCount:1,references:[]}).includes('Soft light'));
 const required={...screen,controls:[{...screen.controls[0],required:true}]};assert.throws(()=>validateSelections(required,{}));assert.equal(validateSelections(required,{style:'a'}).style,'a');
});
test('public catalog excludes drafts/hidden rows and private production instructions',()=>{
 const r={id:'global',enabled:true,published:normalizeDraft(draft),position:2};assert.equal(catalogCard({...r,enabled:false},'en'),null);assert.equal(catalogCard({...r,published:null},'en'),null);
 const c=catalogCard(r,'tr');assert.equal(c.tr,'Deneme');assert.equal(c.managed,true);assert.equal(c.custom,true);assert.equal(c.screen.instruction,undefined);assert.equal(c.screen.controls[0].options[0].instruction,undefined);assert.equal(c.screen.detailsRequired,true);
});
test('global access requires published/enabled catalog; private ownership remains enforced',async()=>{
 const make=(owner,published)=>({from:table=>{const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,maybeSingle:async()=>({data:table==='custom_studio_tools'?{id:'tool',user_id:owner}:published?{id:'tool'}:null})};return q;}});
 assert.equal(await accessibleTool(make('someone-else',true),'tool','me'),null);
 assert.equal(await accessibleTool(make(null,false),'tool','me'),null);
 assert.equal((await accessibleTool(make(null,true),'tool','me')).catalogManaged,true);
 assert.equal((await accessibleTool(make('me',false),'tool','me')).user_id,'me');
});
