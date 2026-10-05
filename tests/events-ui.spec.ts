import {test,expect,type Page} from '@playwright/test';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync,existsSync} from 'node:fs';
import {session} from './hub-session';
const uid='00000000-0000-0000-0000-000000000001';
async function setup(page:Page){
 await session(page);const calls:string[]=[];page.on('request',r=>{if(r.url().includes('/rest/v1/'))calls.push(r.url());});
 await page.route('**/rest/v1/rpc/notification_center',r=>r.fulfill({json:{unread:0,attention:[],items:[],has_more:false}}));return calls;
}
test('family guide includes optional Friday and all parent-information sections without task operations',async()=>{
 const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
 try{
  const {EventOverview}=await server.ssrLoadModule('/src/events/EventOverview.tsx');
  const html=renderToStaticMarkup(createElement(EventOverview,{route:'#events/kcmt-2026'}));
  for(const copy of ['Coronado High School','1590 W Fillmore St','Arrival &amp; pickup','Meals &amp; dietary needs','Spectators &amp; what to bring','Volunteering &amp; questions','Ask Aiden privately about dietary arrangements','Optional for Team 4418','4:00–6:00 pm','5:00 pm','6:00–8:00 pm','8:30 pm','All times Mountain Time','Organizer’s tentative schedule'])expect(html).toContain(copy);
  expect(html.match(/Optional for Team 4418/g)).toHaveLength(1);
  expect(html).not.toMatch(/Event prep tasks|Link board|Planning season|<form|<input|<select|<iframe/);
  expect(html).toContain('https://pit.frc4418.org');
  const source=readFileSync('src/events/EventOverview.tsx','utf8');expect(source).not.toMatch(/loadPlanning|savePlanning|planning-link|planning\/service|supabase|event-prep/);expect(existsSync('src/events/planning-link.ts')).toBe(false);
 }finally{await server.close();}
});
test('parent preview and unknown event render without operational links or invented logistics',async()=>{
 const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
 try{
  const {EventOverview}=await server.ssrLoadModule('/src/events/EventOverview.tsx');
  const preview=renderToStaticMarkup(createElement(EventOverview,{route:'#events/kcmt-2026/preview'}));
  expect(preview).toContain('Parent page preview');expect(preview.match(/href="tel:[^"]+"/g)).toEqual(['href="tel:+17205253196"']);expect(preview).toContain('Team details awaiting confirmation');expect(preview).toContain('Optional for Team 4418');expect(preview).not.toMatch(/pit\.frc4418|planning|kanban|mailto:|<form|<input|<select/i);
  const unknown=renderToStaticMarkup(createElement(EventOverview,{route:'#events/unknown'}));expect(unknown).toContain('Event not found');expect(unknown).not.toContain('Coronado');
 }finally{await server.close();}
});
for(const width of [390,768,1440])test(`family overview and parent preview navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const calls=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#events/kcmt-2026');await expect(page.getByRole('heading',{name:'Event overview',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Skip to content'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#main')).toBeFocused();expect(page.url()).toContain('#events/kcmt-2026');
 await expect(page.getByText('Optional for Team 4418',{exact:true})).toBeVisible();
 for(const name of ['Arrival & pickup','Meals & dietary needs','Spectators & what to bring','Volunteering & questions'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(page.locator('.event-overview').getByRole('link',{name:'Competition Operations'})).toHaveAttribute('href','https://pit.frc4418.org');
 await expect(page.locator('.event-overview')).not.toContainText(/prep tasks|kanban|planning board|inventory|strike|attendance|purchase order/i);
 expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/event-overview-${width}.png`,fullPage:true});
 await page.getByRole('link',{name:'Preview parent page'}).click();await expect(page.getByText('Parent page preview')).toBeVisible();await expect(page.locator('.event-overview').getByRole('link',{name:'Competition Operations'})).toHaveCount(0);
 await page.screenshot({path:`test-results/parent-preview-${width}.png`,fullPage:true});await page.getByRole('link',{name:'Back to event overview'}).click();await expect(page.getByRole('heading',{name:'Event overview',exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByText('Parent page preview')).toBeVisible();await page.goForward();await expect(page.getByRole('heading',{name:'Event overview',exact:true})).toBeVisible();
 expect(calls.filter(url=>/planning|inventory|team_attendance/.test(url))).toEqual([]);expect(errors).toEqual([]);
});
test('sign-in interruption retains the event deep link without reading operational records',async({page})=>{
 const calls:string[]=[];await page.route('**/rest/v1/**',r=>{calls.push(r.request().url());return r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/profiles')?{display_name:'Fixture',role:'student',active:true}:{unread:0,attention:[],items:[],has_more:false}});});
 await page.route('**/auth/v1/token?grant_type=password',r=>r.fulfill({json:{access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,expires_in:3600,token_type:'bearer',user:{id:uid,aud:'authenticated',app_metadata:{},user_metadata:{}}}}));
 await page.goto('/#events/kcmt-2026');await expect(page.getByRole('heading',{name:'Team sign in'})).toBeVisible();expect(page.url()).toContain('#events/kcmt-2026');expect(calls).toEqual([]);
 await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-only-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Event overview',exact:true})).toBeVisible();expect(page.url()).toContain('#events/kcmt-2026');expect(calls.filter(url=>/planning|inventory|team_attendance/.test(url))).toEqual([]);
});
test('unknown internal event does not expose a fallback event',async({page})=>{
 const calls=await setup(page);await page.goto('/#events/not-an-event');await expect(page.getByRole('heading',{name:'Event not found'})).toBeVisible();expect(calls.filter(url=>/planning|inventory|team_attendance/.test(url))).toEqual([]);await expect(page.getByRole('heading',{name:'KCMT 2026'})).toHaveCount(0);
});
