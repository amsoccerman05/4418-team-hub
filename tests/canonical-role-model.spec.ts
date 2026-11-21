import {test,expect} from '@playwright/test';
import {ACCOUNT_ROLES,inviteRoles} from '../src/roles';
import {classifyInvitationResponse} from '../src/team/invitation-client';
import {canParticipate,isManager,type Data} from '../src/attendance/service';
const id='00000000-0000-0000-0000-000000000001';
test('exactly five selectable roles and no legacy actor authority',()=>{expect(ACCOUNT_ROLES).toEqual(['readonly','student','lead','admin_lead','mentor']);expect(inviteRoles('mentor')).toEqual(['student','lead','admin_lead','mentor','readonly']);expect(inviteRoles('admin_lead')).toEqual(['student']);for(const r of ['admin','lead','student','readonly','unknown'])expect(inviteRoles(r)).toEqual([]);});
test('new retired-role denial is not sent but recorded historical uncertainty is never safe to resend',()=>{expect(classifyInvitationResponse(id,{code:'retired_role'},403,true)).toMatchObject({status:'not_sent',code:'retired_role',stage:'before_reservation'});for(const [body,status] of [[{code:'already_reserved'},409],[{code:'retired_role',status:'review'},403],[{code:'retired_role'},502]] as const)expect(classifyInvitationResponse(id,body,status,true).status).toBe('review');});
test('old profile cannot advertise Attendance management or participation even with stale capability',()=>{const profile={id,display_name:'Historical fixture',active:true,role:'admin'};expect(isManager(profile)).toBe(false);expect(canParticipate(profile,{policy:{can_participate:true}} as Data)).toBe(false);});
