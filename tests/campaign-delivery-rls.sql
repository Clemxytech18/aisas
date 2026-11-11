-- Rollback-only delivery/event/analytics fixtures. This never calls a provider or dispatch HTTP request.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.list',gen_random_uuid()::text,true),set_config('qa.mailbox',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'delivery-qa-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'delivery-qa-'||current_setting('qa.other')||'@example.test');
insert into public.lead_lists(id,owner_id,name) values(current_setting('qa.list')::uuid,current_setting('qa.owner')::uuid,'Delivery QA');
insert into public.mailboxes(id,owner_id,email,provider) values(current_setting('qa.mailbox')::uuid,current_setting('qa.owner')::uuid,'sender@fixture.example','google');
insert into public.leads(owner_id,list_id,company,contact_name,email) select current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid,'Fixture practice',name,email from (values('One','one@fixture.example'),('Two','two@fixture.example'),('Three','three@fixture.example'),('Duplicate One','one@fixture.example'),('Phone only','')) x(name,email);
insert into public.campaigns(id,owner_id,name,list_id,mailbox_id,status,approved,recipient_total,recipient_valid,messages) values(current_setting('qa.campaign')::uuid,current_setting('qa.owner')::uuid,'Delivery QA',current_setting('qa.list')::uuid,current_setting('qa.mailbox')::uuid,'running',true,5,4,'[{"step":0,"subject":"First","body":"Hello","delay_hours":0},{"step":1,"subject":"Follow up","body":"Follow up","delay_hours":24},{"step":2,"subject":"Follow up","body":"Follow up","delay_hours":48},{"step":3,"subject":"Follow up","body":"Follow up","delay_hours":72}]');
insert into public.campaign_recipients(owner_id,campaign_id,lead_id) select owner_id,current_setting('qa.campaign')::uuid,id from public.leads where list_id=current_setting('qa.list')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.aisas_set_grant(current_setting('qa.mailbox')::uuid,'qa-delivery-grant');
do $$ declare claimed integer;r public.campaign_recipients;delivery jsonb;a uuid;b uuid;c uuid;result jsonb;count_sent integer;event jsonb;
begin
 select count(*) into claimed from public.aisas_claim_delivery_batch(current_setting('qa.campaign')::uuid);
 if claimed<>4 then raise exception 'Duplicate address not suppressed or claim count wrong: %',claimed;end if;
 if exists(select 1 from public.aisas_claim_delivery_batch(current_setting('qa.campaign')::uuid)) then raise exception 'Overlapping worker claimed the same recipients';end if;
 for r in select q.* from public.campaign_recipients q join public.leads l on l.id=q.lead_id where q.campaign_id=current_setting('qa.campaign')::uuid and q.status='processing' order by l.email
 loop
  delivery:=public.aisas_begin_campaign_send(r.id,r.claim_token);
  if (select email from public.leads where id=r.lead_id)='' then
   if delivery is not null then raise exception 'Contactless lead could be sent';end if;continue;
  end if;
  if delivery is null then raise exception 'Eligible send was not prepared';end if;
  if (select email from public.leads where id=r.lead_id)='one@fixture.example' then a:=(delivery->>'delivery_id')::uuid;
  elsif (select email from public.leads where id=r.lead_id)='two@fixture.example' then b:=(delivery->>'delivery_id')::uuid;
  else c:=(delivery->>'delivery_id')::uuid;end if;
 end loop;
 if a is null or b is null or c is null then raise exception 'Prepared deliveries missing';end if;
 -- A signed-but-unrelated grant cannot attribute engagement to another customer's send.
 perform public.aisas_record_email_event(jsonb_build_object('id','qa-wrong-'||a,'kind','opened','grant_id','other-grant','label',a,'message_ids','[]'::jsonb,'at',now()));
 if exists(select 1 from public.campaign_messages where id=a and opened_at is not null) then raise exception 'Cross-grant event attribution allowed';end if;
 -- Open can race ahead of the send response; it confirms delivery exactly once.
 event:=jsonb_build_object('id','qa-open-'||a,'kind','opened','grant_id','qa-delivery-grant','label',a,'provider_id','provider-a','thread_id','thread-a','message_ids',jsonb_build_array('provider-a'),'at',now());
 perform public.aisas_record_email_event(event);perform public.aisas_record_email_event(event);
 perform public.aisas_finish_campaign_send(a,'sent','provider-a','thread-a');
 if (select step from public.campaign_recipients where id=(select recipient_id from public.campaign_messages where id=a))<>1 then raise exception 'Duplicate confirmation advanced the sequence twice';end if;
 if not exists(select 1 from public.campaign_recipients where id=(select recipient_id from public.campaign_messages where id=a) and next_send_at>now()+interval '23 hours') then raise exception 'Follow-up delay not applied';end if;
 perform public.aisas_record_email_event(jsonb_build_object('id','qa-reply-'||a,'kind','replied','grant_id','qa-delivery-grant','thread_id','thread-a','sender','one@fixture.example','message_ids','[]'::jsonb,'at',now()));
 perform public.aisas_finish_campaign_send(b,'sent','provider-b','thread-b');
 perform public.aisas_record_email_event(jsonb_build_object('id','qa-bounce-'||b,'kind','bounced','grant_id','qa-delivery-grant','message_ids',jsonb_build_array('provider-b'),'at',now()));
 perform public.aisas_finish_campaign_send(c,'uncertain',null,null,'Timeout');
 if (select status from public.campaign_recipients where id=(select recipient_id from public.campaign_messages where id=c))<>'uncertain' then raise exception 'Ambiguous send was eligible for duplicate delivery';end if;
 perform public.aisas_record_email_event(jsonb_build_object('id','qa-success-'||c,'kind','sent','grant_id','qa-delivery-grant','label',c,'provider_id','provider-c','thread_id','thread-c','message_ids','[]'::jsonb,'at',now()));
 perform public.aisas_record_email_event(jsonb_build_object('id','qa-failure-'||c,'kind','failed','grant_id','qa-delivery-grant','message_ids',jsonb_build_array('provider-c'),'at',now()));
 perform public.aisas_record_email_event(jsonb_build_object('id','qa-failure-'||c,'kind','failed','grant_id','qa-delivery-grant','message_ids',jsonb_build_array('provider-c'),'at',now()));
 if exists(select 1 from public.aisas_claim_delivery_batch(current_setting('qa.campaign')::uuid)) then raise exception 'Replied, bounced or uncertain recipient was re-sent';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$ declare a jsonb;begin
 a:=public.aisas_campaign_analytics(current_setting('qa.campaign')::uuid)->0;
 if (a->>'total_recipients')::integer<>5 or (a->>'valid_recipients')::integer<>4 or (a->>'total_sent')::integer<>3 or (a->>'total_fails')::integer<>1 or (a->>'bounce')::integer<>1 or (a->>'read')::integer<>1 or (a->>'response')::integer<>1 or (a->>'uncertain')::integer<>1 then raise exception 'Analytics aggregation failed: %',a;end if;
 begin perform public.aisas_claim_delivery_batch();raise exception 'Client could claim delivery work';exception when insufficient_privilege then null;end;
 begin perform public.aisas_request_campaign_dispatch();raise exception 'Client could invoke delivery HTTP';exception when insufficient_privilege then null;end;
 begin perform public.aisas_email_webhook_secret();raise exception 'Client could read webhook credential';exception when insufficient_privilege then null;end;
 begin insert into public.campaign_messages(owner_id,campaign_id,recipient_id,mailbox_id,step,email_address) values(auth.uid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,'fake@fixture.example');raise exception 'Client could forge sent analytics';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$ begin
 if jsonb_array_length(public.aisas_campaign_analytics(current_setting('qa.campaign')::uuid))<>0 then raise exception 'Another user can read campaign metrics';end if;
 if exists(select 1 from public.campaign_messages where campaign_id=current_setting('qa.campaign')::uuid) then raise exception 'Another user can read delivery records';end if;
end $$;
reset role;
select 'Delivery claims, duplicate prevention, delays, event races, counts and owner isolation passed' as result;
rollback;
