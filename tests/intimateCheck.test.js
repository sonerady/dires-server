const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIntimate } = require('../src/utils/intimateCheck');

test('intimate-check: confident lingerie/underwear/swimwear/erotic answers lock model photos', () => {
  for (const category of ['lingerie', 'underwear', 'swimwear', 'erotic']) {
    assert.deepEqual(parseIntimate(`{"intimate": true, "category": "${category}", "confidence": 0.9}`), { intimate: true, category, confidence: 0.9 });
  }
  assert.equal(parseIntimate('```json\n{"intimate":true,"category":"lingerie","confidence":1}\n```').intimate, true);
});

test('intimate-check: low confidence, "none" or broken output never locks (no false blocking)', () => {
  assert.equal(parseIntimate('{"intimate": true, "category": "lingerie", "confidence": 0.4}').intimate, false);
  assert.equal(parseIntimate('{"intimate": true, "category": "none", "confidence": 1}').intimate, false);
  assert.equal(parseIntimate('{"intimate": false, "category": "none", "confidence": 1}').intimate, false);
  assert.equal(parseIntimate('not json').intimate, false);
  assert.equal(parseIntimate('{"intimate": true, "category": "sportswear", "confidence": 1}').intimate, false);
});
