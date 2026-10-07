import {useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, HeartHandshake, Mail, Plus, ShieldCheck, Utensils, Users, X} from 'lucide-react';
import {mealApi} from './service';
import type {ClaimInput, ClaimReceipt, MealApi, MealCategory, MealSlot, PrivateClaim, PublicMeal} from './types';
import './meals.css';

type PrivateLink = {kind:'verify'|'manage'; token:string};
type Selection = {mealId:string; slotId:string|null};
const categories: {key:MealCategory; title:string}[] = [{key:'main',title:'Main dishes'},{key:'side',title:'Sides'},{key:'drink',title:'Drinks'},{key:'supply',title:'Supplies'},{key:'other',title:'Other help'}];

/** Capability links stay in memory. Never put them in query strings or storage. */
function parsePrivateFragment(hash:string): PrivateLink|null {
  const params = new URLSearchParams(hash.replace(/^#/,''));
  for (const key of ['verify','manage','edit'] as const) {
    const token = params.get(key);
    if (token) return {kind:key === 'verify' ? 'verify' : 'manage',token};
  }
  return null;
}
function readPrivateLink():PrivateLink|null { return typeof window==='undefined' ? null : parsePrivateFragment(window.location.hash); }
function removePrivateFragment() {
  if (/^(verify|manage|edit)=/.test(window.location.hash.slice(1)) || readPrivateLink()) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
}
function formatDate(meal:PublicMeal, options:Intl.DateTimeFormatOptions) {
  try { return new Intl.DateTimeFormat('en-US',{...options,timeZone:meal.timezone}).format(new Date(meal.service_at)); }
  catch { return 'Time to be confirmed'; }
}
function dateLine(meal:PublicMeal) { return formatDate(meal,{weekday:'long',month:'long',day:'numeric',year:'numeric'}); }
function timeLine(meal:PublicMeal) { return formatDate(meal,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}); }
function deadline(value:string|null,meal:PublicMeal) {
  if (!value) return null;
  try { return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:meal.timezone,timeZoneName:'short'}).format(new Date(value)); }
  catch { return null; }
}
const knownErrorCodes=new Set(['invalid_input','synthetic_email_required','meal_unavailable','coordination_required','capacity_changed','version_conflict','rate_limited','mail_unavailable','not_configured','invalid_configuration','invalid_link','temporarily_unavailable']);
function safeApiMessage(error:unknown,fallback:string){
  const value=error as {code?:string;status?:number;message?:string}|null;
  return value && knownErrorCodes.has(value.code ?? '') && typeof value.message==='string' && value.message.length<=500 ? value.message : fallback;
}
export function privateFailurePolicy(error:unknown):'clear_access'|'inspect_before_write' {
  const value=error as {code?:string;status?:number}|null;
  return value?.status===403 || value?.code==='invalid_link' ? 'clear_access' : 'inspect_before_write';
}
function definitelyRejected(error:unknown){
  const value=error as {code?:string}|null;
  return !!value && ['invalid_input','synthetic_email_required','meal_unavailable','coordination_required','capacity_changed','rate_limited','mail_unavailable','not_configured','invalid_configuration'].includes(value.code ?? '');
}
function requestKey() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function MealCard({meal,onChoose}:{meal:PublicMeal;onChoose:(selection:Selection,trigger:HTMLButtonElement)=>void}) {
  const open = meal.status === 'open';
  const needed = meal.slots.reduce((total,slot)=>total+slot.needed,0);
  const confirmed = meal.slots.reduce((total,slot)=>total+slot.confirmed,0);
  const held = meal.slots.reduce((total,slot)=>total+slot.held,0);
  const complete = meal.whole_meal === 'confirmed' || (needed > 0 && confirmed >= needed);
  return <article className="meal-card" aria-labelledby={`meal-${meal.id}`}>
    <header className="meal-card-heading">
      <div className="meal-date-tile" aria-hidden="true"><span>{formatDate(meal,{month:'short'})}</span><strong>{formatDate(meal,{day:'numeric'})}</strong><span>{formatDate(meal,{weekday:'short'})}</span></div>
      <div className="meal-card-title"><p className="meal-eyebrow">{dateLine(meal)}</p><h3 id={`meal-${meal.id}`}>{meal.title}</h3><div className="meal-meta"><span><Clock3 size={15}/>{timeLine(meal)}</span><span><Users size={15}/>{meal.expected_headcount} people</span></div><p className="meal-timezone">Time zone: {meal.timezone}</p></div>
      <span className={`meal-badge ${complete ? 'covered' : !open ? 'muted' : ''}`}>{meal.status === 'cancelled' ? 'Cancelled' : meal.status === 'closed' ? 'Signups closed' : complete ? 'Meal covered' : 'Help welcome'}</span>
    </header>
    {meal.guidance && <div className="meal-guidance"><ShieldCheck size={18}/><div><strong>Meal coordinator’s guidance</strong><p>{meal.guidance}</p></div></div>}
    <div className="meal-coverage-heading"><h4>What’s needed</h4><span>Confirmed <span className="meal-legend confirmed"/> · Awaiting email verification <span className="meal-legend held"/></span></div>
    <div className="meal-categories">
      {categories.filter(category=>category.key !== 'other' || meal.slots.some(slot=>slot.category === 'other')).map(category=><section className="meal-category" key={category.key} aria-label={category.title}><h5>{category.title}</h5>{meal.slots.filter(slot=>slot.category === category.key).length === 0 ? <p className="meal-no-items">No items requested</p> : meal.slots.filter(slot=>slot.category === category.key).map(slot=><SlotRow key={slot.id} slot={slot} disabled={!open || meal.whole_meal === 'held' || meal.whole_meal === 'confirmed'} onChoose={trigger=>onChoose({mealId:meal.id,slotId:slot.id},trigger)}/>)}</section>)}
    </div>
    <div className="meal-whole"><div><strong><Utensils size={17}/>Bring the whole meal</strong><p>{meal.whole_meal === 'confirmed' ? 'A complete meal is confirmed. Thank you!' : meal.whole_meal === 'held' ? 'A complete meal is awaiting email verification.' : meal.whole_meal === 'coordination_required' ? 'Other contributions are already planned. Please coordinate with the meal coordinator before offering a whole meal.' : `Cover the meal and listed supplies for all ${meal.expected_headcount} people.`}</p></div>{meal.whole_meal === 'available' && open && <button className="meal-button secondary" onClick={event=>onChoose({mealId:meal.id,slotId:null},event.currentTarget)}>I can bring it all <ArrowRight size={16}/></button>}</div>
    {held > 0 && <p className="meal-card-note">Pending contributions are temporarily held, but aren’t confirmed until verified by email.</p>}
  </article>;
}
function SlotRow({slot,disabled,onChoose}:{slot:MealSlot;disabled:boolean;onChoose:(trigger:HTMLButtonElement)=>void}) {
  const fraction = (quantity:number)=>slot.needed > 0 ? Math.max(0,Math.min(100,quantity/slot.needed*100)) : 0;
  return <div className="meal-slot"><div className="meal-slot-detail"><div className="meal-slot-label"><strong>{slot.label}</strong><span>{slot.confirmed} / {slot.needed} {slot.unit} confirmed</span></div><div className="meal-progress" aria-hidden="true"><span className="meal-progress-confirmed" style={{width:`${fraction(slot.confirmed)}%`}}/><span className="meal-progress-held" style={{width:`${Math.min(100-fraction(slot.confirmed),fraction(slot.held))}%`}}/></div><p>{slot.held > 0 && <>{slot.held} awaiting verification · </>}{slot.remaining > 0 ? `${slot.remaining} ${slot.unit} still needed` : slot.confirmed >= slot.needed ? 'Fully covered' : 'All remaining portions temporarily held'}</p></div><button className="meal-button slot-claim" disabled={disabled || slot.remaining <= 0} aria-label={`Sign up for ${slot.label}`} onClick={event=>onChoose(event.currentTarget)}>{slot.remaining <= 0 ? <Check size={17}/> : <Plus size={17}/>}<span>{slot.remaining <= 0 ? 'Covered / held' : 'Sign up'}</span></button></div>;
}

function ClaimDialog({meal,slot,api,draft,onClose,onRefresh}:{meal:PublicMeal;slot:MealSlot|null;api:MealApi;draft:boolean;onClose:()=>void;onRefresh:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const key = useRef(requestKey());
  const submitted = useRef<ClaimInput|null>(null);
  const [unresolved,setUnresolved]=useState(false);
  const [name,setName] = useState('');
  const [email,setEmail] = useState('');
  const [quantity,setQuantity] = useState('1');
  const [website,setWebsite] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [receipt,setReceipt] = useState<ClaimReceipt|null>(null);
  const unavailable = meal.status !== 'open' || (slot ? slot.remaining <= 0 || meal.whole_meal === 'held' || meal.whole_meal === 'confirmed' : meal.whole_meal !== 'available');
  useEffect(()=>{ alive.current=true; const element=dialog.current; element?.showModal(); nameInput.current?.focus(); return ()=>{alive.current=false;element?.close();}; },[]);
  useEffect(()=>{if(error) alert.current?.focus();},[error]);
  useEffect(()=>{if(receipt) receiptHeading.current?.focus();},[receipt]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(inFlight.current || receipt) return;
    const amount=slot ? Number(quantity) : 1;
    if(!unresolved && (unavailable || !Number.isInteger(amount) || amount < 1 || (slot && amount > slot.remaining))) {setError('Coverage has changed. Choose a quantity that is still needed, or close this form and choose another contribution.');return;}
    if(!name.trim() || !email.trim()) {setError('Enter your adult name and email address.');return;}
    inFlight.current=true;setBusy(true);setError('');
    const input:ClaimInput=submitted.current ?? {meal_id:meal.id,slot_id:slot?.id ?? null,whole_meal:!slot,quantity:amount,name:name.trim(),email:email.trim(),idempotency_key:key.current,website};
    submitted.current=input;
    try {const result=await api.claim(input);if(alive.current){setReceipt(result);onRefresh();}}
    catch (failure) {if(alive.current){
      if(definitelyRejected(failure)){submitted.current=null;key.current=requestKey();setUnresolved(false);setError(`${safeApiMessage(failure,'The request was not accepted.')} Your details are still here.`);}
      else{setUnresolved(true);setError('We couldn’t confirm whether your request was accepted. Your details are still here and are locked to prevent a duplicate. Retry the same request below, or use the verification email if it already arrived. Ask the meal coordinator for help before starting another signup.');}
      onRefresh();
    }}
    finally {if(alive.current){inFlight.current=false;setBusy(false);}}
  }
  const expires=receipt && deadline(receipt.hold_expires_at,meal);
  return <dialog ref={dialog} className="meal-dialog" aria-labelledby="meal-claim-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <button className="meal-icon-button meal-dialog-close" aria-label="Close signup" onClick={onClose}><X size={22}/></button>
    {receipt ? <div className="meal-receipt"><div className="meal-round-icon"><Mail size={27}/></div><p className="meal-eyebrow">Request received · Not yet confirmed</p><h2 id="meal-claim-title" ref={receiptHeading} tabIndex={-1}>{draft ? 'Preview request received' : receipt.email_status === 'unavailable' ? 'Email verification is unavailable' : receipt.email_status === 'uncertain' ? 'Email delivery is not yet known' : 'Next, verify your email'}</h2><p>{draft ? 'This is a local preview. No email was sent and no real meal signup was created.' : receipt.email_status === 'unavailable' ? 'Your contribution is not confirmed. Email delivery is currently unavailable. Please contact the meal coordinator before making plans.' : receipt.email_status === 'uncertain' ? 'Your request was received, but we can’t confirm whether the verification email was sent. Check your inbox and spam folder. If it arrives, use that link; otherwise, ask the meal coordinator for help before submitting again. Your contribution is not confirmed.' : `${receipt.email_status === 'sent' ? 'Your verification email was accepted for sending. This does not guarantee delivery.' : 'Your verification email is queued.'} Open its link and choose “Confirm my contribution” to finish signing up. A request receipt alone does not confirm your contribution.`}</p>{!draft && (receipt.email_status === 'queued' || receipt.email_status === 'sent') && <p className="meal-subtle">Check your inbox and spam folder. Delivery may take a few minutes. You can change or cancel through your private link.</p>}{expires && <p className="meal-notice">This temporary hold expires {expires}. Unverified contributions may become available again.</p>}<button className="meal-button primary" onClick={onClose}>Back to meal dates</button></div> : <form onSubmit={submit}><p className="meal-eyebrow">A little help goes a long way</p><h2 id="meal-claim-title">{slot ? `Bring ${slot.label.toLowerCase()}` : 'Bring the whole meal'}</h2><p className="meal-subtle">{dateLine(meal)} · {timeLine(meal)}<br/>{meal.title} · {meal.expected_headcount} people</p><p className="meal-form-intro">{slot ? 'Choose what you can bring. We’ll email a private link to confirm your contribution.' : 'You’re offering all the listed food and supplies. We’ll email a private link to confirm.'}</p>
      {error && <p ref={alert} tabIndex={-1} className="meal-error" role="alert">{error}</p>}
      {unavailable && <p className="meal-notice" role="status">This contribution is no longer available. Your entered details have been kept so you can review them before closing.</p>}
      <fieldset disabled={busy || unresolved}><legend className="meal-sr-only">Contribution details</legend><label htmlFor="meal-adult-name">Your name <span>(adult contributor)</span></label><input id="meal-adult-name" ref={nameInput} name="name" autoComplete="name" maxLength={80} required value={name} onChange={event=>setName(event.target.value)}/><label htmlFor="meal-email">Email address</label><input id="meal-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event=>setEmail(event.target.value)} aria-describedby="meal-email-help"/><p id="meal-email-help" className="meal-field-help">{draft ? 'For this preview, use a sample address ending in .invalid, such as parent@example.invalid. No email will be sent. ' : 'Used for verification and your private change/cancel link. '} Your name and email won’t appear on this public page.</p>{slot && <><label htmlFor="meal-quantity">Quantity <span>({slot.unit})</span></label><input className="meal-quantity" id="meal-quantity" name="quantity" type="number" inputMode="numeric" min="1" max={Math.max(1,slot.remaining)} step="1" required value={quantity} onChange={event=>setQuantity(event.target.value)}/><p className="meal-field-help">{slot.remaining} {slot.unit} currently needed</p></>}<div className="meal-honeypot" aria-hidden="true"><label htmlFor="meal-website">Leave this field empty</label><input id="meal-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event=>setWebsite(event.target.value)}/></div></fieldset>
      <div className="meal-notice"><ShieldCheck size={18}/><p>Please use an adult’s contact details. Don’t include student names, health information, or individual dietary details. Questions? Check with the meal coordinator directly.</p></div><div className="meal-form-actions"><button type="button" className="meal-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="meal-button primary" disabled={busy || (unavailable && !unresolved)}>{busy ? 'Sending request…' : unresolved ? 'Retry same request' : draft ? 'Try preview signup' : 'Email my verification link'}{!busy && <ArrowRight size={16}/>}</button></div><p className="meal-field-help">{busy || unresolved ? 'Closing this form won’t undo a request already sent. Check your email before trying again.' : 'Your signup is pending until you verify your email.'}</p>
    </form>}
  </dialog>;
}

function PrivateContribution({link,api,draft,onExit,onChange,onLostAccess}:{link:PrivateLink;api:MealApi;draft:boolean;onExit:()=>void;onChange:()=>void;onLostAccess:()=>void}) {
  const token=useRef(link.token);
  const generation=useRef(0);
  const inFlight=useRef(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const alert=useRef<HTMLParagraphElement>(null);
  const [claim,setClaim]=useState<PrivateClaim|null>(null);
  const [loading,setLoading]=useState(link.kind === 'manage');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [quantity,setQuantity]=useState('1');
  const [editing,setEditing]=useState(false);
  const [cancelling,setCancelling]=useState(false);
  const [retry,setRetry]=useState(0);
  const [accessLost,setAccessLost]=useState(false);
  const [requiresCheck,setRequiresCheck]=useState(false);
  const lastMutation=useRef<'edit'|'cancel'|null>(null);
  function loseAccess(){
    token.current='';setClaim(null);setQuantity('');setEditing(false);setCancelling(false);setNotice('');setAccessLost(true);setRequiresCheck(true);onLostAccess();
    setError(`This private link is no longer available. We can’t confirm the current contribution status here.${lastMutation.current==='cancel' ? ' Your cancellation outcome is not confirmed.' : ''} Please contact the meal coordinator before making another change.`);
  }
  const editButton=useRef<HTMLButtonElement>(null);
  const cancelButton=useRef<HTMLButtonElement>(null);
  const cancelHeading=useRef<HTMLHeadingElement>(null);
  const restoreActionFocus=(which:'edit'|'cancel')=>requestAnimationFrame(()=>{(which==='edit' ? editButton : cancelButton).current?.focus();});
  function dismissChanges(){if(editing){setEditing(false);if(claim)setQuantity(String(claim.quantity));restoreActionFocus('edit');}else{setCancelling(false);restoreActionFocus('cancel');}if(!requiresCheck)setError('');}
  useEffect(()=>{if(cancelling)cancelHeading.current?.focus();},[cancelling]);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{if(error) alert.current?.focus();},[error]);
  useEffect(()=>{
    const current=++generation.current;
    if(link.kind !== 'manage' || !token.current) return ()=>{generation.current++;};
    setLoading(true);setError('');
    api.inspect(token.current).then(result=>{if(current===generation.current){setClaim(result);setQuantity(String(result.quantity));}}).catch(failure=>{if(current===generation.current){if(privateFailurePolicy(failure)==='clear_access')loseAccess();else setError('This private link couldn’t be opened. If you haven’t confirmed yet, use the verification link in your email first. Links can also expire or be replaced. Try again, or ask the meal coordinator for help.');}}).finally(()=>{if(current===generation.current)setLoading(false);});
    return ()=>{generation.current++;};
  },[api,link.kind,retry]);
  async function act(action:'verify'|'edit'|'cancel') {
    if(inFlight.current || accessLost || !token.current || (action!=='verify' && requiresCheck)) return;
    if(action !== 'verify' && !claim) return;
    const amount=Number(quantity);
    if(action==='edit' && (!Number.isInteger(amount) || amount<1)){setError('Enter a whole number of at least 1.');return;}
    const current=++generation.current;inFlight.current=true;setBusy(true);setError('');setNotice('');
    if(action!=='verify')lastMutation.current=action;
    try {
      let result:PrivateClaim;
      if(action==='verify'){const verified=await api.verify(token.current);if(current!==generation.current)return;token.current=verified.access_token;result=verified.claim;}
      else if(action==='edit')result=await api.edit(token.current,{quantity:amount,version:claim!.version});
      else result=await api.cancel(token.current,{version:claim!.version});
      if(current!==generation.current)return;
      setRequiresCheck(false);lastMutation.current=null;setClaim(result);setQuantity(String(result.quantity));setEditing(false);setCancelling(false);setNotice(result.status==='confirmed' ? action==='edit' ? 'Your contribution has been updated.' : 'Your contribution is confirmed. Thank you for helping feed the team!' : result.status==='cancelled' ? 'Your contribution has been cancelled. The space is available for others again.' : 'Your latest contribution status is shown below.');onChange();heading.current?.focus();
    } catch (failure) {
      if(current===generation.current){
        if(privateFailurePolicy(failure)==='clear_access'){loseAccess();return;}
        if(action!=='verify')setRequiresCheck(true);
        setError(action==='verify' ? safeApiMessage(failure,'We couldn’t verify this contribution. The link may have expired or the meal coverage may have changed. Retry, or use the manage link from your original email to check its status.') : `${safeApiMessage(failure,'This change couldn’t be completed.')} Your input is still here. Further changes are locked until you reload its latest status.`);
      }
    } finally {if(current===generation.current){inFlight.current=false;setBusy(false);}}
  }
  async function reload() {
    if(inFlight.current || !claim || accessLost || !token.current)return;
    const current=++generation.current;inFlight.current=true;setBusy(true);setError('');
    try {const result=await api.inspect(token.current);if(current===generation.current){setClaim(result);setRequiresCheck(false);lastMutation.current=null;setNotice('Latest status loaded. Your unsaved quantity has been kept.');}}
    catch (failure) {if(current===generation.current){if(privateFailurePolicy(failure)==='clear_access')loseAccess();else{setRequiresCheck(true);setError('The latest status couldn’t be loaded. Further changes remain locked. Keep this page open and try again, or ask the meal coordinator for help.');}}}
    finally {if(current===generation.current){inFlight.current=false;setBusy(false);}}
  }
  const slot=claim?.meal.slots.find(item=>item.id===claim.slot_id);
  const canEdit=!accessLost && claim?.status==='confirmed' && claim.meal.status==='open';
  const canCancel=!accessLost && claim?.status==='confirmed' && claim.meal.status!=='cancelled';
  return <section className="meal-private" aria-labelledby="meal-private-title" onKeyDown={event=>{if(event.key==='Escape' && !busy && (editing || cancelling)){event.preventDefault();dismissChanges();}}}><button className="meal-text-button" onClick={onExit}><ArrowLeft size={16}/>Back to meal dates</button><div className="meal-round-icon"><ShieldCheck size={27}/></div><p className="meal-eyebrow">Your private contribution</p><h1 id="meal-private-title" ref={heading} tabIndex={-1}>{accessLost ? 'Private link unavailable' : requiresCheck ? 'Check your contribution status' : claim ? claim.status==='cancelled' ? 'Contribution cancelled' : claim.status==='confirmed' ? 'Thanks for feeding the team.' : 'Your contribution' : link.kind==='verify' ? 'One last step: confirm your help.' : 'Manage your contribution'}</h1><p className="meal-subtle">This private link has been removed from the address bar. Keep the original email to return later, and don’t share its link.</p>
    {error && <p className="meal-error" role="alert" ref={alert} tabIndex={-1}>{error}</p>}{notice && <p className="meal-success" role="status">{notice}</p>}{loading ? <p role="status">Opening your contribution…</p> : accessLost ? <p className="meal-subtle">Private details and controls have been removed from this page. Return to meal dates or ask the coordinator for help.</p> : !claim ? link.kind==='verify' ? <><p>Confirming verifies your email and reserves the contribution you requested. We’ll check that it’s still available.</p>{draft && <p className="meal-notice">Preview only. No real contribution or email is created.</p>}<button className="meal-button primary" disabled={busy} onClick={()=>void act('verify')}>{busy ? 'Confirming…' : 'Confirm my contribution'}<CheckCircle2 size={18}/></button></> : <button className="meal-button secondary" onClick={()=>setRetry(value=>value+1)}>Try opening again</button> : <>
      {requiresCheck && <p className="meal-notice">The details below were last verified before the request. Reload the latest status before making another change.</p>}
      <div className="meal-private-summary"><p className="meal-eyebrow">{dateLine(claim.meal)}</p><h2>{claim.meal.title}</h2><p>{timeLine(claim.meal)} · {claim.meal.timezone}</p><dl><div><dt>Contribution</dt><dd>{claim.whole_meal ? `Whole meal for ${claim.meal.expected_headcount} people` : slot?.label ?? 'Meal contribution'}</dd></div>{!claim.whole_meal && <div><dt>Quantity</dt><dd>{claim.quantity} {slot?.unit ?? 'items'}</dd></div>}<div><dt>{requiresCheck ? 'Last known status' : 'Status'}</dt><dd>{claim.status === 'confirmed' ? 'Confirmed' : claim.status === 'pending' ? 'Awaiting email verification' : claim.status === 'expired' ? 'Expired · no longer reserved' : 'Cancelled'}</dd></div></dl></div>
      {deadline(claim.access_expires_at,claim.meal) && <p className="meal-field-help">Private access expires {deadline(claim.access_expires_at,claim.meal)}.</p>}
      {claim.status==='pending' && <p className="meal-notice">This contribution isn’t confirmed yet. Use the verification link from your email to finish.</p>}
      {claim.meal.status!=='open' && <p className="meal-notice">{claim.meal.status==='cancelled' ? 'This meal has been cancelled.' : 'This meal is closed for new signups and quantity changes. You can still cancel your contribution while your private link is valid.'} Please contact the meal coordinator if you need help.</p>}
      {canCancel && (cancelling ? <div className="meal-cancel-check"><h3 ref={cancelHeading} tabIndex={-1}>Cancel this contribution?</h3><p>The meal coordinator will need someone else to cover it.</p><div className="meal-form-actions"><button className="meal-button secondary" disabled={busy} onClick={dismissChanges}>Keep my contribution</button><button className="meal-button danger" disabled={busy || requiresCheck} onClick={()=>void act('cancel')}>{busy ? 'Cancelling…' : 'Yes, cancel my contribution'}</button></div></div> : editing && canEdit ? <form className="meal-private-edit" onSubmit={event=>{event.preventDefault();void act('edit');}}><label htmlFor="meal-edit-quantity">New quantity ({slot?.unit ?? 'items'})</label><input id="meal-edit-quantity" type="number" min="1" step="1" inputMode="numeric" required autoFocus disabled={busy || requiresCheck} value={quantity} onChange={event=>setQuantity(event.target.value)}/><p className="meal-field-help">Availability is checked when you save. For a different item or meal date, cancel this contribution and sign up again.</p><div className="meal-form-actions"><button type="button" className="meal-button secondary" disabled={busy} onClick={dismissChanges}>Discard changes</button><button className="meal-button primary" disabled={busy || requiresCheck}>{busy ? 'Saving…' : 'Save quantity'}</button></div></form> : <div className="meal-form-actions">{!claim.whole_meal && canEdit && <button ref={editButton} className="meal-button secondary" disabled={busy || requiresCheck} onClick={()=>{setEditing(true);setError('');setNotice('');}}>Change quantity</button>}<button ref={cancelButton} className="meal-text-button danger" disabled={busy || requiresCheck} onClick={()=>{setCancelling(true);setError('');setNotice('');}}>Cancel contribution</button></div>)}
      {(error || requiresCheck) && <button className="meal-button secondary" disabled={busy} onClick={()=>void reload()}>Reload latest status</button>}
    </>}
    {busy && <p className="meal-field-help" role="status">A request is in progress. Leaving this page won’t undo a change already sent.</p>}
  </section>;
}

export function PublicMeals({api=mealApi,draft=false}:{api?:MealApi;draft?:boolean}) {
  const [privateLink,setPrivateLink]=useState<PrivateLink|null>(()=>readPrivateLink());
  const [linkVersion,setLinkVersion]=useState(0);
  const [meals,setMeals]=useState<PublicMeal[]|null>(null);
  const [error,setError]=useState(false);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [selection,setSelection]=useState<(Selection & {meal:PublicMeal;slot:MealSlot|null})|null>(null);
  const trigger=useRef<HTMLButtonElement|null>(null);
  const listHeading=useRef<HTMLHeadingElement>(null);
  const listGeneration=useRef(0);
  const refreshMeals=useCallback(()=>setRefresh(value=>value+1),[]);
  useLayoutEffect(()=>{
    removePrivateFragment();
    const changed=(event:PopStateEvent|HashChangeEvent)=>{
      const link=readPrivateLink();
      // One same-document navigation can emit both events. The second event
      // must not erase a capability already consumed by the first one.
      if(!link && event.type==='hashchange' && parsePrivateFragment(new URL((event as HashChangeEvent).newURL).hash))return;
      removePrivateFragment();setSelection(null);setPrivateLink(link);setLinkVersion(value=>value+1);
    };
    window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed);
    return ()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed);};
  },[]);
  useEffect(()=>{document.title=privateLink ? 'Your meal contribution · 4418 IMPULSE' : 'Saturday meals · 4418 IMPULSE';},[privateLink]);
  useEffect(()=>{
    if(privateLink)return;
    const current=++listGeneration.current;const controller=new AbortController();setLoading(true);setError(false);
    api.list(controller.signal).then(result=>{if(current===listGeneration.current)setMeals([...result].sort((a,b)=>a.service_at.localeCompare(b.service_at)));}).catch(()=>{if(current===listGeneration.current && !controller.signal.aborted)setError(true);}).finally(()=>{if(current===listGeneration.current)setLoading(false);});
    return ()=>{listGeneration.current++;controller.abort();};
  },[api,refresh,privateLink]);
  function closeDialog(){setSelection(null);requestAnimationFrame(()=>{if(trigger.current?.isConnected)trigger.current.focus();else listHeading.current?.focus();});}
  const selectedMeal=selection && (meals?.find(meal=>meal.id===selection.mealId) ?? {...selection.meal,status:'closed' as const});
  const selectedSlot=selectedMeal && selection?.slotId ? selectedMeal.slots.find(slot=>slot.id===selection.slotId) ?? (selection.slot ? {...selection.slot,remaining:0} : null) : null;
  return <div className="meals-public"><a className="meal-skip" href="#meal-content" onClick={event=>{event.preventDefault();document.getElementById('meal-content')?.focus();}}>Skip to meal dates</a><header className="meal-site-header"><a className="meal-brand" href={`${import.meta.env.BASE_URL}meals.html`} aria-label="4418 IMPULSE meal dates"><img src={`${import.meta.env.BASE_URL}branding/4418-impulse-emblem.png`} alt=""/><span>4418<strong>IMPULSE</strong></span></a><span className="meal-header-label">Family meal signups</span><span className="meal-header-note"><HeartHandshake size={18}/>Made possible by you</span></header>
    {draft && <aside className="meal-draft-banner"><strong>Local review draft</strong> · Sample meals only. No real signups or emails.</aside>}
    <main id="meal-content" tabIndex={-1}>{privateLink ? <PrivateContribution key={linkVersion} link={privateLink} api={api} draft={draft} onExit={()=>{setPrivateLink(null);refreshMeals();requestAnimationFrame(()=>listHeading.current?.focus());}} onChange={refreshMeals} onLostAccess={()=>setPrivateLink(current=>current ? {...current,token:''} : null)}/> : <><section className="meal-hero"><div><p className="meal-eyebrow">4418 IMPULSE · Saturday meals</p><h1>Good food.<br/>Great teamwork.</h1><p className="meal-hero-copy">Help keep our team fueled on Saturdays. Bring a dish, cover a few essentials, or take care of a whole meal. Every contribution makes a difference.</p><div className="meal-hero-note"><HeartHandshake size={20}/><span>A shared meal. A little less on everyone’s plate.</span></div></div><aside className="meal-how"><span className="meal-how-icon"><Utensils size={24}/></span><h2>One easy way to help</h2><ol><li><span>1</span><div><strong>Pick a Saturday</strong><p>See what’s needed for each meal.</p></div></li><li><span>2</span><div><strong>Choose your contribution</strong><p>A few portions or the whole meal.</p></div></li><li><span>3</span><div><strong>Confirm by email</strong><p>Your private link also lets you change or cancel.</p></div></li></ol></aside></section>
      <section className="meal-dates" aria-labelledby="meal-dates-title"><div className="meal-section-heading"><div><p className="meal-eyebrow">Find your Saturday</p><h2 id="meal-dates-title" tabIndex={-1} ref={listHeading}>A place at the table</h2><p>Live coverage, without anyone’s contact details.</p></div><button className="meal-button secondary" disabled={loading} onClick={refreshMeals}>{loading ? 'Refreshing…' : 'Refresh coverage'}</button></div>
        {error && <div className="meal-error" role="alert"><p>Meal coverage couldn’t be loaded. {meals ? 'The information below may be out of date.' : 'Please try again in a moment.'}</p><button className="meal-button secondary" onClick={refreshMeals}>Try again</button></div>}
        {meals===null && loading ? <div className="meal-empty" role="status"><CalendarDays size={28}/><p>Loading Saturday meals…</p></div> : meals?.length===0 ? <div className="meal-empty"><CalendarDays size={30}/><h3>No meal dates are open yet</h3><p>The meal coordinator will share the next Saturdays here. Please check back soon.</p></div> : <div className="meal-list">{meals?.map(meal=><MealCard key={meal.id} meal={meal} onChoose={(next,element)=>{trigger.current=element;setSelection({...next,meal,slot:meal.slots.find(slot=>slot.id===next.slotId) ?? null});}}/>)}</div>}
      </section><aside className="meal-footer-note"><ShieldCheck size={22}/><div><strong>A simple signup. A little privacy.</strong><p>No team account is needed. Only meal needs and coverage are public. Use an adult’s email and keep dietary or student-specific questions with the meal coordinator.</p></div></aside></>}
    </main><footer className="meal-site-footer"><span>4418 IMPULSE</span><p>Built together. Fueled by community.</p></footer>
    {selection && selectedMeal && (selection.slotId===null || selectedSlot) && <ClaimDialog meal={selectedMeal} slot={selectedSlot ?? null} api={api} draft={draft} onClose={closeDialog} onRefresh={refreshMeals}/>}
  </div>;
}
