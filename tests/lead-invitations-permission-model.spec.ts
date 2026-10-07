import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Runs the actual parent and Onboarding hooks against controllable local responses.
// This checks asynchronous permission boundaries, not browser layout/event scheduling.
const repoRequire=createRequire(import.meta.url);
type Node={type:any;props:any;key?:string|number};
type Bucket={slots:any[];cursor:number;pending:(()=>void)[]};
const bucket=():Bucket=>({slots:[],cursor:0,pending:[]});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
function descendants(node:any):Node[]{
 if(!node||typeof node!=='object')return [];
 if(Array.isArray(node))return node.flatMap(descendants);
 return [node,...descendants(node.props?.children)];
}
function words(node:any):string{
 if(typeof node==='string'||typeof node==='number')return String(node);
 if(Array.isArray(node))return node.map(words).join('');
 return node&&typeof node==='object'?words(node.props?.children):'';
}
function harness(initialRole='mentor'){
 const parent=bucket(),cache=new Map<string,any>();let current=parent,child=bucket(),childKey:any,childMounted=false;
 let role=initialRole,active=true,authCallback:((event:string,session:any)=>void)|undefined;
 let profileGate:ReturnType<typeof deferred<any>>|undefined;
 const contextGates=new Map<string,ReturnType<typeof deferred<any>>>();
 const manager={members:[],areas:[],positions:[],assignments:[],invitations:[{id:'other-invitation',email:'private-other@example.test',display_name:'Other member',status:'pending',created_at:'2026-10-01T00:00:00Z'}],history:[{id:1,actor_id:'other-actor',action:'invitation_requested',reason:'Private manager history',created_at:'2026-10-01T00:00:00Z'}]};
 const lead={members:[],areas:[],positions:[],assignments:[],invitations:[],history:[]};
 const calls:string[]=[],runners:any[]=[];
 const supabase={
  auth:{onAuthStateChange(callback:any){authCallback=callback;callback('INITIAL_SESSION',{user:{id:'fixture-actor'}});return {data:{subscription:{unsubscribe(){}}}};}},
  from(){return {select(){return this;},eq(){return this;},abortSignal(){return this;},single(){calls.push('profile');if(profileGate){const gate=profileGate;profileGate=undefined;return gate.promise;}return Promise.resolve({data:{role,active}});}};},
  rpc(name:string){return {abortSignal(){calls.push(name);const gate=contextGates.get(name);if(gate){contextGates.delete(name);return gate.promise;}return Promise.resolve({data:name==='team_invitation_context'?lead:manager});}};},
 };
 const react={
  useRef(value:any){const index=current.cursor++;return current.slots[index]??={current:value};},
  useState(initial:any){const state=current,index=state.cursor++;if(!(index in state.slots))state.slots[index]=typeof initial==='function'?initial():initial;return [state.slots[index],(value:any)=>{state.slots[index]=typeof value==='function'?value(state.slots[index]):value;}];},
  useEffect(effect:()=>void|(()=>void),deps?:any[]){
   const state=current,index=state.cursor++,old=state.slots[index];
   if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){state.slots[index]={deps,cleanup:old?.cleanup};state.pending.push(()=>{state.slots[index].cleanup?.();state.slots[index].cleanup=effect();});}
  },
 };
 const forms={Dialog:function Dialog(){},InviteForm:function InviteForm(){},PositionForm:function PositionForm(){},AreaForm:function AreaForm(){},StateForm:function StateForm(){},groups:[],linked(){}};
 const jsx=(type:any,props:any,key?:string|number)=>({type,props,key});
 function load(file:string):any{
  const path=resolve(file);if(cache.has(path))return cache.get(path);
  const exports:any={};cache.set(path,exports);
  const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',source)((name:string)=>{
   if(name==='react')return react;
   if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
   if(name==='lucide-react')return new Proxy({},{get:()=>function Icon(){}});
   if(name.endsWith('.css'))return {};
   if(name==='./ManagementForms')return forms;
   if(name==='../attendance/service')return {supabase};
   if(name==='./invitation-client')return {submitReviewedInvitation:async()=>{throw Error('These tests must never send invitations');}};
   if(!name.startsWith('.'))return repoRequire(name);
   let next=resolve(dirname(path),name);if(!extname(next))next+=existsSync(next+'.ts')?'.ts':'.tsx';
   const result=load(next);
   if(name==='./invitation-batch')return {...result,createInvitationBatchRunner:(options:any)=>{const runner=result.createInvitationBatchRunner(options);runners.push(runner);return runner;}};
   return result;
  },exports);return exports;
 }
 const TeamManagement=load('src/team/TeamManagement.tsx').TeamManagement;
 const Onboarding=load('src/team/Onboarding.tsx').Onboarding;
 let tree:Node,onboardingTree:Node,onboardingNode:Node;
 const cleanup=(state:Bucket)=>{for(const slot of state.slots)slot?.cleanup?.();};
 function render(){
  current=parent;parent.cursor=0;tree=TeamManagement({workspace:true});
  onboardingNode=descendants(tree).find(node=>node.type===Onboarding)!;
  if(!childMounted||childKey!==onboardingNode.key){if(childMounted)cleanup(child);child=bucket();childKey=onboardingNode.key;childMounted=true;}
  current=child;child.cursor=0;onboardingTree=Onboarding(onboardingNode.props);
  for(const state of [parent,child])for(const effect of state.pending.splice(0))effect();
 }
 async function settle(){for(let i=0;i<5;i++){await tick();render();}}
 const find=(type:string,label:string,inChild=false)=>descendants(inChild?onboardingTree:tree).find(node=>node.type===type&&(node.props['aria-label']===label||words(node)===label))!;
 const click=(label:string,inChild=false)=>{const node=find('button',label,inChild);expect(node,`button ${label}`).toBeTruthy();node.props.onClick();render();};
 function draft(){
  if(!onboardingNode.props.active)click('Onboarding');
  click('Add one recipient',true);
  for(const [label,value] of [['Name for recipient 1','Reviewed student'],['Email for recipient 1','reviewed@example.test'],['Reason for recipient 1','Approved student joining']]){find('input',label,true).props.onChange({target:{value}});render();}
  click('Review batch',true);
 }
 return {manager,lead,calls,render,settle,click,draft,
  get node(){return onboardingNode;},get tree(){return tree;},get runner(){return runners.at(-1);},
  holdContext(name:string){const gate=deferred<any>();contextGates.set(name,gate);return gate;},
  holdProfile(){const gate=deferred<any>();profileGate=gate;return gate;},
  refreshSingle(){click('+ Invite member');const form=descendants(tree).find(node=>node.type===forms.InviteForm)!;form.props.onRefresh();render();},
  auth(nextRole=role,nextActive=active){role=nextRole;active=nextActive;authCallback!('TOKEN_REFRESHED',{user:{id:'fixture-actor'}});render();},
  close(){cleanup(parent);cleanup(child);},
 };
}

const globals=['location','window'] as const;let original:Map<string,PropertyDescriptor|undefined>;
test.beforeEach(()=>{original=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));Object.assign(globalThis,{location:{hash:'#team-management'},window:{addEventListener(){},removeEventListener(){}}});});
test.afterEach(()=>{for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});

test('late manager refresh cannot replace a same-user lead projection',async()=>{
 const h=harness();try{
  h.render();await h.settle();const oldSignal=h.node.props.identitySignal;
  const managerRefresh=h.holdContext('team_management_context_v2');h.refreshSingle();
  h.auth('lead');await h.settle();expect(h.node.props.studentOnly).toBe(true);expect(oldSignal.aborted).toBe(true);expect(h.node.props.data.invitations).toEqual([]);
  managerRefresh.resolve({data:h.manager});await h.settle();
  expect(h.node.props.active).toBe(true);expect(h.node.props.data.invitations).toEqual([]);expect(words(h.tree)).not.toMatch(/Private manager history|private-other@example/);
 }finally{h.close();}
});

test('manager response before role discovery is discarded even when the new context fails',async()=>{
 const h=harness();try{
  h.render();await h.settle();const managerRefresh=h.holdContext('team_management_context_v2');h.refreshSingle();
  const profile=h.holdProfile(),leadContext=h.holdContext('team_invitation_context');h.auth('lead');await h.settle();
  managerRefresh.resolve({data:h.manager});await h.settle();expect(h.node.props.active).toBe(false);
  profile.resolve({data:{role:'lead',active:true}});await h.settle();leadContext.resolve({error:{message:'Fixture context interruption'}});await h.settle();
  expect(h.node.props.studentOnly).toBe(true);expect(h.node.props.active).toBe(false);expect(h.node.props.data.invitations).toEqual([]);
  expect(words(h.tree)).toContain('Team management is unavailable.');expect(words(h.tree)).not.toMatch(/Private manager history|private-other@example/);
 }finally{h.close();}
});

for(const role of ['mentor','lead'])test(`same-role ${role} token refresh preserves the reviewed batch`,async()=>{
 const h=harness(role);try{
  h.render();await h.settle();h.draft();const runner=h.runner,key=h.node.key,signal=h.node.props.identitySignal,rows=runner.snapshot();
  expect(rows[0].status).toBe('ready');h.auth(role);await h.settle();
  expect(h.node.key).toBe(key);expect(signal.aborted).toBe(false);expect(h.runner).toBe(runner);expect(h.runner.snapshot()).toEqual(rows);
 }finally{h.close();}
});

test('same-user permission change clears reviewed manager drafts',async()=>{
 const h=harness();try{
  h.render();await h.settle();h.draft();const runner=h.runner,key=h.node.key;expect(runner.snapshot()).toHaveLength(1);
  h.auth('lead');await h.settle();expect(h.node.key).not.toBe(key);expect(h.runner).not.toBe(runner);expect(h.runner.snapshot()).toEqual([]);
 }finally{h.close();}
});
