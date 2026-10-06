import type {Page,Route} from '@playwright/test';
import type {Context,Task} from '../../src/planning/service';
import type {AssemblyCheck,AssemblyComponent,AssemblyContext,AssemblyMutation,AssemblyReceipt,AssemblySnapshot,CheckInput,ComponentInput} from '../../src/planning/assembly/types';
import {readinessFacts} from '../../src/planning/assembly/model';

export const assemblyId=(n:number)=>`30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const assemblyActor=assemblyId(1),assemblySeason=assemblyId(100),assemblyBoard=assemblyId(200);
export const assemblyRoute=`/#planning/boards/${assemblyBoard}/assembly`;
export const assemblyToken='synthetic-assembly-actor-token';
const recordedAt='2026-10-06T12:00:00Z';

/** All records, names, tokens and evidence references are synthetic. No real accounts or project data. */
export function assemblyUIFixture():AssemblyContext{
 const task=(n:number,title:string,status:string):Task=>({id:assemblyId(n),board_id:assemblyBoard,title,description:'Synthetic Planning task for interface testing.',status,priority:'normal',owner_ids:[assemblyActor],owners:[{id:assemblyActor,name:'Alex Builder',active:true}],area_id:null,start_date:null,due_date:'2026-10-10',blocked_reason:status==='blocked'?'Waiting for the replacement bushing.':'',version:1});
 const check=(n:number,title:string,revision:number|null,outcome:AssemblyCheck['outcome']):AssemblyCheck=>({id:assemblyId(n),title,kind:'fit',outcome,procedure:'Dry fit the synthetic shaft and rotate by hand.',expected:'Free rotation with no binding.',observed:outcome==='passed'?'Rotates freely through a full turn.':'Binding at the support bracket.',evidence_url:`https://example.com/synthetic-assembly/check-${n}`,revision_id:revision?assemblyId(revision):null,rework_task_id:outcome==='failed'?assemblyId(302):null,supersedes_id:null,created_by:assemblyActor,created_at:recordedAt});
 const context:AssemblyContext={user_id:assemblyActor,board_id:assemblyBoard,version:4,can_edit:true,loaded_at:'2026-10-06T13:00:00Z',
  components:[{id:assemblyId(500),name:'Flanged shaft bearings',quantity:4,status:'received',notes:'All four synthetic units checked.',created_by:assemblyActor,created_at:recordedAt,updated_at:recordedAt},{id:assemblyId(501),name:'Timing belt',quantity:1,status:'ordered',notes:'Synthetic order awaiting delivery.',created_by:assemblyActor,created_at:recordedAt,updated_at:recordedAt}],
  parts:[{id:assemblyId(400),name:'Intake side plate',status:'done',version:3,current_revision_id:assemblyId(411),revision_number:2,quantity:2},{id:assemblyId(401),name:'Shaft support bracket',status:'in_progress',version:1,current_revision_id:assemblyId(412),revision_number:1,quantity:2}],
  revisions:[{id:assemblyId(410),part_id:assemblyId(400),name:'Intake side plate',revision_number:1},{id:assemblyId(411),part_id:assemblyId(400),name:'Intake side plate',revision_number:2},{id:assemblyId(412),part_id:assemblyId(401),name:'Shaft support bracket',revision_number:1}],
  tasks:[task(300,'Mount the intake roller','done'),task(301,'Install the belt guard','todo'),task(302,'Correct the support bracket fit','blocked')],linked_task_ids:[assemblyId(300),assemblyId(302)],
  checks:[check(600,'Original plate fit',410,'passed'),check(601,'Support bracket fit',412,'failed')],snapshots:[],facts:{} as AssemblyContext['facts']};
 context.facts=readinessFacts(context);return context;
}
export function assemblyPlanningFixture(context:AssemblyContext):Context{
 return {user_id:context.user_id,can_manage:context.can_edit,season_id:assemblySeason,seasons:[{id:assemblySeason,name:'Synthetic 2026–27 season',status:'active',start_date:'2026-09-01',end_date:'2027-06-30',version:1}],members:[{id:assemblyActor,name:'Alex Builder'}],areas:[],groups:[],items:[],boards:[{id:assemblyBoard,season_id:assemblySeason,name:'Intake prototype',description:'From manufactured parts to a tested subsystem.',kind:'project',area_id:null,active:true,display_order:0,version:1},{id:assemblyId(201),season_id:assemblySeason,name:'Elevator prototype',description:'A separate synthetic project.',kind:'project',area_id:null,active:true,display_order:1,version:1}],tasks:context.tasks,dependencies:[]};
}
export async function changeAssemblyActor(page:Page,id:string|null,token='synthetic-second-actor-token'){
 await page.evaluate(({actor,accessToken})=>{const channel=new BroadcastChannel('4418-team-hub-auth');if(actor){const session={access_token:accessToken,refresh_token:'synthetic-refresh',expires_at:4000000000,token_type:'bearer',user:{id:actor,aud:'authenticated',app_metadata:{},user_metadata:{}}};localStorage.setItem('4418-team-hub-auth',JSON.stringify(session));channel.postMessage({event:'SIGNED_IN',session});}else{localStorage.removeItem('4418-team-hub-auth');channel.postMessage({event:'SIGNED_OUT',session:null});}channel.close();},{actor:id,accessToken:token});
}
export async function setupAssemblyUI(page:Page,adjust?:(context:AssemblyContext)=>void){
 const context=assemblyUIFixture();adjust?.(context);context.facts=readinessFacts(context);
 const mutations:AssemblyMutation[]=[],canonicalWrites:unknown[]=[],external:string[]=[],requests:{name:string;body:any;authorization:string|undefined}[]=[],receipts=new Map<string,AssemblyReceipt>();
 await page.route('**/*',r=>{const url=new URL(r.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return r.continue();external.push(url.origin+url.pathname);return r.abort('blockedbyclient');});
 await page.addInitScript(({actor,token})=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',expires_at:4000000000,token_type:'bearer',user:{id:actor,aud:'authenticated',app_metadata:{},user_metadata:{}}})),{actor:context.user_id,token:assemblyToken});
 await page.route('**/rest/v1/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/profiles')?{display_name:'Synthetic member',role:'student',active:true}:[]}));
 const capture=(r:Route)=>{const value={name:new URL(r.request().url()).pathname.split('/').at(-1)!,body:r.request().postDataJSON(),authorization:r.request().headers()['authorization']};requests.push(value);return value.body;};
 await page.route('**/rpc/planning_context',r=>r.fulfill({json:assemblyPlanningFixture(context)}));
 await page.route('**/rpc/planning_my_work_context',r=>r.fulfill({json:assemblyPlanningFixture(context)}));
 await page.route('**/rpc/planning_task_detail',r=>r.fulfill({json:{steps:[],comments:[],history:[]}}));
 await page.route('**/rpc/planning_save',r=>{canonicalWrites.push(r.request().postDataJSON());return r.fulfill({status:400,json:{code:'TEST_ONLY',message:'Unexpected canonical Planning write in assembly test'}});});
 await page.route('**/rpc/assembly_context',r=>{const body=capture(r);if(body.expected_actor!==context.user_id||body.board_id!==context.board_id)return r.fulfill({status:403,json:{code:'AS403',message:'Unavailable synthetic project'}});context.facts=readinessFacts(context);return r.fulfill({json:context});});
 function apply(body:AssemblyMutation):AssemblyReceipt{
  mutations.push(structuredClone(body));const earlier=receipts.get(body.request_id);if(earlier)return earlier;
  if(body.expected_actor!==context.user_id||body.p.board_id!==context.board_id||body.p.version!==context.version||!context.can_edit)throw Error('Invalid synthetic assembly mutation');
  const p=body.p,now='2026-10-06T14:00:00Z';let entity:string;
  if(body.action==='component'){const input=p as ComponentInput,prior=context.components.find(c=>c.id===input.id);entity=input.id;const value:AssemblyComponent={id:input.id,name:input.name,quantity:input.quantity,status:input.status,notes:input.notes,created_by:prior?.created_by||context.user_id,created_at:prior?.created_at||now,updated_at:now};if(prior)Object.assign(prior,value);else context.components.push(value);}
  else if(body.action==='task_link'){const input=p as {task_id:string;linked:boolean};entity=input.task_id;if(input.linked)context.linked_task_ids=[...new Set([...context.linked_task_ids,entity])];else context.linked_task_ids=context.linked_task_ids.filter(id=>id!==entity);}
  else if(body.action==='check'){const input=p as CheckInput;entity=input.id;context.checks.unshift({id:input.id,title:input.title,kind:input.kind,outcome:input.outcome,procedure:input.procedure,expected:input.expected,observed:input.observed,evidence_url:input.evidence_url,revision_id:input.revision_id,rework_task_id:input.rework_task_id,supersedes_id:input.supersedes_id,created_by:context.user_id,created_at:now});}
  else{const input=p as {id:string;notes:string};entity=input.id;const facts=structuredClone(readinessFacts(context));const snapshot:AssemblySnapshot={id:entity,board_id:context.board_id,created_by:context.user_id,created_at:now,notes:input.notes,facts,summary:`Assembly & testing snapshot · ${now}\nSnapshot ${entity}\nParts made: ${facts.parts_done}/${facts.parts_total}\nComponents on hand: ${facts.components_available}/${facts.components_total}\nAssembly tasks done: ${facts.tasks_done}/${facts.tasks_total}\nCurrent checks: ${facts.checks_passed} passed, ${facts.checks_failed} failed, ${facts.checks_blocked} blocked, ${facts.checks_stale} older revision\n${input.notes}`};context.snapshots.unshift(snapshot);}
  context.version++;context.facts=readinessFacts(context);const receipt:AssemblyReceipt={request_id:body.request_id,status:'applied',action:body.action,entity_id:entity,version:context.version};receipts.set(body.request_id,receipt);return receipt;
 }
 await page.route('**/rpc/assembly_mutate',r=>r.fulfill({json:apply(capture(r))}));
 await page.route('**/rpc/assembly_mutation_status',r=>{const body=capture(r);return r.fulfill({json:receipts.get(body.request_id)||{request_id:body.request_id,status:'unknown',action:null,entity_id:null,version:null}});});
 await page.route('**/rpc/assembly_cancel_mutation',r=>{const body=capture(r),receipt=receipts.get(body.request_id)||{request_id:body.request_id,status:'cancelled' as const,action:null,entity_id:null,version:null};receipts.set(body.request_id,receipt);return r.fulfill({json:receipt});});
 return {context,mutations,canonicalWrites,external,requests,receipts,apply};
}
