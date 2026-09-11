-- Client/store evidence must also survive account deletion or identity changes.
create trigger acquisition_exclusion_identity after insert on public.acquisition_push_exclusions
for each row execute function push_private.record_exclusion();

-- Serialize per-user claims across Railway replicas and timezone changes.
create function public.acquisition_push_claim(p_user_id uuid,p_local_date date,p_campaign_id text)
returns setof public.acquisition_push_deliveries
language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('acquisition:'||p_user_id::text,0));
 if exists(select 1 from public.acquisition_push_deliveries where user_id=p_user_id and local_date=p_local_date) then
   return query select * from public.acquisition_push_deliveries where user_id=p_user_id and local_date=p_local_date;
   return;
 end if;
 if exists(select 1 from public.acquisition_push_deliveries where user_id=p_user_id
   and claimed_at>now()-interval '23 hours' and status in ('claimed','failed','sent')) then return; end if;
 if not public.acquisition_push_eligible(p_user_id) then return; end if;
 return query insert into public.acquisition_push_deliveries(user_id,local_date,campaign_id)
 values(p_user_id,p_local_date,p_campaign_id) returning *;
end $$;
revoke all on function public.acquisition_push_claim(uuid,date,text) from public,anon,authenticated;
grant execute on function public.acquisition_push_claim(uuid,date,text) to service_role;
