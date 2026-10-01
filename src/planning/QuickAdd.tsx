import {useEffect,useRef,useState} from 'react';
export function QuickAdd({kind,onAdd,hint}:{kind:'item'|'task';onAdd:(title:string)=>Promise<void>;hint?:string}){
 const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const trigger=useRef<HTMLButtonElement>(null),saving=useRef(false),wasOpen=useRef(false);
 useEffect(()=>{if(!open&&wasOpen.current)trigger.current?.focus();wasOpen.current=open;},[open]);
 function close(){setOpen(false);setTitle('');setError('');}
 return <div className="planning-quick-add"><button ref={trigger} hidden={open} onClick={()=>setOpen(true)}>+ Add {kind}</button>{open&&<form onSubmit={async e=>{e.preventDefault();if(saving.current||!title.trim())return;saving.current=true;setBusy(true);setError('');try{await onAdd(title.trim());close();}catch(e){setError((e as Error).message);}finally{saving.current=false;setBusy(false);}}} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();close();}}}>
 <label>{kind==='task'?'Task title':'Item title'}<input autoFocus required maxLength={200} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>{hint&&<small>{hint}</small>}{error&&<p role="alert">{error}</p>}<div className="planning-toolbar"><button className="planning-primary" disabled={busy||!title.trim()}>{busy?'Adding…':'Add'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div></form>}</div>;
}
