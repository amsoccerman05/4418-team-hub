import {useEffect,useRef,useState} from 'react';
import {Home,CalendarDays,Megaphone,Users,Package,Wrench,Wallet,ExternalLink,Menu,X} from 'lucide-react';
import {systems,resources} from './links';
import {supabase} from './attendance/service';
import './hub-shell.css';
export function HubNav({route}:{route:string}){
 const [open,setOpen]=useState(false),[manager,setManager]=useState(false),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{let alive=true;void supabase?.auth.getSession().then(async({data})=>{if(!data.session)return;const result=await supabase!.from('profiles').select('role,active').eq('id',data.session.user.id).single();if(alive)setManager(!!result.data?.active&&['mentor','admin'].includes(result.data.role));}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>setOpen(false),[route]);
 const local=[{name:'My 4418',href:'#',icon:Home,current:!route||route==='#'||route==='#main'},{name:'Attendance',href:'#attendance',icon:CalendarDays,current:route.startsWith('#attendance')},{name:'Announcements',href:manager?'#announcements':'#home-announcements',icon:Megaphone,current:route==='#announcements'||route==='#home-announcements'},...(manager?[{name:'Team Management',href:'#team-management',icon:Users,current:route==='#team-management'}]:[])];
 const icons={inventory:Package,pit:Wrench,finance:Wallet};
 return <aside className="hub-nav" data-open={open} onKeyDown={e=>{if(e.key==='Escape'&&open){setOpen(false);button.current?.focus();}}}><button ref={button} className="hub-menu" aria-expanded={open} aria-controls="hub-workspace-nav" onClick={()=>setOpen(!open)}>{open?<X size={18}/>:<Menu size={18}/>}Hub menu</button><nav id="hub-workspace-nav" aria-label="Hub workspace" onClick={e=>{if((e.target as Element).closest('a'))setOpen(false);}}><span className="hub-nav-label">Team</span>{local.map(l=><a key={l.name} href={l.href} aria-current={l.current?'page':undefined}><l.icon size={18}/>{l.name}</a>)}<span className="hub-nav-label">Systems</span>{systems.filter(l=>l.id!=='attendance').map(l=>{const Icon=icons[l.id as keyof typeof icons];return <a key={l.id} href={l.url!}><Icon size={18}/>{l.name}</a>;})}<span className="hub-nav-label">Resources</span>{resources.filter(l=>l.url).map(l=><a key={l.id} href={l.url!} target="_blank" rel="noopener noreferrer"><ExternalLink size={18}/>{l.name}</a>)}<div className="hub-nav-meta">4418 IMPULSE<small>One team. Connected.</small></div></nav></aside>;
}
