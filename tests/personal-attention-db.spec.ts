import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const as=async(n:number)=>db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);
const mine=async()=> (await db.query<any>('select planning_my_work_context() c')).rows[0].c;
const repairs=async()=> (await db.query<any>(`select id,title,status,assigned_to from pit_issues where assigned_to=auth.uid() and status in ('OPEN','DIAGNOSING','REPAIRING','TESTING','DEFERRED') order by updated_at desc,id limit 3`)).rows;
test.beforeEach(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,display_name text,role text,active boolean);create table areas(id uuid primary key,name text,active boolean);create table team_positions(key text primary key,active boolean);create table team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
 insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Member A','student',true),('${id(3)}','Member B','student',true),('${id(4)}','Inactive','student',false),('${id(5)}','Read only','readonly',true);
 grant select on profiles to authenticated;`);
 // Byte-identical Pit baseline migration from 82195ca; fixture only, never applied remotely.
 await db.exec(readFileSync('tests/fixtures/pit_operations_attention.sql','utf8'));
 for(const file of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(`insert into pit_events(id,name,start_date,end_date,status) values('${id(10)}','Current','2026-10-05','2026-10-06','active'),('${id(11)}','Previous','2026-09-01','2026-09-02','completed');
 insert into pit_issues(id,event_id,title,subsystem,severity,status,description,reported_by,assigned_to) values
 ('${id(20)}','${id(10)}','Assigned open','Electrical','HIGH','REPAIRING','Fixture','${id(1)}','${id(2)}'),
 ('${id(21)}','${id(10)}','Other member repair','Electrical','LOW','OPEN','Fixture','${id(1)}','${id(3)}'),
 ('${id(22)}','${id(11)}','Older deferred repair','Electrical','ROBOT DOWN','DEFERRED','Fixture','${id(1)}','${id(2)}'),
 ('${id(23)}','${id(10)}','Resolved repair','Electrical','LOW','RESOLVED','Fixture','${id(1)}','${id(2)}');
 insert into planning_seasons(id,name,status,created_by) values('${id(30)}','Current','active','${id(1)}');
 insert into planning_boards(id,season_id,name,kind,created_by) values('${id(31)}','${id(30)}','Robot','project','${id(1)}');
 insert into planning_tasks(id,board_id,title,status,created_by) values('${id(40)}','${id(31)}','Shared assignment','todo','${id(1)}'),('${id(41)}','${id(31)}','Other assignment','todo','${id(1)}');
 insert into planning_task_assignees(task_id,user_id) values('${id(40)}','${id(2)}'),('${id(40)}','${id(3)}'),('${id(41)}','${id(3)}');`);
});
test.afterEach(()=>db.close());
test('existing RPC scopes co-owned Planning tasks to current actor and rejects client actor injection',async()=>{
 await as(2);expect((await mine()).tasks.map((t:any)=>t.id)).toEqual([id(40)]);expect((await mine()).user_id).toBe(id(2));
 await as(3);expect((await mine()).tasks.map((t:any)=>t.id).sort()).toEqual([id(40),id(41)]);
 await expect(db.query('select planning_my_work_context(user_id=>$1::uuid)',[id(2)])).rejects.toThrow(/does not exist/);
 await db.exec(`reset role;delete from planning_task_assignees where task_id='${id(40)}' and user_id='${id(2)}'`);await as(2);expect((await mine()).tasks).toEqual([]);
});
test('existing Pit RLS and explicit personal filter retain deferred work and exclude resolved/other assignments',async()=>{
 await as(2);expect((await repairs()).map(r=>r.id).sort()).toEqual([id(20),id(22)]);
 await as(3);expect((await repairs()).map(r=>r.id)).toEqual([id(21)]);
 await db.exec(`reset role;update pit_issues set assigned_to='${id(3)}' where id='${id(20)}'`);await as(2);expect((await repairs()).map(r=>r.id)).toEqual([id(22)]);
 await db.exec(`reset role;update pit_issues set status='RESOLVED' where id='${id(22)}'`);await as(2);expect(await repairs()).toEqual([]);
});
test('inactive and anonymous actors cannot retrieve assignments; access revocation is current',async()=>{
 await as(4);expect(await repairs()).toEqual([]);await expect(mine()).rejects.toThrow(/Active/);
 await as(2);expect((await mine()).tasks).toHaveLength(1);await db.exec(`reset role;update profiles set active=false where id='${id(2)}'`);await as(2);expect(await repairs()).toEqual([]);await expect(mine()).rejects.toThrow(/Active/);
 await db.exec('reset role;set role anon');await expect(repairs()).rejects.toThrow(/permission/);await expect(mine()).rejects.toThrow(/permission/);
});
test('read-only integration preserves write protections and does not create history or notifications',async()=>{
 await as(2);const before=(await db.query<any>('select count(*)::int n from pit_issue_events')).rows[0].n;await mine();await repairs();await mine();await repairs();
 expect((await db.query<any>('select count(*)::int n from pit_issue_events')).rows[0].n).toBe(before);
 await expect(db.exec("update pit_issues set title='Not allowed'")).rejects.toThrow(/permission/);
 await expect(db.exec('delete from planning_task_assignees')).rejects.toThrow(/permission/);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from planning_private.history')).rows[0].n).toBe(0);
 expect((await db.query<any>("select to_regclass('public.team_notifications') n")).rows[0].n).toBeNull();
});
