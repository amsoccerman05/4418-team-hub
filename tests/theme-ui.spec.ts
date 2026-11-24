import {test, expect, type Page} from '@playwright/test';
const uid='00000000-0000-0000-0000-000000000001';
async function synthetic(page:Page, mentor=false) {
 await page.addInitScript(uid=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,token_type:'bearer',user:{id:uid,aud:'authenticated',app_metadata:{},user_metadata:{}}})),uid);
 const writes:string[]=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin==='http://127.0.0.1:4422')return route.continue();
  if(url.hostname!=='attendance-test.supabase.invalid')return route.abort();
  const name=url.pathname.split('/').at(-1);
  if(name==='profiles')return route.fulfill({json:{id:uid,display_name:'Synthetic Member',role:mentor?'mentor':'student',active:true}});
  if(name==='team_attendance_sync_my_rosters')return route.fulfill({json:{added:0}});
  if(name==='notification_center')return route.fulfill({json:{items:[],attention:[],unread:0,has_more:false}});
  if(name==='team_dashboard_context')return route.fulfill({json:{name:'Synthetic Member',role:mentor?'mentor':'student',admin:mentor,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]}});
  if(name==='planning_context'||name==='planning_my_work_context')return route.fulfill({json:{user_id:uid,can_manage:false,can_write:true,season_id:'season',seasons:[{id:'season',name:'Synthetic season',status:'active'}],members:[],areas:[],groups:[],items:[],boards:[],tasks:[]}});
  if(name==='team_attendance_policy_context')return route.fulfill({json:{user_id:uid,can_review:false,can_read_team:false,can_manage_meetings:false,strike_year_start:null,people:[],warnings:[]}});
  if(route.request().method()!=='GET')writes.push(name||url.pathname);
  return route.fulfill({json:[]});
 });
 return writes;
}
async function themeLabelContrast(page:Page) {
 const ratio=await page.locator('hub-theme-control label').evaluate(label=>{
  const luminance=(value:string)=>{const rgb=value.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
  let node:Element|null=label,bg='rgb(255,255,255)';
  while(node){const candidate=getComputedStyle(node).backgroundColor;if(candidate!=='rgba(0, 0, 0, 0)'&&candidate!=='transparent'){bg=candidate;break;}node=node.parentElement;}
  const fg=luminance(getComputedStyle(label).color),back=luminance(bg);return (Math.max(fg,back)+.05)/(Math.min(fg,back)+.05);
 });expect(ratio).toBeGreaterThanOrEqual(4.5);
}
async function fit(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
for(const width of [390,1440]) {
 test(`theme follows system, keyboard override persists, and System resumes at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  const theme=page.getByRole('combobox',{name:'Theme',exact:true});await expect(theme).toHaveValue('system');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await theme.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(theme).toHaveValue('light');
  await page.reload();await expect(theme).toHaveValue('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await theme.selectOption('system');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await fit(page);
 });
 for(const mode of ['light','dark'] as const) {
  test(`public pages and sign-in are readable in ${mode} at ${width}`,async({page})=>{
   await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:mode});
   for(const path of ['/','/privacy.html','/event.html#unavailable']) {
    await page.goto(path);await expect(page.getByRole('combobox',{name:'Theme',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme',mode);await fit(page);await themeLabelContrast(page);
    if(mode==='dark')expect(await page.getByRole('combobox',{name:'Theme',exact:true}).evaluate(e=>getComputedStyle(e).backgroundRepeat)).toBe('no-repeat');
    await page.screenshot({path:`test-results/theme-public-${path.includes('privacy')?'privacy':path.includes('event')?'event':'signin'}-${mode}-${width}.png`,fullPage:true});
   }
  });
  test(`student moves Home to Planning to Attendance in ${mode} at ${width}`,async({page})=>{
   await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:mode});const writes=await synthetic(page);
   const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.getByRole('heading',{name:'My 4418',exact:true})).toBeVisible();
   await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption(mode);await fit(page);await page.screenshot({path:`test-results/theme-home-${mode}-${width}.png`,fullPage:true});
   await page.getByRole('link',{name:'My assignments',exact:true}).click();await expect(page.getByRole('heading',{name:'My Work',exact:true})).toBeVisible();await expect(page.getByText('You’re caught up. Tasks assigned to you will appear here.')).toBeVisible();await fit(page);await page.screenshot({path:`test-results/theme-planning-${mode}-${width}.png`,fullPage:true});
   await page.goto('/#attendance');await expect(page.locator('.att-account-toolbar')).toContainText('Synthetic Member');await expect(page.locator('html')).toHaveAttribute('data-theme',mode);await fit(page);await page.screenshot({path:`test-results/theme-attendance-${mode}-${width}.png`,fullPage:true});expect(errors).toEqual([]);expect(writes).toEqual([]);
  });
 }
 test(`mentor dialog and menus retain dark surfaces and keyboard access at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:'dark'});await synthetic(page,true);await page.goto('/#announcements');
  const create=page.getByRole('button',{name:'Create announcement',exact:true});await create.click();const dialog=page.getByRole('dialog',{name:'Announcement editor'});await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title',{exact:true}).fill('Synthetic evening reminder');await dialog.getByLabel('Message',{exact:true}).fill('Bring safety glasses.');
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:`test-results/theme-dialog-dark-${width}.png`,fullPage:true});await page.keyboard.press('Escape');await expect(create).toBeFocused();
  if(width<761){await page.getByRole('button',{name:'Hub menu'}).click();await expect(page.getByRole('navigation',{name:'Hub workspace'})).toBeVisible();await page.screenshot({path:`test-results/theme-menu-dark-${width}.png`,fullPage:true});}
 });
}
