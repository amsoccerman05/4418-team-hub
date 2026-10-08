// Opt-in extension of fabrication-local.mjs's OWNED disposable stack, after the
// Attendance editing fixture. Real Auth and PostgREST; no hosted URL or mock JWT.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const attendanceRequestSources = [
  'supabase/migrations/20261008063138_attendance_coach_request_review.sql',
  'tests/integration/attendance-requests-stack.spec.mjs',
];

const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const fields = 'id,meeting_id,student_id,physical_status,review_status,checked_in_at,left_at,notice_type,expected_at,notice_at,notice_reason,review_reason,reviewed_by,reviewed_at,version';
const physical = row => Object.fromEntries(['id', 'meeting_id', 'student_id', 'physical_status', 'checked_in_at', 'left_at'].map(key => [key, row[key]]));

export async function runAttendanceRequestsIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql("select to_regclass('public.team_attendance') is not null"), 't',
    'Run after the owned Attendance editing fixture; never install into an existing database');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  const checks = [];
  const pass = label => { const message = `Attendance requests: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, `Attendance request HTTP ${response.status}; code=${body?.code || 'unspecified'}`);
    return body;
  }
  async function saved(response) {
    // RETURNS void can be represented as 204 or a null JSON result by PostgREST.
    const body = await response.text();
    assert(response.ok, `Attendance request HTTP ${response.status}: ${body}`);
  }
  async function rejected(response, code, message, status = 400) {
    const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, code); assert.match(body.message, message);
  }
  const query = q => JSON.parse(sql(q));
  const fingerprint = (tables, where = '') => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t ${where})`
  ).join(',')})`)).digest('hex');
  const state = () => fingerprint(['public.team_meetings', 'public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history', 'public.team_attendance_strikes']);
  const auditCount = id => Number(sql(`select count(*) from public.team_attendance_history where entity='team_attendance' and entity_id=${lit(id)} and action='UPDATE'`));
  const latestAudit = id => query(`select to_jsonb(h) from public.team_attendance_history h where entity='team_attendance' and entity_id=${lit(id)} and action='UPDATE' order by id desc limit 1`);
  const submit = (p, actor) => rpc('team_attendance_request', { p }, actor);
  const manage = (action, p, actor) => rpc('team_attendance_manage', { action, p }, actor);
  async function record(mid, actor) {
    const rows = await json(await localFetch(base, `/rest/v1/team_attendance?select=${fields}&meeting_id=eq.${mid}&student_id=eq.${actor.id}`, { headers: headers(actor) }));
    assert.equal(rows.length, 1); return rows[0];
  }
  async function signup(name, role, active = true) {
    const email = `attendance-request-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    // User-controlled claims deliberately disagree with the authoritative profile.
    const created = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true, position: 'program_manager' } }));
    assert(created.user?.id && created.access_token, 'Real Auth signup must issue a session');
    registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, created.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token, name, role };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    if (role) sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Attendance ${name}`)},${lit(role)},${active});`);
    return actor;
  }
  // This opt-in suite installs the additive request-only restriction after the
  // older editing suite finishes, so that suite keeps its historical contract.
  // Do not substitute the production audit table here: this real-stack fixture
  // intentionally retains its extra actor columns. The dedicated production
  // ten-column NOT NULL performed_by fixture is tested separately in PGlite.
  const sharedHelpers = [
    'auth.uid()', 'public.team_has_position(text)', 'team_attendance_private.role()',
    'team_attendance_private.manager()', 'team_attendance_private.reader()', 'team_attendance_private.reviewer()',
  ];
  const helperDefinitions = () => sharedHelpers.map(name => sql(`select pg_get_functiondef(${lit(name)}::regprocedure)`));
  const unchangedHelpers = helperDefinitions();
  const migrationState = state();
  for (const path of attendanceRequestSources.filter(path => path.endsWith('.sql'))) {
    sql(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
  }
  assert.deepEqual(helperDefinitions(), unchangedHelpers, 'Request routing must not change shared role, management, reader, strike, or Auth helpers');
  assert.equal(state(), migrationState, 'Additive reviewer migration must not rewrite attendance or audit data');
  sql("notify pgrst, 'reload schema';");
  // Notification Center/Finance prerequisites are deliberately absent from this
  // stack. Notification eligibility is covered by the isolated notification SQL
  // suite; this test must not claim email delivery or notification integration.
  assert.equal(sql("select to_regnamespace('notifications_private') is null"), 't');
  pass('additive request restriction preserves real Auth, shared authority helpers, and existing attendance/audit rows');

  const users = {};
  for (const [name, role, active = true] of [
    ['student', 'student'], ['lead', 'lead'], ['studentPM', 'student'], ['leadPM', 'lead'],
    ['mentorPM', 'mentor'], ['adminPM', 'admin'],
    ['mentor', 'mentor'], ['admin', 'admin'], ['reader', 'readonly'],
    ['coach1', 'mentor'], ['coach2', 'mentor'],
    ['studentCoach', 'student'], ['leadCoach', 'lead'], ['adminCoach', 'admin'], ['readerCoach', 'readonly'],
    ['inactiveStudent', 'student', false], ['inactiveLead', 'lead', false], ['noProfile', null],
  ]) users[name] = await signup(name, role, active);
  const { student, lead, studentPM, leadPM, mentorPM, adminPM, mentor, admin, reader, inactiveStudent, inactiveLead, noProfile,
    coach1, coach2, studentCoach, leadCoach, adminCoach, readerCoach } = users;
  const programManagers = [studentPM, leadPM, mentorPM, adminPM];
  const coaches = [coach1, coach2];
  const participants = [student, lead, ...programManagers, studentCoach, leadCoach];
  const nonparticipants = [reader, inactiveStudent, inactiveLead, mentor, admin, noProfile, ...coaches, adminCoach, readerCoach];
  sql(`insert into public.team_positions(key,name,active) values('program_manager','Program Manager',true) on conflict(key) do nothing;
    insert into public.team_member_positions(user_id,position_key,revoked_at) values
    ${programManagers.map(actor => `(${lit(actor.id)},'program_manager',null)`).join(',')};
    insert into public.team_positions(key,name,active) values
      ('lead_coach_1','Synthetic first lead coach',true),('lead_coach_2','Synthetic second lead coach',true);
    insert into public.team_member_positions(user_id,position_key,revoked_at) values
      (${lit(coach1.id)},'lead_coach_1',null),(${lit(coach2.id)},'lead_coach_2',null),
      (${lit(mentorPM.id)},'lead_coach_1',null),
      ${[studentCoach, leadCoach, adminCoach, readerCoach].map(actor => `(${lit(actor.id)},'lead_coach_1',null)`).join(',')};`);
  const createMeeting = async (title, starts = 120, actor = mentor) => (await json(await manage('create', {
    title, meeting_type: 'preseason', requirement: 'active', starts_at: future(starts), ends_at: future(starts + 120),
  }, actor))).id;
  const meetingVersion = mid => Number(sql(`select version from public.team_meetings where id=${lit(mid)}`));
  const mid = await createMeeting('Synthetic own request matrix');
  const untouchedID = await createMeeting('Synthetic unrelated request occurrence', 360);
  const unrosteredID = await createMeeting('Synthetic unrostered physical attendance boundary', -10);
  const unrosteredOpening = await json(await manage('open', { meeting_id: unrosteredID, version: meetingVersion(unrosteredID) }, mentor));
  const untouched = fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id=${lit(untouchedID)}`);
  // A genuinely new active account has no entry in an already-snapshotted meeting.
  const unrostered = await signup('unrostered', 'lead');
  const canonicalTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private')
    and not (n.nspname='public' and c.relname in ('team_meetings','team_meeting_members','team_attendance','team_attendance_history'))
    order by 1`).split('\n').filter(Boolean);
  const canonical = fingerprint(canonicalTables);
  const accountRoles = () => query(`select jsonb_object_agg(id,role) from public.profiles
    where id in (${Object.values(users).filter(actor => actor.role).map(actor => lit(actor.id)).join(',')})`);
  const originalRoles = accountRoles();
  for (const actor of [...participants, mentor, admin, ...coaches, adminCoach]) {
    const context = await json(await rpc('team_attendance_policy_context', {}, actor));
    assert.equal(context.user_id, actor.id);
    assert.equal(context.can_participate, participants.includes(actor));
    assert.equal(context.can_review, [...programManagers, mentor, ...coaches].includes(actor), 'Legacy strike capability must stay separate');
    assert.equal(context.can_review_requests, [...programManagers, ...coaches].includes(actor));
    assert.equal(context.can_manage_meetings, ['lead', 'mentor', 'admin'].includes(actor.role));
    assert.equal(context.can_review_program_manager_requests, coaches.includes(actor));
    if (context.can_read_team) {
      for (const pm of programManagers) assert(context.mentor_review_required_for.includes(pm.id));
      assert.equal(context.people.find(person => person.id === actor.id)?.role, actor.role);
    }
  }
  const roster = await json(await rpc('team_attendance_roster', {}, mentor));
  for (const actor of participants) assert(roster.some(row => row.student_id === actor.id));
  for (const actor of nonparticipants) assert(!roster.some(row => row.student_id === actor.id));
  pass('nineteen real Auth identities use authoritative profiles and position keys; both mentor-role coach positions review, other-role coach labels grant no new authority, and legacy strikes/management remain unchanged');

  for (const actor of [mentorPM, adminPM]) {
    const managedID = await createMeeting(`Synthetic ${actor.name} retained management`, 120, actor);
    const managed = query(`select to_jsonb(m) from public.team_meetings m where id=${lit(managedID)}`);
    assert.equal(managed.created_by, actor.id);
    const edited = await json(await rpc('team_attendance_edit_meeting', { p: {
      meeting_id: managedID, version: managed.version, title: `${managed.title} edited`,
      meeting_type: managed.meeting_type, starts_at: managed.starts_at, ends_at: managed.ends_at,
    } }, actor));
    assert.deepEqual(edited, { id: managedID, version: managed.version + 1, changed: true });
    assert.deepEqual(accountRoles(), originalRoles);
  }
  pass('mentor/admin Program Managers retain real create/edit meeting authority while using their unchanged shared account roles');

  // Every permission denial must leave both records and audit unchanged.
  const deniedBefore = state();
  const notice = { meeting_id: mid, version: 1, notice_type: 'absent', reason: 'Synthetic permission probe' };
  for (const actor of nonparticipants) {
    await rejected(await submit(notice, actor), '42501', /Active Attendance participant required/, 403);
    await rejected(await rpc('team_attendance_check_in', { meeting_id: unrosteredID, code: unrosteredOpening.code }, actor), '42501', /Active Attendance participant required/, 403);
    await rejected(await rpc('team_attendance_check_out', { meeting_id: unrosteredID }, actor), '42501', /Active Attendance participant required/, 403);
  }
  await rejected(await submit(notice, null), '42501', /permission denied/, 401);
  await rejected(await rpc('team_attendance_check_in', { meeting_id: unrosteredID, code: unrosteredOpening.code }, null), '42501', /permission denied/, 401);
  await rejected(await rpc('team_attendance_check_out', { meeting_id: unrosteredID }, null), '42501', /permission denied/, 401);
  await rejected(await submit(notice, unrostered), 'P0001', /not on this meeting roster/);
  await rejected(await rpc('team_attendance_check_in', { meeting_id: unrosteredID, code: unrosteredOpening.code }, unrostered), 'P0001', /not on this meeting roster/);
  await rejected(await rpc('team_attendance_check_out', { meeting_id: unrosteredID }, unrostered), 'P0001', /not on this meeting roster/);
  assert.equal(state(), deniedBefore);
  pass('inactive, readonly, nonparticipant mentor/admin/coaches, missing profile, anonymous, and unrostered accounts cannot request, check in/out, or create audit');

  async function verifySaved(actor, before, p) {
    const audits = auditCount(before.id);
    const serverBefore = Date.parse(sql('select clock_timestamp()'));
    await saved(await submit(p, actor));
    const serverAfter = Date.parse(sql('select clock_timestamp()'));
    const after = await record(p.meeting_id, actor);
    assert.deepEqual(physical(after), physical(before));
    assert.equal(after.version, before.version + 1); assert.equal(after.notice_type, p.notice_type);
    assert.equal(after.notice_reason, p.reason.trim()); assert.equal(after.review_status, 'pending');
    assert.equal(after.review_reason, ''); assert.equal(after.reviewed_by, null); assert.equal(after.reviewed_at, null);
    assert.equal(after.expected_at && new Date(after.expected_at).toISOString(), p.expected_at || null);
    const noticeTime = Date.parse(after.notice_at);
    assert(noticeTime >= serverBefore && noticeTime <= serverAfter, 'Notice must use the server submission time');
    assert.equal(auditCount(before.id), audits + 1);
    const audit = latestAudit(before.id);
    assert.equal(audit.performed_by, actor.id); assert.equal(audit.student_id, actor.id);
    assert.equal(audit.before_data.version, before.version); assert.equal(audit.after_data.version, after.version);
    assert.equal(audit.after_data.notice_reason, p.reason.trim());
    return after;
  }
  async function verifyCheckedOut(meeting_id, actor) {
    const before = await record(meeting_id, actor), audits = auditCount(before.id);
    const others = () => fingerprint(['public.team_attendance'], `where not (meeting_id=${lit(meeting_id)} and student_id=${lit(actor.id)})`);
    const otherBefore = others();
    const serverBefore = Date.parse(sql('select clock_timestamp()'));
    assert.equal((await json(await rpc('team_attendance_check_out', { meeting_id }, actor))).message, 'Check-out recorded');
    const serverAfter = Date.parse(sql('select clock_timestamp()'));
    const after = await record(meeting_id, actor);
    assert.deepEqual(after, { ...before, physical_status: 'left_early', left_at: after.left_at, version: before.version + 1 });
    assert(Date.parse(after.left_at) >= serverBefore && Date.parse(after.left_at) <= serverAfter);
    assert.equal(others(), otherBefore); assert.equal(auditCount(before.id), audits + 1);
    const audit = latestAudit(before.id);
    assert.equal(audit.performed_by, actor.id); assert.equal(audit.student_id, actor.id);
    assert.equal(audit.before_data.version, before.version); assert.equal(audit.after_data.version, after.version);
    const unchanged = state();
    assert.equal((await json(await rpc('team_attendance_check_out', { meeting_id }, actor))).message, 'Check-out already recorded');
    assert.equal(state(), unchanged, 'Check-out replay must preserve the original departure and audit');
    return after;
  }
  for (const actor of participants) {
    let current = await record(mid, actor);
    for (const [notice_type, expected_at, reason] of [
      ['absent', null, '  Synthetic absence  '], ['late', future(150), 'Synthetic late arrival'],
      ['early', future(180), 'Synthetic early departure'], ['early', future(190), 'Synthetic updated departure'],
      ['absent', null, 'Synthetic updated absence clears expected time'],
    ]) {
      current = await verifySaved(actor, current, { meeting_id: mid, version: current.version, notice_type, expected_at, reason });
    }
    const staleBefore = state();
    for (const version of [1, null]) await rejected(await submit({ ...notice, version }, actor), 'P0001', /Attendance changed/);
    assert.equal(state(), staleBefore);
    const candidates = ['A', 'B'].map(label => ({ ...notice, version: current.version, reason: `Synthetic competing ${label}` }));
    const audits = auditCount(current.id);
    const responses = await Promise.all(candidates.map(p => submit(p, actor)));
    assert.equal(responses.filter(response => response.ok).length, 1);
    const winner = responses.findIndex(response => response.ok);
    await saved(responses[winner]); await rejected(responses[1 - winner], 'P0001', /Attendance changed/);
    current = await record(mid, actor);
    assert.equal(current.version, candidates[winner].version + 1); assert.equal(current.notice_reason, candidates[winner].reason);
    assert.equal(auditCount(current.id), audits + 1);
    pass(`${actor.name} submits absent/late/early, updates and clears times; stale and concurrent writes preserve one version/audit`);
  }

  for (const actor of participants) {
    const before = await record(mid, actor), victim = actor === student ? lead : student;
    const victimRecord = await record(mid, victim);
    const otherRows = () => fingerprint(['public.team_attendance'], `where not (meeting_id=${lit(mid)} and student_id=${lit(actor.id)})`);
    const others = otherRows();
    await verifySaved(actor, before, { ...notice, version: before.version, reason: 'Synthetic bound identity',
      student_id: victim.id, user_id: victim.id, attendance_id: victimRecord.id,
      reviewed_by: victim.id, review_status: 'excused', physical_status: 'absent',
      notice_at: '2000-01-01T00:00:00Z', checked_in_at: '2000-01-01T00:00:00Z',
    });
    assert.equal(otherRows(), others);
  }
  const directBefore = state();
  for (const actor of participants) {
    await rejected(await localFetch(base, `/rest/v1/team_attendance?meeting_id=eq.${mid}&student_id=eq.${actor.id}`, {
      method: 'PATCH', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify({ review_status: 'excused' }),
    }), '42501', /permission denied/, 403);
  }
  assert.equal(state(), directBefore);
  pass('spoofed identity, attendance ID, physical status, review status, and backdated notice fields cannot change another person or bypass the RPC');

  const review = (row, reviewer, status = 'excused') => manage('attendance', {
    meeting_id: row.meeting_id, attendance_id: row.id, version: row.version,
    review_status: status, explanation: 'Synthetic independent review',
  }, reviewer);
  const reviewStates = ['excused', 'denied', 'not_required', 'none', 'pending'];
  const selfBefore = state();
  for (const actor of [lead, ...programManagers, leadCoach]) for (const status of reviewStates) {
    await rejected(await review(await record(mid, actor), actor, status), '42501', /review|Leadership access required/i, 403);
  }
  for (const reviewer of [mentor, lead, admin, studentCoach, leadCoach, adminCoach, readerCoach]) {
    // A real, still-valid Auth token does not make the user a request reviewer.
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(reviewer) }))).id, reviewer.id);
    for (const status of reviewStates) {
      await rejected(await review(await record(mid, student), reviewer, status), '42501', /review|Leadership access required/i, 403);
    }
  }
  await rejected(await review(await record(mid, lead), student), '42501', /Leadership access required/, 403);
  assert.equal(state(), selfBefore);
  async function verifyReviewed(before, reviewer, status) {
    const audits = auditCount(before.id);
    await json(await review(before, reviewer, status));
    const after = query(`select to_jsonb(a) from public.team_attendance a where id=${lit(before.id)}`);
    assert.deepEqual(physical(after), physical(before)); assert.equal(after.review_status, status);
    assert.equal(after.reviewed_by, reviewer.id); assert(after.reviewed_at); assert.equal(after.version, before.version + 1);
    assert.equal(auditCount(before.id), audits + 1); assert.equal(latestAudit(before.id).performed_by, reviewer.id);
    return after;
  }
  for (const actor of [student, lead]) for (const reviewer of [...coaches, ...programManagers]) {
    for (const status of ['excused', 'denied']) {
      const after = await verifyReviewed(await record(mid, actor), reviewer, status);
      await verifySaved(actor, after, { ...notice, version: after.version, reason: 'Synthetic changed request needs a new review' });
    }
  }
  pass('valid ordinary mentor and other-role coach JWTs cannot decide/reset requests; both coach positions and all PM roles approve/deny ordinary participants with attributed audit and fresh-request reset');

  for (const actor of programManagers) {
    const before = await record(mid, actor), unchanged = state();
    for (const peer of [...programManagers, mentor]) {
      for (const status of reviewStates) {
        await rejected(await review(before, peer, status), '42501', /review/i, 403);
      }
    }
    assert.equal(state(), unchanged);
    for (const coach of coaches) for (const status of ['excused', 'denied']) {
      const current = await record(mid, actor);
      const queue = await json(await localFetch(base, `/rest/v1/team_attendance?select=${fields}&review_status=eq.pending&student_id=eq.${actor.id}`, { headers: headers(coach) }));
      assert(queue.some(row => row.id === current.id), 'An eligible lead coach must see the Program Manager request');
      const after = await verifyReviewed(current, coach, status);
      await verifySaved(actor, after, { ...notice, version: after.version, reason: 'Synthetic PM request needs a new coach review' });
    }
    const context = await json(await rpc('team_attendance_policy_context', {}, actor));
    assert.equal(context.can_review_program_manager_requests, false);
    assert(context.mentor_review_required_for.includes(actor.id));
  }
  pass('PM requests reject self, every peer PM, dual coach/PM, and ordinary mentor; both non-PM lead coach positions approve/deny all four PM account roles');

  // No token refresh occurs while database authority changes. Every forbidden
  // review status and a combined physical+review payload must be denied before
  // a row version, physical record, or history entry can change.
  for (const [actor, position] of [[coach1, 'lead_coach_1'], [coach2, 'lead_coach_2'], [studentPM, 'program_manager']]) {
    for (const [label, invalidate, restore, profileActive] of [
      ['assignment revocation', `update public.team_member_positions set revoked_at=clock_timestamp() where user_id=${lit(actor.id)} and position_key=${lit(position)} and revoked_at is null`,
        `update public.team_member_positions set revoked_at=null where user_id=${lit(actor.id)} and position_key=${lit(position)}`, true],
      ['position inactivity', `update public.team_positions set active=false where key=${lit(position)}`,
        `update public.team_positions set active=true where key=${lit(position)}`, true],
      ['profile inactivity', `update public.profiles set active=false where id=${lit(actor.id)}`,
        `update public.profiles set active=true where id=${lit(actor.id)}`, false],
    ]) {
      const authorityBefore = fingerprint(canonicalTables);
      sql(invalidate);
      try {
        const unchanged = state();
        assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
        const contextResponse = await rpc('team_attendance_policy_context', {}, actor);
        if (profileActive) {
          const context = await json(contextResponse);
          assert.equal(context.can_review_requests, false);
          assert.equal(context.can_review_program_manager_requests, false);
          assert.equal(context.can_review, coaches.includes(actor), 'Coach assignment removal must not revoke legacy mentor strike access');
          assert.equal(context.can_manage_meetings, coaches.includes(actor), 'Coach assignment removal must not revoke legacy mentor management');
        } else await rejected(contextResponse, '42501', /Active Attendance account required/, 403);
        for (const requester of [student, leadPM]) {
          const row = await record(mid, requester);
          for (const status of reviewStates) await rejected(await review(row, actor, status), '42501', /review|Leadership access required/i, 403);
          await rejected(await manage('attendance', { meeting_id: row.meeting_id, attendance_id: row.id,
            version: row.version, physical_status: 'absent', review_status: 'excused', explanation: 'Synthetic combined bypass',
          }, actor), '42501', /review|Leadership access required/i, 403);
        }
        assert.equal(state(), unchanged, `${actor.name} ${label} must not change records or audit`);
        assert.deepEqual(accountRoles(), originalRoles);
      } finally {
        sql(restore);
        assert.equal(fingerprint(canonicalTables), authorityBefore, `Synthetic ${actor.name} ${label} fixture must be restored exactly`);
      }
      const restored = await json(await rpc('team_attendance_policy_context', {}, actor));
      assert.equal(restored.can_review_requests, true);
      assert.equal(restored.can_review_program_manager_requests, coaches.includes(actor));
    }
  }
  pass('unchanged real coach/PM JWTs lose decision authority immediately after assignment revocation, position inactivity, or profile inactivity, including combined correction/review payloads');


  // Both before-start and during-meeting check-ins retain physical evidence when
  // a request is submitted. The request never turns a check-in into an absence.
  for (const [starts, expectedPhysical] of [[20, 'present'], [-10, 'late']]) {
    const checkedID = await createMeeting(`Synthetic ${expectedPhysical} before early request`, starts);
    const opening = await json(await manage('open', { meeting_id: checkedID, version: meetingVersion(checkedID) }, mentor));
    for (const actor of participants) {
      const prior = await record(checkedID, actor), audits = auditCount(prior.id);
      const others = () => fingerprint(['public.team_attendance'], `where not (meeting_id=${lit(checkedID)} and student_id=${lit(actor.id)})`);
      const otherBefore = others();
      assert.equal((await json(await rpc('team_attendance_check_in', { meeting_id: checkedID, code: opening.code }, actor))).message, 'Checked in');
      const before = await record(checkedID, actor);
      assert.equal(before.physical_status, expectedPhysical); assert(before.checked_in_at);
      assert.deepEqual(before, { ...prior, physical_status: expectedPhysical, checked_in_at: before.checked_in_at, version: prior.version + 1 });
      assert.equal(others(), otherBefore); assert.equal(auditCount(before.id), audits + 1);
      assert.equal(latestAudit(before.id).performed_by, actor.id);
      if (starts < 0) {
        const unchanged = state();
        for (const notice_type of ['absent', 'late']) await rejected(await submit({
          ...notice, meeting_id: checkedID, version: before.version, notice_type,
        }, actor), 'P0001', /During a meeting only early-departure/);
        assert.equal(state(), unchanged);
      }
      await verifySaved(actor, before, { ...notice, meeting_id: checkedID, version: before.version,
        notice_type: 'early', expected_at: future(50), reason: 'Synthetic departure after check-in',
      });
      if (starts < 0) await verifyCheckedOut(checkedID, actor);
    }
  }
  pass('all eligible student/lead/PM participants check in to their own row, request early departure without rewriting physical evidence, and check out once; in-progress absent/late is rejected');

  // Keep the same real JWT while authoritative eligibility changes. A stale
  // session cannot keep participant rights, including idempotent check-in paths.
  const eligibilityID = await createMeeting('Synthetic live participant eligibility', -10);
  const eligibilityOpening = await json(await manage('open', { meeting_id: eligibilityID, version: meetingVersion(eligibilityID) }, mentor));
  for (const actor of [mentorPM, adminPM]) {
    assert.equal((await json(await rpc('team_attendance_check_in', { meeting_id: eligibilityID, code: eligibilityOpening.code }, actor))).message, 'Checked in');
    const before = await record(eligibilityID, actor);
    for (const [label, invalidate, restore, profileActive] of [
      ['position revocation', `update public.team_member_positions set revoked_at=clock_timestamp() where user_id=${lit(actor.id)} and position_key='program_manager' and revoked_at is null`,
        `update public.team_member_positions set revoked_at=null where user_id=${lit(actor.id)} and position_key='program_manager'`, true],
      ['position archival', "update public.team_positions set active=false where key='program_manager'",
        "update public.team_positions set active=true where key='program_manager'", true],
      ['profile inactivity', `update public.profiles set active=false where id=${lit(actor.id)}`,
        `update public.profiles set active=true where id=${lit(actor.id)}`, false],
    ]) {
      const authorityBefore = fingerprint(canonicalTables);
      sql(invalidate);
      try {
        const unchanged = state();
        const contextResponse = await rpc('team_attendance_policy_context', {}, actor);
        if (profileActive) {
          const context = await json(contextResponse);
          assert.equal(context.can_participate, false);
          assert.equal(context.can_manage_meetings, true, 'Removing PM eligibility must retain the underlying active mentor/admin management role');
          assert(!context.mentor_review_required_for.includes(actor.id));
        } else await rejected(contextResponse, '42501', /Active Attendance account required/, 403);
        await rejected(await submit({ ...notice, meeting_id: eligibilityID, version: before.version,
          notice_type: 'early', expected_at: future(50), reason: `Synthetic ${label} request`,
        }, actor), '42501', /Active Attendance participant required/, 403);
        await rejected(await rpc('team_attendance_check_in', { meeting_id: eligibilityID, code: eligibilityOpening.code }, actor), '42501', /Active Attendance participant required/, 403);
        await rejected(await rpc('team_attendance_check_out', { meeting_id: eligibilityID }, actor), '42501', /Active Attendance participant required/, 403);
        assert.equal(state(), unchanged, `${label} denial must not change records or audit`);
        assert.deepEqual(accountRoles(), originalRoles);
      } finally {
        sql(restore);
        assert.equal(fingerprint(canonicalTables), authorityBefore, `Synthetic ${label} fixture must be restored exactly`);
      }
      const restored = await json(await rpc('team_attendance_policy_context', {}, actor));
      assert.equal(restored.can_participate, true); assert.equal(restored.can_manage_meetings, true);
      assert.equal(restored.can_review_program_manager_requests, false);
      assert(restored.mentor_review_required_for.includes(actor.id));
    }
    await verifySaved(actor, before, { ...notice, meeting_id: eligibilityID, version: before.version,
      notice_type: 'early', expected_at: future(50), reason: 'Synthetic participant eligibility restored',
    });
    await verifyCheckedOut(eligibilityID, actor);
  }
  pass('the same mentor/admin PM JWT loses request/check-in/check-out rights after assignment revocation, position archival, or profile inactivity; restoring fixtures restores eligibility without changing roles');

  const current = await record(mid, lead);
  const invalidBefore = state();
  const start = sql(`select starts_at from public.team_meetings where id=${lit(mid)}`);
  const end = sql(`select ends_at from public.team_meetings where id=${lit(mid)}`);
  for (const [patch, message] of [
    [{ notice_type: 'other' }, /Select attendance impact/], [{ reason: '  ' }, /Provide a reason/],
    [{ reason: 'x'.repeat(2001) }, /Provide a reason/], [{ expected_at: future(150) }, /Absence does not need/],
    [{ notice_type: 'late', expected_at: null }, /Expected time/], [{ notice_type: 'early', expected_at: start }, /Expected time/],
    [{ notice_type: 'late', expected_at: end }, /Expected time/], [{ notice_type: 'early', expected_at: future(-1) }, /Expected time/],
    [{ meeting_id: randomUUID() }, /Meeting not found/],
  ]) await rejected(await submit({ ...notice, version: current.version, ...patch }, lead), 'P0001', message);
  assert.equal(state(), invalidBefore);
  const endedID = await createMeeting('Synthetic ended request boundary', -240);
  for (const finalized of [false, true]) {
    if (finalized) {
      await json(await manage('close', { meeting_id: endedID, version: meetingVersion(endedID) }, mentor));
      await json(await manage('finalize', { meeting_id: endedID, version: meetingVersion(endedID) }, mentor));
    }
    const unchanged = state();
    for (const actor of participants) await rejected(await submit({ ...notice, meeting_id: endedID,
      version: (await record(endedID, actor)).version, notice_type: 'early', expected_at: future(50),
    }, actor), 'P0001', /Contact leadership after the meeting/);
    assert.equal(state(), unchanged);
  }
  pass('invalid reasons/impact/times/missing meeting and ended/finalized requests are rejected without record or audit writes');

  const beforeFailure = state();
  sql(`create function public.attendance_request_test_audit_failure() returns trigger language plpgsql as $$
    begin if new.entity='team_attendance' and new.entity_id=${lit(current.id)} and new.action='UPDATE' then
      raise exception 'Synthetic request audit failure';end if;return new;end$$;
    create trigger attendance_request_test_audit_failure before insert on public.team_attendance_history
    for each row execute function public.attendance_request_test_audit_failure();`);
  try {
    await rejected(await submit({ ...notice, version: current.version, reason: 'Synthetic rollback probe' }, lead), 'P0001', /Synthetic request audit failure/);
    assert.equal(state(), beforeFailure);
  } finally {
    sql('drop trigger attendance_request_test_audit_failure on public.team_attendance_history;drop function public.attendance_request_test_audit_failure();');
  }
  assert.equal(fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id=${lit(untouchedID)}`), untouched);
  assert.equal(fingerprint(canonicalTables), canonical, 'Requests changed profiles, positions, membership, strikes, or unrelated app records');
  assert.deepEqual(accountRoles(), originalRoles, 'Attendance participation must never change shared account roles');
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  assert.deepEqual(helperDefinitions(), unchangedHelpers, 'Shared strike/read/management and Auth helpers must remain unchanged');
  pass('audit failure rolls back atomically; other occurrences, profiles, positions, membership, strikes, unrelated apps, and real Auth remain unchanged');
  return checks;
}
