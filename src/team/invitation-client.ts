import {supabase} from '../attendance/service';
import type {InvitationOutcome, InvitationPayload} from './invitation-batch';

const review=(message='The invitation result is not confirmed. Check the account and Activity before taking another action.'):InvitationOutcome=>({status:'review',message});
const notSent=(code:Extract<InvitationOutcome,{status:'not_sent'}>['code'],message:string):InvitationOutcome=>({status:'not_sent',stage:'before_reservation',code,message});
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
/** Only the existing edge handler's explicit pre-reservation responses allow correction/retry. */
export function classifyInvitationResponse(id:string,data:unknown,status:number|null,error:boolean):InvitationOutcome{
 const body=record(data);
 if(!error){
  if((status===200||status===202)&&body?.id===id&&body.status==='pending'&&(body.already_invited===undefined||typeof body.already_invited==='boolean'))return {status:'accepted',alreadyInvited:body.already_invited===true,message:body.already_invited===true?'This request was already accepted. No new invitation was sent.':'Invitation accepted by the service; account setup is still pending. Inbox delivery is not confirmed.'};
  return review();
 }
 if(status!==null&&status>=500)return review();
 if(body?.code==='already_reserved'||body?.status==='processing'||body?.status==='review')return review('An invitation is already processing or needs review. Refresh status and check Activity; do not resend.');
 if(status===409){
  if(body?.code==='invalid_details')return notSent('invalid_details','Not sent. Check the name, email, and required invitation reason.');
  if(body?.code==='inactive_area')return notSent('inactive_area','Not sent. Choose an active area or leave it unassigned, then review again.');
  if(body?.code==='existing_account')return notSent('existing_account','Not sent. This account already exists; find the member instead of inviting again.');
 }
 if(status===403&&body?.code==='inviter_required')return notSent('inviter_required','Not sent. Active lead, mentor or admin access is required. Refresh before continuing.');
 if(status===403&&body?.code==='student_only')return notSent('student_only','Not sent. Leads can invite students only. Review the account role before continuing.');
 if(status===403&&body?.code==='invitation_not_owned')return notSent('invitation_not_owned','Not sent. This invitation is not available to this account. Ask a mentor to review it.');
 if(status===403&&body?.code==='manager_required')return notSent('manager_required','Not sent. Active mentor or admin access is required. Refresh the team list before continuing.');
 if(status===403&&body?.error==='Origin not allowed')return notSent('origin_not_allowed','Not sent. Open Team Hub at its official address before continuing.');
 if(status===401&&body?.error==='Sign in required')return notSent('sign_in_required','Not sent. Sign in again before continuing.');
 if(status===400&&body?.error==='Valid invitation request required')return notSent('invalid_request','Not sent. This request could not be validated. Review the recipient again.');
 if(status===405&&body?.error==='POST required')return notSent('method_not_allowed','Not sent. The invitation request was rejected before processing.');
 return review();
}
export type InvitationDispatchScope = {actorId:string;isCurrent:()=>boolean;signal:AbortSignal};
/** One recipient, one endpoint call, no retries or provider/quota assumptions. */
export async function submitReviewedInvitation(payload:InvitationPayload,scope:InvitationDispatchScope):Promise<InvitationOutcome>{
 if(!supabase)return notSent('sign_in_required','Not sent. The team connection is unavailable.');
 const viewRequest=new AbortController(),signal=AbortSignal.any([scope.signal,viewRequest.signal]);
 const leave=()=>{if(!scope.isCurrent())viewRequest.abort();};
 window.addEventListener('hashchange',leave);
 try{
  const current=()=>!signal.aborted&&scope.isCurrent();
  if(!current())return notSent('invalid_request','Not sent. The reviewed invitation workspace changed.');
  const {data,error}=await supabase.auth.getSession();
  // The suite broker is asynchronous. Recheck the originating account/view after
  // it replies, then pin this actor's token so the SDK cannot borrow a later one.
  if(!current())return notSent('invalid_request','Not sent. The reviewed invitation workspace changed.');
  if(error||!data.session?.access_token||data.session.user.id!==scope.actorId)return notSent('sign_in_required','Not sent. The signed-in account changed. Review again before sending.');
  const result=await supabase.functions.invoke('team-invitations',{body:payload,timeout:60000,signal,headers:{Authorization:`Bearer ${data.session.access_token}`}});
  if(!result.error)return classifyInvitationResponse(payload.id,result.data,result.response?.status??null,false);
  const response=result.error.context instanceof Response?result.error.context:null;
  const body=response?await response.json().catch(()=>null):null;
  return classifyInvitationResponse(payload.id,body,response?.status??null,true);
 }catch{return review();}
 finally{window.removeEventListener('hashchange',leave);}
}
