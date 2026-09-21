-- API-only: native anonymous device accounts use the same verified identity as refunds.
create table if not exists public.custom_studio_tools (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 request_key uuid not null,
 description text not null check (char_length(description) between 15 and 1500),
 language text not null default 'en',
 title text,
 brief text,
 source_url text,
 before_url text,
 after_url text,
 status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id,request_key)
);
create index if not exists custom_studio_tools_owner on public.custom_studio_tools(user_id,created_at desc);
create unique index if not exists custom_studio_tools_one_active on public.custom_studio_tools(user_id) where status in ('queued','processing');
alter table public.custom_studio_tools enable row level security;
revoke all on public.custom_studio_tools from anon, authenticated;
grant all on public.custom_studio_tools to service_role;
