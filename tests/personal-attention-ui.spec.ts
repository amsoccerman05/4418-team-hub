import {test,expect,type Page} from '@playwright/test';
import {session} from './hub-session';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function setup(page:Page){
 await session(page);
 const c:any={user_id:id(1),can_manage:false,season_id:id(20),seasons:[{id:id(20),name:'Current season',status:'active'}],members:[{id:id(1),name:'Member'}],areas:[],groups:[],items:[],boards:[{id:id(10),name:'Robot',kind:'project',active:true,season_id:id(20)}],tasks:[{id:id(30),board_id:id(10),title:'Check intake alignment',description:'Synthetic local fixture',status:'blocked',blocked_reason:'Waiting for fixture part',priority:'high',owner_ids:[id(1)],owners:[{id:id(1),name:'Member'}],version:1,due_date:'2020-01-01'}]};
 const repairs:any[]=[{id:id(40),issue_number:40,title:'Replace loose connector',status:'REPAIRING',severity:'HIGH',assigned_to:id(1)}];
 const dashboard={name:'Member',role:'student',admin:false,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]};
 const mutations:string[]=[];page.on('request',r=>{if(/\/rpc\/(planning_save|notification_read|pit_update_issue)$/.test(new URL(r.url()).pathname))mutations.push(r.url());});
 await page.route('**/rpc/team_dashboard_context',r=>r.fulfill({json:dashboard}));
 await page.route('**/rpc/notification_center',r=>r.fulfill({json:{unread:0,attention:[],items:[],has_more:false}}));
 await page.route('**/rpc/planning_my_work_context',r=>r.fulfill({json:c}));
 await page.route('**/rpc/planning_task_detail',r=>r.fulfill({json:{steps:[],comments:[],history:[]}}));
 await page.route('**/rest/v1/pit_issues?*',r=>{expect(new URL(r.request().url()).searchParams.get('assigned_to')).toBe(`eq.${id(1)}`);return r.fulfill({json:repairs,headers:{'content-range':repairs.length?`0-${repairs.length-1}/${repairs.length}`:'*/0','access-control-expose-headers':'content-range'}});});
 return {c,repairs,mutations};
}
for(const width of [390,1440])test(`personal follow-through and exact task navigation at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {c,repairs,mutations}=await setup(page);await page.goto('/');
 // This cross-origin fixture must expose the same count header the SDK reads.
 expect(await page.evaluate(async uid=>(await fetch(`https://attendance-test.supabase.invalid/rest/v1/pit_issues?assigned_to=eq.${uid}`)).headers.get('content-range'),id(1))).toBe('0-0/1');
 const attention=page.getByRole('region',{name:'Needs your attention'});await expect(attention.getByText('Check intake alignment',{exact:true})).toBeVisible();await expect(attention.getByText('Repair #40 · Replace loose connector',{exact:true})).toBeVisible();
 await expect(attention.getByRole('link',{name:/Repair #40/})).toHaveAttribute('href',`https://pit.frc4418.org/#issue/${id(40)}`);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/personal-attention-${width}.png`,fullPage:true});
 await attention.getByRole('link',{name:/Check intake alignment/}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Check intake alignment');await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(/#planning\/my-work$/);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(dialog).toHaveCount(0);await page.goBack();await expect(page.getByRole('heading',{name:'My 4418',exact:true})).toBeVisible();await page.goForward();await expect(page.getByRole('heading',{name:'My Work',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
 c.tasks[0].status='done';repairs.length=0;await page.goto('/');await expect(page.getByRole('region',{name:'Needs your attention'})).toHaveCount(0);expect(mutations).toEqual([]);
});
// GET 503 retries are bounded by the dashboard's existing 15-second source budget.
test('partial failures preserve the other source and retry replaces stale assignments',async({page})=>{
 const {c}=await setup(page);await page.route('**/rest/v1/pit_issues?*',r=>r.fulfill({status:503,json:{message:'Synthetic unavailable'}}));await page.goto('/');await expect(page.getByText('Check intake alignment',{exact:true})).toBeVisible();await expect(page.getByText('Your pit repairs couldn’t be checked.',{exact:false})).toBeVisible({timeout:16000});
 c.tasks=[];await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByText('Check intake alignment',{exact:true})).toHaveCount(0);
 await page.goto(`/#planning/my-work/${id(30)}`);await expect(page.getByText('This assigned task is no longer available.',{exact:false})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('late assignment responses cannot repopulate signed-out screens',async({page})=>{
 await setup(page);let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);
 await page.route('**/rest/v1/pit_issues?*',async r=>{await wait;await r.fulfill({json:[{id:id(40),issue_number:40,title:'Late private repair',status:'OPEN',severity:'LOW',assigned_to:id(1)}],headers:{'content-range':'0-0/1'}}).catch(()=>{});});
 await page.goto('/');await expect(page.getByText('Checking your pit repairs…')).toBeVisible();await page.evaluate(()=>{localStorage.removeItem('4418-team-hub-auth');const channel=new BroadcastChannel('4418-team-hub-auth');channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();});await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();release();await expect(page.getByText('Late private repair',{exact:false})).toHaveCount(0);await expect(page.locator('.my-attention')).toHaveCount(0);
});
test('assignment deep link survives sign-in without exposing its contents before authentication',async({page})=>{
 await setup(page);await page.addInitScript(()=>localStorage.removeItem('4418-team-hub-auth'));
 const user={id:id(1),aud:'authenticated',email:'test@example.invalid',app_metadata:{},user_metadata:{}};
 const token=[{alg:'HS256'},{sub:user.id,exp:4000000000,aud:'authenticated'}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.fixture';
 await page.route('**/auth/v1/token**',r=>r.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user}}));
 await page.goto(`/#planning/my-work/${id(30)}`);await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await expect(page.getByText('Check intake alignment')).toHaveCount(0);
 await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Check intake alignment');await expect(page).toHaveURL(new RegExp(`#planning/my-work/${id(30)}$`));
});

test('delayed save cannot replace a newer route or close its editor',async({page})=>{
 const {c}=await setup(page);c.tasks.push({...c.tasks[0],id:id(31),title:'Newer task'});
 let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);let saveStarted=false;
 await page.route('**/rpc/planning_save',async r=>{saveStarted=true;await wait;await r.fulfill({json:id(30)}).catch(()=>{});});
 await page.goto('/#planning/my-work');await page.evaluate(route=>location.hash=route,`planning/my-work/${id(30)}`);
 await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Check intake alignment');await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>saveStarted).toBe(true);
 await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await page.evaluate(route=>location.hash=route,`planning/my-work/${id(31)}`);await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Newer task');
 const saved=page.waitForResponse(r=>r.url().endsWith('/rpc/planning_save'));release();await saved;
 await expect(page).toHaveURL(new RegExp(`#planning/my-work/${id(31)}$`));await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Newer task');
});

 test('save from an unmounted Planning instance cannot close a remounted copy of the same task',async({page})=>{
 await setup(page);let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);let saveStarted=false;
 await page.route('**/rpc/planning_save',async r=>{saveStarted=true;await wait;await r.fulfill({json:id(30)}).catch(()=>{});});
 await page.goto(`/#planning/my-work/${id(30)}`);await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>saveStarted).toBe(true);
 await page.evaluate(()=>location.hash='');await expect(page.getByRole('heading',{name:'My 4418',exact:true})).toBeVisible();await page.evaluate(route=>location.hash=route,`planning/my-work/${id(30)}`);await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Check intake alignment');
 const saved=page.waitForResponse(r=>r.url().endsWith('/rpc/planning_save'));release();await saved;await expect(page).toHaveURL(new RegExp(`#planning/my-work/${id(30)}$`));await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Check intake alignment');
});
