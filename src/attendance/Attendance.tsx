import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  supabase,
  isManager,
  loadData,
  loadHistory,
  manage,
  rpc,
  summary,
  strikeAction,
  label,
  type Profile,
  type Data,
  type Meeting,
  type Attendance,
  type Member,
  type History,
} from "./service";
import "./attendance.css";
import { occurrences, type Repeat } from "./recurrence";
import { MeetingCalendar } from "./Calendar";
const time = (s: string | null) =>
  s
    ? new Date(s).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const localTime = (s: string | null) =>
  s
    ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
const fields = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return new FormData(e.currentTarget);
};
const text = (f: FormData, k: string) => String(f.get(k) ?? "");
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Could not complete the request. Try again.";
function Stats({ data, id }: { data: Data; id: string }) {
  const s = summary(data, id);
  return (
    <div className="attendance-stats">
      <span>
        <strong>{s.percent === null ? "—" : `${s.percent}%`}</strong> Attendance
        · {s.attended}/{s.total} required, finalized meetings
      </span>
      <span>
        <strong>{s.late}</strong> Late · {s.early} left early
      </span>
      <span>
        <strong>{s.strikes}</strong> Active strikes{" "}
        <small>{strikeAction(s.strikes)}</small>
      </span>
    </div>
  );
}
export function AttendanceHub({
  workspace,
  tab,
}: {
  workspace: boolean;
  tab: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [signedIn, setSignedIn] = useState(false),
    [loading, setLoading] = useState(!!supabase),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const gen = ++generation.current;
        setProfile(null);
        setData(null);
        setError("");
        setSignedIn(!!session);
        setLoading(!!session);
        if (!session) return;
        // Fetch outside the synchronous auth callback to avoid auth lock contention.
        setTimeout(() => {
          void (async () => {
            try {
              const { data: p, error: e } = await supabase!
                .from("profiles")
                .select("id,display_name,role,active")
                .eq("id", session.user.id)
                .single();
              if (e) throw e;
              if (
                !p.active ||
                !["student", "lead", "admin", "mentor"].includes(p.role)
              )
                throw new Error(
                  "Attendance access requires an active student or leadership account.",
                );
              const d = await loadData(isManager(p));
              if (mounted && gen === generation.current) {
                setProfile(p);
                setData(d);
              }
            } catch (e) {
              if (mounted && gen === generation.current) setError(errorText(e));
            } finally {
              if (mounted && gen === generation.current) setLoading(false);
            }
          })();
        }, 0);
      },
    );
    return () => {
      mounted = false;
      generation.current++;
      subscription.subscription.unsubscribe();
    };
  }, []);
  async function run(work: () => Promise<unknown>, success = "Saved") {
    setBusy(true);
    setError("");
    setMessage("");
    const gen = generation.current;
    try {
      await work();
      if (profile) {
        const d = await loadData(isManager(profile));
        if (gen === generation.current) setData(d);
      }
      if (gen === generation.current) setMessage(success);
    } catch (e) {
      if (gen === generation.current) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="attendance"
      className={`attendance-section ${workspace ? "att-workspace" : ""}`}
      aria-labelledby="attendance-heading"
    >
      <div className="section-heading">
        <div>
          {workspace ? (
            <>
              <a href="#" className="att-home">
                ← Team Hub / Home
              </a>
              <h1 id="attendance-heading">Attendance</h1>
            </>
          ) : (
            <h2 id="attendance-heading">Attendance</h2>
          )}
          <p>Show up. Stay connected. Keep your record clear.</p>
        </div>
        {signedIn && (
          <button
            className="att-secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await supabase!.auth.signOut({
                  scope: "local",
                });
                if (error) throw error;
              }, "Signed out")
            }
          >
            Sign out
          </button>
        )}
      </div>
      {!supabase ? (
        <div className="att-panel">
          Attendance setup is pending. Your team’s existing sign-in will be
          available here once configured.
        </div>
      ) : (
        <>
          {error && (
            <p className="att-error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {loading ? (
            <p role="status">Loading attendance…</p>
          ) : !profile && signedIn ? (
            <p>
              You are signed into the Team 4418 suite. Attendance is unavailable
              for this account; you can still open your permitted apps above.
            </p>
          ) : !profile ? (
            <form
              className="att-panel att-form"
              onSubmit={(e) => {
                const f = fields(e);
                void run(async () => {
                  const { error } = await supabase!.auth.signInWithPassword({
                    email: text(f, "email"),
                    password: text(f, "password"),
                  });
                  if (error) throw error;
                }, "");
              }}
            >
              <h3>Team sign-in</h3>
              <p>Use your existing Team 4418 account.</p>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button disabled={busy}>Sign in</button>
            </form>
          ) : (
            data && (
              <>
                <div className="att-toolbar">
                  <span>Welcome, {profile.display_name}</span>
                  <button
                    className="att-secondary"
                    disabled={busy}
                    onClick={() => void run(async () => {}, "Refreshed")}
                  >
                    Refresh
                  </button>
                  {!workspace && (
                    <a className="att-link-button" href="#attendance">
                      {isManager(profile)
                        ? "Manage attendance"
                        : "My Attendance"}{" "}
                      →
                    </a>
                  )}
                </div>
                {!workspace && (
                  <>
                    {!isManager(profile) && (
                      <PersonalCallouts data={data} id={profile.id} />
                    )}
                    {isManager(profile) ? (
                      <div className="attendance-stats">
                        <span>
                          <strong>
                            {
                              data.meetings.filter((m) => m.status === "open")
                                .length
                            }
                          </strong>{" "}
                          Open meetings
                        </span>
                        <span>
                          <strong>
                            {
                              data.attendance.filter(
                                (a) => a.review_status === "pending",
                              ).length
                            }
                          </strong>{" "}
                          Attendance requests to review
                        </span>
                        <span>
                          <strong>
                            {
                              data.members.filter(
                                (m) => summary(data, m.student_id).strikes >= 3,
                              ).length
                            }
                          </strong>{" "}
                          Students requiring strike action
                        </span>
                      </div>
                    ) : (
                      <Stats data={data} id={profile.id} />
                    )}
                    {isManager(profile) && (
                      <div className="att-toolbar att-callouts">
                        <a href="#attendance/calendar">Open calendar →</a>
                        <a href="#attendance/notices">
                          Review attendance requests →
                        </a>
                        <a href="#attendance/strikes">
                          Review strike actions →
                        </a>
                      </div>
                    )}
                  </>
                )}
                {workspace && (
                  <fieldset disabled={busy} className="att-fieldset">
                    <Workspace
                      data={data}
                      profile={profile}
                      tab={tab}
                      run={run}
                      busy={busy}
                      error={error}
                      message={message}
                    />
                  </fieldset>
                )}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
type Run = (work: () => Promise<unknown>, success?: string) => Promise<void>;
function Student({ data, id, run }: { data: Data; id: string; run: Run }) {
  const [history, setHistory] = useState<History[] | null>(null);
  return (
    <>
      <h3>My Attendance</h3>
      {!data.meetings.length && (
        <p className="att-panel">
          No meetings have been added to your attendance record yet.
        </p>
      )}
      {data.meetings.map((m) => {
        const a = data.attendance.find(
          (a) => a.meeting_id === m.id && a.student_id === id,
        );
        if (!a) return null;
        const required = data.snapshots.find(
          (s) => s.meeting_id === m.id && s.student_id === id,
        )?.required;
        return (
          <article className="att-panel" key={m.id}>
            <MeetingHeader meeting={m} />
            <ol className="att-lifecycle" aria-label="Meeting lifecycle">
              {["draft", "open", "closed", "finalized"].map((stage) => (
                <li
                  key={stage}
                  aria-current={m.status === stage ? "step" : undefined}
                >
                  {stage === "open" ? "Open check-in" : label(stage)}
                </li>
              ))}
            </ol>
            <p>
              {required ? "Required" : "Optional"} · <Status attendance={a} />
            </p>
            {m.check_in_open &&
              m.status === "open" &&
              !a.checked_in_at &&
              a.physical_status === "pending" && (
                <form
                  className="att-inline"
                  onSubmit={(e) => {
                    const f = fields(e);
                    void run(
                      () =>
                        rpc("team_attendance_check_in", {
                          meeting_id: m.id,
                          code: text(f, "code"),
                        }),
                      "Check-in recorded",
                    );
                  }}
                >
                  <label>
                    6-digit meeting code
                    <input
                      name="code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      minLength={6}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <button>Check in</button>
                </form>
              )}
            {a.checked_in_at && <p>Checked in: {time(a.checked_in_at)}</p>}
            <NoticeDetails a={a} meeting={m} />
            <NoticeForm a={a} meeting={m} run={run} />
            {a.review_reason && <p>Leadership review: {a.review_reason}</p>}
            <StrikeList data={data} attendance={a} />
            <button
              className="att-secondary"
              onClick={() =>
                void run(
                  async () => setHistory(await loadHistory(m.id)),
                  "History loaded",
                )
              }
            >
              View my history · {m.title}
            </button>
          </article>
        );
      })}
      {history && <HistoryList history={history} />}
    </>
  );
}
function MeetingHeader({ meeting: m }: { meeting: Meeting }) {
  return (
    <>
      <div className="att-toolbar">
        <h3>{m.title}</h3>
        <span className="att-badge">{label(m.status)}</span>
      </div>
      <p>
        {time(m.starts_at)} – {time(m.ends_at)} · {label(m.meeting_type)} ·{" "}
        {m.late_minutes}-minute grace period
      </p>
    </>
  );
}
function Status({ attendance: a }: { attendance: Attendance }) {
  return (
    <>
      <span className={`att-badge ${a.physical_status}`}>
        {label(a.physical_status)}
      </span>
      {a.review_status !== "none" && (
        <>
          {" "}
          <span className="att-badge">
            {a.review_status === "pending"
              ? "Excuse review pending"
              : label(a.review_status)}
          </span>
        </>
      )}
    </>
  );
}
function noticeTiming(a: Attendance, m: Meeting) {
  return a.notice_at
    ? new Date(m.starts_at).getTime() - new Date(a.notice_at).getTime() >=
      86400000
      ? "At least 24 hours’ notice"
      : "Less than 24 hours’ notice"
    : "No notice submitted";
}
function Management({
  data,
  run,
  selected,
}: {
  data: Data;
  run: Run;
  selected: string;
}) {
  const [code, setCode] = useState<{
      meetingId: string;
      code: string;
      expires: string;
    } | null>(null),
    [history, setHistory] = useState<History[] | null>(null);
  const [rosterFilter, setRosterFilter] = useState("all");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const m = data.meetings.find((m) => m.id === selected);
  return (
    <>
      {m && (
        <>
          <div className="att-panel">
            <MeetingHeader meeting={m} />
            <ol className="att-lifecycle" aria-label="Meeting lifecycle">
              {["draft", "open", "closed", "finalized"].map((stage) => (
                <li
                  key={stage}
                  aria-current={m.status === stage ? "step" : undefined}
                >
                  {stage === "open" ? "Open check-in" : label(stage)}
                </li>
              ))}
            </ol>
            <p>
              Required roster snapshotted at creation ·{" "}
              {
                data.snapshots.filter(
                  (s) => s.meeting_id === m.id && s.required,
                ).length
              }{" "}
              required
            </p>
            <div className="att-toolbar">
              {m.status !== "finalized" && (
                <button
                  onClick={() =>
                    void run(async () => {
                      const r = await manage("open", {
                        meeting_id: m.id,
                        version: m.version,
                      });
                      setCode({
                        meetingId: m.id,
                        code: r.code,
                        expires: r.expires_at,
                      });
                    }, "Temporary code opened")
                  }
                >
                  {m.status === "open"
                    ? "Rotate check-in code"
                    : "Open check-in"}
                </button>
              )}
              {["draft", "open"].includes(m.status) && (
                <button
                  className="att-secondary"
                  onClick={() =>
                    void run(async () => {
                      await manage("close", {
                        meeting_id: m.id,
                        version: m.version,
                      });
                      setCode(null);
                    }, "Check-in closed")
                  }
                >
                  Close check-in
                </button>
              )}
              {m.status === "closed" && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Finalize this meeting? Missing required attendees will be recorded Absent. Leadership can still make audited corrections.",
                      )
                    )
                      void run(
                        () =>
                          manage("finalize", {
                            meeting_id: m.id,
                            version: m.version,
                          }),
                        "Meeting finalized",
                      );
                  }}
                >
                  Finalize meeting
                </button>
              )}
              <button
                className="att-secondary"
                onClick={() =>
                  void run(
                    async () => setHistory(await loadHistory(m.id)),
                    "History loaded",
                  )
                }
              >
                View audit history
              </button>
            </div>
            {code &&
              code.meetingId === m.id &&
              m.check_in_open &&
              m.status === "open" &&
              now < Date.parse(code.expires) &&
              now < Date.parse(m.ends_at) && (
                <p className="att-code">
                  Meeting code: <strong>{code.code}</strong>
                  <small>
                    Expires {time(code.expires)}. Share only with attendees.
                    Rotation invalidates the previous code.
                  </small>
                </p>
              )}
            <p className="att-muted">
              Open from 30 minutes before start until meeting end. Codes last up
              to 30 minutes. Finalize after the scheduled end and closing
              check-in.
            </p>
          </div>
          <label className="att-select">
            Live roster filter
            <select
              value={rosterFilter}
              onChange={(e) => setRosterFilter(e.target.value)}
            >
              {[
                "all",
                "present",
                "late",
                "left_early",
                "excused",
                "absent",
                "pending",
                "notice",
              ].map((v) => (
                <option key={v} value={v}>
                  {v === "pending"
                    ? "Pending / not checked in"
                    : v === "notice"
                      ? "Notice submitted"
                      : label(v)}
                </option>
              ))}
            </select>
          </label>
          {data.attendance
            .filter(
              (a) =>
                a.meeting_id === m.id &&
                (rosterFilter === "all" ||
                  (rosterFilter === "excused"
                    ? a.review_status === "excused"
                    : rosterFilter === "notice"
                      ? !!a.notice_at
                      : a.physical_status === rosterFilter)),
            )
            .map((a) => (
              <details className="att-record" key={a.id}>
                <summary>
                  {data.members.find(
                    (member) => member.student_id === a.student_id,
                  )?.display_name ?? a.student_id}
                  <span>
                    {label(a.physical_status)} · {label(a.review_status)}
                    <small>
                      Check-in {time(a.checked_in_at)} · Departure{" "}
                      {time(a.left_at)}
                      {a.notice_at && (
                        <>
                          {" "}
                          · {a.notice_type ? label(a.notice_type) : "Notice"} ·
                          Expected {time(a.expected_at ?? null)} ·{" "}
                          {noticeTiming(a, m)}
                        </>
                      )}
                    </small>
                  </span>
                </summary>
                <NoticeDetails a={a} meeting={m} />
                <AttendanceEditor
                  key={`${a.id}-${a.version}`}
                  a={a}
                  meeting={m}
                  data={data}
                  run={run}
                />
              </details>
            ))}
          {history && <HistoryList history={history} />}
        </>
      )}
    </>
  );
}
function MemberForm({ member: m, run }: { member: Member; run: Run }) {
  return (
    <form
      className="att-member"
      onSubmit={(e) => {
        const f = fields(e);
        void run(() =>
          manage("member", {
            student_id: m.student_id,
            member_status: text(f, "status"),
            team_area: text(f, "area"),
          }),
        );
      }}
    >
      <strong>{m.display_name}</strong>
      <label>
        Member status
        <select name="status" defaultValue={m.member_status}>
          {["prospective", "registered", "inactive"].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Team area
        <input name="area" maxLength={100} defaultValue={m.team_area} />
      </label>
      <button>Save member</button>
    </form>
  );
}
function MeetingForm({
  members,
  run,
  date,
  onCreated,
}: {
  members: Member[];
  run: Run;
  date: Date;
  onCreated: () => void;
}) {
  const [requirement, setRequirement] = useState("registered");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [preview, setPreview] = useState("");
  const [preset, setPreset] = useState("Offseason"),
    [title, setTitle] = useState("Offseason meeting"),
    [type, setType] = useState("offseason");
  const end = new Date(date);
  end.setHours(end.getHours() + 3);
  return (
    <form
      className="att-form"
      onChange={() => setPreview("")}
      onSubmit={(e) => {
        const f = fields(e);
        const form = e.currentTarget;
        void run(async () => {
          if (Date.parse(text(f, "end")) <= Date.parse(text(f, "start")))
            throw new Error("End time must be after start time.");
          if (requirement === "areas" && !f.getAll("areas").length)
            throw new Error("Select at least one required area.");
          if (requirement === "selected" && !f.getAll("students").length)
            throw new Error("Select at least one required student.");
          const base = {
            title: text(f, "title"),
            meeting_type: text(f, "type"),
            starts_at: new Date(text(f, "start")).toISOString(),
            ends_at: new Date(text(f, "end")).toISOString(),
            late_minutes: Number(f.get("late")),
            requirement,
            areas: f.getAll("areas"),
            selected_students: f.getAll("students"),
          };
          const dates = occurrences(
            text(f, "start"),
            text(f, "end"),
            repeat,
            text(f, "until"),
            Number(f.get("interval") || 1),
            f.getAll("weekday").map(Number),
          );
          if (repeat === "none") await manage("create", base);
          else
            await rpc("team_attendance_create_batch", {
              meetings: dates.map((d) => ({ ...base, ...d })),
            });
          form.reset();
          onCreated();
        }, "Meeting created with required roster snapshot");
      }}
    >
      <div className="att-presets" role="group" aria-label="Meeting presets">
        {[
          "Offseason",
          "Preseason",
          "Build Meeting",
          "Competition",
          "Optional",
        ].map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={preset === name}
            className={preset === name ? "" : "att-secondary"}
            onClick={() => {
              setPreset(name);
              setTitle(
                name === "Offseason" || name === "Preseason"
                  ? `${name} meeting`
                  : name,
              );
              setType(
                name === "Offseason"
                  ? "offseason"
                  : name === "Preseason"
                    ? "preseason"
                    : "other",
              );
              setRequirement(name === "Optional" ? "optional" : "registered");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <label>
        Title
        <input
          name="title"
          maxLength={150}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="att-grid">
        <label>
          Start (your local time)
          <input
            name="start"
            type="datetime-local"
            defaultValue={localTime(date.toISOString())}
            required
          />
        </label>
        <label>
          End (your local time)
          <input
            name="end"
            type="datetime-local"
            defaultValue={localTime(end.toISOString())}
            required
          />
        </label>
      </div>
      <label>
        Repeat
        <select
          aria-label="Repeat"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as Repeat)}
        >
          <option value="none">Does not repeat</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Custom recurrence</option>
        </select>
      </label>
      {repeat !== "none" && (
        <div className="att-panel att-form">
          <p>
            Use the start/end fields above for the first date and daily times.
            Each occurrence is a separate meeting with its own required roster.
          </p>
          <label>
            Repeat through (end date)
            <input type="date" name="until" required />
          </label>
          {repeat === "custom" && (
            <>
              <label>
                Repeat every N weeks
                <input
                  type="number"
                  name="interval"
                  min="1"
                  max="12"
                  defaultValue="1"
                  required
                />
              </label>
              <fieldset>
                <legend>Weekdays</legend>
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day, index) => (
                  <label className="att-check" key={day}>
                    <input
                      type="checkbox"
                      name="weekday"
                      value={index}
                      defaultChecked={date.getDay() === index}
                    />
                    {day}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <button
            type="button"
            className="att-secondary"
            onClick={(e) => {
              const f = new FormData(e.currentTarget.form!);
              try {
                const dates = occurrences(
                  text(f, "start"),
                  text(f, "end"),
                  repeat,
                  text(f, "until"),
                  Number(f.get("interval") || 1),
                  f.getAll("weekday").map(Number),
                );
                setPreview(
                  `${dates.length} meetings: ${dates.map((d) => new Date(d.starts_at).toLocaleDateString()).join(", ")}`,
                );
              } catch (error) {
                setPreview(errorText(error));
              }
            }}
          >
            Preview meetings
          </button>
          {preview && <p role="status">{preview}</p>}
          <small>
            Maximum 52 meetings and one year per creation. All meetings are
            saved together or none are saved.
          </small>
        </div>
      )}
      <label>
        Required attendance
        <select
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
        >
          <option value="registered">All registered students</option>
          <option value="areas">Registered students in selected areas</option>
          <option value="selected">
            Selected students (including prospective)
          </option>
          <option value="optional">Optional meeting</option>
        </select>
      </label>
      {requirement === "areas" && (
        <fieldset>
          <legend>Required areas</legend>
          {!members.some((m) => m.team_area) && (
            <p>Add team areas in Roster before using this option.</p>
          )}
          {[...new Set(members.map((m) => m.team_area).filter(Boolean))].map(
            (area) => (
              <label className="att-check" key={area}>
                <input type="checkbox" name="areas" value={area} />
                {area}
              </label>
            ),
          )}
        </fieldset>
      )}
      {requirement === "selected" && (
        <fieldset>
          <legend>Required students</legend>
          {members
            .filter((m) => m.member_status !== "inactive")
            .map((m) => (
              <label className="att-check" key={m.student_id}>
                <input type="checkbox" name="students" value={m.student_id} />
                {m.display_name} · {label(m.member_status)}
              </label>
            ))}
        </fieldset>
      )}
      <details>
        <summary>Advanced settings · 10-minute grace by default</summary>
        <div className="att-grid">
          {" "}
          <label>
            Meeting type
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="offseason">Offseason</option>
              <option value="preseason">Preseason</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Late threshold (minutes)
            <input
              name="late"
              type="number"
              min={0}
              max={120}
              defaultValue={10}
              required
            />
          </label>
        </div>
      </details>
      <p className="att-muted">
        Local times · Required members are snapshotted when this meeting is
        created.
      </p>
      <button>Create meeting</button>
    </form>
  );
}
function AttendanceEditor({
  a,
  meeting: m,
  data,
  run,
}: {
  a: Attendance;
  meeting: Meeting;
  data: Data;
  run: Run;
}) {
  const [physical, setPhysical] = useState(a.physical_status);
  const member = data.members.find((s) => s.student_id === a.student_id),
    snapshot = data.snapshots.find(
      (s) => s.meeting_id === m.id && s.student_id === a.student_id,
    );
  return (
    <article className="att-panel">
      <div className="att-toolbar">
        <h4>{member?.display_name ?? a.student_id}</h4>
        <Status attendance={a} />
      </div>
      <p>
        {snapshot?.required ? "Required" : "Optional"} ·{" "}
        {label(snapshot?.member_status ?? "prospective")} ·{" "}
        {snapshot?.team_area || "No area"} (meeting snapshot)
      </p>

      <p>
        Check-in: {time(a.checked_in_at)} · {noticeTiming(a, m)}
      </p>
      <NoticeDetails a={a} meeting={m} />
      <DepartureForm a={a} meeting={m} run={run} />
      {a.review_reason && (
        <p>
          Latest review: {a.review_reason} · {time(a.reviewed_at)}
        </p>
      )}
      <div className="att-toolbar">
        <button
          type="button"
          className="att-secondary"
          onClick={(e) => {
            const d = e.currentTarget
              .closest("article")
              ?.querySelector<HTMLDetailsElement>("[data-review]");
            if (d) {
              d.open = true;
              d.scrollIntoView({ block: "nearest" });
            }
          }}
        >
          Review excuse / correct attendance
        </button>
        <button
          type="button"
          className="att-secondary"
          onClick={(e) => {
            const d = e.currentTarget
              .closest("article")
              ?.querySelector<HTMLDetailsElement>("[data-strike]");
            if (d) {
              d.open = true;
              d.scrollIntoView({ block: "nearest" });
            }
          }}
        >
          Add / review strikes
        </button>
      </div>
      <details data-review>
        <summary>Review / correct attendance</summary>
        <form
          className="att-form"
          onSubmit={(e) => {
            const f = fields(e);
            void run(() =>
              manage("attendance", {
                meeting_id: m.id,
                attendance_id: a.id,
                version: a.version,
                physical_status: physical,
                review_status: text(f, "review"),
                left_at: text(f, "left")
                  ? new Date(text(f, "left")).toISOString()
                  : null,
                explanation: text(f, "explanation"),
              }),
            );
          }}
        >
          <div className="att-grid">
            <label>
              Physical attendance
              <select
                value={physical}
                onChange={(e) => setPhysical(e.target.value)}
              >
                {["pending", "present", "late", "left_early", "absent"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Excuse / requirement review
              <select name="review" defaultValue={a.review_status}>
                {["none", "pending", "excused", "denied", "not_required"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          {physical === "left_early" && (
            <label>
              Left at (your local time)
              <input
                type="datetime-local"
                name="left"
                defaultValue={localTime(a.left_at)}
                required
              />
            </label>
          )}
          <label>
            Review / correction explanation
            <textarea name="explanation" maxLength={2000} required />
          </label>
          <button>Save attendance review</button>
        </form>
      </details>
      <StrikeList data={data} attendance={a} run={run} />
      <details data-strike>
        <summary>Assign strike</summary>
        <form
          className="att-form"
          onSubmit={(e) => {
            const f = fields(e);
            const form = e.currentTarget;
            void run(async () => {
              await manage("strike", {
                meeting_id: m.id,
                attendance_id: a.id,
                category: text(f, "category"),
                quantity: Number(f.get("quantity")),
                explanation: text(f, "explanation"),
              });
              form.reset();
            }, "Strike assigned");
          }}
        >
          <div className="att-grid">
            <label>
              Category
              <select name="category">
                {[
                  "Unexcused Absence",
                  "Late Arrival",
                  "Early Departure",
                  "Insufficient Notice",
                  "Other",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                type="number"
                name="quantity"
                min={1}
                max={10}
                defaultValue={1}
                required
              />
            </label>
          </div>
          <label>
            Explanation
            <textarea name="explanation" maxLength={2000} required />
          </label>
          <button>Assign strike</button>
        </form>
      </details>
    </article>
  );
}
function StrikeList({
  data,
  attendance: a,
  run,
}: {
  data: Data;
  attendance: Attendance;
  run?: Run;
}) {
  return (
    <div className="att-strikes">
      {data.strikes
        .filter((s) => s.attendance_id === a.id)
        .map((s) => (
          <div key={s.id}>
            <p>
              <strong>
                {s.rescinded_at ? "Rescinded" : `+${s.quantity}`} · {s.category}
              </strong>{" "}
              — {s.explanation}
              <br />
              <small>
                Assigned {time(s.assigned_at)} by{" "}
                {data.members.find((m) => m.student_id === s.assigned_by)
                  ?.display_name ?? s.assigned_by}
              </small>
              {s.rescinded_at && (
                <small>
                  Rescinded {time(s.rescinded_at)}: {s.rescind_reason}
                </small>
              )}
            </p>
            {run && !s.rescinded_at && (
              <form
                className="att-inline"
                onSubmit={(e) => {
                  const f = fields(e);
                  void run(
                    () =>
                      manage("rescind", {
                        meeting_id: a.meeting_id,
                        attendance_id: a.id,
                        strike_id: s.id,
                        explanation: text(f, "reason"),
                      }),
                    "Strike rescinded",
                  );
                }}
              >
                <label>
                  Rescind / correction reason
                  <input name="reason" maxLength={2000} required />
                </label>
                <button className="att-secondary">Rescind strike</button>
              </form>
            )}
          </div>
        ))}
    </div>
  );
}
function HistoryList({ history }: { history: History[] }) {
  return (
    <section className="att-panel">
      <h3>Audit history</h3>
      <p>
        Latest 100 entries. Corrections preserve earlier values. To correct a
        strike, rescind it with a reason and assign a replacement.
      </p>
      {!history.length && <p>No history yet.</p>}
      {history.map((h) => (
        <details key={h.id}>
          <summary>
            {time(h.performed_at)} ·{" "}
            {h.entity.replace("team_", "").replaceAll("_", " ")} · {h.action}
          </summary>
          <p>Actor: {h.performed_by}</p>
          <pre>
            {JSON.stringify(
              { before: h.before_data, after: h.after_data },
              null,
              2,
            )}
          </pre>
        </details>
      ))}
    </section>
  );
}

function PersonalCallouts({ data, id }: { data: Data; id: string }) {
  const next = [...data.meetings]
    .filter(
      (m) =>
        Date.parse(m.ends_at) > Date.now() &&
        data.snapshots.some(
          (s) => s.meeting_id === m.id && s.student_id === id && s.required,
        ),
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  const pending = data.attendance.filter(
    (a) => a.student_id === id && a.review_status === "pending",
  ).length;
  return (
    <div className="att-panel att-callouts">
      <div>
        <small>Next required meeting</small>
        <strong>
          {next
            ? `${next.title} · ${time(next.starts_at)}`
            : "No upcoming required meeting"}
        </strong>
      </div>
      <a href="#attendance">View meetings / check in →</a>
      <a href="#attendance/notices">{pending} pending attendance requests →</a>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      className="att-dialog"
      ref={ref}
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
function Workspace({
  data,
  profile,
  tab,
  run,
  busy,
  error,
  message,
}: {
  data: Data;
  profile: Profile;
  tab: string;
  run: Run;
  busy: boolean;
  error: string;
  message: string;
}) {
  const manager = isManager(profile);
  const tabs = manager
    ? ["calendar", "roster", "notices", "strikes", "history"]
    : ["calendar", "notices", "strikes", "history"];
  const current = tabs.includes(tab) ? tab : "calendar";
  const [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState<Date | null>(null),
    [search, setSearch] = useState("");
  const [historyMeeting, setHistoryMeeting] = useState(""),
    [history, setHistory] = useState<History[] | null>(null);
  const [noticeFilter, setNoticeFilter] = useState("pending");
  useEffect(() => {
    setSelected(null);
    setCreating(null);
    setSearch("");
  }, [tab]);
  const ownData = manager
    ? data
    : {
        ...data,
        attendance: data.attendance.filter((a) => a.student_id === profile.id),
        strikes: data.strikes.filter((s) => s.student_id === profile.id),
      };
  const selectedMeeting = data.meetings.find((m) => m.id === selected);
  const notices = ownData.attendance.filter(
    (a) =>
      (a.notice_at || a.review_status === "pending") &&
      (noticeFilter === "all" || a.review_status === noticeFilter),
  );
  const incidentRows =
    current === "notices"
      ? notices
      : ownData.attendance.filter((a) =>
          ownData.strikes.some((s) => s.attendance_id === a.id),
        );
  return (
    <>
      <nav className="att-tabs" aria-label="Attendance views">
        {tabs.map((name) => (
          <a
            key={name}
            href={`#attendance/${name}`}
            aria-current={current === name ? "page" : undefined}
          >
            {name === "notices" ? "Attendance Requests" : label(name)}
            {name === "notices" && (
              <span>
                {
                  ownData.attendance.filter(
                    (a) => a.review_status === "pending",
                  ).length
                }
              </span>
            )}
          </a>
        ))}
      </nav>
      {current === "calendar" && (
        <>
          <div className="att-toolbar att-view-heading">
            <div>
              <h2>Meeting calendar</h2>
              <p className="att-muted">
                {manager
                  ? "Plan meetings. Open check-in. Review each roster."
                  : "Your meetings, check-ins, and attendance record."}
              </p>
            </div>
            {manager && (
              <button
                onClick={() => {
                  const date = new Date();
                  date.setHours(18, 0, 0, 0);
                  setCreating(date);
                }}
              >
                New meeting
              </button>
            )}
          </div>
          <MeetingCalendar
            meetings={data.meetings}
            onOpen={setSelected}
            onCreate={manager ? setCreating : undefined}
          />
          {profile.role === "lead" && (
            <details className="att-panel">
              <summary>My Attendance (lead)</summary>
              <Student data={data} id={profile.id} run={run} />
            </details>
          )}
        </>
      )}
      {current === "roster" && manager && (
        <>
          <h2>Team roster</h2>
          <p className="att-muted">
            Registration and team areas apply to future meetings. Existing
            required rosters stay unchanged.
          </p>
          <label className="att-select">
            Find a member
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or team area"
            />
          </label>
          {data.members
            .filter((m) =>
              `${m.display_name} ${m.team_area}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((m) => (
              <details className="att-record" key={m.student_id}>
                <summary>
                  {m.display_name}
                  <span>
                    {label(m.member_status)} · {m.team_area || "No team area"}
                  </span>
                </summary>
                <MemberForm member={m} run={run} />
              </details>
            ))}
          {!data.members.filter((m) =>
            `${m.display_name} ${m.team_area}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          ).length && (
            <p className="att-empty">
              {search
                ? "No members match your search."
                : "No active student accounts found."}
            </p>
          )}
        </>
      )}
      {(current === "notices" || current === "strikes") && (
        <>
          <h2>
            {current === "notices"
              ? "Notices & excuse review"
              : "Strikes & leadership actions"}
          </h2>
          <p className="att-muted">
            {current === "notices"
              ? "Notify leadership at least 24 hours before a meeting. Excuse decisions remain separate from physical attendance."
              : "Totals use active strike records. Three strikes require warning / parent contact; five require leadership review. Access is never changed automatically."}
          </p>
          {current === "notices" && (
            <label className="att-select">
              Notice status
              <select
                value={noticeFilter}
                onChange={(e) => setNoticeFilter(e.target.value)}
              >
                <option value="pending">Pending review</option>
                <option value="excused">Approved / excused</option>
                <option value="denied">Denied / unexcused</option>
                <option value="all">All notices</option>
              </select>
            </label>
          )}
          {current === "strikes" &&
            manager &&
            data.members
              .filter((m) => summary(data, m.student_id).strikes >= 3)
              .map((m) => (
                <p className="att-panel" key={m.student_id}>
                  <strong>
                    {m.display_name} · {summary(data, m.student_id).strikes}{" "}
                    active strikes
                  </strong>
                  <small>
                    {strikeAction(summary(data, m.student_id).strikes)}
                  </small>
                </p>
              ))}
          {!incidentRows.length && (
            <p className="att-empty">
              {current === "notices"
                ? "No notices to review in this view."
                : "No strikes recorded."}
            </p>
          )}
          {incidentRows.map((a) => {
            const meeting = data.meetings.find((m) => m.id === a.meeting_id);
            return (
              meeting && (
                <article className="att-panel" key={a.id}>
                  <div className="att-toolbar">
                    <h3>
                      {manager
                        ? `${data.members.find((m) => m.student_id === a.student_id)?.display_name ?? "Member"} · `
                        : ""}
                      {meeting.title}
                    </h3>
                    <button
                      className="att-secondary"
                      onClick={() => setSelected(meeting.id)}
                    >
                      Open meeting
                    </button>
                  </div>
                  {current === "notices" ? (
                    <>
                      <Status attendance={a} />
                      <p>{a.notice_reason || "Excuse review requested"}</p>
                      <NoticeDetails a={a} meeting={meeting} />
                      {a.review_reason && <p>{a.review_reason}</p>}
                      {manager && (
                        <details>
                          <summary>Review notice</summary>
                          <AttendanceEditor
                            key={`${a.id}-${a.version}`}
                            a={a}
                            meeting={meeting}
                            data={data}
                            run={run}
                          />
                        </details>
                      )}
                    </>
                  ) : (
                    <StrikeList
                      data={ownData}
                      attendance={a}
                      run={manager ? run : undefined}
                    />
                  )}
                </article>
              )
            );
          })}
          {current === "notices" && !manager && (
            <a href="#attendance/calendar">
              Open a meeting to submit a notice →
            </a>
          )}
        </>
      )}
      {current === "history" && (
        <>
          <h2>Attendance history</h2>
          <p className="att-muted">
            Select a meeting to see its attendance and strike changes.
          </p>
          <label className="att-select">
            History meeting
            <select
              value={historyMeeting}
              onChange={(e) => {
                setHistoryMeeting(e.target.value);
                setHistory(null);
              }}
            >
              <option value="">Select a meeting</option>
              {data.meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} · {time(m.starts_at)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!historyMeeting}
            onClick={() =>
              void run(
                async () => setHistory(await loadHistory(historyMeeting)),
                "History loaded",
              )
            }
          >
            Load history
          </button>
          {history ? (
            <HistoryList history={history} />
          ) : (
            <p className="att-empty">
              History appears here after you select a meeting and load it.
            </p>
          )}
        </>
      )}
      <details className="att-policy">
        <summary>Attendance policy</summary>
        <p>
          Notify leadership at least 24 hours in advance. The default late
          threshold is 10 minutes. Excused and Not Required meetings are
          excluded from percentages. Late and Left Early count as attended.
          Strikes are reviewed separately and never automatically remove members
          or change access.
        </p>
      </details>
      {creating && (
        <Modal
          title="New meeting"
          busy={busy}
          onClose={() => setCreating(null)}
        >
          <>
            {error && (
              <p className="att-error" role="alert">
                {error}
              </p>
            )}
          </>
          <MeetingForm
            members={data.members}
            run={run}
            date={creating}
            onCreated={() => setCreating(null)}
          />
        </Modal>
      )}
      {selectedMeeting && (
        <Modal
          title="Meeting details"
          busy={busy}
          onClose={() => setSelected(null)}
        >
          {error && (
            <p className="att-error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {manager ? (
            <Management
              key={selectedMeeting.id}
              selected={selectedMeeting.id}
              data={data}
              run={run}
            />
          ) : (
            <Student
              key={selectedMeeting.id}
              data={{ ...data, meetings: [selectedMeeting] }}
              id={profile.id}
              run={run}
            />
          )}
        </Modal>
      )}
    </>
  );
}

function NoticeDetails({ a, meeting: m }: { a: Attendance; meeting: Meeting }) {
  const lead = a.notice_at
    ? (Date.parse(m.starts_at) - Date.parse(a.notice_at)) / 3600000
    : null;
  return (
    <div className="att-muted">
      {a.notice_at && (
        <>
          <p>
            <strong>
              Attendance notice:{" "}
              {a.notice_type === "late"
                ? "Arriving late"
                : a.notice_type === "early"
                  ? "Leaving early"
                  : a.notice_type === "absent"
                    ? "Absent"
                    : "Attendance impact"}
            </strong>
            {a.expected_at && <> · Expected {time(a.expected_at)}</>}
            <br />
            {a.notice_reason}
            <br />
            Submitted {time(a.notice_at)} ·{" "}
            {lead! >= 0
              ? `${lead!.toFixed(1)} hours in advance`
              : `${Math.abs(lead!).toFixed(1)} hours after start`}{" "}
            · {noticeTiming(a, m)}
          </p>
        </>
      )}
      <p>
        Actual check-in: {time(a.checked_in_at)} · Actual departure:{" "}
        {time(a.left_at)}
        <br />
        Excuse review:{" "}
        {a.review_status === "denied"
          ? "Denied / unexcused"
          : label(a.review_status)}
      </p>
    </div>
  );
}
function NoticeForm({
  a,
  meeting: m,
  run,
}: {
  a: Attendance;
  meeting: Meeting;
  run: Run;
}) {
  const active = Date.now() >= Date.parse(m.starts_at);
  const [kind, setKind] = useState<string>(
    active ? "early" : a.notice_type || "absent",
  );
  if (m.status === "finalized" || Date.now() >= Date.parse(m.ends_at))
    return null;
  return (
    <details>
      <summary>
        {active
          ? "I need to leave early"
          : a.notice_at
            ? "Update attendance request"
            : "Submit attendance request"}
      </summary>
      <form
        className="att-form"
        onSubmit={(e) => {
          const f = fields(e);
          void run(
            () =>
              rpc("team_attendance_request", {
                p: {
                  meeting_id: m.id,
                  version: a.version,
                  notice_type: active ? "early" : kind,
                  expected_at: text(f, "expected")
                    ? new Date(text(f, "expected")).toISOString()
                    : null,
                  reason: text(f, "reason"),
                },
              }),
            "Attendance request submitted for leadership review",
          );
        }}
      >
        <label>
          How will your attendance be affected?
          <select
            value={active ? "early" : kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {!active && (
              <>
                <option value="absent">I will be absent</option>
                <option value="late">I will arrive late</option>
              </>
            )}
            <option value="early">I need to leave early</option>
          </select>
        </label>
        {(active || kind !== "absent") && (
          <label>
            {active || kind === "early"
              ? "Expected departure"
              : "Expected arrival"}
            <input
              type="datetime-local"
              name="expected"
              defaultValue={localTime(a.expected_at ?? null)}
              required
            />
          </label>
        )}
        <label>
          Reason
          <textarea
            name="reason"
            maxLength={2000}
            defaultValue={a.notice_reason}
            required
          />
        </label>
        <p className="att-muted">
          Leadership reviews this request separately. It does not excuse you,
          record an actual departure, or assign strikes. Updating a request
          records a new submission time; the previous notice remains in audit
          history.
        </p>
        <button>Submit attendance request</button>
      </form>
    </details>
  );
}
function DepartureForm({
  a,
  meeting: m,
  run,
}: {
  a: Attendance;
  meeting: Meeting;
  run: Run;
}) {
  const [departure, setDeparture] = useState("");
  if (Date.now() < Date.parse(m.starts_at) || m.status === "finalized")
    return null;
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !departure)
          setDeparture(localTime(a.left_at || new Date().toISOString()));
      }}
    >
      <summary>Mark left early</summary>
      <form
        className="att-form"
        onSubmit={(e) => {
          const f = fields(e);
          void run(
            () =>
              manage("attendance", {
                meeting_id: m.id,
                attendance_id: a.id,
                version: a.version,
                physical_status: "left_early",
                left_at: new Date(text(f, "departure")).toISOString(),
                review_status: text(f, "decision"),
                explanation:
                  text(f, "departure_reason").trim() ||
                  "Leadership recorded early departure.",
              }),
            "Early departure recorded",
          );
        }}
      >
        <label>
          Actual departure time
          <input
            name="departure"
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            required
          />
        </label>
        <label>
          Departure reason (optional)
          <textarea name="departure_reason" maxLength={2000} />
        </label>
        <label>
          Departure excuse decision
          <select name="decision" defaultValue={a.review_status}>
            {["none", "pending", "excused", "denied", "not_required"].map(
              (v) => (
                <option value={v} key={v}>
                  {v === "denied" ? "Denied / unexcused" : label(v)}
                </option>
              ),
            )}
          </select>
        </label>
        <button>Confirm left early</button>
      </form>
    </details>
  );
}
