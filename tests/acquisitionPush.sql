begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); claim1 uuid; claim2 uuid; dev text:='push-test-'||gen_random_uuid();
begin
 insert into public.users(id,device_id,created_at) values(a,dev,clock_timestamp()),(b,'second-'||dev,clock_timestamp()),(c,'old-'||dev,'2020-01-01');
 if not public.acquisition_push_eligible(a) then raise exception 'new never purchaser incorrectly excluded'; end if;
 if public.acquisition_push_eligible(c) then raise exception 'old account enrolled'; end if;
 update public.users set is_in_trial=true,has_used_trial=true,trial_started_at=now() where id=a;
 if public.acquisition_push_eligible(a) then raise exception 'trial eligible'; end if;
 update public.users set is_in_trial=false,has_used_trial=false,trial_started_at=null where id=a;
 if public.acquisition_push_eligible(a) then raise exception 'expired trial reactivated'; end if;
 update public.users set device_id=dev where id=b;
 if public.acquisition_push_eligible(b) then raise exception 'same device eligible'; end if;
 delete from public.users where id=a;
 if public.acquisition_push_eligible(b) then raise exception 'deleted payer identity lost'; end if;
 update public.users set device_id='other-'||dev where id=b;
 insert into public.purchase_history(user_id,product_id,transaction_id,event_type,store,environment,purchased_at) values(b::text,'test-plan',gen_random_uuid()::text,'CANCELLATION','APP_STORE','SANDBOX',now());
 if public.acquisition_push_eligible(b) then raise exception 'historical cancelled purchaser eligible'; end if;
 delete from public.purchase_history where user_id=b::text;
 if public.acquisition_push_eligible(b) then raise exception 'purchase history removal reactivated user'; end if;
 insert into public.users(id,device_id,created_at) values(d,'claim-'||dev,clock_timestamp());
 select id into claim1 from public.acquisition_push_claim(d,current_date,'test-day');
 select id into claim2 from public.acquisition_push_claim(d,current_date,'test-day');
 if claim1 is null or claim1<>claim2 then raise exception 'claim is not idempotent'; end if;
 if exists(select 1 from public.acquisition_push_claim(d,current_date+1,'other-day')) then raise exception 'timezone change bypassed daily cap'; end if;
 if has_table_privilege('anon','public.acquisition_push_enrollments','SELECT') or has_table_privilege('authenticated','public.acquisition_push_exclusions','DELETE') then raise exception 'private campaign data exposed'; end if;
 if has_function_privilege('anon','public.acquisition_push_eligible(uuid)','EXECUTE') then raise exception 'eligibility exposed'; end if;
end $$;
rollback;
