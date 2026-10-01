import {test,expect,type Page} from '@playwright/test';
import {session} from './hub-session';
const uid='00000000-0000-0000-0000-000000000001';
async function setup(page:Page,manager=true){
 await session(page);
 const c:any={user_id:uid,can_manage:manager,season_id:'season',seasons:[{id:'season',name:'2027 FRC Season',status:'active',version:1}],members:[{id:uid,name:'Aiden'},{id:'other',name:'Teammate'}],areas:[{id:'area',name:'Software'}],groups:[{id:'group',name:'Robot',active:true,display_order:0}],boards:[{id:'board',season_id:'season',name:'Intake',kind:'project',active:true,version:1},{id:'admin',season_id:null,name:'Admin',kind:'area',active:true,version:1}],items:[{id:'item',season_id:'season',title:'Intake CAD',kind:'work',start_date:'2027-01-05',end_date:'2027-02-15',status:'in_progress',group_id:'group',board_id:'board',version:1},{id:'milestone',season_id:'season',title:'Design freeze',kind:'milestone',start_date:'2027-02-16',end_date:'2027-02-16',status:'not_started',predecessor_id:'item',version:1}],tasks:[{id:'task',board_id:'board',title:'Cut shafts',description:'Measure first',status:'todo',priority:'high',owner_id:uid,area_id:'area',due_date:'2027-01-20',version:1},{id:'other-task',board_id:'board',title:'Fit bearing',status:'backlog',priority:'normal',owner_id:'other',version:1}]};
 const details:any={steps:[],comments:[],history:[]};const calls:any[]=[];
 await page.route('**/rest/v1/rpc/planning_context',r=>r.fulfill({json:c}));
 await page.route('**/rest/v1/rpc/planning_task_detail',r=>r.fulfill({json:details}));
 await page.route('**/rest/v1/rpc/planning_save',r=>{const {entity,p}=r.request().postDataJSON();calls.push({entity,p});const key=({season:'seasons',group:'groups',board:'boards',item:'items',task:'tasks',step:'steps',comment:'comments'} as any)[entity];const list=entity==='step'||entity==='comment'?details[key]:c[key];if(p.id)Object.assign(list.find((x:any)=>x.id===p.id),p,{version:(p.version||1)+1});else list.push({...p,id:'new-'+calls.length,version:1});return r.fulfill({json:p.id||'new-'+calls.length});});
 return {c,details,calls};
}
for(const width of [390,1440])test(`Planning Gantt, board, task and My Work at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {calls}=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#planning');await expect(page.getByRole('heading',{name:'Planning',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:/Season Gantt/})).toBeVisible();
 await page.getByRole('button',{name:'Edit Intake CAD',exact:true}).click();let d=page.getByRole('dialog');await d.getByLabel('Title',{exact:true}).fill('Intake design');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);expect(calls[0].entity).toBe('item');
 await page.getByRole('button',{name:'Edit Design freeze'}).click();d=page.getByRole('dialog');await expect(d.getByLabel('Milestone date')).toHaveValue('2027-02-16');await expect(d.getByLabel('Starts after')).toHaveValue('item');await d.getByRole('button',{name:'Close',exact:true}).click();
 await page.screenshot({path:`test-results/planning-gantt-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('navigation',{name:'Planning workspace'}).getByRole('link',{name:'Boards',exact:true}).click();await page.getByRole('button',{name:'Intake',exact:true}).click();await page.getByLabel('Status for Cut shafts').selectOption('in_progress');await expect(page.getByLabel('Status for Cut shafts')).toHaveValue('in_progress');
 await page.getByRole('button',{name:'List view'}).click();await page.getByLabel('Search tasks').fill('shafts');await expect(page.getByRole('button',{name:'Fit bearing',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Cut shafts',exact:true}).click();d=page.getByRole('dialog');await d.getByRole('combobox',{name:'Owner',exact:true}).selectOption('other');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 await page.getByRole('button',{name:'Cut shafts',exact:true}).click();d=page.getByRole('dialog');await d.getByLabel('New checklist step').fill('Measure twice');await d.getByRole('button',{name:'Add step'}).click();await expect(d.getByRole('checkbox',{name:'Measure twice'})).toBeVisible();await d.getByRole('checkbox',{name:'Measure twice'}).check();await d.getByLabel('Add a comment').fill('Ready for review');await d.getByRole('button',{name:'Post comment'}).click();await expect(d.getByText('Ready for review',{exact:true})).toBeVisible();await d.getByRole('combobox',{name:'Owner',exact:true}).selectOption(uid);await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 await page.getByRole('navigation',{name:'Planning workspace'}).getByRole('link',{name:'My Work'}).click();await expect(page.getByRole('heading',{name:'My Work',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Cut shafts',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Fit bearing',exact:true})).toHaveCount(0);
 await page.screenshot({path:`test-results/planning-my-work-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('normal member has assigned status fallback without project administration',async({page})=>{
 await setup(page,false);await page.goto('/#planning/boards/board');await expect(page.getByRole('button',{name:'Add task'})).toHaveCount(0);await expect(page.getByLabel('Status for Fit bearing')).toBeDisabled();await page.getByLabel('Status for Cut shafts').selectOption('done');await expect(page.getByLabel('Status for Cut shafts')).toHaveValue('done');
 await page.getByRole('button',{name:'Cut shafts',exact:true}).click();const d=page.getByRole('dialog');await expect(d.getByRole('combobox',{name:'Owner',exact:true})).toBeDisabled();await expect(d.getByRole('button',{name:'Save',exact:true})).toBeVisible();await d.press('Escape');await expect(d).toHaveCount(0);
});
test('desktop drag uses the same status mutation as accessible selector',async({page})=>{
 await page.setViewportSize({width:1920,height:1000});const {calls}=await setup(page);await page.goto('/#planning/boards/board');const task=page.locator('.planning-task').filter({has:page.getByRole('button',{name:'Cut shafts',exact:true})});const done=page.locator('.planning-column').filter({has:page.getByRole('heading',{name:'Done · 0',exact:true})});await task.dragTo(done);await expect(page.getByLabel('Status for Cut shafts')).toHaveValue('done');expect(calls.at(-1).entity).toBe('task');
});
test('draft season creation, board types and signed-out privacy',async({page})=>{
 const {c,calls}=await setup(page);c.seasons=[];c.season_id=null;await page.goto('/#planning');await page.getByRole('button',{name:'Create planning season'}).click();const d=page.getByRole('dialog');await d.getByLabel('Name',{exact:true}).fill('2028 FRC Season');await expect(d.getByLabel('Season status')).toHaveValue('draft');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);expect(calls[0].p.status).toBe('draft');
 await page.evaluate(()=>{localStorage.removeItem('4418-team-hub-auth');const ch=new BroadcastChannel('4418-team-hub-auth');ch.postMessage({event:'SIGNED_OUT',session:null});ch.close();});await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await expect(page.locator('.planning')).toHaveCount(0);
});

for(const timezoneId of ['America/Los_Angeles','Pacific/Auckland'])test(`Planning calendar-date round trip in ${timezoneId}`,async({browser})=>{
 const context=await browser.newContext({timezoneId});const page=await context.newPage();const {c,calls}=await setup(page);
 Object.assign(c.items[0],{start_date:'2027-03-13',end_date:'2027-03-15'});
 await page.goto('http://127.0.0.1:4422/#planning');
 await expect(page.getByRole('button',{name:'Edit Intake CAD',exact:true})).toHaveAttribute('title',/2027-03-13 – 2027-03-15/);
 await page.getByRole('button',{name:'Edit Intake CAD',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d.getByLabel('Start date',{exact:true})).toHaveValue('2027-03-13');await expect(d.getByLabel('End date',{exact:true})).toHaveValue('2027-03-15');
 await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 expect(calls[0].p.start_date).toBe('2027-03-13');expect(calls[0].p.end_date).toBe('2027-03-15');await context.close();
});
