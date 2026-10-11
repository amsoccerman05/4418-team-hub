#!/usr/bin/env node
// Owns a fresh synthetic PostgreSQL cluster, using a private Unix socket only.
// ATTENDANCE_EDITING_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/attendance-editing-concurrency.mjs
// No existing database URL, production credentials, browser, or migration deploy.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { installAttendanceEditingFixture } from '../integration/attendance-editing-fixture.mjs';

const bin = process.env.ATTENDANCE_EDITING_PG_BIN || process.env.DESIGN_DECISION_PG_BIN;
assert(bin && isAbsolute(bin), 'Set ATTENDANCE_EDITING_PG_BIN to an installed local PostgreSQL bin directory');
const root = mkdtempSync(join(tmpdir(), 'attendance-edit-it-')), data = join(root, 'db');
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8', TZ: 'UTC' };
const args = ['-X', '-h', root, '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const sql = input => execFileSync(join(bin, 'psql'), args, { input, env, encoding: 'utf8', timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }).trim();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = n => `select set_config('test.uid',${literal(n ? id(n) : '')},false);set role authenticated;`;
const value = output => JSON.parse(output.split('\n').filter(Boolean).at(-1));
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const edit = (p, who = 1) => `${actor(who)}select public.team_attendance_edit_meeting(${json(p)});`;
const checkIn = (mid, code) => `${actor(3)}select public.team_attendance_check_in(${literal(mid)},${literal(code)});`;
const children = new Set();
let started = false, checks = 0;
const pass = label => { checks++; console.log(`PASS Attendance: ${label}`); };

function session(name) {
  const child = spawn(join(bin, 'psql'), args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', b => { out += b; });
    child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => { children.delete(child); code ? reject(Error(err || `psql exited ${code}`)) : resolve(out.trim()); });
  });
  done.catch(() => {}); // Failure is asserted by the caller after gate release.
  child.stdin.write("set statement_timeout='15s';set idle_in_transaction_session_timeout='20s';\n");
  return { child, done, output: () => out };
}
function asyncSQL(query, name) {
  const s = session(name); s.child.stdin.end(`${query}\n`); return s.done;
}
async function waitFor(predicate, label) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(`Timed out waiting for ${label}`);
}
async function transactionGate(query, name) {
  const s = session(name);
  s.child.stdin.write(`begin;${query}select 'ATTENDANCE_GATE_READY';\n`);
  await Promise.race([
    waitFor(() => s.output().includes('ATTENDANCE_GATE_READY'), `${name} readiness`),
    s.done.then(() => { throw Error(`${name} exited before the gate became ready`); }),
  ]);
  let released = false;
  return { done: s.done, release: async () => {
    if (!released) { released = true; s.child.stdin.end('commit;\n\\q\n'); }
    return s.done;
  } };
}
const blocked = (...names) => waitFor(() => Number(sql(`select count(*) from pg_stat_activity
  where application_name in (${names.map(literal).join(',')}) and wait_event_type='Lock'`)) === names.length, `${names.join(', ')} lock wait`);
const meeting = mid => value(sql(`select to_jsonb(m) from public.team_meetings m where id=${literal(mid)}`));
const draft = (mid, changes = {}) => {
  const m = meeting(mid);
  return { meeting_id: mid, version: m.version, title: m.title, meeting_type: m.meeting_type, starts_at: m.starts_at, ends_at: m.ends_at, ...changes };
};
const snapshot = mid => sql(`select jsonb_build_object(
  'attendance',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.team_attendance t where meeting_id=${literal(mid)}),
  'roster',(select coalesce(jsonb_agg(to_jsonb(t) order by student_id),'[]') from public.team_meeting_members t where meeting_id=${literal(mid)}),
  'strikes',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.team_attendance_strikes t where meeting_id=${literal(mid)}))`);
const auditCount = mid => Number(sql(`select count(*) from public.team_attendance_history where entity='team_meetings' and entity_id=${literal(mid)} and action='UPDATE'`));
function createMeeting(title, starts = 120) {
  return value(sql(`${actor(1)}select public.team_attendance_manage('create',${json({ title, meeting_type: 'preseason', requirement: 'active', starts_at: future(starts), ends_at: future(starts + 120) })});`)).id;
}
function openMeeting(mid) {
  return value(sql(`${actor(1)}select public.team_attendance_manage('open',${json({ meeting_id: mid, version: meeting(mid).version })});`)).code;
}

try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], { env, stdio: 'pipe', timeout: 30_000 });
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start'], { env, stdio: 'pipe', timeout: 30_000 });
  started = true;
  sql(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into public.profiles values
      ('${id(1)}','Synthetic mentor','mentor',true),('${id(2)}','Synthetic lead','lead',true),
      ('${id(3)}','Synthetic student','student',true),('${id(4)}','Synthetic Program Manager','student',true),
      ('${id(5)}','Synthetic reader','readonly',true),('${id(6)}','Synthetic admin','admin',true),
      ('${id(7)}','Synthetic inactive lead','lead',false);
    create table public.team_positions(key text primary key,name text,active boolean);
    create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    insert into public.team_positions values('program_manager','Program Manager',true);
    insert into public.team_member_positions values('${id(4)}','program_manager',null);`);
  await installAttendanceEditingFixture(sql);
  for (const file of [
    '20261008063138_attendance_coach_request_review.sql',
    '20261008234849_attendance_active_meeting_roster_sync.sql',
    '20261009155227_attendance_automatic_absence_strikes.sql',
    '20261010144754_attendance_operations_lead_participation.sql',
    '20261011025742_attendance_required_roster_editing.sql',
  ]) sql(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));

  const mid = createMeeting('Synthetic edit race'), records = snapshot(mid);
  const original = draft(mid), before = auditCount(mid);
  const gate = await transactionGate('select pg_advisory_xact_lock(4418,10);', 'edit-pair-gate');
  const pair = Promise.allSettled([
    asyncSQL(edit({ ...original, title: 'Mentor edit' }, 1), 'edit-pair-one'),
    asyncSQL(edit({ ...original, title: 'Lead edit' }, 2), 'edit-pair-two'),
  ]);
  await blocked('edit-pair-one', 'edit-pair-two'); await gate.release();
  const results = await pair;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /Meeting changed/);
  assert.equal(meeting(mid).version, original.version + 1); assert.equal(auditCount(mid), before + 1);
  assert.equal(snapshot(mid), records);
  const audit = value(sql(`select to_jsonb(h) from public.team_attendance_history h where entity='team_meetings' and entity_id=${literal(mid)} and action='UPDATE' order by id desc limit 1`));
  assert.equal(audit.before_data.title, original.title); assert.equal(audit.after_data.title, meeting(mid).title);
  assert.equal(audit.performed_by, audit.after_data.title === 'Mentor edit' ? id(1) : id(2));
  for (const payload of [audit.before_data, audit.after_data]) for (const key of ['code_hash', 'code_expires_at']) assert(!(key in payload));
  pass('two real sessions sharing a version yield one edit/audit; roster, attendance, strikes stay unchanged');

  const replay = draft(mid, { title: 'Synthetic retry' }), replayBefore = auditCount(mid);
  const retryGate = await transactionGate('select pg_advisory_xact_lock(4418,10);', 'retry-gate');
  const retries = Promise.all([asyncSQL(edit(replay), 'retry-one'), asyncSQL(edit(replay), 'retry-two')]);
  retries.catch(() => {});
  await blocked('retry-one', 'retry-two'); await retryGate.release();
  const receipts = (await retries).map(value);
  assert.deepEqual(receipts.map(r => r.changed).sort(), [false, true]);
  assert(receipts.every(r => r.version === replay.version + 1)); assert.equal(auditCount(mid), replayBefore + 1);
  assert.equal(snapshot(mid), records);
  pass('simultaneous identical retries commit one mutation and return the same version');

  const revokeGate = await transactionGate('select pg_advisory_xact_lock(4418,10);', 'role-gate');
  const roleBefore = meeting(mid), roleAudit = auditCount(mid);
  const revoked = asyncSQL(edit(draft(mid, { title: 'Forbidden queued edit' }), 2), 'revoked-edit');
  await blocked('revoked-edit'); sql(`update public.profiles set role='readonly' where id='${id(2)}';`);
  await revokeGate.release(); await assert.rejects(revoked, /Leadership access required/);
  assert.deepEqual(meeting(mid), roleBefore); assert.equal(auditCount(mid), roleAudit); assert.equal(snapshot(mid), records);
  sql(`update public.profiles set role='lead' where id='${id(2)}';`);
  pass('leadership is rechecked after the advisory-lock wait; role downgrade cannot write or audit');

  const checkedFirst = createMeeting('Synthetic check-in first', 20), code = openMeeting(checkedFirst);
  const checkOriginal = meeting(checkedFirst);
  const checkDraft = draft(checkedFirst, { starts_at: future(180), ends_at: future(300), acknowledge_schedule_change: true });
  const checkGate = await transactionGate(checkIn(checkedFirst, code), 'check-in-first');
  const queuedEdit = asyncSQL(edit(checkDraft), 'edit-after-check-in');
  await blocked('edit-after-check-in'); await checkGate.release();
  const checkedRecords = snapshot(checkedFirst), checkedMeeting = meeting(checkedFirst), checkedAudit = auditCount(checkedFirst);
  await assert.rejects(queuedEdit, /Recorded attendance or reviewed decisions lock this schedule/);
  assert.equal(snapshot(checkedFirst), checkedRecords); assert.deepEqual(meeting(checkedFirst), checkedMeeting); assert.equal(auditCount(checkedFirst), checkedAudit);
  const checked = value(sql(`select to_jsonb(a) from public.team_attendance a where meeting_id=${literal(checkedFirst)} and student_id='${id(3)}'`));
  assert.equal(checked.physical_status, 'present'); assert(checked.checked_in_at); assert.equal(checked.version, 2);
  assert.equal(checkedMeeting.starts_at, checkOriginal.starts_at); assert.equal(checkedMeeting.version, checkOriginal.version);
  pass('committed check-in wins the row-lock race; queued schedule edit cannot move recorded attendance');

  const editFirst = createMeeting('Synthetic edit first', 20), oldCode = openMeeting(editFirst);
  const pending = snapshot(editFirst), reschedule = draft(editFirst, { starts_at: future(180), ends_at: future(300), acknowledge_schedule_change: true });
  const editGate = await transactionGate(edit(reschedule), 'edit-first');
  const queuedCheck = asyncSQL(checkIn(editFirst, oldCode), 'check-in-after-edit');
  await blocked('check-in-after-edit'); await editGate.release();
  await assert.rejects(queuedCheck, /Check-in is closed or the code expired/);
  const moved = meeting(editFirst);
  assert.equal(new Date(moved.starts_at).toISOString(), reschedule.starts_at); assert.equal(moved.check_in_open, false);
  assert.equal(moved.code_hash, null); assert.equal(moved.code_expires_at, null); assert.equal(snapshot(editFirst), pending);
  pass('committed reschedule wins the row-lock race; queued old-code check-in fails without attendance writes');

  const denied = draft(mid, { title: 'Forbidden role edit' }), unchanged = meeting(mid), unchangedAudit = auditCount(mid);
  for (const who of [3, 4, 5, 7, null]) await assert.rejects(asyncSQL(edit(denied, who), `denied-${who}`), /Leadership access required/);
  await assert.rejects(asyncSQL(`set role anon;select public.team_attendance_edit_meeting(${json(denied)});`, 'denied-anon'), /permission denied/);
  for (const who of [1, 3, 4]) await assert.rejects(asyncSQL(`${actor(who)}update public.team_meetings set title='Direct write' where id=${literal(mid)};`, `direct-${who}`), /permission denied/);
  assert.deepEqual(meeting(mid), unchanged); assert.equal(auditCount(mid), unchangedAudit); assert.equal(snapshot(mid), records);
  pass('student, student Program Manager, readonly, inactive, missing actor, anonymous, and direct table writes fail closed');
  const required = meetingID => value(sql(`select coalesce(jsonb_agg(student_id order by student_id),'[]') from public.team_meeting_members where meeting_id=${literal(meetingID)} and required`));
  const rosterDraft = (meetingID, wanted) => draft(meetingID, {
    required_student_ids: wanted, expected_required_student_ids: required(meetingID), acknowledge_roster_change: true,
  });
  const rosterMid = createMeeting('Synthetic required roster race');
  const rosterBase = required(rosterMid), rosterBefore = auditCount(rosterMid);
  const rosterA = rosterDraft(rosterMid, rosterBase.filter(x => x !== id(3)));
  const rosterB = rosterDraft(rosterMid, rosterBase.filter(x => x !== id(4)));
  const rosterGate = await transactionGate('select pg_advisory_xact_lock(4418,10);', 'roster-pair-gate');
  const rosterPair = Promise.allSettled([
    asyncSQL(edit(rosterA), 'roster-pair-one'), asyncSQL(edit(rosterB, 2), 'roster-pair-two'),
  ]);
  await blocked('roster-pair-one', 'roster-pair-two'); await rosterGate.release();
  const rosterResults = await rosterPair;
  assert.equal(rosterResults.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(rosterResults.find(r => r.status === 'rejected').reason.message, /Meeting changed/);
  assert.equal(auditCount(rosterMid), rosterBefore + 1); assert.equal(meeting(rosterMid).requirement, 'selected');
  assert.equal(Number(sql(`select count(*) from public.team_meeting_members where meeting_id=${literal(rosterMid)}`)), rosterBase.length);
  const winner = rosterResults[0].status === 'fulfilled' ? rosterA : rosterB;
  const rosterState = snapshot(rosterMid);
  const rosterReplays = await Promise.all([asyncSQL(edit(winner), 'roster-retry-one'), asyncSQL(edit(winner), 'roster-retry-two')]);
  assert(rosterReplays.every(r => value(r).changed === false)); assert.equal(snapshot(rosterMid), rosterState);
  assert.equal(auditCount(rosterMid), rosterBefore + 1);
  pass('two required-roster edits serialize, retain every snapshot, and exact retries add no audit or version');

  const rosterCheckMid = createMeeting('Synthetic roster after check-in', 20), rosterCode = openMeeting(rosterCheckMid);
  const removeChecked = rosterDraft(rosterCheckMid, required(rosterCheckMid).filter(x => x !== id(3)));
  const rosterCheckGate = await transactionGate(checkIn(rosterCheckMid, rosterCode), 'roster-check-in-first');
  const rosterCheckEdit = asyncSQL(edit(removeChecked), 'roster-after-check-in');
  await blocked('roster-after-check-in'); await rosterCheckGate.release();
  const rosterChecked = snapshot(rosterCheckMid);
  await assert.rejects(rosterCheckEdit, /Recorded attendance, reviewed decisions, or strikes lock/);
  assert.equal(snapshot(rosterCheckMid), rosterChecked); assert(required(rosterCheckMid).includes(id(3)));
  pass('check-in wins the row-lock race and prevents a queued requirement change without losing evidence');

  const syncMid = createMeeting('Synthetic edit after roster sync');
  const syncDraft = rosterDraft(syncMid, required(syncMid).filter(x => x !== id(3)));
  sql(`insert into public.profiles values('${id(8)}','Synthetic late addition','student',true)`);
  const syncGate = await transactionGate(`${actor(1)}select public.team_attendance_sync_future_rosters();`, 'roster-sync-first');
  const syncEdit = asyncSQL(edit(syncDraft), 'edit-after-roster-sync');
  await blocked('edit-after-roster-sync'); await syncGate.release();
  const afterSync = snapshot(syncMid), syncMeeting = meeting(syncMid);
  await assert.rejects(syncEdit, /Required roster changed/);
  assert.equal(snapshot(syncMid), afterSync); assert.equal(syncMeeting.version, syncDraft.version);
  assert(required(syncMid).includes(id(8)));
  pass('roster sync without a meeting-version bump invalidates a stale required-list draft');

  const eligibilityMid = createMeeting('Synthetic eligibility recheck');
  const eligibilityDraft = rosterDraft(eligibilityMid, required(eligibilityMid).filter(x => x !== id(8)));
  const eligibilityGate = await transactionGate(`update public.profiles set active=false where id='${id(8)}';`, 'eligibility-change-first');
  const eligibilityEdit = asyncSQL(edit(eligibilityDraft), 'edit-after-eligibility');
  await blocked('edit-after-eligibility'); await eligibilityGate.release();
  const eligibilityState = snapshot(eligibilityMid);
  await assert.rejects(eligibilityEdit, /participant is unavailable/);
  assert.equal(snapshot(eligibilityMid), eligibilityState); assert(required(eligibilityMid).includes(id(8)));
  pass('participant eligibility is rechecked after its profile-lock wait and unavailable rows remain unchanged');

  const boundaryMid = createMeeting('Synthetic start-boundary recheck', 0.02);
  const boundaryDraft = rosterDraft(boundaryMid, required(boundaryMid).filter(x => x !== id(3)));
  const boundaryGate = await transactionGate('select pg_advisory_xact_lock(4418,10);', 'start-boundary-gate');
  const boundaryEdit = asyncSQL(edit(boundaryDraft), 'edit-after-start');
  await blocked('edit-after-start'); sql('select pg_sleep(1.3)'); await boundaryGate.release();
  await assert.rejects(boundaryEdit, /started/);
  assert.equal(meeting(boundaryMid).version, boundaryDraft.version);
  assert.deepEqual(required(boundaryMid), boundaryDraft.expected_required_student_ids);
  pass('queued required-roster edit rechecks the start boundary after waiting and writes nothing');
  console.log(`${checks} Attendance native multi-session/authorization checks passed; isolated PostgreSQL ${sql('show server_version')}.`);
} catch (error) {
  if (!started) { try { console.error(readFileSync(join(root, 'server.log'), 'utf8')); } catch {} }
  throw error;
} finally {
  for (const child of children) child.kill('SIGTERM');
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'pipe', timeout: 30_000 });
  rmSync(root, { recursive: true, force: true });
}
