-- Entire test is rolled back, including auth users, runs, lists, leads and pool rows.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.run',gen_random_uuid()::text,true),set_config('qa.profile',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'qa-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'qa-'||current_setting('qa.other')||'@example.test');
insert into public.scouting_profiles(id,owner_id,name,audience,location,niche,sub_niche,usp,offer) values(current_setting('qa.profile')::uuid,current_setting('qa.owner')::uuid,'QA','Dentists','QA Region','Service','QA','QA','QA');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare initial jsonb:=jsonb_build_object('version',1,'kind','person','options',jsonb_build_object('target',250,'searchBudget',30),'stats',jsonb_build_object('saved',0));claimed jsonb; rows jsonb; result jsonb; destination uuid; other_lease uuid;
begin
 perform public.aisas_start_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.profile')::uuid,'QA Coverage',initial);
 -- Retried creation returns the original run without creating another.
 perform public.aisas_start_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.profile')::uuid,'QA Coverage',initial);
 if (select count(*) from public.scout_runs where owner_id=current_setting('qa.owner')::uuid)<>1 then raise exception 'Run creation not idempotent';end if;
 claimed:=public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid);
 if not coalesce((public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid)->>'busy')::boolean,false) then raise exception 'Concurrent scout not excluded';end if;
 select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'prospect_kind','person','contact_name','qa professional '||i,'email','qa'||i||'@public.example','company','','location',current_setting('qa.run'),'source_url','https://source.example/team/'||i)) into rows from generate_series(1,125) i;
 begin
  perform public.aisas_checkpoint_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,gen_random_uuid(),initial,rows);
  raise exception 'Invalid lease accepted';
 exception when raise_exception then if sqlerrm='Invalid lease accepted' then raise;end if;end;
 result:=public.aisas_checkpoint_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,(claimed->>'lease')::uuid,initial,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'prospect_kind','person','contact_name','No contact','source_url','https://source.example/no-contact')));
 if result->>'list_id' is not null or (result->>'count')::integer<>0 then raise exception 'Contactless result created a list';end if;
 claimed:=public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid);
 result:=public.aisas_checkpoint_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,(claimed->>'lease')::uuid,initial||jsonb_build_object('stats',jsonb_build_object('saved',125)),rows);
 destination:=(result->>'list_id')::uuid;
 if (result->>'count')::integer<>125 then raise exception 'More than 100 prospects were truncated';end if;
 claimed:=public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid);
 -- Two people may legitimately publish the same office address.
 rows:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'prospect_kind','person','contact_name','王小明','company','','location',current_setting('qa.run'),'email','office@public.example','source_url','https://source.example/team'),jsonb_build_object('id',gen_random_uuid(),'prospect_kind','person','contact_name','siti','company','','location',current_setting('qa.run'),'email','office@public.example','source_url','https://source.example/team'));
 result:=public.aisas_checkpoint_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,(claimed->>'lease')::uuid,initial||jsonb_build_object('stats',jsonb_build_object('saved',127)),rows);
 if (result->>'count')::integer<>127 then raise exception 'Shared office email collapsed separate people';end if;
 -- Later server enrichment also updates the shared pool, while private edit behavior stays unchanged.
 update public.leads set phone='+1 713 555 1234' where list_id=destination and contact_name='qa professional 1';
 if not exists(select 1 from public.prospect_pool where contact_name='qa professional 1' and location=current_setting('qa.run') and phone='+1 713 555 1234') then raise exception 'Shared pool enrichment not synchronized';end if;
 claimed:=public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid);
 update public.scout_runs set status='paused' where id=current_setting('qa.run')::uuid;
 perform public.aisas_checkpoint_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,(claimed->>'lease')::uuid,initial||jsonb_build_object('stats',jsonb_build_object('saved',127)),'[]');
 if (select status from public.scout_runs where id=current_setting('qa.run')::uuid)<>'paused' then raise exception 'Checkpoint ignored concurrent pause';end if;
 if not coalesce((public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid)->>'idle')::boolean,false) then raise exception 'Paused run continued';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$ begin
 if (select count(id) from public.scout_runs)<>1 then raise exception 'Own progress unavailable';end if;
 begin perform state from public.scout_runs;raise exception 'Internal cursor exposed';exception when insufficient_privilege then null;end;
 begin update public.scout_runs set target=1000;raise exception 'Client could mutate progress';exception when insufficient_privilege then null;end;
 begin perform public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid);raise exception 'Client could claim server lease';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$ begin if exists(select 1 from public.scout_runs) then raise exception 'Other owner can read progress';end if;end $$;
reset role;
set local role anon;
do $$ begin begin perform id from public.scout_runs;raise exception 'Anonymous progress exposed';exception when insufficient_privilege then null;end;end $$;
reset role;
select '125+ prospects, enrichment, leases, idempotency, pause and RLS passed' as result;
rollback;
