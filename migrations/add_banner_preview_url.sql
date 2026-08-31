-- 🖼️ Banner önizleme JPG kolonu (25 Ağu 2026)
-- Results kartları görsel istiyor; banner HTML olduğu için üretim sonunda
-- puppeteer ile tek kare JPG'e çevrilip storage'a yazılıyor, URL'i burada.
-- Tablo add_banner_studio_results.sql'den ÖNCE kurulduysa bu ALTER yeterli;
-- taze kurulumda ana migration kolonu zaten içeriyor.
ALTER TABLE banner_studio_results
  ADD COLUMN IF NOT EXISTS preview_url TEXT;
