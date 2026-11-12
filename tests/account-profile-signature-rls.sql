-- Transaction-only fixtures: no real account is deleted and no provider is contacted.
begin;
select set_config('qa.owner',gen_random_uuid()::text,true),set_config('qa.other',gen_random_uuid()::text,true),set_config('qa.profile',gen_random_uuid()::text,true),set_config('qa.campaign',gen_random_uuid()::text,true),set_config('qa.list',gen_random_uuid()::text,true),set_config('qa.mailbox',gen_random_uuid()::text,true),set_config('qa.recipient',gen_random_uuid()::text,true),set_config('qa.lead',gen_random_uuid()::text,true),set_config('qa.shared_grant','qa-shared-'||gen_random_uuid(),true),set_config('qa.own_grant','qa-own-'||gen_random_uuid(),true);
insert into auth.users(id,email) values(current_setting('qa.owner')::uuid,'account-qa-'||current_setting('qa.owner')||'@example.test'),(current_setting('qa.other')::uuid,'account-qa-'||current_setting('qa.other')||'@example.test');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
insert into public.scouting_profiles(id,owner_id,name,audience,location,niche,sub_niche,usp,offer,sender_name,signature_text,signature_image_url) values(current_setting('qa.profile')::uuid,auth.uid(),'Signatory QA','Hotels','Lagos','Marketing','Growth','Proposition','Offer','Alex','Founder','https://beslhrcwojbxbqcvsnhy.supabase.co/storage/v1/object/public/email-signatures/'||auth.uid()||'/00000000-0000-4000-8000-000000000001.jpg');
insert into public.campaigns(id,owner_id,name,profile_id,sender_name,signature_text) values(current_setting('qa.campaign')::uuid,auth.uid(),'Signature snapshot QA',current_setting('qa.profile')::uuid,'Tampered','Tampered');
do $$begin
 if not exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid and sender_name='Alex' and signature_text='Founder')then raise exception 'Profile snapshot failed';end if;
 update public.scouting_profiles set sender_name='New name' where id=current_setting('qa.profile')::uuid;
 if not exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid and sender_name='Alex')then raise exception 'Unapproved signatory changed';end if;
 update public.campaigns set approved=true where id=current_setting('qa.campaign')::uuid;
 if not exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid and sender_name='New name')then raise exception 'Resave did not snapshot';end if;
 begin update public.campaigns set signature_text='Tampered' where id=current_setting('qa.campaign')::uuid;raise exception 'Reserved signature snapshot editable';exception when insufficient_privilege then null;end;
 begin update public.scouting_profiles set signature_image_url='https://attacker.example/image.jpg' where id=current_setting('qa.profile')::uuid;raise exception 'Unowned signatory URL allowed';exception when check_violation then null;end;
 begin perform public.aisas_prepare_account_deletion(auth.uid());raise exception 'Client could call account deletion preparation';exception when insufficient_privilege then null;end;
 -- Roll back the fake Storage metadata inside a subtransaction; no object is created.
 begin
 insert into storage.objects(bucket_id,name,owner_id) values('avatars',auth.uid()||'/00000000-0000-4000-8000-000000000001.jpg',auth.uid()::text);
 raise exception using errcode='P7777',message='Rollback fixture object';
 exception when sqlstate 'P7777' then null;end;
 begin insert into storage.objects(bucket_id,name,owner_id) values('avatars',current_setting('qa.other')||'/00000000-0000-4000-8000-000000000001.jpg',auth.uid()::text);raise exception 'Cross-owner image insert allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.other'),'role','authenticated')::text,true);
do $$begin
 if exists(select 1 from public.scouting_profiles where id=current_setting('qa.profile')::uuid) or exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid)then raise exception 'Private signatory exposed';end if;
end $$;
reset role;
insert into public.lead_lists(id,owner_id,name) values(current_setting('qa.list')::uuid,current_setting('qa.owner')::uuid,'Account cascade QA');
insert into public.mailboxes(id,owner_id,email,provider) values(current_setting('qa.mailbox')::uuid,current_setting('qa.owner')::uuid,'fixture@example.test','custom');
insert into aisas_private.mailbox_credentials(mailbox_id,grant_id) values(current_setting('qa.mailbox')::uuid,current_setting('qa.own_grant'));
insert into public.mailboxes(owner_id,email,provider) values(current_setting('qa.owner')::uuid,'shared@example.test','custom'),(current_setting('qa.other')::uuid,'shared@example.test','custom');
insert into aisas_private.mailbox_credentials(mailbox_id,grant_id) select id,current_setting('qa.shared_grant') from public.mailboxes where owner_id in (current_setting('qa.owner')::uuid,current_setting('qa.other')::uuid) and email='shared@example.test';
insert into public.leads(id,owner_id,list_id,company,email) values(current_setting('qa.lead')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.list')::uuid,'Fixture','prospect@example.test');
update public.campaigns set list_id=current_setting('qa.list')::uuid,mailbox_id=current_setting('qa.mailbox')::uuid,status='running' where id=current_setting('qa.campaign')::uuid;
insert into public.campaign_recipients(id,owner_id,campaign_id,lead_id) values(current_setting('qa.recipient')::uuid,current_setting('qa.owner')::uuid,current_setting('qa.campaign')::uuid,current_setting('qa.lead')::uuid);
insert into public.campaign_messages(owner_id,campaign_id,recipient_id,mailbox_id,step,email_address) values(current_setting('qa.owner')::uuid,current_setting('qa.campaign')::uuid,current_setting('qa.recipient')::uuid,current_setting('qa.mailbox')::uuid,0,'prospect@example.test');
insert into aisas_private.email_events(id,event) values(current_setting('qa.own_grant'),jsonb_build_object('grant_id',current_setting('qa.own_grant'))),(current_setting('qa.shared_grant'),jsonb_build_object('grant_id',current_setting('qa.shared_grant')));
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare grants text[];begin
 grants:=public.aisas_prepare_account_deletion(current_setting('qa.owner')::uuid);
 if grants<>array[current_setting('qa.own_grant')]then raise exception 'Shared mailbox grant could be revoked';end if;
 if not exists(select 1 from public.campaigns where id=current_setting('qa.campaign')::uuid and status='paused')then raise exception 'Deletion did not stop campaign';end if;
 perform public.aisas_purge_account_events(current_setting('qa.owner')::uuid);
 if exists(select 1 from aisas_private.email_events where id=current_setting('qa.own_grant')) or not exists(select 1 from aisas_private.email_events where id=current_setting('qa.shared_grant'))then raise exception 'Event cleanup isolation failed';end if;
end $$;
reset role;
update auth.users set banned_until=now()+interval '1 hour' where id=current_setting('qa.owner')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.owner'),'role','authenticated')::text,true);
do $$begin
 if aisas_private.account_is_active() or exists(select 1 from public.prospect_pool) or exists(select 1 from public.campaign_delivery_status)then raise exception 'Frozen user retained shared access';end if;
 begin insert into storage.objects(bucket_id,name,owner_id) values('avatars',auth.uid()||'/00000000-0000-4000-8000-000000000001.jpg',auth.uid()::text);raise exception 'Frozen user could upload';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Delete only this newly-created transaction fixture to prove every private FK cascades.
delete from auth.users where id=current_setting('qa.owner')::uuid;
do $$begin
 if exists(select 1 from public.campaign_messages where owner_id=current_setting('qa.owner')::uuid) or exists(select 1 from public.campaigns where owner_id=current_setting('qa.owner')::uuid) or exists(select 1 from public.leads where owner_id=current_setting('qa.owner')::uuid) or exists(select 1 from public.mailboxes where owner_id=current_setting('qa.owner')::uuid)then raise exception 'Account cascade left private records';end if;
 if not exists(select 1 from auth.users where id=current_setting('qa.other')::uuid)then raise exception 'Other user deleted';end if;
end $$;
set local role authenticated;
do $$begin if aisas_private.account_is_active() then raise exception 'Deleted account retained access';end if;end $$;
reset role;
select 'Signature snapshots, ownership, upload isolation, exclusive grant cleanup, stale JWT protection and account cascades passed' as result;
rollback;
