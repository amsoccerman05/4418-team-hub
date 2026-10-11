import type { Attendance, Data, Meeting, Snapshot } from "./service";

export function localMeetingTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
// Reject nonexistent wall-clock times. Expose both instants during a DST fall-back
// instead of silently choosing one. UTC instants are the database contract.
export function localTimeChoices(value: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed)) return [];
  const choices: string[] = [];
  for (let delta = -180; delta <= 180; delta += 15) {
    const instant = new Date(+parsed + delta * 60000).toISOString();
    if (localMeetingTime(instant) === value) choices.push(instant);
  }
  return choices;
}
export function resolveMeetingTime(value: string, original: string, choice: string) {
  if (value === localMeetingTime(original)) {
    if (!choice) return original; // Preserve exact seconds and repeated-hour offset.
  }
  const options = localTimeChoices(value);
  if (!options.length) throw new Error("This local time does not exist. Choose a valid date and time outside the daylight-saving gap.");
  if (options.length > 1 && !options.includes(choice)) throw new Error("This time occurs twice when daylight saving ends. Choose the intended UTC offset.");
  return options.length > 1 ? choice : options[0];
}
export function offsetLabel(instant: string) {
  return new Date(instant).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
}
export function meetingLockReason(meeting: Meeting, now = Date.now()) {
  if (meeting.status === "finalized") return "This meeting’s attendance is complete. Meeting details are locked.";
  if (now >= Date.parse(meeting.starts_at)) return "This meeting has started. Meeting details can only be edited before it starts.";
  return "";
}
export function scheduleLockReason(meeting: Meeting, records: Attendance[], hasStrikes: boolean, now = Date.now()) {
  const locked = meetingLockReason(meeting, now);
  if (locked) return locked;
  if (hasStrikes || records.some(a => a.checked_in_at || a.left_at || a.physical_status !== "pending" || a.reviewed_at || ["excused", "denied"].includes(a.review_status)))
    return "This meeting already has recorded attendance or a reviewed decision. Its schedule is locked to preserve those records.";
  return "";
}

const sortedIds = (ids: readonly string[]) => [...new Set(ids)].sort();

// A snapshot is the source of truth, including people no longer returned by the
// eligible roster endpoint. Filtering through data.members would drop them.
export function requiredStudentIds(snapshots: Snapshot[], meetingId: string) {
  return sortedIds(snapshots.filter(s => s.meeting_id === meetingId && s.required).map(s => s.student_id));
}
export function requiredRosterChanges(before: readonly string[], after: readonly string[]) {
  const beforeIds = sortedIds(before), afterIds = sortedIds(after);
  const previous = new Set(beforeIds), next = new Set(afterIds);
  const added = afterIds.filter(id => !previous.has(id));
  const removed = beforeIds.filter(id => !next.has(id));
  return { before: beforeIds.length, after: afterIds.length, added, removed, changed: added.length > 0 || removed.length > 0 };
}
export function participantRequirementLockReason(record: Attendance | undefined, hasStrikes: boolean) {
  if (record && (record.notice_at || record.review_status === "pending" || record.notice_type
    || record.notice_reason?.trim() || record.expected_at)) {
    return "An existing attendance request locks this participant’s required status. Use the normal request review workflow.";
  }
  if (hasStrikes || (record && (record.checked_in_at || record.left_at || record.physical_status !== "pending"
    || record.reviewed_at || record.reviewed_by || record.review_reason?.trim() || ["excused", "denied"].includes(record.review_status)))) {
    return "Recorded attendance, a reviewed decision, or a strike locks this participant’s required status.";
  }
  return "";
}
export type RequiredRosterOption = { id: string; name: string; memberStatus: string; lockReason: string };
export function meetingRosterOptions(data: Data, meetingId: string, preservedIds: readonly string[] = []): RequiredRosterOption[] {
  const members = new Map(data.members.map(member => [member.student_id, member]));
  const people = new Map(data.policy?.people.map(person => [person.id, person.name]) ?? []);
  const records = new Map(data.attendance.filter(a => a.meeting_id === meetingId).map(a => [a.student_id, a]));
  // Any strike, including a rescinded strike, protects the saved requirement.
  const strikes = new Set(data.strikes.filter(s => s.meeting_id === meetingId).map(s => s.student_id));
  const ids = sortedIds([
    ...data.members.filter(member => member.member_status !== "inactive").map(member => member.student_id),
    ...data.snapshots.filter(s => s.meeting_id === meetingId).map(s => s.student_id),
    ...preservedIds,
  ]);
  return ids.map(id => {
    const member = members.get(id);
    return {
      id,
      name: member?.display_name?.trim() || people.get(id)?.trim() || id,
      memberStatus: member?.member_status ?? "unavailable",
      lockReason: !member ? "Not on the current eligible roster. Required status is preserved."
        : member.member_status === "inactive" ? "Attendance membership is inactive. Required status is preserved."
        : participantRequirementLockReason(records.get(id), strikes.has(id)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function bulkRequiredSelection(options: RequiredRosterOption[], selected: readonly string[], requireAll: boolean) {
  const next = new Set(selected);
  for (const option of options) {
    if (option.lockReason) continue;
    if (requireAll) next.add(option.id);
    else next.delete(option.id);
  }
  return sortedIds([...next]);
}
export function rosterEditFields(before: readonly string[], after: readonly string[], acknowledged: boolean) {
  // Omit the roster contract altogether for title/schedule-only edits. This also
  // preserves active/registered/area modes when checkboxes return to their base.
  if (!requiredRosterChanges(before, after).changed) return {};
  return {
    required_student_ids: sortedIds(after),
    expected_required_student_ids: sortedIds(before),
    acknowledge_roster_change: acknowledged,
  };
}
