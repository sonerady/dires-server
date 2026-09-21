-- Claims hold the user lock; read an existing request without locking it to avoid a lock-order cycle with settlement.
create or replace function public.claim_credit_refund(p_user uuid, p_result uuid, p_reason text, p_category text, p_language text, p_owner uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.reference_results%rowtype; r public.credit_refund_requests%rowtype; lim int; age_days int; enabled boolean;
begin
 perform 1 from public.users where id=p_user for update;
 if not found then raise exception 'user_not_found'; end if;
 select * into g from public.reference_results where id=p_result and user_id=p_user;
 if not found then raise exception 'not_found'; end if;
 select * into r from public.credit_refund_requests where user_id=p_user and
  (result_id=g.id or generation_id=g.id::text or generation_id=g.generation_id::text) order by created_at limit 1;
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
