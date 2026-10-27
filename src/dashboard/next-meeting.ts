import {attendanceMeetingHref} from '../attendance/meeting-route';
import type {Dashboard} from './service';
export function nextMeetingAction(m:NonNullable<Dashboard['next_meeting']>,now=Date.now()) {
 const href=attendanceMeetingHref(m.id),start=Date.parse(m.starts_at),end=Date.parse(m.ends_at);
 const checkedIn=!!m.checked_in_at&&!m.left_at&&['present','late'].includes(m.physical_status);
 const open=m.check_in_open&&!!m.code_expires_at&&now<Date.parse(m.code_expires_at)&&now>=start-30*60_000&&now<end;
 return {href,open,checkedIn,status:m.left_at?'Checked out':checkedIn?'You’re checked in':null,
  action:href==='#attendance'?'View meeting':checkedIn&&now>=start&&now<end+30*60_000?'Check out':open&&!m.checked_in_at&&m.physical_status==='pending'?'Check in':'View meeting'};
}

// Prefer the checked-in meeting that ends first, including the established
// checkout grace. Never mistake an old unclosed record for a current visit.
export function currentCheckoutMeeting<T extends {id:string;starts_at:string;ends_at:string;status:string}>(meetings:T[],records:{meeting_id:string;physical_status:string;checked_in_at:string|null;left_at:string|null}[],now=Date.now()):T|undefined {
 return meetings.filter(m=>['draft','open','closed','finalized'].includes(m.status)&&Date.parse(m.starts_at)<=now&&now<Date.parse(m.ends_at)+30*60_000
  &&records.some(a=>a.meeting_id===m.id&&a.checked_in_at&&!a.left_at&&['present','late'].includes(a.physical_status)))
  .sort((a,b)=>Date.parse(a.ends_at)-Date.parse(b.ends_at)||a.id.localeCompare(b.id))[0];
}

// Copy presence, not record identity: attendance.id is not meeting.id. Keeping
// this projection explicit also makes richer API/mock rows safe to consume.
export function attendancePresence(row:{physical_status:string;checked_in_at:string|null;left_at:string|null}) {
 return {physical_status:row.physical_status,checked_in_at:row.checked_in_at,left_at:row.left_at};
}
