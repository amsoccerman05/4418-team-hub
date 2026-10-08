// Opt-in extension of the OWNED disposable fabrication-local.mjs stack.
// Real local Auth + PostgREST + native pg Pool. No hosted URL or outbound mail.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { localFetch, localURL, ORIGIN, API_PORT, DB_PORT } from './fabrication-safety.mjs';
import { installMealsFixture, syntheticMeal } from './meals-fixture.mjs';
import { createMealManagerVerifier } from '../../supabase/functions/team-meals/auth.ts';
import { createPostgresMealGateway } from '../../supabase/functions/team-meals/postgres-gateway.ts';
import { MockMealMailer } from '../../supabase/functions/team-meals/mail.ts';

export async function runMealsIntegration({ base, anonKey, sql, registerSecret, edge }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable Auth stack is supported');
  const authBefore = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authBefore.includes('test.uid'), 'Real Supabase Auth is required');
  assert(sql("select to_regclass('auth.users')") === 'auth.users');
  await installMealsFixture(sql);
  sql("notify pgrst, 'reload schema';");
  const checks = [], pass = label => { const message = `Meals real Auth/API: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const lit = value => `'${String(value).replaceAll("'", "''")}'`;
  const headers = user => ({ apikey: anonKey, Origin: ORIGIN, ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });
  const request = (path, body, user) => localFetch(base, path, { method: 'POST', headers: { ...headers(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const parse = async (response, expected = 200) => { const body = await response.json(); assert.equal(response.status, expected, `Meals HTTP ${response.status}; code=${body?.code || body?.error?.code || 'unspecified'}`); return body; };
  const rpc = (name, body, user) => request(`/rest/v1/rpc/${name}`, body, user);
  const users = {};
  for (const [name, role] of [['mentor', 'mentor'], ['admin', 'admin'], ['lead', 'lead'], ['student', 'student']]) {
    const email = `meals-${name}-${randomUUID()}@example.invalid`, password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await parse(await request('/auth/v1/signup', { email, password, data: { role: 'admin', active: true } }));
    assert(signup.user?.id && signup.access_token, 'Synthetic Auth signup must issue a session');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    const login = await parse(await request('/auth/v1/token?grant_type=password', { email, password }));
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    assert.equal(login.user.id, signup.user.id);
    users[name] = { id: login.user.id, token: login.access_token };
    assert.equal((await parse(await localFetch(base, '/auth/v1/user', { headers: headers(users[name]) }))).id, login.user.id);
    sql(`insert into public.profiles(id,display_name,role,active) values(${lit(login.user.id)},${lit(`Synthetic Adult Meals ${name} role`)},${lit(role)},true)`);
  }
  // Schema-cache readiness uses the real wrapper and a non-manager session.
  const deadline = Date.now() + 15_000;
  while (true) {
    const response = await rpc('meals_manager_context', {}, users.student), body = await response.json();
    if (body.code !== 'PGRST202') { assert.equal(response.status, 403); assert.equal(body.code, '42501'); break; }
    assert(Date.now() < deadline, 'Meals manager RPC did not enter the PostgREST schema cache');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  pass('four synthetic identities sign up/login through real Auth; real public RPC reaches authorization');

  // Every connection parameter is literal synthetic configuration for this owned
  // stack. No connectionString, hosted address or environment credential is used.
  const pool = new Pool({ host: '127.0.0.1', port: DB_PORT, database: 'postgres', user: 'postgres', password: 'postgres', ssl: false,
    options: '-c statement_timeout=15000 -c idle_in_transaction_session_timeout=20000', application_name: 'meals-owned-auth-integration', max: 6, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  try {
    let authCalls = 0;
    const authorizeManager = createMealManagerVerifier({ authBaseUrl: base, publicApiKey: anonKey, fetcher: (url, init) => {
      const target = new URL(url); assert.equal(target.origin, base); assert.equal(target.pathname, '/auth/v1/user'); assert.equal(target.search, '');
      authCalls++; return localFetch(base, target.pathname, init);
    } });
    const mailer = new MockMealMailer(), gateway = createPostgresMealGateway({ pool, allowedOrigins: [ORIGIN], publicBaseUrl: `${ORIGIN}/meals.html`, mailer, authorizeManager });
    const call = async (body, user) => {
      const response = await gateway.handle(new Request(`${ORIGIN}/meal-api`, { method: 'POST', headers: { ...headers(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { ip: 'synthetic-owned-api-client' });
      return { status: response.status, body: await response.json() };
    };
    const ok = async (body, user) => { const r = await call(body, user); assert.equal(r.status, 200, `Meals handler code=${r.body.error?.code || 'unspecified'}`); return r.body; };
    const denied = async (body, user) => { const r = await call(body, user); assert.equal(r.status, 403); assert.equal(r.body.error.code, 'manager_required'); };
    for (const user of [undefined, users.lead, users.student]) await denied({ operation: 'manager' }, user);
    const forged = { token: `unsigned.${Buffer.from(JSON.stringify({ sub: users.mentor.id, role: 'authenticated', user_metadata: { role: 'admin' } })).toString('base64url')}.signature` };
    await denied({ operation: 'manager' }, forged);
    const created = await ok({ operation: 'save_meal', meal: syntheticMeal('Synthetic real Auth meal', 2) }, users.mentor);
    assert.equal(created.slots.length, 1);
    await ok({ operation: 'manager' }, users.admin);
    assert(authCalls >= 5, 'Manager calls must verify at Auth instead of decoding claims');
    const realContext = await parse(await rpc('meals_manager_context', {}, users.mentor));
    assert(realContext.meals.some(m => m.id === created.id));
    pass('actual Auth verifier + native SQL authorizes mentor/admin; lead/student/forged metadata and fake tokens fail');

    sql(`update public.profiles set active=false where id=${lit(users.mentor.id)}`);
    await denied({ operation: 'manager' }, users.mentor);
    const inactive = await rpc('meals_manager_context', {}, users.mentor); assert.equal(inactive.status, 403); assert.equal((await inactive.json()).code, '42501');
    sql(`update public.profiles set active=true,role='readonly' where id=${lit(users.mentor.id)}`);
    await denied({ operation: 'manager' }, users.mentor);
    sql(`update public.profiles set role='mentor' where id=${lit(users.mentor.id)}`);
    await ok({ operation: 'manager' }, users.mentor);
    pass('same real Auth session loses coordinator access immediately on profile deactivation or role downgrade');

    for (const user of [undefined, users.student, users.mentor]) {
      const schema = await localFetch(base, '/rest/v1/parent_contacts?select=*', { headers: { ...headers(user), 'Accept-Profile': 'meals_private' } });
      assert.equal(schema.status, 406); assert.equal((await schema.json()).code, 'PGRST106');
      const write = await localFetch(base, '/rest/v1/claims', { method: 'POST', headers: { ...headers(user), 'Content-Type': 'application/json', 'Content-Profile': 'meals_private' }, body: '{}' });
      assert.equal(write.status, 406); assert.equal((await write.json()).code, 'PGRST106');
      const helper = await rpc('create_hold', {}, user); assert.equal(helper.status, 404); assert.equal((await helper.json()).code, 'PGRST202');
    }
    const anonManager = await rpc('meals_manager_context', {}, undefined); assert.equal(anonManager.status, 401); assert.equal((await anonManager.json()).code, '42501');
    pass('PostgREST does not expose private schema/base rows/helpers; anonymous manager RPC is denied');

    const claim = { operation: 'claim', meal_id: created.id, slot_id: created.slots[0].id, whole_meal: false, quantity: 1,
      name: 'Synthetic Auth Smoke Adult', email: 'auth-smoke-parent@example.invalid', idempotency_key: randomUUID() };
    assert.equal((await ok(claim)).email_status, 'sent'); assert.equal(mailer.mailbox.length, 1);
    const captured = mailer.mailbox[0], verified = await ok({ operation: 'verify', token: captured.verificationToken });
    assert.equal(verified.claim.status, 'confirmed');
    const context = await parse(await rpc('meals_manager_context', {}, users.admin));
    const managed = context.claims.find(c => c.id === verified.claim.id); assert.equal(managed.email, claim.email);
    const cancelled = await rpc('meals_manager_cancel_claim', { p_claim: managed.id, p_version: managed.version, p_reason: 'Synthetic real API cancellation' }, users.admin);
    assert.equal(cancelled.status, 204); await cancelled.text();
    // PostgREST void returns an empty response, so cancellation is also verified
    // by the durable gateway rather than trusting response status alone.
    const closed = await call({ operation: 'inspect', token: captured.manageToken }); assert.equal(closed.status, 403); assert.equal(closed.body.error.code, 'invalid_link');
    assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authBefore);
    pass('durable signup/verification appears in real manager RPC; real API cancellation revokes capability; mock mail only');
  } finally { await pool.end(); }
  if (edge) {
    const { runMealsEdgeIntegration } = await import('./meals-edge.spec.mjs');
    checks.push(...await runMealsEdgeIntegration({ base, anonKey, sql, users, registerSecret, ...edge }));
  }
  return checks;
}
