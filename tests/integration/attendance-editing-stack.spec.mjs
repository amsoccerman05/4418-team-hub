// Opt-in extension of fabrication-local.mjs's OWNED disposable stack.
// Import and call runAttendanceEditingIntegration({ ...status, sql, registerSecret }).
// Real Auth + PostgREST only; no hosted URL, forged JWT, mock auth.uid, or deploy.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';
import { installAttendanceEditingFixture } from './attendance-editing-fixture.mjs';

const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const fields = 'id,title,meeting_type,starts_at,ends_at,late_minutes,requirement,status,check_in_open,code_expires_at,created_by,created_at,version';

export async function runAttendanceEditingIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  await installAttendanceEditingFixture(sql);
  sql("notify pgrst, 'reload schema';");
  const checks = [];
  const pass = label => { const message = `Attendance editing: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, `Attendance HTTP ${response.status}; code=${body?.code || 'unspecified'}`);
    return body;
  }
  async function rejected(response, code, message, status) {
    const body = await response.json();
    assert(!response.ok, 'A rejected Attendance RPC unexpectedly succeeded');
    if (status !== undefined) assert.equal(response.status, status);
    assert.equal(body.code, code); assert.match(body.message, message);
    return body;
  }
  const query = q => JSON.parse(sql(q));
  const count = q => Number(sql(q));
  const fingerprint = (tables, where = '') => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t ${where})`
  ).join(',')})`)).digest('hex');
  const records = mid => fingerprint(['public.team_attendance', 'public.team_meeting_members', 'public.team_attendance_strikes'], `where meeting_id=${lit(mid)}`);
  const fullState = () => fingerprint(['public.team_meetings', 'public.team_attendance', 'public.team_meeting_members', 'public.team_attendance_strikes', 'public.team_attendance_history']);
  const auditCount = mid => count(`select count(*) from public.team_attendance_history where entity='team_meetings' and entity_id=${lit(mid)} and action='UPDATE'`);

  const users = {};
  for (const [name, role, active] of [
    ['mentor', 'mentor', true], ['lead', 'lead', true], ['admin', 'admin', true],
    ['student', 'student', true], ['programManager', 'student', true],
    ['reader', 'readonly', true], ['inactive', 'lead', false],
  ]) {
    const email = `attendance-edit-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true } }));
    assert(signup.user?.id && signup.access_token, 'Real Auth signup must issue a session');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, signup.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    users[name] = actor;
    sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Attendance ${name}`)},${lit(role)},${active});`);
  }
  const { mentor, lead, admin, student, programManager, reader, inactive } = users;
  sql(`insert into public.team_positions(key,name,active) values('program_manager','Program Manager',true) on conflict(key) do nothing;
    insert into public.team_member_positions(user_id,position_key,revoked_at) values(${lit(programManager.id)},'program_manager',null);`);

  // Readiness is bounded and exercises the exact public edit route. A cache-miss
  // response is not confused with an authorization pass.
  const deadline = Date.now() + 15_000;
  while (true) {
    const response = await rpc('team_attendance_edit_meeting', { p: {} }, student);
    const body = await response.json();
    if (body.code !== 'PGRST202') { assert.equal(response.status, 403); assert.equal(body.code, '42501'); break; }
    assert(Date.now() < deadline, 'Attendance public RPC did not reach the PostgREST schema cache');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const canonicalTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private')
    and not (n.nspname='public' and c.relname in ('team_meetings','team_meeting_members','team_attendance','team_attendance_members','team_attendance_strikes','team_attendance_history'))
    order by 1`).split('\n').filter(Boolean);
  const canonical = fingerprint(canonicalTables);
  for (const actor of [mentor, lead, admin, student, programManager]) {
    const context = await json(await rpc('team_attendance_policy_context', {}, actor));
    assert.equal(context.user_id, actor.id);
    assert.equal(context.can_manage_meetings, [mentor, lead, admin].includes(actor));
    if (actor === programManager) { assert.equal(context.can_review, true); assert.equal(context.can_read_team, true); }
  }
  pass('seven real Auth identities and verified public-audit fixture use the public gateway; admin user_metadata does not grant access');

  const manage = (action, p, actor = mentor) => rpc('team_attendance_manage', { action, p }, actor).then(r => json(r));
  const edit = (p, actor = mentor) => rpc('team_attendance_edit_meeting', { p }, actor);
  async function meeting(mid, actor = mentor) {
    const rows = await json(await localFetch(base, `/rest/v1/team_meetings?select=${fields}&id=eq.${mid}`, { headers: headers(actor) }));
    assert.equal(rows.length, 1); return rows[0];
  }
  async function draft(mid, changes = {}) {
    const m = await meeting(mid);
    return { meeting_id: mid, version: m.version, title: m.title, meeting_type: m.meeting_type, starts_at: m.starts_at, ends_at: m.ends_at, ...changes };
  }
  const createMeeting = (title, starts = 120) => manage('create', {
    title, meeting_type: 'preseason', requirement: 'active', starts_at: future(starts), ends_at: future(starts + 120),
  }).then(r => r.id);
  const mid = await createMeeting('Synthetic HTTP edit meeting');
  const other = await createMeeting('Synthetic other occurrence', 360), otherBefore = await meeting(other);
  const original = await meeting(mid), unchangedRecords = records(mid);
  const forbidden = await draft(mid, { title: 'Forbidden HTTP edit' }), deniedBefore = fullState();
  for (const actor of [student, programManager, reader, inactive]) {
    await rejected(await edit(forbidden, actor), '42501', /Leadership access required/, 403);
  }
  await rejected(await edit(forbidden, null), '42501', /permission denied/, 401);
  for (const actor of [mentor, student, programManager]) {
    await rejected(await localFetch(base, `/rest/v1/team_meetings?id=eq.${mid}`, {
      method: 'PATCH', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Direct bypass' }),
    }), '42501', /permission denied/, 403);
  }
  assert.equal(fullState(), deniedBefore);
  pass('students, student Program Managers, readonly, inactive, anonymous, and direct table PATCH cannot mutate or create audit');

  for (const [actor, title] of [[mentor, 'Mentor title'], [lead, 'Lead title'], [admin, 'Admin title']]) {
    const before = await meeting(mid), payload = await draft(mid, { title, meeting_type: 'other' });
    assert.deepEqual(await json(await edit(payload, actor)), { id: mid, version: before.version + 1, changed: true });
    const after = await meeting(mid);
    assert.deepEqual(after, { ...before, title, meeting_type: 'other', version: before.version + 1 });
    const audit = query(`select to_jsonb(h) from public.team_attendance_history h where entity='team_meetings' and entity_id=${lit(mid)} and action='UPDATE' order by id desc limit 1`);
    assert.equal(audit.performed_by, actor.id); assert.equal(audit.before_data.title, before.title); assert.equal(audit.after_data.title, title);
    for (const p of [audit.before_data, audit.after_data]) for (const secret of ['code_hash', 'code_expires_at']) assert(!(secret in p));
  }
  assert.equal((await meeting(mid)).version, original.version + 3); assert.equal(records(mid), unchangedRecords);
  assert.deepEqual(await meeting(other), otherBefore);
  pass('mentor, lead, and admin edit only the selected occurrence with attributed old/new audit and unchanged roster/records');

  const concurrent = await draft(mid), auditsBefore = auditCount(mid);
  const candidates = [{ ...concurrent, title: 'HTTP competing A' }, { ...concurrent, title: 'HTTP competing B' }];
  const responses = await Promise.all(candidates.map((p, i) => edit(p, i ? lead : mentor)));
  assert.equal(responses.filter(r => r.ok).length, 1);
  const winnerIndex = responses.findIndex(r => r.ok);
  const receipt = await json(responses[winnerIndex]);
  await rejected(responses[1 - winnerIndex], '40001', /Meeting changed/);
  assert.deepEqual(receipt, { id: mid, version: concurrent.version + 1, changed: true });
  assert.equal((await meeting(mid)).title, candidates[winnerIndex].title); assert.equal(auditCount(mid), auditsBefore + 1);
  const replayBefore = fullState();
  for (const response of await Promise.all([edit(candidates[winnerIndex]), edit(candidates[winnerIndex])])) {
    assert.deepEqual(await json(response), { ...receipt, changed: false });
  }
  assert.equal(fullState(), replayBefore); assert.equal(records(mid), unchangedRecords);
  pass('competing HTTP edits reject the stale draft; exact lost-response retries preserve one audit/version');

  const rescheduleID = await createMeeting('Synthetic HTTP pending notice', 20);
  const expected = future(60);
  const noticeResponse = await rpc('team_attendance_request', { p: {
    meeting_id: rescheduleID, version: 1, notice_type: 'late', expected_at: expected, reason: 'Synthetic timing conflict',
  } }, student);
  assert(noticeResponse.ok, `Attendance request HTTP ${noticeResponse.status}`); await noticeResponse.text();
  const opening = await manage('open', { meeting_id: rescheduleID, version: (await meeting(rescheduleID)).version });
  assert.match(opening.code, /^\d{6}$/);
  const preserved = records(rescheduleID), beforeSchedule = fullState();
  const move = await draft(rescheduleID, { starts_at: future(1440), ends_at: future(1560) });
  await rejected(await edit(move), 'P0001', /Review and acknowledge/, 400);
  assert.equal(fullState(), beforeSchedule);
  assert.equal((await json(await edit({ ...move, acknowledge_schedule_change: true }))).changed, true);
  const moved = await meeting(rescheduleID);
  assert.equal(new Date(moved.starts_at).toISOString(), move.starts_at); assert.equal(new Date(moved.ends_at).toISOString(), move.ends_at);
  assert.equal(moved.check_in_open, false); assert.equal(moved.code_expires_at, null);
  assert.equal(sql(`select code_hash is null from public.team_meetings where id=${lit(rescheduleID)}`), 't');
  assert.equal(records(rescheduleID), preserved);
  assert.equal(new Date(sql(`select expected_at from public.team_attendance where meeting_id=${lit(rescheduleID)} and student_id=${lit(student.id)}`)).toISOString(), expected);
  await rejected(await rpc('team_attendance_check_in', { meeting_id: rescheduleID, code: opening.code }, student), 'P0001', /Check-in is closed/, 400);
  assert.equal(records(rescheduleID), preserved);
  pass('acknowledged future reschedule invalidates the old code and preserves pending notice times, attendance, roster, and strikes');

  const checkedID = await createMeeting('Synthetic HTTP checked-in meeting', 20);
  const code = (await manage('open', { meeting_id: checkedID, version: (await meeting(checkedID)).version })).code;
  assert.equal((await json(await rpc('team_attendance_check_in', { meeting_id: checkedID, code }, student))).message, 'Checked in');
  const checkedRecords = records(checkedID), checkedBefore = fullState();
  await rejected(await edit(await draft(checkedID, { starts_at: future(1440), ends_at: future(1560), acknowledge_schedule_change: true })), 'P0001', /Recorded attendance/, 400);
  assert.equal(fullState(), checkedBefore);
  assert.equal((await json(await edit(await draft(checkedID, { title: 'Corrected future title' })))).changed, true);
  assert.equal(records(checkedID), checkedRecords);
  pass('recorded check-in blocks a schedule change while title correction preserves attendance');

  const beforeFailure = fullState();
  sql(`create function public.attendance_editing_test_audit_failure() returns trigger language plpgsql as $$
    begin if new.entity='team_meetings' and new.entity_id=${lit(mid)} and new.action='UPDATE' then
      raise exception 'Synthetic Attendance audit failure';end if;return new;end$$;
    create trigger attendance_editing_test_audit_failure before insert on public.team_attendance_history
    for each row execute function public.attendance_editing_test_audit_failure();`);
  try {
    await rejected(await edit(await draft(mid, { title: 'Must roll back' })), 'P0001', /Synthetic Attendance audit failure/, 400);
    assert.equal(fullState(), beforeFailure);
  } finally {
    sql('drop trigger attendance_editing_test_audit_failure on public.team_attendance_history;drop function public.attendance_editing_test_audit_failure();');
  }
  assert.equal(fingerprint(canonicalTables), canonical, 'Attendance edits modified unrelated application records');
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('audit failure rolls back the RPC atomically; unrelated app data and real Auth contract remain unchanged');
  return checks;
}
