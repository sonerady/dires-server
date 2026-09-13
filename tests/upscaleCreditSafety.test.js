const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { changeUpscaleBalance } = require('../src/utils/upscaleCreditBalance');

function database(balance = 100, options = {}) {
  const state = { balance, writes: 0, owners: [] };
  const db = { from(table) {
    let values, filters = {};
    return {
      select() { return this; }, eq(k,v) { filters[k]=v; return this; },
      update(v) { values=v; return this; }, insert() { return this; },
      async single() { return { data: { credit_balance: state.balance }, error: options.readError }; },
      then(resolve) {
        if (!values) return Promise.resolve({ data: [], error: null }).then(resolve);
        state.writes++;
        if (options.writeError) return Promise.resolve({ error: Error('database unavailable') }).then(resolve);
        if (state.balance !== filters.credit_balance) return Promise.resolve({data: [],error:null}).then(resolve);
        state.balance=values.credit_balance; state.owners.push(filters.id);
        return Promise.resolve({ data: [{credit_balance:state.balance}], error:null }).then(resolve);
      },
    };
  }};
  return { db, state };
}

test('20 concurrent 4 MP debits preserve every charge', async () => {
 const {db,state}=database(1000);
 await Promise.all(Array.from({length:20},()=>changeUpscaleBalance(db,'device-account',-10)));
 assert.equal(state.balance,800);
});
test('concurrent attempts cannot spend the same final credits twice', async () => {
 const {db,state}=database(10);
 const outcomes=await Promise.allSettled([changeUpscaleBalance(db,'owner',-10),changeUpscaleBalance(db,'owner',-10)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,402); assert.equal(state.balance,0);
});
test('refund and debit preserve an intervening credit purchase', async () => {
 const {db,state}=database(50);
 await Promise.all([changeUpscaleBalance(db,'owner',10),changeUpscaleBalance(db,'owner',-20),changeUpscaleBalance(db,'owner',1000)]);
 assert.equal(state.balance,1040);
});
test('unknown identity, read failure and uncertain write fail closed', async () => {
 for (const owner of [null,'anonymous_user','anonymous']) await assert.rejects(changeUpscaleBalance(database().db,owner,-10));
 for (const options of [{readError:Error('offline')},{writeError:true}]) {
  const {db,state}=database(100,options); await assert.rejects(changeUpscaleBalance(db,'owner',-10));
  assert.equal(state.balance,100); assert.ok(state.writes<=1);
 }
});

function routeSetup({balance=1000, failProvider=false, writeError=false, precheckError=false, routeFile="imageEnhancement"}={}) {
 const {db,state}=database(balance,{writeError}); let calls=0; const handlers={};
 const router={post:(path,fn)=>{handlers[path]=fn;},get:(path,fn)=>{handlers[path]=fn;}};
 const axios={post:async()=>{calls++;if(failProvider)throw Error('provider failed');return {data:{status:'succeeded',output:'https://test/output.jpg',image:{url:'https://test/output.jpg'}}};},get:async()=>{throw Error('storage unavailable');},head:async()=>({headers:{}})};
 const context={module:{exports:{}},console:{log(){},warn(){},error(){}},Buffer,URL,setTimeout,setInterval(){},process:{env:{REPLICATE_API_TOKEN:'test'}},require(name){
  if(name==='express')return {Router:()=>router}; if(name==='axios')return axios;
  if(name==='sharp')return ()=>{}; if(name==='uuid')return {v4:()=> 'id'};
  if(name==='../supabaseClient')return {supabase:db};
  if(name==='../utils/upscaleCreditBalance')return {changeUpscaleBalance};
  if(name==='../services/teamService')return {getEffectiveCredits:async()=>{if(precheckError)throw Error('offline');return {creditOwnerId:'team-owner',creditBalance:state.balance,isPro:true};}};
  throw Error(name);
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/'+routeFile),'utf8')+'\nmodule.exports.testBulk = typeof processBulkUpscaleItem === "function" ? processBulkUpscaleItem : null;',context);
 async function request(path,body) {let status=200,data;const res={status(n){status=n;return this;},json(v){data=v;return this;}};await handlers[path]({body},res);return {status,data};}
 return {state,request,bulk:context.module.exports.testBulk,calls:()=>calls};
}

test('Pro, team and device-account single upscales are charged at every MP tier', async()=>{
 for(const [targetMp,cost] of [[4,10],[8,20],[16,40],[32,80],[64,120],[128,240]]){
  const x=routeSetup(); const r=await x.request('/',{userId:'device-user',imageUrl:'https://test/input',targetMp});
  assert.equal(r.data.success,true);assert.equal(x.state.balance,1000-cost);assert.equal(x.state.owners[0],'team-owner');
 }
});
test('single provider failure refunds original owner; debit failure never invokes provider',async()=>{
 const x=routeSetup({failProvider:true});await x.request('/',{userId:'member',imageUrl:'https://test/input'}); assert.equal(x.state.balance,1000);assert.equal(x.calls(),1);
 const y=routeSetup({writeError:true});const r=await y.request('/',{userId:'member',imageUrl:'https://test/input'});assert.equal(r.status,500);assert.equal(y.calls(),0);
});
test('bulk charges before generation and refunds only failed items',async()=>{
 const x=routeSetup();const r=await x.bulk({userId:'member',creditOwnerId:'team-owner',imageUrl:'https://test/input',index:0,targetMp:16});assert.equal(r.status,'succeeded');assert.equal(r.creditsCharged,40);assert.equal(x.state.balance,960);
 const y=routeSetup({failProvider:true});const f=await y.bulk({userId:'member',creditOwnerId:'team-owner',imageUrl:'https://test/input',index:0});assert.equal(f.status,'failed');assert.equal(y.state.balance,1000);assert.equal(f.imageUrl,undefined);
 const z=routeSetup({writeError:true});const denied=await z.bulk({userId:'member',creditOwnerId:'team-owner',imageUrl:'https://test/input',index:0});assert.equal(denied.status,'failed');assert.equal(z.calls(),0);assert.equal(denied.imageUrl,undefined);
});
test('bulk precheck failures block sync and async jobs; missing device account is not free',async()=>{
 for(const path of ['/generate-bulk','/generate-bulk-async']) {
  const x=routeSetup({precheckError:true});const r=await x.request(path,{userId:'member',items:[{imageUrl:'https://test/input'}]});assert.equal(r.status,503);assert.equal(x.calls(),0);
 }
 const x=routeSetup();for(const userId of [undefined,'anonymous_user','anonymous']){const r=await x.request('/',{userId,imageUrl:'https://test/input'});assert.equal(r.status,400);}assert.equal(x.calls(),0);
});

for (const routeFile of ['imageEnhancementWeb','imageEnhancement_v2']) test(`${routeFile} legacy debit and refund use the same concurrency-safe owner balance`, async()=>{
 const x=routeSetup({routeFile});const r=await x.request('/',{userId:'member',imageUrl:'https://test/input'});assert.equal(r.status,200);assert.equal(x.state.balance,995);
 const y=routeSetup({routeFile,failProvider:true});await y.request('/',{userId:'member',imageUrl:'https://test/input'});assert.equal(y.state.balance,1000);assert.deepEqual(y.state.owners,['team-owner','team-owner']);
 const z=routeSetup({routeFile,writeError:true});await z.request('/',{userId:'member',imageUrl:'https://test/input'});assert.equal(z.calls(),0);
});
test('legacy web bulk never returns an output if debit is rejected',async()=>{
 const x=routeSetup({routeFile:'imageEnhancementWeb',writeError:true});const r=await x.bulk({userId:'member',imageUrl:'https://test/input',index:0});assert.equal(r.status,'failed');assert.equal(r.imageUrl,undefined);
});
