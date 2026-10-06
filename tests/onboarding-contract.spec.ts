import {test,expect} from '@playwright/test';
import {classifyInvitationResponse} from '../src/team/invitation-client';
import {parseInvitationList} from '../src/team/onboarding-input';
import {invitationSetup,attendanceRegistration,linkedInvitationMember,type OnboardingInvitation} from '../src/team/onboarding-status';
import {readFileSync} from 'node:fs';
const id='00000000-0000-0000-0000-000000000001';
for(const status of [200,202])test(`only confirmed matching pending responses are accepted ${status}`,()=>{
 expect(classifyInvitationResponse(id,{id,status:'pending'},status,false)).toMatchObject({status:'accepted',alreadyInvited:false});
 expect(classifyInvitationResponse(id,{id,status:'pending',already_invited:true},status,false)).toMatchObject({status:'accepted',alreadyInvited:true});
});
for(const [status,body,code] of [
 [400,{error:'Valid invitation request required'},'invalid_request'],[401,{error:'Sign in required'},'sign_in_required'],
 [403,{error:'Origin not allowed'},'origin_not_allowed'],[403,{code:'manager_required'},'manager_required'],
 [405,{error:'POST required'},'method_not_allowed'],[409,{code:'invalid_details'},'invalid_details'],[409,{code:'inactive_area'},'inactive_area'],[409,{code:'existing_account'},'existing_account'],
] as const)test(`explicit ${code} rejection establishes no send`,()=>{
 expect(classifyInvitationResponse(id,body,status,true)).toMatchObject({status:'not_sent',stage:'before_reservation',code});
});
for(const [label,status,body,error] of [
 ['missing HTTP result',null,{id,status:'pending'},false],['unexpected HTTP success',201,{id,status:'pending'},false],
 ['missing identity',202,{status:'pending'},false],['different identity',202,{id:'other',status:'pending'},false],['malformed body',200,'pending',false],
 ['unexpected state',200,{id,status:'accepted'},false],['bad already flag',200,{id,status:'pending',already_invited:'true'},false],
 ['server failure',502,{code:'invalid_details'},true],['unknown reservation failure',403,{error:'Invitation not allowed. Check manager access, member details, and existing invitations.'},true],
 ['rate limit',429,{error:'Too many requests'},true],['unknown bad input',400,{error:'Something went wrong'},true],['reserved UUID',409,{code:'already_reserved'},true],
 ['processing',409,{id,status:'processing'},true],['review',409,{id,status:'review'},true],['network',null,null,true],
] as const)test(`ambiguous ${label} requires review without retry`,()=>{expect(classifyInvitationResponse(id,body,status,error).status).toBe('review');});
test('success wording distinguishes service acceptance, setup, and delivery',()=>{
 const result=classifyInvitationResponse(id,{id,status:'pending'},202,false);expect(result.message).toContain('setup is still pending');expect(result.message).toContain('delivery is not confirmed');expect(result.message).not.toContain('setup is complete');
});
test('paste supports two columns and quoted names without interpreting roles or code',()=>{
 expect(parseInvitationList('Name, email\n"Lee, Jordan", jordan@example.test\nAlex Rivera\talex@example.test')).toEqual({recipients:[{display_name:'Lee, Jordan',email:'jordan@example.test'},{display_name:'Alex Rivera',email:'alex@example.test'}],errors:[]});
 expect(parseInvitationList('Alex, alex@example.test, admin').errors).toHaveLength(1);expect(parseInvitationList('"Unclosed, example@test.invalid').errors).toHaveLength(1);
 expect(parseInvitationList('<script>name</script>, a@example.test').recipients[0].display_name).toBe('<script>name</script>');
});
test('status never infers acceptance or registration from matching email',()=>{
 const base:OnboardingInvitation={id,email:'same@example.test',display_name:'Fixture',status:'account_active',created_at:'2026-01-01',user_id:null};
 const members=[{id:'actual',email:base.email,display_name:'Actual',active:true,member_status:'registered'}];
 expect(invitationSetup(base).label).toBe('Account active');expect(linkedInvitationMember(base,members)).toBeUndefined();expect(attendanceRegistration(undefined).label).toBe('Unavailable');
 expect(attendanceRegistration(linkedInvitationMember({...base,user_id:'actual'},members)).label).toBe('Registered');
 expect(invitationSetup({...base,status:'pending'}).description).toContain('has not signed in');expect(invitationSetup({...base,status:'accepted'}).label).toBe('Sign-in recorded');
 expect(attendanceRegistration({...members[0],active:false,member_status:'registered'})).toMatchObject({label:'Registered',description:expect.stringContaining('account is inactive')});
});
test('onboarding remains client-only and does not add credential/storage/provider behavior',()=>{
 const ui=['src/team/Onboarding.tsx','src/team/invitation-client.ts','src/team/invitation-batch.ts'].map(path=>readFileSync(path,'utf8')).join('\n');
 expect(ui).not.toMatch(/SERVICE_ROLE|auth\.admin|\/auth\/v1\/invite|localStorage|sessionStorage|setTimeout|setInterval/);
 const client=readFileSync('src/team/invitation-client.ts','utf8');expect((client.match(/functions\.invoke\(/g)||[])).toHaveLength(1);
});
