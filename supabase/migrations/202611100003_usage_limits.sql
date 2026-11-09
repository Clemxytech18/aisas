create table aisas_private.daily_usage(
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('scout','generate-sequence','connect-mailbox')),
 day date not null default current_date,used integer not null default 1,
 primary key(owner_id,kind,day)
);
alter table aisas_private.daily_usage enable row level security;
grant all on aisas_private.daily_usage to service_role;
create function public.aisas_reserve_usage(p_owner uuid,p_kind text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; cap integer; begin
 cap:=case p_kind when 'scout' then 20 when 'generate-sequence' then 100 when 'connect-mailbox' then 20 else 0 end;
 if cap=0 then return false; end if;
 insert into aisas_private.daily_usage(owner_id,kind) values(p_owner,p_kind)
 on conflict(owner_id,kind,day) do update set used=aisas_private.daily_usage.used+1 where aisas_private.daily_usage.used<cap returning used into n;
 return n is not null;
end $$;
revoke all on function public.aisas_reserve_usage(uuid,text) from public,anon,authenticated;
grant execute on function public.aisas_reserve_usage(uuid,text) to service_role;
