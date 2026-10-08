import { createSuiteClient } from "../suite-auth";
const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;
export const supabase =
  url && key
    ? createSuiteClient(url, key, {
        auth: { storageKey: "4418-team-hub-auth" },
      })
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
  notice_type?: "absent" | "late" | "early" | null;
  expected_at?: string | null;
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
export type PolicyContext = {
 user_id: string; can_review: boolean; can_read_team: boolean; can_manage_meetings: boolean; strike_year_start: string|null;
 can_participate?: boolean;
 can_review_requests?: boolean;
 can_review_program_manager_requests?: boolean;
 mentor_review_required_for?: string[];
 people: {id:string;name:string;role:string;positions:string[]}[];
 warnings: {student_id:string;at:string;actor:string;note:string}[];
};
export type Data = {
  policy?: PolicyContext;
  meetings: Meeting[];
  attendance: Attendance[];
  snapshots: Snapshot[];
  strikes: Strike[];
  history: History[];
  members: Member[];
};
export const isManager = (p: Profile) =>
  p.active && ["lead", "admin", "mentor"].includes(p.role);
// Attendance participation is independent of shared suite management access.
// Existing student/lead clients stay compatible until the new policy context is deployed.
export const canParticipate = (p:Profile,data:Data) => p.active && ["student","lead","mentor","admin"].includes(p.role) && (
 data.policy?.can_participate ?? ["student","lead"].includes(p.role)
);
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
  const policy = await rpc("team_attendance_policy_context", {}) as PolicyContext;
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
      (manager || policy.can_read_team)
        ? (rpc("team_attendance_roster", {}) as Promise<Member[]>)
        : Promise.resolve([] as Member[]),
    ],
  );
  return {
    policy,
    meetings: meetings.reverse(),
    attendance,
    snapshots,
    strikes,
    members,
    history: [],
  };
}
export async function loadHistory(meetingId: string, studentId?: string) {
  let query = supabase!
    .from("team_attendance_history")
    .select("*")
    .eq("meeting_id", meetingId);
  if (studentId) query = query.eq("student_id", studentId);
  const { data, error } = await query.order("performed_at", { ascending: false }).limit(100);
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
    .filter((s) => s.student_id === studentId && !s.rescinded_at && inStrikeYear(data,s))
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
export const inStrikeYear = (data:Data,s:Strike) => !data.policy?.strike_year_start || Date.parse(s.assigned_at)>=Date.parse(data.policy.strike_year_start);
export const requiresMentorReview = (data:Data, studentId:string) => data.policy?.mentor_review_required_for?.includes(studentId) ?? false;
// No attendance argument means existing strike/policy management capability.
// Excuse decisions require the separate, affirmative server capability.
export const canReview = (data:Data,a?:Attendance) => !!data.policy?.can_review && (!a || (
 data.policy.can_review_requests===true && a.student_id!==data.policy.user_id
 && (!requiresMentorReview(data,a.student_id) || data.policy.can_review_program_manager_requests===true)
));
export const strikeAction = (n: number) =>
 n>=5 ? "Removal threshold reached" : n>=3 ? "Warning / parent contact previously required · monitor" : n>=2 ? "Warning / parent contact required" : "No strike threshold reached";
export function checkInControls(m:Meeting,now=Date.now()){
 const ended=now>=Date.parse(m.ends_at),complete=m.status==='finalized';
 const inWindow=!complete&&now>=Date.parse(m.starts_at)-1800000&&!ended;
 const open=inWindow&&m.status==='open'&&m.check_in_open&&!!m.code_expires_at&&now<Date.parse(m.code_expires_at);
 return {ended,complete,canOpen:inWindow,open,canClose:!complete&&['draft','open'].includes(m.status)&&(open||ended)};
}
export function noticeTiming(a:Attendance,m:Meeting){
 return !a.notice_at ? 'No request submitted' : Date.parse(m.starts_at)-Date.parse(a.notice_at)>=86400000 ? 'At least 24 hours’ notice' : 'Emergency / late notice · excused reason requires review';
}
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Presentation only: stored lifecycle values and attendance policy stay unchanged.
export function meetingState(m: Meeting, now = Date.now()): string {
  if (m.status === "finalized") return "Attendance complete";
  if (now >= Date.parse(m.ends_at)) return "Meeting ended";
  if (now >= Date.parse(m.starts_at)) return "In progress";
  return "Upcoming";
}
export function attendanceDuration(a: Attendance, meeting?: Meeting, now = Date.now()): string | null {
  if (!a.checked_in_at) return null;
  // Live elapsed time is presentation only, never a recorded departure.
  const live = meeting && meeting.status !== "finalized" && now < Date.parse(meeting.ends_at)
    && ["present", "late"].includes(a.physical_status);
  const end = a.left_at ? Date.parse(a.left_at) : live ? now : null;
  if (end === null) return null;
  const minutes = Math.floor((end - Date.parse(a.checked_in_at)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Selection aid only; the scoped server RPC validates time, membership and rights again.
export function rosterSyncMeetings(data:Data,member:Member,now=Date.now()):Meeting[] {
 if(member.member_status==="inactive")return [];
 return data.meetings.filter(m=>m.status!=="finalized" && Date.parse(m.starts_at)>now
  && (m.requirement==="active" || (m.requirement==="registered" && member.member_status==="registered")))
  .sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)||a.id.localeCompare(b.id));
}
