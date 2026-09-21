alter table public.custom_studio_tools add column if not exists deleted_at timestamptz;
alter table public.custom_studio_tools add column if not exists button_hue integer not null default 260 check(button_hue between 0 and 359);
update public.custom_studio_tools set button_hue=case when lower(coalesce(title,'')||' '||description) ~ '(jewelry|jewellery|takı)' then 38 else 155 end;
create or replace function public.start_custom_studio_generation(p_user uuid,p_tool uuid,p_request uuid,p_owner uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare job public.custom_studio_generations; debit json; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into job from custom_studio_generations where user_id=p_user and request_key=p_request;
 if found then return to_jsonb(job); end if;
 if not exists(select 1 from custom_studio_tools where id=p_tool and user_id=p_user and deleted_at is null and screen_schema is not null) then raise exception 'tool_not_found'; end if;
 if (select count(*) from custom_studio_generations where user_id=p_user and status in ('queued','processing'))>=4 then raise exception 'too_many_generations'; end if;
 -- Owner is resolved by the authenticated API, never supplied by the client.
 debit:=deduct_user_credit(p_owner,10);
 if not coalesce((debit->>'success')::boolean,false) then raise exception 'insufficient_credit'; end if;
 insert into custom_studio_generations(user_id,tool_id,request_key,credit_owner_id,input) values(p_user,p_tool,p_request,p_owner,p_input) returning * into job;
 insert into reference_results(id,user_id,status,reference_images,original_prompt,enhanced_prompt,aspect_ratio,settings,credits_before_generation,credits_deducted,credits_after_generation,credit_owner_id,visibility)
 values(job.id,p_user,'pending',p_input->'images',p_input->>'details',p_input->>'prompt',p_input->>'ratio',jsonb_build_object('customToolId',p_tool,'customToolGeneration',true,'creditDeducted',true,'qualityVersion','v1','creditCost',10),(debit->>'current_balance')::integer,10,(debit->>'new_balance')::integer,p_owner,false);
 return to_jsonb(job);
end $$;
revoke all on function public.start_custom_studio_generation(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.start_custom_studio_generation(uuid,uuid,uuid,uuid,jsonb) to service_role;

