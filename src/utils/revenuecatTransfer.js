// RevenueCat TRANSFER event'i
// ----------------------------
// Aynı mağaza hesabı (Apple ID / Google hesabı) farklı bir uygulama kullanıcısıyla
// oturum açtığında RevenueCat satın almayı YENİ app_user_id'ye taşır ve tek bir
// TRANSFER event'i gönderir:
//
//   { type: "TRANSFER", transferred_from: [eski_id...], transferred_to: [yeni_id...] }
//
// Bu event'te `app_user_id` ve `product_id` YOKTUR — bu yüzden webhook'un normal
// akışına girmez. Eskiden hiç işlenmiyordu ve şu sonucu doğuruyordu:
//   - Aboneliğin ESKİ sahibi RC'de tüm haklarını kaybediyor,
//   - ama bizim DB'de `is_pro=true` / `is_in_trial=true` sonsuza kadar takılı kalıyor,
//   - abonelik bittiğinde gelen EXPIRATION artık YENİ id'ye gittiği için eski kayıt
//     hiçbir zaman düşürülmüyordu → ömür boyu bedava PRO ("hayalet PRO").
//
// Burada yalnız `transferred_from` tarafını düşürüyoruz. `transferred_to` tarafına
// PRO vermek için event'te ürün/plan bilgisi yok; o yön zaten mevcut client akışıyla
// kendini onarıyor (CustomHeader → /api/auth/sync-pro-status, RC entitlement'ı
// gördüğünde backend'i yukarı senkronlar) ve sonraki RENEWAL event'i planı yazar.
//
// KREDİLERE DOKUNULMAZ: kredi kullanıcının kazanılmış bakiyesidir ve çoğu transfer
// aynı insanın cihaz/hesap değiştirmesidir; geri almak cezalandırıcı olur.

const TRANSFER_DOWNGRADE_FIELDS = {
  is_pro: false,
  is_in_trial: false,
  subscription_type: null,
  team_max_members: 0,
  team_subscription_active: false,
};

/**
 * TRANSFER event'ini uygular.
 * @returns {Promise<{downgraded: string[], skipped: string[], failed: string[]}>}
 */
async function applyRevenueCatTransfer({ supabase, event, logPrefix = "RC_TRANSFER" }) {
  const from = Array.isArray(event?.transferred_from) ? event.transferred_from : [];
  const to = Array.isArray(event?.transferred_to) ? event.transferred_to : [];

  // Savunma: bir id hem from hem to listesindeyse (RC alias birleşmeleri) dokunma —
  // aksi halde hakkı devralan kullanıcıyı düşürürüz.
  const receiving = new Set(to.map(String));
  const targets = [...new Set(from.map(String))].filter((id) => id && !receiving.has(id));

  const result = { downgraded: [], skipped: from.filter((id) => receiving.has(String(id))), failed: [] };

  if (targets.length === 0) {
    console.log(`ℹ️ [${logPrefix}] Düşürülecek transferred_from id'si yok.`);
    return result;
  }

  console.log(
    `🔁 [${logPrefix}] Transfer: ${targets.length} eski sahip düşürülüyor → yeni sahip(ler): ${to.join(", ") || "(bilinmiyor)"}`,
  );

  for (const userId of targets) {
    try {
      const { data, error } = await supabase
        .from("users")
        .update(TRANSFER_DOWNGRADE_FIELDS)
        .eq("id", userId)
        .select("id");

      if (error) {
        console.error(`❌ [${logPrefix}] ${userId} düşürülemedi:`, error.message);
        result.failed.push(userId);
        continue;
      }
      if (!data || data.length === 0) {
        // RC anonim id'leri ($RCAnonymousID:...) users tablosunda yoktur — normal.
        console.log(`ℹ️ [${logPrefix}] ${userId} users tablosunda yok, atlandı.`);
        result.skipped.push(userId);
        continue;
      }

      result.downgraded.push(userId);
      console.log(`✅ [${logPrefix}] ${userId} düşürüldü (is_pro=false, is_in_trial=false).`);

      // Denetim izi. transaction_id benzersiz olmalı → event id + user id.
      try {
        await supabase.from("purchase_history").insert({
          user_id: userId,
          product_id: "transfer",
          transaction_id: `transfer_${event?.id || event?.event_timestamp_ms || "na"}_${userId}`,
          credits_added: 0,
          price: 0,
          currency: event?.currency || "USD",
          store: event?.store || "unknown",
          environment: event?.environment || "unknown",
          event_type: "TRANSFER",
          purchased_at: new Date(event?.event_timestamp_ms || Date.now()),
          created_at: new Date().toISOString(),
        });
      } catch (historyError) {
        console.error(
          `⚠️ [${logPrefix}] purchase_history kaydı yazılamadı (${userId}):`,
          historyError?.message || historyError,
        );
      }
    } catch (err) {
      console.error(`❌ [${logPrefix}] ${userId} işlenirken hata:`, err?.message || err);
      result.failed.push(userId);
    }
  }

  return result;
}

module.exports = { applyRevenueCatTransfer, TRANSFER_DOWNGRADE_FIELDS };
