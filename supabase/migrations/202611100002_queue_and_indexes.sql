create index oauth_states_owner_id_idx on aisas_private.oauth_states(owner_id);
alter table public.campaign_recipients add column message_id text;
