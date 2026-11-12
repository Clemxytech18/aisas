set local lock_timeout='5s';
create table public.ideal_profiles(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users on delete cascade,
 audience_profile_id uuid not null,name text not null check(length(btrim(name)) between 1 and 160),
 business text not null check(length(btrim(business)) between 1 and 2000),
 decision_maker text not null check(length(btrim(decision_maker)) between 1 and 2000),
 starting_segment text not null check(length(btrim(starting_segment)) between 1 and 2000),
 main_problem text not null check(length(btrim(main_problem)) between 1 and 2000),
 secondary_problem text not null check(length(btrim(secondary_problem)) between 1 and 2000),
 buying_triggers text not null check(length(btrim(buying_triggers)) between 1 and 2000),
 prospecting_signals text not null check(length(btrim(prospecting_signals)) between 1 and 2000),
 created_at timestamptz not null default now(),
 foreign key(audience_profile_id,owner_id) references public.scouting_profiles(id,owner_id) on delete cascade
);
alter table public.ideal_profiles enable row level security;
create policy ideal_profiles_read on public.ideal_profiles for select to authenticated using(owner_id=(select auth.uid()));
create policy ideal_profiles_insert on public.ideal_profiles for insert to authenticated with check(owner_id=(select auth.uid()));
create policy ideal_profiles_update on public.ideal_profiles for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy ideal_profiles_delete on public.ideal_profiles for delete to authenticated using(owner_id=(select auth.uid()));
revoke all on public.ideal_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.ideal_profiles to authenticated;
grant all on public.ideal_profiles to service_role;
create index ideal_profiles_owner_created_idx on public.ideal_profiles(owner_id,created_at desc);
create index ideal_profiles_audience_owner_idx on public.ideal_profiles(audience_profile_id,owner_id);

create function aisas_private.valid_ideal_report(r jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(r->'qualified'='true'::jsonb and jsonb_typeof(r->'criteria')='object' and jsonb_typeof(r->'checks')='array'
 and jsonb_array_length(r->'checks')=7 and (r->>'score')::integer between 70 and 100
 and not exists(select 1 from jsonb_array_elements(r->'checks') c where c->>'area' not in ('business','decision_maker','starting_segment','main_problem','secondary_problem','buying_triggers','prospecting_signals') or c->>'status' not in ('match','mismatch','unknown'))
 and not exists(select 1 from jsonb_array_elements(r->'checks') c cross join lateral jsonb_array_elements(c->'evidence') e where c->>'status'='match' and (length(coalesce(e->>'quote','')) not between 8 and 400 or coalesce(e->>'url','') !~ '^https?://'))
 and (select count(distinct c->>'area') from jsonb_array_elements(r->'checks') c)=7
 and not exists(select 1 from unnest(array['business','decision_maker','starting_segment']) required where not exists(select 1 from jsonb_array_elements(r->'checks') c where c->>'area'=required and c->>'status'='match' and jsonb_array_length(c->'evidence')>0))
 and exists(select 1 from jsonb_array_elements(r->'checks') c where c->>'area' in ('main_problem','secondary_problem','buying_triggers','prospecting_signals') and c->>'status'='match' and jsonb_array_length(c->'evidence')>0)
 and (r->>'score')::integer=(select coalesce(sum(case c->>'area' when 'business' then 25 when 'decision_maker' then 15 when 'starting_segment' then 20 when 'main_problem' then 10 when 'secondary_problem' then 5 when 'buying_triggers' then 10 when 'prospecting_signals' then 15 else 0 end),0) from jsonb_array_elements(r->'checks') c where c->>'status'='match'),false);
$$;
revoke all on function aisas_private.valid_ideal_report(jsonb) from public,anon,authenticated;
grant execute on function aisas_private.valid_ideal_report(jsonb) to service_role;
create table public.ideal_qualifications(
 lead_id uuid primary key,owner_id uuid not null references auth.users on delete cascade,
 run_id uuid not null references public.scout_runs(id) on delete cascade,
 ideal_profile_id uuid references public.ideal_profiles(id) on delete set null,
 report jsonb not null check(octet_length(report::text)<18000 and aisas_private.valid_ideal_report(report)),
 created_at timestamptz not null default now(),
 foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade
);
alter table public.ideal_qualifications enable row level security;
create policy ideal_qualification_read on public.ideal_qualifications for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.ideal_qualifications from public,anon,authenticated;
grant select on public.ideal_qualifications to authenticated;
grant all on public.ideal_qualifications to service_role;
create index ideal_qualification_owner_created_idx on public.ideal_qualifications(owner_id,created_at desc);
create index ideal_qualification_run_idx on public.ideal_qualifications(run_id);
create index ideal_qualification_profile_idx on public.ideal_qualifications(ideal_profile_id);

create function public.aisas_checkpoint_ideal_run(p_id uuid,p_owner uuid,p_lease uuid,p_state jsonb,p_rows jsonb,p_reports jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;r public.scout_runs;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 select * into r from public.scout_runs where id=p_id and owner_id=p_owner for update;
 if not found or r.lease_token is distinct from p_lease or r.state->>'goal'<>'ideal' or p_state->>'goal'<>'ideal' or r.state->'criteria' is distinct from p_state->'criteria' or r.state->>'ideal_profile_id' is distinct from p_state->>'ideal_profile_id' then raise exception 'Invalid ideal-prospect checkpoint';end if;
 if jsonb_typeof(p_reports)<>'array' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<>jsonb_array_length(p_reports)
 or exists(select 1 from jsonb_array_elements(p_rows) x where not exists(select 1 from jsonb_array_elements(p_reports) q where q->>'lead_id'=x->>'id' and q->'report'->'criteria'=p_state->'criteria' and aisas_private.valid_ideal_report(q->'report')) or not (coalesce(x->>'email','') ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(x->>'phone',''),'[^0-9]','','g')) between 7 and 18)) then raise exception 'Only contact-bearing, evidence-qualified prospects may be saved';end if;
 result:=public.aisas_checkpoint_scout_run(p_id,p_owner,p_lease,p_state,p_rows);
 insert into public.ideal_qualifications(lead_id,owner_id,run_id,ideal_profile_id,report)
 select (q->>'lead_id')::uuid,p_owner,p_id,(p_state->>'ideal_profile_id')::uuid,q->'report' from jsonb_array_elements(p_reports) q
 where exists(select 1 from public.leads l where l.id=(q->>'lead_id')::uuid and l.owner_id=p_owner and l.list_id=(result->>'list_id')::uuid)
 on conflict(lead_id) do nothing;
 return result;
end $$;
revoke all on function public.aisas_checkpoint_ideal_run(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.aisas_checkpoint_ideal_run(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;

alter table public.campaign_recipients add column ideal_context jsonb not null default '{}'::jsonb;
create function aisas_private.snapshot_recipient_ideal_context() returns trigger language plpgsql security invoker set search_path='' as $$begin
 select coalesce(q.report,'{}'::jsonb) into new.ideal_context from public.ideal_qualifications q where q.lead_id=new.lead_id and q.owner_id=new.owner_id;
 new.ideal_context:=coalesce(new.ideal_context,'{}'::jsonb);return new;
end $$;
revoke all on function aisas_private.snapshot_recipient_ideal_context() from public,anon,authenticated;
create trigger recipient_ideal_snapshot before insert on public.campaign_recipients for each row execute function aisas_private.snapshot_recipient_ideal_context();
-- Keep the existing send guards and grant boundary; add only the approved recipient context to the payload.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.aisas_begin_campaign_send(uuid,uuid)'::regprocedure);
 if position('''lead'',to_jsonb(l)' in definition)=0 then raise exception 'Unexpected delivery function definition';end if;
 execute replace(definition,'''lead'',to_jsonb(l)','''ideal_context'',r.ideal_context,''lead'',to_jsonb(l)');
end $$;
