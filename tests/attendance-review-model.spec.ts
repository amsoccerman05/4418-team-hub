import {test,expect} from '@playwright/test';
import {canReview,requiresMentorReview,canParticipate,isManager,rosterSyncMeetings,type Attendance,type Data} from '../src/attendance/service';
const record=(student_id:string)=>({student_id} as Attendance);
function data(mentor=false):Data {
 return {meetings:[],attendance:[],snapshots:[],strikes:[],history:[],members:[],policy:{
  user_id:'reviewer',can_review:true,can_review_requests:true,can_read_team:true,can_manage_meetings:mentor,
  strike_year_start:null,people:[],warnings:[],
  can_review_program_manager_requests:mentor,mentor_review_required_for:['student-pm','lead-pm'],
 }};
}
for(const requester of ['student-pm','lead-pm']) {
 test(`only lead-coach review controls appear for ${requester}`,()=>{
  expect(requiresMentorReview(data(),requester)).toBe(true);
  expect(canReview(data(),record(requester))).toBe(false);
  expect(canReview(data(true),record(requester))).toBe(true);
  // A missing affirmative lead-coach capability cannot reveal the review form.
  const stale=data();delete stale.policy!.can_review_program_manager_requests;
  expect(canReview(stale,record(requester))).toBe(false);
 });
}
test('Program Manager retains ordinary student/lead review and general strike capability',()=>{
 for(const requester of ['student','lead']) expect(canReview(data(),record(requester))).toBe(true);
 expect(canReview(data())).toBe(true);
 expect(requiresMentorReview(data(),'student')).toBe(false);
});
test('self-approval is hidden even for a mentor or a Program Manager with review rights',()=>{
 for(const mentor of [false,true]) expect(canReview(data(mentor),record('reviewer'))).toBe(false);
});
test('general reviewer permission is mandatory even when mentor-specific permission is present',()=>{
 const value=data(true);value.policy!.can_review=false;
 expect(canReview(value,record('student-pm'))).toBe(false);
 expect(canReview(value,record('student'))).toBe(false);
 expect(canReview(value)).toBe(false);
 delete value.policy;expect(canReview(value,record('student-pm'))).toBe(false);
});

for(const role of ['mentor','admin']) test(`${role} Program Manager participates without changing shared management role`,()=>{
 const profile={id:'pm',display_name:'Synthetic PM',role,active:true};
 const d=data();d.policy!.can_participate=true;
 expect(canParticipate(profile,d)).toBe(true);expect(isManager(profile)).toBe(true);expect(profile.role).toBe(role);
 d.policy!.can_participate=false;expect(canParticipate(profile,d)).toBe(false);expect(isManager(profile)).toBe(true);
 delete d.policy!.can_participate;expect(canParticipate(profile,d)).toBe(false);
});
test('participant capability honors inactive accounts and authoritative denial',()=>{
 const d=data();d.policy!.can_participate=true;
 expect(canParticipate({id:'p',display_name:'Inactive',role:'mentor',active:false},d)).toBe(false);
 expect(canParticipate({id:'p',display_name:'Readonly',role:'readonly',active:true},d)).toBe(false);
 d.policy!.can_participate=false;
 expect(canParticipate({id:'p',display_name:'Denied',role:'lead',active:true},d)).toBe(false);
 delete d.policy!.can_participate;
 for(const role of ['student','lead'])expect(canParticipate({id:'p',display_name:'Legacy',role,active:true},d)).toBe(true);
});

test('roster selection is member-specific and excludes past, finalized and non-broad meetings',()=>{
 const d=data(),base={id:'active',title:'Meeting',meeting_type:'preseason',starts_at:'2026-10-09T17:00:00Z',ends_at:'2026-10-09T19:00:00Z',late_minutes:5,requirement:'active',status:'draft',check_in_open:false,code_expires_at:null,version:1};
 d.meetings=[base,{...base,id:'registered',requirement:'registered'},{...base,id:'optional',requirement:'optional'},{...base,id:'area',requirement:'areas'},{...base,id:'selected',requirement:'selected'},{...base,id:'final',status:'finalized'},{...base,id:'past',starts_at:'2026-10-01T17:00:00Z'}];
 const member={student_id:'pm',display_name:'Synthetic PM',member_status:'prospective',team_area:''},now=Date.parse('2026-10-08T17:00:00Z');
 expect(rosterSyncMeetings(d,member,now).map(m=>m.id)).toEqual(['active']);
 expect(rosterSyncMeetings(d,{...member,member_status:'registered'},now).map(m=>m.id)).toEqual(['active','registered']);
 expect(rosterSyncMeetings(d,{...member,member_status:'inactive'},now)).toEqual([]);
 expect(rosterSyncMeetings(d,{...member,member_status:'registered'},Date.parse(base.starts_at))).toEqual([]);
});

test('ordinary mentors retain strikes but have no request decision capability',()=>{
 const d=data(true);d.policy!.can_review_requests=false;d.policy!.can_review_program_manager_requests=false;
 for(const id of ['student','student-pm'])expect(canReview(d,record(id))).toBe(false);
 expect(canReview(d)).toBe(true);expect(d.policy!.can_manage_meetings).toBe(true);
 delete d.policy!.can_review_requests;expect(canReview(d,record('student'))).toBe(false);
});
