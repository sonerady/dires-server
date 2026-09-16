const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGenerationAge, ageDirective } = require('../src/utils/generationAge');
test('adult numeric selection overrides legacy teenage template without altering details', () => {
  const result = normalizeGenerationAge({ numericAge: 22, age: 'young' }, 'Age range: young (teenage model). Gender: woman. Additional details: keep freckles.');
  assert.equal(result.settings.age, '22');
  assert.equal(result.prompt, 'Age range: 22 years old (adult). Gender: woman. Additional details: keep freckles.');
});
test('minor age remains minor, including 17', () => {
  assert.match(ageDirective({ numericAge: 17 }), /17 years old \(minor\)/);
  assert.equal(normalizeGenerationAge({ numericAge: 0 }).settings.age, '0');
});
test('missing or invalid numeric age does not invent an adult', () => {
  for (const numericAge of [null, undefined, '', true, -1, 101, 'unknown']) {
    assert.equal(ageDirective({ numericAge }), '');
    assert.equal(normalizeGenerationAge({ age: 'child', numericAge }, 'original').prompt, 'original');
  }
});
