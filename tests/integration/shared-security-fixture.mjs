// Byte-identical external migration sources, pinned in sources.json. Disposable
// local DB only. This is representative API boundary coverage, not a replay of
// every deployed Inventory/Pit feature or permission to deploy these fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
export const sharedSecurityManifest = 'tests/fixtures/shared-security/sources.json';
const upstream = JSON.parse(read(sharedSecurityManifest));
const teamSources = [
  'supabase/migrations/202609100001_team_attendance.sql',
  'tests/fixtures/finance_v1.sql',
  'supabase/migrations/202609120003_team_management_positions.sql',
  'supabase/migrations/202609120007_team_management_v2.sql',
  'supabase/migrations/202609160001_notification_profile_and_role_guards.sql',
  'supabase/migrations/202610010002_team_invitation_display.sql',
  'supabase/migrations/20261007013837_lead_student_invitations.sql',
];
export const sharedSecuritySources = [sharedSecurityManifest, ...upstream.map(s => s.file), ...teamSources,
  'tests/integration/shared-security-fixture.mjs', 'tests/integration/shared-security-stack.spec.mjs'];
export async function installSharedSecurityFixture(sql) {
  assert.equal(await sql("select coalesce(to_regclass('public.profiles')::text,'absent')"), 'absent', 'Refusing an existing application database');
  assert.equal(await sql('select count(*) from auth.users'), '0', 'Refusing a nonempty Auth database');
  for (const entry of upstream) {
    const source = read(entry.file);
    assert.equal(createHash('sha256').update(source).digest('hex'), entry.sha256, `Pinned upstream source changed: ${entry.file}`);
  }
  for (const entry of upstream.filter(e => e.file.includes('/inventory-'))) await sql(read(entry.file));
  for (const path of teamSources) await sql(read(path));
  for (const entry of upstream.filter(e => e.file.includes('/pit-'))) await sql(read(entry.file));
  await sql("notify pgrst, 'reload schema';");
}
