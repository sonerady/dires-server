-- 🗂️ Banner şablon metadata'sı (27 Ağu 2026, kullanıcı isteği)
--
-- Her üretilen banner, LLM tarafından arka planda etiketlenir ve "hazır
-- şablon" olarak sunulabilir hale gelir:
--   template_category : sabit sözlükten kategori (flash-sale, new-collection…)
--   template_title    : banner'ın konusunu anlatan kısa başlık (İngilizce)
--   template_prompt   : tasarımın yeniden üretilebilir tarifi (yerleşim,
--                       tipografi, renk/mood) — şablondan üretimde nb2/edit
--                       prompt'una ek yönerge olarak gider
--   template_meta_at  : etiketleme zamanı (null = henüz etiketlenmedi)
--   is_template       : şablon havuzunda görünsün mü (küratörlük şalteri)

ALTER TABLE banner_studio_results
  ADD COLUMN IF NOT EXISTS template_category TEXT,
  ADD COLUMN IF NOT EXISTS template_title TEXT,
  ADD COLUMN IF NOT EXISTS template_prompt TEXT,
  ADD COLUMN IF NOT EXISTS template_meta_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT true;

-- Şablon listesi: etiketli + önizlemeli + şalteri açık kayıtlar, en yeni önce
CREATE INDEX IF NOT EXISTS idx_banner_results_template
  ON banner_studio_results (template_meta_at DESC)
  WHERE is_template = true AND template_category IS NOT NULL;
