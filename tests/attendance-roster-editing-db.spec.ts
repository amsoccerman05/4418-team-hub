import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Isolated PostgreSQL regression coverage. This never connects to Supabase.
let db: PGlite;
let mid: string;
let beforeMigration: any;
let beforeDefinitions: any;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const migration = '20261011025742_attendance_required_roster_editing.sql';
const initialRequired = [2, 3, 4, 5, 9, 20, 21].map(id);

async function as(n: number) {
  await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);
}
async function rows(query: string, args: any[] = []) {
  return (await db.query<any>(query, args)).rows;
}
async function rootQuery(query: string, args: any[] = []) {
  await db.exec('reset role');
  try { return await rows(query, args); } finally { await as(1); }
}
async function manage(action: string, p: any) {
  return (await rows('select public.team_attendance_manage($1,$2::jsonb) r', [action, JSON.stringify(p)]))[0].r;
}
async function meeting(meetingId = mid) {
  return (await rows('select id,title,meeting_type,starts_at,ends_at,version,status,check_in_open,code_expires_at,requirement,late_minutes,created_by,created_at from team_meetings where id=$1', [meetingId]))[0];
}
async function rawMeeting(meetingId = mid) {
  return (await rootQuery('select * from team_meetings where id=$1', [meetingId]))[0];
}
async function required(meetingId = mid): Promise<string[]> {
  return (await rows('select student_id from team_meeting_members where meeting_id=$1 and required order by student_id', [meetingId])).map(r => r.student_id);
}
async function attendance(n: number, meetingId = mid) {
  return (await rows('select * from team_attendance where meeting_id=$1 and student_id=$2', [meetingId, id(n)]))[0];
}
async function member(n: number, meetingId = mid) {
  return (await rows('select * from team_meeting_members where meeting_id=$1 and student_id=$2', [meetingId, id(n)]))[0];
}
async function draft(extra: any = {}) {
  const m = await meeting();
  return { meeting_id: mid, version: m.version, title: m.title, meeting_type: m.meeting_type, starts_at: m.starts_at, ends_at: m.ends_at, ...extra };
}
async function rosterDraft(next: string[], extra: any = {}) {
  return draft({ required_student_ids: next, expected_required_student_ids: await required(), acknowledge_roster_change: true, ...extra });
}
async function edit(p: any) {
  return (await rows('select public.team_attendance_edit_meeting($1::jsonb) r', [JSON.stringify(p)]))[0].r;
}
async function fingerprint() {
  return (await rootQuery(`select jsonb_build_object(
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from profiles t),
    'positions',(select jsonb_agg(to_jsonb(t) order by key) from team_positions t),
    'assignments',(select jsonb_agg(to_jsonb(t) order by user_id,position_key) from team_member_positions t),
    'membership',(select jsonb_agg(to_jsonb(t) order by student_id) from team_attendance_members t),
    'meetings',(select jsonb_agg(to_jsonb(t) order by id) from team_meetings t),
    'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),
    'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),
    'strikes',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_strikes t),
    'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t)) snapshot`))[0].snapshot;
}
async function definitions() {
  return rootQuery(`select n.nspname,p.proname,p.proacl,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','team_attendance_private')
    and not (n.nspname='team_attendance_private' and p.proname='edit_meeting')
    order by n.nspname,p.proname,p.oid`);
}
async function create(requirement = 'active', extra: any = {}) {
  return (await manage('create', { title: 'Another synthetic occurrence', meeting_type: 'preseason', requirement, starts_at: future(72), ends_at: future(74), ...extra })).id;
}
async function request(n: number, kind = 'late') {
  await as(n);
  const a = await attendance(n);
  await rows('select team_attendance_request($1::jsonb)', [JSON.stringify({ meeting_id: mid, version: a.version, notice_type: kind, expected_at: kind === 'absent' ? null : future(49), reason: 'Synthetic request evidence' })]);
  await as(1);
}
async function newParticipant(n = 30, role = 'student', active = true) {
  await rootQuery('insert into profiles values($1,$2,$3,$4)', [id(n), `Synthetic participant ${n}`, role, active]);
}
async function history(action: string, meetingId = mid) {
  return rows('select * from team_attendance_history where meeting_id=$1 and action=$2 order by id', [meetingId, action]);
}

// Real production contract: public history table, required genuine profile actor,
// and no fallback attribution trigger or database-session actor columns.
test.beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into profiles values
      ('${id(1)}','Mentor','mentor',true),('${id(2)}','Lead','lead',true),
      ('${id(3)}','Student','student',true),('${id(4)}','Student PM','student',true),
      ('${id(5)}','Other student','student',true),('${id(6)}','Admin','admin',true),
      ('${id(7)}','Inactive lead','lead',false),('${id(8)}','Readonly','readonly',true),
      ('${id(9)}','Mentor PM','mentor',true),('${id(20)}','Admin Operations Lead','admin',true),
      ('${id(21)}','Mentor Operations Lead','mentor',true),('${id(22)}','Revoked Operations Lead','admin',true),
      ('${id(23)}','Inactive Operations Lead','admin',false),('${id(24)}','Readonly Operations Lead','readonly',true);
    create table team_positions(key text primary key,name text,active boolean);
    insert into team_positions values('program_manager','Program Manager',true),('operations_lead','Operations Lead',true);
    create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    insert into team_member_positions values
      ('${id(4)}','program_manager',null),('${id(9)}','program_manager',null),
      ('${id(20)}','operations_lead',null),('${id(21)}','operations_lead',null),
      ('${id(22)}','operations_lead',now()),('${id(23)}','operations_lead',null),('${id(24)}','operations_lead',null);
    create function public.team_has_position(key text) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.team_member_positions mp join public.team_positions p on p.key=mp.position_key and p.active
      join public.profiles u on u.id=mp.user_id and u.active and u.role in ('student','lead','mentor','admin')
      where mp.user_id=auth.uid() and mp.position_key=$1 and mp.revoked_at is null) $$;
    select set_config('test.uid','${id(1)}',false);`);
  for (const file of ['202609100001_team_attendance.sql', '202609120001_attendance_requests_recurrence.sql', '202609120008_attendance_roster_sync.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
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
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await as(1);
  await manage('member', { student_id: id(3), member_status: 'registered', team_area: 'Mechanical' });
  await manage('member', { student_id: id(5), member_status: 'registered', team_area: 'Software' });
  mid = await create('active', { title: 'Synthetic roster editing meeting', starts_at: future(48), ends_at: future(50) });
  beforeMigration = await fingerprint();
  beforeDefinitions = await definitions();
  await db.exec('reset role');
  await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  await as(1);
});
test.afterEach(async () => { await db?.close(); });

test('migration rewrites no data and leaves other functions, privileges and genuine audit attribution intact', async () => {
  expect(await fingerprint()).toEqual(beforeMigration);
  expect(await definitions()).toEqual(beforeDefinitions);
  expect(await required()).toEqual(initialRequired);
  const column = (await rootQuery("select is_nullable from information_schema.columns where table_name='team_attendance_history' and column_name='performed_by'"))[0];
  expect(column.is_nullable).toBe('NO');
  await db.exec('reset role');
  await expect(rows("insert into team_attendance_history(entity,entity_id,action,performed_by) values('test','test','TEST',null)")).rejects.toThrow(/not-null constraint/);
  await expect(rows("insert into team_attendance_history(entity,entity_id,action,performed_by) values('test','test','TEST',$1)", [id(999)])).rejects.toThrow(/foreign key constraint/);
});

test('leadership roles can edit required participants with exactly one meeting revision and attributed audit', async () => {
  for (const actor of [1, 2, 6, 9, 20, 21]) {
    await as(actor);
    const m = await meeting();
    const current = await required();
    const next = current.includes(id(3)) ? current.filter(n => n !== id(3)) : [...current, id(3)].sort();
    const r = await edit(await rosterDraft(next));
    expect(r).toEqual({ id: mid, version: m.version + 1, changed: true });
    expect(await required()).toEqual(next);
    expect((await history('ROSTER_EDIT_REQUIREMENT')).at(-1)).toMatchObject({ performed_by: id(actor), student_id: id(3) });
  }
  const audits = (await history('UPDATE')).filter(a => a.entity === 'team_meetings');
  expect(audits).toHaveLength(6);
  for (const a of audits) {
    expect(a.before_data).not.toHaveProperty('code_hash');
    expect(a.after_data).not.toHaveProperty('code_expires_at');
  }
});

test('students, student PMs, readonly, inactive and anonymous cannot edit or write directly', async () => {
  const p = await rosterDraft(initialRequired.filter(n => n !== id(3)));
  const before = await fingerprint();
  for (const actor of [3, 4, 7, 8, 23, 24]) {
    await as(actor);
    await expect(edit(p)).rejects.toThrow(/Leadership access required/);
    await expect(rows('update team_meeting_members set required=false where meeting_id=$1', [mid])).rejects.toThrow(/permission denied/);
    await expect(rows('update team_meetings set title=$2 where id=$1', [mid, 'Unauthorized'])).rejects.toThrow(/permission denied/);
  }
  await db.exec('reset role;set role anon');
  await expect(edit(p)).rejects.toThrow(/permission denied/);
  await db.exec("reset role;select set_config('test.uid','',false);set role authenticated");
  await expect(edit(p)).rejects.toThrow(/Leadership access required/);
  await as(999);
  await expect(edit(p)).rejects.toThrow(/Leadership access required/);
  expect(await fingerprint()).toEqual(before);
});

test('arbitrary-person helpers remain private and the public editor keeps its previous ACL', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`reset role;set role ${role}`);
    for (const fn of ['is_participant', 'is_program_manager']) {
      await expect(rows(`select team_attendance_private.${fn}($1)`, [id(20)])).rejects.toThrow(/permission denied/);
    }
  }
  const acl = await rootQuery(`select has_function_privilege('authenticated','public.team_attendance_edit_meeting(jsonb)','execute') authenticated,
    has_function_privilege('anon','public.team_attendance_edit_meeting(jsonb)','execute') anon`);
  expect(acl).toEqual([{ authenticated: true, anon: false }]);
});

test('changed required roster becomes selected while every existing snapshot and unrelated occurrence survives', async () => {
  const other = await create();
  const before = await fingerprint();
  const previous = await member(3);
  const a = await attendance(3);
  await rootQuery("update team_meeting_members set attempts=2,attempt_window=now() where meeting_id=$1 and student_id=$2", [mid, id(3)]);
  const withAttempts = await member(3);
  await edit(await rosterDraft(initialRequired.filter(n => n !== id(3)), { title: 'Edited one occurrence', meeting_type: 'other' }));
  const after = await fingerprint();
  expect(await member(3)).toEqual({ ...withAttempts, required: false });
  expect(await attendance(3)).toEqual({ ...a, review_status: 'not_required', version: a.version + 1 });
  expect(previous.member_status).toBe('registered');
  expect(await rawMeeting()).toMatchObject({ requirement: 'selected', selected_students: initialRequired.filter(n => n !== id(3)), areas: [], title: 'Edited one occurrence', meeting_type: 'other' });
  for (const key of ['profiles', 'positions', 'assignments', 'membership', 'strikes']) expect(after[key]).toEqual(before[key]);
  for (const key of ['meetings', 'members', 'attendance', 'history']) {
    expect(after[key].filter((r: any) => (key === 'meetings' ? r.id : r.meeting_id) === other)).toEqual(before[key].filter((r: any) => (key === 'meetings' ? r.id : r.meeting_id) === other));
  }
  expect(after.members.filter((r: any) => r.meeting_id === mid)).toHaveLength(initialRequired.length);
  expect(after.attendance.filter((r: any) => r.meeting_id === mid)).toHaveLength(initialRequired.length);
  const audit = (await history('ROSTER_EDIT_REQUIREMENT'))[0];
  expect(audit.before_data).toMatchObject({ required: true, member_status: 'registered', team_area: 'Mechanical' });
  expect(audit.after_data).toMatchObject({ required: false, member_status: 'registered', team_area: 'Mechanical' });
  expect(audit.before_data).not.toHaveProperty('attempts');
  expect(audit.after_data).not.toHaveProperty('attempt_window');
});

test('legacy title and date payloads and unchanged rosters preserve active, registered, areas, selected and optional modes', async () => {
  for (const requirement of ['active', 'registered', 'areas', 'selected', 'optional']) {
    mid = await create(requirement, { areas: requirement === 'areas' ? ['Mechanical'] : [], selected_students: requirement === 'selected' ? [id(3)] : [] });
    const original = await rawMeeting();
    const records = (await fingerprint()).members.filter((r: any) => r.meeting_id === mid);
    await edit(await draft({ title: 'Legacy client edit' }));
    await edit(await rosterDraft(await required(), { title: 'No requirement change' }));
    await edit(await draft({ starts_at: future(120), ends_at: future(122), acknowledge_schedule_change: true }));
    const after = await rawMeeting();
    expect(after).toMatchObject({ requirement: original.requirement, areas: original.areas, selected_students: original.selected_students });
    expect((await fingerprint()).members.filter((r: any) => r.meeting_id === mid)).toEqual(records);
    expect(await history('ROSTER_EDIT_REQUIREMENT')).toHaveLength(0);
    const current = await required();
    const next = current.includes(id(3)) ? current.filter(v => v !== id(3)) : [...current, id(3)].sort();
    await edit(await rosterDraft(next));
    expect(await rawMeeting()).toMatchObject({ requirement: next.length ? 'selected' : 'optional', selected_students: next, areas: [] });
  }
});

test('empty required list means optional; broad and scoped sync cannot re-require removed participants', async () => {
  await edit(await rosterDraft([]));
  expect(await required()).toEqual([]);
  expect(await rawMeeting()).toMatchObject({ requirement: 'optional', selected_students: [], areas: [] });
  const before = await fingerprint();
  expect((await rows('select team_attendance_sync_future_rosters() r'))[0].r).toMatchObject({ added: 0, promoted: 0 });
  await expect(rows('select team_attendance_sync_participant_rosters($1,$2::uuid[])', [id(3), [mid]])).rejects.toThrow(/active or registered/);
  expect(await fingerprint()).toEqual(before);
  await edit(await rosterDraft([id(3)]));
  const selected = await fingerprint();
  await rows('select team_attendance_sync_future_rosters()');
  expect(await fingerprint()).toEqual(selected);
  expect(await attendance(3)).toMatchObject({ review_status: 'none', physical_status: 'pending', version: 3 });
});

test('new participants receive required snapshots and pending attendance without global enrollment', async () => {
  await newParticipant();
  await rootQuery("insert into team_attendance_members values($1,'registered','Electrical')", [id(30)]);
  const before = await fingerprint();
  await edit(await rosterDraft([...initialRequired, id(30)]));
  expect(await member(30)).toMatchObject({ student_id: id(30), required: true, member_status: 'registered', team_area: 'Electrical', attempts: 0, attempt_window: null });
  expect(await attendance(30)).toMatchObject({ student_id: id(30), physical_status: 'pending', review_status: 'none', checked_in_at: null, left_at: null, notice_at: null, reviewed_at: null, version: 1 });
  const after = await fingerprint();
  expect(after.members.filter((r: any) => r.student_id !== id(30))).toEqual(before.members);
  expect(after.attendance.filter((r: any) => r.student_id !== id(30))).toEqual(before.attendance);
  expect(after.membership).toEqual(before.membership);
  expect(after.strikes).toEqual(before.strikes);
  expect((await history('ROSTER_EDIT_ADD'))[0]).toMatchObject({ student_id: id(30), performed_by: id(1), entity: 'team_meeting_members' });
  await newParticipant(31);
  await edit(await rosterDraft([...await required(), id(31)]));
  expect(await member(31)).toMatchObject({ required: true, member_status: 'prospective', team_area: '' });
  expect(await rows('select * from team_attendance_members where student_id=$1', [id(31)])).toHaveLength(0);
});

test('active Operations Leads are eligible with admin or mentor suite roles and no added review authority', async () => {
  mid = await create('optional');
  await as(20);
  const before = (await rows('select team_attendance_policy_context() r'))[0].r;
  expect(before).toMatchObject({ can_participate: true, can_manage_meetings: true, can_review_requests: false });
  await edit(await rosterDraft([id(20), id(21)]));
  for (const n of [20, 21]) expect(await attendance(n)).toMatchObject({ physical_status: 'pending', review_status: 'none' });
  expect((await rows('select team_attendance_policy_context() r'))[0].r).toEqual(before);
  await as(1);
  for (const n of [1, 6, 22, 23, 24, 999]) {
    await expect(edit(await rosterDraft([...await required(), id(n)]))).rejects.toThrow(/unavailable/);
  }
});

test('pending requests lock requirement removal and promotion while unrelated participants remain editable', async () => {
  for (const requirement of ['active', 'optional']) {
    mid = await create(requirement, { starts_at: future(48), ends_at: future(50) });
    await request(3);
    const pending = await attendance(3);
    const current = await required();
    const next = current.includes(id(3)) ? current.filter(v => v !== id(3)) : [...current, id(3)];
    const before = await fingerprint();
    await expect(edit(await rosterDraft(next))).rejects.toThrow(/existing attendance request locks/);
    expect(await fingerprint()).toEqual(before);
    const other = current.includes(id(5)) ? current.filter(v => v !== id(5)) : [...current, id(5)];
    await edit(await rosterDraft(other));
    expect(await attendance(3)).toEqual(pending);
    expect(await member(3)).toMatchObject({ required: requirement === 'active' });
  }
});

test('any surviving request evidence locks required changes even when review_status looks pristine', async () => {
  for (const mutation of [
    "notice_at=now()", "review_status='pending'", "notice_type='absent'",
    "notice_type='late',expected_at=now()+interval '49 hours'", "notice_reason='Preserved request evidence'",
  ]) {
    await rootQuery(`update team_attendance set ${mutation} where meeting_id=$1 and student_id=$2`, [mid, id(3)]);
    const before = await fingerprint();
    await expect(edit(await rosterDraft(initialRequired.filter(v => v !== id(3))))).rejects.toThrow(/existing attendance request locks/);
    expect(await fingerprint()).toEqual(before);
    await rootQuery("update team_attendance set notice_at=null,review_status='none',notice_type=null,expected_at=null,notice_reason='' where meeting_id=$1 and student_id=$2", [mid, id(3)]);
  }
});

for (const [label, mutation] of [
  ['check-in', "checked_in_at=now()"],
  ['departure', "left_at=now()"],
  ['present', "physical_status='present'"],
  ['late', "physical_status='late'"],
  ['absent', "physical_status='absent'"],
  ['review timestamp', "reviewed_at=now()"],
  ['review actor', "reviewed_by='00000000-0000-0000-0000-000000000001'"],
  ['review explanation', "review_reason='Preserved review evidence'"],
  ['excused review', "review_status='excused'"],
  ['denied review', "review_status='denied'"],
]) test(`${label} locks only the affected participant requirement`, async () => {
  await rootQuery(`update team_attendance set ${mutation} where meeting_id=$1 and student_id=$2`, [mid, id(3)]);
  const protectedAttendance = await attendance(3);
  const protectedMember = await member(3);
  const before = await fingerprint();
  await expect(edit(await rosterDraft(initialRequired.filter(n => n !== id(3))))).rejects.toThrow(/lock this participant/);
  expect(await fingerprint()).toEqual(before);
  await edit(await rosterDraft(initialRequired.filter(n => n !== id(5))));
  expect(await attendance(3)).toEqual(protectedAttendance);
  expect(await member(3)).toEqual(protectedMember);
});

test('active and rescinded strikes block toggles without blocking edits to another participant', async () => {
  const a = await attendance(3);
  await manage('strike', { meeting_id: mid, attendance_id: a.id, category: 'Other', quantity: 1, explanation: 'Synthetic adjudicated history' });
  for (const rescinded of [false, true]) {
    if (rescinded) await rootQuery("update team_attendance_strikes set rescinded_at=now(),rescinded_by=$1,rescind_reason='Synthetic rescission' where meeting_id=$2", [id(1), mid]);
    const before = await fingerprint();
    await expect(edit(await rosterDraft((await required()).filter(n => n !== id(3))))).rejects.toThrow(/strikes lock/);
    expect(await fingerprint()).toEqual(before);
  }
  const strikes = (await fingerprint()).strikes;
  await edit(await rosterDraft(initialRequired.filter(n => n !== id(5))));
  expect((await fingerprint()).strikes).toEqual(strikes);
});

test('inactive accounts, attendance memberships and revoked positions stay unchanged while other people remain editable', async () => {
  await rootQuery('update profiles set active=false where id=$1', [id(3)]);
  await rootQuery("update team_attendance_members set member_status='inactive' where student_id=$1", [id(5)]);
  await rootQuery("update team_member_positions set revoked_at=now() where user_id=$1 and position_key='operations_lead'", [id(20)]);
  const preserved = [await member(3), await member(5), await member(20)];
  const before = await fingerprint();
  for (const n of [3, 5, 20]) await expect(edit(await rosterDraft(initialRequired.filter(v => v !== id(n))))).rejects.toThrow(/unavailable.*stay unchanged/);
  expect(await fingerprint()).toEqual(before);
  await edit(await rosterDraft(initialRequired.filter(v => v !== id(4)), { title: 'Edit around unavailable snapshot' }));
  expect([await member(3), await member(5), await member(20)]).toEqual(preserved);
  for (const n of [3, 5, 20]) expect(await required()).toContain(id(n));
  await newParticipant(30, 'student', false);
  await expect(edit(await rosterDraft([...await required(), id(30)]))).rejects.toThrow(/unavailable/);
  await newParticipant(31);
  await rootQuery("insert into team_attendance_members values($1,'inactive','')", [id(31)]);
  await expect(edit(await rosterDraft([...await required(), id(31)]))).rejects.toThrow(/unavailable/);
});

test('stale meeting versions and independently changed required sets cannot overwrite', async () => {
  const stale = await rosterDraft(initialRequired.filter(v => v !== id(3)));
  await edit(await draft({ title: 'Newer meeting title' }));
  const before = await fingerprint();
  await expect(edit(stale)).rejects.toThrow(/Meeting changed/);
  expect(await fingerprint()).toEqual(before);
  const staleRoster = await rosterDraft(initialRequired.filter(v => v !== id(3)));
  await rootQuery('update team_meeting_members set required=false where meeting_id=$1 and student_id=$2', [mid, id(5)]);
  const synchronized = await fingerprint();
  await expect(edit(staleRoster)).rejects.toThrow(/Required roster changed/);
  expect(await fingerprint()).toEqual(synchronized);
  await expect(edit(await draft({ title: 'Wrong expected list', required_student_ids: await required(), expected_required_student_ids: initialRequired }))).rejects.toThrow(/Required roster changed/);
});

test('exact retry with old version and original required list is read-only and audits only once', async () => {
  await newParticipant();
  const p = await rosterDraft([...initialRequired.filter(v => v !== id(3)), id(30)], { title: 'Saved once', starts_at: future(144), ends_at: future(146), acknowledge_schedule_change: true });
  const result = await edit(p);
  const saved = await fingerprint();
  expect(await edit(p)).toEqual({ ...result, changed: false });
  expect(await fingerprint()).toEqual(saved);
  expect(await history('ROSTER_EDIT_ADD')).toHaveLength(1);
  expect(await history('ROSTER_EDIT_REQUIREMENT')).toHaveLength(1);
  expect((await history('UPDATE')).filter(a => a.entity === 'team_meetings')).toHaveLength(1);
  await expect(edit({ ...p, title: 'Stale different edit' })).rejects.toThrow(/Meeting changed/);
  const unchanged = await rosterDraft([...await required()].reverse(), { acknowledge_roster_change: false });
  expect((await edit(unchanged)).changed).toBe(false);
  expect(await fingerprint()).toEqual(saved);
});

test('malformed arrays, duplicate IDs, unsupported fields and missing acknowledgement reject atomically', async () => {
  const next = initialRequired.filter(v => v !== id(3));
  const valid = await rosterDraft(next);
  const before = await fingerprint();
  const changes = [
    { required_student_ids: null }, { required_student_ids: {} }, { required_student_ids: id(3) },
    { required_student_ids: [3] }, { required_student_ids: [null] }, { required_student_ids: [[]] }, { required_student_ids: ['not-a-uuid'] },
    { required_student_ids: [id(3), id(3)] }, { expected_required_student_ids: [id(3), id(3)] },
    { expected_required_student_ids: null }, { expected_required_student_ids: 'invalid' }, { expected_required_student_ids: [false] },
    { expected_required_student_ids: ['not-a-uuid'] }, { required_student_ids: Array(5001).fill(id(3)) },
    { acknowledge_roster_change: false }, { acknowledge_roster_change: 'true' },
    { selected_students: [id(3)] }, { requirement: 'optional' }, { areas: ['Mechanical'] }, { status: 'finalized' },
    { performed_by: id(6) }, { student_id: id(3) }, { late_minutes: 0 },
    { title: ' ' }, { meeting_type: 'invalid' }, { starts_at: 'infinity' }, { ends_at: 'invalid' }, { version: null },
  ];
  for (const change of changes) await expect(edit({ ...valid, ...change }), JSON.stringify(change).slice(0, 180)).rejects.toThrow();
  const { expected_required_student_ids: _expected, ...missingExpected } = valid;
  const { required_student_ids: _required, ...missingRequired } = valid;
  const { acknowledge_roster_change: _acknowledge, ...missingAcknowledgement } = valid;
  for (const invalid of [missingExpected, missingRequired, missingAcknowledgement, null, [], 'invalid']) await expect(edit(invalid)).rejects.toThrow();
  expect(await fingerprint()).toEqual(before);
});

test('combined date and roster edit is atomic, invalidates code, preserves request evidence and allows overnight times', async () => {
  await request(3);
  await rootQuery("update team_meetings set status='open',check_in_open=true,code_hash=sha256(convert_to(id::text||'123456','UTF8')),code_expires_at=now()+interval '30 minutes' where id=$1", [mid]);
  const pending = await attendance(3);
  const overnightYear = new Date().getUTCFullYear() + 1;
  const p = await rosterDraft(initialRequired.filter(v => v !== id(5)), { starts_at: `${overnightYear}-10-07T23:00:00-05:00`, ends_at: `${overnightYear}-10-08T02:00:00-05:00`, acknowledge_schedule_change: true });
  const before = await fingerprint();
  for (const change of [{ acknowledge_schedule_change: false }, { acknowledge_roster_change: false }, { required_student_ids: [id(999)] }, { ends_at: future(1) }]) {
    await expect(edit({ ...p, ...change })).rejects.toThrow();
    expect(await fingerprint()).toEqual(before);
  }
  const old = await meeting();
  await edit(p);
  const m = await rawMeeting();
  expect(new Date(m.starts_at).toISOString()).toBe(`${overnightYear}-10-08T04:00:00.000Z`);
  expect(new Date(m.ends_at).toISOString()).toBe(`${overnightYear}-10-08T07:00:00.000Z`);
  expect(m).toMatchObject({ version: old.version + 1, check_in_open: false, code_hash: null, code_expires_at: null, requirement: 'selected' });
  expect(await attendance(3)).toEqual(pending);
});

test('physical attendance on an unchanged participant prevents a combined reschedule but allows roster-only editing', async () => {
  await rootQuery("update team_attendance set checked_in_at=now(),physical_status='present' where meeting_id=$1 and student_id=$2", [mid, id(3)]);
  const p = await rosterDraft(initialRequired.filter(v => v !== id(5)), { starts_at: future(144), ends_at: future(146), acknowledge_schedule_change: true });
  const before = await fingerprint();
  await expect(edit(p)).rejects.toThrow(/Recorded attendance/);
  expect(await fingerprint()).toEqual(before);
  await edit(await rosterDraft(initialRequired.filter(v => v !== id(5))));
  expect(await attendance(3)).toMatchObject({ physical_status: 'present' });
});

test('future draft, open and closed meetings allow edits and preserve code when the schedule is unchanged', async () => {
  for (const status of ['draft', 'open', 'closed']) {
    mid = await create('active');
    await rootQuery("update team_meetings set status=$2,check_in_open=($2='open'),code_hash=sha256(convert_to(id::text||'123456','UTF8')),code_expires_at=now()+interval '30 minutes' where id=$1", [mid, status]);
    const original = await rawMeeting();
    await edit(await rosterDraft(initialRequired.filter(v => v !== id(3))));
    const after = await rawMeeting();
    expect(after).toMatchObject({ status, check_in_open: original.check_in_open, code_hash: original.code_hash, code_expires_at: original.code_expires_at });
  }
});

test('started, ended and finalized occurrences reject title, roster and schedule changes without writes', async () => {
  for (const state of [
    { status: 'open', start: -1, end: 1 }, { status: 'closed', start: -2, end: -1 },
    { status: 'draft', start: -1, end: 1 }, { status: 'finalized', start: 48, end: 50 },
  ]) {
    await rootQuery('update team_meetings set status=$2,starts_at=$3,ends_at=$4 where id=$1', [mid, state.status, future(state.start), future(state.end)]);
    const before = await fingerprint();
    const drafts = [await draft({ title: `Cannot edit ${state.status}` }), await rosterDraft(initialRequired.filter(v => v !== id(3))), await rosterDraft(initialRequired.filter(v => v !== id(3)), { starts_at: future(144), ends_at: future(146), acknowledge_schedule_change: true })];
    for (const p of drafts) await expect(edit(p)).rejects.toThrow(/started or attendance is complete/);
    expect(await fingerprint()).toEqual(before);
  }
});

for (const entity of ['team_attendance', 'team_meeting_members', 'team_meetings']) test(`${entity} audit failure rolls back all combined edits and new participant insertion`, async () => {
  await newParticipant();
  const before = await fingerprint();
  await db.exec(`reset role;create function public.fail_roster_edit_audit() returns trigger language plpgsql as $$
    begin if new.entity='${entity}' then raise exception 'synthetic roster audit failure';end if;return new;end$$;
    create trigger fail_roster_edit_audit before insert on team_attendance_history for each row execute function public.fail_roster_edit_audit();`);
  await as(1);
  const p = await rosterDraft([...initialRequired.filter(v => v !== id(3)), id(30)], { title: 'Must roll back', starts_at: future(144), ends_at: future(146), acknowledge_schedule_change: true });
  await expect(edit(p)).rejects.toThrow(/synthetic roster audit failure/);
  expect(await fingerprint()).toEqual(before);
});


test('invalid versions reject even an otherwise exact no-op payload', async () => {
  const original = await draft();
  const before = await fingerprint();
  for (const version of [null, '', 'invalid', 0, -1, 1.5, true, {}, []]) {
    await expect(edit({ ...original, version }), JSON.stringify(version)).rejects.toThrow();
    await expect(edit({ ...await rosterDraft(initialRequired), version }), JSON.stringify(version)).rejects.toThrow();
  }
  expect(await fingerprint()).toEqual(before);
});

test('missing attendance row fails the whole roster preflight before another toggle writes', async () => {
  await rootQuery('delete from team_attendance where meeting_id=$1 and student_id=$2', [mid, id(5)]);
  const before = await fingerprint();
  await expect(edit(await rosterDraft(initialRequired.filter(v => ![id(3), id(5)].includes(v))))).rejects.toThrow(/Attendance record is missing/);
  expect(await fingerprint()).toEqual(before);
});


test('denial then resubmission cannot remove a required participant or bypass later automatic absence strikes', async () => {
  await request(3, 'absent');
  await as(4); // An active student PM may review this non-PM request, but cannot edit meetings.
  let a = await attendance(3);
  await manage('attendance', { meeting_id: mid, attendance_id: a.id, version: a.version, review_status: 'denied', explanation: 'Synthetic request denial' });
  await as(1);
  expect(await attendance(3)).toMatchObject({ review_status: 'denied', reviewed_by: id(4) });
  await request(3, 'absent');
  const pending = await attendance(3);
  expect(pending).toMatchObject({ review_status: 'pending', reviewed_at: null, reviewed_by: null });
  const before = await fingerprint();
  await expect(edit(await rosterDraft(initialRequired.filter(v => v !== id(3))))).rejects.toThrow(/existing attendance request locks/);
  expect(await fingerprint()).toEqual(before);
  expect(await member(3)).toMatchObject({ required: true });
  expect(await attendance(3)).toEqual(pending);

  // Only the normal review workflow decides the resubmitted request. A later
  // denial remains eligible for a genuine automatic strike at completion.
  await as(4);
  a = await attendance(3);
  await manage('attendance', { meeting_id: mid, attendance_id: a.id, version: a.version, review_status: 'denied', explanation: 'Synthetic resubmission denial' });
  await rootQuery("update team_meetings set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id=$1", [mid]);
  await manage('close', { meeting_id: mid, version: (await meeting()).version });
  const candidates = (await rows(`select a.id from team_attendance a join team_meeting_members mm using(meeting_id,student_id)
    where a.meeting_id=$1 and mm.required and a.physical_status in ('pending','absent')
      and a.review_status in ('none','denied') order by a.id`, [mid])).map(r => r.id);
  expect(candidates).toContain(a.id);
  await manage('finalize', { meeting_id: mid, version: (await meeting()).version, automatic_absence_strike_count: candidates.length, automatic_absence_strike_attendance_ids: candidates });
  expect(await rows('select source,quantity,assigned_by,rescinded_at from team_attendance_strikes where meeting_id=$1 and student_id=$2', [mid, id(3)])).toEqual([
    { source: 'automatic_absence', quantity: 1, assigned_by: id(1), rescinded_at: null },
  ]);
  expect(await member(3)).toMatchObject({ required: true });
});
