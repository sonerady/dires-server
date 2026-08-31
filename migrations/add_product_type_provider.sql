-- 🏷️ Ürün tipi sınıflandırma sağlayıcı anahtarı (26 Ağu 2026, kullanıcı kararı)
--
-- CreateModelPhotoScreen'in foto-analizi (product-type/classify) hangi LLM'e
-- gitsin: 'deepseek' (varsayılan — eklenti stil akışıyla aynı model,
-- deepseek-v4-flash-vision-exp) ya da 'fal' (fal openrouter geçidi + Luna).
-- Sunucu değeri 60 sn cache'ler; değişiklik en geç 1 dk içinde etkir.
--
-- Yapı prompt_enhance_provider ile aynı: app_config tek satırlı tabloysa
-- kolon; key/value yapısındaysa sunucu 'product_type_provider' anahtarını da
-- okuyabiliyor (kolon yoksa fallback).

ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS product_type_provider text NOT NULL DEFAULT 'deepseek';

ALTER TABLE app_config
  DROP CONSTRAINT IF EXISTS app_config_product_type_provider_check;

ALTER TABLE app_config
  ADD CONSTRAINT app_config_product_type_provider_check
  CHECK (product_type_provider IN ('deepseek', 'fal'));

-- Mevcut satır(lar) varsayılana çekilir
UPDATE app_config SET product_type_provider = 'deepseek';

-- Değiştirmek için:
--   UPDATE app_config SET product_type_provider = 'fal';      -- fal/Luna'ya dön
--   UPDATE app_config SET product_type_provider = 'deepseek';  -- DeepSeek (varsayılan)
