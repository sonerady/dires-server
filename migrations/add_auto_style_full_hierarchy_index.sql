-- Otomatik stil seçiminin tam hiyerarşisini hızlandırır:
-- product_category → product_subtype → style_approach.
--
-- Örnek: jewelry / earring / 3 isteği yalnız aynı ürün ve çekim tarzındaki
-- profillerden seçilir. created_at son kolonda olduğu için rastgele pencere
-- sorgusundaki deterministik sıralama da aynı indeks üzerinden çalışabilir.

CREATE INDEX IF NOT EXISTS idx_style_profiles_auto_full_hierarchy
  ON style_profiles (
    user_id,
    product_category,
    product_subtype,
    style_approach,
    created_at
  )
  WHERE product_category IS NOT NULL;
