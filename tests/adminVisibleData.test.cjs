const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {adminVisibleData,HIDDEN_ADMIN_USER_IDS,hideAdminPersonalAssets}=require('../src/utils/adminVisibleData');
const {enrichAdminStyleReferences}=require('../src/utils/adminStyleReferences');
test('admin read exclusions apply before pagination; customer reads and writes stay unchanged',async()=>{
 const requests=[];
 const raw=createClient('https://example.test','test-key',{global:{fetch:async(url,options)=>{requests.push({url:new URL(url),options});return new Response('[]',{headers:{'Content-Type':'application/json'}})}}});
 const admin=adminVisibleData(raw);
 await admin.from('reference_results').select('*',{count:'exact'}).eq('status','completed').range(30,59);
 assert.match(requests[0].url.searchParams.get('or'),new RegExp(HIDDEN_ADMIN_USER_IDS[0]));
 assert.match(requests[0].url.searchParams.get('or'),/user_id.is.null/);
 assert.equal(requests[0].url.searchParams.get('offset'),'30');
 await admin.from('users').select('id');assert.match(requests[1].url.searchParams.get('or'),/id.not.in/);
 await raw.from('reference_results').select('*');assert.equal(requests[2].url.searchParams.has('or'),false);
 await admin.from('users').update({full_name:'Test'}).eq('id','test').select('id');assert.equal(requests[3].url.searchParams.has('or'),false);
});
test('profile enrichment batches IDs and preserves actual historical reference when profile was deleted',async()=>{
 let calls=0;
 const db={from(table){assert.equal(table,'style_profiles');calls++;return{select(){return{async in(column,ids){assert.deepEqual(ids,['one','deleted']);return{data:[{id:'one',name:'Current profile'}]}}}}}}};
 const rows=[{style_profile_id:'one',style_reference_url:'https://old.test/image'},{style_profile_id:'one'},{style_profile_id:'deleted'}];
 const result=await enrichAdminStyleReferences(db,rows);
 assert.equal(calls,1);assert.equal(result[0].style_reference_url,rows[0].style_reference_url);assert.equal(result[2].style_profile,null);
});
test('identifiable personal assets are hidden without deleting aggregate metrics',async()=>{
 const report={models:[{id:'a'},{id:'b'}],locations:[],styles:[],summary:{outputs:30}};
 const db = { from: () => ({ select: () => ({ in: () => ({ in: async () => ({data:[{image_url:'a'}]}) }) }) }) };
 const result=await hideAdminPersonalAssets(db,report);assert.deepEqual(result.models,[{id:'b'}]);assert.equal(result.summary.outputs,30);
});
