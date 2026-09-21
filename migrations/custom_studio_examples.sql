alter table public.custom_studio_tools add column if not exists reference_urls jsonb not null default '[]';
alter table public.custom_studio_tools add column if not exists example_plan jsonb;
alter table public.custom_studio_tools add column if not exists accepted_examples jsonb not null default '[]';
alter table public.custom_studio_tools add column if not exists intro_examples jsonb not null default '[]';
alter table public.custom_studio_tools add column if not exists attempts integer not null default 0;
