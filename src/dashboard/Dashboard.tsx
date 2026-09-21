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
 const hour=new Date(now).getHours(),greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
 const meeting=data?.next_meeting&&Date.parse(data.next_meeting.ends_at)>now?data.next_meeting:null;
 const actions=data?[
  ...(data.finance.allowed&&data.finance.approvals>0?[{href:'https://finance.frc4418.org/',text:`${data.finance.approvals} purchase orders need your approval`}]:[]),
  ...(data.finance.allowed&&data.finance.school>0?[{href:'https://finance.frc4418.org/',text:`${data.finance.school} purchase orders ready for school`}]:[]),
  ...(data.attention?.requests?[{href:'#attendance/notices',text:`${data.attention.requests} attendance requests to review`}]:[]),
  ...(data.attention?.strike_actions?[{href:'#attendance/strikes',text:`${data.attention.strike_actions} students need an attendance follow-up`}]:[])
 ]:[];
 return <section className={`my-dashboard ${management?'my-management':''}`} aria-labelledby="my-heading"><div className="section-heading my-welcome"><div><h1 id="my-heading">{management?'Announcements':'My 4418'}</h1>{!management&&data?<><h2>{greeting}, {data.name.split(' ')[0]}.</h2><p>Here’s what’s happening with the team.</p></>:<p>{management?'Updates from team leadership.':'Your meetings, requests, and team updates.'}</p>}</div>{!management&&state==='ready'&&<button className="my-refresh" onClick={()=>setRefresh(x=>x+1)}>Refresh</button>}</div>
 {state==='loading'?<p className="my-empty" role="status">Loading My 4418…</p>:state==='setup'?<p className="my-empty">Team connection is not configured yet.</p>:state==='signed-out'?<p className="my-empty"><a href="#">Sign in to My 4418</a></p>:state==='denied'?<p className="my-empty" role="alert">An active team profile is required. Contact a mentor for access.</p>:state==='error'?<p className="my-empty" role="alert">{error} <button onClick={()=>setRefresh(x=>x+1)}>Try again</button></p>:data&&(management?(data.admin?<AnnouncementManager/>:<p role="alert">Only active mentors and admins can manage announcements.</p>):<>
 <section className={`my-next ${meeting?'has-meeting':'is-empty'}`} aria-labelledby="next-heading"><h2 id="next-heading">Next up</h2>{meeting?<div className="my-next-content"><div><h3>{meeting.title}</h3><p>{date(meeting.starts_at)} · {label(meeting.type)}</p><span className="my-pill">Required</span>{meeting.check_in_open&&meeting.code_expires_at&&Date.parse(meeting.code_expires_at)>now&&<span className="my-pill">Check-in open</span>}</div><a className="my-primary-link" href="#attendance">View meeting →</a></div>:<p>No required meetings coming up. <a href="#attendance">View calendar →</a></p>}{data.personal.pending>0&&<p className="my-request-summary"><a href="#attendance">{data.personal.pending} attendance {data.personal.pending===1?'request':'requests'} awaiting review →</a></p>}</section>
 {actions.length>0&&<section className="my-attention" aria-labelledby="attention-heading"><h2 id="attention-heading">Needs your attention</h2><ul>{actions.map(a=><li key={a.text}><a href={a.href}>{a.text}<span aria-hidden="true"> →</span></a></li>)}</ul></section>}
 <section id="home-announcements" className={`my-announcement-section ${activeAnnouncements.length?'has-announcements':'is-empty'}`} aria-labelledby="announcements-heading"><h2 id="announcements-heading">Announcements</h2><div className="my-announcements">{activeAnnouncements.map(a=><article className={`my-card announcement ${a.severity}`} key={a.id}>{a.severity!=='normal'&&<span className="my-pill">{label(a.severity)}</span>}<h3>{a.title}</h3><p>{a.body}</p><AnnouncementImage path={a.image_path}/><small>{date(a.created_at)}</small></article>)}</div>{!activeAnnouncements.length&&<p className="my-quiet">You’re up to date. No new announcements.</p>}</section>
 <section className="my-activity" aria-labelledby="activity-heading"><h2 id="activity-heading">My activity</h2><div className="my-grid"><Card title="My attendance" href="#attendance" action="View attendance">{data.personal.percent===null?<p>No completed required meetings yet.</p>:<p className="my-number">{data.personal.percent}% <small>attendance</small></p>}{data.personal.strikes>0&&<p>{data.personal.strikes} active {data.personal.strikes===1?'strike':'strikes'}</p>}</Card><Card title="My purchase orders" href="https://finance.frc4418.org/" action="View purchase orders">{data.orders.length?<ul className="my-rows">{data.orders.map(p=><li key={p.id}><a href={`https://finance.frc4418.org/#po/${p.id}`}>PO #{p.po_number} · {p.vendor}</a><span>{money(p.amount)} · {label(p.status)}</span>{p.status==='awaiting_approval'&&<small>{p.approvals}/2 approvals for this submission</small>}</li>)}</ul>:<p>No purchase orders yet.</p>}</Card></div></section>
 {data.attention&&(data.robot||data.inventory&&(data.inventory.low>0||data.inventory.out>0))&&<section className="my-team-status" aria-labelledby="status-heading"><h2 id="status-heading">Team status</h2>{data.robot&&<a href="https://pit.frc4418.org/">{data.robot.event}: {data.robot.readiness==='READY'?'Robot ready':data.robot.readiness==='NOT READY'?'Robot needs attention':'Check robot readiness'} · {data.robot.open} open issues · {data.robot.blocking} blocking →</a>}{data.inventory&&(data.inventory.low>0||data.inventory.out>0)&&<a href="https://inventory.frc4418.org/#restock">{data.inventory.low} low-stock · {data.inventory.out} out-of-stock items →</a>}</section>}

 </>)}

 </section>;
}
