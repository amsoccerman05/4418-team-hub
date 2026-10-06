import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {assertContext,validEvidenceUrl} from '../src/planning/goals/model';
// @ts-expect-error Shared JavaScript fixtures are also consumed by native PostgreSQL.
import {baseline,id,migration,goal,update} from './fixtures/season-goals-baseline.mjs';
test.describe.configure({mode:'serial'});
let db:PGlite;
const as=async(n:number)=>db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);
const save=async(p:any=goal(),actor=3)=>(await db.query<any>('select planning_goal_save($1,$2) r',[JSON.stringify(p),id(actor)])).rows[0].r;
const append=async(p:any=update(),actor=3)=>(await db.query<any>('select planning_goal_update($1,$2) r',[JSON.stringify(p),id(actor)])).rows[0].r;
const context=async(s:string|null=id(100))=>(await db.query<any>('select planning_goals_context($1) c',[s])).rows[0].c;
const status=async(op:number,actor=3)=>(await db.query<any>('select planning_goal_operation_status($1,$2) r',[id(op),id(actor)])).rows[0].r;
const cancel=async(op:number,actor=3)=>(await db.query<any>('select planning_goal_operation_cancel($1,$2) r',[id(op),id(actor)])).rows[0].r;
async function rejects(fn:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint attempt');await expect(fn()).rejects.toThrow(pattern);await db.exec('rollback to attempt');}
const fresh=async()=>{const c=await context();return c.goals.find((g:any)=>g.id===id(300));};
const edited=async(overrides:any={})=>{const g=await fresh();return goal({operation_id:id(902),expected_version:g.version,...overrides});};
async function adminSQL(sql:string,actor=3){await db.exec('reset role');await db.exec(sql);await as(actor);}
async function count(table:string){await db.exec('reset role');const n=(await db.query<any>(`select count(*)::integer n from ${table}`)).rows[0].n;await as(3);return n;}
test.beforeAll(async()=>{db=new PGlite();await db.exec(baseline());await db.exec(readFileSync(migration,'utf8'));});
test.afterAll(async()=>db.close());
test.beforeEach(async()=>{await as(3);await db.exec('begin');});
test.afterEach(async()=>db.exec('rollback'));

test('explicit current capabilities, eligible student owners, and season visibility match existing Planning',async()=>{
 for(const n of [1,2,8]){await as(n);const c=await context();expect(c.capabilities).toEqual({can_create:true,can_manage:true,can_reassign:true});expect(c.eligible_owners.map((x:any)=>x.id).sort()).toEqual([2,3,4,6].map(id));expect((await context(id(101))).capabilities.can_create).toBe(true);expect((await context(id(102))).capabilities).toEqual({can_create:false,can_manage:true,can_reassign:false});}
 for(const n of [3,4,6]){await as(n);const c=await context();expect(c.capabilities).toEqual({can_create:true,can_manage:false,can_reassign:false});expect(c.eligible_owners.map((x:any)=>x.id)).toEqual([id(n)]);await rejects(()=>context(id(101)),/unavailable/);await rejects(()=>context(id(102)),/unavailable/);}
 await as(7);expect((await context()).capabilities.can_create).toBe(false);expect((await context()).eligible_owners).toEqual([]);
 await as(5);await rejects(()=>context(),/Active team/);
 await adminSQL("update planning_seasons set status='archived' where status='active'");expect((await context(null)).season).toBeNull();expect((await context(null)).capabilities.can_create).toBe(false);
});
test('student authors self-owned goal; managers facilitate and reassign without changing task owners',async()=>{
 const r=await save();expect(r).toEqual({status:'committed',operation_id:id(900),result:{goal_id:id(300),version:1,update_id:null}});
 let g=await fresh();expect(g.capabilities).toEqual({can_edit:true,can_update:true,can_reassign:false});expect(g.supporters).toEqual([{id:id(6),name:'Student supporter',active:true}]);expect(g.measurement_locked).toBe(false);
 expect((await context()).tasks.find((x:any)=>x.id===id(120)).owner_ids).toEqual([id(4)]);
 await as(4);await save(goal({id:id(301),operation_id:id(903),owner_id:id(4)}),4);await rejects(()=>save(goal({id:id(302),operation_id:id(904)}),4),/self-owned/);
 await as(3);await rejects(async()=>save(await edited({owner_id:id(4)})),/reassign/);
 await as(1);await save(await edited({owner_id:id(4)}),1);g=await fresh();expect(g.owner_id).toBe(id(4));expect(g.capabilities.can_reassign).toBe(true);
 await as(3);expect((await fresh()).capabilities.can_edit).toBe(false);await rejects(()=>save(goal({operation_id:id(905),expected_version:2})),/student owner/);
 await as(1);await rejects(()=>save(goal({id:id(302),operation_id:id(906),owner_id:id(1)}),1),/student owner/);
});
test('named active support can append evidence but receives no definition, task or manager authority',async()=>{
 await save();await as(6);expect((await fresh()).capabilities).toEqual({can_edit:false,can_update:true,can_reassign:false});
 await append(update(),6);expect((await fresh()).updates[0].author_id).toBe(id(6));
 await rejects(async()=>save(await edited(),6),/student owner/);
 await rejects(()=>db.query('select planning_save($1,$2)',['task',JSON.stringify({id:id(120),version:1,board_id:id(110),title:'Escalation',status:'done',priority:'normal',owner_ids:[id(4)]})]),/assigned/);
 await as(4);expect((await fresh()).capabilities.can_update).toBe(false);await rejects(()=>append(update({id:id(401),operation_id:id(902),expected_version:2}),4),/named supporters/);
 await as(7);await rejects(()=>save(goal({id:id(301),operation_id:id(903),owner_id:id(7)}),7),/self-owned/);
});
test('all four categories, lower-is-better and maintenance targets have finite direction rules',async()=>{
 await save(goal({baseline:15,target:10,unit:'seconds',direction:'decrease'}));expect((await fresh()).target).toBe(10);
 await save(goal({operation_id:id(902),id:id(301),category:'performance',baseline:90,target:90,unit:'percent',direction:'equal'}));
 await save(goal({operation_id:id(903),id:id(302),category:'team_growth',baseline:1,target:4,unit:'qualified backups'}));
 await save(goal({operation_id:id(904),id:id(303),category:'fundraising',baseline:0,target:1000,unit:'USD manually reported',fundraising_measure:'pledged'}));
 await save(goal({operation_id:id(905),id:id(304),category:'fundraising',baseline:0,target:1000,unit:'USD manually reported',fundraising_measure:'received'}));
 for(const patch of [{baseline:10,target:10,direction:'increase'},{baseline:5,target:10,direction:'decrease'},{baseline:1,target:3,direction:'equal'},{baseline:'NaN'},{target:'Infinity'},{target:1e16},{baseline:null},{unit:''},{deadline:'infinity'},{deadline:'10000-01-01'},{deadline:'0001-01-01 BC'},{category:'fundraising',fundraising_measure:null},{fundraising_measure:'pledged'},{category:'unknown'}])await rejects(()=>save(goal({id:id(310),operation_id:id(910),...patch})),/finite|check constraint|null value/);
 const c=await context();expect(JSON.stringify(c)).not.toMatch(/completion_percent|finance_income|budget/);expect(c.goals.filter((g:any)=>g.category==='fundraising').map((g:any)=>g.fundraising_measure)).toEqual(['pledged','received']);
});
test('append-only weekly and measurement evidence preserves definitions and makes status explicitly manual',async()=>{
 await save();await append(update({measured_value:100,status:'at_risk'}));let g=await fresh();expect(g.updates[0].status).toBe('at_risk');expect(g.measurement_locked).toBe(true);
 await append(update({id:id(401),operation_id:id(902),expected_version:2,kind:'weekly',measured_value:null,status:'blocked',evidence:'Alignment is inconsistent',next_step:'Ask the student lead for a second test slot'}));
 g=await fresh();expect(g.version).toBe(3);expect(g.updates.map((u:any)=>u.kind)).toEqual(['weekly','measurement']);expect(g.updates.map((u:any)=>u.goal_version)).toEqual([3,2]);
 for(const patch of [{baseline:1},{target:9},{unit:'cycles'},{direction:'decrease',baseline:12,target:8},{category:'performance'},{category:'fundraising',fundraising_measure:'received'}])await rejects(async()=>save(await edited({operation_id:id(903),...patch})),/definition is locked/);
 await save(await edited({operation_id:id(903),title:'Clearer title',deadline:'2027-05-01',task_ids:[id(121)],supporter_ids:[]}));expect((await fresh()).version).toBe(4);expect((await fresh()).updates).toHaveLength(2);
 for(const patch of [{measured_value:null},{measured_value:'NaN'},{measured_value:1e16},{kind:'weekly',measured_value:2},{evidence:''},{next_step:''},{observed_on:'2999-01-01'},{observed_on:'0001-01-01 BC'},{evidence_url:'javascript:alert(1)'},{evidence_url:'http://example.org'},{evidence_url:'https://example.org:99999'},{evidence_url:'https://user:secret@example.org'},{evidence_url:'https://example.org/ invalid'}])await rejects(()=>append(update({operation_id:id(904),id:id(402),expected_version:4,...patch})),/finite|measurement|check constraint|future/);
});
test('parent boundaries reject cross-season links, work items, missing next milestone, and invalid supporters',async()=>{
 for(const patch of [{task_ids:[id(122)]},{milestone_ids:[id(131)],next_milestone_id:id(131)},{milestone_ids:[id(132)],next_milestone_id:id(132)},{milestone_ids:[],next_milestone_id:id(130)},{supporter_ids:[id(3)]},{supporter_ids:[id(5)]},{supporter_ids:[id(99)]},{supporter_ids:[id(6),id(6)]},{task_ids:[id(120),id(120)]},{supporter_ids:null},{task_ids:['bad']},{milestone_ids:[null]}])await rejects(()=>save(goal(patch)),/season|milestone|owner|support members|Duplicate|list|uuid|identity/);
 await save(goal({task_ids:[id(120),id(121)]}));expect((await fresh()).task_ids).toEqual([id(120),id(121)]);
 await rejects(async()=>save(await edited({season_id:id(101)})),/unavailable|cannot change/);
 await adminSQL(`update planning_boards set active=false where id='${id(110)}'`);expect((await context()).tasks.find((t:any)=>t.id===id(120))).toEqual({id:id(120),board_id:null,title:'Unavailable task',status:'unavailable',owner_ids:[],available:false});await save(await edited({title:'Edit with unavailable link',task_ids:[id(120),id(121)]}));
 await save(await edited({operation_id:id(903),task_ids:[]}));await rejects(()=>save(goal({id:id(301),operation_id:id(904)})),/active task/);
});
test('archival, inactivity and revocation immediately remove write rights without hiding historical identities',async()=>{
 await save();await adminSQL(`update profiles set active=false where id='${id(6)}'`);expect((await fresh()).supporters[0].active).toBe(false);expect((await context()).members.some((m:any)=>m.id===id(6))).toBe(false);
 await as(6);await rejects(()=>append(update(),6),/Active team/);
 await adminSQL(`update profiles set role='readonly' where id='${id(3)}'`);expect((await fresh()).capabilities.can_edit).toBe(false);await rejects(()=>append(),/named supporters/);
 await as(2);expect((await context()).capabilities.can_manage).toBe(true);await adminSQL(`update team_member_positions set revoked_at=clock_timestamp() where user_id='${id(2)}'`,2);expect((await context()).capabilities.can_manage).toBe(false);await rejects(()=>save(goal({id:id(301),operation_id:id(902)}),2),/self-owned/);
 await adminSQL(`update planning_seasons set status='archived' where id='${id(100)}'`,1);expect((await fresh()).capabilities).toEqual({can_edit:false,can_update:false,can_reassign:false});await rejects(()=>append(update(),1),/archived/);await rejects(()=>save(goal({id:id(301),operation_id:id(902)}),1),/archived/);
 await as(4);await rejects(()=>context(),/unavailable/);
});
test('actor-bound exact replay is immutable, payload-sensitive, and never duplicates a mutation',async()=>{
 const receipt=await save();expect(await save()).toEqual(receipt);expect(await status(900)).toEqual(receipt);expect((await fresh()).version).toBe(1);
 await rejects(()=>save(goal({title:'Different'})),/different input/);await rejects(()=>append(update({operation_id:id(900)})),/different input/);
 await as(4);await rejects(()=>save(goal(),4),/another account/);await rejects(()=>status(900,4),/another account/);await rejects(()=>cancel(900,4),/another account/);
 await as(3);await rejects(()=>save(goal({operation_id:id(902),id:id(301)}),4),/Account changed/);await rejects(()=>append(update(),4),/Account changed/);await rejects(()=>status(900,4),/Account changed/);await rejects(()=>cancel(900,4),/Account changed/);
 const ur=await append();expect(await append()).toEqual(ur);expect((await fresh()).updates).toHaveLength(1);expect(await count('planning_private.goal_history')).toBe(2);expect(await count('planning_private.goal_operations')).toBe(2);
});
test('explicit reconciliation/cancellation distinguishes absent, cancelled and committed without resending',async()=>{
 expect(await status(900)).toEqual({status:'not_found',operation_id:id(900),result:null});
 const cancelled=await cancel(900);expect(cancelled).toEqual({status:'cancelled',operation_id:id(900),result:null});expect(await cancel(900)).toEqual(cancelled);await rejects(()=>save(),/cancelled/);expect((await context()).goals).toEqual([]);
 const r=await save(goal({operation_id:id(902)}));expect(await cancel(902)).toEqual(r);expect((await fresh()).version).toBe(1);
 await adminSQL(`update profiles set role='readonly' where id='${id(3)}'`);expect(await status(902)).toEqual(r);expect((await cancel(903)).status).toBe('cancelled');
});
test('stale writes, actor spoofing and unknown fields leave goal, receipts and evidence untouched',async()=>{
 await save();await save(await edited({title:'Current title'}));await rejects(()=>save(goal({operation_id:id(903),expected_version:1})),/Changed/);await rejects(()=>append(update()),/Changed/);
 for(const patch of [{actor_id:id(1)},{author_id:id(1)},{can_manage:true},{role:'mentor'}])await rejects(async()=>save(await edited({operation_id:id(903),...patch})),/Unknown goal/);
 await rejects(()=>append(update({expected_version:2,actor_id:id(1)})),/Unknown update/);
 expect((await fresh()).title).toBe('Current title');expect((await fresh()).version).toBe(2);expect(await count('planning_private.goal_operations')).toBe(2);
});
test('audit is atomic, server-authored and immutable; audit insert failure rolls back version, data and receipt',async()=>{
 await save();await append();await db.exec('reset role');const history=(await db.query<any>('select actor_id,action,before_data,after_data from planning_private.goal_history order by id')).rows;expect(history.map(h=>h.actor_id)).toEqual([id(3),id(3)]);expect(history.map(h=>h.action)).toEqual(['created','measurement']);expect(history[0].before_data).toBeNull();expect(history[1].after_data.update.author_id).toBe(id(3));
 for(const table of ['public.planning_goal_updates','planning_private.goal_history','planning_private.goal_operations'])for(const query of [`delete from ${table}`,`truncate ${table} cascade`])await rejects(()=>db.exec(query),/append only/);
 await db.exec("create function planning_private.fail_goal_audit() returns trigger language plpgsql as $$begin raise exception 'audit offline';end$$;create trigger fail_goal_audit before insert on planning_private.goal_history for each row execute function planning_private.fail_goal_audit();");await as(3);
 await rejects(async()=>save(await edited()),/audit offline/);await rejects(()=>append(update({id:id(401),operation_id:id(902),expected_version:2})),/audit offline/);expect((await fresh()).version).toBe(2);expect((await fresh()).updates).toHaveLength(1);expect((await status(902)).status).toBe('not_found');
});
test('RLS/revokes deny every direct table path, privileged helper and anonymous API under broad inherited grants',async()=>{
 await save();const tables=['public.planning_goals','public.planning_goal_supporters','public.planning_goal_updates','public.planning_goal_task_links','public.planning_goal_milestone_links','planning_private.goal_operations','planning_private.goal_history'];
 for(const role of ['anon','authenticated','service_role']){await db.exec(`reset role;set role ${role}`);for(const table of tables)for(const sql of [`select * from ${table}`,`delete from ${table}`,`truncate ${table}`,`insert into ${table} default values`])await rejects(()=>db.exec(sql),/permission denied/);
  await rejects(()=>db.exec(`select planning_private.goal_snapshot('${id(300)}')`),/permission denied/);
  if(role!=='authenticated'){await rejects(()=>context(),/permission denied/);await rejects(()=>save(),/permission denied/);await rejects(()=>append(),/permission denied/);await rejects(()=>status(900),/permission denied/);await rejects(()=>cancel(900),/permission denied/);}
 }
 await db.exec("reset role;select set_config('test.uid','',false);set role authenticated");await rejects(()=>context(),/Active team/);await rejects(()=>save(),/Account changed/);
 await db.exec('reset role');expect((await db.query<any>("select count(*)::integer n from pg_class where oid=any($1::regclass[]) and relrowsecurity",[tables])).rows[0].n).toBe(tables.length);
});
test('migration failure rolls back every additive object and preserves existing Planning API and rows',async()=>{
 const freshDb=new PGlite();try{await freshDb.exec(baseline());const before=(await freshDb.query<any>("select pg_get_functiondef('planning_private.manager()'::regprocedure) m,pg_get_functiondef('planning_save(text,jsonb)'::regprocedure) s")).rows;
 await expect(freshDb.exec(readFileSync(migration,'utf8').replace(/commit;\s*$/,()=>"do $$begin raise exception 'forced migration failure';end$$;commit;"))).rejects.toThrow(/forced migration/);await freshDb.exec('rollback');expect((await freshDb.query<any>("select to_regclass('public.planning_goals') g,to_regprocedure('public.planning_goals_context(uuid)') f")).rows[0]).toEqual({g:null,f:null});expect((await freshDb.query<any>("select pg_get_functiondef('planning_private.manager()'::regprocedure) m,pg_get_functiondef('planning_save(text,jsonb)'::regprocedure) s")).rows).toEqual(before);expect((await freshDb.query<any>('select count(*)::integer n from planning_tasks')).rows[0].n).toBe(3);
 }finally{await freshDb.close();}
});

test('readonly profiles never gain supporter writing; retained historical support grants no current rights',async()=>{
 expect((await context()).members.some((m:any)=>m.id===id(7))).toBe(false);
 await rejects(()=>save(goal({supporter_ids:[id(7)]})),/support members/);await save();
 await adminSQL(`update profiles set role='readonly' where id='${id(6)}'`,6);expect((await fresh()).capabilities.can_update).toBe(false);await rejects(()=>append(update(),6),/named supporters/);
 await as(3);await save(await edited({title:'Retain the historical support record'}));expect((await fresh()).supporter_ids).toEqual([id(6)]);
 await save(await edited({operation_id:id(903),supporter_ids:[]}));await rejects(async()=>save(await edited({operation_id:id(904),supporter_ids:[id(6)]})),/support members/);
});
test('a moved task link retains only its identity and may be removed without exposing the new parent',async()=>{
 await save();await adminSQL(`update planning_tasks set board_id='${id(112)}' where id='${id(120)}'`);
 expect((await context()).tasks.find((t:any)=>t.id===id(120))).toEqual({id:id(120),board_id:null,title:'Unavailable task',status:'unavailable',owner_ids:[],available:false});
 await save(await edited({title:'The linked work moved'}));expect((await fresh()).task_ids).toEqual([id(120)]);
 await as(1);expect((await context()).tasks.find((t:any)=>t.id===id(120)).title).toBe('Unavailable task');
 await as(3);await rejects(()=>save(goal({id:id(301),operation_id:id(903)})),/active task/);await save(await edited({operation_id:id(904),task_ids:[]}));expect((await fresh()).task_ids).toEqual([]);
});

test('actual RPC contexts use browser-compatible required whitespace semantics and reject blanks atomically',async()=>{
 const whitespace=['\t','\n','\u00a0','\r\n\t\u00a0','\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'];
 for(const blank of whitespace){expect(blank.trim()).toBe('');for(const key of ['title','unit'])await rejects(()=>save(goal({[key]:blank})),/check constraint/);}
 expect(await count('public.planning_goals')).toBe(0);expect(await count('planning_private.goal_operations')).toBe(0);expect(await count('planning_private.goal_history')).toBe(0);
 const padding=whitespace.at(-1)!;await save(goal({title:padding+'Student goal'+padding,unit:padding+'runs'+padding}));
 expect((await fresh()).title).toBe('Student goal');expect((await fresh()).unit).toBe('runs');const initialWire=await context();expect(()=>assertContext(initialWire,id(3),id(100))).not.toThrow();
 for(const blank of whitespace)for(const key of ['evidence','next_step'])await rejects(()=>append(update({[key]:blank})),/check constraint/);
 expect((await fresh()).version).toBe(1);expect((await fresh()).updates).toEqual([]);expect(await count('planning_private.goal_operations')).toBe(1);expect(await count('planning_private.goal_history')).toBe(1);
 await append(update({evidence:padding+'Observed four runs'+padding,next_step:padding+'Repeat tomorrow'+padding,evidence_url:padding+'https://example.org/evidence'+padding}));
 const wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.goals[0].updates[0]).toMatchObject({evidence:'Observed four runs',next_step:'Repeat tomorrow',evidence_url:'https://example.org/evidence'});
});

test('actual RPC optional malformed browser URLs preserve readable immutable evidence and context',async()=>{
 await save();let version=1;
 const invalid=['https://[::::]','https://999.999','https://1.1.1.256','https://example.org/'+ '界'.repeat(250)];
 for(let index=0;index<invalid.length;index++){
  const link=invalid[index];expect(validEvidenceUrl(link)).toBe(false);
  await append(update({id:id(420+index),operation_id:id(920+index),expected_version:version,evidence_url:link}));version++;
  const wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.goals[0].updates[0].evidence_url).toBe(link);
 }
 expect((await fresh()).updates).toHaveLength(4);
});

test('actual RPC legacy profile projections are bounded and conservative without modifying profiles',async()=>{
 await adminSQL(`update profiles set display_name=null where id='${id(3)}';update profiles set display_name=repeat('界',201) where id='${id(6)}';update profiles set display_name=E'\\t\\n' where id='${id(4)}'`);
 let wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.eligible_owners[0].name).toBe('Team member');expect(wire.members.find((m:any)=>m.id===id(6)).name).toBe('界'.repeat(200));expect(wire.members.find((m:any)=>m.id===id(4)).name).toBe('Team member');
 await save();await adminSQL(`update profiles set active=null where id='${id(6)}'`);wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.goals[0].supporters[0].active).toBe(false);expect(wire.members.some((m:any)=>m.id===id(6))).toBe(false);
 await save(await edited({title:'Unrelated edit retains historical support'}));await db.exec('reset role');const raw=(await db.query<any>(`select display_name,active from profiles where id='${id(6)}'`)).rows[0];expect(raw.display_name).toBe('界'.repeat(201));expect(raw.active).toBeNull();
});

test('actual RPC invalid legacy milestone dates become unavailable; old links survive and new links fail',async()=>{
 for(const date of ['infinity','-infinity','10000-01-01','0001-01-01 BC']){
  await db.exec('savepoint variant');await adminSQL(`update planning_items set start_date='${date}',end_date='${date}' where id='${id(130)}'`);
  let wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.milestones.find((m:any)=>m.id===id(130))).toEqual({id:id(130),title:'Unavailable milestone',start_date:null,status:'unavailable',available:false});
  await rejects(()=>save(),/available milestone/);expect((await context()).goals).toEqual([]);await db.exec('rollback to variant');
 }
 await save();await adminSQL(`update planning_items set start_date='infinity',end_date='infinity' where id='${id(130)}'`);
 await save(await edited({title:'Keep the historical link'}));let wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.goals[0].milestone_ids).toEqual([id(130)]);expect(wire.goals[0].next_milestone_id).toBe(id(130));
 await save(await edited({operation_id:id(903),next_milestone_id:null}));await rejects(async()=>save(await edited({operation_id:id(904),next_milestone_id:id(130)})),/available next milestone/);
 await save(await edited({operation_id:id(905),milestone_ids:[],next_milestone_id:null}));await rejects(async()=>save(await edited({operation_id:id(906)})),/available milestone/);
 wire=await context();expect(()=>assertContext(wire,id(3),id(100))).not.toThrow();expect(wire.goals[0].milestone_ids).toEqual([]);
});
