import {useEffect,useRef,useState} from 'react';
import {LayoutDashboard,ChartNoAxesGantt,Columns3,ListTodo,Home,Menu,X} from 'lucide-react';
export function PlanningNav({route}:{route:string}){
 const [open,setOpen]=useState(false),button=useRef<HTMLButtonElement>(null);
 const tab=route.split('/')[1]||'dashboard';
 useEffect(()=>setOpen(false),[route]);
 return <aside className="hub-nav planning-nav" data-open={open} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}}}>
 <button ref={button} className="hub-menu" aria-expanded={open} aria-controls="planning-workspace-nav" onClick={()=>setOpen(!open)}>{open?<X size={18}/>:<Menu size={18}/>}Planning menu</button>
 <nav id="planning-workspace-nav" aria-label="Planning workspace" onClick={e=>{if((e.target as Element).closest('a'))setOpen(false);}}><span className="hub-nav-label">Planning</span>
 {[{id:'dashboard',name:'Dashboard',icon:LayoutDashboard},{id:'plan',name:'Season Plan',icon:ChartNoAxesGantt},{id:'boards',name:'Boards',icon:Columns3},{id:'my-work',name:'My Work',icon:ListTodo}].map(l=><a key={l.id} href={l.id==='dashboard'?'#planning':`#planning/${l.id}`} aria-current={tab===l.id?'page':undefined}><l.icon size={18}/>{l.name}</a>)}
 <a className="hub-nav-return" href="#"><Home size={18} aria-hidden="true"/>Team Hub / Home</a><div className="hub-nav-meta">4418 IMPULSE<small>One team. Connected.</small></div></nav></aside>;
}
