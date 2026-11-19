import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {coreBaseline} from './fixtures/student-role-core';
import type {PGlite} from '@electric-sql/pglite';
const migration=readFileSync('supabase/migrations/20261119232042_project_lead_account_role.sql','utf8');
const reviewed=JSON.parse(readFileSync('tests/fixtures/project-lead-account-reviewed-functions.json','utf8'));
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db:PGlite,season:string,board:string,task:string;
const as=async(n:number)=>db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);
const save=async(entity:string,p:unknown)=>(await db.query<any>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;
async function denies(fn:()=>Promise<unknown>,pattern=/permission|leadership|writer|assigned|mentor|account/i){await db.exec('savepoint attempt');await expect(fn()).rejects.toThrow(pattern);await db.exec('rollback to attempt');}
async function baseline(){
 const d=await coreBaseline();
 for(const file of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql','20261018051320_planning_current_writer_guard.sql','20261118015929_planning_project_lead.sql'])await d.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await d.exec(`alter table profiles drop constraint profiles_role_check;alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','mentor'));set check_function_bodies=off;`);
 for(const schema of new Set(reviewed.map((f:any)=>f.nspname)))await d.exec(`create schema if not exists ${schema};`);
 await d.exec('create table team_notifications(id uuid);');
 for(const f of reviewed)await d.exec(f.definition);
 await d.exec(`create or replace function pit_private.current_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active$$;
 create table if not exists finance_private.budget_positions(position_key text);
 create or replace function private.can_edit(area uuid) returns boolean language sql stable as $$select false$$;
 create or replace function team_private.admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role='mentor')$$;
 create or replace function finance_private.admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce(finance_private.role()='mentor',false)$$;`);
 for(const [t,p] of [['pit_batteries','pit_member_read'],['pit_battery_events','pit_member_read'],['pit_events','pit_member_read'],['pit_issue_events','pit_member_read'],['pit_issues','pit_member_read'],['pit_manual_match_events','competition_read'],['pit_scouting_assignments','scouting_read'],['pit_scouting_management_events','scouting_read'],['pit_scouting_observations','scouting_read'],['pit_scouting_picklist','scouting_read']])await d.exec(`create table ${t}(id uuid);alter table ${t} enable row level security;create policy ${p} on ${t} for select to authenticated using((select pit_private.current_role())=any(array['readonly','student','lead','admin_lead','mentor']));`);
 return d;
}
test.beforeAll(async()=>{db=await baseline();await db.exec(migration);await as(1);season=await save('season',{name:'Season',status:'active'});board=await save('board',{season_id:season,kind:'project',name:'Board'});task=await save('task',{board_id:board,title:'Student task',status:'todo',priority:'normal',owner_ids:[id(2)]});await db.exec(`reset role;insert into profiles(id,display_name,role,active) values('${id(6)}','Project Lead','project_lead',true),('${id(7)}','Admin Lead','admin_lead',true);`);});
test.afterAll(()=>db?.close());test.beforeEach(async()=>{await as(6);await db.exec('begin');});test.afterEach(()=>db.exec('rollback'));
test('actual account role can create assign edit cards/checklists without a position',async()=>{
 const c=(await db.query<any>('select planning_context($1) c',[season])).rows[0].c;expect(c.can_manage_tasks).toBe(true);expect(c.can_manage).toBe(false);expect(c.can_write).toBe(true);
 await save('task',{board_id:board,title:'Lead card',status:'todo',priority:'normal',owner_ids:[id(2)]});await save('step',{task_id:task,text:'Test checklist'});
 const t=c.tasks.find((x:any)=>x.id===task);await save('task',{...t,title:'Edited',owner_ids:[id(6)]});
 for(const entity of ['season','board','group','item'])await denies(()=>save(entity,{name:'Forbidden'}));await denies(()=>db.query("select planning_dependency_save('add',$1,$1)",[task]));
});
test('normal student rights unchanged; retired position cannot grant role capability',async()=>{await as(2);await denies(()=>save('task',{board_id:board,title:'No',status:'todo',priority:'normal'}));await db.exec(`reset role;update team_positions set active=true where key='project_lead';insert into team_member_positions(user_id,position_key,assigned_by,assignment_reason) values('${id(2)}','project_lead','${id(1)}','obsolete');`);await as(2);expect((await db.query<any>('select planning_context($1) c',[season])).rows[0].c.can_manage_tasks).toBe(false);});
test('demotion and deactivation remove card capability immediately',async()=>{for(const sql of ["role='student'","role='readonly'","role='project_lead',active=false"]){await db.exec(`reset role;update profiles set ${sql} where id='${id(6)}'`);await as(6);await denies(()=>save('task',{board_id:board,title:'No',status:'todo',priority:'normal'}));}});
test('student parity preserves attendance inventory finance and Pit baseline, not management',async()=>{
 await db.exec('reset role');const v=(await db.query<any>(`select team_attendance_private.is_participant(auth.uid()) attendance,private.can_count() inventory,private.can_create_item(null) items,finance_private.creator() finance_create,finance_private.admin() finance_admin,finance_private.cap('finance_approver') finance_approve,pit_private.competition_manager() pit_manage,planning_private.manager() plan_manage,team_private.admin() team_admin`)).rows[0];expect(v).toEqual({attendance:true,inventory:true,items:true,finance_create:true,finance_admin:false,finance_approve:false,pit_manage:false,plan_manage:false,team_admin:false});
});
test('Project Lead cannot assign roles, invite or directly write profiles',async()=>{await denies(()=>db.query("select team_manage('member','{}')"));await denies(()=>db.query("select team_invitation_reserve('{}')"));await denies(()=>db.exec("update profiles set role='mentor' where id='"+id(6)+"'"));});
test('migration makes no account assignments and retains profile roles',async()=>{await db.exec('reset role');expect((await db.query<any>('select role from profiles where id=$1',[id(2)])).rows[0].role).toBe('student');expect((await db.query<any>("select active from team_positions where key='project_lead'")).rows[0].active).toBe(false);});
test('unknown function drift fails migration atomically',async()=>{const other=await baseline();await other.exec("create or replace function private.can_count() returns boolean language sql as $$select false$$");await expect(other.exec(migration)).rejects.toThrow(/drift/);await other.exec('rollback');expect((await other.query<any>("select pg_get_constraintdef(oid) c from pg_constraint where conname='profiles_role_check'")).rows[0].c).not.toContain('project_lead');await other.close();});
test('new position holders halt conversion rather than overwrite or strip their existing roles',async()=>{const other=await baseline();await other.exec(`insert into team_member_positions(user_id,position_key,assigned_by,assignment_reason) values('${id(3)}','project_lead','${id(1)}','existing holder')`);await expect(other.exec(migration)).rejects.toThrow(/position has holders/);await other.exec('rollback');expect((await other.query<any>('select role from profiles where id=$1',[id(3)])).rows[0].role).toBe('lead');await other.close();});
test('mentor assigns actual account role through existing audited member editor',async()=>{
 await db.exec('reset role');const p=(await db.query<any>('select * from profiles where id=$1',[id(2)])).rows[0];await as(1);
 await db.query('select team_manage_v2($1,$2)',['member',JSON.stringify({user_id:id(2),display_name:p.display_name,role:'project_lead',active:true,expected_updated_at:p.updated_at,expected_member_status:'prospective',expected_team_area:'',member_status:'prospective',team_area:'',reason:'Lead assignment'})]);
 await as(2);expect((await db.query<any>('select planning_context($1) c',[season])).rows[0].c.can_manage_tasks).toBe(true);
 await db.exec('reset role');expect((await db.query<any>('select role from profiles where id=$1',[id(2)])).rows[0].role).toBe('project_lead');expect((await db.query<any>('select count(*)::int n from team_private.management_history where user_id=$1',[id(2)])).rows[0].n).toBeGreaterThan(0);
});
test('retired position cannot be recreated or reactivated by management RPC',async()=>{await as(1);await denies(()=>db.query('select team_manage_v2($1,$2)',['position_save',JSON.stringify({key:'project_lead',reason:'Attempt',create:false,active:true})]),/account role|retired/);});

test('unexpected Pit policy drift fails closed',async()=>{const d=await baseline();try{await d.exec('alter policy pit_member_read on pit_batteries using(false)');await expect(d.exec(migration)).rejects.toThrow(/policy drift/);await d.exec('rollback');expect((await d.query<any>("select count(*)::int n from profiles where role='project_lead'")).rows[0].n).toBe(0);}finally{await d.close();}});
