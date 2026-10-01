import {useState} from 'react';
import type {Context,Item} from './service';
import {localDate,planStatuses} from './service';
const day=86400000;
const stamp=(s:string)=>Date.parse(s+'T00:00:00Z');
export function Gantt({data,onOpen,onBoard}:{data:Context;onOpen:(i:Item)=>void;onBoard:(id:string)=>void}){
 const [scale,setScale]=useState('week');
 const groups=[...data.groups].sort((a,b)=>a.display_order-b.display_order);
 const items=[...data.items].sort((a,b)=>groups.findIndex(g=>g.id===a.group_id)-groups.findIndex(g=>g.id===b.group_id)||a.display_order-b.display_order||a.start_date.localeCompare(b.start_date));
 if(!items.length)return <p className="planning-empty">Start with the season’s major work and milestones. Detailed tasks belong on boards.</p>;
 const start=Math.min(...items.map(i=>stamp(i.start_date)))-day*2,end=Math.max(...items.map(i=>stamp(i.end_date)))+day*3;
 const days=Math.round((end-start)/day),unit=scale==='day'?34:14,width=Math.max(600,days*unit),height=items.length*52+40;
 const x=(d:string)=>(stamp(d)-start)/day*unit;
 const now=x(localDate());
 return <><label className="planning-scale">Timeline scale<select value={scale} onChange={e=>setScale(e.target.value)}><option value="week">Weeks</option><option value="day">Days</option></select></label><div className="planning-gantt" tabIndex={0} role="region" aria-label="Season Gantt; scroll horizontally for dates"><div style={{width:width+220,minWidth:'100%',position:'relative',height}}>
 <div className="planning-gantt-labels"><div className="planning-axis">Season plan</div>{items.map(i=><div key={i.id} className={`planning-gantt-label ${i.kind}`}><button onClick={()=>onOpen(i)}>{i.kind==='milestone'?'◆ ':''}{i.title}</button><small>{groups.find(g=>g.id===i.group_id)?.name||'Ungrouped'}{i.board_id&&<> · <button onClick={()=>onBoard(i.board_id!)}>Board →</button></>}</small></div>)}</div>
 <div className="planning-timeline" style={{left:220,width,height}}>
 <svg width={width} height={height} aria-hidden="true" className="planning-lines"><defs><marker id="plan-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="currentColor"/></marker></defs>{items.map((i,n)=>{const p=items.findIndex(p=>p.id===i.predecessor_id);if(p<0)return null;const a=x(items[p].end_date)+unit,b=x(i.start_date);return <path key={i.id} d={`M${a} ${p*52+66} H${a+8} V${n*52+66} H${b}`} fill="none" stroke="currentColor" markerEnd="url(#plan-arrow)"/>;})}</svg>
 {Array.from({length:Math.ceil(days/(scale==='day'?1:7))},(_,n)=>{const d=n*(scale==='day'?1:7);return <span key={n} className="planning-tick" style={{left:d*unit,height}}>{new Date(start+d*day).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})}</span>;})}
 {now>=0&&now<=width&&<span className="planning-today" style={{left:now,height}} aria-label="Today"><span>Today</span></span>}
 {items.map((i,n)=><button key={i.id} className={`planning-bar ${i.kind} ${i.status}`} style={{top:n*52+48,left:x(i.start_date),width:i.kind==='milestone'?24:Math.max(28,x(i.end_date)-x(i.start_date)+unit)}} title={`${i.title}: ${i.start_date} – ${i.end_date}; ${planStatuses[i.status as keyof typeof planStatuses]}${i.predecessor_id?'; after '+items.find(p=>p.id===i.predecessor_id)?.title:''}`} onClick={()=>onOpen(i)} aria-label={`Edit ${i.title}`}>{i.kind==='milestone'?'◆':i.title}</button>)}
 </div></div></div><p className="planning-hint">Arrows show finish-to-start dependencies. Dates change only when you edit them.</p></>;
}
