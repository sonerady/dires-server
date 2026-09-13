const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/utils/nudityGuard.js'),'utf8');
const restricted='61038732-9077-4731-bf51-178ba7a3cac5';
function load({offline=false,emails}={}) {
 let queries=0,requestedEmails=[];
 const module={exports:{}};
 const query = {
   async in(_key, list) {
     queries++; requestedEmails = [...list];
     if (offline) throw Error('offline');
     return {data:[{id:'review-account',email:'nodselemen@gmail.com'}],error:null};
   },
 };
 const fakeClient = { from: () => ({select: () => query}) };
 vm.runInNewContext(source, {
   module,
   process: { env: { SUPABASE_URL:'https://example.test', SUPABASE_ANON_KEY:'test', ...(emails ? {SAFETY_TEST_EMAILS:emails} : {}) } },
   require: () => ({createClient: () => fakeClient}),
 });
 return {guard:module.exports,queries:()=>queries,emails:()=>requestedEmails};
}
test('reported account stays strict with offline lookup and overridden email configuration',async()=>{
 const x=load({offline:true,emails:'another@example.test'});
 assert.equal(await x.guard.isSafetyTestUser(restricted),true);
 assert.equal(x.queries(),0);
 const result=await x.guard.evaluatePrompt(restricted,'Generate nudity');
 assert.equal(result.isTestUser,true);assert.equal(result.blocked,true);
});
test('safe fashion request receives strict scope without being blocked; unrelated users unchanged',async()=>{
 const x=load();
 const safe=await x.guard.evaluatePrompt(restricted,'Professional studio photo of a wool coat');
 assert.equal(safe.isTestUser,true);assert.equal(safe.blocked,false);
 assert.match(x.guard.hardenPrompt('Wool coat'),/STRICT SAFETY REQUIREMENT/);
 const other=await x.guard.evaluatePrompt('unrelated-account','Professional studio photo');
 assert.equal(other.isTestUser,false);assert.equal(other.blocked,false);
 assert.equal(await x.guard.isSafetyTestUser('review-account'),true);
 assert.ok(x.emails().includes('nodselemen@gmail.com'));
 assert.ok(x.emails().includes('fatih66klcc@gmail.com'));
});
test('mandatory email remains in lookup even with custom configured accounts',async()=>{
 const x=load({emails:' Another@Example.Test '});await x.guard.isSafetyTestUser('lookup-account');
 assert.deepEqual(x.emails(),['another@example.test','fatih66klcc@gmail.com']);
});
