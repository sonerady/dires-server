const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePoolModelNames, buildPrompt } = require('../src/utils/poolModelNames');

test('one name per language, native script, excluded names are rejected and re-requested', async () => {
  const prompts = [];
  const callText = async (prompt) => {
    prompts.push(prompt);
    if (prompts.length === 1) return '```json\n{"en":"Ava","tr":"Defne","ja":"葵","ar":"Ava"}\n```'; // ar invalid (taken), missing de
    return JSON.stringify({ ar: 'ليان', de: 'Mila' });
  };
  const names = await generatePoolModelNames({ gender: 'woman', age: '24', langs: ['en', 'tr', 'ja', 'ar', 'de'], exclude: { ar: ['ava'] }, callText });
  assert.deepEqual(names, { en: 'Ava', tr: 'Defne', ja: '葵', ar: 'ليان', de: 'Mila' });
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes('ar, de') && !prompts[1].includes('tr,'), 'second request only asks for the missing languages');
  assert.ok(buildPrompt({ gender: 'man', age: '25', langs: ['en'], exclude: { en: ['Noah'] } }).includes('en: Noah'));
});

test('languages still missing after retries fall back to the English name instead of staying empty', async () => {
  const names = await generatePoolModelNames({ gender: 'man', langs: ['en', 'tr'], exclude: {}, attempts: 2, callText: async () => '{"en":"Noah"}' });
  assert.deepEqual(names, { en: 'Noah', tr: 'Noah' });
});

test('a Latin-script name is rejected for non-Latin languages and never copied into them as fallback', async () => {
  const prompts = [];
  const names = await generatePoolModelNames({ gender: 'woman', langs: ['en', 'ja', 'ar', 'de'], exclude: {}, attempts: 2, callText: async (p) => { prompts.push(p); return prompts.length === 1 ? '{"en":"Ella","ja":"Ella","ar":"Ella","de":"Ella"}' : '{"ja":"葵"}'; } });
  assert.deepEqual(names, { en: 'Ella', de: 'Ella', ja: '葵' }, 'ar stays empty instead of receiving a Latin name');
  assert.match(prompts[1], /Language codes \(ISO 639-1\/2\): ja, ar\n/, 'only the rejected languages are re-requested');
});

test('without an English name nothing is copied: no Afrikaans/Amharic name spreads to every language', async () => {
  const names = await generatePoolModelNames({ gender: 'woman', langs: ['af', 'am', 'tr', 'ja'], exclude: {}, attempts: 1, callText: async () => '{"af":"Lienke","am":"ፀጋ"}' });
  assert.deepEqual(names, { af: 'Lienke', am: 'ፀጋ' });
});

test('languages are requested in small chunks with en and tr first', async () => {
  const prompts = [];
  const langs = Array.from({ length: 30 }, (_, i) => `l${i}`).concat(['tr', 'en']);
  await generatePoolModelNames({ gender: 'man', langs, exclude: {}, attempts: 1, chunkSize: 12, callText: async (p) => { prompts.push(p); return '{}'; } });
  assert.equal(prompts.length, 3);
  assert.match(prompts[0], /Language codes \(ISO 639-1\/2\): en, tr, l0/);
});
