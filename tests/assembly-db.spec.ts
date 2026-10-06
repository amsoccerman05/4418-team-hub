import {test,expect} from '@playwright/test';
import type {PGlite} from '@electric-sql/pglite';
import {createAssemblyDatabase,seedAssembly,as,id,component,check,payload,context,mutate,receipt} from './fixtures/assembly';
import {upload,submission,mutate as fabricate,actionPayload} from './fixtures/fabrication';
import {reviewPayload,saveReview,updatePayload} from './fixtures/sprint-review';
test.describe.configure({mode:'serial'});let db:PGlite;
async function reject(fn:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint rejected');try{await expect(fn()).rejects.toThrow(pattern);}finally{await db.exec('rollback to rejected');}}
test.beforeAll(async()=>{db=await createAssemblyDatabase();await seedAssembly(db);});test.afterAll(async()=>{await db?.close();});test.beforeEach(async()=>{await db.exec('reset role;begin');});test.afterEach(async()=>{await db.exec('rollback');});

test('transactional additive migration and empty canonical context start at version zero',async()=>{
 const c=await context(db);expect(c).toMatchObject({user_id:id(3),board_id:id(201),version:0,can_edit:true,components:[],parts:[],revisions:[],checks:[],snapshots:[],linked_task_ids:[]});
 expect(c.tasks).toHaveLength(1);expect(c.tasks[0]).toMatchObject({id:id(301),board_id:id(201),owner_ids:[id(3),id(4)],owners:[{id:id(3),name:'Project lead',active:true},{id:id(4),name:'Student supporter',active:true}],status:'todo'});
 expect(Object.values(c.facts)).toEqual(Array(12).fill(0));
});
test('component versions, exact replay, stale writes and actor-specific terminal cancellation',async()=>{
 const p=payload(component()),key=id(60001);const r=await mutate(db,'component',p,3,key);expect(r).toEqual({request_id:key,status:'applied',action:'component',entity_id:id(901),version:1});
 expect(await mutate(db,'component',p,3,key)).toEqual(r);await reject(()=>mutate(db,'component',{...p,name:'Different'},3,key),/already used/);
 await reject(()=>mutate(db,'component',payload(component(902))),/Changed by another teammate/);
 expect(await receipt(db,key,4)).toMatchObject({status:'unknown'});expect(await receipt(db,key,3,true)).toEqual(r);
 const cancelled=id(60002);expect(await receipt(db,cancelled,3,true)).toMatchObject({status:'cancelled',action:null,entity_id:null,version:null});
 expect(await mutate(db,'component',payload(component(902),1),3,cancelled)).toMatchObject({status:'cancelled'});
 await mutate(db,'component',payload({...component(),status:'received'},1));const c=await context(db);expect(c.version).toBe(2);expect(c.components).toHaveLength(1);expect(c.components[0]).toMatchObject({status:'received',created_by:id(3)});expect(c.facts.components_available).toBe(1);
 await db.exec('reset role');expect((await db.query<{n:number}>('select count(*)::int n from assembly_private.history')).rows[0].n).toBe(2);
});
test('current project leads/supporters and managers can edit; unassigned, inactive and readonly cannot',async()=>{
 for(const actor of [1,2,3,4,8]){expect((await context(db,201,actor)).can_edit).toBe(true);}
 for(const actor of [5,6,9]){expect((await context(db,201,actor)).can_edit).toBe(false);await reject(()=>mutate(db,'component',payload(component()),actor),/unavailable/);}
 await as(db,3);await reject(()=>db.query('select assembly_context($1,$2)',[id(201),id(1)]),/account changed/);
 await reject(()=>context(db,201,7),/account changed/);
 await mutate(db,'component',payload(component()),4,id(61001));await db.exec(`reset role;delete from planning_project_review_supporters where board_id='${id(201)}' and user_id='${id(4)}'`);
 expect((await context(db,201,4)).can_edit).toBe(false);await reject(()=>mutate(db,'component',payload(component()),4,id(61001)),/unavailable/);expect(await receipt(db,id(61001),4)).toMatchObject({status:'applied'});
 await db.exec(`reset role;update profiles set active=false where id='${id(3)}'`);await reject(()=>receipt(db,id(61001),3),/account changed/);
});
test('draft, archived, inactive and area boards preserve canonical project visibility',async()=>{
 await reject(()=>context(db,203,3),/unavailable/);expect((await context(db,203,1)).can_edit).toBe(true);await mutate(db,'component',payload(component(),0,203),1);
 await reject(()=>context(db,204,1),/unavailable/);await reject(()=>mutate(db,'component',payload(component(),0,204),1),/unavailable/);
 await db.exec(`reset role;update planning_seasons set status='archived' where id='${id(101)}'`);await reject(()=>context(db,201,3),/unavailable/);expect((await context(db,201,1)).can_edit).toBe(false);await reject(()=>mutate(db,'component',payload(component()),1),/unavailable/);
 await db.exec(`reset role;update planning_seasons set status='active' where id='${id(101)}';update planning_boards set active=false where id='${id(201)}'`);await reject(()=>context(db,201,6),/unavailable/);expect((await context(db,201,2)).can_edit).toBe(false);await reject(()=>mutate(db,'component',payload(component()),2),/unavailable/);
 await db.exec(`reset role;update team_member_positions set revoked_at=clock_timestamp() where user_id='${id(2)}'`);await reject(()=>context(db,201,2),/unavailable/);
});
test('task links are same-board canonical pointers; live owners, status and blockers stay authoritative',async()=>{
 await reject(()=>mutate(db,'task_link',payload({task_id:id(302),linked:true})),/unavailable/);await reject(()=>mutate(db,'task_link',payload({task_id:id(303),linked:true})),/unavailable/);
 expect(await mutate(db,'task_link',payload({task_id:id(301),linked:true}))).toMatchObject({entity_id:id(301),version:1});
 await as(db,1);await db.query('select planning_save($1,$2)',['task',JSON.stringify({id:id(301),board_id:id(201),version:1,title:'Current canonical task',status:'blocked',priority:'high',blocked_reason:'Waiting for mount',owner_ids:[id(4)]})]);
 let c=await context(db);expect(c.tasks[0]).toMatchObject({title:'Current canonical task',status:'blocked',blocked_reason:'Waiting for mount',owner_ids:[id(4)]});expect(c.facts).toMatchObject({tasks_total:1,tasks_done:0,tasks_blocked:1});
 await mutate(db,'check',payload({...check(),outcome:'blocked',rework_task_id:id(301)},1));
 // A privileged canonical repair can relocate a task even though normal task edits preserve its board.
 await db.exec(`reset role;update planning_tasks set board_id='${id(202)}',title='Moved task secret',status='done' where id='${id(301)}'`);
 c=await context(db);expect(c.tasks).toEqual([]);expect(c.linked_task_ids).toEqual([]);expect(c.checks[0].rework_task_id).toBe(id(301));expect(c.facts.tasks_total).toBe(0);expect(JSON.stringify(c)).not.toContain('Moved task secret');
});
test('checks preserve immutable history, same-subject supersession and latest current facts',async()=>{
 await upload(db);await mutate(db,'check',payload({...check(),revision_id:id(701),outcome:'failed',rework_task_id:id(301)}));
 await mutate(db,'check',payload({...check(1002),revision_id:id(701),supersedes_id:id(1001)},1));
 let c=await context(db);expect(c.checks).toHaveLength(2);expect(c.facts).toMatchObject({parts_total:1,checks_total:1,checks_passed:1,checks_failed:0,checks_stale:0});
 await reject(()=>mutate(db,'check',payload({...check(1003),revision_id:id(701),supersedes_id:id(1001)},2)),/Changed/);
 await reject(()=>mutate(db,'check',payload({...check(1003),supersedes_id:id(1002)},2)),/Changed/);
 await reject(()=>mutate(db,'check',payload({...check(1002),revision_id:id(701)},2)),/Changed/);
 await upload(db,submission(601,702,1));c=await context(db);expect(c.parts[0].current_revision_id).toBe(id(702));expect(c.revisions).toHaveLength(2);expect(c.facts).toMatchObject({checks_total:1,checks_passed:0,checks_stale:1});
 await mutate(db,'check',payload({...check(1003),revision_id:id(701),supersedes_id:id(1002),outcome:'blocked'},2));
 await mutate(db,'check',payload({...check(1004),revision_id:id(702)},3));
 c=await context(db);expect(c.facts).toMatchObject({checks_total:2,checks_passed:1,checks_failed:0,checks_blocked:0,checks_stale:1});
 await db.exec('reset role');for(const statement of ['update assembly_private.checks set title=\'overwrite\'','delete from assembly_private.checks'])await reject(()=>db.exec(statement),/Immutable/);
});
test('forged cross-project revision, supersession, component and rework links are rejected',async()=>{
 await upload(db,submission(601,701,null,202),1);await reject(()=>mutate(db,'check',payload({...check(),revision_id:id(701)})),/unavailable/);
 await reject(()=>mutate(db,'check',payload({...check(),outcome:'failed',rework_task_id:id(303)})),/Invalid/);await reject(()=>mutate(db,'check',payload({...check(),rework_task_id:id(301)})),/Invalid/);
 await mutate(db,'component',payload(component(),0,202),1);await reject(()=>mutate(db,'component',payload(component()),1),/unavailable/);
 await mutate(db,'check',payload(check(),1,202),1);await reject(()=>mutate(db,'check',payload({...check(1002),supersedes_id:id(1001)})),/Changed/);
});
test('snapshots capture server facts and timestamp immutably without changing Planning, Reviews or Fabrication',async()=>{
 await upload(db);await fabricate(db,'claim',actionPayload(),5);await fabricate(db,'ready',actionPayload(2),5);await fabricate(db,'acknowledge',actionPayload(3),5);await fabricate(db,'start',actionPayload(4),5);await fabricate(db,'done',actionPayload(5),5);
 await as(db,1);await saveReview(db,'review',reviewPayload());await saveReview(db,'update',updatePayload());
 await mutate(db,'component',payload({...component(),status:'installed'}));await mutate(db,'task_link',payload({task_id:id(301),linked:true},1));await mutate(db,'check',payload({...check(),revision_id:id(701)},2));
 const canonical=async()=>{await db.exec('reset role');return (await db.query("select jsonb_build_object('tasks',(select jsonb_agg(to_jsonb(t)) from planning_tasks t),'updates',(select jsonb_agg(to_jsonb(u)) from planning_sprint_review_updates u),'reviews',(select jsonb_agg(to_jsonb(r)) from planning_sprint_reviews r),'parts',(select jsonb_agg(to_jsonb(p)) from fabrication_parts p)) d")).rows;};
 const before=await canonical();await mutate(db,'snapshot',payload({id:id(1101),notes:'Ready for discussion'},3));const c=await context(db),s=c.snapshots[0];expect(s.facts).toEqual(c.facts);expect(s.facts).toMatchObject({parts_done:1,components_available:1,checks_passed:1,tasks_done:0});expect(s.summary).toContain('Ready for discussion');expect(s.summary).toContain('Captured');expect(s.summary).toContain(`Snapshot ID: ${id(1101)}`);expect(s.created_by).toBe(id(3));expect(Number.isFinite(Date.parse(s.created_at))).toBe(true);expect(await canonical()).toEqual(before);
 await mutate(db,'component',payload({...component(),status:'needed'},4));const later=await context(db);expect(later.facts.components_available).toBe(0);expect(later.snapshots[0]).toEqual(s);
 await db.exec('reset role');for(const table of ['snapshots','requests','history'])for(const verb of ['update','delete'])await reject(()=>db.exec(verb==='update'?`update assembly_private.${table} set created_at=clock_timestamp()`:`delete from assembly_private.${table}`),/Immutable/);
});
test('strict exact-key bounds and safe evidence reject malformed untrusted payloads atomically',async()=>{
 for(const invalid of [{...payload(component()),extra:true},{...payload(component()),quantity:0},{...payload(component()),quantity:100001},{...payload(component()),quantity:'2'},{...payload(component()),quantity:1.5},{...payload(component()),version:null},{...payload(component()),version:-1},{...payload(component()),version:'0'},{...payload(component()),name:'\u00a0'},{...payload(component()),name:'a'.repeat(201)},{...payload(component()),status:'done'},{...payload(component()),notes:'a'.repeat(2001)},{...payload(component()),id:'wrong'}])await reject(()=>mutate(db,'component',invalid as any),/Invalid/);
 for(const field of ['procedure','expected','observed'])for(const value of ['', '\u00a0', 'a'.repeat(2001)])await reject(()=>mutate(db,'check',payload({...check(),[field]:value})),/Invalid/);
 for(const url of ['http://example.com','javascript:alert(1)','https://user:pass@example.com','https://localhost/a','https://a.localhost/a','https://a.local/a','https://127.0.0.1','https://10.0.0.2/a','https://[::1]/','https://example.com\\@evil.org','https://example.com/\n','https://example.com/%0afoo','https://example.com:65536','https://example.com:0','https://exa_mple.com'])await reject(()=>mutate(db,'check',payload({...check(),evidence_url:url})),/Invalid/);
 await mutate(db,'check',payload({...check(),evidence_url:'HTTPS://docs.example.com:443/results?q=1#proof'}));expect((await context(db)).version).toBe(1);
 await db.exec('reset role');expect((await db.query<{n:number}>('select count(*)::int n from assembly_private.requests')).rows[0].n).toBe(1);
});
test('raw URL mutations reject punycode and C1 controls before immutable records can poison client context',async()=>{
 const urls=['https://xn--a.com','https://sub.xn--a.com','https://XN--a.com','https://xn--bcher-kva.example','https://example.com/\u0085'];
 for(const evidence_url of urls){
  await db.exec('reset role');expect((await db.query<{safe:boolean}>('select assembly_private.evidence_url($1) safe',[evidence_url])).rows[0].safe).toBe(false);
  await reject(()=>mutate(db,'check',payload({...check(),evidence_url})),/Invalid/);
 }
 const before=await context(db);expect(before.version).toBe(0);expect(before.checks).toEqual([]);
 await mutate(db,'check',payload(check()));const after=await context(db);expect(after.version).toBe(1);expect(after.checks).toHaveLength(1);expect(after.checks[0].evidence_url).toBe('https://example.com/test-results');
});
test('component and append-only history capacities fail before losing data; full context never truncates',async()=>{
 await db.exec(`reset role;insert into assembly_private.components(id,board_id,name,quantity,status,created_by) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${id(201)}','Synthetic component '||i,1,'needed','${id(1)}' from generate_series(20000,20199) i;`);
 expect((await context(db)).components).toHaveLength(200);await reject(()=>mutate(db,'component',payload(component())),/limit reached/);await mutate(db,'component',payload(component(20000)));expect((await context(db)).components).toHaveLength(200);
 await db.exec(`reset role;insert into assembly_private.checks(id,board_id,title,kind,outcome,procedure,expected,observed,created_by) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${id(201)}','Synthetic check '||i,'fit','passed','Fit the bearing','No interference','Fits freely','${id(1)}' from generate_series(30000,30999) i;`);
 expect((await context(db)).checks).toHaveLength(1000);await reject(()=>mutate(db,'check',payload(check(),1)),/limit reached/);expect((await context(db)).version).toBe(1);
 await db.exec(`reset role;insert into assembly_private.snapshots(id,board_id,notes,facts,summary,created_by) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${id(201)}','',assembly_private.facts('${id(201)}'),'Synthetic snapshot','${id(1)}' from generate_series(40000,40199) i;`);
 expect((await context(db)).snapshots).toHaveLength(200);await reject(()=>mutate(db,'snapshot',payload({id:id(1101),notes:''},1)),/limit reached/);
});
test('task-link and per-project mutation budgets reject growth but preserve readable records',async()=>{
 await db.exec(`reset role;insert into planning_tasks(id,board_id,title,created_by) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${id(201)}','Synthetic linked task '||i,'${id(1)}' from generate_series(70000,70499) i;insert into assembly_private.task_links(board_id,task_id,created_by) select '${id(201)}',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${id(1)}' from generate_series(70000,70499) i;`);
 expect((await context(db)).linked_task_ids).toHaveLength(500);await reject(()=>mutate(db,'task_link',payload({task_id:id(301),linked:true})),/limit reached/);
 await mutate(db,'task_link',payload({task_id:id(70000),linked:false}));await mutate(db,'task_link',payload({task_id:id(301),linked:true},1));expect((await context(db)).linked_task_ids).toHaveLength(500);
 await db.exec(`reset role;insert into assembly_private.requests(actor_id,request_id,status,board_id) select '${id(1)}',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'applied','${id(201)}' from generate_series(80000,89997) i;`);
 await reject(()=>mutate(db,'component',payload(component(),2)),/limit reached/);expect((await context(db)).version).toBe(2);expect((await receipt(db,id(99001),3,true)).status).toBe('cancelled');
});
test('audit failure rolls back data, board version and receipt and sanitizes private error details',async()=>{
 await db.exec(`reset role;create function assembly_private.audit_failure() returns trigger language plpgsql set search_path='' as $$begin raise exception 'protected database detail';end$$;create trigger audit_failure before insert on assembly_private.history for each row execute function assembly_private.audit_failure();`);
 await reject(()=>mutate(db,'component',payload(component()),3,id(62001)),/could not complete/);expect(await receipt(db,id(62001))).toMatchObject({status:'unknown'});const c=await context(db);expect(c.version).toBe(0);expect(c.components).toEqual([]);
});
test('every private table/helper has RLS and zero direct grants; anonymous/service RPC access denied',async()=>{
 for(const role of ['anon','authenticated','service_role']){await db.exec(`reset role;set role ${role}`);for(const table of ['boards','components','task_links','checks','snapshots','requests','history'])for(const verb of ['select * from','delete from','truncate'])await reject(()=>db.exec(`${verb} assembly_private.${table}`),/permission denied/);await reject(()=>db.exec('select assembly_private.facts(null)'),/permission denied/);
 if(role!=='authenticated')for(const q of [`select assembly_context('${id(201)}','${id(3)}')`,`select assembly_mutate('component','${id(63001)}','${id(3)}','{}')`,`select assembly_mutation_status('${id(63001)}','${id(3)}')`,`select assembly_cancel_mutation('${id(63001)}','${id(3)}')`])await reject(()=>db.exec(q),/permission denied/);}
 await db.exec('reset role');expect((await db.query<{n:number}>("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='assembly_private' and c.relkind='r' and c.relrowsecurity")).rows[0].n).toBe(7);
});
