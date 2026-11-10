begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000011','verify-a@aisas.test'),('00000000-0000-4000-8000-000000000012','verify-b@aisas.test');
insert into public.lead_lists(id,owner_id,name) values('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','Verify A'),('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012','Verify B');
insert into public.leads(id,owner_id,list_id,company,email,email_verification_status,email_verification_address,email_verification_checked_at)
 values('20000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','A','before@business.tld','verified','before@business.tld',now()),
 ('20000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012','B','other@business.tld','verified','other@business.tld',now());
do $$ begin if not public.aisas_reserve_usage('00000000-0000-4000-8000-000000000011','verify-email') then raise exception 'Verification quota kind is not enabled'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.leads)<>1 then raise exception 'Cross-user verification data exposed'; end if;
 begin
  update public.leads set email_verification_status='verified' where id='20000000-0000-4000-8000-000000000011';
  raise exception 'Client can forge verification results';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.leads(owner_id,list_id,company,email,email_verification_status) values('00000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','Spoof','spoof@business.tld','verified');
  raise exception 'Client can insert forged verification';
 exception when insufficient_privilege then null; end;
 update public.leads set email='after@business.tld' where id='20000000-0000-4000-8000-000000000011';
 if exists(select 1 from public.leads where email_verification_status<>'unverified' or email_verification_checked_at is not null or email_verification_address is not null) then raise exception 'Email changes keep stale verification'; end if;
 update public.leads set email='wrong@business.tld' where id='20000000-0000-4000-8000-000000000012';
end $$;
reset role;
do $$ declare changed integer; begin
 if not exists(select 1 from public.leads where id='20000000-0000-4000-8000-000000000012' and email='other@business.tld') then raise exception 'Cross-user update succeeded'; end if;
 update public.leads set email_verification_status='verified',email_verification_address='before@business.tld',email_verification_checked_at=now() where id='20000000-0000-4000-8000-000000000011' and email='before@business.tld';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Stale provider result was saved'; end if;
 begin
  update public.leads set email_verification_status='verified',email_verification_checked_at=now(),email_verification_address=null where id='20000000-0000-4000-8000-000000000011';
  raise exception 'Verified rows allow an absent address';
 exception when check_violation then null; end;
end $$;
rollback;
