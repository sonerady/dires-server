alter table public.custom_studio_tools add column if not exists screen_schema jsonb;
create table if not exists public.custom_studio_generations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 tool_id uuid not null references public.custom_studio_tools(id), request_key uuid not null,
 credit_owner_id uuid not null references public.users(id),
 status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
 input jsonb not null, result_url text, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,request_key)
);
create index if not exists custom_studio_generations_owner on public.custom_studio_generations(user_id,tool_id,created_at desc);
alter table public.custom_studio_generations enable row level security;
revoke all on public.custom_studio_generations from anon,authenticated;
grant all on public.custom_studio_generations to service_role;

-- Service-only, invoker privileges. Debit and durable queue insertion are one transaction.
create or replace function public.start_custom_studio_generation(p_user uuid,p_tool uuid,p_request uuid,p_owner uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare job public.custom_studio_generations; debit json; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into job from custom_studio_generations where user_id=p_user and request_key=p_request;
 if found then return to_jsonb(job); end if;
 if not exists(select 1 from custom_studio_tools where id=p_tool and user_id=p_user and screen_schema is not null) then raise exception 'tool_not_found'; end if;
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

-- Terminal state is immutable: duplicate completion/failure cannot debit/refund twice.
create or replace function public.finish_custom_studio_generation(p_id uuid,p_url text default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare job public.custom_studio_generations; begin
 select * into job from custom_studio_generations where id=p_id for update;
 if not found then raise exception 'generation_not_found'; end if;
 if job.status in ('completed','failed') then return to_jsonb(job); end if;
 if p_url is not null and length(p_url)>0 then
  update custom_studio_generations set status='completed',result_url=p_url,updated_at=now() where id=p_id returning * into job;
  update reference_results set status='completed',result_image_url=p_url,updated_at=now() where id=p_id;
 else
  update users set credit_balance=coalesce(credit_balance,0)+10 where id=job.credit_owner_id;
  update custom_studio_generations set status='failed',error_code=coalesce(p_error,'generation_failed'),updated_at=now() where id=p_id returning * into job;
  update reference_results set status='failed',credits_deducted=0,settings=settings||jsonb_build_object('creditDeducted',false,'failureRefunded',true),updated_at=now() where id=p_id;
 end if;
 return to_jsonb(job);
end $$;
revoke all on function public.finish_custom_studio_generation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_custom_studio_generation(uuid,text,text) to service_role;
