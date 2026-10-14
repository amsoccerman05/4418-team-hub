-- Proposed policy: 30-minute departure grace, including completed meetings.
-- No historical records, check-in controls, strikes, or existing grants change.
begin;
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
 -- Completion locks every other student edit; only an existing check-in may
 -- receive a real-time departure during this bounded grace period.
 if t<m.starts_at or t>=m.ends_at+interval '30 minutes' then raise exception 'Check-out closes 30 minutes after the scheduled end. Contact leadership for corrections.';end if;
 if a.checked_in_at is null or a.checked_in_at>t or a.physical_status not in ('present','late') then raise exception 'Check in before checking out';end if;
 update public.team_attendance set left_at=t,physical_status=case when t<m.ends_at then 'left_early' else a.physical_status end,version=version+1 where id=a.id;
 -- team_audit persists the before/after values and auth.uid() atomically.
 return jsonb_build_object('message','Check-out recorded');
end $$;

commit;
