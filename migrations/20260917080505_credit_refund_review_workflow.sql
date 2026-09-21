alter table public.reference_results add column if not exists credit_owner_id uuid references public.users(id);
alter table public.credit_refund_requests
 add column if not exists result_id uuid references public.reference_results(id),
 add column if not exists credit_owner_id uuid references public.users(id),
 add column if not exists reason text,
 add column if not exists reason_category text,
 add column if not exists appeal_text text,
 add column if not exists appealed_at timestamptz,
 add column if not exists reviewed_at timestamptz,
 add column if not exists reviewed_by text,
 add column if not exists admin_note text,
 add column if not exists notification_status text,
 add column if not exists notification_error text,
 add column if not exists notification_id text;
alter table public.credit_refund_requests drop constraint if exists credit_refund_requests_status_check;
alter table public.credit_refund_requests add constraint credit_refund_requests_status_check check(status in ('analyzing','refunded','rejected','error','review_pending','appeal_pending','appeal_rejected'));
create index if not exists credit_refund_review_queue on public.credit_refund_requests(status, created_at desc);
alter table public.credit_refund_requests enable row level security;
revoke all on public.credit_refund_requests from anon, authenticated;
grant all on public.credit_refund_requests to service_role;

-- Claims and daily-limit checks serialize per account. Historical aliases also block new requests.
create or replace function public.claim_credit_refund(p_user uuid, p_result uuid, p_reason text, p_category text, p_language text, p_owner uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.reference_results%rowtype; r public.credit_refund_requests%rowtype; lim int; age_days int; enabled boolean;
begin
 perform 1 from public.users where id=p_user for update;
 if not found then raise exception 'user_not_found'; end if;
 select * into g from public.reference_results where id=p_result and user_id=p_user;
 if not found then raise exception 'not_found'; end if;
 select * into r from public.credit_refund_requests where user_id=p_user and
  (result_id=g.id or generation_id=g.id::text or generation_id=g.generation_id::text) order by created_at limit 1 for update;
 if found then return jsonb_build_object('existing',to_jsonb(r)); end if;
 select refund_daily_limit,refund_max_age_days,refund_enabled into lim,age_days,enabled from public.app_config limit 1;
 if enabled is false then raise exception 'disabled'; end if;
 if g.created_at < now()-make_interval(days=>coalesce(age_days,14)) then raise exception 'too_old'; end if;
 if coalesce(g.credits_deducted,0)<=0 or g.result_image_url is null then raise exception 'no_charge'; end if;
 if length(trim(p_reason)) not between 20 and 1500 then raise exception 'invalid_reason'; end if;
 if (select count(*) from public.credit_refund_requests where user_id=p_user and created_at>now()-interval '24 hours') >= coalesce(lim,3) then raise exception 'daily_limit'; end if;
 insert into public.credit_refund_requests(user_id,generation_id,result_id,credit_owner_id,result_image_url,product_image_urls,credits_deducted,reason,reason_category,language_code,status)
 values(p_user,coalesce(g.generation_id::text,g.id::text),g.id,coalesce(g.credit_owner_id,p_owner),coalesce(g.pre_upscale_image_url,g.result_image_url),coalesce(g.reference_images,'[]'::jsonb),g.credits_deducted,p_reason,p_category,p_language,'analyzing') returning * into r;
 return jsonb_build_object('request',to_jsonb(r));
end $$;

-- Credit mutation and terminal decision commit together. Retrying can never add a second refund.
create or replace function public.settle_credit_refund(p_id uuid,p_status text,p_analysis jsonb default '{}'::jsonb,p_admin text default null,p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.credit_refund_requests%rowtype; balance int;
begin
 select * into r from public.credit_refund_requests where id=p_id for update;
 if not found then raise exception 'not_found'; end if;
 if r.status='refunded' then return jsonb_build_object('request',to_jsonb(r),'alreadySettled',true); end if;
 if p_admin is null then
  if r.status<>'analyzing' then return jsonb_build_object('request',to_jsonb(r),'alreadySettled',true); end if;
  if p_status not in ('refunded','rejected','review_pending') then raise exception 'invalid_status'; end if;
 else
  if r.status not in ('review_pending','appeal_pending','error') then raise exception 'not_pending'; end if;
  if p_status not in ('refunded','appeal_rejected') or length(trim(coalesce(p_note,'')))<5 then raise exception 'invalid_decision'; end if;
 end if;
 if p_status='refunded' then
  if r.credit_owner_id is null or r.credits_deducted<=0 then raise exception 'credit_owner_unverified'; end if;
  update public.users set credit_balance=coalesce(credit_balance,0)+r.credits_deducted where id=r.credit_owner_id returning credit_balance into balance;
  if not found then raise exception 'credit_owner_missing'; end if;
 end if;
 update public.credit_refund_requests set status=p_status,
  refunded_credits=case when p_status='refunded' then credits_deducted else 0 end,
  refund_percent=case when p_status='refunded' then 100 else 0 end,
  verdict=case when p_status='refunded' then 'refund_full' else coalesce(p_analysis->>'verdict',verdict) end,
  product_match=coalesce((p_analysis->>'productMatch')::int,product_match),render_quality=coalesce((p_analysis->>'renderQuality')::int,render_quality),
  confidence=coalesce((p_analysis->>'confidence')::numeric,confidence),defects=coalesce(p_analysis->'defects',defects),
  summary=coalesce(p_analysis->>'summary',summary),model=coalesce(p_analysis->>'model',model),
  raw_response=case when p_admin is null then p_analysis else raw_response end,
  admin_note=coalesce(p_note,admin_note),reviewed_by=coalesce(p_admin,reviewed_by),
  reviewed_at=case when p_admin is not null then now() else reviewed_at end,
  notification_status=case when p_admin is not null and p_status='refunded' then 'pending' else notification_status end,updated_at=now()
 where id=p_id returning * into r;
 return jsonb_build_object('request',to_jsonb(r),'newBalance',balance);
end $$;
revoke all on function public.claim_credit_refund(uuid,uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.settle_credit_refund(uuid,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.claim_credit_refund(uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.settle_credit_refund(uuid,text,jsonb,text,text) to service_role;
