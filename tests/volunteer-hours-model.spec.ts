import { test, expect } from "@playwright/test";
import {
  timeCandidates,
  resolveTime,
  weekStart,
  hours,
  csvCell,
  personalCsv,
} from "../src/attendance/volunteer/model";
test("DST spring gap rejected, fall fold requires an explicit instant, overnight supported", () => {
  expect(timeCandidates("2026-03-08T02:30", "America/Chicago")).toEqual([]);
  expect(timeCandidates("2025-11-02T01:30", "America/Chicago")).toEqual([
    { iso: "2025-11-02T06:30:00.000Z", label: "UTC−05:00" },
    { iso: "2025-11-02T07:30:00.000Z", label: "UTC−06:00" },
  ]);
  expect(timeCandidates("2026-02-30T12:30", "UTC")).toEqual([]);
  expect(timeCandidates("2026-10-06T23:30", "Asia/Kathmandu")[0].iso).toBe(
    "2026-10-06T17:45:00.000Z",
  );
  expect(weekStart("2026-10-11")).toBe("2026-10-05");
  expect(weekStart("2026-10-12")).toBe("2026-10-12");
});
test("CSV formula escaping, quote escaping, running and void excluded", () => {
  expect(csvCell(" =CMD()")).toBe('"\' =CMD()"');
  expect(csvCell('a,"b"')).toBe('"a,""b"""');
  const e: any = {
    started_at: "2026-10-06T10:00:00Z",
    ended_at: "2026-10-06T12:00:00Z",
    voided_at: null,
    activity: "mentoring",
    notes: "=FORMULA()",
    time_zone: "UTC",
  };
  expect(hours(e)).toBe(2);
  expect(hours({ ...e, ended_at: null })).toBe(0);
  expect(hours({ ...e, voided_at: "2026-10-07" })).toBe(0);
  expect(personalCsv([e], [])).toContain("'=FORMULA()");
});

test("unchanged correction preserves exact seconds and repeated-hour instant", () => {
  expect(
    resolveTime(
      "2025-11-02T01:30",
      "America/Chicago",
      "2025-11-02T07:30:00.000Z",
      "2025-11-02T07:30:49.123Z",
    ),
  ).toBe("2025-11-02T07:30:49.123Z");
  expect(
    resolveTime(
      "2025-11-02T01:30",
      "America/Chicago",
      "2025-11-02T06:30:00.000Z",
      "2025-11-02T07:30:49.123Z",
    ),
  ).toBe("2025-11-02T06:30:00.000Z");
});

import {
  VolunteerRequestError,
  uncertainRequest,
} from "../src/attendance/volunteer/service";
test("gateway errors preserve the original request even without network wording", () => {
  expect(
    uncertainRequest(new VolunteerRequestError("Internal Server Error", true)),
  ).toBe(true);
  expect(
    uncertainRequest(new VolunteerRequestError("Entry changed", false)),
  ).toBe(false);
  expect(uncertainRequest(new Error("Failed to fetch"))).toBe(true);
});
