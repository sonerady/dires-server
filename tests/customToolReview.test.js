const test=require('node:test'),assert=require('node:assert/strict');
process.env.CUSTOM_TOOL_REVIEW_SECRET='isolated-test-secret';
const {issueReview,readReview,parseReview}=require('../src/utils/customToolReview');
const valid={ready:true,title:'Lamp studio',intent:'Show the uploaded lamp illuminated without altering its shape.',steps:['Upload a lamp photo','Generate the illuminated product'],questions:[]};
test('confirmation is signed and bound to the verified owner',()=>{
 const token=issueReview({owner:'owner-a',requestKey:'request-a',review:valid,reference_urls:['https://example.com/idea.webp']});
 assert.deepEqual(readReview(token,'owner-a').review,valid);
 assert.throws(()=>readReview(token,'owner-b'),/confirmation_required/);
 const [body,sig]=token.split('.');const forged=JSON.parse(Buffer.from(body,'base64url'));forged.review.intent='Attacker changes approved instructions';
 assert.throws(()=>readReview(Buffer.from(JSON.stringify(forged)).toString('base64url')+'.'+sig,'owner-a'),/confirmation_required/);
 assert.throws(()=>readReview('', 'owner-a'),/confirmation_required/);
});
test('expired reviews cannot authorize later generation',t=>{
 const now=Date.now(),token=issueReview({owner:'owner-a',review:valid});
 t.mock.method(Date,'now',()=>now+3600001);
 assert.throws(()=>readReview(token,'owner-a'),/review_expired/);
});
test('clarifying questions prevent approval even if the model says ready',()=>{
 assert.equal(parseReview(JSON.stringify({...valid,questions:['Should the existing room stay?']})).ready,false);
 assert.deepEqual(parseReview(['```json\n',JSON.stringify(valid),'\n```']),valid);
});
test('malformed or oversized model output never becomes an approval',()=>{
 for(const value of [{...valid,intent:'x'},{...valid,intent:'x'.repeat(1501)},{...valid,steps:'bad'},{...valid,ready:'true'}])assert.throws(()=>parseReview(JSON.stringify(value)),/review_unavailable/);
});
