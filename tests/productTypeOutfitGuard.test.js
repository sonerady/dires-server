const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
const { normalize, applyOutfitGuard, CONTEXT_PREFIX } = require('../src/routes/productTypeRoutes')._test;

test('outfit prompt states one garment outweighs any number of jewelry pieces and asks for pieces', () => {
  assert.match(CONTEXT_PREFIX.outfit, /ONE garment always outweighs ANY number of/);
  assert.match(CONTEXT_PREFIX.outfit, /"pieces"/);
});

test('normalize reads pieces and drops unknown entries', () => {
  const r = normalize('{"category":"jewelry","subtype":"necklace","pieces":["clothing","jewelry","weird"],"gender":"woman"}');
  assert.deepEqual(r.pieces, ['clothing', 'jewelry']);
  assert.equal(r.category, 'jewelry');
});

test('1 garment + 2 jewelry → clothing even if the model said jewelry', () => {
  const r = applyOutfitGuard({ category: 'jewelry', subtype: 'necklace', form: null, pieces: ['clothing', 'jewelry', 'jewelry'] }, 'outfit');
  assert.equal(r.category, 'clothing');
  assert.equal(r.subtype, null); // necklace is not a clothing subtype
  assert.equal(r.override, 'jewelry → clothing');
});

test('all jewelry stays jewelry; shoes + jewelry → shoes; no pieces / other context → untouched', () => {
  assert.equal(applyOutfitGuard({ category: 'jewelry', subtype: 'ring', form: null, pieces: ['jewelry', 'jewelry'] }, 'outfit').category, 'jewelry');
  assert.equal(applyOutfitGuard({ category: 'jewelry', subtype: 'ring', form: null, pieces: ['shoes', 'jewelry'] }, 'outfit').category, 'shoes');
  assert.equal(applyOutfitGuard({ category: 'jewelry', subtype: 'ring', form: 'bangle', pieces: null }, 'outfit').override, null);
  assert.equal(applyOutfitGuard({ category: 'jewelry', subtype: 'ring', form: null, pieces: ['clothing'] }, 'angles').category, 'jewelry');
});
