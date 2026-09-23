const test = require('node:test');
const assert = require('node:assert/strict');
const { cancelStateAction, cancelBannerState, syncCancelState } = require('../src/utils/revenuecatCancelState');

const NOW = Date.parse('2026-09-23T12:00:00Z');
const DAY = 86400000;
const paidCancel = { type: 'CANCELLATION', period_type: 'NORMAL', cancel_reason: 'UNSUBSCRIBE', expiration_at_ms: NOW + 12 * DAY, app_user_id: '57292d05-f60c-4f92-b62c-c9357223096b' };

test('paid user unsubscribing with time left → set', () => {
  assert.equal(cancelStateAction(paidCancel, NOW), 'set');
});
test('trial cancellation never opens the banner', () => {
  assert.equal(cancelStateAction({ ...paidCancel, period_type: 'TRIAL' }, NOW), 'clear');
});
test('billing error / refund cancellations are ignored', () => {
  assert.equal(cancelStateAction({ ...paidCancel, cancel_reason: 'BILLING_ERROR' }, NOW), null);
  assert.equal(cancelStateAction({ ...paidCancel, cancel_reason: 'CUSTOMER_SUPPORT' }, NOW), null);
});
test('already-expired cancellation does not set', () => {
  assert.equal(cancelStateAction({ ...paidCancel, expiration_at_ms: NOW - DAY }, NOW), null);
});
test('re-activation, renewal, expiration clear the banner', () => {
  for (const type of ['UNCANCELLATION', 'RENEWAL', 'INITIAL_PURCHASE', 'PRODUCT_CHANGE', 'EXPIRATION']) {
    assert.equal(cancelStateAction({ ...paidCancel, type }, NOW), 'clear', type);
  }
});
test('banner shows only for pro, non-trial, cancelled, not expired', () => {
  const user = { is_pro: true, is_in_trial: false, subscription_cancelled_at: '2026-09-23T10:00:00Z', subscription_expires_at: new Date(NOW + 5.2 * DAY).toISOString() };
  assert.deepEqual(cancelBannerState(user, NOW), { show: true, expiresAt: new Date(NOW + 5.2 * DAY).toISOString(), daysLeft: 6 });
  assert.equal(cancelBannerState({ ...user, is_pro: false }, NOW).show, false);
  assert.equal(cancelBannerState({ ...user, is_in_trial: true }, NOW).show, false);
  assert.equal(cancelBannerState({ ...user, subscription_cancelled_at: null }, NOW).show, false);
  assert.equal(cancelBannerState({ ...user, subscription_expires_at: new Date(NOW - 1).toISOString() }, NOW).show, false);
});
test('sync writes the right patch and never throws', async () => {
  const calls = [];
  const supabase = { from: () => ({ update: (patch) => ({ eq: async (col, id) => { calls.push({ patch, col, id }); return { error: null }; } }) }) };
  assert.equal(await syncCancelState({ supabase, event: paidCancel }), 'set');
  assert.ok(calls[0].patch.subscription_cancelled_at && calls[0].patch.subscription_expires_at);
  assert.equal(await syncCancelState({ supabase, event: { ...paidCancel, type: 'UNCANCELLATION' } }), 'clear');
  assert.deepEqual(calls[1].patch, { subscription_cancelled_at: null, subscription_expires_at: null });
  const broken = { from: () => { throw new Error('db down'); } };
  assert.equal(await syncCancelState({ supabase: broken, event: paidCancel }), null);
});
