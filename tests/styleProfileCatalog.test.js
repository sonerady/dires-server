const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express');
function factory(database){
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/styleProfileRouterFactory'),'utf8'),{module,exports:module.exports,require:n=>n==='express'?express:n==='@supabase/supabase-js'?{createClient:()=>database}:n==='crypto'?require('crypto'):n==='uuid'?{v4:()=> 'test'}:{},process:{env:{}},console,Buffer,URL,Map,Set,setTimeout,clearTimeout});
 return module.exports.createStyleProfileRouter;
}
for(const table of ['style_profiles','refiner_style_profiles'])test(`${table}: public catalog uses only its schema and preserves reference/display images`,async()=>{
 let selected;
 const row={id:'public-style',name:'Studio',image_urls:['reference.jpg'],status:'ready',...(table==='style_profiles'?{display_image_urls:['display.jpg']}: {})};
 const db={from(name){assert.equal(name,table);return{select(columns){selected=columns;if(table==='refiner_style_profiles'){assert(!columns.includes('display_image_urls'));assert(!columns.includes('source_profile_id'));assert(!columns.includes('category_slug'));}return this;},eq(){return this;},order:async()=>({data:[row]})};}};
 const app=express();app.use('/styles',factory(db)({table}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/styles/global`);assert.equal(r.status,200);const j=await r.json();assert.equal(j.profiles[0].image_urls[0],table==='style_profiles'?'display.jpg':'reference.jpg');assert.deepEqual(j.profiles[0].reference_image_urls,['reference.jpg']);assert(!selected.includes('style_prompt'));}finally{await new Promise(r=>server.close(r));}
});
module.exports={factory};
