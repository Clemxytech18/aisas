create extension if not exists pg_trgm with schema extensions;
-- Shared public-source prospects are separate from user-owned lists and campaign state.
create table public.prospect_pool (
 id uuid primary key default gen_random_uuid(),
 prospect_kind text not null check(prospect_kind in ('company','person')),
 fingerprint text not null unique,
 company text not null default '', contact_name text not null default '',
 category text not null default '', industry text not null default '', location text not null default '',
 job_title text not null default '', department text not null default '', seniority text not null default '',
 email text not null default '', phone text not null default '', website text not null default '', linkedin text not null default '',
 domain text not null default '', source_url text not null check(source_url ~ '^https?://'), summary text not null default '',
 company_size text not null default '', revenue numeric check(revenue between 0 and 1e15),
 funding_amount numeric check(funding_amount between 0 and 1e15), founded_year integer check(founded_year between 1000 and 2100),
 technologies text[] not null default '{}',
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 search_document tsvector generated always as (to_tsvector('simple'::regconfig,
   company||' '||contact_name||' '||category||' '||industry||' '||location||' '||job_title||' '||department||' '||seniority||' '||summary)) stored,
 check((prospect_kind='company' and company<>'') or (prospect_kind='person' and contact_name<>''))
);
alter table public.prospect_pool enable row level security;
revoke all on public.prospect_pool from public,anon,authenticated;
grant select on public.prospect_pool to authenticated;
grant all on public.prospect_pool to service_role;
create policy signed_in_pool_read on public.prospect_pool for select to authenticated using ((select auth.uid()) is not null);
create index prospect_pool_company_text_idx on public.prospect_pool using gin(company extensions.gin_trgm_ops);
create index prospect_pool_contact_name_text_idx on public.prospect_pool using gin(contact_name extensions.gin_trgm_ops);
create index prospect_pool_location_text_idx on public.prospect_pool using gin(location extensions.gin_trgm_ops);
create index prospect_pool_job_title_text_idx on public.prospect_pool using gin(job_title extensions.gin_trgm_ops);
create index prospect_pool_search_idx on public.prospect_pool using gin(search_document);
create index prospect_pool_browse_idx on public.prospect_pool(prospect_kind,last_seen_at desc,id);
create index prospect_pool_domain_idx on public.prospect_pool(domain);
create index prospect_pool_industry_idx on public.prospect_pool(industry);
create index prospect_pool_size_idx on public.prospect_pool(company_size);
create index prospect_pool_revenue_idx on public.prospect_pool(revenue) where revenue is not null;
create index prospect_pool_funding_idx on public.prospect_pool(funding_amount) where funding_amount is not null;
create index prospect_pool_founded_idx on public.prospect_pool(founded_year) where founded_year is not null;
create index prospect_pool_technology_idx on public.prospect_pool using gin(technologies);

alter table public.leads
 add column pool_prospect_id uuid references public.prospect_pool(id) on delete set null,
 add column prospect_kind text not null default 'company' check(prospect_kind in ('company','person')),
 add column industry text not null default '',
 add column job_title text not null default '', add column department text not null default '', add column seniority text not null default '',
 add column company_size text not null default '', add column revenue numeric check(revenue between 0 and 1e15),
 add column funding_amount numeric check(funding_amount between 0 and 1e15), add column founded_year integer check(founded_year between 1000 and 2100),
 add column technologies text[] not null default '{}', add column domain text not null default '', add column summary text not null default '';
-- Allow different people at one company even when neither has a published email.
drop index public.lead_dedup;
create unique index lead_dedup on public.leads(list_id,lower(company),lower(contact_name),lower(email));
create unique index lead_pool_dedup on public.leads(list_id,pool_prospect_id) where pool_prospect_id is not null;
create index leads_pool_fk_idx on public.leads(pool_prospect_id) where pool_prospect_id is not null;
-- Existing column-level verification protections remain in place; new descriptive fields are writable only in own rows.
grant insert(prospect_kind,industry,job_title,department,seniority,company_size,revenue,funding_amount,founded_year,technologies,domain,summary,pool_prospect_id),
 update(prospect_kind,industry,job_title,department,seniority,company_size,revenue,funding_amount,founded_year,technologies,domain,summary,pool_prospect_id) on public.leads to authenticated;

-- Only trusted server scouting inserts publish allowlisted public prospect fields.
-- Client-created/edited leads and pool imports cannot publish or alter the shared pool.
create function aisas_private.publish_scout_prospect() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity_key text; pool_id uuid;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' or new.pool_prospect_id is not null
    or new.source_url !~ '^https?://' then return new; end if;
 if new.prospect_kind='person' and btrim(new.contact_name)='' then return new; end if;
 if new.prospect_kind='company' and btrim(new.company)='' then return new; end if;
 identity_key := case when new.prospect_kind='person' then
   coalesce(nullif(rtrim(lower(regexp_replace(split_part(new.linkedin,'?',1),'^https?://(www\.)?','','i')),'/'),''),nullif(lower(new.email),''),lower(new.contact_name)||'|'||lower(new.company)||'|'||lower(new.location))
   else lower(btrim(new.company))||'|'||lower(btrim(new.domain))||'|'||lower(btrim(new.email)) end;
 insert into public.prospect_pool(prospect_kind,fingerprint,company,contact_name,category,industry,location,job_title,department,seniority,email,phone,website,linkedin,domain,source_url,summary,company_size,revenue,funding_amount,founded_year,technologies)
 values(new.prospect_kind,md5(new.prospect_kind||'|'||identity_key),left(new.company,200),left(new.contact_name,200),left(new.category,200),left(new.industry,200),left(new.location,300),left(new.job_title,200),left(new.department,100),left(new.seniority,100),left(new.email,320),left(new.phone,100),left(new.website,2000),left(new.linkedin,2000),left(new.domain,253),left(new.source_url,2000),left(new.summary,2000),left(new.company_size,100),new.revenue,new.funding_amount,new.founded_year,new.technologies)
 on conflict(fingerprint) do update set
   last_seen_at=now(),
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
revoke all on function aisas_private.publish_scout_prospect() from public,anon,authenticated;
create trigger publish_scout_to_pool before insert on public.leads for each row execute function aisas_private.publish_scout_prospect();

create function public.aisas_search_pool(p_kind text default 'company',p_filters jsonb default '{}',p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; needle text; filters jsonb:=coalesce(p_filters,'{}');
begin
 if auth.uid() is null then raise exception 'Sign in to search the prospect pool.' using errcode='42501'; end if;
 if p_kind not in ('company','person') or p_kind is null or p_offset not between 0 and 10000 or p_offset is null or jsonb_typeof(filters)<>'object' or length(filters::text)>8000 then raise exception 'Invalid search request.'; end if;
 -- Reject malformed ranges rather than quietly treating missing data as zero.
 if exists(select 1 from jsonb_each_text(filters) f where f.key in ('revenue_min','revenue_max','funding_min','funding_max','founded_min','founded_max') and f.value is not null and f.value !~ '^\d+(\.\d+)?$') then raise exception 'Enter valid non-negative range values.'; end if;
 if coalesce((filters->>'revenue_min')::numeric,0)>coalesce((filters->>'revenue_max')::numeric,1e15)
 or coalesce((filters->>'funding_min')::numeric,0)>coalesce((filters->>'funding_max')::numeric,1e15)
 or coalesce((filters->>'founded_min')::numeric,1000)>coalesce((filters->>'founded_max')::numeric,2100) then raise exception 'Minimum values must not exceed maximum values.'; end if;
 if jsonb_typeof(coalesce(filters->'technologies','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(filters->'technologies','[]'::jsonb))>20 then raise exception 'Choose up to 20 technologies.'; end if;
 if exists(select 1 from jsonb_each_text(filters) f where f.key in ('revenue_min','revenue_max','funding_min','funding_max') and f.value is not null and f.value::numeric>1e15) then raise exception 'Range values are too large.'; end if;
 if exists(select 1 from jsonb_each_text(filters) f where f.key in ('founded_min','founded_max') and f.value is not null and (f.value !~ '^\d{4}$' or f.value::numeric not between 1000 and 2100)) then raise exception 'Enter founding years between 1000 and 2100.'; end if;
 needle:=btrim(coalesce(filters->>'keyword',''));
 with matches as (
  select p.* from public.prospect_pool p
  where p.prospect_kind=p_kind
   and (coalesce(filters->>'company','')='' or p.company ilike ('%'||replace(replace(replace(filters->>'company','^','^^'),'%','^%'),'_','^_')||'%') escape '^')
   and (coalesce(filters->>'person','')='' or p.contact_name ilike ('%'||replace(replace(replace(filters->>'person','^','^^'),'%','^%'),'_','^_')||'%') escape '^')
   and (coalesce(filters->>'location','')='' or p.location ilike ('%'||replace(replace(replace(filters->>'location','^','^^'),'%','^%'),'_','^_')||'%') escape '^')
   and (coalesce(filters->>'industry','')='' or position(lower(filters->>'industry') in lower(coalesce(nullif(p.industry,''),p.category)))>0)
   and (coalesce(filters->>'job_title','')='' or p.job_title ilike ('%'||replace(replace(replace(filters->>'job_title','^','^^'),'%','^%'),'_','^_')||'%') escape '^')
   and (coalesce(filters->>'department','')='' or lower(p.department)=lower(filters->>'department'))
   and (coalesce(filters->>'seniority','')='' or lower(p.seniority)=lower(filters->>'seniority'))
   and (coalesce(filters->>'company_size','')='' or p.company_size=filters->>'company_size')
   and (coalesce(filters->>'domain','')='' or p.domain=lower(filters->>'domain'))
   and (coalesce(filters->>'has_email','false')<>'true' or p.email<>'')
   and (coalesce(filters->>'has_phone','false')<>'true' or p.phone<>'')
   and (filters->>'revenue_min' is null or p.revenue >= (filters->>'revenue_min')::numeric)
   and (filters->>'revenue_max' is null or p.revenue <= (filters->>'revenue_max')::numeric)
   and (filters->>'funding_min' is null or p.funding_amount >= (filters->>'funding_min')::numeric)
   and (filters->>'funding_max' is null or p.funding_amount <= (filters->>'funding_max')::numeric)
   and (filters->>'founded_min' is null or p.founded_year >= (filters->>'founded_min')::integer)
   and (filters->>'founded_max' is null or p.founded_year <= (filters->>'founded_max')::integer)
   and (coalesce(filters->'technologies','[]')='[]'::jsonb or p.technologies @> array(select jsonb_array_elements_text(filters->'technologies')))
   and (needle='' or p.search_document @@ websearch_to_tsquery('simple'::regconfig,needle))
  order by p.last_seen_at desc,p.id limit 26 offset p_offset
 ), numbered as (select m.*,row_number() over(order by m.last_seen_at desc,m.id) as rn from matches m)
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(n)-'search_document'-'fingerprint'-'rn' order by n.rn) filter(where n.rn<=25),'[]'::jsonb),'has_more',count(*)>25) into result from numbered n;
 return result;
end $$;
revoke all on function public.aisas_search_pool(text,jsonb,integer) from public,anon;
grant execute on function public.aisas_search_pool(text,jsonb,integer) to authenticated;

create function public.aisas_save_pool_prospects(p_ids uuid[],p_list_id uuid default null,p_list_name text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare destination uuid:=p_list_id; added integer; requested integer;
begin
 if auth.uid() is null then raise exception 'Sign in to save prospects.' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 100 then raise exception 'Select between 1 and 100 prospects.'; end if;
 select count(distinct id) into requested from unnest(p_ids) as ids(id);
 if (select count(*) from public.prospect_pool where id=any(p_ids))<>requested then raise exception 'Some prospects are no longer available. Refresh your search.'; end if;
 if destination is null then
  if length(btrim(coalesce(p_list_name,''))) not between 1 and 160 then raise exception 'Choose a list name under 160 characters.'; end if;
  insert into public.lead_lists(owner_id,name) values(auth.uid(),btrim(p_list_name)) returning id into destination;
 elsif not exists(select 1 from public.lead_lists where id=destination and owner_id=auth.uid()) then
  raise exception 'Choose a list in your own workspace.' using errcode='42501';
 end if;
 insert into public.leads(owner_id,list_id,pool_prospect_id,prospect_kind,company,contact_name,category,industry,location,job_title,department,seniority,email,phone,website,linkedin,source_url,domain,summary,company_size,revenue,funding_amount,founded_year,technologies,score)
 select auth.uid(),destination,p.id,p.prospect_kind,p.company,p.contact_name,p.category,p.industry,p.location,p.job_title,p.department,p.seniority,p.email,p.phone,p.website,p.linkedin,p.source_url,p.domain,p.summary,p.company_size,p.revenue,p.funding_amount,p.founded_year,p.technologies,case when p.email<>'' then 85 when p.phone<>'' then 75 else 60 end
 from public.prospect_pool p where p.id=any(p_ids) on conflict do nothing;
 get diagnostics added=row_count;
 return jsonb_build_object('list_id',destination,'added',added,'skipped',requested-added);
end $$;
revoke all on function public.aisas_save_pool_prospects(uuid[],uuid,text) from public,anon;
grant execute on function public.aisas_save_pool_prospects(uuid[],uuid,text) to authenticated;

-- Service-only, atomic persistence for the dedicated scouting endpoint; it never sends mail.
create function public.aisas_save_scout_results(p_owner uuid,p_name text,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare destination uuid; saved integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server-only scouting persistence' using errcode='42501'; end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 160 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'Invalid scouting results'; end if;
 insert into public.lead_lists(owner_id,name) values(p_owner,btrim(p_name)) returning id into destination;
 insert into public.leads(owner_id,list_id,prospect_kind,company,contact_name,category,industry,location,job_title,department,seniority,email,phone,website,linkedin,source_url,domain,summary,company_size,revenue,funding_amount,founded_year,technologies,score)
 select p_owner,destination,coalesce(r.prospect_kind,'company'),coalesce(r.company,''),coalesce(r.contact_name,''),coalesce(r.category,''),coalesce(r.industry,''),coalesce(r.location,''),coalesce(r.job_title,''),coalesce(r.department,''),coalesce(r.seniority,''),coalesce(r.email,''),coalesce(r.phone,''),coalesce(r.website,''),coalesce(r.linkedin,''),coalesce(r.source_url,''),coalesce(r.domain,''),coalesce(r.summary,''),coalesce(r.company_size,''),r.revenue,r.funding_amount,r.founded_year,coalesce(r.technologies,'{}'::text[]),coalesce(r.score,0)
 from jsonb_to_recordset(p_rows) as r(prospect_kind text,company text,contact_name text,category text,industry text,location text,job_title text,department text,seniority text,email text,phone text,website text,linkedin text,source_url text,domain text,summary text,company_size text,revenue numeric,funding_amount numeric,founded_year integer,technologies text[],score integer)
 on conflict do nothing;
 get diagnostics saved=row_count;
 return jsonb_build_object('list_id',destination,'count',saved);
end $$;
revoke all on function public.aisas_save_scout_results(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.aisas_save_scout_results(uuid,text,jsonb) to service_role;
