import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const id='10000000-0000-4000-8000-000000000001';
const uid='00000000-0000-0000-0000-000000000001';
const target=`https://inventory.frc4418.org/#location/${id}`;
const token=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})).toString('base64url')}.fixture-signature`;
const user={id:uid,email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};

for(const width of [390,1440])test(`authenticated scan confirmation uses the existing first-party opener and clears its routing hint ${width}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width,height:844}});
 let mutations=0;
 await context.routeWebSocket('**',ws=>ws.close());
 await context.route('https://**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.supabase.invalid')||url.hostname.endsWith('.supabase.co')){
   const path=url.pathname;
   let result:unknown=[];
   if(path==='/auth/v1/token')result={access_token:token(),refresh_token:'fixture-refresh-token',expires_in:3600,token_type:'bearer',user};
   else if(path==='/auth/v1/user')result=user;
   else if(path==='/rest/v1/profiles')result={...user,display_name:'Fixture',active:true,role:'student'};
   else if(path.endsWith('/team_dashboard_context'))result={name:'Fixture Student',role:'student',admin:false,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]};
   else if(path.includes('/rpc/'))result={unread:0,attention:[],items:[],has_more:false};
   if(path.startsWith('/rest/v1/')&&route.request().method()!=='GET'&&!path.includes('/rpc/'))mutations++;
   return route.fulfill({json:result});
  }
  if(url.hostname==='team.frc4418.org'){
   const file=resolve(process.cwd(),'dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
   return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream'});
  }
  if(url.hostname==='inventory.frc4418.org')return route.fulfill({contentType:'text/html',body:`<h1>Inventory location fixture</h1><p id="status">Waiting for broker</p><script>
   window.addEventListener('message',event=>{
    if(event.origin!=='https://team.frc4418.org'||event.source!==window.opener||event.data?.id!=='scan-return')return;
    const session=event.data.result?.data?.session;
    document.getElementById('status').textContent=session?.access_token&&!session.refresh_token&&!session.provider_token?'Authenticated through existing broker':'Invalid session';
   });
   window.opener?.postMessage({protocol:'4418-suite-auth-v1',id:'scan-return',method:'getSession',args:[]},'https://team.frc4418.org');
   </script>`});
  return route.abort();
 });
 const hub=await context.newPage();
 await hub.goto(`https://team.frc4418.org/?inventory_location=${id}`);
 await expect(hub.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();
 await expect(hub.getByRole('link',{name:'Continue to scanned inventory location'})).toHaveCount(0);
 await hub.reload();
 await hub.getByLabel('Email',{exact:true}).fill(user.email);
 await hub.getByLabel('Password',{exact:true}).fill('fixture-password');
 await hub.getByRole('button',{name:'Sign in',exact:true}).click();
 const link=hub.getByRole('link',{name:'Continue to scanned inventory location',exact:true});
 await expect(link).toHaveAttribute('href',target);
 expect(context.pages()).toHaveLength(1);
 await hub.reload();
 await expect(link).toHaveAttribute('href',target);
 await hub.screenshot({path:`test-results/inventory-return-${width}.png`,fullPage:true});
 const opened=context.waitForEvent('page');
 await link.click();
 const inventory=await opened;
 await expect(inventory).toHaveURL(target);
 await expect(inventory.getByText('Authenticated through existing broker',{exact:true})).toBeVisible();
 expect(new URL(hub.url()).search).toBe('');
 expect(await inventory.evaluate(()=>Object.keys(localStorage).filter(k=>/auth|token/i.test(k)))).toEqual([]);
 expect(mutations).toBe(0);
 await context.close();
});
