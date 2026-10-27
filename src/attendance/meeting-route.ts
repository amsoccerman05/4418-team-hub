// Meeting links contain an identifier only, never a check-in code or a write intent.
const meetingRoute = /^#attendance\/meeting\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const attendanceMeetingId = (route:string):string|null => route.match(meetingRoute)?.[1].toLowerCase() ?? null;
export const attendanceMeetingHref = (id:string):string => attendanceMeetingId(`#attendance/meeting/${id}`) ? `#attendance/meeting/${id}` : '#attendance';
