export type Reservation={id:string;send:boolean;status?:string;email?:string;display_name?:string};
export type Services={verify:(jwt:string)=>Promise<void>;reserve:(jwt:string,p:Record<string,unknown>)=>Promise<Reservation>;invite:(r:Reservation)=>Promise<string>;finish:(id:string,user:string|null)=>Promise<void>};
export async function handle(req:Request,s:Services){
 const origin=req.headers.get('origin');const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'https://team.frc4418.org','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const reply=(status:number,message:unknown)=>new Response(JSON.stringify(message),{status,headers});
 if(origin&&origin!=='https://team.frc4418.org')return reply(403,{error:'Origin not allowed'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 const jwt=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!jwt)return reply(401,{error:'Sign in required'});
 try{await s.verify(jwt);}catch{return reply(401,{error:'Sign in required'});}
 let p:Record<string,unknown>;try{const body=await req.text();if(body.length>16000)throw Error();p=JSON.parse(body);if(!p||typeof p!=='object'||!/^\b[0-9a-f-]{36}\b$/i.test(String(p.id)))throw Error();}catch{return reply(400,{error:'Valid invitation request required'});}
 let r:Reservation;
 try{r=await s.reserve(jwt,p);}catch{return reply(403,{error:'Invitation not allowed. Check manager access, member details, and existing invitations.'});}
 if(!r.send)return reply(200,{id:r.id,status:r.status});
 try{const user=await s.invite(r);await s.finish(r.id,user);return reply(202,{id:r.id,status:'pending'});}
 catch{
  // Never repeat an uncertain Auth email send. Persist a reviewed retry boundary.
  try{await s.finish(r.id,null);}catch{console.error('Invitation requires reconciliation',r.id);}
  return reply(502,{id:r.id,error:'Invitation needs review. Check Activity before trying again.'});
 }
}
