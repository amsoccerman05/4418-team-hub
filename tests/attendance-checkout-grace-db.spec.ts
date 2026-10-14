import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Synthetic, in-memory PostgreSQL only. No Supabase connection or live data.
// PGlite serializes submitted queries; real lock contention is tested separately
// by tests/native/attendance-abuse-concurrency.mjs.
test.describe.configure({ mode: 'serial' });
let db: PGlite;
let mid: string;
let beforeData: any, afterData: any, beforeBoundary: any, afterBoundary: any;
const migration = 'supabase/migrations/20261014034212_attendance_check_in_hardening.sql';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const source = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8');
const invalid = { status: 'invalid_code', error: 'Invalid meeting code' };
const limited = { status: 'rate_limited', error: 'Too many attempts. Try again in 15 minutes or contact leadership.' };
const checked = { status: 'checked_in', message: 'Checked in' };
const recorded = { status: 'already_recorded', message: 'Attendance already recorded' };

async function as(n: number | null) {
  await db.exec(`reset role;select set_config('test.uid','${n === null ? '' : id(n)}',false);set role authenticated;`);
}
async function root(query: string, params: any[] = []) {
  await db.exec(`reset role;select set_config('test.uid','${id(1)}',false);`);
  return (await db.query<any>(query, params)).rows;
}
async function rejects(run: () => Promise<unknown>, pattern: RegExp) {
  await db.exec('savepoint expected_denial');
  try { await expect(run()).rejects.toThrow(pattern); }
  finally { await db.exec('rollback to savepoint expected_denial;release savepoint expected_denial'); }
}
async function check(code: string | null = '123456', actor: number | null = 3, meeting = mid) {
  await as(actor);
  return (await db.query<any>('select public.team_attendance_check_in($1,$2) r', [meeting, code])).rows[0].r;
}
async function member(actor = 3, meeting = mid) {
  return (await root('select * from public.team_meeting_members where meeting_id=$1 and student_id=$2', [meeting, id(actor)]))[0];
}
async function attendance(actor = 3, meeting = mid) {
  return (await root('select * from public.team_attendance where meeting_id=$1 and student_id=$2', [meeting, id(actor)]))[0];
}
async function budget(attempts: number, age = '1 minute', actor = 3, meeting = mid) {
  await root('update public.team_meeting_members set attempts=$3,attempt_window=clock_timestamp()-$4::interval where meeting_id=$1 and student_id=$2', [meeting, id(actor), attempts, age]);
}
async function manage(action: string, payload: any) {
  await as(1);
  return (await db.query<any>('select public.team_attendance_manage($1,$2::jsonb) r', [action, JSON.stringify(payload)])).rows[0].r;
}
async function create() {
  return (await manage('create', { title: 'Synthetic check-in security test', meeting_type: 'preseason', requirement: 'active', starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString() })).id;
}
async function open(meeting = mid) {
  const m = (await root('select version from public.team_meetings where id=$1', [meeting]))[0];
  return manage('open', { meeting_id: meeting, version: m.version });
}
async function snapshot() {
  return (await root(`select jsonb_build_object(
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from profiles t),
    'positions',(select jsonb_agg(to_jsonb(t) order by key) from team_positions t),
    'assignments',(select jsonb_agg(to_jsonb(t) order by user_id,position_key) from team_member_positions t),
    'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),
    'meetings',(select jsonb_agg(to_jsonb(t) order by id) from team_meetings t),
    'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),
    'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t),
    'strikes',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_strikes t)) r`))[0].r;
}
async function boundary() {
  return (await root(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'grants',p.proacl::text,
      'definition',case when p.oid='public.team_attendance_check_in(uuid,text)'::regprocedure then null else pg_get_functiondef(p.oid) end,
      'security_definer',p.prosecdef,'config',p.proconfig) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','team_attendance_private')),
    'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'grants',c.relacl::text,'rls',c.relrowsecurity) order by c.oid)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','v') and n.nspname in ('public','team_attendance_private')),
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p)) r`))[0].r;
}

test.beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into profiles values
      ('${id(1)}','Synthetic Mentor','mentor',true),('${id(2)}','Synthetic Lead','lead',true),
      ('${id(3)}','Synthetic Student','student',true),('${id(4)}','Synthetic Student PM','student',true),
      ('${id(5)}','Synthetic Other Student','student',true),('${id(6)}','Synthetic Admin','admin',true),
      ('${id(7)}','Synthetic Inactive Lead','lead',false),('${id(8)}','Synthetic Readonly','readonly',true),
      ('${id(9)}','Synthetic Mentor PM','mentor',true),('${id(10)}','Synthetic Admin PM','admin',true),
      ('${id(20)}','Synthetic Admin Operations Lead','admin',true),('${id(21)}','Synthetic Mentor Operations Lead','mentor',true),
      ('${id(22)}','Synthetic Revoked Operations Lead','admin',true),('${id(23)}','Synthetic Inactive Operations Lead','admin',false),
      ('${id(24)}','Synthetic Readonly Operations Lead','readonly',true);
    create table team_positions(key text primary key,name text,active boolean);
    insert into team_positions values('program_manager','Program Manager',true),('operations_lead','Operations Lead',true);
    create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    insert into team_member_positions values
      ('${id(4)}','program_manager',null),('${id(9)}','program_manager',null),('${id(10)}','program_manager',null),
      ('${id(20)}','operations_lead',null),('${id(21)}','operations_lead',null),
      ('${id(22)}','operations_lead',now()),('${id(23)}','operations_lead',null),('${id(24)}','operations_lead',null);
    create function public.team_has_position(key text) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.team_member_positions mp join public.team_positions p on p.key=mp.position_key and p.active
      join public.profiles u on u.id=mp.user_id and u.active and u.role in ('student','lead','mentor','admin')
      where mp.user_id=auth.uid() and mp.position_key=$1 and mp.revoked_at is null) $$;
    select set_config('test.uid','${id(1)}',false);`);
  for (const file of ['202609100001_team_attendance.sql', '202609120001_attendance_requests_recurrence.sql', '202609120008_attendance_roster_sync.sql']) await db.exec(source(file));
  // Match production's public audit table with a required, genuine profile actor.
  await db.exec(`drop view team_attendance_history;
    alter table team_attendance_private.history set schema public;
    alter table public.history rename to team_attendance_history;
    drop trigger team_history_actor on public.team_attendance_history;
    alter table public.team_attendance_history drop column actor_auth_uid,drop column actor_database_session,drop column actor_database_role,alter column performed_by set not null;
    grant select on team_attendance_history to authenticated;
    create policy attendance_history_read on team_attendance_history for select to authenticated
      using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
  await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql', 'utf8'));
  for (const file of [
    '202609300001_attendance_policy_v03.sql',
    '20261007033053_attendance_meeting_editing.sql',
    '20261008032037_attendance_program_manager_mentor_review.sql',
    '20261008051847_attendance_program_manager_participation.sql',
    '20261008063138_attendance_coach_request_review.sql',
    '20261008234849_attendance_active_meeting_roster_sync.sql',
    '20261009155227_attendance_automatic_absence_strikes.sql',
    '20261010144754_attendance_operations_lead_participation.sql',
    '20261011025742_attendance_required_roster_editing.sql',
  ]) await db.exec(source(file));
  mid = await create();
  await open();
  await root("update public.team_meetings set code_hash=sha256(convert_to(id::text||'123456','UTF8')) where id=$1", [mid]);
  // Existing nonzero counters must survive deployment unchanged.
  await budget(2);
  beforeData = await snapshot();beforeBoundary = await boundary();
  await db.exec(readFileSync(migration, 'utf8'));
  await db.exec(source('20261014051116_attendance_checkout_grace.sql'));
  afterData = await snapshot();afterBoundary = await boundary();
  await root('update public.team_meeting_members set attempts=0,attempt_window=null');
});
test.beforeEach(async () => { await db.exec('begin'); });
test.afterEach(async () => { await db.exec('rollback;reset role'); });
test.afterAll(async () => { await db?.close(); });


async function checkout(actor=3) { await as(actor); return (await db.query<any>('select team_attendance_check_out($1) r',[mid])).rows[0].r; }
async function recordCheckIn(status='present') { await root("update team_attendance set checked_in_at=clock_timestamp()-interval '10 minutes',physical_status=$2 where meeting_id=$1 and student_id=$3",[mid,status,id(3)]); }
async function ended(minutes=5,status='closed') { await root("update team_meetings set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-($2::text||' minutes')::interval,status=$3 where id=$1",[mid,minutes,status]); }
test('migration preserves existing data and check-in security implementation',async()=>{
 expect(afterData).toEqual(beforeData);
 const a=beforeBoundary.functions.find((f:any)=>f.name==='team_attendance_check_in');
 const b=afterBoundary.functions.find((f:any)=>f.name==='team_attendance_check_in');
 expect(b).toEqual(a);
 expect(afterBoundary.tables).toEqual(beforeBoundary.tables);expect(afterBoundary.policies).toEqual(beforeBoundary.policies);
});
for(const state of ['open','closed','finalized']) for(const status of ['present','late']) test(`real departure five minutes after scheduled end: ${state}, ${status}`,async()=>{
 await recordCheckIn(status);await ended(5,state);const before=await attendance();
 await checkout();const after=await attendance();expect(after.left_at).not.toBeNull();expect(after.physical_status).toBe(status);expect(after.checked_in_at).toEqual(before.checked_in_at);expect(after.review_status).toBe(before.review_status);expect(after.version).toBe(before.version+1);
 expect(Date.now()-Date.parse(after.left_at)).toBeLessThan(5000);
 expect((await root('select count(*)::int n from team_attendance_strikes'))[0].n).toBe(0);
 const audit=await root("select performed_by from team_attendance_history where entity_id=$1 and after_data->>'left_at' is not null",[after.id]);expect(audit).toHaveLength(1);expect(audit[0].performed_by).toBe(id(3));
 await checkout();expect(await attendance()).toEqual(after);
});
test('before-end departure remains Left Early; retry after grace never rewrites it',async()=>{
 await recordCheckIn();await checkout();const after=await attendance();expect(after.physical_status).toBe('left_early');await ended(31,'finalized');await checkout();expect(await attendance()).toEqual(after);
});
test('exact end is allowed; 30-minute boundary is closed and leaves records untouched',async()=>{
 await recordCheckIn();await ended(30,'finalized');const before=await attendance();await rejects(()=>checkout(),/30 minutes/);expect(await attendance()).toEqual(before);
 await ended(0,'finalized');await checkout();expect((await attendance()).physical_status).toBe('present');
});
test('anonymous, inactive, unrostered and unchecked-in callers remain blocked',async()=>{
 await recordCheckIn();await ended(5,'finalized');
 await rejects(()=>checkout(null as any),/participant/);await rejects(()=>checkout(7),/participant/);
 await rejects(()=>checkout(5),/Check in before/);
 await root('delete from team_attendance where meeting_id=$1 and student_id=$2',[mid,id(5)]);await rejects(()=>checkout(5),/roster/);
 await as(3);await db.exec('reset role;set role anon');await rejects(()=>db.query('select team_attendance_check_out($1)',[mid]),/permission denied/);
});
test('completion does not reopen check-in, notices or other finalized student records',async()=>{
 await recordCheckIn();await ended(5,'finalized');await rejects(()=>check('123456',5),/closed/);
 await as(3);await rejects(()=>db.query("select team_attendance_notice($1,'late reason')",[mid]),/finalized meeting/);
});
test('audit failure rolls back departure atomically',async()=>{
 await recordCheckIn();await ended(5,'finalized');const before=await attendance();await db.exec(`reset role;create function fail_departure_audit() returns trigger language plpgsql as $$begin if new.after_data->>'left_at' is not null then raise exception 'Audit unavailable';end if;return new;end $$;create trigger fail_departure_audit before insert on team_attendance_history for each row execute function fail_departure_audit();`);
 await rejects(()=>checkout(),/Audit unavailable/);expect(await attendance()).toEqual(before);
});
