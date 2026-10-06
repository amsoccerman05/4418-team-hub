import type {SupabaseClient} from '@supabase/supabase-js';
import {supabase} from '../../attendance/service';
import {assertAssemblyContext,uuid,validateCheck,validateComponent} from './model';
import type {AssemblyMutation,AssemblyReceipt,CheckInput,ComponentInput} from './types';

export class AssemblyServiceError extends Error {
 constructor(message:string,readonly outcome:'rejected'|'unknown'='rejected'){super(message);this.name='AssemblyServiceError';}
}
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const actions=['component','task_link','check','snapshot'];
export function assertAssemblyReceipt(value:unknown,requestId:string):AssemblyReceipt {
 if(!object(value)||!id(requestId)||value.request_id!==requestId||!['applied','cancelled','unknown'].includes(value.status)||(value.status==='applied'?(!actions.includes(value.action)||!id(value.entity_id)||!Number.isSafeInteger(value.version)||value.version<1):(value.action!==null||value.entity_id!==null||value.version!==null)))throw new AssemblyServiceError('The save result could not be verified. Check its status before trying again.','unknown');
 return value as AssemblyReceipt;
}
export function assertAssemblyReceiptMatches(value:unknown,mutation:AssemblyMutation):AssemblyReceipt {
 const receipt=assertAssemblyReceipt(value,mutation.request_id),entityId=mutation.action==='task_link'&&'task_id' in mutation.p?mutation.p.task_id:'id' in mutation.p?mutation.p.id:null;
 if(receipt.status==='applied'&&(receipt.action!==mutation.action||receipt.entity_id!==entityId||receipt.version!==mutation.p.version+1))throw new AssemblyServiceError('The save result did not match this change. Check its status before trying again.','unknown');
 return receipt;
}
function boundedMutation(mutation:AssemblyMutation):AssemblyMutation {
 if(!object(mutation)||!id(mutation.request_id)||!id(mutation.expected_actor)||!actions.includes(mutation.action)||!object(mutation.p)||!id(mutation.p.board_id)||!Number.isSafeInteger(mutation.p.version)||mutation.p.version<0||mutation.p.version>=Number.MAX_SAFE_INTEGER)throw new AssemblyServiceError('The project, account or version is unavailable. Refresh before saving.');
 const p=mutation.p;
 const fields:Record<string,string[]>={component:['id','name','quantity','status','notes'],task_link:['task_id','linked'],check:['id','title','kind','outcome','procedure','expected','observed','evidence_url','revision_id','rework_task_id','supersedes_id'],snapshot:['id','notes']};
 const allowed=['board_id','version',...fields[mutation.action]];
 if(Object.keys(p).length!==allowed.length||Object.keys(p).some(key=>!allowed.includes(key)))throw new AssemblyServiceError('The change contains unsupported fields. Refresh before saving.');
 const error=mutation.action==='component'?validateComponent(p as ComponentInput):mutation.action==='check'?validateCheck(p as CheckInput):mutation.action==='task_link'?(!('task_id' in p)||!id(p.task_id)||!('linked' in p)||typeof p.linked!=='boolean'?'Choose a current Planning task.':null):(!('id' in p)||!id(p.id)||!('notes' in p)||typeof p.notes!=='string'||p.notes.length>2000?'Keep snapshot notes within 2,000 characters.':null);
 if(error)throw new AssemblyServiceError(error);
 // Copy only the public wire contract before auth yields; an editor cannot change
 // the submitted body or expected receipt while the SDK is checking the session.
 return {action:mutation.action,request_id:mutation.request_id,expected_actor:mutation.expected_actor,p:{...p}};
}
async function abortable<T>(operation:PromiseLike<T>,signal:AbortSignal,error:()=>AssemblyServiceError):Promise<T> {
 let cancel=()=>{};
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{cancel=()=>reject(error());signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]);}
 finally{signal.removeEventListener('abort',cancel);}
}
async function request(name:string,args:Record<string,unknown>,actorId:string,signal:AbortSignal,write:boolean,client:SupabaseClient|null,isCurrent:()=>boolean):Promise<unknown> {
 if(!client)throw new AssemblyServiceError('Team connection unavailable.');
 if(!id(actorId)||signal.aborted||!isCurrent())throw new AssemblyServiceError('This request was closed.');
 const abandoned=new AbortController(),timeout=AbortSignal.any([signal,abandoned.signal,AbortSignal.timeout(15000)]);
 let dispatched=false;
 const leave=()=>{if(!isCurrent())abandoned.abort();};
 const subscription=client.auth.onAuthStateChange((_event,next)=>{if(next?.user.id!==actorId)abandoned.abort();}).data.subscription;
 if(typeof window!=='undefined')window.addEventListener('hashchange',leave);
 try {
  const {data:auth,error}=await abortable(client.auth.getSession(),timeout,()=>new AssemblyServiceError('Your account changed or this request closed. Reload Assembly & Testing.'));
  if(timeout.aborted||!isCurrent()||error||auth.session?.user.id!==actorId||!auth.session.access_token)throw new AssemblyServiceError('Your account changed. Reload Assembly & Testing.');
  const operation=client.rpc(name,args).setHeader('Authorization',`Bearer ${auth.session.access_token}`).retry(false).abortSignal(timeout);
  dispatched=true;
  const result=await abortable(operation,timeout,()=>new AssemblyServiceError(write?'The save may have completed. Check its status.':'Assembly & Testing could not be loaded. Refresh to try again.',write?'unknown':'rejected'));
  if(timeout.aborted||!isCurrent())throw new AssemblyServiceError('This view changed before the result could be confirmed.',write?'unknown':'rejected');
  if(result.error){
   const code=result.error.code||'',rejected=!!code&&result.status>=400&&result.status<500&&![408,429].includes(result.status)&&(/^AS(401|403|409|412|413|422)$/.test(code)||!code.startsWith('AS'));
   const message=code==='AS409'?'Another teammate changed this project. Close the editor and refresh before saving.':code==='AS403'?'Your access to this project changed. Close the editor and refresh.':code==='AS401'?'Your account changed. Reload Assembly & Testing.':code==='AS422'?'Check the fields, current revision and linked Planning task.':code==='AS413'?'This project reached its record limit. Refresh before saving.':code==='AS412'?'This request could not be reused. Check its status before starting another.':rejected?'This change could not be saved. Refresh before trying again.':'The connection ended before the result could be confirmed.';
   throw new AssemblyServiceError(message,write&&!rejected?'unknown':'rejected');
  }
  return result.data;
 }catch(error){if(error instanceof AssemblyServiceError)throw error;throw new AssemblyServiceError(write&&dispatched?'The save may have completed. Check its status.':'Assembly & Testing could not be loaded. Refresh to try again.',write&&dispatched?'unknown':'rejected');}
 finally{subscription.unsubscribe();if(typeof window!=='undefined')window.removeEventListener('hashchange',leave);}
}
export async function loadAssembly(actorId:string,boardId:string,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 if(!id(boardId))throw new AssemblyServiceError('Choose an available project.');
 return assertAssemblyContext(await request('assembly_context',{board_id:boardId,expected_actor:actorId},actorId,signal,false,client,isCurrent),actorId,boardId);
}
export async function mutateAssembly(mutation:AssemblyMutation,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 const copied=boundedMutation(mutation);
 return assertAssemblyReceiptMatches(await request('assembly_mutate',copied,copied.expected_actor,signal,true,client,isCurrent),copied);
}
export async function reconcileAssembly(actorId:string,requestId:string,cancel:boolean,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 if(!id(requestId)||typeof cancel!=='boolean')throw new AssemblyServiceError('The save receipt could not be verified.');
 return assertAssemblyReceipt(await request(cancel?'assembly_cancel_mutation':'assembly_mutation_status',{request_id:requestId,expected_actor:actorId},actorId,signal,cancel,client,isCurrent),requestId);
}
