#!/usr/bin/env node
// Owns one fresh synthetic cluster, private Unix socket, no inherited credentials.
// MEALS_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/meals-concurrency.mjs
// No hosted URL, migration deployment, real parent data, or outbound email.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { installMealsFixture, syntheticMeal } from '../integration/meals-fixture.mjs';
import { SQL_DELIVERY_ENVELOPE, syntheticProviderUsage } from '../helpers/meal-delivery-fixture.ts';

const bin = process.env.MEALS_PG_BIN;
assert(bin && isAbsolute(bin), 'Set MEALS_PG_BIN to an installed local PostgreSQL bin directory');
const root = mkdtempSync(join(tmpdir(), 'meals-native-')), data = join(root, 'db');
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8', TZ: 'UTC' };
// The pg driver used later must not inherit PG*, database URLs, proxies, Node
// options or a developer home. Only this owned Unix socket is a connection target.
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
const args = ['-X', '-h', root, '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const sql = input => execFileSync(join(bin, 'psql'), args, { input, env, encoding: 'utf8', timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }).trim();
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${lit(JSON.stringify(value))}::jsonb`;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hash = value => `decode('${createHash('sha256').update(value).digest('hex')}','hex')`;
const actor = n => `select set_config('request.jwt.claim.sub',${lit(n ? id(n) : '')},false);set role authenticated;`;
const service = 'set role service_role;';
const result = output => JSON.parse(output.split('\n').filter(Boolean).at(-1));
const tables = ['meals', 'slots', 'parent_contacts', 'claims', 'tokens', 'outbox', 'idempotency', 'mail_budget', 'rate_windows', 'history'];
const snapshot = () => sql(`select jsonb_build_object(${tables.map(t => `${lit(t)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from meals_private.${t} t)`).join(',')})`);
const meal = mid => result(sql(`select meals_private.public_meal(${lit(mid)})`));
const claim = cid => result(sql(`select to_jsonb(c) from meals_private.claims c where id=${lit(cid)}`));
const count = query => Number(sql(query));
const save = (draft, who = 1) => `${actor(who)}select public.meals_manager_save(${json(draft)});`;
function draft(mid, extra = {}) { const m = meal(mid); return { ...m, slots: m.slots.map(({ id, label, category, unit, needed }) => ({ id, label, category, unit, needed })), ...extra, whole_meal: undefined }; }
const hold = (m, key, quantity = 1, whole = false) => `${service}select meals_private.create_hold(${lit(m.id)},${whole ? 'null' : lit(m.slots[0].id)},${whole},${quantity},'Synthetic Adult',${lit(`${key}@example.invalid`)},${hash('request:'+key)},${hash('verify:'+key)},${hash('manage:'+key)},${hash('ip:'+key)},${lit(randomUUID())},${lit(randomUUID())},${lit(SQL_DELIVERY_ENVELOPE)},${lit(syntheticProviderUsage())}::jsonb);`;
const verify = key => `${service}select meals_private.verify(${hash('verify:'+key)},${hash('access:'+key)});`;
const change = (key, version, quantity) => `${service}select meals_private.change_claim(${hash('access:'+key)},${version},${quantity},false);`;
const deliveryLeases = new Map();
const beginDelivery = oid => `${service}select coalesce(meals_private.begin_delivery(${lit(oid)},${lit(syntheticProviderUsage())}::jsonb),'null'::jsonb);`;
function leaseDelivery(oid) { const lease=result(sql(beginDelivery(oid))); if(lease)deliveryLeases.set(oid,lease.lease_token);return lease; }
const finishDelivery = oid => `${service}select meals_private.finish_delivery(${lit(oid)},${lit(deliveryLeases.get(oid))},'failed',false,null);`;
function create(title, needed = 2) { return result(sql(save(syntheticMeal(title, needed)))); }
const children = new Set();
let started = false, startAttempted = false, checks = 0, pool, cleanupPromise;
function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const child of children) child.kill('SIGTERM');
    if (pool) await pool.end();
    if (startAttempted) {
      try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'pipe', timeout: 30_000 }); }
      catch (error) {
        const message = String(error.stderr || error.message);
        if (!/PID file .* does not exist|no server running/.test(message)) {
          console.error(`Owned synthetic cluster cleanup failed; retaining ${root}`);
          throw error;
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  })();
  return cleanupPromise;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, async () => { await cleanup(); process.exit(code); });
const pass = label => { checks++; console.log(`PASS Meals: ${label}`); };
function session(name) {
  const child = spawn(join(bin, 'psql'), args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child); let out = '', err = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => { children.delete(child); code ? reject(Error(err || `psql exited ${code}`)) : resolve(out.trim()); });
  });
  done.catch(() => {});
  child.stdin.write("set statement_timeout='15s';set idle_in_transaction_session_timeout='20s';\n");
  return { child, done, output: () => out };
}
function asyncSQL(query, name) { const s = session(name); s.child.stdin.end(`${query}\n`); return s.done; }
async function waitFor(predicate, label) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(`Timed out waiting for ${label}`);
}
async function gate(query, name) {
  const s = session(name); s.child.stdin.write(`begin;${query}select 'MEALS_GATE_READY';\n`);
  await Promise.race([waitFor(() => s.output().includes('MEALS_GATE_READY'), `${name} readiness`), s.done.then(() => { throw Error(`${name} exited before readiness`); })]);
  let released = false;
  return { release: async () => { if (!released) { released = true; s.child.stdin.end('commit;\n\\q\n'); } return s.done; } };
}
const blocked = (...names) => waitFor(() => count(`select count(*) from pg_stat_activity where application_name in (${names.map(lit).join(',')}) and wait_event_type='Lock'`) === names.length, `${names.join(', ')} lock wait`);
const lockMeal = m => `select 1 from meals_private.meals where id=${lit(m.id)} for update;`;
function oneWinner(results, failure) {
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, failure);
}
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], { env, stdio: 'pipe', timeout: 30_000 });
  startAttempted = true;
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start'], { env, stdio: 'pipe', timeout: 30_000 });
  started = true;
  sql(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into public.profiles values
      ('${id(1)}','Synthetic Adult Mentor','mentor',true),('${id(2)}','Synthetic Adult Admin','admin',true),
      ('${id(3)}','Synthetic Lead Fixture','lead',true),('${id(4)}','Synthetic Student Role Fixture','student',true),
      ('${id(5)}','Synthetic Adult Inactive','mentor',false),('${id(6)}','Synthetic Adult Reader','readonly',true);`);
  await installMealsFixture(sql);

  const last = create('Synthetic last serving', 1), firstGate = await gate(lockMeal(last), 'last-gate');
  const lastPair = Promise.allSettled([asyncSQL(hold(last, 'last-a'), 'last-a'), asyncSQL(hold(last, 'last-b'), 'last-b')]);
  await blocked('last-a', 'last-b'); await firstGate.release(); oneWinner(await lastPair, /no longer available/);
  assert.equal(meal(last.id).slots[0].held, 1); assert.equal(count(`select count(*) from meals_private.claims where meal_id=${lit(last.id)}`), 1);
  pass('concurrent parents contest the last serving: one hold, no over-allocation');

  for (const wholeFirst of [true, false]) {
    const m = create(`Synthetic whole/item ${wholeFirst}`), key = `whole-order-${wholeFirst}`;
    const g = await gate(hold(m, key, 1, wholeFirst), key);
    const losing = asyncSQL(hold(m, `${key}-other`, 1, !wholeFirst), `${key}-wait`);
    await blocked(`${key}-wait`); await g.release(); await assert.rejects(losing, /coordinator review/);
    assert.equal(count(`select count(*) from meals_private.claims where meal_id=${lit(m.id)}`), 1);
  }
  pass('whole-meal and item holds exclude each other in both lock orderings');

  const replayMeal = create('Synthetic duplicated request'), replayGate = await gate(lockMeal(replayMeal), 'replay-gate');
  const usedBefore = count('select used from meals_private.mail_budget');
  const replays = Promise.all([asyncSQL(hold(replayMeal, 'same-request'), 'replay-a'), asyncSQL(hold(replayMeal, 'same-request'), 'replay-b')]); replays.catch(() => {});
  await blocked('replay-a', 'replay-b'); await replayGate.release(); const receipts = (await replays).map(result);
  assert.equal(receipts[0].claim_id, receipts[1].claim_id); assert.deepEqual(receipts.map(r => r.replayed).sort(), [false, true]);
  assert.equal(count('select used from meals_private.mail_budget'), usedBefore + 1);
  const receipt = receipts.find(r => !r.replayed), leaseGate = await gate(lockMeal(replayMeal), 'lease-gate');
  const leases = Promise.all([asyncSQL(beginDelivery(receipt.outbox_id), 'lease-a'), asyncSQL(beginDelivery(receipt.outbox_id), 'lease-b')]); leases.catch(() => {});
  await blocked('lease-a', 'lease-b'); await leaseGate.release(); const winners=(await leases).map(result);assert.equal(winners.filter(Boolean).length,1);assert(winners.find(Boolean).lease_token);
  pass('simultaneous duplicate request and dispatch leases reserve/budget/send at most once');

  const recoveryMeal = create('Synthetic fenced retry', 1), recoverHold = result(sql(hold(recoveryMeal, 'fenced-retry')));
  const recoveryBudget = count('select used from meals_private.mail_budget');
  const firstLease = leaseDelivery(recoverHold.outbox_id);
  sql(`update meals_private.outbox set lease_until=clock_timestamp()-interval '1 second' where id=${lit(recoverHold.outbox_id)}`);
  const secondLease = leaseDelivery(recoverHold.outbox_id);
  assert.equal(secondLease.envelope, firstLease.envelope); assert.equal(secondLease.idempotency_key, firstLease.idempotency_key);
  assert.notEqual(secondLease.lease_token, firstLease.lease_token); assert.equal(secondLease.attempts, 2);
  const fencedGate = await gate(lockMeal(recoveryMeal), 'fenced-gate');
  const finish = lease => `${service}select meals_private.finish_delivery(${lit(lease.id)},${lit(lease.lease_token)},'sent',false,'synthetic-provider-id');`;
  const finishes = Promise.all([asyncSQL(finish(firstLease), 'stale-finish'), asyncSQL(finish(secondLease), 'current-finish')]); finishes.catch(() => {});
  await blocked('stale-finish', 'current-finish'); await fencedGate.release(); assert.deepEqual(await finishes, ['f', 't']);
  const recovered = result(sql(`select to_jsonb(o) from meals_private.outbox o where id=${lit(recoverHold.outbox_id)}`));
  assert.equal(recovered.status, 'sent'); assert.equal(recovered.envelope, null); assert.equal(recovered.lease_token, null);
  assert.equal(count('select used from meals_private.mail_budget'), recoveryBudget);
  pass('expired lease recovers identical encrypted payload/key; stale completion loses the fence without a second reservation');

  const exp = create('Synthetic verify expiry', 1), held = result(sql(hold(exp, 'expired')));
  const expGate = await gate(`update meals_private.claims set hold_expires_at=clock_timestamp()-interval '1 second' where id=${lit(held.claim_id)};${lockMeal(exp)}`, 'expiry-gate');
  const expiredVerify = asyncSQL(verify('expired'), 'expired-verify'); await blocked('expired-verify'); await expGate.release(); await assert.rejects(expiredVerify, /expired link/);
  sql(hold(exp, 'replacement')); assert.equal(claim(held.claim_id).status, 'expired'); assert.equal(meal(exp.id).slots[0].held, 1);
  assert.equal(count(`select count(*) from meals_private.tokens where claim_id=${lit(held.claim_id)} and revoked_at is null`), 0);
  const confirmedMeal = create('Synthetic verified before cleanup', 1), confirmedHold = result(sql(hold(confirmedMeal, 'confirmed-cleanup')));
  const confirmedGate = await gate(verify('confirmed-cleanup'), 'verified-gate');
  const cleanupLoser = asyncSQL(hold(confirmedMeal, 'cleanup-other'), 'cleanup-wait'); await blocked('cleanup-wait'); await confirmedGate.release(); await assert.rejects(cleanupLoser, /no longer available/);
  assert.equal(claim(confirmedHold.claim_id).status, 'confirmed'); assert.equal(meal(confirmedMeal.id).slots[0].confirmed, 1);
  pass('expired verification cannot revive capacity; committed verification survives competing cleanup');

  for (const cancel of [false, true]) {
    const m = create(`Synthetic stale manager ${cancel}`, 2), p = draft(m.id, cancel ? { status: 'cancelled', acknowledge_cancellation: true, cancellation_reason: 'Synthetic cancellation' } : {});
    if (!cancel) p.slots[0].needed = 1;
    const g = await gate(hold(m, `before-manager-${cancel}`, 2), `claim-before-${cancel}`);
    const stale = asyncSQL(save(p), `manager-wait-${cancel}`); await blocked(`manager-wait-${cancel}`); await g.release(); await assert.rejects(stale, /Meal changed/);
    assert.equal(meal(m.id).status, 'open'); assert.equal(meal(m.id).slots[0].needed, 2); assert.equal(meal(m.id).slots[0].held, 2);
  }
  for (const cancel of [false, true]) {
    const m = create(`Synthetic manager before claim ${cancel}`, 2), p = draft(m.id, cancel ? { status: 'cancelled', cancellation_reason: 'Synthetic cancellation' } : {});
    if (!cancel) p.slots[0].needed = 1;
    const g = await gate(save(p), `manager-first-${cancel}`);
    const stale = asyncSQL(hold(m, `after-manager-${cancel}`, 2), `claim-wait-${cancel}`); await blocked(`claim-wait-${cancel}`); await g.release(); await assert.rejects(stale, cancel ? /not accepting/ : /no longer available/);
    assert.equal(count(`select count(*) from meals_private.claims where meal_id=${lit(m.id)}`), 0);
  }
  pass('claim versus capacity reduction/cancellation is safe in both orders; stale acknowledgement fails');

  const quantity = create('Synthetic quantity race', 2); sql(hold(quantity, 'quantity-owner')); const verified = result(sql(verify('quantity-owner')));
  const quantityGate = await gate(lockMeal(quantity), 'quantity-gate');
  const quantityPair = Promise.allSettled([asyncSQL(change('quantity-owner', verified.version, 2), 'quantity-edit'), asyncSQL(hold(quantity, 'quantity-other'), 'quantity-hold')]);
  await blocked('quantity-edit', 'quantity-hold'); await quantityGate.release(); oneWinner(await quantityPair, /no longer available/);
  const allocation = meal(quantity.id).slots[0]; assert.equal(allocation.held + allocation.confirmed, 2);
  pass('quantity increase and another parent claim cannot both consume the last serving');

  for (const verifyFirst of [true, false]) {
    const m = create(`Synthetic failure versus verify ${verifyFirst}`, 1), key = `failure-order-${verifyFirst}`, h = result(sql(hold(m, key))); leaseDelivery(h.outbox_id);
    const g = await gate(verifyFirst ? verify(key) : finishDelivery(h.outbox_id), `failure-first-${verifyFirst}`);
    const other = asyncSQL(verifyFirst ? finishDelivery(h.outbox_id) : verify(key), `failure-wait-${verifyFirst}`);
    await blocked(`failure-wait-${verifyFirst}`); await g.release();
    if (verifyFirst) { await other; assert.equal(claim(h.claim_id).status, 'confirmed'); assert.equal(result(sql(`${service}select meals_private.inspect(${hash('manage:'+key)});`)).id, h.claim_id); }
    else { await assert.rejects(other, /expired link/); assert.equal(claim(h.claim_id).status, 'expired'); assert.equal(count(`select count(*) from meals_private.tokens where claim_id=${lit(h.claim_id)} and revoked_at is null`), 0); sql(hold(m, `${key}-replacement`)); }
    const before = snapshot(); sql(finishDelivery(h.outbox_id)); assert.equal(snapshot(), before);
  }
  pass('definite failure frees pending capacity once; verification-first preserves pledge and capabilities');

  const fresh = create('Synthetic fresh authorization'), staleDraft = draft(fresh.id, { title: 'Must not be written' });
  const revokeGate = await gate(`update public.profiles set active=false where id='${id(1)}';`, 'profile-revoke');
  const deniedSave = asyncSQL(save(staleDraft), 'revoked-save'); await blocked('revoked-save'); await revokeGate.release(); const afterRevoke = snapshot();
  await assert.rejects(deniedSave, /coordinator access required/); assert.equal(snapshot(), afterRevoke); sql(`update public.profiles set active=true where id='${id(1)}'`);
  const authGate = await gate(save(draft(fresh.id, { title: 'Authorized before revocation' })), 'authorized-manager');
  const queuedRevoke = asyncSQL(`update public.profiles set role='readonly' where id='${id(1)}';`, 'queued-revoke'); await blocked('queued-revoke'); await authGate.release(); await queuedRevoke;
  await assert.rejects(asyncSQL(`${actor(1)}select public.meals_manager_context();`, 'after-revoke'), /coordinator access required/); sql(`update public.profiles set role='mentor' where id='${id(1)}'`);
  pass('profile revocation-first rejects queued manager; authorized transaction holds profile lock until commit');

  const beforeDenied = snapshot();
  for (const who of [3, 4, 5, 6, null]) await assert.rejects(asyncSQL(save(syntheticMeal('Forbidden'), who), `deny-${who}`), /coordinator access required/);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of tables) {
      await assert.rejects(asyncSQL(`set role ${role};select * from meals_private.${table};`, `deny-read-${role}-${table}`), /permission denied/);
      await assert.rejects(asyncSQL(`set role ${role};delete from meals_private.${table};`, `deny-write-${role}-${table}`), /permission denied/);
    }
    await assert.rejects(asyncSQL(`set role ${role};select meals_private.manager();`, `deny-helper-${role}`), /permission denied/);
  }
  for (const role of ['anon', 'service_role']) await assert.rejects(asyncSQL(`set role ${role};select public.meals_manager_context();`, `deny-public-manager-${role}`), /permission denied/);
  for (const role of ['anon', 'authenticated']) await assert.rejects(asyncSQL(`set role ${role};select meals_private.list_public();`, `deny-service-helper-${role}`), /permission denied/);
  assert.equal(snapshot(), beforeDenied);
  assert.equal(count("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='meals_private' and c.relkind='r' and c.relrowsecurity"), 10);
  assert.equal(count("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='meals_private' and has_function_privilege('anon',p.oid,'EXECUTE')"), 0);
  assert.equal(sql('begin;grant usage on schema meals_private to authenticated;grant select on all tables in schema meals_private to authenticated;set local role authenticated;select count(*) from meals_private.parent_contacts;rollback;'), '0');
  pass('all base tables enforce private grants/RLS; wrong roles and accidental browser SELECT grant fail closed');

  const rollbackMeal = create('Synthetic atomic rollback', 1), beforeRollback = snapshot();
  sql("create function meals_private.test_fail_audit() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure'; end$$;create trigger test_fail_audit before insert on meals_private.history for each row execute function meals_private.test_fail_audit();");
  await assert.rejects(asyncSQL(hold(rollbackMeal, 'audit-rollback'), 'audit-rollback'), /Synthetic audit failure/);
  assert.equal(snapshot(), beforeRollback); sql('drop trigger test_fail_audit on meals_private.history;drop function meals_private.test_fail_audit();');
  const publicList = sql(`${service}select meals_private.list_public();`);
  for (const forbidden of ['@example.invalid', 'Synthetic Adult', 'contact_id', 'token_hash', 'email_status', 'claim_id']) assert(!publicList.includes(forbidden));
  pass('audit failure rolls back hold/contact/token/outbox/budget atomically; public projection stays anonymous');

  const { Pool } = await import('pg');
  pool = new Pool({ host: root, port: 5432, user: 'postgres', database: 'postgres', password: '', ssl: false, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const { runNativeMealsGateway } = await import('../integration/meals-gateway-native.mjs');
  checks += await runNativeMealsGateway({ pool, sql, id, pass: label => console.log(`PASS Meals gateway: ${label}`) });
  console.log(`${checks} Meals native PostgreSQL / durable gateway checks passed; isolated PostgreSQL ${sql('show server_version')}. Synthetic auth.uid fixture only; real Supabase Auth/PostgREST not asserted.`);
} catch (error) {
  if (!started) { try { console.error(readFileSync(join(root, 'server.log'), 'utf8')); } catch {} }
  throw error;
} finally {
  await cleanup();
}
