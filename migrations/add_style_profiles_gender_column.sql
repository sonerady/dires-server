-- 🚻 Stil profili GENDER ETİKETİ — yalnızca tablo bilgisi
--
-- Kullanıcı kuralı (19 Ağu 2026): gender bir SINIFLANDIRMA ETİKETİDİR, stil
-- analizine/promptuna ASLA girmez. Stil promptlarındaki cinsiyetsizlik kuralı
-- (styleProfileRoutes.js "no gender/age" kuralları) aynen geçerli kalır —
-- bu kolon yalnızca havuz kayıtlarını raporlamak/süzmek için tutulur.
--
-- Doldurma kaynağı: auto-style-clipper eklentisi. Eklenti gender'ı YALNIZCA
-- giyim + Sokak Stili (product_category='clothing' AND style_approach=4)
-- kayıtlarında gönderir; sunucu da aynı koşulu ayrıca zorlar. Diğer tüm
-- kayıtlarda NULL kalır.
--
-- Değerler: 'woman' | 'man' (uygulamadaki üretim sözlüğüyle aynı,
-- bkz. pose_change_generations.gender).

ALTER TABLE style_profiles
  ADD COLUMN IF NOT EXISTS gender text;

COMMENT ON COLUMN style_profiles.gender IS
  'Salt tablo etiketi: woman | man | NULL. Prompta/analize girmez. Yalnız giyim + Sokak Stili (style_approach=4) klip kayıtlarında dolar.';
