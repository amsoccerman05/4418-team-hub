import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
const {harness}=createRequire(import.meta.url)('./fixtures/onboarding-lifecycle.cjs');
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const globals=['location','window','document','history','fetch'] as const;
let original:Map<string,PropertyDescriptor|undefined>;
test.beforeEach(()=>{original=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));});
test.afterEach(()=>{for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});

test('actual hash navigation pauses before the next recipient even before router render',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),sent:string[]=[];
 Object.assign(globalThis,{location:{hash:'#team-management'},window:{addEventListener(){},removeEventListener(){}}});
 const h=harness({'./invitation-client':()=>({submitReviewedInvitation:async(payload:any)=>{sent.push(payload.id);if(sent.length===1)await gate;return {status:'accepted'};}})});
 const {runner,unmount}=h.mount();runner.replaceRows(h.reviewedRows(2));const running=runner.start();
 expect(sent).toHaveLength(1);location.hash='#planning/my-work';release();
 const result=await running;expect(sent).toHaveLength(1);expect(result.status).toBe('paused');expect(result.rows[1].status).toBe('ready');unmount();
});

async function brokerFixture(){
 const listeners=new Map<string,Set<(event:any)=>void>>(),held:any[]=[],sent:{actor:string;id:string}[]=[];
 const a={access_token:'fixture-only-actor-a',user:{id:'account-A'}},b={access_token:'fixture-only-actor-b',user:{id:'account-B'}};
 let brokerSession=a,count=0,holdAt=0,aborted=0;
 const frame:any={contentWindow:{postMessage(message:any){if(message.method==='getSession'&&++count===holdAt){held.push(message);return;}queueMicrotask(()=>reply(message,brokerSession));}}};
 const emit=(kind:string,event:any)=>{for(const fn of listeners.get(kind)||[])fn(event);};
 const dispatch=(data:any)=>emit('message',{origin:'https://team.frc4418.org',source:frame.contentWindow,data});
 const reply=(message:any,session:any)=>dispatch({protocol:'4418-suite-auth-v1',id:message.id,result:{data:{session},error:null}});
 Object.assign(globalThis,{
  location:{origin:'https://team.frc4418.org',pathname:'/',search:'',hash:'#team-management'},
  window:{opener:null,addEventListener(kind:string,fn:any){if(!listeners.has(kind))listeners.set(kind,new Set());listeners.get(kind)!.add(fn);},removeEventListener(kind:string,fn:any){listeners.get(kind)?.delete(fn);}},
  document:{referrer:'',createElement(){return frame;},body:{append(f:any){f.onload();}},addEventListener(){}},history:{replaceState(){}},
  fetch:async(url:string,init:RequestInit)=>{
   // Native fetch rejects an already-aborted request before any HTTP transmission.
   if(init.signal?.aborted){aborted++;throw new DOMException('Aborted','AbortError');}
   expect(new URL(url).hostname).toBe('local-fixture.invalid');
   const header=new Headers(init.headers).get('Authorization');
   const actor=header===`Bearer ${a.access_token}`?'account-A':header===`Bearer ${b.access_token}`?'account-B':'unknown';
   const body=JSON.parse(String(init.body));sent.push({actor,id:body.id});
   return new Response(JSON.stringify({id:body.id,status:'pending'}),{status:202,headers:{'content-type':'application/json'}});
  },
 });
 let supabase:any;const h=harness({'../attendance/service':()=>({supabase})});
 supabase=h.load('src/suite-auth.ts').createSuiteClient('https://local-fixture.invalid','fixture-public-key');
 await supabase.auth.getSession();await tick();count=0;
 return {h,supabase,sent,held,a,b,get aborted(){return aborted;},hold(n:number){holdAt=n;count=0;},
  async wait(){for(let n=0;n<20&&!held.length;n++)await tick();expect(held).toHaveLength(1);},
  release(session=brokerSession){reply(held.shift(),session);},
  change(session:any,event='SIGNED_IN'){brokerSession=session;dispatch({protocol:'4418-suite-auth-v1',event,session});},
  navigate(hash:string){location.hash=hash;emit('hashchange',{});},
 };
}

for(const stage of [1,2])for(const transition of ['account switch','unmount','route exit'] as const)test(`pending broker stage ${stage} cannot dispatch after ${transition}`,async()=>{
 const f=await brokerFixture(),controller=new AbortController();let current=true;
 const sub=f.supabase.auth.onAuthStateChange((_event:string,session:any)=>{if(session?.user.id!=='account-A'){current=false;controller.abort();}});
 await tick();const {runner,unmount}=f.h.mount({identitySignal:controller.signal,isCurrentIdentity:()=>current});
 runner.replaceRows(f.h.reviewedRows(1));f.hold(stage);const running=runner.start();await f.wait();expect(f.sent).toHaveLength(0);
 if(transition==='account switch')f.change(f.b);else if(transition==='unmount')unmount();else f.navigate('#planning/my-work');
 f.release(transition==='account switch'?f.b:f.a);await running;expect(f.sent).toHaveLength(0);
 if(stage===2)expect(f.aborted).toBe(1);
 unmount();sub.data.subscription.unsubscribe();
});

test('SDK late token selection cannot replace the reviewed actor Authorization',async()=>{
 const f=await brokerFixture();const {runner,unmount}=f.h.mount();runner.replaceRows(f.h.reviewedRows(1));
 f.hold(2);const running=runner.start();await f.wait();f.release(f.b);await running;
 expect(f.sent.map(row=>row.actor)).toEqual(['account-A']);unmount();
});

test('different actor returned by first broker read is rejected before invocation',async()=>{
 const f=await brokerFixture();const {runner,unmount}=f.h.mount();runner.replaceRows(f.h.reviewedRows(1));
 f.hold(1);const running=runner.start();await f.wait();f.release(f.b);const result=await running;
 expect(f.sent).toHaveLength(0);expect(result.rows[0].outcome).toMatchObject({status:'not_sent',code:'sign_in_required'});unmount();
});

test('same-user token refresh keeps an in-flight reviewed request bound to its actor',async()=>{
 const f=await brokerFixture(),controller=new AbortController();
 const sub=f.supabase.auth.onAuthStateChange((_event:string,session:any)=>{if(session?.user.id!=='account-A')controller.abort();});
 await tick();const {runner,unmount}=f.h.mount({identitySignal:controller.signal});runner.replaceRows(f.h.reviewedRows(1));
 f.hold(2);const running=runner.start();await f.wait();f.change(f.a,'TOKEN_REFRESHED');f.release(f.a);const result=await running;
 expect(controller.signal.aborted).toBe(false);expect(f.sent.map(row=>row.actor)).toEqual(['account-A']);expect(result.rows[0].status).toBe('accepted');unmount();sub.data.subscription.unsubscribe();
});

test('identity epoch invalidation cannot be revived by switching away and back',async()=>{
 const f=await brokerFixture(),controller=new AbortController();let currentId='account-A',epoch=1;
 const sub=f.supabase.auth.onAuthStateChange((_event:string,session:any)=>{if(currentId!==session?.user.id){currentId=session?.user.id;epoch++;controller.abort();}});
 await tick();const expected=epoch;const {runner,unmount}=f.h.mount({identitySignal:controller.signal,isCurrentIdentity:()=>currentId==='account-A'&&epoch===expected});runner.replaceRows(f.h.reviewedRows(1));
 f.hold(2);const running=runner.start();await f.wait();f.change(f.b);f.change(f.a);f.release(f.a);await running;
 expect(f.sent).toHaveLength(0);expect(controller.signal.aborted).toBe(true);unmount();sub.data.subscription.unsubscribe();
});

for(const stage of [1,2])test(`single invitation route cancellation survives return during broker stage ${stage} without poisoning identity`,async()=>{
 const f=await brokerFixture(),identity=new AbortController();
 const client=f.h.load('src/team/invitation-client.ts');
 const scope={actorId:'account-A',isCurrent:()=>location.hash==='#team-management',signal:identity.signal};
 const rows=f.h.reviewedRows(2);f.hold(stage);
 const pending=client.submitReviewedInvitation(rows[0].reviewedPayload,scope);await f.wait();
 f.navigate('#planning/my-work');f.navigate('#team-management');f.release(f.a);await pending;
 expect(f.sent).toHaveLength(0);expect(identity.signal.aborted).toBe(false);
 const fresh=await client.submitReviewedInvitation(rows[1].reviewedPayload,scope);
 expect(fresh.status).toBe('accepted');expect(f.sent).toHaveLength(1);expect(f.sent[0].id).toBe(rows[1].id);
});

for(const stage of [1,2])test(`batch leave and return during broker stage ${stage} preserves later explicit dispatch`,async()=>{
 const f=await brokerFixture();const {runner,unmount}=f.h.mount();const rows=f.h.reviewedRows(2);runner.replaceRows(rows);
 f.hold(stage);const pending=runner.start();await f.wait();f.navigate('#planning/my-work');f.navigate('#team-management');f.release(f.a);await pending;
 expect(f.sent).toHaveLength(0);expect(runner.snapshot()[1].status).toBe('ready');
 // Models a new explicit resume after review; the interrupted first row is not retried.
 await runner.start();expect(f.sent).toHaveLength(1);expect(f.sent[0].id).toBe(rows[1].id);unmount();
});
