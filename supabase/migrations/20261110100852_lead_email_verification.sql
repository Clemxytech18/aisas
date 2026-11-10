alter table public.leads
 add column email_verification_status text not null default 'unverified' check(email_verification_status in ('unverified','verified','invalid','unknown')),
 add column email_verification_checked_at timestamptz,
 add column email_verification_address text,
 add column email_verification_reason text,
 add column email_verification_provider text,
 add constraint consistent_email_verification check(
  (email_verification_status='unverified' and email_verification_checked_at is null and email_verification_address is null)
  or (email_verification_status in ('verified','invalid','unknown') and email_verification_checked_at is not null and email_verification_address=email)
 );
-- User-owned lead fields remain editable; verification results are server-owned.
revoke insert,update on public.leads from authenticated;
grant insert(id,owner_id,list_id,company,contact_name,category,location,email,phone,website,linkedin,source_url,score,status,created_at),
 update(id,owner_id,list_id,company,contact_name,category,location,email,phone,website,linkedin,source_url,score,status,created_at)
 on public.leads to authenticated;
create function public.aisas_clear_email_verification() returns trigger language plpgsql set search_path='' as $$
begin
 new.email_verification_status:='unverified';
 new.email_verification_checked_at:=null;
 new.email_verification_address:=null;
 new.email_verification_reason:=null;
 new.email_verification_provider:=null;
 return new;
end $$;
revoke all on function public.aisas_clear_email_verification() from public,anon,authenticated;
create trigger clear_email_verification before update of email on public.leads
 for each row when (old.email is distinct from new.email) execute function public.aisas_clear_email_verification();
alter table aisas_private.daily_usage drop constraint daily_usage_kind_check;
alter table aisas_private.daily_usage add constraint daily_usage_kind_check check(kind in ('scout','generate-sequence','connect-mailbox','verify-email'));
create or replace function public.aisas_reserve_usage(p_owner uuid,p_kind text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; cap integer; begin
 cap:=case p_kind when 'scout' then 20 when 'generate-sequence' then 100 when 'connect-mailbox' then 20 when 'verify-email' then 200 else 0 end;
 if cap=0 then return false; end if;
 insert into aisas_private.daily_usage(owner_id,kind) values(p_owner,p_kind)
 on conflict(owner_id,kind,day) do update set used=aisas_private.daily_usage.used+1 where aisas_private.daily_usage.used<cap returning used into n;
 return n is not null;
end $$;

create or replace function public.aisas_runtime_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare config jsonb;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception 'Server-only configuration' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(substring(name from 7), decrypted_secret), '{}'::jsonb)
    into config
    from vault.decrypted_secrets
   where name in (
     'aisas_ZEROBOUNCE_API_KEY', 'aisas_OPENAI_API_KEY', 'aisas_OPENAI_MODEL', 'aisas_SERPAPI_KEY',
     'aisas_NYLAS_API_KEY', 'aisas_NYLAS_CLIENT_ID', 'aisas_NYLAS_CLIENT_SECRET',
     'aisas_CRON_SECRET', 'aisas_APP_ORIGIN', 'aisas_NYLAS_REDIRECT_URI'
   );
  return config;
end;
$$;
revoke all on function public.aisas_runtime_config() from public, anon, authenticated;
grant execute on function public.aisas_runtime_config() to service_role;
comment on function public.aisas_runtime_config() is 'AISAS Edge Function only; returns allowlisted platform credentials from encrypted Vault storage.';
