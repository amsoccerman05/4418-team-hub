import {useEffect,useRef,useState} from 'react';
export function QuickAdd({kind,onAdd,hint}:{kind:'item'|'task';onAdd:(title:string)=>Promise<void>;hint?:string}){
 const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),saving=useRef(false),wasOpen=useRef(false);
 useEffect(()=>{if(open&&!busy)input.current?.focus();},[open,busy]);
 useEffect(()=>{if(!open&&wasOpen.current)trigger.current?.focus();wasOpen.current=open;},[open]);
 function close(){setOpen(false);setTitle('');setError('');setSaved('');}
 return <div className="planning-quick-add"><button ref={trigger} hidden={open} onClick={()=>setOpen(true)}>+ Add {kind}</button>{open&&<form onSubmit={async e=>{e.preventDefault();if(saving.current||!title.trim())return;saving.current=true;setBusy(true);setError('');setSaved('');try{await onAdd(title.trim());setSaved(`${kind==='task'?'Task':'Item'} added: ${title.trim()}`);setTitle('');}catch(e){setError((e as Error).message);}finally{saving.current=false;setBusy(false);}}} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();close();}}}>
 <label>{kind==='task'?'Task title':'Item title'}<input ref={input} autoFocus required maxLength={200} value={title} disabled={busy} onChange={e=>{setTitle(e.target.value);setSaved('');}}/></label>{hint&&<small>{hint}</small>}{error&&<p className="planning-error" role="alert">{error}</p>}{!error&&(busy||saved)&&<p className="planning-quick-feedback" role="status">{busy?`Adding ${kind}…`:saved}</p>}<div className="planning-toolbar"><button className="planning-primary" disabled={busy||!title.trim()}>{busy?'Adding…':'Add'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div></form>}</div>;
}
