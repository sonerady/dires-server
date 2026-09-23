-- 23 Eyl 2026 (kullanıcı kararı):
--  • İade YALNIZ ürünü koruyan ana üretimlerde: kanıt satırı (credit_refund_charges)
--    yalnız giyim/takı V7, web, Ürün Stüdyosu, Arka Yüz ve Poz Değiştir rotaları
--    borçlanırken yazılır. Kanıtı olmayan satır (kit, çeşitlendirme, renk değiştirme,
--    AI düzenleme) reddedilir.
--  • Deneme (trial) kullanıcıları iade alamaz.
--  • Yaş penceresi en fazla 24 saat (app_config.refund_max_age_days daha büyük olsa bile).
-- Rota tarafı (creditRefundRoutes.eligibility) aynı kuralları önceden uygular; bu RPC
-- son savunma hattıdır.
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
 -- Deneme (trial) kullanıcısı iade alamaz.
 if exists (select 1 from public.users u where u.id=p_user and u.is_in_trial is true) then raise exception 'trial'; end if;
 -- Yalnız ana üretimler kanıt satırı yazar; kanıtsız = kit/çeşitlendirme/düzenleme türevi.
 if proof.user_id is null then raise exception 'not_main_generation'; end if;
 -- En geç 24 saat: config daha uzun verse de aşılamaz.
 if proof.created_at < now()-least(greatest(coalesce(age_days,1),1),1)*interval '1 day' then raise exception 'too_old'; end if;
 if coalesce(g.credits_deducted,0)<=0 or g.result_image_url is null then raise exception 'no_charge'; end if;
 if (select count(*) from public.credit_refund_requests where user_id=p_user and created_at>now()-interval '24 hours') >= coalesce(lim,3) then raise exception 'daily_limit'; end if;
 owner := coalesce(proof.credit_owner_id, g.credit_owner_id);
 if owner is null and not exists (select 1 from public.team_members tm where tm.user_id=p_user) then owner := p_user; end if;
 insert into public.credit_refund_requests(user_id,generation_id,result_id,credit_owner_id,result_image_url,product_image_urls,credits_deducted,reason,reason_category,language_code,status)
 values(p_user,coalesce(g.generation_id::text,g.id::text),g.id,owner,coalesce(proof.result_image_url,g.pre_upscale_image_url,g.result_image_url),coalesce(proof.product_image_urls,g.reference_images,'[]'::jsonb),coalesce(proof.credits,g.credits_deducted),null,'general',p_language,'analyzing') returning * into r;
 return jsonb_build_object('request',to_jsonb(r));
end $$;
