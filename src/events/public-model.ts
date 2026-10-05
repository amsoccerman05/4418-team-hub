/** The public contract is deliberately independent of all team database types. */
export type EventDay = { date: string; label: string; optional?: boolean; items: { time: string; title: string }[] };
export type EventNotice = { status: 'pending' | 'confirmed'; text: string; bullets?: string[] };
export type PublicContact = { name: string; phone: string };
export type PublicEvent = {
  slug: string;
  title: string;
  subtitle: string;
  dateLabel: string;
  venue: string;
  address: string;
  timeZone: string;
  sourceUrl: string;
  sourceChecked: string;
  schedule: EventDay[];
  scheduleNote?: string;
  arrival: EventNotice;
  meals: EventNotice;
  visiting: EventNotice;
  volunteering: EventNotice;
  contact?: PublicContact;
};
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid event information.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid event information.');
  return value.trim();
};
const date = (value: unknown): string => {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) throw Error('Invalid event date.');
  return result;
};
function notice(value: unknown): EventNotice {
  const n = record(value);
  if (n.status !== 'pending' && n.status !== 'confirmed') throw Error('Invalid event status.');
  if (n.bullets !== undefined && (!Array.isArray(n.bullets) || n.bullets.length > 8)) throw Error('Invalid event details.');
  return { status: n.status, text: text(n.text, 1000), ...(n.bullets === undefined ? {} : {bullets: (n.bullets as unknown[]).map(item => text(item, 300))}) };
}
function contact(value: unknown): PublicContact {
  const c = record(value), phone = text(c.phone, 16);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw Error('Invalid public contact phone.');
  return {name: text(c.name, 80), phone};
}
export function contactPhoneLabel(phone: string): string {
  return /^\+1\d{10}$/.test(phone) ? `${phone.slice(2,5)}-${phone.slice(5,8)}-${phone.slice(8)}` : phone;
}
/** Reconstruct only explicitly allowed fields. Never spread an API/database row. */
export function parsePublicEvent(value: unknown): PublicEvent {
  const e = record(value), slug = text(e.slug, 80), sourceUrl = text(e.sourceUrl, 250);
  if (!slugPattern.test(slug)) throw Error('Invalid event link.');
  const url = new URL(sourceUrl);
  // Add an organizer only after reviewing its exact official URL. No forms,
  // payment destinations, tracking queries or personal contact links here.
  if (url.href !== 'https://coloradofirst.org/frc/kcmt/') throw Error('Unapproved organizer link.');
  if (e.timeZone !== 'America/Denver') throw Error('Invalid event time zone.');
  if (!Array.isArray(e.schedule) || !e.schedule.length || e.schedule.length > 7) throw Error('Invalid schedule.');
  const schedule = e.schedule.map(value => {
    const d = record(value);
    if (!Array.isArray(d.items) || !d.items.length || d.items.length > 24) throw Error('Invalid schedule.');
    if (d.optional !== undefined && typeof d.optional !== 'boolean') throw Error('Invalid attendance note.');
    return { date: date(d.date), label: text(d.label, 80), ...(d.optional === undefined ? {} : {optional: d.optional}), items: d.items.map(value => {
      const i = record(value);
      return { time: text(i.time, 70), title: text(i.title, 120) };
    }) };
  });
  return { slug, title: text(e.title, 120), subtitle: text(e.subtitle, 250), dateLabel: text(e.dateLabel, 120), venue: text(e.venue, 120), address: text(e.address, 200), timeZone: e.timeZone, sourceUrl, sourceChecked: date(e.sourceChecked), schedule, ...(e.scheduleNote === undefined ? {} : {scheduleNote: text(e.scheduleNote, 500)}), arrival: notice(e.arrival), meals: notice(e.meals), visiting: notice(e.visiting), volunteering: notice(e.volunteering), ...(e.contact === undefined ? {} : {contact: contact(e.contact)}) };
}
export function parsePublishedEvents(value: unknown): PublicEvent[] {
  const document = record(value);
  if (document.schemaVersion !== 1 || !Array.isArray(document.events) || document.events.length > 25) throw Error('Event information is unavailable.');
  const events = document.events.map(parsePublicEvent);
  if (new Set(events.map(e => e.slug)).size !== events.length) throw Error('Duplicate event links.');
  return events;
}
export function publicEventHref(slug: string) { return `${import.meta.env.BASE_URL}event.html#${encodeURIComponent(slug)}`; }
