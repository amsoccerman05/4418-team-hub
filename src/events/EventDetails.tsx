import {CalendarDays, Clock3, MapPin, Utensils, HandHeart, ExternalLink, Navigation, Backpack} from 'lucide-react';
import type {PublicEvent, EventNotice} from './public-model';
import './events.css';
function FamilyDetail({title, notice, icon: Icon}: {title: string; notice: EventNotice; icon: typeof MapPin}) {
  return <div className="event-family-detail"><div className="event-card-heading"><Icon size={19} aria-hidden="true"/><h3>{title}</h3>{notice.status === 'confirmed' && <span className="event-status confirmed">Confirmed</span>}</div><p>{notice.text}</p></div>;
}
/** Pure presentation: no auth, database, team records or external embeds. */
export function EventDetails({event, titleId = 'event-title'}: {event: PublicEvent; titleId?: string}) {
  const pending = [event.arrival,event.meals,event.visiting,event.volunteering].some(note => note.status === 'pending');
  return <>
    <section className="event-hero" aria-labelledby={titleId}>
      <div className="event-hero-copy"><span className="event-eyebrow">4418 IMPULSE · Competition weekend</span><h1 id={titleId}>{event.title}</h1><p className="event-subtitle">{event.subtitle}</p><div className="event-hero-meta"><span><CalendarDays size={18} aria-hidden="true"/>{event.dateLabel}</span><span><MapPin size={18} aria-hidden="true"/>{event.venue}</span></div></div>
      <div className="event-date-stamp" aria-hidden="true"><span>FRC TEAM</span><strong>4418</strong><span>IMPULSE</span></div>
    </section>
    <section className="event-location" aria-labelledby="event-location-title"><div className="event-card-heading"><Navigation size={21} aria-hidden="true"/><div><h2 id="event-location-title">Where we’re headed</h2><p>{event.venue}<br/>{event.address}</p></div></div><a className="event-button" href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Official event information <ExternalLink size={15} aria-hidden="true"/></a></section>
    <section className="event-family-info" aria-labelledby="event-family-title"><div className="event-section-heading"><h2 id="event-family-title">Before you go</h2>{pending && <span className="event-status">Team details awaiting confirmation</span>}</div><div className="event-family-grid"><FamilyDetail title="Arrival & pickup" notice={event.arrival} icon={MapPin}/><FamilyDetail title="Meals & dietary needs" notice={event.meals} icon={Utensils}/><FamilyDetail title="Spectators & what to bring" notice={event.visiting} icon={Backpack}/><FamilyDetail title="Volunteering & questions" notice={event.volunteering} icon={HandHeart}/></div></section>
    <section className="event-schedule" aria-labelledby="event-schedule-title"><div className="event-section-heading"><div><h2 id="event-schedule-title">Weekend schedule</h2><p>Organizer’s tentative schedule. Times may change.</p></div><span className="event-timezone"><Clock3 size={16} aria-hidden="true"/>All times Mountain Time</span></div><div className="event-days">{event.schedule.map(day => <section className="event-day" key={day.date}><header><p>{new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`))}</p><h3>{day.label}</h3>{day.optional && <span className="event-optional">Optional for Team 4418</span>}</header><ol>{day.items.map((item,index) => <li key={`${day.date}-${index}`}><span className="event-time">{item.time}</span><span>{item.title}</span></li>)}</ol></section>)}</div><p className="event-source">Schedule highlights from <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Colorado FIRST</a>, checked {event.sourceChecked}. {event.scheduleNote} Check the organizer’s page for the full schedule and changes.</p></section>
  </>;
}
