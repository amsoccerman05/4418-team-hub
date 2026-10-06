import {useEffect,useRef,useState} from 'react';
import {X,CheckCircle2} from 'lucide-react';
import type {OutreachContext,OutreachEntity,SavePayload,SaveResult} from './types';
import {outreachService} from './service';
import {errorMessage,OutreachError,requestScope,type OutreachScope} from './request-scope';
import {money,stages,today} from './model';
import {buildOutreachPayload,canOpenEditor} from './editor-payload';

export type EditorConfig={entity:OutreachEntity|'income_link';initial:SavePayload;title:string};
export function OutreachEditor({config,context,scope,onClose,onSaved,onAccessChanged}:{config:EditorConfig;context:OutreachContext;scope:OutreachScope;onClose:()=>void;onSaved:(result:SaveResult)=>void;onAccessChanged:()=>void}) {
  const {entity,initial}=config,dialog=useRef<HTMLDialogElement>(null),active=useRef(false),busyRef=useRef(false),requests=useRef(new Set<AbortController>());
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState<string|null>(null),[conflict,setConflict]=useState(false),[checking,setChecking]=useState(false);
  const [kind,setKind]=useState(String(initial.kind||'cash')),[status,setStatus]=useState(String(initial.status||'promised'));
  useEffect(()=>{active.current=true;dialog.current?.showModal();return()=>{active.current=false;for(const request of requests.current)request.abort();dialog.current?.close();};},[]);
  const dismiss=()=>{active.current=false;for(const request of requests.current)request.abort();onClose();};
  const current=()=>active.current&&scope.isCurrent()&&!scope.signal.aborted;
  const makeScope=()=>{const request=requestScope(scope.actorId,scope.signal,current);requests.current.add(request.controller);return request;};
  const text=(key:string,fallback='')=>String(initial[key]??fallback);
  const unavailableOwner=!!initial.owner_id&&!context.owners.some(owner=>owner.id===initial.owner_id);
  const owners=<>{unavailableOwner&&<option value="__unavailable__" disabled>Owner unavailable · choose an owner or Unassigned</option>}<option value="">Unassigned</option>{context.owners.map(owner=><option key={owner.id} value={owner.id}>{owner.name}</option>)}</>;
  const save=async(form:HTMLFormElement)=>{
    if(busyRef.current||uncertain||conflict||!current())return;
    if(!canOpenEditor(context,entity,initial)){setError('This record is read-only for your account. Close the form and reload.');setConflict(true);return;}
    const ownerControl=form.elements.namedItem('owner_id') as HTMLSelectElement|null;
    if(ownerControl?.value==='__unavailable__'){setError('Choose a current owner or explicitly select Unassigned before saving.');return;}
    busyRef.current=true;setBusy(true);setError('');const operationId=crypto.randomUUID(),request=makeScope(),f=new FormData(form);
    const value=(name:string)=>String(f.get(name)||'').trim(),nullable=(name:string)=>value(name)||null;
    try {
      let result:SaveResult;
      if(entity==='income_link')result=await outreachService.linkIncome(text('pledge_id'),value('income_id'),operationId,request.scope);
      else {
        const fields=Object.fromEntries(Array.from(f.entries()).map(([key,value])=>[key,String(value)]));
        result=await outreachService.save(entity,buildOutreachPayload(entity,initial,context,fields),operationId,request.scope);
      }
      if(current())onSaved(result);
    } catch(e) {
      if(!current())return;
      if(e instanceof OutreachError&&e.kind==='denied'){active.current=false;onAccessChanged();return;}
      setError(errorMessage(e));
      if(e instanceof OutreachError&&e.kind==='uncertain')setUncertain(operationId);
      if(e instanceof OutreachError&&(e.kind==='conflict'||e.kind==='denied'||e.kind==='unavailable'))setConflict(true);
    } finally {requests.current.delete(request.controller);if(current()){busyRef.current=false;setBusy(false);}}
  };
  const check=async(cancel=false)=>{
    if(!uncertain||busyRef.current||!current())return;busyRef.current=true;setChecking(true);const request=makeScope();
    try {const result=await (cancel?outreachService.cancel:outreachService.status)(uncertain,request.scope);if(!current())return;if(result.status==='applied')onSaved(result.result);else if(result.status==='canceled')dismiss();else setError('No completed save was found yet. It may still finish. Check again or cancel the unconfirmed change before entering it again.');}
    catch(e){if(current())setError(errorMessage(e));}
    finally {requests.current.delete(request.controller);if(current()){busyRef.current=false;setChecking(false);}}
  };
  const engagement=context.engagements.find(e=>e.id===initial.engagement_id);
  const contacts=context.contacts.filter(c=>c.active&&c.organization_id===engagement?.organization_id);
  const candidates=context.income.filter(i=>i.status!=='canceled'&&!context.income_links.some(l=>l.income_id===i.id));
  const disabled=busy||checking||!!uncertain||conflict;
  return <dialog className="outreach-dialog" ref={dialog} aria-labelledby="outreach-editor-title" onCancel={event=>{event.preventDefault();dismiss();}}>
    <div className="outreach-dialog-heading"><div><span className="outreach-eyebrow">Private team record</span><h2 id="outreach-editor-title">{config.title}</h2></div><button type="button" className="outreach-icon-button" aria-label="Close form" onClick={dismiss}><X size={20}/></button></div>
    <form onSubmit={e=>{e.preventDefault();void save(e.currentTarget);}}>
      <fieldset disabled={disabled}>
      {(entity==='organization'||entity==='prospect')&&<>
        <div className="outreach-field"><label htmlFor="outreach-kind">Profile type</label><select id="outreach-kind" name="kind" defaultValue={text('kind','organization')}><option value="organization">Organization</option><option value="person">Individual sponsor</option></select></div>
        <label>Name<input name="name" required maxLength={150} defaultValue={text('name')} autoComplete="off"/></label>
        <div className="outreach-field"><label htmlFor="outreach-website">Website</label><input id="outreach-website" name="website" type="url" placeholder="https://example.org" pattern="https://.*" maxLength={500} defaultValue={text('website')} aria-describedby="outreach-website-help"/><small id="outreach-website-help">Use a public HTTPS website.</small></div>
        {context.can_manage&&entity==='organization'&&<label>Profile notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={text('notes')}/></label>}{entity==='prospect'&&<><label>Next follow-up<input name="next_follow_up_on" type="date" defaultValue={text('next_follow_up_on')}/></label><p className="outreach-form-note">This creates a prospect assigned to you for the selected season. Check the shared sponsor list first to avoid duplicate outreach.</p></>}
      </>}
      {entity==='contact'&&<>
        <label>Contact name<input name="name" required maxLength={150} defaultValue={text('name')} autoComplete="off"/></label>
        <label>Title or role<input name="title" maxLength={150} defaultValue={text('title')}/></label>
        <div className="outreach-form-pair"><label>Email<input name="email" type="email" maxLength={254} defaultValue={text('email')} autoComplete="off"/></label><label>Phone<input name="phone" type="tel" maxLength={80} defaultValue={text('phone')} autoComplete="off"/></label></div>
        {context.can_manage&&<label>Contact notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={text('notes')}/></label>}
        <p className="outreach-form-note">Business contact details are visible to the team for outreach coordination.</p>
      </>}
      {entity==='engagement'&&<>
        <div className="outreach-form-pair"><div className="outreach-field"><label htmlFor="outreach-stage">Relationship stage</label><select id="outreach-stage" name="stage" defaultValue={text('stage','prospect')}>{Object.entries(stages).filter(([key])=>context.can_manage||key!=='committed'||initial.stage==='committed').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>{context.can_manage&&<div className="outreach-field"><label htmlFor="outreach-owner_id">Relationship owner</label><select id="outreach-owner_id" name="owner_id" defaultValue={unavailableOwner?'__unavailable__':text('owner_id')}>{owners}</select></div>}</div>
        <label>Next follow-up<input name="next_follow_up_on" type="date" defaultValue={text('next_follow_up_on')}/></label>
        {context.can_manage&&<label>Season notes<textarea name="notes" rows={4} maxLength={4000} defaultValue={text('notes')}/></label>}{!context.can_manage&&<p className="outreach-form-note">Assignments and private relationship notes are managed by mentors and admins.</p>}
      </>}
      {entity==='conversation'&&<>
        <div className="outreach-form-pair"><label>Date<input name="occurred_on" type="date" max={today()} required defaultValue={text('occurred_on',today())}/></label><div className="outreach-field"><label htmlFor="outreach-channel">Channel</label><select id="outreach-channel" name="channel" defaultValue={text('channel','email')}><option value="email">Email</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="other">Other</option></select></div></div>
        <div className="outreach-field"><label htmlFor="outreach-contact_id">Contact</label><select id="outreach-contact_id" name="contact_id" defaultValue={text('contact_id')}><option value="">General conversation</option>{contacts.map(contact=><option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></div>
        <label>Conversation summary<textarea name="summary" rows={5} required maxLength={4000} defaultValue={text('summary')} placeholder="What was discussed, what was agreed, and what happens next?"/></label>
        <p className="outreach-form-note">Record an email or conversation that already happened. This form does not send an email. Its details are visible to you, mentors, and admins; teammates see who contacted the sponsor, when, and by which channel. Add a follow-up note to correct an earlier entry.</p>
      </>}
      {entity==='pledge'&&<>
        <div className="outreach-form-pair"><div className="outreach-field"><label htmlFor="outreach-kind">Commitment type</label><select id="outreach-kind" name="kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="cash">Cash pledge</option><option value="in_kind">In-kind support</option></select></div>{kind==='cash'&&<label>Pledged amount (USD)<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={text('amount')}/></label>}</div>
        <label>Description<textarea name="description" required rows={3} maxLength={2000} defaultValue={text('description')}/></label>
        <div className="outreach-form-pair"><label>Promised on<input name="promised_on" type="date" required defaultValue={text('promised_on',today())}/></label><label>Expected on<input name="expected_on" type="date" defaultValue={text('expected_on')}/></label></div>
        <div className="outreach-field"><label htmlFor="outreach-status">Commitment status</label><select id="outreach-status" name="status" defaultValue={text('status','pledged')}><option value="pledged">Pledged</option><option value="canceled">Canceled</option></select></div>
        <p className="outreach-form-note">Received funds are recorded in Finance. Saving a pledge does not record a receipt.</p>
      </>}
      {entity==='recognition'&&<>
        <div className="outreach-field"><label htmlFor="outreach-kind">Promise type</label><select id="outreach-kind" name="kind" defaultValue={text('kind','recognition')}><option value="logo">Logo placement</option><option value="recognition">Recognition</option><option value="thank_you">Thank-you</option><option value="other">Other</option></select></div>
        <label>What was promised?<textarea name="description" rows={3} required maxLength={2000} defaultValue={text('description')}/></label>
        <div className="outreach-form-pair"><div className="outreach-field"><label htmlFor="outreach-owner_id">Promise owner</label><select id="outreach-owner_id" name="owner_id" defaultValue={unavailableOwner?'__unavailable__':text('owner_id')}>{owners}</select></div><label>Due date<input name="due_on" type="date" defaultValue={text('due_on')}/></label></div>
        <div className="outreach-field"><label htmlFor="outreach-pledge_id">Related commitment</label><select id="outreach-pledge_id" name="pledge_id" defaultValue={text('pledge_id')}><option value="">Relationship overall</option>{context.pledges.filter(p=>p.engagement_id===initial.engagement_id).map(p=><option key={p.id} value={p.id}>{p.description}</option>)}</select></div>
        <div className="outreach-field"><label htmlFor="outreach-status">Fulfillment status</label><select id="outreach-status" name="status" value={status} onChange={e=>setStatus(e.target.value)}><option value="promised">Promised</option><option value="fulfilled">Fulfilled</option><option value="waived">Waived</option></select></div>
        {status==='fulfilled'&&<label>Fulfilled on<input name="fulfilled_on" type="date" required defaultValue={text('fulfilled_on',today())}/></label>}
        <label>Fulfillment notes<textarea name="fulfillment_note" rows={2} maxLength={2000} defaultValue={text('fulfillment_note')}/></label>
      </>}
      {entity==='income_link'&&<>
        <p className="outreach-form-note">Link an existing Finance income record to this cash pledge. The amount, receipt status, and dates remain managed in Finance.</p>
        <div className="outreach-field"><label htmlFor="outreach-income_id">Finance income record</label><select id="outreach-income_id" name="income_id" required defaultValue=""><option value="">Choose an existing record</option>{candidates.map(income=><option key={income.id} value={income.id}>{income.source} · {money(income.amount)} · {income.status}{income.reference?` · ${income.reference}`:''}</option>)}</select></div>
        {!candidates.length&&<p>No unlinked income records are available in this season.</p>}
      </>}
      </fieldset>
      {error&&<div className="outreach-error" role="alert"><p>{error}</p>{uncertain&&<><button type="button" className="outreach-button" disabled={checking} onClick={()=>void check()}>{checking?'Checking…':'Check save status'}</button><button type="button" className="outreach-button" disabled={checking} onClick={()=>void check(true)}>Cancel unconfirmed change</button><p>Cancel prevents a change that has not saved yet. If it already saved, the current record will be shown.</p></>}</div>}
      {busy&&<p role="status" className="outreach-form-note">Saving… If you close now, the save may still finish. Reload the profile before making the same change again.</p>}
      <div className="outreach-dialog-actions"><button type="button" className="outreach-button" onClick={dismiss}>{uncertain||conflict?'Close and review':'Cancel'}</button><button className="outreach-button primary" disabled={disabled||(entity==='income_link'&&!candidates.length)}>{busy?'Saving…':<><CheckCircle2 size={16}/>{entity==='income_link'?'Link record':'Save record'}</>}</button></div>
    </form>
  </dialog>;
}
