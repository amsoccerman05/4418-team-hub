// Exact released schema and candidate migrations in an OWNED empty local stack.
// This is test-only composition, never a production installer. Real Auth and
// Storage are supplied by Supabase; no authorization helpers are stubbed here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = name => `supabase/migrations/${name}.sql`;
export const sharedSecurityManifest = 'tests/fixtures/shared-security/sources.json';
const upstream = JSON.parse(read(sharedSecurityManifest));
const inventorySecurityPath='tests/fixtures/shared-security/inventory-post-lock-security-baseline.json';
const inventorySecurity=JSON.parse(read(inventorySecurityPath));
const securityPinsPath='tests/fixtures/shared-security/canonical-baseline-security.json';
const securityPins=JSON.parse(read(securityPinsPath));
const corePinsPath='tests/fixtures/canonical-role-core-pins.json';
const modulePinsPath='tests/fixtures/canonical-workflow-definition-pins.json';
const corePins=JSON.parse(read(corePinsPath));
const modulePins=JSON.parse(read(modulePinsPath)).functions;
const coreMigration=migration('20261029190339_canonical_roles_mentor_administration');
const moduleMigration=migration('20261029190442_canonical_roles_workflow_boundaries');
const initial = [
 migration('202609100001_team_attendance'), 'tests/fixtures/finance_v1.sql',
 migration('202609120003_team_management_positions'), migration('202609120005_hub_dashboard_announcements'),
 'tests/fixtures/finance_notifications.sql', migration('202609120006_team_communications'),
 migration('202609120001_attendance_requests_recurrence'),
];
const afterAudit = [
 'tests/fixtures/attendance-production-functions.sql',migration('202609300001_attendance_policy_v03'),
 'tests/fixtures/finance_notification_coverage.sql',migration('202610050001_notification_center'),
 ...['20261008032037_attendance_program_manager_mentor_review','20261008032108_attendance_program_manager_notification_routing','20261008051847_attendance_program_manager_participation','20261008063138_attendance_coach_request_review',
 '202609120007_team_management_v2','202609160001_notification_profile_and_role_guards','202610010002_team_invitation_display','20261007013837_lead_student_invitations','20261007033053_attendance_meeting_editing','20261015071925_frc_2027_kickoff_reset'].map(migration),
 'tests/fixtures/student-role-live-core.sql','tests/fixtures/student-role-live-attendance.sql',
 ...['202609200001_finance_budget_core','202609200002_finance_workbook','20261005235435_finance_repair_po_links','20261007011342_allow_all_active_student_purchase_requests','20261018051306_finance_notification_delivery_authorization','20261027204114_finance_po_received','20261028033326_finance_po_actionability'].map(n=>`tests/fixtures/finance-candidate/${n}.sql`),
 ...['20261009155227_attendance_automatic_absence_strikes','20261014052049_attendance_stem_outreach','20261014174641_attendance_notice_copy','20261018051317_attendance_legacy_notice_validation'].map(migration),
 'tests/fixtures/student-role-live-attendance.sql',migration('20261028160322_student_admin_lead_roles'),
 'tests/fixtures/finance-candidate/20261028160500_finance_student_roles_readonly_privacy.sql',
 migration('20261028160734_admin_lead_attendance_and_notices'),migration('20261028162931_coach_own_step_hub_counts'),
];
const latestAttendance = ['20261014034212_attendance_check_in_hardening','20261014051116_attendance_checkout_grace','20261028001414_attendance_automatic_roster_membership'].map(migration);
const modules = ['202610020001_planning_v1','202610030001_planning_task_dependencies','202610040001_planning_task_assignees','20261018051320_planning_current_writer_guard','20261006045839_sponsor_outreach_v1','20261006061729_season_goals_v1','20261006073717_sprint_review_v1','20261006201639_fabrication_v1','20261006213850_assembly_testing_v1','20261006235739_sprint_review_design_decisions_v1','20261007155231_mentor_volunteer_hours'].map(migration);
export const sharedSecuritySources = [...new Set([sharedSecurityManifest, inventorySecurityPath, securityPinsPath, corePinsPath,modulePinsPath, ...upstream.map(s=>s.file),...initial,...afterAudit,...latestAttendance,...modules,
 migration('20261028160521_admin_lead_workflow_compatibility'),coreMigration,moduleMigration,
 'tests/integration/shared-security-catalog.sql','tests/integration/shared-security-fixture.mjs','tests/integration/shared-security-stack.spec.mjs'])];
const literal=s=>`'${s.replaceAll("'","''")}'`;
async function normalizeACL(sql,pin){
 const sig=pin.schema==='public'&&!pin.signature.startsWith('public.')?`public.${pin.signature}`:pin.signature;
 assert.match(sig,/^[a-z_]+\.[a-z_0-9]+\([a-z_.0-9 ,\[\]]*\)$/);
 await sql(`revoke all on function ${sig} from public,anon,authenticated,service_role`);
 for(const role of ['authenticated','service_role'])if(pin.acl?.includes(role+'=X'))await sql(`grant execute on function ${sig} to ${role}`);
}
export async function installSharedSecurityFixture(sql) {
 assert.equal(await sql("select coalesce(to_regclass('public.profiles')::text,'absent')"),'absent','Refusing an existing application database');
 assert.equal(await sql('select count(*) from auth.users'),'0','Refusing a nonempty Auth database');
 for(const entry of upstream)assert.equal(createHash('sha256').update(read(entry.file)).digest('hex'),entry.sha256,`Pinned source changed: ${entry.file}`);
 for(const entry of upstream.filter(e=>e.file.includes('/inventory-')&&!e.phase))await sql(read(entry.file));
 for(const entry of upstream.filter(e=>e.file.includes('/pit-')&&!e.phase))await sql(read(entry.file));
 for(const path of initial)await sql(read(path));
 // Exact legacy deployed audit shape, confined to this empty synthetic database.
 assert.equal(await sql('select count(*) from team_attendance_private.history'),'0');
 await sql(`drop view public.team_attendance_history;alter table team_attendance_private.history set schema public;alter table public.history rename to team_attendance_history;drop trigger team_history_actor on public.team_attendance_history;alter table public.team_attendance_history drop column actor_auth_uid,drop column actor_database_session,drop column actor_database_role,alter column performed_by set not null;grant select on team_attendance_history to authenticated;create policy attendance_history_read on team_attendance_history for select to authenticated using(team_attendance_private.manager() or student_id=auth.uid());`);
 for(const path of afterAudit)await sql(read(path));
 for(const path of latestAttendance)await sql(read(path));
 for(const path of modules)await sql(read(path));
 // Only exact reviewed baseline ACLs are normalized. The candidate's complete
 // function/body/owner/ACL/security guards remain enabled and execute unchanged.
 await sql('revoke execute on function planning_private.context(uuid,boolean),planning_private.manager(),public.planning_save(text,jsonb) from service_role');
 await sql(read(migration('20261028160521_admin_lead_workflow_compatibility')));
 for(const entry of upstream.filter(e=>e.phase==='current'))await sql(read(entry.file));
 for(const entry of upstream.filter(e=>e.phase==='role')){
  if(entry.file.endsWith('20261028170803_inventory_post_lock_authority.sql'))for(const f of inventorySecurity.functions){
   await sql(`revoke execute on function ${f.signature} from service_role`);
   const actual=JSON.parse(await sql(`select jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'prosecdef',prosecdef,'provolatile',provolatile,'proconfig',proconfig) from pg_proc where oid=${literal(f.signature)}::regprocedure`));
   const {signature:_,...expected}=f;assert.deepEqual(actual,expected,'Exact Inventory live security baseline');
  }
  await sql(read(entry.file));
 }
 for(const entry of upstream.filter(e=>e.phase==='pit-current')){
  if(entry.file.endsWith('20261028160506_pit_admin_lead_role_adapter.sql')){
   // Native Supabase default EXECUTE differs from captured production. Restore
   // only the eight ACLs pinned by this exact old adapter, retaining body guards.
   for(const match of read(entry.file).matchAll(/to_regprocedure\('([^']+)'\).*?proacl::text='([^']+)'/g))await normalizeACL(sql,{signature:match[1],acl:match[2]});
  }
  await sql(read(entry.file));
 }
 // Pin overlays are captured deployed definitions, not mock permission helpers.
 // They bridge historical fixture source files to the exact reviewed live core.
 for(const pin of corePins){await sql(pin.definition);await normalizeACL(sql,pin);}
 for(const pin of modulePins)await normalizeACL(sql,pin);
 for(const pin of securityPins)await normalizeACL(sql,pin);
 await sql("notify pgrst, 'reload schema'");
}
export async function applySharedCanonicalFixture(sql){
 const source=read(coreMigration);
 const digest=await sql(`select encode(sha256(convert_to(id::text||'|'||to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'UTF8')),'hex') from profiles where role='admin'`);
 assert.match(digest,/^[0-9a-f]{64}$/,'Exactly one synthetic legacy account is required');
 const productionDigest=source.match(/'([0-9a-f]{64})' then raise exception 'Confirmed legacy account/)?.[1];
 assert(productionDigest,'Production one-account/version guard must remain in source');
 // Synthetic identity/version substitution ONLY. No preflight, ACL, role or
 // last-Mentor guard is removed. This modified text is never exported/deployed.
 await sql(source.replace(productionDigest,digest));
 const candidates=upstream.filter(e=>e.phase==='canonical').sort((a,b)=>a.source_path.localeCompare(b.source_path));
 assert.equal(candidates.length,3);
 for(const entry of candidates)await sql(read(entry.file));
 await sql(read(moduleMigration));
 await sql("notify pgrst, 'reload schema'");
}
export const sharedCanonicalCatalog = sql=>sql(read('tests/integration/shared-security-catalog.sql'));
