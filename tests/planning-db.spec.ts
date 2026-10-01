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
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
 create table public.areas(id uuid primary key,name text,active boolean);
 create table public.team_positions(key text primary key,active boolean);
 create table public.team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
 insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Leader','student',true),('${id(3)}','Owner','student',true),('${id(4)}','Unrelated','lead',true),('${id(5)}','Inactive','mentor',false);
 insert into areas values('${id(10)}','Software',true);insert into team_positions values('software_lead',true);insert into team_member_positions values('${id(2)}','software_lead',null);`);
 // Supabase may inherit broad default table/function grants. The migration must
 // revoke these explicitly; RLS alone does not prevent TRUNCATE.
 await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 const existing=()=>db.query(`select c.oid,c.relname,c.relacl::text,c.relrowsecurity from pg_class c where c.oid in ('profiles'::regclass,'areas'::regclass,'team_positions'::regclass,'team_member_positions'::regclass) order by c.oid`);
 const before=await existing();
 await db.exec(readFileSync('supabase/migrations/202610020001_planning_v1.sql','utf8'));
 expect((await existing()).rows).toEqual(before.rows);await as(1);
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
test('calendar dates reject reversed ranges and survive timezone/DST boundaries',async()=>{
 await as(1);const c=await context(season);const itemBefore=c.items.find((i:any)=>i.id===item);const taskBefore=c.tasks[0];
 await expect(save('season',{name:'Invalid dates',start_date:'2027-03-15',end_date:'2027-03-13'})).rejects.toThrow(/check constraint/);
 await expect(save('item',{...itemBefore,start_date:'2027-03-15',end_date:'2027-03-13'})).rejects.toThrow(/check constraint/);
 await expect(save('task',{...taskBefore,start_date:'2027-03-15',due_date:'2027-03-13'})).rejects.toThrow(/check constraint/);
 const milestone=c.items.find((i:any)=>i.kind==='milestone');
 await expect(save('item',{...milestone,end_date:'2027-02-01'})).rejects.toThrow(/check constraint/);
 await save('item',{...itemBefore,start_date:'2027-03-13',end_date:'2027-03-15'});
 for(const timezone of ['America/Denver','Pacific/Auckland']){
  await db.query("select set_config('TimeZone',$1,false)",[timezone]);
  const actual=(await context(season)).items.find((i:any)=>i.id===item);
  expect([actual.start_date,actual.end_date]).toEqual(['2027-03-13','2027-03-15']);
 }
 await db.exec("set timezone='UTC'");
});
test('dependency removal preserves items; deletion cannot orphan references',async()=>{
 await as(1);let c=await context(season);let m=c.items.find((i:any)=>i.kind==='milestone');
 await expect(save('item',{...m,predecessor_id:m.id})).rejects.toThrow(/cycle|check constraint/);
 await expect(save('item',{...m,predecessor_id:id(999)})).rejects.toThrow(/foreign key/);
 const draft=c.seasons.find((s:any)=>s.status==='draft');
 const other=await save('item',{season_id:draft.id,title:'Other season',kind:'work',status:'not_started',start_date:'2028-01-01',end_date:'2028-01-02'});
 await expect(save('item',{...m,predecessor_id:other})).rejects.toThrow(/foreign key/);
 await expect(db.query('delete from planning_items where id=$1',[item])).rejects.toThrow(/permission denied/);
 await db.exec('reset role');await expect(db.query('delete from planning_items where id=$1',[item])).rejects.toThrow(/foreign key/);
 await as(1);await save('item',{...m,predecessor_id:null});
 c=await context(season);m=c.items.find((i:any)=>i.id===m.id);expect(m.predecessor_id).toBeNull();expect(c.items.some((i:any)=>i.id===item)).toBe(true);
 await save('item',{...m,predecessor_id:item});
});
test('all intended positions authorize through trusted current assignment only',async()=>{
 const keys=['program_manager','product_technical_manager','finance_lead','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead'];
 for(const key of keys){
  await db.exec(`reset role;insert into team_positions values('${key}',true) on conflict do nothing;update team_member_positions set position_key='${key}' where user_id='${id(2)}';`);
  await as(2);expect((await context()).can_manage).toBe(true);
 }
 await db.exec(`reset role;update profiles set active=false where id='${id(2)}'`);await as(2);
 await expect(save('board',{name:'Inactive',kind:'area'})).rejects.toThrow(/Active team/);
 await db.exec(`reset role;update profiles set active=true where id='${id(2)}';update team_positions set active=false where key='operations_lead';`);await as(2);
 await expect(save('board',{name:'Archived authority',kind:'area'})).rejects.toThrow(/leadership/);
 await db.exec(`reset role;update team_positions set active=true where key='operations_lead';update team_member_positions set revoked_at=now() where user_id='${id(2)}';`);await as(2);
 await expect(save('board',{name:'Revoked authority',kind:'area'})).rejects.toThrow(/leadership/);
 await as(4);for(const entity of ['season','board','group','item'])await expect(save(entity,{name:'Spoofed',title:'Spoofed',role:'mentor',can_manage:true,position_key:'program_manager'})).rejects.toThrow(/leadership/);
 await db.exec(`reset role;update team_member_positions set revoked_at=null,position_key='software_lead' where user_id='${id(2)}';`);
});
test('explicit grants deny direct table writes/deletes/truncate and private helpers',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`reset role;set role ${role}`);
  for(const table of ['seasons','groups','boards','items','tasks','steps','comments']){
   await expect(db.exec(`select * from public.planning_${table}`)).rejects.toThrow(/permission denied/);
   await expect(db.exec(`delete from public.planning_${table}`)).rejects.toThrow(/permission denied/);
   await expect(db.exec(`truncate public.planning_${table} cascade`)).rejects.toThrow(/permission denied/);
  }
  await expect(db.exec('select planning_private.manager()')).rejects.toThrow(/permission denied/);
  await expect(db.exec('select * from planning_private.history')).rejects.toThrow(/permission denied/);
  if(role==='anon'){await expect(save('season',{name:'Denied'})).rejects.toThrow(/permission denied/);await expect(detail(task)).rejects.toThrow(/permission denied/);}
 }
 await as(3);await expect(save('delete_task',{id:task})).rejects.toThrow(/Unknown/);
 const d=await detail(task);expect(d.comments).toHaveLength(1);expect(d.steps).toHaveLength(1);
 await as(1);const checks=(await db.query<any>(`select count(*)::integer n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and ((n.nspname='public' and c.relname like 'planning_%') or n.nspname='planning_private')`)).rows[0];expect(checks.n).toBe(8);
});
test('board archival preserves records, season archive is read only, functional boards persist',async()=>{
 await as(1);let c=await context();let b=c.boards.find((b:any)=>b.id===board);await save('board',{...b,active:false});
 await as(3);expect((await context()).tasks).toHaveLength(0);await expect(detail(task)).rejects.toThrow(/unavailable/);
 await as(1);c=await context();b=c.boards.find((b:any)=>b.id===board);await save('board',{...b,active:true});
 await save('season',{...c.seasons.find((s:any)=>s.id===season),status:'archived'});await expect(save('task',{...c.tasks[0],status:'todo'})).rejects.toThrow(/archived/);
 await save('season',{name:'2028',status:'active'});c=await context();expect(c.boards.map((b:any)=>b.name)).toEqual(['Admin']);
 expect((await context(season)).tasks).toHaveLength(1);
});
