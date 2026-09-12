import { test, expect } from "@playwright/test";
import { occurrences } from "../src/attendance/recurrence";
test("weekly, Tue/Thu and alternate Sundays preserve local times and end dates", () => {
  const dates = occurrences(
    "2026-09-08T18:00",
    "2026-09-08T21:00",
    "custom",
    "2026-09-17",
    1,
    [2, 4],
  );
  expect(dates.map((d) => new Date(d.starts_at).getDate())).toEqual([
    8, 10, 15, 17,
  ]);
  expect(
    dates.every(
      (d) =>
        new Date(d.starts_at).getHours() === 18 &&
        new Date(d.ends_at).getHours() === 21,
    ),
  ).toBe(true);
  expect(
    occurrences(
      "2026-09-12T09:00",
      "2026-09-12T16:00",
      "weekly",
      "2026-09-26",
      1,
      [],
    ),
  ).toHaveLength(3);
  expect(
    occurrences(
      "2026-09-13T09:00",
      "2026-09-13T16:00",
      "custom",
      "2026-10-11",
      2,
      [0],
    ).map((d) => new Date(d.starts_at).getDate()),
  ).toEqual([13, 27, 11]);
  const dst = occurrences(
    "2026-10-25T18:00",
    "2026-10-25T21:00",
    "weekly",
    "2026-11-08",
    1,
    [],
  );
  expect(dst.every((d) => new Date(d.starts_at).getHours() === 18)).toBe(true);
});
test("invalid and unbounded recurrence creates no dates", () => {
  expect(() =>
    occurrences(
      "2026-09-08T18:00",
      "2026-09-08T21:00",
      "custom",
      "2026-09-17",
      1,
      [],
    ),
  ).toThrow(/weekday/);
  expect(() =>
    occurrences(
      "2026-09-08T18:00",
      "2026-09-08T21:00",
      "custom",
      "2027-09-08",
      1,
      [0, 1, 2, 3, 4, 5, 6],
    ),
  ).toThrow(/52/);
  expect(() =>
    occurrences(
      "2026-09-08T18:00",
      "2026-09-08T21:00",
      "weekly",
      "2026-09-01",
      1,
      [],
    ),
  ).toThrow(/end date/);
  expect(() =>
    occurrences(
      "2026-09-08T18:00",
      "2026-09-08T21:00",
      "custom",
      "2026-09-17",
      0,
      [0],
    ),
  ).toThrow(/1–12/);
});
