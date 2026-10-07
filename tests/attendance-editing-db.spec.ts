import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
let db: PGlite;
let mid: string;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const future = (hours: number) => new Date(Date.now()+hours*3600000).toISOString();
async function as(n: number) { await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`); }
async function rows(q: string, args: any[] = []) { return (await db.query<any>(q,args)).rows; }
async function manage(action: string, p: any) { return (await rows('select team_attendance_manage($1,$2::jsonb) r',[action, JSON.stringify(p)]))[0].r; }
async function meeting() { return (await rows('select id,title,meeting_type,starts_at,ends_at,version,status,check_in_open,code_expires_at,requirement,late_minutes,created_by,created_at from team_meetings where id=$1',[mid]))[0]; }
async function draft(extra = {}) { const m = await meeting(); return {meeting_id: mid, version: m.version, title:m.title,meeting_type:m.meeting_type,starts_at:m.starts_at,ends_at:m.ends_at,...extra}; }
async function edit(p: any) { return (await rows('select team_attendance_edit_meeting($1::jsonb) r',[JSON.stringify(p)]))[0].r; }
async function snapshot() { return (await rows(`select jsonb_build_object('attendance',(select jsonb_agg(to_jsonb(a) order by id) from team_attendance a),'roster',(select jsonb_agg(to_jsonb(a) order by student_id) from team_meeting_members a),'strikes',(select jsonb_agg(to_jsonb(a) order by id) from team_attendance_strikes a)) d`))[0].d; }
test.beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Lead','lead',true),('${id(3)}','Student','student',true),('${id(4)}','Program Manager','student',true),('${id(5)}','Other student','student',true),('${id(6)}','Admin','admin',true),('${id(7)}','Inactive leader','lead',false),('${id(8)}','Readonly','readonly',true);
    create table team_positions(key text primary key,name text,active boolean);insert into team_positions values('program_manager','Program Manager',true);
    create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);insert into team_member_positions values('${id(4)}','program_manager',null);
    create function public.team_has_position(key text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.team_member_positions where user_id=auth.uid() and position_key=$1 and revoked_at is null) $$;
    select set_config('test.uid','${id(1)}',false);`);
  for (const file of ['202609100001_team_attendance.sql','202609120001_attendance_requests_recurrence.sql','202609120008_attendance_roster_sync.sql']) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  // Existing production uses a public audit table; the original local migration
  // has a private table and read facade. Mirror the verified production contract.
  await db.exec(`drop view team_attendance_history;alter table team_attendance_private.history set schema public;alter table public.history rename to team_attendance_history;grant select on team_attendance_history to authenticated;
    create policy attendance_history_read on team_attendance_history for select to authenticated using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
  await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/202609300001_attendance_policy_v03.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261007033053_attendance_meeting_editing.sql','utf8'));
  await as(1);
  mid=(await manage('create',{title:'Synthetic editing meeting',meeting_type:'preseason',requirement:'active',starts_at:future(48),ends_at:future(50)})).id;
});
test.afterEach(() => db.close());
test('existing leadership edits one meeting, preserving roster and records with attributed old/new audit', async () => {
  const before=await snapshot(), original=await meeting();
  const other=(await manage('create',{title:'Other occurrence',meeting_type:'preseason',requirement:'active',starts_at:future(216),ends_at:future(218)})).id;
  const beforeOther=(await rows('select title,version from team_meetings where id=$1',[other]))[0];
  for (const role of [1,2,6]) { await as(role); const p=await draft({title:`Renamed ${role}`,meeting_type:'other'});const r=await edit(p);expect(r.changed).toBe(true); }
  expect((await meeting()).version).toBe(original.version+3);
  expect((await meeting()).requirement).toBe(original.requirement);
  const after=await snapshot();
  expect(after.attendance.filter((a:any)=>a.meeting_id===mid)).toEqual(before.attendance);
  expect(after.roster.filter((a:any)=>a.meeting_id===mid)).toEqual(before.roster);
  expect(after.strikes).toEqual(before.strikes);
  expect((await rows('select title,version from team_meetings where id=$1',[other]))[0]).toEqual(beforeOther);
  const h=(await rows("select * from team_attendance_history where entity='team_meetings' and entity_id=$1 and action='UPDATE' order by id desc limit 1",[mid]))[0];
  expect(h.performed_by).toBe(id(6)); expect(h.before_data.title).toBe('Renamed 2');expect(h.after_data.title).toBe('Renamed 6');
  expect(h.before_data).not.toHaveProperty('code_hash');expect(h.after_data).not.toHaveProperty('code_expires_at');
});
test('students, student Program Managers, readonly, inactive and anonymous cannot edit or write directly',async()=>{
  const p=await draft({title:'Unauthorized edit'});
  for(const n of [3,4,7,8]) {await as(n);await expect(edit(p)).rejects.toThrow(/Leadership access required/);await expect(db.query("update team_meetings set title='Direct edit' where id=$1",[mid])).rejects.toThrow(/permission denied/);}
  await db.exec('reset role;set role anon'); await expect(edit(p)).rejects.toThrow(/permission denied/);
  await db.exec("reset role;select set_config('test.uid','',false);set role authenticated;"); await expect(edit(p)).rejects.toThrow(/Leadership access required/);
  await as(1);expect((await meeting()).title).toBe('Synthetic editing meeting');
});
test('future reschedule needs acknowledgment, supports overnight, invalidates code, preserves pending requests and audit',async()=>{
  await as(3);await db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:mid,version:1,notice_type:'late',expected_at:future(49),reason:'Synthetic schedule conflict'})]);
  await as(1);const preserved=await snapshot();
  await db.exec('reset role');await db.query("update team_meetings set status='open',check_in_open=true,code_hash=sha256(convert_to(id::text||'123456','UTF8')),code_expires_at=now()+interval '30 minutes' where id=$1",[mid]);await as(1);
  const p=await draft({starts_at:'2027-10-07T23:00:00-05:00',ends_at:'2027-10-08T02:00:00-05:00'});
  await expect(edit(p)).rejects.toThrow(/acknowledge/);
  await edit({...p,acknowledge_schedule_change:true});
  const m=await meeting();expect(new Date(m.starts_at).toISOString()).toBe('2027-10-08T04:00:00.000Z');expect(new Date(m.ends_at).toISOString()).toBe('2027-10-08T07:00:00.000Z');expect(m.check_in_open).toBe(false);expect(m.code_expires_at).toBeNull();
  expect(await snapshot()).toEqual(preserved);
  await db.exec('reset role');expect((await rows('select code_hash from team_meetings where id=$1',[mid]))[0].code_hash).toBeNull();
});
test('started, ended and finalized meetings reject every edit',async()=>{
  for(const status of ['open','closed','finalized']) {
    await db.exec('reset role');await db.query("update team_meetings set status=$2,starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' where id=$1",[mid,status]);await as(1);
    const p=await draft({starts_at:future(24),ends_at:future(26),acknowledge_schedule_change:true});
    await expect(edit(p)).rejects.toThrow(/started or attendance is complete/);
    await expect(edit(await draft({title:`Corrected ${status}`}))).rejects.toThrow(/started or attendance is complete/);
  }
});
test('checked-in, reviewed and strike-bearing future meetings retain their schedule and adjudicated data',async()=>{
  const blockers=["checked_in_at=clock_timestamp(),physical_status='present'","review_status='excused',reviewed_at=clock_timestamp()","review_status='denied'"];
  for(const blocker of blockers) {
    await db.exec('reset role');await db.query(`update team_attendance set ${blocker} where meeting_id=$1 and student_id=$2`,[mid,id(3)]);await as(1);
    const before=await snapshot();await expect(edit(await draft({starts_at:future(72),ends_at:future(74),acknowledge_schedule_change:true}))).rejects.toThrow(/Recorded attendance/);
    await edit(await draft({title:`Corrected ${blocker}`}));expect(await snapshot()).toEqual(before);
    await db.exec('reset role');await db.query("update team_attendance set checked_in_at=null,physical_status='pending',review_status='none',reviewed_at=null where meeting_id=$1 and student_id=$2",[mid,id(3)]);await as(1);
  }
  const a=(await rows('select id from team_attendance where meeting_id=$1 and student_id=$2',[mid,id(3)]))[0];
  await manage('strike',{meeting_id:mid,attendance_id:a.id,category:'Other',quantity:1,explanation:'Synthetic review'});
  const before=await snapshot();await expect(edit(await draft({starts_at:future(72),ends_at:future(74),acknowledge_schedule_change:true}))).rejects.toThrow(/Recorded attendance/);expect(await snapshot()).toEqual(before);
});
test('stale writes cannot overwrite; exact retries are no-op with one audit; bad input cannot bypass scope',async()=>{
  const p=await draft({title:'Saved once'});const first=await edit(p);const replay=await edit(p);expect(replay).toEqual({...first,changed:false});
  expect((await rows("select count(*)::int n from team_attendance_history where entity='team_meetings' and entity_id=$1 and action='UPDATE'",[mid]))[0].n).toBe(1);
  await expect(edit({...p,title:'Stale overwrite'})).rejects.toThrow(/Meeting changed/);
  for(const change of [{title:' '},{meeting_type:'new-type'},{ends_at:future(1)},{starts_at:'infinity'},{starts_at:null},{version:null},{requirement:'optional'},{selected_students:[id(5)]},{status:'finalized'},{late_minutes:0}]) await expect(edit(await draft(change))).rejects.toThrow();
  await expect(edit(await draft({starts_at:new Date(Date.now()-60000).toISOString(),ends_at:future(1),acknowledge_schedule_change:true}))).rejects.toThrow(/future/);
  expect((await meeting()).title).toBe('Saved once');
});
test('audit failure rolls back the meeting atomically',async()=>{
  const original=await meeting();await db.exec(`reset role;create function public.fail_attendance_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;create trigger fail_attendance_audit before insert on team_attendance_history for each row execute function public.fail_attendance_audit();`);await as(1);
  await expect(edit(await draft({title:'Must not persist'}))).rejects.toThrow(/synthetic audit failure/);expect(await meeting()).toEqual(original);
});
