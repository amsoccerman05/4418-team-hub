import {test,expect} from '@playwright/test';
import type {PGlite} from '@electric-sql/pglite';
import {createReviewDatabase,asReviewUser as as,planningFixture,reviewPayload,assignmentPayload,updatePayload,saveReview,reviewContext,reviewId as id} from './fixtures/sprint-review';
import type {ReviewMutationReceipt} from '../src/planning/reviews/types';
import {assertReviewContext,validateReviewPayload,updatePayload as editableUpdatePayload} from '../src/planning/reviews/model';
import {createReviewExportSnapshot} from '../src/planning/reviews/export/snapshot';
import {assertReviewReceipt,assertReviewReceiptMatches} from '../src/planning/reviews/service';
test.describe.configure({mode:'serial'});
let db:PGlite,fixture:Awaited<ReturnType<typeof planningFixture>>;
async function reject(fn:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint rejected');try{await expect(fn()).rejects.toThrow(pattern);}finally{await db.exec('rollback to rejected');}}
async function receipt(key:string,actor=1,method='status'){return(await db.query<{r:ReviewMutationReceipt}>(`select sprint_review_${method==='status'?'mutation_status':'cancel_mutation'}($1,$2) r`,[key,id(actor)])).rows[0].r;}
test.beforeAll(async()=>{db=await createReviewDatabase();fixture=await planningFixture(db);});
test.afterAll(async()=>{await db?.close();});
test.beforeEach(async()=>{await as(db,1);await db.exec('begin');});
test.afterEach(async()=>{await db.exec('rollback');});

test('header, assignment and update return actual typed context and canonical work projections',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());
 await as(db,3);const saved=await saveReview(db,'update',updatePayload(),3);expect(saved).toMatchObject({status:'applied',entity_id:id(501),version:1});
 const c=await reviewContext(db);expect(c).toMatchObject({user_id:id(3),can_manage:false,season_id:fixture.season,selected_review_id:id(401)});
 expect(c.boards.find(x=>x.id===fixture.board)).toMatchObject({can_edit_update:true,assignment:{lead_id:id(3),supporter_ids:[id(1),id(4)]}});
 expect(c.updates[0]).toMatchObject({recorded_by:id(3),reported_by_student_ids:[id(2),id(3)],linked_task:{id:fixture.task,owner_ids:[id(3),id(4)],due_date:'2026-10-10',available:true}});
 expect(c.members.find(x=>x.id===id(9))?.name).toBe('Unnamed teammate');
 expect(c.tasks.some(x=>x.id===fixture.privateTask)).toBe(false);
});
test('actual RPC responses pass the actual frontend parser and detached export across access and legacy cases',async()=>{
 for(const [action,payload] of [['review',reviewPayload()],['assignment',assignmentPayload()],['update',updatePayload()]] as const){expect(validateReviewPayload(action,payload)).toBeNull();await saveReview(db,action,payload);}
 for(const actor of [1,2,3,4,6]){
  await as(db,actor);const context=assertReviewContext(await reviewContext(db),id(actor),fixture.season,id(401));
  const snapshot=createReviewExportSnapshot(context);expect(snapshot.projects.find(x=>x.id===fixture.board)?.update?.nextTask).toMatchObject({owners:['Project lead','Student supporter'],dueDate:'2026-10-10',available:true});
  expect(snapshot.projects.find(x=>x.id===fixture.board)?.update?.reportedBy).toEqual(['Student leadership','Project lead']);
  context.updates[0].progress='Changed after export';expect(snapshot.projects.find(x=>x.id===fixture.board)?.update?.progress).toBe('Tested the new prototype');
 }
 await db.exec(`reset role;update profiles set active=false,display_name=repeat('🚀',200) where id='${id(3)}';
 update planning_tasks set due_date='infinity' where id='${fixture.task}';
 update planning_sprint_review_updates set evidence='[{"label":"Legacy source","url":"https://example.com:bad","reference_id":"TEST-OLD"}]' where id='${id(501)}';`);
 await as(db,1);let context=assertReviewContext(await reviewContext(db),id(1));
 expect(context.updates[0].reported_students.find(x=>x.id===id(3))).toMatchObject({active:false,can_write:false});
 expect(context.updates[0].reported_students.find(x=>x.id===id(3))!.name.length).toBe(150);
 expect(context.updates[0].evidence[0].url).toBe('');expect(context.updates[0].linked_task).toMatchObject({due_date:null,due_date_unavailable:true});
 await db.exec(`reset role;update planning_sprint_review_updates set linked_task_id='${fixture.privateTask}' where id='${id(501)}'`);await as(db,6);
 context=assertReviewContext(await reviewContext(db),id(6));expect(createReviewExportSnapshot(context).projects.find(x=>x.id===fixture.board)?.update?.nextTask).toMatchObject({available:false,owners:[],dueDate:null});
 await db.exec(`reset role;update planning_seasons set status='archived' where id='${fixture.season}'`);await as(db,6);
 expect(assertReviewContext(await reviewContext(db),id(6))).toMatchObject({season_id:null,selected_review_id:null,boards:[],tasks:[],updates:[]});
});
test('valid reference labels preserve 173/200 UTF-16 units and END suffix through actual save, parser, export and later edits',async()=>{
 await saveReview(db,'review',reviewPayload());
 const labels=['R'.repeat(170)+'END','R'.repeat(197)+'END','🚀'.repeat(98)+'XEND',' '+'R'.repeat(195)+'END'+' '];
 let version:number|null=null;
 for(const label of labels){
  const p={...updatePayload(),version,evidence:[{label,url:'https://example.com/evidence',reference_id:'EVIDENCE-200'}],decision_references:[{label,url:'https://example.com/decisions',reference_id:'DECISION-200'}]};
  expect([173,200]).toContain(label.length);expect(validateReviewPayload('update',p)).toBeNull();
  await saveReview(db,'update',p);
  const c=assertReviewContext(await reviewContext(db),id(1));
  expect(c.updates[0].evidence[0].label).toBe(label);expect(c.updates[0].decision_references[0].label).toBe(label);
  const exported=createReviewExportSnapshot(c).projects.find(x=>x.id===fixture.board)!.update!;
  expect(exported.evidence[0].label).toBe(label);expect(exported.decisionReferences[0].label).toBe(label);
  // A later unrelated edit must not persist a shortened read projection.
  await saveReview(db,'update',{...editableUpdatePayload(c.updates[0]),progress:'An unrelated later edit'});
  const reread=assertReviewContext(await reviewContext(db),id(1)).updates[0];
  expect(reread.evidence[0].label).toBe(label);expect(reread.decision_references[0].label).toBe(label);version=reread.version;
 }
 for(const label of ['R'.repeat(198)+'END','🚀'.repeat(99)+'END']){
  expect(label.length).toBe(201);
  for(const field of ['evidence','decision_references'] as const){
   const p={...updatePayload(),version,[field]:[{label,url:'https://example.com/source',reference_id:'LIMIT-201'}]};
   expect(validateReviewPayload('update',p)).not.toBeNull();await reject(()=>saveReview(db,'update',p),/Invalid/);
  }
 }
 await db.exec(`reset role;update profiles set display_name=repeat('P',197)||'END' where id='${id(3)}'`);await as(db,1);
 expect(assertReviewContext(await reviewContext(db),id(1)).members.find(p=>p.id===id(3))!.name).toBe('P'.repeat(150));
 await reject(()=>db.exec("select planning_review_private.bounded_text('x',200)"),/permission denied/);
});
test('canonical Task owner sets larger than review assignment limits remain readable',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'update',updatePayload());
 await db.exec(`reset role;insert into profiles(id,display_name,role,active) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Synthetic owner '||i,'student',true from generate_series(2000,2035) i;
 insert into planning_task_assignees(task_id,user_id) select '${fixture.task}',id from profiles where display_name like 'Synthetic owner %';`);await as(db,1);
 const context=assertReviewContext(await reviewContext(db),id(1));expect(context.updates[0].linked_task?.owner_ids).toHaveLength(38);
});
test('bounded meeting history retains explicitly selected header and unavailable historical attribution',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'update',{...updatePayload(),reported_by_student_ids:[id(9)]});
 await db.exec(`reset role;delete from profiles where id='${id(9)}';
 insert into planning_sprint_reviews(id,season_id,title,review_date,recorded_by)
 select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${fixture.season}','Synthetic later review '||i,date '2027-01-01'+(i-4000),'${id(1)}' from generate_series(4000,4100) i;`);
 await as(db,1);const context=assertReviewContext(await reviewContext(db,fixture.season,id(401)),id(1),fixture.season,id(401));
 expect(context.reviews).toHaveLength(101);expect(context.reviews_limit_reached).toBe(true);
 expect(context.updates[0].reported_students).toEqual([{id:id(9),name:'Unavailable teammate',active:false,is_student:false,can_write:false}]);
 expect(createReviewExportSnapshot(context).title).toBe('Weekly Sprint Review');
});
test('only explicit current writers or Planning leadership can write; readonly retains reading',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());
 for(const actor of [1,2,3,4,8]){await as(db,actor);await saveReview(db,'update',{...updatePayload(),version:actor===1?null:actor===2?1:actor===3?2:actor===4?3:4},actor);}
 for(const actor of [5,6]){await as(db,actor);expect((await reviewContext(db)).updates).toHaveLength(1);await reject(()=>saveReview(db,'update',{...updatePayload(),version:5},actor),/unavailable/);await reject(()=>saveReview(db,'assignment',assignmentPayload(),actor),/unavailable/);}
 await as(db,7);await reject(()=>reviewContext(db),/account changed/);
 await as(db,1);await db.exec(`reset role;update profiles set role='readonly' where id='${id(4)}'`);await as(db,4);
 expect((await reviewContext(db)).boards.find(x=>x.id===fixture.board)?.can_edit_update).toBe(false);
 await reject(()=>saveReview(db,'update',{...updatePayload(),version:5},4),/unavailable/);
});
test('assignment has student lead and permitted supporter roles; no exclusive functional silo',async()=>{
 for(const lead_id of [id(1),id(6),id(7),id(99)])await reject(()=>saveReview(db,'assignment',{...assignmentPayload(),lead_id}),/Invalid/);
 for(const supporter_ids of [[id(6)],[id(10)],[id(99)],[id(3)],[id(4),id(4)]])await reject(()=>saveReview(db,'assignment',{...assignmentPayload(),supporter_ids}),/Invalid/);
 await saveReview(db,'assignment',assignmentPayload());await saveReview(db,'assignment',{...assignmentPayload(fixture.otherBoard),supporter_ids:[id(4),id(8)]});
 expect((await reviewContext(db)).boards.filter(x=>x.assignment?.lead_id===id(3))).toHaveLength(2);
});
test('draft and archived visibility follows existing Planning; archived and inactive boards are read only',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());await saveReview(db,'update',updatePayload());
 await saveReview(db,'review',reviewPayload(id(402),fixture.draft));await as(db,3);
 await reject(()=>reviewContext(db,fixture.draft),/unavailable/);
 await reject(()=>reviewContext(db,fixture.season,id(402)),/unavailable/);
 await db.exec(`reset role;update planning_boards set active=false where id='${fixture.board}'`);await as(db,3);
 expect((await reviewContext(db)).updates).toHaveLength(0);await reject(()=>saveReview(db,'update',{...updatePayload(),version:1},3),/unavailable/);
 await as(db,1);expect((await reviewContext(db)).updates).toHaveLength(1);
 await db.exec(`reset role;update planning_seasons set status='archived' where id='${fixture.season}'`);await as(db,1);
 await reject(()=>saveReview(db,'review',{...reviewPayload(),version:1}),/unavailable/);
 await as(db,3);await reject(()=>reviewContext(db,fixture.season),/unavailable/);
});
test('direct review links resolve the authorized actual season and still reject explicit mismatch or hidden seasons',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'review',reviewPayload(id(402),fixture.draft));
 await saveReview(db,'update',{...updatePayload(id(502),id(402),fixture.draftBoard),linked_task_id:fixture.privateTask});
 for(const status of ['draft','archived']){
  if(status==='archived')await db.exec(`reset role;update planning_seasons set status='archived' where id='${fixture.draft}'`);
  for(const actor of [1,2,8]){
   await as(db,actor);const c=assertReviewContext(await reviewContext(db,null,id(402)),id(actor),null,id(402));
   expect(c).toMatchObject({season_id:fixture.draft,selected_review_id:id(402),can_manage:true});
   expect(c.seasons.find(s=>s.id===fixture.draft)?.status).toBe(status);
   expect(c.updates.map(u=>u.id)).toEqual([id(502)]);
   expect(c.boards.every(b=>b.season_id===fixture.draft)).toBe(true);
   expect(createReviewExportSnapshot(c).reviewId).toBe(id(402));
   await reject(()=>reviewContext(db,fixture.season,id(402)),/unavailable/);
  }
  for(const actor of [3,6]){
   await as(db,actor);await reject(()=>reviewContext(db,null,id(402)),/unavailable/);
   await reject(()=>reviewContext(db,fixture.draft,id(402)),/unavailable/);
   const active=assertReviewContext(await reviewContext(db,null,id(401)),id(actor),null,id(401));
   expect(active.season_id).toBe(fixture.season);
  }
 }
 for(const actor of [1,3]){await as(db,actor);await reject(()=>reviewContext(db,null,id(4999)),/unavailable/);}
});
test('review updates never alter Planning tasks or task assignment permission',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());
 const before=(await db.query<any>('select planning_context() c')).rows[0].c;
 await as(db,4);await saveReview(db,'update',{...updatePayload(),linked_task_id:fixture.areaTask},4);
 await reject(()=>db.query('select planning_save($1,$2)',['task',JSON.stringify({id:fixture.areaTask,version:1,board_id:fixture.areaBoard,title:'Attempt',status:'todo',priority:'normal',owner_ids:[id(4)]})]),/assigned/);
 await as(db,1);expect((await db.query<any>('select planning_context() c')).rows[0].c.tasks).toEqual(before.tasks);
 await reject(()=>saveReview(db,'update',{...updatePayload(),version:1,linked_task_id:fixture.privateTask}),/Invalid/);
});
test('exact actor-bound replay/status/cancel; cancellation is an immutable tombstone',async()=>{
 const payload=reviewPayload(),key=id(900);const first=await saveReview(db,'review',payload,1,key);
 expect(assertReviewReceiptMatches(first,{action:'review',request_id:key,expected_actor:id(1),p:payload})).toEqual(first);
 expect(await saveReview(db,'review',payload,1,key)).toEqual(first);expect(await receipt(key)).toEqual(first);
 await reject(()=>saveReview(db,'review',{...payload,title:'Different'},1,key),/request ID/);
 await as(db,2);expect((await receipt(key,2)).status).toBe('unknown');await reject(()=>receipt(key,1),/account changed/);await reject(()=>saveReview(db,'review',payload,1,id(901)),/account changed/);
 await as(db,1);expect(await receipt(key,1,'cancel')).toEqual(first);
 const cancelled=await receipt(id(902),1,'cancel');expect(cancelled).toMatchObject({status:'cancelled',action:null,entity_id:null,version:null});
 expect(assertReviewReceipt(cancelled,id(902))).toEqual(cancelled);
 expect(await saveReview(db,'review',{...payload,id:id(402)},1,id(902))).toEqual(cancelled);
 expect((await reviewContext(db)).reviews).toHaveLength(1);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from planning_review_private.history')).rows[0].n).toBe(1);
 await reject(()=>db.exec('update planning_review_private.requests set status=\'cancelled\''),/Immutable/);
});
test('stale versions and duplicate project review cannot overwrite; audit is server recorded and atomic',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());await saveReview(db,'update',updatePayload());
 await reject(()=>saveReview(db,'update',{...updatePayload(),version:null}),/Changed/);
 await reject(()=>saveReview(db,'update',{...updatePayload(id(599)),version:null}),/Changed/);
 await as(db,3);await saveReview(db,'update',{...updatePayload(),version:1,reported_by_student_ids:[]},3);
 const current=(await reviewContext(db)).updates[0];expect(current.recorded_by).toBe(id(3));expect(current.reported_by_student_ids).toEqual([]);
 await db.exec("reset role;create function planning_review_private.fail_audit() returns trigger language plpgsql as $$begin raise exception 'secret-row-detail';end$$;create trigger fail_audit before insert on planning_review_private.history for each row execute function planning_review_private.fail_audit();");await as(db,3);
 let failure:any;await db.exec('savepoint audit');try{await saveReview(db,'update',{...updatePayload(),version:2,progress:'Should roll back'},3);}catch(e){failure=e;}await db.exec('rollback to audit');
 expect(failure.message).not.toContain('secret-row-detail');expect(failure.detail||'').toBe('');expect((await reviewContext(db)).updates[0]).toEqual(current);
});
test('revocation and current role checks apply before idempotent replay',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());await as(db,3);
 const key=id(910);await saveReview(db,'update',updatePayload(),3,key);
 await as(db,1);await saveReview(db,'assignment',{...assignmentPayload(),lead_id:id(5),version:1});await as(db,3);
 await reject(()=>saveReview(db,'update',updatePayload(),3,key),/unavailable/);
 expect((await receipt(key,3)).status).toBe('applied');
 await db.exec(`reset role;update profiles set active=false where id='${id(3)}'`);await as(db,3);
 await reject(()=>receipt(key,3),/account changed/);
});
test('references, dates, whitespace, unknown fields and malformed identifiers fail safely',async()=>{
 for(const title of ['',' \n\t','\u00a0\u2007\ufeff'])await reject(()=>saveReview(db,'review',{...reviewPayload(),title}),/Invalid/);
 await reject(()=>saveReview(db,'review',{...reviewPayload(),title:'🚀'.repeat(101)}),/Invalid/);
 for(const review_date of ['0000-01-01','infinity','-infinity','10000-01-01','2026-02-30','2026-1-1'])await reject(()=>saveReview(db,'review',{...reviewPayload(),review_date}),/Invalid/);
 for(const review_date of ['0001-01-01','9999-12-31']){await db.exec('savepoint finite');await saveReview(db,'review',{...reviewPayload(),review_date});expect((await reviewContext(db)).reviews[0].review_date).toBe(review_date);await db.exec('rollback to finite');}
 await saveReview(db,'review',reviewPayload());
 for(const url of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.com','https://example.com/with space','https://example.com\\evil'])await reject(()=>saveReview(db,'update',{...updatePayload(),evidence:[{label:'Evidence',url,reference_id:''}]}),/Invalid/);
 await reject(()=>saveReview(db,'update',{...updatePayload(),recorded_by:id(1)} as any),/Invalid/);
 await reject(()=>saveReview(db,'update',{...updatePayload(),reported_by_student_ids:[id(1)]}),/Invalid/);
 await reject(()=>saveReview(db,'update',{...updatePayload(),linked_task_id:'bad-uuid'}),/Invalid/);
});
test('legacy profile labels and unavailable canonical task dates/links are normalized without source mutation',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'update',updatePayload());
 await db.exec(`reset role;update profiles set display_name=repeat('Long name ',100) where id='${id(3)}';update planning_tasks set due_date='infinity' where id='${fixture.task}';`);await as(db,1);
 let c=await reviewContext(db);expect(c.updates[0].linked_task).toMatchObject({due_date:null,due_date_unavailable:true});expect(c.members.find(x=>x.id===id(3))!.name.length).toBe(150);
 await db.exec(`reset role;update profiles set display_name=repeat('🚀',100) where id='${id(3)}';`);await as(db,1);
 expect((await reviewContext(db)).members.find(x=>x.id===id(3))!.name.length).toBe(150);
 await db.exec(`reset role;update planning_sprint_review_updates set evidence='[{"label":"Legacy","url":"not a URL","reference_id":"E-1"}]' where id='${id(501)}';update planning_sprint_review_updates set linked_task_id='${fixture.privateTask}' where id='${id(501)}';`);await as(db,3);
 c=await reviewContext(db);expect(c.updates[0].evidence[0].url).toBe('');expect(c.updates[0].linked_task).toMatchObject({available:false,title:'Linked task unavailable',owners:[],due_date:null,board_id:null});
 await db.exec('reset role');expect((await db.query<any>(`select due_date::text d from planning_tasks where id='${fixture.task}'`)).rows[0].d).toBe('infinity');
});
test('carry-forward references earlier same-project updates with no duplicate tasks/register',async()=>{
 await saveReview(db,'review',reviewPayload());await saveReview(db,'update',updatePayload());
 await saveReview(db,'review',{...reviewPayload(id(402)),review_date:'2026-10-13'});
 await saveReview(db,'update',{...updatePayload(id(502),id(402)),carry_from_update_id:id(501)});
 const c=await reviewContext(db);expect(c.previous_updates.map(x=>x.id)).toEqual([id(501)]);expect(c.updates[0].carried_from).toMatchObject({update_id:id(501),review_id:id(401)});
 await reject(()=>saveReview(db,'update',{...updatePayload(id(503),id(402),fixture.otherBoard),carry_from_update_id:id(501)}),/Invalid/);
 await reject(()=>saveReview(db,'update',{...updatePayload(),version:1,carry_from_update_id:id(502)}),/Invalid/);
 await reject(()=>saveReview(db,'update',{...updatePayload(),version:1,carry_from_update_id:id(501)}),/Invalid/);
 await reject(()=>saveReview(db,'review',{...reviewPayload(),version:1,review_date:'2026-10-20'}),/Invalid/);
 await reject(()=>saveReview(db,'review',{...reviewPayload(id(402)),version:1,review_date:'2026-09-20'}),/Invalid/);
});
test('all direct table/private helper and anonymous RPC access is denied; existing helpers unchanged',async()=>{
 for(const role of ['anon','authenticated','service_role']){await db.exec(`reset role;set role ${role}`);for(const table of ['planning_sprint_reviews','planning_project_review_assignments','planning_project_review_supporters','planning_sprint_review_updates','planning_review_private.history','planning_review_private.requests'])for(const verb of ['select * from','delete from','truncate'])await reject(()=>db.exec(`${verb} ${table}`),/permission denied/);
  await reject(()=>db.exec('select planning_review_private.person(null)'),/permission denied/);if(role!=='authenticated')await reject(()=>reviewContext(db),/permission denied/);
 }
 await db.exec('reset role');expect((await db.query<any>("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='planning_review_private' and c.relkind='r' or c.relname in ('planning_sprint_reviews','planning_project_review_assignments','planning_project_review_supporters','planning_sprint_review_updates')) and c.relrowsecurity")).rows[0].n).toBe(6);
});
