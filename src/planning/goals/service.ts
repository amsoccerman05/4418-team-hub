import type {SupabaseClient} from '@supabase/supabase-js';
import {supabase} from '../../attendance/service';
import type {GoalsContext,GoalSavePayload,GoalUpdatePayload,GoalOperationReceipt} from './types';
import {assertContext,uuid} from './model';
import type {PendingGoalOperation} from './session';

export class GoalServiceError extends Error {constructor(message:string,readonly outcome:'rejected'|'unknown'='rejected'){super(message);}}
export function assertReceipt(value:GoalOperationReceipt,operationId:string):GoalOperationReceipt{
 if(!value||value.operation_id!==operationId||!['committed','cancelled','not_found'].includes(value.status)||value.status==='committed'&&(!value.result||!uuid.test(value.result.goal_id)||!Number.isSafeInteger(value.result.version)||value.result.version<1||value.result.update_id!==null&&!uuid.test(value.result.update_id))||value.status!=='committed'&&value.result!==null)throw new GoalServiceError('The save result could not be verified. Check its status before trying again.','unknown');
 return value;
}
export function assertReceiptMatches(value:GoalOperationReceipt,expected:PendingGoalOperation){assertReceipt(value,expected.operationId);if(value.status==='committed'&&(value.result.goal_id!==expected.goalId||value.result.version!==expected.expectedVersion+1||value.result.update_id!==expected.updateId))throw new GoalServiceError('The save result does not match this request. Keep the pending receipt and check again.','unknown');return value;}
async function currentSession(client:SupabaseClient,signal:AbortSignal){
 let cancel:()=>void=()=>{};
 try{return await Promise.race([client.auth.getSession(),new Promise<never>((_,reject)=>{cancel=()=>reject(new GoalServiceError('Your session changed. Reopen Season Goals before saving.'));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]);}finally{signal.removeEventListener('abort',cancel);}
}
async function request<T>(name:string,args:Record<string,unknown>,actorId:string,signal:AbortSignal,write:boolean,client:SupabaseClient|null,isCurrent:()=>boolean):Promise<T>{
 if(!client)throw new GoalServiceError('Team connection unavailable.');
 if(signal.aborted||!isCurrent())throw new GoalServiceError('The request was closed.');
 const abandoned=new AbortController(),timeout=AbortSignal.any([signal,abandoned.signal,AbortSignal.timeout(15000)]);
 const leave=()=>{if(!isCurrent())abandoned.abort();};
 const subscription=client.auth.onAuthStateChange((_event,next)=>{if(next?.user.id!==actorId)abandoned.abort();}).data.subscription;
 if(typeof window!=='undefined')window.addEventListener('hashchange',leave);
 try{
  const {data:auth,error:authError}=await currentSession(client,timeout);
  if(timeout.aborted||!isCurrent()||authError||auth.session?.user.id!==actorId||!auth.session.access_token)throw new GoalServiceError('Your session changed. Reopen Season Goals before saving.');
  // Pin the checked actor's token. The SDK performs another lazy token lookup;
  // this header cannot be replaced if an account changes during that await.
  const result=await client.rpc(name,args).setHeader('Authorization',`Bearer ${auth.session.access_token}`).retry(false).abortSignal(timeout);
  if(timeout.aborted||!isCurrent())throw new GoalServiceError('This view changed before the result could be confirmed.',write?'unknown':'rejected');
  if(result.error){const rejected=!!result.error.code&&![408,429].includes(result.status)&&(result.status>=400&&result.status<500||/^(22|23|40|42|P0)/.test(result.error.code));const message=result.error.code==='40001'?'Another teammate updated this goal. Close the dialog and refresh before saving.':result.error.code==='42501'?'Your access to this goal may have changed. Close the dialog and refresh the workspace.':result.error.message;throw new GoalServiceError(rejected?message:'The connection ended before the result could be confirmed.',write&&!rejected?'unknown':'rejected');}
  return result.data as T;
 }catch(error){if(error instanceof GoalServiceError)throw error;throw new GoalServiceError(write?'The connection ended before the save could be confirmed.':'Season goals could not be loaded. Refresh to try again.',write?'unknown':'rejected');}finally{subscription.unsubscribe();if(typeof window!=='undefined')window.removeEventListener('hashchange',leave);}
}
export async function loadGoals(actorId:string,seasonId:string,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){
 return assertContext(await request<GoalsContext>('planning_goals_context',{selected_season:seasonId},actorId,signal,false,client,isCurrent),actorId,seasonId);
}
export async function saveGoal(actorId:string,p:GoalSavePayload,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){return assertReceipt(await request<GoalOperationReceipt>('planning_goal_save',{p,expected_actor:actorId},actorId,signal,true,client,isCurrent),p.operation_id);}
export async function saveGoalUpdate(actorId:string,p:GoalUpdatePayload,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){return assertReceipt(await request<GoalOperationReceipt>('planning_goal_update',{p,expected_actor:actorId},actorId,signal,true,client,isCurrent),p.operation_id);}
export async function reconcileGoal(actorId:string,operationId:string,cancel:boolean,signal:AbortSignal,client:SupabaseClient|null=supabase,isCurrent:()=>boolean=()=>true){return assertReceipt(await request<GoalOperationReceipt>(cancel?'planning_goal_operation_cancel':'planning_goal_operation_status',{operation_id:operationId,expected_actor:actorId},actorId,signal,cancel,client,isCurrent),operationId);}
