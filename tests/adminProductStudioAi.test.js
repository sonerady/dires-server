const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
test('admin AI design uses Astra, separates references from assets and queues image work idempotently',async()=>{
 const rows=new Map();let calls=0,updates=0;
 const db={from(){let filter={},value,op='read';const q={select(){return q},insert(v){value=v;op='insert';return q},update(v){value=v;op='update';return q},eq(k,v){filter[k]=v;return q},is(k,v){filter[k]=v;return q},single(){return Promise.resolve(run())},then(resolve,reject){return Promise.resolve(run()).then(resolve,reject)}};function run(){if(op==='insert'){rows.set(value.id,{attempts:0,deleted_at:null,accepted_examples:[],...value});return {data:rows.get(value.id)}}const row=[...rows.values()].find(r=>Object.entries(filter).every(([k,v])=>r[k]===v));if(op==='update'&&row){Object.assign(row,value);updates++}return {data:row,error:row?null:Error('not found')}}return q}};
 const brief={supported:true,title:'Light up lamps',brief:'Show the same lamp switched on in a styled room.',screen:{version:1,instruction:'Preserve the lamp and show it lit.',controls:[]},examples:['lamp','lantern','desk light','wall light'].map(product=>({product,before:'A clean seller photo.',after:'A commercial styled photo.'}))};
 const original=Module._load;
 Module._load=function(name,parent,...rest){if(name==='../supabaseClient')return {supabaseAdmin:db};if(name==='../utils/menuStudioAstra')return {askAstra:async opts=>{calls++;assert.equal(opts.model,'openai/gpt-6-astra');assert.deepEqual(opts.imageUrls,[]);return JSON.stringify(brief)}};return original.call(this,name,parent,...rest)};
 let router;try{delete require.cache[require.resolve('../src/routes/adminProductStudioRoutes')];router=require('../src/routes/adminProductStudioRoutes')}finally{Module._load=original}
 const express=require('express'),app=express();app.use(express.json());app.use(router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  let res=await fetch(base+'/product-studio/design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:'Show my lamp turned on in a cozy living room.',language:'en'})});assert.equal(res.status,200);const {job}=await res.json();assert.equal(calls,1);assert.equal(job.draft.beforeUrl,'');assert.equal(job.draft.screen.instruction,brief.screen.instruction);assert.equal(rows.get(job.id).example_plan.length,4);
  for(let i=0;i<2;i++){res=await fetch(base+'/product-studio/ai-jobs/'+job.id+'/images',{method:'POST'});assert.equal(res.status,202)}assert.equal(updates,1);assert.equal(rows.get(job.id).status,'queued');
  rows.get(job.id).source_url='published-tool';res=await fetch(base+'/product-studio/ai-jobs/'+job.id);assert.equal(res.status,400);
 }finally{await new Promise(r=>server.close(r));server.closeAllConnections()}
});
