const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compare,encodeCursor,decodeCursor}=require('../src/routes/adminUserWorkRoutes');
test('same-timestamp records across features have stable, nonoverlapping pages',()=>{
 const rows=Array.from({length:65},(_,i)=>({record_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,feature:i%2?'videos':'virtual-model',created_at:'2026-09-13T12:34:56.123456+00:00'})).sort(compare);
 const first=rows.slice(0,30),cursor=decodeCursor(encodeCursor(first.at(-1)));
 const second=rows.filter(row=>compare(row,cursor)>0).slice(0,30);
 assert.equal(second.length,30);
 assert.equal(new Set([...first,...second].map(row=>row.record_id)).size,60);
 assert.deepEqual([...first,...second],rows.slice(0,60));
});
test('cursor rejects malformed values and filter syntax injection',()=>{
 for(const value of ['invalid','a'.repeat(600),Buffer.from(JSON.stringify({record_id:'id),status.eq.failed',created_at:'2026-09-13T00:00:00Z',feature:'videos'})).toString('base64url')])assert.throws(()=>decodeCursor(value));
 assert.equal(decodeCursor(undefined),null);
});
