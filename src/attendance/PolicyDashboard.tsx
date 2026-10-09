import {ArrowUpRight, CalendarCheck2, CheckCircle2, ClipboardList, Search, ShieldAlert, TriangleAlert, Users} from "lucide-react";
import {useState} from "react";
import {summary,strikeAction,inStrikeYear,canReview,rpc,noticeTiming,type Data,type Member} from "./service";
type Run=(work:()=>Promise<unknown>,success?:string)=>Promise<void>;
const date=(s:string)=>new Date(s).toLocaleString([], {dateStyle:"medium",timeStyle:"short"});
const name=(d:Data,id:string)=>d.policy?.people.find(p=>p.id===id)?.name||d.members.find(m=>m.student_id===id)?.display_name||"Name unavailable";
export function PolicyHelp(){return <details className="att-panel att-policy-help"><summary>Attendance Policy · v0.3</summary>
 <p>Arrive within 5 minutes of the scheduled start. Give at least 24 hours’ notice for absence, late arrival or early departure. Shorter notice is an emergency request, reviewed against the excused reasons; it is not automatically denied.</p>
 <ul><li>Medical emergency or major illness symptoms.</li><li>Family emergency/event with parent confirmation.</li><li>Extracurricular activity with school confirmation.</li><li>Educational need at Mentor discretion: contact a Mentor.</li><li>Mental health day: honor system; repeated use may require parent confirmation.</li></ul>
 <p>At 2 strikes: verbal warning and parent contact. At 5: removal threshold reached. Leadership handles these actions; the app does not contact parents or remove members. For this team’s implementation, strike totals reset each January 1; history is retained.</p>
 <p>Offseason, preseason and build-season meetings remain mandatory according to your roster. File competition absences at least one week ahead. Between competitions, the normal notice rule applies.</p>
 <p>Build/competition shifts: full time requires 16 hours/week, an assigned off day and the full Saturday meeting; part time requires 10 hours/week. Shift compliance and competition notice are not automatically checked here.</p>
 <p>Use the meeting request form and follow the policy’s Slack #Absent procedure. For private reasons, contact a Mentor.</p>
 <a href="/policies/attendance-v03.pdf" target="_blank" rel="noopener noreferrer">Read the full policy (PDF)</a>
 </details>;}
export function MemberAttendance({data,member}:{data:Data;member:Member}){
 const s=summary(data,member.student_id),person=data.policy?.people.find(p=>p.id===member.student_id);
 const recent=data.attendance.filter(a=>a.student_id===member.student_id).map(a=>({a,m:data.meetings.find(m=>m.id===a.meeting_id)})).filter(x=>x.m).sort((x,y)=>Date.parse(y.m!.starts_at)-Date.parse(x.m!.starts_at));
 return <section aria-label={member.display_name+" attendance summary"}>
 <p>{person?.role}{person?.positions.length? " · "+person.positions.join(", "):""}</p>
 <p><strong>{s.percent===null?"No completed required meetings":s.percent+"% attendance"}</strong> · {s.strikes} active strikes · {strikeAction(s.strikes)}</p>
 <h4>Recent attendance & requests</h4>
 {recent.filter(x=>Date.parse(x.m!.starts_at)<=Date.now()||x.a.notice_at).slice(0,6).map(({a,m})=><p key={a.id}>{m!.title} · {date(m!.starts_at)} · {a.physical_status.replaceAll("_"," ")}{a.notice_at&&<> · {a.notice_type||"Absence"} request: {a.review_status} · {noticeTiming(a,m!)}</>}</p>)}
 <h4>Upcoming required meetings</h4>
 {recent.filter(({m})=>Date.parse(m!.ends_at)>Date.now()&&data.snapshots.some(x=>x.meeting_id===m!.id&&x.student_id===member.student_id&&x.required)).reverse().slice(0,5).map(({m})=><p key={m!.id}>{m!.title} · {date(m!.starts_at)}</p>)}
 </section>;
}
export function LeadershipDashboard({data,run,openMeeting}:{data:Data;run:Run;openMeeting:(id:string)=>void}){
 const [search,setSearch]=useState("");
 const members=data.members.map(m=>({m,s:summary(data,m.student_id)}));
 const pending=data.attendance.filter(a=>a.review_status==="pending");
 const ended=data.meetings.filter(m=>m.status!=="finalized"&&Date.parse(m.ends_at)<=Date.now());
 const flagged=members.filter(x=>x.s.strikes>=2).sort((a,b)=>b.s.strikes-a.s.strikes);
 const metrics=[
  {label:"Pending requests",value:pending.length,icon:ClipboardList,tone:"attention"},
  {label:"Members with strikes",value:members.filter(x=>x.s.strikes>0).length,icon:Users,tone:"neutral"},
  {label:"Warning threshold · 2+",value:members.filter(x=>x.s.strikes>=2&&x.s.strikes<5).length,icon:TriangleAlert,tone:"attention"},
  {label:"Removal threshold · 5+",value:members.filter(x=>x.s.strikes>=5).length,icon:ShieldAlert,tone:"danger"},
  {label:"Meetings to complete",value:ended.length,icon:CalendarCheck2,tone:"attention"},
 ];
 return <div className="att-leadership-dashboard">
 <div className="att-dashboard-heading"><div><h2>Attendance · needs attention</h2><p>Review requests, complete meeting records, and keep member follow-ups in view.</p></div><span className="att-badge">{members.length} {members.length===1?'member':'members'}</span></div>
 <div className="attendance-stats att-leadership-stats">{metrics.map(({label,value,icon:Icon,tone})=><span key={label} className={value>0?`att-stat-${tone}`:''}><span className="att-stat-top"><span>{label}</span><Icon size={18} aria-hidden="true"/></span><strong>{value}</strong><small>{value===0?'None right now':label==='Members with strikes'?'Current strike year':'Needs leadership review'}</small></span>)}</div>
 {!data.policy?.strike_year_start&&<p className="att-attention">Current strike-year information is unavailable. Refresh before using these totals.</p>}
 <div className="att-dashboard-grid">
 <section className="att-panel att-review-queue" aria-label="Attendance review queue"><div className="att-panel-heading"><h3><ClipboardList size={18} aria-hidden="true"/>Review queue</h3><span className="att-badge">{pending.length+ended.length}</span></div>
 {pending.length>0&&<a className="att-action-row" href="#attendance/notices"><span><strong>{pending.length} attendance requests need review</strong><small>Absences, late arrivals, and early departures</small></span><ArrowUpRight size={18} aria-hidden="true"/></a>}
 {ended.map(m=><button className="att-secondary att-action-row" key={m.id} onClick={()=>openMeeting(m.id)}><span><strong>{m.title} · review / complete attendance</strong><small>{date(m.starts_at)}</small></span><ArrowUpRight size={18} aria-hidden="true"/></button>)}
 {!pending.length&&!ended.length&&<div className="att-quiet-state"><CheckCircle2 size={28} aria-hidden="true"/><strong>Meeting reviews are up to date</strong><p>No pending requests or meetings to complete.</p></div>}
 </section>
 <section className="att-panel att-member-search"><div className="att-panel-heading"><h3><Search size={18} aria-hidden="true"/>Find a member</h3></div><p className="att-muted">Look up attendance, recent requests, and upcoming required meetings.</p><label className="att-select">Member name<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search current members"/></label>
 {search.trim()&&members.filter(({m})=>m.display_name.toLowerCase().includes(search.trim().toLowerCase())).map(({m})=><details className="att-record" key={m.student_id}><summary>{m.display_name}</summary><MemberAttendance data={data} member={m}/></details>)}
 {search.trim()&&!members.some(({m})=>m.display_name.toLowerCase().includes(search.trim().toLowerCase()))&&<p className="att-empty">No matching members.</p>}
 </section>
 </div>
 {flagged.length>0&&<section className="att-followups"><div className="att-panel-heading"><h3><TriangleAlert size={18} aria-hidden="true"/>Member follow-ups</h3><a href="#attendance/strikes">View strikes <ArrowUpRight size={15} aria-hidden="true"/></a></div>{flagged.map(({m,s})=><div className="att-panel" key={m.student_id}><strong>{m.display_name} · {s.strikes} strikes</strong><p>{strikeAction(s.strikes)}</p>{data.policy?.warnings.some(w=>w.student_id===m.student_id)?<p className="att-muted">Warning / parent contact recorded — see Strikes for details.</p>:<p className="att-muted">Warning / parent contact has not been recorded.</p>}</div>)}</section>}
 {!pending.length&&!ended.length&&!flagged.length&&<p className="att-dashboard-clear"><CheckCircle2 size={17} aria-hidden="true"/>No attendance actions need attention.</p>}
 </div>;
}
export function StrikeWorkspace({data,run}:{data:Data;run:Run}){
 const [search,setSearch]=useState(""),[state,setState]=useState("all");
 const strikes=data.strikes.filter(s=>inStrikeYear(data,s)&&name(data,s.student_id).toLowerCase().includes(search.toLowerCase())&&(state==="all"||(state==="active"?!s.rescinded_at:!!s.rescinded_at)));
 return <><h2>Strikes & leadership actions</h2><p>{data.policy?.strike_year_start?"Calendar year "+new Date(data.policy.strike_year_start).getUTCFullYear()+" · January 1 reset (UTC)":"Strike year unavailable"}. History remains available after rescission.</p>
 <div className="att-grid"><label>Find strike member<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Strike status<select value={state} onChange={e=>setState(e.target.value)}><option value="all">All</option><option value="active">Active</option><option value="rescinded">Rescinded</option></select></label></div>
 {!strikes.length&&<p className="att-empty">No strikes match this view.</p>}
 {[...new Set(strikes.map(s=>s.student_id))].map(id=><section className="att-panel" key={id}><h3>{name(data,id)} · {summary(data,id).strikes} active strikes</h3><p>{strikeAction(summary(data,id).strikes)}</p>
 {data.policy?.warnings.filter(w=>w.student_id===id).map((w,i)=><p key={i}>Warning / parent contact recorded {date(w.at)} by {name(data,w.actor)}{w.note&&" · "+w.note}</p>)}
 {canReview(data)&&data.policy?.user_id!==id&&<details><summary>Record warning / parent contact</summary><form className="att-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>rpc("team_attendance_policy_action",{action:"warning_parent_contact",p:{student_id:id,note:f.get("note")}}),"Warning / parent contact recorded");}}><p>Record only after the verbal warning and parent contact have occurred.</p><label>Optional note<input name="note" maxLength={2000}/></label><button>Record completed action</button></form></details>}
 {strikes.filter(s=>s.student_id===id).map(s=><article key={s.id}><p><strong>{s.rescinded_at?"Rescinded": "+"+s.quantity} · {s.category}</strong>{s.source==='automatic_absence'&&<> · <span className="att-badge">Automatic</span></>} · {date(s.assigned_at)} · {data.meetings.find(m=>m.id===s.meeting_id)?.title||"Meeting unavailable"}</p><p>{s.explanation} · {s.source==='automatic_absence'?'Recorded':'Assigned'} by {name(data,s.assigned_by)}</p>{s.rescinded_at?<p>Rescinded {date(s.rescinded_at)} · {s.rescind_reason}</p>:canReview(data)&&<form className="att-inline" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>rpc("team_attendance_manage",{action:"rescind",p:{meeting_id:s.meeting_id,attendance_id:s.attendance_id,strike_id:s.id,explanation:f.get("reason")}}),"Strike rescinded");}}><label>Rescind reason<input name="reason" required maxLength={2000}/></label><button className="att-secondary">Rescind strike</button></form>}</article>)}
 </section>)}
 <p>Newly completed meetings assign one automatic strike per eligible unexcused absence. Add other strikes from the meeting’s attendance record after review.</p></>;
}
