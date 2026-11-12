-- Every account, source, qualification and campaign here is a rolled-back fixture. No email is sent.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.audience',gen_random_uuid()::text,true),set_config('qa.other_audience',gen_random_uuid()::text,true),set_config('qa.ideal',gen_random_uuid()::text,true),set_config('qa.run',gen_random_uuid()::text,true),set_config('qa.lead',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true),set_config('qa.mailbox',gen_random_uuid()::text,true),set_config('qa.recipient',gen_random_uuid()::text,true),set_config('qa.claim',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'ideal-qa-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'ideal-qa-'||current_setting('qa.other')||'@example.test');
insert into public.scouting_profiles(id,owner_id,name,audience,location,niche,sub_niche,usp,offer) values(current_setting('qa.audience')::uuid,current_setting('qa.owner')::uuid,'Ideal QA','HVAC','Austin','Automation','Calls','A proposition','An offer'),(current_setting('qa.other_audience')::uuid,current_setting('qa.other')::uuid,'Other private audience','Dentists','London','Automation','Calls','Other proposition','Other offer');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
insert into public.ideal_profiles(id,owner_id,audience_profile_id,name,business,decision_maker,starting_segment,main_problem,secondary_problem,buying_triggers,prospecting_signals) values(current_setting('qa.ideal')::uuid,auth.uid(),current_setting('qa.audience')::uuid,'Ideal HVAC','Residential HVAC','Owner who schedules','3–20 field technicians','Missed calls','Manual reminders','Peak demand','Callback website');
do $$begin
 begin insert into public.ideal_profiles(owner_id,audience_profile_id,name,business,decision_maker,starting_segment,main_problem,secondary_problem,buying_triggers,prospecting_signals) values(auth.uid(),current_setting('qa.other_audience')::uuid,'Cross-owner','HVAC','Owner','Small team','Calls','Reminders','Growth','Website');raise exception 'Cross-owner audience allowed';exception when foreign_key_violation then null;end;
 begin update public.ideal_profiles set business='' where id=current_setting('qa.ideal')::uuid;raise exception 'Blank criterion allowed';exception when check_violation then null;end;
 begin update public.ideal_profiles set owner_id=current_setting('qa.other')::uuid,audience_profile_id=current_setting('qa.other_audience')::uuid where id=current_setting('qa.ideal')::uuid;raise exception 'Owner reassignment allowed';exception when insufficient_privilege then null;end;
 begin insert into public.ideal_qualifications(lead_id,owner_id,run_id,report) values(gen_random_uuid(),auth.uid(),gen_random_uuid(),'{}');raise exception 'Client could forge qualification';exception when insufficient_privilege then null;end;
 begin perform public.aisas_checkpoint_ideal_run(gen_random_uuid(),auth.uid(),gen_random_uuid(),'{}','[]','[]');raise exception 'Client could invoke qualification checkpoint';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$begin if exists(select 1 from public.ideal_profiles where id=current_setting('qa.ideal')::uuid) then raise exception 'Private ideal profile exposed';end if;end $$;
reset role;
select set_config('qa.criteria',(select (to_jsonb(p)-array['id','owner_id','audience_profile_id','name','created_at'])::text from public.ideal_profiles p where id=current_setting('qa.ideal')::uuid),true);
select set_config('qa.state',jsonb_build_object('version',1,'goal','ideal','method','boolean','ideal_profile_id',current_setting('qa.ideal'),'criteria',current_setting('qa.criteria')::jsonb,'kind','company','options',jsonb_build_object('target',1,'searchBudget',10),'stats',jsonb_build_object('saved',0),'done',false,'warnings','[]'::jsonb)::text,true);
select set_config('qa.rows',jsonb_build_array(jsonb_build_object('id',current_setting('qa.lead'),'prospect_kind','company','company','Fixture Heating','contact_name','Jane Doe','email','office@fixture.example','phone','+1 512 555 0111','source_url','https://fixture.example/','website','https://fixture.example/','score',90))::text,true);
select set_config('qa.report',jsonb_build_object('qualified',true,'score',75,'criteria',current_setting('qa.criteria')::jsonb,'profile_name','Ideal HVAC','assessed_at',now(),'checks',(select jsonb_agg(jsonb_build_object('area',area,'status',case when area in ('business','decision_maker','starting_segment','prospecting_signals')then 'match' else 'unknown'end,'reason','Fixture evidence','evidence',case when area in ('business','decision_maker','starting_segment','prospecting_signals')then jsonb_build_array(jsonb_build_object('url','https://fixture.example/','quote','Published fixture evidence supports this field.','kind','website'))else '[]'::jsonb end))from unnest(array['business','decision_maker','starting_segment','main_problem','secondary_problem','buying_triggers','prospecting_signals'])area))::text,true);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.aisas_start_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.audience')::uuid,'Qualified fixture list',current_setting('qa.state')::jsonb);
select set_config('qa.lease',(public.aisas_claim_scout_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid)->>'lease'),true);
do $$declare denied boolean:=false;begin
 begin perform public.aisas_checkpoint_ideal_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.lease')::uuid,current_setting('qa.state')::jsonb-'goal','[]','[]');exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Missing ideal purpose accepted';end if;
end $$;
do $$declare denied boolean:=false;bad jsonb;begin
 bad:=jsonb_set(current_setting('qa.report')::jsonb,'{checks,2,status}','"unknown"');
 begin perform public.aisas_checkpoint_ideal_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.lease')::uuid,current_setting('qa.state')::jsonb,current_setting('qa.rows')::jsonb,jsonb_build_array(jsonb_build_object('lead_id',current_setting('qa.lead'),'report',bad)));exception when raise_exception then denied:=true;end;
 if not denied or exists(select 1 from public.leads where id=current_setting('qa.lead')::uuid)then raise exception 'Unqualified prospect saved';end if;
end $$;
select public.aisas_checkpoint_ideal_run(current_setting('qa.run')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.lease')::uuid,jsonb_set(jsonb_set(current_setting('qa.state')::jsonb,'{done}','true'),'{reason}','"qualified_target_reached"'),current_setting('qa.rows')::jsonb,jsonb_build_array(jsonb_build_object('lead_id',current_setting('qa.lead'),'report',current_setting('qa.report')::jsonb)));
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$begin if not exists(select 1 from public.ideal_qualifications where lead_id=current_setting('qa.lead')::uuid and (report->>'score')::integer=75)then raise exception 'Owner could not read qualified evidence';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$begin if exists(select 1 from public.ideal_qualifications where lead_id=current_setting('qa.lead')::uuid)then raise exception 'Other user read private qualification';end if;end $$;
reset role;
set local role anon;
do $$begin begin perform * from public.ideal_qualifications;raise exception 'Anonymous evidence access';exception when insufficient_privilege then null;end;end $$;
reset role;
insert into public.mailboxes(id,owner_id,email,provider) values(current_setting('qa.mailbox')::uuid,current_setting('qa.owner')::uuid,'sender@fixture.example','custom');
insert into public.campaigns(id,owner_id,name,list_id,profile_id,mailbox_id,status,approved,messages) select current_setting('qa.campaign')::uuid,current_setting('qa.owner')::uuid,'Ideal delivery snapshot',list_id,current_setting('qa.audience')::uuid,current_setting('qa.mailbox')::uuid,'running',true,'[{"step":0,"subject":"Idea","body":"{{ideal_observation}}","delay_hours":0},{"step":1,"subject":"Follow up","body":"Second","delay_hours":24},{"step":2,"subject":"Follow up","body":"Third","delay_hours":24},{"step":3,"subject":"Follow up","body":"Fourth","delay_hours":24}]' from public.scout_runs where id=current_setting('qa.run')::uuid;
insert into public.campaign_recipients(id,owner_id,campaign_id,lead_id,status,claim_token)values(current_setting('qa.recipient')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.campaign')::uuid,current_setting('qa.lead')::uuid,'processing',current_setting('qa.claim')::uuid);
delete from public.ideal_qualifications where lead_id=current_setting('qa.lead')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare payload jsonb;begin
 payload:=public.aisas_begin_campaign_send(current_setting('qa.recipient')::uuid,current_setting('qa.claim')::uuid);
 if payload->'ideal_context' is distinct from current_setting('qa.report')::jsonb then raise exception 'Approved recipient evidence was not preserved';end if;
end $$;
reset role;
insert into public.ideal_qualifications(lead_id,owner_id,run_id,ideal_profile_id,report) values(current_setting('qa.lead')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.run')::uuid,current_setting('qa.ideal')::uuid,current_setting('qa.report')::jsonb);
do $$declare other_list uuid:=gen_random_uuid();other_lead uuid:=gen_random_uuid();begin
 insert into public.lead_lists(id,owner_id,name)values(other_list,current_setting('qa.other')::uuid,'Other private list');
 insert into public.leads(id,owner_id,list_id,company,email)values(other_lead,current_setting('qa.other')::uuid,other_list,'Other fixture','other@fixture.example');
 begin insert into public.ideal_qualifications(lead_id,owner_id,run_id,report)values(other_lead,current_setting('qa.other')::uuid,current_setting('qa.run')::uuid,current_setting('qa.report')::jsonb);raise exception 'Cross-owner run relation accepted';exception when foreign_key_violation then null;end;
end $$;
delete from auth.users where id=current_setting('qa.owner')::uuid;
do $$begin if exists(select 1 from public.ideal_profiles where owner_id=current_setting('qa.owner')::uuid)or exists(select 1 from public.ideal_qualifications where owner_id=current_setting('qa.owner')::uuid)then raise exception 'Account deletion left ideal data';end if;end $$;
select 'Ideal ownership, required fields, qualified-only checkpoint, private evidence, immutable recipient context and deletion cascades passed' as result;
rollback;
