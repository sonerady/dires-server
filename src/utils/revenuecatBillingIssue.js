// BILLING_ISSUE — yenileme/dönüşüm çekimi başarısız oldu, kullanıcı mağaza
// tarafında grace period'a girdi (erişimi/entitlement'ı RC'de hâlâ aktif).
//
// Ürün kararı (21 Ağu 2026): grace sırasında erişim, kredi ve subscription_type
// korunur; YALNIZ is_pro=false yapılır. is_pro sadece filigranı kontrol ettiği
// için kullanıcı üretime devam eder ama filigran geri gelir — "ödeme yöntemini
// düzelt" baskısı. Çekim kurtarılınca gelen RENEWAL/INITIAL_PURCHASE akışı
// is_pro'yu ürün eşleşmesinden tekrar true yazar; burada geri açma işi yok.
//
// purchase_history'ye BILLING_ISSUE satırı da yazılır — grace kurtarma oranını
// (billing issue → renewal/expiration) ölçebilmek için. Aynı abone için mağaza
// birden çok deneme yapabilir; satırların tekrarı bilinçli, analizde dedupe edilir.

const {
  isSupersededByNewerPaidSubscription,
} = require("./revenuecatSupersededProduct");

async function applyRevenueCatBillingIssue({ supabase, event, logPrefix = "RC_BILLING_ISSUE" }) {
  const userId = event?.app_user_id || event?.original_app_user_id;
  if (!userId) {
    console.warn(`⚠️ [${logPrefix}] BILLING_ISSUE event'inde user id yok, atlanıyor.`);
    return { skipped: true, reason: "no_user_id" };
  }

  const productId = event?.product_id || null;

  // Bayat event koruması: event'in ürünü kullanıcının güncel ücretli aboneliği
  // değilse (araya yeni ürün alınmışsa) aktif ödeyen aboneye filigran basma.
  if (
    productId &&
    (await isSupersededByNewerPaidSubscription({
      supabase,
      userId,
      productId,
      purchasedAtMs: event?.purchased_at_ms,
    }))
  ) {
    console.log(
      `🛡️ [${logPrefix}] BILLING_ISSUE bayat ürüne ait (${productId}) → is_pro dokunulmadı.`,
    );
    return { skipped: true, reason: "superseded_product", product_id: productId };
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ is_pro: false })
    .eq("id", userId);

  if (updateError) {
    console.error(`❌ [${logPrefix}] BILLING_ISSUE is_pro güncellenemedi:`, updateError.message);
    return { skipped: true, reason: "update_failed", error: updateError.message };
  }

  console.log(
    `💳 [${logPrefix}] BILLING_ISSUE: ${userId} grace'e girdi → is_pro=false (kredi/plan korunuyor).`,
  );

  try {
    await supabase.from("purchase_history").insert({
      user_id: userId,
      product_id: productId || "unknown",
      transaction_id: event?.transaction_id || `billing_issue_${event?.event_timestamp_ms || Date.now()}`,
      credits_added: 0,
      price: 0,
      currency: event?.currency || "USD",
      store: event?.store || "unknown",
      environment: event?.environment || "unknown",
      event_type: "BILLING_ISSUE",
      purchased_at: new Date(event?.purchased_at_ms || event?.event_timestamp_ms || Date.now()),
      created_at: new Date().toISOString(),
    });
  } catch (historyError) {
    console.error(
      `⚠️ [${logPrefix}] BILLING_ISSUE history yazılamadı:`,
      historyError?.message || historyError,
    );
  }

  return { user_id: userId, product_id: productId, is_pro: false };
}

module.exports = { applyRevenueCatBillingIssue };
