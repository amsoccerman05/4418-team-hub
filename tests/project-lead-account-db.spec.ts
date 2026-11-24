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

// These exercise the account-role migration, not the retired position baseline.
const context=async()=>(await db.query<any>('select planning_context($1) c',[season])).rows[0].c;
const current=async(taskId=task)=>(await context()).tasks.find((t:any)=>t.id===taskId);
async function memberPayload(n:number,role:string){
 await db.exec('reset role');
 const profile=(await db.query<any>('select * from profiles where id=$1',[id(n)])).rows[0];
 const membership=(await db.query<any>('select * from team_attendance_members where student_id=$1',[id(n)])).rows[0];
 return {user_id:id(n),display_name:profile.display_name,role,active:profile.active,
  expected_updated_at:profile.updated_at,expected_member_status:membership?.member_status??null,
  expected_team_area:membership?.team_area??null,member_status:membership?.member_status??null,
  primary_area_id:profile.primary_area_id,reason:'Synthetic account-role review'};
}
test('audited assignment and removal revoke unowned writes but preserve owned Student work',async()=>{
 const assignment=await memberPayload(2,'project_lead');await as(1);
 await db.query('select team_manage_v2($1,$2)',['member',JSON.stringify(assignment)]);
 await as(2);
 const unowned=await save('task',{board_id:board,title:'Another member owns this',status:'todo',priority:'normal',owner_ids:[id(6)]});
 const stale=await current(unowned);
 const step=await save('step',{task_id:unowned,text:'Created while Project Lead'});
 const removal=await memberPayload(2,'student');await as(1);
 await db.query('select team_manage_v2($1,$2)',['member',JSON.stringify(removal)]);
 // The same identity/session now has only ordinary Student permissions.
 await as(2);expect((await context()).can_manage_tasks).toBe(false);expect((await context()).can_write).toBe(true);
 await denies(()=>save('task',{...stale,title:'Stale privileged draft'}));
 await denies(()=>save('step',{id:step,version:1,task_id:unowned,text:'Stale checklist',done:true}));
 await denies(()=>save('task',{board_id:board,title:'New after removal',status:'todo',priority:'normal'}));
 await save('task',{...await current(),description:'Still my assigned Student work'});
 await save('step',{task_id:task,text:'Student checklist'});
 await save('comment',{task_id:unowned,text:'Ordinary Student comment'});
 await denies(async()=>save('task',{...await current(),owner_ids:[id(6)]}),/reassign/);
 await db.exec('reset role');
 const audit=(await db.query<any>("select before_data->'profile'->>'role' before_role,after_data->'profile'->>'role' after_role,actor_id,reason from team_private.management_history where user_id=$1 and action='member' order by created_at,id",[id(2)])).rows;
 expect(audit).toEqual(expect.arrayContaining([
  expect.objectContaining({before_role:'student',after_role:'project_lead',actor_id:id(1),reason:assignment.reason}),
  expect.objectContaining({before_role:'project_lead',after_role:'student',actor_id:id(1),reason:removal.reason})]));
 expect(audit).toHaveLength(2);
});
test('only authorized active mentor can assign Account role; stale member versions fail closed',async()=>{
 const payload=await memberPayload(2,'project_lead');
 for(const actor of [2,3,4,5,6,7]){await as(actor);await denies(()=>db.query('select team_manage_v2($1,$2)',['member',JSON.stringify(payload)]));}
 await as(1);await db.query('select team_manage_v2($1,$2)',['member',JSON.stringify(payload)]);
 await denies(()=>db.query('select team_manage_v2($1,$2)',['member',JSON.stringify({...payload,role:'student'})]),/changed/i);
 await db.exec('reset role');expect((await db.query<any>('select role from profiles where id=$1',[id(2)])).rows[0].role).toBe('project_lead');
});
test('account-role task and checklist rights span active project and area boards only',async()=>{
 await as(1);
 const second=await save('board',{season_id:season,kind:'project',name:'Second project'});
 const area=await save('board',{kind:'area',name:'Functional board',area_id:id(101)});
 for(const target of [board,second,area]){
  await as(6);const created=await save('task',{board_id:target,title:'Cross-board card',status:'todo',priority:'normal',owner_ids:[id(2)]});
  await save('task',{...await current(created),title:'Edited cross-board card',owner_ids:[id(2),id(6)]});
  const step=await save('step',{task_id:created,text:'Check this'});
  await save('step',{id:step,task_id:created,version:1,text:'Checked',done:true});
  const detail=(await db.query<any>('select planning_task_detail($1) d',[created])).rows[0].d;
  expect(detail.steps[0]).toMatchObject({text:'Checked',done:true,version:2});
 }
 for(const status of ['draft','archived']){
  await db.exec(`reset role;update planning_seasons set status='${status}' where id='${season}'`);await as(6);
  await denies(()=>save('task',{board_id:second,title:'Unavailable',status:'todo',priority:'normal'}),/Season/);
  await save('task',{board_id:area,title:'Area remains available',status:'todo',priority:'normal'});
 }
 await db.exec(`reset role;update planning_seasons set status='active';update planning_boards set active=false where id='${second}'`);await as(6);
 await denies(()=>save('task',{board_id:second,title:'Inactive board',status:'todo',priority:'normal'}),/Active board/);
 await denies(()=>db.query('select planning_private.project_lead()'));
 await denies(()=>db.exec('insert into planning_tasks default values'));
});

test('Student and Project Lead match shared-suite predicates and Finance compatibility response',async()=>{
 const snapshots:any[]=[];
 for(const role of ['student','project_lead']){
  await db.exec(`reset role;update profiles set role='${role}' where id='${id(6)}'`);
  const flags=(await db.query<any>(`select team_attendance_private.is_participant(auth.uid()) attendance,
   team_attendance_private.is_program_manager(auth.uid()) attendance_manage,
   planning_goals_private.goal_student(auth.uid()) goal_student,
   planning_goals_private.goal_contributor(auth.uid()) goal_contributor,
   private.can_count() inventory,private.can_create_item(null) inventory_create,
   private.can_create_assigned_lead_location() inventory_location,
   fabrication_private.manager(auth.uid()) fabrication_manage,
   finance_private.creator() finance_create,finance_private.can_manage_budget() budget_manage,
   finance_private.cap('finance_approver') finance_approve,finance_private.cap('po_approver') po_approve,
   finance_private.cap('school_submitter') school_submit,
   pit_private.competition_manager() pit_manage,planning_private.manager() planning_manage`)).rows[0];
  snapshots.push(flags);
  await as(6);const finance=(await db.query<any>('select finance_context() c')).rows[0].c;
  expect(finance.profile.role).toBe('student');expect(finance.can_create).toBe(true);
  expect(finance.is_admin).toBe(false);expect(finance.capabilities).toEqual([]);
 }
 expect(snapshots[1]).toEqual(snapshots[0]);
 expect(snapshots[1]).toEqual({attendance:true,attendance_manage:false,goal_student:true,goal_contributor:true,
  inventory:true,inventory_create:true,inventory_location:false,fabrication_manage:false,
  finance_create:true,budget_manage:false,finance_approve:false,po_approve:false,school_submit:false,
  pit_manage:false,planning_manage:false});
});
test('readonly or inactive former Project Lead cannot edit retained owned tasks or checklists',async()=>{
 await save('task',{...await current(),owner_ids:[id(6)]});
 const owned=await current();const step=await save('step',{task_id:task,text:'Retained checklist'});
 for(const change of ["role='readonly'","role='project_lead',active=false"]){
  await db.exec(`reset role;update profiles set ${change} where id='${id(6)}'`);await as(6);
  await denies(()=>save('task',{...owned,description:'Stale owner edit'}));
  await denies(()=>save('step',{id:step,task_id:task,version:1,text:'Stale step',done:true}));
  await denies(()=>save('comment',{task_id:task,text:'Stale comment'}));
 }
});
