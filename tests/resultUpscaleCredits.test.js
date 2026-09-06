const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pricing = require('../src/utils/generationCredits');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/resultUpscale.js'), 'utf8');

function setup({ balance = 1000, base = 10, providerError = false, emptyOutput = false, missingToken = false, rejectDebit = false, afterProvider } = {}) {
  const state = { balance, debits: [], events: [], settings: {}, providerCalls: 0 };
  const query = () => ({
    select() { return this; }, eq() { return this; },
    limit: async () => ({ data: [{ settings: state.settings }] }),
    update(values) { state.settings = values.settings; return this; },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
  });
  const db = {
    from: query,
    rpc: async (name, args) => {
      assert.equal(name, 'deduct_user_credit');
      assert.equal(args.user_id, 'team-owner');
      state.events.push('mp-charge');
      if (rejectDebit || state.balance < args.credit_amount) return { data: { success: false }, error: null };
      state.balance -= args.credit_amount;
      state.debits.push(args.credit_amount);
      return { data: { new_balance: state.balance }, error: null };
    },
  };
  const context = {
    module: { exports: {} }, Date,
    process: { env: { REPLICATE_API_TOKEN: missingToken ? '' : 'test-token' } },
    require(name) {
      if (name === './generationCredits') return pricing;
      if (name === './logger') return { log() {}, warn() {} };
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name === '../services/teamService') return { getEffectiveCredits: async () => ({ creditOwnerId: 'team-owner', creditBalance: state.balance }) };
      if (name === 'axios') return {
        post: async () => {
          state.providerCalls++;
          state.events.push('provider');
          if (providerError) throw Error('provider timeout');
          afterProvider?.(state);
          return { data: { status: 'succeeded', output: emptyOutput ? [] : 'https://test/upscaled.jpg' } };
        },
      };
      throw Error('Unexpected dependency: ' + name);
    },
  };
  vm.runInNewContext(source, context);
  const apply = (extra = {}) => context.module.exports.applyResultUpscale({
    imageUrl: 'https://test/original.jpg', upscaleMp: 16, userId: 'member', generationId: 'generation',
    ensureBaseCharge: async () => {
      state.events.push('base-charge');
      if (state.balance < base) return false;
      state.balance -= base;
      state.settings.creditDeducted = true;
      return true;
    },
    ...extra,
  });
  return { state, apply };
}

test('tariffs include quality and MP per image, including zero extra for 4 MP', () => {
  for (const [mp, fee] of [[4, 0], [8, 20], [16, 40], [32, 80], [64, 120], [128, 240]]) {
    assert.equal(pricing.getGenerationCreditCost('v1', mp), 10 + fee);
    assert.equal(pricing.getGenerationCreditCost('v2', mp), 35 + fee);
    assert.equal(pricing.getUpscaleCredits(String(mp)), fee);
  }
});

test('4 MP and invalid MP never trigger additional processing or charging', async () => {
  for (const mp of [4, 0, 99]) {
    const { state, apply } = setup();
    const result = await apply({ upscaleMp: mp });
    assert.equal(result.creditsCharged, 0);
    assert.deepEqual(state.events, []);
  }
});

test('successful upscale settles base first, then bills team owner only after provider success', async () => {
  const { state, apply } = setup({ balance: 75, base: 35 });
  const result = await apply();
  assert.equal(result.appliedMp, 16);
  assert.equal(result.creditsCharged, 40);
  assert.equal(state.balance, 0);
  assert.deepEqual(state.events, ['base-charge', 'provider', 'mp-charge']);
  assert.equal(state.settings.creditDeducted, true);
  assert.equal(state.settings.stage, null);
});

for (const failure of ['providerError', 'emptyOutput', 'missingToken']) {
  test(`${failure}: original image retained and no MP fee deducted`, async () => {
    const { state, apply } = setup({ [failure]: true });
    const result = await apply();
    assert.equal(result.imageUrl, 'https://test/original.jpg');
    assert.equal(result.appliedMp, null);
    assert.equal(result.creditsCharged, 0);
    assert.equal(state.balance, 990);
    assert.deepEqual(state.debits, []);
    assert.equal(state.settings.stage, null);
  });
}

test('MP cannot consume credits needed for the base generation', async () => {
  const { state, apply } = setup({ balance: 40 });
  const result = await apply();
  assert.equal(state.balance, 30);
  assert.equal(state.providerCalls, 0);
  assert.equal(result.creditsCharged, 0);
});

test('unconfirmed base payment prevents upscale', async () => {
  const { state, apply } = setup();
  await apply({ ensureBaseCharge: async () => false });
  assert.equal(state.balance, 1000);
  assert.equal(state.providerCalls, 0);
});

test('debit RPC rejection does not report a paid upscale', async () => {
  const { state, apply } = setup({ rejectDebit: true });
  const result = await apply();
  assert.equal(result.appliedMp, null);
  assert.equal(result.creditsCharged, 0);
  assert.equal(state.balance, 990);
});

test('balance changes while provider runs do not cause an overdraft', async () => {
  const { state, apply } = setup({ afterProvider: state => { state.balance = 5; } });
  const result = await apply();
  assert.equal(result.appliedMp, null);
  assert.equal(state.balance, 5);
  assert.deepEqual(state.debits, []);
});

test('bulk sum includes only successfully applied MP fees', async () => {
  const success = await setup().apply();
  const failed = await setup({ providerError: true }).apply();
  const standard = await setup().apply({ upscaleMp: 4 });
  const total = [success, failed, standard].reduce((sum, r) => sum + 10 + r.creditsCharged, 0);
  assert.equal(total, 70);
});
