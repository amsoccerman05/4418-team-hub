// Runs LAST in fabrication-local.mjs's OWNED disposable stack. Real Auth sessions
// and PostgREST only; no hosted URL, service-role API, forged JWT, or mock auth.uid.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';

export const attendanceActiveRosterSources = [
  'supabase/migrations/20261008234849_attendance_active_meeting_roster_sync.sql',
  'tests/integration/attendance-active-roster-stack.spec.mjs',
];
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const auditColumns = ['id', 'meeting_id', 'student_id', 'entity', 'entity_id', 'action', 'before_data', 'after_data', 'performed_by', 'performed_at'];
const attendanceTables = ['public.team_meetings', 'public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_strikes', 'public.team_attendance_history'];

export async function runAttendanceActiveRosterIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql("select to_regprocedure('public.team_attendance_sync_participant_rosters(uuid,uuid[])') is not null"), 't', 'Run after the owned Attendance fixtures');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  const checks = [];
  const pass = label => { const message = `Active Attendance roster: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response) {
    const body = await response.json();
    assert.equal(response.status, 200, `Active roster HTTP ${response.status}; code=${body?.code || body?.error_code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function rejected(response, message, code = 'P0001', status = 400) {
    const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, code); assert.match(body.message, message);
  }
  const read = (table, select, filter, actor) => localFetch(base, `/rest/v1/${table}?select=${select}&${filter}`, { headers: headers(actor) }).then(json);
  const fingerprint = (tables, where = '') => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t ${where})`
  ).join(',')})`)).digest('hex');
  const state = () => fingerprint(attendanceTables);
  const query = q => JSON.parse(sql(q));
  const bulk = actor => rpc('team_attendance_sync_future_rosters', {}, actor);
  const scoped = (actor, student, meetings) => rpc('team_attendance_sync_participant_rosters', { student_id: student.id, meeting_ids: meetings }, actor);

  // Convert ONLY this disposable fixture after all earlier suites have completed.
  // Earlier fixtures allow owner-without-Auth audit records. Reset their synthetic
  // audit rows at this boundary rather than fabricate actors or loosen NOT NULL.
  // All business records, Auth, RLS, and subsequent real-session actors survive.
  // This setup is NOT part of the production migration.
  const businessTables = attendanceTables.filter(table => table !== 'public.team_attendance_history');
  const businessBefore = fingerprint(businessTables);
  sql(`begin;
    truncate public.team_attendance_history;
    drop trigger team_history_actor on public.team_attendance_history;
    alter table public.team_attendance_history drop column actor_auth_uid, drop column actor_database_session,
      drop column actor_database_role, alter column performed_by set not null;
    commit;`);
  assert.equal(fingerprint(businessTables), businessBefore, 'Fixture conversion must preserve business records');
  assert.equal(sql('select count(*) from public.team_attendance_history'), '0');
  assert.deepEqual(query("select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='team_attendance_history'"), auditColumns);
  assert.equal(sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='team_attendance_history' and column_name='performed_by'"), 'NO');
  pass('finished prior suites before resetting only their synthetic audit history; new checks use production ten-column NOT NULL attribution with unchanged Auth and business records');

  async function signup(name, role, active = true) {
    const email = `active-roster-${name}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    // Deliberately untrusted metadata must not override the shared profile.
    const created = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true } }));
    assert(created.user?.id && created.access_token, 'Real Auth signup must issue a session');
    registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, created.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Active Roster ${name}`)},${lit(role)},${active});`);
    return actor;
  }
  const manager = await signup('manager', 'mentor');
  const manage = (action, p) => rpc('team_attendance_manage', { action, p }, manager).then(json);
  const create = async (title, start = -20, end = 180) => (await manage('create', {
    title: `Synthetic active roster ${title}`, meeting_type: 'preseason', requirement: 'active',
    starts_at: future(start), ends_at: future(end),
  })).id;
  const version = mid => Number(sql(`select version from public.team_meetings where id=${lit(mid)}`));
  const scopedID = await create('scoped'), bulkID = await create('bulk'), draftID = await create('draft');
  const scopedOpening = await manage('open', { meeting_id: scopedID, version: version(scopedID) });
  const bulkOpening = await manage('open', { meeting_id: bulkID, version: version(bulkID) });
  const closedID = await create('closed');
  await manage('close', { meeting_id: closedID, version: version(closedID) });
  const endedID = await create('ended', -180, -60);
  const finalizedID = await create('finalized', -180, -60);
  await manage('close', { meeting_id: finalizedID, version: version(finalizedID) });
  await manage('finalize', { meeting_id: finalizedID, version: version(finalizedID) });
  // Both new accounts are created AFTER the already-started meetings and their
  // snapshots. Use the same real sessions before and after the leadership repair.
  const student = await signup('student', 'student'), other = await signup('other', 'student');
  const inactive = await signup('inactive', 'student', false);
  const visible = (mid, actor) => read('team_meetings', 'id,status', `id=eq.${mid}`, actor);
  const own = (mid, actor) => read('team_attendance', 'id,student_id,physical_status,review_status,checked_in_at,left_at,version', `meeting_id=eq.${mid}`, actor);
  for (const actor of [student, other]) for (const mid of [scopedID, bulkID, draftID]) {
    assert.deepEqual(await visible(mid, actor), []);
    assert.deepEqual(await own(mid, actor), []);
  }
  await rejected(await rpc('team_attendance_check_in', { meeting_id: scopedID, code: scopedOpening.code }, student), /not on this meeting roster/);
  await rejected(await scoped(manager, student, [scopedID]), /Only future/);

  const unchangedFunctions = [
    'auth.uid()', 'team_attendance_private.manager()', 'team_attendance_private.reader()',
    'team_attendance_private.participant()', 'team_attendance_private.can_review_request(uuid,uuid)',
    'public.team_attendance_check_in(uuid,text)', 'public.team_attendance_check_out(uuid)',
    'public.team_attendance_request(jsonb)', 'public.team_attendance_sync_participant_rosters(uuid,uuid[])',
  ];
  const definitions = () => unchangedFunctions.map(name => sql(`select pg_get_functiondef(${lit(name)}::regprocedure)`));
  const definitionsBefore = definitions();
  const policies = () => fingerprint(['pg_catalog.pg_policies'], "where schemaname in ('public','team_attendance_private')");
  const policyBefore = policies(), migrationBefore = state();
  sql(readFileSync(new URL(`../../${attendanceActiveRosterSources[0]}`, import.meta.url), 'utf8'));
  sql("notify pgrst, 'reload schema';");
  assert.equal(state(), migrationBefore, 'Applying the migration must not backfill or rewrite data');
  assert.equal(policies(), policyBefore); assert.deepEqual(definitions(), definitionsBefore);
  assert.deepEqual(await visible(scopedID, student), [], 'Leadership must explicitly sync');
  pass('real signup/login reproduces missing started-meeting visibility; additive migration preserves data, RLS, Auth, check-in, and request/reviewer helpers');

  const unrelatedTables = sql(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
    and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','assembly_private','volunteer_private')
    and not (n.nspname='public' and c.relname in ('team_meetings','team_meeting_members','team_attendance','team_attendance_history'))
    order by 1`).split('\n').filter(Boolean);
  const unrelatedBefore = fingerprint(unrelatedTables), deniedBefore = state();
  for (const actor of [student, other, inactive]) {
    await rejected(await bulk(actor), /Leadership access required/, '42501', 403);
    await rejected(await scoped(actor, student, [scopedID]), /Leadership access required/, '42501', 403);
  }
  await rejected(await bulk(null), /permission denied/, '42501', 401);
  await rejected(await scoped(null, student, [scopedID]), /permission denied/, '42501', 401);
  await rejected(await scoped(manager, inactive, [scopedID]), /Active Attendance participant required/, '42501', 403);
  for (const mid of [closedID, endedID, finalizedID]) {
    // Mixed targets must fail atomically, including when a valid one comes first.
    await rejected(await scoped(manager, student, [scopedID, mid]), /Only future or in-progress draft\/open/);
  }
  // SQL-owner execution without an Auth session must not bypass actor checks.
  assert.equal(sql('select auth.uid() is null'), 't');
  for (const call of [
    'public.team_attendance_sync_future_rosters()',
    `public.team_attendance_sync_participant_rosters(${lit(student.id)}::uuid,array[${lit(scopedID)}::uuid])`,
    `team_attendance_private.sync_participant_rosters(${lit(student.id)}::uuid,array[${lit(scopedID)}::uuid])`,
  ]) sql(`do $$ begin
    begin perform ${call}; raise exception 'Unexpected owner-without-Auth success';
    exception when insufficient_privilege then
      if sqlerrm<>'Leadership access required' then raise;end if;
    end;
  end $$;`);
  assert.equal(state(), deniedBefore);
  pass('student, inactive, anonymous, and SQL-owner-without-Auth syncs are denied; closed/ended/finalized mixed targets roll back without audit writes');

  const scopedResult = await json(await scoped(manager, student, [scopedID]));
  assert.deepEqual(scopedResult, { student_id: student.id, meeting_ids: [scopedID], added: 1, promoted: 0, skipped: 0 });
  assert.equal((await visible(scopedID, student)).length, 1);
  assert.deepEqual(await visible(scopedID, other), []);
  assert.deepEqual(await visible(bulkID, student), []);
  assert.deepEqual(await read('team_meeting_members', 'student_id,required', `meeting_id=eq.${scopedID}`, student), [{ student_id: student.id, required: true }]);
  let stable = state();
  assert.deepEqual(await json(await scoped(manager, student, [scopedID])), { ...scopedResult, added: 0 });
  assert.equal(state(), stable, 'Repeat scoped sync must be a true no-op including audit');
  pass('authenticated scoped repair restores only the selected student/meeting; repeat sync is idempotent');

  async function checkIn(mid, code, actor) {
    const otherAttendance = fingerprint(['public.team_attendance'], `where not (meeting_id=${lit(mid)} and student_id=${lit(actor.id)})`);
    const wrongCode = code === '000000' ? '999999' : '000000';
    assert.deepEqual(await json(await rpc('team_attendance_check_in', { meeting_id: mid, code: wrongCode }, actor)), { error: 'Invalid meeting code' });
    assert.deepEqual(await json(await rpc('team_attendance_check_in', { meeting_id: mid, code }, actor)), { message: 'Checked in' });
    const records = await own(mid, actor);
    assert.equal(records.length, 1);
    assert.equal(records[0].student_id, actor.id); assert.equal(records[0].physical_status, 'late');
    assert.equal(records[0].review_status, 'none'); assert.equal(records[0].version, 2);
    assert(records[0].checked_in_at); assert.equal(records[0].left_at, null);
    const checked = state();
    assert.deepEqual(await json(await rpc('team_attendance_check_in', { meeting_id: mid, code }, actor)), { message: 'Attendance already recorded' });
    assert.equal(state(), checked, 'Repeat check-in must not rewrite records or audit');
    assert.equal(fingerprint(['public.team_attendance'], `where not (meeting_id=${lit(mid)} and student_id=${lit(actor.id)})`), otherAttendance);
    const audit = query(`select to_jsonb(h) from public.team_attendance_history h where entity='team_attendance' and entity_id=${lit(records[0].id)} and action='UPDATE' order by id desc limit 1`);
    assert.equal(audit.performed_by, actor.id); assert.equal(audit.student_id, actor.id);
  }
  await checkIn(scopedID, scopedOpening.code, student);
  const checkedBeforeBulk = await own(scopedID, student);
  const excludedBefore = fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id in (${[closedID, endedID, finalizedID].map(lit).join(',')})`);
  const expectedAdded = Number(sql(`select count(*) from public.team_meetings m cross join public.profiles p
    left join public.team_attendance_members r on r.student_id=p.id
    where m.ends_at>clock_timestamp() and m.status in ('draft','open') and m.requirement in ('active','registered')
    and team_attendance_private.is_participant(p.id) and coalesce(r.member_status,'prospective')<>'inactive'
    and (m.requirement='active' or r.member_status='registered')
    and not exists(select 1 from public.team_meeting_members mm where mm.meeting_id=m.id and mm.student_id=p.id)`));
  const bulkResult = await json(await bulk(manager));
  assert.equal(bulkResult.added, expectedAdded); assert(expectedAdded >= 5);
  assert.deepEqual(await own(scopedID, student), checkedBeforeBulk, 'Bulk sync must preserve an existing late check-in');
  for (const actor of [student, other]) for (const mid of [scopedID, bulkID, draftID]) {
    assert.equal((await visible(mid, actor)).length, 1);
    const roster = await read('team_meeting_members', 'student_id,required', `meeting_id=eq.${mid}`, actor);
    assert.deepEqual(roster, [{ student_id: actor.id, required: true }], 'Student RLS must expose only the authenticated subject');
    assert.equal((await own(mid, actor)).length, 1);
  }
  stable = state();
  const repeatBulk = await json(await bulk(manager));
  assert.equal(repeatBulk.added, 0); assert.equal(repeatBulk.promoted, 0);
  assert.equal(repeatBulk.skipped, bulkResult.skipped, 'Previously touched optional rows may remain skipped');
  assert.equal(state(), stable, 'Repeat bulk sync must not write audit or attendance');
  assert.equal(fingerprint(['public.team_meeting_members', 'public.team_attendance', 'public.team_attendance_history'], `where meeting_id in (${[closedID, endedID, finalizedID].map(lit).join(',')})`), excludedBefore);
  for (const actor of [student, other]) for (const mid of [closedID, endedID, finalizedID]) assert.deepEqual(await visible(mid, actor), []);
  assert.deepEqual(await visible(bulkID, inactive), []);
  await checkIn(bulkID, bulkOpening.code, other);
  assert.equal((await own(bulkID, student))[0].checked_in_at, null);
  assert.deepEqual(await read('team_attendance', 'student_id', `meeting_id=eq.${bulkID}&student_id=eq.${other.id}`, student), []);
  const syncActors = query(`select coalesce(jsonb_agg(distinct performed_by),'[]') from public.team_attendance_history
    where student_id in (${lit(student.id)},${lit(other.id)}) and action='ROSTER_SYNC_ADD'`);
  assert.deepEqual(syncActors, [manager.id]);
  assert.equal(fingerprint(unrelatedTables), unrelatedBefore, 'Sync/check-in must not change profiles, positions, strikes, membership, or other apps');
  assert.deepEqual(definitions(), definitionsBefore); assert.equal(policies(), policyBefore);
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  pass('bulk repair includes ongoing open/draft meetings and excludes closed/ended/finalized/inactive targets; own late check-in, code validation, identity isolation, repeat idempotency, and production audit attribution hold');
  return checks;
}
