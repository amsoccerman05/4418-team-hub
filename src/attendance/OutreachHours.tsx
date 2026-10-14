import {useEffect,useRef,useState,type FormEvent} from 'react';
import {rpc,type Attendance,type Meeting} from './service';
import {localMeetingTime,localTimeChoices,resolveMeetingTime,offsetLabel} from './meetingEdit';
type Goal={target_hours:number;version:number};
type Report={goal:Goal;can_configure:boolean;available_years:number[];period:{start_year:number;current_start_year:number;start_date:string;end_date:string;time_zone:string};members:{student_id:string;display_name:string;hours:number;missing_checkouts:number}[]};
export function OutreachHours(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[year,setYear]=useState<number|undefined>();
 const generation=useRef(0);
 async function load(selected=year){const gen=++generation.current;setBusy(true);setError('');try{const result=await rpc('team_attendance_outreach_summary',{period_start_year:selected??null}) as Report;if(gen===generation.current)setReport(result);}catch(e){if(gen===generation.current)setError(e instanceof Error?e.message:'Outreach hours could not be loaded');}finally{if(gen===generation.current)setBusy(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[]);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!report||busy)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await rpc('team_attendance_outreach_goal',{p:{version:report.goal.version,target_hours:f.get('target')}});await load();}catch(e){setError(e instanceof Error?e.message:'Goal could not be saved');setBusy(false);}}
 return <section><div className="att-toolbar"><h2>STEM outreach hours</h2><button className="att-secondary" disabled={busy} onClick={()=>void load()}>Refresh hours</button></div>
 <p>Check in with the event code and check out when you leave. STEM outreach is optional and never receives attendance notices.</p>
 <p className="att-muted">The requirement is {report?.goal.target_hours??10} hours each May 1–April 30 year, using America/Denver time. Previous years’ records are kept. Only recorded arrival and departure times count; overlapping events count once. Other lettering requirements and mentor approval still apply.</p>
 {error&&<p className="att-error" role="alert">{error}</p>}
 {!report&&!error&&<p>Loading outreach hours…</p>}
 {report&&<><label>Outreach year<select aria-label="Outreach year" value={report.period.start_year} disabled={busy} onChange={e=>{const next=Number(e.target.value);setYear(next);void load(next);}}>{report.available_years.map(y=><option key={y} value={y}>May 1, {y} – April 30, {y+1}{y===report.period.current_start_year?' (current)':''}</option>)}</select></label><p>{report.goal.target_hours} hour target · {report.period.start_date} through {report.period.end_date} · {report.period.time_zone}</p>
 {!report.members.length&&<p>No eligible participants.</p>}
 {report.members.map(m=><article className="att-panel" key={m.student_id}><h3>{m.display_name}</h3><p><strong>{Number(m.hours).toFixed(2)} hours</strong> / {report.goal.target_hours} required</p><p>{Math.max(0,report.goal.target_hours-Number(m.hours)).toFixed(2)} hours remaining</p>{m.missing_checkouts>0&&<p className="att-attention">{m.missing_checkouts} event{m.missing_checkouts===1?'':'s'} with no recorded departure. No hours credited for those entries; contact leadership for a verified correction.</p>}</article>)}
 {report.can_configure&&<details><summary>Configure lettering hours target</summary><form key={report.goal.version} className="att-form" onSubmit={e=>void save(e)}><p>This changes the displayed target for all years. Use the team’s confirmed policy. The annual May 1–April 30 window stays fixed. This does not award a letter or rewrite attendance.</p><label>Required outreach hours<input name="target" type="number" required min="0.01" max="10000" step="0.01" defaultValue={report.goal.target_hours}/></label><button disabled={busy}>Save outreach requirement</button></form></details>}</>}
 </section>;
}
export function OutreachTimeCorrection({a,meeting,run}:{a:Attendance;meeting:Meeting;run:(work:()=>Promise<unknown>,message?:string)=>Promise<void>}){
 const [arrival,setArrival]=useState(a.checked_in_at?localMeetingTime(a.checked_in_at):''),[departure,setDeparture]=useState(a.left_at?localMeetingTime(a.left_at):'');
 const [arrivalChoice,setArrivalChoice]=useState(''),[departureChoice,setDepartureChoice]=useState('');
 const offset=(title:string,value:string,original:string|null,choice:string,setChoice:(v:string)=>void)=>localTimeChoices(value).length>1?<label>{title} repeated-hour offset<select value={choice} required={!original||localMeetingTime(original)!==value} onChange={e=>setChoice(e.target.value)}><option value="">{original&&localMeetingTime(original)===value?'Keep recorded timestamp':'Choose intended offset'}</option>{localTimeChoices(value).map(v=><option key={v} value={v}>{offsetLabel(v)}</option>)}</select></label>:null;
 return <details><summary>Correct verified outreach times</summary><form className="att-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>rpc('team_attendance_outreach_correct',{p:{meeting_id:meeting.id,attendance_id:a.id,version:a.version,checked_in_at:resolveMeetingTime(arrival,a.checked_in_at||'1970-01-01T00:00:00Z',arrivalChoice),left_at:resolveMeetingTime(departure,a.left_at||'1970-01-01T00:00:00Z',departureChoice),reason:f.get('reason')}}),'Verified outreach times saved');}}>
 <p>Enter actual, verified times only. This is an audited correction. Times use your local time zone and must fall within the event’s 30-minute early/late attendance window.</p>
 <label>Verified arrival<input name="arrival" type="datetime-local" required value={arrival} onChange={e=>{setArrival(e.target.value);setArrivalChoice('');}}/></label>
 <label>Verified departure<input name="departure" type="datetime-local" required value={departure} onChange={e=>{setDeparture(e.target.value);setDepartureChoice('');}}/></label>
 {offset('Arrival',arrival,a.checked_in_at,arrivalChoice,setArrivalChoice)}{offset('Departure',departure,a.left_at,departureChoice,setDepartureChoice)}
 <label>How were these times verified?<textarea name="reason" required maxLength={2000}/></label><button>Save verified outreach times</button></form></details>;
}
