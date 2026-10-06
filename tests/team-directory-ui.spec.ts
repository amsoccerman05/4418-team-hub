import {test,expect} from '@playwright/test';
import {onboardingFixture,openOnboarding,prepareBatch} from './fixtures/onboarding';

function addDirectoryFixture(data:any){
 data.members.push(
  {id:'active-teammate',email:'alex@example.test',display_name:'Alex Rivera',role:'student',active:true,primary_area_id:'area',updated_at:'2026-10-05T12:00:00Z',member_status:'registered',team_area:'Build'},
  {id:'inactive-teammate',email:'jordan@example.test',display_name:'Jordan Lee',role:'student',active:false,primary_area_id:null,updated_at:'2026-10-05T12:00:00Z',member_status:'inactive',team_area:null},
 );
 data.invitations.push(
  {id:'active',email:'alex@example.test',display_name:'Alex Rivera',status:'account_active',created_at:'2026-10-01',user_id:'active-teammate'},
  {id:'duplicate-review',email:'alex@example.test',display_name:'Alex Rivera',status:'review',review_reason:'identity_unmatched',created_at:'2026-10-02',user_id:null},
  ...['pending','processing','accepted','unrecognized'].map((status,index)=>({id:status,email:`invite${index}@example.test`,display_name:['Morgan Chen','Taylor Brooks','Casey Patel','Riley Santos'][index],status,created_at:'2026-10-05',user_id:null})),
 );
}

for(const width of [390,768,1440])test(`invitations are separate from the roster with open queue and retained history ${width}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:1000});const {data,sent}=await onboardingFixture(page);addDirectoryFixture(data);
 await page.goto('/#team-management');await expect(page.locator('.team-member-grid .team-member')).toHaveCount(3);
 await expect(page.getByText('alex@example.test',{exact:true})).toHaveCount(1);
 await expect(page.getByText('invite0@example.test',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'View invitations 5 open',exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/invite-cleanup/members-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'View invitations 5 open',exact:true}).click();const ui=page.getByRole('region',{name:'Team onboarding',exact:true});
 await expect(ui.getByRole('button',{name:'In progress 5',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(ui.locator('.onboarding-status-row')).toHaveCount(5);
 await expect(ui.getByText('Account active',{exact:true})).toHaveCount(0);
 await expect(ui.getByText('Sign-in recorded',{exact:true})).toBeVisible();
 await expect(ui.locator('.onboarding-status-row').filter({hasText:'alex@example.test'})).toContainText('Needs review');
 await expect(ui.getByLabel('Names and emails',{exact:true})).toBeHidden();
 await page.screenshot({path:`test-results/invite-cleanup/invitations-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await ui.getByLabel('Account setup status').selectOption('review');await expect(ui.locator('.onboarding-status-row')).toHaveCount(2);
 await ui.getByLabel('Find an invitation').fill('alex@');await expect(ui.locator('.onboarding-status-row')).toHaveCount(1);
 await ui.getByRole('button',{name:'Account history 1',exact:true}).click();await expect(ui.locator('.onboarding-status-row')).toHaveCount(1);
 await expect(ui.getByText('Account active',{exact:true})).toBeVisible();await expect(ui.getByText('Needs review',{exact:true})).toHaveCount(0);
 await expect(ui.getByText('Password setup is not tracked here.',{exact:false})).toBeVisible();
 await ui.getByText('Attendance registration',{exact:true}).click();await expect(ui).toContainText('Attendance: Registered');
 await page.screenshot({path:`test-results/invite-cleanup/history-${width}.png`,fullPage:true});
 await ui.getByRole('button',{name:'Manage Alex Rivera'}).click();await expect(page.getByRole('dialog',{name:'Member editor'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'View invitations 5 open',exact:true}).click();await expect(ui.getByRole('button',{name:'In progress 5',exact:true})).toHaveAttribute('aria-pressed','true');await expect(ui.getByLabel('Find an invitation')).toHaveValue('');await expect(ui.locator('.onboarding-status-row')).toHaveCount(5);
 expect(sent).toEqual([]);expect(errors).toEqual([]);
});

test('all-active history leaves an explicit empty queue and refresh can return a record for review',async({page})=>{
 const {data,sent}=await onboardingFixture(page);data.invitations.push({id:'history',email:'history@example.test',display_name:'Active teammate',status:'account_active',created_at:'2026-10-01',user_id:null});
 const ui=await openOnboarding(page);await expect(ui.getByRole('heading',{name:'No invitations in progress'})).toBeVisible();await expect(ui.getByRole('button',{name:'Account history 1'})).toBeVisible();
 await ui.getByRole('button',{name:'Account history 1'}).click();await expect(ui.locator('.onboarding-status-row')).toHaveCount(1);
 await ui.getByLabel('Find an invitation').fill('absent');await expect(ui.getByText('No invitations match this view.')).toBeVisible();await ui.getByRole('button',{name:'Clear invitation filters'}).click();await expect(ui.locator('.onboarding-status-row')).toHaveCount(1);
 data.invitations[0].status='review';await ui.getByRole('button',{name:'Refresh status',exact:true}).click();await expect(ui.getByRole('button',{name:'In progress 1'})).toBeVisible();await ui.getByRole('button',{name:'In progress 1'}).click();await expect(ui.getByText('Needs review',{exact:true})).toBeVisible();expect(sent).toEqual([]);
});

test('collapsing the group invitation composer preserves the reviewed draft without sending',async({page})=>{
 const {sent}=await onboardingFixture(page);const ui=await prepareBatch(page);
 await ui.getByText('Invite a group',{exact:true}).click();await expect(ui.getByRole('checkbox')).toBeHidden();await expect(ui.locator('.onboarding-compose')).not.toHaveAttribute('open');
 await ui.getByText('Invite a group',{exact:true}).click();await expect(ui.locator('.onboarding-review-values')).toHaveCount(2);await expect(ui.getByRole('checkbox')).not.toBeChecked();await expect(ui.getByRole('button',{name:'Send 2 reviewed invitations'})).toBeDisabled();expect(sent).toEqual([]);
});


test('collapsing a running batch pauses before the next invitation can start',async({page})=>{
 const {sent,control}=await onboardingFixture(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 control.send=async(payload,route)=>{await gate;await route.fulfill({status:202,json:{id:payload.id,status:'pending'}});};
 const ui=await prepareBatch(page);await ui.getByRole('checkbox').check();await ui.getByRole('button',{name:'Send 2 reviewed invitations'}).click();
 await expect.poll(()=>sent.length).toBe(1);await ui.getByText('Invite a group',{exact:true}).click();
 await expect(ui.locator('.onboarding-compose')).not.toHaveAttribute('open');await expect(ui).toContainText('Pausing after the current request');
 release();await expect(ui).toContainText('Paused. The current request has settled');expect(sent).toHaveLength(1);
 await ui.getByText('Invite a group',{exact:true}).click();await expect(ui.locator('.is-accepted')).toHaveCount(1);await expect(ui.locator('.is-ready')).toHaveCount(1);await expect(ui.getByRole('checkbox')).not.toBeChecked();expect(sent).toHaveLength(1);
});
