alter table public.app_config add column if not exists custom_tool_creation_visible boolean not null default true;
comment on column public.app_config.custom_tool_creation_visible is 'Show Create your own tool button on the home product studio. Defaults visible; existing tools remain accessible.';
