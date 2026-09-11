-- Keep legacy enrollment/FKs; eligibility and creation history are now per gender.
alter table public.model_starter_enrollments
  add column eligible_woman boolean,
  add column eligible_man boolean;

insert into public.model_starter_enrollments(user_id, eligible)
select distinct m.user_id, false from public.user_models m
join public.users u on u.id = m.user_id
where m.gender in ('woman', 'man')
on conflict (user_id) do nothing;

update public.model_starter_enrollments e set
  eligible_woman = case
    when exists(select 1 from public.model_starter_jobs j where j.user_id=e.user_id and j.gender='woman') then true
    when exists(select 1 from public.user_models m where m.user_id=e.user_id and m.gender='woman') then false
    else null end,
  eligible_man = case
    when exists(select 1 from public.model_starter_jobs j where j.user_id=e.user_id and j.gender='man') then true
    when exists(select 1 from public.user_models m where m.user_id=e.user_id and m.gender='man') then false
    else null end;
update public.model_starter_enrollments set eligible = coalesce(eligible_woman,true) or coalesce(eligible_man,true);

create or replace function public.ensure_starter_models(p_user_id uuid, p_gender text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_eligible boolean;
begin
  if p_gender not in ('woman','man') or p_gender is null then raise exception 'Invalid gender'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,9021));
  insert into public.model_starter_enrollments(user_id,eligible) values(p_user_id,true)
    on conflict(user_id) do nothing;
  select case when p_gender='woman' then eligible_woman else eligible_man end
    into v_eligible from public.model_starter_enrollments where user_id=p_user_id;
  if v_eligible is null then
    v_eligible := not exists(select 1 from public.user_models where user_id=p_user_id and gender=p_gender);
    update public.model_starter_enrollments set
      eligible_woman = case when p_gender='woman' then v_eligible else eligible_woman end,
      eligible_man = case when p_gender='man' then v_eligible else eligible_man end
    where user_id=p_user_id;
  end if;
  update public.model_starter_enrollments set eligible=coalesce(eligible_woman,true) or coalesce(eligible_man,true)
    where user_id=p_user_id;
  if v_eligible then
    insert into public.model_starter_jobs(user_id,gender,slot)
      select p_user_id,p_gender,n from generate_series(0,2) as n
      on conflict(user_id,gender,slot) do nothing;
  end if;
  return v_eligible;
end;
$$;
revoke all on function public.ensure_starter_models(uuid,text) from public,anon,authenticated;
grant execute on function public.ensure_starter_models(uuid,text) to service_role;

-- Called after manual saves and before deletion; never starts generation.
create function public.record_model_gender_history(p_user_id uuid,p_gender text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_gender not in ('woman','man') or p_gender is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,9021));
  insert into public.model_starter_enrollments(user_id,eligible) values(p_user_id,true)
    on conflict(user_id) do nothing;
  update public.model_starter_enrollments set
    eligible_woman = case when p_gender='woman' then coalesce(eligible_woman,false) else eligible_woman end,
    eligible_man = case when p_gender='man' then coalesce(eligible_man,false) else eligible_man end
    where user_id=p_user_id;
  update public.model_starter_enrollments set eligible=coalesce(eligible_woman,true) or coalesce(eligible_man,true)
    where user_id=p_user_id;
end;
$$;
revoke all on function public.record_model_gender_history(uuid,text) from public,anon,authenticated;
grant execute on function public.record_model_gender_history(uuid,text) to service_role;
