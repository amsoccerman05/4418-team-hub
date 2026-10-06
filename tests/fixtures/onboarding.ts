import type {Page,Route} from '@playwright/test';
export async function onboardingFixture(page:Page,role='mentor'){
 const owner='00000000-0000-0000-0000-000000000001';
 const data:any={members:[{id:owner,email:'manager@example.test',display_name:'Fixture Manager',role,active:true,primary_area_id:null,updated_at:'2026-09-12T00:00:00Z',member_status:null,team_area:null}],areas:[{id:'area',name:'Build',active:true}],positions:[],assignments:[],invitations:[],history:[]};
 const sent:any[]=[],control:{send?:(payload:any,route:Route)=>Promise<void>;context?:()=>Promise<void>}={};
 await page.addInitScript(({owner})=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,token_type:'bearer',user:{id:owner,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),{owner});
 await page.route('https://team.frc4418.org/**',route=>route.abort());
 await page.route('https://*.supabase.co/**',route=>route.abort());
 await page.route('**/rest/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/profiles'))return route.fulfill({json:data.members[0]});
  if(path.endsWith('/team_management_context_v2')){await control.context?.();return route.fulfill({json:data});}
  if(path.endsWith('/notification_center'))return route.fulfill({json:{unread:0,attention:[],items:[],has_more:false}});
  return route.fulfill({status:400,json:{message:'Unexpected fixture request'}});
 });
 await page.route('**/functions/v1/team-invitations',async route=>{
  const payload=route.request().postDataJSON();sent.push(payload);
  if(control.send)return control.send(payload,route);
  data.invitations.push({id:payload.id,email:payload.email,display_name:payload.display_name,status:'pending',created_at:'2026-10-05T12:00:00Z',user_id:null});
  await route.fulfill({status:202,json:{id:payload.id,status:'pending'}});
 });
 return {data,sent,control};
}
export async function openOnboarding(page:Page){await page.goto('/#team-management');await page.getByRole('button',{name:'Onboarding',exact:true}).click();return page.getByRole('region',{name:'Team onboarding',exact:true});}
export async function prepareBatch(page:Page,text='Alex Rivera, alex@example.test\nJordan Lee, jordan@example.test'){
 const ui=await openOnboarding(page);await ui.getByText('Invite a group',{exact:true}).click();await ui.getByLabel('Names and emails',{exact:true}).fill(text);await ui.getByLabel('Reason for these invitations',{exact:true}).fill('Joining the build team');await ui.getByRole('button',{name:'Add pasted recipients',exact:true}).click();await ui.getByRole('button',{name:'Review batch',exact:true}).click();return ui;
}
