const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
const { sendGenerationCompletedNotification, buildGenerationCompletedPush, localizedGenerationText } = require('../src/services/pushNotificationService');

const env = { ONESIGNAL_APP_ID: 'app-1', ONESIGNAL_REST_API_KEY: 'Key secret' };
const GEN = '3f6c9a2e-1b2d-4c5e-9f7a-0123456789ab';

test('standalone server ships all app notification translations without reading client files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const file = require.resolve('../src/services/pushNotificationService');
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, console, process,
    require(id) {
      if (id === 'fs' || id === 'path') throw new Error('Client filesystem access is unavailable in deployment');
      if (id === '../supabaseClient') return { supabase: {} };
      if (id === 'expo-server-sdk') return { Expo: class {} };
      return localRequire(id);
    },
  }, { filename: file });
  const catalog = require('../locales/notifications.json');
  assert.equal(Object.keys(catalog).length, 70);
  for (const [lang, text] of Object.entries(catalog)) {
    const push = module.exports.buildGenerationCompletedPush('app', 'user', GEN, { language: lang });
    assert.equal(push.contents.en, text.generationCompletedBody, lang);
    assert.equal(push.data.language, lang);
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../../client/locales', `${lang}.json`), 'utf8')).notification;
    assert.deepEqual(text, source, `${lang}: bundled catalog stays in sync`);
  }
});

test('payload targets the user external_id with the server-picked language text', () => {
  const push = buildGenerationCompletedPush('app-1', 'user-1', GEN, { source: 'v7', language: 'tr-TR' });
  assert.deepEqual(push.include_aliases, { external_id: ['user-1'] });
  assert.equal(push.target_channel, 'push');
  assert.equal(push.data.type, 'generation_completed');
  assert.equal(push.data.generationId, GEN);
  assert.equal(push.data.language, 'tr');
  assert.equal(push.idempotency_key, GEN);
  assert.equal(push.headings.en, localizedGenerationText('tr').title);
  assert.equal(push.contents.en, localizedGenerationText('tr').body);
  assert.notEqual(push.contents.en, localizedGenerationText('en').body);
});

test('language rule matches the campaign push: region stripped, unknown language falls back to English', () => {
  assert.equal(localizedGenerationText('pt_BR').language, 'pt');
  assert.equal(localizedGenerationText('xx'), null);
  assert.equal(buildGenerationCompletedPush('a', 'u', GEN, { language: 'xx' }).data.language, 'en');
  assert.equal(buildGenerationCompletedPush('a', 'u', GEN, {}).data.language, 'en');
});

test('language comes from the OneSignal profile first, then users.preferred_language, then the enrollment row', async () => {
  const mkdb = rows => ({ from: table => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: rows[table] || null }) }) });
  const bodies = [];
  const mkfetch = profileLang => async (url, init) => {
    if (url.includes('/users/by/external_id/')) return { ok: !!profileLang, json: async () => ({ properties: { language: profileLang } }) };
    bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'n' }) };
  };
  await sendGenerationCompletedNotification('user-1', GEN, { env, fetchImpl: mkfetch('tr'), db: mkdb({ users: { preferred_language: 'en' }, acquisition_push_enrollments: { language: 'es' } }) });
  await sendGenerationCompletedNotification('user-1', GEN, { env, fetchImpl: mkfetch(null), db: mkdb({ users: { preferred_language: 'de' }, acquisition_push_enrollments: { language: 'es' } }) });
  await sendGenerationCompletedNotification('user-1', GEN, { env, fetchImpl: mkfetch(null), db: mkdb({ acquisition_push_enrollments: { language: 'es' } }) });
  await sendGenerationCompletedNotification('user-1', GEN, { env, fetchImpl: mkfetch(null), db: mkdb({}) });
  assert.deepEqual(bodies.map(b => b.data.language), ['tr', 'de', 'es', 'en']);
  assert.equal(bodies[0].contents.en, localizedGenerationText('tr').body);
});

test('sends through OneSignal and returns the notification id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ id: 'n-1' }) }; };
  const r = await sendGenerationCompletedNotification('user-1', GEN, { env, fetchImpl, language: 'tr' });
  assert.deepEqual(r, { success: true, id: 'n-1' });
  assert.equal(calls[0].url, 'https://api.onesignal.com/notifications?c=push');
  assert.equal(calls[0].init.headers.Authorization, 'Key secret');
  assert.equal(JSON.parse(calls[0].init.body).include_aliases.external_id[0], 'user-1');
});

test('no subscribed device is a skip, not a failure', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ errors: ['All included players are not subscribed'] }) });
  const r = await sendGenerationCompletedNotification('user-1', GEN, { env, fetchImpl, language: 'tr' });
  assert.equal(r.success, true); assert.equal(r.reason, 'no_subscribed_devices');
});

test('GENERATION_PUSH_ENABLED=false and missing user skip without calling OneSignal', async () => {
  let called = 0; const fetchImpl = async () => { called++; };
  assert.equal((await sendGenerationCompletedNotification('user-1', GEN, { env: { ...env, GENERATION_PUSH_ENABLED: 'false' }, fetchImpl })).reason, 'disabled');
  assert.equal((await sendGenerationCompletedNotification('anonymous_user', GEN, { env, fetchImpl })).reason, 'no_user');
  assert.equal(called, 0);
});
