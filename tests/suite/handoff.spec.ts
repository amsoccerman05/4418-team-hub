import {test,expect,type BrowserContext} from "@playwright/test";
import {setup,fixtureUser as user} from "./handoff-fixture";

async function login(page:any){
 await page.goto('https://team.frc4418.org/');
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByLabel('Password',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'My 4418',exact:true})).toBeVisible();
}
async function isolate(context:BrowserContext){
 await context.addInitScript(()=>{
  let resolved=false;
  (window as any).__privateFlash=false;
  (window as any).__credentialLeak=false;
  window.addEventListener('message',e=>{
   if(e.origin!=='https://team.frc4418.org'||e.data?.protocol!=='4418-suite-auth-v1')return;
   const session=e.data.session||e.data.result?.data?.session;
   if(session){resolved=true;if(session.refresh_token||session.provider_token||session.provider_refresh_token)(window as any).__credentialLeak=true;}
  });
  new MutationObserver(()=>{if(!resolved&&document.querySelector('.suite-header'))(window as any).__privateFlash=true;}).observe(document,{subtree:true,childList:true});

  // Reproduce the physical-device observation without changing Hub's first-party storage.
  if(location.pathname==='/suite-auth.html'&&document.referrer&&!document.referrer.startsWith('https://team.frc4418.org/')){
   const store=new Map<string,string>();Object.defineProperty(window,'localStorage',{value:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,String(v)),removeItem:(k:string)=>store.delete(k)}});
  }
 });
}
for(const width of [390,1440])for(const logout of ['hub','pit'])test(`first-party navigation and ${logout} logout ${width}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});const audit=await setup(context);await isolate(context);
 const page=await context.newPage();await login(page);
 const pages:any[]=[];
 for(const label of ['Competition Operations','Inventory','Finance']){
  await page.bringToFront();
  const opened=context.waitForEvent('page');
  if(width===390)await page.getByRole('button',{name:'Hub menu'}).click();
  const link=page.locator('.hub-nav').getByRole('link',{name:label,exact:true});
  if(width===390)await link.tap();else await link.click();
  const destination=await opened;pages.push(destination);await destination.bringToFront();
  await expect(destination.locator('.suite-header')).toBeVisible();
  expect(new URL(destination.url()).hostname).not.toBe('team.frc4418.org');
  expect(await destination.evaluate(()=>document.querySelectorAll('iframe').length)).toBe(0);
  expect(await destination.evaluate(()=>[(window as any).__privateFlash,(window as any).__credentialLeak])).toEqual([false,false]);
  // Reload retains the opener transport and does not depend on destination storage.
  await destination.reload();await expect(destination.locator('.suite-header')).toBeVisible();
  expect(await destination.evaluate(()=>Object.keys(localStorage).filter(k=>/auth|token/i.test(k)))).toEqual([]);
  if(label==='Inventory'){await expect(destination.getByRole('button',{name:'Add item',exact:true})).toBeEnabled();await expect(destination.getByRole('button',{name:'Admin',exact:true})).toHaveCount(0);await expect(destination.getByRole('button',{name:'Add location',exact:true})).toHaveCount(0);}
  if(label==='Finance')await expect(destination.getByRole('button',{name:'New purchase order',exact:true})).toBeEnabled();
  expect(await destination.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await destination.screenshot({path:`test-results/exact-student-${label.toLowerCase().replaceAll(' ','-')}-${width}-${logout}.png`,fullPage:true,animations:'disabled'});
 }
 await page.bringToFront();await audit.verify();
 await expect(page.locator('.hub-nav').getByRole('link',{name:'Team Management',exact:true})).toHaveCount(0);
 await page.screenshot({path:`test-results/exact-student-hub-${width}-${logout}.png`,fullPage:true,animations:'disabled'});
 await page.goto('https://team.frc4418.org/');
 // Reloading Hub discards its opened-window registry. The PO uses this fresh
 // owner; the existing Pit tab reconnects through its browser-maintained opener.
 const opened=context.waitForEvent('page');await page.getByRole('link',{name:'PO #99 · Navigation test',exact:true}).click();
 const po=await opened;await expect(po.getByRole('dialog')).toBeVisible();expect(po.url()).toMatch(/#po\/00000000-0000-4000-8000-000000000099$/);
 // Existing children must remain usable and receive logout even if Hub reloads.
 await pages[0].reload();await expect(pages[0].locator('.suite-header')).toBeVisible();
 await audit.verify(true);
 await (logout==='hub'?page:pages[0]).getByRole('button',{name:'Sign out',exact:true}).click();
 const signedOutTabs=[
  [page,'https://team.frc4418.org','Team sign in'],
  [pages[0],'https://pit.frc4418.org','Competition Operations sign in'],
  [pages[1],'https://inventory.frc4418.org','Inventory sign in'],
  [pages[2],'https://finance.frc4418.org','Finance sign in'],
  [po,'https://finance.frc4418.org','Finance sign in'],
 ] as const;
 const assertSignedOut=async(tab:any,origin:string,title:string)=>{
  expect(new URL(tab.url()).origin).toBe(origin);
  await expect(tab.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(tab.locator('.suite-header')).toHaveCount(0);
  await expect(tab.getByRole('dialog')).toHaveCount(0);
 };
 // Released apps clear private state in place; they do not redirect to Hub.
 for(const [tab,origin,title] of signedOutTabs)await assertSignedOut(tab,origin,title);
 const protectedReads=()=>audit.calls.filter(call=>call.path.startsWith('/rest/v1/')).length;
 const afterLogout=protectedReads();
 // A fresh app bootstrap (including the old PO hash) cannot resurrect the
 // shared session or issue protected reads. Do not pretend logout revokes JWTs.
 for(const [tab,origin,title] of signedOutTabs){await tab.reload();await assertSignedOut(tab,origin,title);}
 expect(protectedReads(),'Signed-out reloads must not fetch protected data using the previous session').toBe(afterLogout);
 await audit.verify();await context.close();
});
test('genuinely signed-out destinations show no private UI and link to Hub login',async({browser})=>{
 const context=await browser.newContext({serviceWorkers:'block'});const audit=await setup(context);await isolate(context);
 for(const [host,title] of [['pit','Competition Operations sign in'],['inventory','Inventory sign in'],['finance','Finance sign in']]){
  const page=await context.newPage();await page.goto(`https://${host}.frc4418.org/`);
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.locator('.suite-header')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__privateFlash)).toBe(false);
  const hub=page.locator('a[href="https://team.frc4418.org/"]');await expect(hub).toHaveCount(1);await hub.click();
  await expect(page).toHaveURL('https://team.frc4418.org/');await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await audit.verify();await page.close();
 }
 await audit.verify();await context.close();
});

test('broker rejects untrusted origins and unrelated frame sources',async({browser})=>{
 const context=await browser.newContext({serviceWorkers:'block'});const audit=await setup(context);const page=await context.newPage();await login(page);
 await context.route('https://untrusted.frc4418.org/',r=>r.fulfill({contentType:'text/html',body:'<p>Untrusted test origin</p>'}));
 const opened=context.waitForEvent('page');await page.evaluate(()=>window.open('https://untrusted.frc4418.org/','_blank'));
 const untrusted=await opened;await untrusted.waitForLoadState();
 expect(await untrusted.evaluate(async()=>{let received=false;window.addEventListener('message',e=>{if(e.data?.id==='untrusted-check')received=true;});window.opener.postMessage({protocol:'4418-suite-auth-v1',id:'untrusted-check',method:'getSession',args:[]},'https://team.frc4418.org');await new Promise(r=>setTimeout(r,400));return received;})).toBe(false);
 // An allowlisted origin in an unrelated iframe is not a Hub-opened app window.
 await context.route('https://inventory.frc4418.org/source-check',r=>r.fulfill({contentType:'text/html',body:'<p>Unrelated frame</p>'}));
 await page.evaluate(()=>{const f=document.createElement('iframe');f.src='https://inventory.frc4418.org/source-check';document.body.append(f);});
 await expect(page.frameLocator('iframe[src$="source-check"]').getByText('Unrelated frame')).toBeVisible();
 const frame=page.frames().find(f=>f.url().endsWith('/source-check'))!;
 expect(await frame.evaluate(async()=>{let received=false;window.addEventListener('message',e=>{if(e.data?.id==='source-check')received=true;});parent.postMessage({protocol:'4418-suite-auth-v1',id:'source-check',method:'getSession',args:[]},'https://team.frc4418.org');await new Promise(r=>setTimeout(r,400));return received;})).toBe(false);
 await audit.verify();await context.close();
});
