// Runs after the request, active-roster, and automatic-strike suites in the
// harness's OWNED disposable stack. All application mutations use genuine Auth
// sessions through PostgREST. SQL only prepares synthetic authority, installs
// the migration, and inspects results. Never targets a hosted database.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const attendanceOperationsLeadSources = [
  'supabase/migrations/20261010144754_attendance_operations_lead_participation.sql',
  'tests/integration/attendance-operations-lead-stack.spec.mjs',
];
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const attendanceTables = ['public.team_meetings', 'public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_strikes', 'public.team_attendance_history'];

export async function runAttendanceOperationsLeadIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql("select to_regprocedure('team_attendance_private.reconcile_absence_strike(uuid)') is not null"), 't', 'Run after the owned Attendance request, active-roster, and automatic-strike suites');
  assert.equal(sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='team_attendance_history' and column_name='performed_by'"), 'NO');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  const checks = [];
  const pass = label => { const message = `Operations Lead participation: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response) {
    const body = await response.json();
    assert.equal(response.status, 200, `Operations Lead HTTP ${response.status}; code=${body?.code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function saved(response) {
    const body = await response.text();
    assert(response.ok, `Operations Lead HTTP ${response.status}: ${body}`);
  }
  async function rejected(response, message, code = '42501', status = 403) {
    const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, code); assert.match(body.message, message);
  }
  const read = (table, select, filter, actor) => localFetch(base, `/rest/v1/${table}?select=${select}&${filter}`, { headers: headers(actor) }).then(json);
  const query = q => JSON.parse(sql(q));
  const fingerprint = (tables, where = '') => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t ${where})`
  ).join(',')})`)).digest('hex');
  const state = () => fingerprint(attendanceTables);
  const manage = (action, p, actor) => rpc('team_attendance_manage', { action, p }, actor);
  const context = actor => rpc('team_attendance_policy_context', {}, actor).then(json);
  const scoped = (actor, subject, mid) => rpc('team_attendance_sync_participant_rosters', { student_id: subject.id, meeting_ids: [mid] }, actor);
  const checkIn = (actor, mid, code) => rpc('team_attendance_check_in', { meeting_id: mid, code }, actor);
  const checkOut = (actor, mid) => rpc('team_attendance_check_out', { meeting_id: mid }, actor);
  const own = async (actor, mid) => {
    const rows = await read('team_attendance', '*', `meeting_id=eq.${mid}&student_id=eq.${actor.id}`, actor);
    assert.equal(rows.length, 1); return rows[0];
  };
  const meeting = mid => query(`select to_jsonb(m) from public.team_meetings m where id=${lit(mid)}`);
  const create = async (actor, title, starts = -20) => (await json(await manage('create', {
    title: `Synthetic Operations Lead ${title}`, meeting_type: 'preseason', requirement: 'active', starts_at: future(starts), ends_at: future(starts + 180),
  }, actor))).id;
  const submit = (actor, mid, version) => rpc('team_attendance_request', { p: {
    meeting_id: mid, version, notice_type: 'early', expected_at: future(60), reason: 'Synthetic early departure request',
  } }, actor);
  async function signup(name, role, active = true) {
    const email = `attendance-operations-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    // Deliberately false user-editable metadata must not confer participation.
    const created = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true, position: 'operations_lead' } }));
    assert(created.user?.id && created.access_token, 'Real Auth signup must issue a session');
    registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, created.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token, role, active, name };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    if (role) sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Operations Lead ${name}`)},${lit(role)},${active});`);
    return actor;
  }

  const users = {};
  for (const [name, role, active = true] of [
    ['adminOps', 'admin'], ['mentorOps', 'mentor'], ['revokedOps', 'admin'], ['inactiveOps', 'admin', false],
    ['readerOps', 'readonly'], ['admin', 'admin'], ['mentor', 'mentor'], ['student', 'student'], ['lead', 'lead'],
    ['adminPM', 'admin'], ['mentorPM', 'mentor'], ['noProfile', null],
  ]) users[name] = await signup(name, role, active);
  const { adminOps, mentorOps, revokedOps, inactiveOps, readerOps, admin, mentor, student, lead, adminPM, mentorPM, noProfile } = users;
  const operationsLeads = [adminOps, mentorOps];
  const existingParticipants = [student, lead, adminPM, mentorPM];
  const participants = [...operationsLeads, ...existingParticipants];
  const excluded = [revokedOps, inactiveOps, readerOps, admin, mentor, noProfile];
  sql(`insert into public.team_positions(key,name,active) values('operations_lead','Operations Lead',true) on conflict(key) do nothing;
    insert into public.team_member_positions(user_id,position_key,revoked_at) values
    ${[...operationsLeads, inactiveOps, readerOps].map(actor => `(${lit(actor.id)},'operations_lead',null)`).join(',')},
    (${lit(revokedOps.id)},'operations_lead',clock_timestamp()),
    (${lit(adminPM.id)},'program_manager',null),(${lit(mentorPM.id)},'program_manager',null);`);
  const beforeContexts = new Map();
  for (const actor of [...operationsLeads, admin, mentor, ...existingParticipants, revokedOps]) {
    const result = await context(actor); beforeContexts.set(actor.id, result);
    assert.equal(result.can_participate, existingParticipants.includes(actor));
  }
  // These real-session-created meetings already exist when the predicate changes.
  // Even an administrator's team-wide read access must not bypass its own roster.
  const activeID = await create(adminOps, 'existing active meeting');
  const unrelatedID = await create(mentorOps, 'unselected active meeting');
  const opening = await json(await manage('open', { meeting_id: activeID, version: meeting(activeID).version }, adminOps));
  let stable = state();
  for (const actor of operationsLeads) await rejected(await checkIn(actor, activeID, opening.code), /Active Attendance participant required/);
  assert.equal(state(), stable);
  pass('real admin/mentor Operations Lead sessions reproduce the original check-in denial while retaining meeting management');

  const unchangedFunctions = [
    'auth.uid()', 'public.team_has_position(text)', 'team_attendance_private.role()', 'team_attendance_private.manager()',
    'team_attendance_private.reader()', 'team_attendance_private.reviewer()', 'team_attendance_private.participant()',
    'team_attendance_private.is_program_manager(uuid)', 'team_attendance_private.is_student_program_manager(uuid)',
    'team_attendance_private.request_reviewer(uuid)', 'team_attendance_private.can_review_request(uuid,uuid)',
    'public.team_attendance_policy_context()', 'public.team_attendance_manage(text,jsonb)', 'public.team_attendance_roster()',
    'public.team_attendance_check_in(uuid,text)', 'public.team_attendance_check_out(uuid)', 'public.team_attendance_request(jsonb)',
    'public.team_attendance_sync_participant_rosters(uuid,uuid[])', 'public.team_attendance_sync_future_rosters()',
  ];
  const definitions = () => unchangedFunctions.map(name => sql(`select pg_get_functiondef(${lit(name)}::regprocedure)`));
  const definitionsBefore = definitions();
  const policyBefore = fingerprint(['pg_catalog.pg_policies']);
  const protectedTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
    and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private','volunteer_private')
    and not (n.nspname='public' and c.relname in ('team_meetings','team_meeting_members','team_attendance','team_attendance_history'))
    order by 1`).split('\n').filter(Boolean);
  const protectedBefore = fingerprint(protectedTables);
  const migration = readFileSync(new URL(`../../${attendanceOperationsLeadSources[0]}`, import.meta.url), 'utf8');
  for (let application = 0; application < 2; application++) {
    sql(migration);
    assert.equal(state(), stable, 'Predicate migration must not backfill rosters or rewrite business/audit records');
    assert.equal(fingerprint(protectedTables), protectedBefore, 'Predicate migration must not change profiles, positions, strikes, or other apps');
    assert.deepEqual(definitions(), definitionsBefore, 'Only the participation predicate may change');
    assert.equal(fingerprint(['pg_catalog.pg_policies']), policyBefore);
  }
  sql("notify pgrst, 'reload schema';");
  for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_function_privilege(${lit(role)},'team_attendance_private.is_participant(uuid)','EXECUTE')`), 'f');
  for (const actor of participants) {
    const result = await context(actor);
    assert.equal(result.can_participate, true);
    for (const key of ['can_manage_meetings', 'can_read_team', 'can_review', 'can_review_requests', 'can_review_program_manager_requests', 'mentor_review_required_for']) {
      assert.deepEqual(result[key], beforeContexts.get(actor.id)[key], `${actor.name}: ${key} must not change`);
    }
    assert.equal(result.people.find(person => person.id === actor.id)?.role ?? actor.role, actor.role);
  }
  const roster = await json(await rpc('team_attendance_roster', {}, adminOps));
  for (const actor of participants) assert(roster.some(row => row.student_id === actor.id), `${actor.name} should participate`);
  for (const actor of excluded) assert(!roster.some(row => row.student_id === actor.id), `${actor.name} should stay excluded`);
  for (const actor of [admin, mentor, revokedOps]) assert.equal((await context(actor)).can_participate, false);
  for (const actor of operationsLeads) {
    assert.deepEqual(await read('team_meeting_members', 'student_id', `meeting_id=eq.${activeID}&student_id=eq.${actor.id}`, actor), []);
    await rejected(await checkIn(actor, activeID, opening.code), /not on this meeting roster/, 'P0001', 400);
  }
  assert.equal(state(), stable);
  pass('idempotent migration changes only the private eligibility predicate; roles, RLS, review/management powers, PM participation, and historical snapshots remain intact');

  const unrelatedBefore = fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id=${lit(unrelatedID)}`);
  for (const actor of excluded) {
    await rejected(await checkIn(actor, activeID, opening.code), /Active Attendance participant required/);
    await rejected(await checkOut(actor, activeID), /Active Attendance participant required/);
    await rejected(await submit(actor, activeID, 1), /Active Attendance participant required/);
    await rejected(await scoped(adminOps, actor, activeID), /Active Attendance participant required/);
  }
  await rejected(await checkIn(null, activeID, opening.code), /permission denied/, '42501', 401);
  assert.equal(state(), stable, 'Denied participation and roster additions must be atomic and audit-free');
  for (const actor of operationsLeads) {
    const added = await json(await scoped(actor, actor, activeID));
    assert.deepEqual(added, { student_id: actor.id, meeting_ids: [activeID], added: 1, promoted: 0, skipped: 0 });
    const after = state();
    assert.deepEqual(await json(await scoped(actor, actor, activeID)), { ...added, added: 0 });
    assert.equal(state(), after, 'Repeated scoped roster addition must be a no-op');
    assert.equal((await own(actor, activeID)).physical_status, 'pending');
    const wrongCode = opening.code === '000000' ? '999999' : '000000';
    assert.deepEqual(await json(await checkIn(actor, activeID, wrongCode)), { error: 'Invalid meeting code' });
    assert.deepEqual(await json(await checkIn(actor, activeID, opening.code)), { message: 'Checked in' });
    const checked = await own(actor, activeID);
    assert.equal(checked.physical_status, 'late'); assert(checked.checked_in_at); assert.equal(checked.review_status, 'none');
    assert.equal(checked.version, 2);
    const checkedState = state();
    assert.deepEqual(await json(await checkIn(actor, activeID, opening.code)), { message: 'Attendance already recorded' });
    assert.equal(state(), checkedState);
    const audit = query(`select to_jsonb(h) from public.team_attendance_history h where entity='team_attendance' and entity_id=${lit(checked.id)} and action='UPDATE' order by id desc limit 1`);
    assert.equal(audit.performed_by, actor.id); assert.equal(audit.student_id, actor.id);
  }
  assert.equal(fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id=${lit(unrelatedID)}`), unrelatedBefore);
  pass('only explicitly selected active-meeting rosters gain Operations Leads; valid own check-in succeeds, incorrect codes fail, repeats are idempotent, and production audit actors are authentic');

  // Authority changes are read live using the SAME JWT, including after a
  // successful check-in. A stale session cannot preserve revoked participation.
  async function deniedLive(actor) {
    const before = state();
    assert.equal((await context(actor)).can_participate, false);
    await rejected(await checkIn(actor, activeID, opening.code), /Active Attendance participant required/);
    await rejected(await checkOut(actor, activeID), /Active Attendance participant required/);
    await rejected(await submit(actor, activeID, (await own(actor, activeID)).version), /Active Attendance participant required/);
    await rejected(await scoped(mentor, actor, activeID), /Active Attendance participant required/);
    assert.equal(state(), before);
  }
  sql(`update public.team_member_positions set revoked_at=clock_timestamp() where user_id=${lit(adminOps.id)} and position_key='operations_lead';`);
  await deniedLive(adminOps);
  assert.equal((await context(adminOps)).can_manage_meetings, true, 'Revoking participation must not revoke the shared admin role');
  sql(`update public.team_member_positions set revoked_at=null where user_id=${lit(adminOps.id)} and position_key='operations_lead';`);
  sql("update public.team_positions set active=false where key='operations_lead';");
  for (const actor of operationsLeads) await deniedLive(actor);
  for (const actor of existingParticipants) assert.equal((await context(actor)).can_participate, true);
  sql("update public.team_positions set active=true where key='operations_lead';");
  assert.equal(fingerprint(protectedTables), protectedBefore, 'Restored synthetic authority must match the original state exactly');
  pass('revoked assignments and inactive positions immediately block check-in, checkout, requests, and roster repair with unchanged JWTs; ordinary admin/mentor and inactive/readonly accounts remain excluded');

  for (const actor of operationsLeads) {
    const before = await own(actor, activeID);
    await saved(await submit(actor, activeID, before.version));
    const requested = await own(actor, activeID);
    assert.equal(requested.review_status, 'pending'); assert.equal(requested.checked_in_at, before.checked_in_at);
    assert.equal(requested.physical_status, before.physical_status); assert.equal(requested.version, before.version + 1);
    stable = state();
    await rejected(await manage('attendance', { meeting_id: activeID, attendance_id: requested.id, version: requested.version,
      review_status: 'excused', explanation: 'Synthetic prohibited self-review' }, actor), /Another active Lead Coach or Program Manager must review/);
    assert.equal(state(), stable);
    assert.deepEqual(await json(await checkOut(actor, activeID)), { message: 'Check-out recorded' });
    const departed = await own(actor, activeID);
    assert.equal(departed.physical_status, 'left_early'); assert(departed.left_at); assert.equal(departed.review_status, 'pending');
    stable = state();
    assert.deepEqual(await json(await checkOut(actor, activeID)), { message: 'Check-out already recorded' });
    assert.equal(state(), stable);
    const managedID = await create(actor, `${actor.name} retained future management`, 180);
    const managed = meeting(managedID);
    assert.equal(managed.created_by, actor.id);
    assert.deepEqual(await json(await rpc('team_attendance_edit_meeting', { p: {
      meeting_id: managedID, version: managed.version, title: `${managed.title} edited`, meeting_type: managed.meeting_type,
      starts_at: managed.starts_at, ends_at: managed.ends_at,
    } }, actor)), { id: managedID, version: managed.version + 1, changed: true });
  }
  // Also prove self-review is forbidden when the Operations Lead genuinely has
  // independent review authority, rather than merely lacking reviewer powers.
  sql(`insert into public.team_member_positions(user_id,position_key,revoked_at) values(${lit(mentorOps.id)},'lead_coach_1',null);`);
  assert.equal((await context(mentorOps)).can_review_requests, true);
  const requested = await own(mentorOps, activeID);
  stable = state();
  await rejected(await manage('attendance', { meeting_id: activeID, attendance_id: requested.id, version: requested.version,
    review_status: 'excused', explanation: 'Synthetic reviewer self-review denial' }, mentorOps), /Another active Lead Coach or Program Manager must review/);
  assert.equal(state(), stable);
  const adminRequest = await own(adminOps, activeID);
  await json(await manage('attendance', { meeting_id: activeID, attendance_id: adminRequest.id, version: adminRequest.version,
    review_status: 'excused', explanation: 'Synthetic independent coach review' }, mentorOps));
  const reviewed = await own(adminOps, activeID);
  assert.equal(reviewed.review_status, 'excused'); assert.equal(reviewed.reviewed_by, mentorOps.id);
  assert.equal(reviewed.checked_in_at, adminRequest.checked_in_at); assert.equal(reviewed.left_at, adminRequest.left_at);
  // Remove only this temporary synthetic fixture grant, restoring the fingerprint.
  sql(`delete from public.team_member_positions where user_id=${lit(mentorOps.id)} and position_key='lead_coach_1';`);
  assert.equal(fingerprint(protectedTables), protectedBefore, 'All shared roles, positions, membership, strikes, and unrelated application data remain unchanged');
  assert.deepEqual(definitions(), definitionsBefore); assert.equal(fingerprint(['pg_catalog.pg_policies']), policyBefore);
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('own requests and checkout preserve physical history; self-review is denied even for a reviewer-qualified Operations Lead; independent review and admin/mentor create/edit management remain intact');
  return checks;
}
