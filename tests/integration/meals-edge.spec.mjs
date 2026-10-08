// Actual Supabase Edge HTTP entrypoint in the owned disposable stack. No
// injected handler, public mailbox, production provider, or hosted database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';
import { syntheticMeal } from './meals-fixture.mjs';
import { createMealEnvelope } from '../../supabase/functions/team-meals/envelope.ts';

/** JSON null is a valid successful void-operation receipt (e.g. cancellation).
 * Assertions must not crash while constructing their diagnostic message. */
export async function mealEdgeResponse(response, status = 200) {
  const parsed = await response.json();
  const code = parsed?.error?.code || parsed?.code || 'unspecified';
  assert.equal(response.status, status, `Meals Edge HTTP ${response.status}; code=${code}`);
  return parsed;
}

export async function runMealsEdgeIntegration({ base, anonKey, sql, users, envelopeKey, workerSecret, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`);
  assert(envelopeKey && workerSecret, 'Only generated owned-stack test configuration is supported');
  const route = '/functions/v1/team-meals', checks = [];
  const pass = label => { const message = `Meals served Edge: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const lit = value => `'${String(value).replaceAll("'", "''")}'`;
  const raw = query => JSON.parse(sql(query));
  const request = (body, user, extra = {}) => localFetch(base, route, { method: 'POST', headers: {
    apikey: anonKey, Origin: ORIGIN, 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...extra,
  }, body: JSON.stringify(body) });
  const body = mealEdgeResponse;
  const call = (payload, user) => request(payload, user).then(response => body(response));
  const expectError = async (payload, status, code, user, extra) => {
    const result = await body(await request(payload, user, extra), status); assert.equal(result.error.code, code);
  };
  const dispatch = (authorization = workerSecret, extra = {}) => localFetch(base, `${route}/dispatch`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json', ...extra }, body: '{}',
  });
  const start = Date.now(); let lastSummary = '', lastLoggedAt = 0;
  const safeReadinessCodes = new Set(['not_configured','temporarily_unavailable','origin_forbidden','rate_limited','BOOT_ERROR','WORKER_ERROR','WORKER_LIMIT']);
  while (true) {
    const response = await request({ operation: 'list' }); const status = response.status;
    let payload;try { payload=await response.json(); } catch { payload=null; }
    // Enumerated diagnostics only: never print Auth responses, request bodies,
    // connection strings, tokens, provider payloads or arbitrary error messages.
    const candidate=payload?.error?.code ?? payload?.code;
    const code=safeReadinessCodes.has(candidate)?candidate:'unspecified';
    if (status === 200) break;
    const summary=`HTTP ${status}; code=${code}`;
    if(summary!==lastSummary||Date.now()-lastLoggedAt>=15000){console.log(`Meals Edge readiness: ${summary}`);lastSummary=summary;lastLoggedAt=Date.now();}
    assert(code!=='not_configured', `Actual team-meals Edge activation failed: ${summary}`);
    assert(Date.now() - start < 90000, `Actual team-meals Edge entrypoint failed readiness: ${summary}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const preflight = await localFetch(base, route, { method: 'OPTIONS', headers: { apikey: anonKey, Origin: ORIGIN,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
  assert([200, 204].includes(preflight.status)); await preflight.text();
  await expectError({ operation: 'list' }, 403, 'origin_forbidden', undefined, { Origin: 'http://127.0.0.1:54340' });
  await expectError({ operation: 'manager' }, 403, 'manager_required');
  await expectError({ operation: 'manager' }, 403, 'manager_required', users.student);
  await expectError({ operation: 'manager' }, 403, 'manager_required', users.lead);
  const managed = await call({ operation: 'manager' }, users.admin); assert.equal(managed.mail_mode, 'mock');
  pass('Deno HTTP entry boots with generated local config, public CORS and real Auth/SQL authorization');

  const meal = await call({ operation: 'save_meal', meal: syntheticMeal('Synthetic served Edge meal', 3) }, users.mentor);
  const input = { operation: 'claim', meal_id: meal.id, slot_id: meal.slots[0].id, whole_meal: false, quantity: 1,
    name: 'Synthetic Edge Adult', email: 'edge-parent@example.invalid', idempotency_key: randomUUID() };
  const accepted = await call(input); assert.equal(accepted.email_status, 'queued');
  const row = raw(`select to_jsonb(o) from meals_private.outbox o join meals_private.claims c on c.id=o.claim_id where c.meal_id=${lit(meal.id)}`);
  assert.equal(row.status, 'queued'); assert.equal(row.attempts, 0); assert(row.envelope);
  const plaintext = await createMealEnvelope(envelopeKey).open(row.envelope, row), mail = JSON.parse(plaintext);
  for (const token of [mail.verificationToken, mail.manageToken]) { registerSecret(token); assert(!row.envelope.includes(token)); }
  assert.equal(mail.to, input.email); assert.equal(mail.claimId, row.claim_id);
  assert.equal(new URL(mail.verificationUrl).origin, ORIGIN); assert.equal(new URL(mail.verificationUrl).search, '');
  assert.equal(new URL(mail.verificationUrl).hash, `#verify=${mail.verificationToken}`);
  const replay = await call(input); assert.equal(replay.email_status, 'queued');
  const replayRow = raw(`select to_jsonb(o) from meals_private.outbox o where id=${lit(row.id)}`);
  assert.deepEqual(replayRow, row);
  const publicResult = JSON.stringify(await call({ operation: 'list' }));
  for (const value of [input.email, input.name, mail.verificationToken, 'envelope', 'claim_id']) assert(!publicResult.includes(value));
  pass('real HTTP claim atomically queues encrypted immutable links; duplicate receipt preserves one envelope');

  assert.equal((await body(await dispatch('synthetic-wrong-worker-secret-at-least-32'), 403)).error.code, 'worker_required');
  assert.equal((await body(await dispatch(users.mentor.token), 403)).error.code, 'worker_required');
  assert.equal((await body(await dispatch(workerSecret, { Origin: ORIGIN }), 400)).error.code, 'invalid_request');
  const workers = await Promise.all([dispatch().then(r => body(r)), dispatch().then(r => body(r))]);
  assert.equal(workers.reduce((n, result) => n + result.attempted, 0), 1);
  const sent = raw(`select to_jsonb(o) from meals_private.outbox o where id=${lit(row.id)}`);
  assert.equal(sent.status, 'sent'); assert.equal(sent.attempts, 1); assert.equal(sent.envelope, null); assert.equal(sent.lease_token, null); assert(sent.terminal_at);
  assert.equal((await body(await dispatch())).attempted, 0);
  pass('actual protected dispatch HTTP uses one fenced mock lease and erases the terminal envelope');

  const verified = await call({ operation: 'verify', token: mail.verificationToken }); registerSecret(verified.access_token);
  assert.equal(verified.claim.status, 'confirmed');
  await expectError({ operation: 'verify', token: mail.verificationToken }, 403, 'invalid_link');
  const returning = await call({ operation: 'inspect', token: mail.manageToken }); assert.equal(returning.id, row.claim_id);
  const edited = await call({ operation: 'edit', token: mail.manageToken, quantity: 2, version: returning.version }); assert.equal(edited.quantity, 2);
  const context = await call({ operation: 'manager' }, users.mentor); assert(context.claims.some(c => c.id === row.claim_id && c.email === input.email));
  sql(`update public.profiles set active=false where id=${lit(users.mentor.id)}`);
  await expectError({ operation: 'manager' }, 403, 'manager_required', users.mentor);
  sql(`update public.profiles set active=true where id=${lit(users.mentor.id)}`);
  await call({ operation: 'cancel_claim', id: edited.id, version: edited.version, reason: 'Synthetic served Edge cancellation' }, users.mentor);
  await expectError({ operation: 'inspect', token: mail.manageToken }, 403, 'invalid_link');
  pass('served HTTP verifies once, returns management/edit state, rechecks real profiles and revokes cancelled links');

  const expirationMeal = await call({ operation: 'save_meal', meal: syntheticMeal('Synthetic Edge expiry', 1) }, users.admin);
  const expInput = { ...input, meal_id: expirationMeal.id, slot_id: expirationMeal.slots[0].id, email: 'edge-expired@example.invalid', idempotency_key: randomUUID() };
  assert.equal((await call(expInput)).email_status, 'queued');
  const expRow = raw(`select to_jsonb(o) from meals_private.outbox o join meals_private.claims c on c.id=o.claim_id where c.meal_id=${lit(expirationMeal.id)}`);
  sql(`update meals_private.claims set hold_expires_at=clock_timestamp()-interval '1 second' where id=${lit(expRow.claim_id)}`);
  assert.equal((await body(await dispatch())).attempted, 0);
  const expired = raw(`select to_jsonb(o) from meals_private.outbox o where id=${lit(expRow.id)}`);
  assert.equal(expired.status, 'failed'); assert.equal(expired.envelope, null); assert.equal(expired.attempts, 0);
  assert.equal(sql(`select count(*) from meals_private.tokens where claim_id=${lit(expRow.claim_id)} and revoked_at is null`), '0');
  pass('served worker cleans expired queued ciphertext without a mail attempt or revived capability');
  return checks;
}
