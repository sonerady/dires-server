-- Persist LLM-generated phone-language names before creating portraits.
ALTER TABLE public.model_starter_jobs ADD COLUMN IF NOT EXISTS display_name text;
COMMENT ON COLUMN public.model_starter_jobs.display_name IS 'Localized contemporary model name generated for the first claimed batch and retained across retries.';
