-- AISAS: user-owned application data; provider credentials never enter exposed schemas.
create schema if not exists aisas_private;
revoke all on schema aisas_private from public, anon, authenticated;
create table public.scouting_profiles (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 160), audience text not null, location text not null,
 niche text not null, sub_niche text not null, usp text not null, offer text not null,
 created_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.lead_lists (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 160), created_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.leads (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 list_id uuid not null, company text not null, contact_name text not null default '', category text not null default '', location text not null default '',
 email text not null default '', phone text not null default '', website text not null default '', linkedin text not null default '',
 source_url text not null default '', score integer not null default 0 check(score between 0 and 100),
 status text not null default 'new' check(status in ('new','contacted','replied','unsubscribed')),
 created_at timestamptz not null default now(), unique(id,owner_id),
 foreign key(list_id,owner_id) references public.lead_lists(id,owner_id) on delete cascade
);
create unique index lead_dedup on public.leads(list_id,lower(company),lower(email));
create table public.mailboxes (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 email text not null, provider text not null, status text not null default 'connected',
 created_at timestamptz not null default now(), unique(id,owner_id),unique(owner_id,email)
);
create table public.campaigns (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 160), list_id uuid, profile_id uuid, mailbox_id uuid,
 status text not null default 'draft' check(status in ('draft','scheduled','running','paused','completed')),
 start_at timestamptz, messages jsonb not null default '[]', approved boolean not null default false,
 created_at timestamptz not null default now(),unique(id,owner_id),
 foreign key(list_id,owner_id) references public.lead_lists(id,owner_id),
 foreign key(profile_id,owner_id) references public.scouting_profiles(id,owner_id),
 foreign key(mailbox_id,owner_id) references public.mailboxes(id,owner_id),
 check(jsonb_typeof(messages)='array' and jsonb_array_length(messages)<=4)
);
create table public.campaign_recipients (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null,lead_id uuid not null, step integer not null default 0 check(step between 0 and 4),
 next_send_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','processing','sent','replied','suppressed','failed','uncertain')),
 thread_id text,last_error text,created_at timestamptz not null default now(),unique(campaign_id,lead_id),
 foreign key(campaign_id,owner_id) references public.campaigns(id,owner_id) on delete cascade,
 foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade
);
create table aisas_private.mailbox_credentials(mailbox_id uuid primary key references public.mailboxes(id) on delete cascade,grant_id text not null);
create table aisas_private.oauth_states(state text primary key,owner_id uuid not null references auth.users(id) on delete cascade,expires_at timestamptz not null default now()+interval '10 minutes');
alter table aisas_private.mailbox_credentials enable row level security;
alter table aisas_private.oauth_states enable row level security;
grant usage on schema aisas_private to service_role;
grant all on all tables in schema aisas_private to service_role;
-- Private schema is intentionally absent from PostgREST exposed schemas. Service-only RPCs access it.
create function public.aisas_store_oauth(p_state text,p_owner uuid) returns void language sql security definer set search_path='' as $$ insert into aisas_private.oauth_states(state,owner_id) values(p_state,p_owner); $$;
create function public.aisas_consume_oauth(p_state text) returns uuid language sql security definer set search_path='' as $$ delete from aisas_private.oauth_states where state=p_state and expires_at>now() returning owner_id; $$;
create function public.aisas_set_grant(p_mailbox uuid,p_grant text) returns void language sql security definer set search_path='' as $$ insert into aisas_private.mailbox_credentials values(p_mailbox,p_grant) on conflict(mailbox_id) do update set grant_id=excluded.grant_id; $$;
create function public.aisas_get_grant(p_mailbox uuid) returns text language sql security definer set search_path='' as $$ select grant_id from aisas_private.mailbox_credentials where mailbox_id=p_mailbox; $$;
-- Atomic claim prevents two scheduler instances from delivering the same queued message.
create function public.aisas_claim_recipients() returns setof public.campaign_recipients language sql security definer set search_path='' as $$
 update public.campaign_recipients set status='processing' where id in (
 select r.id from public.campaign_recipients r join public.campaigns c on c.id=r.campaign_id
 where r.status='pending' and r.next_send_at<=now() and c.status in ('running','scheduled') and (c.start_at is null or c.start_at<=now())
 order by r.next_send_at for update of r skip locked limit 10) returning *;
$$;
-- Functions above intentionally require service-role authorization, never user-supplied role claims.
revoke all on function public.aisas_store_oauth(text,uuid),public.aisas_consume_oauth(text),public.aisas_set_grant(uuid,text),public.aisas_get_grant(uuid),public.aisas_claim_recipients() from public,anon,authenticated;
grant execute on function public.aisas_store_oauth(text,uuid),public.aisas_consume_oauth(text),public.aisas_set_grant(uuid,text),public.aisas_get_grant(uuid),public.aisas_claim_recipients() to service_role;
do $$ declare n text; begin
 foreach n in array array['scouting_profiles','lead_lists','leads','campaigns','mailboxes','campaign_recipients'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('create index on public.%I(owner_id)',n);
 execute format('revoke all on public.%I from anon,authenticated',n);
 execute format('grant select on public.%I to authenticated',n);
 execute format('grant all on public.%I to service_role',n);
 execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid())=owner_id)',n);
 if n in ('scouting_profiles','lead_lists','leads') then
 execute format('grant insert,update,delete on public.%I to authenticated',n);
 execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid())=owner_id)',n);
 execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',n);
 execute format('create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid())=owner_id)',n);
 end if;
 end loop;
end $$;
grant insert on public.campaigns to authenticated;
grant update(name,list_id,profile_id,mailbox_id,start_at,messages,approved) on public.campaigns to authenticated;
create policy owner_insert on public.campaigns for insert to authenticated with check ((select auth.uid())=owner_id and status='draft');
create policy owner_update on public.campaigns for update to authenticated using ((select auth.uid())=owner_id and status in ('draft','paused')) with check ((select auth.uid())=owner_id and status in ('draft','paused'));
create index on public.leads(list_id,owner_id);
create index on public.campaigns(list_id,owner_id);
create index on public.campaigns(profile_id,owner_id);
create index on public.campaigns(mailbox_id,owner_id);
create index on public.campaign_recipients(campaign_id,owner_id);
create index on public.campaign_recipients(lead_id,owner_id);
create index on public.campaign_recipients(next_send_at) where status='pending';
