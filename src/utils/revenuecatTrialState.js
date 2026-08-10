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

  // Gerçek trial başlangıcı HER ZAMAN INITIAL_PURCHASE + period_type=TRIAL ile gelir.
  if (normalizedPeriodType === "TRIAL" && eventType === "INITIAL_PURCHASE") {
    return true;
  }

  // ⚠️ PRODUCT_CHANGE + period_type=TRIAL trial BAŞLATMAZ.
  // Kullanıcı trial'dayken ücretli plana yükseldiğinde mağaza iki event gönderir:
  //   1) INITIAL_PURCHASE/RENEWAL → YENİ ücretli ürün, period_type=NORMAL
  //   2) PRODUCT_CHANGE           → ESKİ (trial) ürün, period_type=TRIAL
  // İkisi milisaniyeler arayla paralel işleniyor. Eskiden (2) burada `true`
  // döndüğü için, (1)'in yeni kapattığı trial bayrağını geri DİRİLTİYORDU →
  // ödeme yapan kullanıcı `is_in_trial=true` takılı kalıyor, downloadRoutes.js
  // `canDownloadOriginal = is_pro && !is_in_trial` kuralı yüzünden her indirmede
  // filigran yiyordu. Artık bu event bayrağı yalnızca KORUR, asla açmaz —
  // böylece iki event hangi sırayla işlenirse işlensin sonuç aynı olur.
  if (normalizedPeriodType === "TRIAL" && eventType === "PRODUCT_CHANGE") {
    return wasInTrial;
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
