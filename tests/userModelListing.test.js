const test = require('node:test');
const assert = require('node:assert/strict');
const { listUserModels } = require('../src/services/userModelListing');
function fake(rows, failPage = -1) {
  const calls = [];
  return { calls, from(table) {
    assert.equal(table, 'user_models');const filters = {};
    const q = {select(){return q},eq(k,v){filters[k]=v;return q},order(){return q},async range(a,b){
      calls.push([a,b]);if(calls.length===failPage)return {error:{message:'database unavailable'}};
      return { data: rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)).slice(a,b+1), error:null };
    }};return q;
  }};
}
const model = (id, extra={}) => ({id,user_id:'erika',status:'completed',...extra});
test('legacy unpaginated request retains all 22 personal and 12 pool models',async()=>{
 const rows=Array.from({length:34},(_,i)=>model(i,{replicate_id:i>=2&&i<14?'pool:copy':'personal'}));
 const result=await listUserModels(fake(rows),'erika');assert.equal(result.data.length,34);assert.equal(result.data.filter(r=>r.replicate_id==='personal').length,22);
});
test('fetches across database page boundaries without including other owners or incomplete models',async()=>{
 const rows=Array.from({length:1107},(_,i)=>model(i));rows.push(model(9999,{user_id:'other'}),model(9998,{status:'processing'}));
 const db=fake(rows);const result=await listUserModels(db,'erika');assert.equal(result.data.length,1107);assert.equal(new Set(result.data.map(r=>r.id)).size,1107);assert.deepEqual(db.calls,[[0,499],[500,999],[1000,1499]]);
});
test('explicit pagination keeps numeric offset semantics',async()=>{
 const result=await listUserModels(fake(Array.from({length:70},(_,i)=>model(i))),'erika',{limit:'20',offset:'20'});assert.equal(result.data.length,20);assert.equal(result.data[0].id,20);assert.equal(result.data.at(-1).id,39);
});
test('invalid pagination fails before database access',async()=>{
 for(const query of [{limit:'-1'},{offset:'a'},{limit:['20']},{limit:'0'}]){const db=fake([]);assert.equal((await listUserModels(db,'erika',query)).error.status,400);assert.equal(db.calls.length,0)}
});
test('does not return a silently incomplete library when a later page fails',async()=>{
 const result=await listUserModels(fake(Array.from({length:600},(_,i)=>model(i)),2),'erika');assert.equal(result.data,null);assert.ok(result.error);
});
