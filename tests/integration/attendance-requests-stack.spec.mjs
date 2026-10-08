// Opt-in extension of fabrication-local.mjs's OWNED disposable stack, after the
// Attendance editing fixture. Real Auth and PostgREST; no hosted URL or mock JWT.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

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
  const users = {};
  for (const [name, role, active = true] of [
    ['student', 'student'], ['lead', 'lead'], ['studentPM', 'student'], ['leadPM', 'lead'],
    ['mentor', 'mentor'], ['admin', 'admin'], ['reader', 'readonly'],
    ['inactiveStudent', 'student', false], ['inactiveLead', 'lead', false], ['noProfile', null],
  ]) users[name] = await signup(name, role, active);
  const { student, lead, studentPM, leadPM, mentor, admin, reader, inactiveStudent, inactiveLead, noProfile } = users;
  const participants = [student, lead, studentPM, leadPM];
  sql(`insert into public.team_positions(key,name,active) values('program_manager','Program Manager',true) on conflict(key) do nothing;
    insert into public.team_member_positions(user_id,position_key,revoked_at) values
    (${lit(studentPM.id)},'program_manager',null),(${lit(leadPM.id)},'program_manager',null);`);
  const createMeeting = async (title, starts = 120) => (await json(await manage('create', {
    title, meeting_type: 'preseason', requirement: 'active', starts_at: future(starts), ends_at: future(starts + 120),
  }, mentor))).id;
  const meetingVersion = mid => Number(sql(`select version from public.team_meetings where id=${lit(mid)}`));
  const mid = await createMeeting('Synthetic own request matrix');
  const untouchedID = await createMeeting('Synthetic unrelated request occurrence', 360);
  const untouched = fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id=${lit(untouchedID)}`);
  // A genuinely new active account has no entry in an already-snapshotted meeting.
  const unrostered = await signup('unrostered', 'lead');
  const canonicalTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private')
    and not (n.nspname='public' and c.relname in ('team_meetings','team_meeting_members','team_attendance','team_attendance_history'))
    order by 1`).split('\n').filter(Boolean);
  const canonical = fingerprint(canonicalTables);
  for (const actor of [...participants, mentor, admin]) {
    const context = await json(await rpc('team_attendance_policy_context', {}, actor));
    assert.equal(context.user_id, actor.id);
    assert.equal(context.can_review, [studentPM, leadPM, mentor].includes(actor));
    assert.equal(context.can_manage_meetings, ['lead', 'mentor', 'admin'].includes(actor.role));
  }
  pass('eleven real Auth identities use authoritative profiles; student and lead Program Managers keep separate request/review capabilities');

  // Every permission denial must leave both records and audit unchanged.
  const deniedBefore = state();
  const notice = { meeting_id: mid, version: 1, notice_type: 'absent', reason: 'Synthetic permission probe' };
  for (const actor of [reader, inactiveStudent, inactiveLead, mentor, admin, noProfile]) {
    await rejected(await submit(notice, actor), '42501', /Student access required/, 403);
  }
  await rejected(await submit(notice, null), '42501', /permission denied/, 401);
  await rejected(await submit(notice, unrostered), 'P0001', /not on this meeting roster/);
  assert.equal(state(), deniedBefore);
  pass('inactive student/lead, readonly, mentor, admin, missing profile, anonymous, and unrostered accounts cannot request or create audit');

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
  const selfBefore = state();
  for (const actor of [lead, studentPM, leadPM]) for (const status of ['excused', 'denied', 'not_required']) {
    await rejected(await review(await record(mid, actor), actor, status), '42501', /Another Mentor or Program Manager/, 403);
  }
  for (const reviewer of [lead, admin]) await rejected(await review(await record(mid, student), reviewer), '42501', /Another Mentor or Program Manager/, 403);
  await rejected(await review(await record(mid, lead), student), '42501', /Leadership access required/, 403);
  assert.equal(state(), selfBefore);
  for (const reviewer of [mentor, studentPM, leadPM]) {
    const before = await record(mid, student);
    await json(await review(before, reviewer));
    const reviewed = await record(mid, student);
    assert.deepEqual(physical(reviewed), physical(before)); assert.equal(reviewed.review_status, 'excused');
    assert.equal(reviewed.reviewed_by, reviewer.id); assert(reviewed.reviewed_at); assert.equal(reviewed.version, before.version + 1);
    assert.equal(latestAudit(before.id).performed_by, reviewer.id);
    await verifySaved(student, reviewed, { ...notice, version: reviewed.version, reason: 'Synthetic changed request needs a new review' });
  }
  pass('lead and Program Managers cannot self-review; mentor and both Program Managers review others, and a changed request resets the decision');

  for (const actor of [studentPM, leadPM]) {
    const before = await record(mid, actor), unchanged = state();
    const peer = actor === studentPM ? leadPM : studentPM;
    for (const status of ['excused', 'denied', 'not_required', 'none', 'pending'])
      await rejected(await review(before, peer, status), '42501', /A Mentor must review Program Manager/, 403);
    assert.equal(state(), unchanged);
    const queue = await json(await localFetch(base, `/rest/v1/team_attendance?select=${fields}&review_status=eq.pending&student_id=eq.${actor.id}`, { headers: headers(mentor) }));
    assert(queue.some(row => row.id === before.id), 'The mentor must see the Program Manager request');
    await json(await review(before, mentor));
    const after = await record(mid, actor);
    assert.equal(after.review_status, 'excused'); assert.equal(after.reviewed_by, mentor.id);
    assert.deepEqual(physical(after), physical(before));
    const context = await json(await rpc('team_attendance_policy_context', {}, actor));
    assert.equal(context.can_review_program_manager_requests, false);
    assert(context.mentor_review_required_for.includes(actor.id));
  }
  pass('student and lead Program Manager requests are mentor-visible, reject peer PM decisions, and show the mentor decision to the requester');


  // Both before-start and during-meeting check-ins retain physical evidence when
  // a request is submitted. The request never turns a check-in into an absence.
  for (const [starts, expectedPhysical] of [[20, 'present'], [-10, 'late']]) {
    const checkedID = await createMeeting(`Synthetic ${expectedPhysical} before early request`, starts);
    const opening = await json(await manage('open', { meeting_id: checkedID, version: meetingVersion(checkedID) }, mentor));
    for (const actor of participants) {
      assert.equal((await json(await rpc('team_attendance_check_in', { meeting_id: checkedID, code: opening.code }, actor))).message, 'Checked in');
      const before = await record(checkedID, actor);
      assert.equal(before.physical_status, expectedPhysical); assert(before.checked_in_at);
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
    }
  }
  pass('all four participant types request early departure after present/late check-in without changing physical attendance; in-progress absent/late is rejected');

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
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('audit failure rolls back atomically; other occurrences, profiles, positions, membership, strikes, unrelated apps, and real Auth remain unchanged');
  return checks;
}
