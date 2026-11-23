-- Legacy delivery/read events can have replied_at without any incoming email.
-- They may prioritize a mailbox sync, but cannot count as a readable response.
create or replace function public.aisas_seed_campaign_inbox(p_owner uuid default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 insert into public.campaign_conversations(id,owner_id,campaign_id,mailbox_id,thread_id,contact_email,contact_name,company,last_message_at,last_outbound_at)
 select distinct on(r.id) r.id,r.owner_id,r.campaign_id,m.mailbox_id,m.provider_thread_id,m.email_address,l.contact_name,l.company,
 greatest(m.sent_at,m.replied_at),m.sent_at
 from public.campaign_recipients r join public.campaign_messages m on m.recipient_id=r.id and m.owner_id=r.owner_id
 join public.leads l on l.id=r.lead_id and l.owner_id=r.owner_id
 where m.sent_at is not null and m.provider_thread_id is not null and (p_owner is null or r.owner_id=p_owner)
 and not exists(select 1 from public.campaign_conversations c where c.id=r.id)
 order by r.id,m.sent_at desc on conflict(id) do nothing;
end $$;
update public.campaign_conversations c set last_reply_at=null
where reply_count=0 and not exists(select 1 from public.campaign_inbox_messages m where m.conversation_id=c.id and m.direction='inbound');
-- Existing delivery suppression is intentionally retained. This never resumes sends.
