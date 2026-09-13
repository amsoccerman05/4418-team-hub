import { test, expect, type Page } from "@playwright/test";
import { summary, strikeAction, type Data } from "../src/attendance/service";
const student = "00000000-0000-0000-0000-000000000001";
const lead = "00000000-0000-0000-0000-000000000003";
function fixture(): Data {
  return {
    meetings: [
      {
        id: "m1",
        title: "Preseason build",
        meeting_type: "preseason",
        starts_at: "2026-09-10T17:00:00Z",
        ends_at: "2026-09-10T19:00:00Z",
        late_minutes: 10,
        requirement: "registered",
        status: "open",
        check_in_open: true,
        code_expires_at: "2026-09-10T18:00:00Z",
        version: 1,
      },
    ],
    attendance: [
      {
        id: "a1",
        meeting_id: "m1",
        student_id: student,
        physical_status: "pending",
        review_status: "none",
        checked_in_at: null,
        left_at: null,
        notice_at: null,
        notice_reason: "",
        review_reason: "",
        reviewed_at: null,
        reviewed_by: null,
        version: 1,
      },
    ],
    snapshots: [
      {
        meeting_id: "m1",
        student_id: student,
        required: true,
        member_status: "registered",
        team_area: "Build",
      },
    ],
    strikes: [],
    history: [],
    members: [
      {
        student_id: student,
        display_name: "Alex Student",
        member_status: "registered",
        team_area: "Build",
      },
    ],
  };
}
async function mock(page: Page, role = "student") {
  await page.clock.setFixedTime(new Date("2026-09-10T17:10:00Z"));
  const data = fixture(),
    calls: any[] = [];
  const user = {
    id: role === "student" ? student : lead,
    email: `${role}@test.invalid`,
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
          access_token: "test-token",
          refresh_token: "test-refresh",
          expires_at: 4000000000,
          token_type: "bearer",
          user,
        }),
      ),
    { user },
  );
  await page.route(
    "https://attendance-test.supabase.invalid/**",
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().postDataJSON();
      let result: unknown = [];
      if (path.endsWith("/profiles"))
        result = {
          id: user.id,
          display_name: role === "student" ? "Alex Student" : "Lee Lead",
          role,
          active: true,
        };
      else if (path.endsWith("/team_dashboard_context")) result = {name:'Team member',role,admin:false,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]};
      else if (path.endsWith("/team_meetings")) result = data.meetings;
      else if (path.endsWith("/team_attendance")) result = data.attendance;
      else if (path.endsWith("/team_meeting_members")) result = data.snapshots;
      else if (path.endsWith("/team_attendance_strikes")) result = data.strikes;
      else if (path.endsWith("/team_attendance_history")) result = data.history;
      else if (path.endsWith("/team_attendance_roster")) result = data.members;
      else if (path.endsWith("/team_attendance_check_in")) {
        calls.push(body);
        if (body.code !== "123456") result = { error: "Invalid meeting code" };
        else {
          data.attendance[0].physical_status = "present";
          data.attendance[0].checked_in_at = "2026-09-10T17:03:00Z";
          result = { message: "Checked in" };
        }
      } else if (path.endsWith("/team_attendance_request")) {
        calls.push(body);
        data.attendance[0].notice_at = "2026-09-09T15:00:00Z";
        data.attendance[0].notice_reason = body.p.reason;
        data.attendance[0].notice_type = body.p.notice_type;
        data.attendance[0].expected_at = body.p.expected_at;
        data.attendance[0].review_status = "pending";
        result = null;
      } else if (path.endsWith("/team_attendance_create_batch")) {
        calls.push(body);
        result = body.meetings.map((_: unknown, i: number) => ({
          id: `batch-${i}`,
        }));
      } else if (path.endsWith("/team_attendance_manage")) {
        calls.push(body);
        result = {};
        if (body.action === "open")
          result = { code: "123456", expires_at: "2026-09-10T18:00:00Z" };
        if (body.action === "close" || body.action === "finalize") {
          data.meetings[0].status =
            body.action === "close" ? "closed" : "finalized";
          data.meetings[0].check_in_open = false;
          data.meetings[0].version++;
        }
        if (body.action === "attendance") {
          Object.assign(data.attendance[0], body.p, {
            version: 2,
            review_reason: body.p.explanation,
          });
        }
        if (body.action === "strike") {
          data.strikes.push({
            id: "s1",
            attendance_id: "a1",
            meeting_id: "m1",
            student_id: student,
            category: body.p.category,
            quantity: body.p.quantity,
            explanation: body.p.explanation,
            assigned_by: lead,
            assigned_at: "2026-09-10T18:00:00Z",
            rescinded_at: null,
            rescind_reason: null,
          });
        }
      } else if (path.endsWith("/logout")) result = {};
      else throw new Error(`Unexpected request: ${path}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    },
  );
  await page.goto("/");
  return { data, calls };
}
for (const width of [390, 1440]) {
  test(`student self check-in, notice, and layout ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page);
    await page.locator('.system-card[href="#attendance"]').click();
    await expect(
      page.getByRole("button", { name: "Manage attendance" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Preseason build/ }).click();
    await page.getByLabel("6-digit meeting code").fill("000000");
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Invalid meeting code",
    );
    await page.getByLabel("6-digit meeting code").fill("123456");
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByText("Check-in recorded", { exact: true }),
    ).toBeVisible();
    expect(calls[1]).toEqual({ meeting_id: "m1", code: "123456" });
    await page
      .locator("summary")
      .filter({ hasText: /^I need to leave early$/ })
      .click();
    await page.getByLabel("Expected departure").fill("2026-09-10T12:30");
    await page.getByLabel("Reason", { exact: true }).fill("Family commitment");
    await page
      .getByRole("button", { name: "Submit attendance request", exact: true })
      .click();
    await expect(
      page.getByText("Excuse review pending", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.getByRole("dialog").screenshot({
      path: `test-results/attendance-dialog-${width}-${test.info().title.includes("student") ? "student" : "lead"}.png`,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".attendance-section").screenshot({
      path: `test-results/attendance-student-${width}.png`,
    });
  });
  test(`lead controls, separate reviews/strikes, and layout ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page, "lead");
    await page.locator('.system-card[href="#attendance"]').click();
    await page
      .getByRole("button", { name: "New meeting", exact: true })
      .click();
    await page.getByLabel("Title", { exact: true }).fill("Build night");
    await page.getByLabel("Start (your local time)").fill("2026-09-11T16:00");
    await page.getByLabel("End (your local time)").fill("2026-09-11T18:00");
    await page
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await expect
      .poll(() => calls.some((c) => c.action === "create"))
      .toBe(true);
    await page.getByRole("button", { name: /Preseason build/ }).click();
    await page.getByRole("button", { name: "Rotate check-in code" }).click();
    await expect(page.getByText("123456", { exact: true })).toBeVisible();
    await page
      .locator(".att-record > summary")
      .filter({ hasText: "Alex Student" })
      .click();
    await page
      .getByText("Review / correct attendance", { exact: true })
      .click();
    await page.getByLabel("Physical attendance").selectOption("late");
    await page
      .getByLabel("Excuse / requirement review")
      .selectOption("excused");
    await page
      .getByLabel("Review / correction explanation")
      .fill("Approved transportation issue");
    await page.getByRole("button", { name: "Save attendance review" }).click();
    await expect(
      page.locator(".att-badge").filter({ hasText: /^Excused$/ }),
    ).toBeVisible();
    await page.getByText("Assign strike", { exact: true }).first().click();
    await page.getByLabel("Category").selectOption("Insufficient Notice");
    await page.getByLabel("Quantity").fill("2");
    await page
      .getByLabel("Explanation", { exact: true })
      .fill("Notice reviewed separately");
    await page
      .getByRole("button", { name: "Assign strike", exact: true })
      .click();
    await expect(
      page.getByText("+2 · Insufficient Notice", { exact: true }),
    ).toBeVisible();
    expect(calls.find((c) => c.action === "strike").p.quantity).toBe(2);
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.getByRole("dialog").screenshot({
      path: `test-results/attendance-dialog-${width}-${test.info().title.includes("student") ? "student" : "lead"}.png`,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".attendance-section").screenshot({
      path: `test-results/attendance-lead-${width}.png`,
    });
  });
}
test("percentages exclude excuses/not-required, count late/early, and derive active strike thresholds", () => {
  const d = fixture();
  d.meetings = [];
  d.attendance = [];
  d.snapshots = [];
  const base = fixture();
  for (const [i, [physical, review, required]] of (
    [
      ["present", "none", true],
      ["late", "none", true],
      ["left_early", "none", true],
      ["absent", "none", true],
      ["absent", "excused", true],
      ["absent", "not_required", true],
      ["present", "none", false],
    ] as const
  ).entries()) {
    const id = String(i);
    d.meetings.push({ ...base.meetings[0], id, status: "finalized" });
    d.attendance.push({
      ...base.attendance[0],
      id,
      meeting_id: id,
      physical_status: physical,
      review_status: review,
    });
    d.snapshots.push({ ...base.snapshots[0], meeting_id: id, required });
  }
  expect(summary(d, student)).toMatchObject({
    percent: 75,
    attended: 3,
    total: 4,
    late: 1,
    early: 1,
    strikes: 0,
  });
  d.strikes = [
    { id: "s1", student_id: student, quantity: 3, rescinded_at: null },
    { id: "s2", student_id: student, quantity: 2, rescinded_at: null },
    { id: "s3", student_id: student, quantity: 10, rescinded_at: "2026-01-01" },
  ] as Data["strikes"];
  expect(summary(d, student).strikes).toBe(5);
  expect(strikeAction(3)).toContain("parent contact");
  expect(strikeAction(5)).toContain("possible removal");
  expect(summary(fixture(), student).percent).toBeNull();
});

for (const width of [390, 1440]) {
  test(`calendar presets, validation, routes and focused tabs ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls, data } = await mock(page, "lead");
    await expect(page.locator(".attendance-stats")).toHaveCount(0);
    await page.locator('.system-card[href="#attendance"]').click();
    await expect(
      page
        .getByRole("navigation", { name: "Attendance views" })
        .getByRole("link", { name: "Calendar" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".attendance-stats")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "4418 Systems" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Create meeting on Fri, Sep 11, 2026",
        exact: true,
      })
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByLabel("Start (your local time)")).toHaveValue(
      "2026-09-11T18:00",
    );
    await expect(modal.getByLabel("End (your local time)")).toHaveValue(
      "2026-09-11T21:00",
    );
    await modal
      .getByRole("button", { name: "Competition", exact: true })
      .click();
    await expect(modal.getByLabel("Title", { exact: true })).toHaveValue(
      "Competition",
    );
    await modal.getByLabel("Required attendance").selectOption("selected");
    await modal
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await expect(modal.getByRole("alert")).toContainText(
      "Select at least one required student",
    );
    expect(calls.filter((c) => c.action === "create")).toHaveLength(0);
    await modal.getByLabel("Alex Student · Registered").check();
    await modal.getByLabel("End (your local time)").fill("2026-09-11T17:00");
    await modal
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await expect(modal.getByRole("alert")).toContainText(
      "End time must be after start time",
    );
    await modal.getByLabel("End (your local time)").fill("2026-09-11T21:00");
    await modal.screenshot({
      path: `test-results/attendance-create-${width}.png`,
    });
    await modal
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
    expect(calls.find((c) => c.action === "create").p).toMatchObject({
      title: "Competition",
      meeting_type: "other",
      late_minutes: 10,
      requirement: "selected",
      selected_students: [student],
    });
    await page.getByRole("link", { name: "Roster", exact: true }).click();
    await page.getByLabel("Find a member").fill("Missing");
    await expect(page.getByText("No members match your search.")).toBeVisible();
    await page.getByLabel("Find a member").fill("Alex");
    await page.locator(".att-record > summary").click();
    await page.getByLabel("Member status").selectOption("prospective");
    await page.getByRole("button", { name: "Save member" }).click();
    await expect
      .poll(() => calls.some((c) => c.action === "member"))
      .toBe(true);
    data.attendance[0].notice_at = "2026-09-09T12:00:00Z";
    data.attendance[0].notice_reason = "Appointment";
    data.attendance[0].review_status = "pending";
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("link", { name: /^Attendance Requests/ }).click();
    await expect(page.getByText("Appointment", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Review notice", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Strikes", exact: true }).click();
    await expect(page.getByText("No strikes recorded.")).toBeVisible();
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.getByLabel("History meeting").selectOption("m1");
    await page.getByRole("button", { name: "Load history" }).click();
    await expect(
      page.getByText("History loaded", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.getByRole("link", { name: "Team Hub / Home" }).click();
    await expect(
      page.getByRole("heading", { name: "4418 Systems" }),
    ).toBeVisible();
    await expect(page.locator(".attendance-stats")).toHaveCount(0);
  });
}

test("week time slots prefill optional meetings; expired code and finalized actions are hidden", async ({
  page,
}) => {
  const { calls } = await mock(page, "mentor");
  await page.goto("/#attendance/calendar");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Create meeting on Thu, Sep 10, 2026 at 15:00",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Start (your local time)")).toHaveValue(
    "2026-09-10T15:00",
  );
  await page.getByRole("button", { name: "Optional", exact: true }).click();
  await expect(page.getByLabel("Required attendance")).toHaveValue("optional");
  await page
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.find((c) => c.action === "create").p).toMatchObject({
    requirement: "optional",
    meeting_type: "other",
  });
  await page.getByRole("button", { name: /Preseason build/ }).click();
  await page.getByRole("button", { name: "Rotate check-in code" }).click();
  await expect(page.getByText("123456", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-09-10T19:01:00Z"));
  await expect(page.getByText("123456", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close check-in", exact: true })
    .click();
  await expect(
    page.getByLabel("Meeting lifecycle").locator("[aria-current]"),
  ).toHaveText("Closed");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Finalize meeting" }).click();
  await expect(
    page.getByLabel("Meeting lifecycle").locator("[aria-current]"),
  ).toHaveText("Finalized");
  await expect(
    page.getByRole("button", { name: "Open check-in", exact: true }),
  ).toHaveCount(0);
});

test("student deep links never show team roster or leadership controls", async ({
  page,
}) => {
  await mock(page);
  await expect(page.locator(".attendance-section")).toHaveCount(0);
  await page.goto("/#attendance/roster");
  await expect(
    page.getByRole("heading", { name: "Meeting calendar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Roster", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New meeting", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /^Attendance Requests/ }).click();
  await expect(
    page.getByText("No notices to review in this view."),
  ).toBeVisible();
  await expect(page.getByText("Review notice", { exact: true })).toHaveCount(0);
});

for (const width of [390, 1440])
  test(`recurrence and active roster early departure ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page, "lead");
    await page.locator('.system-card[href="#attendance"]').click();
    await page
      .getByRole("button", { name: "New meeting", exact: true })
      .click();
    await page.getByLabel("Start (your local time)").fill("2026-09-08T18:00");
    await page.getByLabel("End (your local time)").fill("2026-09-08T21:00");
    await page.getByLabel("Repeat", { exact: true }).selectOption("custom");
    await page.getByLabel("Repeat through (end date)").fill("2026-09-17");
    await page.getByLabel("Tuesday", { exact: true }).check();
    await page.getByLabel("Thursday", { exact: true }).check();
    await page.getByRole("button", { name: "Preview meetings" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "4 meetings",
    );
    await page
      .getByRole("dialog")
      .screenshot({ path: `test-results/recurrence-${width}.png` });
    await page
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.find((c) => c.meetings).meetings).toHaveLength(4);
    await page.getByRole("button", { name: /Preseason build/ }).click();
    await page.locator(".att-record > summary").click();
    await page
      .locator("summary")
      .filter({ hasText: /^Mark left early$/ })
      .click();
    await page.getByLabel("Departure excuse decision").selectOption("excused");
    await page.getByRole("button", { name: "Confirm left early" }).click();
    await expect
      .poll(() =>
        calls.some(
          (c) =>
            c.action === "attendance" && c.p.physical_status === "left_early",
        ),
      )
      .toBe(true);
    expect(calls.find((c) => c.action === "attendance").p.review_status).toBe(
      "excused",
    );
    expect(calls.some((c) => c.action === "strike")).toBe(false);
    await page.getByLabel("Live roster filter").selectOption("left_early");
    await expect(page.locator(".att-record > summary")).toHaveCount(1);
    await page
      .getByRole("dialog")
      .screenshot({ path: `test-results/live-roster-${width}.png` });
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
  });

for (const width of [390, 1440])
  test(`future late-arrival requests stay pending and show planned time ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page);
    await page.clock.setFixedTime(new Date("2026-09-09T15:00:00Z"));
    await page.locator('.system-card[href="#attendance"]').click();
    await page.getByRole("button", { name: /Preseason build/ }).click();
    await page
      .locator("summary")
      .filter({ hasText: /^Submit attendance request$/ })
      .click();
    await page
      .getByLabel("How will your attendance be affected?")
      .selectOption("late");
    const expected = await page.evaluate(() => {
      const d = new Date("2026-09-10T17:45:00Z");
      return new Date(+d - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    });
    await page.getByLabel("Expected arrival").fill(expected);
    await page.getByLabel("Reason", { exact: true }).fill("Transportation");
    await page
      .getByRole("button", { name: "Submit attendance request", exact: true })
      .click();
    expect(calls[0].p.notice_type).toBe("late");
    expect(calls[0].p.expected_at).toBe("2026-09-10T17:45:00.000Z");
    await expect(
      page
        .getByRole("dialog")
        .getByText("Excuse review pending", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText(/26.0 hours in advance/),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("Pending", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .screenshot({ path: `test-results/late-request-${width}.png` });
  });
test("leadership request filters separate pending, excused and denied", async ({
  page,
}) => {
  const { data } = await mock(page, "mentor");
  data.attendance[0].notice_at = "2026-09-09T15:00:00Z";
  data.attendance[0].notice_reason = "Transportation";
  data.attendance[0].review_status = "excused";
  await page.locator('.system-card[href="#attendance"]').click();
  await page.getByRole("link", { name: /^Attendance Requests/ }).click();
  await expect(
    page.getByText("No notices to review in this view."),
  ).toBeVisible();
  await page.getByLabel("Notice status").selectOption("excused");
  await expect(
    page.getByRole("button", { name: "Open meeting" }),
  ).toBeVisible();
  await page.getByLabel("Notice status").selectOption("denied");
  await expect(page.getByRole("button", { name: "Open meeting" })).toHaveCount(
    0,
  );
  data.attendance[0].review_status = "denied";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open meeting" }),
  ).toBeVisible();
});

for(const width of [390,1440])test(`future roster sync and active default ${width}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await mock(page,'lead');await page.setViewportSize({width,height:900});let synced=0;
 await page.route('**/rpc/team_attendance_sync_future_rosters',async r=>{synced++;await r.fulfill({json:{added:2,promoted:1,skipped:1}});});
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:'Sync future rosters',exact:true}).click();
 await expect(page.getByText('Added 2; newly required 1; preserved for review 1.',{exact:true})).toBeVisible();expect(synced).toBe(1);
 await page.getByRole('button',{name:'New meeting',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d.getByLabel('Required attendance')).toHaveValue('active');await expect(d.getByRole('option',{name:'Registered students only',exact:true})).toHaveCount(1);
 await d.getByLabel('Required attendance').selectOption('registered');await expect(d.getByLabel('Required attendance')).toHaveValue('registered');
 await d.getByRole('button',{name:'Preseason',exact:true}).click();await expect(d.getByLabel('Required attendance')).toHaveValue('active');
 await page.screenshot({path:`test-results/roster-sync-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('students have no future roster sync action',async({page})=>{await mock(page);await page.goto('/#attendance/calendar');await expect(page.getByRole('button',{name:'Sync future rosters'})).toHaveCount(0);});
