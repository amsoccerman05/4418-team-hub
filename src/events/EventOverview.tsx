import {ArrowUpRight, Eye, ShieldCheck} from 'lucide-react';
import {eventDrafts} from './event-config';
import {EventDetails} from './EventDetails';
import {publicEventHref} from './public-model';
import {systems} from '../links';

/** Team-side review surface. No Planning, task, attendance or inventory reads. */
export function EventOverview({route}: {route: string}) {
  const [,slug = eventDrafts[0]?.slug,mode] = route.split('?')[0].split('/');
  const event = eventDrafts.find(event => event.slug === slug);
  const competition = systems.find(system => system.id === 'pit');
  if (!event) return <section className="event-empty"><h1>Event not found</h1><p>This event overview isn’t available.</p><a className="event-button" href={eventDrafts[0] ? `#events/${eventDrafts[0].slug}` : "#"}>{eventDrafts[0] ? "View current event" : "Back to Team Hub"}</a></section>;
  const base = `#events/${event.slug}`;
  if (mode === 'preview') return <section className="event-overview"><div className="event-review-banner" role="note"><ShieldCheck size={22} aria-hidden="true"/><div><strong>Parent page preview</strong><p>Family-facing event information, kept separate from team records.</p></div><a className="event-button" href={base}>Back to event overview</a></div><EventDetails event={event}/><div className="event-preview-end"><p>Share the parent guide with families. It opens without a team account.</p><a href={publicEventHref(event.slug)} target="_blank" rel="noopener noreferrer">Open parent guide →</a></div></section>;
  return <section className="event-overview"><div className="event-overview-heading"><div><span className="event-eyebrow">Team workspace</span><h1>Event overview</h1><p>The weekend information families need, in one place.</p></div><div className="event-top-actions"><a className="event-button primary" href={competition?.url || 'https://pit.frc4418.org'}>Competition Operations <ArrowUpRight size={17} aria-hidden="true"/></a><a className="event-button" href={`${base}/preview`}><Eye size={17} aria-hidden="true"/>Preview parent page</a></div></div><EventDetails event={event} titleId="event-name"/></section>;
}
