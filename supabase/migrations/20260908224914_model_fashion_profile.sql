-- Casting metadata is separate from original_prompt / enhanced_prompt (passport portraits).
ALTER TABLE public.user_models
  ADD COLUMN IF NOT EXISTS model_profile jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(model_profile) = 'object');
COMMENT ON COLUMN public.user_models.model_profile IS 'Optional physical measurements and character used only for fashion photo generation.';
