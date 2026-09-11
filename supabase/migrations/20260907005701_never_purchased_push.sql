-- New-install acquisition only. No legacy audience is enrolled or reactivated.
create table public.acquisition_push_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  cohort_started_at timestamptz not null default now(),
  local_hour integer not null default 20 check (local_hour between 9 and 21)
);
insert into public.acquisition_push_settings(id) values(true);
create table public.acquisition_push_exclusions (
  user_id text primary key,
  reason text not null,
  excluded_at timestamptz not null default now()
);
create table public.acquisition_push_identities (
  kind text not null,
  value text not null,
  primary key(kind,value)
);
create table public.acquisition_push_enrollments (
  user_id uuid primary key references public.users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  onboarding_completed_at timestamptz,
  subscription_id uuid unique,
  platform text check (platform in ('ios','android')),
  language text,
  timezone text,
  subscribed boolean not null default false,
  client_purchase_seen boolean not null default false,
  last_seen_at timestamptz not null default now(),
  app_version text
);
create table public.acquisition_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  campaign_id text not null,
  status text not null default 'claimed' check (status in ('claimed','sent','skipped','failed')),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_id uuid,
  reason text,
  unique(user_id,local_date)
);
create index acquisition_push_deliveries_recent on public.acquisition_push_deliveries(user_id,claimed_at desc);
create index if not exists acquisition_users_device on public.users(device_id) where device_id is not null;
create index if not exists acquisition_users_email on public.users(lower(email)) where email is not null;
create index if not exists acquisition_users_merge on public.users(merged_into_user_id) where merged_into_user_id is not null;
create index if not exists acquisition_history_user on public.purchase_history(user_id);
create index if not exists acquisition_legacy_purchase_user on public.user_purchase(user_id);

-- A cancellation, refund, expired trial, sandbox purchase, transfer or even a
-- partial purchase record is evidence of history. Never interpret it as free.
insert into public.acquisition_push_exclusions(user_id,reason)
select user_id,'purchase_history' from public.purchase_history where user_id is not null
union select user_id::text,'purchase_history' from public.user_purchase where user_id is not null
on conflict do nothing;
insert into public.acquisition_push_exclusions(user_id,reason)
select id::text,'account_history' from public.users where is_pro is true or is_in_trial is true
 or has_used_trial is true or trial_started_at is not null or subscription_type is not null
 or team_subscription_active is true or active_team_id is not null or owner is true
on conflict do nothing;

create schema if not exists push_private;
revoke all on schema push_private from public, anon, authenticated;
create function push_private.remember_identity(p_user_id text) returns void
language sql security definer set search_path = '' as $$
  insert into public.acquisition_push_identities(kind,value)
  select x.kind,x.value from public.users u
  cross join lateral (values ('device',nullif(u.device_id,'')),('email',nullif(lower(u.email),'')),
    ('auth',u.supabase_user_id::text)) x(kind,value)
  where u.id=case when p_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid else null end and x.value is not null on conflict do nothing;
$$;
do $$ declare r record; begin
 for r in select user_id from public.acquisition_push_exclusions loop perform push_private.remember_identity(r.user_id); end loop;
end $$;
create function push_private.record_exclusion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid text;
begin
  if TG_TABLE_NAME = 'users' then
    uid := NEW.id::text;
    if NEW.is_pro is true or NEW.is_in_trial is true or NEW.has_used_trial is true
      or NEW.trial_started_at is not null or NEW.subscription_type is not null
      or NEW.team_subscription_active is true or NEW.active_team_id is not null or NEW.owner is true then
      insert into public.acquisition_push_exclusions(user_id,reason) values(uid,'account_history') on conflict do nothing;
    end if;
  else
    uid := NEW.user_id::text;
    if uid is not null then
      insert into public.acquisition_push_exclusions(user_id,reason) values(uid,TG_TABLE_NAME) on conflict do nothing;
    end if;
  end if;
  if exists(select 1 from public.acquisition_push_exclusions where user_id=uid) then
    perform push_private.remember_identity(uid);
  end if;
  return NEW;
end $$;
create trigger acquisition_purchase_history after insert or update on public.purchase_history for each row execute function push_private.record_exclusion();
create trigger acquisition_legacy_purchase after insert or update on public.user_purchase for each row execute function push_private.record_exclusion();
create trigger acquisition_account_history after insert or update on public.users for each row execute function push_private.record_exclusion();

-- Fail closed, including merged accounts, other accounts on the same device,
-- and identity tombstones left by deleted paying accounts.
create function public.acquisition_push_eligible(p_user_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
with recursive family as (
 select u.* from public.users u where u.id=p_user_id
 union
 select u.* from public.users u join family f on u.id=f.merged_into_user_id or u.merged_into_user_id=f.id
), related as (
 select * from family
 union
 select u.* from public.users u join family f on
   (nullif(u.device_id,'')=nullif(f.device_id,'')) or
   (nullif(lower(u.email),'')=nullif(lower(f.email),'')) or
   (u.supabase_user_id=f.supabase_user_id)
)
select exists(select 1 from public.users u cross join public.acquisition_push_settings s
 where u.id=p_user_id and u.created_at >= s.cohort_started_at
 and u.merged_into_user_id is null and u.active is distinct from false)
and not exists(
 select 1 from related u where u.is_pro is true or u.is_in_trial is true or u.has_used_trial is true
 or u.trial_started_at is not null or u.subscription_type is not null or u.owner is true
 or u.team_subscription_active is true or u.active_team_id is not null
 or exists(select 1 from public.acquisition_push_exclusions e where e.user_id=u.id::text)
 or exists(select 1 from public.purchase_history p where p.user_id=u.id::text)
 or exists(select 1 from public.user_purchase p where p.user_id=u.id)
 or exists(select 1 from public.team_members m where m.user_id=u.id)
 or exists(select 1 from public.acquisition_push_enrollments e where e.user_id=u.id and e.client_purchase_seen)
 or exists(select 1 from public.acquisition_push_identities i where
    (i.kind='device' and i.value=nullif(u.device_id,'')) or
    (i.kind='email' and i.value=nullif(lower(u.email),'')) or
    (i.kind='auth' and i.value=u.supabase_user_id::text))
);
$$;
revoke all on function public.acquisition_push_eligible(uuid) from public, anon, authenticated;
grant execute on function public.acquisition_push_eligible(uuid) to service_role;
revoke all on all functions in schema push_private from public, anon, authenticated;
alter table public.acquisition_push_settings enable row level security;
alter table public.acquisition_push_exclusions enable row level security;
alter table public.acquisition_push_identities enable row level security;
alter table public.acquisition_push_enrollments enable row level security;
alter table public.acquisition_push_deliveries enable row level security;
revoke all on public.acquisition_push_settings,public.acquisition_push_exclusions,public.acquisition_push_identities,public.acquisition_push_enrollments,public.acquisition_push_deliveries from anon,authenticated;
grant all on public.acquisition_push_settings,public.acquisition_push_exclusions,public.acquisition_push_identities,public.acquisition_push_enrollments,public.acquisition_push_deliveries to service_role;
