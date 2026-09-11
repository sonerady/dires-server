-- Rollback-only database regression test. No providers or real user records touched.
begin;
do $$
declare
  v_user uuid;
  v_gender text;
  v_other text;
  v_count integer;
begin
  foreach v_gender in array array['woman','man'] loop
    v_other := case when v_gender='woman' then 'man' else 'woman' end;
    insert into public.users default values returning id into v_user;
    insert into public.user_models(name,image_url,gender,age,user_id)
      values ('Regression fixture','https://example.invalid/portrait.jpg',v_gender,'young',v_user);
    -- Simulate an old globally excluded account.
    insert into public.model_starter_enrollments(user_id,eligible) values(v_user,false);
    if public.ensure_starter_models(v_user,v_gender) then raise exception 'Existing gender was allowed'; end if;
    if not public.ensure_starter_models(v_user,v_other) then raise exception 'Opposite gender was blocked'; end if;
    perform public.ensure_starter_models(v_user,v_other);
    select count(*) into v_count from public.model_starter_jobs where user_id=v_user;
    if v_count <> 3 then raise exception 'Expected one trio, got %',v_count; end if;
    delete from public.user_models where user_id=v_user;
    if not public.ensure_starter_models(v_user,v_gender) then raise exception 'Deleted manual gender was blocked'; end if;
  end loop;

  insert into public.users default values returning id into v_user;
  perform public.ensure_starter_models(v_user,'man');
  update public.model_starter_jobs set status='completed' where user_id=v_user;
  insert into public.user_models(name,image_url,gender,age,user_id)
    values ('Generated fixture','https://example.invalid/portrait.jpg','man','young',v_user);
  if not public.ensure_starter_models(v_user,'woman') then raise exception 'Completed male trio blocked female trio'; end if;
  update public.model_starter_jobs set status='completed' where user_id=v_user;
  delete from public.user_models where user_id=v_user;
  perform public.ensure_starter_models(v_user,'man');
  perform public.ensure_starter_models(v_user,'woman');
  select count(*) into v_count from public.model_starter_jobs where user_id=v_user;
  if v_count <> 6 then raise exception 'Repeated detection duplicated slots'; end if;
  if exists(select 1 from public.model_starter_jobs where user_id=v_user and status <> 'queued') then
    raise exception 'Deleted starter models did not restart generation';
  end if;

  insert into public.users default values returning id into v_user;
  perform public.record_model_gender_history(v_user,'man');
  if not public.ensure_starter_models(v_user,'man') then raise exception 'History blocked an empty current inventory'; end if;
  if not public.ensure_starter_models(v_user,'woman') then raise exception 'Manual history blocked other gender'; end if;

  if has_function_privilege('anon','public.record_model_gender_history(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.ensure_starter_models(uuid,text)','EXECUTE') then
    raise exception 'Private RPC is publicly executable';
  end if;
end;
$$;
rollback;
select 'Gender eligibility, current inventory, duplicate prevention and RPC grants passed; fixtures rolled back' as result;
