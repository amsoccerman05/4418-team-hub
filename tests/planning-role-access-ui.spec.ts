import {test,expect,type Page} from '@playwright/test';
const user='00000000-0000-0000-0000-000000000001',board='10000000-0000-4000-8000-000000000010';
async function fixture(page:Page){
 if(process.env.HANDOFF_LIVE)throw Error('Synthetic role fixture cannot run with HANDOFF_LIVE');
 const state={role:'admin_lead',write:true as boolean|undefined,failRead:false,denySave:false,writes:[] as any[],unknown:[] as string[]};
 const context={user_id:user,can_manage:false,season_id:'season',seasons:[{id:'season',name:'Synthetic season',status:'active',version:1}],members:[{id:user,name:'Admin Lead fixture'}],areas:[],groups:[],items:[],boards:[{id:board,season_id:'season',name:'Synthetic project',kind:'project',active:true,version:1}],tasks:[{id:'task',board_id:board,title:'Owned synthetic task',description:'Original notes',status:'todo',priority:'normal',owner_ids:[user],owners:[{id:user,name:'Admin Lead fixture'}],version:1}]};
 await page.addInitScript(({user})=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,token_type:'bearer',user:{id:user,aud:'authenticated',app_metadata:{},user_metadata:{}}})),{user});
 await page.routeWebSocket('**/*',ws=>ws.close());
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='http://127.0.0.1:4422')return route.continue();
  if(url.hostname==='attendance-test.supabase.invalid'){
   const name=url.pathname.split('/').at(-1);
   if(name==='profiles')return route.fulfill({json:{id:user,display_name:'Admin Lead fixture',role:state.role,active:true}});
   if(name==='user')return route.fulfill({json:{id:user,aud:'authenticated',app_metadata:{},user_metadata:{}}});
   if(name==='team_my_positions')return route.fulfill({json:[]});
   if(name==='notification_center')return route.fulfill({json:{items:[],unread:0,has_more:false}});
   if(name==='planning_context'||name==='planning_my_work_context')return route.fulfill(state.failRead?{status:503,json:{message:'Synthetic access refresh unavailable'}}:{json:{...context,can_write:state.write}});
   if(name==='planning_task_detail')return route.fulfill({json:{steps:[],comments:[],history:[]}});
   if(name==='planning_save'){
    state.writes.push(route.request().postDataJSON());
    if(state.denySave){state.role='readonly';state.write=false;return route.fulfill({status:403,json:{code:'42501',message:'Active Planning writer required'}});}
    return route.fulfill({json:'task'});
   }
   state.unknown.push(url.pathname);return route.fulfill({status:500,json:{message:'Unknown synthetic endpoint'}});
  }
  // No third-party network in these tests (fonts are optional).
  return route.abort();
 });
 return state;
}
for(const width of [390,1440]){
 test(`Planning Readonly retained owner controls fail closed ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await fixture(page);state.role='readonly';state.write=false;
  await page.goto('/#planning/boards/'+board);await expect(page.getByLabel('Status for Owned synthetic task')).toBeDisabled();await expect(page.getByRole('button',{name:/New task|Add task/})).toHaveCount(0);
  await page.getByRole('button',{name:'Owned synthetic task',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('Title',{exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Add a comment')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Add dependency',exact:true})).toHaveCount(0);
  await page.screenshot({path:`test-results/planning-role-readonly-${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);expect(state.writes).toEqual([]);expect(state.unknown).toEqual([]);
 });
 test(`Planning draft survives denied save, unavailable access refresh and restoration ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await fixture(page);await page.goto('/#planning/boards/'+board);
  await page.getByRole('button',{name:'Details for Owned synthetic task',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Title',{exact:true}).fill('My unsaved student work');await dialog.getByLabel('Description').fill('Keep these notes');await dialog.getByLabel('Add a comment').fill('Keep my unsent comment');
  state.denySave=true;state.failRead=true;await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog.getByText(/Editing access could not be confirmed/)).toBeVisible();await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('My unsaved student work');await expect(dialog.getByLabel('Title',{exact:true})).toBeDisabled();expect(state.writes).toHaveLength(1);
  await page.screenshot({path:`test-results/planning-role-refresh-failed-${width}.png`,fullPage:true});
  state.failRead=false;await dialog.getByRole('button',{name:'Refresh editing access',exact:true}).click();await expect(dialog.getByText(/Planning is read only/)).toBeVisible();expect(state.writes).toHaveLength(1);
  state.role='admin_lead';state.write=true;state.denySave=false;await dialog.getByRole('button',{name:'Refresh editing access',exact:true}).click();
  await expect(dialog.getByLabel('Title',{exact:true})).toBeEnabled();await expect(dialog.getByLabel('Description')).toHaveValue('Keep these notes');await expect(dialog.getByLabel('Add a comment')).toHaveValue('Keep my unsent comment');expect(state.writes).toHaveLength(1);
  await page.screenshot({path:`test-results/planning-role-restored-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);expect(state.writes).toHaveLength(2);expect(state.writes[1].p.title).toBe('My unsaved student work');expect(state.unknown).toEqual([]);
 });
}
test('Planning missing writer flag fails closed without labeling a confirmed Readonly role',async({page})=>{
 const state=await fixture(page);state.write=undefined;await page.goto('/#planning/boards/'+board);await page.getByRole('button',{name:'Owned synthetic task',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByText('Editing access is not confirmed. Your draft is still here.',{exact:false})).toBeVisible();await expect(dialog.getByLabel('Title',{exact:true})).toBeDisabled();expect(state.writes).toEqual([]);expect(state.unknown).toEqual([]);
});
