import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { automaticAbsenceStrikePreview, automaticAbsenceFinalizationConfirmation, automaticAbsenceCorrection } from "../src/attendance/automaticAbsenceStrikes";
import type { Attendance, Data, Strike } from "../src/attendance/service";

function fixture(): Data {
  return {
    meetings: [{ id: "meeting", title: "Synthetic practice", starts_at: "2026-09-10T17:00:00Z", ends_at: "2026-09-10T19:00:00Z", meeting_type: "preseason", late_minutes: 5, requirement: "registered", status: "closed", check_in_open: false, code_expires_at: null, version: 1, auto_absence_strikes_enabled: false }],
    attendance: [], snapshots: [], strikes: [], members: [], history: [],
  };
}
function add(data: Data, id: string, physical_status = "pending", review_status = "none", required = true) {
  const a: Attendance = { id, meeting_id: "meeting", student_id: id, physical_status, review_status, checked_in_at: null, left_at: null, notice_at: null, notice_reason: "", review_reason: "", reviewed_by: null, reviewed_at: null, version: 1 };
  data.attendance.push(a);
  data.snapshots.push({ meeting_id: "meeting", student_id: id, required, member_status: "registered", team_area: "Build" });
  data.members.push({ student_id: id, display_name: `Synthetic ${id}`, member_status: "registered", team_area: "Build" });
  return a;
}
function strike(a: Attendance, extra: Partial<Strike> = {}): Strike {
  return { id: `strike-${a.id}`, attendance_id: a.id, meeting_id: a.meeting_id, student_id: a.student_id, category: "Unexcused Absence", quantity: 1, explanation: "Synthetic fixture", assigned_by: "synthetic-coach", assigned_at: "2026-09-10T19:01:00Z", rescinded_at: null, rescind_reason: null, source: "manual", ...extra };
}

test("finalization previews required absent and pending unexcused records only", () => {
  const data = fixture();
  add(data, "missing"); add(data, "absent", "absent"); add(data, "denied", "absent", "denied");
  add(data, "pending-denied", "pending", "denied"); add(data, "request", "pending", "pending");
  add(data, "absent-request", "absent", "pending"); add(data, "optional", "absent", "none", false);
  add(data, "excused", "absent", "excused"); add(data, "not-required", "absent", "not_required");
  for (const status of ["present", "late", "left_early"]) add(data, status, status, "denied");
  add(data, "late-request", "late", "pending");
  const preview = automaticAbsenceStrikePreview(data, data.meetings[0]);
  expect(preview.additions.map(a => a.id)).toEqual(["missing", "absent", "denied", "pending-denied"]);
  expect(preview.pendingRequests.map(a => a.id)).toEqual(["request", "absent-request"]);
  expect(data.attendance[0].physical_status).toBe("pending");
  expect(data.strikes).toEqual([]);
});

for (const source of ["manual", "automatic_absence"] as const) {
  for (const rescinded of [false, true]) test(`prior ${source} strike blocks duplicate, rescinded=${rescinded}`, () => {
    const data = fixture(); const a = add(data, "member");
    data.strikes = [strike(a, { source, rescinded_at: rescinded ? "2026-09-11T10:00:00Z" : null })];
    expect(automaticAbsenceStrikePreview(data, data.meetings[0]).additions).toEqual([]);
    data.meetings[0].status = "finalized"; data.meetings[0].auto_absence_strikes_enabled = true;
    expect(automaticAbsenceCorrection(data, data.meetings[0], { ...a, physical_status: "absent" })).toEqual({ additions: 0, rescissions: 0 });
  });
}

test("unrelated manual strikes do not block an absence strike; all automatic-source rows do", () => {
  const data = fixture(); const a = add(data, "member");
  data.strikes = [strike(a, { category: "Other" })];
  expect(automaticAbsenceStrikePreview(data, data.meetings[0]).additions).toEqual([a]);
  data.strikes[0].source = "automatic_absence";
  expect(automaticAbsenceStrikePreview(data, data.meetings[0]).additions).toEqual([]);
  data.strikes = [strike(a, { attendance_id: "another-record" })];
  expect(automaticAbsenceStrikePreview(data, data.meetings[0]).additions).toEqual([a]);
});

test("absence category matching mirrors the server's whitespace and case normalization", () => {
  const data = fixture(); const a = add(data, "member", "absent");
  data.strikes = [strike(a, { category: "  unexcused ABSENCE  ", source: undefined })];
  expect(automaticAbsenceStrikePreview(data, data.meetings[0]).additions).toEqual([]);
  data.meetings[0].status = "finalized"; data.meetings[0].auto_absence_strikes_enabled = true;
  expect(automaticAbsenceCorrection(data, data.meetings[0], a).additions).toBe(0);
});

test("finalized legacy meetings are never previewed or reconciled", () => {
  const data = fixture(); const a = add(data, "member", "absent");
  data.meetings[0].status = "finalized";
  expect(automaticAbsenceStrikePreview(data, data.meetings[0])).toEqual({ additions: [], pendingRequests: [] });
  for (const enabled of [undefined, false]) {
    data.meetings[0].auto_absence_strikes_enabled = enabled;
    expect(automaticAbsenceCorrection(data, data.meetings[0], a)).toEqual({ additions: 0, rescissions: 0 });
  }
  data.meetings[0].auto_absence_strikes_enabled = true;
  expect(automaticAbsenceCorrection(data, data.meetings[0], a)).toEqual({ additions: 1, rescissions: 0 });
});

test("later denial can assign a first strike and corrections only rescind active automatic strikes", () => {
  const data = fixture(); const a = add(data, "member", "absent", "pending");
  const m = data.meetings[0]; m.status = "finalized"; m.auto_absence_strikes_enabled = true;
  expect(automaticAbsenceCorrection(data, m, a)).toEqual({ additions: 0, rescissions: 0 });
  expect(automaticAbsenceCorrection(data, m, { ...a, review_status: "denied" })).toEqual({ additions: 1, rescissions: 0 });
  data.strikes = [strike(a), strike(a, { id: "automatic", source: "automatic_absence" }), strike(a, { id: "rescinded", source: "automatic_absence", rescinded_at: "2026-09-11T10:00:00Z" })];
  for (const change of [{ physical_status: "present" }, { physical_status: "late" }, { physical_status: "left_early" }, { review_status: "excused" }, { review_status: "not_required" }, { review_status: "pending" }]) {
    expect(automaticAbsenceCorrection(data, m, { ...a, review_status: "none", ...change })).toEqual({ additions: 0, rescissions: 1 });
  }
  expect(automaticAbsenceCorrection(data, m, { ...a, review_status: "none" })).toEqual({ additions: 0, rescissions: 0 });
  expect(data.strikes.every(s => s.rescinded_at === null || s.id === "rescinded")).toBe(true);
});

test("correction preview requires a matching required snapshot and never treats pending as finalized absence", () => {
  const data = fixture(); const a = add(data, "member");
  const m = data.meetings[0]; m.status = "finalized"; m.auto_absence_strikes_enabled = true;
  expect(automaticAbsenceCorrection(data, m, a).additions).toBe(0);
  data.snapshots[0].meeting_id = "other";
  expect(automaticAbsenceCorrection(data, m, { ...a, physical_status: "absent" }).additions).toBe(0);
  data.snapshots[0].meeting_id = m.id; data.snapshots[0].required = false;
  expect(automaticAbsenceCorrection(data, m, { ...a, physical_status: "absent" }).additions).toBe(0);
});

test("confirmation states exact strike consequence, skipped pending requests, and correction availability", () => {
  expect(automaticAbsenceFinalizationConfirmation(1, 1)).toContain("assign 1 automatic Unexcused Absence strike,");
  expect(automaticAbsenceFinalizationConfirmation(1, 1)).toContain("1 pending absence request is skipped");
  expect(automaticAbsenceFinalizationConfirmation(0, 2)).toContain("assign 0 automatic Unexcused Absence strikes,");
  expect(automaticAbsenceFinalizationConfirmation(0, 2)).toContain("2 pending absence requests are skipped");
  expect(automaticAbsenceFinalizationConfirmation(0, 0)).not.toContain("pending absence");
  expect(automaticAbsenceFinalizationConfirmation(0, 0)).toContain("audited attendance corrections");
});

let renderDir = "";
let createElement: any, renderToStaticMarkup: any, AutomaticAbsencePreview: any, StrikeWorkspace: any;
test.beforeAll(() => {
  renderDir = mkdtempSync(join(tmpdir(), "automatic-absence-presentation-"));
  const bundle = join(renderDir, "render.cjs");
  buildSync({ stdin: { contents: `
    export { createElement } from 'react';
    export { renderToStaticMarkup } from 'react-dom/server';
    export { AutomaticAbsencePreview } from './src/attendance/AutomaticAbsencePreview';
    export { StrikeWorkspace } from './src/attendance/PolicyDashboard';
  `, resolveDir: resolve(".") }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", define: { "import.meta.env": "{}" }, outfile: bundle, logLevel: "silent" });
  ({ createElement, renderToStaticMarkup, AutomaticAbsencePreview, StrikeWorkspace } = createRequire(import.meta.url)(bundle));
});
test.afterAll(() => { if (renderDir) rmSync(renderDir, { recursive: true, force: true }); });

test("preview presents exact affected members and pending count without leaking identifiers", () => {
  const data = fixture(); add(data, "candidate"); add(data, "pending", "pending", "pending");
  data.members[0].display_name = "Synthetic <Member>";
  const html = renderToStaticMarkup(createElement(AutomaticAbsencePreview, { data, meeting: data.meetings[0] }));
  expect(html).toContain('aria-label="Automatic absence strike preview"');
  expect(html).toContain("Completing attendance will assign 1 automatic strike");
  expect(html).toContain("1 pending absence request skipped for now");
  expect(html).toContain("Synthetic &lt;Member&gt;");
  expect(html).not.toContain("Synthetic pending");
  expect(html).toContain("including rescinded strikes");
});

test("strike presentation labels only automatic source while retaining the accountable human", () => {
  const data = fixture(); const a = add(data, "member");
  data.members.push({ student_id: "synthetic-coach", display_name: "Synthetic Coach", member_status: "registered", team_area: "" });
  data.strikes = [strike(a, { source: "automatic_absence" }), strike(a, { id: "manual", source: "manual", category: "Other" })];
  const html = renderToStaticMarkup(createElement(StrikeWorkspace, { data, run: async () => {} }));
  expect(html.match(/>Automatic<\/span>/g)).toHaveLength(1);
  expect(html).toContain("Recorded by Synthetic Coach");
  expect(html).toContain("Assigned by Synthetic Coach");
  expect(html).not.toContain("synthetic-coach");
});
