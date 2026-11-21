import {readFileSync} from 'node:fs';
import {noticesBaseline} from './student-role-notices.ts';
import type {PGlite} from '@electric-sql/pglite';
export const canonicalCoreFile='supabase/migrations/20261029190339_canonical_roles_mentor_administration.sql';
export const canonicalPins=JSON.parse(readFileSync('tests/fixtures/canonical-role-core-pins.json','utf8'));
export const fixtureId=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
/** Actual released core/Finance/Attendance stack, with exact current catalog overlays.
 * Only the reviewed production identity/version digest is replaced for synthetic data.
 * This is never a production invocation or an authority stub. */
export async function canonicalBaseline(installedDb?:PGlite){
 const db=await noticesBaseline(true,installedDb);
 for(const file of ['20261009155227_attendance_automatic_absence_strikes.sql','20261014052049_attendance_stem_outreach.sql','20261014174641_attendance_notice_copy.sql','20261018051317_attendance_legacy_notice_validation.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(readFileSync('tests/fixtures/student-role-live-attendance.sql','utf8'));
 for(const file of ['supabase/migrations/20261028160322_student_admin_lead_roles.sql','tests/fixtures/finance-candidate/20261028160500_finance_student_roles_readonly_privacy.sql','supabase/migrations/20261028160734_admin_lead_attendance_and_notices.sql','supabase/migrations/20261028162931_coach_own_step_hub_counts.sql'])await db.exec(readFileSync(file,'utf8'));
 for(const pin of canonicalPins){
  await db.exec(pin.definition);
  // Fresh local CREATE defaults are not deployed ACLs. Normalize only this test
  // fixture to the catalog's exact existing explicit owner/authenticated grants.
  const sig=pin.schema==='public'?`public.${pin.signature}`:pin.signature;
  await db.exec(`revoke all on function ${sig} from public,anon,authenticated,service_role;`);
  for(const role of ['authenticated','service_role'])if(pin.acl.includes(role+'=X'))await db.exec(`grant execute on function ${sig} to ${role}`);
 }
 await db.exec('create trigger guard_profile before update on profiles for each row execute function private.guard_profile()');
 return db;
}
export async function syntheticCanonicalMigration(db:PGlite){
 const sql=readFileSync(canonicalCoreFile,'utf8');
 const {rows}=await db.query<{digest:string}>(`select encode(sha256(convert_to(id::text||'|'||to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'UTF8')),'hex') digest from profiles where role='admin'`);
 if(rows.length!==1)throw Error('Synthetic baseline needs one legacy account');
 const needle=sql.match(/'([0-9a-f]{64})' then raise exception 'Confirmed legacy account/)?.[1];
 if(!needle)throw Error('Missing production digest guard');
 return sql.replace(needle,rows[0].digest);
}
