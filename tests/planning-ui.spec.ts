import {test,expect,type Page} from '@playwright/test';
import {session} from './hub-session';
const uid='00000000-0000-0000-0000-000000000001';
async function setup(page:Page,manager=true){
 await session(page);
 const c:any={user_id:uid,can_manage:manager,season_id:'season',seasons:[{id:'season',name:'2027 FRC Season',status:'active',version:1}],members:[{id:uid,name:'Aiden'},{id:'other',name:'Teammate'}],areas:[{id:'area',name:'Software'}],groups:[{id:'group',name:'Robot',active:true,display_order:0,version:1}],boards:[{id:'board',season_id:'season',name:'Intake',kind:'project',active:true,version:1},{id:'admin',season_id:null,name:'Admin',kind:'area',active:true,version:1}],items:[{id:'item',season_id:'season',title:'Intake CAD',kind:'work',start_date:'2027-01-05',end_date:'2027-02-15',status:'in_progress',group_id:'group',board_id:'board',version:1},{id:'milestone',season_id:'season',title:'Design freeze',kind:'milestone',start_date:'2027-02-16',end_date:'2027-02-16',status:'not_started',predecessor_id:'item',version:1}],tasks:[{id:'task',board_id:'board',title:'Cut shafts',description:'Measure first',status:'todo',priority:'high',owner_id:uid,area_id:'area',due_date:'2027-01-20',version:1},{id:'other-task',board_id:'board',title:'Fit bearing',status:'backlog',priority:'normal',owner_id:'other',version:1}]};
 const details:any={steps:[],comments:[],history:[]};const calls:any[]=[];
 await page.route('**/rest/v1/rpc/planning_context',r=>r.fulfill({json:c}));
 await page.route('**/rest/v1/rpc/planning_task_detail',r=>r.fulfill({json:details}));
 await page.route('**/rest/v1/rpc/planning_save',r=>{const {entity,p}=r.request().postDataJSON();calls.push({entity,p});const key=({season:'seasons',group:'groups',board:'boards',item:'items',task:'tasks',step:'steps',comment:'comments'} as any)[entity];const list=entity==='step'||entity==='comment'?details[key]:c[key];if(p.id)Object.assign(list.find((x:any)=>x.id===p.id),p,{version:(p.version||1)+1});else list.push({...p,id:'new-'+calls.length,version:1});return r.fulfill({json:p.id||'new-'+calls.length});});
 return {c,details,calls};
}
for(const width of [390,1440])test(`Planning Gantt, board, task and My Work at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {calls}=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#planning/plan');await expect(page.getByRole('heading',{name:'Season Plan',exact:true})).toBeVisible();await page.getByRole('button',{name:'Gantt',exact:true}).click();await expect(page.getByRole('region',{name:/Season Gantt/})).toBeVisible();
 await page.getByRole('button',{name:'Edit Intake CAD',exact:true}).click();let d=page.getByRole('dialog');await d.getByLabel('Title',{exact:true}).fill('Intake design');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);expect(calls[0].entity).toBe('item');
 await page.getByRole('button',{name:'Edit Design freeze'}).click();d=page.getByRole('dialog');await expect(d.getByLabel('Milestone date')).toHaveValue('2027-02-16');await expect(d.getByLabel('Starts after')).toHaveValue('item');await d.getByRole('button',{name:'Close',exact:true}).click();
 await page.screenshot({path:`test-results/planning-gantt-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390)await page.getByRole('button',{name:'Planning menu'}).click();await page.getByRole('navigation',{name:'Planning workspace'}).getByRole('link',{name:'Boards',exact:true}).click();await page.getByRole('button',{name:'Intake',exact:true}).click();await page.getByLabel('Status for Cut shafts').selectOption('in_progress');await expect(page.getByLabel('Status for Cut shafts')).toHaveValue('in_progress');
 await page.getByRole('button',{name:'Table'}).click();await page.getByLabel('Search tasks').fill('shafts');await expect(page.getByRole('button',{name:'Fit bearing',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Cut shafts',exact:true}).click();d=page.getByRole('dialog');await d.getByRole('combobox',{name:'Owner',exact:true}).selectOption('other');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 await page.getByRole('button',{name:'Cut shafts',exact:true}).click();d=page.getByRole('dialog');await d.getByLabel('New checklist step').fill('Measure twice');await d.getByRole('button',{name:'Add step'}).click();await expect(d.getByRole('checkbox',{name:'Measure twice'})).toBeVisible();await d.getByRole('checkbox',{name:'Measure twice'}).check();await d.getByLabel('Add a comment').fill('Ready for review');await d.getByRole('button',{name:'Post comment'}).click();await expect(d.getByText('Ready for review',{exact:true})).toBeVisible();await d.getByRole('combobox',{name:'Owner',exact:true}).selectOption(uid);await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 if(width===390)await page.getByRole('button',{name:'Planning menu'}).click();await page.getByRole('navigation',{name:'Planning workspace'}).getByRole('link',{name:'My Work'}).click();await expect(page.getByRole('heading',{name:'My Work',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Cut shafts',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Fit bearing',exact:true})).toHaveCount(0);
 await page.screenshot({path:`test-results/planning-my-work-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('normal member has assigned status fallback without project administration',async({page})=>{
 await setup(page,false);await page.goto('/#planning/boards/board');await expect(page.getByRole('button',{name:/New task/})).toHaveCount(0);await expect(page.getByLabel('Status for Fit bearing')).toBeDisabled();await page.getByLabel('Status for Cut shafts').selectOption('done');await expect(page.getByLabel('Status for Cut shafts')).toHaveValue('done');
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
 await page.goto('http://127.0.0.1:4422/#planning/plan');await page.getByRole('button',{name:'Gantt',exact:true}).click();
 await expect(page.getByRole('button',{name:'Edit Intake CAD',exact:true})).toHaveAttribute('title',/2027-03-13 – 2027-03-15/);
 await page.getByRole('button',{name:'Edit Intake CAD',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d.getByLabel('Start date',{exact:true})).toHaveValue('2027-03-13');await expect(d.getByLabel('End date',{exact:true})).toHaveValue('2027-03-15');
 await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 expect(calls[0].p.start_date).toBe('2027-03-13');expect(calls[0].p.end_date).toBe('2027-03-15');await context.close();
});

for(const width of [390,1440])test(`dedicated Planning shell and Dashboard ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.clock.install({time:new Date('2027-01-06T12:00:00')});
 const {c,calls}=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 Object.assign(c.seasons[0],{start_date:'2027-01-01',end_date:'2027-03-15'});
 c.tasks=[
 {...c.tasks[0],id:'late',title:'Overdue fabrication',due_date:'2027-01-05',status:'todo'},
 {...c.tasks[0],id:'today',title:'Integrate today',due_date:'2027-01-06',status:'in_progress'},
 {...c.tasks[0],id:'week',title:'Test this week',due_date:'2027-01-08',status:'todo'},
 {...c.tasks[0],id:'blocked',title:'Waiting on CAD',due_date:'2027-01-20',status:'blocked',owner_id:'other'},
 {...c.tasks[0],id:'done',title:'Complete',due_date:'2027-01-01',status:'done'}];
 c.items.push({...c.items[1],id:'old',title:'Old milestone',start_date:'2026-12-01'}, {...c.items[1],id:'complete',title:'Finished milestone',status:'done'});
 c.boards.push({id:'archived',name:'Archived board',active:false});c.tasks.push({...c.tasks[0],id:'hidden',board_id:'archived'});
 await page.goto('/#planning');await expect(page.locator('.suite-brand strong')).toHaveText('Planning');await expect(page.locator('.suite-picker summary')).toContainText('Planning');
 const dash=page.locator('.planning-dashboard');await expect(dash.getByRole('heading',{name:'Active season'})).toBeVisible();await expect(dash.getByText('2027-01-01 → 2027-03-15')).toBeVisible();
 const counts=dash.locator('.planning-counts');for(const [label,n] of [['To Do','2'],['In Progress','1'],['Blocked','1'],['Done','1']])await expect(counts.locator('div').filter({has:page.getByText(label,{exact:true})}).locator('dd')).toHaveText(n);
 await expect(dash.getByText('1 overdue · 1 blocked')).toBeVisible();await expect(dash.getByText('1 overdue · 1 due today · 1 due this week')).toBeVisible();await expect(dash.getByText('Design freeze',{exact:true})).toBeVisible();await expect(dash.getByText('Old milestone')).toHaveCount(0);await expect(dash.getByText('Finished milestone')).toHaveCount(0);
 await expect(dash.getByText('1 / 5 tasks complete')).toBeVisible();await expect(dash.getByText('Archived board')).toHaveCount(0);
 if(width===390)await page.getByRole('button',{name:'Planning menu'}).click();
 const nav=page.getByRole('navigation',{name:'Planning workspace'});await expect(nav.getByRole('link')).toHaveCount(4);await expect(nav.getByRole('link',{name:'Dashboard',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('navigation',{name:'Hub workspace'})).toHaveCount(0);
 if(width===390)await page.keyboard.press('Escape');
 await page.locator('.suite-picker summary').click();await expect(page.getByRole('navigation',{name:'Team 4418 apps'}).getByRole('link',{name:'Planning',exact:true})).toHaveAttribute('aria-current','page');await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/planning-dashboard-shell-${width}.png`,fullPage:true});
 await dash.getByRole('button',{name:'Intake',exact:true}).click();await expect(page.getByRole('heading',{name:'Intake',exact:true})).toBeVisible();expect(calls).toHaveLength(0);expect(errors).toEqual([]);
});
test('Planning empty Dashboard, attention omission, and Hub Systems entry',async({page})=>{
 const {c}=await setup(page);await page.goto('/#planning');await expect(page.getByRole('heading',{name:'Needs attention'})).toHaveCount(0);
 c.seasons=[];c.season_id=null;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'No active planning season'})).toBeVisible();await expect(page.getByText('Create a season to build the master schedule, organize project boards, and assign work.')).toBeVisible();await expect(page.locator('.planning-dashboard')).toHaveCount(0);
 await page.goto('/#attendance');const link=page.locator('.hub-nav a[href="#planning"]');await expect(link).toBeVisible();expect(await link.evaluate(e=>e.previousElementSibling?.textContent)).toBe('Systems');await link.click();await expect(page.locator('.suite-brand strong')).toHaveText('Planning');
});

for(const width of [390,1440])test(`Planning polished surfaces ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.clock.install({time:new Date('2027-01-06T12:00:00')});
 const {c,calls}=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 c.boards[1].area_id='area';c.tasks.push({...c.tasks[0],id:'blocked-review',board_id:'admin',title:'Resolve controller issue',status:'blocked',blocked_reason:'Waiting for replacement',due_date:'2027-01-05'});
 async function capture(name:string){await page.evaluate(()=>{window.scrollTo(0,0);if(document.activeElement?.classList.contains('skip-link'))(document.activeElement as HTMLElement).blur();});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/planning-polish-${name}-${width}.png`,fullPage:true});}
 await page.goto('/#planning/plan');await page.getByRole('button',{name:'Gantt',exact:true}).click();await expect(page.getByLabel('Today',{exact:true})).toBeVisible();await capture('gantt-today');
 await page.goto('/#planning/boards');await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Functional Areas',exact:true})).toBeVisible();await expect(page.getByText('1 blocked',{exact:true})).toBeVisible();await capture('boards');
 await page.getByRole('button',{name:'Intake',exact:true}).click();await expect(page.getByLabel('Status for Cut shafts')).toHaveValue('todo');await capture('project');
 await page.getByRole('button',{name:'Table',exact:true}).click();await expect(page.getByRole('columnheader',{name:'Priority',exact:true})).toBeVisible();await capture('list');
 await page.getByRole('button',{name:'Cut shafts',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Task',exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Planning',exact:true})).toBeVisible();await expect(dialog.getByText('No comments yet. Share progress or a question here.')).toBeVisible();await capture('task');await dialog.press('Escape');await expect(page.getByRole('button',{name:'Cut shafts',exact:true})).toBeFocused();
 await page.goto('/#planning/boards/admin');await page.getByRole('button',{name:'Kanban',exact:true}).click();await expect(page.getByText('Blocked: Waiting for replacement')).toBeVisible();await capture('area');
 await page.goto('/#planning/my-work');await expect(page.getByText('Overdue · 2027-01-05')).toBeVisible();await expect(page.locator('.planning-task').filter({hasText:'Resolve controller issue'}).getByText('Admin',{exact:true})).toBeVisible();await capture('work');
 c.seasons=[];c.season_id=null;await page.goto('/#planning');await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'No active planning season'})).toBeVisible();await expect(page.locator('.planning-intro-grid section')).toHaveCount(3);await expect(page.locator('.planning-counts')).toHaveCount(0);await capture('onboarding');expect(calls).toHaveLength(0);expect(errors).toEqual([]);
});

for(const width of [390,1440])test(`V1.1 grouped Table and Gantt share item identity ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {c,calls}=await setup(page);
 await page.goto('/#planning/plan');await expect(page.getByRole('button',{name:'Table',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'+ Add group',exact:true}).click();let d=page.getByRole('dialog');await expect(d.getByLabel('Display order')).toHaveCount(0);await d.getByLabel('Name',{exact:true}).fill('Manufacturing');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 let group=page.locator('.planning-plan-group').filter({has:page.locator('summary').filter({hasText:'Manufacturing'})});await group.getByRole('button',{name:'Group settings'}).click();d=page.getByRole('dialog');await d.getByLabel('Name',{exact:true}).fill('Fabrication');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);
 group=page.locator('.planning-plan-group').filter({has:page.locator('summary').filter({hasText:'Fabrication'})});await group.getByRole('button',{name:'Move to top'}).click();await expect(page.locator('.planning-plan-group').first()).toContainText('Fabrication');
 await group.getByRole('button',{name:'+ Add item',exact:true}).click();await group.getByLabel('Item title').fill('Build intake');await group.getByRole('button',{name:'Add',exact:true}).click();await expect(group.getByRole('button',{name:'Build intake',exact:true})).toBeVisible();const created=c.items.find((i:any)=>i.title==='Build intake');expect(created.group_id).toBe(c.groups.find((g:any)=>g.name==='Fabrication').id);
 await group.getByRole('button',{name:'Build intake',exact:true}).click();d=page.getByRole('dialog');await d.getByLabel('Title',{exact:true}).fill('Fabricate intake');await d.getByLabel('Start date',{exact:true}).fill('2027-01-07');await d.getByLabel('End date',{exact:true}).fill('2027-01-12');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);expect(calls.at(-1).p.id).toBe(created.id);
 await page.getByRole('button',{name:'Gantt',exact:true}).click();await expect(page.locator('.planning-gantt-group').first()).toHaveText('Fabrication');await page.getByRole('button',{name:'Edit Fabricate intake',exact:true}).click();d=page.getByRole('dialog');await expect(d.getByLabel('Start date',{exact:true})).toHaveValue('2027-01-07');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);expect(calls.at(-1).p.id).toBe(created.id);expect(c.items.filter((i:any)=>i.id===created.id)).toHaveLength(1);
 await page.getByRole('button',{name:'Edit Design freeze',exact:true}).click();d=page.getByRole('dialog');await expect(d.getByLabel('Starts after')).toHaveValue('item');await expect(d.getByLabel('Milestone date')).toHaveValue('2027-02-16');await d.getByRole('button',{name:'Close',exact:true}).click();
 await page.screenshot({path:`test-results/planning-v11-gantt-${width}.png`,fullPage:true});await page.getByRole('button',{name:'+ Add milestone',exact:true}).click();d=page.getByRole('dialog');await expect(d.getByLabel('Item type')).toHaveValue('milestone');await d.press('Escape');
 await page.getByRole('button',{name:'Table',exact:true}).click();await page.screenshot({path:`test-results/planning-v11-table-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const width of [390,1440])test(`V1.1 quick Tasks and shared Board views ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {c,calls}=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#planning/boards/board');
 for(const status of ['backlog','todo','in_progress','blocked','done']){
  const column=page.locator('.planning-column').filter({has:page.locator(`h3[data-status="${status}"]`)});
  await column.getByRole('button',{name:'+ Add task',exact:true}).click();await column.getByLabel('Task title').fill('Quick '+status);await column.getByRole('button',{name:'Add',exact:true}).click();await expect(column.getByRole('button',{name:'Quick '+status,exact:true})).toBeVisible();expect(calls.at(-1).p.status).toBe(status);expect(calls.at(-1).entity).toBe('task');
 }
 await page.getByRole('button',{name:'Table',exact:true}).click();await expect(page.getByRole('button',{name:'Quick blocked',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'+ Add task',exact:true}).click();await page.getByLabel('Task title').fill('Table task');await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.getByLabel('Status for Table task')).toHaveValue('todo');const id=c.tasks.find((t:any)=>t.title==='Table task').id;
 await page.getByLabel('Owner for Table task').selectOption(uid);await expect(page.getByLabel('Owner for Table task')).toHaveValue(uid);await page.getByLabel('Priority for Table task').selectOption('high');await expect(page.getByLabel('Priority for Table task')).toHaveValue('high');await page.getByLabel('Due date for Table task').fill('2027-02-01');await page.getByRole('heading',{name:'Intake',exact:true}).click();await expect.poll(()=>c.tasks.find((t:any)=>t.id===id).due_date).toBe('2027-02-01');
 await page.getByRole('button',{name:'Kanban',exact:true}).click();await expect(page.getByRole('button',{name:'Table task',exact:true})).toBeVisible();await page.goto('/#planning/my-work');await expect(page.getByRole('button',{name:'Table task',exact:true})).toBeVisible();await page.getByLabel('Status for Table task').selectOption('in_progress');await expect(page.getByLabel('Status for Table task')).toHaveValue('in_progress');expect(calls.at(-1).p.id).toBe(id);
 await page.goto('/#planning/boards/board');await expect(page.locator('.planning-column').filter({has:page.locator('h3[data-status="in_progress"]')}).getByRole('button',{name:'Table task',exact:true})).toBeVisible();expect(c.tasks.filter((t:any)=>t.id===id)).toHaveLength(1);
 await page.getByRole('button',{name:'+ New task',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('Title',{exact:true}).fill('Full task');await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);await expect(page.getByRole('button',{name:'Full task',exact:true})).toBeVisible();await page.screenshot({path:`test-results/planning-v11-kanban-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('V1.1 simple Board creation, settings and member boundaries',async({page})=>{
 const {c,calls}=await setup(page);await page.goto('/#planning/boards');
 for(const kind of ['project','area']){
  await page.getByRole('button',{name:'Create board',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('Name',{exact:true}).fill('New '+kind);await d.getByLabel('Board type').selectOption(kind);await expect(d.getByLabel('Board state')).toHaveCount(0);await expect(d.getByLabel('Display order')).toHaveCount(0);if(kind==='area')await d.getByRole('combobox',{name:'Functional area',exact:true}).selectOption('area');else await expect(d.getByRole('combobox',{name:'Functional area',exact:true})).toHaveCount(0);await d.getByRole('button',{name:'Save',exact:true}).click();await expect(d).toHaveCount(0);expect(calls.at(-1).p.active).toBe(true);expect(typeof calls.at(-1).p.display_order).toBe('number');expect(calls.at(-1).p.season_id).toBe(kind==='area'?null:'season');
 }
 await page.getByRole('button',{name:'New area',exact:true}).click();await expect(page.getByRole('heading',{name:'New area',exact:true,level:2})).toBeVisible();await page.getByRole('button',{name:'Board settings',exact:true}).click();const d=page.getByRole('dialog');await expect(d.getByLabel('Board type')).toBeDisabled();await expect(d.getByLabel('Board state')).toBeVisible();await d.press('Escape');
 c.can_manage=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('button',{name:/Add task|New task|Board settings/})).toHaveCount(0);await page.goto('/#planning/plan');await expect(page.getByRole('button',{name:/Add item|Add group|Add milestone|Group settings/})).toHaveCount(0);
});
test('V1.1 inline stale edit and quick-create denial surface without optimistic changes',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/planning_save',r=>r.fulfill({status:403,json:{message:'Planning leadership required'}}));await page.goto('/#planning/boards/board');const col=page.locator('.planning-column').first();await col.getByRole('button',{name:'+ Add task',exact:true}).click();await col.getByLabel('Task title').fill('Denied task');await col.getByRole('button',{name:'Add',exact:true}).click();await expect(col.getByRole('alert')).toContainText('Planning leadership required');await expect(page.getByRole('button',{name:'Denied task',exact:true})).toHaveCount(0);await col.getByRole('button',{name:'Cancel',exact:true}).click();await expect(col.getByRole('button',{name:'+ Add task',exact:true})).toBeFocused();
 await page.route('**/rest/v1/rpc/planning_save',r=>r.fulfill({status:409,json:{message:'Changed by another teammate. Refresh before saving.'}}));await page.getByRole('button',{name:'Table',exact:true}).click();await page.getByLabel('Priority for Cut shafts').selectOption('low');await expect(page.getByRole('alert')).toContainText('Changed by another teammate');await expect(page.getByLabel('Priority for Cut shafts')).toHaveValue('high');
});
