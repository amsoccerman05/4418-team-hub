import { activities, type Entry, type TeamTotal } from "./service";
export const zone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function wallTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
// Enumerate actual instants, rejecting spring-forward gaps and requiring explicit
// selection for a fall-back repeated time. Never let Date silently normalize it.
export function timeCandidates(local: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const naive = Date.parse(`${local}Z`);
  if (!Number.isFinite(naive)) return [];
  const options: { iso: string; label: string }[] = [];
  try {
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
      const iso = new Date(naive - offset * 60000).toISOString();
      if (wallTime(iso, timeZone) === local)
        options.push({
          iso,
          label: `UTC${offset >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`,
        });
    }
  } catch {
    return [];
  }
  return options.sort((a, b) => a.iso.localeCompare(b.iso));
}
export function resolveTime(
  local: string,
  timeZone: string,
  choice: string,
  original: string | null = null,
) {
  const candidates = timeCandidates(local, timeZone);
  const minute = original
    ? new Date(Math.floor(Date.parse(original) / 60000) * 60000).toISOString()
    : null;
  // Keep seconds/milliseconds when editing notes, category or reason only.
  if (
    original &&
    local === wallTime(original, timeZone) &&
    (!choice || choice === minute)
  )
    return original;
  return candidates.length === 1
    ? candidates[0].iso
    : candidates.find((c) => c.iso === choice)?.iso;
}
export function hours(e: Entry) {
  return !e.voided_at && e.ended_at
    ? (Date.parse(e.ended_at) - Date.parse(e.started_at)) / 3600000
    : 0;
}
export const displayHours = (n: number) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
export function weekStart(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
const csv = (rows: unknown[][]) =>
  "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
export const personalCsv = (
  entries: Entry[],
  seasons: { id: string; name: string }[],
) =>
  csv([
    [
      "Activity date",
      "Start (UTC)",
      "End (UTC)",
      "Time zone",
      "Activity",
      "Season",
      "Hours (completed only)",
      "Status",
      "Notes",
      "Entry ID",
      "Version",
    ],
    ...entries.map((e) => [
      e.activity_date,
      e.started_at,
      e.ended_at,
      e.time_zone,
      activities[e.activity],
      seasons.find((s) => s.id === e.season_id)?.name || "Unassigned",
      hours(e).toFixed(4),
      e.voided_at ? "Voided" : e.ended_at ? "Completed" : "Running (excluded)",
      e.notes,
      e.id,
      e.version,
    ]),
  ]);
export const teamCsv = (
  rows: TeamTotal[],
  seasons: { id: string; name: string }[],
) =>
  csv([
    [
      "Mentor",
      "Week starting Monday",
      "Activity",
      "Season",
      "Hours (completed only)",
      "Completed entries",
      "Running entries (excluded)",
      "Missing checkouts",
    ],
    ...rows.map((r) => [
      r.display_name,
      r.week_start,
      activities[r.activity],
      seasons.find((s) => s.id === r.season_id)?.name || "Unassigned",
      Number(r.hours).toFixed(4),
      r.completed_entries,
      r.running_entries,
      r.missing_checkouts,
    ]),
  ]);
export function downloadCsv(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
