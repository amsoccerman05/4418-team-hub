import { supabase } from "../service";
export const activities = {
  mentoring: "Mentoring",
  setup_cleanup: "Setup & cleanup",
  planning: "Planning & preparation",
  outreach: "Outreach",
  travel: "Team travel",
  other: "Other",
};
export type Activity = keyof typeof activities;
export type Entry = {
  id: string;
  user_id: string;
  season_id: string | null;
  meeting_id: string | null;
  activity: Activity;
  started_at: string;
  ended_at: string | null;
  time_zone: string;
  activity_date: string;
  notes: string;
  source: "timer" | "manual";
  voided_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Context = {
  user_id: string;
  can_view_team: boolean;
  server_now: string;
  seasons: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    status: string;
  }[];
};
export type Audit = {
  id: number;
  entry_id: string;
  action: string;
  reason: string;
  performed_at: string;
  before_data: Entry | null;
  after_data: Entry;
};
export type TeamTotal = {
  user_id: string;
  display_name: string;
  season_id: string | null;
  activity: Activity;
  week_start: string;
  hours: number;
  completed_entries: number;
  running_entries: number;
  missing_checkouts: number;
};
export class VolunteerRequestError extends Error {
  constructor(
    message: string,
    public uncertain: boolean,
  ) {
    super(message);
  }
}
export function uncertainRequest(error: unknown) {
  return error instanceof VolunteerRequestError
    ? error.uncertain
    : error instanceof Error &&
        /timeout|abort|fetch|network|connection/i.test(error.message);
}
async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  if (!supabase) throw Error("Team connection unavailable.");
  const { data, error, status } = await supabase
    .rpc(name, args)
    .abortSignal(AbortSignal.timeout(15000));
  if (error)
    throw new VolunteerRequestError(
      error.message,
      status === 0 || status >= 500,
    );
  if (data === null)
    throw new VolunteerRequestError(
      "The response could not be verified.",
      true,
    );
  return data as T;
}
export async function loadVolunteer() {
  const context = await rpc<Context>("team_volunteer_context");
  const entries: Entry[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase!
      .from("team_volunteer_entries")
      .select("*")
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, from + 499)
      .abortSignal(AbortSignal.timeout(15000));
    if (error) throw Error(error.message);
    entries.push(...(data as Entry[]));
    if (data.length < 500) break;
  }
  return { context, entries };
}
export const saveVolunteer = (action: string, p: Record<string, unknown>) =>
  rpc<Entry>("team_volunteer_save", { action, p });
export const loadAudit = (entry: string, before_id: number | null = null) =>
  rpc<Audit[]>("team_volunteer_history", { entry, before_id });
export const loadTeamTotals = (selected_season: string | null = null) =>
  rpc<TeamTotal[]>("team_volunteer_summary", { selected_season });
