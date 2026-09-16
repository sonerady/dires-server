const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalysis, decideRefund, buildAnalysisPrompt, extractProductUrls, THRESHOLDS } = require('../src/utils/creditRefundAnalysis');

test('prompt: bans taste/style reasons, labels banners, asks JSON in user language', () => {
  const p = buildAnalysisPrompt({ languageCode: 'tr', productCount: 2 });
  assert.match(p, /NOT refund reasons/);
  assert.match(p, /ORIGINAL PRODUCT PHOTO #k/);
  assert.match(p, /"AI RESULT"/);
  assert.match(p, /written in Turkish/);
  assert.match(p, /first 2 carry a BLUE banner/);
});

test('parseAnalysis normalizes and clamps', () => {
  const a = parseAnalysis('```json\n{"product_match":"137","render_quality":88.6,"defects":["wrong_color","nope","wrong_color"],"verdict":"refund_partial","confidence":1.4,"summary":"Renk farklı."}\n```');
  assert.deepEqual(a, { productMatch: 100, renderQuality: 89, defects: ['wrong_color'], verdict: 'refund_partial', confidence: 1, summary: 'Renk farklı.' });
  assert.equal(parseAnalysis('no json'), null);
  assert.equal(parseAnalysis('{"verdict":"no_refund"}'), null); // skorlar zorunlu
});

test('decideRefund: full / partial / none by thresholds, model verdict needs confidence', () => {
  const base = { defects: [], summary: '' };
  assert.deepEqual(decideRefund({ ...base, productMatch: 30, renderQuality: 90, verdict: 'no_refund', confidence: 0.9 }, 20), { percent: 100, credits: 20, outcome: 'refund_full', status: 'refunded' });
  assert.deepEqual(decideRefund({ ...base, productMatch: 90, renderQuality: 30, verdict: 'no_refund', confidence: 0.9 }, 20).percent, 100);
  assert.deepEqual(decideRefund({ ...base, productMatch: 70, renderQuality: 90, verdict: 'no_refund', confidence: 0.9 }, 20), { percent: 50, credits: 10, outcome: 'refund_partial', status: 'refunded' });
  assert.equal(decideRefund({ ...base, productMatch: 90, renderQuality: 90, verdict: 'refund_full', confidence: 0.9 }, 20).percent, 100);
  assert.equal(decideRefund({ ...base, productMatch: 90, renderQuality: 90, verdict: 'refund_full', confidence: 0.2 }, 20).percent, 0); // düşük güven → skorlar karar verir
  assert.deepEqual(decideRefund({ ...base, productMatch: 92, renderQuality: 88, verdict: 'no_refund', confidence: 0.8 }, 20), { percent: 0, credits: 0, outcome: 'no_refund', status: 'rejected' });
  assert.equal(decideRefund({ ...base, productMatch: 70, renderQuality: 90, verdict: 'refund_partial', confidence: 0.9 }, 1).credits, 1); // en az 1 kredi
  assert.equal(THRESHOLDS.partialPercent, 50);
});

test('extractProductUrls accepts strings, objects and json strings, dedups, caps at 3', () => {
  assert.deepEqual(extractProductUrls(['https://a/1.jpg', { url: 'https://a/2.jpg' }, { image_url: 'https://a/1.jpg' }, 'file:///x', { uri: 'https://a/3.jpg' }, 'https://a/4.jpg']), ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg']);
  assert.deepEqual(extractProductUrls('["https://a/9.jpg"]'), ['https://a/9.jpg']);
  assert.deepEqual(extractProductUrls(null), []);
});
