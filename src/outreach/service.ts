import type {SupabaseClient} from '@supabase/supabase-js';
import {supabase} from '../attendance/service';
import {parseContext,parseSaveResult,parseRequestStatus} from './model';
import {OutreachError,assertCurrent,type OutreachScope} from './request-scope';
import type {OutreachEntity,SavePayload} from './types';
import {pendingReceipts,rememberReceipt,settleReceipt,type PendingReceipt} from './receipts';

/** A small injectable transport also lets local tests exercise broker races. */
export function createOutreachService(client:Pick<SupabaseClient,'auth'|'rpc'>|null,timeoutMs=15000) {
  async function rpc(name:string,args:Record<string,unknown>,scope:OutreachScope,receipt?:PendingReceipt,cancel=false):Promise<unknown> {
    const mutation=!!receipt||cancel;
    const abandoned=new AbortController(), timeout=new AbortController();
    const signal=AbortSignal.any([scope.signal,abandoned.signal,timeout.signal]);
    const live={...scope,signal};
    const timer=setTimeout(()=>timeout.abort(),timeoutMs);
    let dispatched=false;
    const leave=()=>{if(!scope.isCurrent())abandoned.abort();};
    const subscription=client?.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==scope.actorId)abandoned.abort();}).data.subscription;
    if(typeof window!=='undefined')window.addEventListener('hashchange',leave);
    try {
      assertCurrent(live);
      if(!client)throw new OutreachError('unavailable','Sponsor & Outreach is not configured yet.');
      const {data,error}=await client.auth.getSession();
      assertCurrent(live);
      if(error||!data.session?.access_token||data.session.user.id!==scope.actorId)throw new OutreachError('denied','Your account changed. Reopen this workspace.');
      // Pin the reviewed actor even if the shared SSO broker waits again. The
      // abort signal remains live through that second wait and the response.
      const request=client.rpc(name,args).setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(signal).retry(false);
      if(receipt){if(pendingReceipts(scope.actorId).length)throw new OutreachError('rejected','A previous save still needs checking. Close this form and check its status.');rememberReceipt(receipt);}
      dispatched=true;
      const result=await request;
      assertCurrent(live);
      if(result.error) {
        if(receipt&&((result.status>=400&&result.status<500&&result.status!==408)||/^(22|23|40|42|P0)/.test(result.error.code)))settleReceipt(scope.actorId,receipt.requestId);
        if(result.error.code==='42501'||result.status===401||result.status===403)throw new OutreachError('denied','Your access to this record may have changed. Close the form and reload the workspace.');
        if(result.error.code==='40001')throw new OutreachError('conflict','This record changed since you opened it. Close this form and reload before editing again.');
        if(result.error.code==='PGRST202'||result.error.code==='42883')throw new OutreachError('unavailable','Sponsor & Outreach is not available on this connection yet.');
        if(result.status>=400&&result.status<500&&result.status!==408)throw new OutreachError('rejected','The change was rejected. Check the fields, or close this form and reload the latest records.');
        throw new OutreachError(mutation?'uncertain':'unavailable',mutation?'We could not confirm whether this change saved. Check its status before entering it again.':'Unable to load the workspace. Try Reload.');
      }
      return result.data;
    } catch(error) {
      if(scope.signal.aborted||abandoned.signal.aborted||!scope.isCurrent())throw new OutreachError('abandoned','This view has changed.');
      if(timeout.signal.aborted)throw new OutreachError(mutation&&dispatched?'uncertain':'unavailable',mutation&&dispatched?'The save timed out. Its outcome is not confirmed; check the save status.':'Loading timed out. Try Reload.');
      if(error instanceof OutreachError)throw error;
      throw new OutreachError(mutation&&dispatched?'uncertain':'unavailable',mutation&&dispatched?'We could not confirm whether this change saved. Check its status before entering it again.':'Unable to connect. Try Reload.');
    } finally {
      clearTimeout(timer);subscription?.unsubscribe();
      if(typeof window!=='undefined')window.removeEventListener('hashchange',leave);
    }
  }
  async function reconcile(name:'outreach_request_status'|'outreach_cancel_request',requestId:string,scope:OutreachScope) {
    const result=parseRequestStatus(await rpc(name,{request_id:requestId,expected_actor:scope.actorId},scope,undefined,name==='outreach_cancel_request'));
    if(!result||(name==='outreach_cancel_request'&&result.status==='not_found'))throw new OutreachError('invalid','The save status could not be verified. Keep the original request for review.');
    const receipt=pendingReceipts(scope.actorId).find(r=>r.requestId===requestId);
    if(!receipt)throw new OutreachError('invalid','This request is not awaiting confirmation for the current account.');
    if(result.status==='applied'){
      if(result.result.version!==receipt.expectedVersion||(receipt.operation!=='income_link'&&result.result.id!==receipt.entityId))throw new OutreachError('invalid','The saved record could not be matched to this request. Keep the original request for review.');
      settleReceipt(scope.actorId,requestId);
    }
    if(result.status==='canceled')settleReceipt(scope.actorId,requestId);
    return result;
  }
  return {
    async load(selectedSeason:string|null,scope:OutreachScope) {
      const result=parseContext(await rpc('outreach_context',{selected_season:selectedSeason},scope),scope.actorId);
      if(!result)throw new OutreachError('invalid','The workspace response could not be verified. Private records are hidden. Try Reload.');
      if(selectedSeason&&result.season_id!==selectedSeason)throw new OutreachError('invalid','The selected season could not be verified. Try Reload.');
      return result;
    },
    async save(entity:OutreachEntity,p:SavePayload,requestId:string,scope:OutreachScope) {
      const result=parseSaveResult(await rpc('outreach_save',{entity,p,request_id:requestId,expected_actor:scope.actorId},scope,{actorId:scope.actorId,requestId,entityId:p.id,operation:entity,expectedVersion:p.version+1}),p.id);
      if(!result||result.version!==p.version+1)throw new OutreachError('uncertain','The save response could not be verified. Check its status before entering it again.');
      settleReceipt(scope.actorId,requestId);
      return result;
    },
    async linkIncome(pledgeId:string,incomeId:string,requestId:string,scope:OutreachScope) {
      const result=parseSaveResult(await rpc('outreach_link_income',{pledge_id:pledgeId,income_id:incomeId,request_id:requestId,expected_actor:scope.actorId},scope,{actorId:scope.actorId,requestId,entityId:pledgeId,operation:'income_link',expectedVersion:1}));
      if(!result||result.version!==1)throw new OutreachError('uncertain','The Finance link could not be confirmed. Check its status before linking again.');
      settleReceipt(scope.actorId,requestId);
      return result;
    },
    status:(requestId:string,scope:OutreachScope)=>reconcile('outreach_request_status',requestId,scope),
    cancel:(requestId:string,scope:OutreachScope)=>reconcile('outreach_cancel_request',requestId,scope),
  };
}
export const outreachService=createOutreachService(supabase);
