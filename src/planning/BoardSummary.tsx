import {ContextActions} from './ContextActions';
import type {Context,Task} from './service';
export function BoardSummary({board,tasks,area,onOpen,onEdit}:{board:Context['boards'][number];tasks:Task[];area?:string;onOpen:()=>void;onEdit?:()=>void}){
 const done=tasks.filter(t=>t.status==='done').length,blocked=tasks.filter(t=>t.status==='blocked').length;
 return <article className="planning-card planning-board-card"><button className="planning-board-open" aria-label={board.name} onClick={onOpen}><span className="planning-eyebrow">{board.kind==='area'?'Functional Area':'Project'}{!board.active?' · Archived':''}</span><strong>{board.name}</strong>{area&&<small>{area}</small>}{board.description&&<span className="planning-board-description">{board.description}</span>}<span className="planning-board-progress"><span>{done} / {tasks.length} tasks complete</span>{blocked>0&&<span className="planning-badge">{blocked} blocked</span>}</span><progress aria-label={`${board.name} tasks complete`} value={done} max={tasks.length||1}/></button>{onEdit&&<ContextActions label={`Actions for ${board.name}`}><button onClick={onEdit}>Board settings</button></ContextActions>}</article>;
}
