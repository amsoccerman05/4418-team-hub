import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,X,RefreshCw,CheckCheck} from 'lucide-react';
import {fetchNotifications,setRead,safeTarget,type Notice,type Center,type Filter} from './service';
import './notifications.css';
const empty:Center={unread:0,attention:[],items:[],has_more:false};
const State=createContext<{data:Center;error:string;busy:boolean;revision:number;refresh:()=>Promise<void>;mark:(id:string|null,unread?:boolean)=>Promise<void>}>(null!);
export function NotificationProvider({children}:{children:ReactNode}){
 const [data,setData]=useState(empty),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const generation=useRef(0),mounted=useRef(true),mutating=useRef(false);
 async function refresh(){const n=++generation.current;try{const c=await fetchNotifications();if(mounted.current&&n===generation.current){setData(c);setError('');setRevision(v=>v+1);}}catch{if(mounted.current&&n===generation.current)setError('Notifications are unavailable. Try again.');}}
 async function mark(id:string|null,unread=false){if(mutating.current)return;mutating.current=true;setBusy(true);try{await setRead(id,unread);await refresh();}catch{if(mounted.current)setError('Read status was not saved. Try again.');}finally{mutating.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},120000);return()=>{mounted.current=false;generation.current++;clearInterval(timer);};},[]);
 return <State.Provider value={{data,error,busy,revision,refresh,mark}}>{children}</State.Provider>;
}
const sources={finance:'Finance',attendance:'Attendance',announcements:'Announcements'};
function Rows({items,onOpen}:{items:Notice[];onOpen?:()=>void}){const {mark,busy}=useContext(State);return <ul className="notification-list">{items.map(n=><li key={n.id} data-read={!!n.read_at}>
 <div className="notification-meta"><span className="notification-source">{sources[n.source]}</span><time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time></div>
 <a href={safeTarget(n.href)} onClick={()=>{void mark(n.id);onOpen?.();}}>{n.title}</a><p>{n.message}</p>
 <div className="notification-actions"><span>{n.read_at?'Read':'Unread'}</span>{n.action_needed&&<strong>Action needed</strong>}<button disabled={busy} onClick={()=>void mark(n.id,!!n.read_at)}>{n.read_at?'Mark unread':'Mark read'}</button></div>
 </li>)}</ul>;}
export function NotificationBell(){const {data,error,busy,refresh,mark}=useContext(State);const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;close.current?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 const attention=data.attention;const recent=data.items.filter(n=>!attention.some(a=>a.id===n.id)).slice(0,5);
 return <div className="notification-bell" ref={root}><button ref={button} aria-label={`Notifications${data.unread?`, ${data.unread} unread`:''}`} aria-expanded={open} aria-controls="notification-panel" onClick={()=>{setOpen(!open);if(!open)void refresh();}}><Bell size={20} aria-hidden="true"/>{data.unread>0&&<span className="notification-count" aria-hidden="true">{data.unread>99?'99+':data.unread}</span>}</button>
 {open&&<section id="notification-panel" className="notification-panel" aria-label="Recent notifications"><div className="notification-toolbar"><h2>Notifications</h2><button ref={close} aria-label="Close notifications" onClick={()=>{setOpen(false);button.current?.focus();}}><X size={18}/></button></div>
 {error&&<p role="alert">{error}</p>}<div className="notification-toolbar"><button disabled={busy||!data.unread} onClick={()=>void mark(null)}>Mark all read</button><button onClick={()=>void refresh()}>Refresh</button></div>
 {attention.length>0&&<><h3>Needs your attention</h3><Rows items={attention} onOpen={()=>setOpen(false)}/></>}{recent.length>0&&<><h3>Recent</h3><Rows items={recent} onOpen={()=>setOpen(false)}/></>}{!attention.length&&!recent.length&&!error&&<p>You’re all caught up.</p>}
 <a className="notification-view-all" href="#notifications" onClick={()=>setOpen(false)}>View all notifications</a></section>}
 </div>;
}
export function Notifications(){const {revision,busy,mark,refresh,error:sharedError}=useContext(State);const [filter,setFilter]=useState<Filter>(location.hash==='#notifications/action'?'action':'all'),[items,setItems]=useState<Notice[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');const generation=useRef(0);
 async function load(append=false){const n=++generation.current;setLoading(true);setError('');try{const c=await fetchNotifications(filter,append?items.at(-1):undefined);if(n===generation.current){setItems(old=>append?[...old,...c.items.filter(x=>!old.some(o=>o.id===x.id))]:c.items);setMore(c.has_more);}}catch{if(n===generation.current)setError('Notifications are unavailable. Try again.');}finally{if(n===generation.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[filter,revision]);
 return <section className="notifications-page"><div className="notification-toolbar notification-page-heading"><div><span className="workspace-eyebrow">Team workspace</span><h1>Notifications</h1><p className="notification-description">Updates and follow-ups across your team.</p></div><div className="notification-page-actions"><button onClick={()=>void refresh()}><RefreshCw size={16} aria-hidden="true"/>Refresh</button><button disabled={busy} onClick={()=>void mark(null)}><CheckCheck size={16} aria-hidden="true"/>Mark all read</button></div></div>
 <nav aria-label="Notification filters" className="notification-filters">{(['all','unread','action'] as const).map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='all'?'All':f==='unread'?'Unread':'Action needed'}</button>)}</nav>
 <p className="notification-help">Read means you’ve seen it. Action needed stays until the work is handled.</p>
 {(error||sharedError)&&<p role="alert">{error||sharedError}</p>}{loading&&<p role="status">Loading notifications…</p>}<Rows items={items}/>{!loading&&!error&&!items.length&&<p className="notification-empty"><CheckCheck size={24} aria-hidden="true"/>{filter==='action'?'Nothing needs your attention.':filter==='unread'?'You’re all caught up.':'No notifications yet.'}</p>}
 {more&&<button disabled={loading} onClick={()=>void load(true)}>Load more</button>}</section>;
}
