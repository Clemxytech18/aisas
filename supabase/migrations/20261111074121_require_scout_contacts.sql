-- Only public email/phone-bearing prospects are returned or saved by scouting/search.
create or replace function public.aisas_checkpoint_scout_run(p_id uuid,p_owner uuid,p_lease uuid,p_state jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.scout_runs; destination uuid; saved integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.scout_runs where id=p_id and owner_id=p_owner for update;
 if not found or r.lease_token is distinct from p_lease then raise exception 'Scouting step expired; resume this run.';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 or octet_length(p_state::text)>6000000 then raise exception 'Invalid checkpoint';end if;
 p_rows:=coalesce((select jsonb_agg(value) from jsonb_array_elements(p_rows) where (coalesce(value->>'email','') ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(translate(coalesce(value->>'phone',''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g')) between 7 and 18)),'[]'::jsonb);
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

create or replace function public.aisas_search_pool(p_kind text default 'company',p_filters jsonb default '{}',p_offset integer default 0)
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
  where p.prospect_kind=p_kind and (p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(translate(p.phone,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g')) between 7 and 18)
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

create or replace function public.aisas_save_pool_prospects(p_ids uuid[],p_list_id uuid default null,p_list_name text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare destination uuid:=p_list_id; added integer; requested integer;
begin
 if auth.uid() is null then raise exception 'Sign in to save prospects.' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 100 then raise exception 'Select between 1 and 100 prospects.'; end if;
 select count(distinct id) into requested from unnest(p_ids) as ids(id);
 if (select count(*) from public.prospect_pool p where id=any(p_ids) and (p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(translate(p.phone,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g')) between 7 and 18))<>requested then raise exception 'Some prospects are no longer available. Refresh your search.'; end if;
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
