-- Invocation counts use batch IDs: one click can produce several images.
create or replace function public.admin_variation_usage(p_from timestamptz,p_to timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $usage$
 with classified as (
 select id,user_id,status,coalesce(nullif(settings->>'batchId',''),generation_id,id::text) batch,
 case when settings->>'automaticTrial'='true' or starts_with(coalesce(settings->>'batchId',''),'trial_auto_') then 'automatic_trial'
 when settings->>'initiatedBy'='user' and settings->>'isTrialAtGeneration'='true' then 'manual_trial'
 when settings->>'initiatedBy'='user' and settings->>'isTrialAtGeneration'='false' then 'manual_regular'
 when settings->>'batchId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'manual_unclassified'
 else 'unknown' end origin
 from public.variation_generations where created_at>=p_from and created_at<p_to
 ) select coalesce(jsonb_agg(x order by x.records desc),'[]'::jsonb) from (
 select origin,count(*) records,count(distinct (user_id,batch)) batches,count(distinct user_id) users,
 count(*) filter(where status in ('completed','succeeded','success')) completed,
 count(*) filter(where status in ('failed','error','cancelled','canceled')) failed
 from classified group by origin)x;
$usage$;
revoke all on function public.admin_variation_usage(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_variation_usage(timestamptz,timestamptz) to service_role;

-- Read-only analytics. No table grants or customer data are exposed to public clients.
create or replace function public.admin_analytics_report(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' set statement_timeout = '30s' as $$
declare report jsonb;
begin
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '90 days' then
  raise exception 'Choose a valid date range of at most 90 days';
 end if;
 -- Date ranges vary widely; parameterized EXECUTE plans against the actual range.
 execute $report$ with facts as not materialized (
select case when r.settings->>'isBackSideCloset'='true' then 'back-side' when r.settings->>'isPoseChange'='true' then 'pose-change' when r.settings->>'isColorChange'='true' then 'color-change' when r.settings->>'isRefinerMode'='true' then 'refiner' when r.settings->>'isEditMode'='true' then 'edit-room' else 'virtual-model' end feature, r.id::text id, r.user_id::text user_id,r.created_at,r.status,coalesce(r.credits_deducted,0)::numeric credits,r.processing_time_seconds::numeric seconds,1::bigint images,r.settings,r.aspect_ratio::text ratio,r.quality_version::text quality,r.style_profile_id::text style_id from public.reference_results r where r.created_at>=$1 and r.created_at<$2 and not exists (select 1 from public.pose_change_generations d where d.generation_id=r.generation_id)
and not exists (select 1 from public.back_side_generations d where d.generation_id=r.generation_id)
and not exists (select 1 from public.color_change_generations d where d.generation_id=r.generation_id)
and not exists (select 1 from public.refiner_generations d where d.generation_id=r.generation_id)
and not exists (select 1 from public.variation_generations d where d.generation_id=r.generation_id)
union all select 'pose-change',id::text,user_id::text,created_at,status,coalesce(credits_used,0)::numeric,processing_time_seconds::numeric,1::bigint,settings,aspect_ratio::text,quality_version::text,null::text from public.pose_change_generations where created_at>=$1 and created_at<$2
union all select 'back-side',id::text,user_id::text,created_at,status,coalesce(credits_used,0)::numeric,processing_time_seconds::numeric,1::bigint,settings,aspect_ratio::text,quality_version::text,null::text from public.back_side_generations where created_at>=$1 and created_at<$2
union all select 'color-change',id::text,user_id::text,created_at,status,coalesce(credits_used,0)::numeric,processing_time_seconds::numeric,1::bigint,settings,aspect_ratio::text,quality_version::text,null::text from public.color_change_generations where created_at>=$1 and created_at<$2
union all select 'refiner',id::text,user_id::text,created_at,status,coalesce(credits_used,0)::numeric,processing_time_seconds::numeric,1::bigint,settings,aspect_ratio::text,quality_version::text,null::text from public.refiner_generations where created_at>=$1 and created_at<$2
union all select 'variations',id::text,user_id::text,created_at,status,coalesce(credits_used,0)::numeric,processing_time_seconds::numeric,1::bigint,settings,null::text,null::text,null::text from public.variation_generations where created_at>=$1 and created_at<$2
union all select 'videos',id::text,user_id::text,created_at,status,coalesce(credits_used,0),processing_time_seconds,1,null::jsonb,aspect_ratio,resolution,null from public.video_generations where created_at>=$1 and created_at<$2
union all select 'upscale',id::text,user_id::text,created_at,status,coalesce(credits_cost,0),null::numeric,1,null::jsonb,null,scale::text,null from public.upscale_generations where created_at>=$1 and created_at<$2
union all select 'chat-edit',id::text,user_id::text,created_at,status,case when credits_refunded then 0 else coalesce(credits_cost,0) end,processing_time_ms/1000.0,1,null::jsonb,aspect_ratio,null,null from public.chat_edits where created_at>=$1 and created_at<$2
union all select 'banners',id::text,user_id::text,created_at,'completed',coalesce(credits_used,0),processing_time_seconds,1,options,ratio,null,null from public.banner_studio_results where created_at>=$1 and created_at<$2
union all select 'ecommerce-kits',id::text,user_id::text,created_at,'completed',coalesce(credits_used,0),processing_time_seconds,coalesce(total_images_generated,0),null::jsonb,null,null,null from public.product_kits where created_at>=$1 and created_at<$2
union all select 'product-stories',id::text,user_id::text,created_at,'completed',coalesce(credits_used,0),processing_time_seconds,coalesce(total_images_generated,0),null::jsonb,null,null,null from public.product_stories where created_at>=$1 and created_at<$2
union all select 'unboxing-stories',id::text,user_id::text,created_at,'completed',coalesce(credits_used,0),processing_time_seconds,coalesce(total_images_generated,0),null::jsonb,null,null,null from public.product_unboxing_stories where created_at>=$1 and created_at<$2
union all select 'street-icon-kits',id::text,user_id::text,created_at,'completed',coalesce(credits_used,0),processing_time_seconds,coalesce(total_images_generated,0),null::jsonb,null,null,null from public.product_street_icon_kits where created_at>=$1 and created_at<$2
 ), f as materialized (
 select *, lower(coalesce(status,'unknown')) in ('completed','succeeded','success') done,
 lower(coalesce(status,'unknown')) in ('failed','error','cancelled','canceled') failed from facts
 ), creators as materialized (select distinct user_id from f), creator_profiles as materialized (select c.user_id,u.platform,u.preferred_language from creators c left join public.users u on u.id=case when c.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then c.user_id::uuid end), purchases as materialized (
 select distinct on (coalesce(nullif(transaction_id,''),id::text), coalesce(store,'unknown'))
 id,user_id,coalesce(nullif(normalized_product_id,''),split_part(product_id,':',1),'Unknown') product,
 event_type,price,currency,store,coalesce(purchased_at,created_at) purchased_time
 from public.purchase_history
 where upper(environment)='PRODUCTION' and event_type in ('INITIAL_PURCHASE','RENEWAL','NON_RENEWING_PURCHASE')
 and not coalesce(switch_marker,false) and coalesce(purchased_at,created_at)>=$1 and coalesce(purchased_at,created_at)<$2
 order by coalesce(nullif(transaction_id,''),id::text),coalesce(store,'unknown'),created_at desc,id desc
 ), paid as materialized (select * from purchases where price>0),
 loc as (select coalesce(nullif(settings->>'locationId',''),nullif(settings->>'location','')) id,max(settings->>'location') name,count(*) count,count(distinct user_id) users from f where done and feature='virtual-model' and coalesce(nullif(settings->>'locationId',''),nullif(settings->>'location','')) is not null group by 1 order by count desc limit 12),
 models as (select settings->>'analyticsModelImage' id,count(*) count,count(distinct user_id) users from f where done and feature='virtual-model' and nullif(settings->>'analyticsModelImage','') is not null group by 1 order by count desc limit 12)
 select jsonb_build_object(
 'from',$1,'to',$2,'generatedAt',now(),
 'summary',(select jsonb_build_object('outputs',count(*),'completed',count(*) filter(where done),'failed',count(*) filter(where failed),'activeCreators',count(distinct user_id),'credits',coalesce(sum(credits) filter(where done),0),'averageSeconds',avg(seconds) filter(where done and seconds>0),'kitJobs',count(*) filter(where feature in ('ecommerce-kits','product-stories','unboxing-stories','street-icon-kits')),'kitUsers',count(distinct user_id) filter(where feature in ('ecommerce-kits','product-stories','unboxing-stories','street-icon-kits')),'paidTransactions',(select count(*) from paid),'payingUsers',(select count(distinct user_id) from paid),'zeroPriceEvents',(select count(*) from purchases where coalesce(price,0)=0)) from f),
 'features',coalesce((select jsonb_agg(x order by x.total desc) from (select feature,count(*) total,count(*) filter(where done) completed,count(*) filter(where failed) failed,count(distinct user_id) users,coalesce(sum(credits) filter(where done),0) credits,avg(seconds) filter(where done and seconds>0) seconds,sum(images) filter(where done) images from f group by feature)x),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(x order by x.day) from (select d::date::text as day,coalesce(g.outputs,0) outputs,coalesce(g.completed,0) completed,coalesce(g.failed,0) failed,coalesce(g.users,0) users,coalesce(p.purchases,0) purchases,coalesce(u.signups,0) signups from generate_series(date_trunc('day',$1 at time zone 'UTC'),date_trunc('day',($2-interval '1 microsecond') at time zone 'UTC'),interval '1 day') d left join (select (created_at at time zone 'UTC')::date as day,count(*) outputs,count(*) filter(where done) completed,count(*) filter(where failed) failed,count(distinct user_id) users from f group by 1)g on g.day=d::date left join (select (purchased_time at time zone 'UTC')::date as day,count(*) purchases from paid group by 1)p on p.day=d::date left join (select (created_at at time zone 'UTC')::date as day,count(*) signups from public.users where created_at>=$1 and created_at<$2 group by 1)u on u.day=d::date)x),'[]'::jsonb),
 'packages',coalesce((select jsonb_agg(x order by x.transactions desc) from (select product,count(*) transactions,count(distinct user_id) buyers,count(*) filter(where event_type='INITIAL_PURCHASE') initial,count(*) filter(where event_type='RENEWAL') renewals,count(*) filter(where event_type='NON_RENEWING_PURCHASE') one_time from paid group by product order by transactions desc limit 20)x),'[]'::jsonb),
 'revenueByCurrency',coalesce((select jsonb_agg(x) from (select coalesce(currency,'Unknown') currency,sum(price) amount,count(*) transactions from paid group by currency order by amount desc)x),'[]'::jsonb),
 'stores',coalesce((select jsonb_agg(x) from (select coalesce(store,'Unknown') name,count(*) count from paid group by store order by count desc)x),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',coalesce(l.name,c.title,l.id),'image',c.image_url,'count',l.count,'users',l.users)) from loc l left join public.custom_locations c on c.id::text=l.id),'[]'::jsonb),
 'models',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(u.name,p.name,'Model reference'),'image',m.id,'count',m.count,'users',m.users)) from models m left join lateral (select name from public.user_models where image_url=m.id order by id desc limit 1)u on true left join lateral (select name from public.model_pool where image_url=m.id order by id desc limit 1)p on true),'[]'::jsonb),
 'variations',public.admin_variation_usage($1,$2),
 'modelCoverage',(select jsonb_build_object('referenceUsed',count(*) filter(where settings->>'usedModelPhoto'='true' or nullif(settings->>'analyticsModelImage','') is not null),'identified',count(*) filter(where nullif(settings->>'analyticsModelImage','') is not null),'total',count(*)) from f where done and feature='virtual-model'),
 'styles',coalesce((select jsonb_agg(x) from (select coalesce(sp.name,s.style_id) name,s.style_id id,s.count from (select style_id,count(*) count from f where done and style_id is not null group by style_id order by count desc limit 12)s left join public.style_profiles sp on sp.id=s.style_id::uuid order by s.count desc)x),'[]'::jsonb),
 'dimensions',coalesce((select jsonb_agg(x) from (select dimension,coalesce(nullif(value,''),'Unknown') name,count(*) count from f cross join lateral (values ('Gender',settings->>'gender'),('Age',settings->>'age'),('Focus area',settings->>'focusArea'),('Category',settings->>'productCategory'),('Quality',quality),('Aspect ratio',ratio))d(dimension,value) where done and value is not null group by 1,2 order by count desc)x),'[]'::jsonb),
 'audience',(select jsonb_build_object('accounts',count(*),'pro',count(*) filter(where is_pro),'trial',count(*) filter(where is_in_trial),'newAccounts',count(*) filter(where created_at>=$1 and created_at<$2)) from public.users),
 'platforms',coalesce((select jsonb_agg(x) from (select coalesce(nullif(lower(platform),''),'Unknown') name,count(*) count from creator_profiles group by 1 order by count desc)x),'[]'::jsonb),
 'languages',coalesce((select jsonb_agg(x) from (select coalesce(nullif(preferred_language,''),'Unknown') name,count(*) count from creator_profiles group by 1 order by count desc limit 15)x),'[]'::jsonb),
 'coverage',jsonb_build_object('purchaseHistorySince',(select min(created_at) from public.purchase_history),'backgroundRemovalTracked',false)
 )$report$ into report using p_from,p_to;
 return report;
end; $$;
revoke all on function public.admin_analytics_report(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_analytics_report(timestamptz,timestamptz) to service_role;
