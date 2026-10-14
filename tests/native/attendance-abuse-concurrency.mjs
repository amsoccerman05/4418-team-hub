#!/usr/bin/env node
// Synthetic, disposable PostgreSQL only; private Unix socket, no database URL.
// ATTENDANCE_ABUSE_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/attendance-abuse-concurrency.mjs
// Real Auth/PostgREST coverage is separate in attendance-abuse-stack.spec.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { installAttendanceEditingFixture } from '../integration/attendance-editing-fixture.mjs';
import { attendanceAbuseMigration } from '../integration/attendance-abuse-stack.spec.mjs';

const bin = process.env.ATTENDANCE_ABUSE_PG_BIN;
assert(bin && isAbsolute(bin), 'Set ATTENDANCE_ABUSE_PG_BIN to an installed local PostgreSQL bin directory');
const root = mkdtempSync(join(tmpdir(), 'attendance-abuse-it-')), data = join(root, 'db');
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8', TZ: 'UTC' };
const args = ['-X', '-h', root, '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const sql = input => execFileSync(join(bin, 'psql'), args, { input, env, encoding: 'utf8', timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }).trim();
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${lit(JSON.stringify(value))}::jsonb`;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = n => `select set_config('test.uid',${lit(id(n))},false);set role authenticated;`;
const value = output => JSON.parse(output.split('\n').filter(Boolean).at(-1));
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const checkIn = (mid, code, n = 3) => `${actor(n)}select public.team_attendance_check_in(${lit(mid)},${lit(code)});`;
const children = new Set();
let started = false, checks = 0;
const pass = label => { checks++; console.log(`PASS Attendance abuse: ${label}`); };
function session(name) {
  const child = spawn(join(bin, 'psql'), args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => { children.delete(child); code ? reject(Error(err || `psql exited ${code}`)) : resolve(out.trim()); });
  });
  done.catch(() => {});
  child.stdin.write("set statement_timeout='15s';set idle_in_transaction_session_timeout='25s';\n");
  return { child, done, output: () => out };
}
function asyncSQL(query, name) { const s = session(name); s.child.stdin.end(`${query}\n`); return s.done; }
async function waitFor(predicate, label) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(`Timed out waiting for ${label}`);
}
async function transactionGate(query, name) {
  const s = session(name); s.child.stdin.write(`begin;${query}select 'ATTENDANCE_ABUSE_GATE_READY';\n`);
  await Promise.race([waitFor(() => s.output().includes('ATTENDANCE_ABUSE_GATE_READY'), `${name} readiness`), s.done.then(() => { throw Error(`${name} exited before readiness`); })]);
  let released = false;
  return { release: async () => { if (!released) { released = true; s.child.stdin.end('commit;\n\\q\n'); } return s.done; } };
}
const blocked = (...names) => waitFor(() => Number(sql(`select count(*) from pg_stat_activity where application_name in (${names.map(lit).join(',')}) and wait_event_type='Lock'`)) === names.length, `${names.join(', ')} lock wait`);
const meeting = mid => value(sql(`select to_jsonb(m) from public.team_meetings m where id=${lit(mid)}`));
const counter = (mid, n = 3) => value(sql(`select jsonb_build_object('attempts',attempts,'window',attempt_window,'retry_at',attempt_window+interval '15 minutes') from public.team_meeting_members where meeting_id=${lit(mid)} and student_id=${lit(id(n))}`));
const attendance = (mid, n = 3) => sql(`select to_jsonb(a) from public.team_attendance a where meeting_id=${lit(mid)} and student_id=${lit(id(n))}`);
const meetingLock = mid => `select id from public.team_meetings where id=${lit(mid)} for update;`;
const memberLock = mid => `select student_id from public.team_meeting_members where meeting_id=${lit(mid)} and student_id=${lit(id(3))} for update;`;
const attendanceLock = mid => `select id from public.team_attendance where meeting_id=${lit(mid)} and student_id=${lit(id(3))} for update;`;
const wrong = code => code === '000000' ? '999999' : '000000';
function open(mid) { return value(sql(`${actor(1)}select public.team_attendance_manage('open',${json({ meeting_id: mid, version: meeting(mid).version })});`)).code; }
function create(title) {
  const mid = value(sql(`${actor(1)}select public.team_attendance_manage('create',${json({ title: `Synthetic abuse ${title}`, meeting_type: 'preseason', requirement: 'active', starts_at: future(-10), ends_at: future(120) })});`)).id;
  return { mid, code: open(mid) };
}
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], { env, stdio: 'pipe', timeout: 30_000 });
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start'], { env, stdio: 'pipe', timeout: 30_000 });
  started = true;
  sql(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into public.profiles values ('${id(1)}','Synthetic mentor','mentor',true),('${id(3)}','Synthetic student','student',true),('${id(4)}','Synthetic peer','student',true);
    create table public.team_positions(key text primary key,name text,active boolean);
    create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    insert into public.team_positions values('program_manager','Program Manager',true);`);
  await installAttendanceEditingFixture(sql);
  for (const file of ['20261008063138_attendance_coach_request_review.sql', '20261008234849_attendance_active_meeting_roster_sync.sql',
    '20261009155227_attendance_automatic_absence_strikes.sql', '20261010144754_attendance_operations_lead_participation.sql',
    '20261011025742_attendance_required_roster_editing.sql']) sql(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  sql(readFileSync(new URL(`../../${attendanceAbuseMigration}`, import.meta.url), 'utf8'));

  const burst = create('concurrent guesses'), initial = attendance(burst.mid);
  const start = await transactionGate(meetingLock(burst.mid), 'burst-gate');
  const names = Array.from({ length: 12 }, (_, i) => `invalid-burst-${i}`);
  const guesses = Promise.all(names.map(name => asyncSQL(checkIn(burst.mid, wrong(burst.code)), name).then(value)));
  guesses.catch(() => {}); await blocked(...names); await start.release();
  const results = await guesses;
  assert.equal(results.filter(r => r.status === 'invalid_code').length, 5);
  assert.equal(results.filter(r => r.status === 'rate_limited').length, 7);
  assert.equal(counter(burst.mid).attempts, 5); assert.equal(attendance(burst.mid), initial);
  for (const r of results.filter(r => r.status === 'rate_limited')) assert.equal(Date.parse(r.retry_at), Date.parse(counter(burst.mid).retry_at));
  pass('12 simultaneous wrong guesses consume exactly five authoritative attempts; seven are limited without attendance writes');

  const contention = await transactionGate(meetingLock(burst.mid), 'locked-meeting-gate');
  const allowed = asyncSQL(checkIn(burst.mid, burst.code, 4), 'allowed-peer'); allowed.catch(() => {});
  await blocked('allowed-peer');
  // A statement timeout makes shared-lock congestion a deterministic failure.
  const denied = await Promise.all(Array.from({ length: 16 }, (_, i) => asyncSQL(`set statement_timeout='1500ms';${checkIn(burst.mid, burst.code)}`, `limited-fast-${i}`).then(value)));
  assert(denied.every(r => r.status === 'rate_limited')); assert.equal(counter(burst.mid).attempts, 5);
  await blocked('allowed-peer'); await contention.release();
  assert.equal(value(await allowed).status, 'checked_in');
  pass('committed lockout returns without taking a shared meeting lock; an eligible peer waits and succeeds');

  const repeatGate = await transactionGate(meetingLock(burst.mid), 'repeat-gate');
  const repeated = asyncSQL(checkIn(burst.mid, 'not-a-code', 4), 'recorded-repeat'); repeated.catch(() => {});
  await blocked('recorded-repeat'); await repeatGate.release();
  assert.equal(value(await repeated).status, 'already_recorded');
  pass('recorded attendance keeps its idempotent result after authoritative locking');

  const rotation = create('rotation');
  const rotateGate = await transactionGate(`${actor(1)}select public.team_attendance_manage('open',${json({ meeting_id: rotation.mid, version: meeting(rotation.mid).version })});`, 'rotate-first');
  const stale = asyncSQL(checkIn(rotation.mid, rotation.code), 'stale-code'); stale.catch(() => {});
  await blocked('stale-code'); await rotateGate.release();
  assert.equal(value(await stale).status, 'invalid_code'); assert.equal(counter(rotation.mid).attempts, 1);
  assert.equal(value(attendance(rotation.mid)).checked_in_at, null);
  pass('code rotation committed during a lock wait invalidates the old code');

  const boundary = create('window boundary');
  sql(`update public.team_meeting_members set attempts=4,attempt_window=clock_timestamp()-interval '15 minutes'+interval '1200 milliseconds' where meeting_id=${lit(boundary.mid)} and student_id=${lit(id(3))}`);
  const oldWindow = counter(boundary.mid).window;
  const memberGate = await transactionGate(memberLock(boundary.mid), 'window-member-gate');
  const boundaryGuess = asyncSQL(checkIn(boundary.mid, wrong(boundary.code)), 'window-boundary'); boundaryGuess.catch(() => {});
  await blocked('window-boundary');
  await waitFor(() => Date.parse(counter(boundary.mid).retry_at) < Date.now(), 'attempt-window expiry');
  await memberGate.release(); assert.equal(value(await boundaryGuess).status, 'invalid_code');
  assert.equal(counter(boundary.mid).attempts, 1); assert(Date.parse(counter(boundary.mid).window) > Date.parse(oldWindow));
  pass('15-minute window is evaluated after the member-row wait and resets exactly once');

  for (const [label, lock] of [['member', memberLock], ['attendance', attendanceLock]]) {
    const expiry = create(`${label} wait expiry`), before = attendance(expiry.mid);
    sql(`update public.team_meetings set code_expires_at=clock_timestamp()+interval '1200 milliseconds' where id=${lit(expiry.mid)}`);
    const expiryGate = await transactionGate(lock(expiry.mid), `${label}-expiry-gate`);
    const waiting = asyncSQL(checkIn(expiry.mid, expiry.code), `${label}-expiry-check`); waiting.catch(() => {});
    await blocked(`${label}-expiry-check`);
    await waitFor(() => Date.parse(meeting(expiry.mid).code_expires_at) < Date.now(), 'code expiry');
    await expiryGate.release(); await assert.rejects(waiting, /Check-in is closed or the code expired/);
    assert.equal(counter(expiry.mid).attempts, 0); assert.equal(attendance(expiry.mid), before);
    pass(`code expiry after ${label}-row wait is authoritative and cannot record attendance or consume a guess`);
  }

  const revoked = create('account revoked'), beforeRevoke = attendance(revoked.mid);
  const revokeGate = await transactionGate(meetingLock(revoked.mid), 'revoke-gate');
  const revoking = asyncSQL(checkIn(revoked.mid, revoked.code), 'revoked-check'); revoking.catch(() => {});
  await blocked('revoked-check'); sql(`update public.profiles set active=false where id=${lit(id(3))}`);
  await revokeGate.release(); await assert.rejects(revoking, /Active Attendance participant required/);
  assert.equal(counter(revoked.mid).attempts, 0); assert.equal(attendance(revoked.mid), beforeRevoke);
  sql(`update public.profiles set active=true where id=${lit(id(3))}`);
  pass('account deactivation while queued is rechecked before code comparison or attendance writes');

  const missing = create('roster removed');
  const removalGate = await transactionGate(meetingLock(missing.mid), 'roster-gate');
  const removed = asyncSQL(checkIn(missing.mid, missing.code), 'removed-roster-check'); removed.catch(() => {});
  await blocked('removed-roster-check');
  sql(`${actor(1)}reset role;delete from public.team_attendance where meeting_id=${lit(missing.mid)} and student_id=${lit(id(3))};delete from public.team_meeting_members where meeting_id=${lit(missing.mid)} and student_id=${lit(id(3))};`);
  await removalGate.release(); await assert.rejects(removed, /not on this meeting roster/);
  assert.equal(sql(`select count(*) from public.team_attendance where meeting_id=${lit(missing.mid)} and student_id=${lit(id(3))}`), '0');
  pass('roster removal committed while queued is authoritative and cannot create a caller row');

  console.log(`${checks} Attendance native abuse/concurrency checks passed; isolated PostgreSQL ${sql('show server_version')}.`);
} catch (error) {
  if (!started) { try { console.error(readFileSync(join(root, 'server.log'), 'utf8')); } catch {} }
  throw error;
} finally {
  for (const child of children) child.kill('SIGTERM');
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'pipe', timeout: 30_000 });
  rmSync(root, { recursive: true, force: true });
}
