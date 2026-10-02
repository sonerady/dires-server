create table public.banner_template_favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  template_id text not null check (length(template_id) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (user_id, template_id)
);
create index banner_template_favorites_recent_idx
  on public.banner_template_favorites (user_id, created_at desc, template_id);
alter table public.banner_template_favorites enable row level security;
-- Native accounts are verified by the API; clients never access this table directly.
revoke all on public.banner_template_favorites from public, anon, authenticated;
grant select, insert, update, delete on public.banner_template_favorites to service_role;
