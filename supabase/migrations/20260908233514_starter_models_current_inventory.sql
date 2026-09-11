-- Eligibility follows the CURRENT inventory for the detected gender.
-- Keep stable slots and active/failed attempts to prevent duplicate provider calls.
create or replace function public.ensure_starter_models(p_user_id uuid, p_gender text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_eligible boolean;
begin
  if p_gender not in ('woman','man') or p_gender is null then raise exception 'Invalid gender'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,9021));
  insert into public.model_starter_enrollments(user_id,eligible) values(p_user_id,true)
    on conflict(user_id) do nothing;
  v_eligible := not exists(select 1 from public.user_models where user_id=p_user_id and gender=p_gender);
  update public.model_starter_enrollments set
    eligible_woman = case when p_gender='woman' then v_eligible else eligible_woman end,
    eligible_man = case when p_gender='man' then v_eligible else eligible_man end
    where user_id=p_user_id;
  update public.model_starter_enrollments set eligible=coalesce(eligible_woman,true) or coalesce(eligible_man,true)
    where user_id=p_user_id;
  if v_eligible then
    -- Deleted completed portraits can be recreated; failed requests retain their
    -- explicit retry policy, and in-flight requests are never reset.
    update public.model_starter_jobs set status='queued',attempts=0,model_id=null,display_name=null,updated_at=now()
      where user_id=p_user_id and gender=p_gender and status='completed' and model_id is null;
    insert into public.model_starter_jobs(user_id,gender,slot)
      select p_user_id,p_gender,n from generate_series(0,2) as n
      on conflict(user_id,gender,slot) do nothing;
  end if;
  return v_eligible;
end;
$$;
revoke all on function public.ensure_starter_models(uuid,text) from public,anon,authenticated;
grant execute on function public.ensure_starter_models(uuid,text) to service_role;
