import {useEffect,useState} from 'react';
import {EventDetails} from './EventDetails';
import {parsePublishedEvents,slugPattern,type PublicEvent} from './public-model';
export function PublicEventPage() {
  const [slug,setSlug] = useState(location.hash.slice(1));
  const [events,setEvents] = useState<PublicEvent[]|null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => { const changed = () => setSlug(location.hash.slice(1)); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => {
    let alive = true; const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    setEvents(null); setError(false);
    fetch(`${import.meta.env.BASE_URL}events/published.json`, {signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'})
      .then(response => { if (!response.ok) throw Error('Unavailable'); return response.json(); })
      .then(data => { const safe = parsePublishedEvents(data); if (alive) setEvents(safe); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  const event = slugPattern.test(slug) ? events?.find(e => e.slug === slug) : undefined;
  useEffect(() => { document.title = event ? `${event.title} · 4418 IMPULSE` : '4418 IMPULSE · Event information'; }, [event]);
  const signIn = `${import.meta.env.BASE_URL}index.html${slugPattern.test(slug) ? `#events/${slug}` : ''}`;
  return <div className="event-public"><a className="skip-link" href="#event-content" onClick={e => {e.preventDefault();document.getElementById('event-content')?.focus();}}>Skip to content</a><header className="event-public-header"><a className="event-public-brand" href="https://www.frc4418.org" aria-label="4418 IMPULSE team website"><img src={`${import.meta.env.BASE_URL}branding/4418-impulse-emblem.png`} alt=""/><span>4418<strong>IMPULSE</strong></span></a><span className="event-parent-label">Family event guide</span><a className="event-sign-in" href={signIn}>Team sign in →</a></header><main id="event-content" tabIndex={-1}>
    {error ? <section className="event-empty" role="alert"><h1>Event information is unavailable</h1><p>Please try again in a moment.</p><button className="event-button" onClick={() => setAttempt(x => x+1)}>Try again</button></section> : !events ? <p className="event-empty" role="status">Loading event information…</p> : event ? <EventDetails event={event}/> : <section className="event-empty"><h1>Event information isn’t published yet</h1><p>This link doesn’t have a public event guide available. Please check with the team for the latest event information.</p><a className="event-button" href="https://www.frc4418.org">Visit the team website</a></section>}
  </main><footer className="event-public-footer"><span>4418 IMPULSE · One team. Connected.</span><span>No account needed to read published event information.</span></footer></div>;
}
