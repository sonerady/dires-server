const {test}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {localSlot,localizedCampaign,due,buildPush,validToken,hash,createAcquisitionPush}=require('../src/services/acquisitionPush');
const messages=require('../marketing/acquisition-push.json');
const now=new Date('2026-09-07T17:02:00Z');
const row={user_id:randomUUID(),subscription_id:randomUUID(),platform:'ios',language:'tr',timezone:'Europe/Istanbul',subscribed:true,client_purchase_seen:false,onboarding_completed_at:'2026-09-05T00:00:00Z',last_seen_at:'2026-09-06T10:00:00Z'};
test('local date/weekdays handle Turkey, date line, DST, half-hour offsets and unknown zones',()=>{
 assert.deepEqual(localSlot(now,'Europe/Istanbul'),{date:'2026-09-07',weekday:1});
 assert.equal(localSlot(now,'America/New_York'),null);
 assert.deepEqual(localSlot(new Date('2026-09-07T08:00:00Z'),'Pacific/Auckland'),{date:'2026-09-07',weekday:1});
 assert.deepEqual(localSlot(new Date('2026-03-08T00:05:00Z'),'America/New_York',19),{date:'2026-03-07',weekday:6});
 assert.deepEqual(localSlot(new Date('2026-09-07T14:35:00Z'),'Asia/Kolkata'),{date:'2026-09-07',weekday:1});
 assert.equal(localSlot(now,'bad'),null);assert.equal(localSlot(now,null),null);
 assert.equal(localSlot(new Date('2026-09-07T17:15:00Z'),'Europe/Istanbul'),null);
});
test('waits a full day after onboarding and four hours after last activity',()=>{
 assert.ok(due(row,now,20));
 for(const change of [{subscribed:false},{client_purchase_seen:true},{platform:'web'},{onboarding_completed_at:null},{onboarding_completed_at:now.toISOString()},{last_seen_at:now.toISOString()},{subscription_id:null}])assert.ok(!due({...row,...change},now,20));
});
test('all 70 languages contain seven different messages, unknown languages are skipped',()=>{
 assert.equal(Object.keys(messages.languages).length,70);
 for(const [lang,copy]of Object.entries(messages.languages)){
  assert.equal(copy.length,7,lang);assert.equal(new Set(copy.map(m=>m.title)).size,7,lang);
  for(let day=0;day<7;day++){const m=localizedCampaign(lang,day);assert.ok(m.title.trim()&&m.body.trim(),lang);assert.ok(!/\{\{|undefined/.test(m.body),lang);}
 }
 assert.equal(localizedCampaign('tr-TR',1).language,'tr');assert.equal(localizedCampaign('xx',1),null);
});
test('localized campaign copy keeps its daily emoji and stays concise without truncation',()=>{
 const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 const length=text=>Array.from(segmenter.segment(text)).length;
 const emojis=['💡','✨','🌿','👗','📸','🎨','🚀'];
 for(const [lang,copy] of Object.entries(messages.languages)){
  copy.forEach((message,day)=>{
   const label=`${lang} day ${day}`;
   assert.ok(message.title.startsWith(`${emojis[day]} `),`${label}: daily emoji`);
   assert.ok(length(message.title)<=30,`${label}: title exceeds editorial limit`);
   assert.ok(length(message.body)<=70,`${label}: body exceeds editorial limit`);
   assert.ok(!/[\r\n]|\.\.\.|…|\{\{|https?:\/\//.test(message.title+message.body),`${label}: incomplete or unsuitable copy`);
  });
 }
});
test('payload can never broadcast; sends immediately with durable idempotency and short expiry',()=>{
 const key=randomUUID();const p=buildPush(randomUUID(),row.subscription_id,localizedCampaign('tr',1),key);
 assert.deepEqual(p.include_subscription_ids,[row.subscription_id]);assert.equal(p.idempotency_key,key);assert.equal(p.ttl,900);
 for(const k of ['filters','included_segments','include_aliases','delayed_option','send_after'])assert.ok(!(k in p));
 assert.throws(()=>buildPush('app','',{},key));assert.equal(p.data.destination,'plans');
});
test('anonymous enrollment credentials cannot be guessed from a user ID',()=>{
 const token='a'.repeat(64);assert.ok(validToken(token,hash(token)));assert.ok(!validToken('b'.repeat(64),hash(token)));assert.ok(!validToken('',hash(token)));
});
// Small in-memory DB double exercises production sender ordering and retries.
function harness({eligibility=[true,true],providerFailure=false,onProfile}={}){
 const deliveries=[];const requests=[];let eligibilityIndex=0;
 const db={rpc:async(name,args)=>{
  if(name==='acquisition_push_claim'){
   let d=deliveries.find(d=>d.user_id===args.p_user_id&&d.local_date===args.p_local_date);
   if(!d){d={id:randomUUID(),user_id:args.p_user_id,local_date:args.p_local_date,status:'claimed'};deliveries.push(d);}
   return {data:[d]};
  }
  return {data:eligibility[Math.min(eligibilityIndex++,eligibility.length-1)]};
 },from:table=>{
  let mode='select',values,filters=[],single=false;
  const q={select:()=>q,eq:(k,v)=>(filters.push(r=>r[k]===v),q),neq:(k,v)=>(filters.push(r=>r[k]!==v),q),gte:()=>q,
   insert:v=>(mode='insert',values=v,q),update:v=>(mode='update',values=v,q),single:()=>(single=true,q),maybeSingle:()=>(single=true,q),
   then:resolve=>{
    const data=table==='acquisition_push_enrollments'?[row]:deliveries;
    if(mode==='insert'){
     if(deliveries.some(d=>d.user_id===values.user_id&&d.local_date===values.local_date))return Promise.resolve(resolve({error:{code:'23505'}}));
     const d={...values,id:randomUUID(),status:'claimed'};deliveries.push(d);return Promise.resolve(resolve({data:d}));
    }
    const matches=data.filter(r=>filters.every(f=>f(r)));
    if(mode==='update')matches.forEach(r=>Object.assign(r,values));
    return Promise.resolve(resolve({data:single?matches[0]:matches}));
   }};return q;
 }};
 let fail=providerFailure;
 const svc=createAcquisitionPush({db,clock:()=>now,env:{ONESIGNAL_APP_ID:randomUUID(),ONESIGNAL_REST_API_KEY:'test',REVENUECAT_API_KEY:'test'},fetchImpl:async(url,options)=>{
  if(url.includes('revenuecat.com'))return {ok:true,json:async()=>({subscriber:{subscriptions:{},non_subscriptions:{},original_app_user_id:row.user_id}})};
  requests.push({url,body:options.body&&JSON.parse(options.body)});
  if(!options.body){onProfile?.();return {ok:true,json:async()=>({subscriptions:[{id:row.subscription_id,enabled:true,type:'iOSPush'}]})};}
  if(fail){fail=false;throw new Error('timeout after provider accepted request');}
  return {ok:true,json:async()=>({id:randomUUID()})};
 }});
 return {svc,deliveries,requests};
}
test('purchase history exclusion sends zero network requests',async()=>{
 const h=harness({eligibility:[false]});assert.equal((await h.svc.sendOne(row,{local_hour:20},{dryRun:false})).skipped,'purchase_or_account_history');assert.equal(h.requests.length,0);
});
test('a purchase arriving during preparation cancels the send',async()=>{
 const h=harness({eligibility:[true,false]});assert.equal((await h.svc.sendOne(row,{local_hour:20},{dryRun:false})).skipped,'eligibility_changed');assert.equal(h.requests.filter(r=>r.body).length,0);
});
test('ambiguous provider failures reuse the UUID, successful repeats do not send twice',async()=>{
 const h=harness({providerFailure:true});await assert.rejects(h.svc.sendOne(row,{local_hour:20},{dryRun:false}));
 assert.equal((await h.svc.sendOne(row,{local_hour:20},{dryRun:false})).sent,true);
 assert.equal((await h.svc.sendOne(row,{local_hour:20},{dryRun:false})).skipped,'already_processed');
 const posts=h.requests.filter(r=>r.body);assert.equal(posts.length,2);assert.equal(posts[0].body.idempotency_key,posts[1].body.idempotency_key);
});
test('dry-run never queries OneSignal or creates a delivery claim',async()=>{
 const h=harness();assert.equal((await h.svc.sendOne(row,{local_hour:20})).eligible,true);assert.equal(h.requests.length,0);assert.equal(h.deliveries.length,0);
});
