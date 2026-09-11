const test = require('node:test');
const assert = require('node:assert/strict');
const { decideWhatsNew, compareVersions, pickLocalized } = require('../src/utils/whatsNew');

const row = {
  whats_new_enabled: true, whats_new_version: '1.7.8', whats_new_audience: 'updated', whats_new_dismissible: false,
  whats_new_platforms: ['ios', 'android', 'desktop', 'web'],
  whats_new_title: { default: 'What\'s new', tr: 'Yenilikler' },
  whats_new_html: { default: '<p>en</p>', tr: '<p>tr</p>', 'pt-br': '<p>ptbr</p>' },
};

test('version compare', () => {
  assert.equal(compareVersions('1.7.10', '1.7.9'), 1);
  assert.equal(compareVersions('1.7.8', '1.7.8'), 0);
  assert.equal(compareVersions('v1.6', '1.7.0'), -1);
  assert.equal(compareVersions(null, '1.0'), null);
});

test('language fallback chain', () => {
  assert.equal(pickLocalized(row.whats_new_html, 'tr').lang, 'tr');
  assert.equal(pickLocalized(row.whats_new_html, 'pt-BR').lang, 'pt-br');
  assert.equal(pickLocalized(row.whats_new_html, 'de').lang, 'default');
  assert.equal(pickLocalized({ en: 'x' }, 'de').lang, 'en');
  assert.equal(pickLocalized({}, 'de').value, null);
});

test('updated audience: only users who actually updated', () => {
  const base = { client: 'ios', lang: 'tr', appVersion: '1.7.8' };
  assert.equal(decideWhatsNew(row, { ...base, previousAppVersion: '1.7.6' }).show, true);
  assert.equal(decideWhatsNew(row, { ...base }).reason, 'not_updated');          // fresh install
  assert.equal(decideWhatsNew(row, { ...base, previousAppVersion: '1.7.8' }).reason, 'not_updated');
  assert.equal(decideWhatsNew(row, { ...base, previousAppVersion: '1.7.6', seenVersion: '1.7.8' }).reason, 'already_seen');
  assert.equal(decideWhatsNew(row, { ...base, appVersion: '1.7.7', previousAppVersion: '1.7.6' }).reason, 'app_too_old');
});

test('all audience + web + payload shape', () => {
  const r = { ...row, whats_new_audience: 'all' };
  const d = decideWhatsNew(r, { client: 'web', lang: 'ar' });
  assert.equal(d.show, true);
  assert.equal(d.payload.rtl, true);
  assert.equal(d.payload.dismissible, false);
  assert.equal(d.payload.html, '<p>en</p>');
  assert.equal(d.payload.title, "What's new");
  assert.equal(decideWhatsNew(r, { client: 'web', seenVersion: '1.7.8' }).reason, 'already_seen');
  assert.equal(decideWhatsNew(r, { client: 'ios', appVersion: '1.7.8' }).show, true); // fresh install sees it in "all"
});

test('kill switches', () => {
  assert.equal(decideWhatsNew({ ...row, whats_new_enabled: false }, { client: 'ios', appVersion: '1.7.8', previousAppVersion: '1.7.6' }).reason, 'disabled');
  assert.equal(decideWhatsNew({ ...row, whats_new_platforms: ['android'] }, { client: 'ios', appVersion: '1.7.8', previousAppVersion: '1.7.6' }).reason, 'platform_excluded');
  assert.equal(decideWhatsNew({ ...row, whats_new_html: {} }, { client: 'ios', appVersion: '1.7.8', previousAppVersion: '1.7.6' }).reason, 'no_html');
  assert.equal(decideWhatsNew(null, { client: 'ios' }).reason, 'disabled');
});
