import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronRight, Plus, RefreshCw, ShieldCheck, UtensilsCrossed } from 'lucide-react';
import { mealApi } from './service';
import type { ManagedClaim, MealApi, MealCategory, MealDraft, MealManagerSnapshot, PublicMeal } from './types';
import './manager.css';
import { wallTime, serviceInstant } from './time';

const categories: MealCategory[] = ['main', 'side', 'drink', 'supply', 'other'];
const categoryNames: Record<MealCategory, string> = { main: 'Main', side: 'Side', drink: 'Drink', supply: 'Supply', other: 'Other' };
const wholeLabels: Record<PublicMeal['whole_meal'], string> = { available: 'Available for a whole-meal volunteer', held: 'Whole-meal offer awaiting verification', confirmed: 'Whole meal confirmed', coordination_required: 'Whole meal needs coordination' };
const emailLabels: Record<ManagedClaim['email_status'], string> = { queued: 'Email queued', sent: 'Email provider accepted', failed: 'Email failed', uncertain: 'Email outcome uncertain', retry: 'Email retry pending' };
type EditableSlot = { key: string; id?: string; label: string; category: MealCategory; unit: string; needed: string };
type Editor = { id?: string; version?: number; title: string; localTime: string; timezone: string; expected: string; guidance: string; cancellationReason: string; cancellationAcknowledged: boolean; status: MealDraft['status']; slots: EditableSlot[] };
let slotSequence = 0;
const newSlot = (): EditableSlot => ({ key: `new-${++slotSequence}`, label: '', category: 'main', unit: 'servings', needed: '' });
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed. Your edits are still here.';
const errorCode = (error: unknown) => error && typeof error === 'object' ? String(('code' in error && error.code) || ('status' in error && error.status) || '') : '';
const errorStatus = (error: unknown) => error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
const denied = (error: unknown) => [401, 403].includes(errorStatus(error) || 0) || ['42501', '401', '403', 'forbidden', 'unauthorized', 'manager_required'].includes(errorCode(error).toLowerCase()) || /permission denied|not authorized|active (mentor|admin)|access denied/i.test(errorText(error));
const conflicted = (error: unknown) => errorStatus(error) === 409 || ['409', '40001', 'stale_version', 'version_conflict', 'active_claims', 'capacity_changed', 'coordination_required', 'conflict'].includes(errorCode(error).toLowerCase()) || /stale|version|changed.*reload|conflict|capacity|committed|already claimed/i.test(errorText(error));

const formatMealTime = (meal: PublicMeal) => {
  try { return `${new Intl.DateTimeFormat(undefined, { timeZone: meal.timezone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(meal.service_at))} · ${meal.timezone}`; }
  catch { return `${meal.service_at} · ${meal.timezone}`; }
};
function makeEditor(meal?: PublicMeal): Editor {
  return meal ? { id: meal.id, version: meal.version, title: meal.title, localTime: wallTime(meal.service_at, meal.timezone), timezone: meal.timezone, expected: String(meal.expected_headcount), guidance: meal.guidance, cancellationReason: '', cancellationAcknowledged: false, status: meal.status, slots: meal.slots.map(s => ({ key: s.id, id: s.id, label: s.label, category: s.category, unit: s.unit, needed: String(s.needed) })) } : { title: 'Saturday team meal', localTime: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', expected: '', guidance: '', cancellationReason: '', cancellationAcknowledged: false, status: 'closed', slots: [newSlot()] };
}
function toDraft(editor: Editor): MealDraft {
  const positive = (value: string, label: string) => { const number = Number(value); if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > 1000) throw Error(`${label} must be a whole number from 1 to 1,000.`); return number; };
  const timezone = editor.timezone.trim();
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw Error('Enter a valid IANA timezone, such as America/New_York or UTC.'); }
  if (!editor.title.trim()) throw Error('Enter a meal title.');
  if (!editor.slots.length || editor.slots.length > 30) throw Error('Add between 1 and 30 contribution slots.');
  if (editor.status === 'cancelled' && !editor.cancellationReason.trim()) throw Error('Enter a meal cancellation reason.');
  return { ...(editor.id ? { id: editor.id, version: editor.version } : {}), title: editor.title.trim(), service_at: serviceInstant(editor.localTime, timezone), timezone, expected_headcount: positive(editor.expected, 'Expected headcount'), guidance: editor.guidance.trim(), status: editor.status, ...(editor.status === 'cancelled' ? { cancellation_reason: editor.cancellationReason.trim(), acknowledge_cancellation: editor.cancellationAcknowledged } : {}), slots: editor.slots.map((slot, index) => {
    if (!slot.label.trim() || !slot.unit.trim()) throw Error(`Add a label and unit for slot ${index + 1}.`);
    return { ...(slot.id ? { id: slot.id } : {}), label: slot.label.trim(), category: slot.category, unit: slot.unit.trim(), needed: positive(slot.needed, `Slot ${index + 1} quantity`) };
  }) };
}

export function MealManager({ api = mealApi }: { api?: MealApi }) {
  const [data, setData] = useState<MealManagerSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [stale, setStale] = useState(false);
  const [uncertainSave, setUncertainSave] = useState(false);
  const [cancelNeedsReview, setCancelNeedsReview] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ManagedClaim | null>(null);
  const [reason, setReason] = useState('');
  const [claimFilter, setClaimFilter] = useState('all');
  const epoch = useRef(0), loadSequence = useRef(0), mutationLock = useRef(false), live = useRef(false), controller = useRef<AbortController | null>(null);
  const selected = data?.meals.find(m => m.id === selectedId);
  const claims = data?.claims.filter(c => c.meal_id === selectedId) || [];
  const editorClaims = data?.claims.filter(c => c.meal_id === editor?.id && ['pending', 'confirmed'].includes(c.status)) || [];
  const wholeCommitted = editorClaims.some(c => c.whole_meal);
  const editorSaved = data?.meals.find(m => m.id === editor?.id);

  const revoke = () => { setAccessDenied(true); setData(null); setEditor(null); setCancelTarget(null); setReason(''); setNotice(''); setDirty(false); };
  async function load(initial = false) {
    const scope = epoch.current, sequence = ++loadSequence.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError('');
    try {
      const next = await api.manager(request.signal);
      if (!live.current || scope !== epoch.current || sequence !== loadSequence.current || request.signal.aborted) return;
      setData(next); setAccessDenied(false);
      setSelectedId(id => next.meals.some(m => m.id === id) ? id : next.meals[0]?.id || null);
      if (!initial) setNotice('Latest coverage and contribution status loaded. Unsaved meal edits are unchanged.');
    } catch (failure) {
      if (!live.current || scope !== epoch.current || sequence !== loadSequence.current || request.signal.aborted) return;
      if (denied(failure)) revoke(); else setError(errorText(failure));
    } finally {
      if (live.current && scope === epoch.current && sequence === loadSequence.current && !request.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true; epoch.current++; mutationLock.current = false;
    setData(null); setEditor(null); setDirty(false); setCancelTarget(null); setReason(''); setStale(false); setUncertainSave(false); setCancelNeedsReview(false); setBusy(false); setAccessDenied(false); setNotice('');
    void load(true);
    return () => { live.current = false; epoch.current++; loadSequence.current++; controller.current?.abort(); };
  }, [api]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { setEditor(current => current ? { ...current, cancellationAcknowledged: false } : current); }, [editor?.id, editorClaims.map(c => `${c.id}:${c.version}`).join(',')]);
  const edit = (patch: Partial<Editor>) => { setEditor(current => current && { ...current, ...patch }); setDirty(true); setNotice(''); };
  const startEditor = (meal?: PublicMeal) => { setEditor(makeEditor(meal)); setDirty(!meal); setStale(false); setUncertainSave(false); setCancelTarget(null); setReason(''); setError(''); setNotice(''); };
  const discard = () => { setEditor(null); setDirty(false); setStale(false); setUncertainSave(false); setError(''); setNotice('Edits discarded. Saved meal details are unchanged.'); };
  const updateSlot = (key: string, patch: Partial<EditableSlot>) => editor && edit({ slots: editor.slots.map(s => s.key === key ? { ...s, ...patch } : s) });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || mutationLock.current || stale || uncertainSave || accessDenied) return;
    let payload: MealDraft;
    try { if (editor.status === 'cancelled' && editorClaims.length && !editor.cancellationAcknowledged) throw Error('Acknowledge cancelling every pending and confirmed contribution before saving.'); payload = toDraft(editor); } catch (failure) { setError(errorText(failure)); return; }
    const scope = epoch.current;
    mutationLock.current = true; setBusy(true); setError(''); setNotice('');
    // No older read may replace a successful mutation response.
    loadSequence.current++; controller.current?.abort(); setLoading(false);
    try {
      const saved = await api.saveMeal(payload);
      if (!live.current || scope !== epoch.current) return;
      setData(current => current && { ...current, meals: [...current.meals.filter(m => m.id !== saved.id), saved].sort((a, b) => a.service_at.localeCompare(b.service_at)) });
      setSelectedId(saved.id); setEditor(makeEditor(saved)); setDirty(false); setStale(false);
      const savedMessage = `Meal saved. Version ${saved.version}. ${saved.status === 'cancelled' ? 'All pending and confirmed contributions are cancelled; history is retained. Contact contributors directly. No notification emails were sent.' : saved.status === 'closed' ? 'Signups are closed.' : 'Signups are open.'}`;
      setNotice(savedMessage);
      if (saved.status === 'cancelled') {
        // The successful date cancellation is authoritative; never leave old active rows visible.
        setData(current => current && { ...current, claims: current.claims.map(claim => claim.meal_id === saved.id && ['pending', 'confirmed'].includes(claim.status) ? { ...claim, status: 'cancelled', version: claim.version + 1 } : claim) });
        try {
          const refreshed = await api.manager();
          if (live.current && scope === epoch.current) setData(refreshed);
        } catch (failure) {
          if (!live.current || scope !== epoch.current) return;
          if (denied(failure)) revoke();
          else setError('The meal cancellation was saved, but the latest contribution list could not be loaded. Refresh status before any further changes.');
        }
      }
    } catch (failure) {
      if (!live.current || scope !== epoch.current) return;
      if (denied(failure)) revoke(); else { setStale(conflicted(failure)); setUncertainSave(['uncertain_result', 'unavailable'].includes(errorCode(failure)) || (errorStatus(failure) || 0) >= 500 || !errorCode(failure)); setError(errorText(failure)); }
    } finally {
      if (live.current && scope === epoch.current) { mutationLock.current = false; setBusy(false); }
    }
  }
  async function cancelContribution(event: FormEvent) {
    event.preventDefault();
    if (!cancelTarget || !reason.trim() || mutationLock.current || cancelNeedsReview || accessDenied) return;
    const scope = epoch.current, target = cancelTarget;
    mutationLock.current = true; setBusy(true); setError(''); setNotice('');
    loadSequence.current++; controller.current?.abort(); setLoading(false);
    try {
      await api.cancelClaim({ id: target.id, version: target.version, reason: reason.trim() });
      if (!live.current || scope !== epoch.current) return;
      setCancelTarget(null); setReason('');
      // Refresh from the server; claim cancellation can also change whole-meal availability.
      const next = await api.manager();
      if (!live.current || scope !== epoch.current) return;
      setData(next); setNotice('Contribution cancelled. Other contributions are unchanged.');
    } catch (failure) {
      if (!live.current || scope !== epoch.current) return;
      if (denied(failure)) revoke(); else { setCancelNeedsReview(true); setError(`${errorText(failure)} Close the cancellation form and refresh the list to check the latest status before trying again.`); }
    } finally {
      if (live.current && scope === epoch.current) { mutationLock.current = false; setBusy(false); }
    }
  }

  return <section className="meal-manager" aria-labelledby="meal-manager-heading">
    <header className="meal-manager-heading"><div><span className="workspace-eyebrow">Team workspace</span><h1 id="meal-manager-heading">Saturday meals</h1><p>Plan the meal, see what’s covered, and coordinate with adult volunteers.</p></div><div className="meal-manager-actions">{data && <><button type="button" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true"/>Refresh status</button><button className="primary" type="button" disabled={busy || !!editor || !!cancelTarget} onClick={() => startEditor()}><Plus size={17} aria-hidden="true"/>Add a meal</button></>}</div></header>
    {accessDenied ? <div className="meal-manager-empty" role="alert"><ShieldCheck size={28} aria-hidden="true"/><h2>Meal management access required</h2><p>Only active mentors and admins can manage meals and view private adult contact details. Sign in with an authorized Team Hub account.</p><a href="#">Return to Team Hub</a></div> : <>
      {error && <div className="meal-manager-alert" role="alert">{error}{!data && <button type="button" disabled={loading} onClick={() => void load(true)}>Try loading again</button>}</div>}
      {notice && <p className="meal-manager-notice" role="status">{notice}</p>}
      {loading && <p className="meal-manager-loading" role="status">{data ? 'Refreshing coverage…' : 'Loading meal management…'}</p>}
      {data && <>
        {data.mail_mode !== 'live' && <div className="meal-manager-warning"><strong>{data.mail_mode === 'mock' ? 'Test email mode' : 'Email is disabled'}</strong><span>{data.mail_mode === 'mock' ? 'Emails are simulated. No real verification or cancellation emails are sent.' : 'Volunteers cannot receive verification or cancellation emails. Do not treat a pending claim as confirmed.'}</span></div>}
        <div className="meal-manager-private"><ShieldCheck size={17} aria-hidden="true"/><span>Private coordinator view. Adult names and emails stay off the public signup page.</span>{data.daily_budget_remaining !== null && <span>Daily email budget remaining: {data.daily_budget_remaining}</span>}</div>
        <div className="meal-manager-layout">
          <aside className="meal-manager-dates" aria-label="Meal dates"><div className="meal-manager-card-heading"><h2>Meal dates</h2><span>{data.meals.length}</span></div>{!data.meals.length ? <p>No meals yet. Add a meal to start planning.</p> : <div className="meal-manager-date-list">{data.meals.map(meal => <button type="button" key={meal.id} aria-current={selectedId === meal.id ? 'true' : undefined} disabled={busy || !!editor || !!cancelTarget} onClick={() => { setSelectedId(meal.id); setError(''); setNotice(''); setClaimFilter('all'); }}><span><strong>{meal.title}</strong><span className="meal-manager-date"><CalendarDays size={14} aria-hidden="true"/>{formatMealTime(meal)}</span><span className={`meal-manager-badge ${meal.status}`}>{meal.status}</span></span><ChevronRight size={16} aria-hidden="true"/></button>)}</div>}{editor && <p className="meal-manager-hint">Save and close, or discard your edits before switching meals.</p>}</aside>
          <div className="meal-manager-detail">
            {editor ? <section className="meal-manager-panel" aria-labelledby="meal-editor-heading"><div className="meal-manager-card-heading"><div><h2 id="meal-editor-heading">{editor.id ? 'Edit meal' : 'New meal'}</h2><p className="meal-manager-save-state">{busy ? 'Saving changes…' : dirty ? 'Unsaved changes' : `Saved · version ${editor.version}`}</p></div><button type="button" disabled={busy} onClick={dirty ? discard : () => { setEditor(null); setStale(false); setError(''); }}>{dirty ? 'Discard unsaved changes' : 'Close editor'}</button></div>
              {uncertainSave && <div className="meal-manager-warning" role="alert"><strong>The save result is uncertain.</strong><span>Your request may have reached the server. Your draft is preserved and saving again is blocked. Refresh status and check the saved meal before discarding this draft; do not create a duplicate meal.</span></div>}
              {stale && <div className="meal-manager-warning" role="alert"><strong>This save needs coordination or a newer meal version.</strong><span>Your draft is preserved. Refresh status and review current commitments. Coordinate any affected volunteers, then discard this draft and edit the latest version. Saving is blocked to protect existing commitments.</span></div>}
              {(stale || uncertainSave) && editorSaved && <details className="meal-manager-latest"><summary>Latest loaded meal · version {editorSaved.version}</summary><p><strong>{editorSaved.title}</strong><br/>{formatMealTime(editorSaved)}<br/>{editorSaved.expected_headcount} expected · {editorSaved.status}</p>{editorSaved.slots.map(slot => <p key={slot.id}>{slot.label}: {slot.needed} {slot.unit} needed · {slot.confirmed} confirmed · {slot.held} pending</p>)}</details>}
              {editorClaims.length > 0 && <p className="meal-manager-warning">Existing volunteers have commitments. Meal time, timezone, and claimed item descriptions stay fixed until you coordinate and cancel the affected contributions. {wholeCommitted && 'Whole-meal commitments also lock headcount and slot configuration.'}</p>}
              <form onSubmit={save}><fieldset disabled={busy}><div className="meal-manager-fields">
                <label className="meal-manager-full">Meal title<input autoFocus value={editor.title} maxLength={120} required onChange={e => edit({ title: e.target.value })}/></label>
                <label>Meal date and local time<input type="datetime-local" disabled={editorClaims.length > 0} value={editor.localTime} required onChange={e => edit({ localTime: e.target.value })}/></label>
                <label>Timezone<input value={editor.timezone} disabled={editorClaims.length > 0} required maxLength={80} list="meal-timezones" aria-describedby="meal-timezone-help" onChange={e => edit({ timezone: e.target.value })}/><datalist id="meal-timezones">{['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu', 'UTC'].map(zone => <option key={zone} value={zone}/>)}</datalist></label>
                <p className="meal-manager-full meal-manager-hint" id="meal-timezone-help">The date and time use the named timezone, not each volunteer’s device timezone. Use an IANA name such as America/New_York.</p>
                <label>Expected headcount<input type="number" min="1" max="1000" step="1" inputMode="numeric" disabled={wholeCommitted} required value={editor.expected} onChange={e => edit({ expected: e.target.value })}/></label>
                <label>Signup state<select value={editor.status} onChange={e => edit({ status: e.target.value as MealDraft['status'], cancellationAcknowledged: false })}><option value="closed">Closed</option><option value="open">Open</option><option value="cancelled">Cancelled</option></select></label>
                {editor.status === 'cancelled' && <label className="meal-manager-full">Meal cancellation reason<textarea value={editor.cancellationReason} required maxLength={300} rows={2} onChange={e => edit({ cancellationReason: e.target.value })}/></label>}
                {editor.status === 'cancelled' && <p className="meal-manager-full meal-manager-warning">Cancelling this date closes signups and cancels every pending and confirmed contribution for this meal. Contribution history is retained. Contact all contributors directly; no notification emails are sent automatically.</p>}
                {editor.status === 'cancelled' && editorClaims.length > 0 && <label className="meal-manager-full meal-manager-cancellation-ack"><input type="checkbox" checked={editor.cancellationAcknowledged} required onChange={e => edit({ cancellationAcknowledged: e.target.checked })}/><span>I understand this cancels all pending and confirmed contributions ({editorClaims.length} currently shown), and I will coordinate directly with the contributors.</span></label>}
                <label className="meal-manager-full">Public dietary and serving guidance<textarea rows={3} value={editor.guidance} maxLength={2000} aria-describedby="meal-guidance-privacy" onChange={e => edit({ guidance: e.target.value })} placeholder="For example: label ingredients; include a vegetarian option."/></label>
                <p className="meal-manager-full meal-manager-warning" id="meal-guidance-privacy"><strong>Visible on the public signup page.</strong> Use general, nonidentifying guidance only. Do not include names, student details, individual allergies, medical information, or private contact details.</p>
              </div>
              <div className="meal-manager-card-heading"><div><h3>Contribution slots</h3><p>Use clear units, such as trays, bottles, or servings.</p></div><button type="button" disabled={wholeCommitted || editor.slots.length >= 30} onClick={() => edit({ slots: [...editor.slots, newSlot()] })}><Plus size={16} aria-hidden="true"/>Add slot</button></div>
              {editor.slots.map((slot, index) => { const savedSlot = data.meals.find(m => m.id === editor.id)?.slots.find(s => s.id === slot.id); const committed = !!savedSlot && savedSlot.confirmed + savedSlot.held > 0; return <div className="meal-manager-slot-editor" key={slot.key} role="group" aria-label={`Contribution slot ${index + 1}`}><label>Slot label<input value={slot.label} disabled={committed} required maxLength={100} onChange={e => updateSlot(slot.key, { label: e.target.value })}/></label><label>Category<select disabled={committed} value={slot.category} onChange={e => updateSlot(slot.key, { category: e.target.value as MealCategory })}>{categories.map(category => <option key={category} value={category}>{categoryNames[category]}</option>)}</select></label><label>Quantity needed<input type="number" min={Math.max(1, (savedSlot?.confirmed || 0) + (savedSlot?.held || 0))} max="1000" step="1" disabled={wholeCommitted} required value={slot.needed} onChange={e => updateSlot(slot.key, { needed: e.target.value })}/></label><label>Unit label<input value={slot.unit} disabled={committed} required maxLength={40} onChange={e => updateSlot(slot.key, { unit: e.target.value })}/></label><button type="button" disabled={committed} aria-label={`Remove slot ${index + 1}`} onClick={() => edit({ slots: editor.slots.filter(s => s.key !== slot.key) })}>Remove</button>{committed && <p className="meal-manager-hint">This slot has confirmed or pending contributions and cannot be removed. Coordinate before reducing coverage.</p>}</div>; })}
              {!editor.slots.length && <p>Add a slot before saving.</p>}
              <p className="meal-manager-hint">The server rechecks commitments before saving. Claimed labels, categories, and units cannot change; committed slots cannot be removed or reduced below existing commitments. Maximum 30 slots.</p>
              <div className="meal-manager-form-actions"><button className="primary" type="submit" disabled={!dirty || stale || uncertainSave || (editor.status === 'cancelled' && editorClaims.length > 0 && !editor.cancellationAcknowledged)}>{busy ? 'Saving…' : 'Save meal'}</button><span>Changes are only applied when saved.</span></div>
              </fieldset></form></section> : selected ? <section className="meal-manager-panel" aria-labelledby="selected-meal-heading"><div className="meal-manager-card-heading"><div><h2 id="selected-meal-heading">{selected.title}</h2><p>{formatMealTime(selected)}</p></div><button type="button" disabled={busy || !!cancelTarget} onClick={() => startEditor(selected)}>Edit meal</button></div><div className="meal-manager-summary"><span className={`meal-manager-badge ${selected.status}`}>{selected.status}</span><span><strong>{selected.expected_headcount}</strong> expected</span><span>Saved version {selected.version}</span></div><div className={`meal-manager-whole ${selected.whole_meal === 'coordination_required' ? 'needs-coordination' : ''}`}><UtensilsCrossed size={21} aria-hidden="true"/><div><strong>{wholeLabels[selected.whole_meal]}</strong><p>{selected.whole_meal === 'coordination_required' ? 'Existing contributions need to be coordinated before a whole-meal offer can be accepted. Contact volunteers; no contribution is automatically displaced.' : 'Whole-meal coverage includes all food and supplies. Existing contributions are retained; coordinate any overlapping offers directly.'}</p></div></div>{selected.guidance && <div className="meal-manager-public-guidance"><h3>Public guidance</h3><p>{selected.guidance}</p></div>}<div className="meal-manager-coverage"><h3>Coverage by slot</h3>{selected.slots.map(slot => <div className="meal-manager-coverage-row" key={slot.id}><div><strong>{slot.label}</strong><span>{categoryNames[slot.category]} · {slot.needed} {slot.unit} needed</span></div><div><span>{slot.confirmed} confirmed · {slot.held} pending</span><strong>{slot.remaining} {slot.unit} remaining</strong></div></div>)}{!selected.slots.length && <p>No contribution slots configured.</p>}</div></section> : <div className="meal-manager-empty"><UtensilsCrossed size={30} aria-hidden="true"/><h2>Make Saturdays easier</h2><p>Add a date, an expected headcount, and what the team needs.</p></div>}
            {selected && <section className="meal-manager-panel" aria-labelledby="meal-contributions-heading"><div className="meal-manager-card-heading"><div><h2 id="meal-contributions-heading">Adult volunteer contributions</h2><p>Private contact information for {selected.title}.</p></div><label className="meal-manager-claim-filter">Contribution status<select value={claimFilter} onChange={e => setClaimFilter(e.target.value)}><option value="all">All statuses</option>{['pending', 'confirmed', 'cancelled', 'expired'].map(status => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}</select></label></div><p className="meal-manager-hint">Pending claims reserve capacity until verification or expiry. “Email provider accepted” does not confirm inbox delivery. Failed or uncertain email needs review; a pending retry reuses the original request. Avoid duplicate sends.</p>
              {claims.filter(c => claimFilter === 'all' || c.status === claimFilter).map(claim => <article className="meal-manager-claim" key={claim.id} aria-label={`Contribution from ${claim.name}`}><div className="meal-manager-claim-header"><div><strong>{claim.name}</strong><span className="meal-manager-contact">{claim.email}</span></div><span className={`meal-manager-badge ${claim.status}`}>{claim.status}</span></div><p>{claim.whole_meal ? 'Whole meal' : `${claim.quantity} ${selected.slots.find(s => s.id === claim.slot_id)?.unit || 'units'} · ${selected.slots.find(s => s.id === claim.slot_id)?.label || 'Previous slot'}`}</p><div className="meal-manager-claim-meta"><span>{emailLabels[claim.email_status]}</span>{claim.status === 'pending' && claim.hold_expires_at && <span>Hold expires {new Date(claim.hold_expires_at).toLocaleString(undefined, { timeZone: 'UTC' })} UTC</span>}</div>{['pending', 'confirmed'].includes(claim.status) && <button type="button" disabled={busy || !!editor || !!cancelTarget} onClick={() => { setCancelTarget(claim); setCancelNeedsReview(false); setReason(''); setError(''); setNotice(''); }}>Cancel contribution from {claim.name}</button>}</article>)}
              {!claims.filter(c => claimFilter === 'all' || c.status === claimFilter).length && <p className="meal-manager-empty-inline">{claims.length ? 'No contributions match this status.' : 'No volunteer contributions yet.'}</p>}
              {cancelTarget && <form className="meal-manager-cancel" aria-label="Cancel contribution" onSubmit={cancelContribution}><h3>Cancel {cancelTarget.name}’s contribution?</h3><p>Only this contribution will be cancelled. All other volunteers’ contributions stay in place. Coordinate changes directly with the volunteer.</p><fieldset disabled={busy}><label>Cancellation reason<textarea value={reason} required maxLength={300} rows={2} onChange={e => setReason(e.target.value)}/></label><div className="meal-manager-actions"><button type="submit" className="meal-manager-danger" disabled={!reason.trim() || cancelNeedsReview}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button><button type="button" onClick={() => { setCancelTarget(null); setCancelNeedsReview(false); setReason(''); setError(''); }}>{cancelNeedsReview ? 'Close cancellation form' : 'Keep contribution'}</button></div></fieldset></form>}
            </section>}
          </div>
        </div>
      </>}
    </>}
  </section>;
}
