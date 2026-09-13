import { test, expect } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let db: PGlite;
const ids = {
  student: "00000000-0000-0000-0000-000000000001",
  other: "00000000-0000-0000-0000-000000000002",
  lead: "00000000-0000-0000-0000-000000000003",
  mentor: "00000000-0000-0000-0000-000000000004",
  admin: "00000000-0000-0000-0000-000000000005",
  readonly: "00000000-0000-0000-0000-000000000006",
  inactive: "00000000-0000-0000-0000-000000000007",
};
async function as(role: keyof typeof ids) {
  await db.exec(
    `reset role; select set_config('test.uid','${ids[role]}',false); set role authenticated;`,
  );
}
async function manage(action: string, p: Record<string, unknown>) {
  const r = await db.query<{ result: any }>(
    "select public.team_attendance_manage($1,$2::jsonb) result",
    [action, JSON.stringify(p)],
  );
  return r.rows[0].result;
}
async function create(extra: Record<string, unknown> = {}) {
  return (
    await manage("create", {
      title: "Preseason build",
      meeting_type: "preseason",
      starts_at: new Date(Date.now() - 5 * 60000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60000).toISOString(),
      requirement: "registered",
      ...extra,
    })
  ).id as string;
}
async function row(mid: string, uid = ids.student) {
  return (
    await db.query<any>(
      "select * from public.team_attendance where meeting_id=$1 and student_id=$2",
      [mid, uid],
    )
  ).rows[0];
}
async function check(mid: string, code: string) {
  return (
    await db.query<any>(
      "select public.team_attendance_check_in($1,$2) result",
      [mid, code],
    )
  ).rows[0].result;
}
test.describe("Attendance database permissions and policy", () => {
  test.beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
   create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
   insert into public.profiles values ${Object.entries(ids)
     .map(
       ([role, id]) =>
         `('${id}','${role}','${["other", "inactive"].includes(role) ? "student" : role}',${role !== "inactive"})`,
     )
     .join(",")};`);
    await db.exec(
      readFileSync(
        "supabase/migrations/202609100001_team_attendance.sql",
        "utf8",
      ),
    );
  });
  test.beforeAll(async () => {
    await db.exec(
      readFileSync(
        "supabase/migrations/202609120001_attendance_requests_recurrence.sql",
        "utf8",
      ),
    );
  });
  test.beforeAll(async () => {await db.exec(readFileSync("supabase/migrations/202609120008_attendance_roster_sync.sql","utf8"));});
  test.afterAll(async () => {
    await db.close();
  });
  test("RLS, column secrecy, authorization, and immutable writes", async () => {
    await as("lead");
    await manage("member", {
      student_id: ids.student,
      member_status: "registered",
      team_area: "Build",
    });
    const mid = await create();
    expect(
      (
        await db.query(
          "select * from public.team_attendance where meeting_id=$1",
          [mid],
        )
      ).rows.length,
    ).toBe(3);
    await as("student");
    expect(
      (
        await db.query(
          "select * from public.team_attendance where meeting_id=$1",
          [mid],
        )
      ).rows.length,
    ).toBe(1);
    expect(
      (
        await db.query(
          "select * from public.team_meeting_members where meeting_id=$1",
          [mid],
        )
      ).rows.length,
    ).toBe(1);
    await expect(
      db.query("select code_hash from public.team_meetings"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("update public.team_attendance set physical_status='present'"),
    ).rejects.toThrow(/permission denied/);
    await expect(manage("create", {})).rejects.toThrow(/Leadership/);
    await expect(
      db.query("select * from public.team_attendance_roster()"),
    ).rejects.toThrow(/Leadership/);
    expect(
      (
        await db.query("select * from public.team_attendance_history")
      ).rows.every((r: any) => r.student_id === ids.student),
    ).toBe(true);
    for (const role of ["readonly", "inactive"] as const) {
      await as(role);
      expect(
        (await db.query("select * from public.team_attendance")).rows.length,
      ).toBe(0);
      await expect(check(mid, "123456")).rejects.toThrow(/Student access/);
      await expect(manage("create", {})).rejects.toThrow(/Leadership/);
    }
    await db.exec("reset role; set role anon;");
    await expect(
      db.query("select * from public.team_attendance"),
    ).rejects.toThrow(/permission denied/);
    await expect(check(mid, "123456")).rejects.toThrow(/permission denied/);
    for (const role of ["admin", "mentor"] as const) {
      await as(role);
      expect(
        (
          await db.query(
            "select * from public.team_attendance where meeting_id=$1",
            [mid],
          )
        ).rows.length,
      ).toBe(3);
    }
  });
  test("snapshots survive member changes; explicit prospective inclusion and optional/area requirements", async () => {
    await as("lead");
    const mid = await create();
    await manage("member", {
      student_id: ids.student,
      member_status: "inactive",
      team_area: "Software",
    });
    expect(
      (
        await db.query<any>(
          "select * from public.team_meeting_members where meeting_id=$1 and student_id=$2",
          [mid, ids.student],
        )
      ).rows[0],
    ).toMatchObject({
      required: true,
      member_status: "registered",
      team_area: "Build",
    });
    const selected = await create({
      requirement: "selected",
      selected_students: [ids.other],
    });
    expect(
      (
        await db.query<any>(
          "select required from public.team_meeting_members where meeting_id=$1 and student_id=$2",
          [selected, ids.other],
        )
      ).rows[0].required,
    ).toBe(true);
    const optional = await create({ requirement: "optional" });
    expect(
      (
        await db.query<any>(
          "select required from public.team_meeting_members where meeting_id=$1",
          [optional],
        )
      ).rows.every((r) => !r.required),
    ).toBe(true);
    await manage("member", {
      student_id: ids.student,
      member_status: "registered",
      team_area: "Build",
    });
    const areas = await create({ requirement: "areas", areas: ["Software"] });
    expect(
      (
        await db.query<any>(
          "select required from public.team_meeting_members where meeting_id=$1",
          [areas],
        )
      ).rows.every((r) => !r.required),
    ).toBe(true);
  });
  test("check-in code rotation, rate limiting, own identity, grace, expiry, and idempotency", async () => {
    await as("lead");
    const mid = await create();
    const first = await manage("open", { meeting_id: mid, version: 1 });
    expect(first.code).toMatch(/^\d{6}$/);
    const second = await manage("open", { meeting_id: mid, version: 2 });
    await as("student");
    if (first.code !== second.code)
      expect((await check(mid, first.code)).error).toMatch(/Invalid/);
    expect((await check(mid, second.code)).message).toBe("Checked in");
    expect((await row(mid)).physical_status).toBe("present");
    const version = (await row(mid)).version;
    await check(mid, second.code);
    expect((await row(mid)).version).toBe(version);
    await as("other");
    for (let i = 0; i < 5; i++)
      expect((await check(mid, "invalid")).error).toMatch(/Invalid/);
    expect((await check(mid, second.code)).error).toMatch(/Too many/);
    expect((await row(mid, ids.other)).physical_status).toBe("pending");
    await as("lead");
    const late = await create({
      starts_at: new Date(Date.now() - 11 * 60000).toISOString(),
    });
    const opened = await manage("open", { meeting_id: late, version: 1 });
    await as("student");
    await check(late, opened.code);
    expect((await row(late)).physical_status).toBe("late");
    await db.exec("reset role");
    await db.query(
      "update public.team_meetings set code_expires_at=now()-interval '1 second' where id=$1",
      [late],
    );
    await as("other");
    await expect(check(late, opened.code)).rejects.toThrow(/expired/);
    await as("lead");
    await manage("close", { meeting_id: mid, version: 3 });
    await as("other");
    await expect(check(mid, second.code)).rejects.toThrow(/closed/);
  });
  test("notice review, close/finalize, audited corrections and multiple rescindable strikes", async () => {
    await as("lead");
    const future = await create({
      starts_at: new Date(Date.now() + 48 * 3600000).toISOString(),
      ends_at: new Date(Date.now() + 49 * 3600000).toISOString(),
    });
    await as("student");
    await db.query("select public.team_attendance_notice($1,$2)", [
      future,
      "Family commitment",
    ]);
    expect((await row(future)).review_status).toBe("pending");
    await expect(
      db.query("select public.team_attendance_notice($1,$2)", [
        future,
        "Change",
      ]),
    ).rejects.toThrow(/already/);
    await as("lead");
    const mid = await create();
    await manage("open", { meeting_id: mid, version: 1 });
    await expect(
      manage("finalize", { meeting_id: mid, version: 2 }),
    ).rejects.toThrow(/Close/);
    await manage("close", { meeting_id: mid, version: 2 });
    await expect(
      manage("finalize", { meeting_id: mid, version: 3 }),
    ).rejects.toThrow(/scheduled end/);
    await db.exec("reset role");
    await db.query(
      "update public.team_meetings set starts_at=now()-interval '2 hours', ends_at=now()-interval '1 hour' where id=$1",
      [mid],
    );
    await as("lead");
    await manage("finalize", { meeting_id: mid, version: 3 });
    let a = await row(mid);
    expect(a.physical_status).toBe("absent");
    await manage("attendance", {
      meeting_id: mid,
      attendance_id: a.id,
      version: a.version,
      physical_status: "absent",
      review_status: "excused",
      explanation: "Reviewed family commitment",
    });
    await expect(
      manage("attendance", {
        meeting_id: mid,
        attendance_id: a.id,
        version: a.version,
        physical_status: "present",
        explanation: "Stale edit",
      }),
    ).rejects.toThrow(/changed/);
    for (const category of ["Unexcused Absence", "Insufficient Notice"])
      await manage("strike", {
        meeting_id: mid,
        attendance_id: a.id,
        category,
        quantity: 1,
        explanation: "Leadership decision",
      });
    const strikes = (
      await db.query<any>(
        "select * from public.team_attendance_strikes where attendance_id=$1",
        [a.id],
      )
    ).rows;
    expect(strikes.length).toBe(2);
    await manage("rescind", {
      meeting_id: mid,
      attendance_id: a.id,
      strike_id: strikes[0].id,
      explanation: "Incorrect assignment",
    });
    expect(
      (
        await db.query<any>(
          "select sum(quantity)::int total from public.team_attendance_strikes where attendance_id=$1 and rescinded_at is null",
          [a.id],
        )
      ).rows[0].total,
    ).toBe(1);
    await expect(
      manage("rescind", {
        meeting_id: mid,
        attendance_id: a.id,
        strike_id: strikes[0].id,
        explanation: "again",
      }),
    ).rejects.toThrow(/Active strike/);
    const history = (
      await db.query<any>(
        "select * from public.team_attendance_history where meeting_id=$1 and entity='team_attendance_strikes'",
        [mid],
      )
    ).rows;
    expect(history.length).toBe(3);
    expect(history[2].before_data.rescinded_at).toBe(null);
    expect(history[2].after_data.rescind_reason).toBe("Incorrect assignment");
    expect(
      (
        await db
          .query<any>("select * from public.profiles where id=$1", [
            ids.student,
          ])
          .catch(() => ({ rows: [] }))
      ).rows,
    ).toEqual([]); // no shared profile grants added
    await as("student");
    expect(
      (
        await db.query<any>("select * from public.team_attendance_strikes")
      ).rows.every((r) => r.student_id === ids.student),
    ).toBe(true);
    await expect(
      db.query("delete from public.team_attendance_history"),
    ).rejects.toThrow(/permission denied/);
  });
  test("never-opened meetings finalize and early departure requires a valid time", async () => {
    await as("mentor");
    const mid = await create({
      starts_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      ends_at: new Date(Date.now() - 3600000).toISOString(),
    });
    await manage("close", { meeting_id: mid, version: 1 });
    await manage("finalize", { meeting_id: mid, version: 2 });
    const a = await row(mid);
    await expect(
      manage("attendance", {
        meeting_id: mid,
        attendance_id: a.id,
        version: a.version,
        physical_status: "left_early",
        explanation: "Left before end",
      }),
    ).rejects.toThrow(/Departure/);
    await manage("attendance", {
      meeting_id: mid,
      attendance_id: a.id,
      version: a.version,
      physical_status: "left_early",
      left_at: new Date(Date.now() - 90 * 60000).toISOString(),
      explanation: "Left before end",
    });
    expect((await row(mid)).physical_status).toBe("left_early");
    await as("student");
    await expect(
      db.query("select public.team_attendance_notice($1,$2)", [
        mid,
        "After finalization",
      ]),
    ).rejects.toThrow(/finalized/);
    await expect(
      db.query("select selected_students from public.team_meetings"),
    ).rejects.toThrow(/permission denied/);
  });
  test("structured notices stay separate from physical attendance and strikes; revisions are audited", async () => {
    await as("lead");
    const mid = await create({
      starts_at: new Date(Date.now() + 48 * 3600000).toISOString(),
      ends_at: new Date(Date.now() + 51 * 3600000).toISOString(),
    });
    await as("student");
    const request = async (p: any) =>
      db.query("select public.team_attendance_request($1::jsonb)", [
        JSON.stringify(p),
      ]);
    let a = await row(mid);
    const p = {
      meeting_id: mid,
      version: a.version,
      notice_type: "late",
      expected_at: new Date(Date.now() + 49 * 3600000).toISOString(),
      reason: "Transport",
    };
    await request(p);
    a = await row(mid);
    expect(a.notice_type).toBe("late");
    expect(a.physical_status).toBe("pending");
    expect(a.review_status).toBe("pending");
    expect(Date.parse(a.notice_at)).toBeGreaterThan(Date.now() - 10000);
    await expect(request(p)).rejects.toThrow(/changed/);
    await expect(
      request({
        ...p,
        version: a.version,
        expected_at: new Date(Date.now() + 60 * 3600000).toISOString(),
      }),
    ).rejects.toThrow(/Expected time/);
    await as("readonly");
    await expect(request(p)).rejects.toThrow(/Student access/);
    await as("other");
    await request({ ...p, student_id: ids.student, reason: "Own record only" });
    expect((await row(mid, ids.other)).notice_reason).toBe("Own record only");
    await as("student");
    expect((await row(mid)).notice_reason).toBe("Transport");
    await as("lead");
    const active = await create();
    await as("student");
    a = await row(active);
    await request({
      meeting_id: active,
      version: a.version,
      notice_type: "early",
      expected_at: new Date(Date.now() + 10 * 60000).toISOString(),
      reason: "Need to leave",
    });
    a = await row(active);
    expect(a.physical_status).toBe("pending");
    expect(a.left_at).toBeNull();
    await expect(
      request({
        meeting_id: active,
        version: a.version,
        notice_type: "absent",
        reason: "No",
      }),
    ).rejects.toThrow(/only early/);
    await request({
      meeting_id: active,
      version: a.version,
      notice_type: "early",
      expected_at: new Date(Date.now() + 15 * 60000).toISOString(),
      reason: "Updated departure",
    });
    expect(
      (
        await db.query<any>(
          "select * from public.team_attendance_history where meeting_id=$1",
          [active],
        )
      ).rows.length,
    ).toBeGreaterThanOrEqual(3);
    await as("lead");
    a = await row(active);
    await manage("attendance", {
      meeting_id: active,
      attendance_id: a.id,
      version: a.version,
      physical_status: "left_early",
      left_at: new Date().toISOString(),
      review_status: "excused",
      explanation: "Confirmed departure",
    });
    expect((await row(active)).physical_status).toBe("left_early");
    expect(
      (
        await db.query(
          "select * from public.team_attendance_strikes where meeting_id=$1",
          [active],
        )
      ).rows,
    ).toHaveLength(0);
  });
  test("recurrence batches enforce roles and rollback every meeting on failure", async () => {
    const base = {
      title: "Recurring",
      meeting_type: "offseason",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      requirement: "registered",
    };
    const batch = (items: any[]) =>
      db.query<any>(
        "select public.team_attendance_create_batch($1::jsonb) result",
        [JSON.stringify(items)],
      );
    await as("student");
    await expect(batch([base])).rejects.toThrow(/Leadership/);
    await as("mentor");
    await expect(batch([])).rejects.toThrow(/between 1 and 52/);
    await expect(batch(Array(53).fill(base))).rejects.toThrow(
      /between 1 and 52/,
    );
    const before = (await db.query("select id from public.team_meetings")).rows
      .length;
    await expect(batch([base, { ...base, title: "" }])).rejects.toThrow();
    expect(
      (await db.query("select id from public.team_meetings")).rows,
    ).toHaveLength(before);
    const ids = (await batch([base, base])).rows[0].result.map(
      (x: any) => x.id,
    );
    for (const id of ids)
      expect(
        (
          await db.query(
            "select * from public.team_meeting_members where meeting_id=$1",
            [id],
          )
        ).rows.length,
      ).toBeGreaterThan(0);
  });

  test("future roster sync is additive, audited, authorized and preserves history/custom decisions",async()=>{
    const fresh="00000000-0000-0000-0000-000000000020",prospective="00000000-0000-0000-0000-000000000021";
    await db.exec(`reset role;insert into profiles values('${prospective}','Prospective','student',true);`);
    await as('lead');
    const future={starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString()};
    const active=await create({...future,requirement:'active'}),registered=await create({...future,requirement:'registered'});
    const custom=await create({...future,requirement:'selected',selected_students:[ids.student]});
    const area=await create({...future,requirement:'areas',areas:['Software']}),optional=await create({...future,requirement:'optional'});
    const past=await create({requirement:'active'}),finalized=await create({...future,requirement:'active'});
    await db.exec(`reset role;update team_meetings set status='finalized' where id='${finalized}';`);
    const protectedIds=[custom,area,optional,past,finalized];
    const snapshots=async()=>({members:(await db.query('select * from team_meeting_members where meeting_id=any($1::uuid[]) order by meeting_id,student_id',[protectedIds])).rows,attendance:(await db.query('select * from team_attendance where meeting_id=any($1::uuid[]) order by id',[protectedIds])).rows});
    const before=await snapshots();
    // All-active creation includes a prospective student without a registration row.
    expect((await db.query<any>('select required from team_meeting_members where meeting_id=$1 and student_id=$2',[active,prospective])).rows[0].required).toBe(true);
    await db.exec(`insert into profiles values('${fresh}','New student','student',true);`);
    const sync=()=>db.query<any>('select team_attendance_sync_future_rosters() result');
    await as('student');await expect(sync()).rejects.toThrow(/Leadership/);
    await db.exec('reset role;set role anon');await expect(sync()).rejects.toThrow(/permission denied/);
    await as('lead');await sync();
    expect(await row(active,fresh)).toMatchObject({review_status:'none',physical_status:'pending'});
    expect(await row(registered,fresh)).toBeUndefined();
    // An existing prospective roster entry is upgraded, not duplicated.
    await manage('member',{student_id:prospective,member_status:'registered',team_area:'Software'});
    await manage('member',{student_id:fresh,member_status:'registered',team_area:'Software'});
    await sync();expect(await row(registered,prospective)).toMatchObject({review_status:'none',version:2});
    expect(await row(registered,fresh)).toMatchObject({review_status:'none',version:1});
    const replay=(await sync()).rows[0].result;expect(replay.added).toBe(0);expect(replay.promoted).toBe(0);
    await db.exec('reset role');expect(await snapshots()).toEqual(before);
    expect((await db.query("select * from team_attendance_private.history where meeting_id=$1 and action='ROSTER_SYNC_ADD' and student_id=$2",[registered,fresh])).rows).toHaveLength(1);
    // Existing RLS and request RPC work for the newly synchronized student.
    await db.exec(`select set_config('test.uid','${fresh}',false);set role authenticated;`);
    expect((await db.query('select id from team_meetings where id=$1',[registered])).rows).toHaveLength(1);
    await db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:registered,version:1,notice_type:'absent',reason:'Travel conflict'})]);
    expect(await row(registered,fresh)).toMatchObject({review_status:'pending',notice_reason:'Travel conflict'});
    await as('lead');await manage('member',{student_id:fresh,member_status:'inactive',team_area:'Software'});await sync();
    expect(await row(registered,fresh)).toMatchObject({review_status:'pending',notice_reason:'Travel conflict'});
    // Do not overwrite a pre-existing optional request when registration changes.
    await manage('member',{student_id:prospective,member_status:'prospective',team_area:'Software'});
    const requested=await create({...future,requirement:'registered'});
    await db.exec(`reset role;select set_config('test.uid','${prospective}',false);set role authenticated;`);
    await db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:requested,version:1,notice_type:'absent',reason:'Existing request'})]);
    const untouched=await row(requested,prospective);
    await as('lead');await manage('member',{student_id:prospective,member_status:'registered',team_area:'Software'});
    expect((await sync()).rows[0].result.skipped).toBeGreaterThan(0);expect(await row(requested,prospective)).toEqual(untouched);
  });
});
