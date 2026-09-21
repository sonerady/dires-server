-- Run against an isolated transaction; every fixture and balance mutation rolls back.
begin;
do $$
declare u uuid:=gen_random_uuid(); g uuid; c jsonb; rid uuid; b int; lim int; blocked boolean:=false;
begin
 insert into public.users(id,credit_balance) values(u,100);
 select refund_daily_limit into lim from public.app_config limit 1;
 for i in 1..lim loop
  g:=gen_random_uuid();
  insert into public.reference_results(id,user_id,generation_id,credits_deducted,result_image_url,reference_images,created_at)
  values(g,u,gen_random_uuid(),20,'https://example.com/result.jpg','["https://example.com/product.jpg"]',now());
  c:=public.claim_credit_refund(u,g,'Clearly visible severe product defect','product','en',null);
  if i=1 then rid:=(c->'request'->>'id')::uuid; end if;
 end loop;
 g:=gen_random_uuid();
 insert into public.reference_results(id,user_id,generation_id,credits_deducted,result_image_url,reference_images,created_at)
 values(g,u,gen_random_uuid(),20,'https://example.com/result.jpg','["https://example.com/product.jpg"]',now());
 begin perform public.claim_credit_refund(u,g,'Clearly visible severe product defect','product','en',null);
 exception when others then if sqlerrm='daily_limit' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'daily limit bypassed'; end if;
 blocked:=false;
 begin perform public.settle_credit_refund(rid,'refunded','{}');
 exception when others then if sqlerrm='credit_owner_unverified' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'unverified owner auto-refunded'; end if;
 perform public.settle_credit_refund(rid,'review_pending','{}');
 perform public.settle_credit_refund(rid,'refunded',jsonb_build_object('verifiedOwner',u),'test-admin','Original charge owner verified in test');
 perform public.settle_credit_refund(rid,'refunded',jsonb_build_object('verifiedOwner',u),'test-admin','Duplicate click');
 select credit_balance into b from public.users where id=u;
 if b<>120 then raise exception 'incorrect balance %',b; end if;
 if has_function_privilege('authenticated','public.claim_credit_refund(uuid,uuid,text,text,text,uuid)','EXECUTE') then raise exception 'client can claim directly'; end if;
end $$;
rollback;
select 'Daily cap, unknown payer guard, manual owner verification, idempotent approval and grants passed' as verification;
