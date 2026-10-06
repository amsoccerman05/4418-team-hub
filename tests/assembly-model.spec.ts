import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
let dir='',api:any;
test.beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),'assembly-model-'));const file=join(dir,'model.cjs');buildSync({stdin:{contents:`export * from './src/planning/assembly/model';export * from './src/planning/assembly/session';export * from './src/planning/assembly/service';export {createClient} from '@supabase/supabase-js';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',define:{'import.meta.env':'{}'},outfile:file,logLevel:'silent'});api=createRequire(import.meta.url)(file);});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const id=(n:number)=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=id(1),board=id(20),partId=id(30),revisionId=id(40),checkId=id(50),taskId=id(60),requestId=id(70),stamp='2026-10-06T20:00:00Z';
const component=()=>({id:id(80),name:'Synthetic bearing',quantity:2,status:'received',notes:'Synthetic component notes'});
const check=()=>({id:checkId,title:'Synthetic fit check',kind:'fit',outcome:'passed',procedure:'Assemble fixture',expected:'Fits without forcing',observed:'Fits',evidence_url:'https://example.com/evidence',revision_id:revisionId,rework_task_id:null,supersedes_id:null});
const fact=()=>({parts_total:1,parts_done:1,components_total:1,components_available:1,tasks_total:1,tasks_done:0,tasks_blocked:1,checks_total:1,checks_passed:1,checks_failed:0,checks_blocked:0,checks_stale:0});
const fixture=():any=>({user_id:actor,board_id:board,version:2,can_edit:true,loaded_at:stamp,components:[{...component(),created_by:actor,created_at:stamp,updated_at:stamp}],parts:[{id:partId,name:'Synthetic plate',status:'done',version:2,current_revision_id:revisionId,revision_number:1,quantity:2}],revisions:[{id:revisionId,part_id:partId,name:'Synthetic plate',revision_number:1}],tasks:[{id:taskId,board_id:board,title:'Synthetic assembly task',description:'',status:'blocked',priority:'normal',owner_ids:[actor],owners:[{id:actor,name:'Synthetic teammate',active:true}],area_id:null,start_date:null,due_date:'2026-10-12',blocked_reason:'Waiting for fixture',version:1}],linked_task_ids:[taskId],checks:[{...check(),created_by:actor,created_at:stamp}],snapshots:[{id:id(90),board_id:board,created_by:actor,created_at:stamp,notes:'Historical observation',facts:fact(),summary:'Recorded summary, not an approval or readiness certification.'}],facts:fact()});
const receipt=(request=requestId,who=actor)=>({request_id:request,expected_actor:who});
const mutation=():any=>({...receipt(),action:'component',p:{board_id:board,version:2,...component()}});
const applied=()=>({request_id:requestId,status:'applied',action:'component',entity_id:id(80),version:3});
const terminal=(status='unknown')=>({request_id:requestId,status,action:null,entity_id:null,version:null});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function clientFor(fetcher:(input:any,init:any)=>Promise<Response>,user=actor){const client=api.createClient('https://assembly.invalid','synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});client.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe:()=>{}}}});client.auth.getSession=async()=>({data:{session:{user:{id:user},access_token:'checked-synthetic-token'}},error:null});return client;}

test('components and check inputs have bounded required fields, quantities and exact enums',()=>{
 expect(api.validateComponent(component())).toBeNull();expect(api.validateCheck(check())).toBeNull();
 for(const patch of [{id:'bad'},{name:' '},{name:'x'.repeat(201)},{quantity:0},{quantity:100001},{quantity:1.5},{quantity:'2'},{status:'done'},{notes:'x'.repeat(2001)}])expect(api.validateComponent({...component(),...patch})).not.toBeNull();
 for(const patch of [{title:' '},{title:'x'.repeat(201)},{kind:'inspection'},{outcome:'ready'},{procedure:'x'.repeat(2001)},{procedure:' '},{expected:''},{observed:'\t'},{expected:undefined},{observed:[]},{supersedes_id:checkId},{revision_id:'bad'},{rework_task_id:taskId}])expect(api.validateCheck({...check(),...patch})).not.toBeNull();
 expect(api.validateCheck({...check(),outcome:'failed',rework_task_id:taskId,evidence_url:''})).toBeNull();
});
test('evidence links reject unsafe schemes, credentials, encoded controls, malformed and local hosts',()=>{
 for(const url of ['javascript:alert(1)','http://example.com','https://user:secret@example.com','https://@example.com','https://example.com\\evil','https://example.com/a b','https://example.com/a\nb','https://example.com/\u0085','https://example.com/%00','https://example.com/%1F','https://example.com/%7f','https://localhost','https://example.localhost','https://example.local','https://example.internal','https://example.home','https://example.lan','https://127.0.0.1','https://2130706433','https://[::1]','https://example.com:0','https://example.com:65536','https://example.com.','https://-example.com','https://example.123','https://example.com@evil.test','https://éxample.com','https://xn--a.com','https://xn--bcher-kva.com','https://docs.xn--bcher-kva.com','https://XN--BCHER-KVA.com'])expect(api.safeEvidenceUrl(url),url).toBeNull();
 expect(api.safeEvidenceUrl('https://example.com/check?revision=1#data')).toBe('https://example.com/check?revision=1#data');expect(api.safeEvidenceUrl('HTTPS://Example.COM:443')).toBe('https://example.com/');expect(api.safeEvidenceUrl('https://example.com:8443/evidence')).toBe('https://example.com:8443/evidence');
});
test('context accepts explicit board/actor scope and rejects malformed shapes, versions and canonical tasks',()=>{
 expect(api.assertAssemblyContext(fixture(),actor,board).board_id).toBe(board);
 const empty={...fixture(),version:0,components:[],parts:[],revisions:[],tasks:[],linked_task_ids:[],checks:[],snapshots:[]};empty.facts=api.readinessFacts(empty);expect(api.assertAssemblyContext(empty,actor,board).version).toBe(0);
 const changes=[(c:any)=>c.user_id=id(2),(c:any)=>c.board_id=id(21),(c:any)=>c.version=-1,(c:any)=>c.version=1.5,(c:any)=>c.can_edit='true',(c:any)=>c.loaded_at='invalid',(c:any)=>c.components[0].updated_at='bad',(c:any)=>c.parts[0].status='received',(c:any)=>c.tasks[0].board_id=id(21),(c:any)=>c.tasks[0].due_date='2026-02-30',(c:any)=>c.tasks[0].owner_ids=[actor,actor],(c:any)=>c.tasks[0].owners[0].id=id(3),(c:any)=>c.tasks[0].status='unknown',(c:any)=>c.tasks[0].version=0];
 for(const change of changes){const c=fixture();change(c);expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow();}
});
test('context rejects duplicate identities, dangling references, invalid revision metadata and cross-board snapshots',()=>{
 for(const change of [(c:any)=>c.components.push(c.components[0]),(c:any)=>c.parts.push(c.parts[0]),(c:any)=>c.revisions.push(c.revisions[0]),(c:any)=>c.tasks.push(c.tasks[0]),(c:any)=>c.checks.push(c.checks[0]),(c:any)=>c.snapshots.push(c.snapshots[0]),(c:any)=>c.linked_task_ids.push(taskId),(c:any)=>c.linked_task_ids=[id(61)],(c:any)=>c.parts[0].current_revision_id=id(41),(c:any)=>c.parts[0].revision_number=2,(c:any)=>c.parts[0].name='Incorrect metadata',(c:any)=>c.revisions[0].part_id=id(31),(c:any)=>c.checks[0].revision_id=id(41),(c:any)=>c.checks[0].supersedes_id=id(51),(c:any)=>c.snapshots[0].board_id=id(21)]){const c=fixture();change(c);expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow();}
});
test('context caps arrays and rejects inconsistent live or historical facts without modifying the response',()=>{
 for(const change of [(c:any)=>c.components=Array(201).fill(c.components[0]),(c:any)=>c.checks=Array(1001).fill(c.checks[0]),(c:any)=>c.snapshots=Array(201).fill(c.snapshots[0]),(c:any)=>c.revisions=Array(10001).fill(c.revisions[0]),(c:any)=>c.parts=Array(1001).fill(c.parts[0]),(c:any)=>c.linked_task_ids=Array(501).fill(taskId),(c:any)=>c.facts.parts_done=0,(c:any)=>c.facts.checks_passed=2,(c:any)=>c.facts.tasks_total=-1,(c:any)=>c.facts.invented_score=100,(c:any)=>c.snapshots[0].facts.checks_total=0,(c:any)=>c.snapshots[0].summary='x'.repeat(8001)]){const c=fixture(),before=JSON.stringify(c);change(c);const changed=JSON.stringify(c);expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow();expect(JSON.stringify(c)).toBe(changed);expect(before).not.toBe(changed);}
});
test('immutable checks keep unavailable rework pointers without borrowing a moved task or counting it',()=>{
 const c=fixture();c.checks[0].outcome='failed';c.checks[0].rework_task_id=id(61);c.facts=api.readinessFacts(c);
 expect(api.assertAssemblyContext(c,actor,board).checks[0].rework_task_id).toBe(id(61));expect(c.facts.tasks_total).toBe(1);expect(c.tasks.some((task:any)=>task.id===id(61))).toBe(false);
});
test('latest checks only count non-stale outcomes while full superseded history stays intact',()=>{
 const c=fixture();const old=c.revisions[0];c.revisions.push({...old,id:id(41),revision_number:2});c.parts[0]={...c.parts[0],revision_number:2,current_revision_id:id(41)};
 c.checks[0].outcome='failed';c.checks.push({...c.checks[0],id:id(51),outcome:'passed',supersedes_id:checkId},{...c.checks[0],id:id(52),outcome:'blocked',revision_id:id(41)},{...c.checks[0],id:id(53),outcome:'passed',revision_id:null});
 c.facts=api.readinessFacts(c);expect(c.facts).toMatchObject({checks_total:3,checks_passed:1,checks_failed:0,checks_blocked:1,checks_stale:1});expect(api.latestChecks(c).map((row:any)=>row.id)).toEqual([id(51),id(52),id(53)]);expect(api.isStaleCheck(c.checks[1],c)).toBe(true);expect(api.isStaleCheck(c.checks[3],c)).toBe(false);expect(api.assertAssemblyContext(c,actor,board).checks).toHaveLength(4);
});
test('supersession rejects forks, cross-subject links and cycles even if forged counts appear consistent',()=>{
 for(const mode of ['fork','subject','cycle']){const c=fixture();c.checks.push({...c.checks[0],id:id(51),supersedes_id:checkId});if(mode==='fork')c.checks.push({...c.checks[0],id:id(52),supersedes_id:checkId});if(mode==='subject')c.checks[1].revision_id=null;if(mode==='cycle')c.checks[0].supersedes_id=id(51);c.facts=api.readinessFacts(c);expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow();}
});
test('readiness counts canonical linked tasks and component availability without a readiness score',()=>{
 const c=fixture();c.components.push({...c.components[0],id:id(81),status:'ordered'},{...c.components[0],id:id(82),status:'installed'});c.tasks.push({...c.tasks[0],id:id(61),status:'done'},{...c.tasks[0],id:id(62),status:'done'});c.linked_task_ids.push(id(61));
 expect(api.readinessFacts(c)).toMatchObject({components_total:3,components_available:2,tasks_total:2,tasks_done:1,tasks_blocked:1});expect(Object.keys(api.readinessFacts(c))).not.toContain('ready');
 const original=c.snapshots[0].summary;c.facts=api.readinessFacts(c);expect(api.snapshotText(c.snapshots[0])).toBe(original);expect(c.snapshots[0].facts.components_total).toBe(1);
});
test('scope tickets isolate actor, board, editor lifecycle, route and StrictMode reactivation',()=>{
 const session=new api.AssemblySession({actorId:actor,boardId:board,route:'#planning/projects/'+board});session.activate();const old=session.openEditor(),controller=session.controller();expect(session.current(old)).toBe(true);session.closeEditor();expect(controller.signal.aborted).toBe(true);session.openEditor();expect(session.current(old)).toBe(false);const next=session.ticket();expect(session.current({...next,actorId:id(2)})).toBe(false);expect(session.current({...next,boardId:id(21)})).toBe(false);expect(session.current(next,'#planning')).toBe(false);session.dispose();session.activate();expect(session.current(next)).toBe(false);expect(session.current(session.ticket())).toBe(true);
});
test('recovery persists only actor and request IDs and never clears a different pending request',()=>{
 const values=new Map<string,string>();Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)},configurable:true});const r=receipt();api.rememberAssemblySave({...r,p:component(),board_id:board,notes:'private draft',access_token:'private token'});const raw=values.get('4418-assembly-receipts-v1')!;expect(JSON.parse(raw)).toEqual([r]);expect(raw).not.toMatch(/private|Synthetic|board_id|notes|access_token/);expect(api.pendingAssemblySave(id(2))).toBeNull();expect(()=>api.rememberAssemblySave(receipt(id(71)))).toThrow(/pending/);api.finishAssemblySave(receipt(id(71)));expect(api.pendingAssemblySave(actor)).toEqual(r);api.finishAssemblySave(r);expect(api.pendingAssemblySave(actor)).toBeNull();
});
test('failed storage writes retain tombstones, another actor and newer receipt until durable recovery',()=>{
 const key='4418-assembly-receipts-v1',who=id(301),otherWho=id(302),old=receipt(id(310),who),next=receipt(id(311),who),other=receipt(id(312),otherWho);const values=new Map([[key,JSON.stringify([old,other])]]);let blocked=false;
 Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{if(blocked)throw Error('quota');values.set(k,v);}},configurable:true});expect(api.pendingAssemblySave(who)).toEqual(old);blocked=true;api.finishAssemblySave(old);expect(api.pendingAssemblySave(who)).toBeNull();expect(JSON.parse(values.get(key)!)).toContainEqual(old);expect(api.assemblyStorageAvailable()).toBe(false);api.rememberAssemblySave(next);api.finishAssemblySave(old);expect(api.pendingAssemblySave(who)).toEqual(next);expect(api.pendingAssemblySave(otherWho)).toEqual(other);api.finishAssemblySave(next);expect(api.pendingAssemblySave(who)).toBeNull();blocked=false;api.finishAssemblySave(next);expect(JSON.parse(values.get(key)!)).toEqual([other]);expect(api.assemblyStorageAvailable()).toBe(true);api.finishAssemblySave(other);
});
test('blocked storage reads preserve hydrated receipts and never overwrite unread actor data',()=>{
 const key='4418-assembly-receipts-v1',who=id(320),otherWho=id(321),thirdWho=id(322),old=receipt(id(330),who),next=receipt(id(331),who),other=receipt(id(332),otherWho),third=receipt(id(333),thirdWho);const values=new Map([[key,JSON.stringify([old,other])]]);let blocked=false,writes=0;
 Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:(k:string)=>{if(blocked)throw Error('blocked');return values.get(k)||null;},setItem:(k:string,v:string)=>{writes++;values.set(k,v);}},configurable:true});expect(api.pendingAssemblySave(who)).toEqual(old);blocked=true;values.set(key,JSON.stringify([old,other,third]));api.finishAssemblySave(old);api.rememberAssemblySave(next);expect(writes).toBe(0);expect(api.pendingAssemblySave(otherWho)).toEqual(other);expect(api.pendingAssemblySave(who)).toEqual(next);blocked=false;api.rememberAssemblySave(next);expect(JSON.parse(values.get(key)!)).toEqual(expect.arrayContaining([next,other,third]));expect(JSON.parse(values.get(key)!)).toHaveLength(3);for(const r of [next,other,third])api.finishAssemblySave(r);
});
test('receipts require exact request, action, entity and board-wide next version',()=>{
 expect(api.assertAssemblyReceiptMatches(applied(),mutation()).status).toBe('applied');for(const status of ['unknown','cancelled'])expect(api.assertAssemblyReceipt(terminal(status),requestId).status).toBe(status);
 for(const patch of [{request_id:id(71)},{action:'snapshot'},{entity_id:taskId},{version:4},{version:0},{status:'pending'}])expect(()=>api.assertAssemblyReceiptMatches({...applied(),...patch},mutation())).toThrow();for(const patch of [{action:'check'},{entity_id:taskId},{version:3}])expect(()=>api.assertAssemblyReceipt({...terminal(),...patch},requestId)).toThrow();
 const link={...mutation(),action:'task_link',p:{board_id:board,version:2,task_id:taskId,linked:true}};expect(api.assertAssemblyReceiptMatches({...applied(),action:'task_link',entity_id:taskId},link).status).toBe('applied');expect(()=>api.assertAssemblyReceiptMatches({...applied(),action:'task_link',entity_id:board},link)).toThrow();
});
test('service uses only four bounded actor-bound RPCs and pins the exact checked token',async()=>{
 const calls:any[]=[];const client=clientFor(async(input,init)=>{const path=new URL(input).pathname;calls.push({path,body:JSON.parse(init.body),headers:new Headers(init.headers)});return json(path.endsWith('_context')?fixture():applied());});const signal=new AbortController().signal;
 await api.loadAssembly(actor,board,signal,client);await api.mutateAssembly(mutation(),signal,client);await api.reconcileAssembly(actor,requestId,false,signal,client);await api.reconcileAssembly(actor,requestId,true,signal,client);
 expect(calls.map(call=>call.path)).toEqual(['/rest/v1/rpc/assembly_context','/rest/v1/rpc/assembly_mutate','/rest/v1/rpc/assembly_mutation_status','/rest/v1/rpc/assembly_cancel_mutation']);expect(calls[0].body).toEqual({board_id:board,expected_actor:actor});expect(calls[1].body).toEqual(mutation());expect(calls[2].body).toEqual(receipt());for(const call of calls)expect(call.headers.get('authorization')).toBe('Bearer checked-synthetic-token');
});
test('service rejects invalid or oversized input before auth/network, including unsupported payload fields',async()=>{
 let count=0;const client=clientFor(async()=>{count++;return json(applied());});
 for(const value of [{...mutation(),request_id:'bad'},{...mutation(),expected_actor:'bad'},{...mutation(),action:'delete'}, {...mutation(),p:{...mutation().p,version:-1}},{...mutation(),p:{...mutation().p,notes:'x'.repeat(2001)}},{...mutation(),p:{...mutation().p,access_token:'not allowed'}}])await expect(api.mutateAssembly(value,new AbortController().signal,client)).rejects.toHaveProperty('outcome','rejected');
 await expect(api.loadAssembly(actor,'bad',new AbortController().signal,client)).rejects.toHaveProperty('outcome','rejected');expect(count).toBe(0);
});
test('definitive rejection differs from transport, timeout, rate limit or unknown SQL outcomes and never retries',async()=>{
 for(const row of [{status:400,code:'AS409',outcome:'rejected'},{status:403,code:'AS403',outcome:'rejected'},{status:400,code:'AS412',outcome:'rejected'},{status:413,code:'AS413',outcome:'rejected'},{status:400,code:'AS422',outcome:'rejected'},{status:400,code:'AS500',outcome:'unknown'},{status:408,code:'AS409',outcome:'unknown'},{status:429,code:'AS409',outcome:'unknown'},{status:503,code:'',outcome:'unknown'}]){let calls=0;const client=clientFor(async()=>{calls++;return json({code:row.code,message:'private database contents'},row.status);});const save=api.mutateAssembly(mutation(),new AbortController().signal,client);await expect(save).rejects.toHaveProperty('outcome',row.outcome);await expect(save).rejects.not.toThrow(/private database/);expect(calls).toBe(1);}
 let calls=0;const client=clientFor(async()=>{calls++;throw Error('private socket details');});await expect(api.mutateAssembly(mutation(),new AbortController().signal,client)).rejects.toHaveProperty('outcome','unknown');expect(calls).toBe(1);
});
test('wrong actor or abort during auth prevents dispatch and releases the auth subscription',async()=>{
 let calls=0,unsubscribed=0;const client=clientFor(async()=>{calls++;return json(applied());},id(2));client.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe:()=>unsubscribed++}}});await expect(api.mutateAssembly(mutation(),new AbortController().signal,client)).rejects.toHaveProperty('outcome','rejected');expect(calls).toBe(0);
 let release:any;client.auth.getSession=()=>new Promise(resolve=>release=resolve);const controller=new AbortController(),pending=api.mutateAssembly(mutation(),controller.signal,client);controller.abort();await expect(pending).rejects.toHaveProperty('outcome','rejected');release({data:{session:{user:{id:actor},access_token:'late'}},error:null});await Promise.resolve();expect(calls).toBe(0);expect(unsubscribed).toBe(2);
});
test('SDK lazy auth cannot swap actor tokens and mutable editor objects cannot change an in-flight body',async()=>{
 let reads=0;const headers:string[]=[],bodies:any[]=[];const client=clientFor(async(_input,init)=>{headers.push(new Headers(init.headers).get('authorization')!);bodies.push(JSON.parse(init.body));return json(applied());});client.auth.getSession=async()=>({data:{session:{user:{id:++reads===1?actor:id(2)},access_token:reads===1?'checked-actor-token':'other-actor-token'}},error:null});const value=mutation(),pending=api.mutateAssembly(value,new AbortController().signal,client);value.p.name='Later editor change';value.p.version=3;await pending;expect(reads).toBeGreaterThanOrEqual(2);expect(headers).toEqual(['Bearer checked-actor-token']);expect(bodies[0].p.name).toBe(component().name);expect(bodies[0].p.version).toBe(2);
});
test('late read and write results cannot enter newer routes even if fetch ignores cancellation',async()=>{
 let release:any,current=true;const client=clientFor(()=>new Promise(resolve=>release=resolve));const context=api.loadAssembly(actor,board,new AbortController().signal,client,()=>current);while(!release)await Promise.resolve();current=false;release(json(fixture()));await expect(context).rejects.toHaveProperty('outcome','rejected');current=true;release=undefined;const save=api.mutateAssembly(mutation(),new AbortController().signal,client,()=>current);while(!release)await Promise.resolve();current=false;release(json(applied()));await expect(save).rejects.toHaveProperty('outcome','unknown');
});
test('abort after dispatch resolves as unknown even when a transport ignores abort entirely',async()=>{
 let release:any,started=false;const client=clientFor(()=>{started=true;return new Promise(resolve=>release=resolve);});const controller=new AbortController(),save=api.mutateAssembly(mutation(),controller.signal,client);while(!started)await Promise.resolve();controller.abort();await expect(save).rejects.toHaveProperty('outcome','unknown');release(json(applied()));await Promise.resolve();
});
test('auth changes after dispatch abort pending writes and never expose late response content',async()=>{
 let change:any,release:any,started=false;const client=clientFor(()=>{started=true;return new Promise(resolve=>release=resolve);});client.auth.onAuthStateChange=(handler:any)=>{change=handler;return {data:{subscription:{unsubscribe:()=>{}}}};};const save=api.mutateAssembly(mutation(),new AbortController().signal,client);while(!started)await Promise.resolve();change('SIGNED_IN',{user:{id:id(2)}});await expect(save).rejects.toHaveProperty('outcome','unknown');release(json(applied()));await Promise.resolve();
});
test('full canonical task context is validated without silently truncating a large project',()=>{
 const c=fixture();c.tasks=Array.from({length:1001},(_,n)=>({...c.tasks[0],id:id(10000+n)}));c.linked_task_ids=[c.tasks[0].id];c.facts=api.readinessFacts(c);expect(api.assertAssemblyContext(c,actor,board).tasks).toHaveLength(1001);c.tasks[1000].board_id=id(21);expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow();
});
test('real local SQL read models and receipts satisfy the client boundary through snapshot capture',async()=>{
 const dbApi=await import('./fixtures/assembly'),fabrication=await import('./fixtures/fabrication');const db=await dbApi.createAssemblyDatabase();
 try{
  await dbApi.seedAssembly(db);const who=dbApi.id(3),project=dbApi.id(201);
  expect(api.assertAssemblyContext(await dbApi.context(db),who,project).version).toBe(0);
  await fabrication.upload(db);const p=dbApi.payload(dbApi.component());const written=await dbApi.mutate(db,'component',p,3,dbApi.id(88001));expect(api.assertAssemblyReceiptMatches(written,{action:'component',request_id:dbApi.id(88001),expected_actor:who,p}).status).toBe('applied');
  await dbApi.mutate(db,'task_link',dbApi.payload({task_id:dbApi.id(301),linked:true},1));await dbApi.mutate(db,'check',dbApi.payload({...dbApi.check(),revision_id:dbApi.id(701)},2));await dbApi.mutate(db,'snapshot',dbApi.payload({id:dbApi.id(1101),notes:'Synthetic discussion'},3));
  const read=api.assertAssemblyContext(await dbApi.context(db),who,project);expect(read.version).toBe(4);expect(read.snapshots[0].facts).toEqual(read.facts);expect(api.snapshotText(read.snapshots[0])).toContain('Synthetic discussion');
  // Exercise canonical table constraints and actual to_jsonb(date) output, rather
  // than constructing synthetic representations of unusual PostgreSQL dates.
  const dates:[string|null,string|null][]=[['-infinity','infinity'],['-infinity','-infinity'],['infinity','infinity'],[null,'infinity'],['infinity',null],['4714-11-24 BC','5874897-12-31'],['0001-02-29 BC','0001-03-01 BC'],['0001-12-31 BC','0001-01-01'],['9999-12-31','10000-01-01'],['10000-02-29','10000-03-01']];
  for(const [index,[start,due]] of dates.entries()){
   const title=index===0?'\u00a0':index===1?' '.repeat(300)+'😀'.repeat(200)+' '.repeat(300):'😀'.repeat(200),description='😀'.repeat(5000),blocker='😀'.repeat(500);
   await db.exec('reset role');await db.query('update public.planning_tasks set title=$1,description=$2,blocked_reason=$3,start_date=$4::date,due_date=$5::date where id=$6',[title,description,blocker,start,due,dbApi.id(301)]);
   const current=api.assertAssemblyContext(await dbApi.context(db),who,project),task=current.tasks.find((row:any)=>row.id===dbApi.id(301));
   expect(task).toMatchObject({title,description,blocked_reason:blocker,start_date:start,due_date:due});expect(current.snapshots[0]).toEqual(read.snapshots[0]);
  }
 }finally{await db.close();}
});
test('canonical Planning text uses PostgreSQL Unicode code-point limits without changing Assembly input limits',()=>{
 const c=fixture();Object.assign(c.tasks[0],{title:'😀'.repeat(200),description:'😀'.repeat(5000),blocked_reason:'😀'.repeat(500)});
 expect(api.assertAssemblyContext(c,actor,board).tasks[0]).toMatchObject({title:c.tasks[0].title,description:c.tasks[0].description,blocked_reason:c.tasks[0].blocked_reason});
 for(const [field,max] of [['title',200],['description',5000],['blocked_reason',500]] as const){const invalid=structuredClone(c);invalid.tasks[0][field]='😀'.repeat(max+1);expect(()=>api.assertAssemblyContext(invalid,actor,board)).toThrow(/invalid response/);}
 expect(api.validateComponent({...component(),name:'😀'.repeat(101)})).not.toBeNull();expect(api.validateCheck({...check(),title:'😀'.repeat(101)})).not.toBeNull();
});
test('canonical Planning title trims ASCII spaces only while owner labels retain their SQL UTF-16 bound',()=>{
 for(const title of ['\u00a0','\t','  \u00a0  ',' '.repeat(300)+'😀'.repeat(200)+' '.repeat(300)]){const c=fixture();c.tasks[0].title=title;expect(api.assertAssemblyContext(c,actor,board).tasks[0].title).toBe(title);}
 for(const title of ['',' ',' '.repeat(300),' '.repeat(300)+'😀'.repeat(201)+' '.repeat(300)]){const c=fixture();c.tasks[0].title=title;expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow(/invalid response/);}
 const c=fixture();c.tasks[0].owners[0].name='😀'.repeat(75);expect(api.assertAssemblyContext(c,actor,board).tasks[0].owners[0].name).toBe(c.tasks[0].owners[0].name);c.tasks[0].owners[0].name+='x';expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow(/invalid response/);
 expect(api.validateComponent({...component(),name:'\u00a0'})).not.toBeNull();expect(api.validateCheck({...check(),title:'\u00a0'})).not.toBeNull();
});
test('canonical PostgreSQL dates preserve raw infinities, BCE and extended years with chronological ordering',()=>{
 const pairs:[string|null,string|null][]=[['-infinity','infinity'],['-infinity','-infinity'],['infinity','infinity'],[null,'infinity'],['infinity',null],['4714-11-24 BC','5874897-12-31'],['0100-12-31 BC','0001-01-01 BC'],['0001-02-29 BC','0001-03-01 BC'],['0001-12-31 BC','0001-01-01'],['9999-12-31','10000-01-01'],['10000-02-29','10000-03-01'],['5874897-12-31','infinity']];
 for(const [start,due] of pairs){const c=fixture();Object.assign(c.tasks[0],{start_date:start,due_date:due});const task=api.assertAssemblyContext(c,actor,board).tasks[0];expect(task.start_date).toBe(start);expect(task.due_date).toBe(due);}
 for(const [start,due] of [['infinity','2026-10-06'],['2026-10-06','-infinity'],['0001-01-01','0001-12-31 BC'],['0001-01-01 BC','0100-12-31 BC'],['10000-01-01','9999-12-31']]){const c=fixture();Object.assign(c.tasks[0],{start_date:start,due_date:due});expect(()=>api.assertAssemblyContext(c,actor,board)).toThrow(/invalid response/);}
 for(const date of ['0000-01-01','0000-01-01 BC','4714-11-23 BC','4715-01-01 BC','5874898-01-01','0002-02-29 BC','1900-02-29','10001-02-29','2026-02-30','2026-00-10','2026-13-01','2026-01-00','2026-01-32','2026-1-01','+10000-01-01','010000-01-01','Infinity','+infinity','tomorrow']){const c=fixture();Object.assign(c.tasks[0],{start_date:null,due_date:date});expect(()=>api.assertAssemblyContext(c,actor,board),date).toThrow(/invalid response/);}
});
