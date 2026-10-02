import {useState} from 'react';
import {changeDependency,type Context,type Task} from './service';
export function DependencyHint({task,data}:{task:Task;data:Context}){
 const deps=(data.dependencies||[]).filter(d=>d.successor_task_id===task.id),waiting=deps.filter(d=>data.tasks.find(t=>t.id===d.predecessor_task_id)?.status!=='done');
 return deps.length?<small className="planning-dependency" title={deps.map(d=>'After '+(data.tasks.find(t=>t.id===d.predecessor_task_id)?.title||'Task')).join('; ')}>{waiting.length?`Waiting on ${waiting.length} task${waiting.length===1?'':'s'}`:'Dependencies complete'}</small>:null;
}
export function TaskDependencies({task,data,editable,onChanged}:{task:Task;data:Context;editable:boolean;onChanged:()=>Promise<void>}){
 const [selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const deps=(data.dependencies||[]).filter(d=>d.successor_task_id===task.id);
 const eligible=data.tasks.filter(t=>t.board_id===task.board_id&&t.id!==task.id&&!deps.some(d=>d.predecessor_task_id===t.id));
 async function mutate(action:'add'|'remove',id:string){setBusy(true);setError('');try{await changeDependency(action,action==='add'?{predecessor:id,successor:task.id}:{dependency_id:id});setSelected('');await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="planning-dependencies"><h3>Depends on</h3><p className="planning-hint">Finish these tasks first. Dates and statuses stay under your control.</p>{error&&<p role="alert">{error}</p>}<ul className="planning-detail-list">{deps.map(d=><li key={d.id}>{data.tasks.find(t=>t.id===d.predecessor_task_id)?.title||'Task'}{editable&&<button disabled={busy} aria-label={`Remove dependency on ${data.tasks.find(t=>t.id===d.predecessor_task_id)?.title||'Task'}`} onClick={()=>void mutate('remove',d.id)}>Remove</button>}</li>)}</ul>{!deps.length&&<p>No dependencies.</p>}{editable&&<form onSubmit={e=>{e.preventDefault();if(selected)void mutate('add',selected);}}><label>Depends on<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">Choose a task</option>{eligible.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><button disabled={busy||!selected}>Add dependency</button></form>}</section>;
}
