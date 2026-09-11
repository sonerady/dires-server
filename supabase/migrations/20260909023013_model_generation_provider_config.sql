-- V1 provider switch. Dashboard/SQL administrators can edit; apps cannot.
create table public.app_model_generation_config (
  id text primary key default 'v1' check (id = 'v1'),
  provider text not null default 'gpt' check (provider in ('gpt', 'gemini'))
);
comment on table public.app_model_generation_config is 'V1 product generation provider. gpt = GPT 2.5 Sunburst + automatic 4 MP finishing; gemini = Nano Banana 2 without automatic finishing.';
alter table public.app_model_generation_config enable row level security;
revoke all on public.app_model_generation_config from public, anon, authenticated, service_role;
grant select on public.app_model_generation_config to service_role;
create policy model_generation_config_backend_read on public.app_model_generation_config
  for select to service_role using (true);
insert into public.app_model_generation_config (id, provider) values ('v1', 'gpt');
