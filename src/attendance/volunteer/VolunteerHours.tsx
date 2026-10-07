import { useEffect, useRef, useState, type FormEvent } from "react";
import { Clock, Download, Plus, RefreshCw } from "lucide-react";
import type { Meeting, Profile } from "../service";
import {
  activities,
  loadVolunteer,
  saveVolunteer,
  loadAudit,
  loadTeamTotals,
  uncertainRequest,
  type Entry,
  type Context,
  type Audit,
  type TeamTotal,
  type Activity,
} from "./service";
import {
  zone,
  wallTime,
  timeCandidates,
  resolveTime,
  hours,
  displayHours,
  weekStart,
  personalCsv,
  teamCsv,
  downloadCsv,
} from "./model";
import "./volunteer.css";
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not load volunteer hours. Try again.";
const timestamp = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
type Draft = {
  activity: Activity;
  season_id: string;
  meeting_id: string;
  notes: string;
  start: string;
  end: string;
  time_zone: string;
  startChoice: string;
  endChoice: string;
  reason: string;
};
function draftFor(e: Entry | null, season: string): Draft {
  const tz = e?.time_zone || zone();
  return {
    activity: e?.activity || "mentoring",
    season_id: e?.season_id || season,
    meeting_id: e?.meeting_id || "",
    notes: e?.notes || "",
    start: e ? wallTime(e.started_at, tz) : "",
    end: e?.ended_at ? wallTime(e.ended_at, tz) : "",
    time_zone: tz,
    startChoice: e
      ? new Date(
          Math.floor(Date.parse(e.started_at) / 60000) * 60000,
        ).toISOString()
      : "",
    endChoice: e?.ended_at
      ? new Date(
          Math.floor(Date.parse(e.ended_at) / 60000) * 60000,
        ).toISOString()
      : "",
    reason: "",
  };
}
type Attempt = { action: string; p: Record<string, unknown> };
export function VolunteerHours({
  profile,
  meetings,
}: {
  profile: Profile;
  meetings: Meeting[];
}) {
  const [data, setData] = useState<{
      context: Context;
      entries: Entry[];
    } | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Attempt | null>(null);
  const [view, setView] = useState<"mine" | "team">("mine"),
    [season, setSeason] = useState("all"),
    [activity, setActivity] = useState("all"),
    [period, setPeriod] = useState("all"),
    [showVoids, setShowVoids] = useState(false);
  const [editor, setEditor] = useState<Entry | "new" | null>(null),
    [voiding, setVoiding] = useState<Entry | null>(null),
    [voidReason, setVoidReason] = useState("");
  const [audit, setAudit] = useState<{
      entry: Entry;
      rows: Audit[];
      more: boolean;
    } | null>(null),
    [team, setTeam] = useState<TeamTotal[] | null>(null),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  const [timerDraft, setTimerDraft] = useState<Draft>(() => draftFor(null, ""));
  const alive = useRef(true),
    lock = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      generation.current++;
      clearInterval(timer);
    };
  }, []);
  async function refresh() {
    const gen = ++generation.current;
    setError("");
    setBusy(true);
    setTeam(null);
    try {
      const next = await loadVolunteer();
      if (!alive.current || gen !== generation.current) return;
      setData(next);
      setOffset(Date.parse(next.context.server_now) - Date.now());
      if (next.context.can_view_team) {
        const totals = await loadTeamTotals();
        if (alive.current && gen === generation.current) setTeam(totals);
      }
    } catch (e) {
      if (alive.current && gen === generation.current) setError(messageOf(e));
    } finally {
      if (alive.current && gen === generation.current) setBusy(false);
    }
  }
  async function mutate(attempt: Attempt) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setPending(attempt);
    let saved = false;
    try {
      await saveVolunteer(attempt.action, attempt.p);
      saved = true;
      if (!alive.current) return;
      setPending(null);
      setEditor(null);
      setVoiding(null);
      setAudit(null);
      setMessage(
        attempt.action === "start"
          ? "Volunteer clock-in recorded"
          : attempt.action === "stop"
            ? "Volunteer clock-out recorded"
            : attempt.action === "void"
              ? "Entry voided; history preserved"
              : "Volunteer hours saved",
      );
      await refresh();
    } catch (e) {
      if (!alive.current) return;
      const detail = messageOf(e);
      const uncertain = uncertainRequest(e);
      if (!uncertain) setPending(null);
      setError(
        saved
          ? `Saved, but the refreshed view could not be loaded. Refresh hours to verify.`
          : uncertain
            ? "The response did not arrive. Refresh to check, or retry the same request below; it cannot create a duplicate."
            : detail,
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(action: string, p: Record<string, unknown>) {
    void mutate({ action, p: { ...p, request_id: crypto.randomUUID() } });
  }
  async function history(entry: Entry, more = false) {
    setError("");
    setBusy(true);
    try {
      const rows = await loadAudit(
        entry.id,
        more && audit ? audit.rows.at(-1)!.id : null,
      );
      if (alive.current)
        setAudit({
          entry,
          rows: more && audit ? [...audit.rows, ...rows] : rows,
          more: rows.length === 100,
        });
    } catch (e) {
      if (alive.current) setError(messageOf(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="att-panel">
        <h2>Volunteer hours</h2>
        {error ? (
          <>
            <p role="alert" className="att-error">
              {error}
            </p>
            <button onClick={() => void refresh()} disabled={busy}>
              Retry loading hours
            </button>
          </>
        ) : (
          <p role="status">Loading your volunteer hours…</p>
        )}
      </div>
    );
  const { context, entries } = data,
    serverNow = now + offset;
  const running = entries.find((e) => !e.ended_at && !e.voided_at),
    missing =
      !!running && serverNow - Date.parse(running.started_at) > 86400000;
  const currentWeek = weekStart(
    wallTime(new Date(serverNow).toISOString(), zone()).slice(0, 10),
  );
  const matches = (e: Entry) =>
    (season === "all" ||
      (season === "none" ? !e.season_id : e.season_id === season)) &&
    (activity === "all" || e.activity === activity) &&
    (period === "all" || weekStart(e.activity_date) === currentWeek);
  const filtered = entries.filter(matches),
    shown = filtered.filter((e) => showVoids || !e.voided_at),
    completed = filtered.filter((e) => e.ended_at && !e.voided_at);
  const totals = (team || []).filter(
    (r) =>
      (season === "all" ||
        (season === "none" ? !r.season_id : r.season_id === season)) &&
      (activity === "all" || r.activity === activity) &&
      (period === "all" || r.week_start === currentWeek),
  );
  const people = Object.values(
    totals.reduce<
      Record<
        string,
        { name: string; hours: number; running: number; missing: number }
      >
    >((acc, r) => {
      const p = (acc[r.user_id] ??= {
        name: r.display_name,
        hours: 0,
        running: 0,
        missing: 0,
      });
      p.hours += Number(r.hours);
      p.running += r.running_entries;
      p.missing += r.missing_checkouts;
      return acc;
    }, {}),
  );
  const byActivity = Object.keys(activities)
    .map((key) => ({
      key: key as Activity,
      total: completed
        .filter((e) => e.activity === key)
        .reduce((n, e) => n + hours(e), 0),
    }))
    .filter((r) => r.total > 0);
  return (
    <section className="volunteer-hours" aria-labelledby="volunteer-heading">
      <div className="att-toolbar att-view-heading">
        <div>
          <h2 id="volunteer-heading">
            <Clock size={21} aria-hidden="true" /> Volunteer hours
          </h2>
          <p>
            Record your actual time, including early setup, late cleanup, and
            work outside meetings.
          </p>
        </div>
        <button
          className="att-secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} aria-hidden="true" /> Refresh hours
        </button>
      </div>
      <p className="att-muted">
        This volunteer clock runs independently of meeting times and student
        check-in codes. It does not change attendance or strikes.
      </p>
      {error && (
        <p className="att-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="att-success" role="status">
          {message}
        </p>
      )}
      {pending && !busy && (
        <div className="att-panel">
          <p>
            A request is waiting for verification. Retrying uses the same
            request ID.
          </p>
          <button onClick={() => void mutate(pending)}>
            Retry same request
          </button>
        </div>
      )}
      {busy && <p role="status">Updating volunteer hours…</p>}
      <details className="att-panel volunteer-help">
        <summary>How to record volunteer hours</summary>
        <ol>
          <li>
            Choose an activity and optional season or meeting, then use{" "}
            <strong>Clock in for volunteering</strong> when you start. No
            meeting code is needed.
          </li>
          <li>
            Use <strong>Clock out from volunteering</strong> when you finish.
            Early arrival and late departure count as the actual time you
            record.
          </li>
          <li>
            For past work or a forgotten checkout, use{" "}
            <strong>Add past hours</strong> or <strong>Correct hours</strong>.
            Enter both actual dates and times. Overnight work uses the next day
            as the end date.
          </li>
          <li>
            Use <strong>History</strong> to review changes. Use{" "}
            <strong>Void entry</strong> with a reason for mistakes or
            duplicates; the record remains in history.
          </li>
        </ol>
        <p>
          Running timers and voided entries are excluded from totals. After 24
          hours a timer needs a corrected checkout. Each completed entry may be
          at most 24 hours. You can edit only your own entries. Admins and
          explicitly approved mentor report readers can view team totals.
        </p>
        <p>
          Times use the time zone shown with each entry. During a repeated
          daylight-saving hour, choose the UTC offset. Weeks start Monday and
          group entries by their start date.
        </p>
      </details>
      <fieldset className="att-fieldset" disabled={busy || !!pending}>
        <section
          className={`att-panel volunteer-clock ${missing ? "volunteer-attention" : ""}`}
          aria-label="Volunteer clock"
        >
          {running ? (
            <>
              <div>
                <span className="att-eyebrow">
                  {missing ? "Checkout needed" : "Your volunteer timer"}
                </span>
                <h3>
                  {missing
                    ? "Record your actual end time"
                    : `Clocked in · ${activities[running.activity]}`}
                </h3>
                <p>
                  Started {timestamp(running.started_at, running.time_zone)} ·{" "}
                  {running.time_zone}
                </p>
                <p className="volunteer-live">
                  {missing
                    ? "No hours counted yet"
                    : `${displayHours(Math.max(0, serverNow - Date.parse(running.started_at)) / 3600000)} live estimate`}
                </p>
                <p className="att-muted">
                  {missing
                    ? "This timer has been open more than 24 hours. Correct it before starting another."
                    : "This estimate is excluded from completed totals until you clock out."}
                </p>
              </div>
              <div className="att-toolbar">
                {!missing && (
                  <button
                    onClick={() =>
                      submit("stop", {
                        id: running.id,
                        version: running.version,
                      })
                    }
                  >
                    Clock out from volunteering
                  </button>
                )}
                <button
                  className="att-secondary"
                  onClick={() => setEditor(running)}
                >
                  Correct hours
                </button>
                <button
                  className="att-secondary"
                  onClick={() => {
                    setVoiding(running);
                    setVoidReason("");
                  }}
                >
                  Void entry
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit("start", {
                  activity: timerDraft.activity,
                  season_id: timerDraft.season_id || null,
                  meeting_id: timerDraft.meeting_id || null,
                  notes: timerDraft.notes,
                  time_zone: timerDraft.time_zone,
                });
              }}
            >
              <h3>Start your volunteer time</h3>
              <EntryFields
                draft={timerDraft}
                setDraft={setTimerDraft}
                context={context}
                meetings={meetings}
              />
              <p className="att-muted">
                The server records your start time when you clock in. Time zone:{" "}
                {timerDraft.time_zone}.
              </p>
              <button>Clock in for volunteering</button>
            </form>
          )}
        </section>
        <div className="att-toolbar volunteer-mode">
          <button
            type="button"
            className={view === "mine" ? "" : "att-secondary"}
            aria-pressed={view === "mine"}
            onClick={() => setView("mine")}
          >
            My hours
          </button>
          {context.can_view_team && (
            <button
              className={view === "team" ? "" : "att-secondary"}
              aria-pressed={view === "team"}
              onClick={() => setView("team")}
            >
              Team totals
            </button>
          )}
          <button className="att-secondary" onClick={() => setEditor("new")}>
            <Plus size={16} aria-hidden="true" /> Add past hours
          </button>
        </div>
      </fieldset>
      <div className="volunteer-filters">
        <label>
          Season
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="all">All seasons</option>
            <option value="none">Unassigned</option>
            {context.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Activity
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          >
            <option value="all">All activities</option>
            {Object.entries(activities).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">All dates</option>
            <option value="week">This week · {currentWeek}</option>
          </select>
        </label>
      </div>
      {view === "mine" ? (
        <>
          <div className="attendance-stats">
            <span>
              <strong>
                {displayHours(completed.reduce((n, e) => n + hours(e), 0))}
              </strong>{" "}
              Completed · selected filters
            </span>
            <span>
              <strong>{completed.length}</strong> Completed entries
            </span>
            <span>
              <strong>
                {filtered.filter((e) => !e.ended_at && !e.voided_at).length}
              </strong>{" "}
              Running · excluded
            </span>
          </div>
          {!!byActivity.length && (
            <ul
              className="volunteer-activity-totals"
              aria-label="Hours by activity"
            >
              {byActivity.map((r) => (
                <li key={r.key}>
                  {activities[r.key]} <strong>{displayHours(r.total)}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="att-toolbar">
            <label className="volunteer-check">
              <input
                type="checkbox"
                checked={showVoids}
                onChange={(e) => setShowVoids(e.target.checked)}
              />{" "}
              Show voided entries
            </label>
            <button
              className="att-secondary"
              onClick={() =>
                downloadCsv(
                  personalCsv(shown, context.seasons),
                  "my-volunteer-hours.csv",
                )
              }
              disabled={!shown.length}
            >
              <Download size={16} aria-hidden="true" /> Export my hours CSV
            </button>
          </div>
          {!shown.length && (
            <p className="att-panel">
              No volunteer entries for these filters. Clock in for new work or
              add past hours.
            </p>
          )}
          <div className="volunteer-entries">
            {shown.map((e) => (
              <article className="att-panel" key={e.id}>
                <div className="att-toolbar">
                  <h3>{activities[e.activity]}</h3>
                  <span className="att-badge">
                    {e.voided_at
                      ? "Voided"
                      : e.ended_at
                        ? displayHours(hours(e))
                        : "Running · excluded"}
                  </span>
                </div>
                <p>
                  {timestamp(e.started_at, e.time_zone)} →{" "}
                  {e.ended_at
                    ? timestamp(e.ended_at, e.time_zone)
                    : "Not clocked out"}
                  <br />
                  <span className="att-muted">
                    {e.time_zone} ·{" "}
                    {context.seasons.find((s) => s.id === e.season_id)?.name ||
                      "Unassigned season"}{" "}
                    ·{" "}
                    {e.source === "timer" ? "Volunteer timer" : "Manual entry"}
                  </span>
                </p>
                {e.meeting_id && (
                  <p>
                    Linked meeting:{" "}
                    {meetings.find((m) => m.id === e.meeting_id)?.title ||
                      "Previously linked meeting"}
                  </p>
                )}
                {e.notes && <p className="volunteer-note">{e.notes}</p>}
                <div className="att-toolbar">
                  {!e.voided_at && (
                    <>
                      <button
                        className="att-secondary"
                        disabled={busy || !!pending}
                        onClick={() => setEditor(e)}
                      >
                        Correct hours
                      </button>
                      <button
                        className="att-secondary"
                        disabled={busy || !!pending}
                        onClick={() => {
                          setVoiding(e);
                          setVoidReason("");
                        }}
                      >
                        Void entry
                      </button>
                    </>
                  )}
                  <button
                    className="att-secondary"
                    disabled={busy}
                    onClick={() => void history(e)}
                  >
                    History
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <section className="att-panel" aria-label="Team volunteer totals">
          <div className="att-toolbar">
            <h3>Team volunteer totals</h3>
            <button
              className="att-secondary"
              disabled={!totals.length}
              onClick={() =>
                downloadCsv(
                  teamCsv(totals, context.seasons),
                  "team-volunteer-totals.csv",
                )
              }
            >
              <Download size={16} aria-hidden="true" /> Export team totals CSV
            </button>
          </div>
          <p className="att-muted">
            Authorized team summary. Completed hours only; private entry notes
            and corrections are not included.
          </p>
          {team === null ? (
            <p>Team totals could not be loaded. Use Refresh hours.</p>
          ) : (
            <>
              <div className="attendance-stats">
                <span>
                  <strong>
                    {displayHours(
                      totals.reduce((n, r) => n + Number(r.hours), 0),
                    )}
                  </strong>{" "}
                  Completed · selected filters
                </span>
                <span>
                  <strong>
                    {totals.reduce((n, r) => n + r.running_entries, 0)}
                  </strong>{" "}
                  Running · excluded
                </span>
              </div>
              {people.length ? (
                <ul className="volunteer-team-list">
                  {people.map((p, i) => (
                    <li key={i}>
                      <strong>{p.name}</strong>
                      <span>
                        {displayHours(p.hours)}
                        {p.running > 0 && ` · ${p.running} running`}
                        {p.missing > 0 && ` · ${p.missing} missing checkout`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No team volunteer entries for these filters.</p>
              )}
              <details>
                <summary>Weekly activity breakdown</summary>
                <ul className="volunteer-team-list">
                  {totals.map((r, i) => (
                    <li key={i}>
                      <span>
                        {r.display_name} · week of {r.week_start}
                        <br />
                        {activities[r.activity]} ·{" "}
                        {context.seasons.find((s) => s.id === r.season_id)
                          ?.name || "Unassigned"}
                      </span>
                      <strong>{displayHours(Number(r.hours))}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </section>
      )}
      {editor && (
        <EntryEditor
          key={typeof editor === "string" ? editor : editor.id}
          entry={typeof editor === "string" ? null : editor}
          context={context}
          meetings={meetings}
          busy={busy}
          pending={!!pending}
          onRetry={() => pending && void mutate(pending)}
          onClose={() => setEditor(null)}
          onSave={(p) => submit(editor === "new" ? "manual" : "correct", p)}
          error={error}
        />
      )}
      {voiding && (
        <Modal
          title="Void volunteer entry"
          onClose={() => setVoiding(null)}
          busy={busy}
        >
          {pending && (
            <button disabled={busy} onClick={() => void mutate(pending)}>
              Retry same request
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit("void", {
                id: voiding.id,
                version: voiding.version,
                reason: voidReason,
              });
            }}
          >
            <p>
              This removes the entry from totals and stops a running timer. Its
              full history remains available.
            </p>
            <label>
              Reason
              <textarea
                disabled={busy || !!pending}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                required
                maxLength={1000}
              />
            </label>
            {error && (
              <p role="alert" className="att-error">
                {error}
              </p>
            )}
            <div className="att-toolbar">
              <button disabled={busy || !!pending || !voidReason.trim()}>
                Void entry
              </button>
              <button
                type="button"
                className="att-secondary"
                disabled={busy}
                onClick={() => setVoiding(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {audit && (
        <Modal
          title="Volunteer entry history"
          onClose={() => setAudit(null)}
          busy={busy}
        >
          <p>
            All changes are retained. Showing {audit.rows.length} most recent
            changes.
          </p>
          <ol className="volunteer-audit">
            {audit.rows.map((h) => (
              <li key={h.id}>
                <strong>
                  {h.action} · {new Date(h.performed_at).toLocaleString()}
                </strong>
                {h.reason && <p>{h.reason}</p>}
                <p>
                  After:{" "}
                  {timestamp(h.after_data.started_at, h.after_data.time_zone)} →{" "}
                  {h.after_data.ended_at
                    ? timestamp(h.after_data.ended_at, h.after_data.time_zone)
                    : "Running"}{" "}
                  ·{" "}
                  {h.after_data.voided_at
                    ? "Voided"
                    : displayHours(hours(h.after_data))}
                </p>
                {h.before_data && (
                  <p>
                    Before:{" "}
                    {timestamp(
                      h.before_data.started_at,
                      h.before_data.time_zone,
                    )}{" "}
                    →{" "}
                    {h.before_data.ended_at
                      ? timestamp(
                          h.before_data.ended_at,
                          h.before_data.time_zone,
                        )
                      : "Running"}{" "}
                    · {activities[h.before_data.activity]} ·{" "}
                    {h.before_data.notes || "No notes"}
                  </p>
                )}
                <p>
                  {activities[h.after_data.activity]} ·{" "}
                  {h.after_data.notes || "No notes"}
                </p>
                <p>
                  Season:{" "}
                  {context.seasons.find((s) => s.id === h.after_data.season_id)
                    ?.name || "Unassigned"}{" "}
                  · Meeting:{" "}
                  {meetings.find((m) => m.id === h.after_data.meeting_id)
                    ?.title || "None"}{" "}
                  · {h.after_data.time_zone}
                </p>
                {h.before_data && (
                  <p>
                    Previously:{" "}
                    {context.seasons.find(
                      (s) => s.id === h.before_data!.season_id,
                    )?.name || "Unassigned"}{" "}
                    · Meeting:{" "}
                    {meetings.find((m) => m.id === h.before_data!.meeting_id)
                      ?.title || "None"}{" "}
                    · {h.before_data.time_zone}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {audit.more && (
            <button
              disabled={busy}
              onClick={() => void history(audit.entry, true)}
            >
              Load older changes
            </button>
          )}
        </Modal>
      )}
    </section>
  );
}
function EntryFields({
  draft,
  setDraft,
  context,
  meetings,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  context: Context;
  meetings: Meeting[];
}) {
  return (
    <div className="volunteer-fields">
      <label>
        Activity
        <select
          value={draft.activity}
          onChange={(e) =>
            setDraft({ ...draft, activity: e.target.value as Activity })
          }
        >
          {Object.entries(activities).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Season (optional)
        <select
          value={draft.season_id}
          onChange={(e) => setDraft({ ...draft, season_id: e.target.value })}
        >
          <option value="">Unassigned</option>
          {context.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.status}
            </option>
          ))}
        </select>
      </label>
      <label>
        Link a meeting (optional)
        <select
          value={draft.meeting_id}
          onChange={(e) => setDraft({ ...draft, meeting_id: e.target.value })}
        >
          <option value="">No meeting · independent work</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title} · {new Date(m.starts_at).toLocaleDateString()}
            </option>
          ))}
        </select>
      </label>
      <label className="volunteer-wide">
        Notes (optional)
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          maxLength={2000}
          rows={2}
          placeholder="What did you work on?"
        />
      </label>
    </div>
  );
}
function EntryEditor({
  entry,
  context,
  meetings,
  busy,
  pending,
  onRetry,
  onClose,
  onSave,
  error,
}: {
  entry: Entry | null;
  context: Context;
  meetings: Meeting[];
  busy: boolean;
  pending: boolean;
  onRetry: () => void;
  onClose: () => void;
  onSave: (p: Record<string, unknown>) => void;
  error: string;
}) {
  const [draft, setDraft] = useState(() => draftFor(entry, "")),
    [validation, setValidation] = useState("");
  const starts = timeCandidates(draft.start, draft.time_zone),
    ends = timeCandidates(draft.end, draft.time_zone);
  const start = resolveTime(
    draft.start,
    draft.time_zone,
    draft.startChoice,
    entry?.started_at,
  );
  const end = resolveTime(
    draft.end,
    draft.time_zone,
    draft.endChoice,
    entry?.ended_at,
  );
  function save(e: FormEvent) {
    e.preventDefault();
    setValidation("");
    if (!start || !end) {
      setValidation(
        "Enter valid start and end times. For a repeated daylight-saving time, choose its UTC offset.",
      );
      return;
    }
    if (
      Date.parse(end) <= Date.parse(start) ||
      Date.parse(end) - Date.parse(start) > 86400000
    ) {
      setValidation(
        "End must follow start and the entry may be at most 24 hours. For overnight work, use the next date.",
      );
      return;
    }
    onSave({
      ...(entry ? { id: entry.id, version: entry.version } : {}),
      activity: draft.activity,
      season_id: draft.season_id || null,
      meeting_id: draft.meeting_id || null,
      notes: draft.notes,
      started_at: start,
      ended_at: end,
      time_zone: draft.time_zone,
      reason: draft.reason,
    });
  }
  return (
    <Modal
      title={entry ? "Correct volunteer hours" : "Add past volunteer hours"}
      onClose={onClose}
      busy={busy}
    >
      {pending && (
        <p>
          <button disabled={busy} onClick={onRetry}>
            Retry same request
          </button>{" "}
          Your draft is kept while the response is unverified.
        </p>
      )}
      <form onSubmit={save}>
        <fieldset className="att-fieldset" disabled={busy || pending}>
          <p>
            Enter actual start and end times in{" "}
            <strong>{draft.time_zone}</strong>. Include the end date for
            overnight work. Maximum 24 hours per entry.
          </p>
          <div className="volunteer-fields">
            {(["start", "end"] as const).map((key) => {
              const options = key === "start" ? starts : ends;
              return (
                <div key={key}>
                  <label>
                    {key === "start" ? "Actual start" : "Actual end"}
                    <input
                      type="datetime-local"
                      value={draft[key]}
                      required
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: e.target.value,
                          [`${key}Choice`]: "",
                        })
                      }
                    />
                  </label>
                  {draft[key] && !options.length && (
                    <p className="att-error">
                      This local time does not exist in {draft.time_zone}.
                    </p>
                  )}
                  {options.length > 1 && (
                    <label>
                      {key === "start" ? "Start" : "End"} UTC offset (repeated
                      hour)
                      <select
                        required
                        value={draft[`${key}Choice`]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [`${key}Choice`]: e.target.value,
                          })
                        }
                      >
                        <option value="">Choose the intended time</option>
                        {options.map((o) => (
                          <option key={o.iso} value={o.iso}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {start && end && Date.parse(end) > Date.parse(start) && (
            <p>
              Duration:{" "}
              <strong>
                {displayHours((Date.parse(end) - Date.parse(start)) / 3600000)}
              </strong>
            </p>
          )}
          <EntryFields
            draft={draft}
            setDraft={setDraft}
            context={context}
            meetings={meetings}
          />
          {entry && (
            <label>
              Correction reason
              <textarea
                required
                maxLength={1000}
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              />
            </label>
          )}
          {(validation || error) && (
            <p role="alert" className="att-error">
              {validation || error}
            </p>
          )}
          <div className="att-toolbar">
            <button>{entry ? "Save correction" : "Save past hours"}</button>
            <button type="button" className="att-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="volunteer-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="att-toolbar">
        <h2>{title}</h2>
        <button
          type="button"
          className="att-secondary"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
