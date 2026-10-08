import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresMealGateway } from '../supabase/functions/team-meals/postgres-gateway';
import { PostgresMealDatabase, type MealSqlPool } from '../supabase/functions/team-meals/postgres';
import { MockMealMailer, mockProviderUsage, type MailResult, type ProviderUsage } from '../supabase/functions/team-meals/mail';
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
async function ready() { await db.exec("update meals_private.outbox set lease_until=case when lease_token is not null then clock_timestamp()-interval '1 second' else null end,next_attempt_at=clock_timestamp()-interval '1 second'"); }
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

test('atomic encrypted preparation has no plaintext capability at rest and survives process/disk restart', async () => {
    await db.close(); const dir = mkdtempSync(join(tmpdir(), 'meal-recovery-'));
    try {
        db = new PGlite(dir); await seed();
        const queued = gateway(new MockMealMailer(), { deferDelivery: true });
        expect((await claim(queued)).body.email_status).toBe('queued');
        const before = await outbox(), cryptoBox = createMealEnvelope(SYNTHETIC_ENVELOPE_KEY);
        const mail = JSON.parse(await cryptoBox.open(before.envelope, before));
        const durable = JSON.stringify(await rows('select row_to_json(o) as data from meals_private.outbox o union all select row_to_json(t) from meals_private.tokens t'));
        for (const value of [mail.verificationToken, mail.manageToken, mail.verificationUrl, mail.to]) expect(durable).not.toContain(value);
        await db.close(); db = new PGlite(dir);
        const provider = new RecoveryMailer();
        expect(await gateway(provider).dispatchPending()).toEqual({ attempted: 1 });
        expect(provider.requests).toEqual([{ key: before.idempotency_key, body: await cryptoBox.open(before.envelope, before) }]);
        expect(provider.mailbox[0].verificationToken).toBe(mail.verificationToken);
        const after = await outbox(); expect(after.status).toBe('sent'); expect(after.envelope).toBeNull(); expect(after.terminal_at).not.toBeNull();
        expect(await gateway(provider).dispatchPending()).toEqual({ attempted: 0 });
        expect((await claim(gateway(provider))).body.email_status).toBe('sent'); expect(provider.requests).toHaveLength(1);
    } finally { await db.close(); db = new PGlite(); rmSync(dir, { recursive: true, force: true }); }
});

test('accepted send plus lost finish recovers identical request/key and only one provider message', async () => {
    const provider = new RecoveryMailer();
    const broken: MealSqlPool = { async connect() { const c = await pool.connect(); return { query: async <Row>(sql: string, args?: unknown[]) => { if (sql.includes('finish_delivery')) throw new Error('Synthetic lost finish'); return c.query<Row>(sql,args); }, release: e => c.release(e) }; } };
    expect((await claim(gateway(provider, { pool: broken }))).status).toBe(503);
    const before = await outbox(); expect(before.status).toBe('uncertain'); expect(before.envelope).not.toBeNull();
    const tokenRows = await rows('select * from meals_private.tokens order by purpose');
    expect(await gateway(provider).dispatchPending()).toEqual({ attempted: 0 });
    await ready(); expect(await gateway(provider).dispatchPending()).toEqual({ attempted: 1 });
    expect(provider.requests).toHaveLength(2); expect(provider.requests[1]).toEqual(provider.requests[0]); expect(provider.mailbox).toHaveLength(1);
    expect(await rows('select * from meals_private.tokens order by purpose')).toEqual(tokenRows);
    expect((await outbox()).envelope).toBeNull(); expect((await rows('select used from meals_private.mail_budget'))[0].used).toBe(1);
});

test('leases are exclusive, stale finishes are fenced, and immutable payload survives a worker restart', async () => {
    await claim(gateway(new MockMealMailer(), { deferDelivery: true })); const original = await outbox();
    const [a,b] = await Promise.all([database.beginDelivery(original.id,mockProviderUsage()),database.beginDelivery(original.id,mockProviderUsage())]);
    expect([a,b].filter(Boolean)).toHaveLength(1); const first = a ?? b;
    await ready(); const second = await database.beginDelivery(original.id,mockProviderUsage());
    expect(second!.lease_token).not.toBe(first!.lease_token); expect(second!.envelope).toBe(first!.envelope);
    expect(await database.finishDelivery(first!,{status:'failed'})).toBe(false);
    expect(await database.finishDelivery(second!,{status:'sent',providerId:'synthetic-current-worker'})).toBe(true);
    expect(await database.finishDelivery(first!,{status:'uncertain',retryable:true})).toBe(false);
    expect((await outbox()).status).toBe('sent'); expect((await outbox()).envelope).toBeNull();
});

test('uncertain retries are bounded, unchanged, and never mint replacement links', async () => {
    const provider = new RecoveryMailer(); provider.outcome = { status: 'uncertain', retryable: true };
    const g = gateway(provider); const first = await claim(g); expect(first.body.email_status).toBe('uncertain');
    const original = await outbox(), hashes = await rows('select token_hash,purpose,expires_at from meals_private.tokens order by purpose');
    expect((await claim(g)).body.email_status).toBe('uncertain'); expect(provider.requests).toHaveLength(1);
    for (let n = 0; n < 4; n++) { await ready(); expect(await g.dispatchPending()).toEqual({ attempted: 1 }); }
    expect(provider.requests).toHaveLength(5); expect(new Set(provider.requests.map(r => r.body)).size).toBe(1); expect(new Set(provider.requests.map(r => r.key)).size).toBe(1);
    expect((await outbox()).status).toBe('uncertain'); expect((await outbox()).envelope).toBeNull();
    await ready(); expect(await g.dispatchPending()).toEqual({ attempted: 0 });
    expect(await rows('select token_hash,purpose,expires_at from meals_private.tokens order by purpose')).toEqual(hashes);
    expect((await rows('select hold_expires_at,status from meals_private.claims'))[0].status).toBe('pending');
    expect((await outbox()).id).toBe(original.id); expect((await rows('select used,attempts_used from meals_private.mail_budget'))[0]).toEqual({used:1,attempts_used:5});
});

test('429-style definite rejection reports retry; permanent failure releases and erases', async () => {
    const provider = new RecoveryMailer(); provider.outcome = { status: 'failed', retryable: true };
    const g = gateway(provider); expect((await claim(g)).body.email_status).toBe('retry');
    expect((await outbox()).envelope).not.toBeNull(); expect((await rows('select status from meals_private.claims'))[0].status).toBe('pending');
    provider.outcome = { status: 'failed', retryable: false }; await ready(); await g.dispatchPending();
    expect((await claim(g)).body.email_status).toBe('unavailable'); expect((await outbox()).envelope).toBeNull();
    expect((await rows('select status from meals_private.claims'))[0].status).toBe('expired');
    expect((await rows('select count(*)::integer n from meals_private.tokens where revoked_at is null'))[0].n).toBe(0);
});

for (const alteration of ['body', 'identity', 'wrong-key'] as const) test(`authenticated envelope rejects ${alteration} tampering without provider access`, async () => {
    await claim(gateway(new MockMealMailer(), { deferDelivery: true })); const original = await outbox();
    if (alteration === 'body') { const box = JSON.parse(original.envelope); box.ciphertext = (box.ciphertext[0] === 'A' ? 'B' : 'A') + box.ciphertext.slice(1); await rows('update meals_private.outbox set envelope=$1',[JSON.stringify(box)]); }
    if (alteration === 'identity') await rows("update meals_private.outbox set idempotency_key='synthetic-swapped-key'");
    const provider = new RecoveryMailer(); await gateway(provider, alteration === 'wrong-key' ? { envelopeKey: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=' } : {}).dispatchPending();
    expect(provider.requests).toHaveLength(0); expect((await outbox()).status).toBe('uncertain'); expect((await outbox()).envelope).toBeNull();
});

test('expiry and 23-hour provider guard purge ciphertext without contacting provider', async () => {
    for (let n = 1; n <= 2; n++) {
        await claim(gateway(new MockMealMailer(),{deferDelivery:true}),n);
        const o = (await rows('select * from meals_private.outbox order by created_at desc'))[0];
        if (n === 1) await rows("update meals_private.claims set hold_expires_at=clock_timestamp()-interval '1 second' where id=$1",[o.claim_id]);
        else await rows("update meals_private.outbox set first_attempt_at=clock_timestamp()-interval '24 hours' where id=$1",[o.id]);
    }
    const provider = new RecoveryMailer(); expect(await gateway(provider).dispatchPending()).toEqual({attempted:0}); expect(provider.requests).toHaveLength(0);
    expect((await rows('select count(*)::integer n from meals_private.outbox where envelope is not null'))[0].n).toBe(0);
});

test('cancelled in-flight claim erases envelope and prevents a stale worker completion', async () => {
    await claim(gateway(new MockMealMailer(),{deferDelivery:true})); const o = await outbox();
    const lease = await database.beginDelivery(o.id,mockProviderUsage());
    await database.cancelClaim({id:MANAGER},o.claim_id,1,'Synthetic coordinator cancellation');
    expect(await database.finishDelivery(lease!,{status:'sent',providerId:'synthetic-late'})).toBe(false);
    expect((await outbox()).envelope).toBeNull(); expect((await rows('select status from meals_private.claims'))[0].status).toBe('cancelled');
});

test('fail-closed usage, quota approval and kill switch prevent reservation and dispatch', async () => {
    for (const mutate of [
        (u:ProviderUsage) => ({...u,fetchedAt:new Date(Date.now()-120000).toISOString()}),
        (u:ProviderUsage) => ({...u,dailyUsed:u.dailyLimit!}),
        (u:ProviderUsage) => ({...u,monthlyUsed:u.monthlyLimit!}),
        (u:ProviderUsage) => ({...u,dailyResetsAt:new Date(Date.now()-1000).toISOString()}),
    ]) {
        const provider = new RecoveryMailer(); provider.readUsage = async () => mutate(mockProviderUsage());
        expect((await claim(gateway(provider))).status).toBe(429); expect(provider.requests).toHaveLength(0);
    }
    const unavailable = new RecoveryMailer(); unavailable.readUsage = async () => { throw new Error('Synthetic 403 usage scope unavailable'); };
    expect((await claim(gateway(unavailable))).status).toBe(503);
    expect((await rows('select count(*)::integer n from meals_private.claims'))[0].n).toBe(0);
    const queued = gateway(new MockMealMailer(),{deferDelivery:true}); await claim(queued);
    await db.exec('update meals_private.mail_budget set mail_enabled=false');
    const provider = new RecoveryMailer(); expect(await gateway(provider).dispatchPending()).toEqual({attempted:0});
    expect((await claim(gateway(provider),2)).status).toBe(429); expect(provider.requests).toHaveLength(0);
    await db.exec("update meals_private.mail_budget set mail_enabled=true,quota_approved_until=clock_timestamp()-interval '1 second'");
    expect(await gateway(provider).dispatchPending()).toEqual({attempted:0});
});

test('counts-only notification allowance and configured reserve protect capacity conservatively', async () => {
    await db.exec("create table public.team_notifications(channel text,status text,first_attempt_at timestamptz);insert into public.team_notifications values('email','pending',null),('email','sending',clock_timestamp()),('in_app','pending',null)");
    const provider = new RecoveryMailer(); provider.readUsage = async () => ({...mockProviderUsage(),dailyLimit:3,dailyUsed:1});
    expect((await claim(gateway(provider))).status).toBe(429);
    await db.exec("delete from public.team_notifications;update meals_private.mail_budget set reserved_daily=2");
    expect((await claim(gateway(provider))).status).toBe(429);
    await db.exec('update meals_private.mail_budget set reserved_daily=0');
    expect((await claim(gateway(provider))).status).toBe(200);
});

test('last feature budget slot is atomic across independent request handlers', async () => {
    await db.exec('update meals_private.mail_budget set daily_limit=1');
    const providers = [new RecoveryMailer(),new RecoveryMailer()];
    const result = await Promise.all(providers.map((p,i) => claim(gateway(p),i+1)));
    expect(result.map(r=>r.status).sort()).toEqual([200,429]);
    expect((await rows('select used from meals_private.mail_budget'))[0].used).toBe(1);
    expect((await rows('select count(*)::integer n from meals_private.outbox'))[0].n).toBe(1);
    expect(providers.reduce((n,p)=>n+p.mailbox.length,0)).toBe(1);
});

test('audit failure rolls back hold, envelope, token hashes and budget together', async () => {
    await db.exec("create function meals_private.synthetic_audit_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure';end$$;create trigger synthetic_fail before insert on meals_private.history for each row execute function meals_private.synthetic_audit_failure()");
    const provider = new RecoveryMailer(); expect((await claim(gateway(provider))).status).toBe(503);
    for (const table of ['claims','tokens','outbox','parent_contacts','idempotency']) expect((await rows(`select count(*)::integer n from meals_private.${table}`))[0].n).toBe(0);
    expect((await rows('select used from meals_private.mail_budget'))[0].used).toBe(0); expect(provider.requests).toHaveLength(0);
});

test('a later definite rejection cannot erase uncertainty about an earlier accepted attempt', async () => {
    const provider = new RecoveryMailer(); provider.outcome = { status: 'uncertain', retryable: true };
    const g = gateway(provider); expect((await claim(g)).body.email_status).toBe('uncertain');
    await ready(); provider.outcome = { status: 'failed', retryable: false }; await g.dispatchPending();
    expect((await outbox()).status).toBe('uncertain'); expect((await outbox()).envelope).toBeNull();
    expect((await rows('select status from meals_private.claims'))[0].status).toBe('pending');
    expect((await rows('select count(*)::integer n from meals_private.tokens where revoked_at is null'))[0].n).toBe(2);
});

test('UTC rollover charges carried delivery once against the new daily feature allowance', async () => {
    await claim(gateway(new MockMealMailer(),{deferDelivery:true}));
    await db.exec("update meals_private.outbox set budget_day=(clock_timestamp() at time zone 'UTC')::date-1;update meals_private.mail_budget set utc_day=(clock_timestamp() at time zone 'UTC')::date-1,used=1,daily_limit=1");
    const provider = new RecoveryMailer(), g = gateway(provider);
    expect((await claim(g,2)).status).toBe(429);
    expect(await g.dispatchPending()).toEqual({attempted:1});
    expect((await rows('select used from meals_private.mail_budget'))[0].used).toBe(1);
    expect((await claim(g,2)).status).toBe(429); expect(provider.mailbox).toHaveLength(1);
});

test('daily email/IP and global request abuse gates survive rejected operations', async () => {
    const g = gateway();
    await db.exec("insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('email_day',sha256(convert_to('adult1@example.invalid','UTF8')),date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC',8)");
    expect((await claim(g)).status).toBe(429);
    await db.exec("insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('ip_day',sha256(convert_to('synthetic-ip-2','UTF8')),date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC',30)");
    expect((await claim(g,2)).status).toBe(429);
    expect((await rows('select used from meals_private.mail_budget'))[0].used).toBe(0);
    await db.exec("update meals_private.rate_windows set used=600 where kind='global_request'");
    const ipRows = (await rows("select count(*)::integer n from meals_private.rate_windows where kind='request'"))[0].n;
    for (let n=3;n<10;n++) expect((await claim(g,n)).status).toBe(429);
    expect((await rows("select count(*)::integer n from meals_private.rate_windows where kind='request'"))[0].n).toBe(ipRows);
    expect((await rows("select used from meals_private.rate_windows where kind='global_request'"))[0].used).toBe(601);
    expect((await rows('select count(*)::integer n from meals_private.claims'))[0].n).toBe(0);
});
