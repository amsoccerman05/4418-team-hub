import {handle,type Reservation} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
async function api(path:string,token:string,key:string,body?:unknown){
 if(!url||!key)throw Error('Configuration missing');
 const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Request rejected');return r.status===204?null:r.json();
}
Deno.serve(req=>handle(req,{
 verify:async jwt=>{const u=await api('/auth/v1/user',jwt,anon);if(!u.id)throw Error('Invalid caller');},
 reserve:(jwt,p)=>api('/rest/v1/rpc/team_invitation_reserve',jwt,anon,{p}),
 invite:async(r:Reservation)=>{const u=await api('/auth/v1/invite?redirect_to='+encodeURIComponent('https://team.frc4418.org/?password-reset=1'),service,service,{email:r.email,data:{display_name:r.display_name,team_invitation_id:r.id}});if(!u.id)throw Error('Missing invite identity');return u.id;},
 finish:async(id,user)=>{await api('/rest/v1/rpc/team_invitation_finish',service,service,{invitation_id:id,invited_user:user});},
}));
