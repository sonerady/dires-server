-- Kullanıcı kararı (17 Eyl 2026): iade kararı ANINDA ve ikili verilir.
-- İnsan incelemesi yalnız kullanıcı redde İTİRAZ ederse devreye girer.
-- decideRefund artık review_pending üretmiyor; burada kalan tek engel
-- ödeyenin kim olduğunun bilinmemesiydi: credit_refund_charges yalnız bu
-- düzeltmeden SONRAKİ üretimler için doluyor, eski üretimlerde ise
-- reference_results.credit_owner_id de (83k satırda 2 kayıt) pratikte boş.
-- Kanıt yoksa ve kullanıcı HİÇBİR takımın üyesi değilse ödeyen tanımı gereği
-- kullanıcının kendisidir; takım üyesiyse başka bir hesabı tahmin etmek yerine
-- credit_owner_id null bırakılır ve akış admin incelemesine düşer.
create or replace function public.claim_credit_refund(p_user uuid, p_result uuid, p_reason text, p_category text, p_language text, p_owner uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare proof public.credit_refund_charges%rowtype; g public.reference_results%rowtype; r public.credit_refund_requests%rowtype; lim int; age_days int; enabled boolean; owner uuid;
begin
 perform 1 from public.users where id=p_user for update;
 if not found then raise exception 'user_not_found'; end if;
 select * into g from public.reference_results where id=p_result and user_id=p_user;
 if not found then raise exception 'not_found'; end if;
 select * into proof from public.credit_refund_charges where user_id=p_user and generation_id=coalesce(g.generation_id::text,g.id::text);
 select * into r from public.credit_refund_requests where user_id=p_user and
  (result_id=g.id or generation_id=g.id::text or generation_id=g.generation_id::text) order by created_at limit 1;
 if found then return jsonb_build_object('existing',to_jsonb(r)); end if;
 select refund_daily_limit,refund_max_age_days,refund_enabled into lim,age_days,enabled from public.app_config limit 1;
 if enabled is false then raise exception 'disabled'; end if;
 if coalesce(proof.created_at,g.created_at) < now()-(greatest(coalesce(age_days,1),1)||' days')::interval then raise exception 'too_old'; end if;
 if coalesce(g.credits_deducted,0)<=0 or g.result_image_url is null then raise exception 'no_charge'; end if;
 if (select count(*) from public.credit_refund_requests where user_id=p_user and created_at>now()-interval '24 hours') >= coalesce(lim,3) then raise exception 'daily_limit'; end if;
 owner := coalesce(proof.credit_owner_id, g.credit_owner_id);
 if owner is null and not exists (select 1 from public.team_members tm where tm.user_id=p_user) then owner := p_user; end if;
 insert into public.credit_refund_requests(user_id,generation_id,result_id,credit_owner_id,result_image_url,product_image_urls,credits_deducted,reason,reason_category,language_code,status)
 values(p_user,coalesce(g.generation_id::text,g.id::text),g.id,owner,coalesce(proof.result_image_url,g.pre_upscale_image_url,g.result_image_url),coalesce(proof.product_image_urls,g.reference_images,'[]'::jsonb),coalesce(proof.credits,g.credits_deducted),null,'general',p_language,'analyzing') returning * into r;
 return jsonb_build_object('request',to_jsonb(r));
end $$;
