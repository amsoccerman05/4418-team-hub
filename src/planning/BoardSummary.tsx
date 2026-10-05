import {ArrowUpRight, Layers3, Users} from 'lucide-react';
import {ContextActions} from './ContextActions';
import type {Context,Task} from './service';
export function BoardSummary({board,tasks,area,onOpen,onEdit}:{board:Context['boards'][number];tasks:Task[];area?:string;onOpen:()=>void;onEdit?:()=>void}){
 const done=tasks.filter(t=>t.status==='done').length,blocked=tasks.filter(t=>t.status==='blocked').length;
 const Icon=board.kind==='area'?Users:Layers3;
 return <article className={`planning-card planning-board-card ${!board.active?'is-archived':''}`}><button className="planning-board-open" aria-label={board.name} onClick={onOpen}>
  <span className="planning-board-icon"><Icon size={20} aria-hidden="true"/></span>
  <span className="planning-eyebrow">{board.kind==='area'?'Functional Area':'Project'}{!board.active?' · Archived':''}</span>
  <strong>{board.name}</strong>{area&&<small>{area}</small>}
  <span className="planning-board-description">{board.description||(board.kind==='area'?'Ongoing team responsibilities and assignments.':'Tasks, owners, and progress in one place.')}</span>
  <span className="planning-board-progress"><span>{done} / {tasks.length} tasks complete</span>{blocked>0?<span className="planning-badge planning-blocked-badge">{blocked} blocked</span>:<ArrowUpRight size={16} aria-hidden="true"/>}</span>
  <progress aria-label={`${board.name} tasks complete`} value={done} max={tasks.length||1}/>
 </button>{onEdit&&<ContextActions label={`Actions for ${board.name}`}><button onClick={onEdit}>Board settings</button></ContextActions>}</article>;
}
