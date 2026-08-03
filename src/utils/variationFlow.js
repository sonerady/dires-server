const DEFAULT_VARIATION_CREDIT_COST = 10;
const DEFAULT_TRIAL_VARIATION_BATCH_LIMIT = 5;

function calculateVariationCost(
  previousRowCount,
  {
    freeFirstVariation = true,
    variationCreditCost = DEFAULT_VARIATION_CREDIT_COST,
  } = {},
) {
  const previous = Math.max(0, Number(previousRowCount) || 0);
  const variationIndex = previous + 1;
  const creditCost =
    freeFirstVariation && variationIndex === 1 ? 0 : variationCreditCost;

  return { variationIndex, creditCost };
}

function canStartFreeOnlyVariation(creditCost) {
  return Number(creditCost) === 0;
}

function shouldStartAutomaticTrialVariation(access = {}) {
  return (
    access.isInTrial === true &&
    Number(access.batchCount) === 0 &&
    access.limitReached !== true
  );
}

function calculateVariationAccess(
  previousBatchCount,
  {
    isInTrial = false,
    trialBatchLimit = DEFAULT_TRIAL_VARIATION_BATCH_LIMIT,
    freeFirstVariation = true,
    variationCreditCost = DEFAULT_VARIATION_CREDIT_COST,
  } = {},
) {
  const batchCount = Math.max(0, Number(previousBatchCount) || 0);
  const normalizedTrialLimit = Math.max(0, Number(trialBatchLimit) || 0);
  const variationIndex = batchCount + 1;

  if (isInTrial) {
    const limitReached = batchCount >= normalizedTrialLimit;
    return {
      variationIndex,
      creditCost: 0,
      batchCount,
      isInTrial: true,
      trialLimit: normalizedTrialLimit,
      trialRemaining: Math.max(0, normalizedTrialLimit - batchCount),
      limitReached,
    };
  }

  const { creditCost } = calculateVariationCost(batchCount, {
    freeFirstVariation,
    variationCreditCost,
  });
  return {
    variationIndex,
    creditCost,
    batchCount,
    isInTrial: false,
    trialLimit: normalizedTrialLimit,
    trialRemaining: null,
    limitReached: false,
  };
}

module.exports = {
  DEFAULT_VARIATION_CREDIT_COST,
  DEFAULT_TRIAL_VARIATION_BATCH_LIMIT,
  calculateVariationCost,
  calculateVariationAccess,
  canStartFreeOnlyVariation,
  shouldStartAutomaticTrialVariation,
};
