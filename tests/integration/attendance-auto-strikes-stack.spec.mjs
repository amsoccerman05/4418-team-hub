// Runs LAST in fabrication-local.mjs's OWNED disposable Supabase stack, after
// active-roster checks establish the production ten-column NOT NULL audit table.
// All app mutations use genuine Auth sessions through PostgREST. SQL is limited
// to synthetic profile/position setup, migration installation, inspection, and
// isolated fault injection. No impersonation, hosted URL, or service-role API.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const attendanceAutoStrikeSources = [
  'supabase/migrations/20261009155227_attendance_automatic_absence_strikes.sql',
  'tests/integration/attendance-auto-strikes-stack.spec.mjs',
];
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const fromNow = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const auditColumns = ['id', 'meeting_id', 'student_id', 'entity', 'entity_id', 'action', 'before_data', 'after_data', 'performed_by', 'performed_at'];
const attendanceTables = ['public.team_meetings', 'public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_strikes', 'public.team_attendance_history'];

export async function runAttendanceAutoStrikesIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql("select to_regprocedure('team_attendance_private.can_review_request(uuid,uuid)') is not null"), 't', 'Run after the owned Attendance request/active-roster suites');
  const query = q => JSON.parse(sql(q));
  assert.deepEqual(query("select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='team_attendance_history'"), auditColumns);
  assert.equal(sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='team_attendance_history' and column_name='performed_by'"), 'NO');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  const checks = [];
  const pass = label => { const message = `Automatic absence strikes: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response) {
    const body = await response.json();
    assert.equal(response.status, 200, `Automatic absence HTTP ${response.status}; code=${body?.code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function rejected(response, message, code = 'P0001', status = 400) {
    const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, code); assert.match(body.message, message);
  }
  const read = (table, select, filter, actor) => localFetch(base, `/rest/v1/${table}?select=${select}&${filter}`, { headers: headers(actor) }).then(json);
  // Omitting only the two additive fields makes before/after migration snapshots
  // comparable. Normal operation checks include those fields and every audit row.
  const fingerprint = (tables, where = '', additive = false) => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(${additive ? "to_jsonb(t)-'source'-'auto_absence_strikes_enabled'" : 'to_jsonb(t)'} order by to_jsonb(t)::text),'[]') from ${table} t ${where})`
  ).join(',')})`)).digest('hex');
  const state = () => fingerprint(attendanceTables);
  const manage = (action, p, actor) => rpc('team_attendance_manage', { action, p }, actor);
  const meeting = mid => query(`select to_jsonb(m) from public.team_meetings m where id=${lit(mid)}`);
  const record = (mid, actor) => query(`select to_jsonb(a) from public.team_attendance a where meeting_id=${lit(mid)} and student_id=${lit(actor.id)}`);
  const strikes = (mid, actor) => query(`select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.team_attendance_strikes s where meeting_id=${lit(mid)} and student_id=${lit(actor.id)}`);
  const auto = (mid, actor) => strikes(mid, actor).filter(s => s.source === 'automatic_absence');
  async function signup(name, role, active = true) {
    const email = `auto-absence-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    // User-editable metadata deliberately lies about role and activity.
    const created = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true, position: 'program_manager' } }));
    assert(created.user?.id && created.access_token, 'Real Auth signup must issue a session');
    registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, created.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    if (role) sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Automatic Absence ${name}`)},${lit(role)},${active});`);
    return actor;
  }
  const users = {};
  for (const [name, role, active = true] of [
    ['manager', 'mentor'], ['coach', 'mentor'], ['lead', 'lead'], ['admin', 'admin'],
    ['student', 'student'], ['other', 'student'], ['deferred', 'student'], ['pm', 'student'], ['optional', 'student'],
    ['reader', 'readonly'], ['inactive', 'mentor', false], ['noProfile', null],
  ]) users[name] = await signup(name, role, active);
  const { manager, coach, lead, admin, student, other, deferred, pm, optional, reader, inactive, noProfile } = users;
  sql(`insert into public.team_member_positions(user_id,position_key,revoked_at) values
    (${lit(coach.id)},'lead_coach_1',null),(${lit(pm.id)},'program_manager',null);`);
  const create = async (title, selected, start = -120, end = -60, actor = manager) => (await json(await manage('create', {
    title: `Synthetic automatic absence ${title}`, meeting_type: 'preseason', requirement: 'selected',
    selected_students: selected.map(a => a.id), starts_at: fromNow(start), ends_at: fromNow(end),
  }, actor))).id;
  const close = (mid, actor = manager) => manage('close', { meeting_id: mid, version: meeting(mid).version }, actor).then(json);
  const candidateIDs = mid => query(`select coalesce(jsonb_agg(a.id order by a.id),'[]') from public.team_attendance a
    join public.team_meeting_members mm on mm.meeting_id=a.meeting_id and mm.student_id=a.student_id
    where a.meeting_id=${lit(mid)} and mm.required and a.physical_status in ('pending','absent')
    and a.review_status in ('none','denied') and not exists(select 1 from public.team_attendance_strikes s
      where s.attendance_id=a.id and (s.source='automatic_absence' or lower(trim(s.category))='unexcused absence'))`);
  const finalize = (mid, count, actor = manager, patch = {}) => manage('finalize', {
    meeting_id: mid, version: meeting(mid).version, automatic_absence_strike_count: count,
    automatic_absence_strike_attendance_ids: candidateIDs(mid), ...patch,
  }, actor);
  const change = (mid, subject, patch, actor = manager) => {
    const a = record(mid, subject);
    return manage('attendance', { meeting_id: mid, attendance_id: a.id, version: a.version, explanation: 'Synthetic reviewed correction', ...patch }, actor);
  };
  const manual = (mid, subject, category = 'Unexcused Absence', actor = manager) => manage('strike', {
    meeting_id: mid, attendance_id: record(mid, subject).id, category, quantity: 1, explanation: 'Synthetic explicit manual decision',
  }, actor);

  // Produce authentic pre-migration history and pre-existing manual strikes using
  // the old RPC, rather than creating business records with an invented actor.
  const historicID = await create('already finalized history', [student, other]);
  await close(historicID);
  await json(await manage('finalize', { meeting_id: historicID, version: meeting(historicID).version }, manager));
  const manualID = await create('manual and non-absence matrix', [student, other, deferred, pm, lead]);
  await json(await manual(manualID, student));
  await json(await manual(manualID, other));
  const manualToRescind = strikes(manualID, other)[0];
  await json(await manage('rescind', { meeting_id: manualID, attendance_id: record(manualID, other).id,
    strike_id: manualToRescind.id, explanation: 'Synthetic pre-existing rescission' }, manager));
  const rescindedManual = strikes(manualID, other)[0];
  await json(await manual(manualID, deferred, 'Other'));
  await json(await change(manualID, pm, { physical_status: 'late' }));
  await json(await change(manualID, lead, { physical_status: 'left_early', left_at: new Date(Date.parse(meeting(manualID).starts_at) + 10_000).toISOString() }));
  await json(await change(manualID, optional, { physical_status: 'absent', review_status: 'none' }, coach));
  await close(manualID);
  const oldManual = strikes(manualID, student)[0], otherCategory = strikes(manualID, deferred)[0];
  const helpers = ['auth.uid()', 'public.team_has_position(text)', 'team_attendance_private.role()',
    'team_attendance_private.manager()', 'team_attendance_private.reader()', 'team_attendance_private.reviewer()',
    'team_attendance_private.participant()', 'team_attendance_private.request_reviewer(uuid)',
    'team_attendance_private.can_review_request(uuid,uuid)', 'public.team_attendance_request(jsonb)',
    'public.team_attendance_check_in(uuid,text)', 'public.team_attendance_check_out(uuid)', 'team_attendance_private.audit()'];
  const definitions = () => helpers.map(name => sql(`select pg_get_functiondef(${lit(name)}::regprocedure)`));
  const helperBefore = definitions();
  const policies = () => fingerprint(['pg_catalog.pg_policies'], "where schemaname in ('public','team_attendance_private')");
  const policyBefore = policies(), beforeMigration = fingerprint(attendanceTables, '', true);
  sql(readFileSync(new URL(`../../${attendanceAutoStrikeSources[0]}`, import.meta.url), 'utf8'));
  sql("notify pgrst, 'reload schema';");
  assert.equal(fingerprint(attendanceTables, '', true), beforeMigration, 'Migration must not rewrite records or historical audit');
  assert.equal(sql('select count(*) from public.team_meetings where auto_absence_strikes_enabled'), '0');
  assert.equal(sql("select count(*) from public.team_attendance_strikes where source<>'manual'"), '0');
  assert.equal(policies(), policyBefore); assert.deepEqual(definitions(), helperBefore);
  pass('additive migration preserves all prior records, audit, RLS, real Auth, and reviewer helpers; historical finalized meetings remain disabled and existing strikes become manual');

  const unrelatedTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
    and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private','volunteer_private')
    and not (n.nspname='public' and c.relname in ('team_meetings','team_meeting_members','team_attendance','team_attendance_strikes','team_attendance_history'))
    order by 1`).split('\n').filter(Boolean);
  const unrelatedBefore = fingerprint(unrelatedTables);
  const policyHistory = () => fingerprint(['public.team_attendance_history'], "where entity='attendance_policy' or action='WARNING_PARENT_CONTACT'");
  const policyHistoryBefore = policyHistory();
  assert.equal(sql("select prosecdef from pg_proc where oid='team_attendance_private.reconcile_absence_strike(uuid)'::regprocedure"), 'f');
  for (const role of ['anon', 'authenticated']) {
    assert.equal(sql(`select has_function_privilege(${lit(role)},'team_attendance_private.reconcile_absence_strike(uuid)','execute')`), 'f', 'Private reconciliation must not be client-callable');
  }
  for (const actor of [manager, lead, admin, student, pm]) {
    const context = await json(await rpc('team_attendance_policy_context', {}, actor));
    assert.equal(context.user_id, actor.id);
    assert.equal(context.can_manage_meetings, [manager, lead, admin].includes(actor));
    assert.equal(context.can_review_requests, actor === pm);
  }
  // This short real-time meeting allows genuine own absent requests before start.
  // No database clock, auth.uid(), physical row, or audit identity is mocked.
  const mid = await create('new finalization and deferred requests', [student, other, deferred, pm], 15, 25);
  for (const actor of [deferred, pm]) {
    const response = await rpc('team_attendance_request', { p: { meeting_id: mid, version: record(mid, actor).version,
      notice_type: 'absent', reason: 'Synthetic absence awaiting authorized review' } }, actor);
    assert(response.ok, `Own synthetic request failed: HTTP ${response.status}; ${await response.text()}`);
    assert.equal(record(mid, actor).review_status, 'pending');
    const h = query(`select to_jsonb(h) from public.team_attendance_history h where entity='team_attendance' and entity_id=${lit(record(mid, actor).id)} and action='UPDATE' order by id desc limit 1`);
    assert.equal(h.performed_by, actor.id);
  }
  await json(await change(mid, other, { physical_status: 'absent', review_status: 'denied' }, coach));
  await close(mid);
  const deniedBefore = state();
  for (const actor of [student, other, deferred, pm, reader, inactive, noProfile]) {
    await rejected(await finalize(mid, 2, actor), /Leadership access required/, '42501', 403);
  }
  await rejected(await finalize(mid, 2, null), /permission denied/, '42501', 401);
  // Reuse a genuine issued JWT after the authoritative profile becomes inactive.
  sql(`update public.profiles set active=false where id=${lit(manager.id)}`);
  try { await rejected(await finalize(mid, 2), /Leadership access required/, '42501', 403); }
  finally { sql(`update public.profiles set active=true where id=${lit(manager.id)}`); }
  assert.equal(sql('select auth.uid() is null'), 't');
  sql(`do $$ begin begin perform public.team_attendance_manage('finalize',jsonb_build_object('meeting_id',${lit(mid)},'version',${meeting(mid).version},'automatic_absence_strike_count',2));
    raise exception 'Unexpected owner-without-Auth success';exception when insufficient_privilege then
    if sqlerrm<>'Leadership access required' then raise;end if;end;end $$;`);
  assert.equal(state(), deniedBefore);
  pass('student/PM/readonly/inactive/missing-profile/anonymous callers and SQL owner without Auth cannot finalize; current profile authority overrides stale JWT metadata');

  // Finalization intentionally waits for the actual scheduled end; bound by this
  // synthetic meeting's deadline, never by a mocked server clock.
  const waitDeadline = Date.parse(meeting(mid).ends_at) + 15_000;
  while (sql(`select clock_timestamp()>=ends_at from public.team_meetings where id=${lit(mid)}`) !== 't') {
    assert(Date.now() < waitDeadline, 'Synthetic meeting end did not arrive');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  let stable = state();
  for (const count of [undefined, null, '2', -1, 1.5, true, 0, 1, 3]) {
    await rejected(await finalize(mid, count), /count|confirm|changed|integer/i);
    assert.equal(state(), stable, 'Invalid or stale confirmation must leave finalization, attendance, strikes, and audit unchanged');
  }
  const confirmedIDs = candidateIDs(mid);
  for (const ids of [undefined, null, 'not-an-array', [], ['not-a-uuid'], [randomUUID(), randomUUID()], [confirmedIDs[0], confirmedIDs[0]]]) {
    await rejected(await finalize(mid, 2, manager, { automatic_absence_strike_attendance_ids: ids }), /count|confirm|changed|preview/i);
    assert.equal(state(), stable, 'Missing, malformed, or mismatched named preview must fail atomically');
  }
  // A reviewed change between the preview and confirmation must invalidate the
  // old count even though the meeting's own version has not changed.
  await json(await change(mid, other, { review_status: 'excused' }, coach));
  stable = state();
  await rejected(await finalize(mid, 2), /count|confirm|changed/i);
  assert.equal(state(), stable);
  // Same count, different people: preserve the original named preview while
  // the deferred request becomes denied and the prior candidate is excused.
  await json(await change(mid, deferred, { review_status: 'denied' }, pm));
  assert.equal(candidateIDs(mid).length, confirmedIDs.length);
  assert.notDeepEqual(candidateIDs(mid), confirmedIDs);
  stable = state();
  await rejected(await finalize(mid, 2, manager, { automatic_absence_strike_attendance_ids: confirmedIDs }), /count|confirm|changed|preview/i);
  assert.equal(state(), stable);
  await json(await change(mid, deferred, { review_status: 'pending' }, pm));
  await json(await change(mid, other, { review_status: 'denied' }, coach));
  const result = await json(await finalize(mid, 2, manager, { assigned_by: student.id, performed_by: student.id }));
  assert.equal(result.automatic_absence_strikes, 2);
  assert.equal(meeting(mid).status, 'finalized'); assert.equal(meeting(mid).auto_absence_strikes_enabled, true);
  for (const actor of [student, other]) {
    const s = auto(mid, actor);
    assert.equal(s.length, 1); assert.equal(s[0].category, 'Unexcused Absence'); assert.equal(s[0].quantity, 1);
    assert.equal(s[0].assigned_by, manager.id); assert.equal(s[0].rescinded_at, null);
    assert.equal(record(mid, actor).physical_status, 'absent');
    const h = query(`select to_jsonb(h) from public.team_attendance_history h where entity='team_attendance_strikes' and entity_id=${lit(s[0].id)} and action='INSERT'`);
    assert.equal(h.performed_by, manager.id); assert.equal(h.after_data.source, 'automatic_absence');
  }
  for (const actor of [deferred, pm]) { assert.equal(record(mid, actor).physical_status, 'absent'); assert.deepEqual(auto(mid, actor), []); }
  assert.deepEqual(strikes(mid, optional), []); assert.equal(record(mid, optional).physical_status, 'pending');
  stable = state();
  await rejected(await finalize(mid, 0), /finalized/);
  assert.equal(state(), stable);
  pass('strict count and exact named-candidate confirmation reject same-count swaps and are rechecked against current eligibility; required pending/denied absences get one attributed strike, pending excuses defer, and optional rows stay untouched');

  for (const actor of [student, other]) {
    const visible = await read('team_attendance_strikes', 'id,student_id,source,assigned_by', `meeting_id=eq.${mid}`, actor);
    assert.equal(visible.length, 1); assert(visible.every(s => s.student_id === actor.id));
    const hidden = actor === student ? other : student;
    for (const table of ['team_attendance', 'team_attendance_strikes', 'team_attendance_history']) {
      assert.deepEqual(await read(table, 'student_id', `meeting_id=eq.${mid}&student_id=eq.${hidden.id}`, actor), [], `${table} must not leak another student's records`);
    }
  }
  assert.deepEqual(await read('team_attendance_strikes', 'id', `meeting_id=eq.${mid}`, inactive), []);
  stable = state();
  for (const [table, filter, body] of [
    ['team_meetings', `id=eq.${mid}`, { auto_absence_strikes_enabled: false }],
    ['team_attendance_strikes', `id=eq.${auto(mid, student)[0].id}`, { source: 'manual' }],
  ]) {
    await rejected(await localFetch(base, `/rest/v1/${table}?${filter}`, {
      method: 'PATCH', headers: { ...headers(manager), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), /permission denied/, '42501', 403);
    assert.equal(state(), stable, 'Even management sessions cannot directly rewrite strike provenance or meeting opt-in');
  }
  stable = state();
  for (const category of ['Unexcused Absence', '  unexcused absence  ']) {
    await rejected(await manual(mid, student, category), /automatic|absence|already|duplicate/i);
    assert.equal(state(), stable, 'Manual absence cannot duplicate an active automatic strike');
  }
  await json(await manage('strike', { meeting_id: mid, attendance_id: record(mid, student).id, category: 'Other',
    quantity: 1, explanation: 'Synthetic spoofed source and actor probe', source: 'automatic_absence', assigned_by: student.id,
  }, manager));
  const manualOther = strikes(mid, student).find(s => s.source === 'manual');
  assert(manualOther); assert.equal(manualOther.assigned_by, manager.id);
  await json(await change(mid, student, { physical_status: 'present' }));
  assert(auto(mid, student)[0].rescinded_at); assert.equal(auto(mid, student)[0].rescinded_by, manager.id);
  assert.deepEqual(strikes(mid, student).find(s => s.id === manualOther.id), manualOther);
  await json(await change(mid, other, { review_status: 'excused' }, coach));
  assert(auto(mid, other)[0].rescinded_at); assert.equal(auto(mid, other)[0].rescinded_by, coach.id);
  const rescindedAuto = auto(mid, student)[0];
  await json(await change(mid, student, { physical_status: 'absent' }));
  assert.deepEqual(auto(mid, student), [rescindedAuto], 'Correction back to absence must never reissue a rescinded automatic strike');
  await json(await manual(mid, student));
  assert.equal(strikes(mid, student).filter(s => s.category === 'Unexcused Absence' && !s.rescinded_at).length, 1, 'A human may explicitly replace a rescinded automatic strike');
  pass('real-session RLS hides other students; manual-before/after duplicate protection is distinct from other categories, correction/excuse rescinds only automatic strikes, and later corrections never recreate them');

  stable = state();
  for (const [subject, actor] of [[deferred, manager], [deferred, lead], [pm, pm], [pm, manager]]) {
    await rejected(await change(mid, subject, { review_status: 'denied' }, actor), /Lead Coach|Program Manager/, '42501', 403);
  }
  await rejected(await change(mid, deferred, { physical_status: 'absent', review_status: 'denied' }, pm), /physical attendance corrections/, '42501', 403);
  assert.equal(state(), stable);
  await json(await change(mid, deferred, { review_status: 'denied' }, pm));
  assert.equal(auto(mid, deferred).length, 1); assert.equal(auto(mid, deferred)[0].assigned_by, pm.id);
  await json(await change(mid, pm, { review_status: 'denied' }, coach));
  assert.equal(auto(mid, pm).length, 1); assert.equal(auto(mid, pm)[0].assigned_by, coach.id);
  const deferredStrike = auto(mid, deferred)[0];
  await json(await change(mid, deferred, { review_status: 'denied' }, pm));
  assert.deepEqual(auto(mid, deferred), [deferredStrike]);
  await json(await change(mid, deferred, { review_status: 'excused' }, pm));
  assert.equal(auto(mid, deferred)[0].rescinded_by, pm.id);
  pass('plain mentors/leads cannot decide requests, PMs cannot self-review or alter physical evidence, and only a non-PM Lead Coach decides PM requests; authorized denial creates once and later excuse rescinds');

  const manualResult = await json(await finalize(manualID, 1));
  assert.equal(manualResult.automatic_absence_strikes, 1);
  for (const actor of [student, other, pm, lead, optional]) assert.deepEqual(auto(manualID, actor), []);
  assert.deepEqual(strikes(manualID, student), [{ ...oldManual, source: 'manual' }]);
  assert.deepEqual(strikes(manualID, other), [{ ...rescindedManual, source: 'manual' }]);
  assert.equal(auto(manualID, deferred).length, 1);
  await json(await change(manualID, deferred, { physical_status: 'present' }));
  assert(auto(manualID, deferred)[0].rescinded_at);
  assert.deepEqual(strikes(manualID, deferred).find(s => s.id === otherCategory.id), { ...otherCategory, source: 'manual' });
  const historicalStrikes = fingerprint(['public.team_attendance_strikes'], `where meeting_id=${lit(historicID)}`);
  await json(await change(historicID, student, { review_status: 'denied' }, coach));
  await json(await change(historicID, other, { physical_status: 'present' }));
  await json(await change(historicID, other, { physical_status: 'absent' }));
  assert.equal(meeting(historicID).auto_absence_strikes_enabled, false);
  assert.equal(fingerprint(['public.team_attendance_strikes'], `where meeting_id=${lit(historicID)}`), historicalStrikes);
  pass('existing manual absences, including rescinded ones, block automatic duplication; late/early/non-required rows are excluded, other manual categories survive, and historical finalized corrections never backfill');

  // Force the production audit trigger to fail after strike insertion. The RPC
  // must roll back attendance, marker, strike, meeting version, and audit together.
  const rollbackID = await create('atomic audit and concurrent finalization', [student]);
  await close(rollbackID);
  stable = state();
  sql(`create function public.auto_absence_test_audit_failure() returns trigger language plpgsql as $$
    begin if new.meeting_id=${lit(rollbackID)} and new.entity='team_attendance_strikes' and new.action='INSERT' then
      raise exception 'Synthetic automatic strike audit failure';end if;return new;end$$;
    create trigger auto_absence_test_audit_failure before insert on public.team_attendance_history
    for each row execute function public.auto_absence_test_audit_failure();`);
  try {
    await rejected(await finalize(rollbackID, 1), /Synthetic automatic strike audit failure/);
    assert.equal(state(), stable);
  } finally {
    sql('drop trigger auto_absence_test_audit_failure on public.team_attendance_history;drop function public.auto_absence_test_audit_failure();');
  }
  const version = meeting(rollbackID).version;
  const responses = await Promise.all([manager, admin].map(actor => finalize(rollbackID, 1, actor, { version })));
  assert.equal(responses.filter(r => r.ok).length, 1);
  const winner = responses.findIndex(r => r.ok);
  assert.equal((await json(responses[winner])).automatic_absence_strikes, 1);
  await rejected(responses[1 - winner], /Meeting changed|finalized/);
  assert.equal(auto(rollbackID, student).length, 1); assert.equal(auto(rollbackID, student)[0].assigned_by, [manager, admin][winner].id);
  for (const actor of [lead, admin]) {
    const id = await create('active manager zero-count confirmation', [student], -120, -60, actor);
    await json(await change(id, student, { physical_status: 'present' }, actor));
    await close(id, actor);
    assert.equal((await json(await finalize(id, 0, actor))).automatic_absence_strikes, 0);
    assert.equal(meeting(id).auto_absence_strikes_enabled, true); assert.deepEqual(strikes(id, student), []);
  }
  assert.equal(fingerprint(unrelatedTables), unrelatedBefore, 'No profile, position, membership, or other-app changes are allowed');
  assert.equal(policyHistory(), policyHistoryBefore, 'No warning, parent-contact, or removal automation');
  assert.equal(sql('select count(*) from public.team_attendance_history where performed_by is null'), '0');
  assert.deepEqual(query("select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='team_attendance_history'"), auditColumns);
  assert.equal(policies(), policyBefore); assert.deepEqual(definitions(), helperBefore);
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('forced production-audit failure rolls everything back; competing real sessions commit once; active lead/admin zero-count finalization works; no warnings, membership changes, unrelated writes, or fabricated audit actors');
  return checks;
}
