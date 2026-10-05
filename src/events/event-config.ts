import type {PublicEvent} from './public-model';
/** Separately curated family information. Current KCMT copy is approved for
 * publication; unknown team arrangements remain pending. This module is not
 * imported by the public entry. Later changes require a fresh content review
 * before copying approved fields into public/events/published.json. */
export const eventDraft: PublicEvent = {
  slug: 'kcmt-2026',
  title: 'KCMT 2026',
  subtitle: 'Kendrick Castillo Memorial Tournament',
  dateLabel: 'October 10–11, 2026',
  venue: 'Coronado High School',
  address: '1590 W Fillmore St, Colorado Springs, CO 80904',
  timeZone: 'America/Denver',
  sourceUrl: 'https://coloradofirst.org/frc/kcmt/',
  sourceChecked: '2026-10-05',
  schedule: [
    { date: '2026-10-09', label: 'Friday · Load-in & practice', optional: true, items: [
      { time: '4:00–6:00 pm', title: 'Team load-in / event check-in' },
      { time: '5:00 pm', title: 'Practice field opens' },
      { time: '6:00–8:00 pm', title: 'Practice rounds' },
      { time: '8:30 pm', title: 'Venue closes' },
    ] },
    { date: '2026-10-10', label: 'Saturday · Qualifications', items: [
      { time: '7:30 am', title: 'Venue opens' },
      { time: '8:30 am', title: 'Drivers meeting' },
      { time: '9:00 am', title: 'Opening ceremony' },
      { time: '9:30 am', title: 'Qualification rounds' },
      { time: '12:30 pm', title: 'Scheduled lunch break' },
      { time: '1:15 pm', title: 'Qualification rounds resume' },
      { time: '6:00 pm', title: 'Qualification rounds end' },
      { time: '7:30 pm*', title: 'Venue closes' },
    ] },
    { date: '2026-10-11', label: 'Sunday · Finals', items: [
      { time: '7:30 am', title: 'Venue opens' },
      { time: '8:30 am', title: 'Welcome ceremony' },
      { time: '9:00 am', title: 'Qualification rounds' },
      { time: 'Noon', title: 'Alliance selection' },
      { time: '12:30 pm', title: 'Scheduled lunch break' },
      { time: '1:30 pm', title: 'Elimination rounds' },
      { time: '6:00 pm', title: 'Elimination rounds end' },
    ] },
  ],
  scheduleNote: '*Saturday venue closing is listed as 7:30 pm or one hour after the last round.',
  arrival: { status: 'pending', text: 'Team arrival, meeting point and pickup arrangements are still to be confirmed. Venue opening times are not team arrival instructions.', bullets: [
    'Parking is available in the school parking lot.',
    'Optional Friday load-in is October 9, 4:00–6:00 pm. Enter from W Fillmore St and follow the bright yellow arrows.',
  ] },
  meals: { status: 'pending', text: 'Team meal plans are still to be confirmed. Ask Aiden privately about dietary arrangements.', bullets: [
    'Outside food is allowed at the venue.',
    'Eat in the cafeteria, avoiding sections reserved for other events, or outside in the courtyard.',
  ] },
  visiting: { status: 'confirmed', text: 'Plan for limited seating and time outdoors.', bullets: [
    'Bring safety glasses for everyone visiting with you. Only limited loaners are available.',
    'Seating is limited. Keep the reserved accessible seating available for people who need it.',
    'There is no quiet room at this event.',
    'The walkway between the pits and competition field is outside. Prepare for the weather.',
  ] },
  volunteering: { status: 'confirmed', text: 'The event is seeking referees, meal-support volunteers, queuers, photographers/videographers, and setup/cleanup help. Use the Volunteer sign up tab on the official event page for details. For parent questions, contact Aiden.', },
  contact: {name: 'Aiden Morrison', phone: '+17205253196'},
};

/** Add separately reviewed event drafts here; the public registry stays separate. */
export const eventDrafts: PublicEvent[] = [eventDraft];
