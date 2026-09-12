import { useState } from "react";
import { label, type Meeting } from "./service";
const dateLabel = (date: Date) =>
  date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
export function MeetingCalendar({
  meetings,
  onOpen,
  onCreate,
}: {
  meetings: Meeting[];
  onOpen: (id: string) => void;
  onCreate?: (date: Date) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date()),
    [mode, setMode] = useState<"month" | "week">(() =>
      window.matchMedia("(max-width: 700px)").matches ? "week" : "month",
    );
  const first = new Date(
    cursor.getFullYear(),
    cursor.getMonth(),
    mode === "month" ? 1 : cursor.getDate(),
  );
  first.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: mode === "month" ? 42 : 7 }, (_, index) => {
    const date = new Date(first);
    date.setDate(date.getDate() + index);
    return date;
  });
  const move = (amount: number) =>
    setCursor((current) =>
      mode === "month"
        ? new Date(current.getFullYear(), current.getMonth() + amount, 1)
        : new Date(
            current.getFullYear(),
            current.getMonth(),
            current.getDate() + amount * 7,
          ),
    );
  return (
    <div className="att-calendar">
      <div className="att-toolbar att-calendar-toolbar">
        <h2>
          {mode === "month"
            ? cursor.toLocaleDateString([], { month: "long", year: "numeric" })
            : `${dateLabel(days[0])} – ${dateLabel(days[6])}`}
        </h2>
        <div className="att-toolbar">
          <button
            className="att-secondary"
            aria-label="Previous period"
            onClick={() => move(-1)}
          >
            ←
          </button>
          <button
            className="att-secondary"
            onClick={() => setCursor(new Date())}
          >
            Today
          </button>
          <button
            className="att-secondary"
            aria-label="Next period"
            onClick={() => move(1)}
          >
            →
          </button>
        </div>
        <div className="att-toolbar" role="group" aria-label="Calendar view">
          {(["month", "week"] as const).map((view) => (
            <button
              key={view}
              className={mode === view ? "" : "att-secondary"}
              aria-pressed={mode === view}
              onClick={() => setMode(view)}
            >
              {label(view)}
            </button>
          ))}
        </div>
      </div>
      <p className="att-muted">
        {onCreate
          ? "Select a date to create a meeting, or open a meeting to manage attendance."
          : "Open a meeting to check in or send a notice."}{" "}
        Times shown in your local time zone.
      </p>
      <div className={`att-calendar-grid ${mode}`}>
        {days.map((date) => {
          const events = meetings
            .filter((m) => sameDay(new Date(m.starts_at), date))
            .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
          return (
            <div
              key={date.toISOString()}
              className={`att-day ${sameDay(date, new Date()) ? "today" : ""} ${date.getMonth() !== cursor.getMonth() && mode === "month" ? "outside" : ""}`}
            >
              {onCreate ? (
                <button
                  className="att-date att-secondary"
                  aria-label={`Create meeting on ${dateLabel(date)}`}
                  onClick={() => {
                    const start = new Date(date);
                    start.setHours(18);
                    onCreate(start);
                  }}
                >
                  <span>
                    {date.toLocaleDateString([], { weekday: "short" })}
                  </span>{" "}
                  {date.getDate()} <span aria-hidden="true">+</span>
                </button>
              ) : (
                <div className="att-date">
                  {date.toLocaleDateString([], {
                    weekday: "short",
                    day: "numeric",
                  })}
                </div>
              )}
              {events.map((m) => (
                <button
                  key={m.id}
                  className={`att-event ${m.status}`}
                  onClick={() => onOpen(m.id)}
                >
                  <strong>{m.title}</strong>
                  <span>
                    {new Date(m.starts_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {label(m.status)}
                  </span>
                </button>
              ))}
              {!events.length && (
                <small className="att-no-events">No meetings</small>
              )}
              {mode === "week" && onCreate && (
                <div className="att-time-slots">
                  {[9, 12, 15, 18].map((hour) => (
                    <button
                      key={hour}
                      className="att-secondary"
                      aria-label={`Create meeting on ${dateLabel(date)} at ${hour}:00`}
                      onClick={() => {
                        const start = new Date(date);
                        start.setHours(hour);
                        onCreate(start);
                      }}
                    >
                      {hour}:00 +
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!meetings.length && (
        <p className="att-empty">
          No meetings yet.
          {onCreate
            ? " Review the roster, then choose a date to create the first meeting."
            : "Your meetings will appear here when leadership adds you to a roster."}
        </p>
      )}
    </div>
  );
}
