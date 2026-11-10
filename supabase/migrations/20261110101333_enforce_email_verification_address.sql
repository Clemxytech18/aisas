alter table public.leads drop constraint consistent_email_verification;
alter table public.leads add constraint consistent_email_verification check(
 (email_verification_status='unverified' and email_verification_checked_at is null and email_verification_address is null)
 or (email_verification_status in ('verified','invalid','unknown') and email_verification_checked_at is not null and email_verification_address is not null and email_verification_address=email)
);
