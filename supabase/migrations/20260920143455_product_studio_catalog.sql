create table public.product_studio_catalog (
 id uuid primary key default gen_random_uuid(),
 builtin_id text unique,
 position integer not null default 0,
 draft jsonb not null,
 published jsonb,
 revision integer not null default 1,
 enabled boolean not null default false,
 updated_at timestamptz not null default now(),
 published_at timestamptz
);
alter table public.product_studio_catalog enable row level security;
revoke all on public.product_studio_catalog from public,anon,authenticated;
grant all on public.product_studio_catalog to service_role;
create index product_studio_catalog_order on public.product_studio_catalog(position,id);
alter table public.custom_studio_tools alter column user_id drop not null;
-- A global tool has no end-user owner. Private tools retain their existing ownership.
create or replace function public.publish_product_studio(p_id uuid,p_revision integer)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r product_studio_catalog; d jsonb; begin
 select * into r from product_studio_catalog where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'revision_conflict'; end if;
 d:=r.draft;
 if d->'screen' is not null and d->'screen'<>'null'::jsonb then
 insert into custom_studio_tools(id,user_id,request_key,description,language,title,brief,status,screen_schema,button_hue,translations,before_url,after_url,intro_examples)
 values(r.id,null,r.id,d->>'description',d->>'language',d->>'title',d->>'description','completed',d->'screen',(d->>'buttonHue')::int,d->'translations',d->>'beforeUrl',d->>'afterUrl',d->'introExamples')
 on conflict(id) do update set title=excluded.title,description=excluded.description,brief=excluded.brief,language=excluded.language,screen_schema=excluded.screen_schema,button_hue=excluded.button_hue,translations=excluded.translations,before_url=excluded.before_url,after_url=excluded.after_url,intro_examples=excluded.intro_examples,updated_at=now()
 where custom_studio_tools.user_id is null;
 end if;
 update product_studio_catalog set published=d,enabled=true,published_at=now(),updated_at=now(),revision=revision+1 where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.publish_product_studio(uuid,integer) from public,anon,authenticated;
grant execute on function public.publish_product_studio(uuid,integer) to service_role;
create or replace function public.reorder_product_studio(p_ids uuid[])
returns void language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('product_studio_order',0));
 if cardinality(p_ids)<>(select count(*) from product_studio_catalog) or (select count(distinct x) from unnest(p_ids) x)<>cardinality(p_ids) or exists(select 1 from unnest(p_ids) x where not exists(select 1 from product_studio_catalog where id=x)) then raise exception 'invalid_order'; end if;
 update product_studio_catalog c set position=a.n-1 from unnest(p_ids) with ordinality a(id,n) where c.id=a.id;
end $$;
revoke all on function public.reorder_product_studio(uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_product_studio(uuid[]) to service_role;

create or replace function public.start_custom_studio_generation(p_user uuid,p_tool uuid,p_request uuid,p_owner uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare job public.custom_studio_generations; debit json; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into job from custom_studio_generations where user_id=p_user and request_key=p_request;
 if found then return to_jsonb(job); end if;
 if not exists(select 1 from custom_studio_tools where id=p_tool and (user_id=p_user or (user_id is null and exists(select 1 from product_studio_catalog c where c.id=p_tool and c.enabled and c.published is not null))) and deleted_at is null and screen_schema is not null) then raise exception 'tool_not_found'; end if;
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

