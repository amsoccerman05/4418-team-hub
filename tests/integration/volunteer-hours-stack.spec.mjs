// Opt-in extension of fabrication-local.mjs's OWNED disposable stack, after its
// Attendance fixture. Real Auth and PostgREST only; never a hosted/shared project.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const volunteerHoursSources = [
  'supabase/migrations/20261007155231_mentor_volunteer_hours.sql',
  'tests/integration/volunteer-hours-stack.spec.mjs',
];
const lit = value => `'${String(value).replaceAll("'", "''")}'`;

export async function runVolunteerHoursIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  assert.equal(sql("select to_regclass('public.team_meetings')::text"), 'team_meetings', 'Run the Attendance fixture first');
  assert.equal(sql("select coalesce(to_regnamespace('volunteer_private')::text,'absent')"), 'absent', 'Refusing an existing Volunteer database');
  sql(readFileSync(new URL(`../../${volunteerHoursSources[0]}`, import.meta.url), 'utf8'));
  sql("notify pgrst, 'reload schema';");

  const checks = [];
  const pass = label => { const message = `Volunteer hours: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null, method = 'POST') => localFetch(base, path, {
    method, headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, `Volunteer HTTP ${response.status}; code=${body?.code || body?.error_code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function rejected(response, message, code = 'P0001', status = 400) {
    const body = await response.json();
    assert.equal(response.status, status, `Expected Volunteer denial; code=${body?.code || 'unspecified'}`);
    assert.equal(body.code, code); assert.match(body.message, message);
    return body;
  }
  const fingerprint = tables => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t)`
  ).join(',')})`)).digest('hex');
  const state = () => fingerprint(['public.team_volunteer_entries', 'volunteer_private.history', 'volunteer_private.receipts']);
  const count = q => Number(sql(q));
  const auditCount = entry => count(`select count(*) from volunteer_private.history where entry_id=${lit(entry)}`);
  const users = {};
  for (const [name, role, active] of [
    ['mentor', 'mentor', true], ['otherMentor', 'mentor', true], ['admin', 'admin', true],
    ['student', 'student', true], ['lead', 'lead', true], ['programManager', 'student', true],
    ['reader', 'readonly', true], ['inactive', 'mentor', false], ['unprofiled', null, false],
  ]) {
    const email = `volunteer-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true, can_view_team: true } }));
    assert(signup.user?.id && signup.access_token, 'Real Auth signup must issue a session');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, signup.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    const actual = await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }));
    assert.equal(actual.id, actor.id); assert.equal(actual.user_metadata.role, 'admin');
    users[name] = actor;
    if (role) sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Volunteer ${name}`)},${lit(role)},${active});`);
  }
  const { mentor, otherMentor, admin, student, lead, programManager, reader, inactive, unprofiled } = users;
  sql(`insert into public.team_positions(key,name,active) values('program_manager','Program Manager',true) on conflict(key) do nothing;
    insert into public.team_member_positions(user_id,position_key,revoked_at) values(${lit(programManager.id)},'program_manager',null);`);
  const deadline = Date.now() + 15_000;
  while (true) {
    const response = await rpc('team_volunteer_context', {}, student);
    const body = await response.json();
    if (body.code !== 'PGRST202') { assert.equal(response.status, 400); assert.equal(body.code, 'P0001'); assert.match(body.message, /Active mentor or admin/); break; }
    assert(Date.now() < deadline, 'Volunteer public RPC did not reach the PostgREST schema cache');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const save = (action, p, actor = mentor) => rpc('team_volunteer_save', { action, p }, actor);
  const apply = (action, p, actor = mentor) => save(action, p, actor).then(r => json(r));
  const own = actor => localFetch(base, '/rest/v1/team_volunteer_entries?select=*&order=started_at,id', { headers: headers(actor) }).then(r => json(r));
  const history = (entry, actor = mentor, before_id = null) => rpc('team_volunteer_history', { entry, before_id }, actor).then(r => json(r));
  const summary = (selected_season = null, actor = admin) => rpc('team_volunteer_summary', { selected_season }, actor).then(r => json(r));
  const day = days => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const at = (days, hour) => `${day(days)}T${String(hour).padStart(2, '0')}:00:00Z`;
  const season = randomUUID(), otherSeason = randomUUID();
  for (const id of [season, otherSeason]) assert.equal(await json(await rpc('planning_save', { entity: 'season', p: {
    id, name: `Synthetic volunteer ${id === season ? 'archived' : 'other'} season`, status: 'archived',
  } }, mentor)), id);
  const meeting = await json(await rpc('team_attendance_manage', { action: 'create', p: {
    title: 'Synthetic volunteer linked meeting', meeting_type: 'other', requirement: 'active', starts_at: at(12, 10), ends_at: at(12, 12),
  } }, mentor));
  assert(meeting.id);
  const canonicalTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
    and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private','team_attendance_private')
    and c.relname<>'team_volunteer_entries' order by 1`).split('\n').filter(Boolean);
  const canonical = fingerprint(canonicalTables);
  const draft = (days = 12, start = 8, end = 10, extra = {}) => ({
    request_id: randomUUID(), activity: 'mentoring', time_zone: 'America/Chicago',
    started_at: at(days, start), ended_at: at(days, end), season_id: season, meeting_id: meeting.id,
    notes: 'Synthetic private volunteer note', ...extra,
  });

  for (const actor of [mentor, otherMentor, admin]) {
    const context = await json(await rpc('team_volunteer_context', {}, actor));
    assert.equal(context.user_id, actor.id); assert.equal(context.can_view_team, actor === admin);
    assert(context.seasons.some(s => s.id === season && s.status === 'archived')); assert(Number.isFinite(Date.parse(context.server_now)));
  }
  const deniedBefore = state();
  for (const actor of [student, lead, programManager, reader, inactive, unprofiled]) {
    for (const [name, body] of [
      ['team_volunteer_context', {}], ['team_volunteer_save', { action: 'manual', p: draft() }],
      ['team_volunteer_history', { entry: randomUUID() }], ['team_volunteer_summary', {}],
    ]) await rejected(await rpc(name, body, actor), /Active (mentor or admin|admin)/);
    assert.deepEqual(await own(actor), []);
  }
  for (const name of ['team_volunteer_context', 'team_volunteer_summary']) await rejected(await rpc(name, {}, null), /permission denied/, '42501', 401);
  await rejected(await save('manual', draft(), null), /permission denied/, '42501', 401);
  for (const actor of [mentor, otherMentor]) await rejected(await rpc('team_volunteer_summary', {}, actor), /Active admin/);
  assert.equal(state(), deniedBefore);
  pass('nine real Auth sessions; forged admin user_metadata, student leadership positions, inactive/missing profiles, and anonymous requests cannot gain volunteer access');

  const firstPayload = draft(12, 8, 10, { user_id: student.id });
  const first = await apply('manual', firstPayload);
  assert.equal(first.user_id, mentor.id); assert.equal(first.source, 'manual'); assert.equal(first.version, 1);
  assert.equal(new Date(first.started_at).toISOString(), firstPayload.started_at.replace('Z', '.000Z'));
  const late = await apply('manual', draft(12, 13, 15));
  const independent = await apply('manual', draft(11, 9, 11, { meeting_id: null, season_id: null, activity: 'outreach' }));
  assert.equal(independent.meeting_id, null); assert.equal(independent.season_id, null);
  const second = await apply('manual', draft(12, 8, 9), otherMentor);
  const adminEntry = await apply('manual', draft(12, 8, 9), admin);
  assert.deepEqual((await own(mentor)).map(e => e.id).sort(), [first.id, late.id, independent.id].sort());
  assert.deepEqual((await own(otherMentor)).map(e => e.id), [second.id]);
  assert.deepEqual((await own(admin)).map(e => e.id), [adminEntry.id]);
  const totals = await summary();
  assert.equal(totals.reduce((sum, row) => sum + Number(row.hours), 0), 8);
  assert.equal((await summary(season)).reduce((sum, row) => sum + Number(row.hours), 0), 6);
  for (const row of totals) assert.deepEqual(Object.keys(row).sort(), [
    'user_id', 'display_name', 'season_id', 'activity', 'week_start', 'hours', 'completed_entries', 'running_entries', 'missing_checkouts',
  ].sort());
  assert(!JSON.stringify(totals).includes(first.notes));
  assert.equal(fingerprint(canonicalTables), canonical);
  pass('early, late, and unlinked actual work bypass student meeting windows; self-only RLS and exact admin aggregates expose no notes, entry IDs, times, or history');

  const directBefore = state();
  for (const actor of [mentor, admin, student]) {
    await rejected(await request('/rest/v1/team_volunteer_entries', { ...first, id: randomUUID() }, actor), /permission denied/, '42501', 403);
    await rejected(await request(`/rest/v1/team_volunteer_entries?id=eq.${first.id}`, { notes: 'Forbidden direct write' }, actor, 'PATCH'), /permission denied/, '42501', 403);
    await rejected(await localFetch(base, `/rest/v1/team_volunteer_entries?id=eq.${first.id}`, { method: 'DELETE', headers: headers(actor) }), /permission denied/, '42501', 403);
    for (const table of ['history', 'receipts']) {
      const response = await localFetch(base, `/rest/v1/${table}?select=*`, { headers: { ...headers(actor), 'Accept-Profile': 'volunteer_private' } });
      await rejected(response, /invalid schema: volunteer_private|schema must be one of/i, 'PGRST106', 406);
    }
  }
  for (const actor of [otherMentor, admin]) {
    await rejected(await rpc('team_volunteer_history', { entry: first.id }, actor), /unavailable/);
    for (const action of ['stop', 'correct', 'void']) await rejected(await save(action, draft(12, 8, 10, {
      id: first.id, version: first.version, reason: 'Forbidden other-person change',
    }), actor), /unavailable/);
  }
  assert.equal(state(), directBefore);
  pass('direct INSERT/PATCH/DELETE and private-schema HTTP access are denied; admins cannot inspect history or mutate another mentor');

  const retryBefore = state();
  assert.deepEqual(await apply('manual', firstPayload), first); assert.equal(state(), retryBefore);
  await rejected(await save('manual', { ...firstPayload, notes: 'Changed retry' }), /already used for different details/);
  await rejected(await save('manual', draft(12, 9, 11, { season_id: otherSeason })), /overlaps/);
  assert.equal(state(), retryBefore);
  const correctionPayload = draft(12, 8, 10, { id: first.id, version: first.version, notes: 'Synthetic corrected private note', reason: 'Synthetic correction reason' });
  const corrected = await apply('correct', correctionPayload);
  assert.equal(corrected.version, 2); assert.equal(corrected.started_at, first.started_at); assert.equal(corrected.ended_at, first.ended_at);
  const correctedBefore = state();
  assert.deepEqual(await apply('correct', correctionPayload), corrected);
  await rejected(await save('correct', { ...correctionPayload, request_id: randomUUID(), notes: 'Stale update' }), /Entry changed/);
  assert.equal(state(), correctedBefore);
  const revisions = await history(first.id);
  assert.deepEqual(revisions.map(r => r.action), ['correct', 'manual']);
  assert.equal(revisions[0].reason, correctionPayload.reason); assert.equal(revisions[0].user_id, mentor.id);
  assert.deepEqual(revisions[0].before_data, first); assert.deepEqual(revisions[0].after_data, corrected);
  assert.deepEqual(await history(first.id, mentor, revisions[0].id), [revisions[1]]);
  const voidPayload = { request_id: randomUUID(), id: first.id, version: corrected.version, reason: 'Synthetic duplicate void' };
  const voided = await apply('void', voidPayload); assert(voided.voided_at); assert.equal(voided.version, 3);
  const voidBefore = state(); assert.deepEqual(await apply('void', voidPayload), voided); assert.equal(state(), voidBefore);
  await rejected(await save('correct', { ...correctionPayload, request_id: randomUUID(), version: 3 }), /Voided entries/);
  assert.equal((await summary()).reduce((sum, row) => sum + Number(row.hours), 0), 6);
  assert.equal(auditCount(first.id), 3);
  pass('repeat receipts preserve one audit; cross-season overlap, reused IDs, and stale corrections fail; private before/after history paginates and void removes credited totals');

  const timerPayload = { request_id: randomUUID(), activity: 'setup_cleanup', time_zone: 'UTC', season_id: season, meeting_id: meeting.id, notes: 'Synthetic timer' };
  const started = await apply('start', { ...timerPayload, started_at: at(12, 1), ended_at: at(12, 2) });
  assert.equal(started.ended_at, null); assert.equal(started.source, 'timer'); assert(Date.parse(started.started_at) > Date.now() - 60_000);
  const runningTotals = await summary(season);
  const running = runningTotals.find(r => r.user_id === mentor.id && r.activity === 'setup_cleanup');
  assert.equal(Number(running.hours), 0); assert.equal(running.running_entries, 1);
  await rejected(await save('start', { ...timerPayload, request_id: randomUUID() }), /already have a running timer/);
  const stopPayload = { request_id: randomUUID(), id: started.id, version: started.version };
  const stoppedResponses = await Promise.all([save('stop', stopPayload), save('stop', stopPayload)]);
  const stopped = await json(stoppedResponses[0]); assert.deepEqual(await json(stoppedResponses[1]), stopped);
  assert.equal(stopped.version, 2); assert(Date.parse(stopped.ended_at) > Date.parse(started.started_at)); assert.equal(auditCount(started.id), 2);
  const startRace = await Promise.all([save('start', { ...timerPayload, request_id: randomUUID() }), save('start', { ...timerPayload, request_id: randomUUID() })]);
  assert.equal(startRace.filter(r => r.ok).length, 1);
  const active = await json(startRace.find(r => r.ok)); await rejected(startRace.find(r => !r.ok), /already have a running timer/);
  assert.equal(count(`select count(*) from public.team_volunteer_entries where user_id=${lit(mentor.id)} and ended_at is null and voided_at is null`), 1);
  await apply('stop', { request_id: randomUUID(), id: active.id, version: active.version });
  pass('server-time start/stop is independent of student check-in; parallel stop retries create one revision and parallel starts leave exactly one running timer');

  const sameManual = draft(9, 8, 10, { meeting_id: null });
  const sameResponses = await Promise.all([save('manual', sameManual), save('manual', sameManual)]);
  const sameEntry = await json(sameResponses[0]); assert.deepEqual(await json(sameResponses[1]), sameEntry); assert.equal(auditCount(sameEntry.id), 1);
  const overlapRace = await Promise.all([save('manual', draft(8, 8, 10)), save('manual', draft(8, 9, 11))]);
  assert.equal(overlapRace.filter(r => r.ok).length, 1); await json(overlapRace.find(r => r.ok)); await rejected(overlapRace.find(r => !r.ok), /overlaps/);
  const correctionRace = await Promise.all(['A', 'B'].map(note => save('correct', { ...sameManual,
    request_id: randomUUID(), id: sameEntry.id, version: sameEntry.version, notes: `Synthetic race ${note}`, reason: `Synthetic competing correction ${note}`,
  })));
  assert.equal(correctionRace.filter(r => r.ok).length, 1); await json(correctionRace.find(r => r.ok)); await rejected(correctionRace.find(r => !r.ok), /Entry changed/);
  assert.equal(auditCount(sameEntry.id), 2);
  pass('parallel HTTP manual retries, overlapping intervals, and competing corrections serialize without duplicate credit or lost updates');

  const abandoned = await apply('start', { ...timerPayload, request_id: randomUUID() });
  // Age only our synthetic record to exercise a 24-hour condition without waiting
  // a day. All user-facing actions remain real authenticated gateway RPCs.
  sql(`update public.team_volunteer_entries set started_at=${lit(at(5, 8))}, activity_date=${lit(day(5))} where id=${lit(abandoned.id)};`);
  const overdue = (await summary(season)).find(r => r.user_id === mentor.id && r.activity === 'setup_cleanup' && r.missing_checkouts === 1);
  assert(overdue); assert.equal(overdue.running_entries, 1);
  await rejected(await save('stop', { request_id: randomUUID(), id: abandoned.id, version: abandoned.version }), /Missing checkout/);
  const recovered = await apply('correct', draft(5, 8, 10, { id: abandoned.id, version: abandoned.version, activity: 'setup_cleanup', reason: 'Synthetic actual end after missed checkout' }));
  assert.equal(recovered.version, 2); assert.equal(new Date(recovered.ended_at).toISOString(), at(5, 10).replace('Z', '.000Z'));
  assert.equal((await summary(season)).reduce((sum, row) => sum + row.missing_checkouts, 0), 0);
  const revokedBefore = state();
  sql(`update public.profiles set active=false where id=${lit(mentor.id)};`);
  try {
    assert.deepEqual(await own(mentor), []);
    await rejected(await save('manual', draft(4, 8, 10)), /Active mentor or admin/);
    await rejected(await rpc('team_volunteer_history', { entry: first.id }, mentor), /Active mentor or admin/);
    assert((await summary()).some(r => r.user_id === mentor.id), 'Historical admin totals survive mentor deactivation');
    assert.equal(state(), revokedBefore);
  } finally { sql(`update public.profiles set active=true where id=${lit(mentor.id)};`); }
  pass('missing checkout requires actual-time correction; current profile revocation blocks old valid Auth sessions without erasing historical totals');

  const auditBefore = state();
  const failingPayload = draft(3, 8, 10);
  sql(`create function volunteer_private.test_audit_failure() returns trigger language plpgsql as $$begin
    if new.user_id=${lit(mentor.id)} then raise exception 'Synthetic Volunteer audit failure';end if;return new;end$$;
    create trigger volunteer_test_audit_failure before insert on volunteer_private.history for each row execute function volunteer_private.test_audit_failure();`);
  try {
    await rejected(await save('manual', failingPayload), /Synthetic Volunteer audit failure/);
    assert.equal(state(), auditBefore, 'Entry, receipt, and audit must roll back together');
  } finally { sql('drop trigger volunteer_test_audit_failure on volunteer_private.history;drop function volunteer_private.test_audit_failure();'); }
  const recoveredFailure = await apply('manual', failingPayload); assert.equal(auditCount(recoveredFailure.id), 1);
  assert.equal(fingerprint(canonicalTables), canonical, 'Volunteer activity modified student attendance, strikes, roster, meetings, or other application records');
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('audit insertion failure rolls back entry and receipt; same-request retry recovers, all student and unrelated app records stay byte-for-byte unchanged, and real Auth is preserved');
  return checks;
}
