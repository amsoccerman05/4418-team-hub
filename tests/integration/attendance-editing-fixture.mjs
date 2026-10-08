// Synthetic fixture only. The caller must own a fresh disposable database.
// Matches tests/attendance-editing-db.spec.ts, including the inspected production
// public-audit contract; never run this against an existing/shared app database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const attendanceEditingSources = [
  'supabase/migrations/202609100001_team_attendance.sql',
  'supabase/migrations/202609120001_attendance_requests_recurrence.sql',
  'supabase/migrations/202609120008_attendance_roster_sync.sql',
  'tests/fixtures/attendance-production-functions.sql',
  'supabase/migrations/202609300001_attendance_policy_v03.sql',
  'supabase/migrations/20261007033053_attendance_meeting_editing.sql',
  'supabase/migrations/20261008032037_attendance_program_manager_mentor_review.sql',
];
const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

export async function installAttendanceEditingFixture(sql) {
  assert.equal((await sql("select coalesce(to_regclass('public.team_meetings')::text,'absent')")), 'absent',
    'Refusing an existing Attendance database');
  // Existing HTTP prerequisites omit the display label consumed by policy_context.
  // Fill only this newly added synthetic column; never change existing labels.
  await sql(`do $$ begin
    if not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='team_positions' and column_name='name') then
      alter table public.team_positions add column name text;
      update public.team_positions set name=key;
    end if;
  end $$;`);
  // This shared-app helper is absent from the disposable HTTP prerequisite file.
  // Do not replace it when an owned stack already supplies the contract.
  await sql(`do $outer$ begin
    if to_regprocedure('public.team_has_position(text)') is null then
      execute $fn$create function public.team_has_position(key text) returns boolean
      language sql stable security definer set search_path='' as $body$
        select exists(select 1 from public.team_member_positions mp
        join public.team_positions tp on tp.key=mp.position_key and tp.active
        join public.profiles pr on pr.id=mp.user_id and pr.active and pr.role::text in ('student','lead','mentor','admin')
        where mp.user_id=auth.uid() and mp.position_key=$1 and mp.revoked_at is null)
      $body$$fn$;
      revoke all on function public.team_has_position(text) from public,anon;
      grant execute on function public.team_has_position(text) to authenticated;
    end if;
  end $outer$;`);
  for (const path of attendanceEditingSources.slice(0, 3)) await sql(source(path));
  await sql(`drop view public.team_attendance_history;
    alter table team_attendance_private.history set schema public;
    alter table public.history rename to team_attendance_history;
    grant select on public.team_attendance_history to authenticated;
    create policy attendance_history_read on public.team_attendance_history for select to authenticated
      using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
  for (const path of attendanceEditingSources.slice(3)) await sql(source(path));
}
