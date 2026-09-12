import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,role='mentor') {
 const id='00000000-0000-0000-0000-000000000001';
 const member={id,display_name:'Aiden',role,active:true,primary_area_id:null,updated_at:'2026-09-12T00:00:00Z',member_status:null,team_area:null};
 const data={members:[member],areas:[{id:'area',name:'Finance',active:true}],positions:[{key:'lead_coach_2',name:'Lead Coach 2',active:true},{key:'finance_lead',name:'Finance Lead',active:true}],assignments:[] as any[],history:[]};
 const calls:any[]=[];
 await page.addInitScript(({id})=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,token_type:'bearer',user:{id,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),{id});
 await page.route('**/rest/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/profiles'))return r.fulfill({json:member});
  if(path.endsWith('/team_management_context'))return r.fulfill({json:data});
  if(path.endsWith('/team_manage')){
   const body=r.request().postDataJSON();calls.push(body);
   if(body.action==='member')Object.assign(member,body.p,{updated_at:'2026-09-12T00:01:00Z'});
   if(body.action==='assign_position')data.assignments.push({id:'assignment',user_id:id,position_key:body.p.position_key,assigned_by:id,assigned_at:'2026-09-12T00:01:00Z',assignment_reason:body.p.reason,revoked_at:null});
   if(body.action==='revoke_position')data.assignments[0].revoked_at='2026-09-12T00:02:00Z';
   return r.fulfill({json:null});
  }
  return r.fulfill({json:[]});
 });return calls;
}
for(const width of [390,1440])test(`member editor and position add/remove at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const calls=await setup(page);
 await page.goto('/#team-management');await page.getByRole('button',{name:'Manage Aiden'}).click();
 const editor=page.getByRole('region',{name:'Member editor'});
 await editor.getByLabel('Display name',{exact:true}).fill('Aiden Updated');await editor.getByRole('combobox',{name:'Registration',exact:true}).selectOption('registered');await editor.getByRole('combobox',{name:'Functional area',exact:true}).selectOption('area');await editor.getByLabel('Reason for change').fill('Registration confirmed');await editor.getByRole('button',{name:'Save member'}).click();
 await expect(page.getByRole('status')).toContainText('updated');expect(calls[0].p.expected_updated_at).toBe('2026-09-12T00:00:00Z');
 await editor.getByRole('combobox',{name:'Position',exact:true}).selectOption('lead_coach_2');await editor.getByLabel('Assignment reason').fill('Season coach');await editor.getByRole('button',{name:'Assign position',exact:true}).click();
 await expect(editor.getByRole('heading',{name:'Lead Coach 2',exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/team-management-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await editor.getByLabel('Removal reason').fill('Term ended');await editor.getByRole('button',{name:'Remove position'}).click();
 await expect(editor.getByRole('button',{name:'Remove position'})).toHaveCount(0);expect(calls.map(c=>c.action)).toEqual(['member','assign_position','revoke_position']);
});
test('student cannot open management controls via a direct route',async({page})=>{
 const calls=await setup(page,'student');await page.goto('/#team-management');await expect(page.getByText('Active mentors and admins can manage the team.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:/Manage Aiden/})).toHaveCount(0);expect(calls).toHaveLength(0);
});

test('mentor creates a shared area through the audited RPC',async({page})=>{
 const calls=await setup(page);await page.goto('/#team-management');await page.getByText('Add team area',{exact:true}).click();
 await page.getByLabel('Area name',{exact:true}).fill('Operations');await page.getByLabel('Area key',{exact:true}).fill('operations');await page.getByLabel('Reason for new area').fill('New functional area');await page.getByRole('button',{name:'Add area',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Team area added.');expect(calls[0]).toEqual({action:'create_area',p:{name:'Operations',slug:'operations',reason:'New functional area'}});
});
