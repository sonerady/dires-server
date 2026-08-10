// Trial→ücretli yükseltmesinde mağaza, ESKİ (trial) ürün için bir süre sonra
// EXPIRATION event'i gönderir — kullanıcının o sırada YENİ ürün üzerinde aktif ve
// ödenmiş bir aboneliği olmasına rağmen. Webhook bu event'i körlemesine işlediğinde
// ödeyen aboneyi `is_pro=false, subscription_type=null`'a düşürüyordu.
//
// Bu yardımcı, event'in konusu olan ürünün kullanıcının GÜNCEL ücretli ürünü olup
// olmadığını `purchase_history` üzerinden belirler. Güncel değilse event bayattır ve
// düşürme işlemi atlanmalıdır.
//
// Not: Yalnız ABONELİK satın almaları dikkate alınır; coin paketleri
// (NON_RENEWING_PURCHASE) abonelik durumunu temsil etmez.

const SUBSCRIPTION_EVENT_TYPES = ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE"];
const SUBSCRIPTION_TIER_RE = /(standard|plus|premium|pro)/;
const SUBSCRIPTION_PERIOD_RE = /(week|month|year)/;

const normalizeProductId = (productId) =>
  String(productId || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(":")[0]
    .toLowerCase();

const looksLikeSubscription = (normalizedId) =>
  SUBSCRIPTION_TIER_RE.test(normalizedId) &&
  SUBSCRIPTION_PERIOD_RE.test(normalizedId);

const rowTime = (row) => {
  const t = new Date(row?.purchased_at || row?.created_at || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
};

/**
 * Event'in ürünü, kullanıcının DAHA YENİ bir ücretli aboneliği tarafından
 * geçersiz kılınmışsa true. Yani: "bu event kullanıcının artık kullanmadığı,
 * yerine ücretli bir abonelik alınmış eski bir ürün hakkında".
 *
 * ⚠️ SADECE "farklı ürün" yetmez, ödemenin DAHA YENİ olması da şart. Aksi halde
 * geri dönen bir müşteri (Haziran'da ödemiş, Ağustos'ta yeni trial başlatmış)
 * trial'ı bittiğinde düşürülmez ve ömür boyu bedava PRO kalırdı.
 *
 * Karşılaştırma referansı: event ürününün purchase_history'deki kendi en son
 * satın alma zamanı; yoksa event'in `purchased_at_ms` değeri. İkisi de yoksa
 * `false` döner (guard uygulanmaz, mevcut davranış korunur).
 */
async function isSupersededByNewerPaidSubscription({
  supabase,
  userId,
  productId,
  purchasedAtMs,
}) {
  const eventProductId = normalizeProductId(productId);
  if (!userId || !eventProductId) return false;

  try {
    const { data, error } = await supabase
      .from("purchase_history")
      .select("product_id, price, purchased_at, created_at, event_type")
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false })
      .limit(100);

    if (error) {
      console.warn(
        "⚠️ [RC_SUPERSEDED] purchase_history okunamadı, guard atlanıyor:",
        error.message,
      );
      return false;
    }

    const rows = (data || []).map((row) => ({
      ...row,
      pid: normalizeProductId(row.product_id),
      t: rowTime(row),
    }));

    // Süresi dolan ürünün KENDİ en son satın alma zamanı (karşılaştırma referansı).
    const ownLatest = rows.find((r) => r.pid === eventProductId && r.t !== null);
    const referenceTime =
      ownLatest?.t ??
      (Number.isFinite(purchasedAtMs) && purchasedAtMs > 0 ? purchasedAtMs : null);

    if (referenceTime === null) {
      console.log(
        `ℹ️ [RC_SUPERSEDED] "${eventProductId}" için referans zaman bulunamadı → guard uygulanmadı.`,
      );
      return false;
    }

    // Farklı bir ürünün, DAHA SONRA yapılmış ücretli abonelik satın alması.
    const newerPaid = rows.find(
      (r) =>
        r.pid !== eventProductId &&
        Number(r.price) > 0 &&
        SUBSCRIPTION_EVENT_TYPES.includes(r.event_type) &&
        looksLikeSubscription(r.pid) &&
        r.t !== null &&
        r.t > referenceTime,
    );

    if (!newerPaid) return false;

    console.log(
      `🛡️ [RC_SUPERSEDED] "${eventProductId}" (${new Date(referenceTime).toISOString()}) ` +
        `daha yeni ücretli abonelikle geçersiz kılınmış: "${newerPaid.pid}" ` +
        `(${new Date(newerPaid.t).toISOString()}, $${newerPaid.price}) → düşürme atlanacak.`,
    );
    return true;
  } catch (err) {
    console.warn(
      "⚠️ [RC_SUPERSEDED] guard hatası, atlanıyor:",
      err?.message || err,
    );
    return false;
  }
}

module.exports = {
  isSupersededByNewerPaidSubscription,
  normalizeProductId,
};
