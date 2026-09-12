import {useEffect,useState,type ReactNode} from 'react';
import {supabase,label} from '../attendance/service';
import {context,type Dashboard} from './service';
import './dashboard.css';
import {AnnouncementManager,AnnouncementImage} from './Announcements';
const date=(s:string)=>new Date(s).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const errorText=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Unable to load. Please try again.';
function Card({title,children,href,action}:{title:string;children:ReactNode;href:string;action:string}){return <article className="my-card"><h3>{title}</h3><div className="my-card-body">{children}</div><a className="system-action" href={href}>{action} →</a></article>;}
export function My4418({management=false}:{management?:boolean}){
 const [data,setData]=useState<Dashboard|null>(null),[state,setState]=useState('loading'),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[now,setNow]=useState(Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t);},[]);
 useEffect(()=>{
  if(!supabase){setState('setup');return;}
  let alive=true,generation=0;let timer:ReturnType<typeof setTimeout>;
  const update=(uid?:string)=>{const v=++generation;clearTimeout(timer);setData(null);setError('');setState(uid?'loading':'signed-out');if(!uid)return;
   timer=setTimeout(()=>{if(alive&&v===generation){generation++;setState('error');setError('Dashboard timed out. Please try again.');}},15000);
   setTimeout(()=>{if(!alive||v!==generation)return;void context().then(d=>{if(alive&&v===generation){setData(d);setState('ready');}}).catch(e=>{if(alive&&v===generation){setState(e?.code==='42501'?'denied':'error');setError(errorText(e));}}).finally(()=>{if(v===generation)clearTimeout(timer);});},0);
  };
  timer=setTimeout(()=>{if(alive){generation++;setState('error');setError('Sign-in is taking longer than expected. Try again.');}},15000);
  const sub=supabase.auth.onAuthStateChange((_e,s)=>update(s?.user.id));
  return()=>{alive=false;generation++;clearTimeout(timer);sub.data.subscription.unsubscribe();};
 },[refresh]);
 const activeAnnouncements=data?.announcements.filter(a=>!a.expires_at||Date.parse(a.expires_at)>now)||[];
 return <section className="my-dashboard" aria-labelledby="my-heading"><div className="section-heading"><div><h2 id="my-heading">{management?'Announcements':'My 4418'}</h2><p>{management?'Updates from team leadership.':data?`Welcome, ${data.name}. Here’s what’s next.`:'Your meetings, requests, and team updates.'}</p></div>{management?<a href="#">Team Hub / Home</a>:state==='ready'&&<button onClick={()=>setRefresh(x=>x+1)}>Refresh</button>}</div>
 {state==='loading'?<p className="my-empty" role="status">Loading My 4418…</p>:state==='setup'?<p className="my-empty">Team connection is not configured yet.</p>:state==='signed-out'?<div className="my-empty"><h3>Sign in to My 4418</h3><p>Use your existing Team 4418 account to see your personal dashboard.</p><a className="system-action" href="#attendance">Team sign-in →</a></div>:state==='denied'?<p className="my-empty" role="alert">An active team profile is required. Contact a mentor for access.</p>:state==='error'?<p className="my-empty" role="alert">{error} <button onClick={()=>setRefresh(x=>x+1)}>Try again</button></p>:data&&(management?(data.admin?<AnnouncementManager/>:<p role="alert">Only active mentors and admins can manage announcements.</p>):<>
 <div className="my-grid"><Card title="Next required meeting" href="#attendance" action="Open Attendance">{data.next_meeting&&Date.parse(data.next_meeting.ends_at)>now?<><strong>{data.next_meeting.title}</strong><p>{date(data.next_meeting.starts_at)} · {label(data.next_meeting.type)}</p><p>Required attendance · {label(data.next_meeting.physical_status||'pending')}</p>{data.next_meeting.check_in_open&&data.next_meeting.code_expires_at&&Date.parse(data.next_meeting.code_expires_at)>now&&<span className="my-pill">Check-in open</span>}</>:<><strong>No upcoming meetings</strong><p>No required meetings are currently scheduled.</p></>}</Card>
 <Card title="My attendance" href="#attendance" action="View attendance"><p className="my-number">{data.personal.percent===null?'—':`${data.personal.percent}%`} <small>attendance</small></p><p>{data.personal.strikes} active strikes · {data.personal.pending} pending requests</p>{data.personal.percent===null&&<p>No finalized required meetings yet.</p>}</Card>
 <Card title="My purchase orders" href="https://finance.frc4418.org" action="Open Finance">{data.orders.length?<ul className="my-rows">{data.orders.map(p=><li key={p.id}><a href={`https://finance.frc4418.org/#po/${p.id}`}>PO #{p.po_number} · {p.vendor}</a><span>{money(p.amount)} · {label(p.status)}</span><small>{p.approvals}/2 approvals for the current revision</small></li>)}</ul>:<><strong>No purchase orders yet</strong><p>Your recent requests will appear here.</p></>}</Card>
 {data.finance.allowed&&<Card title="Finance actions" href="https://finance.frc4418.org" action="Review Finance">{data.finance.approvals?<p><strong>{data.finance.approvals}</strong> POs need your approval.</p>:<p>No POs need your approval. You’re caught up.</p>}<p>{data.finance.school} POs ready for your school submission.</p></Card>}
 {data.attention&&<Card title="Needs Attention" href="#attendance" action="Manage attendance"><p><a href="#attendance/calendar">{data.attention.open_meetings} open meetings</a></p><p><a href="#attendance/notices">{data.attention.requests} attendance requests to review</a></p><p><a href="#attendance/strikes">{data.attention.strike_actions} students requiring strike action</a></p></Card>}
 {data.attention&&<Card title="Robot & inventory" href="https://pit.frc4418.org" action="Open Pit Operations">{data.robot?<><strong className={data.robot.blocking?'my-danger':'my-success'}>{data.robot.readiness==='READY'?'Robot ready':data.robot.readiness}</strong><p>{data.robot.event} · {data.robot.open} open issues · {data.robot.blocking} blocking issues</p></>:<p>No active Pit event. Open Pit to review readiness.</p>}{data.inventory&&<p><a href="https://inventory.frc4418.org/#restock">{data.inventory.low} low-stock · {data.inventory.out} out-of-stock items →</a></p>}</Card>}</div>
 <section className="my-announcement-section" aria-labelledby="announcements-heading"><div className="section-heading"><h2 id="announcements-heading">Announcements</h2>{data.admin&&<a href="#announcements">Manage announcements →</a>}</div><div className="my-announcements">{activeAnnouncements.map(a=><article className={`my-card announcement ${a.severity}`} key={a.id}><span className="my-pill">{label(a.severity)}</span><h3>{a.title}</h3><p>{a.body}</p><AnnouncementImage path={a.image_path}/><small>{date(a.created_at)}</small></article>)}</div>{!activeAnnouncements.length&&<div className="my-empty"><strong>No announcements</strong><p>Nothing new from team leadership.</p></div>}</section>
 </>)}
 </section>;
}
