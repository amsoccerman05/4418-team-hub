import type {Context,Group,Item} from './service';
export function planGroups(data:Context):{group:Group|null;items:Item[]}[]{
 const sortItems=(items:Item[])=>[...items].sort((a,b)=>a.display_order-b.display_order||a.start_date.localeCompare(b.start_date)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
 const groups=[...data.groups].sort((a,b)=>a.display_order-b.display_order||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 return [...groups.map(group=>({group,items:sortItems(data.items.filter(i=>i.group_id===group.id))})),{group:null,items:sortItems(data.items.filter(i=>!groups.some(g=>g.id===i.group_id)))}];
}
export const nextOrder=(rows:{display_order:number}[])=>Math.min(2147483647,Math.max(-1,...rows.map(r=>r.display_order||0))+1);
