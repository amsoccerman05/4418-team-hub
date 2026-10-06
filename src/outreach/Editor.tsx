import {useEffect,useRef,useState} from 'react';
import {X,CheckCircle2} from 'lucide-react';
import type {OutreachContext,OutreachEntity,SavePayload,SaveResult} from './types';
import {outreachService} from './service';
import {errorMessage,OutreachError,requestScope,type OutreachScope} from './request-scope';
import {money,stages,today} from './model';

export type EditorConfig={entity:OutreachEntity|'income_link';initial:SavePayload;title:string};
export function OutreachEditor({config,context,scope,onClose,onSaved}:{config:EditorConfig;context:OutreachContext;scope:OutreachScope;onClose:()=>void;onSaved:(result:SaveResult)=>void}) {
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
    const ownerControl=form.elements.namedItem('owner_id') as HTMLSelectElement|null;
    if(ownerControl?.value==='__unavailable__'){setError('Choose a current owner or explicitly select Unassigned before saving.');return;}
    busyRef.current=true;setBusy(true);setError('');const operationId=crypto.randomUUID(),request=makeScope(),f=new FormData(form);
    const value=(name:string)=>String(f.get(name)||'').trim(),nullable=(name:string)=>value(name)||null;
    try {
      let result:SaveResult;
      if(entity==='income_link')result=await outreachService.linkIncome(text('pledge_id'),value('income_id'),operationId,request.scope);
      else {
        let values:Record<string,unknown>={};
        if(entity==='organization')values={kind:value('kind'),name:value('name'),website:value('website'),notes:value('notes'),active:initial.active??true};
        if(entity==='contact')values={organization_id:initial.organization_id,name:value('name'),title:value('title'),email:value('email'),phone:value('phone'),notes:value('notes'),active:initial.active??true};
        if(entity==='engagement')values={organization_id:initial.organization_id,season_id:context.season_id,stage:value('stage'),owner_id:nullable('owner_id'),next_follow_up_on:nullable('next_follow_up_on'),notes:value('notes')};
        if(entity==='conversation')values={engagement_id:initial.engagement_id,contact_id:nullable('contact_id'),occurred_on:value('occurred_on'),channel:value('channel'),summary:value('summary')};
        if(entity==='pledge')values={engagement_id:initial.engagement_id,kind:value('kind'),amount:value('kind')==='cash'?Number(value('amount')):null,description:value('description'),promised_on:value('promised_on'),expected_on:nullable('expected_on'),status:value('status')};
        if(entity==='recognition')values={engagement_id:initial.engagement_id,pledge_id:nullable('pledge_id'),owner_id:nullable('owner_id'),kind:value('kind'),description:value('description'),due_on:nullable('due_on'),status:value('status'),fulfilled_on:value('status')==='fulfilled'?nullable('fulfilled_on'):null,fulfillment_note:value('fulfillment_note')};
        result=await outreachService.save(entity,{id:initial.id,version:initial.version,...values},operationId,request.scope);
      }
      if(current())onSaved(result);
    } catch(e) {
      if(!current())return;
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
      {entity==='organization'&&<>
        <label>Profile type<select name="kind" defaultValue={text('kind','organization')}><option value="organization">Organization</option><option value="person">Individual sponsor</option></select></label>
        <label>Name<input name="name" required maxLength={150} defaultValue={text('name')} autoComplete="off"/></label>
        <label>Website<input name="website" type="url" placeholder="https://example.org" pattern="https://.*" maxLength={500} defaultValue={text('website')}/><small>Use a public HTTPS website.</small></label>
        <label>Profile notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={text('notes')}/></label>
      </>}
      {entity==='contact'&&<>
        <label>Contact name<input name="name" required maxLength={150} defaultValue={text('name')} autoComplete="off"/></label>
        <label>Title or role<input name="title" maxLength={150} defaultValue={text('title')}/></label>
        <div className="outreach-form-pair"><label>Email<input name="email" type="email" maxLength={254} defaultValue={text('email')} autoComplete="off"/></label><label>Phone<input name="phone" type="tel" maxLength={80} defaultValue={text('phone')} autoComplete="off"/></label></div>
        <label>Contact notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={text('notes')}/></label>
        <p className="outreach-form-note">Store only the contact details your team needs for this relationship.</p>
      </>}
      {entity==='engagement'&&<>
        <div className="outreach-form-pair"><label>Relationship stage<select name="stage" defaultValue={text('stage','prospect')}>{Object.entries(stages).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Relationship owner<select name="owner_id" defaultValue={unavailableOwner?'__unavailable__':text('owner_id')}>{owners}</select></label></div>
        <label>Next follow-up<input name="next_follow_up_on" type="date" defaultValue={text('next_follow_up_on')}/></label>
        <label>Season notes<textarea name="notes" rows={4} maxLength={4000} defaultValue={text('notes')}/></label>
      </>}
      {entity==='conversation'&&<>
        <div className="outreach-form-pair"><label>Date<input name="occurred_on" type="date" required defaultValue={text('occurred_on',today())}/></label><label>Channel<select name="channel" defaultValue={text('channel','email')}><option value="email">Email</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="other">Other</option></select></label></div>
        <label>Contact<select name="contact_id" defaultValue={text('contact_id')}><option value="">General conversation</option>{contacts.map(contact=><option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
        <label>Conversation summary<textarea name="summary" rows={5} required maxLength={4000} defaultValue={text('summary')} placeholder="What was discussed, what was agreed, and what happens next?"/></label>
        <p className="outreach-form-note">This adds a dated note to the history. To correct a previous note, add a follow-up note.</p>
      </>}
      {entity==='pledge'&&<>
        <div className="outreach-form-pair"><label>Commitment type<select name="kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="cash">Cash pledge</option><option value="in_kind">In-kind support</option></select></label>{kind==='cash'&&<label>Pledged amount (USD)<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={text('amount')}/></label>}</div>
        <label>Description<textarea name="description" required rows={3} maxLength={2000} defaultValue={text('description')}/></label>
        <div className="outreach-form-pair"><label>Promised on<input name="promised_on" type="date" required defaultValue={text('promised_on',today())}/></label><label>Expected on<input name="expected_on" type="date" defaultValue={text('expected_on')}/></label></div>
        <label>Commitment status<select name="status" defaultValue={text('status','pledged')}><option value="pledged">Pledged</option><option value="canceled">Canceled</option></select></label>
        <p className="outreach-form-note">Received funds are recorded in Finance. Saving a pledge does not record a receipt.</p>
      </>}
      {entity==='recognition'&&<>
        <label>Promise type<select name="kind" defaultValue={text('kind','recognition')}><option value="logo">Logo placement</option><option value="recognition">Recognition</option><option value="thank_you">Thank-you</option><option value="other">Other</option></select></label>
        <label>What was promised?<textarea name="description" rows={3} required maxLength={2000} defaultValue={text('description')}/></label>
        <div className="outreach-form-pair"><label>Promise owner<select name="owner_id" defaultValue={unavailableOwner?'__unavailable__':text('owner_id')}>{owners}</select></label><label>Due date<input name="due_on" type="date" defaultValue={text('due_on')}/></label></div>
        <label>Related commitment<select name="pledge_id" defaultValue={text('pledge_id')}><option value="">Relationship overall</option>{context.pledges.filter(p=>p.engagement_id===initial.engagement_id).map(p=><option key={p.id} value={p.id}>{p.description}</option>)}</select></label>
        <label>Fulfillment status<select name="status" value={status} onChange={e=>setStatus(e.target.value)}><option value="promised">Promised</option><option value="fulfilled">Fulfilled</option><option value="waived">Waived</option></select></label>
        {status==='fulfilled'&&<label>Fulfilled on<input name="fulfilled_on" type="date" required defaultValue={text('fulfilled_on',today())}/></label>}
        <label>Fulfillment notes<textarea name="fulfillment_note" rows={2} maxLength={2000} defaultValue={text('fulfillment_note')}/></label>
      </>}
      {entity==='income_link'&&<>
        <p className="outreach-form-note">Link an existing Finance income record to this cash pledge. The amount, receipt status, and dates remain managed in Finance.</p>
        <label>Finance income record<select name="income_id" required defaultValue=""><option value="">Choose an existing record</option>{candidates.map(income=><option key={income.id} value={income.id}>{income.source} · {money(income.amount)} · {income.status}{income.reference?` · ${income.reference}`:''}</option>)}</select></label>
        {!candidates.length&&<p>No unlinked income records are available in this season.</p>}
      </>}
      </fieldset>
      {error&&<div className="outreach-error" role="alert"><p>{error}</p>{uncertain&&<><button type="button" className="outreach-button" disabled={checking} onClick={()=>void check()}>{checking?'Checking…':'Check save status'}</button><button type="button" className="outreach-button" disabled={checking} onClick={()=>void check(true)}>Cancel unconfirmed change</button><p>Cancel prevents a change that has not saved yet. If it already saved, the current record will be shown.</p></>}</div>}
      {busy&&<p role="status" className="outreach-form-note">Saving… If you close now, the save may still finish. Reload the profile before making the same change again.</p>}
      <div className="outreach-dialog-actions"><button type="button" className="outreach-button" onClick={dismiss}>{uncertain||conflict?'Close and review':'Cancel'}</button><button className="outreach-button primary" disabled={disabled||(entity==='income_link'&&!candidates.length)}>{busy?'Saving…':<><CheckCircle2 size={16}/>{entity==='income_link'?'Link record':'Save record'}</>}</button></div>
    </form>
  </dialog>;
}
