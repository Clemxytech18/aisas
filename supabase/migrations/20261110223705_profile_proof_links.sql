-- Optional user-owned proof links; existing owner-based profile RLS continues to apply.
alter table public.scouting_profiles
 add column demo_video_url text not null default '',
 add column work_sample_url text not null default '',
 add constraint profile_demo_video_url_valid check(demo_video_url='' or (length(demo_video_url)<=2048 and demo_video_url ~* '^https?://[^[:space:]]+$')),
 add constraint profile_work_sample_url_valid check(work_sample_url='' or (length(work_sample_url)<=2048 and work_sample_url ~* '^https?://[^[:space:]]+$'));
comment on column public.scouting_profiles.demo_video_url is 'Optional public demo URL supplied by the owner for outreach first-message context.';
comment on column public.scouting_profiles.work_sample_url is 'Optional public work sample URL supplied by the owner for outreach first-message context.';
