import {test,expect} from '@playwright/test';
import {canReview,requiresMentorReview,type Attendance,type Data} from '../src/attendance/service';
const record=(student_id:string)=>({student_id} as Attendance);
function data(mentor=false):Data {
 return {meetings:[],attendance:[],snapshots:[],strikes:[],history:[],members:[],policy:{
  user_id:'reviewer',can_review:true,can_read_team:true,can_manage_meetings:mentor,
  strike_year_start:null,people:[],warnings:[],
  can_review_program_manager_requests:mentor,mentor_review_required_for:['student-pm','lead-pm'],
 }};
}
for(const requester of ['student-pm','lead-pm']) {
 test(`only mentor review controls appear for ${requester}`,()=>{
  expect(requiresMentorReview(data(),requester)).toBe(true);
  expect(canReview(data(),record(requester))).toBe(false);
  expect(canReview(data(true),record(requester))).toBe(true);
  // A missing affirmative mentor capability cannot reveal the review form.
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
