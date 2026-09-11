import { test, expect, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const roots: Record<string, string> = {
  "team.frc4418.org": "4418-team-hub",
  "inventory.frc4418.org": "amsoccerman05.github.io",
  "pit.frc4418.org": "4418-pit-app",
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
for (const width of [390, 1440])
  test(`one login journey, shared logout and branding ${width}`, async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await setup(context);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://team.frc4418.org/");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Welcome, Suite Student")).toBeVisible();
    for (const [dest, title] of [
      ["https://inventory.frc4418.org/", "4418 Inventory"],
      ["https://team.frc4418.org/", "4418 Team Hub"],
      ["https://pit.frc4418.org/", "4418 Pit Operations"],
      ["https://team.frc4418.org/", "4418 Team Hub"],
    ]) {
      await page.getByLabel("Team 4418 apps").selectOption(dest);
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toHaveCount(0);
      if (dest.includes("team."))
        await expect(page.getByText("Welcome, Suite Student")).toBeVisible();
      else await expect(page.locator(".topbar")).toBeVisible();
      await expect(page).toHaveTitle(title);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page.locator('link[rel="icon"]').getAttribute("href"),
      ).toContain("4418-suite-icon.svg");
      if (!dest.includes("team."))
        expect(
          await page.evaluate(() =>
            Object.keys(localStorage).filter(
              (k) => k.includes("auth-token") || k === "4418-team-hub-auth",
            ),
          ),
        ).toEqual([]);
      await page.screenshot({
        path: `test-results/suite-${new URL(dest).hostname}-${width}.png`,
        fullPage: true,
      });
    }
    expect(
      calls.filter((c) => c.path.includes("grant_type=password")),
    ).toHaveLength(1);
    const inventory = await context.newPage();
    await inventory.goto("https://inventory.frc4418.org/");
    await expect(inventory.locator(".topbar")).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Team sign-in" }),
    ).toBeVisible();
    await expect(
      inventory.getByRole("button", { name: "Sign In", exact: true }),
    ).toBeVisible();
    await page.goto("https://pit.frc4418.org/");
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
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
test("Inventory password reset stays on the supported PKCE flow", async ({
  context,
  page,
}) => {
  const calls = await setup(context);
  await page.goto("https://inventory.frc4418.org/");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByText(
      "If an account exists, a password reset email is on its way.",
    ),
  ).toBeVisible();
  expect(
    calls.find((c) => c.path.startsWith("/auth/v1/recover"))?.body
      .code_challenge,
  ).toBeTruthy();
  await page.goto(
    "https://inventory.frc4418.org/?password-reset=1&code=fixture-code",
  );
  await expect(
    page.getByRole("heading", { name: "Set your password" }),
  ).toBeVisible();
  expect(page.url()).not.toContain("code=");
  await page
    .getByLabel("New password", { exact: true })
    .fill("new-fixture-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("new-fixture-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
});

for (const host of ["inventory", "pit"])
  test(`signing in at ${host} restores Hub without another login`, async ({
    context,
    page,
  }) => {
    const calls = await setup(context);
    await page.goto(`https://${host}.frc4418.org/`);
    await page
      .getByLabel(host === "pit" ? "Team account email" : "Email", {
        exact: true,
      })
      .fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: /^Sign in$/i }).click();
    await expect(page.locator(".topbar")).toBeVisible();
    await page
      .getByLabel("Team 4418 apps")
      .selectOption("https://team.frc4418.org/");
    await expect(page.getByText("Welcome, Suite Student")).toBeVisible();
    expect(
      calls.filter((c) => c.path.includes("grant_type=password")),
    ).toHaveLength(1);
  });
