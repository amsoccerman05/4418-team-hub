import {BoardSummary} from './BoardSummary';
import {localDate,workGroup,taskStatuses,type Context,type Season,type Task} from './service';
export function PlanningDashboard({data,season,onTask,onBoard}:{data:Context;season:Season;onTask:(t:Task)=>void;onBoard:(id:string)=>void}){
 const today=localDate(),boards=data.boards.filter(b=>b.active),tasks=data.tasks.filter(t=>boards.some(b=>b.id===t.board_id));
 const unfinished=tasks.filter(t=>t.status!=='done'),overdue=unfinished.filter(t=>!!t.due_date&&t.due_date<today),blocked=unfinished.filter(t=>t.status==='blocked');
 const mine=unfinished.filter(t=>t.owner_ids.includes(data.user_id)),milestones=data.items.filter(i=>i.kind==='milestone'&&i.start_date>=today&&i.status!=='done').sort((a,b)=>a.start_date.localeCompare(b.start_date)).slice(0,5);
 const attention=[...new Map([...overdue,...blocked].map(t=>[t.id,t])).values()].sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
 return <div className="planning-dashboard">
 <section className="planning-card planning-season-hero"><h2>{season.status==='active'?'Active season':'Selected season'}</h2><strong>{season.name}</strong><span className="planning-badge">{season.status}</span>{(season.start_date||season.end_date)&&<p>{season.start_date||'Start date not set'} → {season.end_date||'Target date not set'}</p>}<a href="#planning/plan">Open Season Plan →</a></section>
 <section className="planning-card"><h2>Work status</h2>{tasks.length?<dl className="planning-counts">{(['todo','in_progress','blocked','done'] as const).map(s=><div key={s}><dt>{taskStatuses[s]}</dt><dd>{tasks.filter(t=>t.status===s).length}</dd></div>)}</dl>:<p>No tasks yet. Add work to a board when you’re ready.</p>}</section>
 {!!attention.length&&<section className="planning-card planning-attention"><h2>Needs attention</h2><p>{overdue.length} overdue · {blocked.length} blocked</p><ul>{attention.map(t=><li key={t.id}><button onClick={()=>onTask(t)}>{t.title}</button><span>{t.due_date&&t.due_date<today?'Overdue':''}{t.status==='blocked'?`${t.due_date&&t.due_date<today?' · ':''}Blocked`:''}</span></li>)}</ul></section>}
 {mine.length>0&&<section className="planning-card"><h2>My Work</h2><p>{mine.filter(t=>workGroup(t,today)==='Overdue').length} overdue · {mine.filter(t=>workGroup(t,today)==='Today').length} due today · {mine.filter(t=>workGroup(t,today)==='This week').length} due this week</p><a href="#planning/my-work">Open My Work →</a></section>}
 {milestones.length>0&&<section className="planning-card planning-milestones"><h2>Upcoming milestones</h2><ul>{milestones.map((i,n)=><li key={i.id}><span>{n===0&&<small className="planning-eyebrow">Next milestone</small>}<span>{i.title}</span></span><time dateTime={i.start_date}>{i.start_date}</time></li>)}</ul><a href="#planning/plan">View Season Plan →</a></section>}
 {boards.length>0&&<section className="planning-dashboard-boards"><h2>Boards</h2><div className="planning-grid">{boards.map(b=><BoardSummary key={b.id} board={b} tasks={tasks.filter(t=>t.board_id===b.id)} area={data.areas.find(a=>a.id===b.area_id)?.name} onOpen={()=>onBoard(b.id)}/>)}</div></section>}
 </div>;
}
