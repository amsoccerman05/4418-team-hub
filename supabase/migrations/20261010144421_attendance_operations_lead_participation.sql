-- Attendance participation is separate from the shared suite management role.
-- An active Operations Lead may keep mentor/admin access and attend meetings.
-- This capability-only change does not enroll anyone or rewrite any roster.
begin;

create or replace function team_attendance_private.is_participant(member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.profiles p
  where p.id=member_id and p.active
   and (p.role::text in ('student','lead') or
    (p.role::text in ('mentor','admin') and (
     team_attendance_private.is_program_manager(p.id) or exists(
      select 1 from public.team_member_positions mp
      join public.team_positions tp on tp.key=mp.position_key and tp.active
      where mp.user_id=p.id and mp.revoked_at is null and tp.key='operations_lead'
     )
    )))
 )
$$;

-- Keep arbitrary-identity authorization helpers private.
revoke all on function team_attendance_private.is_participant(uuid) from public,anon,authenticated;

commit;
