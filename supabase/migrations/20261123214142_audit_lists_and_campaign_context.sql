-- Private audit lists reuse owned lead lists, without contributing uploaded contacts to the shared pool.
alter table public.leads add column first_name text not null default '',add column last_name text not null default '',add column instagram_url text not null default '',add column tiktok_url text not null default '',add column facebook_url text not null default '';
alter table public.leads add constraint leads_audit_parent_unique unique(id,list_id,owner_id);
alter table public.campaigns add column list_source text not null default 'audience' check(list_source in ('audience','audited'));
grant insert(list_source),update(list_source) on public.campaigns to authenticated;
alter table public.campaign_recipients add column audit_context jsonb;
create table public.audit_lists(
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 source text not null check(source in ('manual','file','ai')),status text not null default 'ready' check(status in ('ready','auditing','audited','partial')),
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,owner_id),
 foreign key(id,owner_id) references public.lead_lists(id,owner_id) on delete cascade
);
create index audit_lists_owner on public.audit_lists(owner_id,created_at desc);
create table public.audit_reports(
 lead_id uuid primary key,owner_id uuid not null,list_id uuid not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 cro_performance text not null default '',social_performance text not null default '',issues text not null default '',best_offer text not null default '',
 evidence jsonb not null default '[]',findings jsonb not null default '[]',limitations jsonb not null default '[]',
 input_snapshot jsonb,lease_token uuid,lease_until timestamptz,attempts integer not null default 0,last_error text,audited_at timestamptz,
 foreign key(lead_id,list_id,owner_id) references public.leads(id,list_id,owner_id) on delete cascade,
 foreign key(list_id,owner_id) references public.audit_lists(id,owner_id) on delete cascade,
 check(jsonb_typeof(evidence)='array' and jsonb_typeof(findings)='array' and jsonb_typeof(limitations)='array'),
 check(status<>'completed' or (length(cro_performance)>0 and length(social_performance)>0 and length(issues)>0 and length(best_offer)>0 and audited_at is not null))
);
create index audit_reports_owner_list on public.audit_reports(owner_id,list_id,status);
create index audit_reports_list_parent on public.audit_reports(list_id,owner_id);
create index audit_reports_lead_parent on public.audit_reports(lead_id,list_id,owner_id);
create index audit_reports_queue on public.audit_reports(status,lease_until) where status in ('pending','processing');
create table public.audit_discovery_runs(
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 terms text not null,location text not null,details text not null default '',method text not null check(method in ('boolean','google_maps')),
 status text not null default 'running' check(status in ('running','paused','completed')),state jsonb not null,
 lease_token uuid,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index audit_discovery_owner on public.audit_discovery_runs(owner_id,created_at desc);
do $$declare n text;begin
 foreach n in array array['audit_lists','audit_reports','audit_discovery_runs'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant all on public.%I to service_role',n);
  if n<>'audit_discovery_runs' then execute format('grant select on public.%I to authenticated',n);end if;
  execute format('create policy owner_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',n);
 end loop;
end $$;
grant select(id,owner_id,terms,location,details,method,status,created_at,updated_at) on public.audit_discovery_runs to authenticated;
revoke select on public.audit_reports from authenticated;
grant select(lead_id,owner_id,list_id,status,cro_performance,social_performance,issues,best_offer,evidence,findings,limitations,audited_at,last_error) on public.audit_reports to authenticated;
create table aisas_private.audit_usage(owner_id uuid not null references auth.users(id) on delete cascade,day date not null,kind text not null check(kind in ('audit','discover','sequence')),attempts integer not null default 1,primary key(owner_id,day,kind));
alter table aisas_private.audit_usage enable row level security;
revoke all on aisas_private.audit_usage from public,anon,authenticated;
grant all on aisas_private.audit_usage to service_role;
create function public.aisas_audit_quota(p_owner uuid,p_kind text) returns boolean language plpgsql security invoker set search_path='' as $$
declare used integer;cap integer:=case p_kind when 'audit' then 500 when 'discover' then 30 when 'sequence' then 100 else 0 end;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if cap=0 then return false;end if;
 insert into aisas_private.audit_usage(owner_id,day,kind) values(p_owner,(now() at time zone 'UTC')::date,p_kind)
 on conflict(owner_id,day,kind) do update set attempts=aisas_private.audit_usage.attempts+1 where aisas_private.audit_usage.attempts<cap returning attempts into used;
 return used is not null;
end $$;

create function aisas_private.validate_audit_lead() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.audit_lists a where a.id=new.list_id and a.owner_id=new.owner_id) then
  if coalesce(auth.jwt()->>'role','')<>'service_role' and (auth.uid() is null or auth.uid()<>new.owner_id) then raise exception 'Not authorized' using errcode='42501';end if;
  if btrim(new.first_name)='' or btrim(new.company)='' or btrim(new.email)='' or btrim(new.website)='' then raise exception 'Audit leads require Firstname, Email, Business name and Website URL.';end if;
  if exists(select 1 from public.campaigns c where c.list_id=new.list_id and c.owner_id=new.owner_id and c.status in ('running','scheduled')) then raise exception 'Pause campaigns using this audit list before editing its leads.';end if;
 end if;
 if tg_op='UPDATE' and exists(select 1 from public.audit_lists a where a.id=old.list_id) and (new.list_id is distinct from old.list_id or new.owner_id is distinct from old.owner_id) then raise exception 'Audit leads cannot be moved between lists.';end if;
 return new;
end $$;
revoke all on function aisas_private.validate_audit_lead() from public,anon,authenticated;
create trigger validate_audit_lead before insert or update of first_name,last_name,email,company,website,instagram_url,tiktok_url,facebook_url,linkedin,list_id,owner_id on public.leads for each row execute function aisas_private.validate_audit_lead();
create function aisas_private.invalidate_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.audit_lists where id=new.list_id and owner_id=new.owner_id) then return new;end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' and (auth.uid() is null or auth.uid()<>new.owner_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if tg_op='INSERT' or (new.first_name,new.last_name,new.email,new.company,new.website,new.instagram_url,new.tiktok_url,new.facebook_url,new.linkedin) is distinct from (old.first_name,old.last_name,old.email,old.company,old.website,old.instagram_url,old.tiktok_url,old.facebook_url,old.linkedin) then
  update public.audit_reports set status='pending',lease_token=null,lease_until=null,audited_at=null,last_error=null where lead_id=new.id;
  update public.audit_lists set status='ready',revision=revision+1,updated_at=now() where id=new.list_id and owner_id=new.owner_id;
 end if;
 return new;
end $$;
revoke all on function aisas_private.invalidate_audit() from public,anon,authenticated;
create trigger invalidate_audit after insert or update of first_name,last_name,email,company,website,instagram_url,tiktok_url,facebook_url,linkedin on public.leads for each row execute function aisas_private.invalidate_audit();

create function public.aisas_save_audit_list(p_owner uuid,p_id uuid,p_name text,p_source text,p_rows jsonb,p_revision integer default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.audit_lists;v jsonb;rid uuid;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if length(btrim(p_name)) not between 1 and 160 or p_source not in ('manual','file','ai') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Invalid audit list';end if;
 select * into existing from public.audit_lists where id=p_id and owner_id=p_owner for update;
 if found then
  if p_revision is distinct from existing.revision then raise exception 'This list changed. Reopen it before saving.';end if;
  if exists(select 1 from public.campaigns where list_id=p_id and owner_id=p_owner and status in ('running','scheduled')) then raise exception 'Pause campaigns using this list before editing it.';end if;
  update public.lead_lists set name=btrim(p_name) where id=p_id and owner_id=p_owner;
 else
  if p_revision is not null then raise exception 'Audit list unavailable';end if;
  insert into public.lead_lists(id,owner_id,name) values(p_id,p_owner,btrim(p_name));
  insert into public.audit_lists(id,owner_id,source) values(p_id,p_owner,p_source);
 end if;
 -- Removing a historical campaign recipient must not erase its conversation and delivery evidence.
 if exists(select 1 from public.leads l join public.campaign_recipients r on r.lead_id=l.id where l.list_id=p_id and l.owner_id=p_owner and not exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'id')::uuid=l.id)) then raise exception 'A removed lead is already used by a campaign. Save a new list instead.';end if;
 delete from public.leads l where l.list_id=p_id and l.owner_id=p_owner and not exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'id')::uuid=l.id);
 for v in select * from jsonb_array_elements(p_rows) loop
  rid:=(v->>'id')::uuid;
  if exists(select 1 from public.leads where id=rid and (owner_id<>p_owner or list_id<>p_id)) then raise exception 'Lead unavailable';end if;
  insert into public.leads(id,owner_id,list_id,first_name,last_name,email,company,website,instagram_url,tiktok_url,facebook_url,linkedin,contact_name,location,category,source_url,domain)
  values(rid,p_owner,p_id,v->>'first_name',coalesce(v->>'last_name',''),lower(v->>'email'),v->>'company',v->>'website',coalesce(v->>'instagram_url',''),coalesce(v->>'tiktok_url',''),coalesce(v->>'facebook_url',''),coalesce(v->>'linkedin',''),concat_ws(' ',v->>'first_name',nullif(v->>'last_name','')),coalesce(v->>'location',''),coalesce(v->>'category',''),coalesce(v->>'source_url',''),'')
  on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,company=excluded.company,website=excluded.website,instagram_url=excluded.instagram_url,tiktok_url=excluded.tiktok_url,facebook_url=excluded.facebook_url,linkedin=excluded.linkedin,contact_name=excluded.contact_name,location=excluded.location,category=excluded.category,source_url=excluded.source_url;
 end loop;
 update public.audit_lists set status=case when exists(select 1 from public.leads l left join public.audit_reports r on r.lead_id=l.id where l.list_id=p_id and (r.status is distinct from 'completed')) then 'ready' else status end,revision=revision+1,updated_at=now() where id=p_id and owner_id=p_owner;
 return (select to_jsonb(a) from public.audit_lists a where id=p_id);
end $$;

create function public.aisas_start_audit(p_owner uuid,p_list uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 perform 1 from public.audit_lists where id=p_list and owner_id=p_owner for update;
 if not found then raise exception 'Audit list unavailable';end if;
 if exists(select 1 from public.audit_reports where list_id=p_list and status='processing' and lease_until>now()) then raise exception 'An audit is already running. Refresh to see progress.';end if;
 insert into public.audit_reports(lead_id,owner_id,list_id) select id,owner_id,list_id from public.leads where list_id=p_list and owner_id=p_owner
 on conflict(lead_id) do update set status='pending',lease_token=null,lease_until=null,last_error=null,audited_at=null,attempts=0;
 if not found then raise exception 'Add leads before auditing this list.';end if;
 update public.audit_lists set status='auditing',updated_at=now() where id=p_list;
end $$;
create function public.aisas_claim_audit(p_owner uuid default null,p_list uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.audit_reports;token uuid:=gen_random_uuid();begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 update public.audit_reports set status='failed',last_error='Processing was interrupted repeatedly. Retry this audit when ready.',lease_token=null,lease_until=null where status='processing' and lease_until<now() and attempts>=5;
 update public.audit_lists a set status=case when exists(select 1 from public.audit_reports r where r.list_id=a.id and r.status='failed') then 'partial' else 'audited' end where a.status='auditing' and not exists(select 1 from public.audit_reports r where r.list_id=a.id and r.status in ('pending','processing'));
 select q.* into r from public.audit_reports q join public.audit_lists a on a.id=q.list_id and a.status='auditing'
 where (p_owner is null or q.owner_id=p_owner) and (p_list is null or q.list_id=p_list) and (q.status='pending' or (q.status='processing' and q.lease_until<now())) and q.attempts<5
 order by a.updated_at,q.lead_id for update of q skip locked limit 1;
 if not found then return null;end if;
 update public.audit_reports set status='processing',lease_token=token,lease_until=now()+interval '3 minutes',attempts=attempts+1 where lead_id=r.lead_id;
 return jsonb_build_object('lead',(select to_jsonb(l) from public.leads l where l.id=r.lead_id),'lease',token,'owner_id',r.owner_id,'list_id',r.list_id);
end $$;
create function public.aisas_finish_audit(p_lead uuid,p_lease uuid,p_result jsonb default null,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.audit_reports;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.audit_reports where lead_id=p_lead and lease_token=p_lease and status='processing' for update;
 if not found then return false;end if;
 if p_result is not null then update public.audit_reports set status='completed',cro_performance=p_result->>'cro_performance',social_performance=p_result->>'social_performance',issues=p_result->>'issues',best_offer=p_result->>'best_offer',evidence=coalesce(p_result->'evidence','[]'),findings=coalesce(p_result->'findings','[]'),limitations=coalesce(p_result->'limitations','[]'),input_snapshot=p_result->'input_snapshot',audited_at=now(),last_error=null,lease_token=null,lease_until=null where lead_id=p_lead;
 else update public.audit_reports set status='failed',last_error=left(p_error,500),lease_token=null,lease_until=null where lead_id=p_lead;end if;
 update public.audit_lists a set status=case when exists(select 1 from public.audit_reports q where q.list_id=a.id and q.status in ('pending','processing')) then 'auditing' when exists(select 1 from public.audit_reports q where q.list_id=a.id and q.status='failed') then 'partial' else 'audited' end,updated_at=now() where a.id=r.list_id;
 return true;
end $$;
create function public.aisas_claim_audit_discovery(p_owner uuid,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.audit_discovery_runs;token uuid:=gen_random_uuid();begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.audit_discovery_runs where id=p_id and owner_id=p_owner for update;
 if not found then raise exception 'Discovery unavailable';end if;
 if r.status<>'running' or r.lease_until>now() then return jsonb_build_object('busy',r.lease_until>now());end if;
 update public.audit_discovery_runs set lease_token=token,lease_until=now()+interval '3 minutes' where id=p_id;
 return jsonb_build_object('lease',token,'state',r.state);
end $$;
-- Only server code can mutate audit metadata or access discovery checkpoints.
revoke all on function public.aisas_audit_quota(uuid,text),public.aisas_save_audit_list(uuid,uuid,text,text,jsonb,integer),public.aisas_start_audit(uuid,uuid),public.aisas_claim_audit(uuid,uuid),public.aisas_finish_audit(uuid,uuid,jsonb,text),public.aisas_claim_audit_discovery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aisas_audit_quota(uuid,text),public.aisas_save_audit_list(uuid,uuid,text,text,jsonb,integer),public.aisas_start_audit(uuid,uuid),public.aisas_claim_audit(uuid,uuid),public.aisas_finish_audit(uuid,uuid,jsonb,text),public.aisas_claim_audit_discovery(uuid,uuid) to service_role;

create function public.aisas_list_audits(p_owner uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
 select a.*,l.name,(select count(*) from public.leads p where p.list_id=a.id) as total,
 (select count(*) from public.audit_reports r where r.list_id=a.id and r.status='completed') as completed,
 (select count(*) from public.audit_reports r where r.list_id=a.id and r.status='failed') as failed,
 (select count(*) from public.audit_reports r where r.list_id=a.id and r.status='processing') as processing,
 (select count(*) from public.audit_reports r where r.list_id=a.id and r.status='pending') as pending,
 exists(select 1 from public.campaigns c where c.list_id=a.id and c.status in ('running','scheduled')) as locked
 from public.audit_lists a join public.lead_lists l on l.id=a.id and l.owner_id=a.owner_id where a.owner_id=p_owner order by a.created_at desc)x);
end $$;
create function public.aisas_search_audit_leads(p_owner uuid,p_query text default '',p_offset integer default 0,p_audited boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(
 select l.*,n.name as list_name,(to_jsonb(r)-'lease_token'-'lease_until'-'input_snapshot'-'attempts') as audit_report from public.leads l join public.audit_lists a on a.id=l.list_id and a.owner_id=l.owner_id join public.lead_lists n on n.id=a.id
 left join public.audit_reports r on r.lead_id=l.id and r.owner_id=l.owner_id
 where l.owner_id=p_owner and (not p_audited or r.status='completed') and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',l.first_name,l.last_name,l.email,l.company,l.website,r.issues,r.best_offer)))>0)
 order by l.created_at desc,l.id limit 26 offset greatest(0,least(p_offset,100000)))x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'has_more',jsonb_array_length(rows)>25);
end $$;
revoke all on function public.aisas_list_audits(uuid),public.aisas_search_audit_leads(uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.aisas_list_audits(uuid),public.aisas_search_audit_leads(uuid,text,integer,boolean) to service_role;

create function aisas_private.request_audit_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare secret text;begin
 if not exists(select 1 from public.audit_lists where status='auditing') then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='aisas_CRON_SECRET' limit 1;
 if coalesce(secret,'')='' then raise exception 'Worker credential missing';end if;
 return net.http_post(url:='https://beslhrcwojbxbqcvsnhy.supabase.co/functions/v1/audit-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=110000);
end $$;
create function public.aisas_request_audit_worker() returns bigint language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 return aisas_private.request_audit_worker();
end $$;
revoke all on function aisas_private.request_audit_worker(),public.aisas_request_audit_worker() from public,anon,authenticated;
grant execute on function aisas_private.request_audit_worker(),public.aisas_request_audit_worker() to service_role;
select cron.schedule('aisas-audit-worker','* * * * *','select aisas_private.request_audit_worker();');
select cron.alter_job((select jobid from cron.job where jobname='aisas-audit-worker'),active:=false);

-- Imported and AI-generated audit leads are searchable by their owner only.
-- Preserve the existing shared-pool publisher for regular scouting.
do $$declare definition text;begin
 definition:=pg_get_functiondef('aisas_private.publish_scout_prospect()'::regprocedure);
 if position(E'begin\n' in definition)=0 then raise exception 'Unexpected pool publisher definition';end if;
 execute replace(definition,E'begin\n',E'begin\n if exists(select 1 from public.audit_lists a where a.id=new.list_id and a.owner_id=new.owner_id) then return new;end if;\n');
end $$;
create function aisas_private.guard_audited_campaign() returns trigger language plpgsql security invoker set search_path='' as $$
declare a public.audit_lists;begin
 select * into a from public.audit_lists where id=new.list_id and owner_id=new.owner_id;
 if new.list_source='audited' then
  if not found or a.status<>'audited' or not exists(select 1 from public.leads l where l.list_id=a.id) or exists(select 1 from public.leads l left join public.audit_reports r on r.lead_id=l.id and r.owner_id=l.owner_id where l.list_id=a.id and r.status is distinct from 'completed') then raise exception 'Finish auditing every lead before saving this audited campaign.';end if;
 elsif found then raise exception 'Choose Audited List for an audit list.';
 end if;
 return new;
end $$;
revoke all on function aisas_private.guard_audited_campaign() from public,anon,authenticated;
create trigger guard_audited_campaign before insert or update of list_source,list_id,messages,approved on public.campaigns for each row execute function aisas_private.guard_audited_campaign();
create function aisas_private.snapshot_recipient_audit() returns trigger language plpgsql security invoker set search_path='' as $$
declare source text;begin
 select list_source into source from public.campaigns where id=new.campaign_id and owner_id=new.owner_id;
 new.audit_context:=null;
 if source='audited' then
  select jsonb_build_object('first_name',l.first_name,'last_name',l.last_name,'company',l.company,'email',l.email,'website',l.website,'cro_performance',r.cro_performance,'social_performance',r.social_performance,'issues',r.issues,'best_offer',r.best_offer)
  into new.audit_context from public.leads l join public.audit_lists a on a.id=l.list_id and a.owner_id=l.owner_id and a.status='audited' join public.audit_reports r on r.lead_id=l.id and r.owner_id=l.owner_id and r.status='completed'
  where l.id=new.lead_id and l.owner_id=new.owner_id and l.list_id=(select list_id from public.campaigns where id=new.campaign_id);
  if new.audit_context is null then raise exception 'An audited recipient has no current completed audit.';end if;
 end if;
 return new;
end $$;
revoke all on function aisas_private.snapshot_recipient_audit() from public,anon,authenticated;
create trigger recipient_audit_snapshot before insert on public.campaign_recipients for each row execute function aisas_private.snapshot_recipient_audit();
-- Keep all existing delivery, quota and suppression guards; pass the immutable audit snapshot.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.aisas_begin_campaign_send(uuid,uuid)'::regprocedure);
 if position('''ideal_context'',r.ideal_context' in definition)=0 or position('select * into l from public.leads where id=r.lead_id;' in definition)=0 then raise exception 'Unexpected delivery function definition';end if;
 definition:=replace(definition,'''ideal_context'',r.ideal_context','''ideal_context'',r.ideal_context,''audit_context'',r.audit_context');
 definition:=replace(definition,'select * into l from public.leads where id=r.lead_id;',E'select * into l from public.leads where id=r.lead_id;\n if c.list_source=''audited'' and (r.audit_context is null or r.audit_context->>''email'' is distinct from l.email or r.audit_context->>''website'' is distinct from l.website or r.audit_context->>''company'' is distinct from l.company or r.audit_context->>''first_name'' is distinct from l.first_name) then update public.campaign_recipients set status=''suppressed'',last_error=''The audited contact changed after launch. Review the list and create a new campaign.'',claim_token=null where id=r.id;return null;end if;');
 execute definition;
end $$;
