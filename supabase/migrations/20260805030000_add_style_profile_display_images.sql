-- Global çekim tarzlarında üretim referansları ile vitrinde gösterilen gerçek
-- sonuçları birbirinden ayırır.
--
-- image_urls: Üretimde NB2'ye giden, stil ilk oluşturulurken yüklenen referanslar.
-- display_image_urls: Global modalda gösterilen örnek sonuçlar; üretimde kullanılmaz.
ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS display_image_urls TEXT[];

-- Bir kullanıcı stilinin yanlışlıkla birden fazla kez globale alınmasını önler
-- ve global kopyanın kaynağını yönetim ekranında izlenebilir tutar.
ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS source_profile_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS style_profiles_global_source_profile_unique
  ON style_profiles (source_profile_id)
  WHERE user_id = 'global' AND source_profile_id IS NOT NULL;

COMMENT ON COLUMN style_profiles.display_image_urls IS
  'UI showcase images only. Generation must always use image_urls.';

COMMENT ON COLUMN style_profiles.source_profile_id IS
  'Original user-owned style profile copied into the global catalogue.';
