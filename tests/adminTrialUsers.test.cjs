const {test} = require('node:test');
const assert = require('node:assert/strict');
const {extractRevenueCatLite, reconcileTrialUser, sortTrialUsers} = require('../src/utils/adminTrialUsers');
const now = Date.parse('2026-09-14T00:00:00Z');
const sub = {period_type:'trial',purchase_date:'2026-09-13T21:25:34Z',expires_date:'2026-09-16T21:25:34Z',unsubscribe_detected_at:'2026-09-13T21:31:12Z'};
const read = subscriptions => ({ok:true,...extractRevenueCatLite({subscriber:{subscriptions}},now)});
test('9960-credit row with no start date is last and never gets a fresh three-day trial',()=>{
 const missing=reconcileTrialUser({id:'missing',credit_balance:9960,trial_started_at:null},3,now);
 const recent=reconcileTrialUser({id:'recent',trial_started_at:'2026-09-13T21:25:34Z'},3,now);
 assert.equal(missing.remaining_hours,null);assert.equal(missing.trial_state,'review');assert.equal(missing.credit_balance,9960);
 assert.deepEqual(sortTrialUsers([missing,recent]).map(u=>u.id),['recent','missing']);
});
test('cancelled trial remains active until actual RevenueCat expiry',()=>{
 const rc=read({weekly:sub});assert.equal(rc.is_in_trial,true);assert.equal(rc.trial_will_renew,false);
 const row=reconcileTrialUser({id:'u',trial_started_at:null,rc},3,now);
 assert.equal(row.trial_state,'active');assert.equal(row.remaining_hours,70);assert.equal(row.trial_started_at,sub.purchase_date.replace('Z','.000Z'));
});
test('seven-day trial uses store expiry instead of fixed three days',()=>{
 const rc=read({weekly:{...sub,purchase_date:'2026-09-10T00:00:00Z',expires_date:'2026-09-17T00:00:00Z'}});
 assert.equal(reconcileTrialUser({id:'u',rc},3,now).remaining_hours,72);
});
test('expired trial is not live just because period_type stays trial',()=>{
 const rc=read({weekly:{...sub,expires_date:'2026-09-12T00:00:00Z'}});
 assert.equal(rc.is_in_trial,false);assert.equal(reconcileTrialUser({id:'u',trial_started_at:sub.purchase_date,rc},3,now).trial_state,'review');
});
test('active paid subscription wins over an expired trial',()=>{
 const rc=read({old:{...sub,expires_date:'2026-09-12T00:00:00Z'},paid:{...sub,period_type:'normal'}});
 assert.equal(rc.is_in_trial,false);assert.equal(rc.subscription.product_id,'paid');
});
test('no subscription never counts as verified trial',()=>{
 const rc=read({});assert.equal(rc.subscription,null);
 assert.equal(reconcileTrialUser({id:'u',trial_started_at:sub.purchase_date,rc},3,now).trial_state,'review');
});
test('unavailable RC stays explicitly estimated, old or future dates need review',()=>{
 const rc={ok:false,error:'timeout'};
 assert.equal(reconcileTrialUser({id:'u',trial_started_at:sub.purchase_date,rc},3,now).trial_state,'estimated');
 for(const date of [null,'invalid','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z']) assert.equal(reconcileTrialUser({id:'u',trial_started_at:date,rc},3,now).trial_state,'review');
});
test('v2 subscriptions use trialing, millisecond period and lowercase renewal fields',()=>{
 const rc=extractRevenueCatLite({subscriptions:{items:[{status:'trialing',gives_access:true,current_period_starts_at:now-1000,current_period_ends_at:now+3600000,auto_renewal_status:'will_not_renew'}]}},now);
 assert.equal(rc.is_in_trial,true);assert.equal(rc.trial_will_renew,false);assert.equal(rc.trial_expires_at,'2026-09-14T01:00:00.000Z');
});
test('customer-only v2 data must not silently become no trial',()=>{
 assert.throws(()=>extractRevenueCatLite({id:'customer',active_entitlements:{items:[]}},now),/missing/);
});
test('unknown v2 renewal is not interpreted as cancellation',()=>{
 const rc=extractRevenueCatLite({subscriptions:{items:[{status:'trialing',gives_access:true,current_period_starts_at:now-1000,current_period_ends_at:now+3600000,auto_renewal_status:'unknown'}]}},now);
 assert.equal(rc.trial_will_renew,null);
});
