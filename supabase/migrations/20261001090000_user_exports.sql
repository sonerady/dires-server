-- 📤 Kullanıcı çıktıları (1 Eki 2026): cihazda üretilen Kolaj / PDF Katalog / Film Lab çıktıları (ve ileride
-- banner) başarılı kaydet/indir sonrasında uygulama tarafından bildirilir; admin panelindeki "Kullanıcı Çıktıları"
-- sayfası bunu okur. Yalnız API (service_role) yazar/okur: POST /api/exports/record, GET /api/admin-dashboard/user-exports*.
-- Salt ekleme: yeni tablo, mevcut hiçbir tabloya dokunmaz. Banner galerisi indirmeleri ayrıca banner_gallery_downloads'ta.
create table if not exists public.user_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tool text not null check (tool in ('catalog_pdf', 'collage', 'film_lab', 'banner')),
  file_url text check (file_url is null or (length(file_url) <= 600 and file_url like 'https://%')),
  thumb_url text check (thumb_url is null or (length(thumb_url) <= 600 and thumb_url like 'https://%')),
  -- şablon / film / sayfa sayısı / ürün sayısı / biçim / uygulama sürümü / platform (API doğrular, küçük düz nesne)
  meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) < 4096),
  created_at timestamptz not null default now()
);

create index if not exists user_exports_tool_created_idx
  on public.user_exports (tool, created_at desc);
create index if not exists user_exports_user_idx
  on public.user_exports (user_id, created_at desc);
-- "Tümü" sekmesi ve günlük sayımlar araç süzgeci olmadan tarih aralığı tarar
create index if not exists user_exports_created_idx
  on public.user_exports (created_at desc);

alter table public.user_exports enable row level security;
-- İstemciler tabloya doğrudan erişmez; kimlik API'de doğrulanır.
revoke all on public.user_exports from public, anon, authenticated;
grant select, insert, update, delete on public.user_exports to service_role;

comment on table public.user_exports is
  'Exports users saved from on-device tools (catalog_pdf, collage, film_lab, banner). Written only via /api/exports/record; read by the admin "Kullanıcı Çıktıları" page. Files live in storage images/userExports/<tool>/.';
