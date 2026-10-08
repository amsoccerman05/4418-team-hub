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
test('empty event registry and retired overview/preview links render without event content or operations',async()=>{
 const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
 try{
  const {eventDrafts}=await server.ssrLoadModule('/src/events/event-config.ts');
  expect(eventDrafts).toEqual([]);
  const {EventOverview}=await server.ssrLoadModule('/src/events/EventOverview.tsx');
  for(const route of ['#events','#events/kcmt-2026','#events/kcmt-2026/preview','#events/unknown']){
   const html=renderToStaticMarkup(createElement(EventOverview,{route}));
   expect(html).toContain('Event not found');expect(html).toContain('Back to Team Hub');
   expect(html).not.toMatch(/KCMT|Coronado|720-525-3196|event\.html|tel:|View current event|<form|<input|<select|<iframe/);
  }
  const source=readFileSync('src/events/EventOverview.tsx','utf8');expect(source).not.toMatch(/loadPlanning|savePlanning|planning-link|planning\/service|supabase|event-prep/);expect(existsSync('src/events/planning-link.ts')).toBe(false);
 }finally{await server.close();}
});
for(const width of [390,768,1440])test(`retired guide links and Hub navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const calls=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#events/kcmt-2026');await expect(page.getByRole('heading',{name:'Event not found',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Skip to content'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#main')).toBeFocused();expect(page.url()).toContain('#events/kcmt-2026');
 await expect(page.locator('a[href^="#events"],a[href*="event.html"]')).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText(/KCMT|Coronado|720-525-3196/);
 expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/event-retired-${width}.png`,fullPage:true});
 await page.evaluate(()=>{location.hash='events/kcmt-2026/preview';});
 await expect(page.getByRole('heading',{name:'Event not found',exact:true})).toBeVisible();
 await expect(page.getByText('Parent page preview')).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'Event not found',exact:true})).toBeVisible();
 await page.goBack();expect(page.url()).toContain('#events/kcmt-2026');
 await page.goForward();expect(page.url()).toContain('/preview');
 await page.getByRole('link',{name:'Back to Team Hub'}).click();
 await expect(page.getByRole('heading',{name:'Event not found',exact:true})).toHaveCount(0);
 await expect(page.locator('a[href^="#events"],a[href*="event.html"]')).toHaveCount(0);
 expect(calls.filter(url=>/planning|inventory|team_attendance/.test(url)).filter(url=>!url.includes('rpc/my_4418'))).toEqual([]);expect(errors).toEqual([]);
});
test('sign-in interruption reaches a safe retired state without reading operational records',async({page})=>{
 const calls:string[]=[];await page.route('**/rest/v1/**',r=>{calls.push(r.request().url());return r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/profiles')?{display_name:'Fixture',role:'student',active:true}:{unread:0,attention:[],items:[],has_more:false}});});
 await page.route('**/auth/v1/token?grant_type=password',r=>r.fulfill({json:{access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,expires_in:3600,token_type:'bearer',user:{id:uid,aud:'authenticated',app_metadata:{},user_metadata:{}}}}));
 await page.goto('/#events/kcmt-2026');await expect(page.getByRole('heading',{name:'Team sign in'})).toBeVisible();expect(page.url()).toContain('#events/kcmt-2026');expect(calls).toEqual([]);
 await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-only-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Event not found',exact:true})).toBeVisible();expect(page.url()).toContain('#events/kcmt-2026');expect(calls.filter(url=>/planning|inventory|team_attendance/.test(url))).toEqual([]);
});
test('base and unknown internal event routes work with no default event',async({page})=>{
 const calls=await setup(page);
 for(const route of ['#events','#events/not-an-event']){
  await page.goto('/'+route);await expect(page.getByRole('heading',{name:'Event not found'})).toBeVisible();await expect(page.getByRole('link',{name:'Back to Team Hub'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'KCMT 2026'})).toHaveCount(0);
 }
 expect(calls.filter(url=>/planning|inventory|team_attendance/.test(url))).toEqual([]);
});
