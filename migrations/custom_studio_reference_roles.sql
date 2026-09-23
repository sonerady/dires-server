alter table public.custom_studio_tools add column if not exists reference_roles jsonb not null default '[]';
