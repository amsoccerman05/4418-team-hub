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
const pass = label => { checks++; console.log(`PASS Attendance checkout: ${label}`); };
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

  sql(readFileSync(new URL('../../supabase/migrations/20261014051116_attendance_checkout_grace.sql', import.meta.url), 'utf8'));
  const checkout = mid => `${actor(3)}select public.team_attendance_check_out(${lit(mid)});`;
  function checked(title) {
    const {mid}=create(title);
    sql(`update public.team_attendance set checked_in_at=clock_timestamp()-interval '10 minutes',physical_status='present' where meeting_id=${lit(mid)};
      update public.team_meetings set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '5 minutes',status='closed',check_in_open=false where id=${lit(mid)}`);
    return mid;
  }
  const mid=checked('duplicate departures');
  const gate=await transactionGate(meetingLock(mid),'departure-gate');
  const names=Array.from({length:8},(_,i)=>`departure-${i}`);
  const pending=Promise.all(names.map(name=>asyncSQL(checkout(mid),name).then(value)));pending.catch(()=>{});
  await blocked(...names);await gate.release();const results=await pending;
  assert.equal(results.filter(r=>r.message==='Check-out recorded').length,1);
  assert.equal(results.filter(r=>r.message==='Check-out already recorded').length,7);
  const record=value(attendance(mid));assert.equal(record.physical_status,'present');assert(record.left_at);
  assert.equal(Number(sql(`select count(*) from team_attendance_history where entity_id=${lit(record.id)} and after_data->>'left_at' is not null`)),1);
  pass('eight queued departures create exactly one timestamp and audit record');

  for(const [label,lock] of [['meeting',meetingLock],['attendance',attendanceLock]]) {
    const expired=checked(`${label} grace expiry`),before=attendance(expired);
    sql(`update public.team_meetings set ends_at=clock_timestamp()-interval '30 minutes'+interval '1200 milliseconds' where id=${lit(expired)}`);
    const wait=await transactionGate(lock(expired),`${label}-expiry`);
    const request=asyncSQL(checkout(expired),`${label}-checkout`);request.catch(()=>{});await blocked(`${label}-checkout`);
    await waitFor(()=>Date.parse(meeting(expired).ends_at)+30*60_000<=Date.now(),'grace expiry');
    await wait.release();await assert.rejects(request,/30 minutes/);assert.equal(attendance(expired),before);
    pass(`${label} lock wait cannot extend the checkout boundary`);
  }
  const revoked=checked('revocation while queued'),beforeRevoked=attendance(revoked);
  const revokeGate=await transactionGate(meetingLock(revoked),'revoke-gate');
  const request=asyncSQL(checkout(revoked),'revoked-checkout');request.catch(()=>{});await blocked('revoked-checkout');
  sql(`update profiles set active=false where id=${lit(id(3))}`);await revokeGate.release();
  await assert.rejects(request,/Active Attendance participant required/);assert.equal(attendance(revoked),beforeRevoked);
  sql(`update profiles set active=true where id=${lit(id(3))}`);pass('deactivation committed during lock wait blocks checkout without a write');

  const finalized=checked('completion race'),version=meeting(finalized).version;
  const finish=await transactionGate(`${actor(1)}select team_attendance_manage('finalize',${json({meeting_id:finalized,version,automatic_absence_strike_count:0,automatic_absence_strike_attendance_ids:[]})});`,'finish-first');
  const afterFinish=asyncSQL(checkout(finalized),'after-finish');afterFinish.catch(()=>{});await blocked('after-finish');await finish.release();
  assert.equal(value(await afterFinish).message,'Check-out recorded');assert.equal(meeting(finalized).status,'finalized');assert.equal(value(attendance(finalized)).physical_status,'present');
  assert.equal(Number(sql(`select count(*) from team_attendance_strikes where meeting_id=${lit(finalized)}`)),0);
  pass('queued checkout records only departure after concurrent finalization and introduces no strikes');
  console.log(`${checks} checkout native concurrency checks passed.`);
} catch(error) {throw error;} finally {
  for(const child of children)child.kill('SIGTERM');
  if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'pipe',timeout:30_000});
  rmSync(root,{recursive:true,force:true});
}
