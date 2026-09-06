// Explicit integration check: isolated synthetic rows, no email is sent.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { createSupportMailStore } = require('../src/lib/supportMailStore');
const { createTicket } = require('../src/lib/supportMail');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY, { auth: { persistSession: false } });
const store = createSupportMailStore(db), id = randomUUID(), delivery = `verify:${id}`;
(async () => {
 try {
  const ticket = await store.createConversation(createTicket(id, 'fixture@example.com', 'Synthetic storage check'));
  assert.equal((await store.byToken('agent', ticket.agent_token)).id, id);
  const inaccessible = await anon.from('support_conversations').select('id').eq('id', id);
  assert.ok(inaccessible.error || inaccessible.data.length === 0, 'Anonymous access must be denied');
  let sends = 0;
  const prepare = async () => ({ to: 'fixture@example.com', text: 'No email is sent' });
  const send = async () => { sends++; return { id: randomUUID() }; };
  const results = await Promise.allSettled([store.deliver(delivery,prepare,send),store.deliver(delivery,prepare,send)]);
  assert.ok(results.some(x=>x.status==='fulfilled'));
  await store.deliver(delivery,prepare,send);
  assert.equal(sends,1,'Concurrent and repeated events only invoke sender once');
  const data = await db.from('support_mail_deliveries').select('payload,status').eq('id',delivery).single();
  assert.equal(data.data.status,'sent'); assert.equal(data.data.payload,null);
  console.log('PASS: private access, conversation routing, concurrent claim, persistent deduplication, payload cleanup');
 } finally {
  const a=await db.from('support_mail_deliveries').delete().eq('id',delivery);
  const b=await db.from('support_conversations').delete().eq('id',id);
  if(a.error || b.error) throw Error('Synthetic data cleanup failed');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
