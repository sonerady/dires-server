-- Virtual Model üretiminin girişte hangi moddan başlatıldığını saklar.
-- NULL: bu alan eklenmeden önceki kayıt veya ön kapıyı kullanmayan legacy akış.
-- crystal/canvas: CreateModelStartModal içindeki kesin kullanıcı seçimi.

ALTER TABLE public.reference_results
  ADD COLUMN IF NOT EXISTS creation_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reference_results_creation_mode_check'
      AND conrelid = 'public.reference_results'::regclass
  ) THEN
    ALTER TABLE public.reference_results
      ADD CONSTRAINT reference_results_creation_mode_check
      CHECK (creation_mode IS NULL OR creation_mode IN ('crystal', 'canvas'));
  END IF;
END $$;

COMMENT ON COLUMN public.reference_results.creation_mode IS
  'CreateModelPhotoScreen giriş modu: crystal veya canvas. NULL eski/legacy akış demektir.';
