import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261015071925_frc_2027_kickoff_reset.sql','utf8');
let db:PGlite;
test.setTimeout(90_000);
test.beforeEach(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create schema team_attendance_private;
 create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
 create function team_attendance_private.role() returns text language sql as $$select 'student'::text$$;
 create table profiles(id uuid,display_name text,role text,active boolean);
 create table team_positions(key text,name text,active boolean);
 create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
 create table team_attendance_history(id int,student_id uuid,performed_at timestamptz,performed_by uuid,after_data jsonb,entity text,action text);
 create table notice_fixture(assigned_at timestamptz,quantity int,rescinded_at timestamptz);
 insert into notice_fixture values('2026-12-31T23:00Z',1,null),('2027-01-08T23:00-07',2,null),('2027-01-09T00:00-07',1,null),('2027-01-09T00:01-07',2,'2027-01-10T00:00Z');`);
 for(const name of ['participant','reviewer','request_reviewer','reader','manager'])await db.exec(`create function team_attendance_private.${name}() returns boolean language sql as $$select false$$`);
 for(const name of ['is_lead_coach','is_program_manager'])await db.exec(`create function team_attendance_private.${name}(uuid) returns boolean language sql as $$select false$$`);
 await db.exec(migration);
});
test.afterEach(()=>db.close());
test('exact Denver kickoff boundary, no January 1 reset, no invented future reset',async()=>{
 for(const [input,expected] of [
 ['2026-10-15T12:00Z','2026-01-01T00:00:00.000Z'],
 ['2027-01-01T00:00Z','2026-01-01T00:00:00.000Z'],
 ['2027-01-09T06:59:59.999Z','2026-01-01T00:00:00.000Z'],
 ['2027-01-09T07:00Z','2027-01-09T07:00:00.000Z'],
 ['2028-01-01T00:00Z','2027-01-09T07:00:00.000Z']]) {
  const r=await db.query<any>('select team_attendance_private.notice_window_start($1) boundary',[input]);expect(new Date(r.rows[0].boundary).toISOString()).toBe(expected);
 }
 await db.exec("set timezone='Pacific/Auckland'");
 const r=await db.query<any>("select team_attendance_private.notice_window_start('2027-01-09T07:00Z') boundary");expect(new Date(r.rows[0].boundary).toISOString()).toBe('2027-01-09T07:00:00.000Z');
});
test('window filters counts and completed follow-ups while preserving every historical row',async()=>{
 await db.exec(`insert into team_attendance_history values
 (1,auth.uid(),'2027-01-09T06:59:59Z',auth.uid(),'{}','attendance_policy','WARNING_PARENT_CONTACT'),
 (2,auth.uid(),'2027-01-09T07:00:00Z',auth.uid(),'{}','attendance_policy','WARNING_PARENT_CONTACT');`);
 const before=(await db.query('select * from team_attendance_history order by id')).rows;
 const notices=(await db.query('select * from notice_fixture order by assigned_at')).rows;
 // Pin the helper in this isolated test DB so the real RPC is exercised at the reset.
 await db.exec(`create or replace function team_attendance_private.notice_window_start(as_of timestamptz) returns timestamptz language sql immutable strict security invoker set search_path='' as $$select timestamptz '2027-01-09T07:00Z'$$`);
 const c=(await db.query<any>('select public.team_attendance_policy_context() c')).rows[0].c;
 expect(new Date(c.strike_year_start).toISOString()).toBe('2027-01-09T07:00:00.000Z');expect(c.warnings).toHaveLength(1);expect(c.people).toEqual([]);
 expect((await db.query<any>('select sum(quantity)::int n from notice_fixture where assigned_at >= $1 and rescinded_at is null',[c.strike_year_start])).rows[0].n).toBe(1);
 expect((await db.query('select * from team_attendance_history order by id')).rows).toEqual(before);
 expect((await db.query('select * from notice_fixture order by assigned_at')).rows).toEqual(notices);
 await db.exec(`create or replace function team_attendance_private.role() returns text language sql as $$select null::text$$`);
 await expect(db.query('select public.team_attendance_policy_context()')).rejects.toThrow(/Active Attendance account required/);
});

test('existing RPC changes only its boundary assignment and preserves its authorization contract',()=>{
 const old=readFileSync('supabase/migrations/20261008063138_attendance_coach_request_review.sql','utf8');
 const start='create or replace function public.team_attendance_policy_context()';
 const expected=old.slice(old.indexOf(start),old.lastIndexOf('commit;')).trim().replace("-- User-approved annual reset: January 1, using the database UTC calendar.\n boundary:=date_trunc('year',now() at time zone 'UTC') at time zone 'UTC';",'-- Keep the current window through January 8, then start the 2027 season.\n boundary:=team_attendance_private.notice_window_start(now());');
 expect(migration.slice(migration.indexOf(start),migration.lastIndexOf('commit;')).trim()).toBe(expected);
 expect(migration).not.toMatch(/\b(delete|update|insert|truncate|drop)\s/i);
});
