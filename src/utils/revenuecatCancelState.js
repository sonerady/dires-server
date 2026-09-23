// 🔴 Abonelik iptal durumu (23 Eyl 2026) — anasayfa iptal banner'ı
//
// PRO iken otomatik yenilemeyi kapatan kullanıcıya uygulamada kırmızı bir uyarı
// gösterilir. RevenueCat CANCELLATION olayı erişimi hemen kesmez (dönem sonuna kadar
// PRO kalır); o yüzden iptal anı + bitiş tarihi users tablosuna yazılır:
//   subscription_cancelled_at, subscription_expires_at
// Banner'ı AÇAN tek olay: ücretli dönemde (TRIAL değil), kullanıcının kendi iptali,
// süresi henüz dolmamış. Deneme iptali, çekim hatası ve iade (müşteri desteği) sayılmaz.
// Banner'ı KAPATAN olaylar: yeniden etkinleştirme, yenileme, yeni satın alım,
// ürün değişikliği, süre bitimi ve aktarım.
// Webhook akışını ASLA bozmaz: her hata yutulur, yalnız loglanır.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RevenueCat cancel_reason: UNSUBSCRIBE | BILLING_ERROR | DEVELOPER_INITIATED | PRICE_INCREASE | CUSTOMER_SUPPORT | UNKNOWN
const USER_CANCEL_REASONS = new Set(["UNSUBSCRIBE", "PRICE_INCREASE", "UNKNOWN"]);
const CLEAR_EVENTS = new Set(["UNCANCELLATION", "RENEWAL", "INITIAL_PURCHASE", "PRODUCT_CHANGE", "EXPIRATION"]);

/** Saf karar: bu olay iptal durumunu nasıl değiştirir? → "set" | "clear" | null */
function cancelStateAction(event, now = Date.now()) {
  if (!event || !event.type) return null;
  if (event.type === "CANCELLATION") {
    const expiresAt = Number(event.expiration_at_ms) || 0;
    const reason = event.cancel_reason || "UNKNOWN";
    if (event.period_type === "TRIAL") return "clear"; // deneme iptali banner açmaz
    if (!USER_CANCEL_REASONS.has(reason)) return null;
    if (!expiresAt || expiresAt <= now) return null; // süresi zaten bitmiş → EXPIRATION akışı
    return "set";
  }
  if (CLEAR_EVENTS.has(event.type)) return "clear";
  return null;
}

/** Olayı users tablosuna uygular. TRANSFER'da eski sahipler (transferred_from) temizlenir. */
async function syncCancelState({ supabase, event, logPrefix = "RC_CANCEL_STATE" }) {
  try {
    if (event?.type === "TRANSFER") {
      const ids = (event.transferred_from || []).filter((id) => UUID_REGEX.test(String(id)));
      if (ids.length) {
        await supabase.from("users").update({ subscription_cancelled_at: null, subscription_expires_at: null }).in("id", ids);
      }
      return "clear";
    }
    const action = cancelStateAction(event);
    if (!action) return null;
    const userId = event.app_user_id || event.original_app_user_id;
    if (!userId || !UUID_REGEX.test(String(userId))) return null;
    const patch = action === "set"
      ? { subscription_cancelled_at: new Date().toISOString(), subscription_expires_at: new Date(Number(event.expiration_at_ms)).toISOString() }
      : { subscription_cancelled_at: null, subscription_expires_at: null };
    const { error } = await supabase.from("users").update(patch).eq("id", userId);
    if (error) console.warn(`⚠️ [${logPrefix}] cancel state ${action} failed:`, error.message);
    else console.log(`🔴 [${logPrefix}] cancel state ${action} → ${userId}${action === "set" ? ` (until ${patch.subscription_expires_at})` : ""}`);
    return action;
  } catch (error) {
    console.warn(`⚠️ [${logPrefix}] cancel state sync error:`, error?.message);
    return null;
  }
}

/** Banner kararı (durum ucu) */
function cancelBannerState(user, now = Date.now()) {
  const expiresAt = user?.subscription_expires_at ? new Date(user.subscription_expires_at).getTime() : 0;
  const show = Boolean(user?.is_pro && !user?.is_in_trial && user?.subscription_cancelled_at && expiresAt > now);
  return {
    show,
    expiresAt: show ? new Date(expiresAt).toISOString() : null,
    daysLeft: show ? Math.max(1, Math.ceil((expiresAt - now) / 86400000)) : null,
  };
}

module.exports = { cancelStateAction, syncCancelState, cancelBannerState };
