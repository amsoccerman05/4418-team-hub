import { test, expect } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
let db: PGlite;
async function as(n: number, role = "authenticated") {
  await db.exec(
    `reset role;select set_config('test.uid','${n ? id(n) : ""}',false);set role ${role};`,
  );
}
async function save(action: string, p: Record<string, unknown> = {}) {
  return (
    await db.query<any>(
      "select public.team_volunteer_save($1,$2::jsonb) result",
      [action, JSON.stringify({ request_id: randomUUID(), ...p })],
    )
  ).rows[0].result;
}
const past = (day = 1, hour = 12) =>
  new Date(Date.now() - day * 86400000).toISOString().slice(0, 10) +
  `T${hour}:00:00Z`;
const draft = (day = 1) => ({
  activity: "mentoring",
  time_zone: "America/Chicago",
  started_at: past(day),
  ended_at: past(day, 14),
  notes: "Synthetic volunteer work",
  season_id: id(20),
  meeting_id: id(30),
});
async function entries() {
  return (
    await db.query<any>(
      "select * from public.team_volunteer_entries order by created_at",
    )
  ).rows;
}
async function total() {
  return (await db.query<any>("select public.team_volunteer_summary() result"))
    .rows[0].result;
}
async function history(entry: string) {
  return (
    await db.query<any>("select public.team_volunteer_history($1) result", [
      entry,
    ])
  ).rows[0].result;
}
test.describe("Independent volunteer hours database", () => {
  test.beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;
 create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
 insert into public.profiles values('${id(1)}','Mentor One','mentor',true),('${id(2)}','Mentor Two','mentor',true),('${id(3)}','Admin','admin',true),('${id(4)}','Student','student',true),('${id(5)}','Lead','lead',true),('${id(6)}','Read only','readonly',true),('${id(7)}','Inactive mentor','mentor',false);
 create table public.planning_seasons(id uuid primary key,name text,start_date date,end_date date,status text,created_at timestamptz default now());
 insert into public.planning_seasons values('${id(20)}','Archived synthetic season','2025-01-01','2027-12-31','archived',now());
 create table public.team_meetings(id uuid primary key,title text,starts_at timestamptz,ends_at timestamptz);
 insert into public.team_meetings values('${id(30)}','Synthetic meeting','2026-01-01T18:00Z','2026-01-01T20:00Z');
 create table public.team_attendance(id int primary key,student_id uuid,physical_status text);insert into public.team_attendance values(1,'${id(4)}','absent');
 create table public.team_attendance_strikes(id int primary key,quantity int);insert into public.team_attendance_strikes values(1,3);`);
    await db.exec(
      readFileSync(
        "supabase/migrations/20261007155231_mentor_volunteer_hours.sql",
        "utf8",
      ),
    );
    await as(1);
  });
  test.afterEach(async () => {
    await db.close();
  });
  test("mentor self-only read, admin aggregate-only team read, blocked roles and direct writes", async () => {
    const e = await save("manual", draft());
    expect((await entries()).length).toBe(1);
    await expect(
      db.exec(`update public.team_volunteer_entries set notes='hacked'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(`delete from public.team_volunteer_entries`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("select * from volunteer_private.history"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("select * from volunteer_private.receipts"),
    ).rejects.toThrow(/permission denied/);
    await expect(total()).rejects.toThrow(/admin/);
    await as(2);
    expect(await entries()).toEqual([]);
    await expect(history(e.id)).rejects.toThrow(/unavailable/);
    await expect(
      save("correct", {
        ...draft(),
        id: e.id,
        version: e.version,
        reason: "Not mine",
      }),
    ).rejects.toThrow(/unavailable/);
    await as(3);
    expect(await entries()).toEqual([]);
    expect((await total())[0].hours).toBe(2);
    await expect(history(e.id)).rejects.toThrow(/unavailable/);
    await expect(
      save("void", {
        id: e.id,
        version: 1,
        reason: "Admin cannot edit others",
      }),
    ).rejects.toThrow(/unavailable/);
    for (const who of [4, 5, 6, 7, 0]) {
      await as(who);
      expect(await entries()).toEqual([]);
      await expect(
        save("start", { activity: "mentoring", time_zone: "UTC" }),
      ).rejects.toThrow(/access required/);
      await expect(
        db.exec("select public.team_volunteer_context()"),
      ).rejects.toThrow(/access required/);
    }
    await as(0, "anon");
    await expect(
      db.exec("select public.team_volunteer_context()"),
    ).rejects.toThrow(/permission denied/);
    await expect(entries()).rejects.toThrow(/permission denied/);
  });
  test("manual, corrections, void and retry retain immutable history and do not change students", async () => {
    const request_id = randomUUID(),
      p = { ...draft(), request_id };
    const e = await save("manual", p);
    expect(await save("manual", p)).toEqual(e);
    expect(await entries()).toHaveLength(1);
    expect(await history(e.id)).toHaveLength(1);
    await expect(
      save("manual", { ...p, notes: "Different same request" }),
    ).rejects.toThrow(/already used/);
    const correction = {
      ...draft(),
      id: e.id,
      version: 1,
      ended_at: past(1, 15),
      reason: "Forgot cleanup",
      request_id: randomUUID(),
    };
    const edited = await save("correct", correction);
    expect(edited.version).toBe(2);
    expect(await save("correct", correction)).toEqual(edited);
    await expect(
      save("correct", {
        ...correction,
        request_id: randomUUID(),
        notes: "Stale edit",
      }),
    ).rejects.toThrow(/Entry changed/);
    const h = await history(e.id);
    expect(h).toHaveLength(2);
    expect(h[0].before_data.ended_at).toBe(e.ended_at);
    expect(h[0].reason).toBe("Forgot cleanup");
    await expect(
      save("void", { id: e.id, version: 2, reason: " " }),
    ).rejects.toThrow(/reason/);
    await save("void", { id: e.id, version: 2, reason: "Duplicate paper log" });
    expect(await history(e.id)).toHaveLength(3);
    await expect(
      save("correct", { ...correction, request_id: randomUUID(), version: 3 }),
    ).rejects.toThrow(/Voided/);
    await as(3);
    expect(await total()).toEqual([]);
    await db.exec("reset role");
    expect(
      (
        await db.query<any>(
          "select physical_status from public.team_attendance",
        )
      ).rows[0].physical_status,
    ).toBe("absent");
    expect(
      (
        await db.query<any>(
          "select quantity from public.team_attendance_strikes",
        )
      ).rows[0].quantity,
    ).toBe(3);
  });
  test("server timer, single open timer, idempotent stop, overlap protection across seasons", async () => {
    const p = {
      activity: "setup_cleanup",
      time_zone: "UTC",
      request_id: randomUUID(),
    };
    const e = await save("start", p);
    expect(e.ended_at).toBeNull();
    expect(Math.abs(Date.now() - Date.parse(e.started_at))).toBeLessThan(3000);
    expect(await save("start", p)).toEqual(e);
    await expect(
      save("start", { ...p, request_id: randomUUID() }),
    ).rejects.toThrow(/already have/);
    const during = new Date(Date.parse(e.started_at) + 1).toISOString();
    await expect(
      save("manual", {
        ...draft(),
        started_at: e.started_at,
        ended_at: during,
        season_id: null,
      }),
    ).rejects.toThrow(/overlaps|between/);
    await as(3);
    expect((await total())[0]).toMatchObject({
      hours: 0,
      running_entries: 1,
      completed_entries: 0,
    });
    await as(1);
    const stop = { id: e.id, version: 1, request_id: randomUUID() };
    const done = await save("stop", stop);
    expect(done.ended_at).not.toBeNull();
    expect(await save("stop", stop)).toEqual(done);
    expect(await history(e.id)).toHaveLength(2);
    await expect(
      save("stop", { ...stop, request_id: randomUUID() }),
    ).rejects.toThrow(/Entry changed/);
  });
  test("missing checkout never credits a day or scheduled meeting; actual correction required", async () => {
    const e = await save("start", {
      activity: "mentoring",
      time_zone: "UTC",
      meeting_id: id(30),
    });
    await db.exec(
      `reset role;update public.team_volunteer_entries set started_at=clock_timestamp()-interval '25 hours' where id='${e.id}'`,
    );
    await as(1);
    await expect(save("stop", { id: e.id, version: 1 })).rejects.toThrow(
      /Missing checkout/,
    );
    await as(3);
    expect((await total())[0]).toMatchObject({
      hours: 0,
      running_entries: 1,
      missing_checkouts: 1,
    });
    await as(1);
    await save("correct", {
      ...draft(2),
      id: e.id,
      version: 1,
      reason: "Actual end from my notes",
    });
    await as(3);
    expect((await total())[0]).toMatchObject({
      hours: 2,
      running_entries: 0,
      missing_checkouts: 0,
    });
  });
  test("manual overlaps, exact duplicates, future time, duration bounds and invalid time zones rejected", async () => {
    const e = await save("manual", draft(3));
    await expect(
      save("manual", { ...draft(3), season_id: null }),
    ).rejects.toThrow(/overlaps/);
    await expect(
      save("manual", {
        ...draft(3),
        started_at: past(3, 13),
        ended_at: past(3, 15),
      }),
    ).rejects.toThrow(/overlaps/);
    expect(
      await save("manual", {
        ...draft(3),
        started_at: past(3, 14),
        ended_at: past(3, 15),
      }),
    ).toBeTruthy();
    await expect(
      save("manual", { ...draft(4), ended_at: past(4) }),
    ).rejects.toThrow(/End must/);
    await expect(
      save("manual", { ...draft(4), ended_at: past(2) }),
    ).rejects.toThrow(/24 hours/);
    await expect(save("manual", { ...draft(-2) })).rejects.toThrow(
      /actual time/,
    );
    await expect(
      save("manual", { ...draft(4), time_zone: "Not/AZone" }),
    ).rejects.toThrow(/valid IANA/);
    await expect(
      save("manual", { ...draft(4), started_at: past(4).replace("Z", "") }),
    ).rejects.toThrow(/explicit UTC offset/);
    await expect(
      save("manual", { ...draft(4), activity: "payroll" }),
    ).rejects.toThrow(/activity/);
    await expect(
      save("manual", { ...draft(4), notes: "a".repeat(2001) }),
    ).rejects.toThrow(/2000/);
    await expect(
      save("correct", { ...draft(4), id: e.id, version: 1, reason: "" }),
    ).rejects.toThrow(/reason/);
  });
  test("overnight and DST actual instants, archived season, optional meeting outside schedule, no backfill", async () => {
    expect(await entries()).toEqual([]);
    const e = await save("manual", {
      ...draft(),
      started_at: "2025-11-02T01:30:00-05:00",
      ended_at: "2025-11-02T01:30:00-06:00",
    });
    expect(e.activity_date).toBe("2025-11-02");
    const night = await save("manual", {
      ...draft(),
      started_at: "2025-11-03T23:30:00-06:00",
      ended_at: "2025-11-04T01:30:00-06:00",
      meeting_id: null,
    });
    expect(night.activity_date).toBe("2025-11-03");
    await as(3);
    expect((await total()).reduce((n: number, r: any) => n + r.hours, 0)).toBe(
      3,
    );
  });
  test("actor and timestamps are server-controlled; audit failure rolls back the entire mutation", async () => {
    const e = await save("start", {
      activity: "other",
      time_zone: "UTC",
      user_id: id(2),
      started_at: "2001-01-01T00:00:00Z",
      ended_at: "2001-01-01T01:00:00Z",
    });
    expect(e.user_id).toBe(id(1));
    expect(e.ended_at).toBeNull();
    expect(Date.parse(e.started_at)).toBeGreaterThan(
      Date.parse("2026-01-01T00:00:00Z"),
    );
    await db.exec(
      `reset role;create function volunteer_private.reject_audit() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure';end$$;create trigger reject_test before insert on volunteer_private.history for each row execute function volunteer_private.reject_audit();`,
    );
    await as(1);
    await expect(save("stop", { id: e.id, version: 1 })).rejects.toThrow(
      /Synthetic audit failure/,
    );
    expect((await entries())[0].ended_at).toBeNull();
    expect((await entries())[0].version).toBe(1);
    expect(await history(e.id)).toHaveLength(1);
  });
  test("approved mentor gets only revocable aggregate reporting without a global role change", async () => {
    const e = await save("manual", draft());
    await as(2);
    await expect(total()).rejects.toThrow(/approved mentor/);
    await db.exec(
      `reset role;insert into volunteer_private.report_readers(user_id,granted_by,reason) values('${id(2)}','${id(3)}','Synthetic approved reporting');`,
    );
    await as(2);
    expect(
      (await db.query<any>("select team_volunteer_context() r")).rows[0].r
        .can_view_team,
    ).toBe(true);
    expect((await total())[0].hours).toBe(2);
    expect(await entries()).toEqual([]);
    await expect(history(e.id)).rejects.toThrow(/unavailable/);
    await expect(
      save("correct", {
        ...draft(),
        id: e.id,
        version: 1,
        reason: "Forbidden other entry",
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(
      db.exec("select * from volunteer_private.report_readers"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(
        `insert into volunteer_private.report_readers(user_id,granted_by,reason) values('${id(1)}','${id(2)}','Self grant')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await db.exec(
      `reset role;update volunteer_private.report_readers set revoked_at=clock_timestamp() where user_id='${id(2)}'`,
    );
    await as(2);
    expect(
      (await db.query<any>("select team_volunteer_context() r")).rows[0].r
        .can_view_team,
    ).toBe(false);
    await expect(total()).rejects.toThrow(/approved mentor/);
    await db.exec(
      `reset role;update volunteer_private.report_readers set revoked_at=null where user_id='${id(2)}';update profiles set active=false where id='${id(2)}'`,
    );
    await as(2);
    await expect(total()).rejects.toThrow(/approved mentor/);
    await db.exec(
      `reset role;update profiles set active=true,role='student' where id='${id(2)}'`,
    );
    await as(2);
    await expect(total()).rejects.toThrow(/approved mentor/);
    await db.exec(
      `reset role;update profiles set role='mentor' where id='${id(2)}'`,
    );
    await as(2);
    expect((await total())[0].hours).toBe(2);
  });
  test("eligibility is checked for existing data and the RPC wrappers are invoker-only", async () => {
    await save("manual", draft());
    await db.exec(
      `reset role;update profiles set active=false where id='${id(1)}'`,
    );
    await as(1);
    expect(await entries()).toEqual([]);
    await expect(save("manual", draft(2))).rejects.toThrow(/access required/);
    await db.exec("reset role");
    const f = (
      await db.query<any>(
        "select proname,prosecdef,proconfig from pg_proc where proname like 'team_volunteer_%'",
      )
    ).rows;
    expect(f).toHaveLength(4);
    expect(f.every((x) => !x.prosecdef)).toBe(true);
  });
});
