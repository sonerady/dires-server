const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const { dkimSign } = require('mailauth/lib/dkim/sign');
const { dkimVerify } = require('mailauth/lib/dkim/verify');
const { createSupportMail, validateForm, OWNER_EMAIL, SUPPORT_EMAIL } = require('../src/lib/supportMail');

function fixture() {
  const tickets = new Map(), deliveries = new Map(), sent = [], incoming = new Map();
  let failSend = false;
  const store = {
    async createConversation(v) { if (!tickets.has(v.id)) tickets.set(v.id, v); return tickets.get(v.id); },
    async byToken(kind, token) { return [...tickets.values()].find(t => t[kind === 'agent' ? 'agent_token' : 'customer_token'] === token); },
    async updateConversation(id, value) { Object.assign(tickets.get(id), value); },
    async deliver(id, prepare, send) {
      const row = deliveries.get(id) || {}; if (row.sent || row.ignored) return { duplicate: true };
      row.payload ||= await prepare(); deliveries.set(id, row);
      if (!row.payload) { row.ignored = true; return { ignored: true }; }
      await send(row.payload, id); row.sent = true; return { sent: true };
    },
  };
  const resend = {
    emails: {
      send: async (payload, options) => { if (failSend) return { error: { name: 'rate_limit_exceeded' } }; sent.push({ payload, options }); return { data: { id: randomUUID() } }; },
      receiving: { get: async id => ({ data: incoming.get(id) }) },
    },
  };
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const verify = raw => dkimVerify(raw, { resolver: async () => [[`v=DKIM1; k=rsa; p=${publicKey}`]] });
  const service = createSupportMail({ resend, store, verifyDkim: verify, download: async url => new Response(incoming.get(new URL(url).pathname.slice(1)).rawBody) });
  async function inbound({ from = 'customer@example.com', to = SUPPORT_EMAIL, body = 'Can you help?', subject = 'Help', signed = false, extra = '', attachment = false }) {
    const id = randomUUID();
    let raw = Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${id}@example.com>\r\nMIME-Version: 1.0\r\n${extra}${attachment ? 'Content-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\n'+body+'\r\n--test\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="details.txt"\r\n\r\ndetails\r\n--test--' : 'Content-Type: text/plain; charset=utf-8\r\n\r\n'+body}\r\n`);
    if (signed) { const signature = await dkimSign(raw, { signatureData: [{ signingDomain: OWNER_EMAIL.split('@')[1], selector: 'test', privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) }] }); raw = Buffer.concat([Buffer.from(signature.signatures), raw]); }
    incoming.set(id, { id, subject, raw: { download_url: `https://example.com/${id}` }, rawBody: raw });
    const event = { type: 'email.received', data: { email_id: id, to: [to] } };
    return { event, raw, id };
  }
  return { service, sent, tickets, inbound, incoming, fail: value => { failSend = value; } };
}
const form = () => ({ email: 'customer@example.com', subject: 'Order question', message: 'Please help', name: 'Customer', requestId: randomUUID() });

test('validates email, header injection, types, and request ids', () => {
  assert.equal(validateForm(form()).email, 'customer@example.com');
  for (const invalid of [{email:'a\r\nBcc: victim@example.com'}, {subject:'test\r\nBcc: a@b.com'}, {message:{}}, {name:[]}, {requestId:'wrong'}]) assert.throws(() => validateForm({...form(),...invalid}));
});
test('form sends only to the owner, with a secret reply address; retries deduplicate', async () => {
  const f=fixture(), input=form(); await f.service.submit(input); await f.service.submit(input);
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].payload.to,OWNER_EMAIL); assert.match(f.sent[0].payload.replyTo,/^agent\+[a-f0-9]{48}@diress\.ai$/);
  await assert.rejects(f.service.submit({...input,email:'different@example.com'}),/already used/);
});
test('provider errors are not reported as successful delivery', async () => {
  const f=fixture(), input=form();f.fail(true);await assert.rejects(f.service.submit(input),/delivery failed/);f.fail(false);await f.service.submit(input);assert.equal(f.sent.length,1);
});
test('direct customer email forwards with its attachment and no customer-controlled Reply-To', async () => {
  const f=fixture(), msg=await f.inbound({attachment:true,extra:'Reply-To: attacker@example.com\r\n'});await f.service.receive(msg.event);
  assert.equal(f.sent[0].payload.to,OWNER_EMAIL);assert.match(f.sent[0].payload.replyTo,/^agent\+/);assert.equal(f.sent[0].payload.attachments[0].filename,'details.txt');
  await f.service.receive(msg.event);assert.equal(f.sent.length,1);
});
test('signed owner reply goes to the correct customer, without private address or quoted routing token', async () => {
  const f=fixture();await f.service.submit(form());const agent=f.sent[0].payload.replyTo;
  const message=await f.inbound({from:OWNER_EMAIL,to:agent,signed:true,body:`We can help. Contact ${OWNER_EMAIL}\n\nOn Mon, Diress <${agent}> wrote:\n> Customer message`});
  await f.service.receive(message.event);assert.equal(f.sent.length,2);
  const reply=f.sent[1].payload;assert.equal(reply.to,'customer@example.com');assert.equal(reply.from,`Diress Support <${SUPPORT_EMAIL}>`);assert.match(reply.replyTo,/^reply\+/);assert.ok(!reply.text.includes(OWNER_EMAIL));assert.ok(!reply.text.includes(agent));assert.ok(!reply.text.includes('Customer message'));
  const customer=await f.inbound({to:reply.replyTo,body:'Thank you'});await f.service.receive(customer.event);assert.equal(f.sent[2].payload.to,OWNER_EMAIL);assert.equal(f.sent[2].payload.replyTo,agent);
});
test('forged owner identity, unknown tokens, cross-customer access and auto replies do not relay', async () => {
  const f=fixture();await f.service.submit(form());const agent=f.sent[0].payload.replyTo;
  for(const args of [{from:OWNER_EMAIL,to:agent},{from:'attacker@example.com',to:agent},{to:'agent+'+'f'.repeat(48)+'@diress.ai'},{extra:'Auto-Submitted: auto-replied\r\n'},{extra:'List-Id: test\r\n'}]) {const m=await f.inbound(args);await f.service.receive(m.event);} assert.equal(f.sent.length,1);
  const ticket=[...f.tickets.values()][0];const m=await f.inbound({from:'other@example.com',to:`reply+${ticket.customer_token}@diress.ai`});await f.service.receive(m.event);assert.equal(f.sent.length,1);
});
test('owner DKIM cannot be replayed to a different envelope recipient', async () => {
 const f=fixture();await f.service.submit(form());const m=await f.inbound({from:OWNER_EMAIL,to:'someone@example.com',signed:true});m.event.data.to=[f.sent[0].payload.replyTo];await f.service.receive(m.event);assert.equal(f.sent.length,1);
});
test('webhook events other than receiving are ignored',async()=>{const f=fixture();assert.deepEqual(await f.service.receive({type:'email.delivered'}),{ignored:true});assert.equal(f.sent.length,0);});
