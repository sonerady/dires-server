-- 🏬 Beyaz Stüdyo koleksiyonları (26 Ağu 2026, kullanıcı isteği)
--
-- Giyimde 4. çekim tarzı: Beyaz Stüdyo (style_approach = 5). Eklenti bu tarza
-- stil eklerken bir de KOLEKSİYON etiketi verir ("zara", "cos" gibi) — kart
-- modalında stiller bu etikete göre gruplanır, kullanıcı birini seçer ve
-- üretim o profili styleProfileId olarak kullanır (mevcut referans hattı).
--
-- Kolon genel: ileride başka tarzlarda da koleksiyon gruplaması gerekirse
-- aynı alan kullanılır; şimdilik yalnız approach 5 kayıtlarında dolduruluyor.

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS collection text;

CREATE INDEX IF NOT EXISTS idx_style_profiles_collection
  ON style_profiles (product_category, style_approach, collection)
  WHERE collection IS NOT NULL;
