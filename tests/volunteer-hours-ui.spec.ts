import { test, expect, type Page, type Route } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const uid = "00000000-0000-0000-0000-000000000001",
  sid = "00000000-0000-0000-0000-000000000020",
  mid = "00000000-0000-0000-0000-000000000030";
async function setup(
  page: Page,
  role = "mentor",
  seed = false,
  reportReader = false,
) {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select '${uid}'::uuid$$;grant usage on schema auth to authenticated;create table public.profiles(id uuid primary key,display_name text,role text,active boolean);insert into profiles values('${uid}','Synthetic Mentor','${role}',true);create table public.planning_seasons(id uuid primary key,name text,start_date date,end_date date,status text,created_at timestamptz default now());insert into public.planning_seasons values('${sid}','2026–27','2026-06-01','2027-05-31','active',now());create table public.team_meetings(id uuid primary key,title text);insert into public.team_meetings values('${mid}','Synthetic build meeting');`,
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261007155231_mentor_volunteer_hours.sql",
      "utf8",
    ),
  );
  if (reportReader)
    await db.exec(
      `insert into volunteer_private.report_readers(user_id,granted_by,reason) values('${uid}','${uid}','Synthetic report-reader grant')`,
    );
  await db.exec("set role authenticated");
  if (seed)
    await db.query(`select team_volunteer_save('manual',$1::jsonb)`, [
      JSON.stringify({
        request_id: crypto.randomUUID(),
        activity: "setup_cleanup",
        time_zone: "UTC",
        started_at: "2026-10-05T16:00:00Z",
        ended_at: "2026-10-05T17:00:00Z",
        notes: "Set up tools",
        season_id: sid,
      }),
    ]);
  const user = {
    id: uid,
    email: "mentor@volunteer.invalid",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  };
  await page.addInitScript(
    ({ user }) =>
      localStorage.setItem(
        "4418-team-hub-auth",
        JSON.stringify({
          access_token: "synthetic-token",
          refresh_token: "synthetic-refresh",
          expires_at: 4000000000,
          token_type: "bearer",
          user,
        }),
      ),
    { user },
  );
  const calls: any[] = [];
  let dropNext = false;
  await page.route(
    "https://attendance-test.supabase.invalid/**",
    async (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname,
        body = route.request().postDataJSON();
      let result: any = [];
      try {
        if (path === "/auth/v1/user") result = user;
        else if (path.endsWith("/profiles"))
          result = {
            id: uid,
            display_name: "Synthetic Mentor",
            role,
            active: true,
          };
        else if (path.endsWith("/team_attendance_policy_context"))
          result = {
            user_id: uid,
            can_review: role === "mentor",
            can_read_team: ["mentor", "admin", "lead"].includes(role),
            can_manage_meetings: ["mentor", "admin", "lead"].includes(role),
            strike_year_start: null,
            people: [],
            warnings: [],
          };
        else if (path.endsWith("/notification_center"))
          result = { unread: 0, attention: [], items: [], has_more: false };
        else if (path.endsWith("/planning_my_work_context"))
          result = {
            user_id: uid,
            season_id: null,
            seasons: [],
            boards: [],
            tasks: [],
          };
        else if (path.endsWith("/team_dashboard_context"))
          result = {
            name: "Synthetic Mentor",
            role,
            admin: role === "admin",
            personal: { percent: null, strikes: 0, pending: 0 },
            next_meeting: null,
            orders: [],
            finance: { allowed: false, approvals: 0, school: 0 },
            attention: null,
            robot: null,
            inventory: null,
            announcements: [],
          };
        else if (path.endsWith("/team_meetings"))
          result = [
            {
              id: mid,
              title: "Synthetic build meeting",
              meeting_type: "preseason",
              starts_at: "2026-10-10T18:00:00Z",
              ends_at: "2026-10-10T20:00:00Z",
              status: "scheduled",
              late_minutes: 5,
              requirement: "active",
              check_in_open: false,
              code_expires_at: null,
              version: 1,
            },
          ];
        else if (path.endsWith("/team_volunteer_entries"))
          result = (
            await db.query(
              "select * from team_volunteer_entries order by started_at desc,id",
            )
          ).rows;
        else if (path.endsWith("/team_volunteer_context"))
          result = (await db.query<any>("select team_volunteer_context() r"))
            .rows[0].r;
        else if (path.endsWith("/team_volunteer_summary"))
          result = (
            await db.query<any>("select team_volunteer_summary($1) r", [
              body.selected_season,
            ])
          ).rows[0].r;
        else if (path.endsWith("/team_volunteer_history"))
          result = (
            await db.query<any>("select team_volunteer_history($1,$2) r", [
              body.entry,
              body.before_id,
            ])
          ).rows[0].r;
        else if (path.endsWith("/team_volunteer_save")) {
          calls.push(body);
          result = (
            await db.query<any>("select team_volunteer_save($1,$2::jsonb) r", [
              body.action,
              JSON.stringify(body.p),
            ])
          ).rows[0].r;
          if (dropNext) {
            dropNext = false;
            await route.abort("failed");
            return;
          }
        }
        await route.fulfill({ json: result });
      } catch (e) {
        await route.fulfill({
          status: 400,
          json: { code: "P0001", message: (e as Error).message },
        });
      }
    },
  );
  return {
    db,
    calls,
    dropResponse: () => {
      dropNext = true;
    },
  };
}
for (const width of [390, 1440])
  test(`mentor actual timers, manual hours, correction, audit, CSV and navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { db, calls } = await setup(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto("/#attendance/volunteer-hours");
      await expect(
        page.getByRole("heading", { name: "Volunteer hours", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Team totals", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("combobox", { name: "Activity", exact: true })
        .first()
        .selectOption("setup_cleanup");
      await page
        .getByRole("button", { name: "Clock in for volunteering" })
        .click();
      await expect(
        page.getByText("Volunteer clock-in recorded", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Clock out from volunteering" }),
      ).toBeVisible();
      expect(calls[0].p.meeting_id).toBeNull();
      expect(calls[0].p).not.toHaveProperty("started_at");
      await page
        .getByRole("button", { name: "Clock out from volunteering" })
        .click();
      await expect(
        page.getByText("Volunteer clock-out recorded", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Add past hours", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Actual start", { exact: true })
        .fill("2026-10-05T16:00");
      await dialog
        .getByLabel("Actual end", { exact: true })
        .fill("2026-10-05T19:00");
      await dialog
        .getByRole("combobox", { name: "Activity", exact: true })
        .selectOption("outreach");
      await dialog
        .getByRole("combobox", { name: "Season (optional)", exact: true })
        .selectOption(sid);
      await dialog
        .getByLabel("Notes (optional)", { exact: true })
        .fill("Community workshop");
      await dialog
        .getByRole("button", { name: "Save past hours", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText("Community workshop", { exact: true }),
      ).toBeVisible();
      const entry = page
        .locator(".volunteer-entries article")
        .filter({ hasText: "Community workshop" });
      await entry
        .getByRole("button", { name: "Correct hours", exact: true })
        .click();
      await dialog
        .getByLabel("Actual end", { exact: true })
        .fill("2026-10-05T20:00");
      await dialog
        .getByLabel("Correction reason", { exact: true })
        .fill("Stayed to pack up");
      await page.screenshot({
        path: `test-results/volunteer-hours-editor-${width}.png`,
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Save correction", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(entry.getByText("4 h", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `test-results/volunteer-hours-completed-${width}.png`,
        fullPage: true,
      });
      await entry.getByRole("button", { name: "History", exact: true }).click();
      await expect(
        dialog.getByText("Stayed to pack up", { exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Close dialog" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export my hours CSV" }).click();
      expect((await download).suggestedFilename()).toBe(
        "my-volunteer-hours.csv",
      );
      await entry
        .getByRole("button", { name: "Void entry", exact: true })
        .click();
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill("Accidental duplicate");
      await dialog
        .getByRole("button", { name: "Void entry", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText("Community workshop", { exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("Show voided entries").check();
      await expect(
        page.getByText("Community workshop", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Add past hours", exact: true })
        .click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("link", { name: "Calendar", exact: true }).click();
      await page.goBack();
      await expect(
        page.getByRole("heading", { name: "Volunteer hours", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `test-results/volunteer-hours-${width}.png`,
        fullPage: true,
      });
    } finally {
      await db.close();
    }
  });
test("admin totals and CSV contain aggregates, with no team edit controls", async ({
  page,
}) => {
  const { db } = await setup(page, "admin", true);
  try {
    await page.goto("/#attendance/volunteer-hours");
    await page
      .getByRole("button", { name: "Team totals", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Team volunteer totals" }),
    ).toContainText("1 h");
    await expect(
      page
        .getByRole("region", { name: "Team volunteer totals" })
        .getByRole("button", { name: "Correct hours" }),
    ).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export team totals CSV" }).click();
    expect((await download).suggestedFilename()).toBe(
      "team-volunteer-totals.csv",
    );
    await page.screenshot({
      path: "test-results/volunteer-hours-admin-totals.png",
      fullPage: true,
    });
  } finally {
    await db.close();
  }
});
test("lost save response retries same request without duplicate hours", async ({
  page,
}) => {
  const { db, calls, dropResponse } = await setup(page);
  try {
    await page.goto("/#attendance/volunteer-hours");
    await expect(
      page.getByRole("button", { name: "Clock in for volunteering" }),
    ).toBeVisible();
    dropResponse();
    await page
      .getByRole("button", { name: "Clock in for volunteering" })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry same request" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry same request" }).click();
    await expect(
      page.getByRole("button", { name: "Clock out from volunteering" }),
    ).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(
      (await db.query("select * from team_volunteer_entries")).rows,
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});
test("student and lead never see volunteer-hours tab", async ({ page }) => {
  for (const role of ["student", "lead"]) {
    const { db } = await setup(page, role);
    try {
      await page.goto("/#attendance/volunteer-hours");
      await expect(
        page.getByRole("navigation", { name: "Attendance views" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Volunteer hours", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Volunteer hours", exact: true }),
      ).toHaveCount(0);
    } finally {
      await page.unrouteAll();
      await db.close();
    }
  }
});

test("manual lost response keeps a usable dialog with safe retry and no duplicate", async ({
  page,
}) => {
  const { db, calls, dropResponse } = await setup(page);
  try {
    await page.goto("/#attendance/volunteer-hours");
    await page
      .getByRole("button", { name: "Add past hours", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Actual start", { exact: true })
      .fill("2026-10-04T16:00");
    await dialog
      .getByLabel("Actual end", { exact: true })
      .fill("2026-10-04T18:00");
    dropResponse();
    await dialog
      .getByRole("button", { name: "Save past hours", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Retry same request", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Close dialog" }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Retry same request", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(
      (await db.query("select * from team_volunteer_entries")).rows,
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test("explicitly approved mentor sees aggregate totals without becoming admin", async ({
  page,
}) => {
  const { db } = await setup(page, "mentor", true, true);
  try {
    await page.goto("/#attendance/volunteer-hours");
    await page
      .getByRole("button", { name: "Team totals", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Team volunteer totals" }),
    ).toContainText("1 h");
    await db.exec("reset role");
    expect((await db.query("select role from profiles")).rows[0].role).toBe(
      "mentor",
    );
    await page.screenshot({
      path: "test-results/volunteer-hours-approved-reader.png",
      fullPage: true,
    });
  } finally {
    await db.close();
  }
});
