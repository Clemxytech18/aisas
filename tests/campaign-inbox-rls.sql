-- Transaction-only fixtures. No emails, provider requests, or persistent test accounts.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.list',gen_random_uuid()::text,true),set_config('qa.box',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true),set_config('qa.lead',gen_random_uuid()::text,true),set_config('qa.recipient',gen_random_uuid()::text,true),set_config('qa.request',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'inbox-owner-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'inbox-other-'||current_setting('qa.other')||'@example.test');
insert into public.lead_lists(id,owner_id,name) values(current_setting('qa.list')::uuid,current_setting('qa.owner')::uuid,'Inbox QA');
insert into public.leads(id,owner_id,list_id,company,contact_name,email) values(current_setting('qa.lead')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid,'Fixture Company','Ada','ada@fixture.example');
insert into public.mailboxes(id,owner_id,email,provider) values(current_setting('qa.box')::uuid,current_setting('qa.owner')::uuid,'sender@fixture.example','google');
insert into public.campaigns(id,owner_id,name,list_id,mailbox_id) values(current_setting('qa.campaign')::uuid,current_setting('qa.owner')::uuid,'Inbox QA',current_setting('qa.list')::uuid,current_setting('qa.box')::uuid);
insert into public.campaign_recipients(id,owner_id,campaign_id,lead_id,status,step,thread_id) values(current_setting('qa.recipient')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.campaign')::uuid,current_setting('qa.lead')::uuid,'sent',4,'qa-thread');
insert into public.campaign_messages(owner_id,campaign_id,recipient_id,mailbox_id,step,email_address,state,provider_message_id,provider_thread_id,sent_at) values(current_setting('qa.owner')::uuid,current_setting('qa.campaign')::uuid,current_setting('qa.recipient')::uuid,current_setting('qa.box')::uuid,0,'ada@fixture.example','sent','qa-original','qa-thread',now()-interval '2 hours');
-- A historical engagement timestamp is a sync hint, not proof of incoming content.
update public.campaign_messages set replied_at=now()-interval '90 minutes' where recipient_id=current_setting('qa.recipient')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.aisas_seed_campaign_inbox(current_setting('qa.owner')::uuid);
do $$ declare c uuid:=current_setting('qa.recipient')::uuid;msgs jsonb;summary jsonb;request jsonb;message uuid;before_read timestamptz;
begin
 if (select count(*) from public.campaign_conversations where id=c)<>1 then raise exception 'Conversation not seeded from delivery';end if;
 if (select last_reply_at from public.campaign_conversations where id=c) is not null then raise exception 'A delivery signal was counted before an incoming message synced';end if;
 perform public.aisas_seed_campaign_inbox(current_setting('qa.owner')::uuid);
 if (select count(*) from public.campaign_conversations where id=c)<>1 then raise exception 'Duplicate seed';end if;
 msgs:=jsonb_build_array(jsonb_build_object('provider_message_id','qa-incoming','direction','inbound','from_email','ada@fixture.example','from_name','Ada','subject','Re: Original','body_text','Can you share details?','received_at',now()-interval '1 hour','reply_reference','qa-incoming'));
 perform public.aisas_store_inbox_messages(c,msgs);perform public.aisas_store_inbox_messages(c,msgs);
 if (select count(*) from public.campaign_inbox_messages where conversation_id=c)<>1 then raise exception 'Duplicate webhook created duplicate messages';end if;
 if (select status from public.campaign_recipients where id=c)<>'replied' then raise exception 'Completed recipient reply not tracked';end if;
 if (select status from public.leads where id=current_setting('qa.lead')::uuid)<>'replied' then raise exception 'Responder not marked';end if;
 summary:=public.aisas_inbox_summary(current_setting('qa.owner')::uuid);
 if (summary->>'responses')::integer<>1 or (summary->>'responders')::integer<>1 or (summary->>'unread')::integer<>1 or (summary->>'awaiting')::integer<>1 then raise exception 'Incorrect inbox summary %',summary;end if;
 select id into message from public.campaign_inbox_messages where conversation_id=c;
 request:=public.aisas_begin_inbox_reply(current_setting('qa.owner')::uuid,c,current_setting('qa.request')::uuid,message,'A real answer');
 if not (request->>'claimed')::boolean then raise exception 'Reply not reserved';end if;
 request:=public.aisas_begin_inbox_reply(current_setting('qa.owner')::uuid,c,current_setting('qa.request')::uuid,message,'A real answer');
 if (request->>'claimed')::boolean then raise exception 'Duplicate reply reservation sent twice';end if;
 begin
  perform public.aisas_begin_inbox_reply(current_setting('qa.owner')::uuid,c,gen_random_uuid(),message,'Second answer');
  raise exception 'Two concurrent replies allowed';
 exception when raise_exception then if sqlerrm='Two concurrent replies allowed' then raise;end if;end;
 update public.campaign_reply_sends set state='sent' where id=current_setting('qa.request')::uuid;
 perform public.aisas_store_inbox_messages(c,jsonb_build_array(jsonb_build_object('provider_message_id','qa-outgoing','direction','outbound','from_email','sender@fixture.example','subject','Re: Original','body_text','A real answer','received_at',now()-interval '30 minutes','reply_reference','qa-outgoing')));
 if (public.aisas_inbox_summary(current_setting('qa.owner')::uuid)->>'awaiting')::integer<>0 then raise exception 'Sent answer still needs reply';end if;
 perform public.aisas_read_inbox(current_setting('qa.owner')::uuid,c,now());
 select last_read_at into before_read from public.campaign_conversations where id=c;
 perform public.aisas_read_inbox(current_setting('qa.owner')::uuid,c,now()-interval '1 day');
 if (select last_read_at from public.campaign_conversations where id=c)<>before_read then raise exception 'Read timestamp regressed';end if;
 perform public.aisas_store_inbox_messages(c,jsonb_build_array(jsonb_build_object('provider_message_id','qa-new-incoming','direction','inbound','from_email','ada@fixture.example','subject','Re: Original','body_text','Thanks, one more question','received_at',now(),'reply_reference','qa-new-incoming')));
 if (public.aisas_inbox_summary(current_setting('qa.owner')::uuid)->>'unread')::integer<>1 then raise exception 'New response was incorrectly marked read';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$begin
 if (select count(*) from public.campaign_inbox_messages where conversation_id=current_setting('qa.recipient')::uuid)<>3 then raise exception 'Owner cannot read history';end if;
 if has_table_privilege('authenticated','public.campaign_inbox_messages','INSERT') or has_table_privilege('authenticated','public.campaign_reply_sends','UPDATE') then raise exception 'Client can forge messages or delivery';end if;
 if has_function_privilege('authenticated','public.aisas_begin_inbox_reply(uuid,uuid,uuid,uuid,text)','EXECUTE') or has_function_privilege('anon','public.aisas_store_inbox_messages(uuid,jsonb)','EXECUTE') then raise exception 'Service RPC exposed';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$begin
 if exists(select 1 from public.campaign_conversations where id=current_setting('qa.recipient')::uuid) or exists(select 1 from public.campaign_inbox_messages where conversation_id=current_setting('qa.recipient')::uuid) or exists(select 1 from public.campaign_reply_sends where conversation_id=current_setting('qa.recipient')::uuid) then raise exception 'Cross-owner inbox data exposed';end if;
end $$;
reset role;
select 'Inbox deduplication, response tracking, unread state, reply reservation and owner isolation passed' as result;
rollback;
