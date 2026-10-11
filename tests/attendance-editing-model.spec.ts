import {test,expect} from '@playwright/test';
import {bulkRequiredSelection,localMeetingTime,localTimeChoices,resolveMeetingTime,meetingLockReason,meetingRosterOptions,participantRequirementLockReason,requiredRosterChanges,requiredStudentIds,rosterEditFields,scheduleLockReason} from '../src/attendance/meetingEdit';
import type {Meeting,Attendance,Data,Member,Snapshot,Strike} from '../src/attendance/service';
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


const member = (id:string, name=id, member_status='registered'):Member => ({student_id:id,display_name:name,member_status,team_area:''});
const snapshot = (id:string, required=true, meeting_id='meeting'):Snapshot => ({student_id:id,required,meeting_id,member_status:'registered',team_area:''});
const attendance = (id:string, patch:Partial<Attendance>={}):Attendance => ({
 id:`attendance-${id}`,meeting_id:'meeting',student_id:id,physical_status:'pending',review_status:'none',
 checked_in_at:null,left_at:null,notice_at:null,notice_reason:'',review_reason:'',reviewed_by:null,reviewed_at:null,version:1,...patch,
});
const rosterData = ():Data => ({meetings:[],members:[],snapshots:[],attendance:[],strikes:[],history:[]});

test('required baselines retain unlisted snapshot IDs, with stable sorted set comparison',()=>{
 const data=rosterData();data.members=[member('current')];
 data.snapshots=[snapshot('unlisted'),snapshot('current'),snapshot('optional',false),snapshot('other',true,'another-meeting'),snapshot('current')];
 const base=requiredStudentIds(data.snapshots,'meeting');
 expect(base).toEqual(['current','unlisted']);
 expect(requiredRosterChanges(base,['unlisted','current','current'])).toEqual({before:2,after:2,added:[],removed:[],changed:false});
 expect(requiredRosterChanges(base,['current','new'])).toEqual({before:2,after:2,added:['new'],removed:['unlisted'],changed:true});
 // Roster sync can change snapshots without increasing the meeting version.
 data.snapshots.push(snapshot('new'));
 expect(requiredRosterChanges(base,requiredStudentIds(data.snapshots,'meeting')).changed).toBe(true);
 expect(base).toEqual(['current','unlisted']);
});

test('attendance evidence, submitted requests, decisions, and any strike lock a participant',()=>{
 const clean=attendance('requester');
 expect(participantRequirementLockReason(undefined,false)).toBe('');
 expect(participantRequirementLockReason(clean,false)).toBe('');
 expect(participantRequirementLockReason({...clean,review_status:'not_required'},false)).toBe('');
 for(const patch of [
  {notice_at:'2026-10-10T15:00:00Z'}, {review_status:'pending'}, {notice_type:'late' as const},
  {notice_reason:'School activity'}, {expected_at:'2026-10-12T18:30:00Z'},
 ]) expect(participantRequirementLockReason({...clean,...patch},false)).toMatch(/request.*normal request review workflow/);
 for(const patch of [
  {checked_in_at:'2026-10-12T17:55:00Z'}, {left_at:'2026-10-12T18:10:00Z'},
  {physical_status:'present'}, {physical_status:'late'}, {physical_status:'absent'}, {physical_status:'left_early'},
  {reviewed_at:'2026-10-10T16:00:00Z'}, {reviewed_by:'reviewer'}, {review_reason:'Existing review'}, {review_status:'excused'}, {review_status:'denied'},
 ]) expect(participantRequirementLockReason({...clean,...patch},false)).toMatch(/locks/);
 expect(participantRequirementLockReason({...clean,notice_reason:'  ',review_reason:'  '},false)).toBe('');
 expect(participantRequirementLockReason(clean,true)).toMatch(/locks/);
 expect(participantRequirementLockReason(undefined,true)).toMatch(/locks/);
});

test('roster options retain ineligible participants with policy-name and ID fallbacks',()=>{
 const data=rosterData();
 data.members=[member('available','Ada'),member('inactive','Ina','inactive'),member('not-snapshotted','Hidden inactive','inactive')];
 data.snapshots=[snapshot('inactive'),snapshot('policy-only'),snapshot('unknown-id'),snapshot('old-optional',false)];
 data.policy={user_id:'manager',can_review:true,can_read_team:true,can_manage_meetings:true,strike_year_start:null,warnings:[],people:[{id:'policy-only',name:'Former participant',role:'student',positions:[]}]};
 const options=meetingRosterOptions(data,'meeting',['draft-only']);
 expect(options.map(option=>option.id).sort()).toEqual(['available','draft-only','inactive','old-optional','policy-only','unknown-id']);
 expect(options.find(option=>option.id==='available')).toMatchObject({name:'Ada',lockReason:''});
 expect(options.find(option=>option.id==='inactive')).toMatchObject({name:'Ina',memberStatus:'inactive'});
 expect(options.find(option=>option.id==='inactive')!.lockReason).toMatch(/inactive/);
 expect(options.find(option=>option.id==='policy-only')).toMatchObject({name:'Former participant'});
 expect(options.find(option=>option.id==='unknown-id')).toMatchObject({name:'unknown-id'});
 for(const id of ['policy-only','unknown-id','old-optional','draft-only']) expect(options.find(option=>option.id===id)!.lockReason).toMatch(/eligible roster/);
});

test('roster locks are per participant and per meeting, including rescinded strikes',()=>{
 const data=rosterData();data.members=['checked-in','reviewed','struck','optional-struck','other-meeting','requester'].map(id=>member(id));
 data.attendance=[attendance('checked-in',{checked_in_at:'2026-10-12T17:55:00Z'}),attendance('reviewed',{review_status:'denied'}),attendance('requester',{review_status:'pending',notice_at:'2026-10-10T15:00:00Z'}),attendance('other-meeting',{meeting_id:'other',physical_status:'present'})];
 data.strikes=[{student_id:'struck',meeting_id:'meeting',rescinded_at:'2026-10-10T15:00:00Z'},{student_id:'optional-struck',meeting_id:'meeting',rescinded_at:null},{student_id:'other-meeting',meeting_id:'other',rescinded_at:null}] as Strike[];
 const options=meetingRosterOptions(data,'meeting');
 for(const id of ['checked-in','reviewed','struck','optional-struck','requester'])expect(options.find(option=>option.id===id)!.lockReason).toMatch(/locks/);
 for(const id of ['other-meeting'])expect(options.find(option=>option.id===id)!.lockReason).toBe('');
});

test('All active and Clear all preserve both required and optional locked people',()=>{
 const data=rosterData();data.members=['required-locked','optional-locked','editable','new'].map(id=>member(id));
 data.snapshots=[snapshot('unlisted'),snapshot('required-locked'),snapshot('optional-locked',false),snapshot('editable')];
 data.attendance=[attendance('required-locked',{review_status:'excused'}),attendance('optional-locked',{physical_status:'present'})];
 const base=requiredStudentIds(data.snapshots,'meeting');
 const options=meetingRosterOptions(data,'meeting',base);
 expect(bulkRequiredSelection(options,base,true)).toEqual(['editable','new','required-locked','unlisted']);
 expect(bulkRequiredSelection(options,base,false)).toEqual(['required-locked','unlisted']);
 expect(base).toEqual(['editable','required-locked','unlisted']);
});

test('roster payload is omitted when untouched and sends exact sorted expected baseline when changed',()=>{
 expect(rosterEditFields(['old','active'],['active','old'],false)).toEqual({});
 expect(rosterEditFields(['old','active'],['active','old'],true)).toEqual({});
 expect(rosterEditFields(['old','active'],['new','old','active'],true)).toEqual({
  required_student_ids:['active','new','old'],expected_required_student_ids:['active','old'],acknowledge_roster_change:true,
 });
 expect(rosterEditFields(['active'],[],true)).toEqual({required_student_ids:[],expected_required_student_ids:['active'],acknowledge_roster_change:true});
 expect(rosterEditFields([],['new'],false)).toEqual({required_student_ids:['new'],expected_required_student_ids:[],acknowledge_roster_change:false});
});

test('roster selection never mutates requests, attendance, snapshots, or policy data',()=>{
 const data=rosterData();data.members=[member('requester'),member('editable')];data.snapshots=[snapshot('requester'),snapshot('editable')];
 data.attendance=[attendance('requester',{review_status:'pending',notice_at:'2026-10-10T15:00:00Z',notice_reason:'School activity',notice_type:'early',expected_at:'2026-10-12T19:30:00Z'})];
 const before=JSON.stringify(data),base=requiredStudentIds(data.snapshots,'meeting');
 const selection=bulkRequiredSelection(meetingRosterOptions(data,'meeting',base),base,false);
 expect(selection).toEqual(['requester']);
 expect(rosterEditFields(base,selection,true)).toEqual({required_student_ids:['requester'],expected_required_student_ids:['editable','requester'],acknowledge_roster_change:true});
 expect(JSON.stringify(data)).toBe(before);
});
