const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real route-local payment helpers without starting HTTP servers,
// provider clients or a live database.
for (const route of ['changePose', 'changeProductColor', 'backSideCloset', 'createRefiner', 'referenceBrowserRoutesV7', 'referenceJewelryBrowserRoutesV7']) {
  for (const quality of ['v1', 'v2']) {
    test(`${route} ${quality}: base fee is charged once even when completion follows upscale`, async () => {
      const source = fs.readFileSync(path.join(__dirname, `../src/routes/${route}.js`), 'utf8');
      const start = source.indexOf('async function deductCreditOnSuccess(');
      const end = source.indexOf('async function updateGenerationStatus(', start);
      let balance = 100;
      let row = { settings: { qualityVersion: quality } };
      const debits = [];
      const db = {
        from(table) {
          return {
            select() { return this; }, eq() { return this; },
            single: async () => ({ data: table === 'users' ? { credit_balance: balance } : row }),
            update(values) { row = { ...row, ...values }; return this; },
            then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
          };
        },
        async rpc(name, args) {
          assert.equal(args.user_id, 'owner');
          debits.push(args.credit_amount);
          balance -= args.credit_amount;
          return { data: { new_balance: balance }, error: null };
        },
      };
      const quiet = { log() {}, error() {}, warn() {} };
      const fn = vm.runInNewContext(source.slice(start, end) + '\ndeductCreditOnSuccess;', {
        supabase: db, console: quiet, logger: quiet,
        teamService: { getEffectiveCredits: async () => ({ creditOwnerId: 'owner', creditBalance: balance, isTeamCredit: true }) },
      });
      assert.equal(await fn('generation', 'member'), true);
      assert.equal(await fn('generation', 'member'), true);
      assert.deepEqual(debits, [quality === 'v2' ? 35 : 10]);
      assert.equal(row.settings.creditDeducted, true);
    });
  }
}
