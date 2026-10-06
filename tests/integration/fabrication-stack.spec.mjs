// Actual HTTP integration suite. Does NOT import the handler, mock fetch, or fake
// Auth/Storage tables. Only fabrication-local.mjs supplies this disposable context.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { localFetch, ORIGIN } from './fabrication-safety.mjs';

export function syntheticFiles() {
  const dxf = Buffer.from('0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n0\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n25.4\n21\n10\n0\nENDSEC\n0\nEOF\n');
  let text = '%PDF-1.4\n'; const offsets = [];
  for (const [i, object] of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'].entries()) {
    offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += 'xref\n0 4\n0000000000 65535 f \n' + offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { dxf, pdf: Buffer.from(text) };
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const lit = value => `'${String(value).replaceAll("'", "''")}'`;

export async function runFabricationIntegration({ base, anonKey, sql, gate, waitFor, registerSecret }) {
  const checks = [];
  const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
  const files = syntheticFiles();
  const headers = token => ({ apikey: anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: ORIGIN });
  const request = (path, actor, body, extra = {}) => localFetch(base, path, {
    method: 'POST', headers: { ...headers(actor?.token), 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
  async function json(response, expected = 200) {
    const body = await response.json();
    assert.equal(response.status, expected, `Unexpected HTTP ${response.status}; code=${body?.code || body?.error_code || "unspecified"}`);
    return body;
  }
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, actor, body);
  const edge = (body, actor) => request('/functions/v1/fabrication-files', actor, { expected_actor: actor.id, ...body });
  const status = (key, actor) => rpc('fabrication_mutation_status', { request_id: key, expected_actor: actor.id }, actor).then(r => json(r));
  const cancel = (key, actor) => edge({ action: 'cancel', request_id: key }, actor);
  const count = (table, where = 'true') => Number(sql(`select count(*) from ${table} where ${where}`));
  const objects = revision => sql(`select coalesce(jsonb_agg(to_jsonb(o) order by name),'[]') from storage.objects o where bucket_id='fabrication-private' and name like ${lit(`%/${revision}/%`)}`);
  const objectCount = revision => JSON.parse(objects(revision)).length;
  const submission = (board, part = randomUUID(), revision = randomUUID(), version = null) => ({
    part_id: part, board_id: board, revision_id: revision, version, name: 'Synthetic integration bracket', material: '6061 aluminum', thickness: 3,
    thickness_unit: 'mm', drawing_unit: 'mm', quantity: 2, needed_date: '2026-10-20', onshape_url: '', notes: 'Generated synthetic test bytes only',
  });
  function upload(p, key, actor, bytes = files, expectedActor = actor.id) {
    const form = new FormData();
    form.set('action', 'upload'); form.set('request_id', key); form.set('expected_actor', expectedActor); form.set('p', JSON.stringify(p));
    form.set('dxf', new Blob([bytes.dxf], { type: 'application/dxf' }), 'Synthetic bracket.dxf');
    if (bytes.pdf) form.set('pdf', new Blob([bytes.pdf], { type: 'application/pdf' }), 'Synthetic bracket.pdf');
    return localFetch(base, '/functions/v1/fabrication-files', { method: 'POST', headers: headers(actor.token), body: form });
  }
  async function download(p, kind, actor, bytes = files[kind], number = 1) {
    const response = await edge({ action: 'download', revision_id: p.revision_id, file_kind: kind }, actor);
    assert.equal(response.status, 200, `Download ${kind} failed: ${response.status}`);
    assert.equal(response.headers.get('x-fabrication-revision'), p.revision_id);
    assert.equal(response.headers.get('x-fabrication-kind'), kind);
    assert.equal(response.headers.get('x-fabrication-sha256'), digest(bytes));
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.match(response.headers.get('content-disposition'), new RegExp(`-r${number}\\.${kind}"$`));
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  async function denied(response, allowed = [401, 403, 404]) {
    const text = await response.text();
    assert(allowed.includes(response.status), `Expected denial, received ${response.status}: ${text}`);
    return text;
  }
  const waiting = (name, minimum = 1) => waitFor(() => count('pg_stat_activity', `pid<>pg_backend_pid() and wait_event='advisory' and query like ${lit(`%${name}%`)}`) >= minimum, `${minimum} ${name} HTTP RPC sessions at advisory lock`);

  // Real email/password Auth sessions, using only unique reserved .invalid identities.
  const users = {};
  for (const [name, role, active] of [['mentor', 'mentor', true], ['lead', 'student', true], ['supporter', 'lead', true], ['operator', 'student', true], ['reader', 'readonly', true], ['inactive', 'student', false]]) {
    const email = `fabrication-${name}-${randomUUID()}@example.invalid`, password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await json(await request('/auth/v1/signup', null, { email, password, data: { role: 'admin', active: true } }));
    assert(signup.user?.id && signup.access_token, 'Real Auth signup/session is required');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    const login = await json(await request('/auth/v1/token?grant_type=password', null, { email, password }));
    assert.equal(login.user.id, signup.user.id); registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    users[name] = { id: login.user.id, token: login.access_token };
    const actual = await json(await localFetch(base, '/auth/v1/user', { headers: headers(login.access_token) }));
    assert.equal(actual.id, users[name].id);
    sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actual.id)},${lit(`Synthetic ${name}`)},${lit(role)},${active});`);
  }
  const { mentor, lead, supporter, operator, reader, inactive } = users;
  pass('real Auth signup, password sign-in, and /user verification for six synthetic identities');

  const season = randomUUID(), board = randomUUID();
  await waitFor(async () => {
    const r = await rpc('fabrication_context', { selected_season: null, selected_project: null }, mentor);
    await r.text(); return r.status === 200;
  }, 'PostgREST schema cache');
  assert.equal(await json(await rpc('planning_save', { entity: 'season', p: { id: season, name: 'Synthetic integration season', status: 'active' } }, mentor)), season);
  assert.equal(await json(await rpc('planning_save', { entity: 'board', p: { id: board, season_id: season, kind: 'project', name: 'Synthetic integration project' } }, mentor)), board);
  const assignment = await json(await rpc('sprint_review_save', { action: 'assignment', request_id: randomUUID(), expected_actor: mentor.id, p: { board_id: board, lead_id: lead.id, supporter_ids: [supporter.id], version: null } }, mentor));
  assert.equal(assignment.status, 'applied');
  pass('Planning and Sprint Review setup uses real authenticated gateway RPCs');

  const initial = submission(board), initialKey = randomUUID();
  await denied(await edge({ action: 'download', revision_id: initial.revision_id, file_kind: 'dxf' }, { id: lead.id, token: 'synthetic-invalid-token' }), [401]);
  await denied(await upload(initial, randomUUID(), lead, files, operator.id), [403]);
  for (const actor of [operator, reader, inactive]) await denied(await upload(submission(board), randomUUID(), actor), [401, 403]);
  assert.equal(count('fabrication_private.reservations'), 0);
  pass('invalid tokens, account mismatch, outsider, readonly, and inactive upload permissions fail closed despite user_metadata admin claims');

  const receipt = await json(await upload(initial, initialKey, lead));
  assert.equal(receipt.status, 'applied'); assert.equal(receipt.version, 1);
  assert.equal(count('fabrication_revisions'), 1); assert.equal(count('fabrication_private.history'), 1);
  assert.equal(objectCount(initial.revision_id), 2);
  for (const object of JSON.parse(objects(initial.revision_id))) {
    const kind = object.name.endsWith('.dxf') ? 'dxf' : 'pdf';
    assert.equal(Number(object.metadata.size), files[kind].length);
    assert.equal(object.metadata.mimetype, `application/${kind}`);
    assert.equal(object.user_metadata.sha256, digest(files[kind]));
  }
  await download(initial, 'dxf', lead); await download(initial, 'pdf', reader);
  assert.equal((await status(initialKey, lead)).status, 'applied');
  assert.equal((await status(initialKey, operator)).status, 'unknown');
  pass('real Edge multipart DXF/PDF → real Storage metadata → PostgreSQL finalize → byte-identical private downloads');

  const storagePath = `${board}/${initial.part_id}/${initial.revision_id}/drawing.dxf`;
  for (const actor of [null, lead, reader]) {
    await denied(await localFetch(base, `/storage/v1/object/authenticated/fabrication-private/${storagePath}`, { headers: headers(actor?.token) }), [400, 401, 403, 404]);
    await denied(await localFetch(base, `/storage/v1/object/fabrication-private/${board}/${randomUUID()}/blocked.dxf`, { method: 'POST', headers: { ...headers(actor?.token), 'Content-Type': 'application/dxf' }, body: files.dxf }), [400, 401, 403, 404]);
  }
  await denied(await localFetch(base, `/storage/v1/object/public/fabrication-private/${storagePath}`, { headers: headers() }), [400, 401, 403, 404]);
  await denied(await rpc('fabrication_reserve_upload', { actor: lead.id, request_id: randomUUID(), p: initial, manifest: {} }, lead));
  await denied(await localFetch(base, '/rest/v1/fabrication_revisions?select=*', { headers: headers(lead.token) }));
  assert.equal(count('storage.objects', "bucket_id='fabrication-private'"), 2);
  pass('real Storage browser read/write, public download, direct tables, and service-only RPCs stay denied with an unrelated permissive Storage policy');

  const initialObjects = objects(initial.revision_id);
  assert.deepEqual(await json(await upload(initial, initialKey, lead)), receipt);
  const changed = { ...files, dxf: Buffer.from(files.dxf.toString().replace('25.4', '26.4')) };
  await json(await upload(initial, initialKey, lead, changed), 412);
  assert.equal(objects(initial.revision_id), initialObjects);
  assert.equal(count('fabrication_revisions'), 1); assert.equal(count('fabrication_private.history'), 1);
  pass('applied exact replay is idempotent; changed validated bytes cannot reuse the request or replace Storage objects');

  // Current database rows, not stale JWT metadata, control file access and writes.
  sql(`update profiles set role='readonly' where id=${lit(lead.id)}`);
  await denied(await upload(submission(board), randomUUID(), lead), [403]);
  sql(`update profiles set role='student',active=false where id=${lit(lead.id)}`);
  await denied(await edge({ action: 'download', revision_id: initial.revision_id, file_kind: 'dxf' }, lead), [401]);
  sql(`update profiles set active=true where id=${lit(lead.id)};update planning_project_review_assignments set lead_id=${lit(operator.id)} where board_id=${lit(board)}`);
  await denied(await upload(submission(board), randomUUID(), lead), [403]);
  sql(`update planning_project_review_assignments set lead_id=${lit(lead.id)} where board_id=${lit(board)};update planning_seasons set status='archived' where id=${lit(season)}`);
  await denied(await edge({ action: 'download', revision_id: initial.revision_id, file_kind: 'dxf' }, lead), [403]);
  await download(initial, 'dxf', mentor);
  sql(`update planning_seasons set status='active' where id=${lit(season)}`);
  await download(initial, 'dxf', lead);
  pass('same issued JWT immediately obeys role downgrade, deactivation, current assignment, archive, and manager historical access');

  // Test-only trigger injects finalization failure or pauses the real transaction.
  // It never replaces a function, grants app access, or writes fake Storage rows.
  sql(`create schema fabrication_it;
    revoke all on schema fabrication_it from public,anon,authenticated,service_role;
    create table fabrication_it.control(request_id uuid primary key, mode text not null, target_status text);
    create function fabrication_it.intercept() returns trigger language plpgsql set search_path='' as $$declare c fabrication_it.control;begin
      select * into c from fabrication_it.control where request_id=new.request_id;
      if found then
        if tg_table_name='history' and c.mode='fail' then raise exception 'synthetic integration finalize fault';end if;
        if tg_table_name='requests' then
          if c.mode='hold' and c.target_status=new.status then perform pg_advisory_xact_lock(9918,99);end if;
        end if;
      end if;
      return new;
    end$$;
    revoke all on function fabrication_it.intercept() from public,anon,authenticated,service_role;
    create trigger fabrication_it_history before insert on fabrication_private.history for each row execute function fabrication_it.intercept();
    create trigger fabrication_it_request before insert on fabrication_private.requests for each row execute function fabrication_it.intercept();`);
  const control = (key, mode, target = null) => sql(`insert into fabrication_it.control values(${lit(key)},${lit(mode)},${target ? lit(target) : 'null'})`);
  const clear = key => sql(`delete from fabrication_it.control where request_id=${lit(key)}`);
  async function pending(p, key) {
    control(key, 'fail');
    try { await json(await upload(p, key, lead), 502); } finally { clear(key); }
    assert.equal((await status(key, lead)).status, 'pending');
    assert.equal(count('fabrication_parts', `id=${lit(p.part_id)}`), p.version === null ? 0 : 1);
    assert.equal(objectCount(p.revision_id), 2);
  }
  const pendingPart = submission(board), pendingKey = randomUUID();
  await pending(pendingPart, pendingKey);
  const pendingObjects = objects(pendingPart.revision_id);
  assert.equal((await json(await upload(pendingPart, pendingKey, lead))).status, 'applied');
  assert.equal(objects(pendingPart.revision_id), pendingObjects);
  assert.equal(count('fabrication_private.history', `request_id=${lit(pendingKey)}`), 1);
  await download(pendingPart, 'dxf', lead); await download(pendingPart, 'pdf', lead);
  pass('pending retry after real transaction rollback checks duplicate Storage bytes and commits one immutable revision without replacement');

  const parallel = submission(board), parallelKey = randomUUID(), releaseParallel = await gate();
  let parallelResponses;
  try {
    parallelResponses = Promise.all([upload(parallel, parallelKey, lead), upload(parallel, parallelKey, lead)]);
    await waiting('fabrication_reserve_upload', 2);
  } finally { await releaseParallel(); }
  const [one, two] = await parallelResponses;
  assert.deepEqual(await json(one), await json(two));
  assert.equal(count('fabrication_revisions', `part_id=${lit(parallel.part_id)}`), 1);
  assert.equal(count('fabrication_private.history', `request_id=${lit(parallelKey)}`), 1);
  assert.equal(objectCount(parallel.revision_id), 2);
  pass('two real Edge upload requests contend in PostgreSQL and produce one receipt, revision, audit, and immutable file pair');

  // Both cancel/finalize orders are forced at the terminal receipt insert.
  for (const winner of ['cancelled', 'applied']) {
    const p = submission(board), key = randomUUID(); await pending(p, key);
    control(key, 'hold', winner);
    const release = await gate('9918,99');
    let first, second;
    try {
      first = winner === 'cancelled' ? cancel(key, lead) : upload(p, key, lead);
      await waiting(winner === 'cancelled' ? 'fabrication_cancel_mutation' : 'fabrication_finalize_upload');
      second = winner === 'cancelled' ? upload(p, key, lead) : cancel(key, lead);
      await waiting(winner === 'cancelled' ? 'fabrication_reserve_upload' : 'fabrication_cancel_mutation');
    } finally { await release(); clear(key); }
    assert.equal((await json(await first)).status, winner);
    assert.equal((await json(await second)).status, winner);
    assert.equal((await status(key, lead)).status, winner);
    assert.equal(count('fabrication_parts', `id=${lit(p.part_id)}`), winner === 'applied' ? 1 : 0);
    assert.equal(objectCount(p.revision_id), winner === 'applied' ? 2 : 0);
    if (winner === 'applied') await download(p, 'dxf', lead);
    pass(`${winner === 'applied' ? 'finalize' : 'cancel'} wins controlled real-HTTP race; both requests reconcile the same receipt and correct Storage retention`);
  }

  const tombstone = submission(board), tombstoneKey = randomUUID();
  assert.equal((await json(await cancel(tombstoneKey, lead))).status, 'cancelled');
  assert.equal((await json(await upload(tombstone, tombstoneKey, lead))).status, 'cancelled');
  assert.equal(count('fabrication_private.reservations', `request_id=${lit(tombstoneKey)}`), 0);
  assert.equal(objectCount(tombstone.revision_id), 0);
  pass('cancel-before-reserve leaves a permanent actor-bound tombstone and no uploaded bytes');

  const mutate = (action, version, key, actor) => rpc('fabrication_mutate', { action, request_id: key, expected_actor: actor.id, p: { part_id: initial.part_id, revision_id: initial.revision_id, version, note: '' } }, actor);
  const releaseClaim = await gate(); let claims;
  try { claims = Promise.all([mutate('claim', 1, randomUUID(), operator), mutate('claim', 1, randomUUID(), supporter)]); await waiting('fabrication_mutate', 2); }
  finally { await releaseClaim(); }
  const claimResults = await claims, successes = claimResults.filter(r => r.status === 200);
  assert.equal(successes.length, 1);
  await json(successes[0]);
  const failedClaim = await claimResults.find(r => r.status !== 200).json(); assert.equal(failedClaim.code, 'FB409');
  const ownerID = sql(`select claimed_by from fabrication_parts where id=${lit(initial.part_id)}`);
  const owner = [operator, supporter].find(a => a.id === ownerID); assert(owner);
  const ackKey = randomUUID();
  const acks = await Promise.all([mutate('acknowledge', 2, ackKey, owner), mutate('acknowledge', 2, ackKey, owner)]);
  assert.deepEqual(await json(acks[0]), await json(acks[1]));
  assert.equal(count('fabrication_private.history', `request_id=${lit(ackKey)}`), 1);
  pass('authenticated PostgREST claim race picks one owner and identical acknowledgement replays produce one audit');

  const revisionA = submission(board, initial.part_id, randomUUID(), 3), revisionB = submission(board, initial.part_id, randomUUID(), 3);
  const keyA = randomUUID(), keyB = randomUUID();
  // Both reserve/upload before finalization, using real Storage and rollback faults.
  await pending(revisionA, keyA); await pending(revisionB, keyB);
  const releaseRevision = await gate(); let revisions;
  try { revisions = Promise.all([upload(revisionA, keyA, lead), upload(revisionB, keyB, lead)]); await waiting('fabrication_reserve_upload', 2); }
  finally { await releaseRevision(); }
  const revisionResults = await revisions;
  assert.equal(revisionResults.filter(r => r.status === 200).length, 1);
  const revisionBodies = await Promise.all(revisionResults.map(r => r.json()));
  const conflict = revisionBodies.find(b => b.code === 'FB409'); assert(conflict); assert.equal(conflict.receipt.status, 'cancelled');
  const current = JSON.parse(sql(`select to_jsonb(p) from fabrication_parts p where id=${lit(initial.part_id)}`));
  assert.equal(current.version, 4); assert.equal(current.claimed_by, owner.id); assert.equal(current.status, 'needs_review');
  assert.equal(current.acknowledged_revision_id, null); assert.equal(current.reviewed_revision_id, null);
  assert.equal(count('fabrication_revisions', `part_id=${lit(initial.part_id)}`), 2);
  for (const p of [revisionA, revisionB]) assert.equal(objectCount(p.revision_id), p.revision_id === current.current_revision_id ? 2 : 0);
  await download(initial, 'dxf', lead); // Historical bytes remain immutable/readable.
  await download(current.current_revision_id === revisionA.revision_id ? revisionA : revisionB, 'pdf', lead, files.pdf, 2);
  pass('competing real revision uploads have one winner; loser is cancelled/cleaned, claim survives, acknowledgements reset, history remains downloadable');

  // Permission loss while a request is already waiting on the authority lock.
  for (const change of ['role', 'assignment', 'archive']) {
    const p = submission(board), key = randomUUID(); await pending(p, key);
    const release = await gate(); let response;
    try {
      response = upload(p, key, lead); await waiting('fabrication_reserve_upload');
      if (change === 'role') sql(`update profiles set role='readonly' where id=${lit(lead.id)}`);
      if (change === 'assignment') sql(`update planning_project_review_assignments set lead_id=${lit(operator.id)} where board_id=${lit(board)}`);
      if (change === 'archive') sql(`update planning_seasons set status='archived' where id=${lit(season)}`);
    } finally { await release(); }
    await denied(await response, [403]);
    assert.equal(count('fabrication_parts', `id=${lit(p.part_id)}`), 0);
    sql(`update profiles set role='student' where id=${lit(lead.id)};update planning_project_review_assignments set lead_id=${lit(lead.id)} where board_id=${lit(board)};update planning_seasons set status='active' where id=${lit(season)}`);
    assert.equal((await json(await cancel(key, lead))).status, 'cancelled');
    assert.equal(objectCount(p.revision_id), 0);
    pass(`in-flight HTTP retry rechecks current ${change} after a PostgreSQL lock wait`);
  }
  sql('drop trigger fabrication_it_history on fabrication_private.history;drop trigger fabrication_it_request on fabrication_private.requests;drop schema fabrication_it cascade;');
  assert.equal(count('fabrication_private.reservations', 'not exists(select 1 from fabrication_private.requests q where q.actor_id=reservations.actor_id and q.request_id=reservations.request_id)'), 0);
  assert.equal(count('auth.users'), 6);
  pass('all synthetic leases reach terminal outcomes; test-only fault controls removed');
  const { runAssemblyIntegration } = await import('./assembly-stack.spec.mjs');
  checks.push(...await runAssemblyIntegration({ base, anonKey, sql, gate, waitFor, users, season, foreignBoard: board, foreignRevision: initial.revision_id, upload, submission }));
  return checks;
}
