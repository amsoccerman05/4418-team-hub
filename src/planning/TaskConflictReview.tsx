import {useEffect,useRef} from 'react';
import type {Context,Task} from './service';
import {priorities,taskStatuses} from './service';
import {taskChanges,type TaskChoices,type TaskEditField} from './task-reconciliation';
export function TaskConflictReview({base,draft,latest,data,choices,onChoice,onApply,onCancel}:{base:Record<string,unknown>;draft:Record<string,unknown>;latest:Task;data:Context;choices:TaskChoices;onChoice:(key:TaskEditField,value:'draft'|'latest')=>void;onApply:()=>void;onCancel:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>heading.current?.focus(),[]);
 const changes=taskChanges(base,draft,latest),unresolved=changes.some(c=>c.conflict&&!choices[c.key]);
 const value=(key:TaskEditField,v:unknown)=>{
  if(key==='owner_ids')return (v as string[]||[]).map(id=>[...data.members,...latest.owners,...((draft.owners||[]) as Task['owners'])].find(m=>m.id===id)?.name||'Unavailable teammate').join(', ')||'Unassigned';
  if(key==='area_id')return data.areas.find(a=>a.id===v)?.name||'Unassigned';
  if(key==='status')return taskStatuses[v as keyof typeof taskStatuses]||String(v||'Not set');
  if(key==='priority')return priorities[v as keyof typeof priorities]||String(v||'Not set');
  return String(v||'Not set');
 };
 return <section className="planning-conflict-review" aria-labelledby="planning-conflict-title">
  <h3 id="planning-conflict-title" ref={heading} tabIndex={-1}>Review task changes</h3>
  <p>Your draft is still here. Changes to different fields can be combined. Choose what to keep where you both changed the same field.</p>
  {!changes.length&&<p>The latest task matches your draft.</p>}
  <ul>{changes.map(c=><li key={c.key}><h4>{c.label}</h4><dl><dt>Your draft</dt><dd>{value(c.key,draft[c.key])}</dd><dt>Latest saved</dt><dd>{value(c.key,latest[c.key])}</dd></dl>{c.conflict?<label>Keep for {c.label}<select value={choices[c.key]||''} onChange={e=>onChoice(c.key,e.target.value as 'draft'|'latest')}><option value="" disabled>Choose a version</option><option value="draft">My draft</option><option value="latest">Latest saved</option></select></label>:<p className="planning-hint">{c.draftChanged?'Your change will be kept.':'Your teammate’s change will be kept.'}</p>}</li>)}</ul>
  <div className="planning-toolbar"><button type="button" onClick={onCancel}>Back to my draft</button><button type="button" disabled={unresolved} onClick={onApply}>Apply reviewed version</button></div>
  <p className="planning-hint">Nothing is saved until you select Save. A newer teammate change will be checked again.</p>
 </section>;
}
