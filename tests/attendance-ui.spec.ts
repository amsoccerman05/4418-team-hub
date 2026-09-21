import { test, expect, type Page } from "@playwright/test";
import { summary, strikeAction, meetingState, attendanceDuration, type Data } from "../src/attendance/service";
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
      } else if (path.endsWith("/team_attendance_check_out")) {
        calls.push(body);data.attendance[0].left_at="2026-09-10T17:10:00Z";data.attendance[0].physical_status="left_early";data.attendance[0].version++;result={message:"Check-out recorded"};
      } else if (path.endsWith("/team_attendance_request")) {
        calls.push(body);
        data.attendance[0].version++;
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
        if (body.action === "open") {
          result = { code: "123456", expires_at: "2026-09-10T18:00:00Z" };
          data.meetings[0].status="open";data.meetings[0].check_in_open=true;data.meetings[0].code_expires_at=result.expires_at;
        }
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
    if (width < 761) await page.getByRole('button', { name: 'Hub menu' }).click();
    await page.locator('.hub-nav a[href="#attendance"]').click();
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
      .filter({ hasText: /^Report attendance issue$/ })
      .click();
    await page.getByLabel("Expected departure").fill("2026-09-10T12:30");
    await page.getByLabel("Reason", { exact: true }).fill("Family commitment");
    await page
      .getByRole("button", { name: "Report an attendance issue", exact: true })
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
    if (width < 761) await page.getByRole('button', { name: 'Hub menu' }).click();
    await page.locator('.hub-nav a[href="#attendance"]').click();
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
    await page.getByText("Meeting controls", {exact:true}).click();
    await page.getByRole("button", { name: "Rotate check-in code" }).click();
    await expect(page.getByText("123456", { exact: true })).toBeVisible();
    await page
      .locator(".att-record > summary")
      .filter({ hasText: "Alex Student" })
      .click();
    await page
      .getByText("Review / correct attendance", { exact: true })
      .click();
    await page.getByRole("combobox", {name:/^Attendance/}).selectOption("late");
    await page
      .getByLabel("Excuse status")
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
    if (width < 761) await page.getByRole('button', { name: 'Hub menu' }).click();
    await page.locator('.hub-nav a[href="#attendance"]').click();
    await expect(
      page
        .getByRole("navigation", { name: "Attendance views" })
        .getByRole("link", { name: "Calendar" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".attendance-stats")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Quick access" }),
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
    await page.getByRole("link", { name: /^(Absence & Schedule Requests|My Requests)/ }).click();
    await expect(page.getByText("Appointment", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Advanced attendance & strikes", { exact: true }),
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
    // Keep the cross-origin Home navigation on the frontend under test.
    await page.route("https://team.frc4418.org/", route => route.fulfill({status:302,headers:{location:"http://127.0.0.1:4422/"}}));
    await page.getByRole("link", { name: "Team Hub / Home" }).click();
    await expect(
      page.getByRole("heading", { name: "My 4418", exact: true }),
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
  await page.getByText("Meeting controls", {exact:true}).click();
    await page.getByRole("button", { name: "Rotate check-in code" }).click();
  await expect(page.getByText("123456", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-09-10T19:01:00Z"));
  await expect(page.getByText("123456", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close check-in", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Meeting ended",{exact:true}),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Complete attendance" }).click();
  await expect(
    page.getByRole("dialog").locator(".att-badge.finalized"),
  ).toBeVisible();
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
  await page.getByRole("link", { name: /^(Absence & Schedule Requests|My Requests)/ }).click();
  await expect(
    page.getByText("You’re all caught up. No requests match this view."),
  ).toBeVisible();
  await expect(page.getByText("Advanced attendance & strikes", { exact: true })).toHaveCount(0);
});

for (const width of [390, 1440])
  test(`recurrence and active roster early departure ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page, "lead");
    if (width < 761) await page.getByRole('button', { name: 'Hub menu' }).click();
    await page.locator('.hub-nav a[href="#attendance"]').click();
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
    await page.getByRole("group",{name:"Live roster filter"}).getByRole("button",{name:"All",exact:true}).click();
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
    if (width < 761) await page.getByRole('button', { name: 'Hub menu' }).click();
    await page.locator('.hub-nav a[href="#attendance"]').click();
    await page.getByRole("button", { name: /Preseason build/ }).click();
    await page
      .locator("summary")
      .filter({ hasText: /^Report attendance issue$/ })
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
      .getByRole("button", { name: "Report an attendance issue", exact: true })
      .click();
    await expect.poll(()=>calls[0]?.p.notice_type).toBe("late");
    expect(calls[0].p.expected_at).toBe("2026-09-10T17:45:00.000Z");
    await expect(
      page
        .getByRole("dialog")
        .getByText("Excuse review pending", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Reason",{exact:true})).not.toBeVisible();
    await expect(page.getByRole("dialog").getByText("Late arrival requested · Pending")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText(/26.0 hours before the meeting/),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("Late arrival requested · Pending", { exact: true }),
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
  await page.locator('.hub-nav a[href="#attendance"]').click();
  await page.getByRole("link", { name: /^(Absence & Schedule Requests|My Requests)/ }).click();
  await expect(
    page.getByText("You’re all caught up. No requests match this view."),
  ).toBeVisible();
  await page.getByLabel("Request status").selectOption("excused");
  await expect(
    page.getByRole("button", { name: "Open meeting" }),
  ).toBeVisible();
  await page.getByLabel("Request status").selectOption("denied");
  await expect(page.getByRole("button", { name: "Open meeting" })).toHaveCount(
    0,
  );
  await page.evaluate(async()=>{const {supabase}=await import(/* @vite-ignore */ '/src/attendance/'+'service.ts');const {data:{session}}=await supabase.auth.getSession();await supabase.auth._notifyAllSubscribers('SIGNED_IN',session,false);});
  await expect(page.getByLabel("Request status")).toHaveValue("denied");expect(page.url()).toContain('#attendance/notices');
  data.attendance[0].review_status = "denied";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open meeting" }),
  ).toBeVisible();
});

for(const width of [390,1440])test(`future roster sync and active default ${width}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await mock(page,'lead');await page.setViewportSize({width,height:900});let synced=0;
 await page.route('**/rpc/team_attendance_sync_future_rosters',async r=>{synced++;await r.fulfill({json:{added:2,promoted:1,skipped:1}});});
 await page.goto('/#attendance/calendar');await expect(page.getByRole('button',{name:'Sync future rosters',exact:true})).not.toBeVisible();await page.getByText('Roster tools',{exact:true}).click();await page.getByRole('button',{name:'Sync future rosters',exact:true}).click();
 await expect(page.getByText('Added 2; newly required 1; preserved for review 1.',{exact:true})).toBeVisible();expect(synced).toBe(1);
 await page.getByRole('button',{name:'New meeting',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d.getByLabel('Required attendance')).toHaveValue('active');await expect(d.getByRole('option',{name:'Registered students only',exact:true})).toHaveCount(1);
 await d.getByLabel('Required attendance').selectOption('registered');await expect(d.getByLabel('Required attendance')).toHaveValue('registered');
 await d.getByRole('button',{name:'Preseason',exact:true}).click();await expect(d.getByLabel('Required attendance')).toHaveValue('active');
 await page.screenshot({path:`test-results/roster-sync-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('students have no future roster sync action',async({page})=>{await mock(page);await page.goto('/#attendance/calendar');await expect(page.getByRole('button',{name:'Sync future rosters'})).toHaveCount(0);});

for(const width of [390,1440])test(`compact request inbox decisions preserve physical attendance ${width}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:900});const {data,calls}=await mock(page,'mentor');
 Object.assign(data.attendance[0],{notice_at:'2026-09-09T15:00:00Z',notice_type:'early',notice_reason:'Appointment',review_status:'pending',physical_status:'left_early',left_at:'2026-09-10T17:05:00Z'});
 await page.goto('/#attendance/notices');await expect(page.getByRole('button',{name:'Excuse',exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:/^Attendance/})).not.toBeVisible();await expect(page.getByRole('button',{name:'Add / review strikes',exact:true})).not.toBeVisible();
 await page.getByLabel('Review reason',{exact:true}).fill('Appointment confirmed');await page.screenshot({path:`test-results/request-inbox-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Excuse',exact:true}).click();
 await expect.poll(()=>calls.at(-1)).toEqual({action:'attendance',p:{meeting_id:'m1',attendance_id:'a1',version:1,review_status:'excused',left_at:'2026-09-10T17:05:00Z',explanation:'Appointment confirmed'}});expect(data.attendance[0].physical_status).toBe('left_early');expect(data.strikes).toHaveLength(0);
 data.attendance[0].review_status='pending';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByLabel('Review reason',{exact:true}).fill('Not approved');await page.getByRole('button',{name:'Deny',exact:true}).click();await expect.poll(()=>calls.at(-1)?.p.review_status).toBe('denied');expect(calls.at(-1).p).not.toHaveProperty('physical_status');
 await page.getByLabel('Request status').selectOption('denied');await page.getByText('Advanced attendance & strikes',{exact:true}).click();await expect(page.getByRole('button',{name:'Review excuse / correct attendance',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

for(const width of [390,1440]) test(`same-account auth preserves modal and checkout state ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {data,calls}=await mock(page,'student');
 data.attendance[0].checked_in_at='2026-09-10T17:00:00Z';data.attendance[0].physical_status='present';
 let reads=0;page.on('request',r=>{if(r.url().includes('/team_meetings'))reads++;});
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();
 await page.getByText('Report attendance issue',{exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Keep this unsent request');
 const baseline=reads;
 await page.evaluate(async()=>{
  const {supabase}=await import(/* @vite-ignore */ '/src/attendance/' + 'service.ts');const {data:{session}}=await supabase.auth.getSession();
  await supabase.auth._notifyAllSubscribers('SIGNED_IN',session,false);
  await supabase.auth._notifyAllSubscribers('TOKEN_REFRESHED',session,false);
  window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));
 });
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByLabel('Reason',{exact:true})).toHaveValue('Keep this unsent request');expect(reads).toBe(baseline);expect(page.url()).toContain('#attendance/calendar');
 await expect(page.getByRole('dialog').getByText('In progress',{exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Check out',exact:true}).click();
 await expect(page.getByText('Checked out',{exact:true})).toBeVisible();await expect(page.getByText('Left early',{exact:true})).toBeVisible();await expect(page.getByText('Duration: 10 min',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Check out',exact:true})).toHaveCount(0);expect(calls.at(-1)).toEqual({meeting_id:'m1'});expect(data.attendance[0].review_status).toBe('none');expect(data.strikes).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('dialog').screenshot({path:`test-results/checkout-${width}.png`});
 await page.evaluate(async()=>{const {supabase}=await import(/* @vite-ignore */ '/src/attendance/' + 'service.ts');await supabase.auth._notifyAllSubscribers('SIGNED_OUT',null,false);});
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();
});
test('meeting vocabulary and duration use actual timestamps only',()=>{
 const m=fixture().meetings[0],a=fixture().attendance[0];const now=Date.parse('2026-09-10T17:10:00Z');
 expect(meetingState({...m,status:'draft'},Date.parse(m.starts_at)-1)).toBe('Upcoming');expect(meetingState(m,now)).toBe('In progress');expect(meetingState(m,Date.parse(m.ends_at))).toBe('Meeting ended');expect(meetingState({...m,status:'finalized'},now)).toBe('Attendance complete');
 expect(attendanceDuration({...a,checked_in_at:m.starts_at,physical_status:'present'},m,now)).toBe('10 min');expect(attendanceDuration({...a,checked_in_at:m.starts_at,physical_status:'present'},m,Date.parse(m.ends_at))).toBeNull();expect(attendanceDuration(a)).toBeNull();expect(attendanceDuration({...a,checked_in_at:m.starts_at})).toBeNull();expect(attendanceDuration({...a,checked_in_at:m.starts_at,left_at:m.ends_at})).toBe('2h 0m');
});

for(const width of [390,1440])test(`V3 arrival, live time and missing departure ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {data}=await mock(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:'View meeting / check in',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByText("You're expected at this meeting",{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Check out',exact:true})).toHaveCount(0);
 await dialog.getByLabel('6-digit meeting code').fill('123456');await dialog.getByRole('button',{name:'Check in',exact:true}).click();
 await expect(dialog.getByText("You're checked in",{exact:true})).toBeVisible();await expect(dialog.getByText('Here for 7 min',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Check out',exact:true})).toBeVisible();
 await page.clock.setFixedTime(new Date('2026-09-10T18:03:00Z'));await expect(dialog.getByText('Here for 1h 0m',{exact:true})).toBeVisible();
 await dialog.screenshot({path:`test-results/v3-checked-in-${width}.png`});
 await page.clock.setFixedTime(new Date('2026-09-10T19:01:00Z'));await expect(dialog.getByText('Meeting ended',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Check out',exact:true})).toHaveCount(0);await expect(dialog.getByText('Departure not recorded · duration unavailable')).toBeVisible();expect(data.attendance[0].left_at).toBeNull();await expect(dialog.getByText(/Here for/)).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Complete attendance',exact:true})).toHaveCount(0);expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(errors).toEqual([]);
});
for(const width of [390,1440])test(`V3 compact roster attention and completion ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {data,calls}=await mock(page,'mentor');
 data.members.push({student_id:'other',display_name:'Jordan Here',member_status:'registered',team_area:'Build'});
 data.snapshots.push({...data.snapshots[0],student_id:'other'});data.attendance.push({...data.attendance[0],id:'a2',student_id:'other',physical_status:'present',checked_in_at:'2026-09-10T17:00:00Z'});
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByText('2 expected · 1 here · 0 checked out · 1 not checked in · 0 excused')).toBeVisible();await expect(dialog.getByRole('region',{name:'Needs attention'})).toBeVisible();
 const filters=dialog.getByRole('group',{name:'Live roster filter'});
 await filters.getByRole('button',{name:'Here',exact:true}).click();await expect(dialog.locator('.att-record')).toHaveCount(1);await expect(dialog.locator('.att-record')).toContainText('Jordan Here');
 await filters.getByRole('button',{name:'Not checked in',exact:true}).click();await expect(dialog.locator('.att-record')).toHaveCount(1);await expect(dialog.locator('.att-record')).toContainText('Alex Student');
 await filters.getByRole('button',{name:'Requests',exact:true}).click();await expect(dialog.getByText('No students match this view.')).toBeVisible();
 await filters.getByRole('button',{name:'All',exact:true}).click();await dialog.locator('.att-record > summary').first().click();await expect(dialog.getByRole('button',{name:'Review excuse / correct attendance'})).toBeVisible();await dialog.locator('.att-record > summary').first().click();
 await dialog.screenshot({path:`test-results/v3-roster-${width}.png`});
 await page.clock.setFixedTime(new Date('2026-09-10T19:01:00Z'));await expect(dialog.getByText('Meeting ended',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Open check-in',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Complete attendance',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close check-in',exact:true}).click();await expect(dialog.getByRole('button',{name:'Complete attendance',exact:true})).toBeVisible();page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Complete attendance',exact:true}).click();await expect.poll(()=>calls.at(-1)?.action).toBe('finalize');await expect(dialog.locator('.att-badge.finalized')).toHaveText('Attendance complete');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('V3 future check-in availability and editable collapsed absence summary',async({page})=>{
 const {data,calls}=await mock(page);await page.clock.setFixedTime(new Date('2026-09-09T15:00:00Z'));data.meetings[0].check_in_open=false;await page.goto('/#attendance/calendar');await page.getByRole('button',{name:'View meeting / check in',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByText('Upcoming',{exact:true})).toBeVisible();await expect(dialog.getByText(/Leadership can open check-in from/)).toBeVisible();await expect(dialog.getByRole('button',{name:'Check in',exact:true})).toHaveCount(0);
 await dialog.getByText('Report attendance issue',{exact:true}).click();await expect(dialog.getByLabel('Expected arrival')).toHaveCount(0);await expect(dialog.getByLabel('Expected departure')).toHaveCount(0);await dialog.getByLabel('Reason',{exact:true}).fill('School activity');await dialog.getByRole('button',{name:'Report an attendance issue',exact:true}).click();await expect(dialog.getByText('Absence requested · Pending')).toBeVisible();await expect(dialog.getByLabel('Reason',{exact:true})).not.toBeVisible();await dialog.getByText('Edit request',{exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Reason',exact:true})).toHaveValue('School activity');await dialog.getByRole('textbox',{name:'Reason',exact:true}).fill('Updated school activity');await dialog.getByRole('button',{name:'Report an attendance issue',exact:true}).click();await expect(dialog.locator('.att-request-reason').getByText('Updated school activity',{exact:true})).toBeVisible();await expect(dialog.getByRole('textbox',{name:'Reason',exact:true})).not.toBeVisible();expect(calls.at(-1).p.notice_type).toBe('absent');expect(calls.at(-1).p.reason).toBe('Updated school activity');
});

test('strike cards use available names and safe labels instead of raw actor IDs',async({page})=>{
 const {data}=await mock(page,'mentor');data.strikes=[{id:'strike',attendance_id:'a1',meeting_id:'m1',student_id:student,category:'attendance',quantity:1,explanation:'Missed required meeting',assigned_by:lead,assigned_at:'2026-09-10T17:00:00Z',rescinded_at:null,rescind_reason:null}];
 await page.goto('/#attendance/strikes');await expect(page.locator('.att-strikes')).toContainText('Name unavailable');await expect(page.locator('.att-strikes')).not.toContainText(lead);
 data.members.push({student_id:lead,display_name:'Coach Morgan',member_status:'registered',team_area:''});await page.reload();await expect(page.locator('.att-strikes')).toContainText('Coach Morgan');
});

for(const role of ['student','lead'])test(`checkout visible on calendar with closed check-in for ${role}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});const {data,calls}=await mock(page,role);
 const uid=role==='lead'?lead:student;data.attendance[0].student_id=uid;data.attendance[0].checked_in_at='2026-09-10T17:00:00Z';data.attendance[0].physical_status='late';data.snapshots[0].student_id=uid;data.meetings[0].status='closed';data.meetings[0].check_in_open=false;data.meetings[0].code_expires_at='2026-09-10T17:01:00Z';
 await page.goto('/#attendance/calendar');const current=page.getByRole('region',{name:'Your current attendance'});await expect(current.getByRole('button',{name:'Check out',exact:true})).toBeVisible();await expect(current).toContainText('Arrived');await expect(current).toContainText('Here for 10 min');
 if(role==='lead'){await page.getByRole('button',{name:/Preseason build/}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'Check out',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
 await current.screenshot({path:`test-results/checkout-calendar-${role}.png`});
 page.once('dialog',d=>d.accept());await current.getByRole('button',{name:'Check out',exact:true}).click();await expect(current).toContainText('Checked out');await expect(current).toContainText('Duration: 10 min');await expect(current).toContainText('Left early');await expect(current.getByRole('button',{name:'Check out',exact:true})).toHaveCount(0);expect(calls.at(-1)).toEqual({meeting_id:'m1'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('expected lead explicitly checks self in without changing another attendee',async({page})=>{
 const {data,calls}=await mock(page,'lead');data.attendance[0].student_id=lead;data.snapshots[0].student_id=lead;data.members.push({student_id:lead,display_name:'Alex Lead',member_status:'registered',team_area:'Build'});
 data.attendance.push({...data.attendance[0],id:'other-attendance',student_id:student});data.meetings[0].check_in_open=false;data.meetings[0].status='draft';
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Open check-in',exact:true}).click();
 expect(data.attendance[0].checked_in_at).toBeNull();expect(calls).toHaveLength(1);
 await dialog.getByRole('button',{name:'Check myself in',exact:true}).click();expect(calls.at(-1)).toEqual({meeting_id:'m1',code:'123456'});expect(data.attendance[1].checked_in_at).toBeNull();await expect(dialog.getByRole('button',{name:'Close check-in',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Check out',exact:true}).click();await expect(dialog.locator('.att-roster-counts')).toContainText('1 checked out');await dialog.getByRole('group',{name:'Live roster filter'}).getByRole('button',{name:'Checked out',exact:true}).click();await expect(dialog.locator('.att-record')).toHaveCount(1);await expect(dialog.locator('.att-record')).toContainText('Alex Lead');await expect(dialog.locator('.att-record')).toContainText('Duration: 7 min');await expect(dialog.locator('.att-record')).toContainText('Left early');
});
