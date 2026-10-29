// Byte-identical external migration sources, pinned in sources.json. Disposable
// local DB only. This is representative API boundary coverage, not a replay of
// every deployed Inventory/Pit feature or permission to deploy these fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
export const sharedSecurityManifest = 'tests/fixtures/shared-security/sources.json';
const upstream = JSON.parse(read(sharedSecurityManifest));
const inventorySecurityPath='tests/fixtures/shared-security/inventory-post-lock-security-baseline.json';
const inventorySecurity=JSON.parse(read(inventorySecurityPath));
const teamSources = [
  'supabase/migrations/202609100001_team_attendance.sql',
  'tests/fixtures/finance_v1.sql',
  'supabase/migrations/202609120003_team_management_positions.sql',
  'supabase/migrations/202609120007_team_management_v2.sql',
  'supabase/migrations/202609160001_notification_profile_and_role_guards.sql',
  'supabase/migrations/202610010002_team_invitation_display.sql',
  'supabase/migrations/20261007013837_lead_student_invitations.sql',
];
export const sharedSecuritySources = [sharedSecurityManifest, inventorySecurityPath, ...upstream.map(s => s.file), ...teamSources,
  'tests/fixtures/student-role-live-core.sql',
  'supabase/migrations/20261028160322_student_admin_lead_roles.sql',
  'tests/integration/shared-security-fixture.mjs', 'tests/integration/shared-security-stack.spec.mjs'];
export async function installSharedSecurityFixture(sql) {
  assert.equal(await sql("select coalesce(to_regclass('public.profiles')::text,'absent')"), 'absent', 'Refusing an existing application database');
  assert.equal(await sql('select count(*) from auth.users'), '0', 'Refusing a nonempty Auth database');
  for (const entry of upstream) {
    const source = read(entry.file);
    assert.equal(createHash('sha256').update(source).digest('hex'), entry.sha256, `Pinned upstream source changed: ${entry.file}`);
  }
  for (const entry of upstream.filter(e => e.file.includes('/inventory-') && !e.phase)) await sql(read(entry.file));
  for (const path of teamSources) await sql(read(path));
  for (const entry of upstream.filter(e => e.phase==='current')) await sql(read(entry.file));
  await sql(read('tests/fixtures/student-role-live-core.sql'));
  await sql(read('supabase/migrations/20261028160322_student_admin_lead_roles.sql'));
  for (const entry of upstream.filter(e => e.phase==='role')) {
    if(entry.file.endsWith('20261028170803_inventory_post_lock_authority.sql')){
      // Owned local Supabase supplies service_role default EXECUTE, unlike the
      // captured production ACL. Reproduce only these three exact baseline ACLs;
      // the candidate's full-body/owner/security drift guards remain unchanged.
      for(const f of inventorySecurity.functions){
        assert.match(f.signature,/^public\.[a-z_]+\([a-z ,]+\)$/);
        await sql(`revoke execute on function ${f.signature} from service_role`);
        const signature=f.signature.replaceAll("'","''");
        const actual=JSON.parse(await sql(`select jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'prosecdef',prosecdef,'provolatile',provolatile,'proconfig',proconfig) from pg_proc where oid='${signature}'::regprocedure`));
        const {signature:_,...expected}=f;assert.deepEqual(actual,expected,'Exact Inventory live security baseline');
      }
    }
    await sql(read(entry.file));
  }
  for (const entry of upstream.filter(e => e.file.includes('/pit-'))) await sql(read(entry.file));
  await sql("notify pgrst, 'reload schema';");
}
