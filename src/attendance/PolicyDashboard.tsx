import {ArrowUpRight, CalendarCheck2, CheckCircle2, ClipboardList, Search, ShieldAlert, TriangleAlert, Users} from "lucide-react";
import {useState} from "react";
import {summary,strikeAction,inStrikeYear,canReview,rpc,noticeTiming,type Data,type Member} from "./service";
type Run=(work:()=>Promise<unknown>,success?:string)=>Promise<void>;
const date=(s:string)=>new Date(s).toLocaleString([], {dateStyle:"medium",timeStyle:"short"});
const name=(d:Data,id:string)=>d.policy?.people.find(p=>p.id===id)?.name||d.members.find(m=>m.student_id===id)?.display_name||"Name unavailable";
export function PolicyHelp(){return <details className="att-panel att-policy-help"><summary>Attendance Policy · v1.0 (Proposed)</summary>
 <p>This summary follows the supplied 2026 Participation and Attendance Policy, Version 1.0 | Proposed. Attendance notices address unexcused absences, unapproved late arrivals, early departures, and missed agreed-upon schedules.</p>
 <h4>Five-notice process</h4>
 <ol><li>First notice: an attendance notice and reminder of team expectations.</li><li>Second notice: a mentor meets with the member and a parent or guardian is contacted.</li><li>Third notice: continued communication with the member and family; mentors may establish an attendance improvement plan.</li><li>Fourth notice: continued communication and attendance improvement support.</li><li>Fifth notice: team leadership reviews continued participation. This review may result in removal from the program.</li></ol>
 <p>Leadership handles these conversations and participation decisions. Recording a completed follow-up here does not contact a parent or remove a member.</p>
 <p><strong>Counting window:</strong> the supplied policy says notices reset at kickoff. The current system still counts from January 1 (UTC), with history retained. The reset rule has not changed.</p>
 <h4>Report absences and schedule conflicts</h4>
 <p>Report planned absences through the website at least 24 hours before the meeting. Less than 24 hours’ notice requires an approved exception to avoid an attendance notice. Communicate unexpected emergencies to a mentor as soon as reasonably possible. A request is not automatically excused; it requires review.</p>
 <p>Report planned late arrivals or early departures at least 24 hours ahead whenever possible. There is a five-minute arrival grace period. Unapproved late arrivals and early departures may receive an attendance notice after review; repeated issues may prompt an attendance review even with advance notice.</p>
 <p>You may also use the designated Slack channel, but Slack does not replace a website request. Contact a mentor privately if you are uncomfortable sharing a reason publicly.</p>
 <h4>Excused absences and support</h4>
 <p>Medical emergencies, significant illness, family emergencies or important events, school-sponsored extracurricular activities, educational needs, mental health days, and other circumstances approved by mentors or the Program Manager may qualify. Family events and school-sponsored activities may require confirmation when appropriate.</p>
 <p>For educational needs, submit a request and communicate with a mentor. Approval is discretionary; mentors will make an effort to communicate a decision by the end of the day. Mental health days use an honor system: private medical information or detailed explanations are not required for consideration. Frequent absences may prompt a conversation with the member and family about support or schedule adjustments.</p>
 <h4>Schedules throughout the season</h4>
 <p>Follow your agreed-upon schedule during offseason, preseason, build, and competition seasons. Report competition absences at least seven days ahead whenever possible; unexpected emergencies are reviewed individually. Meetings between competitions use the standard procedures.</p>
 <p>During build and competition seasons, full-time members commit to at least 16 hours per week, their assigned weekday off, and the full Saturday meeting unless excused. Part-time members commit to at least 10 hours per week. Leadership must approve schedule changes. Extra meetings do not automatically resolve an attendance notice. Weekly hours and the seven-day competition reporting expectation are not automatically enforced here.</p>
 <p>Ask a mentor or the Program Manager to review an incorrect attendance notice or circumstances that were not fully considered. Notices may be modified or removed when appropriate; the system retains the history.</p>
 </details>;}
export function MemberAttendance({data,member}:{data:Data;member:Member}){
 const s=summary(data,member.student_id),person=data.policy?.people.find(p=>p.id===member.student_id);
 const recent=data.attendance.filter(a=>a.student_id===member.student_id).map(a=>({a,m:data.meetings.find(m=>m.id===a.meeting_id)})).filter(x=>x.m).sort((x,y)=>Date.parse(y.m!.starts_at)-Date.parse(x.m!.starts_at));
 return <section aria-label={member.display_name+" attendance summary"}>
 <p>{person?.role}{person?.positions.length? " · "+person.positions.join(", "):""}</p>
 <p><strong>{s.percent===null?"No completed required meetings":s.percent+"% attendance"}</strong> · {s.strikes} active attendance notices · {strikeAction(s.strikes)}</p>
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
  {label:"Members with attendance notices",value:members.filter(x=>x.s.strikes>0).length,icon:Users,tone:"neutral"},
  {label:"Member / family follow-up · 2+",value:members.filter(x=>x.s.strikes>=2&&x.s.strikes<5).length,icon:TriangleAlert,tone:"attention"},
  {label:"Participation review · 5+",value:members.filter(x=>x.s.strikes>=5).length,icon:ShieldAlert,tone:"danger"},
  {label:"Meetings to complete",value:ended.length,icon:CalendarCheck2,tone:"attention"},
 ];
 return <div className="att-leadership-dashboard">
 <div className="att-dashboard-heading"><div><h2>Attendance · needs attention</h2><p>Review requests, complete meeting records, and keep member follow-ups in view.</p></div><span className="att-badge">{members.length} {members.length===1?'member':'members'}</span></div>
 <div className="attendance-stats att-leadership-stats">{metrics.map(({label,value,icon:Icon,tone})=><span key={label} className={value>0?`att-stat-${tone}`:''}><span className="att-stat-top"><span>{label}</span><Icon size={18} aria-hidden="true"/></span><strong>{value}</strong><small>{value===0?'None right now':label==='Members with attendance notices'?'Current counting year':'Needs leadership review'}</small></span>)}</div>
 {!data.policy?.strike_year_start&&<p className="att-attention">Current counting-window information is unavailable. Refresh before using these totals.</p>}
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
 {flagged.length>0&&<section className="att-followups"><div className="att-panel-heading"><h3><TriangleAlert size={18} aria-hidden="true"/>Member follow-ups</h3><a href="#attendance/strikes">View attendance notices <ArrowUpRight size={15} aria-hidden="true"/></a></div>{flagged.map(({m,s})=><div className="att-panel" key={m.student_id}><strong>{m.display_name} · {s.strikes} attendance notices</strong><p>{strikeAction(s.strikes)}</p>{data.policy?.warnings.some(w=>w.student_id===m.student_id)?<p className="att-muted">Member discussion / parent contact recorded — see Attendance notices for details.</p>:<p className="att-muted">Member discussion / parent contact has not been recorded.</p>}</div>)}</section>}
 {!pending.length&&!ended.length&&!flagged.length&&<p className="att-dashboard-clear"><CheckCircle2 size={17} aria-hidden="true"/>No attendance actions need attention.</p>}
 </div>;
}
export function StrikeWorkspace({data,run}:{data:Data;run:Run}){
 const [search,setSearch]=useState(""),[state,setState]=useState("all");
 const strikes=data.strikes.filter(s=>inStrikeYear(data,s)&&name(data,s.student_id).toLowerCase().includes(search.toLowerCase())&&(state==="all"||(state==="active"?!s.rescinded_at:!!s.rescinded_at)));
 return <><h2>Attendance notices & leadership actions</h2><p>{data.policy?.strike_year_start?"Calendar year "+new Date(data.policy.strike_year_start).getUTCFullYear()+" · January 1 reset (UTC)":"Counting window unavailable"}. History remains available after rescission.</p>
 <div className="att-grid"><label>Find member with notices<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Attendance notice status<select value={state} onChange={e=>setState(e.target.value)}><option value="all">All</option><option value="active">Active</option><option value="rescinded">Rescinded</option></select></label></div>
 {!strikes.length&&<p className="att-empty">No attendance notices match this view.</p>}
 {[...new Set(strikes.map(s=>s.student_id))].map(id=><section className="att-panel" key={id}><h3>{name(data,id)} · {summary(data,id).strikes} active attendance notices</h3><p>{strikeAction(summary(data,id).strikes)}</p>
 {data.policy?.warnings.filter(w=>w.student_id===id).map((w,i)=><p key={i}>Member discussion / parent contact recorded {date(w.at)} by {name(data,w.actor)}{w.note&&" · "+w.note}</p>)}
 {canReview(data)&&data.policy?.user_id!==id&&<details><summary>Record member discussion / parent contact</summary><form className="att-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>rpc("team_attendance_policy_action",{action:"warning_parent_contact",p:{student_id:id,note:f.get("note")}}),"Member discussion / parent contact recorded");}}><p>Record only after the member discussion and parent or guardian contact have occurred.</p><label>Optional note<input name="note" maxLength={2000}/></label><button>Record completed action</button></form></details>}
 {strikes.filter(s=>s.student_id===id).map(s=><article key={s.id}><p><strong>{s.rescinded_at?"Rescinded": "+"+s.quantity} · {s.category}</strong>{s.source==='automatic_absence'&&<> · <span className="att-badge">Automatic</span></>} · {date(s.assigned_at)} · {data.meetings.find(m=>m.id===s.meeting_id)?.title||"Meeting unavailable"}</p><p>{s.explanation} · {s.source==='automatic_absence'?'Recorded':'Assigned'} by {name(data,s.assigned_by)}</p>{s.rescinded_at?<p>Rescinded {date(s.rescinded_at)} · {s.rescind_reason}</p>:canReview(data)&&<form className="att-inline" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>rpc("team_attendance_manage",{action:"rescind",p:{meeting_id:s.meeting_id,attendance_id:s.attendance_id,strike_id:s.id,explanation:f.get("reason")}}),"Attendance notice rescinded");}}><label>Rescind reason<input name="reason" required maxLength={2000}/></label><button className="att-secondary">Rescind attendance notice</button></form>}</article>)}
 </section>)}
 <p>Newly completed meetings assign one automatic attendance notice per eligible unexcused absence. Add other attendance notices from the meeting’s attendance record after review.</p></>;
}
