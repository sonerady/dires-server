const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateVariationCost,
  calculateVariationAccess,
  canStartFreeOnlyVariation,
  shouldStartAutomaticTrialVariation,
} = require("../src/utils/variationFlow");

test("the first variation batch is free", () => {
  assert.deepEqual(calculateVariationCost(0), {
    variationIndex: 1,
    creditCost: 0,
  });
});

test("later variation batches cost ten credits", () => {
  assert.deepEqual(calculateVariationCost(2), {
    variationIndex: 3,
    creditCost: 10,
  });
  assert.deepEqual(calculateVariationCost(8), {
    variationIndex: 9,
    creditCost: 10,
  });
});

test("row counts are normalized before calculating the price", () => {
  assert.deepEqual(calculateVariationCost(-5), {
    variationIndex: 1,
    creditCost: 0,
  });
  assert.deepEqual(calculateVariationCost("2"), {
    variationIndex: 3,
    creditCost: 10,
  });
});

test("free-only trial generation rejects a paid variation", () => {
  assert.equal(canStartFreeOnlyVariation(0), true);
  assert.equal(canStartFreeOnlyVariation(10), false);
});

test("credit configuration remains explicit and testable", () => {
  assert.deepEqual(
    calculateVariationCost(1, {
      freeFirstVariation: false,
      variationCreditCost: 25,
    }),
    { variationIndex: 2, creditCost: 25 },
  );
});

test("trial users receive five free variation batches for the same source", () => {
  for (let batchCount = 0; batchCount < 5; batchCount += 1) {
    const access = calculateVariationAccess(batchCount, { isInTrial: true });
    assert.equal(access.creditCost, 0);
    assert.equal(access.limitReached, false);
    assert.equal(access.trialRemaining, 5 - batchCount);
    assert.equal(access.variationIndex, batchCount + 1);
  }
});

test("the sixth trial batch is disabled without charging credits", () => {
  assert.deepEqual(calculateVariationAccess(5, { isInTrial: true }), {
    variationIndex: 6,
    creditCost: 0,
    batchCount: 5,
    isInTrial: true,
    trialLimit: 5,
    trialRemaining: 0,
    limitReached: true,
  });
});

test("non-trial pricing uses batch count rather than the two database rows per batch", () => {
  assert.deepEqual(calculateVariationAccess(1), {
    variationIndex: 2,
    creditCost: 10,
    batchCount: 1,
    isInTrial: false,
    trialLimit: 5,
    trialRemaining: null,
    limitReached: false,
  });
});

test("backend automatic variation starts only for a trial source with no previous batch", () => {
  assert.equal(
    shouldStartAutomaticTrialVariation({
      isInTrial: true,
      batchCount: 0,
      limitReached: false,
    }),
    true,
  );
  assert.equal(
    shouldStartAutomaticTrialVariation({
      isInTrial: true,
      batchCount: 1,
      limitReached: false,
    }),
    false,
  );
  assert.equal(
    shouldStartAutomaticTrialVariation({
      isInTrial: false,
      batchCount: 0,
      limitReached: false,
    }),
    false,
  );
});
