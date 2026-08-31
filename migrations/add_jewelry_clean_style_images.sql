-- Jewelry auto-style referanslarının, üzerinde mevcut takı bulunmayan sürümleri.
--
-- `image_urls` orijinal kaynakları korur. Replicate ile temizlenen, aynı sıradaki
-- karşılıklar `jewelry_clean_image_urls` içine yazılır. Ayrı grid cache alanı
-- zorunludur; normal `stamped_grid_url` eski/takılı görsellerden üretilmiş olabilir.
-- İdempotent: tekrar çalıştırmak güvenlidir.

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS jewelry_clean_image_urls text[];

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS jewelry_clean_stamped_grid_url text;

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS jewelry_clean_source_fingerprint text;

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS jewelry_cleaned_at timestamptz;

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS jewelry_clean_error text;

COMMENT ON COLUMN style_profiles.jewelry_clean_image_urls IS
  'Jewelry auto-style için mevcut takıları kaldırılmış referans URL''leri. Sıra image_urls ile birebir aynıdır.';
COMMENT ON COLUMN style_profiles.jewelry_clean_stamped_grid_url IS
  'jewelry_clean_image_urls kullanılarak hazırlanmış plakalı stil kolajı önbelleği.';
COMMENT ON COLUMN style_profiles.jewelry_clean_source_fingerprint IS
  'Kaynak image_urls değiştiğinde temiz sürümün bayatladığını tespit eden SHA-256.';
COMMENT ON COLUMN style_profiles.jewelry_cleaned_at IS
  'Tüm jewelry temiz referansları başarıyla tamamlandığında yazılan zaman.';
COMMENT ON COLUMN style_profiles.jewelry_clean_error IS
  'Son backfill denemesindeki hata; başarılı tamamlanmada NULL yapılır.';

CREATE INDEX IF NOT EXISTS idx_style_profiles_jewelry_clean_ready
  ON style_profiles (product_subtype, style_approach)
  WHERE product_category = 'jewelry'
    AND jewelry_clean_image_urls IS NOT NULL;
