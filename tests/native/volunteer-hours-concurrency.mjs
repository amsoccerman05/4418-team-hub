#!/usr/bin/env node
// Owns a fresh synthetic PostgreSQL cluster on a private Unix socket.
// VOLUNTEER_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/volunteer-hours-concurrency.mjs
// Never accepts an existing database URL and never reads app credentials.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
const bin = process.env.VOLUNTEER_PG_BIN;
assert(
  bin && isAbsolute(bin),
  "Set VOLUNTEER_PG_BIN to an installed PostgreSQL bin directory",
);
const root = mkdtempSync(join(tmpdir(), "volunteer-it-")),
  data = join(root, "db");
const env = {
  PATH: process.env.PATH || "/usr/bin:/bin",
  HOME: root,
  LANG: "C.UTF-8",
  TZ: "UTC",
};
const args = [
  "-X",
  "-h",
  root,
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-Atq",
  "-v",
  "ON_ERROR_STOP=1",
];
const sql = (input) =>
  execFileSync(join(bin, "psql"), args, {
    input,
    env,
    encoding: "utf8",
    timeout: 25_000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;
const uid = "00000000-0000-0000-0000-000000000001";
const actor = `select set_config('test.uid','${uid}',false);set role authenticated;`;
const lock = `select pg_advisory_xact_lock(hashtextextended('volunteer:${uid}',0));`;
const save = (action, p) =>
  `${actor}select public.team_volunteer_save(${lit(action)},${json(p)});`;
const value = (output) => JSON.parse(output.split("\n").filter(Boolean).at(-1));
const children = new Set();
let started = false,
  checks = 0;
const pass = (label) => {
  checks++;
  console.log(`PASS Volunteer: ${label}`);
};
function session(name) {
  const child = spawn(join(bin, "psql"), args, {
    env: { ...env, PGAPPNAME: name },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let out = "",
    err = "";
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (b) => {
      out += b;
    });
    child.stderr.on("data", (b) => {
      err += b;
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => {
      children.delete(child);
      code ? reject(Error(err || `psql ${code}`)) : resolve(out.trim());
    });
  });
  done.catch(() => {});
  child.stdin.write(
    "set statement_timeout='15s';set idle_in_transaction_session_timeout='20s';\n",
  );
  return { child, done, output: () => out };
}
function asyncSQL(query, name) {
  const s = session(name);
  s.child.stdin.end(`${query}\n`);
  return s.done;
}
async function waitFor(fn, label) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error(`Timed out: ${label}`);
}
async function gate(name) {
  const s = session(name);
  s.child.stdin.write(`begin;${lock}select 'READY';\n`);
  await Promise.race([
    waitFor(() => s.output().includes("READY"), name),
    s.done.then(() => {
      throw Error("Gate exited");
    }),
  ]);
  return () => {
    s.child.stdin.end("commit;\n\\q\n");
    return s.done;
  };
}
const blocked = (...names) =>
  waitFor(
    () =>
      Number(
        sql(
          `select count(*) from pg_stat_activity where application_name in (${names.map(lit).join(",")}) and wait_event_type='Lock'`,
        ),
      ) === names.length,
    names.join(","),
  );
const read = (id) =>
  value(
    sql(
      `select to_jsonb(e) from public.team_volunteer_entries e where id=${lit(id)}`,
    ),
  );
const count = () =>
  Number(sql("select count(*) from public.team_volunteer_entries"));
const audits = () =>
  Number(sql("select count(*) from volunteer_private.history"));
const start = () => ({
  activity: "mentoring",
  time_zone: "UTC",
  request_id: randomUUID(),
});
const draft = (startHour, endHour) => ({
  activity: "planning",
  time_zone: "UTC",
  started_at: `2025-01-03T${startHour}:00:00Z`,
  ended_at: `2025-01-03T${endHour}:00:00Z`,
  request_id: randomUUID(),
});
try {
  execFileSync(
    join(bin, "initdb"),
    [
      "-D",
      data,
      "-A",
      "trust",
      "-U",
      "postgres",
      "--no-locale",
      "--encoding=UTF8",
    ],
    { env, stdio: "pipe", timeout: 30_000 },
  );
  execFileSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      data,
      "-l",
      join(root, "server.log"),
      "-o",
      `-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`,
      "-w",
      "start",
    ],
    { env, stdio: "pipe", timeout: 30_000 },
  );
  started = true;
  sql(
    `create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;create table public.profiles(id uuid primary key,display_name text,role text,active boolean);insert into profiles values('${uid}','Synthetic Mentor','mentor',true);create table public.planning_seasons(id uuid primary key,name text,start_date date,end_date date,status text,created_at timestamptz);create table public.team_meetings(id uuid primary key);`,
  );
  sql(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261007155231_mentor_volunteer_hours.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  let release = await gate("start-gate");
  let pair = Promise.allSettled([
    asyncSQL(save("start", start()), "start-one"),
    asyncSQL(save("start", start()), "start-two"),
  ]);
  await blocked("start-one", "start-two");
  await release();
  let results = await pair;
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /already have/,
  );
  assert.equal(count(), 1);
  assert.equal(audits(), 1);
  pass("two simultaneous starts commit exactly one timer and one audit");
  let row = value(
    sql("select to_jsonb(e) from public.team_volunteer_entries e"),
  );
  const stop = { id: row.id, version: row.version, request_id: randomUUID() };
  release = await gate("stop-gate");
  pair = Promise.allSettled([
    asyncSQL(save("stop", stop), "stop-one"),
    asyncSQL(save("stop", stop), "stop-two"),
  ]);
  await blocked("stop-one", "stop-two");
  await release();
  results = await pair;
  assert(results.every((r) => r.status === "fulfilled"));
  assert.deepEqual(value(results[0].value), value(results[1].value));
  assert.equal(audits(), 2);
  pass("simultaneous identical stop retries produce one checkout and audit");
  const p = draft("10", "12"),
    before = count();
  release = await gate("overlap-gate");
  pair = Promise.allSettled([
    asyncSQL(save("manual", p), "manual-one"),
    asyncSQL(save("manual", draft("11", "13")), "manual-two"),
  ]);
  await blocked("manual-one", "manual-two");
  await release();
  results = await pair;
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /overlaps/,
  );
  assert.equal(count(), before + 1);
  pass("overlapping manual entries cannot race past interval validation");
  const same = draft("14", "15"),
    preAudit = audits();
  release = await gate("retry-gate");
  pair = Promise.allSettled([
    asyncSQL(save("manual", same), "retry-one"),
    asyncSQL(save("manual", same), "retry-two"),
  ]);
  await blocked("retry-one", "retry-two");
  await release();
  results = await pair;
  assert(results.every((r) => r.status === "fulfilled"));
  assert.deepEqual(value(results[0].value), value(results[1].value));
  assert.equal(audits(), preAudit + 1);
  pass("lost-response manual retries are idempotent across two connections");
  row = value(results[0].value);
  const correction = {
    ...same,
    id: row.id,
    version: row.version,
    reason: "Synthetic correction",
    notes: "First",
    request_id: randomUUID(),
  };
  release = await gate("correction-gate");
  pair = Promise.allSettled([
    asyncSQL(save("correct", correction), "correct-one"),
    asyncSQL(
      save("correct", {
        ...correction,
        notes: "Second",
        request_id: randomUUID(),
      }),
      "correct-two",
    ),
  ]);
  await blocked("correct-one", "correct-two");
  await release();
  results = await pair;
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /Entry changed/,
  );
  assert.equal(read(row.id).version, 2);
  pass("stale concurrent corrections cannot overwrite each other");
  const beforeRole = count(),
    beforeAudit = audits();
  release = await gate("revoke-gate");
  const revoked = asyncSQL(save("manual", draft("16", "17")), "revoke-waiter");
  await blocked("revoke-waiter");
  sql(`update profiles set active=false where id='${uid}'`);
  await release();
  await assert.rejects(revoked, /access required/);
  assert.equal(count(), beforeRole);
  assert.equal(audits(), beforeAudit);
  pass("access is rechecked after waiting for the per-person lock");
  console.log(
    `${checks} native PostgreSQL volunteer concurrency checks passed`,
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  if (started)
    execFileSync(
      join(bin, "pg_ctl"),
      ["-D", data, "-m", "immediate", "-w", "stop"],
      { env, stdio: "pipe", timeout: 20_000 },
    );
  rmSync(root, { recursive: true, force: true });
}
