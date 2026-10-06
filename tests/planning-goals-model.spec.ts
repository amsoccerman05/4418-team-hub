import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {goalsFixture,goalId,actor,seasonId,definitionFixture,updateFixture} from './fixtures/season-goals';
let dir='',api:any;
test.beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),'planning-goals-'));const bundle=join(dir,'goals.cjs');buildSync({stdin:{contents:`export * from './src/planning/goals/model';export * from './src/planning/goals/session';export * from './src/planning/goals/service';export * from './src/planning/goals/GoalViews';export * from './src/planning/goals/GoalRecovery';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';export {createClient} from '@supabase/supabase-js';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},outfile:bundle,logLevel:'silent'});api=createRequire(import.meta.url)(bundle);});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
test('exact goal routes accept UUID case but reject extra segments, encodings and case-altered route grammar',()=>{
 expect(api.goalRoute('#planning/goals')).toEqual({valid:true,id:null});expect(api.goalRoute(`#planning/goals/${goalId(20).toUpperCase()}`)).toEqual({valid:true,id:goalId(20)});
 for(const route of ['#planning/GOALS','#planning/goals/','#Planning/goals/'+goalId(20),'#planning/goals/'+goalId(20)+'/extra','#planning/goals/%31','#planning/goals/javascript:alert(1)'])expect(api.goalRoute(route).valid).toBe(false);
});
test('lower-is-better and maintain targets use measurements, without derived completion percentages',()=>{
 const goal=goalsFixture().goals[0];expect(api.measurementSummary(goal)).toEqual({value:24,observedOn:'2026-09-28',reached:false});goal.updates[0].measured_value=17;expect(api.measurementSummary(goal).reached).toBe(true);expect(api.latestUpdate(goal).status).toBe('on_track');
 goal.direction='equal';goal.baseline=goal.target=17;expect(api.measurementSummary(goal).reached).toBe(true);goal.updates[0].measured_value=18;expect(api.measurementSummary(goal).reached).toBe(false);
 const p=definitionFixture();p.baseline=p.target=10;expect(api.validateDefinition(p)).toContain('direction');p.direction='equal';expect(api.validateDefinition(p)).toBeNull();
});
test('backdated evidence preserves latest observed measurement; newer weekly notes preserve measured progress',()=>{
 const goal=goalsFixture().goals[0];goal.updates.push({...goal.updates[0],id:goalId(52),kind:'weekly',measured_value:null,status:'blocked',observed_on:'2026-10-01',created_at:'2026-10-01T12:00:00Z'});goal.updates.push({...goal.updates[0],id:goalId(53),measured_value:29,observed_on:'2026-09-01',created_at:'2026-10-02T12:00:00Z'});
 expect(api.measurementSummary(goal).value).toBe(24);expect(api.latestUpdate(goal).id).toBe(goalId(53));expect(goal.updates).toHaveLength(3);
});
test('definition validates finite values, real calendar dates, direction, identities and distinct lists',()=>{
 const p=definitionFixture();expect(api.validateDefinition(p)).toBeNull();
 for(const patch of [{baseline:NaN},{target:Infinity},{target:1e13},{deadline:'2026-02-30'},{deadline:'2026-2-01'},{direction:'decrease'},{category:'bad'},{owner_id:'bad'},{supporter_ids:[actor]},{task_ids:[goalId(30),goalId(30)]},{unit:' '},{expected_version:-1}])expect(api.validateDefinition({...p,...patch})).not.toBeNull();
 for(const value of ['', ' ', 'NaN','Infinity','1e309'])expect(api.finiteValue(value)).toBeNull();expect(api.finiteValue('0')).toBe(0);expect(api.finiteValue('-2.5')).toBe(-2.5);
});
test('evidence is not a promise: measurement needs a value, weekly note cannot change it, and future observation is invalid',()=>{
 const p=updateFixture();expect(api.validateUpdate(p,'2026-10-06')).toBeNull();for(const patch of [{measured_value:null},{measured_value:NaN},{evidence:' '},{next_step:''},{observed_on:'2026-10-07'},{observed_on:'2026-02-30'},{kind:'weekly'},{evidence_url:'javascript:alert(1)'},{evidence_url:'http://example.test'},{evidence_url:'https://name:secret@example.test'}])expect(api.validateUpdate({...p,...patch},'2026-10-06')).not.toBeNull();expect(api.validateUpdate({...p,kind:'weekly',measured_value:null},'2026-10-06')).toBeNull();
});
test('fundraising distinguishes pledged and received, and forbids a funds type on other goal categories',()=>{
 const p={...definitionFixture(),category:'fundraising'};expect(api.validateDefinition(p)).toContain('pledged');for(const funds of ['pledged','received'])expect(api.validateDefinition({...p,fundraising_measure:funds})).toBeNull();expect(api.validateDefinition({...definitionFixture(),fundraising_measure:'received'})).not.toBeNull();
});
test('context fails closed on actor, season, capabilities, invalid records, duplicates and cross-goal evidence',()=>{
 expect(api.assertContext(goalsFixture(),actor,seasonId).goals).toHaveLength(2);
 const changes=[(c:any)=>c.user_id=goalId(8),(c:any)=>c.season_id=goalId(9),(c:any)=>c.capabilities.can_create='true',(c:any)=>c.goals[0].capabilities.can_update=null,(c:any)=>c.goals.push(c.goals[0]),(c:any)=>c.goals[0].baseline=Infinity,(c:any)=>c.goals[0].updates[0].goal_id=goalId(99),(c:any)=>c.goals[0].updates[0].author.id=goalId(99),(c:any)=>c.goals[0].supporter_ids=[],(c:any)=>c.goals[0].measurement_locked=false,(c:any)=>c.goals[0].updates[0].observed_on='2026-02-30',(c:any)=>c.goals[0].updates[0].goal_version=99,(c:any)=>c.goals[0].created_at='no date',(c:any)=>c.goals[0].category='secret'];
 for(const change of changes){const c=goalsFixture();change(c);expect(()=>api.assertContext(c,actor,seasonId)).toThrow(/verified/);}
});
test('unavailable task placeholders are redacted and cannot smuggle old titles or owners',()=>{
 const c=goalsFixture();Object.assign(c.tasks[0],{available:false,title:'Unavailable task',status:'unavailable',board_id:null,owner_ids:[]});expect(api.assertContext(c,actor,seasonId)).toBe(c);for(const patch of [{title:'Private old task'},{board_id:goalId(11)},{owner_ids:[actor]},{status:'done'}])expect(()=>api.assertContext({...c,tasks:[{...c.tasks[0],...patch}]},actor,seasonId)).toThrow();
});
test('session rejects close/reopen, Back, other actor/season, disposal and old StrictMode setup tickets',()=>{
 const scope={actorId:actor,seasonId,route:'#planning/goals'},session=new api.GoalSession(scope);session.activate();const original=session.openEditor(),controller=session.controller();expect(session.current(original)).toBe(true);session.closeEditor();expect(controller.signal.aborted).toBe(true);expect(session.current(original)).toBe(false);session.openEditor();expect(session.current(original)).toBe(false);const current=session.ticket();expect(session.current(current,'#planning')).toBe(false);expect(session.current({...current,actorId:goalId(2)})).toBe(false);expect(session.current({...current,seasonId:goalId(9)})).toBe(false);session.dispose();expect(session.current(current)).toBe(false);session.activate();expect(session.current(current)).toBe(false);expect(session.current(session.ticket())).toBe(true);
});
const pending=(n=60)=>({actorId:actor,seasonId,operationId:goalId(n),goalId:goalId(20),expectedVersion:2,updateId:goalId(51)});
test('receipts persist only opaque expected results and are isolated by actor; stale finish cannot erase a replacement',()=>{
 const values=new Map<string,string>();Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v)},configurable:true});const receipt=pending();api.rememberGoalOperation({...receipt,title:'DO NOT PERSIST',evidence:'DO NOT PERSIST'});expect([...values.values()].join()).not.toContain('PERSIST');expect(api.pendingGoalOperation(goalId(2),seasonId)).toBeNull();expect(()=>api.rememberGoalOperation(pending(62))).toThrow(/pending/);api.finishGoalOperation(pending(62));expect(api.pendingGoalOperation(actor,seasonId)).toEqual(receipt);api.finishGoalOperation(receipt);expect(api.pendingGoalOperation(actor,seasonId)).toBeNull();
});
test('blocked tab storage retains recovery in memory and reports its keep-tab-open limitation',()=>{
 Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}},configurable:true});api.rememberGoalOperation(pending(63));expect(api.goalReceiptStorageAvailable()).toBe(false);expect(api.pendingGoalOperation(actor,seasonId)?.operationId).toBe(goalId(63));api.finishGoalOperation(pending(63));
});
test('receipt verification requires matching operation, goal, version and update, never arbitrary valid IDs',()=>{
 const receipt={status:'committed',operation_id:goalId(60),result:{goal_id:goalId(20),version:3,update_id:goalId(51)}};expect(api.assertReceiptMatches(receipt,pending())).toEqual(receipt);for(const result of [{...receipt,operation_id:goalId(62)},{...receipt,result:{...receipt.result,goal_id:goalId(21)}},{...receipt,result:{...receipt.result,version:4}},{...receipt,result:{...receipt.result,update_id:null}},{status:'cancelled',operation_id:goalId(60),result:receipt.result}])expect(()=>api.assertReceiptMatches(result,pending())).toThrow();expect(api.assertReceiptMatches({status:'not_found',operation_id:goalId(60),result:null},pending()).status).toBe('not_found');
});
test('SSR distinguishes reported status, measured target, pledged funds and unavailable linked work with escaped evidence',()=>{
 const data=goalsFixture(),goal=data.goals[0];goal.updates[0].evidence='<script>literal evidence</script>';goal.updates[0].measured_value=17;goal.task_ids.push(goalId(32));const html=api.renderToStaticMarkup(api.createElement(api.GoalDetail,{goal,data,disabled:false,onEdit:()=>{},onUpdate:()=>{},onOpenTask:()=>{},onOpenMilestone:()=>{}}));expect(html).toContain('Measured target met');expect(html).toContain('On track');expect(html).toContain('Status is reported by the team');expect(html).toContain('&lt;script&gt;literal evidence&lt;/script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('Task unavailable');expect(html).not.toContain('100%');const funds=api.renderToStaticMarkup(api.createElement(api.GoalDetail,{goal:{...data.goals[1],fundraising_measure:'pledged'},data,disabled:false,onEdit:()=>{},onUpdate:()=>{},onOpenTask:()=>{},onOpenMilestone:()=>{}}));expect(funds).toContain('Manually reported pledged');expect(funds).toContain('Pledges are promises');expect(funds).toContain('No Finance records');
});
test('SSR capability gates editing and weekly updates independently without deriving permission from ownership',()=>{
 const data=goalsFixture(),goal=data.goals[0];goal.capabilities={can_edit:false,can_update:true,can_reassign:false};let html=api.renderToStaticMarkup(api.createElement(api.GoalDetail,{goal,data,disabled:false,onEdit:()=>{},onUpdate:()=>{},onOpenTask:()=>{},onOpenMilestone:()=>{}}));expect(html).toContain('Weekly update');expect(html).not.toContain('Edit goal');goal.capabilities.can_update=false;html=api.renderToStaticMarkup(api.createElement(api.GoalDetail,{goal,data,disabled:false,onEdit:()=>{},onUpdate:()=>{},onOpenTask:()=>{},onOpenMilestone:()=>{}}));expect(html).not.toContain('Weekly update');
});
function clientFor(fetcher:(input:any,init:any)=>Promise<Response>,sessionId=actor){
 const client=api.createClient('https://season-goals.invalid','synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});
 client.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe:()=>{}}}});client.auth.getSession=async()=>({data:{session:{user:{id:sessionId},access_token:'synthetic-actor-token'}},error:null});return client;
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('service uses only scoped goal RPCs, pins the actor token and sends expected_actor on mutations/recovery',async()=>{
 const calls:any[]=[];const p=definitionFixture();const client=clientFor(async(input,init)=>{const url=new URL(input);calls.push({path:url.pathname,body:JSON.parse(init.body),headers:new Headers(init.headers)});return json(url.pathname.endsWith('_context')?goalsFixture():{status:'committed',operation_id:p.operation_id,result:{goal_id:p.id,version:1,update_id:null}});});
 const signal=new AbortController().signal;expect((await api.loadGoals(actor,seasonId,signal,client)).user_id).toBe(actor);await api.saveGoal(actor,p,signal,client);await api.reconcileGoal(actor,p.operation_id,false,signal,client);await api.reconcileGoal(actor,p.operation_id,true,signal,client);
 expect(calls.map(c=>c.path)).toEqual(['/rest/v1/rpc/planning_goals_context','/rest/v1/rpc/planning_goal_save','/rest/v1/rpc/planning_goal_operation_status','/rest/v1/rpc/planning_goal_operation_cancel']);expect(calls[0].body).toEqual({selected_season:seasonId});expect(calls[1].body).toEqual({p,expected_actor:actor});expect(calls[2].body).toEqual({operation_id:p.operation_id,expected_actor:actor});for(const call of calls)expect(call.headers.get('authorization')).toBe('Bearer synthetic-actor-token');
});
test('service classifies network/server uncertainty separately from definitive rejection and never retries a write',async()=>{
 for(const fixture of [{status:503,data:{message:'Synthetic gateway failure'},outcome:'unknown'},{status:400,data:{message:'Goal version changed',code:'22023'},outcome:'rejected'},{status:500,data:{message:'Goal version changed',code:'40001'},outcome:'rejected'},{status:429,data:{message:'Rate limited',code:'P0001'},outcome:'unknown'}]){
  let count=0;const client=clientFor(async()=>{count++;return json(fixture.data,fixture.status);});await expect(api.saveGoalUpdate(actor,updateFixture(),new AbortController().signal,client)).rejects.toHaveProperty('outcome',fixture.outcome);expect(count).toBe(1);
 }
 let count=0;const client=clientFor(async()=>{count++;throw Error('Synthetic disconnection');});await expect(api.saveGoal(actor,definitionFixture(),new AbortController().signal,client)).rejects.toHaveProperty('outcome','unknown');expect(count).toBe(1);
});
test('missing/mismatched actor and scope disposal during explicit auth lookup prevent request dispatch',async()=>{
 let count=0;const wrong=clientFor(async()=>{count++;return json({});},goalId(2));await expect(api.saveGoal(actor,definitionFixture(),new AbortController().signal,wrong)).rejects.toHaveProperty('outcome','rejected');expect(count).toBe(0);
 const controller=new AbortController(),client=clientFor(async()=>{count++;return json({});});let release!:(value:any)=>void;client.auth.getSession=()=>new Promise(resolve=>release=resolve);const request=api.saveGoal(actor,definitionFixture(),controller.signal,client);controller.abort();await expect(request).rejects.toHaveProperty('outcome','rejected');release({data:{session:{user:{id:actor},access_token:'late-token'}},error:null});await Promise.resolve();expect(count).toBe(0);
});
test('SDK lazy session lookup cannot replace the pinned actor token',async()=>{
 let authReads=0;const headers:string[]=[];const p=definitionFixture();const client=clientFor(async(_input,init)=>{headers.push(new Headers(init.headers).get('authorization')!);return json({status:'committed',operation_id:p.operation_id,result:{goal_id:p.id,version:1,update_id:null}});});
 client.auth.getSession=async()=>({data:{session:{user:{id:++authReads===1?actor:goalId(2)},access_token:authReads===1?'first-actor-token':'changed-actor-token'}},error:null});
 await api.saveGoal(actor,p,new AbortController().signal,client);expect(authReads).toBeGreaterThanOrEqual(2);expect(headers).toEqual(['Bearer first-actor-token']);
});
test('navigation during the SDK lazy auth await aborts the transport and preserves an uncertain outcome',async()=>{
 let authReads=0,dispatched=0;const controller=new AbortController();const client=clientFor(async(_input,init)=>{init.signal.throwIfAborted();dispatched++;return json({});});client.auth.getSession=async()=>{authReads++;if(authReads===2)controller.abort();return {data:{session:{user:{id:actor},access_token:'actor-token'}},error:null};};await expect(api.saveGoal(actor,definitionFixture(),controller.signal,client)).rejects.toHaveProperty('outcome','unknown');expect(dispatched).toBe(0);
});
test('malformed success and mismatched read actors fail closed without becoming an empty success',async()=>{
 const client=clientFor(async()=>json({status:'committed',operation_id:goalId(60),result:{goal_id:'not-a-goal',version:1,update_id:null}}));await expect(api.saveGoal(actor,definitionFixture(),new AbortController().signal,client)).rejects.toHaveProperty('outcome','unknown');const wrong=goalsFixture();wrong.user_id=goalId(2);await expect(api.loadGoals(actor,seasonId,new AbortController().signal,clientFor(async()=>json(wrong)))).rejects.toThrow(/verified/);
});
test('exact route scope is rechecked after explicit auth even before hashchange dispatch',async()=>{
 let current=true,count=0;const client=clientFor(async()=>{count++;return json({});});client.auth.getSession=async()=>{current=false;return {data:{session:{user:{id:actor},access_token:'actor-token'}},error:null};};await expect(api.saveGoal(actor,definitionFixture(),new AbortController().signal,client,()=>current)).rejects.toHaveProperty('outcome','rejected');expect(count).toBe(0);
});
test('an auth change during the SDK lazy wait cancels the original request even without a route change',async()=>{
 let notify:(event:string,next:any)=>void=()=>{},reads=0,dispatched=0;const client=clientFor(async(_input,init)=>{init.signal.throwIfAborted();dispatched++;return json({});});client.auth.onAuthStateChange=(callback:any)=>{notify=callback;return {data:{subscription:{unsubscribe:()=>{}}}};};client.auth.getSession=async()=>{if(++reads===2)notify('SIGNED_IN',{user:{id:goalId(2)}});return {data:{session:{user:{id:actor},access_token:'actor-token'}},error:null};};await expect(api.saveGoal(actor,definitionFixture(),new AbortController().signal,client)).rejects.toHaveProperty('outcome','unknown');expect(dispatched).toBe(0);
});
test('context permits server character-count limits and model rejects prototype enum names and unlinked next milestone',()=>{
 const c=goalsFixture();c.goals[0].title='🛠'.repeat(200);expect(api.assertContext(c,actor,seasonId)).toBe(c);for(const category of ['constructor','__proto__','toString'])expect(api.validateDefinition({...definitionFixture(),category})).not.toBeNull();expect(api.validateDefinition({...definitionFixture(),next_milestone_id:goalId(40)})).toContain('linked');expect(api.validDate('0000-01-01')).toBe(false);expect(api.validEvidenceUrl('https://example.test/has space')).toBe(false);expect(api.numberLabel(0.000000001)).not.toBe('0');
});
test('unusable optional evidence URLs never poison the season or render an unsafe anchor',()=>{
 for(const url of ['https://[::::]','https://999.999','https://1.1.1.256','https://example.org/'+'漢'.repeat(270),'javascript:alert(1)','http://example.org']){const data=goalsFixture(),goal=data.goals[0];goal.updates[0].evidence_url=url;expect(api.assertContext(data,actor,seasonId)).toBe(data);const html=api.renderToStaticMarkup(api.createElement(api.GoalDetail,{goal,data,disabled:false,onEdit:()=>{},onUpdate:()=>{},onOpenTask:()=>{},onOpenMilestone:()=>{}}));expect(html).toContain('Evidence link unavailable');expect(html).not.toContain('View evidence');expect(html).toContain(goal.updates[0].evidence);expect(html).not.toContain('href="'+url);}
 for(const value of [42,{},'x'.repeat(2001)]){const data=goalsFixture();(data.goals[0].updates[0] as any).evidence_url=value;expect(()=>api.assertContext(data,actor,seasonId)).toThrow(/verified/);}
});
test('unavailable legacy milestone dates remain safe placeholders without rejecting goals or inventing dates',()=>{
 const data=goalsFixture();Object.assign(data.milestones[0],{available:false,start_date:null,title:'Unavailable milestone',status:'unavailable'});expect(api.assertContext(data,actor,seasonId)).toBe(data);const html=api.renderToStaticMarkup(api.createElement(api.GoalDetail,{goal:data.goals[0],data,disabled:false,onEdit:()=>{},onUpdate:()=>{},onOpenTask:()=>{},onOpenMilestone:()=>{}}));expect(html).toContain('Milestone unavailable');expect(html).not.toContain('First full practice match');expect(html).not.toContain('infinity');expect(html).not.toContain('Open milestone');for(const patch of [{available:true},{title:'Malformed legacy details'},{status:'done'}])expect(()=>api.assertContext({...data,milestones:[{...data.milestones[0],...patch}]},actor,seasonId)).toThrow(/verified/);
});
test('recovery SSR works without any season context, stays actor-isolated and explains unavailable tab storage',()=>{
 Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}},configurable:true});const receipt=pending(66);api.rememberGoalOperation(receipt);const html=api.renderToStaticMarkup(api.createElement(api.GoalRecovery,{actorId:actor,route:'#planning/goals',onResolved:()=>{}}));expect(html).toContain('One save needs checking');expect(html).toContain('Keep this tab open');expect(html).toContain('even if that season is no longer available');for(const id of [receipt.actorId,receipt.seasonId,receipt.operationId,receipt.goalId,receipt.updateId])expect(html).not.toContain(id);const other=api.renderToStaticMarkup(api.createElement(api.GoalRecovery,{actorId:goalId(2),route:'#planning/goals',onResolved:()=>{}}));expect(other).toBe('');api.finishGoalOperation(receipt);
});
