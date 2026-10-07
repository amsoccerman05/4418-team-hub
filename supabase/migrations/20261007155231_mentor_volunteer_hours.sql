-- LOCAL REVIEW DRAFT. Additive and independent of student attendance.
-- Requires profiles, planning_seasons and team_meetings. No backfill or production application.
begin;
create schema volunteer_private;
revoke all on schema volunteer_private from public, anon, authenticated;
create table public.team_volunteer_entries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 season_id uuid references public.planning_seasons(id), meeting_id uuid references public.team_meetings(id),
 activity text not null check(activity in ('mentoring','setup_cleanup','planning','outreach','travel','other')),
 started_at timestamptz not null, ended_at timestamptz,
 time_zone text not null, activity_date date not null,
 notes text not null default '' check(length(notes)<=2000), source text not null check(source in ('timer','manual')),
 voided_at timestamptz, version integer not null default 1,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(started_at >= '2000-01-01T00:00:00Z'::timestamptz),
 check(ended_at is null or (ended_at>started_at and ended_at<=started_at+interval '24 hours')),
 check(source='timer' or ended_at is not null)
);
create unique index volunteer_one_open on public.team_volunteer_entries(user_id) where ended_at is null and voided_at is null;
create index volunteer_user_start on public.team_volunteer_entries(user_id,started_at,id);
create index volunteer_season_date on public.team_volunteer_entries(season_id,activity_date) where voided_at is null;
create index volunteer_meeting on public.team_volunteer_entries(meeting_id) where meeting_id is not null;
create table volunteer_private.history (
 id bigint generated always as identity primary key, entry_id uuid not null references public.team_volunteer_entries(id),
 user_id uuid not null references public.profiles(id), action text not null,
 reason text not null default '', performed_at timestamptz not null default clock_timestamp(),
 before_data jsonb, after_data jsonb not null
);
create index volunteer_history_entry on volunteer_private.history(entry_id,id);
create table volunteer_private.receipts (
 user_id uuid not null references public.profiles(id), request_id uuid not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,request_id)
);
-- Explicit, narrowly scoped aggregate-report permission. No account identifiers
-- are seeded in this migration; an approved production grant is separate.
create table volunteer_private.report_readers (
 user_id uuid primary key references public.profiles(id),
 granted_by uuid not null references public.profiles(id),
 granted_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 reason text not null check(length(trim(reason)) between 1 and 1000)
);
create index volunteer_report_grant_actor on volunteer_private.report_readers(granted_by);
alter table volunteer_private.report_readers enable row level security;
revoke all on volunteer_private.report_readers from public,anon,authenticated;
alter table public.team_volunteer_entries enable row level security;
alter table volunteer_private.history enable row level security;
alter table volunteer_private.receipts enable row level security;
revoke all on public.team_volunteer_entries, volunteer_private.history, volunteer_private.receipts from public,anon,authenticated;
create function volunteer_private.eligible() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active and role in ('mentor','admin'))
$$;
create function volunteer_private.can_report() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.active
   and (p.role='admin' or (p.role='mentor' and exists(
    select 1 from volunteer_private.report_readers r where r.user_id=p.id and r.revoked_at is null)))
 )
$$;
create policy volunteer_self_read on public.team_volunteer_entries for select to authenticated
 using(user_id=(select auth.uid()) and (select volunteer_private.eligible()));
grant select on public.team_volunteer_entries to authenticated;

create function volunteer_private.context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text;
begin
 select role into r from public.profiles where id=auth.uid() and active and role in ('mentor','admin');
 if auth.uid() is null or r is null then raise exception 'Active mentor or admin access required'; end if;
 return jsonb_build_object('user_id',auth.uid(),'can_view_team',volunteer_private.can_report(),'server_now',statement_timestamp(),
  'seasons',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'status',status) order by start_date desc nulls last,created_at desc),'[]'::jsonb) from public.planning_seasons));
end $$;
create function volunteer_private.save(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); rid uuid; ident uuid; old public.team_volunteer_entries%rowtype; next_row public.team_volunteer_entries%rowtype;
 stamp timestamptz; prior volunteer_private.receipts%rowtype; payload jsonb; reason text; role_name text;
begin
 if uid is null then raise exception 'Active mentor or admin access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('volunteer:'||uid::text,0));
 select role into role_name from public.profiles where id=uid and active and role in ('mentor','admin') for share;
 if role_name is null then raise exception 'Active mentor or admin access required'; end if;
 stamp:=clock_timestamp();
 if action is null or action not in ('start','stop','manual','correct','void') then raise exception 'Unknown volunteer action'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Entry details required'; end if;
 rid:=nullif(p->>'request_id','')::uuid;
 if rid is null then raise exception 'Request ID required for safe retry'; end if;
 payload:=jsonb_build_object('action',action,'p',p);
 select * into prior from volunteer_private.receipts where user_id=uid and request_id=rid;
 if found then
  if prior.payload<>payload then raise exception 'Request ID was already used for different details'; end if;
  return prior.result;
 end if;
 if action in ('stop','correct','void') then
  ident:=nullif(p->>'id','')::uuid;
  select * into old from public.team_volunteer_entries where id=ident and user_id=uid for update;
  if not found then raise exception 'Volunteer entry unavailable'; end if;
  if old.voided_at is not null then raise exception 'Voided entries cannot be changed'; end if;
  if nullif(p->>'version','')::integer is distinct from old.version then raise exception 'Entry changed. Refresh and review the latest version before correcting it'; end if;
  next_row:=old;
  next_row.version:=old.version+1;
 else
  next_row.id:=gen_random_uuid(); next_row.user_id:=uid; next_row.version:=1;
  next_row.created_at:=stamp; next_row.source:=case when action='start' then 'timer' else 'manual' end;
 end if;
 next_row.updated_at:=stamp;
 reason:=trim(coalesce(p->>'reason',''));
 if action in ('correct','void') and length(reason) not between 1 and 1000 then raise exception 'Add a correction reason (1–1000 characters)'; end if;
 if action='void' then next_row.voided_at:=stamp;
 elsif action='stop' then
  if old.ended_at is not null then raise exception 'This timer is already stopped. Refresh to see it'; end if;
  if stamp>old.started_at+interval '24 hours' then raise exception 'Missing checkout. Correct the entry with the actual end time'; end if;
  next_row.ended_at:=stamp;
 else
  next_row.activity:=p->>'activity'; next_row.notes:=trim(coalesce(p->>'notes',''));
  next_row.season_id:=nullif(p->>'season_id','')::uuid; next_row.meeting_id:=nullif(p->>'meeting_id','')::uuid;
  next_row.time_zone:=p->>'time_zone';
  if next_row.time_zone is null or not exists(select 1 from pg_timezone_names where name=next_row.time_zone) then raise exception 'Choose a valid IANA time zone'; end if;
  if action='start' then
   if exists(select 1 from public.team_volunteer_entries where user_id=uid and ended_at is null and voided_at is null) then raise exception 'You already have a running timer. Refresh to see it'; end if;
   next_row.started_at:=stamp; next_row.ended_at:=null;
  else
   if coalesce(p->>'started_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p->>'ended_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Start and end must include an explicit UTC offset'; end if;
   next_row.started_at:=(p->>'started_at')::timestamptz; next_row.ended_at:=(p->>'ended_at')::timestamptz;
  end if;
  next_row.activity_date:=(next_row.started_at at time zone next_row.time_zone)::date;
 end if;
 if action<>'void' then
  if next_row.activity is null or next_row.activity not in ('mentoring','setup_cleanup','planning','outreach','travel','other') then raise exception 'Choose a volunteer activity'; end if;
  if next_row.started_at<'2000-01-01T00:00:00Z'::timestamptz or next_row.started_at>stamp or next_row.ended_at>stamp then raise exception 'Record actual time between January 2000 and now'; end if;
  if action in ('manual','correct','stop') and (next_row.ended_at is null or next_row.ended_at<=next_row.started_at or next_row.ended_at>next_row.started_at+interval '24 hours') then raise exception 'End must follow start, with no more than 24 hours per entry'; end if;
  if length(next_row.notes)>2000 then raise exception 'Notes must be at most 2000 characters'; end if;
  if next_row.season_id is not null and not exists(select 1 from public.planning_seasons where id=next_row.season_id) then raise exception 'Season unavailable'; end if;
  if next_row.meeting_id is not null and not exists(select 1 from public.team_meetings where id=next_row.meeting_id) then raise exception 'Meeting unavailable'; end if;
  if exists(select 1 from public.team_volunteer_entries e where e.user_id=uid and e.id<>next_row.id and e.voided_at is null
   and tstzrange(e.started_at,e.ended_at,'[)') && tstzrange(next_row.started_at,next_row.ended_at,'[)')) then raise exception 'This time overlaps another volunteer entry. Correct or void that entry first'; end if;
 end if;
 if action in ('start','manual') then insert into public.team_volunteer_entries select next_row.*;
 else update public.team_volunteer_entries set season_id=next_row.season_id,meeting_id=next_row.meeting_id,activity=next_row.activity,
  started_at=next_row.started_at,ended_at=next_row.ended_at,time_zone=next_row.time_zone,activity_date=next_row.activity_date,
  notes=next_row.notes,voided_at=next_row.voided_at,version=next_row.version,updated_at=next_row.updated_at where id=next_row.id;
 end if;
 insert into volunteer_private.history(entry_id,user_id,action,reason,before_data,after_data)
 values(next_row.id,uid,action,reason,case when old.id is not null then to_jsonb(old) else null end,to_jsonb(next_row));
 insert into volunteer_private.receipts(user_id,request_id,payload,result) values(uid,rid,payload,to_jsonb(next_row));
 return to_jsonb(next_row);
end $$;
create function volunteer_private.history(entry uuid, before_id bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not volunteer_private.eligible() then raise exception 'Active mentor or admin access required'; end if;
 if not exists(select 1 from public.team_volunteer_entries where id=entry and user_id=auth.uid()) then raise exception 'Volunteer entry unavailable'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by id desc),'[]'::jsonb) from
  (select * from volunteer_private.history where entry_id=entry and (before_id is null or id<before_id) order by id desc limit 100) h);
end $$;
create function volunteer_private.summary(selected_season uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not volunteer_private.can_report() then raise exception 'Active admin or approved mentor report access required for team totals'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(t) order by display_name,user_id,week_start,activity),'[]'::jsonb) from (
  select e.user_id,p.display_name,e.season_id,e.activity,
   (e.activity_date-((extract(isodow from e.activity_date)::integer)-1)) as week_start,
   coalesce(sum(extract(epoch from(e.ended_at-e.started_at))) filter(where e.ended_at is not null)/3600,0) as hours,
   count(*) filter(where e.ended_at is not null) as completed_entries,
   count(*) filter(where e.ended_at is null) as running_entries,
   count(*) filter(where e.ended_at is null and statement_timestamp()>e.started_at+interval '24 hours') as missing_checkouts
  from public.team_volunteer_entries e join public.profiles p on p.id=e.user_id
  where e.voided_at is null and (selected_season is null or e.season_id=selected_season)
  group by e.user_id,p.display_name,e.season_id,e.activity,week_start
 )t);
end $$;
-- Public wrappers are SECURITY INVOKER; privilege lives in narrowly scoped private functions.
create function public.team_volunteer_context() returns jsonb language sql security invoker set search_path='' as $$select volunteer_private.context()$$;
create function public.team_volunteer_save(action text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$select volunteer_private.save(action,p)$$;
create function public.team_volunteer_history(entry uuid,before_id bigint default null) returns jsonb language sql security invoker set search_path='' as $$select volunteer_private.history(entry,before_id)$$;
create function public.team_volunteer_summary(selected_season uuid default null) returns jsonb language sql security invoker set search_path='' as $$select volunteer_private.summary(selected_season)$$;
revoke all on all functions in schema volunteer_private from public,anon,authenticated;
grant usage on schema volunteer_private to authenticated;
grant execute on all functions in schema volunteer_private to authenticated;
revoke all on function public.team_volunteer_context(),public.team_volunteer_save(text,jsonb),public.team_volunteer_history(uuid,bigint),public.team_volunteer_summary(uuid) from public,anon,authenticated;
grant execute on function public.team_volunteer_context(),public.team_volunteer_save(text,jsonb),public.team_volunteer_history(uuid,bigint),public.team_volunteer_summary(uuid) to authenticated;
commit;
