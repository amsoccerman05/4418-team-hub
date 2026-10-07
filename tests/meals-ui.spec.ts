import {test,expect,type Page} from '@playwright/test';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import type {ClaimReceipt,PrivateClaim,PublicMeal} from '../src/meals/types';

function meal(id='meal-one',offset=0):PublicMeal {
  return {id,title:offset ? 'Saturday build lunch' : 'Saturday team lunch',service_at:offset ? '2026-10-17T18:30:00Z' : '2026-10-10T18:30:00Z',timezone:'America/Denver',expected_headcount:36,guidance:'Please label ingredients and bring serving utensils. Ask the coordinator privately about dietary questions.',status:'open',whole_meal:'available',version:1,slots:[
    {id:`${id}-main`,category:'main',label:'Main dish portions',unit:'portions',needed:36,confirmed:0,held:0,remaining:36},
    {id:`${id}-side`,category:'side',label:'Side dish portions',unit:'portions',needed:36,confirmed:0,held:0,remaining:36},
    {id:`${id}-drink`,category:'drink',label:'Drinks',unit:'drinks',needed:36,confirmed:0,held:0,remaining:36},
    {id:`${id}-supply`,category:'supply',label:'Plates and napkins',unit:'sets',needed:36,confirmed:0,held:0,remaining:36},
  ]};
}
function privateClaim():PrivateClaim { return {id:'synthetic-claim',meal:meal(),slot_id:'meal-one-main',whole_meal:false,quantity:12,name:'Synthetic Adult',status:'confirmed',version:3,access_expires_at:'2026-10-11T19:00:00Z'}; }
type Body={operation:string;token?:string;quantity?:number;version?:number;[key:string]:unknown};
async function setup(page:Page){
  const state={meals:[meal(),meal('meal-two',1)],claim:privateClaim(),calls:[] as Body[],external:[] as string[],urls:[] as string[],mailStatus:'queued' as ClaimReceipt['email_status'],listFailures:0,claimFailures:0,claimFailureCode:'uncertain_result',editFailures:0,editFailureCode:'version_conflict',inspectFailures:0,inspectFailureCode:'version_conflict',cancelFailures:0,cancelFailureCode:'uncertain_result',delayClaim:null as Promise<void>|null,delayVerify:null as Promise<void>|null};
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();state.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');});
  await page.route(/\/src\/meals\/service\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:`
    async function call(operation,fields={}){const r=await fetch('/__meals_fixture',{method:'POST',headers:{'Content-Type':'application/json'},referrerPolicy:'no-referrer',body:JSON.stringify({operation,...fields})});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error?.message || 'Synthetic failure'),{code:data.error?.code,status:r.status});return data;}
    export const mealApi={list:()=>call('list'),claim:input=>call('claim',input),verify:token=>call('verify',{token}),inspect:token=>call('inspect',{token}),edit:(token,input)=>call('edit',{token,...input}),cancel:(token,input)=>call('cancel',{token,...input}),manager:()=>call('manager'),saveMeal:()=>call('save_meal'),cancelClaim:()=>call('cancel_claim')};
  `}));
  page.on('request',request=>state.urls.push(request.url()));
  await page.route('**/__meals_fixture',async route=>{
    const input=route.request().postDataJSON() as Body;state.calls.push(input);
    const fail=(code='version_conflict')=>route.fulfill({status:code==='invalid_link'?403:409,json:{error:{code,message:'Synthetic request could not be completed.'}}});
    if(input.operation==='list'){if(state.listFailures-->0)return fail();return route.fulfill({json:state.meals});}
    if(input.operation==='claim'){if(state.delayClaim)await state.delayClaim;if(state.claimFailures-->0)return fail(state.claimFailureCode);return route.fulfill({json:{status:'pending_verification',message:'Synthetic receipt',email_status:state.mailStatus,hold_expires_at:'2026-10-10T18:15:00Z'}});}
    if(input.operation==='verify'){if(state.delayVerify)await state.delayVerify;return route.fulfill({json:{access_token:'synthetic-access-token',claim:state.claim}});}
    if(input.operation==='inspect'){if(state.inspectFailures-->0)return fail(state.inspectFailureCode);return route.fulfill({json:state.claim});}
    if(input.operation==='edit'){if(state.editFailures-->0)return fail(state.editFailureCode);state.claim={...state.claim,quantity:input.quantity!,version:state.claim.version+1};return route.fulfill({json:state.claim});}
    if(input.operation==='cancel'){if(state.cancelFailures-->0)return fail(state.cancelFailureCode);state.claim={...state.claim,status:'cancelled',version:state.claim.version+1};return route.fulfill({json:state.claim});}
    return route.fulfill({status:403,json:{error:{code:'not_allowed'}}});
  });
  return state;
}
async function openClaim(page:Page){await page.getByRole('button',{name:'Sign up for Main dish portions',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();return dialog;}
async function fillClaim(page:Page){const dialog=await openClaim(page);await dialog.getByLabel('Your name').fill('Synthetic Adult');await dialog.getByLabel('Email address',{exact:true}).fill('synthetic-parent@example.invalid');await dialog.getByLabel('Quantity').fill('12');return dialog;}

// These static checks run without a browser, so blocked browser QA is not a hidden pass.
test('static public meal card renders coverage, local date and approved guidance without contact data',async()=>{
  const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
  try {
    const {MealCard}=await server.ssrLoadModule('/src/meals/PublicMeals.tsx');
    const input={...meal(),whole_meal:'coordination_required',name:'Never render this private parent',email:'private@example.invalid',students:['Never render this student']};
    input.slots[0]={...input.slots[0],confirmed:12,held:6,remaining:18};
    const html=renderToStaticMarkup(createElement(MealCard,{meal:input,onChoose:()=>{}}));
    for(const text of ['Saturday, October 10, 2026','12:30 PM MDT','America/Denver','36 people','Main dishes','Sides','Drinks','Supplies','Meal coordinator’s guidance','12 / 36 portions confirmed','6 awaiting verification','18 portions still needed','Please coordinate with the meal coordinator'])expect(html).toContain(text);
    expect(html).not.toMatch(/private@example.invalid|Never render|I can bring it all/);
  }finally{await server.close();}
});
test('static whole meal is claimable only while open and available',async()=>{
  const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
  try{
    const {MealCard}=await server.ssrLoadModule('/src/meals/PublicMeals.tsx');
    const render=(input:PublicMeal)=>renderToStaticMarkup(createElement(MealCard,{meal:input,onChoose:()=>{}}));
    expect(render(meal())).toContain('I can bring it all');
    for(const state of ['held','confirmed','coordination_required'] as const)expect(render({...meal(),whole_meal:state})).not.toContain('I can bring it all');
    for(const state of ['closed','cancelled'] as const)expect(render({...meal(),status:state})).not.toContain('I can bring it all');
  }finally{await server.close();}
});
test('static public shell stays separate from auth and public event pages',async()=>{
  const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
  try{
    const {PublicMeals}=await server.ssrLoadModule('/src/meals/PublicMeals.tsx');
    const html=renderToStaticMarkup(createElement(PublicMeals,{draft:true}));
    expect(html).toContain('Good food.');expect(html).toContain('Local review draft');expect(html).toContain('No real signups or emails');expect(html).not.toMatch(/Sign in|KCMT|student@example/);
    const entry=readFileSync('src/meals/meal-public.tsx','utf8');expect(entry).not.toMatch(/HubAuth|attendance\/service|style\.css/);expect(entry).toContain("VITE_MEALS_DEMO === 'true'");
    const doc=readFileSync('meals.html','utf8');expect(doc).toContain('name="referrer" content="no-referrer"');expect(doc).toContain('noindex, nofollow');
    const source=readFileSync('src/meals/PublicMeals.tsx','utf8');expect(source).not.toMatch(/localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/);
  }finally{await server.close();}
});

for(const width of [320,390,768,1440])test(`public meals and claim dialog remain accessible at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950});const state=await setup(page);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/meals.html');
  await expect(page.getByRole('heading',{name:'A place at the table'})).toBeVisible();await expect(page.locator('.meal-card')).toHaveCount(2);await expect(page.locator('.meal-card').first()).toContainText('12:30 PM MDT');
  await page.getByRole('link',{name:'Skip to meal dates'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#meal-content')).toBeFocused();expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#meal-content').evaluate(element=>(element as HTMLElement).blur());await page.mouse.click(4,150);await page.screenshot({path:`test-results/meals/public-${width}.png`,fullPage:true});
  const dialog=await openClaim(page);await expect(dialog.getByLabel('Your name')).toBeFocused();expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:`test-results/meals/claim-${width}.png`});
  await dialog.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign up for Main dish portions'}).first()).toBeFocused();expect(state.calls.filter(call=>call.operation!=='list')).toEqual([]);expect(state.external).toEqual([]);expect(errors).toEqual([]);
});
test('claim is submitted once and a receipt does not confirm the contribution',async({page})=>{
  const state=await setup(page);await page.goto('/meals.html');const dialog=await fillClaim(page);await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});
  await expect(dialog.getByRole('heading',{name:'Next, verify your email'})).toBeVisible();await expect(dialog).toContainText('Not yet confirmed');await expect(dialog).toContainText('verification email is queued');await expect(dialog).not.toContainText('Your contribution is confirmed.');
  const sent=state.calls.filter(call=>call.operation==='claim');expect(sent).toHaveLength(1);expect(sent[0]).toMatchObject({meal_id:'meal-one',slot_id:'meal-one-main',whole_meal:false,quantity:12,name:'Synthetic Adult',email:'synthetic-parent@example.invalid'});expect(sent[0].idempotency_key).toEqual(expect.any(String));
  await dialog.getByRole('button',{name:'Back to meal dates'}).click();await expect(page.locator('main')).not.toContainText('Synthetic Adult');expect(state.external).toEqual([]);
});
for(const status of ['sent','unavailable','uncertain'] as const)test(`email status ${status} never falsely reports confirmation or delivery`,async({page})=>{
  const state=await setup(page);state.mailStatus=status;await page.goto('/meals.html');const dialog=await fillClaim(page);await dialog.getByRole('button',{name:'Email my verification link'}).click();
  await expect(dialog).toContainText('Not yet confirmed');await expect(dialog).not.toContainText('Your contribution is confirmed.');
  if(status==='sent')await expect(dialog).toContainText('This does not guarantee delivery');
  if(status==='unavailable')await expect(dialog.getByRole('heading',{name:'Email verification is unavailable'})).toBeVisible();
  if(status==='uncertain')await expect(dialog.getByRole('heading',{name:'Email delivery is not yet known'})).toBeVisible();
});
test('failed submission preserves entered details and reuses its idempotency key',async({page})=>{
  const state=await setup(page);state.claimFailures=1;await page.goto('/meals.html');const dialog=await fillClaim(page);await dialog.getByRole('button',{name:'Email my verification link'}).click();await expect(dialog.getByRole('alert')).toContainText('Your details are still here');await expect(dialog.getByLabel('Your name')).toHaveValue('Synthetic Adult');await expect(dialog.getByLabel('Email address',{exact:true})).toHaveValue('synthetic-parent@example.invalid');await expect(dialog.getByLabel('Quantity')).toHaveValue('12');await expect(dialog.getByRole('alert')).toBeFocused();await expect(dialog.getByLabel('Your name')).toBeDisabled();await dialog.getByRole('button',{name:'Retry same request'}).click();await expect(dialog.getByRole('heading',{name:'Next, verify your email'})).toBeVisible();const calls=state.calls.filter(call=>call.operation==='claim');expect(calls).toHaveLength(2);expect(calls[0].idempotency_key).toBe(calls[1].idempotency_key);
});
test('whole-meal request has no slot and means one complete meal',async({page})=>{
  const state=await setup(page);await page.goto('/meals.html');await page.getByRole('button',{name:'I can bring it all'}).first().click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('36 people');await expect(dialog.getByLabel('Quantity')).toHaveCount(0);await dialog.getByLabel('Your name').fill('Synthetic Adult');await dialog.getByLabel('Email address',{exact:true}).fill('whole-meal@example.invalid');await dialog.getByRole('button',{name:'Email my verification link'}).click();await expect(dialog.getByRole('heading',{name:'Next, verify your email'})).toBeVisible();expect(state.calls.find(call=>call.operation==='claim')).toMatchObject({whole_meal:true,slot_id:null,quantity:1});
});
test('coverage changes are visible and do not invent a whole-meal opening',async({page})=>{
  const state=await setup(page);state.meals[0].whole_meal='coordination_required';state.meals[0].slots[0]={...state.meals[0].slots[0],confirmed:24,held:12,remaining:0};await page.goto('/meals.html');const card=page.locator('.meal-card').first();await expect(card).toContainText('Please coordinate with the meal coordinator');await expect(card.getByRole('button',{name:'I can bring it all'})).toHaveCount(0);await expect(card.getByRole('button',{name:'Sign up for Main dish portions'})).toBeDisabled();await expect(card).toContainText('12 awaiting verification');
});
test('closing during a pending request fences a late receipt',async({page})=>{
  const state=await setup(page);let release!:()=>void;state.delayClaim=new Promise<void>(resolve=>release=resolve);await page.goto('/meals.html');let dialog=await fillClaim(page);await dialog.getByRole('button',{name:'Email my verification link'}).click();await expect.poll(()=>state.calls.filter(call=>call.operation==='claim').length).toBe(1);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();dialog=await openClaim(page);release();await expect(dialog.getByLabel('Your name')).toHaveValue('');await expect(dialog.getByRole('heading',{name:'Next, verify your email'})).toHaveCount(0);await expect(dialog.getByLabel('Your name')).toBeFocused();
});
test('private verify link is removed before a deliberate verification and never persisted',async({page})=>{
  const state=await setup(page);await page.goto('/meals.html#verify=synthetic-verification-token');await expect(page.getByRole('heading',{name:'One last step: confirm your help.'})).toBeVisible();expect(new URL(page.url()).hash).toBe('');expect(state.calls.filter(call=>call.operation==='verify')).toHaveLength(0);await page.getByRole('button',{name:'Confirm my contribution'}).click();await expect(page.getByRole('heading',{name:'Thanks for feeding the team.'})).toBeVisible();expect(state.calls.filter(call=>call.operation==='verify')).toHaveLength(1);expect(state.urls.some(url=>/synthetic-verification-token|synthetic-access-token/.test(url))).toBe(false);const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));expect(storage).not.toMatch(/synthetic-verification-token|synthetic-access-token/);await page.reload();await expect(page.getByRole('heading',{name:'A place at the table'})).toBeVisible();await expect(page.getByRole('heading',{name:'Thanks for feeding the team.'})).toHaveCount(0);
});
test('manage edits, error recovery, keyboard dismissal and cancellation are versioned',async({page})=>{
  const state=await setup(page);await page.goto('/meals.html#manage=synthetic-private-token');await expect(page.getByRole('heading',{name:'Thanks for feeding the team.'})).toBeVisible();expect(new URL(page.url()).hash).toBe('');await page.getByRole('button',{name:'Change quantity'}).click();await expect(page.getByLabel('New quantity')).toBeFocused();await page.getByLabel('New quantity').fill('8');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Change quantity'})).toBeFocused();
  state.editFailures=1;await page.getByRole('button',{name:'Change quantity'}).click();await page.getByLabel('New quantity').fill('8');await page.getByRole('button',{name:'Save quantity'}).click();await expect(page.getByRole('alert')).toContainText('Your input is still here');await expect(page.getByLabel('New quantity')).toHaveValue('8');await expect(page.getByRole('button',{name:'Save quantity'})).toBeDisabled();await page.locator('.meal-private-edit').evaluate(form=>(form as HTMLFormElement).requestSubmit());expect(state.calls.filter(call=>call.operation==='edit')).toHaveLength(1);state.claim.version=4;await page.getByRole('button',{name:'Reload latest status'}).click();await expect(page.getByRole('status')).toContainText('Latest status loaded');await expect(page.getByLabel('New quantity')).toHaveValue('8');await page.getByRole('button',{name:'Save quantity'}).click();await expect(page.getByRole('status')).toContainText('updated');expect(state.calls.filter(call=>call.operation==='edit').map(call=>call.version)).toEqual([3,4]);
  await page.getByRole('button',{name:'Cancel contribution',exact:true}).click();await expect(page.getByRole('heading',{name:'Cancel this contribution?'})).toBeFocused();await page.getByRole('button',{name:'Keep my contribution'}).click();await expect(page.getByRole('button',{name:'Cancel contribution',exact:true})).toBeFocused();expect(state.calls.filter(call=>call.operation==='cancel')).toHaveLength(0);await page.getByRole('button',{name:'Cancel contribution',exact:true}).click();await page.getByRole('button',{name:'Yes, cancel my contribution'}).click();await expect(page.getByRole('heading',{name:'Contribution cancelled',exact:true})).toBeVisible();expect(state.calls.find(call=>call.operation==='cancel')).toMatchObject({token:'synthetic-private-token',version:5});
});
test('navigation away from verification ignores a late result',async({page})=>{
  const state=await setup(page);let release!:()=>void;state.delayVerify=new Promise<void>(resolve=>release=resolve);await page.goto('/meals.html#verify=synthetic-old-token');await page.getByRole('button',{name:'Confirm my contribution'}).click();await expect.poll(()=>state.calls.filter(call=>call.operation==='verify').length).toBe(1);await page.getByRole('button',{name:'Back to meal dates'}).click();await expect(page.getByRole('heading',{name:'A place at the table'})).toBeVisible();release();await expect(page.getByRole('heading',{name:'Thanks for feeding the team.'})).toHaveCount(0);expect(new URL(page.url()).hash).toBe('');
});
test('private link opening error has recovery without exposing token or claiming confirmation',async({page})=>{
  const state=await setup(page);state.inspectFailures=2;await page.goto('/meals.html#manage=synthetic-invalid-token');await expect(page.getByRole('alert')).toContainText('private link couldn’t be opened');await expect(page.getByRole('heading',{name:'Thanks for feeding the team.'})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('synthetic-invalid-token');expect(new URL(page.url()).hash).toBe('');await page.getByRole('button',{name:'Back to meal dates'}).click();await expect(page.getByRole('heading',{name:'A place at the table'})).toBeVisible();
});

test('a definite capacity rejection keeps the form when its slot disappears',async({page})=>{
  const state=await setup(page);state.claimFailures=1;state.claimFailureCode='capacity_changed';await page.goto('/meals.html');const dialog=await fillClaim(page);state.meals[0].slots=state.meals[0].slots.filter(slot=>slot.id!=='meal-one-main');await dialog.getByRole('button',{name:'Email my verification link'}).click();await expect(dialog.getByRole('alert')).toContainText('Your details are still here');await expect(dialog).toContainText('no longer available');await expect(dialog.getByLabel('Your name')).toHaveValue('Synthetic Adult');await expect(dialog.getByLabel('Email address',{exact:true})).toHaveValue('synthetic-parent@example.invalid');await expect(dialog.getByRole('button',{name:'Email my verification link'})).toBeDisabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:'A place at the table'})).toBeFocused();
});
test('Back and Forward do not restore a scrubbed private token or a stale private screen',async({page})=>{
  await setup(page);await page.goto('/meals.html');await expect(page.locator('.meal-card')).toHaveCount(2);await page.evaluate(()=>{window.location.hash='verify=synthetic-navigation-token';});await expect(page.getByRole('heading',{name:'One last step: confirm your help.'})).toBeVisible();expect(new URL(page.url()).hash).toBe('');await page.goBack();await expect(page.getByRole('heading',{name:'A place at the table'})).toBeVisible();await page.goForward();await expect(page.getByRole('heading',{name:'A place at the table'})).toBeVisible();expect(new URL(page.url()).hash).toBe('');
});

test('static private error policy clears forbidden capabilities and locks all other failed writes',async()=>{
  const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
  try{const {privateFailurePolicy}=await server.ssrLoadModule('/src/meals/PublicMeals.tsx');for(const error of [{status:403},{code:'invalid_link'},{status:403,code:'unknown'}])expect(privateFailurePolicy(error)).toBe('clear_access');for(const error of [{code:'version_conflict',status:409},{code:'uncertain_result',status:0},new Error('Connection lost'),null])expect(privateFailurePolicy(error)).toBe('inspect_before_write');}finally{await server.close();}
});
test('a revoked link during edit clears private details and all mutation controls',async({page})=>{
  const state=await setup(page);await page.goto('/meals.html#manage=synthetic-revoked-token');await page.getByRole('button',{name:'Change quantity'}).click();await page.getByLabel('New quantity').fill('8');state.editFailures=1;state.editFailureCode='invalid_link';await page.getByRole('button',{name:'Save quantity'}).click();await expect(page.getByRole('heading',{name:'Private link unavailable'})).toBeVisible();await expect(page.locator('.meal-private-summary')).toHaveCount(0);await expect(page.getByLabel('New quantity')).toHaveCount(0);for(const name of ['Save quantity','Cancel contribution','Reload latest status','Try opening again'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('synthetic-revoked-token');expect(state.calls.filter(call=>call.operation==='edit')).toHaveLength(1);
});
test('unknown cancellation locks retries and a forbidden inspect never claims success',async({page})=>{
  const state=await setup(page);await page.goto('/meals.html#manage=synthetic-cancel-token');await page.getByRole('button',{name:'Cancel contribution',exact:true}).click();state.cancelFailures=1;await page.getByRole('button',{name:'Yes, cancel my contribution'}).click();await expect(page.getByRole('button',{name:'Yes, cancel my contribution'})).toBeDisabled();await expect(page.getByRole('heading',{name:'Check your contribution status'})).toBeVisible();state.inspectFailures=1;state.inspectFailureCode='invalid_link';await page.getByRole('button',{name:'Reload latest status'}).click();await expect(page.getByRole('heading',{name:'Private link unavailable'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('cancellation outcome is not confirmed');await expect(page.locator('.meal-private-summary')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Contribution cancelled',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Cancel contribution',exact:true})).toHaveCount(0);expect(state.calls.filter(call=>call.operation==='cancel')).toHaveLength(1);
});
test('closed meal permits cancellation but prevents quantity edits',async({page})=>{
  const state=await setup(page);state.claim.meal.status='closed';await page.goto('/meals.html#manage=synthetic-closed-token');await expect(page.getByRole('button',{name:'Change quantity'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Cancel contribution',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Cancel contribution',exact:true}).click();await page.getByRole('button',{name:'Yes, cancel my contribution'}).click();await expect(page.getByRole('heading',{name:'Contribution cancelled',exact:true})).toBeVisible();expect(state.calls.filter(call=>call.operation==='cancel')).toHaveLength(1);
});
