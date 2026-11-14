set local lock_timeout='5s';
alter table aisas_private.daily_usage drop constraint daily_usage_kind_check;
alter table aisas_private.daily_usage add constraint daily_usage_kind_check check(kind in ('scout','generate-sequence','connect-mailbox','verify-email','upwork-connect','upwork-search','upwork-scout','upwork-draft','upwork-send'));
