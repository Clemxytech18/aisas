set local lock_timeout='5s';
alter table public.ideal_profiles add constraint ideal_profiles_id_owner_key unique(id,owner_id);
alter table public.scout_runs add constraint scout_runs_id_owner_key unique(id,owner_id);
alter table public.ideal_qualifications drop constraint ideal_qualifications_run_id_fkey,
 drop constraint ideal_qualifications_ideal_profile_id_fkey,
 add constraint ideal_qualification_run_owner_fkey foreign key(run_id,owner_id) references public.scout_runs(id,owner_id) on delete cascade,
 add constraint ideal_qualification_profile_owner_fkey foreign key(ideal_profile_id,owner_id) references public.ideal_profiles(id,owner_id) on delete set null(ideal_profile_id);
drop index public.ideal_qualification_run_idx;
drop index public.ideal_qualification_profile_idx;
create index ideal_qualification_run_owner_idx on public.ideal_qualifications(run_id,owner_id);
create index ideal_qualification_profile_owner_idx on public.ideal_qualifications(ideal_profile_id,owner_id);
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.aisas_checkpoint_ideal_run(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 if position('r.state->>''goal''<>''ideal''' in definition)=0 then raise exception 'Unexpected ideal checkpoint definition';end if;
 definition:=replace(definition,'r.state->>''goal''<>''ideal''','r.state->>''goal'' is distinct from ''ideal''');
 definition:=replace(definition,'p_state->>''goal''<>''ideal''','p_state->>''goal'' is distinct from ''ideal''');
 execute definition;
end $$;
