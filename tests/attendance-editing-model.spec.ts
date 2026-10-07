import {test,expect} from '@playwright/test';
import {localMeetingTime,localTimeChoices,resolveMeetingTime,meetingLockReason,scheduleLockReason} from '../src/attendance/meetingEdit';
import type {Meeting,Attendance} from '../src/attendance/service';
const zone=process.env.TZ;
test.afterEach(()=>{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone;});
test('local times reject DST gaps and require explicit repeated-hour offset',()=>{
 process.env.TZ='America/Chicago';
 expect(localTimeChoices('2027-03-14T02:30')).toEqual([]);
 const repeated=localTimeChoices('2026-11-01T01:30');
 expect(repeated).toEqual(['2026-11-01T06:30:00.000Z','2026-11-01T07:30:00.000Z']);
 expect(()=>resolveMeetingTime('2026-11-01T01:30','2026-10-31T06:30:00Z','')).toThrow(/occurs twice/);
 expect(resolveMeetingTime('2026-11-01T01:30','2026-10-31T06:30:00Z',repeated[1])).toBe(repeated[1]);
 expect(resolveMeetingTime('2026-11-01T01:30','2026-11-01T07:30:35.000Z','')).toBe('2026-11-01T07:30:35.000Z');
 expect(()=>resolveMeetingTime('2027-03-14T02:30','2027-03-14T06:30:00Z','')).toThrow(/does not exist/);
});
test('overnight dates and invalid wall-clock dates retain exact instants',()=>{
 process.env.TZ='Asia/Kathmandu';
 expect(localMeetingTime('2027-10-07T18:00:00Z')).toBe('2027-10-07T23:45');
 expect(localTimeChoices('2027-10-08T01:00')).toEqual(['2027-10-07T19:15:00.000Z']);
 expect(localTimeChoices('2027-02-30T10:00')).toEqual([]);expect(localTimeChoices('')).toEqual([]);
});
test('all edits lock at the exact start; early attendance/review/strikes lock schedules',()=>{
 const m={starts_at:'2026-10-07T18:00:00Z',status:'draft'} as Meeting;
 const now=Date.parse(m.starts_at);
 expect(meetingLockReason(m,now-1)).toBe('');expect(meetingLockReason(m,now)).toMatch(/started/);
 expect(meetingLockReason({...m,status:'finalized'},now-1)).toMatch(/complete/);
 const pending={physical_status:'pending',review_status:'pending',notice_at:'2026-10-06T01:00:00Z'} as Attendance;
 expect(scheduleLockReason(m,[pending],false,now-1)).toBe('');
 expect(scheduleLockReason(m,[{...pending,checked_in_at:'2026-10-07T17:55:00Z'}],false,now-1)).toMatch(/recorded/);
 expect(scheduleLockReason(m,[{...pending,review_status:'excused'}],false,now-1)).toMatch(/recorded/);
 expect(scheduleLockReason(m,[pending],true,now-1)).toMatch(/recorded/);
});
