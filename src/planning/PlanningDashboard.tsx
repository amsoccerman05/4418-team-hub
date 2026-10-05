import {ArrowUpRight, CalendarDays, CheckCircle2, CircleAlert, Flag, ListTodo} from 'lucide-react';
import {BoardSummary} from './BoardSummary';
import {localDate,workGroup,taskStatuses,type Context,type Season,type Task} from './service';
export function PlanningDashboard({data,season,onTask,onBoard}:{data:Context;season:Season;onTask:(t:Task)=>void;onBoard:(id:string)=>void}){
 const today=localDate(),boards=data.boards.filter(b=>b.active),tasks=data.tasks.filter(t=>boards.some(b=>b.id===t.board_id));
 const unfinished=tasks.filter(t=>t.status!=='done'),overdue=unfinished.filter(t=>!!t.due_date&&t.due_date<today),blocked=unfinished.filter(t=>t.status==='blocked');
 const mine=unfinished.filter(t=>t.owner_ids.includes(data.user_id)),milestones=data.items.filter(i=>i.kind==='milestone'&&i.start_date>=today&&i.status!=='done').sort((a,b)=>a.start_date.localeCompare(b.start_date)).slice(0,5);
 const attention=[...new Map([...overdue,...blocked].map(t=>[t.id,t])).values()].sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
 const done=tasks.length-unfinished.length;
 return <div className="planning-dashboard">
 <section className="planning-card planning-season-hero">
  <div className="planning-card-heading"><h2>{season.status==='active'?'Active season':'Selected season'}</h2><CalendarDays size={20} aria-hidden="true"/></div>
  <strong>{season.name}</strong><span className={`planning-badge season-${season.status}`}>{season.status}</span>
  {(season.start_date||season.end_date)&&<p>{season.start_date||'Start date not set'} → {season.end_date||'Target date not set'}</p>}
  <div className="planning-season-context-line">{boards.length} active {boards.length===1?'board':'boards'}<span aria-hidden="true">·</span>{data.items.length} plan {data.items.length===1?'item':'items'}</div>
  <a className="planning-card-link" href="#planning/plan">Open Season Plan <ArrowUpRight size={16} aria-hidden="true"/></a>
 </section>
 <section className="planning-card planning-work-status">
  <div className="planning-card-heading"><h2>Work status</h2><span className="planning-metric-note">{done} of {tasks.length} complete</span></div>
  <dl className="planning-counts">{Object.entries(taskStatuses).map(([s,title])=><div key={s} data-status={s}><dt><i aria-hidden="true"/>{title}</dt><dd>{tasks.filter(t=>t.status===s).length}</dd></div>)}</dl>
  {tasks.length?<div className="planning-status-track" aria-hidden="true">{Object.keys(taskStatuses).map(s=><span key={s} data-status={s} style={{flex:tasks.filter(t=>t.status===s).length}}/>)}</div>:<p className="planning-hint">No tasks yet. Add work to a board when you’re ready.</p>}
  <p className="planning-hint">Across active boards in this workspace</p>
 </section>
 <section className={`planning-card planning-attention ${attention.length?'has-attention':'is-clear'}`}>
  <div className="planning-card-heading"><h2><CircleAlert size={18} aria-hidden="true"/>Needs attention</h2><span className="planning-badge">{attention.length}</span></div>
  {attention.length?<><p>{overdue.length} overdue · {blocked.length} blocked</p><ul>{attention.map(t=><li key={t.id}><button onClick={()=>onTask(t)}>{t.title}</button><span className="planning-attention-label">{t.due_date&&t.due_date<today?'Overdue':''}{t.status==='blocked'?`${t.due_date&&t.due_date<today?' · ':''}Blocked`:''}</span></li>)}</ul></>:<div className="planning-quiet-state"><CheckCircle2 size={24} aria-hidden="true"/><strong>No overdue or blocked tasks</strong><p>Your active boards are clear of these blockers.</p></div>}
 </section>
 <section className="planning-card planning-my-work">
  <div className="planning-card-heading"><h2><ListTodo size={18} aria-hidden="true"/>My Work</h2><span className="planning-badge">{mine.length} open</span></div>
  {mine.length?<><strong className="planning-assignment-count">{mine.length}<span>open {mine.length===1?'assignment':'assignments'}</span></strong><p>{mine.filter(t=>workGroup(t,today)==='Overdue').length} overdue · {mine.filter(t=>workGroup(t,today)==='Today').length} due today · {mine.filter(t=>workGroup(t,today)==='This week').length} due this week</p></>:<p className="planning-hint">You’re caught up. Your open assignments will appear here.</p>}
  <a className="planning-card-link" href="#planning/my-work">Open My Work <ArrowUpRight size={16} aria-hidden="true"/></a>
 </section>
 <section className="planning-card planning-milestones">
  <div className="planning-card-heading"><h2><Flag size={18} aria-hidden="true"/>Upcoming milestones</h2></div>
  {milestones.length?<ul>{milestones.map((i,n)=><li key={i.id}><span>{n===0&&<small className="planning-eyebrow">Next milestone</small>}<span>{i.title}</span></span><time dateTime={i.start_date}>{i.start_date}</time></li>)}</ul>:<p className="planning-hint">No upcoming milestones. Season Plan keeps the next important dates in view.</p>}
  <a className="planning-card-link" href="#planning/plan">View Season Plan <ArrowUpRight size={16} aria-hidden="true"/></a>
 </section>
 {boards.length>0&&<section className="planning-dashboard-boards"><div className="planning-section-heading"><div><h2>Boards</h2><p>Focused workspaces for projects and team responsibilities.</p></div><a href="#planning/boards">View all boards <ArrowUpRight size={16} aria-hidden="true"/></a></div><div className="planning-grid">{boards.map(b=><BoardSummary key={b.id} board={b} tasks={tasks.filter(t=>t.board_id===b.id)} area={data.areas.find(a=>a.id===b.area_id)?.name} onOpen={()=>onBoard(b.id)}/>)}</div></section>}
 </div>;
}
