-- Food styles are deliberately isolated from fashion and packshot styles.
CREATE TABLE IF NOT EXISTS public.food_style_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
 name text NOT NULL, subtitle text, image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
 style_prompt text, status text NOT NULL DEFAULT 'analyzing',
 translations_status text NOT NULL DEFAULT 'pending', tags jsonb, category_slug text,
 stamped_grid_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS food_style_profiles_owner_created ON public.food_style_profiles(user_id,created_at DESC);
ALTER TABLE public.food_style_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_style_profiles FROM anon, authenticated;
GRANT ALL ON public.food_style_profiles TO service_role;
COMMENT ON TABLE public.food_style_profiles IS 'Food photography references: lighting, surface and color only, never food/ingredients to copy. Access through verified Express identity.';
