import {test,expect,type Page} from '@playwright/test';
const uid='00000000-0000-0000-0000-000000000001';
const mid='00000000-0000-0000-0000-000000000010';
const other='00000000-0000-0000-0000-000000000011';
const now='2026-10-27T17:10:00Z';
const target=`#attendance/meeting/${mid}`;
async function setup(page:Page,options:{signed?:boolean;role?:string;active?:boolean}={}) {
 await page.clock.setFixedTime(new Date(now));
 const user={id:uid,aud:'authenticated',email:'student@example.invalid',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const token=[{alg:'HS256'},{sub:uid,exp:4000000000,aud:'authenticated'}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.fixture';
 const session={access_token:token,refresh_token:'fixture-refresh',expires_at:4000000000,expires_in:3600,token_type:'bearer',user};
 if(options.signed!==false)await page.addInitScript(session=>localStorage.setItem('4418-team-hub-auth',JSON.stringify(session)),session);
 const m={id:mid,title:'Correct build meeting',meeting_type:'preseason',starts_at:'2026-10-27T17:00:00Z',ends_at:'2026-10-27T19:00:00Z',late_minutes:10,requirement:'active',status:'open',check_in_open:true,code_expires_at:'2026-10-27T17:30:00Z',version:1};
 const a={id:'attendance',meeting_id:mid,student_id:uid,physical_status:'pending',review_status:'none',checked_in_at:null as string|null,left_at:null as string|null,notice_at:null,notice_reason:'',review_reason:'',reviewed_at:null,reviewed_by:null,version:1};
 const state={m,a,meetings:[m,{...m,id:other,title:'Different meeting'}],rostered:true,writes:[] as {name:string;args:any}[],ownReads:[] as string[],delay:0};
 await page.route('**/auth/v1/token**',r=>r.fulfill({json:session}));
 await page.route('**/auth/v1/logout**',r=>r.fulfill({status:204}));
 await page.route('**/rest/v1/**',async r=>{
  const url=new URL(r.request().url()),name=url.pathname.split('/').at(-1)!;
  if(name==='profiles')return r.fulfill({json:{id:uid,display_name:'Test Student',active:options.active!==false,role:options.role||'student'}});
  if(name==='team_dashboard_context')return r.fulfill({json:{name:'Test Student',role:options.role||'student',admin:false,personal:{percent:100,strikes:0,pending:0},next_meeting:{id:mid,title:m.title,type:m.meeting_type,starts_at:m.starts_at,ends_at:m.ends_at,required:true,check_in_open:m.check_in_open,code_expires_at:m.code_expires_at,physical_status:a.physical_status},orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]}});
  if(name==='team_attendance_policy_context')return r.fulfill({json:{user_id:uid,can_participate:options.role!=='mentor',can_read_team:false,can_manage_meetings:false,can_review:false,people:[],warnings:[]}});
  if(name==='team_meetings')return r.fulfill({json:state.meetings});
  if(name==='team_attendance'){
   if(url.searchParams.has('student_id'))state.ownReads.push(url.search);
   return r.fulfill({json:state.rostered?[a]:[]});
  }
  if(name==='team_meeting_members')return r.fulfill({json:state.rostered?[{meeting_id:mid,student_id:uid,required:true,member_status:'registered',team_area:'Build'}]:[]});
  if(name==='planning_my_work_context')return r.fulfill({json:{user_id:uid,season_id:null,seasons:[],boards:[],tasks:[]}});
  if(name==='team_attendance_check_in'||name==='team_attendance_check_out'){
   const args=r.request().postDataJSON();state.writes.push({name,args});
   if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
   if(name==='team_attendance_check_in'){
    if(args.code!=='123456')return r.fulfill({status:400,json:{message:'Invalid meeting code'}});
    Object.assign(a,{physical_status:'present',checked_in_at:now});return r.fulfill({json:{status:'checked_in',message:'Checked in'}});
   }
   Object.assign(a,{physical_status:'left_early',left_at:now});return r.fulfill({json:{}});
  }
  return r.fulfill({json:[],headers:{'content-range':'*/0','access-control-expose-headers':'content-range'}});
 });
 return state;
}
async function home(page:Page){const menu=page.getByRole('button',{name:'Hub menu'});if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')==='false')await menu.click();await page.locator('.hub-nav').getByRole('link',{name:'My 4418',exact:true}).click();}
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Meeting details'});
for(const width of [390,1440])test(`home opens correct guarded check-in and reflects checkout ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const s=await setup(page);await page.goto('/');
 const link=page.locator('.my-next').getByRole('link',{name:'Check in',exact:true});await expect(link).toHaveAttribute('href',target);
 expect(s.ownReads[0]).toContain(`student_id=eq.${uid}`);await link.click();const d=dialog(page);
 await expect(d.getByRole('heading',{name:s.m.title,exact:true})).toBeVisible();await expect(d.getByText('Different meeting')).toHaveCount(0);
 await expect(d.getByLabel('6-digit meeting code')).toBeVisible();expect(s.writes).toEqual([]);
 await d.getByRole('button',{name:'Check in',exact:true}).click();expect(s.writes).toEqual([]);
 await d.getByLabel('6-digit meeting code').fill('000000');await d.getByRole('button',{name:'Check in',exact:true}).click();await expect(d.getByRole('alert')).toContainText('Invalid meeting code');
 s.delay=200;await d.getByLabel('6-digit meeting code').fill('123456');await d.locator('form.att-inline').evaluate((f:HTMLFormElement)=>{f.requestSubmit();f.requestSubmit();});
 await expect(d.getByRole('heading',{name:"You're checked in",exact:true})).toBeVisible();expect(s.writes).toHaveLength(2);expect(s.writes[1]).toEqual({name:'team_attendance_check_in',args:{meeting_id:mid,code:'123456'}});
 await page.screenshot({path:`test-results/home-meeting-checked-in-${width}.png`,fullPage:true});expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await d.getByRole('button',{name:'Close',exact:true}).click();await home(page);
 await expect(page.locator('.my-next')).toContainText('You’re checked in');await page.locator('.my-next').getByRole('link',{name:'Check out',exact:true}).click();
 page.once('dialog',d=>d.dismiss());await dialog(page).getByRole('button',{name:'Check out',exact:true}).click();expect(s.writes).toHaveLength(2);
 page.once('dialog',d=>d.accept());await dialog(page).getByRole('button',{name:'Check out',exact:true}).click();await expect(dialog(page).getByRole('heading',{name:'Checked out',exact:true})).toBeVisible();expect(s.writes).toHaveLength(3);
 await dialog(page).getByRole('button',{name:'Close',exact:true}).click();await home(page);await expect(page.locator('.my-next')).toContainText('Checked out');await expect(page.locator('.my-next').getByRole('link',{name:'View meeting',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const stale of ['missing','canceled','roster','closed','expired','finalized'])test(`stale home link rechecks ${stale} without another meeting or a write`,async({page})=>{
 const s=await setup(page);await page.goto('/');await expect(page.locator('.my-next').getByRole('link',{name:'Check in',exact:true})).toBeVisible();
 if(stale==='missing')s.meetings=s.meetings.filter(m=>m.id!==mid);
 if(stale==='canceled')s.m.status='canceled';if(stale==='roster')s.rostered=false;
 if(stale==='closed'){s.m.status='closed';s.m.check_in_open=false;}if(stale==='expired')s.m.code_expires_at='2026-10-27T17:00:00Z';if(stale==='finalized')s.m.status='finalized';
 await page.locator('.my-next').getByRole('link',{name:'Check in',exact:true}).click();
 if(['missing','canceled','roster'].includes(stale)){await expect(page.getByRole('alert')).toContainText('meeting is unavailable');await expect(dialog(page)).toHaveCount(0);}
 else {await expect(dialog(page)).toBeVisible();await expect(dialog(page).getByLabel('6-digit meeting code')).toHaveCount(0);}
 expect(s.writes).toEqual([]);
});
test('meeting link survives sign-in but does not submit attendance',async({page})=>{
 const s=await setup(page,{signed:false});await page.goto('/'+target);await expect(page.getByRole('heading',{name:'Team sign in'})).toBeVisible();
 await page.getByLabel('Email',{exact:true}).fill('student@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(dialog(page).getByLabel('6-digit meeting code')).toBeVisible();expect(new URL(page.url()).hash).toBe(target);expect(s.writes).toEqual([]);
});
for(const option of [{role:'readonly'},{active:false},{role:'mentor'}])test(`meeting link does not widen account access ${JSON.stringify(option)}`,async({page})=>{
 const s=await setup(page,option);await page.goto('/'+target);await expect(page.getByRole('alert')).toBeVisible();await expect(dialog(page)).toHaveCount(0);await expect(page.getByLabel('6-digit meeting code')).toHaveCount(0);expect(s.writes).toEqual([]);
});
test('Close and Escape remove linked route; refresh and forward cannot resurrect it',async({page})=>{
 const s=await setup(page);await page.goto('/');await page.locator('.my-next').getByRole('link',{name:'Check in',exact:true}).click();await expect(dialog(page)).toBeVisible();await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);expect(new URL(page.url()).hash).toBe('#attendance/calendar');
 await page.reload();await expect(page.getByRole('heading',{name:'Meeting calendar'})).toBeVisible();await expect(dialog(page)).toHaveCount(0);
 await page.goBack();await expect(page.locator('.my-next')).toBeVisible();await page.goForward();await expect(page.getByRole('heading',{name:'Meeting calendar'})).toBeVisible();await expect(dialog(page)).toHaveCount(0);expect(s.writes).toEqual([]);
});
test('newer navigation wins over linked meeting and pending write completion',async({page})=>{
 const s=await setup(page);s.delay=300;await page.goto('/'+target);await dialog(page).getByLabel('6-digit meeting code').fill('123456');await dialog(page).getByRole('button',{name:'Check in',exact:true}).click();
 await page.evaluate(()=>{location.hash='#attendance/how-to';});await expect(dialog(page)).toHaveCount(0);await expect(page.getByRole('heading',{name:'How to use Attendance',exact:true})).toBeVisible();await expect.poll(()=>s.a.checked_in_at).toBe(now);await expect(page.locator('.att-success')).toHaveCount(0);expect(new URL(page.url()).hash).toBe('#attendance/how-to');expect(s.writes).toHaveLength(1);
 await page.goBack();await expect(dialog(page).getByRole('heading',{name:"You're checked in",exact:true})).toBeVisible();expect(s.writes).toHaveLength(1);
});
test('ended linked meeting preserves existing checkout grace without reopening check-in',async({page})=>{
 const s=await setup(page);s.m.ends_at='2026-10-27T17:00:00Z';s.m.starts_at='2026-10-27T15:00:00Z';s.m.status='finalized';s.a.checked_in_at='2026-10-27T15:00:00Z';s.a.physical_status='present';await page.goto('/'+target);await expect(dialog(page).getByRole('button',{name:'Check out',exact:true})).toBeVisible();await expect(dialog(page).getByLabel('6-digit meeting code')).toHaveCount(0);expect(s.writes).toEqual([]);
});

test('interrupted session retains only meeting intent, never a typed code or automatic attendance',async({page})=>{
 const s=await setup(page);await page.goto('/'+target);await dialog(page).getByLabel('6-digit meeting code').fill('123456');
 await page.evaluate(()=>{localStorage.removeItem('4418-team-hub-auth');const channel=new BroadcastChannel('4418-team-hub-auth');channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();});
 await expect(page.getByRole('heading',{name:'Team sign in'})).toBeVisible();expect(new URL(page.url()).hash).toBe(target);
 await page.getByLabel('Email',{exact:true}).fill('student@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(dialog(page).getByLabel('6-digit meeting code')).toHaveValue('');expect(s.writes).toEqual([]);
});

test('Home keeps checked-in meeting through checkout grace rather than moving to the next meeting',async({page})=>{
 const s=await setup(page);s.m.ends_at='2026-10-27T17:00:00Z';s.m.starts_at='2026-10-27T15:00:00Z';s.m.status='finalized';s.a.checked_in_at='2026-10-27T15:00:00Z';s.a.physical_status='present';
 await page.route('**/rpc/team_dashboard_context',r=>r.fulfill({json:{name:'Test Student',role:'student',admin:false,personal:{percent:100,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]}}));
 await page.goto('/');await expect(page.locator('.my-next')).toContainText('You’re checked in');await expect(page.locator('.my-next').getByRole('link',{name:'Check out',exact:true})).toHaveAttribute('href',target);
 await page.locator('.my-next').getByRole('link',{name:'Check out',exact:true}).click();await expect(dialog(page).getByRole('button',{name:'Check out',exact:true})).toBeVisible();expect(s.writes).toEqual([]);
});

test('explicit sign-out clears a linked target while its data is still loading',async({page})=>{
 const s=await setup(page);await page.route('**/rest/v1/team_meetings*',()=>new Promise(()=>{}));await page.goto('/'+target);
 await expect(page.getByText('Loading attendance…')).toBeVisible();await page.locator('.suite-header').getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Team sign in'})).toBeVisible();expect(new URL(page.url()).hash).toBe('');expect(s.writes).toEqual([]);
});
