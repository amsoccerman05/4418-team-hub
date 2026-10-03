import {useEffect,useRef,useState} from 'react';
import type {Named,Owner} from './service';
export function OwnerSummary({owners,full=false}:{owners:Owner[];full?:boolean}){
 const names=owners.map(o=>o.name+(o.active===false?' (inactive)':'')),text=names.join(' · ')||'Unassigned';
 return <span className="planning-owner-summary" title={text} aria-label={text}>{!full&&names.length>2?`${names[0]} +${names.length-1}`:text}</span>;
}
export function OwnerPicker({label,ids,owners,members,disabled=false,full=false,onSave}:{label:string;ids:string[];owners:Owner[];members:Named[];disabled?:boolean;full?:boolean;onSave:(ids:string[])=>Promise<boolean|undefined>}){
 const [open,setOpen]=useState(false),[picked,setPicked]=useState<string[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const trigger=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const choices=[...owners,...members].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
 const selected=(set:string[])=>set.map(id=>choices.find(m=>m.id===id)||{id,name:'Team member'});
 useEffect(()=>{if(open){dialog.current?.showModal();input.current?.focus();}},[open]);
 useEffect(()=>{if(open&&!busy&&error)setPicked(ids);},[ids,open,busy,error]);
 function close(){dialog.current?.close();setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
 function begin(){setPicked(ids);setSearch('');setError('');setOpen(true);}
 return <div className="planning-owners">
 {full&&<OwnerSummary full owners={selected(ids)}/>}
 <button ref={trigger} type="button" disabled={disabled} aria-label={label} aria-haspopup="dialog" onClick={begin}>{full?'+ Add / edit owners':<OwnerSummary owners={selected(ids)}/>}</button>
 {open&&<dialog ref={dialog} className="planning-owner-dialog" aria-label={label} onKeyDown={e=>{if(e.key==='Enter'&&(e.target as HTMLElement).tagName!=='BUTTON'){e.preventDefault();e.stopPropagation();}}} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)close();}}>
 <h3>Owners</h3><p className="planning-hint">Everyone selected shares this task.</p>
 {error&&<p role="alert">{error}</p>}
 <div className="planning-owner-chips">{selected(picked).map(m=><span key={m.id}>{m.name}<button type="button" disabled={busy} aria-label={`Remove ${m.name} as owner`} onClick={()=>setPicked(p=>p.filter(id=>id!==m.id))}>×</button></span>)}</div>
 <label>Search members<input ref={input} type="search" value={search} disabled={busy} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}}/></label>
 <div className="planning-owner-options">{members.filter(m=>m.name.toLowerCase().includes(search.toLowerCase())).map(m=><label key={m.id}><input type="checkbox" disabled={busy} checked={picked.includes(m.id)} onChange={e=>setPicked(p=>e.target.checked?[...p,m.id]:p.filter(id=>id!==m.id))}/>{m.name}</label>)}{!members.some(m=>m.name.toLowerCase().includes(search.toLowerCase()))&&<p>No matching active members.</p>}</div>
 <div className="planning-toolbar"><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="button" className="planning-primary" disabled={busy} onClick={async()=>{setBusy(true);try{if(await onSave(picked))close();else{setPicked(ids);setError('Owners were not saved. Review the current assignment and try again.');}}catch(e){setPicked(ids);setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'Saving…':'Apply owners'}</button></div>
 </dialog>}
 </div>;
}
