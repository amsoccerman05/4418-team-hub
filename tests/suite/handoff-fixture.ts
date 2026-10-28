import {expect,type BrowserContext} from '@playwright/test';
import {extname} from 'node:path';
import {loadArtifacts,verifyArtifacts,manifest} from './handoff-artifacts.mjs';
export const uid='00000000-0000-4000-8000-000000000001';
export const fixtureUser={id:uid,email:'suite-student@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const api='https://tuxwavmjvjfhmaddchtr.supabase.co';
const font='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=Manrope:wght@400;500;600;650;700;750;800&display=swap';
const token=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url')}.synthetic-signature`;
const area='44180000-0000-4000-8000-000000000001';
const po={id:'00000000-0000-4000-8000-000000000099',requester_id:uid,po_number:99,vendor:'Navigation test',amount:10,status:'awaiting_approval',revision:1,version:1,area_id:area,purpose:'Synthetic navigation check',sheet_url:'https://docs.google.com/spreadsheets/d/test/edit',created_at:'2026-10-28T00:00:00Z',school_reference:'',notes:'',school_note:'',needed_by:null,school_submitted_by:null,school_submitted_at:null,received_at:null,received_by:null,receipt_note:''};
const profile={id:uid,display_name:'Suite Student',email:fixtureUser.email,role:'student',primary_area_id:null,active:true,updated_at:'2026-10-28T00:00:00Z'};
const emptyTables=new Set(['locations','inventory_items','inventory_events','inventory_balances','inventory_movements','inventory_media','trips','trip_manifest_items','pit_events','pit_issues','pit_batteries','pit_battery_events','pit_issue_events','finance_po_approvals','finance_po_history','finance_po_revisions','finance_assignments','finance_po_actionability','team_meetings','team_attendance','team_meeting_members','team_announcements','team_positions']);
export async function setup(context:BrowserContext){
 const assets=await loadArtifacts(),unexpected:string[]=[],calls:{path:string;method:string}[]=[],roles=new Map<string,string>();
 await context.routeWebSocket('**/*',ws=>{const u=new URL(ws.url());if(!(u.origin==='wss://tuxwavmjvjfhmaddchtr.supabase.co'&&u.pathname==='/realtime/v1/websocket'))unexpected.push('WebSocket '+u.origin+u.pathname);ws.close();});
 await context.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url()),method=request.method();
  const deny=async()=>{unexpected.push(method+' '+u.origin+u.pathname);await route.abort('blockedbyclient');};
  if(u.href===font&&method==='GET')return route.fulfill({contentType:'text/css',body:'/* offline fallback fonts: no external font traffic */'});
  if(u.origin===api){
   calls.push({path:u.pathname,method});let result:any;const name=u.pathname.split('/').at(-1)!;
   if(u.pathname==='/auth/v1/token'&&method==='POST')result={access_token:token(),refresh_token:'synthetic-refresh-token',expires_in:3600,token_type:'bearer',user:fixtureUser};
   else if(u.pathname==='/auth/v1/user'&&method==='GET')result=fixtureUser;
   else if(u.pathname==='/auth/v1/logout'&&method==='POST')result={};
   else if(method==='GET'&&u.pathname==='/rest/v1/profiles'){expect(profile.role).toBe('student');roles.set(new URL(request.frame().url()).origin,profile.role);result=request.headers().accept?.includes('object')?profile:[profile];}
   else if(method==='GET'&&u.pathname==='/rest/v1/areas')result=[{id:area,name:'Fabrication',slug:'fabrication',active:true}];
   else if(method==='GET'&&u.pathname==='/rest/v1/categories')result=[{name:'Tools'}];
   else if(method==='GET'&&u.pathname==='/rest/v1/finance_purchase_orders')result=[po];
   else if(method==='GET'&&u.pathname.startsWith('/rest/v1/')&&emptyTables.has(name))result=[];
   else if(method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
    if(name==='team_dashboard_context'){result={name:profile.display_name,role:'student',admin:false,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[po],finance:{allowed:true,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]};}
    else if(name==='planning_my_work_context')result={user_id:uid,season_id:null,seasons:[],boards:[],tasks:[]};
    else if(name==='notification_center')result={unread:0,attention:[],items:[],has_more:false};
    else if(name==='finance_context'){result={profile:{id:uid,display_name:profile.display_name,role:'student'},can_create:true,is_admin:false,capabilities:[],areas:[{id:area,name:'Fabrication',active:true}],people:[]};}
    else if(name==='inventory_features')result=4;
    else if(name==='inventory_location_creation_context')result={user_id:uid,assigned_lead:false};
    else if(name==='pit_competition_context')result={can_manage:false,config:null,matches:[],templates:[],runs:[],items:[],links:[],areas:[]};
    else return deny();
   }else return deny();
   if(name==='team_dashboard_context'){expect(result.role).toBe('student');roles.set('https://team.frc4418.org',result.role);}
   if(name==='finance_context'){expect(result.profile.role).toBe('student');roles.set('https://finance.frc4418.org',result.profile.role);}
   return route.fulfill({json:result,headers:{'content-range':'0-0/0','access-control-allow-origin':'*'}});
  }
  if(method==='GET'){
   const url=u.origin+(u.pathname==='/'?'/index.html':u.pathname),bytes=assets.get(url);
   if(bytes&&u.search==='')return route.fulfill({body:bytes,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'} as Record<string,string>)[extname(u.pathname==='/'?'index.html':u.pathname)]||'application/octet-stream'});
   if(u.href==='https://untrusted.frc4418.org/')return route.fulfill({contentType:'text/html',body:'<p>Untrusted synthetic origin</p>'});
  }
  return deny();
 });
 return {calls,roles,async verify(allRoles=false){expect(unexpected,'Every unknown HTTP/WebSocket request must fail closed').toEqual([]);if(allRoles)for(const a of Object.values(manifest.apps) as any[])expect(roles.get(a.origin),a.origin+' must receive literal Student').toBe('student');await verifyArtifacts(process.env.HANDOFF_DIST_ROOT);}};
}
