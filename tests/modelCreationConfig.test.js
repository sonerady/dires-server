const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createModelCreationConfigReader } = require('../src/services/modelCreationConfig');
const { usesSunburstForModelCreation, usesNb2ForModelCreation } = require('../src/utils/modelCreationModel');

function fixture() {
  let result = { data: { provider: 'gpt' }, error: null };
  let reads = 0;
  const client = {
    from(table) { assert.equal(table, 'app_model_generation_config'); return this; },
    select(columns) { assert.equal(columns, 'provider'); return this; },
    eq(key, value) { assert.equal(key, 'id'); assert.equal(value, 'v1'); return this; },
    abortSignal(signal) { assert.equal(signal.aborted, false); return this; },
    async maybeSingle() { reads++; if (result instanceof Error) throw result; return result; },
  };
  return {
    read: createModelCreationConfigReader(client, { warn() {} }),
    set: value => { result = value; }, count: () => reads,
  };
}

test('next generation reads changed provider without restarting or caching the old value', async () => {
  const f = fixture();
  const first = await f.read({ qualityVersion: 'v1' });
  f.set({ data: { provider: 'gemini' } });
  assert.equal(await f.read({ qualityVersion: 'v1' }), 'gemini');
  assert.equal(first, 'gpt');
  assert.equal(f.count(), 2);
});

test('missing, invalid and failed reads retain GPT as a safe operational default', async () => {
  const f = fixture();
  for (const result of [{ data: null }, { data: { provider: 'other' } }, { error: { code: '42501' } }, new Error('timeout')]) {
    f.set(result);
    assert.equal(await f.read({ qualityVersion: 'v1' }), 'gpt');
  }
});

test('V2 and editing flows do not query this config', async () => {
  const f = fixture();
  for (const options of [{ qualityVersion: 'v2' }, ...['isEditMode', 'isColorChange', 'isPoseChange', 'isRefinerMode', 'isBackSideAnalysis'].map(flag => ({ [flag]: true }))]) {
    assert.equal(await f.read(options), null);
  }
  assert.equal(f.count(), 0);
});

for (const name of ['referenceBrowserRoutesV7.js', 'referenceJewelryBrowserRoutesV7.js']) {
  test(`${name}: DB choice selects the provider once and finishing follows actual output`, async () => {
    const source = fs.readFileSync(require.resolve('../src/routes/' + name), 'utf8');
    const start = source.indexOf('          const useSunburst =');
    const end = source.indexOf('          logger.log(', start);
    const snapshot = source.indexOf('const modelCreationProvider = await getModelCreationProvider');
    assert(snapshot > 0 && snapshot < source.indexOf('for (let attempt = 1; attempt <= maxRetries + 1; attempt++)'));
    assert.equal(source.match(/await getModelCreationProvider/g).length, 1);
    for (const provider of ['gpt', 'gemini']) {
      const result = await vm.runInNewContext(`(async()=>{${source.slice(start, end)}return {useSunburst,useNb2,useGpt};})()`, {
        modelCreationOptions: { qualityVersion: 'v1' }, modelCreationProvider: provider,
        usesSunburstForModelCreation, usesNb2ForModelCreation, req: { body: {} },
        isGptEnabledForV1: () => { throw new Error('Legacy flag must not override config'); },
      });
      assert.equal(result.useSunburst, provider === 'gpt');
      assert.equal(result.useGpt, provider === 'gpt');
      assert.equal(result.useNb2, provider === 'gemini');
    }
  });
}
