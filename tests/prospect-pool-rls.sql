-- Rollback-only integration tests. No fixture user, list, or shared record persists.
begin;
select set_config('aisas.test.user_a',gen_random_uuid()::text,true),set_config('aisas.test.user_b',gen_random_uuid()::text,true),set_config('aisas.test.list_b',gen_random_uuid()::text,true),set_config('aisas.test.company','Pool QA '||gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('aisas.test.user_a')::uuid,'qa-a-'||current_setting('aisas.test.user_a')||'@example.test'),(current_setting('aisas.test.user_b')::uuid,'qa-b-'||current_setting('aisas.test.user_b')||'@example.test');
insert into public.lead_lists(id,owner_id,name) values(current_setting('aisas.test.list_b')::uuid,current_setting('aisas.test.user_b')::uuid,'Private B');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare fixture_company text:=current_setting('aisas.test.company'); result jsonb;
begin
 result:=public.aisas_save_scout_results(current_setting('aisas.test.user_b')::uuid,'Scouted B',jsonb_build_array(
 jsonb_build_object('company',fixture_company,'prospect_kind','company','source_url','https://source.example/company','location','Sydney, Australia','industry','Software','email','public@company.example','company_size','11-50','revenue',250000,'funding_amount',100000,'founded_year',2018,'technologies',jsonb_build_array('React','AWS')),
 jsonb_build_object('company',fixture_company||' unknown','prospect_kind','company','source_url','https://source.example/unknown','location','Sydney, Australia','industry','Software'),
 jsonb_build_object('company',fixture_company,'prospect_kind','person','contact_name','QA Founder','phone','+1 713 555 1234','job_title','Founder','seniority','Founder','source_url','https://source.example/founder','linkedin','https://www.linkedin.com/in/qa-founder'),
 jsonb_build_object('company',fixture_company,'prospect_kind','person','contact_name','QA Director','phone','+1 713 555 1234','job_title','Marketing Director','department','Marketing','source_url','https://source.example/director','linkedin','https://www.linkedin.com/in/qa-director')
 ));
 if (result->>'count')::integer<>4 then raise exception 'People without emails collapsed into one lead'; end if;
 perform public.aisas_save_scout_results(current_setting('aisas.test.user_a')::uuid,'Repeated scout',jsonb_build_array(jsonb_build_object('company',fixture_company,'prospect_kind','company','source_url','https://source.example/company','email','public@company.example')));
 if (select count(*) from public.prospect_pool where public.prospect_pool.company=fixture_company)<>3 then raise exception 'Pool duplicate protection failed'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('aisas.test.user_a'),'role','authenticated')::text,true);
do $$ declare fixture_company text:=current_setting('aisas.test.company'); result jsonb; pool_id uuid; saved jsonb; target uuid; before_count integer;
begin
 if exists(select 1 from public.lead_lists where owner_id=current_setting('aisas.test.user_b')::uuid) then raise exception 'Private list isolation failed'; end if;
 result:=public.aisas_search_pool('company',jsonb_build_object('company',fixture_company,'revenue_min',200000,'revenue_max',300000,'funding_min',50000,'funding_max',200000,'founded_min',2010,'founded_max',2020,'company_size','11-50','technologies',jsonb_build_array('React'),'industry','Software','location','Sydney'));
 if jsonb_array_length(result->'rows')<>1 then raise exception 'Company range/filter or unknown-data exclusion failed'; end if;
 if (result->'rows'->0)?'owner_id' or (result->'rows'->0)?'fingerprint' then raise exception 'Shared search metadata leak'; end if;
 pool_id:=(result->'rows'->0->>'id')::uuid;
 saved:=public.aisas_save_pool_prospects(array[pool_id],null,'My saved QA prospects');target:=(saved->>'list_id')::uuid;
 if (saved->>'added')::integer<>1 then raise exception 'Save to new list failed'; end if;
 saved:=public.aisas_save_pool_prospects(array[pool_id],target,null);
 if (saved->>'added')::integer<>0 or (saved->>'skipped')::integer<>1 then raise exception 'Repeated save was not skipped'; end if;
 if exists(select 1 from public.leads where list_id=target and email_verification_status<>'unverified') then raise exception 'Verification history leaked into copy'; end if;
 result:=public.aisas_search_pool('person',jsonb_build_object('company',fixture_company));
 if jsonb_array_length(result->'rows')<>2 then raise exception 'People search / company decision makers failed'; end if;
 perform public.aisas_save_pool_prospects(array(select (x->>'id')::uuid from jsonb_array_elements(result->'rows') x),target,null);
 if (select count(*) from public.leads where list_id=target)<>3 then raise exception 'Multiple people at company not saved'; end if;
 begin
  perform public.aisas_save_pool_prospects(array[pool_id],current_setting('aisas.test.list_b')::uuid,null);
  raise exception 'Cross-owner save allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.prospect_pool set company='Poisoned' where id=pool_id;
  raise exception 'Client could mutate shared pool';
 exception when insufficient_privilege then null; end;
 begin
  perform public.aisas_save_scout_results(current_setting('aisas.test.user_a')::uuid,'Poison','[]'::jsonb);
  raise exception 'Client can impersonate scouting service';
 exception when insufficient_privilege then null; end;
 select count(*) into before_count from public.prospect_pool;
 insert into public.leads(owner_id,list_id,company,source_url) values(auth.uid(),target,'Manual private QA note','https://source.example/private');
 if (select count(*) from public.prospect_pool)<>before_count then raise exception 'Manual private lead leaked into pool'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.aisas_search_pool();raise exception 'Anonymous pool search exposed';
 exception when insufficient_privilege then null; end;
 begin
  perform count(*) from public.prospect_pool;raise exception 'Anonymous pool read exposed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
