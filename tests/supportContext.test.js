const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSupportContext, clientContext, formatSupportContext } = require('../src/lib/supportContext');

test('anonymous requests cannot inject account identity or secret fields', async () => {
  const context = await resolveSupportContext({ headers: {}, body: { context: { platform: 'web', userId: 'victim', account: { userId: 'victim' }, access_token: 'secret', browser: 'a'.repeat(900) } } }, {});
  assert.equal(context.account, null);
  assert.deepEqual(Object.keys(context.client), ['platform', 'browser']);
  assert.equal(context.client.browser.length, 240);
  assert.deepEqual(clientContext({ language: 'tr\nInjected: value' }), { language: 'tr Injected: value' });
});
test('authenticated identity is resolved from the verified session and application account', async () => {
  const db = {
    auth: { getUser: async token => { assert.equal(token, 'valid-token'); return { data: { user: { id: 'auth-id', email: 'verified@example.com' } } }; } },
    from(table) { assert.equal(table, 'users'); return { select() { return this; }, eq(column, value) { assert.equal(column, 'supabase_user_id'); assert.equal(value, 'auth-id'); return this; }, async maybeSingle() { return { data: { id: 'app-user-id', full_name: 'Verified Name', subscription_type: 'pro' } }; } }; },
  };
  const context = await resolveSupportContext({ headers: { authorization: 'Bearer valid-token' }, body: { context: { platform: 'ios', appVersion: '1.7.7', account: { userId: 'victim' } } } }, db);
  assert.equal(context.account.userId, 'app-user-id');
  assert.equal(context.account.email, 'verified@example.com');
  const text = formatSupportContext(context);
  assert.match(text, /User ID: app-user-id/); assert.match(text, /Platform: ios/); assert.match(text, /Uygulama sürümü: 1.7.7/);
  assert.ok(!text.includes('valid-token')); assert.ok(!text.includes('victim'));
});
test('invalid or expired sessions fail instead of silently claiming a logged-in identity', async () => {
  const db = { auth: { getUser: async () => ({ error: new Error('expired') }) } };
  await assert.rejects(resolveSupportContext({ headers: { authorization: 'Bearer expired' }, body: {} }, db), { status: 401 });
  await assert.rejects(resolveSupportContext({ headers: { authorization: 'invalid' }, body: {} }, db), { status: 401 });
});
