import { test, expect } from "@playwright/test";
import { checkInResult, checkInSuccessMessage } from "../src/attendance/checkInResult";

test("explicit and legacy successful responses distinguish existing attendance", () => {
  for (const response of [{ status: "checked_in", message: "Checked in" }, { message: "Checked in" }]) {
    expect(checkInResult(response)).toEqual({ status: "checked_in", message: "Check-in recorded" });
    expect(checkInSuccessMessage(checkInResult(response))).toBe("Check-in recorded");
  }
  for (const response of [{ status: "already_recorded", message: "Attendance already recorded" }, { message: "Attendance already recorded" }]) {
    expect(checkInSuccessMessage(checkInResult(response))).toBe("Attendance already recorded. No new check-in was made.");
  }
});

test("HTTP-success error envelopes never become successful check-ins", () => {
  expect(() => checkInResult({ status: "invalid_code", error: "Invalid meeting code" })).toThrow("Invalid meeting code");
  expect(() => checkInResult({ status: "invalid_code" })).toThrow("Invalid meeting code");
  expect(() => checkInResult({ error: "Too many attempts. Try again in 15 minutes or contact leadership." })).toThrow("Too many attempts");
  expect(() => checkInResult({ status: "checked_in", error: "Request rejected" })).toThrow("Request rejected");
  for (const value of [null, {}, [], { message: "OK" }, { status: "unknown" }]) {
    expect(() => checkInResult(value)).toThrow("could not be confirmed");
    expect(() => checkInSuccessMessage(value)).toThrow("could not be confirmed");
  }
});

test("rate limit uses the server retry time without introducing client polling", () => {
  const retry = "2026-09-10T17:25:17Z";
  const formatted = new Date(retry).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  expect(() => checkInResult({ status: "rate_limited", retry_at: retry, error: "Too many attempts" })).toThrow(`Try again at ${formatted}`);
  for (const retry_at of [undefined, null, "bad time", 123]) {
    expect(() => checkInResult({ status: "rate_limited", retry_at })).toThrow("Try again in 15 minutes or contact leadership");
  }
});
