import {useEffect,useRef,useState} from 'react';
import {Home,ListTodo,Factory,CalendarDays,Megaphone,Users,Handshake,Package,Wrench,Wallet,ExternalLink,Menu,X} from 'lucide-react';
import {systems,resources} from './links';
import {eventDrafts} from './events/event-config';
import {supabase} from './attendance/service';
import './hub-shell.css';
export function HubNav({route}:{route:string}){
 const [open,setOpen]=useState(false),[manager,setManager]=useState(false),[inviter,setInviter]=useState(false),[outreach,setOutreach]=useState(false),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!supabase)return;let alive=true,version=0;const clear=()=>{setManager(false);setInviter(false);setOutreach(false);};
 const update=(uid?:string)=>{const current=++version;clear();if(!uid)return;setTimeout(()=>{void Promise.resolve(supabase!.from('profiles').select('role,active').eq('id',uid).single()).then(result=>{if(!alive||version!==current)return;const p=result.data;if(result.error||!p?.active)return;setManager(['mentor','admin'].includes(p.role));setInviter(['admin_lead','mentor','admin'].includes(p.role));setOutreach(['student','lead','admin_lead','mentor','admin'].includes(p.role));}).catch(()=>{});},0);};
 const sub=supabase.auth.onAuthStateChange((_e,session)=>update(session?.user.id));
 // Initial getSession is guarded against a newer auth notification.
 const initial=version;void supabase.auth.getSession().then(({data})=>{if(alive&&version===initial)update(data.session?.user.id);}).catch(()=>{});
 return()=>{alive=false;version++;sub.data.subscription.unsubscribe();};},[]);
 useEffect(()=>setOpen(false),[route]);
 const local=[{name:'My 4418',href:'#',icon:Home,current:!route||route==='#'||route==='#main'},...(eventDrafts.length?[{name:'Events',href:'#events',icon:CalendarDays,current:route==='#events'||route.startsWith('#events/')}]:[]),{name:'Attendance',href:'#attendance',icon:CalendarDays,current:route.startsWith('#attendance')},{name:'Announcements',href:manager?'#announcements':'#home-announcements',icon:Megaphone,current:route==='#announcements'||route==='#home-announcements'},...(outreach?[{name:'Sponsor & Outreach',href:'#outreach',icon:Handshake,current:route==='#outreach'||route.startsWith('#outreach/')}]:[]),...(inviter?[{name:manager?'Team Management':'Team Operations',href:'#team-management',icon:Users,current:route==='#team-management'}]:[])];
 const icons={inventory:Package,pit:Wrench,finance:Wallet};
 return <aside className="hub-nav" data-open={open} onKeyDown={e=>{if(e.key==='Escape'&&open){setOpen(false);button.current?.focus();}}}><button ref={button} className="hub-menu" aria-expanded={open} aria-controls="hub-workspace-nav" onClick={()=>setOpen(!open)}>{open?<X size={18}/>:<Menu size={18}/>}Hub menu</button><nav id="hub-workspace-nav" aria-label="Hub workspace" onClick={e=>{if((e.target as Element).closest('a'))setOpen(false);}}><span className="hub-nav-label">Team</span>{local.map(l=><a key={l.name} href={l.href} aria-current={l.current?'page':undefined}><l.icon size={18}/>{l.name}</a>)}<span className="hub-nav-label">Systems</span><a href="#planning"><ListTodo size={18}/>Planning</a><a href="#fabrication" aria-current={route==='#fabrication'||route.startsWith('#fabrication/')?'page':undefined}><Factory size={18}/>Fabrication</a>{systems.filter(l=>l.id!=='attendance').map(l=>{const Icon=icons[l.id as keyof typeof icons];return <a key={l.id} href={l.url!}><Icon size={18}/>{l.name}</a>;})}<span className="hub-nav-label">Resources</span>{resources.filter(l=>l.url).map(l=><a key={l.id} href={l.url!} target="_blank" rel="noopener noreferrer"><ExternalLink size={18}/>{l.name}</a>)}<div className="hub-nav-meta">4418 IMPULSE<small>One team. Connected.</small></div></nav></aside>;
}
