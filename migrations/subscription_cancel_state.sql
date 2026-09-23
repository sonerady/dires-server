-- 🔴 İptal banner'ı (23 Eyl 2026): PRO iken otomatik yenilemeyi iptal eden kullanıcı.
-- RevenueCat CANCELLATION (ücretli dönem, süre dolmamış) → iki alan dolar;
-- UNCANCELLATION / RENEWAL / INITIAL_PURCHASE / PRODUCT_CHANGE / EXPIRATION / TRANSFER → temizlenir.
-- Anasayfa banner'ı: is_pro && !is_in_trial && subscription_cancelled_at && subscription_expires_at > now()
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

-- Kill switch: app_config.cancel_banner_enabled = false (herhangi bir satırda) → banner kimseye gösterilmez
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS cancel_banner_enabled boolean NOT NULL DEFAULT true;
