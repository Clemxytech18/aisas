-- Rolled-back fixtures only. Sends are simulated through SQL outcomes; no provider or dispatch HTTP call is made.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.list',gen_random_uuid()::text,true),set_config('qa.mailbox',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true),set_config('qa.small',gen_random_uuid()::text,true),set_config('qa.dst',gen_random_uuid()::text,true);
insert into auth.users(id,email)values(current_setting('qa.owner')::uuid,'daily-qa-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'daily-qa-'||current_setting('qa.other')||'@example.test');
insert into public.lead_lists(id,owner_id,name)values(current_setting('qa.list')::uuid,current_setting('qa.owner')::uuid,'Daily send fixture');
insert into public.mailboxes(id,owner_id,email,provider)values(current_setting('qa.mailbox')::uuid,current_setting('qa.owner')::uuid,'sender@fixture.example','custom');
insert into public.leads(owner_id,list_id,company,email)select current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid,'Fixture '||n,'daily'||n||'@fixture.example' from generate_series(1,200)n;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
insert into public.campaigns(id,owner_id,name,list_id,mailbox_id,daily_send_limit,send_timezone,messages,approved)values(current_setting('qa.campaign')::uuid,auth.uid(),'200 initial emails, 50 daily',current_setting('qa.list')::uuid,current_setting('qa.mailbox')::uuid,50,'Africa/Lagos','[{"step":0,"subject":"First","body":"Hello","delay_hours":0},{"step":1,"subject":"Next","body":"Follow up","delay_hours":48},{"step":2,"subject":"Next","body":"Follow up","delay_hours":72},{"step":3,"subject":"Last","body":"Follow up","delay_hours":120}]',true);
do $$begin
 begin update public.campaigns set daily_send_limit=0 where id=current_setting('qa.campaign')::uuid;raise exception 'Zero limit allowed';exception when check_violation then null;end;
 begin update public.campaigns set daily_send_limit=10001 where id=current_setting('qa.campaign')::uuid;raise exception 'Invalid high limit allowed';exception when check_violation then null;end;
 begin update public.campaigns set send_timezone='not-a-timezone' where id=current_setting('qa.campaign')::uuid;raise exception 'Invalid timezone allowed';exception when check_violation then null;end;
 begin insert into public.campaign_messages(owner_id,campaign_id,recipient_id,mailbox_id,step,email_address)values(auth.uid(),current_setting('qa.campaign')::uuid,gen_random_uuid(),current_setting('qa.mailbox')::uuid,0,'fake@fixture.example');raise exception 'Client could forge successful send totals';exception when insufficient_privilege then null;end;
 begin perform public.aisas_claim_delivery_batch(current_setting('qa.campaign')::uuid);raise exception 'Client could bypass delivery worker';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$begin
 update public.campaigns set daily_send_limit=100 where id=current_setting('qa.campaign')::uuid;if found then raise exception 'Another owner changed the cap';end if;
 if exists(select 1 from aisas_private.campaign_daily_usage(current_setting('qa.campaign')::uuid))then raise exception 'Private daily usage exposed';end if;
end $$;
reset role;
update public.campaigns set status='running',launched_at=now() where id=current_setting('qa.campaign')::uuid;
insert into public.campaign_recipients(owner_id,campaign_id,lead_id,next_send_at)select owner_id,current_setting('qa.campaign')::uuid,id,now()-interval '1 hour' from public.leads where list_id=current_setting('qa.list')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare day integer;batch integer;r public.campaign_recipients;payload jsonb;quota record;local_day date;sent_count integer;
begin
 local_day:=(now() at time zone 'Africa/Lagos')::date;
 for day in 1..4 loop
  sent_count:=0;
  for batch in 1..10 loop
   for r in select * from public.aisas_claim_delivery_batch(current_setting('qa.campaign')::uuid) loop
    payload:=public.aisas_begin_campaign_send(r.id,r.claim_token);
    if payload is null then raise exception 'Available daily slot was blocked';end if;
    perform public.aisas_finish_campaign_send((payload->>'delivery_id')::uuid,'sent','fixture-provider-'||r.id,'fixture-thread-'||r.id);
    sent_count:=sent_count+1;
   end loop;
  end loop;
  if sent_count<>50 then raise exception 'Daily successful count was %, expected 50',sent_count;end if;
  select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.campaign')::uuid);
  if quota.daily_sent<>50 or quota.daily_reserved<>0 or quota.daily_remaining<>0 or quota.resume_at is null then raise exception 'Daily quota summary incorrect';end if;
  if exists(select 1 from public.aisas_claim_delivery_batch(current_setting('qa.campaign')::uuid))then raise exception '51st email could be claimed';end if;
  -- Advance fixture confirmations into the preceding three calendar days, without changing the server clock.
  if day<4 then update public.campaign_messages set sent_at=((local_day-(4-day))::timestamp+interval '12 hours')at time zone 'Africa/Lagos' where campaign_id=current_setting('qa.campaign')::uuid and sent_at>=quota.day_start and sent_at<quota.day_end;end if;
 end loop;
 for day in 1..4 loop
  select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.campaign')::uuid,((local_day-(4-day))::timestamp+interval '15 hours')at time zone 'Africa/Lagos');
  if quota.daily_sent<>50 then raise exception 'Calendar-day rollover did not preserve 50 successes on day %',day;end if;
 end loop;
 if (select count(*) from public.campaign_messages where campaign_id=current_setting('qa.campaign')::uuid and sent_at is not null)<>200 then raise exception '200-recipient outreach incomplete';end if;
 if exists(select 1 from public.campaign_recipients where campaign_id=current_setting('qa.campaign')::uuid and step<>1)then raise exception 'Recipients advanced more than once';end if;
 if not exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid and status='running')then raise exception 'Daily cap prematurely completed campaign';end if;
end $$;
reset role;
insert into public.campaigns(id,owner_id,name,list_id,mailbox_id,daily_send_limit,send_timezone,status,approved,messages)select current_setting('qa.small')::uuid,owner_id,'Follow-up and failed send slots',list_id,mailbox_id,2,'Africa/Lagos','running',true,messages from public.campaigns where id=current_setting('qa.campaign')::uuid;
insert into public.campaign_recipients(owner_id,campaign_id,lead_id,step,next_send_at)select owner_id,current_setting('qa.small')::uuid,id,case when n=1 then 0 else 1 end,now()-interval '1 hour' from(select l.*,row_number()over(order by id)n from public.leads l where list_id=current_setting('qa.list')::uuid)x where n<=3;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare ids uuid[];r public.campaign_recipients;a jsonb;b jsonb;c jsonb;quota record;
begin
 select array_agg(id order by step,id) into ids from public.aisas_claim_delivery_batch(current_setting('qa.small')::uuid);
 if cardinality(ids)<>3 then raise exception 'Pre-claim fixture missing';end if;
 select * into r from public.campaign_recipients where id=ids[1];a:=public.aisas_begin_campaign_send(r.id,r.claim_token);
 select * into r from public.campaign_recipients where id=ids[2];b:=public.aisas_begin_campaign_send(r.id,r.claim_token);
 select * into r from public.campaign_recipients where id=ids[3];c:=public.aisas_begin_campaign_send(r.id,r.claim_token);
 if a is null or b is null or c is not null then raise exception 'Overlapping workers exceeded reserved capacity';end if;
 select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.small')::uuid);
 if quota.daily_sent<>0 or quota.daily_reserved<>2 or quota.daily_remaining<>0 then raise exception 'In-flight reservation count failed';end if;
 perform public.aisas_finish_campaign_send((a->>'delivery_id')::uuid,'failed',null,null,'Definite provider rejection');
 select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.small')::uuid);
 if quota.daily_sent<>0 or quota.daily_reserved<>1 or quota.daily_remaining<>1 then raise exception 'Rejected attempt consumed a success slot';end if;
 select * into r from public.aisas_claim_delivery_batch(current_setting('qa.small')::uuid);
 c:=public.aisas_begin_campaign_send(r.id,r.claim_token);
 if c is null then raise exception 'Released slot did not resume queued recipient';end if;
 perform public.aisas_finish_campaign_send((b->>'delivery_id')::uuid,'sent','followup-b','thread-b');
 perform public.aisas_finish_campaign_send((c->>'delivery_id')::uuid,'sent','followup-c','thread-c');
 perform public.aisas_finish_campaign_send((b->>'delivery_id')::uuid,'sent','followup-b','thread-b');
 select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.small')::uuid);
 if quota.daily_sent<>2 or quota.daily_remaining<>0 then raise exception 'Follow-ups were not counted exactly once';end if;
 update public.campaign_messages set state='uncertain',attempted_at=now()-interval '2 days' where id=(a->>'delivery_id')::uuid;
 select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.small')::uuid,now()+interval '1 day');
 if quota.daily_sent<>0 or quota.daily_reserved<>1 or quota.daily_remaining<>1 then raise exception 'Unconfirmed prior-day send was forgotten';end if;
 update public.campaigns set daily_send_limit=null where id=current_setting('qa.small')::uuid;
 select * into quota from aisas_private.campaign_daily_usage(current_setting('qa.small')::uuid);
 if quota.daily_limit is not null or quota.daily_remaining is not null then raise exception 'Legacy unlimited setting changed behavior';end if;
end $$;
reset role;
update public.campaigns set status='paused' where id=current_setting('qa.campaign')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$declare analytics jsonb;begin
 update public.campaigns set daily_send_limit=25 where id=current_setting('qa.campaign')::uuid;
 begin update public.campaigns set send_timezone='UTC' where id=current_setting('qa.campaign')::uuid;raise exception 'Launched timezone changed';exception when check_violation then null;end;
 analytics:=public.aisas_campaign_analytics(current_setting('qa.campaign')::uuid)->0;
 if (analytics->>'daily_send_limit')::integer<>25 or (analytics->>'daily_sent')::integer<>50 or analytics->>'send_timezone'<>'Africa/Lagos' then raise exception 'Owner analytics lost daily progress';end if;
 begin update public.campaigns set status='running' where id=current_setting('qa.campaign')::uuid;raise exception 'Client could bypass server launch';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.campaigns(id,owner_id,name,daily_send_limit,send_timezone)values(current_setting('qa.dst')::uuid,current_setting('qa.owner')::uuid,'Daylight saving fixture',50,'America/New_York');
do $$declare q record;begin
 select * into q from aisas_private.campaign_daily_usage(current_setting('qa.dst')::uuid,'2026-03-08 16:00:00+00');if q.day_end-q.day_start<>interval '23 hours' then raise exception 'Spring DST reset is wrong';end if;
 select * into q from aisas_private.campaign_daily_usage(current_setting('qa.dst')::uuid,'2026-11-01 16:00:00+00');if q.day_end-q.day_start<>interval '25 hours' then raise exception 'Autumn DST reset is wrong';end if;
end $$;
select 'Daily 50/200 rollover, all-message caps, in-flight reservations, failed-send release, uncertainty, timezone/DST, owner isolation and editable settings passed' as result;
rollback;
