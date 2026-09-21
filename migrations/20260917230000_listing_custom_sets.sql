-- 🎨 Listing Stüdyosu — kullanıcının kendi tanımladığı görsel setleri.
-- label: hapta görünen kısa ad. brief: setin ne olacağını anlatan serbest
-- metin (prompt yönergesine birebir girer). reference_image_url: isteğe bağlı
-- örnek/referans görsel. Silme yumuşak (archived_at) — geçmiş üretimlerdeki
-- custom:<id> tipleri anlamını kaybetmesin.
create table if not exists public.listing_custom_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  brief text not null check (length(btrim(brief)) between 10 and 1500),
  reference_image_url text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listing_custom_sets_user_idx
  on public.listing_custom_sets (user_id, archived_at, created_at desc);
alter table public.listing_custom_sets enable row level security;
drop policy if exists listing_custom_sets_owner on public.listing_custom_sets;
create policy listing_custom_sets_owner on public.listing_custom_sets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.listing_custom_sets to service_role;
