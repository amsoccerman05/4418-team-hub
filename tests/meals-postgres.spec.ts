import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresMealGateway, digestBytes } from '../supabase/functions/team-meals/postgres-gateway';
import { PostgresMealDatabase, type MealSqlConnection, type MealSqlPool } from '../supabase/functions/team-meals/postgres';
import { MockMealMailer } from '../supabase/functions/team-meals/mail';
import type { MealDraft, PublicMeal } from '../src/meals/types';
import inertHandler from '../supabase/functions/team-meals/index';
import { syntheticMailApproval } from './helpers/meal-delivery-fixture.ts';

const ORIGIN = 'https://meals.example.invalid';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite, pool: MealSqlPool, mailer: MockMealMailer, gateway: ReturnType<typeof createPostgresMealGateway>, meal: PublicMeal;
let leaseCount = 0;
const actor = (request: Request) => Promise.resolve(request.headers.get('authorization') === 'Bearer synthetic-mentor' ? { id: id(1) } : request.headers.get('authorization') === 'Bearer synthetic-student' ? { id: id(3) } : null);
/** PGlite has one connection: exclusive leases model a pool without interleaving
 * statements from different transactions. Native multi-connection tests are separate. */
function pglitePool(current: () => PGlite): MealSqlPool {
    let tail = Promise.resolve();
    return { async connect() {
        let release!: () => void;
        const previous = tail;
        tail = new Promise<void>(resolve => { release = resolve; });
        await previous; leaseCount++;
        return { query: async <Row>(sql: string, values: unknown[] = []) => {
            const result = await current().query<Row>(sql, values);
            return { rows: result.rows };
        }, release };
    } };
}
function makeGateway(extra: Partial<Parameters<typeof createPostgresMealGateway>[0]> = {}) {
    return createPostgresMealGateway({ pool, allowedOrigins: [ORIGIN], publicBaseUrl: `${ORIGIN}/meals.html`, mailer, authorizeManager: actor, ...extra });
}
function draft(): MealDraft {
    const saturday = new Date(Date.now() + 14 * 86400000);
    saturday.setUTCDate(saturday.getUTCDate() + (6 - saturday.getUTCDay() + 7) % 7); saturday.setUTCHours(12, 0, 0, 0);
    return { title: 'Synthetic Saturday lunch', service_at: saturday.toISOString(), timezone: 'UTC', expected_headcount: 40, guidance: 'Label ingredients; contact the coordinator privately.', status: 'open', slots: [{ label: 'Sandwiches', category: 'main', unit: 'servings', needed: 10 }, { label: 'Water', category: 'drink', unit: 'bottles', needed: 30 }] };
}
const slot = () => meal.slots.find(s => s.category === 'main')!.id;
function claim(extra: Record<string, unknown> = {}) {
    return { operation: 'claim', meal_id: meal.id, slot_id: slot(), whole_meal: false, quantity: 2, name: 'Synthetic Adult', email: 'adult@example.invalid', idempotency_key: 'synthetic-request-key-0001', website: '', ...extra };
}
async function call(body: unknown, options: { manager?: boolean; student?: boolean; ip?: string; origin?: string; headers?: Record<string, string>; use?: typeof gateway } = {}) {
    const request = new Request(`${ORIGIN}/api`, { method: 'POST', headers: { Origin: options.origin ?? ORIGIN, 'Content-Type': 'application/json', ...(options.manager ? { Authorization: 'Bearer synthetic-mentor' } : options.student ? { Authorization: 'Bearer synthetic-student' } : {}), ...options.headers }, body: JSON.stringify(body) });
    const response = await (options.use ?? gateway).handle(request, { ip: options.ip ?? 'synthetic-trusted-ip' });
    return { status: response.status, body: await response.json() as any, response };
}
async function raw<Row = Record<string, any>>(sql: string, values: unknown[] = []): Promise<Row[]> { return (await db.query<Row>(sql, values)).rows; }
async function verified(extra: Record<string, unknown> = {}) {
    expect((await call(claim(extra))).status).toBe(200);
    const mail = mailer.mailbox.at(-1)!;
    const result = await call({ operation: 'verify', token: mail.verificationToken });
    expect(result.status).toBe(200);
    return { mail, token: result.body.access_token as string, claim: result.body.claim };
}
async function seed() {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.profiles(id uuid primary key, role text, active boolean);
      insert into public.profiles values('${id(1)}', 'mentor', true), ('${id(2)}', 'admin', true), ('${id(3)}', 'student', true);`);
    await db.exec(readFileSync('supabase/drafts/saturday-meals.sql', 'utf8'));
    await db.exec(syntheticMailApproval(100));
    meal = await new PostgresMealDatabase(pool).saveMeal({ id: id(1) }, draft());
}
test.beforeEach(async () => { db = new PGlite(); leaseCount = 0; pool = pglitePool(() => db); mailer = new MockMealMailer(); gateway = makeGateway(); await seed(); });
test.afterEach(async () => { await db.close(); });

test('HTTP to SQL claim/verify/edit/cancel persists across new handlers and exposes coverage only', async () => {
    const receipt = await call(claim()); expect(receipt.status).toBe(200);
    expect(Object.keys(receipt.body).sort()).toEqual(['email_status', 'hold_expires_at', 'message', 'status']);
    expect(receipt.body.email_status).toBe('sent'); expect(mailer.attempts).toHaveLength(1);
    const list = await call({ operation: 'list' });
    expect(list.body[0].slots.find((s: any) => s.id === slot())).toMatchObject({ held: 2, confirmed: 0, remaining: 8 });
    for (const privateValue of ['Synthetic Adult', 'adult@example.invalid', 'claim_id', 'token', 'email_status']) expect(JSON.stringify(list.body)).not.toContain(privateValue);
    gateway = makeGateway();
    const result = await call({ operation: 'verify', token: mailer.mailbox[0].verificationToken }); expect(result.status).toBe(200);
    const token = result.body.access_token;
    expect((await call({ operation: 'verify', token: mailer.mailbox[0].verificationToken })).status).toBe(403);
    const inspected = await call({ operation: 'inspect', token }); expect(inspected.body.id).toBe(result.body.claim.id); expect(inspected.body.email).toBeUndefined();
    const edited = await call({ operation: 'edit', token, version: inspected.body.version, quantity: 4 }); expect(edited.body.quantity).toBe(4);
    expect((await call({ operation: 'edit', token, version: inspected.body.version, quantity: 3 })).body.error.code).toBe('version_conflict');
    expect((await call({ operation: 'cancel', token, version: edited.body.version })).body.status).toBe('cancelled');
    expect((await call({ operation: 'inspect', token })).status).toBe(403);
    expect((await raw('select status from meals_private.claims'))[0].status).toBe('cancelled');
    expect((await call({ operation: 'list' })).body[0].slots.find((s: any) => s.id === slot()).remaining).toBe(10);
});

test('hash-only capabilities stay scoped and management links survive short-session expiry', async () => {
    const first = await verified(); const second = await verified({ email: 'other@example.invalid', idempotency_key: 'synthetic-request-key-0002' });
    expect((await call({ operation: 'inspect', token: first.mail.verificationToken })).status).toBe(403);
    expect((await call({ operation: 'inspect', token: first.token, id: second.claim.id })).status).toBe(400);
    const records = await raw('select encode(token_hash,\'hex\') hash, purpose from meals_private.tokens');
    expect(records.every(row => /^[a-f0-9]{64}$/.test(row.hash))).toBe(true);
    const storage = JSON.stringify(await raw(`select row_to_json(x) data from meals_private.tokens x union all select row_to_json(x) from meals_private.outbox x union all select row_to_json(x) from meals_private.idempotency x`));
    for (const token of [first.token, first.mail.verificationToken, first.mail.manageToken]) expect(storage).not.toContain(token);
    await raw("update meals_private.tokens set expires_at=clock_timestamp()-interval '1 second', created_at=clock_timestamp()-interval '1 day' where purpose='access'");
    expect((await call({ operation: 'inspect', token: first.token })).status).toBe(403);
    expect((await call({ operation: 'inspect', token: first.mail.manageToken })).body.id).toBe(first.claim.id);
    const edited = await call({ operation: 'edit', token: first.mail.manageToken, version: first.claim.version, quantity: 3 }); expect(edited.status).toBe(200);
    expect((await call({ operation: 'cancel', token: first.mail.manageToken, version: edited.body.version })).status).toBe(200);
    expect((await call({ operation: 'inspect', token: second.mail.manageToken })).body.id).toBe(second.claim.id);
});

test('concurrent HTTP claims use SQL capacity/budget locks and leave no partial failed reservations', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, n) => call(claim({ email: `adult${n}@example.invalid`, quantity: 3 }), { ip: `ip-${n}` })));
    expect(results.filter(r => r.status === 200)).toHaveLength(3);
    expect(results.filter(r => r.body.error?.code === 'capacity_changed')).toHaveLength(5);
    expect(mailer.attempts).toHaveLength(3);
    for (const table of ['claims', 'parent_contacts', 'idempotency', 'outbox']) expect((await raw(`select count(*)::int n from meals_private.${table}`))[0].n).toBe(3);
    expect((await raw('select used from meals_private.mail_budget'))[0].used).toBe(3);
    expect((await call({ operation: 'list' })).body[0].slots.find((s: any) => s.id === slot()).remaining).toBe(1);
});

test('same idempotency key replays once, rejects body mismatch, and retained tombstones do not resend', async () => {
    const input = claim();
    const results = await Promise.all(Array.from({ length: 5 }, () => call(input)));
    expect(results.every(r => r.status === 200)).toBe(true); expect(mailer.attempts).toHaveLength(1);
    expect((await call({ ...input, quantity: 4 })).body.error.code).toBe('idempotency_conflict');
    await raw("update meals_private.idempotency set expires_at=clock_timestamp()-interval '1 day'");
    gateway = makeGateway(); expect((await call(input)).status).toBe(200); expect(mailer.attempts).toHaveLength(1);
    expect((await call({ ...input, email: 'different@example.invalid' })).status).toBe(200); expect(mailer.attempts).toHaveLength(2);
});

test('manager authority comes from verified subject plus fresh SQL profiles, never request data', async () => {
    const adult = await verified();
    expect((await call({ operation: 'manager' })).status).toBe(403);
    expect((await call({ operation: 'manager' }, { student: true })).status).toBe(403);
    expect((await call({ operation: 'manager', actor_id: id(1) }, { student: true })).status).toBe(400);
    const manager = await call({ operation: 'manager' }, { manager: true }); expect(manager.body.claims[0].email).toBe('adult@example.invalid'); expect(manager.body.mail_mode).toBe('mock');
    await raw('update public.profiles set active=false where id=$1', [id(1)]);
    expect((await call({ operation: 'manager' }, { manager: true })).status).toBe(403);
    expect((await call({ operation: 'cancel_claim', id: adult.claim.id, version: adult.claim.version, reason: 'Synthetic cancellation' }, { manager: true })).status).toBe(403);
    await raw('update public.profiles set active=true where id=$1', [id(1)]);
    expect((await call({ operation: 'cancel_claim', id: adult.claim.id, version: adult.claim.version, reason: 'Synthetic cancellation' }, { manager: true })).status).toBe(200);
    expect((await call({ operation: 'inspect', token: adult.token })).status).toBe(403);
    expect((await raw("select actor_id from meals_private.history where action='coordinator_cancelled'"))[0].actor_id).toBe(id(1));
    const claims = (await raw("select current_setting('request.jwt.claim.sub',true) subject, current_setting('request.jwt.claims',true) claims, current_user as role"))[0];
    expect(claims.subject ?? '').toBe(''); expect(claims.claims ?? '').toBe(''); expect(claims.role).not.toBe('authenticated');
});

test('manager creates server IDs and stale cancellation cannot affect unreviewed claims', async () => {
    const created = await call({ operation: 'save_meal', meal: draft() }, { manager: true }); expect(created.status).toBe(200); expect(created.body.id).toMatch(/^[a-f0-9-]{36}$/);
    const forged = { ...draft(), slots: draft().slots.map(s => ({ ...s, id: id(99) })) };
    expect((await call({ operation: 'save_meal', meal: forged }, { manager: true })).status).toBe(400);
    const reviewed = await call({ operation: 'manager' }, { manager: true }); const before = reviewed.body.meals.find((m: PublicMeal) => m.id === meal.id);
    await verified();
    const cancelled = await call({ operation: 'save_meal', meal: { ...draft(), id: meal.id, version: before.version, slots: meal.slots.map(({ id, label, unit, category, needed }) => ({ id, label, unit, category, needed })), status: 'cancelled', cancellation_reason: 'Synthetic cancellation', acknowledge_cancellation: true } }, { manager: true });
    expect(cancelled.body.error.code).toBe('version_conflict'); expect((await raw('select status from meals_private.claims'))[0].status).toBe('confirmed');
});

for (const outcome of ['failed', 'uncertain', 'throw'] as const) test(`mail ${outcome} is durably recorded and never blindly retried`, async () => {
    mailer.nextOutcome = outcome;
    const first = await call(claim()); expect(first.status).toBe(200); expect(first.body.email_status).toBe(outcome === 'failed' ? 'unavailable' : 'uncertain');
    gateway = makeGateway(); const retry = await call(claim()); expect(retry.body).toEqual(first.body); expect(mailer.attempts).toHaveLength(1);
    expect((await raw('select status from meals_private.outbox'))[0].status).toBe(outcome === 'failed' ? 'failed' : 'uncertain');
    expect((await raw('select status from meals_private.claims'))[0].status).toBe(outcome === 'failed' ? 'expired' : 'pending');
});

test('a crash after durable delivery lease cannot send a replacement link on retry', async () => {
    const brokenPool: MealSqlPool = { async connect() { const connection = await pool.connect(); return { query: async <Row>(sql: string, values?: unknown[]) => { if (sql.includes('finish_delivery')) throw new Error('synthetic post-send outage'); return connection.query<Row>(sql, values); }, release: error => connection.release(error) }; } };
    const first = await call(claim(), { use: makeGateway({ pool: brokenPool }) }); expect(first.status).toBe(503); expect(mailer.attempts).toHaveLength(1);
    expect((await raw('select status from meals_private.outbox'))[0].status).toBe('uncertain');
    expect((await call(claim())).body.email_status).toBe('uncertain'); expect(mailer.attempts).toHaveLength(1);
});

test('Origin, bounded body, strict fields, trusted transport IP and distributed request quota remain enforced', async () => {
    const before = leaseCount;
    const denied = await call({ operation: 'list' }, { origin: 'https://evil.invalid' }); expect(denied.status).toBe(403); expect(denied.response.headers.get('Access-Control-Allow-Origin')).toBeNull(); expect(leaseCount).toBe(before);
    const response = await gateway.handle(new Request(`${ORIGIN}/api`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'list', padding: 'x'.repeat(17000) }) })); expect(response.status).toBe(413);
    expect((await call({ operation: 'inspect', token: 'bad' })).status).toBe(403);
    expect((await call({ ...claim(), name: 'Line\nInjected' })).status).toBe(400);
    const ip = 'quota-ip';
    await raw("insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('request',$1,date_trunc('minute',clock_timestamp()),119)", [await digestBytes(ip)]);
    expect((await call({ operation: 'unsupported' }, { ip, headers: { 'X-Forwarded-For': 'forged-one' } })).status).toBe(400);
    gateway = makeGateway();
    expect((await call({ operation: 'list' }, { ip, headers: { 'X-Forwarded-For': 'forged-two' } })).status).toBe(429);
    const current = (await raw("select used from meals_private.rate_windows where kind='request' and key_hash=$1", [await digestBytes(ip)]))[0]; expect(current.used).toBe(121);
    const list = await call({ operation: 'list' }); expect(list.response.headers.get('Cache-Control')).toBe('no-store, private'); expect(list.response.headers.get('Referrer-Policy')).toBe('no-referrer');
});

test('email quota and zero mail budget rollback together; mock and production defaults fail closed', async () => {
    await raw('update meals_private.mail_budget set daily_limit=0');
    expect((await call(claim())).status).toBe(429); expect(mailer.attempts).toHaveLength(0);
    expect((await raw('select count(*)::int n from meals_private.parent_contacts'))[0].n).toBe(0);
    await raw('update meals_private.mail_budget set daily_limit=100');
    for (let n = 0; n < 4; n++) expect((await call(claim({ quantity: 1, idempotency_key: `synthetic-email-quota-${n}` }), { ip: `ip-${n}` })).status).toBe(200);
    expect((await call(claim({ quantity: 1, idempotency_key: 'synthetic-email-quota-5' }), { ip: 'new-ip' })).status).toBe(429);
    expect((await raw('select used from meals_private.mail_budget'))[0].used).toBe(4);
    expect((await call(claim({ email: 'person@example.com' }))).body.error.code).toBe('synthetic_email_required');
    expect((await call(claim(), { use: makeGateway({ mailer: undefined }) })).status).toBe(503);
    expect((await inertHandler(new Request(ORIGIN))).status).toBe(503);
});

test('durable data and hash-only capability work after a PGlite disk close/reopen', async () => {
    await db.close(); const directory = mkdtempSync(join(tmpdir(), 'meal-postgres-'));
    try {
        db = new PGlite(directory); await seed(); gateway = makeGateway(); const adult = await verified();
        await db.close(); db = new PGlite(directory); gateway = makeGateway();
        expect((await call({ operation: 'inspect', token: adult.mail.manageToken })).body.id).toBe(adult.claim.id);
        expect((await call(claim())).body.email_status).toBe('sent'); expect(mailer.attempts).toHaveLength(1);
        expect((await call({ operation: 'manager' }, { manager: true })).body.claims).toHaveLength(1);
    } finally { await db.close(); db = new PGlite(); rmSync(directory, { recursive: true, force: true }); }
});

test('pooled transaction rollback and uncertain commit never retry or leak SQL details', async () => {
    const statements: string[] = []; let releaseError: Error | undefined;
    const connection: MealSqlConnection = { query: async <Row>(sql: string) => { statements.push(sql); if (sql === 'commit') throw new Error('private-email@example.invalid secret SQL'); return { rows: [{ result: [] }] as Row[] }; }, release: error => { releaseError = error; } };
    const fake = makeGateway({ pool: { connect: async () => connection } });
    const result = await call({ operation: 'list' }, { use: fake }); expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain('private-email');
    expect(statements.filter(s => s === 'commit')).toHaveLength(1); expect(statements.at(-1)).toBe('rollback'); expect(releaseError?.message).toBe('Discard uncertain meal database connection');
});
