const PAID_SUBSCRIPTION_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
]);

const resolveRevenueCatTrialState = ({
  wasInTrial,
  eventType,
  periodType,
  isTrialConversion,
  isSubscription,
}) => {
  if (!isSubscription) return wasInTrial;

  const normalizedPeriodType = String(periodType || "").toUpperCase();
  if (
    normalizedPeriodType === "TRIAL" &&
    (eventType === "INITIAL_PURCHASE" || eventType === "PRODUCT_CHANGE")
  ) {
    return true;
  }

  if (
    isTrialConversion === true ||
    (PAID_SUBSCRIPTION_EVENTS.has(eventType) &&
      normalizedPeriodType !== "TRIAL")
  ) {
    return false;
  }

  return wasInTrial;
};

module.exports = { resolveRevenueCatTrialState };
