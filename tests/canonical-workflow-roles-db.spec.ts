import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {baseline,id} from './fixtures/outreach-baseline.mjs';
import {planningFixture,assignmentPayload,reviewPayload,updatePayload,saveReview,reviewContext} from './fixtures/sprint-review';
import {reserve,upload,context as fabricationContext,mutate,actionPayload} from './fixtures/fabrication';
import {goal} from './fixtures/season-goals-baseline.mjs';
const migration='supabase/migrations/20261029190442_canonical_roles_workflow_boundaries.sql';
const pins=JSON.parse(readFileSync('tests/fixtures/canonical-workflow-definition-pins.json','utf8'));
let db:PGlite,fixture:Awaited<ReturnType<typeof planningFixture>>,before:any,after:any,rollback:any;
test.describe.configure({mode:'serial'});
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);}
async function sql(file:string){await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));}
async function context(){return (await db.query<any>('select planning_context($1) c',[fixture.season])).rows[0].c;}
async function save(entity:string,p:unknown){return (await db.query<any>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;}
async function reject(fn:()=>Promise<unknown>,pattern=/required|unavailable|permission|Read|active|Only|owned|assigned|leadership|Mentor|access/i){await db.exec('savepoint denied');try{await expect(fn()).rejects.toThrow(pattern);}finally{await db.exec('rollback to denied');}}
async function setRole(n:number,role:string,active=true){await db.exec('reset role');await db.query('update profiles set role=$2,active=$3 where id=$1',[id(n),role,active]);await as(n);}
async function security(){
 await db.exec('reset role');
 const schemas=['public','planning_private','planning_review_private','planning_goals_private','fabrication_private','outreach_private','volunteer_private'];
 return {
 functions:(await db.query<any>(`select p.oid,p.oid::regprocedure::text signature,n.nspname||'.'||p.proname name,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,p.proisstrict from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) order by p.oid`,[schemas])).rows,
 relations:(await db.query(`select n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind in ('r','S','v') order by c.oid`,[schemas])).rows,
 policies:(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
 profiles:(await db.query('select * from profiles order by id')).rows,
 assignments:(await db.query('select * from team_member_positions order by user_id,position_key')).rows,
 tasks:(await db.query('select * from planning_tasks order by id')).rows,
 };
}
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(baseline());
 await db.exec(`insert into profiles values('${id(7)}','Admin Lead','admin_lead',true,null),('${id(8)}','Unassigned Admin Lead','admin_lead',true,null);
 insert into team_positions values('program_manager',true),('software_lead',true),('unrelated',true);
 insert into team_member_positions values('${id(7)}','unrelated',null);
 create table team_meetings(id uuid primary key);`);
 for(const file of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql','20261018051320_planning_current_writer_guard.sql','20261006045839_sponsor_outreach_v1.sql','20261006061729_season_goals_v1.sql','20261006073717_sprint_review_v1.sql'])await sql(file);
 await db.exec(readFileSync('tests/fixtures/fabrication-storage.sql','utf8'));
 for(const file of ['20261006201639_fabrication_v1.sql','20261006213850_assembly_testing_v1.sql','20261006235739_sprint_review_design_decisions_v1.sql','20261007155231_mentor_volunteer_hours.sql'])await sql(file);
 fixture=await planningFixture(db);await saveReview(db,'assignment',assignmentPayload());
 await db.exec('reset role');await db.exec(readFileSync('tests/fixtures/workflow-core-prerequisite.sql','utf8'));
 await db.exec('revoke all on function planning_private.context(uuid,boolean),planning_private.manager(),public.planning_save(text,jsonb) from service_role');
 await sql('20261028160521_admin_lead_workflow_compatibility.sql');
 const source=readFileSync(migration,'utf8');
 await expect(db.exec(source)).rejects.toThrow(/Canonical role conversion required/);await db.exec('rollback');
 // Synthetic counterpart of the separate core migration. This adapter never changes profiles.
 await db.exec(`update profiles set role='admin_lead' where role='admin';alter table profiles drop constraint profiles_role_check;alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','mentor'));`);
 await db.exec('revoke all on all functions in schema volunteer_private from service_role');
 before=await security();
 for(const pin of pins.functions){const actual=before.functions.find((f:any)=>f.signature===pin.signature);expect(actual?.definition,pin.signature).toBe(pin.definition);}
 await expect(db.exec(source.replace(/commit;\s*$/,()=>"do $$begin raise exception 'forced adapter rollback';end$$;commit;"))).rejects.toThrow(/forced adapter rollback/);await db.exec('rollback');rollback=await security();
 for(const drift of ["alter table profiles drop constraint profiles_role_check", "alter function planning_private.manager() security invoker", "grant execute on function planning_private.manager() to anon"]){
  await db.exec('begin;'+drift);await expect(db.exec(source)).rejects.toThrow(/required|differs/);await db.exec('rollback');expect(await security()).toEqual(before);
 }
 await db.exec(source);after=await security();
});
test.afterAll(()=>db?.close());
test.beforeEach(async()=>{await as(2);await db.exec('begin');});test.afterEach(()=>db.exec('rollback'));

test('25 pinned full definitions preserve metadata, RLS, storage, assignments and data; rollback and drift fail atomically',async()=>{
 expect(pins.functions).toHaveLength(25);expect(rollback).toEqual(before);expect(after.relations).toEqual(before.relations);expect(after.policies).toEqual(before.policies);
 for(const key of ['profiles','assignments','tasks'])expect(after[key]).toEqual(before[key]);
 expect(after.functions.map(({definition,...r}:any)=>r)).toEqual(before.functions.map(({definition,...r}:any)=>r));
 const changed=after.functions.filter((f:any)=>f.definition!==before.functions.find((b:any)=>b.oid===f.oid).definition).map((f:any)=>f.signature).sort();
 expect(changed).toEqual(pins.functions.map((p:any)=>p.signature).sort());
 for(const pin of pins.functions){const actual=after.functions.find((f:any)=>f.signature===pin.signature);expect(actual.definition).toBe(pin.expected);expect(createHash('md5').update(actual.definition).digest('hex')).toBe(pin.expected_md5);expect(actual.definition).not.toContain("'admin'");}
});
test('converted legacy account and ordinary Admin Leads have no automatic Planning management, but keep assigned work',async()=>{
 for(const n of [1,7,8]){await as(n);expect(await context()).toMatchObject({can_write:true,can_manage:false});await reject(()=>save('board',{kind:'project',season_id:fixture.season,name:'Not authorized'}));}
 await as(2);const task=(await context()).tasks.find((t:any)=>t.id===fixture.task);await save('task',{...task,owner_ids:[id(1)]});
 await as(1);await save('task',{...(await context()).tasks.find((t:any)=>t.id===fixture.task),title:'Retained ordinary work'});
 await save('comment',{task_id:fixture.task,text:'Evidence from the student lead'});
 await reject(async()=>save('task',{...(await context()).tasks.find((t:any)=>t.id===fixture.task),owner_ids:[id(8)]}));
 await setRole(1,'readonly');expect(await context()).toMatchObject({can_write:false,can_manage:false});await reject(()=>save('comment',{task_id:fixture.task,text:'Denied after downgrade'}));
});
test('named functional positions still enable Planning/Fabrication management and revoke promptly without widening supervisor powers',async()=>{
 await db.exec(`reset role;insert into team_member_positions values('${id(1)}','software_lead',null)`);await as(1);expect((await context()).can_manage).toBe(true);await save('board',{kind:'project',season_id:fixture.season,name:'Assigned function'});
 await db.exec('reset role');expect((await db.query<any>('select fabrication_private.manager($1) manager,fabrication_private.supervisor($1) supervisor',[id(1)])).rows[0]).toEqual({manager:true,supervisor:false});
 await db.exec(`update team_member_positions set revoked_at=now() where user_id='${id(1)}' and position_key='software_lead'`);await as(1);expect((await context()).can_manage).toBe(false);
 await setRole(1,'admin_lead',false);await reject(context);
});
test('Mentor remains a workflow manager/supervisor, while Admin Lead remains operator and assigned project contributor',async()=>{
 await as(2);expect((await context()).can_manage).toBe(true);await save('board',{kind:'project',season_id:fixture.season,name:'Mentor management'});
 await db.exec('reset role');expect((await db.query<any>('select fabrication_private.manager($1) manager,fabrication_private.supervisor($1) supervisor',[id(2)])).rows[0]).toEqual({manager:true,supervisor:true});
 await upload(db);await mutate(db,'claim',actionPayload(),1);await as(1);expect((await fabricationContext(db)).is_operator).toBe(true);expect((await fabricationContext(db)).parts[0].allowed_actions).toContain('ready');
 await reject(()=>reserve(db,undefined,8));await as(2);await saveReview(db,'assignment',{...assignmentPayload(),lead_id:id(1),supporter_ids:[id(8)],version:1},2);
 for(const n of [1,8]){await as(n);expect((await fabricationContext(db)).projects.find(p=>p.id===fixture.board)?.can_submit).toBe(true);}
 await setRole(1,'readonly');await reject(()=>mutate(db,'ready',actionPayload(2),1));
});
test('canonical Admin Lead remains a student Sprint Review participant, not a review manager',async()=>{
 await saveReview(db,'review',{...reviewPayload(),chair_id:id(1)},2);await saveReview(db,'assignment',{...assignmentPayload(),lead_id:id(1),supporter_ids:[id(8)],version:1},2);
 await as(1);const c=await reviewContext(db);expect(c.can_manage).toBe(false);expect(c.members.find(p=>p.id===id(1))).toMatchObject({is_student:true,can_write:true});
 await saveReview(db,'update',{...updatePayload(),reported_by_student_ids:[id(1)],linked_task_id:null},1);
 await reject(()=>saveReview(db,'review',{...reviewPayload(id(402)),chair_id:id(1)},1));
});
test('Admin Lead owns goals without gaining reassignment or private season management',async()=>{
 await as(1);const c=(await db.query<any>('select planning_goals_context($1) c',[fixture.season])).rows[0].c;expect(c.capabilities).toEqual({can_create:true,can_manage:false,can_reassign:false});expect(c.eligible_owners.map((p:any)=>p.id)).toEqual([id(1)]);
 const p=goal({season_id:fixture.season,owner_id:id(1),supporter_ids:[id(8)],task_ids:[],milestone_ids:[],next_milestone_id:null});
 expect((await db.query<any>('select planning_goal_save($1,$2) r',[JSON.stringify(p),id(1)])).rows[0].r.status).toBe('committed');
 await reject(()=>db.query('select planning_goal_save($1,$2)',[JSON.stringify({...p,id:id(999),operation_id:id(998),owner_id:id(8)}),id(1)]));
});
test('Outreach retains own work/retry receipts but hides private fields and rejects manager-only mutations',async()=>{
 const outreach=(n:number,entity:string,p:unknown,key:number)=>db.query('select outreach_save($1,$2,$3,$4)',[entity,JSON.stringify(p),id(key),id(n)]);
 await as(2);await outreach(2,'organization',{id:id(700),version:0,kind:'organization',name:'Mentor sponsor',website:'https://example.test',notes:'Private relationship',active:true},701);
 await as(1);const c=(await db.query<any>('select outreach_context($1) c',[id(100)])).rows[0].c;expect(c).toMatchObject({can_manage:false,can_link_finance:false,financials_redacted:true,income:[]});expect(c.organizations.find((o:any)=>o.id===id(700))).toMatchObject({notes:null,notes_redacted:true,can_edit:false});
 await reject(()=>outreach(1,'organization',{id:id(700),version:1,kind:'organization',name:'Overwrite',active:true},702));
 const p={id:id(703),version:0,kind:'organization',name:'Own sponsor',website:'https://example.test',notes:'Not privileged',active:true};const r=await outreach(1,'organization',p,704);expect(await outreach(1,'organization',p,704)).toEqual(r);
 await outreach(1,'engagement',{id:id(705),version:0,organization_id:id(703),season_id:id(100),stage:'prospect',owner_id:id(1),next_follow_up_on:null,notes:''},706);
 await reject(()=>outreach(1,'pledge',{id:id(707),version:0,engagement_id:id(705)},708));
 await setRole(1,'readonly');await reject(()=>outreach(1,'organization',p,704));
});
test('Volunteer is Mentor-only, team reports still need the separate report-reader assignment',async()=>{
 for(const n of [1,7,8,6,4]){await as(n);await reject(()=>db.exec('select team_volunteer_context()'));}
 await as(2);expect((await db.query<any>('select team_volunteer_context() c')).rows[0].c.can_view_team).toBe(false);
 await db.exec(`reset role;insert into volunteer_private.report_readers(user_id,granted_by,reason) values('${id(2)}','${id(2)}','Synthetic designated reporter')`);await as(2);expect((await db.query<any>('select team_volunteer_context() c')).rows[0].c.can_view_team).toBe(true);
 await db.exec(`reset role;update volunteer_private.report_readers set revoked_at=now() where user_id='${id(2)}'`);await as(2);expect((await db.query<any>('select team_volunteer_context() c')).rows[0].c.can_view_team).toBe(false);
});
test('unknown retired admin value fails closed even if a corrupt fixture bypasses the canonical CHECK',async()=>{
 await db.exec(`reset role;alter table profiles drop constraint profiles_role_check;update profiles set role='admin' where id='${id(1)}'`);await as(1);expect(await context()).toMatchObject({can_write:false,can_manage:false});await reject(()=>save('comment',{task_id:fixture.task,text:'Retired role must not write'}));await reject(()=>db.exec('select team_volunteer_context()'));await reject(()=>db.query('select outreach_context($1)',[id(100)]));
 await db.exec('reset role');expect((await db.query<any>('select fabrication_private.manager($1) manager,fabrication_private.writer($1) writer,fabrication_private.supervisor($1) supervisor',[id(1)])).rows[0]).toEqual({manager:false,writer:false,supervisor:false});
});
