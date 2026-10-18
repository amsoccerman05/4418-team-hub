-- LOCAL REVIEW ONLY. Preserve the legacy first-notice API without a second
-- submission policy. Its untyped notice is an absence request; late arrival and
-- early departure use team_attendance_request with an explicit expected time.
begin;

create or replace function public.team_attendance_notice(meeting_id uuid,reason text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance;
begin
 if not team_attendance_private.participant() then raise exception 'Active Attendance participant required' using errcode='42501'; end if;
 if length(trim(coalesce(reason,''))) not between 1 and 2000 then raise exception 'Provide a notice reason (up to 2000 characters)'; end if;
 -- Use the same meeting -> attendance lock order as the canonical request RPC.
 select * into m from public.team_meetings where id=meeting_id for update;
 if not found then raise exception 'Meeting not found'; end if;
 select * into a from public.team_attendance x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster'; end if;
 if a.notice_at is not null then raise exception 'Notice already submitted. Contact leadership for corrections.'; end if;
 -- The canonical RPC rechecks current participation and clock_timestamp() under
 -- the locks, denies outreach/finalized/ended meetings, and owns the audit update.
 perform public.team_attendance_request(jsonb_build_object(
  'meeting_id',m.id,'version',a.version,'notice_type','absent','reason',reason));
end $$;

commit;
