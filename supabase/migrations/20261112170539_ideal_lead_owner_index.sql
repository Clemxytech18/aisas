set local lock_timeout='5s';
create index ideal_qualification_lead_owner_idx on public.ideal_qualifications(lead_id,owner_id);
