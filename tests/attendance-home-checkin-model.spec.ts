import {test,expect} from '@playwright/test';
import {attendanceMeetingId,attendanceMeetingHref} from '../src/attendance/meeting-route';
import {nextMeetingAction,currentCheckoutMeeting,currentPendingMeeting,attendancePresence} from '../src/dashboard/next-meeting';
const id='00000000-0000-0000-0000-000000000001',now=Date.parse('2026-10-27T17:10:00Z');
const meeting={id,title:'Build',type:'preseason',starts_at:'2026-10-27T17:00:00Z',ends_at:'2026-10-27T19:00:00Z',required:true,check_in_open:true,code_expires_at:'2026-10-27T17:30:00Z',physical_status:'pending'};
test('meeting routes accept only exact UUID targets, never codes or write arguments',()=>{
 expect(attendanceMeetingId(`#attendance/meeting/${id}`)).toBe(id);expect(attendanceMeetingHref(id)).toBe(`#attendance/meeting/${id}`);
 for(const route of ['#attendance/meeting/nope',`#attendance/meeting/${id}/check-in`,`#attendance/meeting/${id}?code=123456`,'https://example.invalid'])expect(attendanceMeetingId(route)).toBeNull();
});
test('home action distinguishes pending, checked in, and checked out with timestamps',()=>{
 expect(nextMeetingAction(meeting,now)).toMatchObject({action:'Check in',open:true});
 const here={...meeting,physical_status:'present',checked_in_at:meeting.starts_at,left_at:null};
 expect(nextMeetingAction(here,now)).toMatchObject({action:'Check out',status:'You’re checked in'});
 expect(nextMeetingAction({...here,left_at:new Date(now).toISOString()},now)).toMatchObject({action:'View meeting',status:'Checked out'});
 expect(nextMeetingAction({...meeting,code_expires_at:new Date(now).toISOString()},now).action).toBe('View meeting');
 expect(nextMeetingAction(meeting,Date.parse(meeting.starts_at)-30*60_000-1).action).toBe('View meeting');
 expect(nextMeetingAction(meeting,Date.parse(meeting.ends_at)).action).toBe('View meeting');
 expect(nextMeetingAction(here,Date.parse(meeting.ends_at)+30*60_000).action).toBe('View meeting');
});

test('current checkout selection honors exact grace, roster records, cancellation and overlap',()=>{
 const m={...meeting,status:'finalized',starts_at:'2026-10-27T15:00:00Z',ends_at:'2026-10-27T17:00:00Z'};
 const a={meeting_id:id,physical_status:'present',checked_in_at:m.starts_at,left_at:null};
 expect(currentCheckoutMeeting([m],[a],now)).toEqual(m);
 expect(currentCheckoutMeeting([m],[a],Date.parse(m.ends_at)+30*60_000)).toBeUndefined();
 expect(currentCheckoutMeeting([{...m,status:'canceled'}],[a],now)).toBeUndefined();
 expect(currentCheckoutMeeting([m],[{...a,left_at:m.ends_at}],now)).toBeUndefined();
 expect(currentCheckoutMeeting([m],[{...a,physical_status:'absent'}],now)).toBeUndefined();
 expect(currentCheckoutMeeting([m],[],now)).toBeUndefined();
 const later={...m,id:'00000000-0000-0000-0000-000000000002',ends_at:'2026-10-27T18:00:00Z'};
 expect(currentCheckoutMeeting([later,m],[a,{...a,meeting_id:later.id}],now)?.id).toBe(id);
 expect(currentCheckoutMeeting([{...m,starts_at:'2026-10-27T18:00:00Z'}],[a],now)).toBeUndefined();
});

test('presence enrichment cannot replace meeting identity with attendance record identity',()=>{
 const row={id:'different-attendance-record',meeting_id:id,student_id:'someone',physical_status:'present',checked_in_at:meeting.starts_at,left_at:null};
 const enriched={...meeting,...attendancePresence(row)};
 expect(enriched.id).toBe(id);expect(nextMeetingAction(enriched,now).href).toBe(`#attendance/meeting/${id}`);
 expect(attendancePresence(row)).toEqual({physical_status:'present',checked_in_at:meeting.starts_at,left_at:null});
});

test('ongoing pending fallback excludes future, ended, closed, recorded, and unrostered meetings',()=>{
 const m={...meeting,status:'open'};
 const a={meeting_id:id,physical_status:'pending',checked_in_at:null,left_at:null};
 expect(currentPendingMeeting([m],[a],now)).toEqual(m);
 expect(currentPendingMeeting([{...m,status:'draft'}],[a],now)).toMatchObject({id});
 for(const status of ['closed','finalized','canceled'])expect(currentPendingMeeting([{...m,status}],[a],now)).toBeUndefined();
 expect(currentPendingMeeting([m],[a],Date.parse(m.starts_at)-1)).toBeUndefined();
 expect(currentPendingMeeting([m],[a],Date.parse(m.ends_at))).toBeUndefined();
 expect(currentPendingMeeting([m],[],now)).toBeUndefined();
 for(const change of [{physical_status:'present'},{checked_in_at:m.starts_at},{left_at:m.starts_at}])expect(currentPendingMeeting([m],[{...a,...change}],now)).toBeUndefined();
 const later={...m,id:'00000000-0000-0000-0000-000000000002',ends_at:'2026-10-27T20:00:00Z'};
 expect(currentPendingMeeting([later,m],[a,{...a,meeting_id:later.id}],now)?.id).toBe(id);
});
