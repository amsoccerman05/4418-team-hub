import {useState} from 'react';
import {CalendarDays, ClipboardList, Megaphone, ArrowRight, MapPin, Clock, CheckCircle2} from 'lucide-react';
import './parents.css';

/** Presentation-only contract. Never pass dashboard, roster, or student records here.
 * A future adapter must supply only data authorized for the verified parent. */
export type ParentHomeData = {
  events: {id:string;day:string;month:string;title:string;time:string;location:string}[];
  needs: {id:string;title:string;detail:string}[];
  announcements: {id:string;title:string;date:string;body:string}[];
};
const empty:ParentHomeData = {events:[],needs:[],announcements:[]};
// Synthetic design examples only. Not a real team schedule or coach announcement.
const example:ParentHomeData = {
  events:[{id:'sample-build',day:'24',month:'OCT',title:'Saturday build meeting',time:'9:00 AM – 4:00 PM',location:'STEM School'}, {id:'sample-outreach',day:'31',month:'OCT',title:'Community outreach',time:'Time to be confirmed',location:'Location to be confirmed'}],
  needs:[{id:'sample-meal',title:'Lunch for Saturday',detail:'Main dishes and drinks still needed.'}],
  announcements:[{id:'sample-note',title:'A note before Saturday',date:'Example coach update',body:'Please have students bring their safety glasses and a water bottle. Lunch details will be shared here once confirmed.'}],
};

export function ParentHome({data,onSignups}:{data:ParentHomeData;onSignups:()=>void}) {
  return <section className="parent-home" aria-labelledby="parent-title">
    <header className="parent-heading"><div><span className="parent-eyebrow">4418 IMPULSE · Families</span><h1 id="parent-title">Parent home</h1><p>Dates, ways to help, and updates from the coaches.</p></div><button className="parent-primary" onClick={onSignups}>View signups <ArrowRight size={17} aria-hidden="true"/></button></header>
    <nav className="parent-jumps" aria-label="Parent page sections"><a href="#parent-upcoming" onClick={e=>{e.preventDefault();document.getElementById('parent-upcoming')?.focus();document.getElementById('parent-upcoming')?.scrollIntoView({block:'start'});}}><CalendarDays size={18} aria-hidden="true"/>Coming up</a><a href="#parent-updates" onClick={e=>{e.preventDefault();document.getElementById('parent-updates')?.focus();document.getElementById('parent-updates')?.scrollIntoView({block:'start'});}}><Megaphone size={18} aria-hidden="true"/>Coach updates</a></nav>
    <div className="parent-columns"><div>
      <section className="parent-panel" aria-labelledby="parent-upcoming"><div className="parent-section-title"><CalendarDays size={20} aria-hidden="true"/><h2 id="parent-upcoming" tabIndex={-1}>Coming up</h2></div><p className="parent-caption">Team dates and event details</p>
        {data.events.length?<ul className="parent-events">{data.events.map(event=><li key={event.id}><div className="parent-date" aria-label={`${event.month} ${event.day}`}><span>{event.month}</span><strong>{event.day}</strong></div><div><h3>{event.title}</h3><p><Clock size={14} aria-hidden="true"/>{event.time}</p><p><MapPin size={14} aria-hidden="true"/>{event.location}</p></div></li>)}</ul>:<p className="parent-empty">No family calendar is connected to this preview yet.</p>}
      </section>
      <section className="parent-panel" aria-labelledby="parent-updates"><div className="parent-section-title"><Megaphone size={20} aria-hidden="true"/><h2 id="parent-updates" tabIndex={-1}>Coach updates</h2></div>
        {data.announcements.length?data.announcements.map(a=><article className="parent-update" key={a.id}><span>{a.date}</span><h3>{a.title}</h3><p>{a.body}</p></article>):<p className="parent-empty">No parent announcements are connected yet.</p>}
      </section>
    </div><aside>
      <section className="parent-panel parent-help" aria-labelledby="parent-help-title"><div className="parent-section-title"><ClipboardList size={20} aria-hidden="true"/><h2 id="parent-help-title">Ways to help</h2></div><p>Pick a meal, supply, or volunteer slot that works for your family.</p>
        {data.needs.length?<ul className="parent-needs">{data.needs.map(n=><li key={n.id}><strong>{n.title}</strong><p>{n.detail}</p></li>)}</ul>:<p className="parent-empty">Signup availability will appear here once connected.</p>}
        <button className="parent-primary" onClick={onSignups}>View signups <ArrowRight size={17} aria-hidden="true"/></button>
      </section>
      <section className="parent-panel parent-commitments"><div className="parent-section-title"><CheckCircle2 size={20} aria-hidden="true"/><h2>My signups</h2></div><p>Your confirmed commitments will appear here after secure parent access is connected.</p></section>
    </aside></div>
  </section>;
}

/** Review route only: behind the existing Hub sign-in, with no database calls.
 * This is not parent authorization and must not be released as a parent portal. */
export function ParentHomePreview() {
  const [samples,setSamples]=useState(false),[notice,setNotice]=useState(false);
  return <><div className="parent-preview-bar" role="note"><div><strong>Design preview</strong><p>{samples?'Example content only. These are not real events, requests, or announcements.':'Calendar, announcements, and signups are not connected. Parent access is still being designed.'}</p></div><label><input type="checkbox" checked={samples} onChange={e=>{setSamples(e.target.checked);setNotice(false);}}/>Show example content</label><a href="#">Back to Team Hub</a></div>
    {notice&&<div className="parent-preview-notice" role="status"><p>This preview does not submit signups. The existing meal signup workflow will be connected after its release and parent access are approved.</p><button onClick={()=>setNotice(false)}>Dismiss</button></div>}
    <ParentHome data={samples?example:empty} onSignups={()=>setNotice(true)}/></>;
}
