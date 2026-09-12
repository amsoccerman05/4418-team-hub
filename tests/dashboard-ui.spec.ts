import {test,expect,type Page} from '@playwright/test';
const base={name:'Aiden',role:'student',admin:false,personal:{percent:100,strikes:0,pending:1},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]};
async function setup(page:Page,mentor=false){
 const uid='00000000-0000-0000-0000-000000000001';const announcements:any[]=[];const c:any={...base,admin:mentor,role:mentor?'mentor':'student'};
 if(mentor)Object.assign(c,{finance:{allowed:true,approvals:2,school:1},attention:{open_meetings:1,requests:2,strike_actions:0},robot:{event:'Regional',open:2,blocking:1,readiness:'NOT READY'},inventory:{out:1,low:3}});
 await page.addInitScript(uid=>localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,token_type:'bearer',user:{id:uid,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),uid);
 await page.route('**/rest/v1/**',async r=>{
 const path=new URL(r.request().url()).pathname;
 if(path.endsWith('/profiles'))return r.fulfill({json:{id:uid,role:c.role,active:true}});
 if(path.endsWith('/team_dashboard_context'))return r.fulfill({json:{...c,announcements:announcements.filter(a=>a.active)}});
 if(path.endsWith('/team_announcements'))return r.fulfill({json:announcements});
 if(path.endsWith('/team_positions'))return r.fulfill({json:[{key:'communications_lead',name:'Communications Lead'}]});
 if(path.endsWith('/areas'))return r.fulfill({json:[{id:uid,name:'Fabrication',active:true}]});
 if(path.endsWith('/team_announcement_save')){const p=r.request().postDataJSON().p;if(p.id)Object.assign(announcements.find(a=>a.id===p.id),p);else announcements.push({...p,id:'new',version:1,created_at:'2026-09-13T12:00:00Z'});return r.fulfill({json:'new'});}
 return r.fulfill({json:[]});
 });return c;
}
for(const width of [390,1440])for(const mentor of [false,true])test(`My 4418 ${mentor?'leadership':'student'} at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page,mentor);await page.goto('/');await expect(page.getByRole('heading',{name:'My 4418',exact:true})).toBeVisible();await expect(page.getByText('No required meetings are currently scheduled.')).toBeVisible();await expect(page.getByText('Nothing new from team leadership.')).toBeVisible();
 await expect(page.locator('.system-card')).toHaveCount(4);await expect(page.getByRole('heading',{name:'Needs Attention',exact:true})).toHaveCount(mentor?1:0);await expect(page.getByRole('link',{name:'Manage announcements →'})).toHaveCount(mentor?1:0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/my-4418-${mentor?'leadership':'student'}-${width}.png`,fullPage:true});
});
for(const width of [390,1440])test(`announcement create edit deactivate and mobile modal ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page,true);await page.goto('/#announcements');await page.getByRole('button',{name:'Create announcement',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Announcement editor'});
 await dialog.getByLabel('Title',{exact:true}).fill('Build reminder');await dialog.getByLabel('Message',{exact:true}).fill('Bring safety glasses.');await dialog.getByLabel('Priority').selectOption('urgent');await dialog.getByRole('combobox',{name:'Audience',exact:true}).selectOption('area');await dialog.getByRole('combobox',{name:'Functional area',exact:true}).selectOption('00000000-0000-0000-0000-000000000001');
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:`test-results/announcement-editor-${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Save announcement'}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Edit Build reminder'}).click();await dialog.getByLabel('Title',{exact:true}).fill('Updated reminder');await dialog.getByRole('button',{name:'Save announcement'}).click();await page.getByRole('button',{name:'Deactivate',exact:true}).click();await expect(page.getByText('No active announcements.')).toBeVisible();await page.getByRole('button',{name:'Show expired / inactive'}).click();await expect(page.getByRole('heading',{name:'Updated reminder'})).toBeVisible();
});
test('student direct announcement management route is denied',async({page})=>{await setup(page);await page.goto('/#announcements');await expect(page.getByRole('alert')).toHaveText('Only active mentors and admins can manage announcements.');await expect(page.getByRole('button',{name:'Create announcement'})).toHaveCount(0);});
test('signed out has useful sign-in state',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Sign in to My 4418'})).toBeVisible();await expect(page.getByRole('link',{name:'Team sign-in →'})).toHaveAttribute('href','#attendance');});
for(const code of ['42501','XX000'])test(`dashboard error ${code} leaves loading state`,async({page})=>{await setup(page);await page.route('**/rpc/team_dashboard_context',r=>r.fulfill({status:400,json:{code,message:'Cannot load dashboard'}}));await page.goto('/');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText('Loading My 4418…')).toHaveCount(0);if(code==='XX000')await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();});
test('dashboard clears personal data on sign-out',async({page})=>{await setup(page);await page.goto('/');await expect(page.getByText('Welcome, Aiden.',{exact:false})).toBeVisible();await page.evaluate(()=>{localStorage.removeItem('4418-team-hub-auth');const channel=new BroadcastChannel('4418-team-hub-auth');channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();});await expect(page.getByRole('heading',{name:'Sign in to My 4418'})).toBeVisible();});

test('populated personal cards and announcement expiration',async({page})=>{
 await page.clock.install();const c=await setup(page);const future=new Date(Date.now()+3600000).toISOString();
 c.next_meeting={id:'meeting',title:'Build night',type:'preseason',starts_at:future,ends_at:future,required:true,check_in_open:true,code_expires_at:future,physical_status:'pending'};
 c.orders=[{id:'po',po_number:27,vendor:'Parts vendor',amount:12.5,status:'awaiting_approval',approvals:1}];
 await page.route('**/rpc/team_dashboard_context',r=>r.fulfill({json:{...c,announcements:[{id:'notice',title:'Urgent update',body:'<script>plain text</script>',severity:'urgent',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+10000).toISOString()}]}}));
 await page.goto('/');await expect(page.getByText('Build night')).toBeVisible();await expect(page.getByText('Check-in open',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'PO #27 · Parts vendor'})).toHaveAttribute('href','https://finance.frc4418.org/#po/po');await expect(page.getByText('1/2 approvals for the current revision')).toBeVisible();await expect(page.getByText('<script>plain text</script>',{exact:true})).toBeVisible();await page.clock.fastForward(31000);await expect(page.getByText('Urgent update')).toHaveCount(0);
});
test('a stalled dashboard request has a bounded retry state',async({page})=>{await page.clock.install();await setup(page);await page.route('**/rpc/team_dashboard_context',()=>new Promise(()=>{}));await page.goto('/');await expect(page.getByText('Loading My 4418…')).toBeVisible();await page.clock.fastForward(16000);await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();});

for(const width of [390,1440])test(`announcement audiences, image preview and explicit email ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page,true);const calls:any[]=[];
 page.on('request',r=>{if(r.url().includes('/team_announcement_save')||r.url().includes('/team_announcement_send_update'))calls.push({url:r.url(),body:r.postDataJSON()});});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=','base64');
 await page.route('**/storage/v1/**',r=>r.request().method()==='GET'?r.fulfill({contentType:'image/png',body:png}):r.fulfill({json:{Key:'image'}}));
 await page.goto('/#announcements');await page.getByRole('button',{name:'Create announcement',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d.getByLabel('Send email notification',{exact:false})).not.toBeChecked();await d.getByLabel('Title',{exact:true}).fill('Packing');await d.getByLabel('Message',{exact:true}).fill('Bring the trailer checklist.');
 await d.getByRole('combobox',{name:'Audience',exact:true}).selectOption('position');await d.getByRole('combobox',{name:'Team position',exact:true}).selectOption('communications_lead');await expect(d.getByRole('combobox',{name:'Functional area',exact:true})).toHaveCount(0);
 const file=d.getByLabel('Image (optional)',{exact:false});await file.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await expect(d.getByRole('alert')).toContainText('JPG, PNG, or WebP');
 await file.setInputFiles({name:'too-big.png',mimeType:'image/png',buffer:Buffer.alloc(6*1024*1024+1)});await expect(d.getByRole('alert')).toContainText('6 MB');
 await file.setInputFiles({name:'image.png',mimeType:'image/png',buffer:png});await expect(d.getByRole('img',{name:'Announcement attachment'})).toBeVisible();await d.getByLabel('Send email notification',{exact:false}).check();
 await page.screenshot({path:`test-results/communications-editor-${width}.png`,fullPage:true});expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await d.getByRole('button',{name:'Save announcement'}).click();await expect(d).toHaveCount(0);expect(calls[0].body.p.send_email).toBe(true);expect(calls[0].body.p.audience).toBe('position');expect(calls[0].body.p.position_key).toBe('communications_lead');expect(calls[0].body.p.image_path).toMatch(/\.png$/);
 await page.getByRole('button',{name:'Edit Packing'}).click();await expect(d.getByLabel('Send email notification',{exact:false})).toHaveCount(0);await d.getByRole('button',{name:'Save announcement'}).click();await expect(d).toHaveCount(0);expect(calls[1].body.p.send_email).toBe(false);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Send update email'}).click();await expect(page.getByRole('status')).toContainText('queued');expect(calls[2].url).toContain('team_announcement_send_update');expect(calls[2].body.request_id).toBeTruthy();
});
