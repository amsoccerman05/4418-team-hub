import type { Attendance, Data, Meeting } from "./service";

const absenceCategory = "unexcused absence";

function required(data: Data, a: Attendance) {
  return data.snapshots.some(s => s.meeting_id === a.meeting_id && s.student_id === a.student_id && s.required);
}

function previouslyAssigned(data: Data, a: Attendance) {
  // A rescission is a prior leadership decision, not permission to add it again.
  return data.strikes.some(s => s.attendance_id === a.id
    && (s.source === "automatic_absence" || s.category.trim().toLowerCase() === absenceCategory));
}

function unexcusedAbsence(a: Attendance, finalizing: boolean) {
  return (a.physical_status === "absent" || (finalizing && a.physical_status === "pending"))
    && ["none", "denied"].includes(a.review_status);
}

// Presentation only. The server locks and rechecks the records and this count.
export function automaticAbsenceStrikePreview(data: Data, meeting: Meeting) {
  if (meeting.status === "finalized") return { additions: [], pendingRequests: [] };
  const missing = data.attendance.filter(a => a.meeting_id === meeting.id && required(data, a)
    && ["absent", "pending"].includes(a.physical_status));
  return {
    additions: missing.filter(a => unexcusedAbsence(a, true) && !previouslyAssigned(data, a)),
    pendingRequests: missing.filter(a => a.review_status === "pending"),
  };
}

export function automaticAbsenceFinalizationConfirmation(count: number, pending: number) {
  return `Complete attendance? Missing required members will be marked absent. This will assign ${count} automatic Unexcused Absence ${count === 1 ? "strike" : "strikes"}, one per eligible unexcused absence.`
    + (pending ? ` ${pending} pending absence ${pending === 1 ? "request is" : "requests are"} skipped until reviewed.` : "")
    + " Leadership can still make audited attendance corrections.";
}

export function automaticAbsenceCorrection(data: Data, meeting: Meeting, next: Attendance) {
  if (meeting.status !== "finalized" || !meeting.auto_absence_strikes_enabled) return { additions: 0, rescissions: 0 };
  const eligible = required(data, next) && unexcusedAbsence(next, false);
  return {
    additions: eligible && !previouslyAssigned(data, next) ? 1 : 0,
    rescissions: eligible ? 0 : data.strikes.filter(s => s.attendance_id === next.id
      && s.source === "automatic_absence" && !s.rescinded_at).length,
  };
}
