-- The verification endpoint reads only its own provider key, not campaign credentials.
create function public.aisas_email_verification_key() returns text
language plpgsql stable security definer set search_path='' as $$
declare provider_key text;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then
  raise exception 'Server-only verifier configuration' using errcode='42501';
 end if;
 select decrypted_secret into provider_key from vault.decrypted_secrets where name='aisas_ZEROBOUNCE_API_KEY';
 return provider_key;
end $$;
revoke all on function public.aisas_email_verification_key() from public,anon,authenticated;
grant execute on function public.aisas_email_verification_key() to service_role;
