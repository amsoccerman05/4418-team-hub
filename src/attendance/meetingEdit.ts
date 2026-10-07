import type { Attendance, Meeting } from "./service";

export function localMeetingTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
// Reject nonexistent wall-clock times. Expose both instants during a DST fall-back
// instead of silently choosing one. UTC instants are the database contract.
export function localTimeChoices(value: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed)) return [];
  const choices: string[] = [];
  for (let delta = -180; delta <= 180; delta += 15) {
    const instant = new Date(+parsed + delta * 60000).toISOString();
    if (localMeetingTime(instant) === value) choices.push(instant);
  }
  return choices;
}
export function resolveMeetingTime(value: string, original: string, choice: string) {
  if (value === localMeetingTime(original)) {
    if (!choice) return original; // Preserve exact seconds and repeated-hour offset.
  }
  const options = localTimeChoices(value);
  if (!options.length) throw new Error("This local time does not exist. Choose a valid date and time outside the daylight-saving gap.");
  if (options.length > 1 && !options.includes(choice)) throw new Error("This time occurs twice when daylight saving ends. Choose the intended UTC offset.");
  return options.length > 1 ? choice : options[0];
}
export function offsetLabel(instant: string) {
  return new Date(instant).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
}
export function meetingLockReason(meeting: Meeting, now = Date.now()) {
  if (meeting.status === "finalized") return "This meeting’s attendance is complete. Meeting details are locked.";
  if (now >= Date.parse(meeting.starts_at)) return "This meeting has started. Meeting details can only be edited before it starts.";
  return "";
}
export function scheduleLockReason(meeting: Meeting, records: Attendance[], hasStrikes: boolean, now = Date.now()) {
  const locked = meetingLockReason(meeting, now);
  if (locked) return locked;
  if (hasStrikes || records.some(a => a.checked_in_at || a.left_at || a.physical_status !== "pending" || a.reviewed_at || ["excused", "denied"].includes(a.review_status)))
    return "This meeting already has recorded attendance or a reviewed decision. Its schedule is locked to preserve those records.";
  return "";
}
