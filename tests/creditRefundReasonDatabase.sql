begin;
do $$
declare u uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); c jsonb;
begin
insert into public.users(id,credit_balance) values(u,100);
update public.app_config set refund_enabled=true;
insert into public.reference_results(id,user_id,generation_id,credits_deducted,result_image_url,reference_images,created_at)
values(g,u,gen_random_uuid(),20,'https://example.com/result.jpg','["https://example.com/product.jpg"]',now());
c:=public.claim_credit_refund(u,g,'','general','tr',null);
if c->'request'->>'status' <> 'analyzing' then raise exception 'empty reason rejected'; end if;
if c->'request'->>'reason' is not null then raise exception 'invented customer reason'; end if;
if c->'request'->>'reason_category' <> 'general' then raise exception 'not a general review'; end if;
end $$;
rollback;
select 'Initial claim without reason passed; fixtures rolled back' as verification;
