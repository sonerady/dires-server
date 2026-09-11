const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/routes/createRefiner'), 'utf8');
const fn = source.slice(source.indexOf('async function saveToRefinerGenerations('), source.indexOf('async function updateRefinerGeneration('));
for (const [qualityVersion, expected] of [['v1', 10], ['v2', 35]]) {
  test(`Refiner history records the ${qualityVersion} generation price`, async () => {
    let inserted;
    const supabase = { from(table) { assert.equal(table, 'refiner_generations'); return { insert(rows) { inserted = rows[0]; return { select: async () => ({ data: rows }) }; } }; } };
    const save = vm.runInNewContext(`${fn}; saveToRefinerGenerations`, { supabase, logger: { log() {} }, console });
    await save({ userId: 'test-user', generationId: 'test-generation', qualityVersion });
    assert.equal(inserted.credits_used, expected);
    await save({ userId: 'test-user', generationId: 'free-generation', qualityVersion, creditsUsed: 0 });
    assert.equal(inserted.credits_used, 0);
  });
}
