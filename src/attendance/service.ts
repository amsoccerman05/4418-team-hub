import { createSuiteClient } from "../suite-auth";
const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;
export const supabase =
  url && key
    ? createSuiteClient(url, key, { auth: { storageKey: "4418-team-hub-auth" } })
    : null;
export type Profile = {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
};
export type Member = {
  student_id: string;
  display_name: string;
  member_status: string;
  team_area: string;
};
export type Meeting = {
  id: string;
  title: string;
  meeting_type: string;
  starts_at: string;
  ends_at: string;
  late_minutes: number;
  requirement: string;
  status: string;
  check_in_open: boolean;
  code_expires_at: string | null;
  version: number;
};
export type Attendance = {
  id: string;
  meeting_id: string;
  student_id: string;
  physical_status: string;
  review_status: string;
  checked_in_at: string | null;
  left_at: string | null;
  notice_at: string | null;
  notice_reason: string;
  review_reason: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  version: number;
};
export type Snapshot = {
  meeting_id: string;
  student_id: string;
  required: boolean;
  member_status: string;
  team_area: string;
};
export type Strike = {
  id: string;
  attendance_id: string;
  meeting_id: string;
  student_id: string;
  category: string;
  quantity: number;
  explanation: string;
  assigned_by: string;
  assigned_at: string;
  rescinded_at: string | null;
  rescind_reason: string | null;
};
export type History = {
  id: number;
  meeting_id: string | null;
  student_id: string | null;
  entity: string;
  action: string;
  performed_by: string;
  performed_at: string;
  before_data: unknown;
  after_data: unknown;
};
export type Data = {
  meetings: Meeting[];
  attendance: Attendance[];
  snapshots: Snapshot[];
  strikes: Strike[];
  history: History[];
  members: Member[];
};
export const isManager = (p: Profile) =>
  p.active && ["lead", "admin", "mentor"].includes(p.role);
export async function rpc(action: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error("Attendance is not configured.");
  const { data, error } = await supabase.rpc(action, args);
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
export const manage = (action: string, p: Record<string, unknown>) =>
  rpc("team_attendance_manage", { action, p });
async function allRows<T>(
  table: string,
  columns = "*",
  order = "id",
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    let query = supabase!.from(table).select(columns).order(order);
    if (table === "team_meeting_members") query = query.order("meeting_id");
    else if (order !== "id") query = query.order("id");
    const { data, error } = await query.range(from, from + 499);
    if (error) throw error;
    rows.push(...(data as unknown as T[]));
    if (data.length < 500) return rows;
  }
}
export async function loadData(manager: boolean): Promise<Data> {
  if (!supabase) throw new Error("Attendance is not configured.");
  const [meetings, attendance, snapshots, strikes, members] = await Promise.all(
    [
      allRows<Meeting>(
        "team_meetings",
        "id,title,meeting_type,starts_at,ends_at,late_minutes,requirement,status,check_in_open,code_expires_at,version",
        "starts_at",
      ),
      allRows<Attendance>("team_attendance"),
      allRows<Snapshot>(
        "team_meeting_members",
        "meeting_id,student_id,required,member_status,team_area",
        "student_id",
      ),
      allRows<Strike>("team_attendance_strikes"),
      manager
        ? (rpc("team_attendance_roster", {}) as Promise<Member[]>)
        : Promise.resolve([] as Member[]),
    ],
  );
  return {
    meetings: meetings.reverse(),
    attendance,
    snapshots,
    strikes,
    members,
    history: [],
  };
}
export async function loadHistory(meetingId: string) {
  const { data, error } = await supabase!
    .from("team_attendance_history")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("performed_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as History[];
}
export function summary(data: Data, studentId: string) {
  const finalized = new Set(
    data.meetings.filter((m) => m.status === "finalized").map((m) => m.id),
  );
  const required = new Set(
    data.snapshots
      .filter((s) => s.student_id === studentId && s.required)
      .map((s) => s.meeting_id),
  );
  const records = data.attendance.filter(
    (a) =>
      a.student_id === studentId &&
      finalized.has(a.meeting_id) &&
      required.has(a.meeting_id) &&
      !["excused", "not_required"].includes(a.review_status),
  );
  const attended = records.filter((a) =>
    ["present", "late", "left_early"].includes(a.physical_status),
  ).length;
  const strikes = data.strikes
    .filter((s) => s.student_id === studentId && !s.rescinded_at)
    .reduce((n, s) => n + s.quantity, 0);
  return {
    total: records.length,
    attended,
    percent: records.length
      ? Math.round((attended / records.length) * 100)
      : null,
    late: records.filter((a) => a.physical_status === "late").length,
    early: records.filter((a) => a.physical_status === "left_early").length,
    strikes,
  };
}
export const strikeAction = (n: number) =>
  n >= 5
    ? "Leadership review for possible removal required"
    : n >= 3
      ? "Warning / parent contact required"
      : "No strike threshold reached";
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
