import { test, expect, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const roots: Record<string, string> = {
  "team.frc4418.org": "4418-team-hub",
  "inventory.frc4418.org": "amsoccerman05.github.io",
  "pit.frc4418.org": "4418-pit-app",
  "finance.frc4418.org": "4418-finance",
};
const uid = "00000000-0000-0000-0000-000000000001";
const user = {
  id: uid,
  email: "suite-test@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const token = () =>
  `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), aud: "authenticated" })).toString("base64url")}.fixture-signature`;
async function setup(context: BrowserContext) {
  const calls: { path: string; body: any }[] = [];
  await context.routeWebSocket("**", (ws) => ws.close());
  await context.route("https://**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.endsWith(".supabase.co")) {
      let result: any = [];
      const body = route.request().postDataJSON();
      calls.push({ path: u.pathname + u.search, body });
      if (u.pathname === "/auth/v1/token")
        result = {
          access_token: token(),
          refresh_token: "fixture-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          user,
        };
      else if(u.pathname.endsWith('/finance_purchase_orders')) result=[{id:'00000000-0000-0000-0000-000000000099',requester_id:uid,po_number:99,vendor:'Navigation test',amount:10,status:'awaiting_approval',revision:1,version:1,area_id:'area',purpose:'Navigation check',sheet_url:'https://docs.google.com/spreadsheets/d/test/edit',created_at:new Date().toISOString(),school_reference:''}];
 else if(u.pathname.endsWith('/team_management_context_v2'))result={members:[],areas:[],positions:[],assignments:[],history:[]};
 else if (u.pathname === "/auth/v1/user") result = user;
      else if (u.pathname.endsWith('/team_dashboard_context')) result={name:'Suite Student',role:'mentor',admin:true,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[{id:'00000000-0000-0000-0000-000000000099',po_number:99,vendor:'Navigation test',amount:10,status:'awaiting_approval',approvals:0}],finance:{allowed:true,approvals:1,school:0},attention:null,robot:null,inventory:null,announcements:[]};
      else if (u.pathname.endsWith('/finance_context')) result={profile:{id:uid,display_name:'Suite Student',role:'student'},can_create:true,is_admin:false,capabilities:[],areas:[],people:[]};
      else if (
        u.pathname === "/auth/v1/logout" ||
        u.pathname === "/auth/v1/recover"
      )
        result = {};
      else if (u.pathname === "/rest/v1/profiles") {
        const p = {
          id: uid,
          display_name: "Suite Student",
          email: user.email,
          role: "mentor",
          active: true,
        };
        result = route.request().headers().accept?.includes("object") ? p : [p];
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    }
    const repo = roots[u.hostname];
    if(repo){
      if(process.env.HANDOFF_LIVE)return route.continue();
      const name=({'team.frc4418.org':'hub','inventory.frc4418.org':'inventory','pit.frc4418.org':'pit','finance.frc4418.org':'finance'} as Record<string,string>)[u.hostname];
      const file=resolve(process.env.HANDOFF_DIST_ROOT||'/tmp',`handoff-${name}/dist`,'.'+(u.pathname==='/'?'/index.html':u.pathname));
      return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream'});
    }
    if (u.hostname === "untrusted.frc4418.org")
      return route.fulfill({
        contentType: "text/html",
        body: '<iframe src="https://team.frc4418.org/suite-auth.html"></iframe>',
      });
    return route.abort();
  });
  return calls;
}





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
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});await setup(context);await isolate(context);
 const page=await context.newPage();await login(page);
 const pages:any[]=[];
 for(const label of ['Pit Operations','Inventory','Finance']){
  await page.bringToFront();
  const opened=context.waitForEvent('page');
  const link=page.locator('.my-quick').getByRole('link',{name:label,exact:true});
  if(width===390)await link.tap();else await link.click();
  const destination=await opened;pages.push(destination);await destination.bringToFront();
  await expect(destination.locator('.suite-header')).toBeVisible();
  expect(new URL(destination.url()).hostname).not.toBe('team.frc4418.org');
  expect(await destination.evaluate(()=>document.querySelectorAll('iframe').length)).toBe(0);
  expect(await destination.evaluate(()=>[(window as any).__privateFlash,(window as any).__credentialLeak])).toEqual([false,false]);
  // Reload retains the opener transport and does not depend on destination storage.
  await destination.reload();await expect(destination.locator('.suite-header')).toBeVisible();
  expect(await destination.evaluate(()=>Object.keys(localStorage).filter(k=>/auth|token/i.test(k)))).toEqual([]);
 }
 await page.bringToFront();
 await page.locator('.my-quick').getByRole('link',{name:'Attendance',exact:true}).click();
 await expect(page).toHaveURL(/#attendance/);await expect(page.locator('.suite-header')).toBeVisible();
 await page.goto('https://team.frc4418.org/');
 // Reloading Hub would discard its opened-window registry, so the PO check uses
 // this fresh owner, and the other tabs are reopened for the logout check below.
 const opened=context.waitForEvent('page');await page.getByRole('link',{name:'PO #99 · Navigation test',exact:true}).click();
 const po=await opened;await expect(po.getByRole('dialog')).toBeVisible();expect(po.url()).toMatch(/#po\/00000000-0000-0000-0000-000000000099$/);
 // Existing children must remain usable and receive logout even if Hub reloads.
 await pages[0].reload();await expect(pages[0].locator('.suite-header')).toBeVisible();
 await (logout==='hub'?page:pages[0]).getByRole('button',{name:'Sign out',exact:true}).click();
 for(const tab of [page,...pages,po]){await expect(tab).toHaveURL('https://team.frc4418.org/');await expect(tab.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await expect(tab.locator('.suite-header')).toHaveCount(0);}
 await context.close();
});
test('genuinely signed-out destinations return to Hub login',async({browser})=>{
 const context=await browser.newContext();await setup(context);await isolate(context);
 for(const host of ['pit','inventory','finance']){const page=await context.newPage();await page.goto(`https://${host}.frc4418.org/`);await expect(page).toHaveURL('https://team.frc4418.org/');await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await expect(page.locator('.suite-header')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__privateFlash)).toBe(false);await page.close();}
 await context.close();
});

test('broker rejects untrusted origins and unrelated frame sources',async({browser})=>{
 const context=await browser.newContext();await setup(context);const page=await context.newPage();await login(page);
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
 await context.close();
});
