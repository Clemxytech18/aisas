-- Conversations are separate from the sequence delivery ledger: human replies never
-- advance sequence steps or consume campaign daily-send slots.
alter table public.campaign_recipients add constraint campaign_recipients_id_owner_unique unique(id,owner_id);
create table public.campaign_conversations (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null, mailbox_id uuid not null, thread_id text not null,
 contact_email text not null,contact_name text not null default '',company text not null default '',
 last_message_at timestamptz not null default now(),last_preview text not null default '',
 last_reply_at timestamptz,last_outbound_at timestamptz,last_read_at timestamptz,
 reply_count integer not null default 0,last_sender_name text not null default '',last_sender_email text not null default '',
 synced_at timestamptz,sync_cursor text,sync_error text,unique(id,owner_id),
 foreign key(id,owner_id) references public.campaign_recipients(id,owner_id) on delete cascade,
 foreign key(campaign_id,owner_id) references public.campaigns(id,owner_id) on delete cascade,
 foreign key(mailbox_id,owner_id) references public.mailboxes(id,owner_id)
);
create index campaign_conversations_owner_latest on public.campaign_conversations(owner_id,last_message_at desc,id);
create index campaign_conversations_campaign_idx on public.campaign_conversations(campaign_id,owner_id);
create index campaign_conversations_mailbox_thread on public.campaign_conversations(mailbox_id,thread_id);
create index campaign_conversations_sync on public.campaign_conversations(synced_at nulls first);
create table public.campaign_inbox_messages (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,
 conversation_id uuid not null,provider_message_id text not null,
 direction text not null check(direction in ('inbound','outbound')),
 from_email text not null,from_name text not null default '',to_emails jsonb not null default '[]',
 subject text not null,body_text text not null,body_truncated boolean not null default false,
 received_at timestamptz not null,reply_reference text not null default '',
 unique(conversation_id,provider_message_id),unique(id,conversation_id,owner_id),
 foreign key(conversation_id,owner_id) references public.campaign_conversations(id,owner_id) on delete cascade,
 check(length(body_text)<=100000),check(jsonb_typeof(to_emails)='array')
);
create index campaign_inbox_messages_history on public.campaign_inbox_messages(conversation_id,received_at desc,id);
create index campaign_inbox_messages_owner on public.campaign_inbox_messages(owner_id);
create table public.campaign_reply_sends (
 id uuid primary key,owner_id uuid not null,conversation_id uuid not null,in_reply_to uuid not null,
 body_text text not null check(length(body_text) between 1 and 12000),
 state text not null default 'sending' check(state in ('sending','sent','failed','uncertain')),
 provider_message_id text,last_error text,created_at timestamptz not null default now(),
 foreign key(conversation_id,owner_id) references public.campaign_conversations(id,owner_id) on delete cascade,
 foreign key(in_reply_to,conversation_id,owner_id) references public.campaign_inbox_messages(id,conversation_id,owner_id)
);
create index campaign_reply_sends_owner on public.campaign_reply_sends(owner_id);
create index campaign_reply_sends_parent on public.campaign_reply_sends(in_reply_to,conversation_id,owner_id);
create index campaign_reply_sends_conversation on public.campaign_reply_sends(conversation_id,created_at desc);
create unique index campaign_reply_sends_inflight on public.campaign_reply_sends(conversation_id) where state in ('sending','uncertain');
do $$ declare n text;begin
 foreach n in array array['campaign_conversations','campaign_inbox_messages','campaign_reply_sends'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to authenticated',n);
  execute format('grant all on public.%I to service_role',n);
  execute format('create policy owner_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',n);
 end loop;
end $$;

create function public.aisas_seed_campaign_inbox(p_owner uuid default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 insert into public.campaign_conversations(id,owner_id,campaign_id,mailbox_id,thread_id,contact_email,contact_name,company,last_message_at,last_reply_at,last_outbound_at)
 select distinct on(r.id) r.id,r.owner_id,r.campaign_id,m.mailbox_id,m.provider_thread_id,m.email_address,l.contact_name,l.company,
 greatest(m.sent_at,m.replied_at),m.replied_at,m.sent_at
 from public.campaign_recipients r join public.campaign_messages m on m.recipient_id=r.id and m.owner_id=r.owner_id
 join public.leads l on l.id=r.lead_id and l.owner_id=r.owner_id
 where m.sent_at is not null and m.provider_thread_id is not null and (p_owner is null or r.owner_id=p_owner)
 and not exists(select 1 from public.campaign_conversations c where c.id=r.id)
 order by r.id,m.sent_at desc on conflict(id) do nothing;
end $$;

create function public.aisas_store_inbox_messages(p_conversation uuid,p_messages jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare c public.campaign_conversations;last_msg public.campaign_inbox_messages;last_in public.campaign_inbox_messages;in_count integer;last_out timestamptz;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into c from public.campaign_conversations where id=p_conversation for update;
 if not found then raise exception 'Conversation unavailable';end if;
 if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>200 then raise exception 'Invalid messages';end if;
 insert into public.campaign_inbox_messages(owner_id,conversation_id,provider_message_id,direction,from_email,from_name,to_emails,subject,body_text,body_truncated,received_at,reply_reference)
 select c.owner_id,c.id,v->>'provider_message_id',v->>'direction',v->>'from_email',coalesce(v->>'from_name',''),coalesce(v->'to_emails','[]'),v->>'subject',v->>'body_text',coalesce((v->>'body_truncated')::boolean,false),(v->>'received_at')::timestamptz,coalesce(v->>'reply_reference','') from jsonb_array_elements(p_messages) v
 on conflict(conversation_id,provider_message_id) do update set body_text=excluded.body_text,body_truncated=excluded.body_truncated,reply_reference=excluded.reply_reference;
 select * into last_msg from public.campaign_inbox_messages where conversation_id=c.id order by received_at desc,id desc limit 1;
 select * into last_in from public.campaign_inbox_messages where conversation_id=c.id and direction='inbound' order by received_at desc,id desc limit 1;
 select count(*) into in_count from public.campaign_inbox_messages where conversation_id=c.id and direction='inbound';
 select max(received_at) into last_out from public.campaign_inbox_messages where conversation_id=c.id and direction='outbound';
 if last_msg.id is not null then update public.campaign_conversations set last_message_at=greatest(last_message_at,last_msg.received_at),last_preview=left(last_msg.body_text,220),
 last_reply_at=greatest(last_reply_at,last_in.received_at),last_outbound_at=greatest(last_outbound_at,last_out),reply_count=in_count,
 last_sender_name=coalesce(last_in.from_name,''),last_sender_email=coalesce(last_in.from_email,'') where id=c.id;end if;
 if in_count>0 then
  update public.campaign_recipients set status='replied',claim_token=null,claimed_at=null where id=c.id and owner_id=c.owner_id;
  update public.leads set status='replied' where id=(select lead_id from public.campaign_recipients where id=c.id) and owner_id=c.owner_id and status<>'unsubscribed';
  update public.campaign_messages set replied_at=coalesce(replied_at,last_in.received_at) where recipient_id=c.id and sent_at<=last_in.received_at;
 end if;
end $$;

create function public.aisas_begin_inbox_reply(p_owner uuid,p_conversation uuid,p_request uuid,p_message uuid,p_body text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaign_conversations;s public.campaign_reply_sends;m public.campaign_inbox_messages;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into c from public.campaign_conversations where id=p_conversation and owner_id=p_owner for update;
 if not found then raise exception 'Conversation unavailable';end if;
 select * into s from public.campaign_reply_sends where id=p_request;
 if found then
  if s.owner_id<>p_owner or s.conversation_id<>p_conversation or s.body_text<>p_body or s.in_reply_to<>p_message then raise exception 'Reply request already used';end if;
  return to_jsonb(s)||jsonb_build_object('claimed',false);
 end if;
 if exists(select 1 from public.campaign_reply_sends where conversation_id=c.id and state in ('sending','uncertain')) then raise exception 'A reply is awaiting delivery confirmation. Refresh the conversation before sending again.';end if;
 select * into m from public.campaign_inbox_messages where id=p_message and conversation_id=c.id and owner_id=p_owner and direction='inbound';
 if not found or m.reply_reference='' then raise exception 'Open and sync an incoming message before replying.';end if;
 if exists(select 1 from public.leads l where l.owner_id=p_owner and lower(l.email)=lower(m.from_email) and l.status='unsubscribed') then raise exception 'This contact is unsubscribed. Sending is blocked.';end if;
 insert into public.campaign_reply_sends(id,owner_id,conversation_id,in_reply_to,body_text) values(p_request,p_owner,c.id,m.id,p_body) returning * into s;
 return to_jsonb(s)||jsonb_build_object('claimed',true);
end $$;
revoke all on function public.aisas_seed_campaign_inbox(uuid),public.aisas_store_inbox_messages(uuid,jsonb),public.aisas_begin_inbox_reply(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.aisas_seed_campaign_inbox(uuid),public.aisas_store_inbox_messages(uuid,jsonb),public.aisas_begin_inbox_reply(uuid,uuid,uuid,uuid,text) to service_role;

create table aisas_private.inbox_usage(owner_id uuid not null references auth.users(id) on delete cascade,day date not null,kind text not null check(kind in ('draft','sync','send')),attempts integer not null default 1,primary key(owner_id,day,kind));
alter table aisas_private.inbox_usage enable row level security;
revoke all on aisas_private.inbox_usage from public,anon,authenticated;
grant all on aisas_private.inbox_usage to service_role;
create function public.aisas_inbox_quota(p_owner uuid,p_kind text) returns boolean language plpgsql security invoker set search_path='' as $$
declare used integer;cap integer:=case p_kind when 'draft' then 100 when 'sync' then 500 when 'send' then 200 else 0 end;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if cap=0 then return false;end if;
 insert into aisas_private.inbox_usage(owner_id,day,kind) values(p_owner,(now() at time zone 'UTC')::date,p_kind)
 on conflict(owner_id,day,kind) do update set attempts=aisas_private.inbox_usage.attempts+1 where aisas_private.inbox_usage.attempts<cap returning attempts into used;
 return used is not null;
end $$;
revoke all on function public.aisas_inbox_quota(uuid,text) from public,anon,authenticated;
grant execute on function public.aisas_inbox_quota(uuid,text) to service_role;
-- No provider calls, sends, or scheduler changes are performed by this migration.
create function public.aisas_inbox_summary(p_owner uuid,p_campaign uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 return (select jsonb_build_object('conversations',count(*),'responders',count(*) filter(where last_reply_at is not null),'responses',coalesce(sum(reply_count),0),
 'unread',count(*) filter(where last_reply_at is not null and (last_read_at is null or last_reply_at>last_read_at)),
 'awaiting',count(*) filter(where last_reply_at is not null and (last_outbound_at is null or last_reply_at>last_outbound_at)))
 from public.campaign_conversations where owner_id=p_owner and (p_campaign is null or campaign_id=p_campaign));
end $$;
create function public.aisas_read_inbox(p_owner uuid,p_conversation uuid,p_through timestamptz) returns void language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 update public.campaign_conversations set last_read_at=greatest(last_read_at,least(p_through,last_reply_at)) where id=p_conversation and owner_id=p_owner and last_reply_at is not null;
end $$;
revoke all on function public.aisas_inbox_summary(uuid,uuid),public.aisas_read_inbox(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.aisas_inbox_summary(uuid,uuid),public.aisas_read_inbox(uuid,uuid,timestamptz) to service_role;
