-- STEM outreach attendance and annual lettering-hours reporting.
-- Confirmed policy: 10 hours per May 1–April 30 Denver-local year; preserve history.
begin;
alter table public.team_meetings drop constraint team_meetings_meeting_type_check;
alter table public.team_meetings add constraint team_meetings_meeting_type_check
 check(meeting_type in ('offseason','preseason','other','stem_outreach'));

create function team_attendance_private.outreach_meeting_policy() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.meeting_type is distinct from new.meeting_type
  and (old.meeting_type='stem_outreach' or new.meeting_type='stem_outreach') then
  raise exception 'Create a separate STEM outreach event instead of converting attendance history';
 end if;
 if new.meeting_type='stem_outreach' then
  new.requirement:='optional';new.auto_absence_strikes_enabled:=false;
 end if;
 return new;
end $$;
create trigger outreach_meeting_policy before insert or update on public.team_meetings
 for each row execute function team_attendance_private.outreach_meeting_policy();
create function team_attendance_private.outreach_optional_roster() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.team_meetings where id=new.meeting_id and meeting_type='stem_outreach') then new.required:=false;end if;
 return new;
end $$;
create trigger outreach_optional_roster before insert or update on public.team_meeting_members
 for each row execute function team_attendance_private.outreach_optional_roster();
create function team_attendance_private.no_outreach_strikes() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.team_meetings where id=new.meeting_id and meeting_type='stem_outreach') then
  raise exception 'STEM outreach participation never receives attendance strikes';
 end if;
 return new;
end $$;
create trigger no_outreach_strikes before insert or update on public.team_attendance_strikes
 for each row execute function team_attendance_private.no_outreach_strikes();
revoke all on function team_attendance_private.outreach_meeting_policy(),team_attendance_private.outreach_optional_roster(),team_attendance_private.no_outreach_strikes() from public,anon,authenticated;

-- Calendar visibility shares event details, never another student's attendance.
alter policy attendance_meeting_read on public.team_meetings using(
 team_attendance_private.reader() or (team_attendance_private.participant() and
 (meeting_type='stem_outreach' or exists(select 1 from public.team_meeting_members mm where mm.meeting_id=team_meetings.id and mm.student_id=auth.uid()))));

-- Confirmed requirement: 10 hours in each May 1–April 30 Denver-local year.
-- Totals are read-time views of preserved records, never a destructive reset.
create table team_attendance_private.outreach_goal (
 id boolean primary key default true check(id),
 target_hours numeric not null default 10 check(target_hours>0 and target_hours<=10000),
 version integer not null default 1
);
alter table team_attendance_private.outreach_goal enable row level security;
revoke all on team_attendance_private.outreach_goal from public,anon,authenticated;
insert into team_attendance_private.outreach_goal(id,target_hours) values(true,10);
create function public.team_attendance_outreach_summary(period_start_year integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare goal team_attendance_private.outreach_goal;viewer uuid:=auth.uid();all_members boolean;
 today date:=(clock_timestamp() at time zone 'America/Denver')::date;current_year integer;chosen_year integer;
 from_at timestamptz;until_at timestamptz;totals jsonb;years jsonb;oldest_year integer;
begin
 if viewer is null or not (team_attendance_private.participant() or team_attendance_private.reader()) then
  raise exception 'Active Attendance access required' using errcode='42501';end if;
 all_members:=team_attendance_private.reader();
 select * into goal from team_attendance_private.outreach_goal where id;
 current_year:=extract(year from today)::integer;
 if today<make_date(current_year,5,1) then current_year:=current_year-1;end if;
 chosen_year:=coalesce(period_start_year,current_year);
 if chosen_year<1 or chosen_year>current_year then raise exception 'Choose the current outreach year or a prior year';end if;
 from_at:=make_date(chosen_year,5,1)::timestamp at time zone 'America/Denver';
 until_at:=make_date(chosen_year+1,5,1)::timestamp at time zone 'America/Denver';
 with eligible as (
  select a.student_id,a.checked_in_at,a.left_at,m.starts_at
  from public.team_attendance a join public.team_meetings m on m.id=a.meeting_id
  where m.meeting_type='stem_outreach' and (all_members or a.student_id=viewer)
 ), intervals as (
  select student_id,range_agg(tstzrange(greatest(checked_in_at,from_at),least(left_at,until_at),'[)')) as periods
  from eligible where checked_in_at is not null and left_at is not null
   and isfinite(checked_in_at) and isfinite(left_at) and left_at>checked_in_at
   and left_at>from_at and checked_in_at<until_at group by student_id
 ), hours as (
  select student_id,round((sum(extract(epoch from(upper(r)-lower(r))))/3600)::numeric,2) as hours
  from intervals cross join lateral unnest(periods) r group by student_id
 ), missing as (
  select student_id,count(*) as missing_checkouts from eligible
  where checked_in_at is not null and left_at is null and checked_in_at>=from_at and checked_in_at<until_at group by student_id
 ) select coalesce(jsonb_agg(jsonb_build_object('student_id',p.id,'display_name',p.display_name,
  'hours',coalesce(h.hours,0),'missing_checkouts',coalesce(m.missing_checkouts,0)) order by p.display_name),'[]') into totals
 from public.profiles p left join hours h on h.student_id=p.id left join missing m on m.student_id=p.id
 where (all_members or p.id=viewer) and (team_attendance_private.is_participant(p.id)
  or (all_members and exists(select 1 from eligible e where e.student_id=p.id and e.checked_in_at is not null)));
 select least(current_year,min(extract(year from d)::integer-case when extract(month from d)<5 then 1 else 0 end)) into oldest_year
 from (select (a.checked_in_at at time zone 'America/Denver')::date d from public.team_attendance a
  join public.team_meetings m on m.id=a.meeting_id where m.meeting_type='stem_outreach'
   and a.checked_in_at is not null and isfinite(a.checked_in_at) and (all_members or a.student_id=viewer)) dates;
 select jsonb_agg(y order by y desc) into years from generate_series(least(chosen_year,coalesce(oldest_year,current_year)),current_year) y;
 return jsonb_build_object('goal',to_jsonb(goal)-'id','members',totals,
  'can_configure',team_attendance_private.role() in ('mentor','admin'),'available_years',years,
  'period',jsonb_build_object('start_year',chosen_year,'current_start_year',current_year,
   'start_date',make_date(chosen_year,5,1),'end_date',make_date(chosen_year+1,5,1)-1,'time_zone','America/Denver'));
end $$;
revoke all on function public.team_attendance_outreach_summary(integer) from public,anon;
grant execute on function public.team_attendance_outreach_summary(integer) to authenticated;
create function public.team_attendance_outreach_goal(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old team_attendance_private.outreach_goal;next team_attendance_private.outreach_goal;
begin
 if auth.uid() is null or not coalesce(team_attendance_private.role() in ('mentor','admin'),false) then raise exception 'Mentor or admin required' using errcode='42501';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('version','target_hours')) then raise exception 'Only the hours target can be changed; outreach years remain May 1 through April 30';end if;
 select * into old from team_attendance_private.outreach_goal where id for update;
 if not coalesce(team_attendance_private.role() in ('mentor','admin'),false) then raise exception 'Mentor or admin required' using errcode='42501';end if;
 if (p->>'version')::integer is distinct from old.version then raise exception 'Outreach goal changed. Refresh and try again.';end if;
 update team_attendance_private.outreach_goal set target_hours=(p->>'target_hours')::numeric,version=version+1
 where id returning * into next;
 insert into public.team_attendance_history(entity,entity_id,action,before_data,after_data,performed_by)
 values('stem_outreach_goal','team','UPDATE',to_jsonb(old),to_jsonb(next),auth.uid());
 return to_jsonb(next)-'id';
end $$;
revoke all on function public.team_attendance_outreach_goal(jsonb) from public,anon;
grant execute on function public.team_attendance_outreach_goal(jsonb) to authenticated;

create or replace function team_attendance_private.edit_meeting(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 m public.team_meetings; next_title text; next_type text;
 next_start timestamptz; next_end timestamptz; schedule_changed boolean;
 roster_supplied boolean; roster_changed boolean:=false;
 next_required uuid[]; expected_required uuid[]; current_required uuid[];
 changed_ids uuid[]; target_id uuid; target_required boolean;
 mm public.team_meeting_members; a public.team_attendance;
 candidate record; before_snapshot jsonb; array_key text; expected_version integer;
begin
 if auth.uid() is null then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Match existing Attendance management's lock order, then recheck authority.
 perform pg_advisory_xact_lock(4418,10);
 perform 1 from public.profiles where id=auth.uid() and active
   and role::text in ('lead','mentor','admin') for share;
 if not found then raise exception 'Leadership access required' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Meeting details are required'; end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in
   ('meeting_id','version','title','meeting_type','starts_at','ends_at','acknowledge_schedule_change',
    'required_student_ids','expected_required_student_ids','acknowledge_roster_change')) then
   raise exception 'Only title, type, schedule, and required participants can be edited';
 end if;
 if not (p ?& array['meeting_id','version','title','meeting_type','starts_at','ends_at']) or
   nullif(p->>'version','') is null then raise exception 'Meeting details and version are required'; end if;
 expected_version:=(p->>'version')::integer;
 if expected_version<1 then raise exception 'A valid meeting version is required'; end if;
 select * into m from public.team_meetings where id=(p->>'meeting_id')::uuid for update;
 if not found then raise exception 'Meeting not found'; end if;
 next_title:=trim(coalesce(p->>'title',''));
 next_type:=p->>'meeting_type';
 if length(next_title) not between 1 and 150 then raise exception 'Enter a title of 1–150 characters'; end if;
 if next_type is null or next_type not in ('offseason','preseason','other','stem_outreach') then raise exception 'Choose a meeting type'; end if;
 next_start:=(p->>'starts_at')::timestamptz;
 next_end:=(p->>'ends_at')::timestamptz;
 if next_start is null or next_end is null or not isfinite(next_start) or not isfinite(next_end) or next_end<=next_start then
   raise exception 'End time must be after a valid start time';
 end if;
 schedule_changed:=next_start is distinct from m.starts_at or next_end is distinct from m.ends_at;
 if m.meeting_type='stem_outreach' and jsonb_array_length(coalesce(p->'required_student_ids','[]'))>0 then raise exception 'STEM outreach is optional and has no required participants';end if;
 roster_supplied:=p ? 'required_student_ids';
 if not roster_supplied and (p ? 'expected_required_student_ids' or p ? 'acknowledge_roster_change') then
   raise exception 'Required participants and the original required roster must be supplied together';
 end if;
 if roster_supplied then
   foreach array_key in array array['required_student_ids','expected_required_student_ids'] loop
     if jsonb_typeof(p->array_key) is distinct from 'array' then raise exception 'Required participant lists must be arrays'; end if;
     if jsonb_array_length(p->array_key)>5000 or exists(select 1 from jsonb_array_elements(p->array_key) v where jsonb_typeof(v)<>'string') then
       raise exception 'Required participant lists must contain valid distinct participant IDs';
     end if;
     if (select count(distinct v::uuid) from jsonb_array_elements_text(p->array_key) v)<>jsonb_array_length(p->array_key) then
       raise exception 'Required participant lists must contain distinct participant IDs';
     end if;
   end loop;
   next_required:=array(select v::uuid from jsonb_array_elements_text(p->'required_student_ids') v order by v::uuid);
   expected_required:=array(select v::uuid from jsonb_array_elements_text(p->'expected_required_student_ids') v order by v::uuid);
   current_required:=array(select student_id from public.team_meeting_members where meeting_id=m.id and required order by student_id);
   roster_changed:=next_required is distinct from current_required;
 end if;
 -- An exact retry after a lost response is a read-only acknowledgement, even
 -- with the original version. A different stale draft can never overwrite.
 if next_title=m.title and next_type=m.meeting_type and not schedule_changed and not roster_changed then
   return jsonb_build_object('id',m.id,'version',m.version,'changed',false);
 end if;
 if m.version is distinct from expected_version then
   raise exception 'Meeting changed. Refresh and reload the latest meeting before saving.' using errcode='40001';
 end if;
 if roster_supplied and expected_required is distinct from current_required then
   raise exception 'Required roster changed. Refresh and reload the latest meeting before saving.' using errcode='40001';
 end if;
 if m.status='finalized' or clock_timestamp()>=m.starts_at then
   raise exception 'This meeting has started or attendance is complete. Meeting details can only be edited before it starts';
 end if;
 if schedule_changed then
   if next_start<=clock_timestamp() then raise exception 'A rescheduled meeting must start in the future'; end if;
   if exists(select 1 from public.team_attendance where meeting_id=m.id and
     (checked_in_at is not null or left_at is not null or physical_status<>'pending' or
      reviewed_at is not null or review_status in ('excused','denied')))
     or exists(select 1 from public.team_attendance_strikes where meeting_id=m.id) then
     raise exception 'Recorded attendance or reviewed decisions lock this schedule; title and type can still be edited';
   end if;
   if p->'acknowledge_schedule_change' is distinct from 'true'::jsonb then
     raise exception 'Review and acknowledge the schedule change. Existing request times stay unchanged and attendees are not notified';
   end if;
 end if;
 if roster_changed then
   if p->'acknowledge_roster_change' is distinct from 'true'::jsonb then
     raise exception 'Review and acknowledge the required roster change. Only this meeting changes and attendees are not notified';
   end if;
   changed_ids:=array(select v from (
     (select unnest(next_required) v except select unnest(current_required))
     union (select unnest(current_required) v except select unnest(next_required))
   ) changes order by v);
   -- Lock live participant eligibility as well as the meeting. These locks keep
   -- account/enrollment changes from racing the per-person preflight.
   perform 1 from public.profiles where id=any(changed_ids) order by id for share;
   perform 1 from public.team_attendance_members where student_id=any(changed_ids) order by student_id for share;
   perform 1 from public.team_positions where key in ('program_manager','operations_lead') order by key for share;
   perform 1 from public.team_member_positions where user_id=any(changed_ids) order by user_id,position_key for share;
   -- Validate every toggle before writing. Existing ineligible snapshot rows
   -- can stay selected but cannot be silently removed by an incomplete picker.
   foreach target_id in array changed_ids loop
     if not team_attendance_private.is_participant(target_id) or exists(
       select 1 from public.team_attendance_members where student_id=target_id and member_status='inactive'
     ) then raise exception 'A changed participant is unavailable. Refresh the roster; existing unavailable participants must stay unchanged'; end if;
     select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=target_id for update;
     if found then
       select * into a from public.team_attendance where meeting_id=m.id and student_id=target_id for update;
       if not found then raise exception 'Attendance record is missing. Refresh before editing the required roster'; end if;
       if a.notice_at is not null or a.review_status='pending' or a.notice_type is not null
         or a.expected_at is not null or nullif(trim(a.notice_reason),'') is not null then
         raise exception 'An existing attendance request locks this participant’s requirement. Use the normal request review workflow';
       end if;
       if a.checked_in_at is not null or a.left_at is not null or a.physical_status<>'pending'
         or a.reviewed_at is not null or a.reviewed_by is not null or nullif(trim(a.review_reason),'') is not null or a.review_status in ('excused','denied')
         or exists(select 1 from public.team_attendance_strikes where meeting_id=m.id and student_id=target_id) then
         raise exception 'Recorded attendance, reviewed decisions, or strikes lock this participant’s requirement';
       end if;
     end if;
   end loop;
   -- Do not cross the start boundary after waiting for any eligibility/row lock.
   if clock_timestamp()>=m.starts_at or (schedule_changed and next_start<=clock_timestamp()) then
     raise exception 'This meeting has started. Required participants can only be edited before it starts';
   end if;
   foreach target_id in array changed_ids loop
     target_required:=target_id=any(next_required);
     select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=target_id;
     if not found then
       select coalesce(mem.member_status,'prospective') member_status,coalesce(mem.team_area,'') team_area
       into candidate from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id where pr.id=target_id;
       insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
       values(m.id,target_id,true,candidate.member_status,candidate.team_area) returning * into mm;
       insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,target_id,'none');
       insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
       values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_EDIT_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
     else
       before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
       update public.team_meeting_members set required=target_required
       where meeting_id=m.id and student_id=target_id returning * into mm;
       -- Physical/request/review evidence is never rewritten. Only pristine
       -- default none/not_required flags follow the changed requirement.
       update public.team_attendance set review_status=case when target_required then 'none' else 'not_required' end,version=version+1
       where meeting_id=m.id and student_id=target_id and notice_at is null and review_status in ('none','not_required')
         and review_status is distinct from case when target_required then 'none' else 'not_required' end;
       insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
       values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_EDIT_REQUIREMENT',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
     end if;
   end loop;
 end if;
 if clock_timestamp()>=m.starts_at or (schedule_changed and next_start<=clock_timestamp()) then
   raise exception 'This meeting has started. Meeting details can only be edited before it starts';
 end if;
 update public.team_meetings set title=next_title,meeting_type=next_type,
   starts_at=next_start,ends_at=next_end,
   requirement=case when roster_changed then case when cardinality(next_required)>0 then 'selected' else 'optional' end else requirement end,
   areas=case when roster_changed then array[]::text[] else areas end,
   selected_students=case when roster_changed then next_required else selected_students end,
   check_in_open=case when schedule_changed then false else check_in_open end,
   code_hash=case when schedule_changed then null else code_hash end,
   code_expires_at=case when schedule_changed then null else code_expires_at end,
   version=version+1 where id=m.id;
 -- Existing team_audit trigger atomically records old/new values and actor;
 -- code material remains excluded. No notifications or strike writes.
 return jsonb_build_object('id',m.id,'version',m.version+1,'changed',true);
end $$;
create or replace function public.team_attendance_sync_future_rosters() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; candidate record; mm public.team_meeting_members;
 a public.team_attendance; before_snapshot jsonb; added integer:=0; promoted integer:=0; skipped integer:=0;
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 for m in select * from public.team_meetings where ends_at>clock_timestamp()
 and status in ('draft','open') and (requirement in ('active','registered') or meeting_type='stem_outreach') order by starts_at,id for update loop
  -- Recheck the end boundary after waiting for the meeting lock.
  if m.ends_at<=clock_timestamp() or m.status not in ('draft','open') then continue;end if;
  for candidate in select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
   from public.profiles p left join public.team_attendance_members r on r.student_id=p.id
   where team_attendance_private.is_participant(p.id) and coalesce(r.member_status,'prospective')<>'inactive'
   and (m.requirement='active' or r.member_status='registered' or m.meeting_type='stem_outreach') order by p.id loop
   select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=candidate.id for update;
   if m.ends_at<=clock_timestamp() then exit;end if;
   if not team_attendance_private.is_participant(candidate.id) then continue;end if;
   if not found then
    insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
    values(m.id,candidate.id,m.meeting_type<>'stem_outreach',candidate.member_status,candidate.team_area) returning * into mm;
    insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,candidate.id,case when m.meeting_type='stem_outreach' then 'not_required' else 'none' end);
    insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    added:=added+1;
   elsif not mm.required and m.meeting_type<>'stem_outreach' then
    select * into a from public.team_attendance where meeting_id=m.id and student_id=candidate.id for update;
    if m.ends_at<=clock_timestamp() then exit;end if;
    if not team_attendance_private.is_participant(candidate.id) then continue;end if;
    -- Upgrade only untouched optional entries. Preserve requests, reviews and check-ins.
    if not found or a.physical_status<>'pending' or a.review_status<>'not_required'
     or a.notice_at is not null or a.reviewed_at is not null or a.checked_in_at is not null
     or a.left_at is not null or a.version<>1 then skipped:=skipped+1;continue;end if;
    before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
    update public.team_meeting_members set required=true,member_status=candidate.member_status,team_area=candidate.team_area
     where meeting_id=m.id and student_id=candidate.id returning * into mm;
    update public.team_attendance set review_status='none',version=version+1 where id=a.id;
    insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_REQUIRE',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    promoted:=promoted+1;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('added',added,'promoted',promoted,'skipped',skipped);
end $$;

-- Explicitly scoped alternative for a roster repair. Never infer a
-- series or synchronize other participants. The caller supplies the verified
-- meeting IDs; all targets are validated before any snapshot is changed.
create or replace function team_attendance_private.sync_participant_rosters(student_id uuid, meeting_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target_id uuid:=$1; targets uuid[]:=$2; m public.team_meetings;
 candidate record; mm public.team_meeting_members; a public.team_attendance;
 before_snapshot jsonb; added integer:=0; promoted integer:=0; skipped integer:=0;
begin
 if target_id is null or targets is null or cardinality(targets) not between 1 and 52
  or array_position(targets,null) is not null
  or (select count(distinct v) from unnest(targets) v)<>cardinality(targets) then
  raise exception 'One participant and 1 to 52 distinct meeting IDs are required';
 end if;
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
 select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
 into candidate from public.profiles p left join public.team_attendance_members r on r.student_id=p.id where p.id=target_id;
 if candidate.member_status='inactive' then raise exception 'Attendance membership is inactive';end if;
 if (select count(*) from public.team_meetings where id=any(targets))<>cardinality(targets) then raise exception 'Meeting not found';end if;
 -- Lock and preflight the whole explicit list before writing anything.
 for m in select * from public.team_meetings where id=any(targets) order by id for update loop
  if m.ends_at<=clock_timestamp() or m.status not in ('draft','open') or (m.requirement not in ('active','registered') and m.meeting_type<>'stem_outreach') then
   raise exception 'Only future or in-progress draft/open active or registered meetings can be synchronized';
  end if;
  if m.requirement='registered' and candidate.member_status<>'registered' then
   raise exception 'Registered Attendance membership is required for every selected registered meeting';
  end if;
 end loop;
 for m in select * from public.team_meetings where id=any(targets) order by id loop
  select * into mm from public.team_meeting_members x where x.meeting_id=m.id and x.student_id=target_id for update;
  if m.ends_at<=clock_timestamp() then raise exception 'A selected meeting has ended';end if;
  if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
  if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
  if not found then
   insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
   values(m.id,target_id,m.meeting_type<>'stem_outreach',candidate.member_status,candidate.team_area) returning * into mm;
   insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,target_id,case when m.meeting_type='stem_outreach' then 'not_required' else 'none' end);
   insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
   values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
   added:=added+1;
  elsif not mm.required and m.meeting_type<>'stem_outreach' then
   select * into a from public.team_attendance x where x.meeting_id=m.id and x.student_id=target_id for update;
   if m.ends_at<=clock_timestamp() then raise exception 'A selected meeting has ended';end if;
   if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
   if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
   -- Identical preservation rule to the existing no-argument sync.
   if not found or a.physical_status<>'pending' or a.review_status<>'not_required'
    or a.notice_at is not null or a.reviewed_at is not null or a.checked_in_at is not null
    or a.left_at is not null or a.version<>1 then skipped:=skipped+1;continue;end if;
   before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
   update public.team_meeting_members x set required=true,member_status=candidate.member_status,team_area=candidate.team_area
    where x.meeting_id=m.id and x.student_id=target_id returning * into mm;
   update public.team_attendance set review_status='none',version=version+1 where id=a.id;
   insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
   values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_SYNC_REQUIRE',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
   promoted:=promoted+1;
  end if;
 end loop;
 return jsonb_build_object('student_id',target_id,'meeting_ids',to_jsonb(targets),'added',added,'promoted',promoted,'skipped',skipped);
end $$;

revoke all on function team_attendance_private.sync_participant_rosters(uuid,uuid[]) from public,anon,authenticated;

revoke all on function public.team_attendance_sync_future_rosters() from public,anon,authenticated;
grant execute on function public.team_attendance_sync_future_rosters() to authenticated;

-- Explicit leadership corrections require verified times and a reason. No
-- correction executes during installation or infers an end from the schedule.
create function public.team_attendance_outreach_correct(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings;a public.team_attendance;arrived timestamptz;departed timestamptz;reason text;
begin
 if auth.uid() is null or not team_attendance_private.manager() then raise exception 'Meeting leadership required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(4418,10);
 select * into m from public.team_meetings where id=(p->>'meeting_id')::uuid for update;
 if not found or m.meeting_type<>'stem_outreach' then raise exception 'STEM outreach event required';end if;
 select * into a from public.team_attendance where id=(p->>'attendance_id')::uuid and meeting_id=m.id for update;
 if not found then raise exception 'Attendance record not found';end if;
 if not team_attendance_private.manager() then raise exception 'Meeting leadership required' using errcode='42501';end if;
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.';end if;
 arrived:=(p->>'checked_in_at')::timestamptz;departed:=(p->>'left_at')::timestamptz;reason:=trim(coalesce(p->>'reason',''));
 if length(reason) not between 1 and 2000 then raise exception 'Explain how the actual times were verified';end if;
 if arrived is null or departed is null or not isfinite(arrived) or not isfinite(departed)
  or departed<=arrived or departed>clock_timestamp() or arrived<m.starts_at-interval '30 minutes' or departed>=m.ends_at+interval '30 minutes' then
  raise exception 'Verified arrival and departure must be in the event attendance window and cannot be in the future';end if;
 update public.team_attendance set checked_in_at=arrived,left_at=departed,
  physical_status=case when departed<m.ends_at then 'left_early' when arrived>m.starts_at+interval '5 minutes' then 'late' else 'present' end,
  version=version+1 where id=a.id;
 insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
 values(m.id,a.student_id,'team_attendance',a.id::text,'OUTREACH_TIME_CORRECTION',jsonb_build_object('reason',reason),auth.uid());
 return jsonb_build_object('message','Verified outreach times saved');
end $$;
revoke all on function public.team_attendance_outreach_correct(jsonb) from public,anon;
grant execute on function public.team_attendance_outreach_correct(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.team_attendance_manage(action text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.team_meetings; a public.team_attendance; s public.team_attendance_strikes;
 mid uuid; code text; target text; uid uuid; result jsonb;
 automatic_count integer:=0; changed integer:=0; automatic_ids jsonb;
begin
 if not (team_attendance_private.manager() or (team_attendance_private.reviewer() and action in ('attendance','strike','rescind'))) then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Serializes leadership mutations, including roster snapshots.
 perform pg_advisory_xact_lock(4418,10);
 if not (team_attendance_private.manager() or (team_attendance_private.reviewer() and action in ('attendance','strike','rescind'))) then raise exception 'Leadership access required' using errcode='42501'; end if;
 if action='member' then
 uid:=(p->>'student_id')::uuid;
 if not team_attendance_private.is_participant(uid) then raise exception 'Active Attendance participant required'; end if;
 insert into public.team_attendance_members(student_id,member_status,team_area) values(uid,p->>'member_status',trim(coalesce(p->>'team_area','')))
 on conflict(student_id) do update set member_status=excluded.member_status,team_area=excluded.team_area;
 return '{}'::jsonb;
 elsif action='create' then
 if p->>'requirement'='areas' and jsonb_array_length(coalesce(p->'areas','[]'))=0 then raise exception 'Select at least one area'; end if;
 if p->>'requirement'='selected' and jsonb_array_length(coalesce(p->'selected_students','[]'))=0 then raise exception 'Select at least one student'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p->'selected_students','[]')) v where not exists(
 select 1 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.id=v::uuid and team_attendance_private.is_participant(pr.id) and coalesce(mem.member_status,'prospective')<>'inactive')) then raise exception 'Selected student is unavailable'; end if;
 insert into public.team_meetings(title,meeting_type,starts_at,ends_at,late_minutes,requirement,areas,selected_students,created_by)
 values(trim(p->>'title'),p->>'meeting_type',(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
 5,coalesce(p->>'requirement','active'),array(select jsonb_array_elements_text(coalesce(p->'areas','[]'))),
 array(select jsonb_array_elements_text(coalesce(p->'selected_students','[]'))::uuid),auth.uid()) returning * into m;
 insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
 select m.id,pr.id,case m.requirement when 'active' then true when 'registered' then coalesce(mem.member_status,'prospective')='registered'
 when 'areas' then coalesce(mem.member_status,'prospective')='registered' and coalesce(mem.team_area,'')=any(m.areas)
 when 'selected' then pr.id=any(m.selected_students) else false end,coalesce(mem.member_status,'prospective'),coalesce(mem.team_area,'')
 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where team_attendance_private.is_participant(pr.id) and coalesce(mem.member_status,'prospective')<>'inactive';
 insert into public.team_attendance(meeting_id,student_id,review_status) select meeting_id,student_id,case when required then 'none' else 'not_required' end from public.team_meeting_members where meeting_id=m.id;
 -- Audit the initial required roster using the existing production history table.
 insert into public.team_attendance_history(meeting_id,entity,entity_id,action,after_data,performed_by)
 select m.id,'team_meeting_members',m.id::text,'SNAPSHOT',coalesce(jsonb_agg(to_jsonb(mm)-'attempts'-'attempt_window'),'[]'),auth.uid() from public.team_meeting_members mm where mm.meeting_id=m.id;
 return jsonb_build_object('id',m.id);
 end if;
 mid:=(p->>'meeting_id')::uuid;
 select * into m from public.team_meetings where id=mid for update;
 if not found then raise exception 'Meeting not found'; end if;
 -- Outreach times have a separate validated, reason-audited correction path.
 -- The generic physical-status correction clears departure timestamps and must
 -- never be used to review or edit an outreach record.
 if action='attendance' and m.meeting_type='stem_outreach' then
  raise exception 'Use the verified outreach time correction. Optional outreach does not require an excuse review';
 end if;
 if action in ('open','close','finalize') then
 if m.version is distinct from (p->>'version')::integer then raise exception 'Meeting changed. Refresh and try again.'; end if;
 if m.status='finalized' then raise exception 'Meeting is finalized'; end if;
 if action='open' then
 if now()<m.starts_at-interval '30 minutes' or now()>=m.ends_at then raise exception 'Check-in opens from 30 minutes before start until the scheduled end'; end if;
 loop
 code:=lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%1000000)::text,6,'0');
 exit when sha256(convert_to(m.id::text||code,'UTF8')) is distinct from m.code_hash;
 end loop;
 update public.team_meetings set status='open',check_in_open=true,code_hash=sha256(convert_to(id::text||code,'UTF8')),
 code_expires_at=least(now()+interval '30 minutes',ends_at),version=version+1 where id=mid;
 return jsonb_build_object('code',code,'expires_at',least(now()+interval '30 minutes',m.ends_at));
 elsif action='close' then
 if clock_timestamp()<m.starts_at-interval '30 minutes' then raise exception 'Check-in window has not started';end if;
 if m.status not in ('draft','open') then raise exception 'Only a draft or open meeting can be closed'; end if;
 update public.team_meetings set status='closed',check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 else
 if m.status<>'closed' or now()<m.ends_at then raise exception 'Close check-in and wait until the scheduled end before finalizing'; end if;
 -- Require the current UI consequence preview. Old clients fail safely instead
 -- of silently opting a meeting into a newly consequential policy.
 select count(*),coalesce(jsonb_agg(att.id::text order by att.id::text),'[]'::jsonb)
 into automatic_count,automatic_ids from public.team_attendance att
 join public.team_meeting_members mm on mm.meeting_id=att.meeting_id and mm.student_id=att.student_id
 where att.meeting_id=mid and mm.required and att.physical_status in ('pending','absent')
 and att.review_status in ('none','denied') and not exists(
  select 1 from public.team_attendance_strikes st where st.attendance_id=att.id
  and (st.source='automatic_absence' or lower(trim(st.category))='unexcused absence'));
 if jsonb_typeof(p->'automatic_absence_strike_attendance_ids') is distinct from 'array' then
  raise exception 'Automatic absence strike preview changed or is missing. Refresh and review before completing attendance';
 end if;
 if (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(p->'automatic_absence_strike_attendance_ids') v) is distinct from automatic_ids
 or jsonb_typeof(p->'automatic_absence_strike_count') is distinct from 'number'
 or (p->>'automatic_absence_strike_count')::numeric is distinct from automatic_count::numeric then
  raise exception 'Automatic absence strike preview changed or is missing. Refresh and review before completing attendance';
 end if;
 update public.team_attendance att set physical_status='absent',version=att.version+1 from public.team_meeting_members mm
 where att.meeting_id=mid and mm.meeting_id=att.meeting_id and mm.student_id=att.student_id and mm.required and att.physical_status='pending';
 -- Only this new finalization opts in. Existing finalized meetings keep false,
 -- even when their attendance or excuse decisions are later corrected.
 update public.team_meetings set status='finalized',auto_absence_strikes_enabled=true,
 check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 for a in select * from public.team_attendance where meeting_id=mid order by id for update loop
  changed:=changed+team_attendance_private.reconcile_absence_strike(a.id);
 end loop;
 return jsonb_build_object('automatic_absence_strikes',changed);
 end if;
 return '{}'::jsonb;
 end if;
 select * into a from public.team_attendance where id=(p->>'attendance_id')::uuid and meeting_id=mid for update;
 if not found then raise exception 'Attendance record not found'; end if;
 if action in ('strike','rescind') and not team_attendance_private.reviewer() then raise exception 'Mentor or active Program Manager required' using errcode='42501';end if;
 if action='attendance' then
 if p ? 'review_status' and (not team_attendance_private.request_reviewer() or a.student_id=auth.uid()) then raise exception 'Another active Lead Coach or Program Manager must review this request' using errcode='42501';end if;
 if p ? 'review_status' and not team_attendance_private.can_review_request(a.student_id) then raise exception 'A non-Program-Manager Lead Coach must review Program Manager attendance requests' using errcode='42501';end if;
 if not team_attendance_private.manager() and (p ? 'physical_status' or nullif(p->>'left_at','')::timestamptz is distinct from a.left_at) then raise exception 'Meeting leadership required for physical attendance corrections' using errcode='42501';end if;
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'A correction/review explanation is required'; end if;
 target:=coalesce(p->>'physical_status',a.physical_status);
 if m.status='finalized' and target='pending' then raise exception 'Finalized attendance cannot be pending'; end if;
 if target='left_early' and (nullif(p->>'left_at','') is null or (p->>'left_at')::timestamptz>=m.ends_at or (p->>'left_at')::timestamptz<m.starts_at) then raise exception 'Departure must be during the meeting, before its end'; end if;
 update public.team_attendance set physical_status=target,review_status=coalesce(p->>'review_status',review_status),
 left_at=case when not (p ? 'physical_status') then a.left_at when target='left_early' then (p->>'left_at')::timestamptz else null end,
 review_reason=case when p ? 'review_status' then trim(p->>'explanation') else review_reason end,
 reviewed_by=case when p ? 'review_status' then auth.uid() else reviewed_by end,
 reviewed_at=case when p ? 'review_status' then now() else reviewed_at end,version=version+1 where id=a.id;
 -- Preserve physical-correction reasons without impersonating an excuse review.
 if not (p ? 'review_status') then
  insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
  values(mid,a.student_id,'team_attendance',a.id::text,'CORRECTION_NOTE',jsonb_build_object('explanation',trim(p->>'explanation')),auth.uid());
 end if;
 -- Reconcile only policy-enabled meetings, only the automatic source. Manual
 -- strikes and historic meetings remain unchanged by attendance corrections.
 changed:=team_attendance_private.reconcile_absence_strike(a.id);
 result:=jsonb_build_object('automatic_absence_strikes',greatest(changed,0),
  'automatic_absence_strikes_rescinded',greatest(-changed,0));
 elsif action='strike' then
 if lower(trim(p->>'category'))='unexcused absence' and exists(
  select 1 from public.team_attendance_strikes st where st.attendance_id=a.id
  and st.source='automatic_absence' and st.rescinded_at is null) then
  raise exception 'An automatic absence strike already exists. Review or rescind it before assigning a replacement';
 end if;
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by)
 values(a.id,a.student_id,a.meeting_id,p->>'category',(p->>'quantity')::integer,trim(p->>'explanation'),auth.uid());
 elsif action='rescind' then
 select * into s from public.team_attendance_strikes where id=(p->>'strike_id')::uuid and attendance_id=a.id for update;
 if not found or s.rescinded_at is not null then raise exception 'Active strike not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return coalesce(result,'{}'::jsonb);
end $function$;




create or replace function public.team_attendance_request(p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance; kind text:=p->>'notice_type';
 expected timestamptz:=nullif(p->>'expected_at','')::timestamptz; t timestamptz:=clock_timestamp();
begin
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if kind is null or kind not in ('absent','late','early') then raise exception 'Select attendance impact'; end if;
 if length(trim(coalesce(p->>'reason',''))) not between 1 and 2000 then raise exception 'Provide a reason (up to 2000 characters)'; end if;
 select * into m from public.team_meetings where id=(p->>'meeting_id')::uuid for update;
 if not found then raise exception 'Meeting not found'; end if;
 if m.meeting_type='stem_outreach' then raise exception 'Optional STEM outreach does not require an excuse request';end if;
 t:=clock_timestamp();
 if m.status='finalized' or t>=m.ends_at then raise exception 'Contact leadership after the meeting'; end if;
 if t>=m.starts_at and kind<>'early' then raise exception 'During a meeting only early-departure requests are available'; end if;
 if kind='absent' and expected is not null then raise exception 'Absence does not need an expected time'; end if;
 if kind in ('late','early') and (expected is null or expected<=m.starts_at or expected>=m.ends_at or expected<t) then raise exception 'Expected time must be in the future and during the meeting'; end if;
 select * into a from public.team_attendance where meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster'; end if;
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.'; end if;
 -- Each change gets a fresh server timestamp and audit history; never backdate notice.
 update public.team_attendance set notice_type=kind,expected_at=expected,notice_at=t,notice_reason=trim(p->>'reason'),
 review_status='pending',review_reason='',reviewed_by=null,reviewed_at=null,version=version+1 where id=a.id;
end $$;

create or replace function public.team_attendance_notice(meeting_id uuid,reason text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance;
begin
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if length(trim(coalesce(reason,''))) not between 1 and 2000 then raise exception 'Provide a notice reason (up to 2000 characters)'; end if;
 select * into m from public.team_meetings where id=meeting_id for update;
 if not found or m.status='finalized' then raise exception 'Contact leadership to review a finalized meeting'; end if;
 if m.meeting_type='stem_outreach' then raise exception 'Optional STEM outreach does not require an excuse request';end if;
 select * into a from public.team_attendance x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster'; end if;
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if a.notice_at is not null then raise exception 'Notice already submitted. Contact leadership for corrections.'; end if;
 update public.team_attendance set notice_at=clock_timestamp(),notice_reason=trim(reason),review_status='pending',version=version+1 where id=a.id;
end $$;


commit;
