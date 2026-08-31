-- 🚻 Çekim tarzı kart görsellerine CİNSİYET boyutu (24 Ağu 2026, kullanıcı isteği)
--
-- Uygulamada fotoğraf yüklenip analiz edilince ürünün kadın giyimi mi erkek
-- giyimi mi olduğu da tespit ediliyor (productTypeRoutes.js → productGender).
-- Kartlarda gösterilecek örnek görsel artık o cinsiyete göre değişir: admin
-- panelinde her (ürün tipi × alt tür × CİNSİYET × çekim tarzı) için ayrı görsel
-- seçilebilir.
--
-- gender NULL = cinsiyetten bağımsız (genel) seçim. Sunucu en özelden genele
-- doğru okur: (alt tür + cinsiyet) → (cinsiyet) → (alt tür) → (genel).
-- Hiçbiri yoksa havuzdan kare gösterilir; kart asla boş kalmaz.
--
-- ⚠️ Bu migration çalıştırılmadan da uygulama çalışır: gender kolonu yoksa
-- sorgu hata verir ve sunucu sessizce havuz görseline düşer.

ALTER TABLE style_approach_cards
  ADD COLUMN IF NOT EXISTS gender text;

COMMENT ON COLUMN style_approach_cards.gender IS
  'woman | man | NULL (cinsiyetten bağımsız). Salt vitrin etiketi — üretim promptuna girmez.';

-- Sokak Stili (4) kod tarafında 17 Ağu''dan beri kullanılıyor ama ilk tabloda
-- CHECK 1..3'te kalmıştı; 4. slot kaydedilemiyordu.
ALTER TABLE style_approach_cards
  DROP CONSTRAINT IF EXISTS style_approach_cards_style_approach_check;
ALTER TABLE style_approach_cards
  ADD CONSTRAINT style_approach_cards_style_approach_check
  CHECK (style_approach BETWEEN 1 AND 4);

-- Tekillik artık cinsiyeti de kapsıyor: aynı slotun kadın ve erkek görseli
-- YAN YANA durabilmeli. Eski indeks bunu engelliyordu.
DROP INDEX IF EXISTS style_approach_cards_slot_idx;
CREATE UNIQUE INDEX IF NOT EXISTS style_approach_cards_slot_idx
  ON style_approach_cards (
    product_category,
    coalesce(product_subtype, ''),
    coalesce(gender, ''),
    style_approach
  );

CREATE INDEX IF NOT EXISTS style_approach_cards_gender_idx
  ON style_approach_cards (product_category, gender, style_approach);
