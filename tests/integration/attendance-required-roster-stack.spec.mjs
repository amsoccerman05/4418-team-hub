// Runs last in fabrication-local.mjs's OWNED disposable stack after Attendance
// prerequisites. Uses real Auth sessions and PostgREST; never a hosted database,
// service-role API, forged JWT, or replacement auth.uid().
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const attendanceRequiredRosterSources = [
  'supabase/migrations/20261011025742_attendance_required_roster_editing.sql',
  'tests/integration/attendance-required-roster-stack.spec.mjs',
];
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const tables = ['public.team_meetings', 'public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_strikes', 'public.team_attendance_history'];

export async function runAttendanceRequiredRosterIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql("select to_regprocedure('team_attendance_private.reconcile_absence_strike(uuid)') is not null"), 't', 'Run after Attendance prerequisites');
  assert.equal(sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='team_attendance_history' and column_name='performed_by'"), 'NO');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  const checks = [];
  const pass = label => { const message = `Required Attendance roster: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response) {
    const body = await response.json();
    assert.equal(response.status, 200, `Required roster HTTP ${response.status}; code=${body?.code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function saved(response) { const body = await response.text(); assert(response.ok, `Required roster HTTP ${response.status}: ${body}`); }
  async function rejected(response, message, code = 'P0001', status = 400) {
    const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, code); assert.match(body.message, message);
  }
  const query = q => JSON.parse(sql(q));
  const fingerprint = (names = tables, where = '') => createHash('sha256').update(sql(`select jsonb_build_object(${names.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t ${where})`
  ).join(',')})`)).digest('hex');
  const state = () => fingerprint();
  const occurrence = mid => tables.map(table => fingerprint([table], `where ${table === 'public.team_meetings' ? 'id' : 'meeting_id'}=${lit(mid)}`)).join(':');
  const meetingFields = 'id,title,meeting_type,starts_at,ends_at,late_minutes,requirement,status,check_in_open,code_expires_at,created_by,created_at,version';
  const read = (table, filter, actor) => localFetch(base, `/rest/v1/${table}?select=${table === 'team_meetings' ? meetingFields : '*'}&${filter}`, { headers: headers(actor) }).then(json);
  const privateMeetingFields = mid => query(`select jsonb_build_object('selected_students',selected_students,'areas',areas) from public.team_meetings where id=${lit(mid)}`);
  const definitions = () => ['auth.uid()', 'public.team_attendance_manage(text,jsonb)', 'public.team_attendance_request(jsonb)',
    'public.team_attendance_check_in(uuid,text)', 'public.team_attendance_check_out(uuid)', 'public.team_attendance_policy_context()',
    'public.team_attendance_sync_participant_rosters(uuid,uuid[])', 'public.team_attendance_sync_future_rosters()',
    'team_attendance_private.is_participant(uuid)', 'team_attendance_private.can_review_request(uuid,uuid)']
    .map(name => sql(`select pg_get_functiondef(${lit(name)}::regprocedure)`));
  const definitionsBefore = definitions(), policiesBefore = fingerprint(['pg_catalog.pg_policies']), installBefore = state();
  sql(readFileSync(new URL(`../../${attendanceRequiredRosterSources[0]}`, import.meta.url), 'utf8'));
  sql("notify pgrst, 'reload schema';");
  assert.equal(state(), installBefore, 'Installing the editor must not backfill or rewrite any record');
  assert.deepEqual(definitions(), definitionsBefore); assert.equal(fingerprint(['pg_catalog.pg_policies']), policiesBefore);
  pass('additive migration preserves existing records, Auth, RLS, request review, check-in, and sync functions');

  async function signup(name, role, active = true) {
    const email = `required-roster-${name}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`; registerSecret(password);
    const created = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true } }));
    assert(created.user?.id && created.access_token, 'Real Auth signup must issue a session');
    registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, created.user.id); registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Required Roster ${name}`)},${lit(role)},${active});`);
    return actor;
  }
  const manager = await signup('manager', 'mentor'), first = await signup('first', 'student'), second = await signup('second', 'student'), requester = await signup('requester', 'student');
  const inactive = await signup('inactive', 'student', false), studentManager = await signup('student-manager', 'student');
  sql(`insert into public.team_member_positions(user_id,position_key,revoked_at) values(${lit(manager.id)},'lead_coach_1',null),(${lit(studentManager.id)},'program_manager',null);`);
  const manage = (action, p) => rpc('team_attendance_manage', { action, p }, manager).then(json);
  const edit = (p, actor = manager) => rpc('team_attendance_edit_meeting', { p }, actor);
  const meeting = async mid => { const rows = await read('team_meetings', `id=eq.${mid}`, manager); assert.equal(rows.length, 1); return rows[0]; };
  const own = async (mid, actor) => { const rows = await read('team_attendance', `meeting_id=eq.${mid}&student_id=eq.${actor.id}`, actor); assert.equal(rows.length, 1); return rows[0]; };
  const required = mid => query(`select coalesce(jsonb_agg(student_id order by student_id),'[]') from public.team_meeting_members where meeting_id=${lit(mid)} and required`);
  const create = (title, ids = [first.id], start = 120, requirement = 'selected') => manage('create', {
    title: `Synthetic required roster ${title}`, meeting_type: 'preseason', requirement,
    selected_students: ids, starts_at: future(start), ends_at: future(start + 120),
  }).then(result => result.id);
  async function draft(mid, target, changes = {}) {
    const m = await meeting(mid);
    return { meeting_id: mid, version: m.version, title: m.title, meeting_type: m.meeting_type, starts_at: m.starts_at, ends_at: m.ends_at,
      ...(target === undefined ? {} : { required_student_ids: [...target].sort(), expected_required_student_ids: required(mid), acknowledge_roster_change: true }), ...changes };
  }
  const mid = await create('combined occurrence', [first.id, requester.id], 20);
  const other = await create('untouched occurrence', [first.id, requester.id], 360);
  const newcomer = await signup('newcomer', 'student');
  const pending = await own(mid, requester);
  await saved(await rpc('team_attendance_request', { p: { meeting_id: mid, version: pending.version, notice_type: 'absent', expected_at: null, reason: 'Synthetic school appointment' } }, requester));
  const requestBefore = await own(mid, requester), otherBefore = occurrence(other);
  const opening = await manage('open', { meeting_id: mid, version: (await meeting(mid)).version });
  const target = [second.id, requester.id, newcomer.id].sort();
  const change = await draft(mid, target, { title: 'Synthetic moved required occurrence', starts_at: future(1440), ends_at: future(1560), acknowledge_schedule_change: true });
  let stable = state();
  for (const actor of [first, studentManager, inactive]) await rejected(await edit(change, actor), /Leadership access required/, '42501', 403);
  await rejected(await edit(change, null), /permission denied/, '42501', 401);
  for (const patch of [{ acknowledge_roster_change: false }, { selected_students: target }, { requirement: 'active' }, { required_student_ids: [second.id, second.id] }]) {
    await rejected(await edit({ ...change, ...patch }), /acknowledge|required|Only|distinct/i);
  }
  await rejected(await edit({ ...change, required_student_ids: target.filter(id => id !== requester.id) }), /request.*lock/i);
  assert.equal(state(), stable, 'Denied combined edits must have zero partial writes');
  pass('unauthorized actors, missing acknowledgment, unknown fields, duplicates, and submitted-request changes are rejected atomically');

  assert.deepEqual(await json(await edit(change)), { id: mid, version: change.version + 1, changed: true });
  const updated = await meeting(mid);
  assert.equal(updated.requirement, 'selected'); assert.deepEqual(privateMeetingFields(mid), { selected_students: target, areas: [] });
  assert.equal(updated.check_in_open, false); assert.equal(updated.code_expires_at, null); assert.deepEqual(required(mid), target);
  assert.deepEqual(await own(mid, requester), requestBefore, 'Submitted request must retain all its saved evidence');
  const removed = await own(mid, first), promoted = await own(mid, second), added = await own(mid, newcomer);
  assert.equal(removed.review_status, 'not_required'); assert.equal(promoted.review_status, 'none'); assert.equal(added.review_status, 'none');
  assert.equal(removed.physical_status, 'pending'); assert.equal(added.physical_status, 'pending');
  assert.equal(occurrence(other), otherBefore, 'Other recurrence occurrence must remain unchanged');
  await rejected(await rpc('team_attendance_check_in', { meeting_id: mid, code: opening.code }, first), /Check-in is closed/);
  const rosterAudit = query(`select jsonb_agg(to_jsonb(h) order by h.id) from public.team_attendance_history h where meeting_id=${lit(mid)} and action in ('ROSTER_EDIT_ADD','ROSTER_EDIT_REQUIREMENT')`);
  assert.equal(rosterAudit.length, 3); assert(rosterAudit.every(row => row.performed_by === manager.id));
  assert(rosterAudit.some(row => row.action === 'ROSTER_EDIT_ADD' && row.student_id === newcomer.id));
  stable = state(); assert.deepEqual(await json(await edit(change)), { id: mid, version: change.version + 1, changed: false }); assert.equal(state(), stable);
  pass('combined date/roster edit updates one occurrence, preserves pending requests, invalidates the code, adds missing participation, records real audit actors, and retries without writes');

  const emptyID = await create('empty selection');
  const clear = await draft(emptyID, []);
  await json(await edit(clear)); assert.equal((await meeting(emptyID)).requirement, 'optional'); assert.deepEqual(required(emptyID), []);
  stable = state(); await json(await edit(clear)); assert.equal(state(), stable);
  await json(await edit(await draft(emptyID, [second.id]))); assert.equal((await meeting(emptyID)).requirement, 'selected'); assert.deepEqual(required(emptyID), [second.id]);
  const broadID = await create('broad mode retained', [], 180, 'active');
  const broadBefore = privateMeetingFields(broadID);
  await json(await edit(await draft(broadID, undefined, { title: 'Synthetic broad title corrected' })));
  assert.equal((await meeting(broadID)).requirement, 'active'); assert.deepEqual(privateMeetingFields(broadID), broadBefore);
  pass('empty required set becomes optional, selecting again becomes explicit selected, and untouched roster fields retain broad requirement mode');

  const staleDraft = await draft(broadID, required(broadID).filter(id => id !== first.id));
  const late = await signup('late-member', 'student');
  await json(await rpc('team_attendance_sync_participant_rosters', { student_id: late.id, meeting_ids: [broadID] }, manager));
  assert.equal((await meeting(broadID)).version, staleDraft.version, 'Roster sync intentionally does not increment meeting.version');
  stable = state(); await rejected(await edit(staleDraft), /Required roster changed/, '40001', 500); assert.equal(state(), stable);
  const currentRequired = required(broadID);
  await json(await edit(await draft(broadID, currentRequired.filter(id => id !== first.id))));
  assert(required(broadID).includes(late.id));
  pass('a roster-sync change is detected independently of meeting.version; reload preserves the newly added participant');

  const checkedID = await create('checked lock', [first.id], 20);
  const code = (await manage('open', { meeting_id: checkedID, version: (await meeting(checkedID)).version })).code;
  assert.equal((await json(await rpc('team_attendance_check_in', { meeting_id: checkedID, code }, first))).message, 'Checked in');
  stable = state(); await rejected(await edit(await draft(checkedID, [second.id])), /Recorded attendance.*lock/); assert.equal(state(), stable);
  const checkedBefore = await own(checkedID, first);
  await json(await edit(await draft(checkedID, [first.id, second.id]))); assert.deepEqual(await own(checkedID, first), checkedBefore);
  const reviewedID = await create('reviewed request lock', [first.id]);
  const reviewRow = await own(reviewedID, first);
  await manage('attendance', { meeting_id: reviewedID, attendance_id: reviewRow.id, version: reviewRow.version, review_status: 'excused', explanation: 'Synthetic approved absence' });
  stable = state(); await rejected(await edit(await draft(reviewedID, [])), /reviewed decisions.*lock/); assert.equal(state(), stable);
  const strikeID = await create('strike lock', [first.id]);
  const strikeRow = await own(strikeID, first);
  await manage('strike', { meeting_id: strikeID, attendance_id: strikeRow.id, version: strikeRow.version, category: 'Other', quantity: 1, explanation: 'Synthetic safety strike' });
  stable = state(); await rejected(await edit(await draft(strikeID, [])), /strikes.*lock/); assert.equal(state(), stable);
  pass('checked-in, reviewed, and strike-bearing participants are immutable while independent unlocked participants remain editable');

  const inactiveID = await create('became inactive', [first.id]);
  sql(`update public.profiles set active=false where id=${lit(first.id)};`);
  stable = state(); await rejected(await edit(await draft(inactiveID, [])), /unavailable/); assert.equal(state(), stable);
  await json(await edit(await draft(inactiveID, [first.id, second.id]))); assert(required(inactiveID).includes(first.id));
  sql(`update public.profiles set active=true where id=${lit(first.id)};`);
  const startedID = await create('started occurrence', [first.id], -10);
  stable = state(); await rejected(await edit(await draft(startedID, [second.id])), /started/); assert.equal(state(), stable);
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  assert.deepEqual(definitions(), definitionsBefore); assert.equal(fingerprint(['pg_catalog.pg_policies']), policiesBefore);
  pass('inactive saved participants remain unchanged, started meetings reject edits, and Auth/RLS/reviewer boundaries are preserved');
  return checks;
}
