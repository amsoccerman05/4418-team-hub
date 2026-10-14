// Current Attendance-only fixture for the owned empty real-Auth stack. No
// Fabrication/Edge/Storage test workload or unrelated app migration stack.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attendanceEditingSources, installAttendanceEditingFixture } from './attendance-editing-fixture.mjs';
import { attendanceAbuseSources } from './attendance-abuse-stack.spec.mjs';
const later = [
  '20261008063138_attendance_coach_request_review.sql',
  '20261008234849_attendance_active_meeting_roster_sync.sql',
  '20261009155227_attendance_automatic_absence_strikes.sql',
  '20261010144754_attendance_operations_lead_participation.sql',
  '20261011025742_attendance_required_roster_editing.sql',
].map(name => `supabase/migrations/${name}`);
export const attendanceSecuritySources = [...attendanceEditingSources, ...later, ...attendanceAbuseSources,
  'tests/integration/attendance-security-fixture.mjs', 'tests/integration/fabrication-prerequisites.sql'];
export async function installAttendanceSecurityFixture(sql) {
  const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  await sql(read('tests/integration/fabrication-prerequisites.sql'));
  await installAttendanceEditingFixture(sql);
  assert.equal(await sql('select count(*) from public.team_attendance_history'), '0', 'Only an empty Attendance fixture may be converted');
  await sql(`begin;
    drop trigger team_history_actor on public.team_attendance_history;
    alter table public.team_attendance_history drop column actor_auth_uid, drop column actor_database_session,
      drop column actor_database_role, alter column performed_by set not null;
    commit;`);
  for (const path of later) await sql(read(path));
}
