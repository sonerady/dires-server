-- Only an authenticated admin may confirm an unrecorded legacy charge owner during atomic approval.
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
  if r.credit_owner_id is null and p_admin is not null and nullif(p_analysis->>'verifiedOwner','') is not null then
   r.credit_owner_id := (p_analysis->>'verifiedOwner')::uuid;
  end if;
  if r.credit_owner_id is null or r.credits_deducted<=0 then raise exception 'credit_owner_unverified'; end if;
  update public.users set credit_balance=coalesce(credit_balance,0)+r.credits_deducted where id=r.credit_owner_id returning credit_balance into balance;
  if not found then raise exception 'credit_owner_missing'; end if;
 end if;
 update public.credit_refund_requests set status=p_status,credit_owner_id=r.credit_owner_id,
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
