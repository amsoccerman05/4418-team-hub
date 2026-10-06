import {test,expect,type Locator,type Page} from '@playwright/test';
import {assemblyActor,assemblyBoard,assemblyId,assemblyRoute,assemblyToken,assemblyUIFixture,changeAssemblyActor,setupAssemblyUI} from './fixtures/assembly-ui';
import {sprintReviewUIFixture,uiActor,uiId} from './fixtures/sprint-review-ui';
import type {ReviewMutation,SprintReviewContext} from '../src/planning/reviews/types';
import {assertAssemblyContext} from '../src/planning/assembly/model';

const workspace=(page:Page)=>page.getByRole('region',{name:'Project assembly and testing'});
const card=(page:Page,title:string)=>workspace(page).locator('.assembly-check').filter({has:page.getByRole('heading',{name:title,exact:true})});
const pending=(page:Page)=>page.getByRole('complementary',{name:'Pending assembly save'});
async function openComponent(page:Page,name='Synthetic belt tensioner'){
 await workspace(page).getByRole('button',{name:'Add component',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Component name',{exact:true}).fill(name);return dialog;
}
async function fillCheck(dialog:Locator,title='Loaded roller function'){
 await dialog.getByLabel('Check title',{exact:true}).fill(title);
 await dialog.getByLabel('Method / test conditions',{exact:true}).fill('Run ten synthetic loaded cycles at the recorded bench setting.');
 await dialog.getByLabel('Expected result',{exact:true}).fill('Ten complete cycles without binding.');
 await dialog.getByLabel('Observed result',{exact:true}).fill('Completed nine cycles; one bound at the bracket.');
 await dialog.getByLabel('Evidence link',{exact:false}).fill('https://example.com/synthetic-assembly/loaded-roller');
}
async function dismiss(dialog:Locator){await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);}

for(const width of [390,768,1440])test(`Assembly workspace and editor screenshots at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:980});const state=await setupAssemblyUI(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(assemblyRoute);await expect(workspace(page).getByRole('heading',{name:'Assembly & testing',exact:true})).toBeVisible();
 await expect(page.getByRole('group',{name:'Board view'}).getByRole('button',{name:'Assembly & testing'})).toHaveAttribute('aria-pressed','true');
 await expect(workspace(page).getByText('1/2',{exact:true})).toHaveCount(3);await expect(workspace(page).getByText('1 failed · 0 blocked · 1 older revision')).toBeVisible();
 await expect(page.locator('main')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/assembly/workspace-${width}.png`,fullPage:true});
 let dialog=await openComponent(page);await page.screenshot({path:`test-results/assembly/component-${width}.png`});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await dismiss(dialog);
 await workspace(page).getByRole('button',{name:'Record a check',exact:true}).click();dialog=page.getByRole('dialog');await fillCheck(dialog);await dialog.getByLabel('Part revision',{exact:true}).selectOption(assemblyId(410));
 await expect(dialog.getByText('This is an older revision.',{exact:false})).toBeVisible();await page.screenshot({path:`test-results/assembly/check-${width}.png`});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await dismiss(dialog);
 expect(state.mutations).toEqual([]);expect(state.canonicalWrites).toEqual([]);expect(errors).toEqual([]);expect(state.external.every(url=>url.includes('fonts.googleapis.com')||url.includes('fonts.gstatic.com'))).toBe(true);
});

test('creates and updates manual components without changing canonical Planning records',async({page})=>{
 const state=await setupAssemblyUI(page);await page.goto(assemblyRoute);let dialog=await openComponent(page);
 await dialog.getByLabel('Quantity needed',{exact:true}).fill('2');await dialog.getByLabel('Component status',{exact:true}).selectOption('ordered');await dialog.getByLabel('Component notes',{exact:true}).fill('Two synthetic units ordered; awaiting arrival.');
 await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);
 expect(state.mutations).toHaveLength(1);expect(state.mutations[0]).toMatchObject({action:'component',expected_actor:assemblyActor,p:{board_id:assemblyBoard,version:4,name:'Synthetic belt tensioner',quantity:2,status:'ordered'}});
 await workspace(page).getByRole('button',{name:'Synthetic belt tensioner',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Quantity needed')).toHaveValue('2');await dialog.getByLabel('Component status').selectOption('installed');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(state.mutations).toHaveLength(2);expect((state.mutations[1].p as any).id).toBe((state.mutations[0].p as any).id);expect(state.context.components.filter(c=>c.name==='Synthetic belt tensioner')).toHaveLength(1);expect(state.context.facts.components_available).toBe(2);expect(state.canonicalWrites).toEqual([]);
});

test('links and unlinks an existing task without duplicating, assigning or changing it',async({page})=>{
 const state=await setupAssemblyUI(page),before=structuredClone(state.context.tasks);await page.goto(assemblyRoute);await workspace(page).getByRole('button',{name:'Link Planning task',exact:true}).click();let dialog=page.getByRole('dialog');
 await expect(dialog.getByLabel('Planning task',{exact:true}).locator('option')).not.toContainText(['Mount the intake roller']);await dialog.getByLabel('Planning task',{exact:true}).selectOption(assemblyId(301));await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
 const task=workspace(page).locator('.assembly-task').filter({has:page.getByRole('button',{name:'Install the belt guard',exact:true})});await expect(task).toContainText('Alex Builder · Due 2026-10-10');await task.getByRole('button',{name:'Install the belt guard',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Install the belt guard');await dismiss(dialog);
 await task.getByRole('button',{name:'Unlink from assembly',exact:true}).click();await expect(task).toHaveCount(0);expect(state.context.tasks).toEqual(before);expect(state.canonicalWrites).toEqual([]);expect(state.mutations.map(m=>m.action)).toEqual(['task_link','task_link']);
 expect(state.mutations.map(m=>m.p)).toEqual([{task_id:assemblyId(301),linked:true,board_id:assemblyBoard,version:4},{task_id:assemblyId(301),linked:false,board_id:assemblyBoard,version:5}]);
});

test('shows older-revision warning and opens evidence only as a safe reference link',async({page})=>{
 const state=await setupAssemblyUI(page);await page.goto(assemblyRoute);const old=card(page,'Original plate fit');await expect(old).toContainText('Intake side plate, revision 1');await expect(old).toContainText('Older part revision. This result does not establish the current revision');
 const evidence=old.getByRole('link',{name:'Open evidence'});await expect(evidence).toHaveAttribute('href','https://example.com/synthetic-assembly/check-600');await expect(evidence).toHaveAttribute('target','_blank');await expect(evidence).toHaveAttribute('rel','noopener noreferrer');expect(state.external.some(url=>url.includes('example.com'))).toBe(false);expect(state.mutations).toEqual([]);
});

test('records a failed revision check linked to existing rework and preserves canonical task state',async({page})=>{
 const state=await setupAssemblyUI(page),tasks=structuredClone(state.context.tasks);await page.goto(assemblyRoute);await workspace(page).getByRole('button',{name:'Record a check',exact:true}).click();const dialog=page.getByRole('dialog');await fillCheck(dialog);await dialog.getByLabel('Check type').selectOption('function');await dialog.getByLabel('Result',{exact:true}).selectOption('failed');await dialog.getByLabel('Part revision').selectOption(assemblyId(411));await dialog.getByLabel('Rework task',{exact:false}).selectOption(assemblyId(302));await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
 const saved=card(page,'Loaded roller function');await expect(saved).toContainText('Failed');await expect(saved).toContainText('Intake side plate, revision 2');await expect(saved.getByRole('button',{name:'Rework: Correct the support bracket fit'})).toBeVisible();expect(state.mutations[0]).toMatchObject({action:'check',p:{revision_id:assemblyId(411),rework_task_id:assemblyId(302),supersedes_id:null,outcome:'failed'}});expect(state.context.tasks).toEqual(tasks);expect(state.canonicalWrites).toEqual([]);
});

test('follow-up creates an immutable chain, stays on its revision and clears rework for a pass',async({page})=>{
 const state=await setupAssemblyUI(page),original=structuredClone(state.context.checks[1]);await page.goto(assemblyRoute);await card(page,'Support bracket fit').getByRole('button',{name:'Record follow-up check'}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByLabel('Part revision')).toBeDisabled();await expect(dialog.getByLabel('Part revision')).toHaveValue(assemblyId(412));await expect(dialog.getByLabel('Observed result')).toHaveValue('');await dialog.getByLabel('Result',{exact:true}).selectOption('passed');await expect(dialog.getByLabel('Rework task',{exact:false})).toHaveCount(0);await dialog.getByLabel('Observed result').fill('Reworked bracket rotates freely for all ten cycles.');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(state.context.checks.find(c=>c.id===original.id)).toEqual(original);expect(state.mutations[0]).toMatchObject({action:'check',p:{supersedes_id:original.id,revision_id:original.revision_id,rework_task_id:null,outcome:'passed'}});expect((state.mutations[0].p as any).id).not.toBe(original.id);await expect(workspace(page).getByText('Previous check records (1)',{exact:true})).toBeVisible();await workspace(page).getByText('Previous check records (1)',{exact:true}).click();await expect(workspace(page).locator('.assembly-history')).toContainText(original.observed);expect(state.context.facts).toMatchObject({checks_total:2,checks_passed:1,checks_failed:0,checks_stale:1});
});

test('snapshots are explicit immutable meeting references and are not automatic review writes',async({page})=>{
 const state=await setupAssemblyUI(page);await page.goto(assemblyRoute);expect(state.context.snapshots).toEqual([]);await workspace(page).getByRole('button',{name:'Capture review snapshot'}).click();let dialog=page.getByRole('dialog');await expect(dialog).toContainText('Nothing is inserted into a review or deck until you choose that snapshot');await dialog.getByLabel('Discussion notes',{exact:false}).fill('Discuss the remaining belt and current fit failure.');await dialog.getByRole('button',{name:'Capture snapshot',exact:true}).click();await expect(dialog).toHaveCount(0);
 const frozen=structuredClone(state.context.snapshots[0]);await expect(workspace(page).locator('.assembly-snapshot-text').first()).toHaveText(frozen.summary);await expect(workspace(page).getByRole('link',{name:'Open Sprint Review'})).toHaveAttribute('href','#planning/reviews');
 await workspace(page).getByRole('button',{name:'Timing belt',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Component status').selectOption('received');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);expect(state.context.facts.components_available).toBe(2);expect(state.context.snapshots[0]).toEqual(frozen);await expect(workspace(page).locator('.assembly-snapshot-text').first()).toHaveText(frozen.summary);expect(state.mutations.map(m=>m.action)).toEqual(['snapshot','component']);expect(state.canonicalWrites).toEqual([]);
});

test('readonly users retain facts, evidence and canonical task detail but no assembly mutate controls',async({page})=>{
 const state=await setupAssemblyUI(page,c=>c.can_edit=false);await page.goto(assemblyRoute);await expect(workspace(page).getByRole('heading',{name:'Purchased components'})).toBeVisible();for(const name of ['Add component','Link Planning task','Record a check','Record follow-up check','Capture review snapshot','Unlink from assembly','Flanged shaft bearings'])await expect(workspace(page).getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(workspace(page).getByRole('link',{name:'Open evidence'})).toHaveCount(2);await workspace(page).getByRole('button',{name:'Mount the intake roller',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Mount the intake roller');expect(state.mutations).toEqual([]);expect(state.canonicalWrites).toEqual([]);
});

test('Close, Escape and browser route changes discard unsaved drafts without writes',async({page})=>{
 const state=await setupAssemblyUI(page);await page.goto(assemblyRoute);let dialog=await openComponent(page,'Discard when closed');await dismiss(dialog);dialog=await openComponent(page,'Discard on Escape');await dialog.press('Escape');await expect(dialog).toHaveCount(0);await workspace(page).getByRole('button',{name:'Add component'}).click();dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Component name')).toHaveValue('');await dialog.getByLabel('Component name').fill('Discard on navigation');await page.evaluate(()=>location.hash='planning/boards');await expect(dialog).toHaveCount(0);await page.goBack();await expect(workspace(page)).toBeVisible();await workspace(page).getByRole('button',{name:'Add component'}).click();await expect(page.getByRole('dialog').getByLabel('Component name')).toHaveValue('');expect(state.mutations).toEqual([]);
});

test('unknown write saves only receipt identifiers and resolves without replaying the payload',async({page})=>{
 const state=await setupAssemblyUI(page);await page.route('**/rpc/assembly_mutate',async r=>{state.apply(r.request().postDataJSON());await r.abort('failed');});await page.goto(assemblyRoute);const dialog=await openComponent(page,'Unknown save synthetic component');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('confirmed');await dismiss(dialog);await expect(pending(page)).toBeVisible();
 const stored=await page.evaluate(()=>sessionStorage.getItem('4418-assembly-receipts-v1'));expect(Object.keys(JSON.parse(stored!)[0]).sort()).toEqual(['expected_actor','request_id']);expect(stored).not.toContain('Unknown save');expect(state.mutations).toHaveLength(1);await expect(workspace(page).getByRole('button',{name:'Add component'})).toBeDisabled();await pending(page).getByRole('button',{name:'Check save status'}).click();await expect(pending(page)).toHaveCount(0);await expect(workspace(page).getByRole('button',{name:'Unknown save synthetic component',exact:true})).toBeVisible();expect(state.mutations).toHaveLength(1);
});

test('cancelled delayed save cannot reappear and a new editor starts blank',async({page})=>{
 const state=await setupAssemblyUI(page);let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/rpc/assembly_mutate',async r=>{const body=r.request().postDataJSON();started=true;await held;await r.fulfill({json:state.apply(body)}).catch(()=>{});});
 try{await page.goto(assemblyRoute);const dialog=await openComponent(page,'Do not restore this delayed draft');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>started).toBe(true);await dismiss(dialog);await pending(page).getByRole('button',{name:'Check save status'}).click();await expect(workspace(page).getByText('No committed result was found.',{exact:false})).toBeVisible();await pending(page).getByRole('button',{name:'Cancel pending request'}).click();await expect(pending(page)).toHaveCount(0);release();await expect.poll(()=>state.mutations.length).toBe(1);expect(state.context.components).toHaveLength(2);await workspace(page).getByRole('button',{name:'Add component'}).click();await expect(page.getByRole('dialog').getByLabel('Component name')).toHaveValue('');}finally{release();}
});

test('stale rejection keeps the draft reviewable and does not strand a recovery receipt',async({page})=>{
 const state=await setupAssemblyUI(page);await page.route('**/rpc/assembly_mutate',r=>r.fulfill({status:409,json:{code:'AS409',message:'Stale project version'}}));await page.goto(assemblyRoute);const dialog=await openComponent(page,'Review this unsaved correction');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Another teammate');await expect(dialog.getByLabel('Component name')).toHaveValue('Review this unsaved correction');await expect(pending(page)).toHaveCount(0);await dismiss(dialog);expect(state.mutations).toEqual([]);
});

test('actor switch immediately clears old drafts, evidence and the other actor recovery receipt',async({page})=>{
 const state=await setupAssemblyUI(page);await page.goto(assemblyRoute);const dialog=await openComponent(page,'Former actor private draft');await page.evaluate(({actor,id})=>sessionStorage.setItem('4418-assembly-receipts-v1',JSON.stringify([{expected_actor:actor,request_id:id}])),{actor:assemblyActor,id:assemblyId(900)});
 state.context.user_id=assemblyId(2);state.context.can_edit=false;state.context.components=[];state.context.parts=[];state.context.revisions=[];state.context.tasks=[];state.context.linked_task_ids=[];state.context.checks=[];state.context.snapshots=[];await changeAssemblyActor(page,assemblyId(2));await expect(dialog).toHaveCount(0);await expect(pending(page)).toHaveCount(0);await expect(page.getByText('Former actor private draft',{exact:true})).toHaveCount(0);await expect(workspace(page).getByRole('link',{name:'Open evidence'})).toHaveCount(0);expect(state.mutations).toEqual([]);
});

test('signout suppresses a late assembly read',async({page})=>{
 await setupAssemblyUI(page);let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/rpc/assembly_context',async r=>{started=true;await held;await r.fulfill({json:assemblyUIFixture()}).catch(()=>{});});
 try{await page.goto(assemblyRoute);await expect.poll(()=>started).toBe(true);await changeAssemblyActor(page,null);await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();release();await expect(workspace(page)).toHaveCount(0);await expect(page.getByText('Flanged shaft bearings',{exact:true})).toHaveCount(0);}finally{release();}
});

test('changing project suppresses a late read from the former project',async({page})=>{
 await setupAssemblyUI(page);let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/rpc/assembly_context',async r=>{const p=r.request().postDataJSON();if(p.board_id!==assemblyBoard)return r.fulfill({status:403,json:{code:'AS403',message:'Unavailable'}});started=true;await held;await r.fulfill({json:assemblyUIFixture()}).catch(()=>{});});
 try{await page.goto(assemblyRoute);await expect.poll(()=>started).toBe(true);await page.evaluate(id=>location.hash=`planning/boards/${id}/assembly`,assemblyId(201));await expect(page.getByRole('heading',{name:'Elevator prototype',exact:true})).toBeVisible();release();await expect(workspace(page).getByRole('alert')).toContainText('access');await expect(page.getByText('Flanged shaft bearings',{exact:true})).toHaveCount(0);}finally{release();}
});

test('route change suppresses a delayed write result and leaves receipt-based recovery',async({page})=>{
 const state=await setupAssemblyUI(page);let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/rpc/assembly_mutate',async r=>{const body=r.request().postDataJSON();started=true;await held;await r.fulfill({json:state.apply(body)}).catch(()=>{});});
 try{await page.goto(assemblyRoute);const dialog=await openComponent(page,'Saved only to original project');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>started).toBe(true);await page.evaluate(()=>location.hash='planning/boards');await expect(dialog).toHaveCount(0);release();await expect.poll(()=>state.mutations.length).toBe(1);await expect(page.getByText('Saved only to original project',{exact:true})).toHaveCount(0);await page.goBack();await expect(pending(page)).toBeVisible();await pending(page).getByRole('button',{name:'Check save status'}).click();await expect(pending(page)).toHaveCount(0);expect(state.mutations).toHaveLength(1);}finally{release();}
});

test('context, mutation and recovery use the exact actor token and explicit provenance',async({page})=>{
 const state=await setupAssemblyUI(page);await page.addInitScript(({actor,id})=>sessionStorage.setItem('4418-assembly-receipts-v1',JSON.stringify([{expected_actor:actor,request_id:id}])),{actor:assemblyActor,id:assemblyId(910)});await page.goto(assemblyRoute);await pending(page).getByRole('button',{name:'Check save status'}).click();await expect(workspace(page).getByText('No committed result was found.',{exact:false})).toBeVisible();await pending(page).getByRole('button',{name:'Cancel pending request'}).click();await expect(pending(page)).toHaveCount(0);const dialog=await openComponent(page,'Token provenance fixture');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(state.requests.map(r=>r.name)).toEqual(expect.arrayContaining(['assembly_context','assembly_mutation_status','assembly_cancel_mutation','assembly_mutate']));expect(state.requests.filter(r=>r.name!=='assembly_context').map(r=>r.name)).toEqual(['assembly_mutation_status','assembly_cancel_mutation','assembly_mutate']);expect(state.requests.every(r=>r.authorization===`Bearer ${assemblyToken}`)).toBe(true);expect(state.requests.every(r=>r.body.expected_actor===assemblyActor)).toBe(true);expect(state.requests.filter(r=>r.name==='assembly_context').every(r=>r.body.board_id===assemblyBoard)).toBe(true);expect(state.mutations[0].p.board_id).toBe(assemblyBoard);
});

test('actor change suppresses the late response of a committed save without replaying it',async({page})=>{
 const state=await setupAssemblyUI(page);let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve),headers:string[]=[];await page.route('**/rpc/assembly_mutate',async r=>{headers.push(r.request().headers()['authorization']);const receipt=state.apply(r.request().postDataJSON());started=true;await held;await r.fulfill({json:receipt}).catch(()=>{});});
 try{await page.goto(assemblyRoute);const dialog=await openComponent(page,'Former actor saved component');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>started).toBe(true);state.context.user_id=assemblyId(2);state.context.components=[];state.context.can_edit=false;state.context.checks=[];state.context.parts=[];state.context.revisions=[];state.context.tasks=[];state.context.linked_task_ids=[];await changeAssemblyActor(page,assemblyId(2));await expect(dialog).toHaveCount(0);release();await expect(pending(page)).toHaveCount(0);await expect(page.getByText('Former actor saved component',{exact:true})).toHaveCount(0);expect(state.mutations).toHaveLength(1);expect(headers).toEqual([`Bearer ${assemblyToken}`]);expect(state.mutations[0].expected_actor).toBe(assemblyActor);}finally{release();}
});

test('a pending save remains recoverable when assembly context access is lost',async({page})=>{
 await setupAssemblyUI(page);await page.addInitScript(({actor,id})=>sessionStorage.setItem('4418-assembly-receipts-v1',JSON.stringify([{expected_actor:actor,request_id:id}])),{actor:assemblyActor,id:assemblyId(911)});await page.route('**/rpc/assembly_context',r=>r.fulfill({status:403,json:{code:'AS403',message:'Access changed'}}));await page.goto(assemblyRoute);await expect(pending(page)).toBeVisible();await expect(workspace(page).getByRole('alert')).toContainText('access');await pending(page).getByRole('button',{name:'Cancel pending request'}).click();await expect(pending(page)).toHaveCount(0);await expect(workspace(page).getByRole('button',{name:'Add component'})).toHaveCount(0);
});

test('malformed and cross-board assembly payloads never display another project records',async({page})=>{
 const state=await setupAssemblyUI(page);await page.route('**/rpc/assembly_context',r=>r.fulfill({json:{...state.context,board_id:assemblyId(201)}}));await page.goto(assemblyRoute);await expect(workspace(page).getByRole('alert')).toContainText('invalid response');await expect(workspace(page).getByText('Flanged shaft bearings',{exact:true})).toHaveCount(0);expect(state.mutations).toEqual([]);
});

async function setupReviewSnapshots(page:Page,withSnapshot=true){
 const state=await setupAssemblyUI(page);
 if(withSnapshot){state.apply({action:'snapshot',request_id:assemblyId(901),expected_actor:assemblyActor,p:{board_id:assemblyBoard,version:state.context.version,id:assemblyId(902),notes:'Discuss the remaining belt and current fit failure.'}});state.mutations.length=0;}
 const review: SprintReviewContext=JSON.parse(JSON.stringify(sprintReviewUIFixture()).replaceAll(uiActor,assemblyActor).replaceAll(uiId(200),assemblyBoard)),reviewMutations:ReviewMutation[]=[];
 await page.route('**/rpc/sprint_review_context',r=>r.fulfill({json:review}));
 await page.route('**/rpc/sprint_review_save',r=>{const body:ReviewMutation=r.request().postDataJSON();reviewMutations.push(structuredClone(body));const input:any=body.p,entry=review.updates.find(row=>row.id===input.id)!;Object.assign(entry,input,{version:input.version+1});return r.fulfill({json:{request_id:body.request_id,status:'applied',action:'update',entity_id:input.id,version:input.version+1}});});
 return {...state,review,reviewMutations};
}
const reviewProject=(page:Page)=>page.locator(`#review-project-${assemblyBoard}`);
async function openWeeklyUpdate(page:Page){await reviewProject(page).getByRole('button',{name:'Edit update',exact:true}).click();return page.getByRole('dialog');}

test('Sprint Review adds a chosen frozen snapshot only on explicit insertion and save',async({page})=>{
 await page.setViewportSize({width:1440,height:980});const state=await setupReviewSnapshots(page),snapshot=structuredClone(state.context.snapshots[0]),oldProgress=state.review.updates[0].progress;await page.goto('/#planning/reviews');const dialog=await openWeeklyUpdate(page);
 await expect(dialog.getByLabel('Progress this week')).toHaveValue(oldProgress);expect(state.requests).toHaveLength(0);await dialog.getByRole('button',{name:'Choose assembly snapshot'}).click();await expect(dialog.getByLabel('Captured snapshot')).toHaveValue(snapshot.id);await expect(dialog.getByLabel('Progress this week')).toHaveValue(oldProgress);expect(state.reviewMutations).toEqual([]);
 await dialog.getByRole('button',{name:'Add selected snapshot to progress'}).click();const combined=`${oldProgress}\n\n${snapshot.summary}`;await expect(dialog.getByLabel('Progress this week')).toHaveValue(combined);expect(state.review.updates[0].progress).toBe(oldProgress);expect(state.reviewMutations).toEqual([]);expect(state.mutations).toEqual([]);
 await dialog.getByRole('button',{name:'Add selected snapshot to progress'}).click();await expect(dialog.getByRole('alert')).toContainText('already included');await expect(dialog.getByLabel('Progress this week')).toHaveValue(combined);
 await page.screenshot({path:'test-results/assembly/review-snapshot-insertion-1440.png'});await dialog.getByRole('button',{name:'Save weekly update'}).click();await expect(dialog).toHaveCount(0);expect(state.reviewMutations).toHaveLength(1);expect((state.reviewMutations[0].p as any).progress).toBe(combined);
 state.context.components[1].status='received';state.context.parts[1].status='done';await page.getByRole('button',{name:'Refresh Sprint Review'}).click();await expect(reviewProject(page)).toContainText(snapshot.summary);expect(state.review.updates[0].progress).toBe(combined);expect(state.context.snapshots[0]).toEqual(snapshot);expect(state.mutations).toEqual([]);
});

test('Sprint Review closing an inserted snapshot draft does not modify the saved update',async({page})=>{
 const state=await setupReviewSnapshots(page),oldProgress=state.review.updates[0].progress;await page.goto('/#planning/reviews');let dialog=await openWeeklyUpdate(page);await dialog.getByRole('button',{name:'Choose assembly snapshot'}).click();await dialog.getByRole('button',{name:'Add selected snapshot to progress'}).click();await expect(dialog.getByLabel('Progress this week')).toHaveValue(`${oldProgress}\n\n${state.context.snapshots[0].summary}`);await dismiss(dialog);dialog=await openWeeklyUpdate(page);await expect(dialog.getByLabel('Progress this week')).toHaveValue(oldProgress);expect(state.reviewMutations).toEqual([]);expect(state.mutations).toEqual([]);
});

test('Sprint Review snapshot load is discarded when the editor closes before its response',async({page})=>{
 const state=await setupReviewSnapshots(page);let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/rpc/assembly_context',async r=>{started=true;await held;await r.fulfill({json:state.context}).catch(()=>{});});
 try{await page.goto('/#planning/reviews');let dialog=await openWeeklyUpdate(page);await dialog.getByRole('button',{name:'Choose assembly snapshot'}).click();await expect.poll(()=>started).toBe(true);await dismiss(dialog);release();dialog=await openWeeklyUpdate(page);await expect(dialog.getByRole('button',{name:'Choose assembly snapshot'})).toBeVisible();await expect(dialog.getByLabel('Captured snapshot')).toHaveCount(0);await expect(dialog.getByLabel('Progress this week')).toHaveValue(state.review.updates[0].progress);expect(state.reviewMutations).toEqual([]);}finally{release();}
});

test('Sprint Review snapshot picker handles no snapshots and rejects oversized insertion',async({page})=>{
 const state=await setupReviewSnapshots(page,false);await page.goto('/#planning/reviews');let dialog=await openWeeklyUpdate(page);await dialog.getByRole('button',{name:'Choose assembly snapshot'}).click();await expect(dialog.getByText('No snapshots yet.',{exact:false})).toBeVisible();await dismiss(dialog);
 state.apply({action:'snapshot',request_id:assemblyId(903),expected_actor:assemblyActor,p:{board_id:assemblyBoard,version:state.context.version,id:assemblyId(904),notes:'Synthetic snapshot'}});state.mutations.length=0;dialog=await openWeeklyUpdate(page);await dialog.getByLabel('Progress this week').fill('A'.repeat(4900));await dialog.getByRole('button',{name:'Choose assembly snapshot'}).click();await dialog.getByRole('button',{name:'Add selected snapshot to progress'}).click();await expect(dialog.getByRole('alert')).toContainText('exceed 5,000 characters');await expect(dialog.getByLabel('Progress this week')).toHaveValue('A'.repeat(4900));expect(state.reviewMutations).toEqual([]);expect(state.mutations).toEqual([]);
});

test('synthetic assembly fixture matches the strict context and conservative readiness contract (node)',()=>{
 const context=assemblyUIFixture();expect(assertAssemblyContext(context,assemblyActor,assemblyBoard)).toBe(context);expect(context.facts).toEqual({parts_total:2,parts_done:1,components_total:2,components_available:1,tasks_total:2,tasks_done:1,tasks_blocked:1,checks_total:2,checks_passed:0,checks_failed:1,checks_blocked:0,checks_stale:1});expect(context.snapshots).toEqual([]);expect(new Set(context.tasks.map(t=>t.id)).size).toBe(context.tasks.length);
});

test('synthetic mutation fixture preserves check history, explicit task links and frozen snapshots (node)',async()=>{
 const fixturePage={route:async()=>{},addInitScript:async()=>{}} as unknown as Page,state=await setupAssemblyUI(fixturePage),tasks=structuredClone(state.context.tasks),checks=structuredClone(state.context.checks),links=structuredClone(state.context.linked_task_ids);
 state.apply({action:'check',request_id:assemblyId(920),expected_actor:assemblyActor,p:{board_id:assemblyBoard,version:4,id:assemblyId(921),title:'Synthetic function failure',kind:'function',outcome:'failed',procedure:'Rotate the roller.',expected:'Free rotation.',observed:'Binding.',evidence_url:'https://example.com/synthetic-evidence',revision_id:assemblyId(411),rework_task_id:assemblyId(301),supersedes_id:null}});
 expect(state.context.linked_task_ids).toEqual(links);expect(state.context.tasks).toEqual(tasks);for(const original of checks)expect(state.context.checks.find(c=>c.id===original.id)).toEqual(original);expect(assertAssemblyContext(state.context,assemblyActor,assemblyBoard)).toBe(state.context);
 state.apply({action:'snapshot',request_id:assemblyId(922),expected_actor:assemblyActor,p:{board_id:assemblyBoard,version:5,id:assemblyId(923),notes:'Frozen synthetic review evidence.'}});const frozen=structuredClone(state.context.snapshots[0]);expect(frozen.summary).toContain(frozen.id);state.apply({action:'component',request_id:assemblyId(924),expected_actor:assemblyActor,p:{board_id:assemblyBoard,version:6,id:assemblyId(501),name:'Timing belt',quantity:1,status:'received',notes:'Arrived.'}});expect(state.context.snapshots[0]).toEqual(frozen);expect(state.context.facts.components_available).toBe(2);expect(assertAssemblyContext(state.context,assemblyActor,assemblyBoard)).toBe(state.context);
});

test('an explicit unknown receipt is never reported as cancellation',async({page})=>{
 await setupAssemblyUI(page);await page.route('**/rpc/assembly_mutate',r=>{const p=r.request().postDataJSON();return r.fulfill({json:{request_id:p.request_id,status:'unknown',action:null,entity_id:null,version:null}});});await page.goto(assemblyRoute);const dialog=await openComponent(page,'Unknown receipt fixture');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('unconfirmed');await expect(workspace(page).getByText('The request was cancelled.',{exact:true})).toHaveCount(0);await expect(pending(page)).toBeVisible();
});

test('saving a canonical linked task refreshes assembly facts and does not create a task copy',async({page})=>{
 const state=await setupAssemblyUI(page);await page.route('**/rpc/planning_save',r=>{const body=r.request().postDataJSON();state.canonicalWrites.push(body);const task=state.context.tasks.find(t=>t.id===body.p.id)!;Object.assign(task,body.p,{version:task.version+1});return r.fulfill({json:task.id});});await page.goto(assemblyRoute);const target=workspace(page).locator('.assembly-task').filter({has:page.getByRole('button',{name:'Correct the support bracket fit',exact:true})});await target.getByRole('button',{name:'Correct the support bracket fit',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Status',{exact:true}).selectOption('done');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(target).toContainText('Done');await expect(workspace(page).locator('.assembly-metric').filter({hasText:'Assembly tasks done'})).toContainText('2/2');expect(state.context.tasks).toHaveLength(3);expect(state.canonicalWrites).toHaveLength(1);expect(state.mutations).toEqual([]);
});

test('same-project Assembly to table navigation closes a canonical task draft',async({page})=>{
 const state=await setupAssemblyUI(page);await page.goto(assemblyRoute);await workspace(page).getByRole('button',{name:'Mount the intake roller',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Title',{exact:true}).fill('Unsaved canonical draft');await page.evaluate(board=>location.hash=`planning/boards/${board}`,assemblyBoard);await expect(dialog).toHaveCount(0);await page.goBack();await expect(workspace(page)).toBeVisible();await workspace(page).getByRole('button',{name:'Mount the intake roller',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Mount the intake roller');expect(state.canonicalWrites).toEqual([]);
});

test('failed snapshot refresh clears previously loaded choices and prevents stale insertion',async({page})=>{
 const state=await setupReviewSnapshots(page),original=state.review.updates[0].progress;await page.goto('/#planning/reviews');const dialog=await openWeeklyUpdate(page);await dialog.getByRole('button',{name:'Choose assembly snapshot'}).click();await expect(dialog.getByLabel('Captured snapshot')).toBeVisible();await page.route('**/rpc/assembly_context',r=>r.fulfill({status:403,json:{code:'AS403',message:'Access revoked'}}));await dialog.getByRole('button',{name:'Refresh snapshots'}).click();await expect(dialog.getByRole('alert')).toContainText('access');await expect(dialog.getByLabel('Captured snapshot')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Add selected snapshot to progress'})).toHaveCount(0);await expect(dialog.getByLabel('Progress this week')).toHaveValue(original);expect(state.reviewMutations).toEqual([]);
});
