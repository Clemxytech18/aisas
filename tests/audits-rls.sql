-- Transaction-only fixtures. No provider calls or campaign launches; all rows roll back.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.list',gen_random_uuid()::text,true),set_config('qa.lead1',gen_random_uuid()::text,true),set_config('qa.lead2',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true),set_config('qa.recipient',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'audit-owner-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'audit-other-'||current_setting('qa.other')||'@example.test');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.aisas_save_audit_list(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid,'Audit QA','ai',jsonb_build_array(
 jsonb_build_object('id',current_setting('qa.lead1'),'first_name','Ada','email','ada-'||current_setting('qa.owner')||'@fixture.example','company','Private audit QA '||current_setting('qa.owner'),'website','https://fixture.example','source_url','https://fixture.example/contact'),
 jsonb_build_object('id',current_setting('qa.lead2'),'first_name','Joe','email','joe-'||current_setting('qa.owner')||'@fixture.example','company','Private audit QA '||current_setting('qa.owner'),'website','https://fixture.example','source_url','https://fixture.example/contact')));
do $$declare first jsonb;second jsonb;result jsonb:=jsonb_build_object('cro_performance','A clear action could help.','social_performance','Not assessed; no links supplied.','issues','Booking action needs review.','best_offer','a focused booking-page improvement','evidence','[]'::jsonb,'findings','[]'::jsonb,'limitations','[]'::jsonb);begin
 if exists(select 1 from public.prospect_pool where company='Private audit QA '||current_setting('qa.owner')) then raise exception 'Private audit contacts leaked into shared search';end if;
 begin
  perform public.aisas_save_audit_list(current_setting('qa.other')::uuid,current_setting('qa.list')::uuid,'Stolen','manual',(select jsonb_agg(to_jsonb(l)) from public.leads l where l.list_id=current_setting('qa.list')::uuid),null);
  raise exception 'Cross-owner overwrite allowed';
 exception when unique_violation then null;end;
 perform public.aisas_start_audit(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid);
 first:=public.aisas_claim_audit(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid);
 second:=public.aisas_claim_audit(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid);
 if first->'lead'->>'id'=second->'lead'->>'id' then raise exception 'Concurrent workers claimed same lead';end if;
 if public.aisas_finish_audit((first->'lead'->>'id')::uuid,gen_random_uuid(),result) then raise exception 'Stale lease accepted';end if;
 if not public.aisas_finish_audit((first->'lead'->>'id')::uuid,(first->>'lease')::uuid,result) then raise exception 'Owned lease rejected';end if;
 if (select status from public.audit_lists where id=current_setting('qa.list')::uuid)<>'auditing' then raise exception 'List completed too early';end if;
 perform public.aisas_finish_audit((second->'lead'->>'id')::uuid,(second->>'lease')::uuid,result);
 if (select status from public.audit_lists where id=current_setting('qa.list')::uuid)<>'audited' then raise exception 'Completed list unavailable for campaigns';end if;
 if jsonb_array_length(public.aisas_search_audit_leads(current_setting('qa.owner')::uuid,'booking',0,true)->'rows')<>2 then raise exception 'Audit findings not searchable';end if;
 if jsonb_array_length(public.aisas_search_audit_leads(current_setting('qa.other')::uuid,'',0,false)->'rows')<>0 then raise exception 'Private search leaked contacts';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$begin
 if (select count(lead_id) from public.audit_reports where list_id=current_setting('qa.list')::uuid)<>2 then raise exception 'Owner cannot read results';end if;
 if has_table_privilege('authenticated','public.audit_reports','INSERT') or has_column_privilege('authenticated','public.audit_reports','lease_token','SELECT') or has_column_privilege('authenticated','public.audit_discovery_runs','state','SELECT') then raise exception 'Internal audit controls exposed';end if;
 if has_function_privilege('authenticated','public.aisas_finish_audit(uuid,uuid,jsonb,text)','EXECUTE') or has_function_privilege('anon','public.aisas_save_audit_list(uuid,uuid,text,text,jsonb,integer)','EXECUTE') then raise exception 'Server RPC exposed';end if;
 insert into public.campaigns(id,owner_id,name,list_id,list_source) values(current_setting('qa.campaign')::uuid,auth.uid(),'Audited QA',current_setting('qa.list')::uuid,'audited');
 if (select profile_id from public.campaigns where id=current_setting('qa.campaign')::uuid) is not null then raise exception 'Audited campaign unexpectedly requires service profile';end if;
 begin
  insert into public.campaigns(id,owner_id,name,list_id,list_source) values(gen_random_uuid(),auth.uid(),'Wrong source',current_setting('qa.list')::uuid,'audience');
  raise exception 'Audit list accepted as ordinary audience';
 exception when raise_exception then if sqlerrm='Audit list accepted as ordinary audience' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$begin
 if exists(select 1 from public.audit_lists where id=current_setting('qa.list')::uuid) or exists(select 1 from public.audit_reports where list_id=current_setting('qa.list')::uuid) or exists(select 1 from public.leads where list_id=current_setting('qa.list')::uuid) then raise exception 'Another account can read private lists';end if;
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.campaign_recipients(id,owner_id,campaign_id,lead_id,audit_context) values(current_setting('qa.recipient')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.campaign')::uuid,current_setting('qa.lead1')::uuid,'{"best_offer":"forged"}');
do $$declare claim jsonb;begin
 if (select audit_context->>'best_offer' from public.campaign_recipients where id=current_setting('qa.recipient')::uuid)<>'a focused booking-page improvement' then raise exception 'Caller forged recipient snapshot';end if;
 update public.audit_reports set best_offer='a later offer' where lead_id=current_setting('qa.lead1')::uuid;
 if (select audit_context->>'best_offer' from public.campaign_recipients where id=current_setting('qa.recipient')::uuid)<>'a focused booking-page improvement' then raise exception 'Recipient context changed after launch';end if;
 update public.campaigns set status='running' where id=current_setting('qa.campaign')::uuid;
 begin
  update public.leads set website='https://changed.example' where id=current_setting('qa.lead1')::uuid;
  raise exception 'Active campaign lead editing allowed';
 exception when raise_exception then if sqlerrm='Active campaign lead editing allowed' then raise;end if;end;
 update public.campaigns set status='paused' where id=current_setting('qa.campaign')::uuid;
 perform public.aisas_start_audit(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid);
 claim:=public.aisas_claim_audit(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid);
 update public.leads set website='https://changed.example' where id=(claim->'lead'->>'id')::uuid;
 if (select status from public.audit_lists where id=current_setting('qa.list')::uuid)<>'ready' then raise exception 'Edited website did not invalidate list';end if;
 if public.aisas_finish_audit((claim->'lead'->>'id')::uuid,(claim->>'lease')::uuid,null,'stale') then raise exception 'Stale worker overwrote edited lead';end if;
 begin
  perform public.aisas_save_audit_list(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid,'Stale edit','ai',(select jsonb_agg(to_jsonb(l)) from public.leads l where l.list_id=current_setting('qa.list')::uuid),1);
  raise exception 'Stale list revision accepted';
 exception when raise_exception then if sqlerrm='Stale list revision accepted' then raise;end if;end;
 update public.audit_reports set status='processing',attempts=5,lease_until=now()-interval '1 minute' where list_id=current_setting('qa.list')::uuid;
 update public.audit_lists set status='auditing' where id=current_setting('qa.list')::uuid;
 if public.aisas_claim_audit(current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid) is not null then raise exception 'Exhausted worker was reclaimed';end if;
 if (select status from public.audit_lists where id=current_setting('qa.list')::uuid)<>'partial' then raise exception 'Interrupted audit never settled';end if;
end $$;
reset role;
select 'Audit privacy, search, leases, invalidation, campaign selection and recipient snapshots passed' as result;
rollback;
