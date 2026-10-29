import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {baseline,id} from './fixtures/outreach-baseline.mjs';
import {planningFixture,assignmentPayload,reviewPayload,updatePayload,saveReview,reviewContext} from './fixtures/sprint-review';
import {reserve,upload,context as fabricationContext,mutate,actionPayload} from './fixtures/fabrication';
import {goal} from './fixtures/season-goals-baseline.mjs';
const migration='supabase/migrations/20261028160521_admin_lead_workflow_compatibility.sql';
const pins=JSON.parse(readFileSync('tests/fixtures/workflow-role-definition-pins.json','utf8'));
let db:PGlite,fixture:Awaited<ReturnType<typeof planningFixture>>,before:any,after:any,rollback:any;
test.describe.configure({mode:'serial'});
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);}
async function sql(file:string){await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));}
async function context(){return (await db.query<any>('select planning_context($1) c',[fixture.season])).rows[0].c;}
async function save(entity:string,p:unknown){return (await db.query<any>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;}
async function reject(fn:()=>Promise<unknown>,pattern=/required|unavailable|permission|Read|active|Only/i){await db.exec('savepoint denied');try{await expect(fn()).rejects.toThrow(pattern);}finally{await db.exec('rollback to denied');}}
async function setRole(n:number,role:string,active=true){await db.exec('reset role');await db.query('update profiles set role=$2,active=$3 where id=$1',[id(n),role,active]);await as(n);}
async function security(){
 await db.exec('reset role');
 const schemas=['public','planning_private','planning_review_private','planning_goals_private','fabrication_private','outreach_private','volunteer_private'];
 return {
 functions:(await db.query<any>(`select p.oid,n.nspname||'.'||p.proname name,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) order by p.oid`,[schemas])).rows,
 relations:(await db.query(`select n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind in ('r','S','v') order by c.oid`,[schemas])).rows,
 policies:(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
 profiles:(await db.query('select * from profiles order by id')).rows,
 assignments:(await db.query('select * from team_member_positions order by user_id,position_key')).rows,
 tasks:(await db.query('select * from planning_tasks order by id')).rows,
 };
}
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(baseline());
 // Literal role and existing assignment facts, not aliased authority helpers.
 await db.exec(`insert into profiles values('${id(7)}','Admin Lead','admin_lead',true,null),('${id(8)}','Unassigned Admin Lead','admin_lead',true,null);
 insert into team_positions values('program_manager',true),('software_lead',true),('unrelated',true);
 insert into team_member_positions values('${id(7)}','unrelated',null);
 create table team_meetings(id uuid primary key);`);
 for(const file of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql','20261018051320_planning_current_writer_guard.sql','20261006045839_sponsor_outreach_v1.sql','20261006061729_season_goals_v1.sql','20261006073717_sprint_review_v1.sql'])await sql(file);
 await db.exec(readFileSync('tests/fixtures/fabrication-storage.sql','utf8'));
 for(const file of ['20261006201639_fabrication_v1.sql','20261006213850_assembly_testing_v1.sql','20261006235739_sprint_review_design_decisions_v1.sql','20261007155231_mentor_volunteer_hours.sql'])await sql(file);
 fixture=await planningFixture(db);await saveReview(db,'assignment',assignmentPayload());
 await db.exec('reset role');await db.exec(readFileSync('tests/fixtures/workflow-core-prerequisite.sql','utf8'));
 // The minimal foundation grants service_role default EXECUTE; live catalog pins show this private helper is owner-only.
 await db.exec('revoke all on function planning_private.context(uuid,boolean),planning_private.manager(),public.planning_save(text,jsonb) from service_role');
 before=await security();const source=readFileSync(migration,'utf8');
 await expect(db.exec(source.replace(/commit;\s*$/,()=>"do $$begin raise exception 'forced adapter rollback';end$$;commit;"))).rejects.toThrow(/forced adapter rollback/);await db.exec('rollback');rollback=await security();
 // Drift guards reject atomically, without changing any baseline object.
 for(const drift of ["alter table profiles drop constraint profiles_role_check", "create or replace function public.team_my_positions() returns text[] language sql stable security definer set search_path='' as $$select '{}'::text[]$$", "alter function planning_private.manager() security invoker", "grant execute on function planning_private.manager() to anon"]){
  await db.exec('begin;'+drift);const altered=await security();await expect(db.exec(source)).rejects.toThrow(/required|differs/);await db.exec('rollback');expect(await security()).toEqual(before);
 }
 await db.exec(source);after=await security();
});
test.afterAll(()=>db?.close());
test.beforeEach(async()=>{await as(1);await db.exec('begin');});test.afterEach(()=>db.exec('rollback'));

test('full 18-definition adapter is source pinned, rollback safe and preserves every existing ACL/data boundary',async()=>{
 expect(rollback).toEqual(before);expect(after.relations).toEqual(before.relations);expect(after.policies).toEqual(before.policies);
 for(const key of ['profiles','assignments','tasks'])expect(after[key]).toEqual(before[key]);
 expect(after.functions.map(({definition,...r}:any)=>r)).toEqual(before.functions.map(({definition,...r}:any)=>r));
 const changed=after.functions.filter((f:any)=>f.definition!==before.functions.find((b:any)=>b.oid===f.oid).definition).map((f:any)=>f.name).sort();
 expect(changed).toEqual(pins.functions.map((p:any)=>p.name).sort());
 const text=readFileSync(migration,'utf8');
 for(const pin of pins.functions){expect(createHash('sha256').update(readFileSync(pin.source)).digest('hex')).toBe(pin.source_sha256);expect(readFileSync(pin.source,'utf8')).toContain(pin.before);expect(text).toContain(pin.expected);}
 expect(pins.functions).toHaveLength(18);
});
test('Admin Lead is an ordinary writer, never an automatic Planning/Fabrication manager; current named positions still govern',async()=>{
 for(const n of [7,8]){await as(n);expect(await context()).toMatchObject({can_write:true,can_manage:false});expect((await fabricationContext(db)).is_operator).toBe(true);await reject(()=>save('board',{kind:'project',season_id:fixture.season,name:'Not authorized'}));}
 await db.exec(`reset role;insert into team_member_positions values('${id(7)}','software_lead',null)`);await as(7);expect((await context()).can_manage).toBe(true);await save('board',{kind:'project',season_id:fixture.season,name:'Named functional responsibility'});
 await db.exec(`reset role;update team_member_positions set revoked_at=now() where user_id='${id(7)}' and position_key='software_lead'`);await as(7);expect((await context()).can_manage).toBe(false);
 await setRole(7,'readonly');expect(await context()).toMatchObject({can_write:false,can_manage:false});expect((await fabricationContext(db)).is_operator).toBe(false);
 await setRole(7,'admin_lead',false);await reject(context);
});
test('retained Readonly task assignment cannot forge task/checklist/comment/dependency writes; restoration needs a fresh explicit write',async()=>{
 await as(1);const task=(await context()).tasks.find((t:any)=>t.id===fixture.task);await save('task',{...task,owner_ids:[id(7)]});
 await as(7);await save('task',{...(await context()).tasks.find((t:any)=>t.id===fixture.task),title:'Admin Lead own work'});
 await setRole(7,'readonly');const current=(await context()).tasks.find((t:any)=>t.id===fixture.task);expect((await context()).can_write).toBe(false);
 for(const [entity,p] of [['task',{...current,title:'Forged'}],['step',{task_id:fixture.task,text:'Forged'}],['comment',{task_id:fixture.task,text:'Forged'}]] as const)await reject(()=>save(entity,p));
 await reject(()=>db.query("select planning_dependency_save('add',$1,$2)",[fixture.areaTask,fixture.task]));
 expect((await context()).tasks.find((t:any)=>t.id===fixture.task).title).toBe('Admin Lead own work');
 await setRole(7,'admin_lead');await save('task',{...current,title:'Explicit restored edit'});
});
test('Fabrication permits Admin Lead operators and only current assigned project submitters',async()=>{
 await upload(db);await mutate(db,'claim',actionPayload(),7);await as(7);expect((await fabricationContext(db)).parts[0].allowed_actions).toContain('ready');
 await reject(()=>reserve(db,undefined,8));
 await as(1);await saveReview(db,'assignment',{...assignmentPayload(),lead_id:id(7),supporter_ids:[id(8)],version:1});
 for(const n of [7,8])await as(n),expect((await fabricationContext(db)).projects.find(p=>p.id===fixture.board)?.can_submit).toBe(true);
 await setRole(7,'readonly');await reject(()=>mutate(db,'ready',actionPayload(2),7));await reject(()=>reserve(db,undefined,7));
});
test('Sprint Review accepts literal Admin Lead students/participants without making them review managers',async()=>{
 await as(1);await saveReview(db,'review',{...reviewPayload(),chair_id:id(7)});
 await saveReview(db,'assignment',{...assignmentPayload(),lead_id:id(7),supporter_ids:[id(8)],version:1});
 await as(7);const c=await reviewContext(db);expect(c.can_manage).toBe(false);expect(c.members.find(p=>p.id===id(7))).toMatchObject({is_student:true,can_write:true});
 await saveReview(db,'update',{...updatePayload(),reported_by_student_ids:[id(7)],linked_task_id:null,decision_workflow:{schema_version:1,status:'comparing',owner_id:id(7),target_date:null,decided_on:null,requirements:[],options:[{id:id(880),label:'Synthetic option',description:'',weight:'',space:'',cost:'',reliability:'',time:'',evidence:[]}],chosen_option_id:null,reopen_criteria:''}} as any,7);
 expect((await reviewContext(db)).updates[0].decision_workflow?.owner_id).toBe(id(7));
 await reject(()=>saveReview(db,'review',{...reviewPayload(id(402)),chair_id:id(7)},7));
 await setRole(7,'readonly');await reject(()=>saveReview(db,'update',{...updatePayload(id(502)),reported_by_student_ids:[id(7)],linked_task_id:null},7));
});
test('Goals permit Admin Lead self ownership/contribution, not other-owner reassignment or manager rights',async()=>{
 await as(7);const c=(await db.query<any>('select planning_goals_context($1) c',[fixture.season])).rows[0].c;
 expect(c.capabilities).toEqual({can_create:true,can_manage:false,can_reassign:false});expect(c.eligible_owners.map((p:any)=>p.id)).toEqual([id(7)]);
 const p=goal({season_id:fixture.season,owner_id:id(7),supporter_ids:[id(8)],task_ids:[],milestone_ids:[],next_milestone_id:null});
 expect((await db.query<any>('select planning_goal_save($1,$2) r',[JSON.stringify(p),id(7)])).rows[0].r.status).toBe('committed');
 await reject(()=>db.query('select planning_goal_save($1,$2)',[JSON.stringify({...p,id:id(999),operation_id:id(998),owner_id:id(8)}),id(7)]));
 await setRole(7,'readonly');expect((await db.query<any>('select planning_goals_context($1) c',[fixture.season])).rows[0].c.capabilities.can_create).toBe(false);
});
test('Outreach Admin Lead retains ordinary owner writes with Finance details redacted',async()=>{
 await as(7);const c=(await db.query<any>('select outreach_context($1) c',[id(100)])).rows[0].c;expect(c).toMatchObject({can_manage:false,can_link_finance:false,financials_redacted:true,income:[]});expect(c.owners.some((p:any)=>p.id===id(7))).toBe(true);
 const saveOutreach=(entity:string,p:unknown,key:number)=>db.query('select outreach_save($1,$2,$3,$4)',[entity,JSON.stringify(p),id(key),id(7)]);
 await saveOutreach('organization',{id:id(700),version:0,kind:'organization',name:'Synthetic sponsor',website:'https://example.test',notes:'',active:true},701);
 await saveOutreach('engagement',{id:id(702),version:0,organization_id:id(700),season_id:id(100),stage:'prospect',owner_id:id(7),next_follow_up_on:null,notes:''},703);
 await setRole(7,'readonly');await reject(()=>saveOutreach('organization',{id:id(704),version:0,kind:'organization',name:'Denied',active:true},705));
});
test('Volunteer remains Mentor/Admin-only despite Admin Lead ordinary workflow inheritance',async()=>{
 for(const n of [7,8,6,4]){await as(n);await reject(()=>db.exec('select team_volunteer_context()'));}
 for(const n of [1,2]){await as(n);expect((await db.query<any>('select team_volunteer_context() c')).rows[0].c).toBeTruthy();}
});
