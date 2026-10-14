-- Preserve the existing six-digit, five-attempt / 15-minute policy. This change
-- writes no existing data and never resets a budget when leadership rotates a
-- code. Known locked-out callers get a read-only denial before the shared
-- meeting lock; every possible success still takes the authoritative locks.
begin;

create or replace function public.team_attendance_check_in(meeting_id uuid, code text)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 m public.team_meetings;
 mm public.team_meeting_members;
 a public.team_attendance;
 t timestamptz:=clock_timestamp();
 retry_at timestamptz;
begin
 if not team_attendance_private.participant() then
  raise exception 'Active Attendance participant required' using errcode='42501';
 end if;

 -- Denial only: no locks, writes, submitted-code inspection or success result.
 -- Include the attendance and meeting state so an already-recorded attendance
 -- retains its existing precedence over throttling, and closed/expired
 -- meetings still use the authoritative closed-check-in error below.
 select x.attempt_window+interval '15 minutes' into retry_at
 from public.team_meeting_members x
 join public.team_attendance att on att.meeting_id=x.meeting_id and att.student_id=x.student_id
 join public.team_meetings meeting on meeting.id=x.meeting_id
 where x.meeting_id=$1 and x.student_id=auth.uid()
  and x.attempts>=5 and t<x.attempt_window+interval '15 minutes'
  and att.checked_in_at is null and att.physical_status='pending'
  and meeting.status='open' and meeting.check_in_open
  and t>=meeting.starts_at-interval '30 minutes'
  and t<meeting.code_expires_at and t<meeting.ends_at;
 if found then
  return jsonb_build_object('status','rate_limited','retry_at',retry_at,
   'error','Too many attempts. Try again in 15 minutes or contact leadership.');
 end if;

 -- A read-only probe can be stale. Never admit a request from that probe:
 -- preserve the meeting -> member -> attendance lock order and recheck all
 -- authorization, availability, idempotency and budget state under those locks.
 select * into m from public.team_meetings where id=$1 for update;
 t:=clock_timestamp();
 if not found or t<m.starts_at-interval '30 minutes' or not m.check_in_open
  or m.status<>'open' or m.code_expires_at is null or t>=m.code_expires_at or t>=m.ends_at then
  raise exception 'Check-in is closed or the code expired';
 end if;
 select * into mm from public.team_meeting_members x
 where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster. Contact leadership.'; end if;
 select * into a from public.team_attendance x
 where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster. Contact leadership.'; end if;
 if not team_attendance_private.participant() then
  raise exception 'Active Attendance participant required' using errcode='42501';
 end if;
 -- Member/attendance lock waits must not extend a code's lifetime, allow a
 -- check-in after the meeting ends, or keep an expired attempt window alive.
 t:=clock_timestamp();
 if t<m.starts_at-interval '30 minutes' or not m.check_in_open
  or m.status<>'open' or m.code_expires_at is null or t>=m.code_expires_at or t>=m.ends_at then
  raise exception 'Check-in is closed or the code expired';
 end if;
 if a.checked_in_at is not null or a.physical_status<>'pending' then
  return jsonb_build_object('status','already_recorded','message','Attendance already recorded');
 end if;
 if mm.attempt_window is null or t>=mm.attempt_window+interval '15 minutes' then
  mm.attempts:=0;
  mm.attempt_window:=t;
  update public.team_meeting_members x set attempts=0,attempt_window=t
  where x.meeting_id=m.id and student_id=auth.uid();
 end if;
 if mm.attempts>=5 then
  return jsonb_build_object('status','rate_limited','retry_at',mm.attempt_window+interval '15 minutes',
   'error','Too many attempts. Try again in 15 minutes or contact leadership.');
 end if;
 update public.team_meeting_members x set attempts=attempts+1
 where x.meeting_id=m.id and student_id=auth.uid();
 if code is null or code !~ '^[0-9]{6}$'
  or sha256(convert_to(m.id::text||code,'UTF8')) is distinct from m.code_hash then
  -- Return, never raise: raising would roll back the consumed attempt.
  return jsonb_build_object('status','invalid_code','error','Invalid meeting code');
 end if;
 update public.team_attendance
 set physical_status=case when t>m.starts_at+interval '5 minutes' then 'late' else 'present' end,
  checked_in_at=t,version=version+1 where id=a.id;
 return jsonb_build_object('status','checked_in','message','Checked in');
end $function$;

-- CREATE OR REPLACE retains grants; repeat the existing boundary explicitly.
revoke all on function public.team_attendance_check_in(uuid,text) from public,anon;
grant execute on function public.team_attendance_check_in(uuid,text) to authenticated;

commit;
