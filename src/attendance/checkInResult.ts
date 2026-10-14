/** Check-in has application outcomes inside an HTTP-success RPC response.
 * Preserve the legacy messages during an additive database/frontend rollout. */
export type CheckInSuccess = {
  status: "checked_in" | "already_recorded";
  message: string;
};

export function checkInResult(value: unknown): CheckInSuccess {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (data.status === "rate_limited") {
    const retry = typeof data.retry_at === "string" ? Date.parse(data.retry_at) : NaN;
    const when = Number.isFinite(retry)
      ? `Try again at ${new Date(retry).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} or contact leadership.`
      : "Try again in 15 minutes or contact leadership.";
    throw new Error(`Too many attempts. ${when}`);
  }
  if (data.error) throw new Error(String(data.error));
  if (data.status === "invalid_code") throw new Error("Invalid meeting code");
  if (data.status === "checked_in" || (data.status === undefined && data.message === "Checked in")) {
    return { status: "checked_in", message: "Check-in recorded" };
  }
  if (data.status === "already_recorded" || (data.status === undefined && data.message === "Attendance already recorded")) {
    return { status: "already_recorded", message: "Attendance already recorded. No new check-in was made." };
  }
  // An HTTP 200 alone must never be represented as a successful check-in.
  throw new Error("Check-in could not be confirmed. Refresh attendance before trying again.");
}

export function checkInSuccessMessage(value: unknown): string {
  if (value && typeof value === "object" && "status" in value) {
    if (value.status === "checked_in") return "Check-in recorded";
    if (value.status === "already_recorded") return "Attendance already recorded. No new check-in was made.";
  }
  throw new Error("Check-in could not be confirmed. Refresh attendance before trying again.");
}
