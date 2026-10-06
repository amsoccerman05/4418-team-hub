// Real Auth/PostgREST integration, invoked only inside the owned disposable stack.
// All identities and file bytes come from fabrication-stack.spec.mjs. No hosted
// endpoints, saved credentials, auth.uid replacements, or fake HTTP services.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localFetch, ORIGIN } from './fabrication-safety.mjs';
// Node 24 strips the type-only imports. Exercise the browser's actual contract,
// rather than maintaining an integration-only approximation of its validation.
import { assertAssemblyContext, readinessFacts, snapshotText } from '../../src/planning/assembly/model.ts';

const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const privateTables = ['boards', 'components', 'task_links', 'checks', 'snapshots', 'requests', 'history'];
const safeErrors = {
  AS401: 'Your account changed. Reload Assembly & Testing before continuing.',
  AS403: 'This Assembly & Testing action is unavailable for your current access.',
  AS409: 'Changed by another teammate. Refresh before continuing.',
  AS412: 'This request ID was already used for a different change.',
  AS422: 'Invalid Assembly & Testing request. Check the fields.',
};
const canonicalTables = [
  'public.profiles', 'public.areas', 'public.team_positions', 'public.team_member_positions',
  'public.planning_seasons', 'public.planning_groups', 'public.planning_boards', 'public.planning_items',
  'public.planning_tasks', 'public.planning_steps', 'public.planning_comments',
  'public.planning_task_dependencies', 'public.planning_task_assignees', 'planning_private.history',
  'public.planning_sprint_reviews', 'public.planning_sprint_review_updates',
  'public.planning_project_review_assignments', 'public.planning_project_review_supporters',
  'planning_review_private.requests', 'planning_review_private.history',
  'public.fabrication_parts', 'public.fabrication_revisions', 'fabrication_private.settings',
  'fabrication_private.requests', 'fabrication_private.reservations', 'fabrication_private.history',
  'storage.buckets', 'storage.objects',
];

export async function runAssemblyIntegration({ base, anonKey, sql, gate, waitFor, users, season, foreignBoard, foreignRevision, upload, submission }) {
  const checks = [];
  const pass = label => { const message = `Assembly: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  // Both assigned writers are ordinary students; the unassigned actor has the
  // legacy global "lead" role, which must not grant this project's edit access.
  const { mentor, lead, operator: supporter, supporter: unassigned, reader, inactive } = users;
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const rpc = (name, body, actor = lead) => localFetch(base, `/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  async function json(response, expected = 200) {
    const body = await response.json();
    assert.equal(response.status, expected, `Assembly HTTP ${response.status}; code=${body?.code || body?.error_code || 'unspecified'}`);
    return body;
  }
  // Custom ASxxx SQLSTATEs are PostgreSQL errors, mapped to HTTP 400 by
  // PostgREST. Assert the exact application code, not a fabricated HTTP 409.
  async function rejected(response, code) {
    const body = await json(response, 400);
    assert.equal(body.code, code); assert(Object.hasOwn(safeErrors, code)); assert.equal(body.message, safeErrors[code]);
    for (const field of ['details', 'hint']) assert(body[field] === '' || body[field] === null, `Unsanitized Assembly error ${field}`);
    return body;
  }
  async function denied(response, statuses = [401, 403, 404]) {
    const body = await response.text();
    assert(statuses.includes(response.status), `Expected Assembly denial, HTTP ${response.status}: ${body}`);
  }
  const count = (table, where = 'true') => Number(sql(`select count(*) from ${table} where ${where}`));
  // Every row is sorted as JSON; detect even timestamp/version/audit changes.
  // These fingerprints never include Auth credentials or sessions.
  const canonical = () => createHash('sha256').update(sql(`select jsonb_build_object(${canonicalTables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t)`
  ).join(',')})`)).digest('hex');
  const planning = async (entity, p) => json(await rpc('planning_save', { entity, p }, mentor));
  const review = async (action, p, actor = mentor) => json(await rpc('sprint_review_save', { action, request_id: randomUUID(), expected_actor: actor.id, p }, actor));
  const board = randomUUID(), task = randomUUID(), doneTask = randomUUID(), foreignTask = randomUUID();
  assert.equal(await planning('board', { id: board, season_id: season, kind: 'project', name: 'Synthetic Assembly integration project' }), board);
  assert.equal((await review('assignment', { board_id: board, lead_id: lead.id, supporter_ids: [supporter.id], version: null })).status, 'applied');
  assert.equal(await planning('task', { id: task, board_id: board, title: 'Synthetic canonical rework', status: 'blocked', priority: 'high', blocked_reason: 'Synthetic mount interference', owner_ids: [lead.id, supporter.id] }), task);
  assert.equal(await planning('task', { id: doneTask, board_id: board, title: 'Synthetic completed bench setup', status: 'done', priority: 'normal', owner_ids: [supporter.id] }), doneTask);
  assert.equal(await planning('task', { id: foreignTask, board_id: foreignBoard, title: 'Synthetic other-project task', status: 'todo', priority: 'normal', owner_ids: [] }), foreignTask);
  const reviewID = randomUUID(), updateID = randomUUID();
  assert.equal((await review('review', { id: reviewID, season_id: season, title: 'Synthetic Assembly review', review_date: '2026-10-06', chair_id: mentor.id, agenda: [], version: null })).status, 'applied');
  assert.equal((await review('update', {
    id: updateID, review_id: reviewID, board_id: board, progress: 'Synthetic unchanged progress', blockers: 'Synthetic unchanged blocker',
    evidence: [], tradeoffs: '', decisions_needed: '', decision_references: [], reported_decision: '', decision_rationale: '',
    reported_by_student_ids: [lead.id], next_test: 'Synthetic repeat test', linked_task_id: task, carry_from_update_id: null, unresolved: true, version: null,
  }, lead)).status, 'applied');
  const firstRevision = submission(board);
  assert.equal((await json(await upload(firstRevision, randomUUID(), lead))).status, 'applied');
  assert.equal(sql(`select bool_and(role='student') from public.profiles where id in (${lit(lead.id)},${lit(supporter.id)})`), 't');
  pass('synthetic project, student assignments, canonical tasks/review, and real uploaded revision created through their own authenticated RPCs');

  const context = async (actor = lead) => {
    const c = assertAssemblyContext(await json(await rpc('assembly_context', { board_id: board, expected_actor: actor.id }, actor)), actor.id, board);
    assert.deepEqual(c.facts, readinessFacts(c));
    return c;
  };
  const mutate = (action, p, actor = lead, key = randomUUID(), expectedActor = actor.id) => rpc('assembly_mutate', { action, request_id: key, expected_actor: expectedActor, p }, actor);
  const receipt = async (key, actor = lead, cancel = false) => json(await rpc(cancel ? 'assembly_cancel_mutation' : 'assembly_mutation_status', { request_id: key, expected_actor: actor.id }, actor));
  const payload = (fields, version) => ({ board_id: board, version, ...fields });
  const component = { id: randomUUID(), name: 'Synthetic flanged bearings', quantity: 2, status: 'needed', notes: 'Synthetic integration only' };
  let unchanged = canonical();
  const initialContext = await context();
  assert.equal(initialContext.version, 0); assert.equal(initialContext.can_edit, true);
  assert.deepEqual(initialContext.components, []); assert.deepEqual(initialContext.checks, []); assert.deepEqual(initialContext.snapshots, []); assert.deepEqual(initialContext.linked_task_ids, []);
  assert.equal(initialContext.parts[0].current_revision_id, firstRevision.revision_id); assert.equal(initialContext.revisions.length, 1);
  assert.equal(initialContext.tasks.length, 2); assert.equal(initialContext.tasks.find(t => t.id === task).blocked_reason, 'Synthetic mount interference');
  assert.deepEqual(new Set(initialContext.tasks.find(t => t.id === task).owner_ids), new Set([lead.id, supporter.id]));
  assert.deepEqual(initialContext.facts, { parts_total: 1, parts_done: 0, components_total: 0, components_available: 0, tasks_total: 0, tasks_done: 0, tasks_blocked: 0, checks_total: 0, checks_passed: 0, checks_failed: 0, checks_blocked: 0, checks_stale: 0 });
  for (const actor of [mentor, supporter]) assert.equal((await context(actor)).can_edit, true);
  for (const actor of [reader, unassigned]) {
    assert.equal((await context(actor)).can_edit, false);
    await rejected(await mutate('component', payload(component, 0), actor), 'AS403');
  }
  await rejected(await rpc('assembly_context', { board_id: board, expected_actor: inactive.id }, inactive), 'AS401');
  await rejected(await mutate('component', payload(component, 0), inactive), 'AS401');
  await rejected(await mutate('component', payload(component, 0), lead, randomUUID(), mentor.id), 'AS401');
  await rejected(await rpc('assembly_context', { board_id: board, expected_actor: mentor.id }, lead), 'AS401');
  for (const [name, body] of [
    ['assembly_context', { board_id: board, expected_actor: lead.id }],
    ['assembly_mutate', { action: 'component', request_id: randomUUID(), expected_actor: lead.id, p: payload(component, 0) }],
    ['assembly_mutation_status', { request_id: randomUUID(), expected_actor: lead.id }],
    ['assembly_cancel_mutation', { request_id: randomUUID(), expected_actor: lead.id }],
  ]) await denied(await rpc(name, body, null));
  assert.equal(count('assembly_private.requests'), 0); assert.equal(count('assembly_private.history'), 0);
  assert.equal(canonical(), unchanged, 'Assembly reads/denials changed canonical data');
  pass('real JWT context satisfies the browser contract; readonly, unassigned, inactive, actor mismatch, and anonymous access fail closed');

  const firstKey = randomUUID(), firstPayload = payload(component, 0);
  const releaseReplay = await gate(); let duplicateRequests;
  try {
    duplicateRequests = Promise.all([mutate('component', firstPayload, lead, firstKey), mutate('component', firstPayload, lead, firstKey)]);
    await waitFor(() => count('pg_stat_activity', "pid<>pg_backend_pid() and wait_event='advisory' and query like '%assembly_mutate%'") >= 2, 'two Assembly HTTP mutations at the real authority lock');
  } finally { await releaseReplay(); }
  const duplicates = await duplicateRequests;
  const firstReceipt = await json(duplicates[0]);
  assert.deepEqual(firstReceipt, { request_id: firstKey, status: 'applied', action: 'component', entity_id: component.id, version: 1 });
  assert.deepEqual(await json(duplicates[1]), firstReceipt);
  assert.deepEqual(await json(await mutate('component', firstPayload, lead, firstKey)), firstReceipt);
  assert.deepEqual(await receipt(firstKey), firstReceipt); assert.deepEqual(await receipt(firstKey, lead, true), firstReceipt);
  assert.deepEqual(await receipt(firstKey, supporter), { request_id: firstKey, status: 'unknown', action: null, entity_id: null, version: null });
  await rejected(await mutate('component', { ...firstPayload, name: 'Changed same request' }, lead, firstKey), 'AS412');
  const staleKey = randomUUID();
  await rejected(await mutate('component', payload({ ...component, id: randomUUID() }, 0), supporter, staleKey), 'AS409');
  assert.equal((await receipt(staleKey, supporter)).status, 'unknown');
  assert.equal(count('assembly_private.history', `request_id=${lit(firstKey)}`), 1);
  assert.equal(count('assembly_private.requests', `request_id=${lit(firstKey)}`), 1);
  assert.equal((await json(await mutate('component', payload({ ...component, status: 'installed' }, 1), supporter))).version, 2);
  const secondComponent = { ...component, id: randomUUID(), name: 'Synthetic spare bracket' };
  assert.equal((await json(await mutate('component', payload(secondComponent, 2), supporter))).version, 3);
  const components = (await context()).components;
  assert.equal(components.find(c => c.id === component.id).created_by, lead.id);
  assert.equal(components.find(c => c.id === component.id).status, 'installed');
  assert.equal(components.find(c => c.id === secondComponent.id).created_by, supporter.id);
  assert.equal(canonical(), unchanged, 'Assembly component operations changed canonical data');
  pass('student lead/supporter component writes, simultaneous same-key replay, actor-specific receipts, stale rejection, and single audit are real HTTP transactions');

  assert.equal((await json(await mutate('task_link', payload({ task_id: task, linked: true }, 3)))).version, 4);
  assert.equal((await json(await mutate('task_link', payload({ task_id: doneTask, linked: true }, 4), supporter))).version, 5);
  await rejected(await mutate('task_link', payload({ task_id: foreignTask, linked: true }, 5)), 'AS403');
  const linked = await context();
  assert.deepEqual(new Set(linked.linked_task_ids), new Set([task, doneTask]));
  assert.equal(linked.facts.tasks_total, 2); assert.equal(linked.facts.tasks_done, 1); assert.equal(linked.facts.tasks_blocked, 1);
  assert.equal(canonical(), unchanged, 'Assembly task links modified canonical Planning data');
  pass('task links retain canonical owners, status and blockers; cross-project linking is denied without editing Planning');

  const check = (fields = {}) => ({ id: randomUUID(), title: 'Synthetic exact-revision bench fit', kind: 'fit', outcome: 'failed', procedure: 'Dry fit the synthetic mount', expected: 'No interference', observed: 'Synthetic interference measured', evidence_url: 'https://example.invalid/synthetic-evidence', revision_id: firstRevision.revision_id, rework_task_id: task, supersedes_id: null, ...fields });
  const failed = check();
  assert.equal((await json(await mutate('check', payload(failed, 5)))).version, 6);
  const immutableFirstCheck = (await context()).checks.find(c => c.id === failed.id);
  assert.equal(immutableFirstCheck.revision_id, firstRevision.revision_id); assert.equal(immutableFirstCheck.rework_task_id, task);
  await rejected(await mutate('check', payload({ ...failed, observed: 'Attempted overwrite' }, 6)), 'AS409');
  await rejected(await mutate('check', payload(check({ revision_id: foreignRevision }), 6)), 'AS403');
  await rejected(await mutate('check', payload(check({ rework_task_id: foreignTask }), 6)), 'AS422');
  await rejected(await mutate('check', payload(check({ outcome: 'passed' }), 6)), 'AS422');
  assert.equal(canonical(), unchanged, 'Assembly failed check/rework changed canonical data');

  // A new revision is created by the unchanged real Edge/Storage upload path.
  // It is an explicit canonical fixture change, outside the no-write assertion.
  const nextRevision = submission(board, firstRevision.part_id, randomUUID(), 1);
  assert.equal((await json(await upload(nextRevision, randomUUID(), lead))).version, 2);
  unchanged = canonical();
  const stale = await context();
  assert.equal(stale.parts[0].current_revision_id, nextRevision.revision_id); assert.equal(stale.parts[0].revision_number, 2);
  assert.equal(stale.revisions.length, 2); assert.equal(stale.facts.checks_stale, 1); assert.equal(stale.facts.checks_failed, 0);
  assert.deepEqual(stale.checks.find(c => c.id === failed.id), immutableFirstCheck);
  const historicalPass = check({ outcome: 'passed', observed: 'Synthetic historical retest', rework_task_id: null, supersedes_id: failed.id });
  assert.equal((await json(await mutate('check', payload(historicalPass, 6), supporter))).version, 7);
  const currentFailed = check({ revision_id: nextRevision.revision_id });
  assert.equal((await json(await mutate('check', payload(currentFailed, 7)))).version, 8);
  await rejected(await mutate('check', payload(check({ revision_id: nextRevision.revision_id, supersedes_id: historicalPass.id }), 8)), 'AS409');
  const currentPass = check({ revision_id: nextRevision.revision_id, outcome: 'passed', observed: 'Synthetic current retest passed', rework_task_id: null, supersedes_id: currentFailed.id });
  assert.equal((await json(await mutate('check', payload(currentPass, 8), supporter))).version, 9);
  await rejected(await mutate('check', payload(check({ supersedes_id: failed.id }), 9)), 'AS409');
  const current = await context();
  assert.equal(current.checks.length, 4); assert.deepEqual(current.checks.find(c => c.id === failed.id), immutableFirstCheck);
  assert.deepEqual(current.facts, { parts_total: 1, parts_done: 0, components_total: 2, components_available: 1, tasks_total: 2, tasks_done: 1, tasks_blocked: 1, checks_total: 2, checks_passed: 1, checks_failed: 0, checks_blocked: 0, checks_stale: 1 });
  assert.equal(canonical(), unchanged, 'Assembly retest/supersession changed canonical data');
  pass('checks/rework bind to immutable revision IDs; real new uploads stale historical checks and same-subject retests preserve all prior observations');

  const snapshotID = randomUUID(), snapshotKey = randomUUID(), snapshotPayload = payload({ id: snapshotID, notes: 'Synthetic review snapshot only' }, 9);
  const snapshotReceipt = await json(await mutate('snapshot', snapshotPayload, lead, snapshotKey));
  assert.equal(snapshotReceipt.version, 10);
  assert.deepEqual(await json(await mutate('snapshot', snapshotPayload, lead, snapshotKey)), snapshotReceipt);
  const captured = (await context()).snapshots[0];
  assert.equal(captured.id, snapshotID); assert.equal(captured.board_id, board); assert.equal(captured.created_by, lead.id);
  assert(Number.isFinite(Date.parse(captured.created_at))); assert.deepEqual(captured.facts, current.facts);
  const capturedUTC = new Date(captured.created_at).toISOString().slice(0, 19).replace('T', ' ');
  for (const text of [`Snapshot ID: ${snapshotID}`, `Captured ${capturedUTC} UTC`, 'Fabricated parts done: 0/1', 'Components received or installed: 1/2', 'Linked tasks done: 1/2; blocked: 1', 'Latest checks: 2; current passed: 1; failed: 0; blocked: 0; historical revision: 1', 'Readiness counts summarize records, not an approval or readiness certification.', 'Synthetic review snapshot only']) assert(captured.summary.includes(text), `Missing captured summary: ${text}`);
  assert(snapshotText(captured).includes(snapshotID));
  assert.equal(count('assembly_private.snapshots', `id=${lit(snapshotID)}`), 1);
  assert.equal(count('assembly_private.history', `request_id=${lit(snapshotKey)}`), 1);
  assert.equal((await json(await mutate('component', payload(component, 10), supporter))).version, 11);
  const later = await context(); assert.equal(later.facts.components_available, 0); assert.deepEqual(later.snapshots[0], captured);
  await rejected(await mutate('snapshot', payload({ id: snapshotID, notes: 'Overwrite attempt' }, 11)), 'AS409');
  assert.equal(canonical(), unchanged, 'Assembly snapshot changed canonical data');
  pass('server snapshots preserve exact current counts, timestamp and ID; repeated capture is idempotent and later edits cannot rewrite captured facts or Sprint Review');

  const cancelledKey = randomUUID();
  assert.deepEqual(await receipt(cancelledKey, supporter, true), { request_id: cancelledKey, status: 'cancelled', action: null, entity_id: null, version: null });
  assert.equal((await json(await mutate('component', payload({ ...component, id: randomUUID() }, 11), supporter, cancelledKey))).status, 'cancelled');
  assert.equal((await receipt(cancelledKey, lead)).status, 'unknown'); assert.equal((await context()).version, 11);
  // Current authority rows must override already issued Auth JWTs, including
  // replay. Restore every controlled change even when its assertion fails.
  try {
    sql(`update public.profiles set role='readonly' where id=${lit(lead.id)}`);
    assert.equal((await context()).can_edit, false);
    await rejected(await mutate('component', firstPayload, lead, firstKey), 'AS403');
    assert.deepEqual(await receipt(firstKey), firstReceipt);
    sql(`update public.profiles set role='student',active=false where id=${lit(lead.id)}`);
    await rejected(await rpc('assembly_context', { board_id: board, expected_actor: lead.id }), 'AS401');
    await rejected(await rpc('assembly_mutation_status', { request_id: firstKey, expected_actor: lead.id }), 'AS401');
  } finally { sql(`update public.profiles set role='student',active=true where id=${lit(lead.id)}`); }
  try {
    sql(`update public.planning_project_review_assignments set lead_id=${lit(unassigned.id)} where board_id=${lit(board)}`);
    assert.equal((await context()).can_edit, false);
    await rejected(await mutate('component', firstPayload, lead, firstKey), 'AS403');
  } finally { sql(`update public.planning_project_review_assignments set lead_id=${lit(lead.id)} where board_id=${lit(board)}`); }
  try {
    sql(`update public.planning_seasons set status='archived' where id=${lit(season)}`);
    await rejected(await rpc('assembly_context', { board_id: board, expected_actor: lead.id }), 'AS403');
    assert.equal((await context(mentor)).can_edit, false);
    await rejected(await mutate('component', payload(component, 11), mentor), 'AS403');
  } finally { sql(`update public.planning_seasons set status='active' where id=${lit(season)}`); }
  assert.equal(canonical(), unchanged, 'Controlled authority changes were not restored');
  pass('terminal cancellation and same-JWT role, inactive, assignment and archive checks preserve actor-specific outcomes');

  for (const actor of [null, lead, reader]) {
    for (const table of privateTables) {
      // A private schema is not exposed, even if its name is supplied explicitly.
      const response = await localFetch(base, `/rest/v1/${table}?select=*`, { headers: { ...headers(actor), 'Accept-Profile': 'assembly_private' } });
      assert.equal(response.status, 406); assert.equal((await response.json()).code, 'PGRST106');
    }
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await localFetch(base, '/rest/v1/components', { method, headers: { ...headers(actor), 'Content-Profile': 'assembly_private', 'Content-Type': 'application/json' }, ...(method === 'DELETE' ? {} : { body: JSON.stringify({ id: component.id, name: 'Forbidden direct write' }) }) });
      assert.equal(response.status, 406); assert.equal((await response.json()).code, 'PGRST106');
    }
  }
  const privilegeFailures = Number(sql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values('anon'),('authenticated'),('service_role')) roles(name)
    where n.nspname='assembly_private' and c.relkind='r' and (not c.relrowsecurity or has_schema_privilege(roles.name,n.oid,'USAGE') or has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))`));
  assert.equal(privilegeFailures, 0); assert.equal(count('pg_class c join pg_namespace n on n.oid=c.relnamespace', "n.nspname='assembly_private' and c.relkind='r'"), privateTables.length);
  assert.equal((await context()).version, 11); assert.equal(canonical(), unchanged, 'Denied direct access changed canonical data');
  assert.equal(count('assembly_private.history', `board_id=${lit(board)}`), 11);
  assert.equal(count('assembly_private.requests', `board_id=${lit(board)} and status='applied'`), 11);
  assert.equal(count('fabrication_private.reservations', 'not exists(select 1 from fabrication_private.requests q where q.actor_id=reservations.actor_id and q.request_id=reservations.request_id)'), 0);
  assert.equal(count('auth.users'), 6); assert.equal(count('pg_namespace', "nspname='fabrication_it'"), 0);
  pass('all seven private tables stay unexposed with zero client/service grants; canonical Planning, Reviews, Fabrication and Storage fingerprints are unchanged');
  return checks;
}
