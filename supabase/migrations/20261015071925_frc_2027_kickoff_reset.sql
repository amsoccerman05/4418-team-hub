begin;

-- FIRST confirms January 9, 2027: https://www.firstinspires.org/programs/frc/game-and-season
-- Reset at midnight America/Denver, not at the broadcast time.
-- Keep 2026's existing boundary until kickoff. No historical rows are changed.
-- Later kickoff dates must be confirmed and added explicitly; never reset January 1.
create function team_attendance_private.notice_window_start(as_of timestamptz)
returns timestamptz language sql immutable strict security invoker set search_path='' as $$
 select case when as_of >= timestamptz '2027-01-09 00:00:00 America/Denver'
 then timestamptz '2027-01-09 00:00:00 America/Denver'
 else least(date_trunc('year',as_of at time zone 'UTC') at time zone 'UTC',timestamptz '2026-01-01 00:00:00 UTC') end
$$;
revoke all on function team_attendance_private.notice_window_start(timestamptz) from public, anon, authenticated;

create or replace function public.team_attendance_policy_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare boundary timestamptz;
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead','mentor','admin') then raise exception 'Active Attendance account required' using errcode='42501';end if;
 -- Keep the current window through January 8, then start the 2027 season.
 boundary:=team_attendance_private.notice_window_start(now());
 return jsonb_build_object('user_id',auth.uid(),'can_participate',team_attendance_private.participant(),'can_review',team_attendance_private.reviewer(),'can_review_requests',team_attendance_private.request_reviewer(),'can_read_team',team_attendance_private.reader(),'can_manage_meetings',team_attendance_private.manager(),'strike_year_start',boundary,
 'can_review_program_manager_requests',team_attendance_private.is_lead_coach(auth.uid()) and not team_attendance_private.is_program_manager(auth.uid()),
 'mentor_review_required_for',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(p.id),'[]'::jsonb) from public.profiles p where team_attendance_private.is_program_manager(p.id)) else '[]'::jsonb end,
 'people',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',p.role,'positions',(select coalesce(jsonb_agg(tp.name),'[]') from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active where mp.user_id=p.id and mp.revoked_at is null))),'[]') from public.profiles p where p.active) else '[]'::jsonb end,
 'warnings',(select coalesce(jsonb_agg(jsonb_build_object('student_id',h.student_id,'at',h.performed_at,'actor',h.performed_by,'note',h.after_data->>'note') order by h.id desc),'[]') from public.team_attendance_history h where h.entity='attendance_policy' and h.action='WARNING_PARENT_CONTACT' and (boundary is null or h.performed_at>=boundary) and (team_attendance_private.reader() or h.student_id=auth.uid())));
end $$;

commit;
