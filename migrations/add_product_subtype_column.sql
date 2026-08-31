-- 🏷️ Ürün ALT TÜRÜ (13 Ağu 2026, kullanıcı isteği)
--
-- `product_category` (shoes | jewelry | clothing) zaten vardı. Bu migration bir
-- kademe daha ekliyor: aynı kategori içinde ürünün türü.
--   jewelry → ring | necklace | earring | bracelet | watch | anklet
--   shoes   → heels | sneakers | boots | sandals | flats | loafers
--   clothing→ dress | top | bottom | outerwear | knitwear | swimwear |
--             lingerie | bag | accessory
--
-- Kullanım: kullanıcı yüzük fotoğrafı yüklediğinde otomatik stil havuzu ÖNCE
-- (jewelry + ring) stillerini dener; o havuz eşiğin altındaysa (jewelry), o da
-- yetmezse genel havuza düşer (autoGlobalStyle.js — CATEGORY_MIN_POOL).
--
-- Değer kaynağı iki yer:
--   1. Tarayıcı eklentisi (auto-style-clipper) — stil kliplenirken elle seçilir
--   2. /api/product-type/classify — kullanıcının ÜRÜN fotoğrafı için (eşleşmede
--      karşı taraf), OpenRouter gpt-5.6-luna ile
--
-- İdempotent: tekrar çalıştırmak güvenli.

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS product_subtype text;

-- Filtre her üretimde (kategori + alt tür) ile sayım yapıyor; bileşik indeks
-- hem sayımı hem pencere sorgusunu karşılar.
CREATE INDEX IF NOT EXISTS idx_style_profiles_category_subtype
  ON style_profiles (product_category, product_subtype)
  WHERE product_category IS NOT NULL;

-- Kontrol:
-- SELECT product_category, product_subtype, COUNT(*)
--   FROM style_profiles
--  WHERE user_id IN ('auto','global')
--  GROUP BY 1,2 ORDER BY 3 DESC;
