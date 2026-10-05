import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,role='mentor',own=true) {
 const id='00000000-0000-0000-0000-000000000001';
 const member={id:own?id:'00000000-0000-0000-0000-000000000002',email:'mentor@example.test',display_name:'Aiden',role,active:true,primary_area_id:null,updated_at:'2026-09-12T00:00:00Z',member_status:null,team_area:null};
 const data:any={members:[member],areas:[{id:'area',name:'Finance',active:true}],positions:[{key:'lead_coach_2',name:'Lead Coach 2',active:true},{key:'finance_lead',name:'Finance Lead',active:true}],invitations:[{id:'pending',display_name:'New member',email:'invited@example.test',status:'pending'},{id:'active',display_name:'Existing member',email:'active@example.test',status:'account_active'},{id:'review',display_name:'Review member',email:'review@example.test',status:'review',review_reason:'identity_unmatched'}],assignments:[] as any[],history:[]};
 const calls:any[]=[];
 await page.addInitScript(({id})=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,token_type:'bearer',user:{id,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),{id});
 await page.route('**/rest/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/team_dashboard_context'))return r.fulfill({json:{name:'Aiden',role,admin:['mentor','admin'].includes(role),personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]}});
  if(path.endsWith('/profiles'))return r.fulfill({json:member});
  if(path.endsWith('/team_management_context_v2'))return r.fulfill({json:{...data,positions:data.positions.map((p:any)=>({...p,version:p.version||1,category:p.category||(['lead_coach_1','lead_coach_2'].includes(p.key)?'Coaching':['program_manager','product_technical_manager'].includes(p.key)?'Program':'Functional Leads')}))}});
  if(path.endsWith('/team_manage_v2')){
   const body=r.request().postDataJSON();calls.push(body);
   if(body.action==='position_save'){if(body.p.create)data.positions.push({...body.p,active:true,version:1});else Object.assign(data.positions.find((p:any)=>p.key===body.p.key),body.p);}
   if(body.action==='area_save')Object.assign(data.areas.find((a:any)=>a.id===body.p.id),body.p);
   if(body.action==='member_state')Object.assign(member,body.p);
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
 await page.goto('/#team-management');await page.getByRole('button',{name:'Manage'}).click();
 const editor=page.getByRole('region',{name:'Member editor'});
 await expect(editor.getByRole('combobox',{name:'Account role',exact:true})).toBeDisabled();
 await expect(editor.getByText('Ask another mentor to change your account role.')).toBeVisible();
 await editor.getByLabel('Display name',{exact:true}).fill('Aiden Updated');await editor.getByRole('combobox',{name:'Registration',exact:true}).selectOption('registered');await editor.getByRole('combobox',{name:'Functional area',exact:true}).selectOption('area');await editor.getByLabel('Reason for change').fill('Registration confirmed');await editor.getByRole('button',{name:'Save member'}).click();
 await expect(page.getByRole('status')).toContainText('updated');expect(calls[0].p.expected_updated_at).toBe('2026-09-12T00:00:00Z');
 await editor.getByText('Team positions',{exact:true}).click();
 await editor.getByRole('combobox',{name:'Position',exact:true}).selectOption('lead_coach_2');await editor.getByLabel('Assignment reason').fill('Season coach');await editor.getByRole('button',{name:'Assign position',exact:true}).click();
 await expect(editor.getByRole('heading',{name:'Lead Coach 2',exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/team-management-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await editor.getByLabel('Removal reason').fill('Term ended');await editor.getByRole('button',{name:'Remove position'}).click();
 await expect(editor.getByRole('button',{name:'Remove position'})).toHaveCount(0);expect(calls.map(c=>c.action)).toEqual(['member','assign_position','revoke_position']);
});
test('student cannot open management controls via a direct route',async({page})=>{
 const calls=await setup(page,'student');await page.goto('/#team-management');await expect(page.getByText('Active mentors and admins can manage the team.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:/Manage/})).toHaveCount(0);expect(calls).toHaveLength(0);
});

test('mentor creates a shared area through the audited RPC',async({page})=>{
 const calls=await setup(page);await page.goto('/#team-management');await page.getByRole('button',{name:'Areas',exact:true}).click();await page.getByText('+ New area',{exact:true}).click();
 await page.getByLabel('Area name',{exact:true}).fill('Operations');await page.getByLabel('Area key',{exact:true}).fill('operations');await page.getByLabel('Reason for new area').fill('New functional area');await page.getByRole('button',{name:'Add area',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Team area added.');expect(calls[0]).toEqual({action:'create_area',p:{name:'Operations',slug:'operations',reason:'New functional area'}});
});

for(const width of [390,1440])test(`focused management views and keyboard dismissal ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);await page.goto('/#team-management');
 await page.getByRole('button',{name:'Positions',exact:true}).click();await expect(page.getByText('Unassigned',{exact:true})).toHaveCount(2);
 await page.screenshot({path:`test-results/positions-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Activity',exact:true}).click();await expect(page.getByText('No changes recorded yet.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Members',exact:true}).click();await page.getByLabel('Find a member').fill('missing');await page.getByRole('button',{name:'Clear search'}).click();
 await page.getByRole('button',{name:'Manage'}).click();await expect(page.getByRole('dialog',{name:'Member editor'})).toBeVisible();
 await page.screenshot({path:`test-results/member-modal-${width}.png`,fullPage:true});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Manage'})).toBeFocused();
});

for(const role of ['mentor','admin','student'])test(`homepage administration visibility for ${role}`,async({page})=>{
 await setup(page,role);await page.goto('/');
 if(role==='student')await expect(page.locator('.hub-nav a[href="#team-management"]')).toHaveCount(0);
 else await expect(page.locator('.hub-nav a[href="#team-management"]')).toBeVisible();
 await expect(page.locator('.attendance-section')).toHaveCount(0);
 await page.locator('.hub-nav a[href="#attendance"]').click();await expect(page.locator('.att-workspace')).toBeVisible();
});

for(const width of [390,1440])test(`leadership directory grouping and vacancies ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);const names=['Lead Coach 1','Lead Coach 2','Finance Lead','Program Manager','Product/Technical Manager','Software Lead','Business Lead','CAD Lead','Fabrication Lead','Strategy Lead','Power Lead','Communications Lead','Operations Lead'];
 await page.route('**/rpc/team_management_context_v2',r=>r.fulfill({json:{members:[],areas:[],positions:names.map(name=>({key:name==='Product/Technical Manager'?'product_technical_manager':name.toLowerCase().replaceAll(' ','_'),name,active:true})),assignments:[],history:[]}}));
 await page.goto('/#team-management');await page.getByRole('button',{name:'Positions',exact:true}).click();for(const name of ['Coaching','Program','Functional Leads'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.getByText('Unassigned',{exact:true})).toHaveCount(13);await expect(page.getByRole('button',{name:'Find a member',exact:true})).toHaveCount(13);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/leadership-directory-${width}.png`,fullPage:true});
});

for(const width of [390,1440])test(`V2 roster, invitation and organization editors ${width}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:900});const calls=await setup(page);let sent:any;
 await page.route('**/functions/v1/team-invitations',async r=>{sent=r.request().postDataJSON();await r.fulfill({json:{id:sent.id,status:'pending'}});});
 await page.goto('/#team-management');await expect(page.getByText('mentor@example.test',{exact:true})).toBeVisible();await page.getByLabel('Find a member',{exact:true}).fill('mentor@example.test');await expect(page.getByRole('button',{name:'Manage'})).toBeVisible();await expect(page.getByText('No members match',{exact:false})).toHaveCount(0);await page.getByLabel('Find a member',{exact:true}).fill('no-such-member');await expect(page.getByRole('button',{name:'Manage'})).toHaveCount(0);await expect(page.getByText('No members match',{exact:false})).toBeVisible();await page.getByLabel('Find a member',{exact:true}).fill('');await page.getByLabel('Account role filter').selectOption('student');await expect(page.getByRole('button',{name:'Manage'})).toHaveCount(0);await page.getByLabel('Account role filter').selectOption('');
 await page.getByRole('button',{name:'+ Invite member',exact:true}).click();let d=page.getByRole('dialog',{name:'Invite member',exact:true});await d.getByLabel('Email',{exact:true}).fill('new@example.test');await d.getByLabel('Display name',{exact:true}).fill('New Member');await d.getByLabel('Invitation reason').fill('Joining team');await page.screenshot({path:`test-results/v2-invite-${width}.png`});await d.getByRole('button',{name:'Send invitation'}).click();await expect(d).toHaveCount(0);expect(sent.role).toBe('student');expect(sent.id).toMatch(/[0-9a-f-]{36}/);
 await page.getByRole('button',{name:'Positions',exact:true}).click();await page.getByRole('button',{name:'+ New position'}).click();d=page.getByRole('dialog',{name:'New position',exact:true});await d.getByLabel('Position name',{exact:true}).fill('Safety Lead');await d.getByLabel('Position key').fill('safety_lead');await d.getByLabel('Reason for position change').fill('New responsibility');await d.getByRole('button',{name:'Save position'}).click();await expect(page.getByRole('heading',{name:'Safety Lead',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit Safety Lead',exact:true}).click();d=page.getByRole('dialog',{name:'Edit position',exact:true});await d.getByLabel('Position state').selectOption('false');await d.getByLabel('Reason for position change').fill('Term ended');await d.getByRole('button',{name:'Save position'}).click();await expect(page.getByText('Inactive position')).toBeVisible();
 await page.getByRole('button',{name:'Edit Finance Lead',exact:true}).click();d=page.getByRole('dialog',{name:'Edit position',exact:true});await expect(d.getByText('System linked:',{exact:false})).toBeVisible();await expect(d.getByLabel('Position key')).toHaveCount(0);await d.getByRole('button',{name:'Close editor'}).click();
 await page.getByRole('button',{name:'Areas',exact:true}).click();await page.getByRole('button',{name:'Edit Finance',exact:true}).click();d=page.getByRole('dialog',{name:'Edit area',exact:true});await d.getByLabel('Area name',{exact:true}).fill('Business');await d.getByLabel('Area state').selectOption('false');await d.getByLabel('Reason for area change').fill('Reorganization');await page.screenshot({path:`test-results/v2-area-${width}.png`});expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await d.getByRole('button',{name:'Save area'}).click();await expect(page.getByText('Business',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Members',exact:true}).click();await page.getByRole('button',{name:'Manage'}).click();await page.getByRole('button',{name:'Deactivate member',exact:true}).click();d=page.getByRole('dialog',{name:'Deactivate member',exact:true});await d.getByLabel('Reason for access change').fill('Departed');await d.getByRole('button',{name:'Confirm deactivation'}).click();await expect(d).toHaveCount(0);expect(calls.some(c=>c.action==='member_state'&&c.p.active===false)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('mentor can promote another member without legacy Admin option',async({page})=>{
 const calls=await setup(page,'mentor',false);await page.goto('/#team-management');await page.getByRole('button',{name:'Manage'}).click();
 const editor=page.getByRole('region',{name:'Member editor'}),role=editor.getByRole('combobox',{name:'Account role',exact:true});
 await expect(role).toBeEnabled();await expect(role.locator('option[value="admin"]')).toHaveCount(0);
 await role.selectOption('mentor');await editor.getByLabel('Reason for change').fill('Approved mentor promotion');await editor.getByRole('button',{name:'Save member'}).click();
 await expect.poll(()=>calls.length).toBe(1);expect(calls[0].p.role).toBe('mentor');expect(calls[0].p.user_id).toBe('00000000-0000-0000-0000-000000000002');
});

test('invitation review outcome stays visible and prevents another send',async({page})=>{
 await setup(page);const ids:string[]=[];
 await page.route('**/functions/v1/team-invitations',async r=>{ids.push(r.request().postDataJSON().id);await r.fulfill({status:409,json:{status:'review',error:'Invitation needs review. Ask a mentor to check Activity; do not resend.'}});});
 await page.goto('/#team-management');await page.getByRole('button',{name:'+ Invite member',exact:true}).click();
 const d=page.getByRole('dialog',{name:'Invite member',exact:true});
 await d.getByLabel('Email',{exact:true}).fill('new@example.test');await d.getByLabel('Display name',{exact:true}).fill('New Member');await d.getByLabel('Invitation reason').fill('Joining team');
 await d.getByRole('button',{name:'Send invitation'}).click();await expect(d.getByRole('alert')).toContainText('needs review');
 await expect(d.getByRole('button',{name:'Send invitation'})).toBeDisabled();await expect(d.getByRole('region',{name:'Invitation needs review'})).toBeVisible();expect(ids).toHaveLength(1);await d.getByRole('button',{name:'Refresh team list'}).click();await expect(d.getByRole('button',{name:'Send invitation'})).toBeDisabled();expect(ids).toHaveLength(1);await d.getByRole('button',{name:'View Activity'}).click();await expect(d).toHaveCount(0);await expect(page.getByRole('heading',{name:'Recent team changes'})).toBeVisible();
});

for(const width of [390,1440])test(`compact invitations and member filters ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const calls=await setup(page);let invitations=0;await page.route('**/functions/v1/team-invitations',r=>{invitations++;return r.fulfill({json:{}});});await page.goto('/#team-management');await expect(page.getByRole('heading',{name:'Invitations 3'})).toBeVisible();await expect(page.getByText('Account active',{exact:true})).toBeVisible();await expect(page.getByText('Awaiting account setup',{exact:true})).toBeVisible();await expect(page.getByText('An account exists, but this invitation could not be matched safely.')).toBeVisible();
 await page.getByLabel('Find a member').fill('mentor@example.test');await expect(page.locator('.team-member-grid .team-member')).toHaveCount(1);await page.getByRole('combobox',{name:'Account role filter'}).selectOption('student');await expect(page.locator('.team-member-grid .team-member')).toHaveCount(0);await page.getByRole('combobox',{name:'Account role filter'}).selectOption('mentor');await page.getByRole('combobox',{name:'Account state filter'}).selectOption('false');await expect(page.locator('.team-member-grid .team-member')).toHaveCount(0);await page.getByRole('combobox',{name:'Account state filter'}).selectOption('true');await expect(page.getByRole('button',{name:'Manage',exact:true})).toBeVisible();expect(invitations).toBe(0);expect(calls).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/team-polish-${width}.png`,fullPage:true});
});

for(const width of [390,1440])test(`empty member filters explain the result and reset without writes ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const calls=await setup(page);await page.goto('/#team-management');
 await expect(page.getByRole('button',{name:'Manage',exact:true})).toBeVisible();
 await page.getByLabel('Account role filter').selectOption('student');
 await expect(page.getByRole('button',{name:'Manage',exact:true})).toHaveCount(0);
 await expect(page.getByText('No members match these filters.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(page.getByLabel('Account role filter')).toHaveValue('');
 await expect(page.getByRole('button',{name:'Manage',exact:true})).toBeVisible();
 await page.getByLabel('Find a member').fill('unmatched');await page.getByLabel('Account state filter').selectOption('false');await page.getByLabel('Area filter').selectOption('area');
 await expect(page.getByText('No members match “unmatched” with these filters.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 for(const label of ['Find a member','Account role filter','Account state filter','Area filter'])await expect(page.getByLabel(label)).toHaveValue('');
 await expect(page.getByRole('button',{name:'Manage',exact:true})).toBeVisible();expect(calls).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [390,1440])test(`invitation essentials optional details duplicate guidance and recipient review ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);const sent:any[]=[];
 await page.route('**/functions/v1/team-invitations',r=>{sent.push(r.request().postDataJSON());return r.fulfill({status:202,json:{status:'pending'}});});
 await page.goto('/#team-management');await page.getByRole('button',{name:'+ Invite member',exact:true}).click();const d=page.getByRole('dialog',{name:'Invite member',exact:true});
 await expect(d.getByLabel('Account role',{exact:true})).toHaveValue('student');await expect(d.getByLabel('Functional area',{exact:true})).toBeHidden();
 await d.getByLabel('Display name',{exact:true}).fill('Fixture Teammate');await d.getByLabel('Invitation reason').fill('Joining team');
 await d.getByLabel('Email',{exact:true}).fill('mentor@example.test');await expect(d.getByRole('status')).toContainText('already has a team account');await expect(d.getByRole('button',{name:'Send invitation'})).toBeDisabled();
 await d.getByLabel('Email',{exact:true}).fill('invited@example.test');await expect(d.getByRole('status')).toContainText('already listed');await expect(d.getByRole('button',{name:'Send invitation'})).toBeDisabled();
 await d.getByLabel('Email',{exact:true}).fill('teammate@example.test');await expect(d.locator('.team-invite-review')).toContainText('teammate@example.test');await expect(d.locator('.team-invite-review')).toContainText('student');
 await d.getByText('Optional team details',{exact:true}).click();await d.getByLabel('Functional area',{exact:true}).selectOption('area');await d.getByLabel('Registration',{exact:true}).selectOption('prospective');
 expect(sent).toHaveLength(0);expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await d.getByRole('button',{name:'Send invitation'}).click();await expect(d).toHaveCount(0);expect(sent).toHaveLength(1);expect(sent[0]).toMatchObject({email:'teammate@example.test',role:'student',area_id:'area',member_status:'prospective',reason:'Joining team'});
});

test('invitation validation retry preserves UUID while uncertain outcomes do not resend',async({page})=>{
 await setup(page);const calls:any[]=[];
 await page.route('**/functions/v1/team-invitations',async r=>{calls.push(r.request().postDataJSON());return calls.length===1?r.fulfill({status:400,json:{error:'Check the invitation details.'}}):r.fulfill({status:202,json:{status:'pending'}});});
 await page.goto('/#team-management');await page.getByRole('button',{name:'+ Invite member',exact:true}).click();const d=page.getByRole('dialog',{name:'Invite member',exact:true});
 await d.getByLabel('Email',{exact:true}).fill('teammate@example.test');await d.getByLabel('Display name',{exact:true}).fill('Fixture Teammate');await d.getByLabel('Invitation reason').fill('Joining team');
 await d.getByRole('button',{name:'Send invitation'}).click();await expect(d.getByRole('alert')).toContainText('Check the invitation details.');await expect(d.getByLabel('Email',{exact:true})).toHaveValue('teammate@example.test');
 await d.getByRole('button',{name:'Send invitation'}).click();await expect(d).toHaveCount(0);expect(calls).toHaveLength(2);expect(calls[1].id).toBe(calls[0].id);
});

for(const reserved of [false,true])test(`closing an uncertain invitation cannot reset its resend protection (reserved=${reserved})`,async({page})=>{
 await setup(page);let sent=0;
 await page.route('**/functions/v1/team-invitations',r=>{sent++;return reserved?r.fulfill({status:409,json:{code:'already_reserved',error:'An invitation already exists for this email. Check Activity; do not resend.'}}):r.fulfill({status:502,json:{status:'review',error:'The invitation service could not confirm sending. Check Activity; do not resend.'}});});
 await page.goto('/#team-management');await page.getByRole('button',{name:'+ Invite member',exact:true}).click();let d=page.getByRole('dialog',{name:'Invite member',exact:true});
 await d.getByLabel('Email',{exact:true}).fill('uncertain@example.test');await d.getByLabel('Display name',{exact:true}).fill('Fixture Teammate');await d.getByLabel('Invitation reason').fill('Joining team');await d.getByRole('button',{name:'Send invitation'}).click();
 await expect(d.getByRole('region',{name:'Invitation needs review'})).toBeVisible();await d.getByRole('button',{name:'Close editor'}).click();
 await page.getByRole('button',{name:'+ Invite member',exact:true}).click();d=page.getByRole('dialog',{name:'Invite member',exact:true});await d.getByLabel('Email',{exact:true}).fill('UNCERTAIN@example.test');
 await expect(d.getByRole('status')).toContainText('still needs review');await expect(d.getByRole('button',{name:'Send invitation'})).toBeDisabled();expect(sent).toBe(1);
 await d.getByLabel('Email',{exact:true}).fill('another@example.test');await expect(d.getByRole('button',{name:'Send invitation'})).toBeEnabled();expect(sent).toBe(1);
});
