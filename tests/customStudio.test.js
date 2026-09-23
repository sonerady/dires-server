const test=require('node:test');
const assert=require('node:assert/strict');
const {validateInput,parseBrief,briefPrompt,publicTool,describeReferences}=require('../src/utils/customStudioBrief');
const {refundIdentity}=require('../src/middleware/refundIdentity');
const key='5a7ede97-4163-42ba-bef3-c1f5ffbdb840';
test('accepts a descriptive need but rejects oversized text and missing idempotency keys',()=>{
 assert.equal(validateInput({description:'  Put my ceramic cup in a cafe.  ',requestKey:key}).description,'Put my ceramic cup in a cafe.');
 for(const input of [{description:'x'.repeat(1501),requestKey:key},{description:'tiny',requestKey:key},{description:'Put my ceramic cup in a cafe.'}])assert.throws(()=>validateInput(input));
});
test('unsupported or incomplete AI briefs do not launch paid image generation',()=>{
 assert.throws(()=>parseBrief('{"supported":false}'),/unsupported_request/);
 assert.throws(()=>parseBrief('{"supported":true,"title":"Example"}'),/invalid_brief/);
 assert.equal(parseBrief('```json\n'+JSON.stringify({supported:true,title:'Cup studio',brief:'A warm cafe',screen:{version:1,instruction:'Professional product photography',controls:[]},examples:['cup','plate','jug','bowl'].map(product=>({product,before:'Daylight seller photo',after:'Professional cafe campaign'}))})+'\n```').title,'Cup studio');
 assert.match(briefPrompt({language:'tr',description:'Cafe photo'}),/identical product/);
});
test('before/after example roles reach the design prompt, and unlabelled uploads still work',()=>{
 assert.equal(describeReferences([]),'');
 assert.equal(describeReferences('1:before'),'');
 const described=describeReferences(['1:before','1:after']);
 assert.match(described,/image1 = example 1 BEFORE/);
 assert.match(described,/image2 = example 1 AFTER/);
 assert.match(briefPrompt({language:'tr',description:'Cafe photo',reference_roles:['1:before','1:after']}),/image2 = example 1 AFTER/);
 assert.doesNotMatch(briefPrompt({language:'tr',description:'Cafe photo'}),/BEFORE —/);
});
test('public card never discloses owner, idempotency or internal source fields',()=>{
 const card=publicTool({id:key,user_id:'private',request_key:'private',source_url:'private',description:'Coffee cup',status:'queued'});
 assert.equal(card.tr,'Coffee cup');assert.equal(card.user_id,undefined);assert.equal(card.source_url,undefined);assert.equal(card.request_key,undefined);
});
test('native identity: a user UUID alone is rejected, matching device ownership is accepted',async()=>{
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:key,device_id:'owner-device-identifier'}})})})})};
 let status,advanced=false;
 const res={status(n){status=n;return this;},json(){return this;}};
 await refundIdentity(db)({query:{userId:key},headers:{}},res,()=>{advanced=true;});
 assert.equal(status,401);assert.equal(advanced,false);
 const req={query:{userId:key},headers:{'x-device-id':'owner-device-identifier'}};
 await refundIdentity(db)(req,res,()=>{advanced=true;});assert.equal(advanced,true);assert.equal(req.refundUserId,key);
});
