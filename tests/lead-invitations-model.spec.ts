import {test,expect} from '@playwright/test';
import {createInvitationRow,reviewInvitationBatch,INVITATION_ROLES} from '../src/team/invitation-batch';
import {classifyInvitationResponse} from '../src/team/invitation-client';
import {handle,InvitationError,type Services} from '../supabase/functions/team-invitations/handler';
const id='00000000-0000-0000-0000-000000000001';
test('student-only review rejects every elevated role while manager review remains intact',()=>{
 for(const role of INVITATION_ROLES){const rows=[createInvitationRow({display_name:'Synthetic Student',email:'student@example.test',role,reason:'Joining team'},()=>id)];const lead=reviewInvitationBatch(rows,{areas:[],existingEmails:[],studentOnly:true});expect(lead.issues.length===0).toBe(role==='student');expect(lead.rows[0].status).toBe(role==='student'?'ready':'draft');expect(reviewInvitationBatch(rows,{areas:[],existingEmails:[]}).issues).toEqual([]);}
});
for(const code of ['inviter_required','student_only','invitation_not_owned'] as const)test(`${code} is a conclusive pre-send rejection and never calls privileged Auth`,async()=>{
 let sent=0;const s:Services={verify:async()=>{},reserve:async()=>{throw new InvitationError(code,403,'Not allowed')},invite:async()=>{sent++;return 'identity'},finish:async()=>{}};
 const req=new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer fixture-only',Origin:'https://team.frc4418.org'},body:JSON.stringify({id})});const r=await handle(req,s);expect(r.status).toBe(403);expect(classifyInvitationResponse(id,await r.json(),r.status,true)).toMatchObject({status:'not_sent',code});expect(sent).toBe(0);
 expect(classifyInvitationResponse(id,{code},502,true).status).toBe('review');
});
test('lead batch retains conservative provider rate-limit and already-reserved handling',()=>{for(const [status,body] of [[429,{error:'Too many requests'}],[409,{code:'already_reserved'}],[502,{status:'review'}]] as const)expect(classifyInvitationResponse(id,body,status,true).status).toBe('review')});
