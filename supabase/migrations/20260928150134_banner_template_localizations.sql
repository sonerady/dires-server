create table if not exists public.banner_template_localizations (
  language text not null,
  template_id text not null,
  source_hash text not null,
  name text not null,
  translations jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (language, template_id)
);

alter table public.banner_template_localizations enable row level security;
revoke all on public.banner_template_localizations from anon, authenticated;
grant select, insert, update, delete on public.banner_template_localizations to service_role;
