-- All fixture users and campaigns are rolled back. No campaign is launched or queued.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true),set_config('qa.upsert',gen_random_uuid()::text,true),set_config('qa.list',gen_random_uuid()::text,true),set_config('qa.other_list',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'campaign-qa-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'campaign-qa-'||current_setting('qa.other')||'@example.test');
insert into public.lead_lists(id,owner_id,name) values(current_setting('qa.list')::uuid,current_setting('qa.owner')::uuid,'Own QA list'),(current_setting('qa.other_list')::uuid,current_setting('qa.other')::uuid,'Other QA list');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$ declare saved uuid;begin
 -- This reproduces the previous client's failure, even when no conflicting row exists.
 begin
  insert into public.campaigns(id,owner_id,name) values(current_setting('qa.upsert')::uuid,auth.uid(),'Upsert regression') on conflict(id) do update set id=excluded.id,owner_id=excluded.owner_id,name=excluded.name;
  raise exception 'Protected-field upsert unexpectedly permitted';
 exception when insufficient_privilege then null;end;
 insert into public.campaigns(id,owner_id,name,list_id,messages,approved) values(current_setting('qa.campaign')::uuid,auth.uid(),'New QA campaign',current_setting('qa.list')::uuid,'[{"step":0,"subject":"Hello","body":"First","delay_hours":0},{"step":1,"subject":"Follow up","body":"Second","delay_hours":24},{"step":2,"subject":"Follow up","body":"Third","delay_hours":48},{"step":3,"subject":"Follow up","body":"Fourth","delay_hours":72}]',false) returning id into saved;
 if saved is distinct from current_setting('qa.campaign')::uuid then raise exception 'Plain campaign insert failed';end if;
 update public.campaigns set name='Reviewed QA campaign',approved=true,start_at=now()+interval '1 day' where id=saved returning id into saved;
 if saved is null or not exists(select 1 from public.campaigns where id=saved and status='draft' and approved=true and jsonb_array_length(messages)=4) then raise exception 'Campaign edit or approval failed';end if;
 begin update public.campaigns set status='running' where id=saved;raise exception 'Client could bypass server launch';exception when insufficient_privilege then null;end;
 begin update public.campaigns set owner_id=current_setting('qa.other')::uuid where id=saved;raise exception 'Client could change ownership';exception when insufficient_privilege then null;end;
 begin update public.campaigns set list_id=current_setting('qa.other_list')::uuid where id=saved;raise exception 'Cross-owner list allowed';exception when foreign_key_violation then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$ declare count_changed integer;begin
 if exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid) then raise exception 'Another user can read the campaign';end if;
 update public.campaigns set name='Tampered' where id=current_setting('qa.campaign')::uuid;get diagnostics count_changed=row_count;if count_changed<>0 then raise exception 'Another user can edit the campaign';end if;
end $$;
reset role;
select 'Upsert failure reproduced; draft insert, edit, approval and owner isolation passed' as result;
rollback;
