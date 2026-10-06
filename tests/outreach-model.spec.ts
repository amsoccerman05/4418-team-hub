import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {outreachFixture,outreachId as id,outreachActor as actor} from './fixtures/outreach';
let dir='',api:any;
test.beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'outreach-model-'));const bundle=join(dir,'api.cjs');
 buildSync({stdin:{contents:`export * from './src/outreach/model';export * from './src/outreach/service';export * from './src/outreach/receipts';export {OutreachPortfolio,OutreachProfile,Outreach} from './src/outreach/Outreach';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},outfile:bundle,logLevel:'silent'});
 api=createRequire(import.meta.url)(bundle);
});
test.afterEach(()=>{for(const owner of [actor,id(2)])for(const r of api.pendingReceipts(owner))api.settleReceipt(owner,r.requestId);});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const render=(component:any,props:any)=>api.renderToStaticMarkup(api.createElement(component,props));
const deferred=()=>{let resolve!:(v:any)=>void,reject!:(e:any)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function scope(){const controller=new AbortController();let live=true;return {controller,leave:()=>{live=false;controller.abort();},value:{actorId:actor,signal:controller.signal,isCurrent:()=>live}};}
function client(response:any={data:{id:id(900),version:1},error:null,status:200}) {
 const calls:any[]=[],listeners=new Set<(event:string,session:any)=>void>();let session:any={user:{id:actor},access_token:'synthetic-actor-token'},sessionWait:Promise<any>|null=null,brokerWait:Promise<any>|null=null;
 const transport={auth:{getSession:async()=>sessionWait?await sessionWait:{data:{session},error:null},onAuthStateChange:(callback:any)=>{listeners.add(callback);return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};}},rpc:(name:string,args:any)=>{const call:any={name,args,headers:{}};calls.push(call);const request:any={setHeader:(name:string,value:string)=>{call.headers[name]=value;return request;},abortSignal:(signal:AbortSignal)=>{call.signal=signal;return request;},retry:(enabled:boolean)=>{call.retry=enabled;return request;},then:async(resolve:any,reject:any)=>{try{if(brokerWait)await brokerWait;call.signal.throwIfAborted();call.sent=true;let result=typeof response==='function'?await response(call):await response;call.signal.throwIfAborted();return resolve(result);}catch(e){return reject(e);}}};return request;}};
 return {transport,calls,waitSession:(p:Promise<any>)=>{sessionWait=p;},waitBroker:(p:Promise<any>)=>{brokerWait=p;},switchActor:(next:string|null)=>{session=next?{user:{id:next},access_token:'synthetic-other-token'}:null;for(const fn of listeners)fn('SIGNED_IN',session);}};
}

test('private context requires matching actor, version, live capability and complete valid relationships',()=>{
 const c=outreachFixture();expect(api.parseContext(c,actor)).toEqual(c);expect(api.parseContext(outreachFixture(false),actor)).toBeTruthy();
 for(const change of [{user_id:id(2)},{contract_version:2},{can_manage:false},{owners:null},{can_link_finance:false},{contacts:[{...c.contacts[0],organization_id:id(999)}]},{engagements:[{...c.engagements[0],season_id:id(11)}]},{conversations:[{...c.conversations[0],contact_id:c.contacts[2].id}]},{income_links:[...c.income_links,{...c.income_links[0],id:id(999)}]}])expect(api.parseContext({...c,...change},actor)).toBeNull();
});
test('dates, fulfillment and no-season payloads fail closed instead of normalizing contradictory records',()=>{
 const c=outreachFixture();
 for(const bad of ['2026-02-31','2026-13-01','2026-00-01','yesterday'])expect(api.parseContext({...c,conversations:[{...c.conversations[0],occurred_on:bad}]},actor)).toBeNull();
 expect(api.parseContext({...c,recognition:[{...c.recognition[0],status:'fulfilled',fulfilled_on:null}]},actor)).toBeNull();
 expect(api.parseContext({...c,recognition:[{...c.recognition[0],fulfilled_on:'2026-10-01'}]},actor)).toBeNull();
 expect(api.parseContext({...c,season_id:null,engagements:[{...c.engagements[0],season_id:null}]},actor)).toBeNull();
 expect(api.parseContext({...c,pledges:[{...c.pledges[0],amount:Infinity}]},actor)).toBeNull();
});
test('routes allow only the exact local workspace and UUID profile grammar',()=>{
 expect(api.parseOutreachRoute('#outreach')).toEqual({organizationId:null});expect(api.parseOutreachRoute(`#outreach/${id(100)}`)).toEqual({organizationId:id(100)});
 for(const route of ['#outreach/','#outreach/javascript:alert(1)',`#outreach/${id(100)}/edit`,`#outreach/${id(100)}?season=x`,'https://evil.invalid/#outreach','#OUTREACH'])expect(api.parseOutreachRoute(route)).toBeNull();
});
test('search finds people inside organizations and archive browsing preserves records without changing obligations',()=>{
 const c=outreachFixture();expect(api.portfolio(c,'Jamie').map((row:any)=>row.organization.id)).toEqual([id(100)]);expect(api.portfolio(c,'','prospect')).toHaveLength(1);
 c.organizations[0].active=false;expect(api.portfolio(c,'Cedarline')).toHaveLength(0);expect(api.portfolio(c,'Cedarline','all',true)).toHaveLength(1);expect(c.recognition.filter(r=>r.status==='promised')).toHaveLength(2);
 expect(api.followUps(c,'2026-10-06').map((e:any)=>e.id)).toEqual([id(303),id(300),id(301)]);
});
test('received money counts only linked Finance received rows, never expected income or fulfilled recognition',()=>{
 const c=outreachFixture();expect(api.receivedFor(c,c.pledges[0])).toBe(2000);c.recognition.forEach(r=>r.status='fulfilled');expect(api.receivedFor(c,c.pledges[0])).toBe(2000);c.income[0].status='canceled';expect(api.receivedFor(c,c.pledges[0])).toBe(0);expect(api.receivedFor(outreachFixture(false),c.pledges[0])).toBeNull();
});
test('SSR portfolio and private profile distinguish organization, contact, promise and funds with escaped text',()=>{
 const c=outreachFixture();let html=render(api.OutreachPortfolio,{context:c,open:()=>{}});expect(html).toContain('$5,750.00');expect(html).toContain('$2,000.00 linked funds received');expect(html).toContain('Follow up next');expect(html).toContain('Include archived');expect(html).not.toContain('DEMO-INCOME');
 c.organizations[0].name='<script>literal sponsor</script>';c.engagements[0].owner_id=id(999);html=render(api.OutreachProfile,{context:c,organization:c.organizations[0],open:()=>{}});expect(html).toContain('&lt;script&gt;literal sponsor&lt;/script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('Owner unavailable');expect(html).toContain('Jamie Example');expect(html).toContain('Log conversation');
 const restricted=render(api.OutreachPortfolio,{context:outreachFixture(false),open:()=>{}});expect(restricted).toContain('Received funds require Finance access');expect(restricted).not.toContain('$2,000.00');
});
test('closed seasons and archived profiles show read-only state; unsafe website destinations never render',()=>{
 const c=outreachFixture();c.seasons[0].status='closed';c.organizations[0].website='javascript:alert(1)';let html=render(api.OutreachProfile,{context:c,organization:c.organizations[0],open:()=>{}});expect(html).toContain('Closed season');expect(html).toContain('disabled=""');expect(html).not.toContain('javascript:');c.organizations[0].active=false;html=render(api.OutreachProfile,{context:c,organization:c.organizations[0],open:()=>{}});expect(html).toContain('Archived profile');
 for(const url of ['http://example.invalid','https://user:secret@example.invalid','javascript:alert(1)','/relative'])expect(api.safeWebsite(url)).toBeNull();
});
test('request pins reviewed actor, sends expected_actor and disables SDK retries',async()=>{
 const mock=client(),s=scope(),service=api.createOutreachService(mock.transport);
 expect(await service.save('organization',{id:id(900),version:0,name:'Demo'},id(901),s.value)).toEqual({id:id(900),version:1});expect(mock.calls).toHaveLength(1);expect(mock.calls[0].headers.Authorization).toBe('Bearer synthetic-actor-token');expect(mock.calls[0].args.expected_actor).toBe(actor);expect(mock.calls[0].retry).toBe(false);expect(api.pendingReceipts(actor)).toEqual([]);
});
test('account switch during first broker wait cancels before any RPC and never persists draft data',async()=>{
 const wait=deferred(),mock=client(),s=scope();mock.waitSession(wait.promise);const operation=api.createOutreachService(mock.transport).save('contact',{id:id(900),version:0,email:'private@example.invalid'},id(901),s.value);mock.switchActor(id(2));wait.resolve({data:{session:{user:{id:actor},access_token:'old'}},error:null});await expect(operation).rejects.toMatchObject({kind:'abandoned'});expect(mock.calls).toEqual([]);expect(api.pendingReceipts(actor)).toEqual([]);
});
test('second broker wait stays actor-bound; abandonment after dispatch retains an opaque receipt',async()=>{
 const wait=deferred(),mock=client(),s=scope();mock.waitBroker(wait.promise);const operation=api.createOutreachService(mock.transport).save('contact',{id:id(900),version:0,email:'private@example.invalid'},id(901),s.value);await expect.poll(()=>mock.calls.length).toBe(1);mock.switchActor(id(2));wait.resolve(null);await expect(operation).rejects.toMatchObject({kind:'abandoned'});expect(mock.calls[0].sent).toBeUndefined();expect(api.pendingReceipts(actor)).toEqual([{actorId:actor,requestId:id(901),entityId:id(900),operation:'contact',expectedVersion:1}]);expect(api.pendingReceipts(id(2))).toEqual([]);expect(JSON.stringify(api.pendingReceipts(actor))).not.toContain('private@');
});
test('route departure and late save response cannot settle the abandoned view or permit replacement mutations',async()=>{
 const wait=deferred(),mock=client(wait.promise),s=scope(),service=api.createOutreachService(mock.transport);const operation=service.save('organization',{id:id(900),version:0},id(901),s.value);await expect.poll(()=>mock.calls[0]?.sent).toBe(true);s.leave();wait.resolve({data:{id:id(900),version:1},error:null,status:200});await expect(operation).rejects.toMatchObject({kind:'abandoned'});expect(api.pendingReceipts(actor)).toHaveLength(1);
 const fresh=client(),newScope=scope();await expect(api.createOutreachService(fresh.transport).save('organization',{id:id(902),version:0},id(903),newScope.value)).rejects.toMatchObject({kind:'rejected'});expect(fresh.calls[0].sent).toBeUndefined();expect(api.pendingReceipts(actor)[0].requestId).toBe(id(901));
});
test('status not_found and mismatched applied results preserve the original request; exact confirmed result unlocks',async()=>{
 api.rememberReceipt({actorId:actor,requestId:id(901),entityId:id(900),operation:'organization',expectedVersion:2});const s=scope();
 for(const data of [{status:'not_found'},{status:'applied',result:{id:id(999),version:2}},{status:'applied',result:{id:id(900),version:1}}]){const service=api.createOutreachService(client({data,error:null,status:200}).transport);if(data.status==='not_found')expect(await service.status(id(901),s.value)).toEqual(data);else await expect(service.status(id(901),s.value)).rejects.toMatchObject({kind:'invalid'});expect(api.pendingReceipts(actor)).toHaveLength(1);}
 const service=api.createOutreachService(client({data:{status:'applied',result:{id:id(900),version:2}},error:null,status:200}).transport);await service.status(id(901),s.value);expect(api.pendingReceipts(actor)).toEqual([]);
});
test('explicit SQL rejection clears a receipt but malformed success and network uncertainty retain it',async()=>{
 const s=scope();for(const code of ['40001','42501','22023']){const mock=client({data:null,error:{code,message:'Synthetic rejection'},status:code==='40001'?500:400});await expect(api.createOutreachService(mock.transport).save('organization',{id:id(900),version:0},id(901),s.value)).rejects.toBeTruthy();expect(api.pendingReceipts(actor)).toEqual([]);}
 const malformed=client({data:{id:id(999),version:1},error:null,status:200});await expect(api.createOutreachService(malformed.transport).save('organization',{id:id(900),version:0},id(901),s.value)).rejects.toMatchObject({kind:'uncertain'});expect(api.pendingReceipts(actor)).toHaveLength(1);
});
test('private load rejects mismatched actor, capability and selected season rather than returning empty success',async()=>{
 for(const data of [{...outreachFixture(),user_id:id(2)},{...outreachFixture(),can_manage:false},[],outreachFixture()]){const service=api.createOutreachService(client({data,error:null,status:200}).transport);await expect(service.load(id(11),scope().value)).rejects.toMatchObject({kind:'invalid'});}
 await expect(api.createOutreachService(null).load(null,scope().value)).rejects.toMatchObject({kind:'unavailable'});
});
test('explicit cancellation uses the same request and only confirmed canceled or applied clears recovery',async()=>{
 const receipt={actorId:actor,requestId:id(901),entityId:id(900),operation:'contact',expectedVersion:1};api.rememberReceipt(receipt);
 const uncertain=client({data:null,error:{code:'',message:'Network failed'},status:0});await expect(api.createOutreachService(uncertain.transport).cancel(id(901),scope().value)).rejects.toMatchObject({kind:'uncertain'});expect(api.pendingReceipts(actor)).toEqual([receipt]);expect(uncertain.calls[0].name).toBe('outreach_cancel_request');expect(uncertain.calls[0].args).toEqual({request_id:id(901),expected_actor:actor});expect(uncertain.calls[0].retry).toBe(false);
 const impossible=client({data:{status:'not_found'},error:null,status:200});await expect(api.createOutreachService(impossible.transport).cancel(id(901),scope().value)).rejects.toMatchObject({kind:'invalid'});expect(api.pendingReceipts(actor)).toEqual([receipt]);
 const canceled=client({data:{status:'canceled'},error:null,status:200});expect(await api.createOutreachService(canceled.transport).cancel(id(901),scope().value)).toEqual({status:'canceled'});expect(api.pendingReceipts(actor)).toEqual([]);
 api.rememberReceipt(receipt);const applied=client({data:{status:'applied',result:{id:id(900),version:1}},error:null,status:200});expect((await api.createOutreachService(applied.transport).cancel(id(901),scope().value)).status).toBe('applied');expect(api.pendingReceipts(actor)).toEqual([]);
});
test('cancel abandonment retains recovery and a later canceled status reconciles without another write',async()=>{
 const receipt={actorId:actor,requestId:id(901),entityId:id(900),operation:'organization',expectedVersion:1};api.rememberReceipt(receipt);const wait=deferred(),mock=client(wait.promise),s=scope(),operation=api.createOutreachService(mock.transport).cancel(id(901),s.value);await expect.poll(()=>mock.calls[0]?.sent).toBe(true);s.leave();wait.resolve({data:{status:'canceled'},error:null,status:200});await expect(operation).rejects.toMatchObject({kind:'abandoned'});expect(api.pendingReceipts(actor)).toEqual([receipt]);
 const status=client({data:{status:'canceled'},error:null,status:200});expect(await api.createOutreachService(status.transport).status(id(901),scope().value)).toEqual({status:'canceled'});expect(status.calls.map(c=>c.name)).toEqual(['outreach_request_status']);expect(api.pendingReceipts(actor)).toEqual([]);
});
test('opaque receipts survive module reload without exposing other actors or retaining draft content',()=>{
 const values=new Map<string,string>();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)}});
 try{const receipt={actorId:actor,requestId:id(901),entityId:id(900),operation:'contact',expectedVersion:1};api.rememberReceipt(receipt);expect(JSON.parse(values.get('4418-outreach-pending-v1')!)).toEqual([receipt]);copyFileSync(join(dir,'api.cjs'),join(dir,'rehydrated.cjs'));const rehydrated=createRequire(import.meta.url)(join(dir,'rehydrated.cjs'));expect(rehydrated.pendingReceipts(actor)).toEqual([receipt]);expect(rehydrated.pendingReceipts(id(2))).toEqual([]);}finally{delete (globalThis as any).sessionStorage;}
});
test('Finance link malformed version remains unresolved and never becomes a confirmed receipt',async()=>{
 const mock=client({data:{id:id(999),version:2},error:null,status:200});await expect(api.createOutreachService(mock.transport).linkIncome(id(500),id(700),id(901),scope().value)).rejects.toMatchObject({kind:'uncertain'});expect(api.pendingReceipts(actor)).toEqual([{actorId:actor,requestId:id(901),entityId:id(500),operation:'income_link',expectedVersion:1}]);
});
