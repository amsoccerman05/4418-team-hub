import { test, expect, type Page, type Route } from "@playwright/test";
import { summary, strikeAction, meetingState, attendanceDuration, checkInControls, noticeTiming, type Data } from "../src/attendance/service";
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
async function mock(page: Page, role = "student", options: { active?: boolean; configure?: (data: Data, userId: string) => void } = {}) {
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
  options.configure?.(data, user.id);
  const ownAttendance = (meetingId: string) => {
    const attendance = data.attendance.find(a => a.meeting_id === meetingId && a.student_id === user.id);
    if (!attendance) throw new Error(`No synthetic attendance for ${user.id} at ${meetingId}`);
    return attendance;
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
  const handleRequest = async (route: Route) => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().postDataJSON();
      let result: unknown = [];
      if (path.endsWith("/profiles"))
        result = {
          id: user.id,
          display_name: role === "student" ? "Alex Student" : "Lee Lead",
          role,
          active: options.active ?? true,
        };
      else if (path === "/rest/v1/rpc/notification_center") result = { unread: 0, attention: [], items: [], has_more: false };
      else if (path === "/rest/v1/rpc/planning_my_work_context") result = {user_id:user.id,season_id:null,seasons:[],boards:[],tasks:[]};
      else if (path === "/rest/v1/pit_issues") return route.fulfill({json:[],headers:{"content-range":"*/0","access-control-expose-headers":"content-range"}});
      else if (path.endsWith("/team_dashboard_context")) result = {name:'Team member',role,admin:false,personal:{percent:null,strikes:0,pending:0},next_meeting:null,orders:[],finance:{allowed:false,approvals:0,school:0},attention:null,robot:null,inventory:null,announcements:[]};
      else if (path.endsWith("/team_attendance_policy_context")) result = data.policy || {user_id:user.id,can_review:role==="mentor",can_read_team:role!=="student",can_manage_meetings:role!=="student",can_start_year:role==="mentor",strike_year_start:null,people:[],warnings:[]};
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
          const attendance = ownAttendance(body.meeting_id);
          attendance.physical_status = "present";
          attendance.checked_in_at = "2026-09-10T17:03:00Z";
          result = { message: "Checked in" };
        }
      } else if (path.endsWith("/team_attendance_check_out")) {
        calls.push(body);
        const attendance = ownAttendance(body.meeting_id);
        attendance.left_at = "2026-09-10T17:10:00Z";
        attendance.physical_status = "left_early";
        attendance.version++;
        result = { message: "Check-out recorded" };
      } else if (path.endsWith("/team_attendance_request")) {
        calls.push(body);
        const attendance = ownAttendance(body.p.meeting_id);
        if (body.p.version !== attendance.version) result = { error: "Attendance changed. Refresh and try again." };
        else {
          attendance.version++;
          attendance.notice_at = "2026-09-09T15:00:00Z";
          attendance.notice_reason = body.p.reason;
          attendance.notice_type = body.p.notice_type;
          attendance.expected_at = body.p.expected_at;
          attendance.review_status = "pending";
          attendance.review_reason = "";
          attendance.reviewed_by = null;
          attendance.reviewed_at = null;
          result = null;
        }
      } else if (path.endsWith("/team_attendance_create_batch")) {
        calls.push(body);
        result = body.meetings.map((_: unknown, i: number) => ({
          id: `batch-${i}`,
        }));
      } else if (path.endsWith("/team_attendance_edit_meeting")) {
        calls.push(body);
        const m=data.meetings.find(m=>m.id===body.p.meeting_id)!;
        const changedTime=m.starts_at!==body.p.starts_at||m.ends_at!==body.p.ends_at;
        Object.assign(m,{title:body.p.title,meeting_type:body.p.meeting_type,starts_at:body.p.starts_at,ends_at:body.p.ends_at,version:m.version+1});
        if(changedTime){m.check_in_open=false;m.code_expires_at=null;}
        result={id:m.id,version:m.version,changed:true};
      } else if (path.endsWith("/team_attendance_manage")) {
        calls.push(body);
        result = {};
        if (body.action === "open") {
          const opened = { code: "123456", expires_at: "2026-09-10T18:00:00Z" };
          result = opened;
          data.meetings[0].status="open";data.meetings[0].check_in_open=true;data.meetings[0].code_expires_at=opened.expires_at;
        }
        if (body.action === "close" || body.action === "finalize") {
          data.meetings[0].status =
            body.action === "close" ? "closed" : "finalized";
          data.meetings[0].check_in_open = false;
          data.meetings[0].version++;
        }
        if (body.action === "attendance") {
          const attendance = data.attendance.find(a => a.id === body.p.attendance_id && a.meeting_id === body.p.meeting_id)!;
          Object.assign(attendance, body.p, {
            version: attendance.version + 1,
            review_reason: body.p.explanation,
            ...(body.p.review_status ? {reviewed_by: user.id, reviewed_at: "2026-09-09T15:10:00Z"} : {}),
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
    };
  await page.route("https://attendance-test.supabase.invalid/**", handleRequest);
  await page.goto("/");
  return { data, calls, handleRequest };
}
test("Attendance fixture accepts header and personal assignment reads but rejects unknown requests", async ({ page }) => {
  const { handleRequest } = await mock(page);
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recent notifications" }).getByText("You’re all caught up.")).toBeVisible();
  const unknown = {
    request: () => ({ url: () => "https://attendance-test.supabase.invalid/rest/v1/rpc/unapproved_rpc", postDataJSON: () => ({}) }),
  } as unknown as Route;
  await expect(handleRequest(unknown)).rejects.toThrow("Unexpected request: /rest/v1/rpc/unapproved_rpc");
});
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
    await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Family commitment");
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
  test(`mentor controls, separate reviews/strikes, and layout ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page, "mentor");
    if (width < 761) await page.getByRole('button', { name: 'Hub menu' }).click();
    await page.locator('.hub-nav a[href="#attendance"]').click();
    await page.locator('.att-tabs a[href="#attendance/calendar"]').click();
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
  expect(strikeAction(5)).toContain("Removal threshold");
  expect(summary(fixture(), student).percent).toBeNull();
  d.policy={user_id:student,can_review:false,can_read_team:false,can_manage_meetings:false,strike_year_start:'2026-01-01T00:00:00Z',people:[],warnings:[]};
  d.strikes[0].assigned_at='2025-12-31T23:59:59Z';d.strikes[1].assigned_at='2026-01-01T00:00:00Z';
  expect(summary(d,student).strikes).toBe(2);expect(d.strikes).toHaveLength(3);
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
    await page.locator('.att-tabs a[href="#attendance/calendar"]').click();
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
      late_minutes: 5,
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
    await page.locator('.att-tabs a[href="#attendance/notices"]').click();
    await expect(page.getByText("Appointment", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Advanced attendance & strikes", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Strikes", exact: true }).click();
    await expect(page.getByText("No strikes match this view.")).toBeVisible();
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
  await page.locator('.att-tabs a[href="#attendance/notices"]').click();
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
    await page.locator('.att-tabs a[href="#attendance/calendar"]').click();
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
    await expect(page.getByLabel("Departure excuse decision")).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm left early" }).click();
    await expect
      .poll(() =>
        calls.some(
          (c) =>
            c.action === "attendance" && c.p.physical_status === "left_early",
        ),
      )
      .toBe(true);
    expect(calls.find((c) => c.action === "attendance").p.review_status).toBeUndefined();
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
    await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Transportation");
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
  await page.locator('.att-tabs a[href="#attendance/notices"]').click();
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
 await page.goto('/#attendance/calendar');
 await page.getByRole('button',{name:/Preseason build/}).click();const dialog=page.getByRole('dialog');
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
 await page.goto('/#attendance/strikes');await expect(page.locator('.att-fieldset')).toContainText('Name unavailable');await expect(page.locator('.att-fieldset')).not.toContainText(lead);
 data.members.push({student_id:lead,display_name:'Coach Morgan',member_status:'registered',team_area:''});await page.reload();await expect(page.locator('.att-fieldset')).toContainText('Coach Morgan');
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
 await page.goto('/#attendance/calendar');
 await page.getByRole('button',{name:/Preseason build/}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Open check-in',exact:true}).click();
 expect(data.attendance[0].checked_in_at).toBeNull();expect(calls).toHaveLength(1);
 await dialog.getByRole('button',{name:'Check myself in',exact:true}).click();expect(calls.at(-1)).toEqual({meeting_id:'m1',code:'123456'});expect(data.attendance[1].checked_in_at).toBeNull();await expect(dialog.getByRole('button',{name:'Close check-in',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Check out',exact:true}).click();await expect(dialog.locator('.att-roster-counts')).toContainText('1 checked out');await dialog.getByRole('group',{name:'Live roster filter'}).getByRole('button',{name:'Checked out',exact:true}).click();await expect(dialog.locator('.att-record')).toHaveCount(1);await expect(dialog.locator('.att-record')).toContainText('Alex Lead');await expect(dialog.locator('.att-record')).toContainText('Duration: 7 min');await expect(dialog.locator('.att-record')).toContainText('Left early');
});

test('policy check-in controls and notice thresholds share exact boundaries',()=>{
 const m=fixture().meetings[0],start=Date.parse(m.starts_at);
 expect(checkInControls(m,start-7*86400000)).toMatchObject({canOpen:false,canClose:false,open:false});
 expect(checkInControls(m,start-1800000)).toMatchObject({canOpen:true,open:true,canClose:true});
 expect(checkInControls({...m,status:'finalized'},start)).toMatchObject({canOpen:false,canClose:false});
 const a=fixture().attendance[0];
 for(const notice_type of ['absent','late','early'] as const){
  expect(noticeTiming({...a,notice_type,notice_at:new Date(start-86400000).toISOString()},m)).toContain('At least 24');
  expect(noticeTiming({...a,notice_type,notice_at:new Date(start-86400000+1).toISOString()},m)).toContain('Emergency');
 }
 expect(strikeAction(2)).toContain('Warning / parent contact required');
 expect(strikeAction(5)).toContain('Removal threshold');
});
for(const width of [390,1440])test(`policy lead personal requests and future controls ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {data,calls}=await mock(page,'lead');
 await page.clock.setFixedTime(new Date('2026-09-09T15:00:00Z'));
 data.attendance[0].student_id=lead;data.snapshots[0].student_id=lead;data.meetings[0].status='draft';data.meetings[0].check_in_open=false;
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();const d=page.getByRole('dialog');
 await d.getByText('Meeting controls',{exact:true}).click();await expect(d.getByRole('button',{name:'Close check-in',exact:true})).toHaveCount(0);await expect(d.getByRole('button',{name:'Open check-in',exact:true})).toHaveCount(0);
 for(const kind of ['absent','late','early']){
  await d.getByText(calls.length?'Edit request':'Report attendance issue',{exact:true}).click();
  await d.getByLabel('How will your attendance be affected?').selectOption(kind);
  if(kind!=='absent')await d.getByLabel(kind==='late'?'Expected arrival':'Expected departure',{exact:true}).fill('2026-09-10T18:00');
  await d.getByRole('textbox',{name:'Reason',exact:true}).fill('Confirmed school activity');await d.getByRole('button',{name:'Report an attendance issue',exact:true}).click();
  await expect.poll(()=>calls.at(-1)?.p.notice_type).toBe(kind);
  expect(calls.at(-1).p.student_id).toBeUndefined();
  await expect(d.getByRole('textbox',{name:'Reason',exact:true})).not.toBeVisible();
 }
 await expect(d.getByRole('button',{name:'Excuse',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const width of [390,1440])test(`policy dashboard search strike thresholds and privacy ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {data}=await mock(page,'mentor');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 data.policy={user_id:lead,can_review:true,can_read_team:true,can_manage_meetings:true,strike_year_start:'2026-01-01T00:00:00Z',people:[{id:student,name:'Alex Student',role:'student',positions:['Software Lead']}],warnings:[]};
 data.members.push({student_id:'other',display_name:'Jordan Five',member_status:'registered',team_area:'Build'});
 data.strikes=[{id:'s1',attendance_id:'a1',meeting_id:'m1',student_id:student,category:'Other',quantity:2,explanation:'Reviewed',assigned_by:lead,assigned_at:'2026-09-10T17:00:00Z',rescinded_at:null,rescind_reason:null},{id:'s2',attendance_id:'a2',meeting_id:'m1',student_id:'other',category:'Other',quantity:5,explanation:'Reviewed',assigned_by:lead,assigned_at:'2026-09-10T17:00:00Z',rescinded_at:null,rescind_reason:null}];
 await page.goto('/#attendance');await expect(page.getByRole('heading',{name:'Attendance · needs attention'})).toBeVisible();
 await expect(page.getByText('Warning / parent contact required',{exact:true})).toBeVisible();await expect(page.getByText('Removal threshold reached',{exact:true})).toBeVisible();
 await page.getByLabel('Member name').fill('Alex');await page.locator('.att-record > summary').filter({hasText:'Alex Student'}).click();
 await expect(page.getByRole('region',{name:'Alex Student attendance summary'})).toContainText('Software Lead');await expect(page.getByRole('region',{name:'Alex Student attendance summary'})).not.toContainText('Jordan Five');
 await page.screenshot({path:`test-results/policy-dashboard-${width}.png`,fullPage:true});
 await page.locator('.att-tabs a[href="#attendance/strikes"]').click();await page.getByLabel('Find strike member').fill('Jordan');
 await expect(page.getByRole('heading',{name:'Jordan Five · 5 active strikes'})).toBeVisible();await expect(page.getByRole('heading',{name:'Alex Student · 2 active strikes'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Program Manager student can review another member without meeting-management controls',async({page})=>{
 const {data,calls}=await mock(page,'student');
 data.policy={user_id:student,can_review:true,can_read_team:true,can_manage_meetings:false,strike_year_start:'2026-01-01T00:00:00Z',people:[],warnings:[]};
 data.attendance[0].student_id=lead;data.attendance[0].notice_at='2026-09-09T12:00:00Z';data.attendance[0].notice_reason='School activity';data.attendance[0].review_status='pending';
 data.members.push({student_id:lead,display_name:'Lee Lead',member_status:'registered',team_area:''});
 await page.goto('/#attendance/calendar');await expect(page.getByRole('button',{name:'New meeting',exact:true})).toHaveCount(0);await expect(page.getByText('Roster tools',{exact:true})).toHaveCount(0);
 await page.locator('.att-tabs a[href="#attendance/notices"]').click();await page.getByLabel('Review reason').fill('School confirmation checked');await page.getByRole('button',{name:'Excuse',exact:true}).click();
 await expect.poll(()=>calls.at(-1)?.p.review_status).toBe('excused');expect(calls.at(-1).p.physical_status).toBeUndefined();expect(calls.at(-1).p.attendance_id).toBe('a1');
});

for(const width of [390,768,1440])test(`UI sweep Attendance review queue and calendar navigation ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {data,calls}=await mock(page,'mentor');
 data.policy={user_id:lead,can_review:true,can_read_team:true,can_manage_meetings:true,strike_year_start:'2026-01-01T00:00:00Z',people:[],warnings:[]};
 data.attendance[0].review_status='pending';data.attendance[0].notice_at='2026-09-09T12:00:00Z';data.attendance[0].notice_reason='School activity';
 await page.goto('/#attendance');await expect(page.locator('.att-leadership-stats>span')).toHaveCount(5);
 await page.screenshot({path:`test-results/ui-review-attendance-dashboard-${width}.png`,fullPage:true});
 const queue=page.getByRole('region',{name:'Attendance review queue'});
 await expect(queue.getByRole('link',{name:/1 attendance requests need review/})).toBeVisible();
 await queue.getByRole('link').click();await expect(page).toHaveURL(/#attendance\/notices$/);
 await expect(page.getByText('School activity',{exact:true})).toBeVisible();
 await page.goto('/#attendance/calendar');await page.getByRole('button',{name:'Month',exact:true}).click();
 await expect(page.locator('.att-weekdays>span')).toHaveCount(7);await expect(page.getByRole('heading',{name:'September 2026',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Next period',exact:true}).click();await expect(page.getByRole('heading',{name:'October 2026',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Today',exact:true}).click();await expect(page.getByRole('heading',{name:'September 2026',exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/ui-review-attendance-calendar-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:/Preseason build/}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await dialog.press('Escape');await expect(dialog).toHaveCount(0);
 expect(calls).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [390,1440])test(`Attendance pending check-in feedback and recovery ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const {calls}=await mock(page);await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('6-digit meeting code').fill('000000');
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/rest/v1/rpc/team_attendance_check_in',async route=>{await pending;await route.fallback();});
 await dialog.getByRole('button',{name:'Check in',exact:true}).click();
 try{
  await expect(dialog.getByRole('status')).toHaveText('Updating attendance…');await expect(dialog.getByRole('button',{name:'Check in',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeDisabled();
  await dialog.press('Escape');await expect(dialog).toBeVisible();
 }finally{release();}
 await expect(dialog.getByRole('alert')).toContainText('Invalid meeting code');await expect(dialog.locator('.att-progress')).toHaveCount(0);await expect(dialog.getByLabel('6-digit meeting code')).toHaveValue('000000');
 await dialog.getByLabel('6-digit meeting code').fill('123456');await dialog.getByRole('button',{name:'Check in',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Check-in recorded');
 expect(calls).toEqual([{meeting_id:'m1',code:'000000'},{meeting_id:'m1',code:'123456'}]);await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [390,1440]) {
 test(`upcoming meeting editing and student how-to ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const {data,calls}=await mock(page,'lead');
  await page.clock.setFixedTime(new Date('2026-09-10T16:00:00Z'));
  await page.goto('/#attendance/calendar');
  await page.getByRole('button',{name:/Preseason build/}).click();
  const dialog=page.getByRole('dialog',{name:'Meeting details'});
  await dialog.getByRole('button',{name:'Edit meeting',exact:true}).click();
  const form=dialog.getByRole('form',{name:'Edit meeting'});
  await form.getByLabel('Meeting title').fill('Updated build meeting');
  await form.getByLabel('Meeting type').selectOption('other');
  await form.getByLabel('Meeting start',{exact:true}).fill('2026-09-11T23:00');
  await form.getByLabel('Meeting end',{exact:true}).fill('2026-09-12T02:00');
  await expect(form.getByText('This meeting only.',{exact:false})).toBeVisible();
  await expect(form.getByRole('button',{name:'Save meeting',exact:true})).toBeDisabled();
  await form.getByRole('checkbox').check();
  await form.getByLabel('Meeting title').scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/attendance-edit-fields-${width}.png`});
  await form.getByRole('button',{name:'Save meeting',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/attendance-edit-review-${width}.png`});
  await form.getByRole('button',{name:'Save meeting',exact:true}).click();
  await expect(dialog.getByText('Meeting saved. Only this meeting was changed.')).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'Updated build meeting',exact:true})).toBeVisible();
  expect(calls.filter(c=>c.p?.title==='Updated build meeting')).toHaveLength(1);
  expect(calls.at(-1).p).toMatchObject({meeting_id:'m1',version:1,meeting_type:'other',acknowledge_schedule_change:true});
  expect(data.meetings[0].check_in_open).toBe(false);
  expect(data.attendance[0].physical_status).toBe('pending');
  await dialog.getByRole('link',{name:'How to use Attendance →'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'How to use Attendance',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'For meeting leadership: edit an upcoming meeting'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'When you arrive'})).toBeVisible();
  expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('heading',{name:'How to use Attendance',exact:true})).toBeInViewport();
  await page.screenshot({path:`test-results/attendance-how-to-${width}.png`});
  await page.goBack();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Meeting calendar'})).toBeVisible();
 });
}
test('meeting edit cancel, Escape and navigation discard the draft without sending',async({page})=>{
 const {calls}=await mock(page,'lead');await page.clock.setFixedTime(new Date('2026-09-10T16:00:00Z'));await page.goto('/#attendance/calendar');
 const open=async()=>{await page.getByRole('button',{name:/Preseason build/}).click();await page.getByRole('button',{name:'Edit meeting',exact:true}).click();};
 await open();await page.getByLabel('Meeting title').fill('Discard me');await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByRole('form',{name:'Edit meeting'})).toHaveCount(0);await page.getByRole('button',{name:'Edit meeting',exact:true}).click();await expect(page.getByLabel('Meeting title')).toHaveValue('Preseason build');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await open();await expect(page.getByLabel('Meeting title')).toHaveValue('Preseason build');expect(calls).toEqual([]);
});
test('meeting edit failure preserves draft and explicit refresh/reload resolves stale version',async({page})=>{
 const {data,calls,handleRequest}=await mock(page,'lead');await page.clock.setFixedTime(new Date('2026-09-10T16:00:00Z'));await page.goto('/#attendance/calendar');
 await page.getByRole('button',{name:/Preseason build/}).click();await page.getByRole('button',{name:'Edit meeting',exact:true}).click();await page.getByLabel('Meeting title').fill('My draft');
 let first=true;
 await page.route('**/rpc/team_attendance_edit_meeting',async route=>{
  if(first){first=false;data.meetings[0].title='Another leader saved';data.meetings[0].version=2;await route.fulfill({status:409,json:{message:'Meeting changed. Refresh and reload the latest meeting before saving.'}});}
  else await handleRequest(route);
 });
 await page.getByRole('button',{name:'Save meeting',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Meeting changed');await expect(page.getByLabel('Meeting title')).toHaveValue('My draft');
 await page.getByRole('button',{name:'Refresh meeting',exact:true}).click();await expect(page.getByRole('button',{name:'Reload latest meeting',exact:true})).toBeVisible();
 await expect(page.getByLabel('Meeting title')).toHaveValue('My draft');await page.getByRole('button',{name:'Reload latest meeting',exact:true}).click();await expect(page.getByLabel('Meeting title')).toHaveValue('Another leader saved');
 await page.getByLabel('Meeting title').fill('My new draft');await page.getByRole('button',{name:'Save meeting',exact:true}).click();await expect(page.getByRole('dialog').getByText('Meeting saved. Only this meeting was changed.')).toBeVisible();expect(calls.at(-1).p.version).toBe(2);
});
test('students and student Program Managers get instructions without meeting-edit authority',async({page})=>{
 const {data}=await mock(page);data.policy={user_id:student,can_review:true,can_read_team:true,can_manage_meetings:false,strike_year_start:null,people:[],warnings:[]};
 await page.clock.setFixedTime(new Date('2026-09-10T16:00:00Z'));await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();
 await expect(page.getByRole('button',{name:'Edit meeting',exact:true})).toHaveCount(0);await page.getByRole('dialog').getByRole('link',{name:'How to use Attendance →'}).click();
 await expect(page.getByRole('heading',{name:'How to use Attendance',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'For meeting leadership: edit an upcoming meeting'})).toHaveCount(0);
});
test('meeting edits stop when the meeting starts, including an editor already open',async({page})=>{
 const {calls}=await mock(page,'lead');await page.clock.setFixedTime(new Date('2026-09-10T16:59:59Z'));await page.goto('/#attendance/calendar');await page.getByRole('button',{name:/Preseason build/}).click();await page.getByRole('button',{name:'Edit meeting',exact:true}).click();
 await page.getByLabel('Meeting title').fill('Too late');await page.clock.setFixedTime(new Date('2026-09-10T17:00:00Z'));
 await expect(page.getByLabel('Meeting title')).toBeDisabled();await expect(page.getByRole('button',{name:'Save meeting',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Edit meeting',exact:true})).toHaveCount(0);expect(calls).toEqual([]);
});
test('successful meeting edit with failed refresh keeps draft and identifies saved result',async({page})=>{
 const {data,handleRequest}=await mock(page,'lead');await page.clock.setFixedTime(new Date('2026-09-10T16:00:00Z'));await page.goto('/#attendance/calendar');
 await page.getByRole('button',{name:/Preseason build/}).click();await page.getByRole('button',{name:'Edit meeting',exact:true}).click();await page.getByLabel('Meeting title').fill('Saved despite refresh failure');
 let fail=true;await page.route('**/rest/v1/team_meetings?*',async route=>{if(fail){fail=false;await route.fulfill({status:500,json:{message:'Synthetic read failure'}});}else await handleRequest(route);});
 await page.getByRole('button',{name:'Save meeting',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Meeting saved, but the refreshed view could not be loaded');
 await expect(page.getByLabel('Meeting title')).toHaveValue('Saved despite refresh failure');expect(data.meetings[0].title).toBe('Saved despite refresh failure');
 await page.getByRole('button',{name:'Refresh meeting',exact:true}).click();await page.getByRole('button',{name:'Reload latest meeting',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save meeting',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog').getByRole('heading',{name:'Saved despite refresh failure',exact:true})).toBeVisible();
});

// Synthetic team data deliberately starts with somebody else's record. A personal
// request must never depend on row ordering or the leadership review permission.
const otherRequester = "00000000-0000-0000-0000-000000000004";
function personalRequestFixture(data: Data, userId: string, reviewer = false) {
  const meeting = data.meetings[0], attendance = data.attendance[0], snapshot = data.snapshots[0];
  data.policy = {
    user_id: userId, can_review: reviewer, can_read_team: userId === lead || reviewer,
    can_manage_meetings: userId === lead, strike_year_start: null, people: [], warnings: [],
    can_review_program_manager_requests: false, mentor_review_required_for: reviewer ? [userId] : [],
  };
  data.meetings = [
    { ...meeting, status: "draft", check_in_open: false, code_expires_at: null },
    { ...meeting, id: "m-own-second", title: "Optional design session", requirement: "optional", starts_at: "2026-09-11T17:00:00Z", ends_at: "2026-09-11T19:00:00Z", status: "draft", check_in_open: false },
    { ...meeting, id: "m-other-only", title: "Other member meeting" },
    { ...meeting, id: "m-ended", title: "Ended roster meeting", starts_at: "2026-09-08T17:00:00Z", ends_at: "2026-09-08T19:00:00Z" },
    { ...meeting, id: "m-finalized", title: "Completed roster meeting", status: "finalized" },
  ];
  data.attendance = [
    { ...attendance, id: "a-other", student_id: otherRequester, notice_type: "absent", notice_at: "2026-09-08T12:00:00Z", notice_reason: "Another member private request", review_status: "pending" },
    { ...attendance, id: "a-own", student_id: userId },
    { ...attendance, id: "a-own-second", meeting_id: "m-own-second", student_id: userId, notice_type: "late", notice_at: "2026-09-08T12:00:00Z", notice_reason: "My existing synthetic request", review_status: "pending", expected_at: "2026-09-11T17:30:00Z" },
    { ...attendance, id: "a-other-only", meeting_id: "m-other-only", student_id: otherRequester },
    { ...attendance, id: "a-ended", meeting_id: "m-ended", student_id: userId },
    { ...attendance, id: "a-finalized", meeting_id: "m-finalized", student_id: userId },
  ];
  data.snapshots = data.attendance.map(a => ({ ...snapshot, meeting_id: a.meeting_id, student_id: a.student_id, required: a.meeting_id !== "m-own-second" }));
  data.members = [
    { student_id: otherRequester, display_name: "Jordan Synthetic", member_status: "registered", team_area: "Build" },
    { student_id: userId, display_name: userId === lead ? "Lee Lead" : "Alex Student", member_status: "registered", team_area: "Build" },
  ];
}
async function localInput(page: Page, iso: string) {
  return page.evaluate(value => {
    const date = new Date(value);
    return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }, iso);
}
async function assertPersonalRequestControls(page: Page) {
  const workspace = page.locator(".attendance-section");
  for (const name of ["Excuse", "Deny", "Save attendance review", "Assign strike", "Edit meeting", "Rotate check-in code", "Complete attendance"]) {
    await expect(workspace.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(workspace.getByLabel("Review reason", { exact: true })).toHaveCount(0);
  await expect(workspace.getByText("Advanced attendance & strikes", { exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("group", { name: "Live roster filter" })).toHaveCount(0);
  await expect(workspace.getByText("Another member private request", { exact: true })).toHaveCount(0);
}
async function openPersonalRequest(page: Page, meetingId = "m1") {
  await page.getByRole("combobox", { name: "Meeting for my request", exact: true }).selectOption(meetingId);
  await page.getByRole("button", { name: "Report my attendance issue", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meeting details" });
  await expect(dialog).toBeVisible();
  return dialog;
}
const leadershipRequestPersonas = [
  { name: "lead", role: "lead", reviewer: false },
  { name: "student Program Manager", role: "student", reviewer: true },
  { name: "lead Program Manager", role: "lead", reviewer: true },
] as const;
for (const width of [390, 1440]) {
  for (const persona of leadershipRequestPersonas) {
    test(`personal attendance requests: ${persona.name} owns absent, late, early and edits ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const { data, calls } = await mock(page, persona.role, { configure: (data, id) => personalRequestFixture(data, id, persona.reviewer) });
      await page.clock.setFixedTime(new Date("2026-09-09T15:00:00Z"));
      const otherBefore = structuredClone(data.attendance.filter(a => a.id !== "a-own"));
      await page.goto("/#attendance/my-requests");
      const personalTab = page.locator('.att-tabs a[href="#attendance/my-requests"]');
      await expect(personalTab).toHaveAttribute("aria-current", "page");
      await expect(personalTab).toContainText("My Requests");
      await expect(personalTab.locator("span")).toHaveText("1");
      await expect(page.locator('.att-tabs a[href="#attendance/notices"]')).toContainText("Absence & Schedule Requests");
      await expect(page.locator(".att-request-card")).toHaveCount(1);
      await expect(page.locator(".att-request-card")).toContainText("My existing synthetic request");
      expect(await page.getByRole("combobox", { name: "Meeting for my request", exact: true }).locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).filter(Boolean))).toEqual(["m1", "m-own-second"]);
      await assertPersonalRequestControls(page);
      const dialog = await openPersonalRequest(page);
      await expect(dialog.getByRole("heading", { name: "Preseason build", exact: true })).toBeVisible();
      await expect(dialog.getByText("Meeting controls", { exact: true })).toHaveCount(0);
      for (const [index, kind] of (["absent", "late", "early", "early"] as const).entries()) {
        await dialog.getByText(index ? "Edit request" : "Report attendance issue", { exact: true }).click();
        const form = dialog.locator(".att-report-issue form");
        await form.getByLabel("How will your attendance be affected?").selectOption(kind);
        const planned = kind === "late" ? "2026-09-10T17:45:00.000Z" : "2026-09-10T18:15:00.000Z";
        if (kind !== "absent") await form.getByLabel(kind === "late" ? "Expected arrival" : "Expected departure", { exact: true }).fill(await localInput(page, planned));
        const reason = index === 3 ? "Updated departure arrangement" : `My synthetic ${kind} request`;
        await form.getByRole("textbox", { name: "Reason", exact: true }).fill(reason);
        await form.getByRole("button", { name: "Report an attendance issue", exact: true }).click();
        await expect(dialog.getByText("Attendance request submitted for leadership review", { exact: true })).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "Reason", exact: true })).not.toBeVisible();
        expect(calls).toHaveLength(index + 1);
        expect(calls[index]).toEqual({ p: { meeting_id: "m1", version: index + 1, notice_type: kind, expected_at: kind === "absent" ? null : planned, reason } });
        await expect(dialog.locator(".att-request-reason")).toHaveText(reason);
        await assertPersonalRequestControls(page);
      }
      const own = data.attendance.find(a => a.id === "a-own")!;
      expect(own).toMatchObject({ physical_status: "pending", review_status: "pending", checked_in_at: null, left_at: null, version: 5 });
      expect(data.attendance.filter(a => a.id !== "a-own")).toEqual(otherBefore);
      expect(data.strikes).toEqual([]);
      await dialog.screenshot({ path: `test-results/attendance-self-requests-dialog-${persona.name.replaceAll(" ", "-")}-${width}.png` });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.locator(".att-request-card")).toHaveCount(2);
      await expect(personalTab.locator("span")).toHaveText("2");
      await page.locator(".att-request-card").filter({ hasText: "Updated departure arrangement" }).getByRole("button", { name: "Open meeting", exact: true }).click();
      await expect(dialog.locator(".att-request-reason")).toHaveText("Updated departure arrangement");
      await assertPersonalRequestControls(page);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.screenshot({ path: `test-results/attendance-self-requests-page-${persona.name.replaceAll(" ", "-")}-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      // The leadership queue and calendar continue to use their own controls.
      await page.locator('.att-tabs a[href="#attendance/notices"]').click();
      await expect(page.getByRole("heading", { name: "Absence & Schedule Requests", exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Meeting for my request", exact: true })).toHaveCount(0);
      const otherCard = page.locator(".att-request-card").filter({ hasText: "Another member private request" });
      await expect(otherCard).toBeVisible();
      await expect(otherCard.getByText("Advanced attendance & strikes", { exact: true })).toBeVisible();
      if (persona.reviewer) {
        await otherCard.getByLabel("Review reason", { exact: true }).fill("Synthetic confirmation checked");
        await otherCard.getByRole("button", { name: "Excuse", exact: true }).click();
        await expect.poll(() => calls.at(-1)?.p.attendance_id).toBe("a-other");
        expect(calls.at(-1)).toMatchObject({ action: "attendance", p: { review_status: "excused" } });
        expect(own.review_status).toBe("pending");
      } else {
        await expect(otherCard.getByRole("button", { name: "Excuse", exact: true })).toHaveCount(0);
      }
      await page.locator('.att-tabs a[href="#attendance/calendar"]').click();
      await expect(page.getByRole("button", { name: "New meeting", exact: true })).toHaveCount(persona.role === "lead" ? 1 : 0);
      await page.getByRole("button", { name: /Preseason build/ }).click();
      await expect(dialog.getByRole("group", { name: "Live roster filter" })).toBeVisible();
      await expect(dialog.getByText("Meeting controls", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Edit meeting", exact: true })).toHaveCount(persona.role === "lead" ? 1 : 0);
      expect(errors).toEqual([]);
    });

    test(`personal attendance requests: checked-in ${persona.name} can request early departure ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { data, calls } = await mock(page, persona.role, { configure: (data, id) => {
        personalRequestFixture(data, id, persona.reviewer);
        Object.assign(data.attendance.find(a => a.id === "a-own")!, { physical_status: "present", checked_in_at: "2026-09-10T17:00:00Z" });
        data.meetings[0].status = "closed";
      } });
      const otherBefore = structuredClone(data.attendance[0]);
      await page.goto("/#attendance/my-requests");
      const dialog = await openPersonalRequest(page);
      await expect(dialog.getByText("You're checked in", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Check out", exact: true })).toBeVisible();
      await dialog.getByText("Report attendance issue", { exact: true }).click();
      await expect(dialog.getByLabel("How will your attendance be affected?").locator("option")).toHaveCount(1);
      await expect(dialog.getByLabel("How will your attendance be affected?")).toHaveValue("early");
      await dialog.getByLabel("Expected departure", { exact: true }).fill(await localInput(page, "2026-09-10T18:00:00Z"));
      await dialog.getByRole("textbox", { name: "Reason", exact: true }).fill("My appointment after arrival");
      await dialog.getByRole("button", { name: "Report an attendance issue", exact: true }).click();
      await expect(dialog.getByText("Early departure requested · Pending", { exact: true })).toBeVisible();
      await assertPersonalRequestControls(page);
      expect(calls).toEqual([{ p: { meeting_id: "m1", version: 1, notice_type: "early", expected_at: "2026-09-10T18:00:00.000Z", reason: "My appointment after arrival" } }]);
      expect(data.attendance.find(a => a.id === "a-own")).toMatchObject({ physical_status: "present", checked_in_at: "2026-09-10T17:00:00Z", left_at: null, review_status: "pending" });
      await dialog.screenshot({ path: `test-results/attendance-self-requests-checked-in-${persona.name.replaceAll(" ", "-")}-${width}.png` });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator('.att-tabs a[href="#attendance/calendar"]').click();
      const current = page.getByRole("region", { name: "Your current attendance" });
      await expect(current.getByRole("button", { name: "Check out", exact: true })).toBeVisible();
      page.once("dialog", dialog => dialog.accept());
      await current.getByRole("button", { name: "Check out", exact: true }).click();
      await expect(current.getByText("Checked out", { exact: true })).toBeVisible();
      expect(calls.at(-1)).toEqual({ meeting_id: "m1" });
      expect(data.attendance.find(a => a.id === "a-own")).toMatchObject({ physical_status: "left_early", review_status: "pending" });
      expect(data.attendance[0]).toEqual(otherBefore);
      expect(data.strikes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

for (const width of [390, 1440]) {
  test(`personal attendance requests: ordinary student keeps My Requests route ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page, "student", { configure: (data, id) => personalRequestFixture(data, id) });
    await page.clock.setFixedTime(new Date("2026-09-09T15:00:00Z"));
    await page.goto("/#attendance/notices");
    await expect(page.locator('.att-tabs a[href="#attendance/notices"]')).toContainText("My Requests");
    await expect(page.locator('.att-tabs a[href="#attendance/my-requests"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Absence & Schedule Requests/ })).toHaveCount(0);
    await assertPersonalRequestControls(page);
    await expect(page.locator(".att-request-card")).toHaveCount(1);
    const dialog = await openPersonalRequest(page);
    await dialog.getByText("Report attendance issue", { exact: true }).click();
    await dialog.getByRole("textbox", { name: "Reason", exact: true }).fill("Ordinary student request");
    await dialog.getByRole("button", { name: "Report an attendance issue", exact: true }).click();
    await expect(dialog.getByText("Absence requested · Pending", { exact: true })).toBeVisible();
    expect(calls).toEqual([{ p: { meeting_id: "m1", version: 1, notice_type: "absent", expected_at: null, reason: "Ordinary student request" } }]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Calendar", exact: true }).click();
    await page.getByRole("button", { name: /Preseason build/ }).click();
    await expect(dialog.getByText("Edit request", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Live roster filter" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New meeting", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
for (const role of ["mentor", "admin"]) {
  test(`personal attendance requests: ${role} retains review queue without a student request tab`, async ({ page }) => {
    const { calls } = await mock(page, role);
    await page.goto("/#attendance/my-requests");
    await expect(page.getByRole("heading", { name: "Attendance · needs attention", exact: true })).toBeVisible();
    await expect(page.locator(".att-tabs").getByRole("link", { name: /My Requests/ })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Meeting for my request", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Report my attendance issue", exact: true })).toHaveCount(0);
    await page.locator('.att-tabs a[href="#attendance/notices"]').click();
    await expect(page.getByRole("heading", { name: "Absence & Schedule Requests", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Meeting for my request", exact: true })).toHaveCount(0);
    expect(calls).toEqual([]);
  });
}
for (const account of [{ role: "lead", active: false }, { role: "student", active: false }, { role: "readonly", active: true }]) {
  test(`personal attendance requests: ${account.active ? "active" : "inactive"} ${account.role} cannot access personal or review controls`, async ({ page }) => {
    const { calls } = await mock(page, account.role, { active: account.active });
    for (const route of ["my-requests", "notices"]) {
      await page.goto(`/#attendance/${route}`);
      await expect(page.locator(".attendance-section").getByRole("alert")).toContainText("Attendance access requires an active student or leadership account.");
      await expect(page.getByRole("navigation", { name: "Attendance views" })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Meeting for my request", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Report my attendance issue", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Excuse", exact: true })).toHaveCount(0);
    }
    expect(calls).toEqual([]);
  });
}

test("personal attendance requests: empty own roster cannot borrow another member's meeting", async ({ page }) => {
  const { calls } = await mock(page, "lead");
  await page.goto("/#attendance/my-requests");
  await expect(page.getByText("No upcoming or in-progress meetings on your roster. Contact leadership if a meeting is missing or has already ended.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Meeting for my request", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Report my attendance issue", exact: true })).toHaveCount(0);
  expect(calls).toEqual([]);
});

for (const [index, persona] of leadershipRequestPersonas.entries()) {
  test(`personal attendance requests: ${persona.name} pending, stale draft, reopen and navigation recovery`, async ({ page }) => {
    await page.setViewportSize({ width: index ? 1440 : 390, height: 900 });
    const { data, calls, handleRequest } = await mock(page, persona.role, { configure: (data, id) => personalRequestFixture(data, id, persona.reviewer) });
    await page.clock.setFixedTime(new Date("2026-09-09T15:00:00Z"));
    await page.goto("/#attendance/my-requests");
    const dialog = await openPersonalRequest(page);
    await dialog.getByText("Report attendance issue", { exact: true }).click();
    await dialog.getByLabel("How will your attendance be affected?").selectOption("late");
    const expected = await localInput(page, "2026-09-10T17:45:00Z");
    await dialog.getByLabel("Expected arrival", { exact: true }).fill(expected);
    await dialog.getByRole("textbox", { name: "Reason", exact: true }).fill("Keep my unsent synthetic draft");
    const attempts: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rpc/team_attendance_request", async route => {
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) {
        await pending;
        Object.assign(data.attendance.find(a => a.id === "a-own")!, { version: 2, notice_type: "absent", notice_at: "2026-09-09T14:00:00Z", notice_reason: "Saved in another tab", review_status: "pending" });
        await route.fulfill({ status: 409, json: { message: "Attendance changed. Refresh and try again." } });
      } else await handleRequest(route);
    });
    const submit = dialog.getByRole("button", { name: "Report an attendance issue", exact: true });
    await submit.click();
    try {
      await expect(dialog.getByRole("status")).toHaveText("Updating attendance…");
      await expect(submit).toBeDisabled();
      await expect(dialog.getByRole("textbox", { name: "Reason", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
      await submit.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      await dialog.press("Escape");
      await expect(dialog).toBeVisible();
      expect(attempts).toHaveLength(1);
    } finally { release(); }
    await expect(dialog.getByRole("alert")).toContainText("Attendance changed");
    await expect(dialog.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("Keep my unsent synthetic draft");
    await expect(dialog.getByLabel("How will your attendance be affected?")).toHaveValue("late");
    await expect(dialog.getByLabel("Expected arrival", { exact: true })).toHaveValue(expected);
    await expect(submit).toBeEnabled();
    await expect(dialog.locator(".att-progress")).toHaveCount(0);
    expect(calls).toEqual([]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator(".att-request-card").filter({ hasText: "Saved in another tab" })).toBeVisible();
    await openPersonalRequest(page);
    await dialog.getByText("Edit request", { exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("Saved in another tab");
    await dialog.getByRole("textbox", { name: "Reason", exact: true }).fill("Retry after refreshing the latest request");
    await submit.click();
    await expect(dialog.getByText("Absence requested · Pending", { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(calls).toEqual([{ p: { meeting_id: "m1", version: 2, notice_type: "absent", expected_at: null, reason: "Retry after refreshing the latest request" } }]);
    await dialog.getByText("Edit request", { exact: true }).click();
    await dialog.getByRole("textbox", { name: "Reason", exact: true }).fill("Navigation should discard this unsent draft");
    await dialog.getByRole("link", { name: "How to use Attendance →", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How to use Attendance", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#attendance\/my-requests$/);
    await expect(dialog).toHaveCount(0);
    await openPersonalRequest(page);
    await dialog.getByText("Edit request", { exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("Retry after refreshing the latest request");
    await dialog.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole("heading", { name: "How to use Attendance", exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
  });

  test(`personal attendance requests: ${persona.name} only loads and shows their own meeting history`, async ({ page }) => {
    const { data, calls } = await mock(page, persona.role, { configure: (data, id) => {
      personalRequestFixture(data, id, persona.reviewer);
      data.history = [
        { id: 1, meeting_id: "m1", student_id: otherRequester, entity: "team_attendance", action: "Other member audit entry", performed_by: otherRequester, performed_at: "2026-09-09T12:00:00Z", before_data: null, after_data: { reason: "Another member private history" } },
        { id: 2, meeting_id: "m1", student_id: id, entity: "team_attendance", action: "My own audit entry", performed_by: id, performed_at: "2026-09-09T12:00:00Z", before_data: null, after_data: { reason: "My synthetic history" } },
      ];
    } });
    const historyQueries: URL[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/team_attendance_history")) historyQueries.push(url);
    });
    await page.goto("/#attendance/my-requests");
    const dialog = await openPersonalRequest(page);
    await dialog.getByText("History & strikes", { exact: true }).click();
    await dialog.getByRole("button", { name: "View my history · Preseason build", exact: true }).click();
    await expect(dialog.locator("summary").filter({ hasText: "My own audit entry" })).toBeVisible();
    await expect(dialog).not.toContainText("Other member audit entry");
    await expect(dialog).not.toContainText("Another member private history");
    expect(historyQueries.at(-1)?.searchParams.get("meeting_id")).toBe("eq.m1");
    expect(historyQueries.at(-1)?.searchParams.get("student_id")).toBe(`eq.${data.policy!.user_id}`);
    expect(calls).toEqual([]);
  });
}

for (const reviewer of ['student','lead','mentor']) {
 test(`Program Manager requests show Mentor-only review controls to ${reviewer} reviewer`,async({page})=>{
  const {data,calls}=await mock(page,reviewer,{configure:(data,id)=>{
   personalRequestFixture(data,id,true);
   data.policy!.can_review_program_manager_requests=reviewer==='mentor';
   data.policy!.mentor_review_required_for=[id,otherRequester];
   data.members[0].display_name='Morgan Program Manager';
   data.attendance[0].notice_reason='Program Manager appointment';
  }});
  await page.goto('/#attendance/notices');
  const card=page.locator('.att-request-card').filter({hasText:'Program Manager appointment'});
  await expect(card.getByText('Awaiting Mentor review',{exact:true})).toBeVisible();
  if(reviewer==='mentor') {
   await card.getByLabel('Review reason',{exact:true}).fill('Mentor checked the request');
   await card.getByRole('button',{name:'Excuse',exact:true}).click();
   await expect.poll(()=>calls).toEqual([{action:'attendance',p:{meeting_id:'m1',attendance_id:'a-other',version:1,review_status:'excused',left_at:null,explanation:'Mentor checked the request'}}]);
   expect(data.attendance[0]).toMatchObject({review_status:'excused',reviewed_by:lead});
  } else {
   for(const name of ['Excuse','Deny']) await expect(card.getByRole('button',{name,exact:true})).toHaveCount(0);
   await card.getByText('Advanced attendance & strikes',{exact:true}).click();
   await expect(card.getByLabel('Excuse status',{exact:true})).toHaveCount(0);
   expect(calls).toEqual([]);
  }
 });
}

test('Program Manager decision links show own decisions without changing the team pending filter',async({page})=>{
 await mock(page,'student',{configure:(data,id)=>{
  personalRequestFixture(data,id,true);
  Object.assign(data.attendance.find(a=>a.id==='a-own-second')!,{review_status:'excused',review_reason:'Mentor approved this request'});
 }});
 await page.goto('/#attendance/my-requests');
 await expect(page.getByRole('combobox',{name:'Request status',exact:true})).toHaveValue('all');
 await expect(page.getByText('Mentor approved this request',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Request status',exact:true}).selectOption('excused');
 await page.locator('.att-tabs a[href="#attendance/notices"]').click();
 await expect(page.getByRole('combobox',{name:'Request status',exact:true})).toHaveValue('pending');
 await expect(page.getByText('Another member private request',{exact:true})).toBeVisible();
 await expect(page.getByText('Mentor approved this request',{exact:true})).toHaveCount(0);
 await page.locator('.att-tabs a[href="#attendance/my-requests"]').click();
 await expect(page.getByRole('combobox',{name:'Request status',exact:true})).toHaveValue('excused');
 await expect(page.getByText('Mentor approved this request',{exact:true})).toBeVisible();
});
