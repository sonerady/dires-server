ALTER TABLE public.public_share_tokens
DROP CONSTRAINT IF EXISTS public_share_tokens_scope_check;

ALTER TABLE public.public_share_tokens
ADD CONSTRAINT public_share_tokens_scope_check
CHECK (scope IN ('all_history', 'albums', 'album', 'single_item'));
