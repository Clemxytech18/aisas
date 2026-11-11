-- Resumable, owner-private scouting. Only authenticated server code writes run state or results.
create table public.scout_runs (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 profile_id uuid references public.scouting_profiles(id) on delete set null,
 name text not null check(length(name) between 1 and 160),
 kind text not null check(kind in ('person','company')),
 target integer not null check(target between 1 and 1000),
 status text not null default 'running' check(status in ('running','paused','completed')),
 list_id uuid references public.lead_lists(id) on delete set null,
 stats jsonb not null default '{}'::jsonb,
 reason text,
 warnings jsonb not null default '[]'::jsonb,
 state jsonb not null,
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index scout_runs_owner_updated_idx on public.scout_runs(owner_id,updated_at desc);
create index scout_runs_profile_idx on public.scout_runs(profile_id);
create index scout_runs_list_idx on public.scout_runs(list_id);
alter table public.scout_runs enable row level security;
create policy scout_runs_owner_read on public.scout_runs for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.scout_runs from public,anon,authenticated;
grant select(id,owner_id,profile_id,name,kind,target,status,list_id,stats,reason,warnings,created_at,updated_at) on public.scout_runs to authenticated;
grant all on public.scout_runs to service_role;

create function public.aisas_start_scout_run(p_id uuid,p_owner uuid,p_profile uuid,p_name text,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.scout_runs;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,73));
 select * into existing from public.scout_runs where id=p_id;
 if found then
  if existing.owner_id<>p_owner then raise exception 'Run unavailable' using errcode='42501';end if;
  return jsonb_build_object('id',existing.id);
 end if;
 if not exists(select 1 from public.scouting_profiles where id=p_profile and owner_id=p_owner) then raise exception 'Choose your own audience profile';end if;
 if length(btrim(p_name)) not between 1 and 160 or (p_state->>'version')::integer<>1 or (p_state->'options'->>'target')::integer not between 1 and 1000 or (p_state->'options'->>'searchBudget')::integer not between 1 and 100 or octet_length(p_state::text)>6000000 then raise exception 'Invalid scouting run';end if;
 if (select count(*) from public.scout_runs where owner_id=p_owner and status='running')>=3 then raise exception 'Pause an existing scout before starting another.';end if;
 if not public.aisas_reserve_usage(p_owner,'scout') then raise exception 'Daily scouting limit reached. Try again tomorrow.';end if;
 insert into public.scout_runs(id,owner_id,profile_id,name,kind,target,stats,state) values(p_id,p_owner,p_profile,btrim(p_name),p_state->>'kind',(p_state->'options'->>'target')::integer,p_state->'stats',p_state);
 return jsonb_build_object('id',p_id);
end $$;

create function public.aisas_claim_scout_run(p_id uuid,p_owner uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.scout_runs; token uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.scout_runs where id=p_id and owner_id=p_owner for update;
 if not found then raise exception 'Scouting run unavailable';end if;
 if r.status<>'running' then return jsonb_build_object('idle',true);end if;
 if r.lease_until>now() then return jsonb_build_object('busy',true);end if;
 token:=gen_random_uuid();
 update public.scout_runs set lease_token=token,lease_until=now()+interval '110 seconds',updated_at=now() where id=p_id;
 return jsonb_build_object('state',r.state,'lease',token);
end $$;

create function public.aisas_checkpoint_scout_run(p_id uuid,p_owner uuid,p_lease uuid,p_state jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.scout_runs; destination uuid; saved integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.scout_runs where id=p_id and owner_id=p_owner for update;
 if not found or r.lease_token is distinct from p_lease then raise exception 'Scouting step expired; resume this run.';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 or octet_length(p_state::text)>6000000 then raise exception 'Invalid checkpoint';end if;
 destination:=r.list_id;
 if destination is null and coalesce((r.stats->>'saved')::integer,0)>0 then raise exception 'The results list was deleted. Start a new scout.';end if;
 if destination is null and jsonb_array_length(p_rows)>0 then
  insert into public.lead_lists(owner_id,name) values(p_owner,r.name) returning id into destination;
 end if;
 if destination is not null then
  insert into public.leads(id,owner_id,list_id,prospect_kind,company,contact_name,category,industry,location,job_title,department,seniority,email,phone,website,linkedin,source_url,domain,summary,company_size,revenue,funding_amount,founded_year,technologies,score)
  select x.id,p_owner,destination,coalesce(x.prospect_kind,'company'),coalesce(x.company,''),coalesce(x.contact_name,''),coalesce(x.category,''),coalesce(x.industry,''),coalesce(x.location,''),coalesce(x.job_title,''),coalesce(x.department,''),coalesce(x.seniority,''),coalesce(x.email,''),coalesce(x.phone,''),coalesce(x.website,''),coalesce(x.linkedin,''),coalesce(x.source_url,''),coalesce(x.domain,''),coalesce(x.summary,''),coalesce(x.company_size,''),x.revenue,x.funding_amount,x.founded_year,coalesce(x.technologies,'{}'::text[]),coalesce(x.score,0)
  from jsonb_to_recordset(p_rows) as x(id uuid,prospect_kind text,company text,contact_name text,category text,industry text,location text,job_title text,department text,seniority text,email text,phone text,website text,linkedin text,source_url text,domain text,summary text,company_size text,revenue numeric,funding_amount numeric,founded_year integer,technologies text[],score integer)
  on conflict(id) do update set email=coalesce(nullif(public.leads.email,''),excluded.email),phone=coalesce(nullif(public.leads.phone,''),excluded.phone),website=coalesce(nullif(public.leads.website,''),excluded.website),linkedin=coalesce(nullif(public.leads.linkedin,''),excluded.linkedin),job_title=coalesce(nullif(public.leads.job_title,''),excluded.job_title)
  where public.leads.owner_id=p_owner and public.leads.list_id=destination;
 end if;
 select count(*) into saved from public.leads where list_id=destination and owner_id=p_owner;
 update public.scout_runs set list_id=destination,state=p_state,stats=jsonb_set(p_state->'stats','{saved}',to_jsonb(saved)),reason=p_state->>'reason',warnings=coalesce(p_state->'warnings','[]'::jsonb),status=case when (p_state->>'done')::boolean then 'completed' else status end,lease_token=null,lease_until=null,updated_at=now() where id=p_id;
 return jsonb_build_object('count',saved,'list_id',destination);
end $$;
revoke all on function public.aisas_start_scout_run(uuid,uuid,uuid,text,jsonb),public.aisas_claim_scout_run(uuid,uuid),public.aisas_checkpoint_scout_run(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.aisas_start_scout_run(uuid,uuid,uuid,text,jsonb),public.aisas_claim_scout_run(uuid,uuid),public.aisas_checkpoint_scout_run(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create index prospect_pool_person_identity_idx on public.prospect_pool(lower(contact_name),lower(company),lower(location)) where prospect_kind='person';

-- Separate named people sharing an office email; publish later server enrichment too.
create or replace function aisas_private.publish_scout_prospect() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity_key text; pool_id uuid; existing_identity text;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' or (tg_op='INSERT' and new.pool_prospect_id is not null)
    or new.source_url !~ '^https?://' then return new; end if;
 if new.prospect_kind='person' and btrim(new.contact_name)='' then return new; end if;
 if new.prospect_kind='company' and btrim(new.company)='' then return new; end if;
 identity_key := case when new.prospect_kind='person' then
 lower(btrim(new.contact_name))||'|'||lower(btrim(new.company))||'|'||lower(btrim(new.location))
 else lower(btrim(new.company))||'|'||lower(btrim(new.domain))||'|'||lower(btrim(new.email)) end;
 if new.prospect_kind='person' then
  select fingerprint into existing_identity from public.prospect_pool
  where prospect_kind='person' and lower(contact_name)=lower(btrim(new.contact_name)) and lower(company)=lower(btrim(new.company)) and lower(location)=lower(btrim(new.location)) order by first_seen_at limit 1;
 end if;
 insert into public.prospect_pool(prospect_kind,fingerprint,company,contact_name,category,industry,location,job_title,department,seniority,email,phone,website,linkedin,domain,source_url,summary,company_size,revenue,funding_amount,founded_year,technologies)
 values(new.prospect_kind,coalesce(existing_identity,md5(new.prospect_kind||'|'||identity_key)),left(new.company,200),left(new.contact_name,200),left(new.category,200),left(new.industry,200),left(new.location,300),left(new.job_title,200),left(new.department,100),left(new.seniority,100),left(new.email,320),left(new.phone,100),left(new.website,2000),left(new.linkedin,2000),left(new.domain,253),left(new.source_url,2000),left(new.summary,2000),left(new.company_size,100),new.revenue,new.funding_amount,new.founded_year,new.technologies)
 on conflict(fingerprint) do update set
   last_seen_at=now(),
   email=coalesce(nullif(excluded.email,''),prospect_pool.email),
   contact_name=coalesce(nullif(excluded.contact_name,''),prospect_pool.contact_name),
   industry=coalesce(nullif(excluded.industry,''),prospect_pool.industry),
   job_title=coalesce(nullif(excluded.job_title,''),prospect_pool.job_title),
   department=coalesce(nullif(excluded.department,''),prospect_pool.department),
   seniority=coalesce(nullif(excluded.seniority,''),prospect_pool.seniority),
   phone=coalesce(nullif(excluded.phone,''),prospect_pool.phone),
   website=coalesce(nullif(excluded.website,''),prospect_pool.website),
   linkedin=coalesce(nullif(excluded.linkedin,''),prospect_pool.linkedin),
   summary=coalesce(nullif(excluded.summary,''),prospect_pool.summary),
   company_size=coalesce(nullif(excluded.company_size,''),prospect_pool.company_size),
   revenue=coalesce(excluded.revenue,prospect_pool.revenue), funding_amount=coalesce(excluded.funding_amount,prospect_pool.funding_amount),
   founded_year=coalesce(excluded.founded_year,prospect_pool.founded_year),
   technologies=case when cardinality(excluded.technologies)>0 then excluded.technologies else prospect_pool.technologies end
 returning id into pool_id;
 new.pool_prospect_id:=pool_id;
 return new;
end $$;
drop trigger publish_scout_to_pool on public.leads;
create trigger publish_scout_to_pool before insert or update of email,phone,website,linkedin,job_title on public.leads for each row execute function aisas_private.publish_scout_prospect();
