#!/usr/bin/env node
// Synthetic, disposable PostgreSQL only; private Unix socket, no database URL.
// ATTENDANCE_ABUSE_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/attendance-roster-concurrency.mjs
// Real Auth/PostgREST coverage is separate in attendance-automatic-roster-stack.spec.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { installAttendanceEditingFixture } from '../integration/attendance-editing-fixture.mjs';
import { attendanceAbuseMigration } from '../integration/attendance-abuse-stack.spec.mjs';

const bin = process.env.ATTENDANCE_ABUSE_PG_BIN;
assert(bin && isAbsolute(bin), 'Set ATTENDANCE_ABUSE_PG_BIN to an installed local PostgreSQL bin directory');
const root = mkdtempSync(join(tmpdir(), 'attendance-roster-it-')), data = join(root, 'db');
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
const pass = label => { checks++; console.log(`PASS Attendance automatic rosters: ${label}`); };
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

  sql(`create table auth.users(id uuid primary key,email_confirmed_at timestamptz,last_sign_in_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    insert into auth.users(id,email_confirmed_at,last_sign_in_at) select id,now(),now() from profiles;`);
  sql(readFileSync(new URL('../../supabase/migrations/20261028001414_attendance_automatic_roster_membership.sql',import.meta.url),'utf8'));
  function newStudent(n) {
    sql(`insert into profiles values('${id(n)}','Synthetic newcomer','student',true);
      insert into auth.users(id,email_confirmed_at,last_sign_in_at) values('${id(n)}',now(),now());`);
  }
  const sync = n => `${actor(n)}select public.team_attendance_sync_my_rosters();`;
  const count = (mid,n) => Number(sql(`select count(*) from team_meeting_members where meeting_id='${mid}' and student_id='${id(n)}'`));

  const burst=create('simultaneous first visits');newStudent(20);
  const names=Array.from({length:8},(_,i)=>`newcomer-${i}`);
  const results=await Promise.all(names.map(name=>asyncSQL(sync(20),name).then(value)));
  assert.equal(results.reduce((sum,r)=>sum+r.added,0),1);assert.equal(count(burst.mid,20),1);
  assert.equal(sql(`select required from team_meeting_members where meeting_id='${burst.mid}' and student_id='${id(20)}'`),'f');
  assert.equal(sql(`select count(*) from team_attendance_history where action='ROSTER_AUTO_ADD' and student_id='${id(20)}'`),'1');
  pass('eight concurrent first visits insert exactly one optional pending roster entry and one enrollment audit');

  const closing=create('close wins');newStudent(21);
  const closeGate=await transactionGate(`select pg_advisory_xact_lock(4418,10);select set_config('test.uid','${id(1)}',false);update public.team_meetings set status='closed' where id='${closing.mid}';`,'close-gate');
  const closeSync=asyncSQL(sync(21),'close-sync');await blocked('close-sync');await closeGate.release();await closeSync;
  assert.equal(count(closing.mid,21),0);pass('close committed ahead of enrollment leaves closed roster untouched');

  const ending=create('end during wait');newStudent(22);
  sql(`select set_config('test.uid','${id(1)}',false);update team_meetings set ends_at=clock_timestamp()+interval '1500 milliseconds' where id='${ending.mid}';`);
  const endGate=await transactionGate(meetingLock(ending.mid),'end-gate');
  const endSync=asyncSQL(sync(22),'end-sync');await blocked('end-sync');
  await waitFor(()=>sql(`select ends_at<=clock_timestamp() from team_meetings where id='${ending.mid}'`)==='t','scheduled end');
  await endGate.release();await endSync;assert.equal(count(ending.mid,22),0);
  pass('meeting ending while enrollment waits on its row lock is not backfilled');

  const revoked=create('deactivation wins');newStudent(23);
  const profileGate=await transactionGate(`update profiles set active=false where id='${id(23)}';`,'profile-gate');
  const revokeSync=asyncSQL(sync(23),'profile-sync');await blocked('profile-sync');await profileGate.release();
  assert.equal(value(await revokeSync).added,0);assert.equal(count(revoked.mid,23),0);
  pass('profile deactivation during lock contention prevents enrollment');

  console.log(`Passed ${checks} automatic roster concurrency checks.`);
} finally {
  for(const child of children)child.kill('SIGTERM');
  if(started)try{execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'pipe',timeout:15000});}catch{}
  rmSync(root,{recursive:true,force:true});
}
