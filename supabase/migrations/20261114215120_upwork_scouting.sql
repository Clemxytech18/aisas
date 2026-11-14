set local lock_timeout='5s';
-- All Upwork records are private to the connected AISAS user, never the shared prospect pool.
create table public.upwork_connections (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 connected_at timestamptz not null default now(), status text not null default 'connected' check(status in ('connected','reconnect')),
 tools jsonb not null default '[]', last_checked_at timestamptz
);
create table public.upwork_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 external_id text not null, job jsonb not null, raw jsonb not null default '{}', updated_at timestamptz not null default now(),
 unique(owner_id,external_id), unique(id,owner_id)
);
create table public.upwork_scouts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid not null, status text not null check(status in ('researching','completed','failed')),
 report jsonb, error text, state jsonb not null default '{}', progress jsonb not null default '{}', claim_token uuid, claimed_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(job_id,owner_id) references public.upwork_jobs(id,owner_id) on delete cascade,
 unique(owner_id,job_id)
);
create table public.upwork_applications (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid not null, mailbox_id uuid references public.mailboxes(id) on delete set null,
 email text not null, subject text not null, body text not null,
 status text not null check(status in ('sending','sent','failed','uncertain')), provider_message_id text,
 error text, permission_confirmed_at timestamptz not null, attempts integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), sent_at timestamptz,
 foreign key(job_id,owner_id) references public.upwork_jobs(id,owner_id) on delete cascade,
 unique(owner_id,job_id)
);
create index upwork_jobs_owner_updated on public.upwork_jobs(owner_id,updated_at desc);
create index upwork_scouts_owner_updated on public.upwork_scouts(owner_id,updated_at desc);
create index upwork_applications_owner_created on public.upwork_applications(owner_id,created_at desc);
create index upwork_applications_mailbox on public.upwork_applications(mailbox_id) where mailbox_id is not null;
alter table public.upwork_connections enable row level security;
alter table public.upwork_jobs enable row level security;
alter table public.upwork_scouts enable row level security;
alter table public.upwork_applications enable row level security;
revoke all on public.upwork_connections,public.upwork_jobs,public.upwork_scouts,public.upwork_applications from anon,authenticated;
grant select on public.upwork_connections,public.upwork_jobs,public.upwork_scouts,public.upwork_applications to authenticated;
grant all on public.upwork_connections,public.upwork_jobs,public.upwork_scouts,public.upwork_applications to service_role;
create policy own_upwork_connections on public.upwork_connections for select to authenticated using(owner_id=(select auth.uid()));
create policy own_upwork_jobs on public.upwork_jobs for select to authenticated using(owner_id=(select auth.uid()));
create policy own_upwork_scouts on public.upwork_scouts for select to authenticated using(owner_id=(select auth.uid()));
create policy own_upwork_applications on public.upwork_applications for select to authenticated using(owner_id=(select auth.uid()));
create table aisas_private.upwork_credentials (
 owner_id uuid primary key references auth.users(id) on delete cascade, secret_id uuid not null, refresh_until timestamptz
);
create table aisas_private.upwork_oauth_states (
 state_hash text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 verifier text not null, client_id text not null, expires_at timestamptz not null default now()+interval '10 minutes'
);
create index upwork_oauth_owner on aisas_private.upwork_oauth_states(owner_id);
alter table aisas_private.upwork_credentials enable row level security;
alter table aisas_private.upwork_oauth_states enable row level security;
revoke all on aisas_private.upwork_credentials,aisas_private.upwork_oauth_states from public,anon,authenticated;
grant all on aisas_private.upwork_credentials,aisas_private.upwork_oauth_states to service_role;
create policy upwork_credentials_server on aisas_private.upwork_credentials for all to service_role using(true) with check(true);
create policy upwork_oauth_server on aisas_private.upwork_oauth_states for all to service_role using(true) with check(true);
-- Server-only RPCs; invoker privileges, no public/client access to token material.
create function public.aisas_upwork_credentials(p_owner uuid,p_tokens jsonb default null,p_delete boolean default false,p_previous text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sid uuid; result jsonb;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('upwork:'||p_owner::text,0));
 select secret_id into sid from aisas_private.upwork_credentials where owner_id=p_owner for update;
 if p_delete then
  delete from aisas_private.upwork_oauth_states where owner_id=p_owner;
  delete from aisas_private.upwork_credentials where owner_id=p_owner;
  delete from public.upwork_connections where owner_id=p_owner;
  return null;
 end if;
 if p_tokens is not null then
  if p_previous is not null and (sid is null or not exists(select 1 from public.upwork_connections where owner_id=p_owner) or not exists(select 1 from vault.decrypted_secrets where id=sid and decrypted_secret::jsonb->>'access_token'=p_previous)) then raise exception 'Upwork connection changed; reconnect';end if;
  select secret_id into sid from aisas_private.upwork_credentials where owner_id=p_owner;
  if sid is null then
   select vault.create_secret(p_tokens::text) into sid;
   insert into aisas_private.upwork_credentials(owner_id,secret_id) values(p_owner,sid);
  else perform vault.update_secret(sid,p_tokens::text);end if;
 end if;
 if sid is not null then select decrypted_secret::jsonb into result from vault.decrypted_secrets where id=sid;end if;
 return result;
end $$;
-- Deletion cascades must also erase encrypted Vault payloads. Trigger-only, no callable RPC.
create function aisas_private.purge_upwork_secret() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from vault.secrets where id=old.secret_id;return old;end $$;
revoke all on function aisas_private.purge_upwork_secret() from public,anon,authenticated,service_role;
create trigger purge_upwork_secret after delete on aisas_private.upwork_credentials for each row execute function aisas_private.purge_upwork_secret();
create function public.aisas_upwork_oauth(p_state text,p_owner uuid default null,p_verifier text default null,p_client text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 delete from aisas_private.upwork_oauth_states where expires_at<now();
 if p_owner is not null then
  delete from aisas_private.upwork_oauth_states where owner_id=p_owner;
  insert into aisas_private.upwork_oauth_states(state_hash,owner_id,verifier,client_id) values(p_state,p_owner,p_verifier,p_client);
  return null;
 end if;
 delete from aisas_private.upwork_oauth_states where state_hash=p_state and expires_at>now() returning to_jsonb(upwork_oauth_states.*) into result;
 return result;
end $$;
create function public.aisas_upwork_usage(p_owner uuid,p_kind text) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; cap integer;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 cap:=case p_kind when 'upwork-connect' then 20 when 'upwork-search' then 200 when 'upwork-scout' then 40 when 'upwork-draft' then 100 when 'upwork-send' then 50 else 0 end;
 if cap=0 then return false;end if;
 insert into aisas_private.daily_usage(owner_id,kind) values(p_owner,p_kind) on conflict(owner_id,kind,day) do update set used=aisas_private.daily_usage.used+1 where aisas_private.daily_usage.used<cap returning used into n;
 return n is not null;
end $$;
-- An accepted/unknown application can never be automatically sent a second time.
create function public.aisas_upwork_reserve_application(p_owner uuid,p_job uuid,p_mailbox uuid,p_email text,p_subject text,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if not exists(select 1 from public.mailboxes where id=p_mailbox and owner_id=p_owner and status='connected') then raise exception 'Connect a sending mailbox';end if;
 if not exists(select 1 from public.upwork_scouts s where s.owner_id=p_owner and s.job_id=p_job and s.status='completed' and exists(select 1 from jsonb_array_elements(s.report->'contacts') c where c->>'kind'='email' and lower(c->>'value')=lower(p_email))) then raise exception 'Use a researched email address';end if;
 insert into public.upwork_applications(owner_id,job_id,mailbox_id,email,subject,body,status,permission_confirmed_at) values(p_owner,p_job,p_mailbox,p_email,p_subject,p_body,'sending',now())
 on conflict(owner_id,job_id) do update set mailbox_id=excluded.mailbox_id,email=excluded.email,subject=excluded.subject,body=excluded.body,status='sending',error=null,updated_at=now(),permission_confirmed_at=now(),attempts=public.upwork_applications.attempts+1
 where public.upwork_applications.status='failed' and public.upwork_applications.attempts<3 returning id into result;
 return result;
end $$;
revoke all on function public.aisas_upwork_credentials(uuid,jsonb,boolean,text),public.aisas_upwork_oauth(text,uuid,text,text),public.aisas_upwork_usage(uuid,text),public.aisas_upwork_reserve_application(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.aisas_upwork_credentials(uuid,jsonb,boolean,text),public.aisas_upwork_oauth(text,uuid,text,text),public.aisas_upwork_usage(uuid,text),public.aisas_upwork_reserve_application(uuid,uuid,uuid,text,text,text) to service_role;

create function public.aisas_upwork_claim_scout(p_owner uuid,p_scout uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 update public.upwork_scouts set claim_token=gen_random_uuid(),claimed_until=clock_timestamp()+interval '2 minutes'
 where id=p_scout and owner_id=p_owner and status='researching' and (claimed_until is null or claimed_until<clock_timestamp()) returning to_jsonb(upwork_scouts.*) into result;
 return result;
end $$;
revoke all on function public.aisas_upwork_claim_scout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aisas_upwork_claim_scout(uuid,uuid) to service_role;

create function public.aisas_upwork_refresh_lock(p_owner uuid,p_release boolean default false) returns boolean language plpgsql security invoker set search_path='' as $$
declare ok boolean;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if p_release then update aisas_private.upwork_credentials set refresh_until=null where owner_id=p_owner;return true;end if;
 update aisas_private.upwork_credentials set refresh_until=clock_timestamp()+interval '45 seconds' where owner_id=p_owner and (refresh_until is null or refresh_until<clock_timestamp()) returning true into ok;return coalesce(ok,false);
end $$;
create function public.aisas_upwork_config() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server only' using errcode='42501';end if;
 return (select coalesce(jsonb_object_agg(substring(name from 7),decrypted_secret),'{}'::jsonb) from vault.decrypted_secrets where name in ('aisas_UPWORK_CLIENT_ID','aisas_UPWORK_CLIENT_SECRET'));
end $$;
revoke all on function public.aisas_upwork_refresh_lock(uuid,boolean),public.aisas_upwork_config() from public,anon,authenticated;
grant execute on function public.aisas_upwork_refresh_lock(uuid,boolean),public.aisas_upwork_config() to service_role;
