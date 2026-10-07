// Real Auth/PostgREST regression coverage, run only by fabrication-local.mjs in
// its owned disposable stack. No hosted URLs, forged JWTs, or auth.uid mocks.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localFetch, ORIGIN } from './fabrication-safety.mjs';

const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const safeErrors = {
  SR401: 'Your account changed. Reload Sprint Review before continuing.',
  SR403: 'This Sprint Review action is unavailable for your current access.',
  SR409: 'Changed by another teammate. Refresh before saving.',
  SR412: 'This request ID was already used for a different change.',
  SR422: 'Invalid Sprint Review request. Check the fields and linked records.',
};
const canonicalTables = [
  'public.profiles', 'public.areas', 'public.team_positions', 'public.team_member_positions',
  'public.planning_seasons', 'public.planning_groups', 'public.planning_boards', 'public.planning_items',
  'public.planning_tasks', 'public.planning_steps', 'public.planning_comments',
  'public.planning_task_dependencies', 'public.planning_task_assignees', 'planning_private.history',
  'public.planning_sprint_reviews', 'public.planning_project_review_assignments', 'public.planning_project_review_supporters',
  'public.fabrication_parts', 'public.fabrication_revisions', 'fabrication_private.settings',
  'fabrication_private.requests', 'fabrication_private.reservations', 'fabrication_private.history',
  ...['boards', 'components', 'task_links', 'checks', 'snapshots', 'requests', 'history'].map(t => `assembly_private.${t}`),
  'storage.buckets', 'storage.objects',
];
const decisionTables = ['public.planning_sprint_review_updates', 'planning_review_private.requests', 'planning_review_private.history'];
const reference = (label, reference_id) => ({ label, url: `https://example.invalid/synthetic/${reference_id}`, reference_id });

export async function runDesignDecisionIntegration({ base, anonKey, sql, registerSecret }) {
  const checks = [];
  const pass = label => { const message = `Design decisions: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response, expected = 200) {
    const body = await response.json();
    assert.equal(response.status, expected, `Decision HTTP ${response.status}; code=${body?.code || 'unspecified'}`);
    return body;
  }
  // Custom SRxxx SQLSTATEs map to HTTP 400, not application-specific HTTP codes.
  async function rejected(response, code) {
    const body = await json(response, 400);
    assert.equal(body.code, code); assert.equal(body.message, safeErrors[code]);
    for (const field of ['details', 'hint']) assert(body[field] === null || body[field] === '', `Unsanitized decision error ${field}`);
  }
  async function denied(response, statuses = [401, 403, 404]) {
    await response.text();
    assert(statuses.includes(response.status), `Expected decision access denial, HTTP ${response.status}`);
  }
  const count = (table, where = 'true') => Number(sql(`select count(*) from ${table} where ${where}`));
  const fingerprint = tables => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table =>
    `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t)`
  ).join(',')})`)).digest('hex');

  // Independent fixture identities keep the preceding Fabrication/Assembly suite
  // untouched. SQL creates only their missing shared-app profile rows; all Auth
  // sessions and application records below use real public gateway endpoints.
  const users = {};
  for (const [name, role, active] of [
    ['mentor', 'mentor', true], ['student', 'student', true], ['supporter', 'student', true],
    ['reader', 'readonly', true], ['unassigned', 'lead', true], ['inactive', 'student', false],
  ]) {
    const email = `design-decision-${name}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await json(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true } }));
    assert(signup.user?.id && signup.access_token, 'A real Auth signup session is required');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, signup.user.id); assert(login.access_token);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    users[name] = { id: login.user.id, token: login.access_token };
    const actual = await json(await localFetch(base, '/auth/v1/user', { headers: headers(users[name]) }));
    assert.equal(actual.id, users[name].id);
    sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actual.id)},${lit(`Synthetic decision ${name}`)},${lit(role)},${active})`);
  }
  const { mentor, student, supporter, reader, unassigned, inactive } = users;
  // Planning permits exactly one active season. Reuse the preceding suites'
  // season through the public context RPC instead of creating a conflicting one
  // or changing their canonical fixtures. This suite owns its new project/review.
  const planningContext = await json(await rpc('planning_context', { selected_season: null }, mentor));
  const activeSeasons = planningContext.seasons.filter(s => s.status === 'active');
  assert.equal(activeSeasons.length, 1, 'The owned stack must have one active synthetic season');
  const season = activeSeasons[0].id;
  assert.equal(planningContext.season_id, season);
  const board = randomUUID(), reviewID = randomUUID(), updateID = randomUUID(), taskID = randomUUID();
  const planning = (entity, p) => rpc('planning_save', { entity, p }, mentor).then(json);
  const save = (action, p, actor = student, key = randomUUID(), expectedActor = actor.id) =>
    rpc('sprint_review_save', { action, request_id: key, expected_actor: expectedActor, p }, actor);
  const receipt = (key, actor = student, cancel = false) => rpc(
    cancel ? 'sprint_review_cancel_mutation' : 'sprint_review_mutation_status',
    { request_id: key, expected_actor: actor.id }, actor,
  ).then(json);
  const emptyReceipt = (key, status = 'unknown') => ({ request_id: key, status, action: null, entity_id: null, version: null });
  assert.equal(await planning('board', { id: board, season_id: season, kind: 'project', name: 'Synthetic decision integration project' }), board);
  assert.equal(await planning('task', { id: taskID, board_id: board, title: 'Synthetic canonical prototype test', status: 'todo', priority: 'normal', owner_ids: [student.id] }), taskID);
  assert.equal((await json(await save('assignment', { board_id: board, lead_id: student.id, supporter_ids: [supporter.id], version: null }, mentor))).status, 'applied');
  assert.equal((await json(await save('review', { id: reviewID, season_id: season, title: 'Synthetic design decision review', review_date: '2026-10-06', chair_id: mentor.id, agenda: [], version: null }, mentor))).status, 'applied');
  assert.equal(sql(`select bool_and(role='student') from public.profiles where id in (${lit(student.id)},${lit(supporter.id)})`), 't');
  pass('six real Auth identities, ordinary student lead/supporter assignments, and Planning/Sprint fixtures use existing authenticated contracts');

  const context = async (actor = student) => {
    const c = await json(await rpc('sprint_review_context', { selected_season: season, selected_review: reviewID }, actor));
    assert.equal(c.user_id, actor.id); assert.equal(c.season_id, season); assert.equal(c.selected_review_id, reviewID);
    assert(Number.isFinite(Date.parse(c.loaded_at)));
    return c;
  };
  const entry = async (actor = student) => {
    const update = (await context(actor)).updates.find(u => u.id === updateID);
    assert(update, 'Saved decision must be readable through Sprint Review context');
    assert.equal(update.board_id, board); assert.equal(update.review_id, reviewID);
    return update;
  };
  const legacy = {
    id: updateID, review_id: reviewID, board_id: board, progress: 'Synthetic prototype compared', blockers: '',
    evidence: [reference('Prototype observations', 'TEST-1')], tradeoffs: 'Mass versus service access',
    decisions_needed: 'Choose the mount geometry', decision_references: [reference('Decision source', 'DEC-1')],
    reported_decision: '', decision_rationale: '', reported_by_student_ids: [student.id], next_test: 'Repeat the loaded cycle test',
    linked_task_id: taskID, carry_from_update_id: null, unresolved: true, version: null,
  };
  const canonical = fingerprint(canonicalTables), untouched = fingerprint(decisionTables);
  for (const actor of [student, supporter, mentor]) assert.equal((await context(actor)).boards.find(b => b.id === board).can_edit_update, true);
  for (const actor of [reader, unassigned]) {
    assert.equal((await context(actor)).boards.find(b => b.id === board).can_edit_update, false);
    await rejected(await save('update', legacy, actor), 'SR403');
  }
  await rejected(await save('update', legacy, inactive), 'SR401');
  await rejected(await rpc('sprint_review_context', { selected_season: season, selected_review: reviewID }, inactive), 'SR401');
  await rejected(await save('update', legacy, student, randomUUID(), mentor.id), 'SR401');
  for (const [name, body] of [
    ['sprint_review_context', { selected_season: season, selected_review: reviewID }],
    ['sprint_review_save', { action: 'update', request_id: randomUUID(), expected_actor: student.id, p: legacy }],
    ...['sprint_review_mutation_status', 'sprint_review_cancel_mutation'].map(name => [name, { request_id: randomUUID(), expected_actor: student.id }]),
  ]) await denied(await rpc(name, body, null));
  assert.equal(fingerprint(decisionTables), untouched, 'Denied requests must not create updates, receipts, or audit rows');
  pass('readonly, unassigned global lead, inactive, actor mismatch, and anonymous requests fail closed despite admin user_metadata');

  const legacyKey = randomUUID();
  assert.deepEqual(await json(await save('update', legacy, student, legacyKey)), { request_id: legacyKey, status: 'applied', action: 'update', entity_id: updateID, version: 1 });
  const first = await entry();
  assert.equal(first.decision_workflow, null); assert.equal(first.recorded_by, student.id); assert.equal(first.version, 1);
  assert.equal(first.linked_task.id, taskID); assert.deepEqual(first.linked_task.owner_ids, [student.id]);
  pass('legacy creation still works with no workflow and records the authenticated student, preserving the canonical task link');

  const optionA = randomUUID(), optionB = randomUUID(), mass = randomUUID(), load = randomUUID();
  const option = (id, label) => ({ id, label, description: 'Synthetic geometry alternative', weight: 'Bench measurement below', space: 'Inside the measured envelope', cost: 'Estimate pending', reliability: 'Loaded-cycle test pending', time: 'Two student sessions', evidence: [reference('Option evidence', 'TEST-2')] });
  const comparison = {
    schema_version: 1, status: 'comparing', owner_id: student.id, target_date: '2026-10-20', decided_on: null,
    requirements: [reference('Mechanism requirements', 'REQ-1')], options: [
      { ...option(optionA, 'Folded mount'), swot: { strengths: 'Lower measured mass', weaknesses: 'More bends', opportunities: 'Single-sheet prototype', threats: 'Bend repeatability' } },
      option(optionB, 'Machined mount'),
    ], chosen_option_id: null, reopen_criteria: '',
    trade_study: {
      criteria: [
        { id: mass, label: 'Assembled mass', unit: 'kg', weight: 3, scale_min: 0, scale_max: 20, direction: 'lower', must_have: true, minimum: null, maximum: 15 },
        { id: load, label: 'Tested load', unit: 'N', weight: 2, scale_min: 0, scale_max: 500, direction: 'higher', must_have: false, minimum: null, maximum: null },
      ],
      assessments: [
        { option_id: optionA, criterion_id: mass, value: 12.5, reason: 'Measured with hardware', evidence: [reference('Mass measurement', 'MEAS-1')] },
        { option_id: optionB, criterion_id: mass, value: 14.25, reason: 'Measured assembled', evidence: [reference('Mass measurement', 'MEAS-2')] },
        { option_id: optionA, criterion_id: load, value: null, reason: 'Load test is still pending', evidence: [] },
        { option_id: optionB, criterion_id: load, value: 420, reason: 'Measured on fixture', evidence: [reference('Load measurement', 'MEAS-3')] },
      ],
    },
  };
  const comparingPayload = { ...legacy, version: 1, decision_workflow: comparison };
  assert.equal((await json(await save('update', comparingPayload))).version, 2);
  for (const actor of [student, supporter, reader, unassigned, mentor]) assert.deepEqual((await entry(actor)).decision_workflow, comparison);
  assert.equal((await entry()).recorded_by, student.id);
  pass('student comparison round-trips requirement IDs, option evidence/SWOT, raw measurements, units, directions, hard bounds, and explicit unknown values');

  const recorded = { ...comparison, status: 'recorded', decided_on: '2026-10-06', chosen_option_id: optionA, reopen_criteria: 'Reopen if the loaded cycle test fails' };
  const recordedPayload = { ...legacy, version: 2, reported_decision: 'Students chose the folded mount', decision_rationale: 'Measured mass leaves margin; load test remains explicit', decision_workflow: recorded, unresolved: false };
  const recordedKey = randomUUID();
  const recordedReceipt = await json(await save('update', recordedPayload, supporter, recordedKey));
  assert.equal(recordedReceipt.version, 3);
  const recordedEntry = await entry(reader);
  assert.deepEqual(recordedEntry.decision_workflow, recorded); assert.equal(recordedEntry.recorded_by, supporter.id);
  assert.deepEqual(recordedEntry.reported_by_student_ids, [student.id]);
  assert.equal(recordedEntry.reported_students[0].id, student.id); assert(recordedEntry.reported_students[0].is_student);
  assert(Number.isFinite(Date.parse(recordedEntry.recorded_at)));
  const audit = JSON.parse(sql(`select to_jsonb(h) from planning_review_private.history h where request_id=${lit(recordedKey)} and actor_id=${lit(supporter.id)}`));
  assert.equal(audit.actor_id, supporter.id); assert.equal(audit.after_data.recorded_by, supporter.id);
  assert.deepEqual(audit.before_data.decision_workflow, comparison); assert.deepEqual(audit.after_data.decision_workflow, recorded);
  pass('assigned student supporter records the reported decision and study; server recorder/audit actor remains separate from the reported student owner');

  const beforeInvalid = fingerprint(decisionTables);
  const invalid = [
    { ...recordedPayload, version: 3, recorded_by: mentor.id },
    { ...recordedPayload, version: 3, reported_by_student_ids: [] },
    { ...recordedPayload, version: 3, decision_rationale: '' },
    { ...recordedPayload, version: 3, decision_workflow: { ...recorded, owner_id: mentor.id } },
    { ...recordedPayload, version: 3, decision_workflow: { ...recorded, chosen_option_id: randomUUID() } },
    { ...recordedPayload, version: 3, decision_workflow: { ...recorded, requirements: [{ ...reference('Unsafe source', 'BAD-1'), url: 'javascript:alert(1)' }] } },
    { ...recordedPayload, version: 3, decision_workflow: { ...recorded, trade_study: { ...recorded.trade_study, score: 99 } } },
    { ...recordedPayload, version: 3, decision_workflow: { ...recorded, trade_study: { ...recorded.trade_study, assessments: [...recorded.trade_study.assessments, recorded.trade_study.assessments[0]] } } },
    { ...recordedPayload, version: 3, decision_workflow: { ...recorded, trade_study: { ...recorded.trade_study, criteria: recorded.trade_study.criteria.map(c => ({ ...c, scale_max: c.scale_min })) } } },
  ];
  for (const p of invalid) { const key = randomUUID(); await rejected(await save('update', p, supporter, key), 'SR422'); assert.deepEqual(await receipt(key, supporter), emptyReceipt(key)); }
  assert.equal(fingerprint(decisionTables), beforeInvalid);
  pass('spoofed recorder, incomplete recorded decisions, non-student owner, unsafe sources, invented scores, duplicate cells, and invalid normalization fail without mutation');

  const beforeRecovery = fingerprint(decisionTables);
  const replays = await Promise.all([save('update', recordedPayload, supporter, recordedKey), save('update', recordedPayload, supporter, recordedKey)]);
  for (const response of replays) assert.deepEqual(await json(response), recordedReceipt);
  assert.deepEqual(await receipt(recordedKey, supporter), recordedReceipt);
  assert.deepEqual(await receipt(recordedKey, supporter, true), recordedReceipt);
  assert.deepEqual(await receipt(recordedKey, student), emptyReceipt(recordedKey));
  await rejected(await save('update', { ...recordedPayload, progress: 'Changed replay content' }, supporter, recordedKey), 'SR412');
  const staleKey = randomUUID();
  await rejected(await save('update', comparingPayload, student, staleKey), 'SR409');
  assert.deepEqual(await receipt(staleKey), emptyReceipt(staleKey));
  for (const name of ['sprint_review_mutation_status', 'sprint_review_cancel_mutation']) {
    await rejected(await rpc(name, { request_id: recordedKey, expected_actor: supporter.id }, student), 'SR401');
  }
  assert.equal(count('planning_review_private.history', `request_id=${lit(recordedKey)}`), 1);
  assert.equal(count('planning_review_private.requests', `request_id=${lit(recordedKey)}`), 1);
  assert.equal(fingerprint(decisionTables), beforeRecovery);
  const cancelKey = randomUUID(), cancelled = emptyReceipt(cancelKey, 'cancelled');
  assert.deepEqual(await receipt(cancelKey, student, true), cancelled);
  assert.deepEqual(await json(await save('update', { ...recordedPayload, version: 3 }, student, cancelKey)), cancelled);
  assert.equal((await entry()).version, 3); assert.equal(count('planning_review_private.history', `request_id=${lit(cancelKey)}`), 0);
  pass('same-key HTTP retries recover one actor-bound receipt/audit, altered replay and stale saves reject, and cancellation prevents late writes');

  const legacyEdit = { ...recordedPayload, version: 3, progress: 'Synthetic legacy client progress edit' };
  delete legacyEdit.decision_workflow;
  assert.equal((await json(await save('update', legacyEdit, student))).version, 4);
  assert.deepEqual((await entry()).decision_workflow, recorded);
  assert.equal((await entry()).recorded_by, student.id);
  assert.equal((await json(await save('update', { ...legacyEdit, version: 4, decision_workflow: null }, supporter))).version, 5);
  assert.equal((await entry()).decision_workflow, null);
  const reopened = { ...recorded, status: 'reopened' };
  assert.equal((await json(await save('update', { ...recordedPayload, version: 5, decision_workflow: reopened, unresolved: true }, student))).version, 6);
  assert.deepEqual((await entry()).decision_workflow, reopened);
  assert.equal(count('public.planning_sprint_review_updates', `id=${lit(updateID)}`), 1);
  assert.deepEqual(JSON.parse(sql(`select after_data->'decision_workflow' from planning_review_private.history where request_id=${lit(recordedKey)}`)), recorded);
  pass('legacy omission preserves the complete study, explicit null clears it, and reopening reuses the same update while retaining earlier audited decisions');

  const beforeDirect = fingerprint(decisionTables);
  for (const actor of [null, student, supporter, reader]) {
    for (const table of ['planning_sprint_reviews', 'planning_sprint_review_updates', 'planning_project_review_assignments', 'planning_project_review_supporters']) {
      await denied(await localFetch(base, `/rest/v1/${table}?select=*`, { headers: headers(actor) }));
    }
    await denied(await localFetch(base, `/rest/v1/planning_sprint_review_updates?id=eq.${updateID}`, {
      method: 'PATCH', headers: { ...headers(actor), 'Content-Type': 'application/json' }, body: JSON.stringify({ progress: 'Attempted direct bypass', decision_workflow: null }),
    }));
    await denied(await localFetch(base, '/rest/v1/history?select=*', { headers: { ...headers(actor), 'Accept-Profile': 'planning_review_private' } }), [401, 403, 404, 406]);
    await denied(await rpc('decision_workflow_valid', { v: recorded, previous_workflow: null, p: recordedPayload }, actor));
  }
  assert.equal(fingerprint(decisionTables), beforeDirect);
  assert.equal(fingerprint(canonicalTables), canonical, 'Decision operations modified unrelated Planning, assignment, Fabrication, Assembly, profile, or Storage rows');
  pass('anonymous/authenticated direct-table reads/writes and private helper/audit access remain closed; unrelated canonical data is byte-for-byte unchanged');
  return checks;
}
