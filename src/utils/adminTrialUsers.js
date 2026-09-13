// Display-only trial reconciliation. Never changes customer credits or entitlements.
const HOUR = 60 * 60 * 1000;
const timestamp = value => value == null ? NaN : typeof value === 'number' ? value : Date.parse(value);
const iso = value => Number.isFinite(timestamp(value)) ? new Date(timestamp(value)).toISOString() : null;

function extractRevenueCatLite(body, now = Date.now()) {
  let subscriptions;
  if (body?.subscriber) {
    subscriptions = Object.entries(body.subscriber.subscriptions || {}).map(([product, s]) => ({
      product, store: s.store, start: s.purchase_date, end: s.expires_date,
      active: !s.refunded_at && timestamp(s.expires_date) > now,
      trial: String(s.period_type).toLowerCase() === 'trial',
      renew: !s.unsubscribe_detected_at && !s.billing_issues_detected_at,
      entitlements: Object.entries(body.subscriber.entitlements || {}).filter(([, e]) => e.product_identifier === product).map(([key]) => key),
    }));
  } else {
    const items = body?.subscriptions?.items;
    if (!Array.isArray(items)) throw new Error('RevenueCat subscription data missing');
    subscriptions = items.map(s => ({
      product: s.product_identifier || s.product_id, store: s.store,
      start: s.current_period_starts_at, end: s.current_period_ends_at,
      active: s.gives_access === true && timestamp(s.current_period_ends_at) > now,
      trial: s.status === 'trialing',
      renew: ['will_renew', 'has_already_renewed'].includes(s.auto_renewal_status) ? true : s.auto_renewal_status === 'will_not_renew' ? false : null,
      entitlements: (s.entitlements?.items || []).map(e => e.lookup_key || e.id),
    }));
  }
  // An old expired trial must not override a current paid subscription.
  subscriptions.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.trial) - Number(a.trial) || (timestamp(b.end) || 0) - (timestamp(a.end) || 0));
  const sub = subscriptions[0];
  const isTrial = !!(sub?.active && sub.trial);
  return {
    is_in_trial: isTrial,
    entitlements: sub?.active ? sub.entitlements : [],
    trial_will_renew: isTrial ? sub.renew : null,
    trial_started_at: isTrial ? iso(sub.start) : null,
    trial_expires_at: isTrial ? iso(sub.end) : null,
    subscription: sub ? { store: sub.store || null, product_id: sub.product || null, status: sub.active ? (sub.trial ? 'in_trial' : 'active') : 'expired' } : null,
  };
}

function reconcileTrialUser(user, durationDays = 3, now = Date.now()) {
  const rc = user.rc;
  const verified = rc?.ok === true;
  const start = timestamp(verified && rc.is_in_trial ? rc.trial_started_at || user.trial_started_at : user.trial_started_at);
  const end = verified && rc.is_in_trial ? timestamp(rc.trial_expires_at) : start + durationDays * 24 * HOUR;
  const validWindow = Number.isFinite(start) && start <= now && Number.isFinite(end) && end > now;
  const active = verified ? rc.is_in_trial === true && validWindow : validWindow;
  return {
    ...user,
    trial_started_at: Number.isFinite(start) ? new Date(start).toISOString() : null,
    trial_state: active ? (verified ? 'active' : 'estimated') : 'review',
    elapsed_hours: Number.isFinite(start) && start <= now ? Math.floor((now - start) / HOUR) : null,
    remaining_hours: active ? Math.max(0, Math.ceil((end - now) / HOUR)) : Number.isFinite(start) ? 0 : null,
  };
}
function sortTrialUsers(users) {
  return [...users].sort((a, b) => (timestamp(b.trial_started_at) || 0) - (timestamp(a.trial_started_at) || 0) || a.id.localeCompare(b.id));
}
module.exports = { extractRevenueCatLite, reconcileTrialUser, sortTrialUsers };
