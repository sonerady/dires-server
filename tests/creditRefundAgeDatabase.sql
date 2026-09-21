begin;
do $$
declare u uuid:=gen_random_uuid(); g uuid; c jsonb; blocked boolean:=false;
begin
insert into public.users(id,credit_balance) values(u,100);
update public.app_config set refund_enabled=true,refund_max_age_days=14;
g:=gen_random_uuid();
insert into public.reference_results(id,user_id,generation_id,credits_deducted,result_image_url,reference_images,created_at)
values(g,u,gen_random_uuid(),20,'https://example.com/result.jpg','["https://example.com/product.jpg"]',now()-interval '24 hours 1 second');
begin
perform public.claim_credit_refund(u,g,'Clearly visible severe product defect','product','en',null);
exception when others then if sqlerrm='too_old' then blocked:=true; else raise; end if; end;
if not blocked then raise exception '24-hour limit bypassed'; end if;
update public.reference_results set created_at=now()-interval '23 hours 59 minutes' where id=g;
c:=public.claim_credit_refund(u,g,'Clearly visible severe product defect','product','en',null);
if c->'request'->>'id' is null then raise exception 'timely request denied'; end if;
update public.reference_results set created_at=now()-interval '2 days' where id=g;
c:=public.claim_credit_refund(u,g,'Clearly visible severe product defect','product','en',null);
if c->'existing'->>'id' is null then raise exception 'timely claim became inaccessible'; end if;
end $$;
rollback;
select refund_max_age_days from public.app_config limit 1;
