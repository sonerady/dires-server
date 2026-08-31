-- 🌟 Otomatik Global Stil Havuzu — metadata kolonları
--
-- Otomatik stil sistemi (autoGlobalStyle.js), kullanıcı stil seçmediğinde
-- arka planda user_id IN ('auto','global') profillerinden seçim yapar:
--   'global' → kullanıcıya görünen küratörlü çekim tarzları (mevcut)
--   'auto'   → SADECE otomatik havuz için admin'in eklediği gizli stiller
--              (admin dashboard → Auto styles sayfası; uygulamada görünmez)
--
-- Bu migration üç metadata kolonu ekler. Seçim şu an ORTAK havuzdan rastgele
-- yapılır; kategori/tag yalnızca kayıt altına alınır (ileride ürün kategorisine
-- göre eşleme için hazır dursun diye).
--
-- ⚠️ Kolon adı `auto_tags` — mevcut `tags` kolonu vitrindeki stil aramasının
-- ÇOK DİLLİ etiket haritasını tutuyor; otomatik havuzun düz etiket listesi
-- onunla karışmasın diye ayrı kolonda.
--
-- Kolon semantiği:
--   auto_tags        — otomatik havuz etiketleri, jsonb string dizisi
--                      (örn. ["pinterest","sokak","sıcak ışık"])
--   product_category — stilin hedeflediği ürün kategorisi slug'ı
--                      (örn. giyim / tesettur / ayakkabi / canta / taki)
--   auto_pool        — otomatik havuz üyeliği: NULL veya TRUE → havuzda,
--                      FALSE → havuz dışı (admin toggle'ı; stil silinmez,
--                      yalnızca otomatik rotasyondan çıkar)

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS auto_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS product_category text;

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS auto_pool boolean;

-- Tahmini yaş: stil referanslarındaki baskın öznenin TEK rakamlık yaş tahmini
-- (otomatik Gemini tahmini + admin düzeltmesi), örn. 27. NULL = tahmin yok.
-- Seçimde YALNIZ kullanıcı 18 yaşından küçük bir yaş girdiğinde devreye girer:
-- önce girilen yaşın ±2 bandındaki stiller tercih edilir; eşleşme bulunmazsa
-- genel havuza dönülür. Yetişkin ve yaş seçilmemiş üretimlerde yaş filtresi
-- UYGULANMAZ.
ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS estimated_age smallint;

COMMENT ON COLUMN style_profiles.auto_tags IS
  'Otomatik stil havuzu: serbest etiketler (jsonb string dizisi). Vitrin aramasının çok dilli tags kolonundan ayrıdır.';
COMMENT ON COLUMN style_profiles.product_category IS
  'Otomatik stil havuzu: hedef ürün kategorisi slug''ı (giyim/tesettur/ayakkabi/canta/taki...). Şimdilik yalnız kayıt.';
COMMENT ON COLUMN style_profiles.auto_pool IS
  'Otomatik stil havuzu üyeliği: NULL/TRUE havuzda, FALSE havuz dışı.';
COMMENT ON COLUMN style_profiles.estimated_age IS
  'Stil referanslarındaki baskın öznenin tek rakamlık tahmini yaşı (yıl, örn. 27). NULL = tahmin yok. Yalnız 18 yaş altı üretimlerde ±2 yaş eşleşmesi için kullanılır.';

-- Mevcut küratörlü global stilleri havuza AÇIKÇA dahil et. (NULL da "havuzda"
-- sayılır; bu update yalnızca admin panelde durumun net görünmesi için.)
UPDATE style_profiles
SET auto_pool = true
WHERE user_id IN ('global', 'auto')
  AND auto_pool IS NULL;
