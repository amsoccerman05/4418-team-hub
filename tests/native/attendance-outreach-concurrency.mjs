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
  sql(readFileSync(new URL('../../supabase/migrations/20261014052049_attendance_stem_outreach.sql',import.meta.url),'utf8'));
  function outreach(title){
    const mid=value(sql(`${actor(1)}select team_attendance_manage('create',${json({title,meeting_type:'stem_outreach',requirement:'active',starts_at:future(-10),ends_at:future(60)})});`)).id;
    sql(`update team_attendance set checked_in_at=clock_timestamp()-interval '8 minutes',physical_status='present' where meeting_id=${lit(mid)} and student_id=${lit(id(3))}`);return mid;
  }
  const correction=(mid,version)=>`${actor(1)}select team_attendance_outreach_correct(${json({meeting_id:mid,attendance_id:value(attendance(mid)).id,version,checked_in_at:future(-8),left_at:future(-3),reason:'Synthetic verified time correction'})});`;
  const checkout=mid=>`${actor(3)}select team_attendance_check_out(${lit(mid)});`;
  const first=outreach('Correction wins');
  const correctionGate=await transactionGate(correction(first,value(attendance(first)).version),'correction-first');
  const waiting=asyncSQL(checkout(first),'checkout-after-correction');waiting.catch(()=>{});await blocked('checkout-after-correction');await correctionGate.release();
  assert.equal(value(await waiting).message,'Check-out already recorded');assert.equal(Number(sql(`select count(*) from team_attendance_history where meeting_id=${lit(first)} and action='OUTREACH_TIME_CORRECTION'`)),1);
  assert.equal(Number(sql(`select count(*) from team_attendance_strikes where meeting_id=${lit(first)}`)),0);pass('verified correction and checkout serialize to one authoritative departure with no strikes');
  const second=outreach('Checkout wins'),version=value(attendance(second)).version;
  const checkoutGate=await transactionGate(checkout(second),'checkout-first');
  const stale=asyncSQL(correction(second,version),'stale-correction');stale.catch(()=>{});await blocked('stale-correction');await checkoutGate.release();await assert.rejects(stale,/Attendance changed/);
  assert.equal(Number(sql(`select count(*) from team_attendance_history where meeting_id=${lit(second)} and action='OUTREACH_TIME_CORRECTION'`)),0);pass('stale leadership correction cannot overwrite a newly recorded checkout');
  const goalGate=await transactionGate('select id from team_attendance_private.outreach_goal for update;','goal-gate');
  const goals=[10,12].map((target,i)=>asyncSQL(`${actor(1)}select team_attendance_outreach_goal(${json({version:1,target_hours:target})});`,`goal-${i}`));
  goals.forEach(p=>p.catch(()=>{}));await blocked('goal-0','goal-1');await goalGate.release();const outcomes=await Promise.allSettled(goals);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);assert.equal(sql('select version from team_attendance_private.outreach_goal'),'2');
  assert.equal(sql("select count(*) from team_attendance_history where entity='stem_outreach_goal'"),'1');pass('concurrent goal updates require the current version and create one audit event');
  console.log(`${checks} outreach native concurrency checks passed.`);
} finally {
 for(const child of children)child.kill('SIGTERM');
 if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'pipe',timeout:30_000});
 rmSync(root,{recursive:true,force:true});
}
