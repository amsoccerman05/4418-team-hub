import {session} from './hub-session';
import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`suite switcher keyboard and mobile layout ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await session(page);await page.goto('/');
 await page.locator('.suite-picker summary').click();const nav=page.getByRole('navigation',{name:'Team 4418 apps'});
 await expect(nav.getByRole('link')).toHaveCount(6);await expect(nav.getByRole('link',{name:'Planning',exact:true})).toHaveAttribute('href','https://team.frc4418.org/#planning');await expect(nav.getByRole('link',{name:'Competition Operations',exact:true})).toHaveAttribute('href','https://pit.frc4418.org/');await expect(nav.getByRole('link',{name:'Finance',exact:false})).toHaveAttribute('href',/https:\/\/finance.frc4418.org\/?$/);
 expect((await nav.boundingBox())!.height).toBeLessThan(400);
 await page.screenshot({path:`test-results/suite-menu-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(nav).toBeHidden();await expect(page.locator('.suite-picker summary')).toBeFocused();
});

for(const width of [390,1440])test(`Attendance identifies the current app and Planning has a direct Home route ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await session(page);await page.route('**/rest/v1/rpc/planning_context',r=>r.fulfill({json:{user_id:'fixture',can_manage:false,season_id:null,seasons:[],members:[],areas:[],groups:[],items:[],boards:[],tasks:[]}}));await page.goto('/#attendance');
 await expect(page.locator('.suite-brand strong')).toHaveText('Attendance');await expect(page.locator('.suite-picker summary')).toContainText('Attendance');
 await page.goto('/#planning');if(width===390)await page.getByRole('button',{name:'Planning menu'}).click();
 await page.getByRole('navigation',{name:'Planning workspace'}).getByRole('link',{name:'Team Hub / Home',exact:true}).click();
 await expect(page.locator('.suite-brand strong')).toHaveText('Team Hub');expect(new URL(page.url()).hash).toBe('');
});
