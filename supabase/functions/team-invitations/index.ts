import {handle,InvitationError,type Reservation} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
async function api(path:string,token:string,key:string,body?:unknown){
 if(!url||!key)throw Error('Configuration missing');
 const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path.startsWith('/auth/v1/invite')?30000:10000)});
 if(!r.ok){
  const error=await r.json().catch(()=>({}));
  // Expose only known reservation messages, never raw Auth/provider responses.
  if(path==='/rest/v1/rpc/team_invitation_reserve'){
   const allowed:Record<string,string>={
    'Account already exists. Manage the existing member.':'existing_account',
    'Active mentor or admin required':'manager_required',
    'Active lead, mentor or admin required':'inviter_required',
    'Leads can invite students only':'student_only',
    'Invitation request unavailable for this account':'invitation_not_owned',
    'Invitation details changed. Review the recorded invitation; do not resend.':'already_reserved',
    'Valid invitation role and registration required':'invalid_details',
    'Valid email, name and reason required':'invalid_details',
    'Choose an active area':'inactive_area',
   };
   const code=allowed[error.message];
   if(code)throw new InvitationError(code,['manager_required','inviter_required','student_only','invitation_not_owned'].includes(code)?403:409,error.message);
   if(error.code==='23505')throw new InvitationError('already_reserved',409,'An invitation is already recorded. Reload the member list and check its status; do not resend.');
  }
  throw Error('Request rejected');
 }return r.status===204?null:r.json();
}
Deno.serve(req=>handle(req,{
 verify:async jwt=>{const u=await api('/auth/v1/user',jwt,anon);if(!u.id)throw Error('Invalid caller');},
 reserve:(jwt,p)=>api('/rest/v1/rpc/team_invitation_reserve',jwt,anon,{p}),
 invite:async(r:Reservation)=>{const u=await api('/auth/v1/invite?redirect_to='+encodeURIComponent('https://team.frc4418.org/?password-reset=1'),service,service,{email:r.email,data:{display_name:r.display_name,team_invitation_id:r.id}});if(!u.id)throw Error('Missing invite identity');return u.id;},
 finish:async(id,user)=>{await api('/rest/v1/rpc/team_invitation_finish',service,service,{invitation_id:id,invited_user:user});},
}));
