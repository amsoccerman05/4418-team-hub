// Disposable synthetic PostgreSQL on 127.0.0.1 only. Never reads a production URL.
// Run: SEASON_GOALS_PG_BIN=/path/to/postgresql/bin node tests/native/season-goals-concurrency.mjs
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {baseline, goal, id, migration} from '../fixtures/season-goals-baseline.mjs';

const bin = process.env.SEASON_GOALS_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const dir = mkdtempSync('/tmp/impulse-season-goals-native-');
const data = join(dir, 'db');
const env = {...process.env};
for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const {port: availablePort} = probe.address();
    probe.close(() => resolve(availablePort));
  });
});
const connection = `host=127.0.0.1 hostaddr=127.0.0.1 port=${port} user=season_goals_fixture dbname=postgres passfile=/nonexistent sslmode=disable gssencmode=disable connect_timeout=5 options='-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000'`;
const args = label => ['-X', '-w', '-d', `${connection} application_name=${label}`, '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
const sql = query => execFileSync(join(bin, 'psql'), args('goal_native_observer'), {input: query, encoding: 'utf8', env}).trim();
const clients = new Set();
let sequence = 0;

function startSQL(query, label = 'request', keepOpen = false) {
  const name = `goals_${++sequence}_${label}`;
  const child = spawn(join(bin, 'psql'), args(name), {env});
  const client = {name, child, out: '', err: '', settled: false};
  clients.add(client);
  client.done = new Promise(resolve => {
    child.stdout.on('data', buffer => { client.out += buffer; });
    child.stderr.on('data', buffer => { client.err += buffer; });
    child.stdin.on('error', error => { client.err += error.message; });
    child.once('error', error => {
      client.err += error.message;
      client.settled = true;
      clients.delete(client);
      resolve({code: -1, out: client.out.trim(), err: client.err});
    });
    child.once('close', code => {
      client.settled = true;
      clients.delete(client);
      resolve({code, out: client.out.trim(), err: client.err});
    });
  });
  if (keepOpen) child.stdin.write(`${query}\n`);
  else child.stdin.end(`${query}\n`);
  return client;
}

async function waitFor(check, message, client) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    if (client?.settled) throw Error(`${message}; session finished early: ${client.err}\n${client.out}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw Error(message);
}

// A gate stays open until explicitly committed. Assertions observe actual PostgreSQL
// lock waits, so fast/slow machines cannot accidentally test two serial requests.
async function transactionGate(query, label) {
  const client = startSQL(`begin;\n${query}\nselect 'GOAL_GATE_READY';`, label, true);
  await waitFor(() => client.out.includes('GOAL_GATE_READY'), `Gate ${label} did not acquire its lock`, client);
  let released = false;
  return {
    client,
    async release(queryAfterWait = '', commit = true) {
      assert.equal(released, false, `Gate ${label} was already released`);
      released = true;
      client.child.stdin.end(`${queryAfterWait}\n${commit ? 'commit' : 'rollback'};\n`);
      return assertSucceeded(await client.done);
    },
  };
}

async function blocked(client, event) {
  await waitFor(
    () => sql(`select count(*) from pg_stat_activity where application_name='${client.name}' and state='active' and wait_event_type='Lock' and wait_event='${event}';`) === '1',
    `${client.name} never reached its ${event} lock wait`,
    client,
  );
  assert.equal(client.settled, false);
}

function assertSucceeded(result) {
  assert.equal(result.code, 0, result.err || result.out);
  return result;
}

function assertDenied(result, pattern = /ERROR:\s+42501:/) {
  assert.notEqual(result.code, 0, `Expected rejection, received ${result.out}`);
  assert.match(result.err, pattern);
  return result;
}

const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const user = actor => `select set_config('test.uid','${id(actor)}',false);set role authenticated;`;
const save = (payload, actor = 1) => `select public.planning_goal_save(${literal(payload)},'${id(actor)}');`;
const append = (payload, actor = 3) => `select public.planning_goal_update(${literal(payload)},'${id(actor)}');`;
const status = (operation, actor = 1) => `select public.planning_goal_operation_status('${id(operation)}','${id(actor)}');`;
const cancel = (operation, actor = 1) => `select public.planning_goal_operation_cancel('${id(operation)}','${id(actor)}');`;
const resultJSON = output => JSON.parse(output.split('\n').filter(line => line.startsWith('{')).at(-1));
const goalLock = ident => `select 1 from public.planning_goals where id='${id(ident)}' for update;`;
const advisoryLock = 'select pg_advisory_xact_lock(4418,30);';
const update = (operation, overrides = {}) => ({
  operation_id: id(operation), id: id(operation + 1000), goal_id: id(300), expected_version: 2,
  kind: 'weekly', measured_value: null, status: 'on_track',
  evidence: 'Synthetic native concurrency evidence', evidence_url: null,
  next_step: 'Run the next measured trial', observed_on: '2026-10-06', ...overrides,
});
const historyCount = operation => sql(`select count(*) from planning_private.goal_history where operation_id='${id(operation)}';`);
const operationCount = operation => sql(`select count(*) from planning_private.goal_operations where operation_id='${id(operation)}';`);
const version = (ident = 300) => Number(sql(`select version from public.planning_goals where id='${id(ident)}';`));
const noOperation = operation => {
  assert.equal(operationCount(operation), '0', 'Rejected request persisted an operation');
  assert.equal(historyCount(operation), '0', 'Rejected request persisted audit history');
};
const committed = (operation, goalId, goalVersion, updateId = null) => ({
  status: 'committed', operation_id: id(operation),
  result: {goal_id: id(goalId), version: goalVersion, update_id: updateId},
});
let checks = 0;
const pass = message => { checks++; console.log(`PASS ${message}`); };
let started = false;

try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '--auth-local=reject', '--auth-host=trust', '-U', 'season_goals_fixture', '--no-locale', '--encoding=UTF8'], {env, stdio: 'ignore'});
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'server.log'), '-o', `-p ${port} -c listen_addresses='127.0.0.1' -c unix_socket_directories='' -c max_connections=20 -c shared_buffers=16MB -c timezone=UTC`, '-w', 'start'], {env, stdio: 'ignore'});
    started = true;
  } catch (error) {
    console.error(readFileSync(join(dir, 'server.log'), 'utf8'));
    throw error;
  }
  sql(baseline());
  sql(readFileSync(migration, 'utf8'));
  assert.equal(sql("show listen_addresses;"), '127.0.0.1');
  assert.equal(sql('show unix_socket_directories;'), '');

  const create = goal({supporter_ids: [id(6)], task_ids: [], milestone_ids: [], next_milestone_id: null});
  const replayGate = await transactionGate(`${user(1)}${save(create)}`, 'create_replay');
  const replay = startSQL(`${user(1)}${save(create)}`, 'exact_create_replay');
  await blocked(replay, 'advisory');
  const originalCreate = await replayGate.release();
  const repeatedCreate = assertSucceeded(await replay.done);
  assert.deepEqual(resultJSON(repeatedCreate.out), resultJSON(originalCreate.out));
  assert.equal(version(), 1);
  assert.equal(historyCount(900), '1');
  assert.equal(operationCount(900), '1');
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(300)}';`), '1');
  pass('simultaneous exact create replay preserves one goal, version, receipt, and audit');

  const edit = {...create, operation_id: id(901), expected_version: 1, title: 'Native winning metadata'};
  const staleGate = await transactionGate(`${user(1)}${save(edit)}`, 'stale_save');
  const stale = startSQL(`${user(2)}${save({...edit, operation_id: id(902), title: 'Stale metadata'}, 2)}`, 'stale_save_loser');
  await blocked(stale, 'advisory');
  await staleGate.release();
  assertDenied(await stale.done, /changed|stale|version|refresh/i);
  assert.equal(version(), 2);
  assert.equal(sql(`select title from public.planning_goals where id='${id(300)}';`), edit.title);
  assert.equal(historyCount(901), '1');
  noOperation(902);
  pass('simultaneous metadata saves reject the stale writer without an audit or receipt');

  const winningUpdate = update(903, {kind: 'measurement', measured_value: 4});
  const appendGate = await transactionGate(`${user(3)}${append(winningUpdate)}`, 'append_winner');
  const competingUpdate = update(904, {evidence: 'Competing measurement'});
  const competing = startSQL(`${user(6)}${append(competingUpdate, 6)}`, 'append_loser');
  await blocked(competing, 'advisory');
  await appendGate.release();
  assertDenied(await competing.done, /changed|stale|version|refresh/i);
  assert.equal(version(), 3);
  assert.equal(sql(`select count(*) from public.planning_goal_updates where goal_id='${id(300)}';`), '1');
  assert.equal(historyCount(903), '1');
  noOperation(904);
  pass('simultaneous update appends choose one version winner and persist one append');

  const exactUpdate = update(905, {expected_version: 3});
  const exactUpdateGate = await transactionGate(`${user(3)}${append(exactUpdate)}`, 'append_replay');
  const appendReplay = startSQL(`${user(3)}${append(exactUpdate)}`, 'exact_append_replay');
  await blocked(appendReplay, 'advisory');
  const originalAppend = await exactUpdateGate.release();
  assert.deepEqual(resultJSON(assertSucceeded(await appendReplay.done).out), resultJSON(originalAppend.out));
  assert.equal(version(), 4);
  assert.equal(sql(`select count(*) from public.planning_goal_updates where id='${exactUpdate.id}';`), '1');
  assert.equal(historyCount(905), '1');
  pass('simultaneous exact append replay preserves the first update and audit');

  for (const [actor, request] of [
    [1, save(create, 2)], [2, save(create, 2)],
    [3, append(exactUpdate, 6)], [6, append(exactUpdate, 6)],
  ]) {
    const changedActorReplay = startSQL(`${user(actor)}${request}`, 'changed_actor_replay');
    assertDenied(await changedActorReplay.done);
  }
  assert.equal(version(), 4);
  assert.equal(historyCount(900), '1');
  assert.equal(operationCount(900), '1');
  assert.equal(historyCount(905), '1');
  assert.equal(operationCount(905), '1');
  assert.deepEqual(resultJSON(sql(`${user(1)}${status(900)}`)), committed(900, 300, 1));
  assert.deepEqual(resultJSON(sql(`${user(3)}${status(905, 3)}`)), committed(905, 300, 4, exactUpdate.id));
  pass('save and append replays reject a changed expected actor or a different signed-in actor');

  const inactiveGate = await transactionGate(advisoryLock, 'inactive_actor');
  const inactive = startSQL(`${user(1)}${save(goal({id: id(301), operation_id: id(906)}))}`, 'inactive_actor_waiter');
  await blocked(inactive, 'advisory');
  sql(`update public.profiles set active=false where id='${id(1)}';`);
  await inactiveGate.release();
  assertDenied(await inactive.done);
  noOperation(906);
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(301)}';`), '0');
  sql(`update public.profiles set active=true where id='${id(1)}';`);
  pass('actor deactivation during the advisory wait blocks the delayed create');

  const managerGate = await transactionGate(goalLock(300), 'manager_position');
  const manager = startSQL(`${user(2)}${save({...create, operation_id: id(907), expected_version: 4, title: 'Revoked manager edit'}, 2)}`, 'manager_position_waiter');
  await blocked(manager, 'transactionid');
  sql(`update public.team_member_positions set revoked_at=clock_timestamp() where user_id='${id(2)}' and revoked_at is null;`);
  await managerGate.release();
  assertDenied(await manager.done);
  assert.equal(version(), 4);
  noOperation(907);
  sql(`update public.team_member_positions set revoked_at=null where user_id='${id(2)}';`);
  pass('position revocation during the goal row wait removes manager edit authority');

  const ownerGate = await transactionGate(goalLock(300), 'owner_role');
  const owner = startSQL(`${user(3)}${append(update(908, {expected_version: 4}))}`, 'owner_role_waiter');
  await blocked(owner, 'transactionid');
  sql(`update public.profiles set role='readonly' where id='${id(3)}';`);
  await ownerGate.release();
  assertDenied(await owner.done);
  assert.equal(version(), 4);
  noOperation(908);
  sql(`update public.profiles set role='student' where id='${id(3)}';`);
  pass('owner role downgrade during the goal row wait removes append authority');

  const supporterRoleGate = await transactionGate(goalLock(300), 'supporter_readonly');
  const readonlySupporter = startSQL(`${user(6)}${append(update(923, {expected_version: 4}), 6)}`, 'supporter_readonly_waiter');
  await blocked(readonlySupporter, 'transactionid');
  sql(`update public.profiles set role='readonly' where id='${id(6)}';`);
  await supporterRoleGate.release();
  assertDenied(await readonlySupporter.done);
  assert.equal(version(), 4);
  noOperation(923);
  assert.equal(sql(`select count(*) from public.planning_goal_supporters where goal_id='${id(300)}' and user_id='${id(6)}';`), '1');
  assert.equal(sql(`select count(*) from public.planning_goal_updates where id='${id(1923)}';`), '0');
  sql(`update public.profiles set role='student' where id='${id(6)}';`);
  pass('supporter role downgrade during the goal row wait denies append despite retained membership');

  const supporterGate = await transactionGate(goalLock(300), 'supporter_removed');
  const supporter = startSQL(`${user(6)}${append(update(909, {expected_version: 4}), 6)}`, 'supporter_removed_waiter');
  await blocked(supporter, 'transactionid');
  await supporterGate.release(`delete from public.planning_goal_supporters where goal_id='${id(300)}' and user_id='${id(6)}';`);
  assertDenied(await supporter.done);
  assert.equal(version(), 4);
  noOperation(909);
  pass('supporter removal during the goal row wait removes append authority');

  const boardGate = await transactionGate(`select 1 from public.planning_boards where id='${id(110)}' for update;`, 'linked_board');
  const invalidBoard = startSQL(`${user(1)}${save(goal({id: id(302), operation_id: id(910), task_ids: [id(120)]}))}`, 'linked_board_waiter');
  await blocked(invalidBoard, 'transactionid');
  await boardGate.release(`update public.planning_boards set active=false where id='${id(110)}';`);
  assertDenied(await invalidBoard.done, /task|board|active|available|link/i);
  noOperation(910);
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(302)}';`), '0');
  sql(`update public.planning_boards set active=true where id='${id(110)}';`);
  pass('linked task board deactivation during its row wait rejects the complete save');

  const seasonGate = await transactionGate(`select 1 from public.planning_seasons where id='${id(100)}' for update;`, 'archived_season');
  const archived = startSQL(`${user(1)}${save(goal({id: id(303), operation_id: id(911)}))}`, 'archived_season_waiter');
  await blocked(archived, 'transactionid');
  await seasonGate.release(`update public.planning_seasons set status='archived' where id='${id(100)}';`);
  assertDenied(await archived.done, /season|archived|available/i);
  noOperation(911);
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(303)}';`), '0');
  sql(`update public.planning_seasons set status='active' where id='${id(100)}';`);
  pass('season archival during its row wait rejects the delayed create');

  const milestoneGate = await transactionGate(`select 1 from public.planning_items where id='${id(130)}' for update;`, 'linked_milestone');
  const invalidMilestone = startSQL(`${user(1)}${save(goal({id: id(304), operation_id: id(912), milestone_ids: [id(130)], next_milestone_id: id(130)}))}`, 'linked_milestone_waiter');
  await blocked(invalidMilestone, 'transactionid');
  await milestoneGate.release(`update public.planning_items set season_id='${id(101)}' where id='${id(130)}';`);
  assertDenied(await invalidMilestone.done, /milestone|season|available/i);
  noOperation(912);
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(304)}';`), '0');
  sql(`update public.planning_items set season_id='${id(100)}' where id='${id(130)}';`);
  pass('milestone season change during its row wait rejects stale linkage');

  const retained = goal({id: id(311), operation_id: id(921)});
  sql(`${user(1)}${save(retained)}`);
  const retainedGate = await transactionGate(`select 1 from public.planning_boards where id='${id(110)}' for update;`, 'retained_archived_link');
  const retainedEdit = {...retained, operation_id: id(922), expected_version: 1, description: 'Keep the historical task link while editing the goal'};
  const retainedSave = startSQL(`${user(3)}${save(retainedEdit, 3)}`, 'retained_archived_link_waiter');
  await blocked(retainedSave, 'transactionid');
  await retainedGate.release(`update public.planning_boards set active=false where id='${id(110)}';`);
  assert.deepEqual(resultJSON(assertSucceeded(await retainedSave.done).out), committed(922, 311, 2));
  assert.equal(version(311), 2);
  assert.equal(sql(`select description from public.planning_goals where id='${id(311)}';`), retainedEdit.description);
  assert.equal(sql(`select count(*) from public.planning_goal_task_links where goal_id='${id(311)}' and task_id='${id(120)}';`), '1');
  assert.equal(historyCount(922), '1');
  sql(`update public.planning_boards set active=true where id='${id(110)}';`);
  pass('an unrelated edit retains its existing task link when the board becomes inactive during the row wait');

  const uncertainGate = await transactionGate(`${user(1)}${save(goal({id: id(305), operation_id: id(913)}))}`, 'uncertain_commit');
  const uncertainStatus = startSQL(`${user(1)}${status(913)}`, 'uncertain_status_waiter');
  await blocked(uncertainStatus, 'advisory');
  await uncertainGate.release();
  assert.deepEqual(resultJSON(assertSucceeded(await uncertainStatus.done).out), committed(913, 305, 1));
  assert.equal(historyCount(913), '1');
  pass('uncertain status waits for an in-flight save and returns its committed receipt');

  const rollbackGate = await transactionGate(`${user(1)}${save(goal({id: id(306), operation_id: id(914)}))}`, 'uncertain_rollback');
  const rollbackStatus = startSQL(`${user(1)}${status(914)}`, 'rollback_status_waiter');
  await blocked(rollbackStatus, 'advisory');
  await rollbackGate.release('', false);
  assert.deepEqual(resultJSON(assertSucceeded(await rollbackStatus.done).out), {status: 'not_found', operation_id: id(914), result: null});
  noOperation(914);
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(306)}';`), '0');
  pass('uncertain status returns not_found only after an in-flight transaction rolls back');

  const cancelGate = await transactionGate(`${user(1)}${cancel(915)}`, 'cancel_wins');
  const lateSave = startSQL(`${user(1)}${save(goal({id: id(307), operation_id: id(915)}))}`, 'cancelled_save_waiter');
  await blocked(lateSave, 'advisory');
  await cancelGate.release();
  assertDenied(await lateSave.done, /cancel/i);
  assert.deepEqual(resultJSON(sql(`${user(1)}${status(915)}`)), {status: 'cancelled', operation_id: id(915), result: null});
  assert.deepEqual(resultJSON(sql(`${user(1)}${cancel(915)}`)), {status: 'cancelled', operation_id: id(915), result: null});
  assert.equal(operationCount(915), '1');
  assert.equal(historyCount(915), '0');
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(307)}';`), '0');
  pass('cancellation wins before the delayed save, preserves one tombstone, and replays safely');

  const saveGate = await transactionGate(`${user(1)}${save(goal({id: id(308), operation_id: id(916)}))}`, 'save_wins');
  const lateCancel = startSQL(`${user(1)}${cancel(916)}`, 'committed_cancel_waiter');
  await blocked(lateCancel, 'advisory');
  await saveGate.release();
  assert.deepEqual(resultJSON(assertSucceeded(await lateCancel.done).out), committed(916, 308, 1));
  assert.equal(version(308), 1);
  assert.equal(historyCount(916), '1');
  assert.equal(operationCount(916), '1');
  pass('save wins before cancellation and cancellation returns the original receipt without undo');

  const actorGate = await transactionGate(`${user(1)}${save(goal({id: id(309), operation_id: id(917)}))}`, 'cross_actor');
  const otherStatus = startSQL(`${user(8)}${status(917, 8)}`, 'cross_actor_status');
  const otherCancel = startSQL(`${user(2)}${cancel(917, 2)}`, 'cross_actor_cancel');
  await blocked(otherStatus, 'advisory');
  await blocked(otherCancel, 'advisory');
  await actorGate.release();
  assertDenied(await otherStatus.done, /42501|actor|another|different|belong|account|operation/i);
  assertDenied(await otherCancel.done, /42501|actor|another|different|belong|account|operation/i);
  assert.deepEqual(resultJSON(sql(`${user(1)}${status(917)}`)), committed(917, 309, 1));
  assert.equal(historyCount(917), '1');
  assert.equal(operationCount(917), '1');
  pass('cross-actor status and cancellation remain denied after an in-flight operation commits');

  const cancelRoleGate = await transactionGate(advisoryLock, 'cancel_role_revoked');
  const downgradedCancel = startSQL(`${user(1)}${cancel(918)}`, 'cancel_role_waiter');
  await blocked(downgradedCancel, 'advisory');
  sql(`update public.profiles set role='readonly' where id='${id(1)}';`);
  await cancelRoleGate.release();
  assert.deepEqual(resultJSON(assertSucceeded(await downgradedCancel.done).out), {status: 'cancelled', operation_id: id(918), result: null});
  assert.deepEqual(resultJSON(sql(`${user(1)}${status(918)}`)), {status: 'cancelled', operation_id: id(918), result: null});
  assert.deepEqual(resultJSON(sql(`${user(1)}${status(913)}`)), committed(913, 305, 1));
  assert.equal(operationCount(918), '1');
  assert.equal(historyCount(918), '0');
  const downgradedSave = startSQL(`${user(1)}${save(goal({id: id(310), operation_id: id(918)}))}`, 'downgraded_cancelled_save');
  assertDenied(await downgradedSave.done, /cancel/i);
  const readOnlyCreate = startSQL(`${user(1)}${save(goal({id: id(310), operation_id: id(920)}))}`, 'downgraded_new_save');
  assertDenied(await readOnlyCreate.done);
  noOperation(920);
  assert.equal(sql(`select count(*) from public.planning_goals where id='${id(310)}';`), '0');
  sql(`update public.profiles set role='mentor' where id='${id(1)}';`);
  pass('active role downgrade preserves own-operation cancellation and status without granting goal writes');

  const inactiveCancelGate = await transactionGate(advisoryLock, 'cancel_actor_inactive');
  const inactiveCancel = startSQL(`${user(1)}${cancel(919)}`, 'cancel_inactive_waiter');
  await blocked(inactiveCancel, 'advisory');
  sql(`update public.profiles set active=false where id='${id(1)}';`);
  await inactiveCancelGate.release();
  assertDenied(await inactiveCancel.done);
  noOperation(919);
  sql(`update public.profiles set active=true where id='${id(1)}';`);
  pass('actor deactivation during cancellation wait prevents a new tombstone');

  console.log(`${checks} native multi-session checks passed on ${sql('show server_version;')}; no production database or external writes used.`);
} finally {
  // Close request pipes before stopping PostgreSQL, including when an assertion fails.
  for (const client of clients) client.child.stdin.destroy();
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], {env, stdio: 'ignore'});
  for (const client of clients) client.child.kill('SIGTERM');
  rmSync(dir, {recursive: true, force: true});
}
