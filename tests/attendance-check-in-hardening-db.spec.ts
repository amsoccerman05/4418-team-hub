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
  afterData = await snapshot();afterBoundary = await boundary();
  await root('update public.team_meeting_members set attempts=0,attempt_window=null');
});
test.beforeEach(async () => { await db.exec('begin'); });
test.afterEach(async () => { await db.exec('rollback;reset role'); });
test.afterAll(async () => { await db?.close(); });

test('migration changes only check-in implementation and preserves all data, RLS, grants, helpers and policy', async () => {
  expect(afterData).toEqual(beforeData);
  expect(afterBoundary).toEqual(beforeBoundary);
  const config = (await root("select prosecdef,proconfig from pg_proc where oid='public.team_attendance_check_in(uuid,text)'::regprocedure"))[0];
  expect(config).toMatchObject({ prosecdef: true, proconfig: ['search_path=""'] });
});

test('success records only self, consumes one attempt and retries do not rewrite attendance or audit', async () => {
  const other = await attendance(5);
  expect(await check()).toEqual(checked);
  const a = await attendance(), mm = await member();
  expect(a).toMatchObject({ physical_status: 'present', version: 2, student_id: id(3) });
  expect(a.checked_in_at).not.toBeNull();expect(mm.attempts).toBe(1);
  const before = await snapshot();
  expect(await check('000000')).toEqual(recorded);
  expect(await check(null)).toEqual(recorded);
  expect(await snapshot()).toEqual(before);expect(await attendance(5)).toEqual(other);
});

test('five invalid attempts commit their counters; sixth and correct code are indistinguishable locked-out denials', async () => {
  for (let n = 1; n <= 5; n++) {
    expect(await check('000000')).toEqual(invalid);
    expect((await member()).attempts).toBe(n);
  }
  const before = await snapshot(), mm = await member();
  const denied = await check('000000');
  expect(denied).toMatchObject(limited);
  expect(new Date(denied.retry_at).getTime()).toBe(new Date(mm.attempt_window).getTime() + 15 * 60_000);
  expect(await check('123456')).toEqual(denied);
  expect(await check(null)).toEqual(denied);
  expect(await snapshot()).toEqual(before);
});

test('fifth correct attempt succeeds and already-recorded takes precedence over the exhausted budget', async () => {
  await budget(4);
  expect(await check()).toEqual(checked);expect((await member()).attempts).toBe(5);
  const before = await snapshot();expect(await check()).toEqual(recorded);
  expect(await snapshot()).toEqual(before);
});

test('null, malformed, whitespace, Unicode and oversized codes each consume an attempt without a success signal', async () => {
  for (const code of [null, '', '12345', '1234567', ' 123456', '123456 ', '１２３４５６', '12345\n', '0'.repeat(100_000)]) {
    await budget(0);
    expect(await check(code)).toEqual(invalid);expect((await member()).attempts).toBe(1);
    expect((await attendance()).checked_in_at).toBeNull();
  }
});

test('the six-digit workflow accepts a leading-zero code', async () => {
  await root("update public.team_meetings set code_hash=sha256(convert_to(id::text||'001234','UTF8')) where id=$1", [mid]);
  expect(await check('001234')).toEqual(checked);
});

test('the 15-minute window resets only when expired or unset', async () => {
  await budget(5, '14 minutes 59 seconds');
  expect(await check()).toMatchObject(limited);expect((await member()).attempts).toBe(5);
  await budget(5, '15 minutes 1 second');
  const before = Date.now();expect(await check('000000')).toEqual(invalid);
  const mm = await member();expect(mm.attempts).toBe(1);
  expect(new Date(mm.attempt_window).getTime()).toBeGreaterThanOrEqual(before - 1000);
  await root('update public.team_meeting_members set attempts=5,attempt_window=null where meeting_id=$1 and student_id=$2', [mid, id(3)]);
  expect(await check()).toEqual(checked);expect((await member()).attempts).toBe(1);
});

test('attempt budgets are independent per member and per meeting', async () => {
  await budget(5);
  expect(await check()).toMatchObject(limited);
  expect(await check('123456', 5)).toEqual(checked);
  const otherMeeting = await create(), code = (await open(otherMeeting)).code;
  expect(await check(code, 3, otherMeeting)).toEqual(checked);
  expect((await member()).attempts).toBe(5);
});

test('rotation changes the code, preserves every attempt window, and does not unlock a caller', async () => {
  await budget(5);await budget(2, '2 minutes', 5);
  const mm = await member(), other = await member(5);
  const rotated = await open();expect(rotated.code).toMatch(/^\d{6}$/);expect(rotated.code).not.toBe('123456');
  expect(await member()).toEqual(mm);expect(await member(5)).toEqual(other);
  expect(await check(rotated.code)).toMatchObject(limited);
  expect(await check('123456', 5)).toEqual(invalid);
  expect(await check(rotated.code, 5)).toEqual(checked);
  const m = (await root('select code_expires_at,ends_at from public.team_meetings where id=$1', [mid]))[0];
  expect(new Date(m.code_expires_at).getTime()).toBeLessThanOrEqual(new Date(m.ends_at).getTime());
  expect(new Date(m.code_expires_at).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
});

test('already-recorded statuses are never overwritten or charged even with an exhausted budget', async () => {
  await budget(5);
  for (const physical of ['present', 'late', 'left_early', 'absent']) {
    await root('update public.team_attendance set physical_status=$3 where meeting_id=$1 and student_id=$2', [mid, id(3), physical]);
    const before = await snapshot();expect(await check('000000')).toEqual(recorded);
    expect(await snapshot()).toEqual(before);
  }
  await root("update public.team_attendance set physical_status='pending',checked_in_at=clock_timestamp() where meeting_id=$1 and student_id=$2", [mid, id(3)]);
  expect(await check(null)).toEqual(recorded);
});

for (const state of ['expired', 'missing_expiry', 'ended', 'too_early', 'closed', 'finalized'] as const) test(`${state} meeting fails closed before any code comparison or budget change`, async () => {
  const changes = {
    expired: "code_expires_at=clock_timestamp()-interval '1 second'",
    missing_expiry: "code_expires_at=null",
    ended: "starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 second'",
    too_early: "starts_at=clock_timestamp()+interval '31 minutes',ends_at=clock_timestamp()+interval '2 hours'",
    closed: "check_in_open=false,status='closed'",
    finalized: "check_in_open=false,status='finalized'",
  };
  await root(`update public.team_meetings set ${changes[state]} where id=$1`, [mid]);
  for (const exhausted of [false, true]) {
    if (exhausted) await budget(5);
    const before = await snapshot();await rejects(() => check(), /Check-in is closed or the code expired/);
    expect(await snapshot()).toEqual(before);
  }
});

test('existing student, lead, Program Manager and Operations Lead participation is preserved', async () => {
  for (const actor of [2, 3, 4, 9, 10, 20, 21]) {
    expect(await check('123456', actor)).toEqual(checked);
    expect((await attendance(actor)).checked_in_at).not.toBeNull();
  }
  for (const actor of [1, 6, 7, 8, 22, 23, 24, null]) {
    await rejects(() => check('123456', actor), /Active Attendance participant required/);
  }
});

test('deactivated accounts, revoked positions and inactive positions cannot use correct codes or the throttle path', async () => {
  await budget(5, '1 minute', 3);await budget(5, '1 minute', 20);await budget(5, '1 minute', 9);
  await root('update public.profiles set active=false where id=$1', [id(3)]);
  await root('update public.team_member_positions set revoked_at=clock_timestamp() where user_id=$1', [id(20)]);
  await root("update public.team_positions set active=false where key='program_manager'");
  for (const actor of [3, 20, 9]) await rejects(() => check('123456', actor), /Active Attendance participant required/);
  expect((await member()).attempts).toBe(5);expect((await attendance()).checked_in_at).toBeNull();
});

test('a valid active account without this roster cannot check in', async () => {
  await root('insert into public.profiles values($1,$2,$3,true)', [id(30), 'Synthetic new student', 'student']);
  const before = await snapshot();await rejects(() => check('123456', 30), /not on this meeting roster/);
  expect(await snapshot()).toEqual(before);
  await rejects(() => check('123456', 3, id(999)), /Check-in is closed or the code expired/);
  expect(await snapshot()).toEqual(before);
});

test('missing attendance fails closed even when an eligible roster and correct code exist', async () => {
  await root('delete from public.team_attendance where meeting_id=$1 and student_id=$2', [mid, id(3)]);
  for (const exhausted of [false, true]) {
    if (exhausted) await budget(5);
    const before = await snapshot();await rejects(() => check(), /not on this meeting roster/);
    expect(await snapshot()).toEqual(before);
  }
});

test('the existing 30-minute admission and five-minute late grace remain in force', async () => {
  await root("update public.team_meetings set starts_at=clock_timestamp()+interval '29 minutes' where id=$1", [mid]);
  expect(await check()).toEqual(checked);expect((await attendance()).physical_status).toBe('present');
  await root("update public.team_meetings set starts_at=clock_timestamp()-interval '4 minutes' where id=$1", [mid]);
  expect(await check('123456', 5)).toEqual(checked);expect((await attendance(5)).physical_status).toBe('present');
  await root("update public.team_meetings set starts_at=clock_timestamp()-interval '5 minutes 1 second' where id=$1", [mid]);
  expect(await check('123456', 2)).toEqual(checked);expect((await attendance(2)).physical_status).toBe('late');
});

test('anonymous execution, code-hash reads, direct mutations and private predicate calls remain denied', async () => {
  await as(3);
  for (const query of [
    'select code_hash from public.team_meetings',
    "update public.team_meeting_members set attempts=0,attempt_window=null",
    "update public.team_attendance set checked_in_at=clock_timestamp(),physical_status='present'",
    "insert into public.team_attendance(meeting_id,student_id) values($1,$2)",
    "select team_attendance_private.is_participant(auth.uid())",
  ]) {
    await rejects(() => db.query(query, query.includes('$') ? [mid, id(3)] : []), /permission denied/);
  }
  await rejects(async () => {
    await db.exec('reset role;set role anon');
    return db.query('select public.team_attendance_check_in($1,$2)', [mid, '123456']);
  }, /permission denied/);
  const args = (await root("select pronargs from pg_proc where oid='public.team_attendance_check_in(uuid,text)'::regprocedure"))[0];
  expect(args.pronargs).toBe(2);
});

test('a queued burst admits only five guesses and no writes after the budget is exhausted', async () => {
  await as(3);
  const results = await Promise.all(Array.from({ length: 20 }, () => db.query<any>('select public.team_attendance_check_in($1,$2) r', [mid, '000000'])));
  const receipts = results.map(r => r.rows[0].r);
  expect(receipts.filter(r => r.status === 'invalid_code')).toHaveLength(5);
  expect(receipts.filter(r => r.status === 'rate_limited')).toHaveLength(15);
  expect(new Set(receipts.filter(r => r.retry_at).map(r => r.retry_at)).size).toBe(1);
  expect((await member()).attempts).toBe(5);expect((await attendance()).checked_in_at).toBeNull();
});

test('a queued success burst is idempotent and records one attempt and one attendance update', async () => {
  const beforeAudit = (await root("select count(*)::int n from public.team_attendance_history where entity='team_attendance' and student_id=$1", [id(3)]))[0].n;
  await as(3);
  const results = await Promise.all(Array.from({ length: 12 }, () => db.query<any>('select public.team_attendance_check_in($1,$2) r', [mid, '123456'])));
  const receipts = results.map(r => r.rows[0].r);
  expect(receipts.filter(r => r.status === 'checked_in')).toHaveLength(1);
  expect(receipts.filter(r => r.status === 'already_recorded')).toHaveLength(11);
  expect((await member()).attempts).toBe(1);expect((await attendance()).version).toBe(2);
  const audit = (await root("select * from public.team_attendance_history where entity='team_attendance' and student_id=$1 order by id", [id(3)]));
  expect(audit).toHaveLength(beforeAudit + 1);expect(audit.at(-1).performed_by).toBe(id(3));
});


test('an open meeting with a missing code hash never admits any code or changes attendance', async () => {
  await root('update public.team_meetings set code_hash=null where id=$1', [mid]);
  const before = await attendance();
  for (let attempts = 1; attempts <= 5; attempts++) {
    expect(await check('123456')).toEqual(invalid);
    expect((await member()).attempts).toBe(attempts);
    expect(await attendance()).toEqual(before);
  }
  const exhausted = await snapshot();
  expect(await check('123456')).toMatchObject(limited);
  expect(await snapshot()).toEqual(exhausted);
});
