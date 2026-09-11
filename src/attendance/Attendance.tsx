import { useEffect, useRef, useState, type FormEvent } from "react";
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
export function AttendanceHub() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [loading, setLoading] = useState(!!supabase),
    [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState(false),
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
      className="attendance-section"
      aria-labelledby="attendance-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="attendance-heading">Attendance</h2>
          <p>Show up. Stay connected. Keep your record clear.</p>
        </div>
        {profile && (
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
                  <button onClick={() => setPage(!page)}>
                    {page
                      ? "Hide attendance details"
                      : isManager(profile)
                        ? "Manage attendance"
                        : "My Attendance"}
                  </button>
                </div>
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
                      Notices to review
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
                {page && (
                  <div className="att-details">
                    <p className="att-policy">
                      Notify leadership at least 24 hours before a meeting if
                      attendance will be impacted. The default grace period is
                      10 minutes. Excused and Not Required meetings are excluded
                      from percentages. Late and Left Early count as attended;
                      strikes are reviewed separately. No strike threshold
                      automatically removes a member or changes access.
                    </p>
                    <fieldset disabled={busy} className="att-fieldset">
                      {isManager(profile) ? (
                        <>
                          {profile.role === "lead" && (
                            <details className="att-panel">
                              <summary>My Attendance (lead)</summary>
                              <Student data={data} id={profile.id} run={run} />
                            </details>
                          )}
                          <Management data={data} run={run} />
                        </>
                      ) : (
                        <Student data={data} id={profile.id} run={run} />
                      )}
                    </fieldset>
                  </div>
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
            {a.notice_at ? (
              <p>
                Notice submitted {time(a.notice_at)}: {a.notice_reason}
                <br />
                {noticeTiming(a, m)}
              </p>
            ) : (
              m.status !== "finalized" && (
                <details>
                  <summary>Notify leadership / request excuse</summary>
                  <form
                    className="att-form"
                    onSubmit={(e) => {
                      const f = fields(e);
                      void run(
                        () =>
                          rpc("team_attendance_notice", {
                            meeting_id: m.id,
                            reason: text(f, "reason"),
                          }),
                        "Notice submitted for leadership review",
                      );
                    }}
                  >
                    <label>
                      Reason
                      <textarea name="reason" maxLength={2000} required />
                    </label>
                    <p>
                      Submitting a notice does not automatically excuse
                      attendance. Submission time is recorded.
                    </p>
                    <button>Submit notice</button>
                  </form>
                </details>
              )
            )}
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
function Management({ data, run }: { data: Data; run: Run }) {
  const [selected, setSelected] = useState(""),
    [code, setCode] = useState<{
      meetingId: string;
      code: string;
      expires: string;
    } | null>(null),
    [history, setHistory] = useState<History[] | null>(null);
  const m = data.meetings.find((m) => m.id === selected);
  return (
    <>
      <h3>Team attendance</h3>
      <details className="att-panel">
        <summary>Membership & team areas</summary>
        <p>
          New members default to Prospective. Set Registered before creating
          required meetings. Changes do not alter existing meeting snapshots.
        </p>
        {data.members.map((member) => (
          <MemberForm key={member.student_id} member={member} run={run} />
        ))}
        {!data.members.length && <p>No active student accounts found.</p>}
      </details>
      <details className="att-panel">
        <summary>Create meeting</summary>
        <MeetingForm members={data.members} run={run} />
      </details>
      <label className="att-select">
        Meeting
        <select
          aria-label="Meeting"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setCode(null);
            setHistory(null);
          }}
        >
          <option value="">Select a meeting</option>
          {data.meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title} · {time(m.starts_at)} · {label(m.status)}
            </option>
          ))}
        </select>
      </label>
      {!data.meetings.length && (
        <p className="att-panel">
          Create your first meeting after reviewing member registration and team
          areas.
        </p>
      )}
      {m && (
        <>
          <div className="att-panel">
            <MeetingHeader meeting={m} />
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
            {code && code.meetingId === m.id && m.check_in_open && (
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
          {data.attendance
            .filter((a) => a.meeting_id === m.id)
            .map((a) => (
              <AttendanceEditor
                key={`${a.id}-${a.version}`}
                a={a}
                meeting={m}
                data={data}
                run={run}
              />
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
function MeetingForm({ members, run }: { members: Member[]; run: Run }) {
  const [requirement, setRequirement] = useState("registered");
  return (
    <form
      className="att-form"
      onSubmit={(e) => {
        const f = fields(e);
        const form = e.currentTarget;
        void run(async () => {
          await manage("create", {
            title: text(f, "title"),
            meeting_type: text(f, "type"),
            starts_at: new Date(text(f, "start")).toISOString(),
            ends_at: new Date(text(f, "end")).toISOString(),
            late_minutes: Number(f.get("late")),
            requirement,
            areas: f.getAll("areas"),
            selected_students: f.getAll("students"),
          });
          form.reset();
          setRequirement("registered");
        }, "Meeting created with required roster snapshot");
      }}
    >
      <label>
        Title
        <input name="title" maxLength={150} required />
      </label>
      <div className="att-grid">
        <label>
          Meeting type
          <select name="type">
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
        <label>
          Start (your local time)
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          End (your local time)
          <input name="end" type="datetime-local" required />
        </label>
      </div>
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
      <Stats data={data} id={a.student_id} />
      <p>
        Check-in: {time(a.checked_in_at)} · {noticeTiming(a, m)}
      </p>
      {a.notice_at && (
        <p>
          Notice {time(a.notice_at)}: {a.notice_reason}
        </p>
      )}
      {a.review_reason && (
        <p>
          Latest review: {a.review_reason} · {time(a.reviewed_at)}
        </p>
      )}
      <details>
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
      <details>
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
