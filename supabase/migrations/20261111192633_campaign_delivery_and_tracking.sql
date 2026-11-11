-- Delivery is server-only. Campaign analytics obey the same owner isolation as campaigns.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table public.campaigns add column recipient_total integer,add column recipient_valid integer,add column launched_at timestamptz;
alter table public.campaign_recipients add column claimed_at timestamptz,add column claim_token uuid,add column last_sent_at timestamptz;
alter table public.campaign_recipients drop constraint campaign_recipients_status_check;
alter table public.campaign_recipients add constraint campaign_recipients_status_check check(status in ('pending','processing','sent','replied','bounced','suppressed','failed','uncertain'));
update public.campaigns c set recipient_total=(select count(*) from public.leads l where l.list_id=c.list_id and l.owner_id=c.owner_id),recipient_valid=(select count(*) from public.leads l where l.list_id=c.list_id and l.owner_id=c.owner_id and btrim(l.email)<>''),launched_at=case when c.status<>'draft' then coalesce((select min(r.created_at) from public.campaign_recipients r where r.campaign_id=c.id),c.created_at) end;
create table public.campaign_messages(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null,recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
 mailbox_id uuid not null,step integer not null check(step between 0 and 3),email_address text not null,
 state text not null default 'sending' check(state in ('sending','sent','failed','uncertain','bounced')),
 provider_message_id text,provider_thread_id text,attempt_count integer not null default 1,failure_count integer not null default 0,
 attempted_at timestamptz not null default now(),sent_at timestamptz,opened_at timestamptz,replied_at timestamptz,bounced_at timestamptz,
 last_error text,unique(recipient_id,step),
 foreign key(campaign_id,owner_id) references public.campaigns(id,owner_id) on delete cascade,
 foreign key(mailbox_id,owner_id) references public.mailboxes(id,owner_id)
);
create index campaign_messages_owner_campaign_idx on public.campaign_messages(owner_id,campaign_id);
create index campaign_messages_campaign_idx on public.campaign_messages(campaign_id);
create index campaign_messages_mailbox_idx on public.campaign_messages(mailbox_id);
create index campaign_messages_provider_idx on public.campaign_messages(mailbox_id,provider_message_id);
create index campaign_messages_thread_idx on public.campaign_messages(mailbox_id,provider_thread_id);
alter table public.campaign_messages enable row level security;
create policy owner_read on public.campaign_messages for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.campaign_messages from public,anon,authenticated;
grant select on public.campaign_messages to authenticated;
grant all on public.campaign_messages to service_role;
create table public.campaign_delivery_status(
 id boolean primary key default true check(id),last_run_at timestamptz,last_success_at timestamptz,last_error_code text,
 tracking_ready boolean not null default false,last_webhook_at timestamptz
);
insert into public.campaign_delivery_status(id) values(true);
alter table public.campaign_delivery_status enable row level security;
-- These global feature/worker timestamps contain no customer records or credentials.
create policy signed_in_health on public.campaign_delivery_status for select to authenticated using(true);
revoke all on public.campaign_delivery_status from public,anon,authenticated;
grant select on public.campaign_delivery_status to authenticated;
grant all on public.campaign_delivery_status to service_role;
create table aisas_private.email_events(id text primary key,event jsonb not null,processed boolean not null default false,received_at timestamptz not null default now());
alter table aisas_private.email_events enable row level security;
grant all on aisas_private.email_events to service_role;
create index email_events_pending_idx on aisas_private.email_events(received_at) where not processed;

create function public.aisas_claim_delivery_batch(p_campaign uuid default null)
returns setof public.campaign_recipients language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 -- A timed-out send must never be blindly retried: it might have reached the provider.
 update public.campaign_messages m set state='uncertain',last_error='Delivery confirmation timed out; check the sending mailbox before retrying.' where state='sending' and attempted_at<now()-interval '5 minutes';
 update public.campaign_recipients r set status='uncertain',last_error='Delivery confirmation unavailable; automatic resend prevented.',claim_token=null where status='processing' and (claimed_at is null or claimed_at<now()-interval '5 minutes') and (claimed_at is null or exists(select 1 from public.campaign_messages m where m.recipient_id=r.id and m.step=r.step));
 update public.campaign_recipients r set status='pending',claimed_at=null,claim_token=null where status='processing' and claimed_at<now()-interval '5 minutes' and not exists(select 1 from public.campaign_messages m where m.recipient_id=r.id and m.step=r.step);
 -- One initial email per address, even when several audience records share an office inbox.
 with ranked as (
  select r.id,row_number() over(partition by r.campaign_id,lower(btrim(l.email)) order by case when r.step>0 or r.status='processing' then 0 else 1 end,r.created_at,r.id) as position
  from public.campaign_recipients r join public.leads l on l.id=r.lead_id join public.campaigns c on c.id=r.campaign_id where c.status in ('running','scheduled')
 ) update public.campaign_recipients r set status='suppressed',last_error='Duplicate email address in this campaign; repeated delivery prevented.' from ranked x where r.id=x.id and x.position>1 and r.status='pending' and r.step=0;
 return query update public.campaign_recipients r set status='processing',claimed_at=now(),claim_token=gen_random_uuid() where r.id in (
  select q.id from public.campaign_recipients q join public.campaigns c on c.id=q.campaign_id
  where q.status='pending' and q.step<4 and q.next_send_at<=now() and c.status in ('running','scheduled') and c.approved and (c.start_at is null or c.start_at<=now()) and (p_campaign is null or c.id=p_campaign)
  order by q.next_send_at,q.id for update of q skip locked limit 5
 ) returning r.*;
end $$;

create function public.aisas_begin_campaign_send(p_recipient uuid,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.campaign_recipients;c public.campaigns;l public.leads;m public.campaign_messages;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.campaign_recipients where id=p_recipient for update;
 if not found or r.status<>'processing' or r.claim_token is distinct from p_claim then return null;end if;
 select * into c from public.campaigns where id=r.campaign_id;
 if not c.approved or c.status not in ('running','scheduled') or (c.start_at is not null and c.start_at>now()) then update public.campaign_recipients set status='pending',claim_token=null where id=r.id;return null;end if;
 select * into l from public.leads where id=r.lead_id;
 if btrim(l.email)='' or l.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or l.status in ('replied','unsubscribed') or exists(select 1 from public.leads opt where opt.owner_id=r.owner_id and lower(opt.email)=lower(l.email) and opt.status='unsubscribed') or l.email_verification_status='invalid' or exists(select 1 from public.campaign_messages old where old.owner_id=r.owner_id and lower(old.email_address)=lower(l.email) and old.bounced_at is not null) then
  update public.campaign_recipients set status='suppressed',last_error='No eligible email address, an invalid address, or a suppression applies.',claim_token=null where id=r.id;return null;
 end if;
 select * into m from public.campaign_messages where recipient_id=r.id and step=r.step;
 if found and m.state<>'failed' then update public.campaign_recipients set status='uncertain',last_error='A send already exists for this sequence step; automatic duplicate prevented.',claim_token=null where id=r.id;return null;end if;
 insert into public.campaign_messages(owner_id,campaign_id,recipient_id,mailbox_id,step,email_address)
 values(r.owner_id,c.id,r.id,c.mailbox_id,r.step,l.email)
 on conflict(recipient_id,step) do update set email_address=excluded.email_address,mailbox_id=excluded.mailbox_id,state='sending',attempted_at=now(),attempt_count=public.campaign_messages.attempt_count+1,last_error=null
 returning * into m;
 return jsonb_build_object('delivery_id',m.id,'lead',to_jsonb(l),'message',c.messages->r.step,'mailbox_id',c.mailbox_id,'thread_id',r.thread_id,'message_id',r.message_id,'step',r.step,'attempt_count',m.attempt_count);
end $$;

create function public.aisas_finish_campaign_send(p_delivery uuid,p_outcome text,p_provider_id text default null,p_thread_id text default null,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.campaign_messages;r public.campaign_recipients;c public.campaigns;next_step integer;delay_hours integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if p_outcome not in ('sent','failed','uncertain') then raise exception 'Invalid send outcome';end if;
 select * into m from public.campaign_messages where id=p_delivery for update;
 if not found then raise exception 'Delivery unavailable';end if;
 select * into r from public.campaign_recipients where id=m.recipient_id for update;
 select * into c from public.campaigns where id=m.campaign_id;
 if p_outcome='sent' then
  update public.campaign_messages set state=case when bounced_at is not null then 'bounced' else 'sent' end,sent_at=coalesce(sent_at,now()),provider_message_id=coalesce(provider_message_id,p_provider_id),provider_thread_id=coalesce(provider_thread_id,p_thread_id),last_error=null where id=m.id;
  if m.sent_at is null and r.step=m.step then
   next_step:=m.step+1;delay_hours:=coalesce((c.messages->next_step->>'delay_hours')::integer,0);
   update public.campaign_recipients set step=next_step,status=case when status in ('replied','bounced','suppressed') then status when next_step>=4 then 'sent' else 'pending' end,thread_id=coalesce(thread_id,p_thread_id),message_id=coalesce(message_id,p_provider_id),last_sent_at=now(),next_send_at=now()+make_interval(hours=>delay_hours),last_error=null,claim_token=null,claimed_at=null where id=r.id;
   update public.leads set status='contacted' where id=r.lead_id and status not in ('replied','unsubscribed');
  end if;
 else
  if m.state not in ('sent','bounced') then
   update public.campaign_messages set state=p_outcome,last_error=left(p_error,500),failure_count=failure_count+case when p_outcome='failed' and state<>'failed' then 1 else 0 end where id=m.id;
   update public.campaign_recipients set status=p_outcome,last_error=left(p_error,500),claim_token=null,claimed_at=null where id=r.id and status not in ('replied','bounced','suppressed');
  end if;
 end if;
end $$;

create function public.aisas_record_email_event(p_event jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.campaign_messages;e aisas_private.email_events;kind text:=p_event->>'kind';occurred timestamptz:=coalesce((p_event->>'at')::timestamptz,now());matched integer:=0;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if length(coalesce(p_event->>'id','')) not between 1 and 300 or kind not in ('opened','replied','bounced','sent','failed') then raise exception 'Invalid event';end if;
 insert into aisas_private.email_events(id,event) values(p_event->>'id',p_event) on conflict(id) do nothing;
 select * into e from aisas_private.email_events where id=p_event->>'id' for update;
 if e.processed then return jsonb_build_object('matched',true,'duplicate',true);end if;
 p_event:=e.event;kind:=p_event->>'kind';
 for m in select d.* from public.campaign_messages d join aisas_private.mailbox_credentials g on g.mailbox_id=d.mailbox_id
 where g.grant_id=p_event->>'grant_id' and (
  d.id::text=p_event->>'label'
  or (d.provider_message_id is not null and d.provider_message_id in (select jsonb_array_elements_text(coalesce(p_event->'message_ids','[]'::jsonb))))
  or (kind='replied' and d.provider_thread_id=p_event->>'thread_id' and (coalesce(p_event->>'sender','')='' or lower(d.email_address)=lower(p_event->>'sender')))
 )
 loop
  if kind='sent' then perform public.aisas_finish_campaign_send(m.id,'sent',p_event->>'provider_id',p_event->>'thread_id');
  elsif kind='opened' then
   if m.sent_at is null then perform public.aisas_finish_campaign_send(m.id,'sent',p_event->>'provider_id',p_event->>'thread_id');end if;
   update public.campaign_messages set opened_at=coalesce(opened_at,occurred) where id=m.id;
  elsif kind='replied' then
   if m.sent_at is null then perform public.aisas_finish_campaign_send(m.id,'sent',p_event->>'provider_id',p_event->>'thread_id');end if;
   update public.campaign_messages set replied_at=coalesce(replied_at,occurred) where id=m.id;
   update public.campaign_recipients set status='replied',claim_token=null where id=m.recipient_id;
   update public.leads set status='replied' where id=(select lead_id from public.campaign_recipients where id=m.recipient_id) and status<>'unsubscribed';
  elsif kind='bounced' then
   update public.campaign_messages set state='bounced',sent_at=coalesce(sent_at,occurred),bounced_at=coalesce(bounced_at,occurred),last_error='The receiving provider reported a bounce.' where id=m.id;
   update public.campaign_recipients set status='bounced',last_error='Recipient address bounced; follow-ups stopped.',claim_token=null where id=m.recipient_id;
  elsif kind='failed' then
   update public.campaign_messages set state='failed',failure_count=failure_count+case when state<>'failed' then 1 else 0 end,last_error='The email provider reported a send failure.' where id=m.id;
   update public.campaign_recipients set status=case when m.sent_at is null then 'failed' else 'uncertain' end,last_error='The email provider reported a send failure.',claim_token=null where id=m.recipient_id and status not in ('replied','bounced','suppressed');
  end if;
  matched:=matched+1;
 end loop;
 if matched>0 then update aisas_private.email_events set processed=true where id=e.id;end if;
 update public.campaign_delivery_status set last_webhook_at=now() where id;
 return jsonb_build_object('matched',matched>0);
end $$;

create function public.aisas_campaign_analytics(p_campaign uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select c.id,c.status,
 coalesce(c.recipient_total,(select count(*)::integer from public.leads l where l.list_id=c.list_id)) as total_recipients,
 coalesce(c.recipient_valid,(select count(*)::integer from public.leads l where l.list_id=c.list_id and btrim(l.email)<>'')) as valid_recipients,
 (select coalesce(sum(greatest(r.step,(select count(*) from public.campaign_messages m where m.recipient_id=r.id and m.sent_at is not null))),0)::integer from public.campaign_recipients r where r.campaign_id=c.id) as total_sent,
 ((select coalesce(sum(failure_count),0)::integer from public.campaign_messages m where m.campaign_id=c.id)+(select count(*)::integer from public.campaign_recipients r where r.campaign_id=c.id and r.status='failed' and not exists(select 1 from public.campaign_messages m where m.recipient_id=r.id and m.failure_count>0))) as total_fails,
 (select count(distinct recipient_id)::integer from public.campaign_messages m where m.campaign_id=c.id and bounced_at is not null) as bounce,
 (select count(distinct recipient_id)::integer from public.campaign_messages m where m.campaign_id=c.id and opened_at is not null) as read,
 (select count(*)::integer from public.campaign_recipients r where r.campaign_id=c.id and r.status='replied') as response,
 (select count(*)::integer from public.campaign_recipients r where r.campaign_id=c.id and r.status='pending') as pending,
 (select count(*)::integer from public.campaign_recipients r where r.campaign_id=c.id and r.status='processing') as processing,
 (select count(*)::integer from public.campaign_recipients r where r.campaign_id=c.id and r.status='uncertain') as uncertain,
 (select count(*)::integer from public.campaign_recipients r where r.campaign_id=c.id and r.status='suppressed') as suppressed,
 (select min(next_send_at) from public.campaign_recipients r where r.campaign_id=c.id and r.status='pending') as next_send_at,
 (select coalesce(jsonb_agg(z),'[]'::jsonb) from (select status,last_error from public.campaign_recipients r where r.campaign_id=c.id and r.last_error is not null order by r.created_at desc limit 3) z) as errors,
 h.last_run_at,h.last_success_at,h.last_error_code,h.tracking_ready from public.campaigns c cross join public.campaign_delivery_status h
 where c.owner_id=(select auth.uid()) and (p_campaign is null or c.id=p_campaign) order by c.created_at desc
 ) x;
$$;
revoke all on function public.aisas_claim_delivery_batch(uuid),public.aisas_begin_campaign_send(uuid,uuid),public.aisas_finish_campaign_send(uuid,text,text,text,text),public.aisas_record_email_event(jsonb) from public,anon,authenticated;
grant execute on function public.aisas_claim_delivery_batch(uuid),public.aisas_begin_campaign_send(uuid,uuid),public.aisas_finish_campaign_send(uuid,text,text,text,text),public.aisas_record_email_event(jsonb) to service_role;
revoke all on function public.aisas_campaign_analytics(uuid) from public,anon;
grant execute on function public.aisas_campaign_analytics(uuid) to authenticated;

create function public.aisas_email_webhook_secret() returns text language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 return (select decrypted_secret from vault.decrypted_secrets where name='aisas_NYLAS_WEBHOOK_SECRET' limit 1);
end $$;
revoke all on function public.aisas_email_webhook_secret() from public,anon,authenticated;
grant execute on function public.aisas_email_webhook_secret() to service_role;

create function public.aisas_reconcile_email_events() returns void language plpgsql security invoker set search_path='' as $$
declare e aisas_private.email_events;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 for e in select * from aisas_private.email_events where not processed and received_at>now()-interval '2 hours' order by received_at desc limit 50 loop perform public.aisas_record_email_event(e.event);end loop;
end $$;
create function public.aisas_complete_finished_campaigns() returns void language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 update public.campaigns c set status='completed' where c.status in ('running','scheduled') and exists(select 1 from public.campaign_recipients r where r.campaign_id=c.id) and not exists(select 1 from public.campaign_recipients r where r.campaign_id=c.id and r.status in ('pending','processing','failed','uncertain'));
end $$;
revoke all on function public.aisas_reconcile_email_events(),public.aisas_complete_finished_campaigns() from public,anon,authenticated;
grant execute on function public.aisas_reconcile_email_events(),public.aisas_complete_finished_campaigns() to service_role;

-- pg_cron never stores a literal credential in its job command.
create function aisas_private.request_campaign_dispatch(p_campaign uuid default null) returns bigint language plpgsql security definer set search_path='' as $$
declare secret text;begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='aisas_CRON_SECRET' limit 1;
 if coalesce(secret,'')='' then raise exception 'Dispatch credential missing';end if;
 return net.http_post(url:='https://beslhrcwojbxbqcvsnhy.supabase.co/functions/v1/campaign-dispatch',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:=jsonb_build_object('campaign_id',p_campaign),timeout_milliseconds:=110000);
end $$;
revoke all on function aisas_private.request_campaign_dispatch(uuid) from public,anon,authenticated;
grant execute on function aisas_private.request_campaign_dispatch(uuid) to service_role;
create function public.aisas_request_campaign_dispatch(p_campaign uuid default null) returns bigint language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 return aisas_private.request_campaign_dispatch(p_campaign);
end $$;
revoke all on function public.aisas_request_campaign_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.aisas_request_campaign_dispatch(uuid) to service_role;
-- Activate only after the worker and event handler have been deployed and checked.
select cron.schedule('aisas-campaign-dispatch','* * * * *','select aisas_private.request_campaign_dispatch();');
select cron.alter_job((select jobid from cron.job where jobname='aisas-campaign-dispatch'),active:=false);
