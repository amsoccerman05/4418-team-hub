import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
test.describe.configure({mode:"serial"});
let db:PGlite;
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);}
async function save(entity:string,p:Record<string,unknown>){return (await db.query<{id:string}>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;}
async function context(s?:string){return (await db.query<any>('select planning_context($1) c',[s||null])).rows[0].c;}
async function detail(t:string){return (await db.query<any>('select planning_task_detail($1) d',[t])).rows[0].d;}
let season:string,board:string,task:string,item:string;
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
 create table public.areas(id uuid primary key,name text,active boolean);
 create table public.team_positions(key text primary key,active boolean);
 create table public.team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
 insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Leader','student',true),('${id(3)}','Owner','student',true),('${id(4)}','Unrelated','lead',true),('${id(5)}','Inactive','mentor',false);
 insert into areas values('${id(10)}','Software',true);insert into team_positions values('software_lead',true);insert into team_member_positions values('${id(2)}','software_lead',null);`);
 await db.exec(readFileSync('supabase/migrations/202610020001_planning_v1.sql','utf8'));await as(1);
});
test.afterAll(()=>db.close());
test('active position leadership, not base role; one active season and stale edits',async()=>{
 await as(4);await expect(save('season',{name:'Forbidden'})).rejects.toThrow(/leadership/);
 await as(5);await expect(context()).rejects.toThrow(/Active team/);
 await as(2);season=await save('season',{name:'2027',status:'draft'});let c=await context();expect(c.can_manage).toBe(true);
 await save('season',{...c.seasons[0],status:'active'});
 await expect(save('season',{name:'Second',status:'active'})).rejects.toThrow(/unique/);
 await expect(save('season',{...c.seasons[0],name:'Stale'})).rejects.toThrow(/Changed/);
 await as(4);expect((await context()).can_manage).toBe(false);
});
test('groups, work, milestone, finish-to-start dependency and cycle/season validation',async()=>{
 await as(2);const group=await save('group',{season_id:season,name:'Robot'});
 item=await save('item',{season_id:season,title:'CAD',kind:'work',status:'not_started',start_date:'2027-01-10',end_date:'2027-01-20',group_id:group});
 const milestone=await save('item',{season_id:season,title:'Design freeze',kind:'milestone',status:'not_started',start_date:'2027-01-21',end_date:'2027-01-21',predecessor_id:item});
 const c=await context();expect(c.items).toHaveLength(2);
 await expect(save('item',{...c.items.find((i:any)=>i.id===item),predecessor_id:milestone})).rejects.toThrow(/cycle/);
 await expect(save('group',{...c.groups[0],active:false})).rejects.toThrow(/Move plan items/);
 await save('item',{...c.items.find((i:any)=>i.id===item),status:'in_progress'});
 expect((await context()).items.find((i:any)=>i.id===item).status).toBe('in_progress');
});
test('project and persistent functional boards, assigned task updates and reassign denial',async()=>{
 await as(2);board=await save('board',{season_id:season,kind:'project',name:'Intake'});
 await save('board',{kind:'area',name:'Admin',area_id:id(10)});
 task=await save('task',{board_id:board,title:'Cut shafts',status:'todo',priority:'normal',owner_id:id(3)});
 await as(4);let t=(await context()).tasks[0];await expect(save('task',{...t,status:'done'})).rejects.toThrow(/assigned/);
 await expect(save('task',{board_id:board,title:'Forbidden',status:'todo',priority:'normal'})).rejects.toThrow(/assigned/);
 await as(3);await expect(save('task',{...t,owner_id:id(4)})).rejects.toThrow(/reassign/);
 await save('task',{...t,status:'blocked',blocked_reason:'Waiting on CAD'});t=(await context()).tasks[0];
 await save('task',{...t,status:'done'});expect((await context()).tasks[0].status).toBe('done');
});
test('checklist, comments and history are scoped and server-authored',async()=>{
 await as(3);const step=await save('step',{task_id:task,text:'Measure twice'});let d=await detail(task);
 await save('step',{...d.steps[0],done:true});await save('comment',{task_id:task,text:'Ready for assembly',author_id:id(1)});d=await detail(task);
 expect(d.steps[0].id).toBe(step);expect(d.steps[0].done).toBe(true);expect(d.comments[0].author_id).toBe(id(3));expect(d.history.some((h:any)=>h.before_data?.status==='blocked'&&h.after_data.status==='done')).toBe(true);
 await expect(db.exec('select * from planning_tasks')).rejects.toThrow(/permission denied/);
 await db.exec('reset role;set role anon');await expect(context()).rejects.toThrow(/permission denied/);
});
test('revoked/archived positions and inactive accounts lose authority immediately',async()=>{
 await db.exec("reset role;update team_positions set active=false");await as(2);expect((await context()).can_manage).toBe(false);
 await db.exec("reset role;update team_positions set active=true;update team_member_positions set revoked_at=now()");await as(2);expect((await context()).can_manage).toBe(false);
 await db.exec("reset role;update team_member_positions set revoked_at=null");
});
test('draft privacy, cross-season references and stale task/checklist writes',async()=>{
 await as(1);const draft=await save('season',{name:'Future draft',status:'draft'});
 const draftBoard=await save('board',{name:'Future board',kind:'project',season_id:draft});
 const hiddenTask=await save('task',{board_id:draftBoard,title:'Draft work',status:'todo',priority:'normal',owner_id:id(3)});
 const hiddenGroup=await save('group',{season_id:draft,name:'Draft group'});
 const c=await context(season);const t=c.tasks[0];
 await expect(save('item',{...c.items[0],group_id:hiddenGroup})).rejects.toThrow(/active group/);
 await expect(save('item',{...c.items[0],board_id:draftBoard})).rejects.toThrow(/active board/);
 await as(3);await expect(context(draft)).rejects.toThrow(/unavailable/);await expect(detail(hiddenTask)).rejects.toThrow(/unavailable/);
 await expect(save('comment',{task_id:hiddenTask,text:'Hidden comment'})).rejects.toThrow(/unavailable/);
 await expect(save('task',{...t,version:0})).rejects.toThrow(/Changed/);
 const d=await detail(task);await expect(save('step',{...d.steps[0],version:0,done:false})).rejects.toThrow(/Changed/);
 await as(4);await expect(save('step',{...d.steps[0],done:false})).rejects.toThrow(/assigned/);
});
test('audit persistence failure rolls back the task mutation',async()=>{
 await as(1);const before=(await context(season)).tasks[0];
 await db.exec("reset role;create function planning_private.fail_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_audit before insert on planning_private.history for each row execute function planning_private.fail_audit();");
 await as(1);await expect(save('task',{...before,title:'Must roll back'})).rejects.toThrow(/audit unavailable/);
 expect((await context(season)).tasks[0]).toEqual(before);
 await db.exec('reset role;drop trigger fail_audit on planning_private.history;drop function planning_private.fail_audit()');
});
test('board archival preserves records, season archive is read only, functional boards persist',async()=>{
 await as(1);let c=await context();let b=c.boards.find((b:any)=>b.id===board);await save('board',{...b,active:false});
 await as(3);expect((await context()).tasks).toHaveLength(0);await expect(detail(task)).rejects.toThrow(/unavailable/);
 await as(1);c=await context();b=c.boards.find((b:any)=>b.id===board);await save('board',{...b,active:true});
 await save('season',{...c.seasons.find((s:any)=>s.id===season),status:'archived'});await expect(save('task',{...c.tasks[0],status:'todo'})).rejects.toThrow(/archived/);
 await save('season',{name:'2028',status:'active'});c=await context();expect(c.boards.map((b:any)=>b.name)).toEqual(['Admin']);
 expect((await context(season)).tasks).toHaveLength(1);
});
