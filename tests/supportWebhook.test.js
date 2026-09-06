const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const express = require('express');
const { Resend } = require('resend');
const { createSupportWebhookRouter } = require('../src/routes/supportWebhookRoutes');

test('raw webhook verifies signatures and rejects forged, altered and expired payloads',async()=>{
 const secretBytes=randomBytes(32),secret=`whsec_${secretBytes.toString('base64')}`, received=[];
 const service={webhookSecret:async()=>secret,receive:async event=>received.push(event)};
 const app=express();app.use('/inbound',express.raw({type:'application/json'}),createSupportWebhookRouter({service,resend:new Resend('re_test')}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}/inbound`;
 const payload=JSON.stringify({type:'email.received',data:{email_id:randomUUID(),to:['support@diress.ai']}});
 const headers=(body,seconds=Math.floor(Date.now()/1000))=>{const id=`msg_${randomUUID()}`, signature=createHmac('sha256',secretBytes).update(`${id}.${seconds}.${body}`).digest('base64');return {'Content-Type':'application/json','svix-id':id,'svix-timestamp':String(seconds),'svix-signature':`v1,${signature}`};};
 try {
  assert.equal((await fetch(url,{method:'POST',headers:headers(payload),body:payload})).status,200);
  assert.equal((await fetch(url,{method:'POST',headers:headers(payload),body:payload+' '})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:headers(payload,Math.floor(Date.now()/1000)-1000),body:payload})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:payload})).status,400);
  assert.equal(received.length,1);
  service.receive=async()=>{throw Error('provider temporarily down');};
  assert.equal((await fetch(url,{method:'POST',headers:headers(payload),body:payload})).status,503);
 }finally{await new Promise(r=>server.close(r));}
});
