-- Prompt enhance sağlayıcısı seçimi (referenceBrowserRoutesV7 prompt enhance)
--   'gemini'    → Google'ın kendi Gemini API'si (yeni @google/genai SDK, GEMINI_API_KEY)
--   'replicate' → Replicate üzerinden google/gemini-3-flash (eski davranış)
-- Default: 'gemini'
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS prompt_enhance_provider text NOT NULL DEFAULT 'gemini';

-- Mevcut satırlar için default'u garanti et (NULL kalmışsa)
UPDATE app_config
  SET prompt_enhance_provider = 'gemini'
  WHERE prompt_enhance_provider IS NULL;
