-- Additive Attendance-only participation: no shared role or permission changes.
-- Existing snapshots remain unchanged until an explicit roster sync is requested.
-- Apply after 20261008032037 and 20261008032108; no data backfill runs here.
begin;
create function team_attendance_private.is_program_manager(member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p
 join public.team_member_positions mp on mp.user_id=p.id and mp.revoked_at is null
 join public.team_positions tp on tp.key=mp.position_key and tp.active
 where p.id=member_id and p.active and p.role::text in ('student','lead','mentor','admin')
 and tp.key='program_manager')
$$;
create function team_attendance_private.is_participant(member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=member_id and p.active
 and (p.role::text in ('student','lead') or
 (p.role::text in ('mentor','admin') and team_attendance_private.is_program_manager(p.id))))
$$;
create function team_attendance_private.participant() returns boolean
language sql stable security definer set search_path='' as $$
 select team_attendance_private.is_participant(auth.uid())
$$;
-- Retain the private legacy signature consumed by existing notification routing.
-- Its former student-only assumption is intentionally replaced by the same
-- authoritative PM predicate used by review authorization and policy context.
create or replace function team_attendance_private.is_student_program_manager(member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select team_attendance_private.is_program_manager(member_id)
$$;
create or replace function team_attendance_private.can_review_request(requester uuid, reviewer uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select requester is not null and reviewer is not null and requester<>reviewer
 and exists(select 1 from public.profiles p where p.id=reviewer and p.active
 and p.role::text in ('student','lead','mentor','admin')
 and case when team_attendance_private.is_program_manager(requester)
 then p.role::text='mentor' and not team_attendance_private.is_program_manager(reviewer)
 else p.role::text='mentor' or team_attendance_private.is_program_manager(reviewer) end)
$$;
revoke all on function team_attendance_private.is_program_manager(uuid),team_attendance_private.is_participant(uuid),team_attendance_private.is_student_program_manager(uuid),team_attendance_private.can_review_request(uuid,uuid),team_attendance_private.participant() from public,anon,authenticated;
grant execute on function team_attendance_private.participant() to authenticated;


CREATE OR REPLACE FUNCTION public.team_attendance_manage(action text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.team_meetings; a public.team_attendance; s public.team_attendance_strikes;
 mid uuid; code text; target text; uid uuid; result jsonb;
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
 update public.team_attendance att set physical_status='absent',version=att.version+1 from public.team_meeting_members mm
 where att.meeting_id=mid and mm.meeting_id=att.meeting_id and mm.student_id=att.student_id and mm.required and att.physical_status='pending';
 update public.team_meetings set status='finalized',check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 end if;
 return '{}'::jsonb;
 end if;
 select * into a from public.team_attendance where id=(p->>'attendance_id')::uuid and meeting_id=mid for update;
 if not found then raise exception 'Attendance record not found'; end if;
 if action in ('strike','rescind') and not team_attendance_private.reviewer() then raise exception 'Mentor or active Program Manager required' using errcode='42501';end if;
 if action='attendance' then
 if p ? 'review_status' and (not team_attendance_private.reviewer() or a.student_id=auth.uid()) then raise exception 'Another Mentor or Program Manager must review this request' using errcode='42501';end if;
 if p ? 'review_status' and not team_attendance_private.can_review_request(a.student_id) then raise exception 'A Mentor must review Program Manager attendance requests' using errcode='42501';end if;
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
 elsif action='strike' then
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by)
 values(a.id,a.student_id,a.meeting_id,p->>'category',(p->>'quantity')::integer,trim(p->>'explanation'),auth.uid());
 elsif action='rescind' then
 select * into s from public.team_attendance_strikes where id=(p->>'strike_id')::uuid and attendance_id=a.id for update;
 if not found or s.rescinded_at is not null then raise exception 'Active strike not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return '{}'::jsonb;
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
 select * into a from public.team_attendance x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster'; end if;
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if a.notice_at is not null then raise exception 'Notice already submitted. Contact leadership for corrections.'; end if;
 update public.team_attendance set notice_at=clock_timestamp(),notice_reason=trim(reason),review_status='pending',version=version+1 where id=a.id;
end $$;

CREATE OR REPLACE FUNCTION public.team_attendance_check_in(meeting_id uuid, code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.team_meetings; mm public.team_meeting_members; a public.team_attendance; t timestamptz:=clock_timestamp();
begin
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 select * into m from public.team_meetings where id=meeting_id for update;
 t:=clock_timestamp();
 if not found or t<m.starts_at-interval '30 minutes' or not m.check_in_open or m.status<>'open' or t>=m.code_expires_at or t>=m.ends_at then raise exception 'Check-in is closed or the code expired'; end if;
 select * into mm from public.team_meeting_members x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster. Contact leadership.'; end if;
 select * into a from public.team_attendance x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if a.checked_in_at is not null or a.physical_status<>'pending' then return jsonb_build_object('message','Attendance already recorded'); end if;
 if mm.attempt_window is null or t>=mm.attempt_window+interval '15 minutes' then
 mm.attempts:=0;
 update public.team_meeting_members x set attempts=0,attempt_window=t where x.meeting_id=m.id and student_id=auth.uid();
 end if;
 if mm.attempts>=5 then return jsonb_build_object('error','Too many attempts. Try again in 15 minutes or contact leadership.'); end if;
 update public.team_meeting_members x set attempts=attempts+1 where x.meeting_id=m.id and student_id=auth.uid();
 if code is null or code !~ '^[0-9]{6}$' or sha256(convert_to(m.id::text||code,'UTF8')) is distinct from m.code_hash then
 return jsonb_build_object('error','Invalid meeting code'); end if;
 update public.team_attendance set physical_status=case when t>m.starts_at+interval '5 minutes' then 'late' else 'present' end,
 checked_in_at=t,version=version+1 where id=a.id;
 return jsonb_build_object('message','Checked in');
end $function$;

create or replace function public.team_attendance_check_out(meeting_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance; t timestamptz;
begin
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 select * into m from public.team_meetings where id=meeting_id for update;
 if not found then raise exception 'Meeting not found';end if;
 select * into a from public.team_attendance x where x.meeting_id=m.id and x.student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster';end if;
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 -- Retries must preserve the original departure, including after meeting end.
 if a.left_at is not null then return jsonb_build_object('message','Check-out already recorded');end if;
 t:=clock_timestamp();
 if m.status='finalized' or t<m.starts_at or t>=m.ends_at then raise exception 'Check out during the meeting. Contact leadership for corrections.';end if;
 if a.checked_in_at is null or a.checked_in_at>t or a.physical_status not in ('present','late') then raise exception 'Check in before checking out';end if;
 update public.team_attendance set left_at=t,physical_status='left_early',version=version+1 where id=a.id;
 -- team_audit persists the before/after values and auth.uid() atomically.
 return jsonb_build_object('message','Check-out recorded');
end $$;

create or replace function public.team_attendance_roster() returns table(student_id uuid,display_name text,member_status text,team_area text)
language plpgsql security definer set search_path='' as $$
begin
 if not team_attendance_private.reader() then raise exception 'Leadership access required' using errcode='42501';end if;
 return query select p.id,p.display_name::text,coalesce(m.member_status,'prospective'),coalesce(m.team_area,'')
 from public.profiles p left join public.team_attendance_members m on m.student_id=p.id
 where team_attendance_private.is_participant(p.id) order by p.display_name;
end $$;

create or replace function public.team_attendance_policy_action(action text,p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=nullif(p->>'student_id','')::uuid; note text:=trim(coalesce(p->>'note',''));
begin
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.reviewer() then raise exception 'Mentor or active Program Manager required' using errcode='42501';end if;
 if length(note)>2000 then raise exception 'Note must be at most 2000 characters';end if;
 if action='warning_parent_contact' then
  if uid=auth.uid() or not team_attendance_private.is_participant(uid) then raise exception 'Choose another active Attendance participant';end if;
  insert into public.team_attendance_history(student_id,entity,entity_id,action,after_data,performed_by)
  values(uid,'attendance_policy',uid::text,'WARNING_PARENT_CONTACT',jsonb_build_object('note',note),auth.uid());
 else raise exception 'Unknown policy action';end if;
end $$;

create or replace function public.team_attendance_policy_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare boundary timestamptz;
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead','mentor','admin') then raise exception 'Active Attendance account required' using errcode='42501';end if;
 -- User-approved annual reset: January 1, using the database UTC calendar.
 boundary:=date_trunc('year',now() at time zone 'UTC') at time zone 'UTC';
 return jsonb_build_object('user_id',auth.uid(),'can_participate',team_attendance_private.participant(),'can_review',team_attendance_private.reviewer(),'can_read_team',team_attendance_private.reader(),'can_manage_meetings',team_attendance_private.manager(),'strike_year_start',boundary,
 'can_review_program_manager_requests',team_attendance_private.role()='mentor' and not team_attendance_private.is_program_manager(auth.uid()),
 'mentor_review_required_for',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(p.id),'[]'::jsonb) from public.profiles p where team_attendance_private.is_program_manager(p.id)) else '[]'::jsonb end,
 'people',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',p.role,'positions',(select coalesce(jsonb_agg(tp.name),'[]') from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active where mp.user_id=p.id and mp.revoked_at is null))),'[]') from public.profiles p where p.active) else '[]'::jsonb end,
 'warnings',(select coalesce(jsonb_agg(jsonb_build_object('student_id',h.student_id,'at',h.performed_at,'actor',h.performed_by,'note',h.after_data->>'note') order by h.id desc),'[]') from public.team_attendance_history h where h.entity='attendance_policy' and h.action='WARNING_PARENT_CONTACT' and (boundary is null or h.performed_at>=boundary) and (team_attendance_private.reader() or h.student_id=auth.uid())));
end $$;

-- Self-service read scope uses the same participant predicate. Existing team
-- readership and management rights are deliberately left intact.
alter policy attendance_member_read on public.team_attendance_members using(team_attendance_private.reader() or (student_id=auth.uid() and team_attendance_private.participant()));
alter policy attendance_snapshot_read on public.team_meeting_members using(team_attendance_private.reader() or (student_id=auth.uid() and team_attendance_private.participant()));
alter policy attendance_meeting_read on public.team_meetings using(team_attendance_private.reader() or (team_attendance_private.participant() and exists(select 1 from public.team_meeting_members mm where mm.meeting_id=team_meetings.id and mm.student_id=auth.uid())));
alter policy attendance_read on public.team_attendance using(team_attendance_private.reader() or (student_id=auth.uid() and team_attendance_private.participant()));
alter policy attendance_strike_read on public.team_attendance_strikes using(team_attendance_private.reader() or (student_id=auth.uid() and team_attendance_private.participant()));
alter policy attendance_history_read on public.team_attendance_history using(team_attendance_private.reader() or (student_id=auth.uid() and team_attendance_private.participant()));


create or replace function public.team_attendance_sync_future_rosters() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; candidate record; mm public.team_meeting_members;
 a public.team_attendance; before_snapshot jsonb; added integer:=0; promoted integer:=0; skipped integer:=0;
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 for m in select * from public.team_meetings where starts_at>clock_timestamp()
 and status<>'finalized' and requirement in ('active','registered') order by starts_at,id for update loop
  -- Recheck time after waiting for the meeting lock.
  if m.starts_at<=clock_timestamp() or m.status='finalized' then continue;end if;
  for candidate in select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
   from public.profiles p left join public.team_attendance_members r on r.student_id=p.id
   where team_attendance_private.is_participant(p.id) and coalesce(r.member_status,'prospective')<>'inactive'
   and (m.requirement='active' or r.member_status='registered') order by p.id loop
   select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=candidate.id for update;
   if m.starts_at<=clock_timestamp() then exit;end if;
   if not team_attendance_private.is_participant(candidate.id) then continue;end if;
   if not found then
    insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
    values(m.id,candidate.id,true,candidate.member_status,candidate.team_area) returning * into mm;
    insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,candidate.id,'none');
    insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    added:=added+1;
   elsif not mm.required then
    select * into a from public.team_attendance where meeting_id=m.id and student_id=candidate.id for update;
    if m.starts_at<=clock_timestamp() then exit;end if;
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

-- Explicitly scoped alternative for an approved roster repair. Never infer a
-- series or synchronize other participants. The caller supplies the verified
-- meeting IDs; all targets are validated before any snapshot is changed.
create function team_attendance_private.sync_participant_rosters(student_id uuid, meeting_ids uuid[]) returns jsonb
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
 if auth.uid() is not null and not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
 select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
 into candidate from public.profiles p left join public.team_attendance_members r on r.student_id=p.id where p.id=target_id;
 if candidate.member_status='inactive' then raise exception 'Attendance membership is inactive';end if;
 if (select count(*) from public.team_meetings where id=any(targets))<>cardinality(targets) then raise exception 'Meeting not found';end if;
 -- Lock and preflight the whole explicit list before writing anything.
 for m in select * from public.team_meetings where id=any(targets) order by id for update loop
  if m.starts_at<=clock_timestamp() or m.status='finalized' or m.requirement not in ('active','registered') then
   raise exception 'Only future, unfinalized active or registered meetings can be synchronized';
  end if;
  if m.requirement='registered' and candidate.member_status<>'registered' then
   raise exception 'Registered Attendance membership is required for every selected registered meeting';
  end if;
 end loop;
 for m in select * from public.team_meetings where id=any(targets) order by id loop
  select * into mm from public.team_meeting_members x where x.meeting_id=m.id and x.student_id=target_id for update;
  if m.starts_at<=clock_timestamp() then raise exception 'A selected meeting has started';end if;
  if auth.uid() is not null and not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
  if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
  if not found then
   insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
   values(m.id,target_id,true,candidate.member_status,candidate.team_area) returning * into mm;
   insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,target_id,'none');
   insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
   values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
   added:=added+1;
  elsif not mm.required then
   select * into a from public.team_attendance x where x.meeting_id=m.id and x.student_id=target_id for update;
   if m.starts_at<=clock_timestamp() then raise exception 'A selected meeting has started';end if;
   if auth.uid() is not null and not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
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

-- Authenticated leadership is the only public entry point. The private core is
-- also usable by the database owner for an explicitly authorized administrative
-- repair; NULL auth.uid() preserves honest database-session audit attribution.
create function public.team_attendance_sync_participant_rosters(student_id uuid, meeting_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 return team_attendance_private.sync_participant_rosters($1,$2);
end $$;

-- Public self-service/management signatures retain their authenticated boundary.
-- No anonymous execution or explicit-identity helper access is added.
revoke all on function public.team_attendance_manage(text,jsonb),public.team_attendance_request(jsonb),public.team_attendance_notice(uuid,text),public.team_attendance_check_in(uuid,text),public.team_attendance_check_out(uuid),public.team_attendance_roster(),public.team_attendance_policy_action(text,jsonb),public.team_attendance_policy_context(),public.team_attendance_sync_future_rosters(),public.team_attendance_sync_participant_rosters(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.team_attendance_manage(text,jsonb),public.team_attendance_request(jsonb),public.team_attendance_notice(uuid,text),public.team_attendance_check_in(uuid,text),public.team_attendance_check_out(uuid),public.team_attendance_roster(),public.team_attendance_policy_action(text,jsonb),public.team_attendance_policy_context(),public.team_attendance_sync_future_rosters(),public.team_attendance_sync_participant_rosters(uuid,uuid[]) to authenticated;
commit;
