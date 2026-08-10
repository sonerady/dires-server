const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveRevenueCatTrialState,
} = require("../src/utils/revenuecatTrialState");

test("ends trial for a v2nt non-trial initial subscription purchase", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: true,
      eventType: "INITIAL_PURCHASE",
      periodType: "NORMAL",
      isTrialConversion: false,
      isSubscription: true,
    }),
    false,
  );
});

test("ends trial for an Android paid subscription when period metadata is absent", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: true,
      eventType: "INITIAL_PURCHASE",
      isTrialConversion: false,
      isSubscription: true,
    }),
    false,
  );
});

test("starts trial for a trial initial purchase", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: false,
      eventType: "INITIAL_PURCHASE",
      periodType: "TRIAL",
      isTrialConversion: false,
      isSubscription: true,
    }),
    true,
  );
});

test("preserves trial during a trial-period product change", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: true,
      eventType: "PRODUCT_CHANGE",
      periodType: "TRIAL",
      isTrialConversion: false,
      isSubscription: true,
    }),
    true,
  );
});

// Regresyon: trial→ücretli yükseltmesinde mağaza iki event gönderiyor —
// yeni ürün için ücretli event, ESKİ (trial) ürün için PRODUCT_CHANGE+TRIAL.
// İkincisi trial bayrağını DİRİLTMEMELİ, yoksa ödeyen kullanıcı is_in_trial=true
// takılı kalıp her indirmede filigran yiyor (downloadRoutes.js canDownloadOriginal).
test("stale trial-period product change never resurrects an already-ended trial", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: false, // ücretli event milisaniyeler önce trial'ı kapattı
      eventType: "PRODUCT_CHANGE",
      periodType: "TRIAL", // eski trial ürününün dönemi
      isTrialConversion: false,
      isSubscription: true,
    }),
    false,
  );
});

test("coin purchases do not end trial", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: true,
      eventType: "NON_RENEWING_PURCHASE",
      periodType: "NORMAL",
      isTrialConversion: false,
      isSubscription: false,
    }),
    true,
  );
});

test("normal renewal ends trial even without the conversion flag", () => {
  assert.equal(
    resolveRevenueCatTrialState({
      wasInTrial: true,
      eventType: "RENEWAL",
      periodType: "NORMAL",
      isTrialConversion: false,
      isSubscription: true,
    }),
    false,
  );
});
