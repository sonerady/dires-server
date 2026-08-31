-- 🎨 ÇEKİM TARZI — üçüncü kademe (13 Ağu 2026, kullanıcı isteği)
--
-- Hiyerarşi: product_category → product_subtype → style_approach
--   jewelry → ring → 1 | 2 | 3
--
-- ⚠️ Değerler SAYISAL ENUM (kullanıcı kararı 13 Ağu: "isim değil 1,2,3 olsun"):
--   1 — Editoryal   : yüzü görünen model, kampanya kurgusu, hikâye anlatan kadraj
--   2 — Sanatsal    : dramatik ışık, yaratıcı kompozisyon, sahne kurgusu
--   3 — E-ticaret   : temiz/katalog; ürün odaklı, yüzsüz kırpma veya ürün tekil
--
-- Kullanıcı arayüzde (CreateModelPhotoScreen, yükleme kartının altındaki 3 kart)
-- tarzı SEÇER; otomatik stil havuzu o kategoride yalnız o tarzdaki stillerden
-- seçer. Tarz seçilmezse kategori düzeyinde çalışır (mevcut davranış).
--
-- smallint: kapalı ve küçük bir küme; metin slug'a göre indekste ve
-- karşılaştırmada ucuz, yazım hatası riski yok.
-- İdempotent.

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS style_approach smallint;

ALTER TABLE style_profiles
  DROP CONSTRAINT IF EXISTS style_profiles_style_approach_check;
ALTER TABLE style_profiles
  ADD CONSTRAINT style_profiles_style_approach_check
  CHECK (style_approach IS NULL OR style_approach BETWEEN 1 AND 3);

CREATE INDEX IF NOT EXISTS idx_style_profiles_category_approach
  ON style_profiles (product_category, style_approach)
  WHERE product_category IS NOT NULL;

-- Kontrol:
-- SELECT product_category, style_approach, COUNT(*)
--   FROM style_profiles WHERE user_id IN ('auto','global')
--  GROUP BY 1,2 ORDER BY 3 DESC;
