-- Platform credentials live in Supabase Vault, not application records or source.
-- Environment variables remain supported by the Edge Function for local development.
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
     'aisas_OPENAI_API_KEY', 'aisas_OPENAI_MODEL', 'aisas_SERPAPI_KEY',
     'aisas_NYLAS_API_KEY', 'aisas_NYLAS_CLIENT_ID', 'aisas_NYLAS_CLIENT_SECRET',
     'aisas_CRON_SECRET', 'aisas_APP_ORIGIN', 'aisas_NYLAS_REDIRECT_URI'
   );
  return config;
end;
$$;
revoke all on function public.aisas_runtime_config() from public, anon, authenticated;
grant execute on function public.aisas_runtime_config() to service_role;
comment on function public.aisas_runtime_config() is 'AISAS Edge Function only; returns allowlisted platform credentials from encrypted Vault storage.';
