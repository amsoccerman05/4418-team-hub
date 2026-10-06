import type {SupabaseClient} from '@supabase/supabase-js';
import {supabase} from '../attendance/service';
import {assertFabricationContext,fabricationActions,uuid,validateFabricationSubmission} from './model';
import {FABRICATION_DXF_MAX_BYTES,FABRICATION_PDF_MAX_BYTES} from './types';
import type {FabricationFileKind,FabricationMutation,FabricationReceipt,FabricationUpload} from './types';

export class FabricationServiceError extends Error {constructor(message:string,readonly outcome:'rejected'|'unknown'='rejected'){super(message);}}
export function assertFabricationReceipt(value:unknown,requestId:string):FabricationReceipt {
 const r=value as FabricationReceipt;
 if(!r||r.request_id!==requestId||!uuid.test(requestId)||!['applied','cancelled','unknown','pending'].includes(r.status)||(r.status==='applied'?(![...fabricationActions,'revision'].includes(r.action||'')||!r.entity_id||!uuid.test(r.entity_id)||!Number.isSafeInteger(r.version)||Number(r.version)<1):(r.action!==null||r.entity_id!==null||r.version!==null)))throw new FabricationServiceError('The result could not be verified. Check its status before trying again.','unknown');
 return {request_id:r.request_id,status:r.status,action:r.action,entity_id:r.entity_id,version:r.version};
}
export function assertFabricationReceiptMatches(value:unknown,mutation:FabricationMutation|FabricationUpload):FabricationReceipt {
 const r=assertFabricationReceipt(value,mutation.request_id),action='action' in mutation?mutation.action:'revision';
 if(r.status==='applied'&&(r.action!==action||r.entity_id!==mutation.p.part_id||r.version!==(mutation.p.version??0)+1))throw new FabricationServiceError('The result did not match this part revision. Check its status before trying again.','unknown');return r;
}
function messageFor(code:string){return code==='FB413'?'The fabrication storage or revision limit has been reached. Ask a team administrator to review capacity.':code==='FB409'?'Another teammate changed this part. Close the editor and refresh.':code==='FB403'?'Your access to this project changed. Close the editor and refresh.':code==='FB401'?'Your account changed. Reload Fabrication.':code==='FB422'?'Check the part fields and file requirements.':code==='FB412'?'This request key could not be reused. Check its status.':'This request could not be completed. Refresh before trying again.';}
function responseError(code:string,status:number,write:boolean,detail=''){const rejected=!!code&&![408,429].includes(status)&&(/^FB(401|403|409|412|413|422)$/.test(code)||!code.startsWith('FB')&&(status>=400&&status<500||/^(22|23|40|42|P0)/.test(code)));const safeDetail=['invalid_file','file_size','invalid_request','invalid_metadata','invalid_onshape_url'].includes(code)&&detail.length<=500&&!/[\u0000-\u0008\u000b-\u001f]/.test(detail)?detail:'';return new FabricationServiceError(rejected?(safeDetail||messageFor(code)):write?'The connection ended before the result could be confirmed. Check its status.':'Fabrication could not be loaded. Try again.',write&&!rejected?'unknown':'rejected');}
async function session(client:SupabaseClient,signal:AbortSignal){let cancel=()=>{};try{return await Promise.race([client.auth.getSession(),new Promise<never>((_,reject)=>{cancel=()=>reject(new FabricationServiceError('Your account changed. Reload Fabrication.'));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]);}finally{signal.removeEventListener('abort',cancel);}}
type Result={data:unknown;response?:Response};
async function request(name:string,body:Record<string,unknown>|FormData,actorId:string,signal:AbortSignal,write:boolean,edge:boolean,client:SupabaseClient|null,isCurrent:()=>boolean):Promise<Result> {
 if(!client)throw new FabricationServiceError('Team connection unavailable.');if(!uuid.test(actorId)||signal.aborted||!isCurrent())throw new FabricationServiceError('This request was closed.');
 const abandoned=new AbortController(),timeout=AbortSignal.any([signal,abandoned.signal,AbortSignal.timeout(edge?90000:15000)]);let dispatched=false;
 const leave=()=>{if(!isCurrent())abandoned.abort();};const subscription=client.auth.onAuthStateChange((_event,next)=>{if(next?.user.id!==actorId)abandoned.abort();}).data.subscription;
 if(typeof window!=='undefined')window.addEventListener('hashchange',leave);
 try {
  const {data:auth,error}=await session(client,timeout);if(timeout.aborted||!isCurrent()||error||auth.session?.user.id!==actorId||!auth.session.access_token)throw new FabricationServiceError('Your account changed. Reload Fabrication.');
  const Authorization=`Bearer ${auth.session.access_token}`;dispatched=true;
  if(edge){const result=await client.functions.invoke(name,{body,headers:{Authorization},signal:timeout});if(timeout.aborted||!isCurrent())throw new FabricationServiceError('This view changed before the result could be confirmed.',write?'unknown':'rejected');if(result.error){let code='',detail='';try{const details=await result.response?.json();code=typeof details?.code==='string'?details.code:'';detail=typeof details?.error==='string'?details.error:'';}catch{/* Transport errors cannot prove a write failed. */}throw responseError(code,result.response?.status??0,write,detail);}return {data:result.data,response:result.response};}
  const result=await client.rpc(name,body as Record<string,unknown>).setHeader('Authorization',Authorization).retry(false).abortSignal(timeout);
  if(timeout.aborted||!isCurrent())throw new FabricationServiceError('This view changed before the result could be confirmed.',write?'unknown':'rejected');
  if(result.error)throw responseError(result.error.code||'',result.status,write);return {data:result.data};
 }catch(e){if(e instanceof FabricationServiceError)throw e;throw new FabricationServiceError(write&&dispatched?'The save may have completed. Check its status.':'Fabrication could not be loaded. Try again.',write&&dispatched?'unknown':'rejected');}
 finally{subscription.unsubscribe();if(typeof window!=='undefined')window.removeEventListener('hashchange',leave);}
}
export async function loadFabrication(actorId:string,seasonId:string|null,projectId:string|null,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){return assertFabricationContext((await request('fabrication_context',{selected_season:seasonId,selected_project:projectId},actorId,signal,false,false,client,isCurrent)).data,actorId,seasonId,projectId);}
/** Lightweight read for an open part. Polling must not repeatedly transfer its entire revision history. */
export async function readFabricationPartVersion(actorId:string,partId:string,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 if(!uuid.test(partId))throw new FabricationServiceError('Invalid part reference.');
 const {data}=await request('fabrication_part_version',{part_id:partId,expected_actor:actorId},actorId,signal,false,false,client,isCurrent);
 if(!Number.isSafeInteger(data)||Number(data)<1)throw new FabricationServiceError('The part status could not be verified. Refresh Fabrication.');return data as number;
}
export async function mutateFabrication(mutation:FabricationMutation,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 if(!uuid.test(mutation.request_id)||!fabricationActions.includes(mutation.action)||![mutation.p.part_id,mutation.p.revision_id].every(v=>uuid.test(v))||!Number.isSafeInteger(mutation.p.version)||mutation.p.version<1||typeof mutation.p.note!=='string'||mutation.p.note.length>2000)throw new FabricationServiceError('Check the selected part and action.');
 return assertFabricationReceiptMatches((await request('fabrication_mutate',mutation,mutation.expected_actor,signal,true,false,client,isCurrent)).data,mutation);
}
export async function reconcileFabrication(actorId:string,requestId:string,cancel:boolean,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 if(!uuid.test(requestId))throw new FabricationServiceError('Invalid recovery request.');const body={request_id:requestId,expected_actor:actorId};
 return assertFabricationReceipt((await request(cancel?'fabrication-files':'fabrication_mutation_status',cancel?{action:'cancel',...body}:body,actorId,signal,cancel,cancel,client,isCurrent)).data,requestId);
}
export async function uploadRevision(mutation:FabricationUpload,dxf:File,pdf:File|null,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 const invalid=validateFabricationSubmission(mutation.p);if(invalid)throw new FabricationServiceError(invalid);
 if(!uuid.test(mutation.request_id))throw new FabricationServiceError('Invalid upload request.');
 for(const [kind,file,max] of [['dxf',dxf,FABRICATION_DXF_MAX_BYTES],['pdf',pdf,FABRICATION_PDF_MAX_BYTES]] as const){if(file===null&&kind==='pdf')continue;if(!file||!file.name.toLowerCase().endsWith('.'+kind)||file.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(file.name)||file.size<1||file.size>max)throw new FabricationServiceError(kind==='dxf'?'Choose a DXF file up to 20 MiB.':'Choose a PDF drawing up to 10 MiB.');}
 const body=new FormData();body.set('action','upload');body.set('request_id',mutation.request_id);body.set('expected_actor',mutation.expected_actor);body.set('p',JSON.stringify(mutation.p));body.set('dxf',dxf);if(pdf)body.set('pdf',pdf);
 return assertFabricationReceiptMatches((await request('fabrication-files',body,mutation.expected_actor,signal,true,true,client,isCurrent)).data,mutation);
}
/** Downloads exact immutable bytes through an authenticated proxy. No persistent signed/public link. */
export async function downloadFabricationFile(actorId:string,revisionId:string,kind:FabricationFileKind,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true):Promise<{blob:Blob;filename:string}> {
 if(!uuid.test(revisionId)||!['dxf','pdf'].includes(kind))throw new FabricationServiceError('Invalid file reference.');
 const {data,response}=await request('fabrication-files',{action:'download',expected_actor:actorId,revision_id:revisionId,file_kind:kind},actorId,signal,false,true,client,isCurrent);
 const disposition=response?.headers.get('Content-Disposition')||'',filename=/^attachment;\s*filename="([^"\\/\u0000-\u001f\u007f]+)"(?:;.*)?$/i.exec(disposition)?.[1],sha=response?.headers.get('X-Fabrication-SHA256');
 if(!(data instanceof Blob)||data.size<1||data.size>(kind==='dxf'?FABRICATION_DXF_MAX_BYTES:FABRICATION_PDF_MAX_BYTES)||!filename||filename.length>240||!filename.toLowerCase().endsWith('.'+kind)||response?.headers.get('X-Fabrication-Revision')!==revisionId||response?.headers.get('X-Fabrication-Kind')!==kind||!sha||!/^[0-9a-f]{64}$/.test(sha))throw new FabricationServiceError('The downloaded file could not be verified. Refresh before trying again.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await data.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');const auth=client?await session(client,AbortSignal.any([signal,AbortSignal.timeout(15000)])):null;if(hash!==sha||auth?.data.session?.user.id!==actorId||auth?.error||signal.aborted||!isCurrent())throw new FabricationServiceError('The file or account changed before the download could be verified.');return {blob:data,filename};
}
