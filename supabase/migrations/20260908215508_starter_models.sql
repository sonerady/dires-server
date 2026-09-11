-- Server-only enrollment remembers eligibility even after models are deleted.
create table public.model_starter_enrollments (
  user_id uuid primary key references public.users(id) on delete cascade,
  eligible boolean not null,
  created_at timestamptz not null default now()
);
create table public.model_starter_jobs (
  user_id uuid not null references public.model_starter_enrollments(user_id) on delete cascade,
  gender text not null check (gender in ('woman', 'man')),
  slot smallint not null check (slot between 0 and 2),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  model_id integer references public.user_models(id) on delete set null,
  attempts smallint not null default 0 check (attempts between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, gender, slot)
);
alter table public.model_starter_enrollments enable row level security;
alter table public.model_starter_jobs enable row level security;
revoke all on public.model_starter_enrollments, public.model_starter_jobs from public, anon, authenticated;
grant all on public.model_starter_enrollments, public.model_starter_jobs to service_role;

-- One transaction reserves the whole trio. Concurrent web/app requests cannot
-- enroll twice; pre-existing models of EITHER gender make the user ineligible.
create function public.ensure_starter_models(p_user_id uuid, p_gender text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_eligible boolean;
begin
  if p_gender not in ('woman', 'man') or p_gender is null then
    raise exception 'Invalid gender';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 9021));
  insert into public.model_starter_enrollments(user_id, eligible)
    values (p_user_id, not exists(select 1 from public.user_models where user_id = p_user_id))
    on conflict (user_id) do nothing;
  select eligible into v_eligible from public.model_starter_enrollments where user_id = p_user_id;
  if v_eligible then
    insert into public.model_starter_jobs(user_id, gender, slot)
      select p_user_id, p_gender, n from generate_series(0, 2) as n
      on conflict (user_id, gender, slot) do nothing;
  end if;
  return v_eligible;
end;
$$;
revoke all on function public.ensure_starter_models(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_starter_models(uuid, text) to service_role;
