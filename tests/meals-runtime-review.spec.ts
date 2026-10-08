import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createPostgresMealGateway } from '../supabase/functions/team-meals/postgres-gateway';
import { PostgresMealDatabase, type MealSqlPool } from '../supabase/functions/team-meals/postgres';
import { MockMealMailer, mockProviderUsage, type MailResult } from '../supabase/functions/team-meals/mail';
import { createMealEnvelope, SYNTHETIC_ENVELOPE_KEY } from '../supabase/functions/team-meals/envelope';
import type { PublicMeal } from '../src/meals/types';

const ORIGIN = 'https://meals.example.invalid', MANAGER = '00000000-0000-0000-0000-000000000001';
let db: PGlite, pool: MealSqlPool, database: PostgresMealDatabase, meal: PublicMeal;
const enable = "update meals_private.mail_budget set mail_enabled=true,daily_limit=100,quota_approved_until=clock_timestamp()+interval '1 day',reserved_daily=0,reserved_monthly=0,notification_daily_allowance=0";
function currentPool(): MealSqlPool {
    let tail = Promise.resolve();
    return { async connect() { let unlock!: () => void; const old = tail; tail = new Promise<void>(r => { unlock = r; }); await old;
        return { async query<Row>(sql: string, args: unknown[] = []) { return { rows: (await db.query<Row>(sql, args)).rows }; }, release() { unlock(); } }; } };
}
async function seed() {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.profiles(id uuid primary key,role text,active boolean);insert into public.profiles values('${MANAGER}','mentor',true);`);
    await db.exec(readFileSync('supabase/drafts/saturday-meals.sql', 'utf8'));
    await db.exec(enable);
    const date = new Date(Date.now() + 14 * 86400000); date.setUTCDate(date.getUTCDate() + (6 - date.getUTCDay() + 7) % 7); date.setUTCHours(12,0,0,0);
    meal = await database.saveMeal({ id: MANAGER }, { title: 'Synthetic Saturday recovery', service_at: date.toISOString(), timezone: 'UTC', expected_headcount: 100, guidance: 'Synthetic fixture only', status: 'open', slots: [{ label: 'Synthetic servings', category: 'main', unit: 'servings', needed: 100 }] });
}
function gateway(mailer = new MockMealMailer(), extra: Partial<Parameters<typeof createPostgresMealGateway>[0]> = {}) {
    return createPostgresMealGateway({ pool, mailer, allowedOrigins: [ORIGIN], publicBaseUrl: `${ORIGIN}/meals.html`, ...extra });
}
function input(n = 1) { return { operation: 'claim', meal_id: meal.id, slot_id: meal.slots[0].id, whole_meal: false, quantity: 1, name: 'Synthetic Adult', email: `adult${n}@example.invalid`, idempotency_key: `synthetic-recovery-request-${n}` }; }
async function claim(g: ReturnType<typeof gateway>, n = 1) {
    const response = await g.handle(new Request(`${ORIGIN}/api`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(input(n)) }), { ip: `synthetic-ip-${n}` });
    return { status: response.status, body: await response.json() };
}
async function rows(sql: string, values: unknown[] = []) { return (await db.query<any>(sql, values)).rows; }
async function outbox() { return (await rows('select * from meals_private.outbox order by created_at'))[0]; }
class RecoveryMailer extends MockMealMailer {
    readonly requests: { body: string; key: string }[] = [];
    outcome: MailResult = { status: 'sent', providerId: 'synthetic-provider-id' };
    override async sendPrepared(body: string, key: string): Promise<MailResult> {
        this.requests.push({ body, key });
        if (this.outcome.status === 'sent') await super.sendPrepared(body, key);
        return this.outcome;
    }
}
test.beforeEach(async () => { db = new PGlite(); pool = currentPool(); database = new PostgresMealDatabase(pool); await seed(); });
test.afterEach(async () => { await db.close(); });

test('review: a duplicate begin cannot revoke the fifth active delivery lease', async () => {
    await claim(gateway(new MockMealMailer(), { deferDelivery: true }));
    const original = await outbox();
    await db.exec("update meals_private.outbox set attempts=4,status='uncertain',delivery_uncertain=true,first_attempt_at=clock_timestamp()-interval '2 minutes'");
    const last = await database.beginDelivery(original.id, mockProviderUsage());
    expect(last?.attempts).toBe(5);
    expect(await database.beginDelivery(original.id, mockProviderUsage())).toBeNull();
    const active = await outbox();
    expect(active.lease_token).toBe(last!.lease_token);
    expect(active.envelope).toBe(original.envelope);
    expect(active.terminal_at).toBeNull();
    expect(await database.finishDelivery(last!, { status: 'sent', providerId: 'synthetic-last-success' })).toBe(true);
    expect((await outbox()).status).toBe('sent');
});

test('review: prior-month delivery stays reserved in the new monthly window after terminal success', async () => {
    await claim(gateway(new MockMealMailer(), { deferDelivery: true }));
    const original = await outbox();
    await db.exec("update meals_private.outbox set created_at=date_trunc('month',clock_timestamp())-interval '1 minute',budget_day=(date_trunc('month',clock_timestamp())-interval '1 minute')::date;update meals_private.mail_budget set utc_day=current_date-1,used=0,attempts_used=0");
    const usage = { ...mockProviderUsage(), monthlyLimit: 1 };
    const lease = await database.beginDelivery(original.id, usage);
    expect(lease).not.toBeNull();
    expect(await database.finishDelivery(lease!, { status: 'sent', providerId: 'synthetic-rollover-success' })).toBe(true);
    // The provider's fresh snapshot can lag; our own accepted send must remain
    // reserved after ciphertext is erased and must not be admitted a second time.
    const provider = new RecoveryMailer(); provider.readUsage = async () => usage;
    expect((await claim(gateway(provider), 2)).status).toBe(429);
    expect(provider.requests).toHaveLength(0);
    expect((await rows('select count(*)::integer n from meals_private.outbox'))[0].n).toBe(1);
});

test('review: envelope AAD binds each identity field and nonces/data keys vary for identical input', async () => {
    const cryptoBox = createMealEnvelope(SYNTHETIC_ENVELOPE_KEY);
    const identity = { id: crypto.randomUUID(), claim_id: crypto.randomUUID(), idempotency_key: 'synthetic-review-key' };
    const plaintext = JSON.stringify({ synthetic: 'private@example.invalid', token: 'not-a-real-capability' });
    const first = await cryptoBox.seal(plaintext, identity), second = await cryptoBox.seal(plaintext, identity);
    expect(await cryptoBox.open(first, identity)).toBe(plaintext);
    const a = JSON.parse(first), b = JSON.parse(second);
    expect(a.iv).not.toBe(b.iv); expect(a.keyIv).not.toBe(b.keyIv); expect(a.wrappedKey).not.toBe(b.wrappedKey); expect(a.ciphertext).not.toBe(b.ciphertext);
    for (const field of ['id', 'claim_id', 'idempotency_key'] as const)
        await expect(cryptoBox.open(first, { ...identity, [field]: identity[field] + '-changed' })).rejects.toThrow('could not be authenticated');
    for (const version of [0, 2, '1', null]) await expect(cryptoBox.open(JSON.stringify({ ...a, v: version }), identity)).rejects.toThrow('could not be authenticated');
});

test('review: preparation failure cannot commit a contact, hold, token, envelope or budget reservation', async () => {
    const provider = new RecoveryMailer(); provider.prepare = () => { throw new Error('Synthetic serialization failure'); };
    expect((await claim(gateway(provider))).status).toBe(503);
    for (const table of ['claims', 'tokens', 'outbox', 'parent_contacts', 'idempotency'])
        expect((await rows(`select count(*)::integer n from meals_private.${table}`))[0].n).toBe(0);
    expect((await rows('select used from meals_private.mail_budget'))[0].used).toBe(0);
    expect(provider.requests).toHaveLength(0);
});
