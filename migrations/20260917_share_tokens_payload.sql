-- 🔗 Grup paylaşımı (17 Eyl 2026): listing seti / varyant grubu / kit destesi
-- tek bir linkte paylaşılır. Bu görseller tek bir tabloya ait olmadığı için
-- (kimi satır, kimi JSON kolonunun içinde) token'ın kendisi listeyi taşır.
alter table public.public_share_tokens
  add column if not exists payload jsonb;

-- scope CHECK'ine grup paylaşımı eklenir
alter table public.public_share_tokens
  drop constraint if exists public_share_tokens_scope_check;

alter table public.public_share_tokens
  add constraint public_share_tokens_scope_check
  check (scope in ('all_history', 'albums', 'album', 'single_item', 'image_group'));
