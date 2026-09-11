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
      } else if (path.endsWith("/team_attendance_notice")) {
        calls.push(body);
        data.attendance[0].notice_at = "2026-09-09T15:00:00Z";
        data.attendance[0].notice_reason = body.reason;
        data.attendance[0].review_status = "pending";
        result = null;
      } else if (path.endsWith("/team_attendance_manage")) {
        calls.push(body);
        result = {};
        if (body.action === "open")
          result = { code: "123456", expires_at: "2026-09-10T18:00:00Z" };
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
    await page
      .getByRole("button", { name: "My Attendance", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Manage attendance" }),
    ).toHaveCount(0);
    await page.getByLabel("6-digit meeting code").fill("000000");
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid meeting code");
    await page.getByLabel("6-digit meeting code").fill("123456");
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(
      page.getByText("Check-in recorded", { exact: true }),
    ).toBeVisible();
    expect(calls[1]).toEqual({ meeting_id: "m1", code: "123456" });
    await page
      .getByText("Notify leadership / request excuse", { exact: true })
      .click();
    await page.getByLabel("Reason", { exact: true }).fill("Family commitment");
    await page.getByRole("button", { name: "Submit notice" }).click();
    await expect(
      page.getByText("Excuse review pending", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page
      .getByRole("heading", { name: "Attendance", exact: true })
      .click();
    await page.locator(".attendance-section").screenshot({
      path: `test-results/attendance-student-${width}.png`,
    });
  });
  test(`lead controls, separate reviews/strikes, and layout ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await mock(page, "lead");
    await page
      .getByRole("button", { name: "Manage attendance", exact: true })
      .click();
    await page.getByText("Create meeting", { exact: true }).first().click();
    await page.getByLabel("Title", { exact: true }).fill("Build night");
    await page.getByLabel("Start (your local time)").fill("2026-09-11T16:00");
    await page.getByLabel("End (your local time)").fill("2026-09-11T18:00");
    await page
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await expect
      .poll(() => calls.some((c) => c.action === "create"))
      .toBe(true);
    await page.getByLabel("Meeting", { exact: true }).selectOption("m1");
    await page.getByRole("button", { name: "Rotate check-in code" }).click();
    await expect(page.getByText("123456", { exact: true })).toBeVisible();
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
    await page
      .getByRole("heading", { name: "Attendance", exact: true })
      .click();
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
