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
      else if (u.pathname === "/auth/v1/user") result = user;
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
          role: "student",
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
    if (repo) {
      const root = resolve("..", repo, "dist");
      const file = resolve(
        root,
        "." + (u.pathname === "/" ? "/index.html" : u.pathname),
      );
      if (!file.startsWith(root + "/")) return route.abort();
      try {
        const bytes = await readFile(file);
        return route.fulfill({
          status: 200,
          body: bytes,
          contentType:
            (
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".png": "image/png",
              } as Record<string, string>
            )[extname(file)] ?? "application/octet-stream",
        });
      } catch {
        return route.fulfill({ status: 404, body: "Not found" });
      }
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

for(const width of [390,1440]) for(const origin of ['team','inventory','pit','finance'])
test(`canonical login and ${origin} logout across all apps ${width}`,async({context,page})=>{
 await page.setViewportSize({width,height:900});const calls=await setup(context);const errors:string[]=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`https://${origin}.frc4418.org/`);
 await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await expect(page).toHaveURL('https://team.frc4418.org/');
 await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'My 4418',exact:true})).toBeVisible();
 const pages:Record<string,typeof page>={team:page};
 for(const host of ['inventory','pit','finance']){const p=await context.newPage();pages[host]=p;await p.setViewportSize({width,height:900});await p.goto(`https://${host}.frc4418.org/`);await expect(p.locator('.suite-header')).toBeVisible();await expect(p.locator('.suite-signout')).toBeVisible();expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.screenshot({path:`test-results/suite-${host}-${width}.png`});}
 expect(calls.filter(c=>c.path.includes('grant_type=password'))).toHaveLength(1);
 await pages[origin].getByRole('button',{name:'Sign out',exact:true}).click();
 for(const p of Object.values(pages)){await expect(p.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();await expect(p).toHaveURL('https://team.frc4418.org/');await expect(p.locator('.suite-header')).toHaveCount(0);}
 expect(errors).toEqual([]);
});

test("untrusted sibling cannot retrieve the Hub session", async ({
  context,
  page,
}) => {
  await setup(context);
  await page.goto("https://untrusted.frc4418.org/");
  await page.frames()[1].waitForLoadState();
  const leaked = await page.evaluate(async () => {
    let replied = false;
    window.addEventListener("message", () => {
      replied = true;
    });
    document
      .querySelector("iframe")!
      .contentWindow!.postMessage(
        {
          protocol: "4418-suite-auth-v1",
          id: "attack",
          method: "getSession",
          args: [],
        },
        "https://team.frc4418.org",
      );
    await new Promise((r) => setTimeout(r, 400));
    return replied;
  });
  expect(leaked).toBe(false);
});
