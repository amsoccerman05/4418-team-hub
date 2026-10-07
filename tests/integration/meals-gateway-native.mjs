// Request/Response handler + real pg Pool against the owned native cluster.
// Identity callback is an explicit synthetic authority, NOT real Supabase Auth.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgresMealGateway } from '../../supabase/functions/team-meals/postgres-gateway.ts';
import { MockMealMailer } from '../../supabase/functions/team-meals/mail.ts';
import { syntheticMeal } from './meals-fixture.mjs';

export async function runNativeMealsGateway({ pool, sql, id, pass }) {
  let checks = 0;
  const passed = label => { checks++; pass(label); };
  const origin = 'https://meal-fixture.invalid', mailbox = new MockMealMailer();
  const options = { pool, allowedOrigins: [origin], publicBaseUrl: `${origin}/meals.html`, mailer: mailbox,
    authorizeManager: async request => {
      const marker = request.headers.get('authorization');
      // These are deliberately not JWTs. This callback models a verified server
      // identity; real Auth verification remains a separate integration gate.
      return marker === 'Synthetic-mentor' ? { id: id(1) } : marker === 'Synthetic-lead' ? { id: id(3) } : null;
    } };
  const first = createPostgresMealGateway(options), second = createPostgresMealGateway(options);
  const call = async (body, { gateway = first, marker, ip = 'synthetic-gateway-ip', requestOrigin = origin } = {}) => {
    const response = await gateway.handle(new Request(`${origin}/api`, { method: 'POST', headers: {
      Origin: requestOrigin, 'Content-Type': 'application/json', ...(marker ? { Authorization: marker } : {}),
    }, body: JSON.stringify(body) }), { ip });
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    return { status: response.status, body: await response.json() };
  };
  const ok = async (body, options) => { const r = await call(body, options); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const rejected = async (body, status, code, options) => { const r = await call(body, options); assert.equal(r.status, status); assert.equal(r.body.error.code, code); return r.body; };
  const manager = { marker: 'Synthetic-mentor' };
  const make = title => ok({ operation: 'save_meal', meal: syntheticMeal(title, 3) }, manager);
  const input = (m, email, key = randomUUID()) => ({ operation: 'claim', meal_id: m.id, slot_id: m.slots[0].id,
    whole_meal: false, quantity: 1, name: 'Synthetic Gateway Adult', email, idempotency_key: key });
  const lit = s => `'${String(s).replaceAll("'", "''")}'`;
  const count = query => Number(sql(query));
  const privateState = () => sql("select jsonb_build_object('claims',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from meals_private.claims c),'contacts',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from meals_private.parent_contacts c),'outbox',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from meals_private.outbox c),'tokens',(select coalesce(jsonb_agg(to_jsonb(c) order by token_hash),'[]') from meals_private.tokens c),'budget',(select used from meals_private.mail_budget))");

  await rejected({ operation: 'manager' }, 403, 'manager_required');
  await rejected({ operation: 'manager' }, 403, 'manager_required', { marker: 'Synthetic-lead' });
  await rejected({ operation: 'manager', actor: { id: id(1), role: 'admin' } }, 400, 'invalid_input');
  await rejected({ operation: 'list' }, 403, 'origin_forbidden', { requestOrigin: 'https://hostile.invalid' });
  const m = await make('Synthetic durable gateway meal');
  assert.equal(m.slots.length, 1); assert.match(m.id, /^[a-f0-9-]{36}$/);
  const forgedSlot = { ...syntheticMeal('Synthetic forged slot'), slots: [{ ...syntheticMeal().slots[0], id: randomUUID() }] };
  await rejected({ operation: 'save_meal', meal: forgedSlot }, 400, 'invalid_input', manager);
  passed('manager wrapper uses verified subject plus fresh SQL role; malformed actors/origins/slot IDs fail');

  const p = input(m, 'durable-parent@example.invalid'), sentBefore = mailbox.attempts.length;
  const receipts = await Promise.all([ok(p), ok(p, { gateway: second })]);
  assert(receipts.every(r => r.status === 'pending_verification'));
  assert.equal(mailbox.attempts.length, sentBefore + 1);
  assert.equal(count(`select count(*) from meals_private.claims where meal_id=${lit(m.id)}`), 1);
  for (const r of receipts) for (const forbidden of ['claim_id', 'outbox_id', 'can_send', 'replayed']) assert(!(forbidden in r));
  const mail = mailbox.mailbox.at(-1); assert.equal(mail.to, p.email);
  assert.equal(new URL(mail.verificationUrl).search, ''); assert(new URL(mail.verificationUrl).hash.startsWith('#verify='));
  await rejected({ ...p, quantity: 2 }, 409, 'idempotency_conflict');
  const verified = await ok({ operation: 'verify', token: mail.verificationToken });
  await rejected({ operation: 'verify', token: mail.verificationToken }, 403, 'invalid_link');
  assert.equal(verified.claim.status, 'confirmed'); assert(!('email' in verified.claim));
  passed('two independent durable handlers deduplicate HTTP claims/mail and verify exactly once');

  // Recreate every handler-side object. All capabilities, versions and allocations
  // must come back from PostgreSQL, not a remembered in-process repository.
  const recreated = createPostgresMealGateway({ ...options, mailer: new MockMealMailer() });
  const managed = await ok({ operation: 'inspect', token: mail.manageToken }, { gateway: recreated });
  assert.equal(managed.id, verified.claim.id);
  const edited = await ok({ operation: 'edit', token: mail.manageToken, version: managed.version, quantity: 2 }, { gateway: recreated });
  assert.equal(edited.quantity, 2);
  await rejected({ operation: 'edit', token: verified.access_token, version: managed.version, quantity: 1 }, 409, 'version_conflict');
  const publicList = await ok({ operation: 'list' }, { gateway: recreated });
  for (const forbidden of ['durable-parent', 'Synthetic Gateway Adult', 'contact_id', 'token_hash', 'email_status']) assert(!JSON.stringify(publicList).includes(forbidden));
  const snapshot = await ok({ operation: 'manager' }, manager); assert(snapshot.claims.some(c => c.email === p.email));
  await ok({ operation: 'cancel_claim', id: edited.id, version: edited.version, reason: 'Synthetic coordinator cancellation' }, manager);
  await rejected({ operation: 'inspect', token: mail.manageToken }, 403, 'invalid_link', { gateway: recreated });
  passed('recreated handler recovers database-backed manage/edit/cancel state without leaking contacts publicly');

  const failMeal = await make('Synthetic gateway failed delivery'), failInput = input(failMeal, 'durable-failed@example.invalid');
  mailbox.nextOutcome = 'failed'; const failed = await ok(failInput);
  assert.equal(failed.email_status, 'unavailable'); assert.equal(failed.hold_expires_at, null);
  const failedAttempts = mailbox.attempts.length; assert.equal((await ok(failInput)).email_status, 'unavailable'); assert.equal(mailbox.attempts.length, failedAttempts);
  assert.equal(count(`select count(*) from meals_private.claims where meal_id=${lit(failMeal.id)} and status='expired'`), 1);
  const uncertainMeal = await make('Synthetic gateway uncertain delivery'), uncertainInput = input(uncertainMeal, 'durable-uncertain@example.invalid');
  mailbox.nextOutcome = 'throw'; const uncertain = await ok(uncertainInput); assert.equal(uncertain.email_status, 'uncertain');
  const uncertainAttempts = mailbox.attempts.length;
  assert.equal((await ok(uncertainInput, { gateway: second })).email_status, 'uncertain'); assert.equal(mailbox.attempts.length, uncertainAttempts);
  passed('definite failure frees durable capacity; provider uncertainty is retained without retrying mail');

  const budgetMeal = await make('Synthetic zero budget');
  sql('update meals_private.mail_budget set daily_limit=0'); const before = privateState();
  await rejected(input(budgetMeal, 'durable-budget@example.invalid'), 429, 'rate_limited'); assert.equal(privateState(), before);
  sql('update meals_private.mail_budget set daily_limit=500');
  const rawTokens = [mail.verificationToken, mail.manageToken, verified.access_token];
  const stored = sql("select jsonb_build_object('tokens',(select jsonb_agg(to_jsonb(t)) from meals_private.tokens t),'outbox',(select jsonb_agg(to_jsonb(o)) from meals_private.outbox o),'history',(select jsonb_agg(to_jsonb(h)) from meals_private.history h))");
  for (const token of rawTokens) assert(!stored.includes(token));
  passed('budget rejection rolls back private records; tokens/links/bodies are absent from durable tables');

  sql(`update public.profiles set active=false where id='${id(1)}'`);
  await rejected({ operation: 'manager' }, 403, 'manager_required', manager);
  sql(`update public.profiles set active=true where id='${id(1)}'`);
  // Quota charges for invalid operations persist independently of operation
  // rollback and are shared by separate gateway instances/pool connections.
  const quotaIP = `synthetic-quota-${randomUUID()}`;
  await rejected({ operation: 'unknown' }, 400, 'invalid_operation', { ip: quotaIP });
  const digest = createHash('sha256').update(quotaIP).digest('hex');
  assert.equal(count(`select sum(used) from meals_private.rate_windows where kind='request' and key_hash=decode('${digest}','hex')`), 1);
  // Seed both adjacent windows so a minute boundary cannot make this cap check
  // flaky. The prior invalid operation proved independent charge persistence.
  sql(`insert into meals_private.rate_windows(kind,key_hash,window_start,used)
    select 'request',decode('${digest}','hex'),date_trunc('minute',clock_timestamp())+n*interval '1 minute',120 from generate_series(0,1) n
    on conflict(kind,key_hash,window_start) do update set used=120`);
  await rejected({ operation: 'list' }, 429, 'rate_limited', { ip: quotaIP, gateway: second });
  assert.equal(count(`select max(used) from meals_private.rate_windows where kind='request' and key_hash=decode('${digest}','hex')`), 121);
  const connection = await pool.connect();
  try {
    const r = await connection.query("select current_user, current_setting('request.jwt.claim.sub',true) as subject");
    assert.equal(r.rows[0].current_user, 'postgres'); assert(!r.rows[0].subject);
  } finally { connection.release(); }
  passed('fresh role revocation, committed distributed request quota and pooled identity cleanup work');
  return checks;
}
