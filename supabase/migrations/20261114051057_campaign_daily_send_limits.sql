set local lock_timeout='5s';
alter table public.campaigns add column daily_send_limit integer check(daily_send_limit between 1 and 10000),
 add column send_timezone text not null default 'UTC';
grant update(daily_send_limit,send_timezone) on public.campaigns to authenticated;
create function aisas_private.validate_campaign_send_timezone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.send_timezone) then raise exception 'Choose a valid sending timezone' using errcode='23514';end if;
 if tg_op='UPDATE' and old.launched_at is not null and new.send_timezone is distinct from old.send_timezone then raise exception 'The daily reset timezone cannot change after launch' using errcode='23514';end if;
 return new;
end $$;
revoke all on function aisas_private.validate_campaign_send_timezone() from public,anon,authenticated;
create trigger campaign_send_timezone before insert or update of send_timezone on public.campaigns for each row execute function aisas_private.validate_campaign_send_timezone();
create index campaign_messages_daily_sent_idx on public.campaign_messages(campaign_id,sent_at) where sent_at is not null;
create index campaign_messages_daily_reserved_idx on public.campaign_messages(campaign_id) where sent_at is null and state in ('sending','uncertain');
create function aisas_private.campaign_daily_usage(p_campaign uuid,p_at timestamptz default clock_timestamp())
returns table(daily_limit integer,daily_sent integer,daily_reserved integer,daily_remaining integer,send_timezone text,day_start timestamptz,day_end timestamptz,resume_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare c public.campaigns; starts timestamptz; ends timestamptz; successes integer; held integer;
begin
 select * into c from public.campaigns where id=p_campaign;
 if not found then return;end if;
 starts:=((p_at at time zone c.send_timezone)::date)::timestamp at time zone c.send_timezone;
 ends:=(((p_at at time zone c.send_timezone)::date+1)::timestamp) at time zone c.send_timezone;
 select count(*)::integer into successes from public.campaign_messages m where m.campaign_id=c.id and m.sent_at>=starts and m.sent_at<ends;
 -- Unknown outcomes may still be accepted by the provider; hold capacity until reconciled, even across midnight.
 select count(*)::integer into held from public.campaign_messages m where m.campaign_id=c.id and m.sent_at is null and m.state in ('sending','uncertain');
 return query select c.daily_send_limit,successes,held,
 case when c.daily_send_limit is null then null else greatest(0,c.daily_send_limit-successes-held) end,
 c.send_timezone,starts,ends,
 case when c.daily_send_limit is not null and successes>=c.daily_send_limit and held<c.daily_send_limit then ends else null end;
end $$;
revoke all on function aisas_private.campaign_daily_usage(uuid,timestamptz) from public,anon;
grant execute on function aisas_private.campaign_daily_usage(uuid,timestamptz) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.aisas_claim_delivery_batch(p_campaign uuid DEFAULT NULL::uuid)
 RETURNS SETOF campaign_recipients
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 return query with eligible_campaigns as materialized (
  select c.id from public.campaigns c
  where c.status in ('running','scheduled') and c.approved and (c.start_at is null or c.start_at<=now()) and (p_campaign is null or c.id=p_campaign)
  and (c.daily_send_limit is null or exists(select 1 from aisas_private.campaign_daily_usage(c.id,clock_timestamp()) d where d.daily_remaining>0))
 ) update public.campaign_recipients r set status='processing',claimed_at=now(),claim_token=gen_random_uuid() where r.id in (
  select q.id from public.campaign_recipients q join eligible_campaigns c on c.id=q.campaign_id
  where q.status='pending' and q.step<4 and q.next_send_at<=now()
  order by q.next_send_at,q.id for update of q skip locked limit 5
 ) returning r.*;
end $function$;

CREATE OR REPLACE FUNCTION public.aisas_begin_campaign_send(p_recipient uuid, p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.campaign_recipients;c public.campaigns;l public.leads;m public.campaign_messages;quota record;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.campaign_recipients where id=p_recipient for update;
 if not found or r.status<>'processing' or r.claim_token is distinct from p_claim then return null;end if;
 select * into c from public.campaigns where id=r.campaign_id for update;
 if not c.approved or c.status not in ('running','scheduled') or (c.start_at is not null and c.start_at>now()) then update public.campaign_recipients set status='pending',claim_token=null where id=r.id;return null;end if;
 select * into l from public.leads where id=r.lead_id;
 if btrim(l.email)='' or l.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or l.status in ('replied','unsubscribed') or exists(select 1 from public.leads opt where opt.owner_id=r.owner_id and lower(opt.email)=lower(l.email) and opt.status='unsubscribed') or l.email_verification_status='invalid' or exists(select 1 from public.campaign_messages old where old.owner_id=r.owner_id and lower(old.email_address)=lower(l.email) and old.bounced_at is not null) then
  update public.campaign_recipients set status='suppressed',last_error='No eligible email address, an invalid address, or a suppression applies.',claim_token=null where id=r.id;return null;
 end if;
 select * into m from public.campaign_messages where recipient_id=r.id and step=r.step;
 if found and m.state<>'failed' then update public.campaign_recipients set status='uncertain',last_error='A send already exists for this sequence step; automatic duplicate prevented.',claim_token=null where id=r.id;return null;end if;
 if c.daily_send_limit is not null then
  select * into quota from aisas_private.campaign_daily_usage(c.id,clock_timestamp());
  if quota.daily_remaining<=0 then
   update public.campaign_recipients set status='pending',claim_token=null,claimed_at=null,last_error=null where id=r.id;
   return null;
  end if;
 end if;
 insert into public.campaign_messages(owner_id,campaign_id,recipient_id,mailbox_id,step,email_address)
 values(r.owner_id,c.id,r.id,c.mailbox_id,r.step,l.email)
 on conflict(recipient_id,step) do update set email_address=excluded.email_address,mailbox_id=excluded.mailbox_id,state='sending',attempted_at=now(),attempt_count=public.campaign_messages.attempt_count+1,last_error=null
 returning * into m;
 return jsonb_build_object('delivery_id',m.id,'ideal_context',r.ideal_context,'lead',to_jsonb(l),'message',c.messages->r.step,'mailbox_id',c.mailbox_id,'thread_id',r.thread_id,'message_id',r.message_id,'step',r.step,'attempt_count',m.attempt_count);
end $function$;

CREATE OR REPLACE FUNCTION public.aisas_campaign_analytics(p_campaign uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select c.id,c.status, d.daily_limit as daily_send_limit,d.daily_sent,d.daily_reserved,d.daily_remaining,d.send_timezone,d.day_end as daily_reset_at,d.resume_at as daily_resume_at,(d.daily_limit is not null and d.daily_sent>=d.daily_limit) as daily_limit_reached,
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
 h.last_run_at,h.last_success_at,h.last_error_code,h.tracking_ready from public.campaigns c cross join public.campaign_delivery_status h left join lateral aisas_private.campaign_daily_usage(c.id,now()) d on true
 where c.owner_id=(select auth.uid()) and (p_campaign is null or c.id=p_campaign) order by c.created_at desc
 ) x;
$function$;

