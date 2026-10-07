import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createReviewDatabase,asReviewUser as as,planningFixture,reviewPayload,assignmentPayload,updatePayload,saveReview,reviewContext,reviewId as id} from './fixtures/sprint-review';
import type {DecisionWorkflow,DecisionOption,TradeCriterion,TradeAssessment,EngineeringTradeStudy} from '../src/planning/reviews/decision-types';
import {assertReviewContext,updatePayload as editableUpdatePayload} from '../src/planning/reviews/model';
import {createReviewExportSnapshot} from '../src/planning/reviews/export/snapshot';
const migration=()=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(x=>x.endsWith('_sprint_review_design_decisions_v1.sql')),'utf8');
const option=(n=601):DecisionOption=>({id:id(n),label:`Option ${n}`,description:'Manual geometry comparison',weight:'Lighter in bench test',space:'Fits measured envelope',cost:'Estimate pending',reliability:'Repeat test needed',time:'Two student work sessions',evidence:[{label:'Option evidence',url:'https://example.com/evidence',reference_id:'TEST-17'}]});
const workflow=(status:DecisionWorkflow['status']='comparing'):DecisionWorkflow=>({schema_version:1,status,owner_id:id(3),target_date:'2026-10-20',decided_on:status==='recorded'?'2026-10-06':null,requirements:[{label:'Requirement source',url:'https://example.com/requirements',reference_id:'REQ-12'}],options:[option(),option(602)],chosen_option_id:status==='recorded'?id(601):null,reopen_criteria:status==='recorded'?'Reopen if the loaded cycle test fails':''});
const criterion=(n=701):TradeCriterion=>({id:id(n),label:'Mechanism mass',unit:'kg',weight:2,scale_min:0,scale_max:20,direction:'lower',must_have:true,minimum:null,maximum:15});
const assessment=(option_id=id(601),criterion_id=id(701)):TradeAssessment=>({option_id,criterion_id,value:12,reason:'Measured prototype with mounting hardware',evidence:[{label:'Measurement sheet',url:'https://example.com/measurements',reference_id:'TEST-18'}]});
const study=():EngineeringTradeStudy=>({criteria:[criterion()],assessments:[assessment(),assessment(id(602))]});
const payload=(w:unknown=workflow(),version:number|null=null)=>({...updatePayload(),version,decision_workflow:w}) as any;
let db:PGlite,fixture:Awaited<ReturnType<typeof planningFixture>>;
async function reject(fn:()=>Promise<unknown>,pattern=/Invalid/){await db.exec('savepoint rejected');try{await expect(fn()).rejects.toThrow(pattern);}finally{await db.exec('rollback to rejected');}}
async function context(){return assertReviewContext(await reviewContext(db),id(1),fixture.season,id(401));}
async function savedWorkflow(){return(await reviewContext(db)).updates[0].decision_workflow;}
async function status(key:number,actor=1){return(await db.query<any>('select sprint_review_mutation_status($1,$2) r',[id(key),id(actor)])).rows[0].r;}
test.describe.configure({mode:'serial'});
let migrationProof:any;
async function securitySnapshot(isolated:PGlite){return ({functions:(await isolated.query("select n.nspname,p.proname,case when n.nspname='planning_review_private' and p.proname='update_json' then null else pg_get_functiondef(p.oid) end body,p.proacl::text,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','planning_private','planning_review_private') and p.proname not in ('sprint_review_save','decision_workflow_valid') order by p.oid")).rows,relations:(await isolated.query("select n.nspname,c.relname,c.relacl::text,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','planning_private','planning_review_private') order by c.oid")).rows,save:(await isolated.query("select proacl::text,prosecdef,proconfig from pg_proc where oid='sprint_review_save(text,uuid,uuid,jsonb)'::regprocedure")).rows});}
test.beforeAll(async()=>{
 db=await createReviewDatabase();const before=await securitySnapshot(db);let rollbackMessage='';
 try{await db.exec(migration().replace(/commit;\s*$/,()=>"do $$begin raise exception 'synthetic decision rollback';end$$;commit;"));}catch(error){rollbackMessage=String(error);}
 await db.exec('rollback');const afterRollback=await securitySnapshot(db);const rollbackColumns=(await db.query<any>("select count(*)::int n from information_schema.columns where table_name='planning_sprint_review_updates' and column_name='decision_workflow'")).rows[0].n;
 await db.exec(migration());migrationProof={before,afterRollback,after:await securitySnapshot(db),rollbackMessage,rollbackColumns};fixture=await planningFixture(db);
});
test.afterAll(async()=>{await db?.close();});
test.beforeEach(async()=>{await as(db,1);await db.exec('begin');await saveReview(db,'review',reviewPayload());await saveReview(db,'assignment',assignmentPayload());});
test.afterEach(async()=>{await db.exec('rollback');});

test('additive migration is atomic; unchanged helpers, all grants/security and relation privileges stay identical',()=>{
 expect(migrationProof.rollbackMessage).toMatch(/synthetic decision rollback/);expect(migrationProof.rollbackColumns).toBe(0);expect(migrationProof.afterRollback).toEqual(migrationProof.before);expect(migrationProof.after).toEqual(migrationProof.before);
});

test('actual RPC, real parser and editable payload preserve manual comparison without task changes',async()=>{
 const before=(await db.query<any>('select planning_context() c')).rows[0].c;
 await as(db,3);expect(await saveReview(db,'update',payload(),3)).toMatchObject({status:'applied',version:1,entity_id:id(501)});
 await as(db,1);const c=await context();expect(c.updates[0].decision_workflow).toEqual(workflow());expect(editableUpdatePayload(c.updates[0]).decision_workflow).toEqual(workflow());
 const exported=createReviewExportSnapshot(c);expect(exported.projects.find(x=>x.id===fixture.board)?.update).toBeTruthy();
 expect((await db.query<any>('select planning_context() c')).rows[0].c.tasks).toEqual(before.tasks);
 for(const actor of [3,4,5,6]){await as(db,actor);expect(assertReviewContext(await reviewContext(db),id(actor)).updates[0].decision_workflow).toEqual(workflow());}
});

test('legacy omission retains object; explicit null clears; no-workflow legacy creation remains valid',async()=>{
 await saveReview(db,'update',updatePayload());expect(await savedWorkflow()).toBeNull();expect((await context()).updates[0].decision_owner).toBeNull();
 await saveReview(db,'update',payload(workflow(),1));
 const legacy={...updatePayload(),version:2,progress:'Legacy edit'};await saveReview(db,'update',legacy,1,id(910));expect(await savedWorkflow()).toEqual(workflow());
 await reject(()=>saveReview(db,'update',{...legacy,decision_workflow:null},1,id(910)),/request ID/);
 await saveReview(db,'update',payload(null,3));expect(await savedWorkflow()).toBeNull();
 await saveReview(db,'update',{...updatePayload(),version:4});expect(await savedWorkflow()).toBeNull();
});

test('recorded and reopened statuses use the same review record and server audit',async()=>{
 const w=workflow('recorded');await as(db,3);await saveReview(db,'update',payload(w),3,id(900));
 expect((await reviewContext(db)).updates[0]).toMatchObject({id:id(501),version:1,recorded_by:id(3),decision_workflow:w});
 const reopened={...w,status:'reopened'};await saveReview(db,'update',payload(reopened,1),3,id(901));
 await db.exec('reset role');const rows=(await db.query<any>('select actor_id,request_id,before_data,after_data from planning_review_private.history where action=\'update\' order by id')).rows;
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({actor_id:id(3),request_id:id(900),before_data:null,after_data:{decision_workflow:w}});
 expect(rows[1]).toMatchObject({before_data:{decision_workflow:w,version:1},after_data:{decision_workflow:reopened,version:2}});
 expect((await db.query<any>('select count(*)::int n from planning_sprint_review_updates')).rows[0].n).toBe(1);
});

test('recorded requires owner, date, valid choice, reported text, rationale, participants and reopen criteria',async()=>{
 const w=workflow('recorded');
 for(const change of [{owner_id:null},{decided_on:null},{chosen_option_id:null},{reopen_criteria:''},{reopen_criteria:'\u00a0\ufeff'}])await reject(()=>saveReview(db,'update',payload({...w,...change})));
 for(const change of [{reported_decision:''},{decision_rationale:' \n\t'},{reported_by_student_ids:[]}])await reject(()=>saveReview(db,'update',{...payload(w),...change}));
 await saveReview(db,'update',payload(w));
 // A legacy client may keep the workflow but cannot invalidate a recorded decision's report.
 await reject(()=>saveReview(db,'update',{...updatePayload(),version:1,reported_decision:''}));
 expect(await savedWorkflow()).toEqual(w);
});

test('only new active students or leads may own; retained historical owner is not new authority',async()=>{
 for(const owner_id of [id(1),id(6),id(7),id(8),id(10),id(999)])await reject(()=>saveReview(db,'update',payload({...workflow(),owner_id})));
 for(const owner_id of [id(2),id(3),id(4),id(5)]){await db.exec('savepoint valid_owner');await saveReview(db,'update',payload({...workflow(),owner_id}));await db.exec('rollback to valid_owner');}
 await saveReview(db,'update',payload(workflow('recorded')));
 await db.exec(`reset role;update profiles set active=false where id='${id(3)}'`);await as(db,1);
 await saveReview(db,'update',payload(workflow('recorded'),1));expect(await savedWorkflow()).toEqual(workflow('recorded'));
 const c=await context();expect(c.members.some(p=>p.id===id(3))).toBe(false);expect(c.updates[0].decision_owner).toEqual({id:id(3),name:'Project lead',active:false,is_student:true,can_write:false});
 expect(c.updates[0].decision_owner?.id).toBe(c.updates[0].decision_workflow?.owner_id);
 await as(db,3);await reject(()=>saveReview(db,'update',payload(workflow('recorded'),2),3),/account changed/);
 await as(db,1);await reject(()=>saveReview(db,'update',payload({...workflow(),owner_id:id(10)},2)));
});

test('strict workflow and option objects reject unknown, missing, wrong-type and duplicate fields',async()=>{
 const invalid:unknown[]=[{},[],false,1,'recorded',{...workflow(),schema_version:2},{...workflow(),schema_version:'1'},{...workflow(),status:'approved'},{...workflow(),owner_id:1},{...workflow(),owner_id:'bad'},{...workflow(),unknown:true},{...workflow(),options:[]},{...workflow(),options:Array.from({length:7},(_,i)=>option(700+i))},{...workflow(),options:[option(),option()]},{...workflow(),options:[{...option(),id:null}]},{...workflow(),options:[{...option(),id:'option-a'}]},{...workflow(),options:[{...option(),score:1}]},{...workflow(),options:[{...option(),label:'\u00a0\u2007\ufeff'}]},{...workflow(),chosen_option_id:id(699)}];
 const missing={...workflow()} as any;delete missing.target_date;invalid.push(missing);const missingOption={...option()} as any;delete missingOption.weight;invalid.push({...workflow(),options:[missingOption]});
 for(const w of invalid)await reject(()=>saveReview(db,'update',payload(w)));
 await reject(()=>saveReview(db,'update',{...payload(),unknown:true}));
});

test('dates require nullable finite exact ISO calendar dates including leap days and year boundaries',async()=>{
 for(const field of ['target_date','decided_on']){
  for(const value of ['infinity','-infinity','0000-01-01','10000-01-01','2026-02-30','2026-02-29','2026-1-1','2026-10-06T12:00:00Z',3,''])await reject(()=>saveReview(db,'update',payload({...workflow(),[field]:value})));
  for(const value of [null,'0001-01-01','9999-12-31','2028-02-29']){await db.exec('savepoint valid_date');await saveReview(db,'update',payload({...workflow(),[field]:value}));expect((await savedWorkflow())?.[field as 'target_date'|'decided_on']).toBe(value);await db.exec('rollback to valid_date');}
 }
});

test('UTF-16 limits and safe references match the existing validators for all manual fields',async()=>{
 for(const [field,limit] of [['label',200],['description',2000],['weight',1000],['space',1000],['cost',1000],['reliability',1000],['time',1000]] as const){
  const value='🚀'.repeat(limit/2-1)+'OK';await db.exec('savepoint valid_bound');await saveReview(db,'update',payload({...workflow(),options:[{...option(),[field]:value}]}));expect((await savedWorkflow())!.options[0][field]).toBe(value);await db.exec('rollback to valid_bound');
  await reject(()=>saveReview(db,'update',payload({...workflow(),options:[{...option(),[field]:value+'!'}]})));
 }
 await reject(()=>saveReview(db,'update',payload({...workflow(),reopen_criteria:'R'.repeat(2001)})));
 for(const url of ['javascript:alert(1)','https://user:pass@example.com','https://example.com/with space','https://example.com\\bad']){
  const refs=[{label:'Source',url,reference_id:'REQ-1'}];await reject(()=>saveReview(db,'update',payload({...workflow(),requirements:refs})));await reject(()=>saveReview(db,'update',payload({...workflow(),options:[{...option(),evidence:refs}]})));
 }
 const refs=Array.from({length:21},()=>({label:'Source',url:'https://example.com',reference_id:'REQ-1'}));await reject(()=>saveReview(db,'update',payload({...workflow(),requirements:refs})));await reject(()=>saveReview(db,'update',payload({...workflow(),options:[{...option(),evidence:refs}]})));
});

test('the original 64KB request ceiling still applies to an otherwise valid comparison',async()=>{
 const w={...workflow(),options:Array.from({length:6},(_,i)=>({...option(700+i),description:'🚀'.repeat(1000),weight:'🚀'.repeat(500),space:'🚀'.repeat(500),cost:'🚀'.repeat(500),reliability:'🚀'.repeat(500),time:'🚀'.repeat(500)}))};
 expect(Buffer.byteLength(JSON.stringify(payload(w)))).toBeGreaterThan(64000);await reject(()=>saveReview(db,'update',payload(w)));
});

test('readonly, lost assignment, changed role and inactive account are rechecked before exact replay',async()=>{
 await as(db,3);const p=payload();await saveReview(db,'update',p,3,id(920));
 for(const actor of [5,6]){await as(db,actor);expect((await reviewContext(db)).updates).toHaveLength(1);await reject(()=>saveReview(db,'update',payload(workflow(),1),actor),/unavailable/);}
 await db.exec(`reset role;update profiles set role='readonly' where id='${id(3)}'`);await as(db,3);await reject(()=>saveReview(db,'update',p,3,id(920)),/unavailable/);expect((await status(920,3)).status).toBe('applied');
 await db.exec(`reset role;update profiles set role='student' where id='${id(3)}';update planning_project_review_assignments set lead_id='${id(5)}' where board_id='${fixture.board}'`);await as(db,3);await reject(()=>saveReview(db,'update',p,3,id(920)),/unavailable/);
 await db.exec(`reset role;update profiles set active=false where id='${id(3)}'`);await as(db,3);await reject(()=>status(920,3),/account changed/);
});

test('exact replay, payload conflicts, stale versions and actor-bound recovery include workflow atomically',async()=>{
 const p=payload(workflow('recorded'));const first=await saveReview(db,'update',p,1,id(930));expect(await saveReview(db,'update',p,1,id(930))).toEqual(first);
 await reject(()=>saveReview(db,'update',{...p,decision_workflow:{...workflow('recorded'),reopen_criteria:'Different'}},1,id(930)),/request ID/);
 await reject(()=>saveReview(db,'update',payload(workflow(),null)),/Changed/);await saveReview(db,'update',payload(workflow('reopened'),1));await reject(()=>saveReview(db,'update',payload(null,1)),/Changed/);
 await as(db,3);expect((await status(930,3)).status).toBe('unknown');await reject(()=>saveReview(db,'update',payload(workflow(),2),1),/account changed/);
 await as(db,1);expect(await status(930)).toEqual(first);expect((await savedWorkflow())?.status).toBe('reopened');
});

test('audit failure rolls back workflow, report, version and receipt without leaking details',async()=>{
 await saveReview(db,'update',payload());const before=(await reviewContext(db)).updates[0];
 await db.exec("reset role;create function planning_review_private.fail_decision_audit() returns trigger language plpgsql as $$begin raise exception 'sensitive synthetic failure';end$$;create trigger fail_decision_audit before insert on planning_review_private.history for each row execute function planning_review_private.fail_decision_audit();");await as(db,1);
 await db.exec('savepoint fail');let failure:any;try{await saveReview(db,'update',payload(workflow('recorded'),1),1,id(940));}catch(error){failure=error;}await db.exec('rollback to fail');
 expect(failure.message).toMatch(/Invalid/);expect(failure.message).not.toContain('sensitive');expect(failure.detail||'').toBe('');expect((await reviewContext(db)).updates[0]).toEqual(before);expect((await status(940)).status).toBe('unknown');
});

test('new private helper, update column and RPC remain inaccessible to unauthorized direct roles',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec(`reset role;set role ${role}`);
  await reject(()=>db.exec('select decision_workflow from planning_sprint_review_updates'),/permission denied/);
  await reject(()=>db.exec("update planning_sprint_review_updates set decision_workflow=null"),/permission denied/);
  await reject(()=>db.exec("select planning_review_private.decision_workflow_valid(null,null,null)"),/permission denied/);
  if(role!=='authenticated')await reject(()=>saveReview(db,'update',payload()),/permission denied/);
 }
});


test('trade study and optional SWOT round-trip raw data through RPC, parser, audit and legacy edits',async()=>{
 const w={...workflow('recorded'),trade_study:study(),options:[{...option(),swot:{strengths:'Serviceable',weaknesses:'Test time',opportunities:'Reusable fixture',threats:'Supplier lead time'}},{...option(602),swot:null}]};
 // A team's selected option may fail a hard constraint; that must be visible, not algorithmically vetoed.
 w.trade_study.assessments[0].value=18;
 await saveReview(db,'update',payload(w));expect((await context()).updates[0].decision_workflow).toEqual(w);
 expect(editableUpdatePayload((await context()).updates[0]).decision_workflow).toEqual(w);
 await saveReview(db,'update',{...updatePayload(),version:1,progress:'Legacy edit keeps measured values'});expect(await savedWorkflow()).toEqual(w);
 await db.exec('reset role');expect((await db.query<any>("select after_data->'decision_workflow' w from planning_review_private.history where action='update' order by id desc limit 1")).rows[0].w).toEqual(w);
});

test('trade-study numerical fields, explicit normalization and separate hard constraints are strictly bounded',async()=>{
 const invalid=[{weight:-1},{weight:1001},{weight:null},{weight:'1'},{scale_min:null},{scale_max:null},{scale_min:20},{scale_max:0},{scale_min:-1e12-1},{scale_max:1e12+1},{direction:'maximize'},{must_have:'true'},{minimum:null,maximum:null},{minimum:16,maximum:15},{must_have:false},{unit:''},{unit:'u'.repeat(51)},{label:'x'.repeat(201)},{computed_score:100}];
 for(const change of invalid)await reject(()=>saveReview(db,'update',payload({...workflow(),trade_study:{criteria:[{...criterion(),...change}],assessments:[]}})));
 const good=[{weight:0},{weight:1000},{weight:0.125},{scale_min:-1e12,scale_max:1e12},{must_have:false,minimum:null,maximum:null},{minimum:15,maximum:15},{minimum:-1e12,maximum:1e12},{direction:'higher'}];
 for(const change of good){await db.exec('savepoint valid_criterion');const w={...workflow(),trade_study:{criteria:[{...criterion(),...change}],assessments:[]}};await saveReview(db,'update',payload(w));expect(await savedWorkflow()).toEqual(w);await db.exec('rollback to valid_criterion');}
});

test('study IDs, strict keys, array limits and assessment references fail closed; partial raw data remains allowed',async()=>{
 const base=study();const badStudy:any[]=[[],{},false,{...base,score:90},{criteria:[criterion(),criterion()],assessments:[]},{criteria:Array.from({length:9},(_,i)=>criterion(700+i)),assessments:[]},{criteria:[criterion()],assessments:Array.from({length:49},()=>assessment())},{criteria:[],assessments:[assessment()]},{...base,assessments:[assessment(),assessment()]},{...base,assessments:[{...assessment(),option_id:id(699)}]},{...base,assessments:[{...assessment(),criterion_id:id(799)}]},{...base,assessments:[{...assessment(),value:'12'}]},{...base,assessments:[{...assessment(),value:1e12+1}]},{...base,assessments:[{...assessment(),value:-1e12-1}]},{...base,assessments:[{...assessment(),reason:'r'.repeat(2001)}]},{...base,assessments:[{...assessment(),normalized_score:60}]}];
 const missing={...criterion()} as any;delete missing.maximum;badStudy.push({criteria:[missing],assessments:[]});const missingAssessment={...assessment()} as any;delete missingAssessment.value;badStudy.push({...base,assessments:[missingAssessment]});
 for(const trade_study of badStudy)await reject(()=>saveReview(db,'update',payload({...workflow(),trade_study})));
 const criteria=Array.from({length:8},(_,i)=>criterion(700+i));const options=Array.from({length:6},(_,i)=>option(600+i));const full={...workflow(),options,trade_study:{criteria,assessments:options.flatMap(o=>criteria.map(c=>assessment(o.id,c.id)))}};await db.exec('savepoint full_study');await saveReview(db,'update',payload(full));expect((await savedWorkflow())!.trade_study!.assessments).toHaveLength(48);await db.exec('rollback to full_study');
 for(const trade_study of [null,{criteria:[],assessments:[]},{criteria:[criterion()],assessments:[{...assessment(),value:null}]},{criteria:[criterion()],assessments:[{...assessment(),value:1e12}]},{criteria:[criterion()],assessments:[{...assessment(),value:-1e12}]}]){await db.exec('savepoint partial_study');await saveReview(db,'update',payload({...workflow(),trade_study}));expect((await savedWorkflow())!.trade_study).toEqual(trade_study);await db.exec('rollback to partial_study');}
});

test('per-assessment evidence and every optional SWOT text field use the existing safe bounds',async()=>{
 for(const swot of [{},false,[],{strengths:'',weaknesses:'',opportunities:'',threats:'',score:1},...['strengths','weaknesses','opportunities','threats'].map(k=>({strengths:'',weaknesses:'',opportunities:'',threats:'',[k]:'🚀'.repeat(1000)+'!'}))])await reject(()=>saveReview(db,'update',payload({...workflow(),options:[{...option(),swot}]})));
 const swot={strengths:'🚀'.repeat(1000),weaknesses:'',opportunities:'',threats:''};await saveReview(db,'update',payload({...workflow(),options:[{...option(),swot}]}));expect((await savedWorkflow())!.options[0].swot).toEqual(swot);
 for(const evidence of [[{label:'Test',url:'javascript:alert(1)',reference_id:'TEST-1'}],Array.from({length:21},()=>({label:'Test',url:'https://example.com',reference_id:'TEST-1'})),[{label:'Test',url:'https://example.com',reference_id:'TEST-1',secret:'no'}]])await reject(()=>saveReview(db,'update',payload({...workflow(),trade_study:{criteria:[criterion()],assessments:[{...assessment(),evidence}]}},1)));
});


test('raw JSON numeric precision cannot store a scale that collapses in JavaScript or unrepresentable measurements',async()=>{
 let key=970;
 const rawSave=async(raw:string)=>(await db.query<any>('select sprint_review_save($1,$2,$3,$4) r',['update',id(++key),id(1),raw])).rows[0].r;
 const rawPayload=(overrides:Record<string,string>,assessmentValue?:string)=>{
  const c={...criterion(),...Object.fromEntries(Object.keys(overrides).map(k=>[k,`RAW_${k}`]))};
  const a={...assessment(),...(assessmentValue===undefined?{}:{value:'RAW_VALUE'})};
  let raw=JSON.stringify(payload({...workflow(),trade_study:{criteria:[c],assessments:[a]}}));
  for(const [field,value] of Object.entries(overrides))raw=raw.replace(JSON.stringify(`RAW_${field}`),value);
  return assessmentValue===undefined?raw:raw.replace('"RAW_VALUE"',assessmentValue);
 };
 for(const raw of [
  rawPayload({scale_min:'1e-45',scale_max:'1.00000000000000000001e-45'}),
  rawPayload({scale_min:'0',scale_max:'1e-1000'}),
  rawPayload({weight:'1e-1000'}),rawPayload({minimum:'1e-1000'}),rawPayload({},'1e-1000'),
  rawPayload({minimum:'16',maximum:'15'}),rawPayload({maximum:'1000000000001'}),rawPayload({},'1000000000001'),
  rawPayload({scale_min:'-1e1000'}),rawPayload({},'1e1000'),
 ])await reject(()=>rawSave(raw));
 // Representable small measurements and endpoints survive the actual RPC/read parser.
 const raw=rawPayload({scale_min:'1e-45',scale_max:'2e-45',minimum:'1e-45',maximum:'2e-45'},'1.5e-45');
 await rawSave(raw);const c=await context();expect(c.updates[0].decision_workflow!.trade_study!.criteria[0]).toMatchObject({scale_min:1e-45,scale_max:2e-45,minimum:1e-45,maximum:2e-45});
 expect(c.updates[0].decision_workflow!.trade_study!.assessments[0].value).toBe(1.5e-45);
});
