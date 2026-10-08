import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Synthetic identities only; the production-shaped audit table deliberately has
// ten columns, a required profile actor, and no supplementary attribution trigger.
const migration = 'supabase/migrations/20261008063138_attendance_coach_request_review.sql';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;
let mid: string;
let beforeMigration: unknown;
let legacyDefinitions: unknown;
async function as(n: number) {
  await db.exec(`reset role; select set_config('test.uid','${id(n)}',false); set role authenticated;`);
}
async function manage(action: string, p: Record<string, unknown>) {
  return (await db.query<any>('select team_attendance_manage($1,$2::jsonb) r', [action, JSON.stringify(p)])).rows[0].r;
}
async function row(n = 3) {
  return (await db.query<any>('select * from team_attendance where meeting_id=$1 and student_id=$2', [mid, id(n)])).rows[0];
}
async function context() {
  return (await db.query<any>('select team_attendance_policy_context() c')).rows[0].c;
}
async function request(n = 3, kind = 'absent') {
  await as(n);
  const attendance = await row(n);
  await db.query('select team_attendance_request($1::jsonb)', [JSON.stringify({
    meeting_id: mid, version: attendance.version, notice_type: kind, reason: 'Synthetic request',
    expected_at: kind === 'absent' ? null : new Date(Date.now() + 49 * 3600000).toISOString(),
  })]);
  return row(n);
}
function decision(attendance: any, extra: Record<string, unknown> = {}) {
  return { meeting_id: mid, attendance_id: attendance.id, version: attendance.version,
    review_status: 'excused', explanation: 'Independent synthetic review', ...extra };
}
async function snapshot() {
  await db.exec('reset role');
  return (await db.query<any>(`select jsonb_build_object(
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from profiles t),
    'positions',(select jsonb_agg(to_jsonb(t) order by key) from team_positions t),
    'assignments',(select jsonb_agg(to_jsonb(t) order by user_id,position_key) from team_member_positions t),
    'meetings',(select jsonb_agg(to_jsonb(t) order by id) from team_meetings t),
    'snapshots',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),
    'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),
    'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t)) s`)).rows[0].s;
}
async function legacy() {
  return (await db.query(`select pg_get_functiondef(p.oid) definition from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='team_attendance_private'
    and p.proname in ('reviewer','reader','manager') order by p.proname`)).rows;
}

test.beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into profiles values
      ('${id(1)}','Ordinary mentor','mentor',true),('${id(2)}','Coach One','mentor',true),
      ('${id(3)}','Student','student',true),('${id(4)}','Coach Two','mentor',true),
      ('${id(5)}','Program Manager','mentor',true),('${id(6)}','Peer PM','mentor',true),
      ('${id(7)}','Admin','admin',true),('${id(8)}','Lead','lead',true),
      ('${id(9)}','Inactive coach','mentor',false),('${id(10)}','Revoked coach','mentor',true),
      ('${id(11)}','Readonly coach','readonly',true),('${id(12)}','Admin coach','admin',true),
      ('${id(13)}','Lead coach','lead',true),('${id(14)}','Student coach','student',true),
      ('${id(15)}','Dual coach PM','mentor',true),('${id(16)}','Student PM','student',true),
      ('${id(17)}','Lead PM','lead',true),('${id(18)}','Admin PM','admin',true),
      ('${id(19)}','Inactive PM','mentor',false),('${id(20)}','Revoked PM','mentor',true),
      ('${id(21)}','Readonly PM','readonly',true),('${id(22)}','Lead Coach 1','mentor',true);
    create table team_positions(key text primary key,name text,active boolean);
    insert into team_positions values ('program_manager','Program Manager',true),
      ('lead_coach_1','Lead Coach 1',true),('lead_coach_2','Lead Coach 2',true);
    create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    insert into team_member_positions values
      ('${id(2)}','lead_coach_1',null),('${id(4)}','lead_coach_2',null),
      ('${id(9)}','lead_coach_1',null),('${id(10)}','lead_coach_2',now()),
      ('${id(11)}','lead_coach_1',null),('${id(12)}','lead_coach_1',null),
      ('${id(13)}','lead_coach_1',null),('${id(14)}','lead_coach_1',null),
      ('${id(15)}','lead_coach_1',null),
      ${[5,6,15,16,17,18,19,21].map(n => `('${id(n)}','program_manager',null)`).join(',')},
      ('${id(20)}','program_manager',now());
    create function public.team_has_position(key text) returns boolean
    language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.team_member_positions mp
      join public.team_positions p on p.key=mp.position_key and p.active
      join public.profiles u on u.id=mp.user_id and u.active and u.role in ('student','lead','mentor','admin')
      where mp.user_id=auth.uid() and mp.position_key=$1 and mp.revoked_at is null)
    $$;
    select set_config('test.uid','${id(1)}',false);`);
  for (const file of ['202609100001_team_attendance.sql', '202609120001_attendance_requests_recurrence.sql', '202609120008_attendance_roster_sync.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(`drop view team_attendance_history;
    alter table team_attendance_private.history set schema public;
    alter table public.history rename to team_attendance_history;
    drop trigger team_history_actor on public.team_attendance_history;
    alter table public.team_attendance_history drop column actor_auth_uid,
      drop column actor_database_session, drop column actor_database_role,
      alter column performed_by set not null;
    grant select on team_attendance_history to authenticated;
    create policy attendance_history_read on team_attendance_history for select to authenticated
      using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
  await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql', 'utf8'));
  for (const file of ['202609300001_attendance_policy_v03.sql', '20261008032037_attendance_program_manager_mentor_review.sql', '20261008051847_attendance_program_manager_participation.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await as(1);
  mid = (await manage('create', { title: 'Coach review fixture', meeting_type: 'preseason', requirement: 'active',
    starts_at: new Date(Date.now() + 48 * 3600000).toISOString(), ends_at: new Date(Date.now() + 50 * 3600000).toISOString() })).id;
  // Seed both a historical decision and an unresolved PM request before upgrade.
  const historical = await request();
  await as(1); await manage('attendance', decision(historical));
  await request(5);
  beforeMigration = await snapshot();
  legacyDefinitions = await legacy();
  await db.exec(readFileSync(migration, 'utf8'));
});
test.afterEach(() => db.close());

test('migration changes only request capabilities and preserves production audit shape and existing data', async () => {
  expect(await snapshot()).toEqual(beforeMigration);
  expect(await legacy()).toEqual(legacyDefinitions);
  const columns = (await db.query<any>(`select column_name,is_nullable from information_schema.columns
    where table_schema='public' and table_name='team_attendance_history' order by ordinal_position`)).rows;
  expect(columns).toHaveLength(10);
  expect(columns.find(c => c.column_name === 'performed_by').is_nullable).toBe('NO');
  expect((await db.query(`select tgname from pg_trigger where tgrelid='public.team_attendance_history'::regclass and not tgisinternal`)).rows).toEqual([]);
  for (const n of [1,2,4,5,6,7,8,10,12,13,14,15,16,17,18,20,22]) {
    await as(n); const c = await context();
    expect(c.can_review_requests).toBe([2,4,5,6,15,16,17,18].includes(n));
    expect(c.can_review_program_manager_requests).toBe([2,4].includes(n));
    expect(c.can_review).toBe([1,2,4,5,6,10,15,16,17,18,20,22].includes(n));
    expect(c.can_read_team).toBe(n !== 14);
    expect(c.can_manage_meetings).toBe(![14,16].includes(n));
  }
});

test('both active mentor coaches and all supported active PM roles review ordinary requests', async () => {
  for (const reviewer of [2,4,5,6,15,16,17,18]) {
    const attendance = await request();
    await as(reviewer);
    const status = reviewer % 2 ? 'denied' : 'excused';
    await manage('attendance', decision(attendance, { review_status: status }));
    expect(await row()).toMatchObject({ review_status: status, reviewed_by: id(reviewer), physical_status: 'pending' });
    const audit = (await db.query<any>(`select performed_by,after_data from team_attendance_history
      where entity_id=$1 and action='UPDATE' order by id desc limit 1`, [attendance.id])).rows[0];
    expect(audit.performed_by).toBe(id(reviewer));
    expect(audit.after_data.review_status).toBe(status);
  }
});

test('ordinary mentors, unassigned leadership and role-ineligible or inactive coaches cannot decide requests', async () => {
  const attendance = await request();
  const before = await snapshot();
  for (const reviewer of [1,7,8,9,10,11,12,13,14,19,20,21,22]) {
    await as(reviewer);
    for (const review_status of ['excused','denied','not_required','none','pending',null]) {
      for (const physical of [{}, { physical_status: 'present' }]) {
        await expect(manage('attendance', decision(attendance, { review_status, ...physical })))
          .rejects.toThrow(/Lead Coach|Leadership/);
      }
    }
  }
  expect(await snapshot()).toEqual(before);
});

test('PM request decisions require another non-PM coach, including when PM also holds a coach position', async () => {
  for (const requester of [5,6,15,16,17,18]) {
    const attendance = await request(requester);
    for (const reviewer of [requester,5,6,15,16,17,18,1]) {
      await as(reviewer);
      for (const review_status of ['excused','denied','not_required','none','pending',null]) {
        await expect(manage('attendance', decision(attendance, { review_status }))).rejects.toThrow(/Lead Coach/);
      }
    }
    for (const reviewer of [2,4]) {
      const pending = await request(requester); await as(reviewer);
      await manage('attendance', decision(pending, { review_status: reviewer === 2 ? 'excused' : 'denied' }));
      expect((await row(requester)).reviewed_by).toBe(id(reviewer));
    }
  }
  await db.exec('reset role');
  for (const n of [2,4,5,6,15,16,17,18]) {
    expect((await db.query<any>('select team_attendance_private.can_review_request($1,$1) ok', [id(n)])).rows[0].ok).toBe(false);
  }
});

test('live revocation, disabled positions and inactive accounts remove review powers without changing legacy mentor abilities', async () => {
  const attendance = await request();
  for (const reviewer of [2,4,5]) {
    const key = reviewer === 2 ? 'lead_coach_1' : reviewer === 4 ? 'lead_coach_2' : 'program_manager';
    const changes = [
      [`update team_member_positions set revoked_at=now() where user_id='${id(reviewer)}'`, `update team_member_positions set revoked_at=null where user_id='${id(reviewer)}'`],
      [`update team_positions set active=false where key='${key}'`, `update team_positions set active=true where key='${key}'`],
      [`update profiles set active=false where id='${id(reviewer)}'`, `update profiles set active=true where id='${id(reviewer)}'`],
    ];
    for (const [disable, restore] of changes) {
      await db.exec(`reset role; ${disable}`);
      await as(reviewer);
      await expect(manage('attendance', decision(attendance))).rejects.toThrow(/Lead Coach|Leadership/);
      if (!disable.includes('update profiles')) {
        const c = await context();
        expect(c.can_review_requests).toBe(false); expect(c.can_review_program_manager_requests).toBe(false);
        expect(c.can_review).toBe(true); expect(c.can_read_team).toBe(true); expect(c.can_manage_meetings).toBe(true);
      }
      await db.exec(`reset role; ${restore}`);
      await as(reviewer); expect((await context()).can_review_requests).toBe(true);
    }
  }
});

test('physical correction and strike/warning powers survive request restriction, without a combined-payload bypass', async () => {
  const attendance = await request(); await as(1);
  await expect(manage('attendance', decision(attendance, { physical_status: 'present' }))).rejects.toThrow(/Lead Coach/);
  await manage('attendance', { meeting_id: mid, attendance_id: attendance.id, version: attendance.version,
    physical_status: 'present', explanation: 'Existing physical correction' });
  expect(await row()).toMatchObject({ physical_status: 'present', review_status: 'pending', reviewed_by: null });
  await manage('strike', { meeting_id: mid, attendance_id: attendance.id, category: 'Other', quantity: 1, explanation: 'Existing mentor strike power' });
  const strike = (await db.query<any>('select * from team_attendance_strikes')).rows[0];
  await manage('rescind', { meeting_id: mid, attendance_id: attendance.id, strike_id: strike.id, explanation: 'Existing mentor rescission power' });
  await db.query("select team_attendance_policy_action('warning_parent_contact',$1::jsonb)", [JSON.stringify({ student_id: id(3), note: 'Completed contact' })]);
  expect((await context()).warnings[0].actor).toBe(id(1));
  const own = await request(5); await as(5);
  await expect(manage('attendance', decision(own, { physical_status: 'present' }))).rejects.toThrow(/Lead Coach/);
  await manage('attendance', { meeting_id: mid, attendance_id: own.id, version: own.version,
    physical_status: 'present', explanation: 'Existing PM physical correction' });
  expect(await row(5)).toMatchObject({ physical_status: 'present', review_status: 'pending', reviewed_by: null });
});

test('context and private predicates fail closed for inactive, readonly, anonymous and null callers', async () => {
  await db.exec('reset role');
  for (const n of [9,11,19,21]) {
    const privateResult = (await db.query<any>('select team_attendance_private.request_reviewer($1) ok', [id(n)])).rows[0].ok;
    expect(privateResult).toBe(false);
    await as(n); await expect(context()).rejects.toThrow(/Active Attendance account/);
    await db.exec('reset role');
  }
  expect((await db.query<any>('select team_attendance_private.request_reviewer(null) ok')).rows[0].ok).toBe(false);
  expect((await db.query<any>('select team_attendance_private.can_review_request(null,$1) ok', [id(2)])).rows[0].ok).toBe(false);
  for (const role of ['authenticated','anon']) {
    await db.exec(`reset role; set role ${role}`);
    for (const fn of ['is_lead_coach','request_reviewer']) {
      await expect(db.query(`select team_attendance_private.${fn}($1)`, [id(2)])).rejects.toThrow(/permission denied/);
    }
    await expect(db.query('select team_attendance_private.can_review_request($1,$2)', [id(3),id(2)])).rejects.toThrow(/permission denied/);
  }
  await db.exec("reset role; select set_config('test.uid','',false); set role authenticated;");
  await expect(context()).rejects.toThrow(/Active Attendance account/);
});
