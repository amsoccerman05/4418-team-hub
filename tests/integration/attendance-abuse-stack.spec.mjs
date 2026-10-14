// Append to fabrication-local.mjs's OWNED disposable stack after historical
// Attendance suites. Real Auth tokens and raw PostgREST requests, not client mocks.
// SQL installs exact migrations, prepares synthetic state, and inspects results.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const attendanceAbuseMigration = 'supabase/migrations/20261014034212_attendance_check_in_hardening.sql';
export const attendanceAbuseSources = [attendanceAbuseMigration, 'tests/integration/attendance-abuse-stack.spec.mjs', 'tests/native/attendance-abuse-concurrency.mjs'];
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const wrong = code => code === '000000' ? '999999' : '000000';

export async function runAttendanceAbuseIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql("select to_regprocedure('public.team_attendance_edit_meeting(jsonb)') is not null"), 't', 'Run after Attendance prerequisites');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  const checks = [];
  const pass = label => { const message = `Attendance direct-API hardening: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null, method = 'POST') => localFetch(base, path, {
    method, headers: { ...headers(actor), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response) {
    const body = await response.json();
    assert.equal(response.status, 200, `Attendance abuse HTTP ${response.status}; code=${body?.code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function rejected(response, message = /permission denied/, code = '42501', status = 403) {
    const body = await response.json(); assert.equal(response.status, status); assert.equal(body.code, code); assert.match(body.message, message);
  }
  const read = (table, select, filter, actor) => request(`/rest/v1/${table}?select=${select}&${filter}`, undefined, actor, 'GET').then(json);
  const query = q => JSON.parse(sql(q));
  const counter = (mid, actor) => query(`select jsonb_build_object('attempts',attempts,'window',attempt_window,'retry_at',attempt_window+interval '15 minutes') from public.team_meeting_members where meeting_id=${lit(mid)} and student_id=${lit(actor.id)}`);
  const stored = (mid, actor) => sql(`select to_jsonb(a) from public.team_attendance a where meeting_id=${lit(mid)} and student_id=${lit(actor.id)}`);
  const checkIn = (mid, code, actor) => rpc('team_attendance_check_in', { meeting_id: mid, code }, actor);
  const businessState = () => sql(`select jsonb_build_object('meetings',(select jsonb_agg(to_jsonb(t) order by id) from public.team_meetings t), 'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from public.team_meeting_members t),'attendance',(select jsonb_agg(to_jsonb(t) order by id) from public.team_attendance t),'history',(select jsonb_agg(to_jsonb(t) order by id) from public.team_attendance_history t))`);
  const beforeInstall = businessState();
  const migration = readFileSync(new URL(`../../${attendanceAbuseMigration}`, import.meta.url), 'utf8');
  sql(migration); sql(migration);
  assert.equal(businessState(), beforeInstall, 'Idempotent migration must not rewrite existing business records or counters');
  sql("notify pgrst, 'reload schema';");
  pass('idempotent additive migration preserves all existing records and budgets');

  async function login(actor, refresh = false) {
    const result = await json(await request(`/auth/v1/token?grant_type=${refresh ? 'refresh_token' : 'password'}`, refresh ? { refresh_token: actor.refresh } : { email: actor.email, password: actor.password }));
    assert.equal(result.user.id, actor.id); assert(result.access_token && result.refresh_token);
    registerSecret(result.access_token); registerSecret(result.refresh_token);
    return { ...actor, token: result.access_token, refresh: result.refresh_token };
  }
  async function signup(name, role = 'student', active = true) {
    const email = `attendance-abuse-${name}-${randomUUID()}@example.invalid`, password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const result = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true, is_admin: true } }));
    assert(result.user?.id && result.access_token && result.refresh_token);
    registerSecret(result.access_token); registerSecret(result.refresh_token);
    const actor = await login({ id: result.user.id, email, password, token: result.access_token, refresh: result.refresh_token });
    if (role) sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Abuse ${name}`)},${lit(role)},${active});`);
    return actor;
  }
  const manager = await signup('manager', 'mentor'), student = await signup('student'), peer = await signup('peer');
  const inactive = await signup('inactive', 'student', false), reader = await signup('reader', 'readonly'), noProfile = await signup('no-profile', null);
  const mutate = q => sql(`select set_config('request.jwt.claim.sub',${lit(manager.id)},false);${q}`);
  const manage = (action, p) => rpc('team_attendance_manage', { action, p }, manager).then(json);
  const version = mid => Number(sql(`select version from public.team_meetings where id=${lit(mid)}`));
  const open = mid => manage('open', { meeting_id: mid, version: version(mid) });
  async function create(title, ids = [student.id, peer.id]) {
    const { id: mid } = await manage('create', { title: `Synthetic Abuse ${title}`, meeting_type: 'preseason', requirement: 'selected', selected_students: ids, starts_at: future(-10), ends_at: future(120) });
    const opening = await open(mid); assert.match(opening.code, /^\d{6}$/); return { mid, code: opening.code };
  }
  const first = await create('direct callers');
  const absent = await signup('not-on-roster'); // Created after the snapshot.
  const original = businessState();
  await rejected(await checkIn(first.mid, first.code, null), /permission denied/, '42501', 401);
  for (const actor of [inactive, reader, noProfile]) await rejected(await checkIn(first.mid, first.code, actor), /Active Attendance participant required/);
  await rejected(await checkIn(first.mid, first.code, absent), /not on this meeting roster/, 'P0001', 400);
  assert.equal(businessState(), original);
  pass('anonymous, inactive, readonly, profile-less, and wrong-roster sessions cannot check in even with the correct code and admin user metadata');

  for (const actor of [student, peer, manager]) {
    await rejected(await request(`/rest/v1/team_meetings?select=code_hash&id=eq.${first.mid}`, undefined, actor, 'GET'));
    await rejected(await request(`/rest/v1/team_meeting_members?meeting_id=eq.${first.mid}&student_id=eq.${student.id}`, { attempts: 0, attempt_window: null }, actor, 'PATCH'));
    await rejected(await request('/rest/v1/team_attendance', { meeting_id: first.mid, student_id: peer.id, physical_status: 'present' }, actor));
    await rejected(await request(`/rest/v1/team_attendance?meeting_id=eq.${first.mid}`, { checked_in_at: new Date().toISOString(), physical_status: 'present' }, actor, 'PATCH'));
  }
  await rejected(await request(`/rest/v1/team_meeting_members?meeting_id=eq.${first.mid}`, undefined, student, 'DELETE'));
  await rejected(await rpc('team_attendance_check_in', { meeting_id: first.mid, code: first.code, student_id: peer.id }, student), /function/i, 'PGRST202', 404);
  assert.equal(businessState(), original);
  pass('raw table writes cannot clear counters, forge attendance or another caller; code_hash is unreadable even to meeting managers');

  const peerBefore = stored(first.mid, peer);
  assert.deepEqual(await json(await checkIn(first.mid, first.code, student)), { status: 'checked_in', message: 'Checked in' });
  const checked = stored(first.mid, student), checkedCounter = counter(first.mid, student);
  assert.equal(stored(first.mid, peer), peerBefore);
  assert.deepEqual(await read('team_attendance', '*', `meeting_id=eq.${first.mid}&student_id=eq.${peer.id}`, student), []);
  assert.deepEqual(await json(await checkIn(first.mid, 'bad', student)), { status: 'already_recorded', message: 'Attendance already recorded' });
  assert.equal(stored(first.mid, student), checked); assert.deepEqual(counter(first.mid, student), checkedCounter);
  pass('valid check-in records only auth.uid(); cross-student reads stay hidden and repeat calls are idempotent');

  const budget = await create('session and rotation budget');
  for (const code of ['bad', null, '', wrong(budget.code), wrong(budget.code)]) {
    assert.deepEqual(await json(await checkIn(budget.mid, code, student)), { status: 'invalid_code', error: 'Invalid meeting code' });
  }
  const five = counter(budget.mid, student), pending = stored(budget.mid, student);
  assert.equal(five.attempts, 5);
  async function limited(actor, code = budget.code) {
    const result = await json(await checkIn(budget.mid, code, actor));
    assert.equal(result.status, 'rate_limited'); assert.match(result.error, /Too many attempts/);
    assert.equal(Date.parse(result.retry_at), Date.parse(five.retry_at));
    assert.deepEqual(counter(budget.mid, student), five); assert.equal(stored(budget.mid, student), pending);
  }
  await limited(student);
  const refreshed = await login(student, true); await limited(refreshed);
  const signedInAgain = await login(student); await limited(signedInAgain);
  const rotated = await open(budget.mid); assert.notEqual(rotated.code, budget.code); await limited(signedInAgain, rotated.code);
  await rejected(await request(`/rest/v1/team_meeting_members?meeting_id=eq.${budget.mid}&student_id=eq.${student.id}`, { attempts: 0, attempt_window: null }, signedInAgain, 'PATCH'));
  await limited(signedInAgain, rotated.code);
  assert.deepEqual(await json(await checkIn(budget.mid, rotated.code, peer)), { status: 'checked_in', message: 'Checked in' });
  pass('five attempts survive real token refresh, fresh password sign-in, direct counter tampering, and code rotation; a different participant still succeeds');

  const fifth = await create('correct fifth attempt');
  for (let i = 0; i < 4; i++) assert.equal((await json(await checkIn(fifth.mid, wrong(fifth.code), student))).status, 'invalid_code');
  assert.equal((await json(await checkIn(fifth.mid, fifth.code, student))).status, 'checked_in');
  assert.equal(counter(fifth.mid, student).attempts, 5);
  pass('the fifth authoritative attempt remains usable when correct, with separate per-meeting budgets');

  const burst = await create('HTTP concurrency');
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => checkIn(burst.mid, wrong(burst.code), student).then(json)));
  assert.equal(outcomes.filter(r => r.status === 'invalid_code').length, 5);
  assert.equal(outcomes.filter(r => r.status === 'rate_limited').length, 7);
  assert.equal(counter(burst.mid, student).attempts, 5); assert.equal(JSON.parse(stored(burst.mid, student)).checked_in_at, null);
  pass('12 parallel real PostgREST requests accept only five wrong-code attempts');

  // Synthetic backdating avoids a 15-minute test delay without mocking time or Auth.
  mutate(`update public.team_meeting_members set attempt_window=clock_timestamp()-interval '15 minutes' where meeting_id=${lit(budget.mid)} and student_id=${lit(student.id)};`);
  assert.equal((await json(await checkIn(budget.mid, rotated.code, signedInAgain))).status, 'checked_in');
  assert.equal(counter(budget.mid, student).attempts, 1);
  pass('server window expiry restores one attempt without changing sign-in requirements');

  const expiry = await create('expired code');
  mutate(`update public.team_meetings set code_expires_at=clock_timestamp()-interval '1 second' where id=${lit(expiry.mid)};`);
  await rejected(await checkIn(expiry.mid, expiry.code, student), /Check-in is closed or the code expired/, 'P0001', 400);
  assert.equal(counter(expiry.mid, student).attempts, 0); assert.equal(JSON.parse(stored(expiry.mid, student)).checked_in_at, null);
  const missingExpiry = await create('missing code expiry');
  mutate(`update public.team_meetings set code_expires_at=null where id=${lit(missingExpiry.mid)};`);
  await rejected(await checkIn(missingExpiry.mid, missingExpiry.code, student), /Check-in is closed or the code expired/, 'P0001', 400);
  assert.equal(counter(missingExpiry.mid, student).attempts, 0); assert.equal(JSON.parse(stored(missingExpiry.mid, student)).checked_in_at, null);
  const liveAuthority = await create('live account revocation');
  assert.equal((await json(await checkIn(liveAuthority.mid, liveAuthority.code, student))).status, 'checked_in');
  const liveState = businessState();
  sql(`update public.profiles set active=false where id=${lit(student.id)};`);
  await rejected(await checkIn(liveAuthority.mid, liveAuthority.code, student), /Active Attendance participant required/);
  assert.equal(businessState(), liveState);
  pass('deactivation immediately rejects the SAME previously successful session, including recorded-attendance retries');
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('expired or missing code expiry fails closed without consuming guesses; genuine Auth remains unchanged');
  return checks;
}
