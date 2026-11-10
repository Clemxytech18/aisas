-- Rollback-only tests for private optional profile references.
begin;
select set_config('aisas.test.profile_a',gen_random_uuid()::text,true),set_config('aisas.test.profile_b',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('aisas.test.profile_a')::uuid,'profile-a-'||current_setting('aisas.test.profile_a')||'@example.test'),(current_setting('aisas.test.profile_b')::uuid,'profile-b-'||current_setting('aisas.test.profile_b')||'@example.test');
insert into public.scouting_profiles(owner_id,name,audience,location,niche,sub_niche,usp,offer,demo_video_url,work_sample_url) values(current_setting('aisas.test.profile_b')::uuid,'Private references','Hotels','Sydney','Marketing','Growth','A private proposition','A private offer','https://example.com/private-demo','https://example.com/private-work');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('aisas.test.profile_a'),'role','authenticated')::text,true);
do $$ declare own_profile uuid;
begin
 if exists(select 1 from public.scouting_profiles where owner_id=current_setting('aisas.test.profile_b')::uuid) then raise exception 'Other-user profile references exposed'; end if;
 insert into public.scouting_profiles(owner_id,name,audience,location,niche,sub_niche,usp,offer) values(auth.uid(),'Blank optional links','Hotels','Sydney','Marketing','Growth','Own proposition','Own offer') returning id into own_profile;
 if exists(select 1 from public.scouting_profiles where id=own_profile and (demo_video_url<>'' or work_sample_url<>'')) then raise exception 'Optional defaults failed'; end if;
 update public.scouting_profiles set demo_video_url='https://example.com/demo',work_sample_url='https://example.com/work' where id=own_profile;
 if not exists(select 1 from public.scouting_profiles where id=own_profile and work_sample_url='https://example.com/work') then raise exception 'Owner cannot save proof references'; end if;
 begin
  update public.scouting_profiles set demo_video_url='javascript:alert(1)' where id=own_profile;
  raise exception 'Unsafe URL scheme accepted';
 exception when check_violation then null; end;
 update public.scouting_profiles set work_sample_url='https://example.com/poisoned' where owner_id=current_setting('aisas.test.profile_b')::uuid;
 if found then raise exception 'Cross-owner reference edit allowed'; end if;
end $$;
reset role;
rollback;
