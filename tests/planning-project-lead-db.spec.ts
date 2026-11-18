import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite,board:string,season:string,task:string;
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const as=async(n:number)=>db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);
const save=async(entity:string,p:any)=>(await db.query<any>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;
const context=async()=>(await db.query<any>('select planning_context($1) c',[season])).rows[0].c;
const current=async()=>(await context()).tasks.find((t:any)=>t.id===task);
async function denies(fn:()=>Promise<unknown>,pattern=/assigned|leadership|writer|account|permission denied/i){await db.exec('savepoint attempt');await expect(fn()).rejects.toThrow(pattern);await db.exec('rollback to attempt');}
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table profiles(id uuid primary key,display_name text,role text,active boolean);
 create table areas(id uuid primary key,name text,active boolean);
 create table team_positions(key text primary key,name text,active boolean,description text,category text constraint team_positions_category_check check(category in ('Coaching','Program','Functional Leads','Other Leadership')),display_order integer);
 create table team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
 insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Project lead','student',true),('${id(3)}','Student','student',true),('${id(4)}','Read only','readonly',true),('${id(5)}','Inactive','student',false),('${id(6)}','Admin Lead','admin_lead',true);`);
 for(const file of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql','20261018051320_planning_current_writer_guard.sql','20261118015929_planning_project_lead.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await as(1);season=await save('season',{name:'Active',status:'active'});board=await save('board',{season_id:season,kind:'project',name:'Robot'});task=await save('task',{board_id:board,title:'Existing',status:'todo',priority:'normal',owner_ids:[id(3)]});
 await db.exec(`reset role;insert into team_member_positions values('${id(2)}','project_lead',null),('${id(4)}','project_lead',null),('${id(5)}','project_lead',null),('${id(6)}','project_lead',null)`);
});
test.afterAll(()=>db.close());test.beforeEach(async()=>{await as(2);await db.exec('begin');});test.afterEach(()=>db.exec('rollback'));
test('Project Lead creates and assigns a card, updates another card and checklist with audit',async()=>{
 const ctx=await context();expect(ctx.can_manage_tasks).toBe(true);expect(ctx.can_manage).toBe(false);
 const created=await save('task',{board_id:board,title:'New card',status:'todo',priority:'normal',owner_ids:[id(3)]});expect(created).toBeTruthy();
 await save('task',{...await current(),title:'Updated by lead',owner_ids:[id(2),id(3)],status:'in_progress'});
 await save('step',{task_id:task,text:'Check wiring'});await save('comment',{task_id:task,text:'Ready for review'});
 const detail=(await db.query<any>('select planning_task_detail($1) d',[task])).rows[0].d;expect(detail.steps).toHaveLength(1);expect(detail.comments).toHaveLength(1);expect(detail.history.some((h:any)=>h.actor_id===id(2)&&h.entity==='task')).toBe(true);
});
test('normal student remains unable to create or reassign but can edit assigned work',async()=>{
 await as(3);expect((await context()).can_manage_tasks).toBe(false);
 await denies(()=>save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal',owner_ids:[id(3)]}));
 await save('task',{...await current(),description:'My progress'});await save('step',{task_id:task,text:'My checklist'});
 await denies(async()=>save('task',{...await current(),owner_ids:[id(2)]}),/reassign/);
});
test('Project Lead cannot change boards, season plans, dependencies or team access',async()=>{
 for(const entity of ['season','board','item','group'])await denies(()=>save(entity,{name:'Forbidden',title:'Forbidden'}));
 await denies(()=>db.query("select planning_dependency_save('add',$1,$1)",[task]));
 await denies(()=>db.exec("update profiles set role='admin'"));
});
test('revoked or deactivated position immediately loses card creation',async()=>{
 for(const sql of ["update team_member_positions set revoked_at=now() where user_id='"+id(2)+"'", "update team_member_positions set revoked_at=null;update team_positions set active=false where key='project_lead'"]){
 await db.exec('reset role;'+sql);await as(2);expect((await context()).can_manage_tasks).toBe(false);await denies(()=>save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal'}));}
});
test('Read-only and inactive assignees gain no write access; Admin Lead holder does',async()=>{
 for(const n of [4,5]){await as(n);await denies(()=>save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal'}));}
 await as(6);expect((await context()).can_manage_tasks).toBe(true);await save('task',{board_id:board,title:'Allowed',status:'todo',priority:'normal'});
});
test('archived or draft seasons and inactive boards remain protected',async()=>{
 for(const state of ['archived','draft']){await db.exec(`reset role;update planning_seasons set status='${state}' where id='${season}'`);await as(2);await denies(()=>save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal'}),/Season/);}
 await db.exec(`reset role;update planning_seasons set status='active';update planning_boards set active=false where id='${board}'`);await as(2);await denies(()=>save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal'}),/Active board/);
});
test('private helper and direct writes remain inaccessible; project category grants no generic Pit leadership',async()=>{
 await denies(()=>db.query('select planning_private.project_lead()'));await denies(()=>db.exec('insert into planning_tasks default values'));await db.exec('reset role');expect((await db.query<any>("select category from team_positions where key='project_lead'")).rows[0].category).toBe('Project Leads');
});

test('legacy admin role does not regain production Planning write access',async()=>{
 await db.exec("reset role;update profiles set role='admin' where id='"+id(2)+"'");await as(2);expect((await context()).can_write).toBe(false);await denies(()=>save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal'}));
});
