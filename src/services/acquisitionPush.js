const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAMPAIGNS = require('../../marketing/acquisition-push.json');
const hash = value => createHash('sha256').update(value).digest('hex');
function validToken(token, digest) {
  if (typeof token !== 'string' || token.length !== 64 || typeof digest !== 'string' || digest.length !== 64) return false;
  return timingSafeEqual(Buffer.from(hash(token)), Buffer.from(digest));
}
function localSlot(now, timezone, hour = 20) {
  if (!timezone || typeof timezone !== 'string') return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type,p.value]));
    if (Number(parts.hour) !== hour || Number(parts.minute) >= 15) return null;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
  } catch { return null; }
}
function localizedCampaign(language, weekday) {
  const lang = String(language || '').toLowerCase().replace('_','-').split('-')[0];
  const messages = CAMPAIGNS.languages[lang];
  // Never silently send English to users whose language has no approved copy.
  if (!messages?.[weekday]) return null;
  return { ...messages[weekday], id: `acquisition-v1-${weekday}`, language: lang };
}
function due(enrollment, now, hour) {
  return enrollment.subscribed === true && !enrollment.client_purchase_seen && UUID.test(enrollment.subscription_id || '')
    && ['ios','android'].includes(enrollment.platform)
    && now - new Date(enrollment.onboarding_completed_at || now) >= 24*3600e3
    && now - new Date(enrollment.last_seen_at) >= 4*3600e3
    && localSlot(now, enrollment.timezone, hour);
}
function buildPush(appId, subscriptionId, campaign, idempotencyKey, test = false) {
  if (!UUID.test(subscriptionId || '')) throw new Error('One exact subscription is required');
  return {
    app_id: appId, include_subscription_ids: [subscriptionId], target_channel: 'push',
    headings: { en: test ? 'Diress · Test' : campaign.title }, contents: { en: campaign.body },
    // Immediate, short-lived delivery. No precomputed tomorrow audience.
    ttl: 900, collapse_id: 'diress-acquisition', ios_interruption_level: 'active',
    isIos: true, isAndroid: true, idempotency_key: idempotencyKey,
    data: { type: test ? 'acquisition_test' : 'acquisition', campaign_id: campaign.id, destination: 'plans' },
  };
}
function createAcquisitionPush({ db, fetchImpl = fetch, env = process.env, clock = () => new Date() }) {
  const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };
  const credentials = () => {
    const appId = env.ONESIGNAL_APP_ID;
    const apiKey = String(env.ONESIGNAL_REST_API_KEY || '').trim().replace(/^(key|basic)\s+/i,'');
    if (!appId || !apiKey) throw new Error('OneSignal credentials missing');
    return {appId,apiKey};
  };
  async function provider(path, options = {}) {
    const {apiKey} = credentials();
    const response = await fetchImpl(`https://api.onesignal.com${path}`, {
      ...options, headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errors) {
      const error = new Error(`OneSignal HTTP ${response.status}`);
      error.status = response.status; throw error;
    }
    return data;
  }
  async function eligible(userId) {
    return check(await db.rpc('acquisition_push_eligible', {p_user_id:userId})) === true;
  }
  async function storeHasHistory(userId) {
    const key=env.REVENUECAT_SECRET_API_KEY || env.REVENUECAT_API_KEY;
    if (!key) throw new Error('RevenueCat verification unavailable');
    const response=await fetchImpl(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`RevenueCat HTTP ${response.status}`);
    const {subscriber}=await response.json();
    if (!subscriber || !subscriber.subscriptions || !subscriber.non_subscriptions) throw new Error('Incomplete RevenueCat history');
    // All historical products, including expired trials and refunded orders.
    const history=Object.keys(subscriber.subscriptions).length>0 || Object.keys(subscriber.non_subscriptions).length>0
      || Object.keys(subscriber.entitlements || {}).length>0
      || (subscriber.original_app_user_id && subscriber.original_app_user_id!==userId);
    if (history) check(await db.from('acquisition_push_exclusions').upsert({user_id:userId,reason:'revenuecat_history'},{onConflict:'user_id',ignoreDuplicates:true}));
    return history;
  }
  async function provision(userId, body) {
    // Called ONLY from the successful new-user creation branches, never login.
    if (body.pushCampaignVersion !== 1 || !['ios','android'].includes(body.platform)) return null;
    const token = randomBytes(32).toString('hex');
    check(await db.from('acquisition_push_enrollments').insert({user_id:userId,token_hash:hash(token),platform:body.platform}));
    return token;
  }
  async function sync(userId, token, body) {
    if (!UUID.test(userId || '')) return {status:401};
    const row = check(await db.from('acquisition_push_enrollments').select('*').eq('user_id',userId).maybeSingle());
    if (!row || !validToken(token,row.token_hash)) return {status:401};
    if (body.purchaseSeen === true) {
      check(await db.from('acquisition_push_exclusions').upsert({user_id:userId,reason:'device_purchase_history'},{onConflict:'user_id',ignoreDuplicates:true}));
      check(await db.from('acquisition_push_enrollments').update({client_purchase_seen:true,subscribed:false}).eq('user_id',userId));
      return {status:200,eligible:false};
    }
    const allowed = await eligible(userId);
    const changes = {last_seen_at:clock().toISOString(), subscribed:body.subscribed === true && allowed};
    if (body.onboardingCompleted === true && !row.onboarding_completed_at) changes.onboarding_completed_at=clock().toISOString();
    if (typeof body.language === 'string' && body.language.length <= 16) changes.language=body.language;
    if (typeof body.appVersion === 'string') changes.app_version=body.appVersion.slice(0,32);
    if (typeof body.timezone === 'string' && body.timezone.length <= 80) {
      try {new Intl.DateTimeFormat('en',{timeZone:body.timezone}); changes.timezone=body.timezone;} catch {changes.subscribed=false;}
    }
    if (UUID.test(body.subscriptionId || '') && changes.subscribed) {
      const {appId}=credentials();
      const profile=await provider(`/apps/${appId}/users/by/external_id/${userId}`);
      const subscription=profile.subscriptions?.find(s=>s.id===body.subscriptionId);
      if (!subscription || !subscription.enabled || !['iOSPush','AndroidPush'].includes(subscription.type)) changes.subscribed=false;
      else changes.subscription_id=body.subscriptionId;
    } else changes.subscribed=false;
    check(await db.from('acquisition_push_enrollments').update(changes).eq('user_id',userId));
    return {status:200,eligible:allowed};
  }
  async function sendOne(row, settings, {dryRun = true} = {}) {
    const now=clock(), slot=due(row,now,settings.local_hour);
    if (!slot) return {skipped:'not_due'};
    const campaign=localizedCampaign(row.language,slot.weekday);
    if (!campaign) return {skipped:'untranslated_language'};
    if (!await eligible(row.user_id)) return {skipped:'purchase_or_account_history'};
    if (dryRun) return {eligible:true,date:slot.date,language:campaign.language};
    if (await storeHasHistory(row.user_id)) return {skipped:'store_purchase_history'};
    const {appId}=credentials();
    const profile=await provider(`/apps/${appId}/users/by/external_id/${row.user_id}`);
    const sub=profile.subscriptions?.find(s=>s.id===row.subscription_id);
    if (!sub?.enabled || !['iOSPush','AndroidPush'].includes(sub.type)) return {skipped:'unsubscribed_or_identity_changed'};
    if (profile.properties?.last_active && now.getTime()/1000-profile.properties.last_active < 4*3600) return {skipped:'recently_active'};
    const claims=check(await db.rpc('acquisition_push_claim', {p_user_id:row.user_id,p_local_date:slot.date,p_campaign_id:campaign.id}));
    const delivery=claims?.[0];
    if (!delivery) return {skipped:'daily_cap_or_ineligible'};
    if (['sent','skipped'].includes(delivery.status)) return {skipped:'already_processed'};
    // Re-read immediately before submission; client changes and webhooks may
    // have arrived during the provider lookup/claim. Unknown state = no send.
    const current=check(await db.from('acquisition_push_enrollments').select('*').eq('user_id',row.user_id).single());
    if (!due(current,clock(),settings.local_hour) || current.timezone!==row.timezone || current.language!==row.language || current.subscription_id!==row.subscription_id || !await eligible(row.user_id)) {
      check(await db.from('acquisition_push_deliveries').update({status:'skipped',reason:'eligibility_changed'}).eq('id',delivery.id));
      return {skipped:'eligibility_changed'};
    }
    try {
      const response=await provider('/notifications',{method:'POST',body:JSON.stringify(buildPush(appId,row.subscription_id,campaign,delivery.id))});
      if (!response.id) throw new Error('OneSignal accepted no recipients');
      check(await db.from('acquisition_push_deliveries').update({status:'sent',provider_id:response.id,sent_at:clock().toISOString(),reason:null}).eq('id',delivery.id));
      return {sent:true};
    } catch (error) {
      // Reuse the durable UUID for all retries, including ambiguous timeouts.
      await db.from('acquisition_push_deliveries').update({status:'failed',reason:error.message}).eq('id',delivery.id).neq('status','sent');
      throw error;
    }
  }
  async function run({dryRun = true} = {}) {
    const settings=check(await db.from('acquisition_push_settings').select('*').single());
    if (!dryRun && (!settings.enabled || env.ACQUISITION_PUSH_WORKER_ENABLED!=='true')) return {skipped:'disabled'};
    const stats={checked:0,eligible:0,sent:0,skipped:0,failed:0};
    let cursor=null;
    while (true) {
      let q=db.from('acquisition_push_enrollments').select('*').eq('subscribed',true).eq('client_purchase_seen',false).order('user_id').limit(200);
      if (cursor) q=q.gt('user_id',cursor);
      const rows=check(await q);
      for (const row of rows) {
        stats.checked++;
        try {const r=await sendOne(row,settings,{dryRun}); if(r.eligible)stats.eligible++; else if(r.sent)stats.sent++;else stats.skipped++;}
        catch(error){stats.failed++; if(error.status===401||error.status===403) throw error;}
      }
      if(rows.length<200)break;
      cursor=rows.at(-1).user_id;
    }
    return stats;
  }
  return {provision,sync,eligible,run,sendOne,provider};
}
let service;
function getAcquisitionPush() {
  if (!service) {
    const {supabaseAdmin}=require('../supabaseClient');
    if (!supabaseAdmin) throw new Error('Acquisition push requires service role');
    service=createAcquisitionPush({db:supabaseAdmin});
  }
  return service;
}
module.exports={createAcquisitionPush,getAcquisitionPush,localSlot,localizedCampaign,due,buildPush,validToken,hash};
