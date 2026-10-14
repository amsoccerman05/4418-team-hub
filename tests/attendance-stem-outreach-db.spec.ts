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
  await db.exec(source('20261014052049_attendance_stem_outreach.sql'));
  afterData = await snapshot();afterBoundary = await boundary();
  await root('update public.team_meeting_members set attempts=0,attempt_window=null');
});
test.beforeEach(async () => { await db.exec('begin'); });
test.afterEach(async () => { await db.exec('rollback;reset role'); });
test.afterAll(async () => { await db?.close(); });



async function outreach(title='Synthetic outreach'){return (await manage('create',{title,meeting_type:'stem_outreach',requirement:'active',starts_at:'2026-01-01T10:00:00Z',ends_at:'2026-01-01T12:00:00Z'})).id;}
async function report(actor=3,year=2025){await as(actor);return (await db.query<any>('select team_attendance_outreach_summary($1) r',[year])).rows[0].r;}
test('outreach is optional despite requested active requirement; finalization cannot create strikes',async()=>{
 const m=await outreach();expect((await root('select requirement,auto_absence_strikes_enabled from team_meetings where id=$1',[m]))[0]).toEqual({requirement:'optional',auto_absence_strikes_enabled:false});
 expect((await root('select count(*)::int n from team_meeting_members where meeting_id=$1 and required',[m]))[0].n).toBe(0);
 await root("update team_meetings set status='closed' where id=$1",[m]);
 await manage('finalize',{meeting_id:m,version:1,automatic_absence_strike_count:0,automatic_absence_strike_attendance_ids:[]});
 expect((await root('select auto_absence_strikes_enabled from team_meetings where id=$1',[m]))[0].auto_absence_strikes_enabled).toBe(false);
 expect((await root('select count(*)::int n from team_attendance_strikes where meeting_id=$1',[m]))[0].n).toBe(0);
 const a=(await root('select id from team_attendance where meeting_id=$1 and student_id=$2',[m,id(3)]))[0];
 for(const category of ['Unexcused Absence','Late Arrival','Early Departure','Other'])await rejects(()=>manage('strike',{meeting_id:m,attendance_id:a.id,category,quantity:1,explanation:'Synthetic rejected strike'}),/never receives/);
});
test('verified intervals count once; missing checkout earns no estimated hours; scope is self-only',async()=>{
 const first=await outreach(),second=await outreach('Overlapping outreach'),third=await outreach('Missing departure');
 await root("update team_attendance set checked_in_at='2026-01-01T10:00Z',left_at='2026-01-01T11:00Z',physical_status='present' where meeting_id=$1 and student_id=$2",[first,id(3)]);
 await root("update team_attendance set checked_in_at='2026-01-01T10:30Z',left_at='2026-01-01T11:30Z',physical_status='present' where meeting_id=$1 and student_id=$2",[second,id(3)]);
 await root("update team_attendance set checked_in_at='2026-01-01T10:00Z',physical_status='present' where meeting_id=$1 and student_id=$2",[third,id(3)]);
 const r=await report();expect(r.members).toHaveLength(1);expect(r.members[0]).toMatchObject({student_id:id(3),hours:1.5,missing_checkouts:1});expect(r.goal.target_hours).toBe(10);expect(r.can_configure).toBe(false);
 expect((await report(1)).members.length).toBeGreaterThan(1);
});
test('goal is authorized, versioned and audited without awarding a letter',async()=>{
 const p={version:1,target_hours:10};
 await as(3);await rejects(()=>db.query('select team_attendance_outreach_goal($1)',[JSON.stringify(p)]),/Mentor or admin/);
 await as(1);await db.query('select team_attendance_outreach_goal($1)',[JSON.stringify(p)]);const r=await report();expect(r.goal).toMatchObject({...p,version:2});
 expect((await root("select count(*)::int n from team_attendance_history where entity='stem_outreach_goal'"))[0].n).toBe(1);
 await as(1);await rejects(()=>db.query('select team_attendance_outreach_goal($1)',[JSON.stringify(p)]),/changed/);
});
test('calendar is visible to a participant without a snapshot, but other attendance remains hidden',async()=>{
 const m=await outreach();await root('delete from team_attendance where meeting_id=$1 and student_id=$2',[m,id(5)]);await root('delete from team_meeting_members where meeting_id=$1 and student_id=$2',[m,id(5)]);
 await as(5);expect((await db.query('select id from team_meetings where id=$1',[m])).rows).toHaveLength(1);expect((await db.query('select id from team_attendance where meeting_id=$1',[m])).rows).toHaveLength(0);
});
test('outreach type cannot relabel historic normal attendance and bypass strikes',async()=>{
 await rejects(()=>root("update team_meetings set meeting_type='stem_outreach' where id=$1",[mid]),/separate STEM outreach/);
});

test('annual Denver-local reset splits overnight and overlapping intervals without deleting prior-year hours',async()=>{
 const m=await outreach(),second=await outreach('Boundary overlap');
 for(const x of [m,second])await root("update team_attendance set checked_in_at='2026-05-01T05:30Z',left_at='2026-05-01T06:30Z',physical_status='present' where meeting_id=$1 and student_id=$2",[x,id(3)]);
 const before=await snapshot();expect((await report(3,2025)).members[0].hours).toBe(0.5);const current=await report(3,2026);expect(current.members[0].hours).toBe(0.5);expect(current.period).toMatchObject({start_date:'2026-05-01',end_date:'2027-04-30',time_zone:'America/Denver'});expect(current.available_years).toEqual(expect.arrayContaining([2026,2025]));expect(await snapshot()).toEqual(before);
});
test('leap-day service stays in the correct annual period and current totals do not carry over',async()=>{
 const m=await outreach();await root("update team_attendance set checked_in_at='2024-02-29T17:00Z',left_at='2024-02-29T18:00Z',physical_status='present' where meeting_id=$1 and student_id=$2",[m,id(3)]);
 expect((await report(3,2023)).members[0].hours).toBe(1);expect((await report(3,2024)).members[0].hours).toBe(0);
});
test('explicit roster sync adds new participants to outreach without requiring attendance',async()=>{
 const m=(await manage('create',{title:'Future outreach',meeting_type:'stem_outreach',requirement:'active',starts_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString()})).id;
 await root('delete from team_attendance where meeting_id=$1 and student_id=$2',[m,id(5)]);await root('delete from team_meeting_members where meeting_id=$1 and student_id=$2',[m,id(5)]);
 await as(1);await db.query('select team_attendance_sync_future_rosters()');
 const added=(await root('select mm.required,a.review_status from team_meeting_members mm join team_attendance a using(meeting_id,student_id) where mm.meeting_id=$1 and mm.student_id=$2',[m,id(5)]))[0];expect(added).toEqual({required:false,review_status:'not_required'});
});

test('leadership retains credited history for inactive participants, who cannot access it themselves',async()=>{
 const m=await outreach();await root("update team_attendance set checked_in_at='2026-01-01T10:00Z',left_at='2026-01-01T11:00Z',physical_status='present' where meeting_id=$1 and student_id=$2",[m,id(3)]);
 await root('update profiles set active=false where id=$1',[id(3)]);const r=await report(1);expect(r.members.find((m:any)=>m.student_id===id(3)).hours).toBe(1);
 await rejects(()=>report(3),/Active Attendance access/);
});

test('leadership verified-time corrections are scoped, versioned and reason-audited',async()=>{
 const m=await outreach();const a=(await root('select * from team_attendance where meeting_id=$1 and student_id=$2',[m,id(3)]))[0];
 const p={meeting_id:m,attendance_id:a.id,version:a.version,checked_in_at:'2026-01-01T10:00Z',left_at:'2026-01-01T11:00Z',reason:'Synthetic verification with event lead'};
 await as(3);await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify(p)]),/leadership/);
 await as(1);await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify({...p,reason:''})]),/verified/);
 await db.query('select team_attendance_outreach_correct($1)',[JSON.stringify(p)]);expect((await report()).members[0].hours).toBe(1);
 expect((await root("select after_data->>'reason' reason from team_attendance_history where action='OUTREACH_TIME_CORRECTION' and entity_id=$1",[a.id]))[0].reason).toBe(p.reason);
 await as(1);await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify(p)]),/changed/);
});

test('normal required meetings retain automatic absence strikes',async()=>{
 await root("update team_meetings set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour',status='closed',check_in_open=false where id=$1",[mid]);
 const m=(await root('select version from team_meetings where id=$1',[mid]))[0];
 const ids=(await root("select a.id from team_attendance a join team_meeting_members mm using(meeting_id,student_id) where a.meeting_id=$1 and mm.required and a.physical_status='pending' and a.review_status='none' order by a.id",[mid])).map((a:any)=>a.id);
 await manage('finalize',{meeting_id:mid,version:m.version,automatic_absence_strike_count:ids.length,automatic_absence_strike_attendance_ids:ids});
 expect((await root('select count(*)::int n from team_attendance_strikes where meeting_id=$1',[mid]))[0].n).toBe(ids.length);expect(ids.length).toBeGreaterThan(0);
});

test('legacy correction and excuse-review payloads cannot erase or bypass verified outreach times',async()=>{
 const m=await outreach();await root("update team_attendance set checked_in_at='2026-01-01T10:00Z',left_at='2026-01-01T12:05Z',physical_status='present' where meeting_id=$1 and student_id=$2",[m,id(3)]);
 const a=(await root('select * from team_attendance where meeting_id=$1 and student_id=$2',[m,id(3)]))[0];
 for(const payload of [{physical_status:'present',review_status:'excused'},{physical_status:'left_early',left_at:'2099-01-01T10:00Z'},{review_status:'excused'}]){
 await rejects(()=>manage('attendance',{meeting_id:m,attendance_id:a.id,version:a.version,explanation:'Synthetic rejected legacy correction',...payload}),/verified outreach time correction/);
 expect((await root('select * from team_attendance where id=$1',[a.id]))[0]).toEqual(a);
 }
});

test('current and legacy notice RPCs cannot create unreviewable outreach excuse requests',async()=>{
 const m=(await manage('create',{title:'Upcoming outreach',meeting_type:'stem_outreach',requirement:'active',starts_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString()})).id;
 const a=(await root('select * from team_attendance where meeting_id=$1 and student_id=$2',[m,id(3)]))[0];await as(3);
 await rejects(()=>db.query('select team_attendance_request($1)',[JSON.stringify({meeting_id:m,version:a.version,notice_type:'absent',reason:'Synthetic rejected outreach request'})]),/does not require an excuse request/);
 await rejects(()=>db.query('select team_attendance_notice($1,$2)',[m,'Synthetic rejected legacy request']),/does not require an excuse request/);
 expect((await root('select * from team_attendance where id=$1',[a.id]))[0]).toEqual(a);
});

test('verified-time correction rejects invalid intervals and cross-event records without writes',async()=>{
 const m=await outreach(),other=await outreach('Other event');const a=(await root('select * from team_attendance where meeting_id=$1 and student_id=$2',[m,id(3)]))[0];
 const base={meeting_id:m,attendance_id:a.id,version:a.version,checked_in_at:'2026-01-01T10:00Z',left_at:'2026-01-01T11:00Z',reason:'Synthetic verified interval'};
 for(const invalid of [
  {checked_in_at:'2026-01-01T11:00Z',left_at:'2026-01-01T11:00Z'},
  {checked_in_at:'2026-01-01T11:01Z',left_at:'2026-01-01T11:00Z'},
  {checked_in_at:'2026-01-01T09:29Z'}, {left_at:'2026-01-01T12:30Z'},
  {checked_in_at:'-infinity'}, {left_at:'infinity'}, {checked_in_at:null}, {left_at:null},
 ]){await as(1);await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify({...base,...invalid})]),/attendance window/);expect((await root('select * from team_attendance where id=$1',[a.id]))[0]).toEqual(a);}
 await as(1);await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify({...base,meeting_id:other})]),/record not found/);
 const live=(await manage('create',{title:'Current outreach',meeting_type:'stem_outreach',requirement:'optional',starts_at:new Date(Date.now()-600000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()})).id;
 const liveA=(await root('select * from team_attendance where meeting_id=$1 and student_id=$2',[live,id(3)]))[0];await as(1);
 await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify({...base,meeting_id:live,attendance_id:liveA.id,version:liveA.version,checked_in_at:new Date(Date.now()-300000).toISOString(),left_at:new Date(Date.now()+300000).toISOString()})]),/cannot be in the future/);
});

test('outreach role matrix retains existing leadership access without promoting student reviewers',async()=>{
 const m=await outreach();const a=(await root('select * from team_attendance where meeting_id=$1 and student_id=$2',[m,id(3)]))[0];
 for(const actor of [2,4,1,6]){const r=await report(actor);expect(r.members.length).toBeGreaterThan(1);expect(r.can_configure).toBe([1,6].includes(actor));}
 for(const actor of [2,3,4]){await as(actor);await rejects(()=>db.query('select team_attendance_outreach_goal($1)',[JSON.stringify({version:1,target_hours:9})]),/Mentor or admin/);}
 for(const actor of [3,4]){await as(actor);await rejects(()=>db.query('select team_attendance_outreach_correct($1)',[JSON.stringify({meeting_id:m,attendance_id:a.id,version:1,checked_in_at:'2026-01-01T10:00Z',left_at:'2026-01-01T11:00Z',reason:'Synthetic rejected correction'})]),/leadership/);}
 for(const actor of [7,8])await rejects(()=>report(actor),/Active Attendance access/);
});

test('new endpoint and private-policy permissions deny anonymous and direct table writes',async()=>{
 await db.exec('reset role;set role anon');
 for(const q of ['select team_attendance_outreach_summary(null)',"select team_attendance_outreach_goal('{}'::jsonb)","select team_attendance_outreach_correct('{}'::jsonb)"]){await rejects(()=>db.query(q),/permission denied/);}
 await as(3);await rejects(()=>db.query('select * from team_attendance_private.outreach_goal'),/permission denied/);
 await rejects(()=>db.query('update team_attendance set left_at=clock_timestamp()'),/permission denied/);
});
