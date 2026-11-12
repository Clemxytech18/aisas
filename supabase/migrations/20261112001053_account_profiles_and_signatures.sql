set local lock_timeout = '5s';

alter table public.scouting_profiles
 add column sender_name text not null default '' check(length(sender_name)<=120 and sender_name !~ E'[\\r\\n]'),
 add column signature_text text not null default '' check(length(signature_text)<=2000),
 add column signature_image_url text not null default '',
 add constraint profile_signatory_sender check(sender_name<>'' or (signature_text='' and signature_image_url='')),
 add constraint profile_signatory_owned_image check(signature_image_url='' or signature_image_url ~ ('^https://beslhrcwojbxbqcvsnhy[.]supabase[.]co/storage/v1/object/public/email-signatures/'||owner_id::text||'/[a-f0-9-]{36}[.]jpg$'));
alter table public.campaigns
 add column sender_name text not null default '',
 add column signature_text text not null default '',
 add column signature_image_url text not null default '';
-- Server-owned snapshots preserve the sign-off approved at save time.
create function aisas_private.snapshot_campaign_signatory() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 select p.sender_name,p.signature_text,p.signature_image_url into new.sender_name,new.signature_text,new.signature_image_url
 from public.scouting_profiles p where p.id=new.profile_id and p.owner_id=new.owner_id;
 new.sender_name:=coalesce(new.sender_name,'');new.signature_text:=coalesce(new.signature_text,'');new.signature_image_url:=coalesce(new.signature_image_url,'');
 return new;
end $$;
revoke all on function aisas_private.snapshot_campaign_signatory() from public,anon,authenticated;
create trigger campaign_signatory_snapshot before insert or update of profile_id,messages,approved on public.campaigns for each row execute function aisas_private.snapshot_campaign_signatory();

-- Stale access JWTs must not retain shared-data or upload access after deletion.
create function aisas_private.account_is_active() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and (banned_until is null or banned_until<=now()));
$$;
revoke all on function aisas_private.account_is_active() from public,anon;
grant usage on schema aisas_private to authenticated;
grant execute on function aisas_private.account_is_active() to authenticated;
alter policy signed_in_pool_read on public.prospect_pool using((select aisas_private.account_is_active()));
alter policy signed_in_health on public.campaign_delivery_status using((select aisas_private.account_is_active()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',false,2097152,array['image/jpeg']),
 ('email-signatures','email-signatures',true,2097152,array['image/jpeg']);
create policy account_images_read on storage.objects for select to authenticated using(
 bucket_id in ('avatars','email-signatures') and (storage.foldername(name))[1]=(select auth.uid()::text) and (select aisas_private.account_is_active()));
create policy account_images_insert on storage.objects for insert to authenticated with check(
 bucket_id in ('avatars','email-signatures') and name ~ ('^'||(select auth.uid()::text)||'/[a-f0-9-]{36}[.]jpg$') and (select aisas_private.account_is_active()));
create policy account_images_delete on storage.objects for delete to authenticated using(
 bucket_id in ('avatars','email-signatures') and (storage.foldername(name))[1]=(select auth.uid()::text) and (select aisas_private.account_is_active()));
-- No UPDATE/upsert permission: an image already approved by a campaign is immutable.

create function public.aisas_prepare_account_deletion(p_owner uuid) returns text[]
language plpgsql security invoker set search_path='' as $$
declare grants text[];
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 update public.campaigns set status='paused' where owner_id=p_owner and status in ('running','scheduled');
 update public.scout_runs set status='paused',lease_token=null,lease_until=null where owner_id=p_owner and status='running';
 select coalesce(array_agg(distinct g.grant_id),'{}') into grants
 from aisas_private.mailbox_credentials g join public.mailboxes m on m.id=g.mailbox_id
 where m.owner_id=p_owner and not exists(select 1 from aisas_private.mailbox_credentials g2 join public.mailboxes m2 on m2.id=g2.mailbox_id where g2.grant_id=g.grant_id and m2.owner_id<>p_owner);
 return grants;
end $$;
create function public.aisas_purge_account_events(p_owner uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 delete from aisas_private.email_events e where exists(
 select 1 from aisas_private.mailbox_credentials g join public.mailboxes m on m.id=g.mailbox_id
 where m.owner_id=p_owner and g.grant_id=e.event->>'grant_id'
 and not exists(select 1 from aisas_private.mailbox_credentials g2 join public.mailboxes m2 on m2.id=g2.mailbox_id where g2.grant_id=g.grant_id and m2.owner_id<>p_owner));
end $$;
revoke all on function public.aisas_prepare_account_deletion(uuid),public.aisas_purge_account_events(uuid) from public,anon,authenticated;
grant execute on function public.aisas_prepare_account_deletion(uuid),public.aisas_purge_account_events(uuid) to service_role;
