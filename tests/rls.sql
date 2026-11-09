-- Run against the development project. All fixture data is rolled back.
begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000001','rls-a@aisas.test'),('00000000-0000-4000-8000-000000000002','rls-b@aisas.test');
insert into public.lead_lists(id,owner_id,name) values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','A'),('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','B');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.lead_lists)<>1 then raise exception 'RLS read isolation failed'; end if;
 begin
 insert into public.lead_lists(owner_id,name) values('00000000-0000-4000-8000-000000000002','Forbidden');
 raise exception 'RLS insert isolation failed';
 exception when insufficient_privilege then null; end;
 begin
 insert into public.leads(owner_id,list_id,company) values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Forbidden cross-owner parent');
 raise exception 'Cross-owner FK isolation failed';
 exception when foreign_key_violation then null; end;
 begin
 perform public.aisas_get_grant(gen_random_uuid());
 raise exception 'Service RPC exposed to user';
 exception when insufficient_privilege then null; end;
 if has_table_privilege('authenticated','public.mailboxes','insert') then raise exception 'Mailbox write grant leaked'; end if;
 if has_column_privilege('authenticated','public.campaigns','status','update') then raise exception 'Campaign launch grant leaked'; end if;
end $$;
reset role;
rollback;
