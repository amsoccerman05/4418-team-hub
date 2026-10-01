import type {Context,Group,Item} from './service';
import {localDate,planStatuses} from './service';
import {planGroups} from './plan-groups';
import {QuickAdd} from './QuickAdd';
export function SeasonTable({data,editable,busy,onItem,onGroup,onBoard,onAdd,onOrder}:{data:Context;editable:boolean;busy:boolean;onItem:(i:Item)=>void;onGroup:(g:Group)=>void;onBoard:(id:string)=>void;onAdd:(title:string,group:string|null)=>Promise<void>;onOrder:(g:Group,edge:'top'|'bottom')=>void}){
 const groups=planGroups(data);
 return <div className="planning-season-table">{groups.map(({group,items},n)=><section key={group?.id||'ungrouped'} className="planning-plan-group">
 <details open><summary>{group?.name||'Ungrouped'}{group&&!group.active?' · Archived':''} <span className="planning-badge">{items.length}</span></summary>
 {editable&&group&&<div className="planning-group-actions"><button onClick={()=>onGroup(group)}>Group settings</button><button disabled={busy||n===0} onClick={()=>onOrder(group,'top')}>Move to top</button><button disabled={busy||n===groups.length-2} onClick={()=>onOrder(group,'bottom')}>Move to bottom</button></div>}
 {items.length>0&&<div className="planning-table-scroll"><table><thead><tr>{['Item','Owner / Area','Status','Timeline','Linked Board'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{items.map(i=><tr key={i.id} data-item-id={i.id}><td><button onClick={()=>onItem(i)}>{i.kind==='milestone'?'◆ ':''}{i.title}</button></td><td>{data.members.find(m=>m.id===i.owner_id)?.name||'Unassigned'}{i.area_id&&<small>{data.areas.find(a=>a.id===i.area_id)?.name}</small>}</td><td><span className="planning-badge">{planStatuses[i.status as keyof typeof planStatuses]}</span></td><td>{i.start_date}{i.kind!=='milestone'&&<> → {i.end_date}</>}</td><td>{i.board_id?<button onClick={()=>onBoard(i.board_id!)}>{data.boards.find(b=>b.id===i.board_id)?.name||'Board'} →</button>:'—'}</td></tr>)}</tbody></table></div>}
 {!items.length&&<p className="planning-hint">No items in this group yet.</p>}{editable&&(!group||group.active)&&<QuickAdd kind="item" hint={`Starts and ends today (${localDate()}). Edit the timeline after adding.`} onAdd={title=>onAdd(title,group?.id||null)}/>}
 </details></section>)}</div>;
}
