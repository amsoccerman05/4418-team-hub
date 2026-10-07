import { test, expect } from '@playwright/test';
import { createMealRuntime, type MealPoolConfiguration } from '../supabase/functions/team-meals/runtime.ts';
import type { MealSqlPool } from '../supabase/functions/team-meals/postgres.ts';
import { digestBytes } from '../supabase/functions/team-meals/postgres-gateway.ts';
import handler, { mealDatabaseErrorCategory } from '../supabase/functions/team-meals/index.ts';
const ORIGIN = 'https://meals.example.invalid';
const base: Record<string, string> = {
    MEALS_ENABLED: 'true', MEALS_RUNTIME_MODE: 'local-test', MEALS_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/postgres',
    MEALS_AUTH_URL: 'http://127.0.0.1:54321', MEALS_AUTH_PUBLIC_KEY: 'synthetic-public-key',
    MEALS_PUBLIC_BASE_URL: `${ORIGIN}/meals.html`, MEALS_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
};
const production = { ...base, MEALS_RUNTIME_MODE: 'production', MEALS_DATABASE_URL: 'postgresql://synthetic:synthetic@database.supabase.co:5432/postgres',
    MEALS_AUTH_URL: 'https://project.supabase.co', MEALS_PUBLIC_BASE_URL: 'https://meals.example.com/meals.html', MEALS_ALLOWED_ORIGINS: JSON.stringify(['https://meals.example.com']) };
function request(body: unknown = { operation: 'list' }, headers: Record<string, string> = {}, path = '/functions/v1/team-meals') {
    return new Request(`https://gateway.invalid${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function fixture() {
    const statements: { sql: string; values?: unknown[] }[] = []; const configurations: MealPoolConfiguration[] = [];
    const pool: MealSqlPool = { connect: async () => ({ query: async <Row>(sql: string, values?: unknown[]) => {
        statements.push({ sql, values });
        const result = sql.includes('reserve_request') ? true : sql.includes('meals_manager_context') ? { meals: [], claims: [] } : [];
        return { rows: [{ result }] as Row[] };
    }, release() {} }) };
    return { statements, configurations, dependencies(values: Record<string, string | undefined> = base, fetcher: typeof fetch = async () => { throw new Error('Network prohibited'); }) {
        return { env: { get: (name: string) => values[name] }, createPool: (configuration: MealPoolConfiguration) => { configurations.push(configuration); return pool; }, fetcher };
    } };
}

test('disabled entrypoint and absent explicit flags do not construct pool or contact a network', async () => {
    expect((await handler(request())).status).toBe(503);
    for (const values of [{}, { ...base, MEALS_ENABLED: 'TRUE' }, { ...base, MEALS_RUNTIME_MODE: undefined }]) {
        const f = fixture(), runtime = await createMealRuntime(f.dependencies(values));
        expect(runtime.state).toBe('disabled'); expect((await runtime.handle(request())).status).toBe(503); expect(f.configurations).toHaveLength(0); expect(f.statements).toHaveLength(0);
    }
});

test('invalid URLs/origins/keys and unapproved transport configuration fail before opening a pool', async () => {
    for (const change of [
        { MEALS_PUBLIC_BASE_URL: `${ORIGIN}/meals.html#verify=secret` }, { MEALS_PUBLIC_BASE_URL: `${ORIGIN}/meals.html?token=secret` },
        { MEALS_ALLOWED_ORIGINS: '["*"]' }, { MEALS_ALLOWED_ORIGINS: '["https://other.invalid"]' }, { MEALS_ALLOWED_ORIGINS: 'null' },
        { MEALS_AUTH_URL: 'http://external.example.com' }, { MEALS_AUTH_PUBLIC_KEY: 'sb_secret_never-use' },
        { MEALS_DATABASE_URL: `${base.MEALS_DATABASE_URL}?sslmode=disable` }, { MEALS_DATABASE_URL: 'postgresql://synthetic@remote.example.com/db' },
        { MEALS_IP_MODE: 'trusted-proxy', MEALS_TRUSTED_IP_HEADER: 'x-real-ip', MEALS_TRUSTED_PROXY_VERIFIED: 'true' },
        { MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'resend' }, { MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'mock', RESEND_API_KEY: 'not-a-real-secret' },
        { MEALS_DISPATCH_ENABLED: 'true', MEALS_WORKER_SECRET: 'x'.repeat(32) },
    ]) {
        const f = fixture(); const runtime = await createMealRuntime(f.dependencies({ ...base, ...change }));
        expect(runtime.state, JSON.stringify(change)).toBe('disabled'); expect(f.configurations).toHaveLength(0);
    }
});

test('production requires real HTTPS authority and TLS verification; mail stays independently disabled', async () => {
    const f = fixture(), runtime = await createMealRuntime(f.dependencies(production));
    expect(runtime.state).toBe('enabled'); expect(f.configurations[0].ssl).toEqual({ rejectUnauthorized: true });
    expect(f.configurations[0]).toMatchObject({ max: 2, connectionTimeoutMillis: 5000, statement_timeout: 8000 });
    for (const change of [{ MEALS_AUTH_URL: 'http://kong:8000', MEALS_LOCAL_AUTH_HOST: 'kong' }, { MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'resend' },
        { MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'mock' }, { MEALS_IP_MODE: 'trusted-proxy', MEALS_TRUSTED_IP_HEADER: 'x-forwarded-for', MEALS_TRUSTED_PROXY_VERIFIED: 'true' }]) {
        const blocked = fixture(); expect((await createMealRuntime(blocked.dependencies({ ...production, ...change }))).state).toBe('disabled'); expect(blocked.configurations).toHaveLength(0);
    }
});

test('public listing is accountless, exact Origin protected, and all spoofed caller IP headers share a quota bucket', async () => {
    const f = fixture(), runtime = await createMealRuntime(f.dependencies());
    expect(runtime.state).toBe('enabled'); expect(f.configurations[0].ssl).toBe(false);
    expect((await runtime.handle(request({ operation: 'list' }, { 'X-Forwarded-For': '1.2.3.4', 'X-Real-IP': '1.2.3.4' }))).status).toBe(200);
    expect((await runtime.handle(request({ operation: 'list' }, { 'X-Forwarded-For': '5.6.7.8', 'CF-Connecting-IP': '5.6.7.8' }))).status).toBe(200);
    const reservations = f.statements.filter(row => row.sql.includes('reserve_request'));
    for (const row of reservations) expect(row.values?.[0]).toEqual(await digestBytes('untrusted-shared'));
    const before = f.statements.length;
    expect((await runtime.handle(request({ operation: 'list' }, { Origin: 'https://hostile.invalid' }))).status).toBe(403); expect(f.statements).toHaveLength(before);
    expect((await runtime.handle(request({}, {}, '/anything-else'))).status).toBe(404);
});

test('manager tokens are checked at configured Auth authority for every call; metadata and forged request fields cannot authorize', async () => {
    const f = fixture(); const calls: { url: unknown; init?: RequestInit }[] = []; let permitted = true;
    const runtime = await createMealRuntime(f.dependencies(base, async (url, init) => { calls.push({ url, init }); return permitted ? Response.json({ id: '00000000-0000-0000-0000-000000000001', user_metadata: { role: 'admin' } }) : new Response('', { status: 401 }); }));
    expect((await runtime.handle(request({ operation: 'manager' }))).status).toBe(403); expect(calls).toHaveLength(0);
    expect((await runtime.handle(request({ operation: 'manager' }, { Authorization: 'Bearer synthetic-session' }))).status).toBe(200);
    expect(calls[0].url).toBe('http://127.0.0.1:54321/auth/v1/user');
    expect(f.statements.some(row => row.sql === 'set local role authenticated')).toBe(true);
    permitted = false;
    expect((await runtime.handle(request({ operation: 'manager' }, { Authorization: 'Bearer synthetic-session' }))).status).toBe(403); expect(calls).toHaveLength(2);
    expect((await runtime.handle(request({ operation: 'manager', actor_id: 'forged' }, { Authorization: 'Bearer synthetic-session' }))).status).toBe(400);
});

test('local Docker authority requires exact configured hostname and never activates Resend', async () => {
    const f = fixture(); const local = { ...base, MEALS_AUTH_URL: 'http://kong:8000', MEALS_LOCAL_AUTH_HOST: 'kong',
        MEALS_DATABASE_URL: 'postgresql://synthetic:synthetic@supabase_db_local:5432/postgres', MEALS_LOCAL_DATABASE_HOST: 'supabase_db_local', MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'mock' };
    const runtime = await createMealRuntime(f.dependencies(local)); expect(runtime.state).toBe('enabled');
    expect((await runtime.handle(request({ operation: 'claim', meal_id: '00000000-0000-0000-0000-000000000001', slot_id: '00000000-0000-0000-0000-000000000002', whole_meal: false, quantity: 1, name: 'Synthetic Adult', email: 'real@example.com', idempotency_key: 'synthetic-request-1234' }))).status).toBe(400);
    expect((await createMealRuntime(fixture().dependencies({ ...local, MEALS_AUTH_URL: 'http://other:8000' }))).state).toBe('disabled');
});

test('protected dispatch is off by default and rejects browser requests, public operations, wrong secrets and paths', async () => {
    const f = fixture(), runtime = await createMealRuntime(f.dependencies());
    expect((await runtime.handle(new Request('https://gateway.invalid/functions/v1/team-meals/dispatch', { method: 'POST' }))).status).toBe(404);
    const guarded = await createMealRuntime(f.dependencies({ ...base, MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'mock', MEALS_DISPATCH_ENABLED: 'true', MEALS_WORKER_SECRET: 's'.repeat(32) }));
    const dispatch = (headers: Record<string, string> = {}, suffix = '') => new Request(`https://gateway.invalid/functions/v1/team-meals/dispatch${suffix}`, { method: 'POST', headers });
    expect((await guarded.handle(dispatch())).status).toBe(403);
    expect((await guarded.handle(dispatch({ Authorization: `Bearer ${'wrong'.repeat(10)}` }))).status).toBe(403);
    expect((await guarded.handle(dispatch({ Authorization: `Bearer ${'s'.repeat(32)}`, Origin: ORIGIN }))).status).toBe(400);
    expect((await guarded.handle(dispatch({ Authorization: `Bearer ${'s'.repeat(32)}` }, '?token=forged'))).status).toBe(400);
    expect((await guarded.handle(request({ operation: 'dispatch' }))).status).toBe(400);
});

test('complete production configuration creates a usable runtime without sending or reading any provider data during boot', async () => {
    let calls = 0; const f = fixture();
    const configured = { ...production, MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'resend', RESEND_API_KEY: 'synthetic-provider-key',
        NOTIFICATIONS_FROM: 'Synthetic <meals@example.invalid>', MEALS_ENVELOPE_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))), MEALS_DISPATCH_ENABLED: 'true', MEALS_WORKER_SECRET: 'w'.repeat(32) };
    const runtime = await createMealRuntime(f.dependencies(configured, async () => { calls++; throw new Error('No provider call expected'); }));
    expect(runtime.state).toBe('enabled'); expect(calls).toBe(0);
    const publicRead = await runtime.handle(request({ operation: 'list' }, { Origin: 'https://meals.example.com' }));
    expect(publicRead.status).toBe(200); expect(calls).toBe(0);
    const dispatch = await runtime.handle(new Request('https://gateway.invalid/functions/v1/team-meals/dispatch', { method: 'POST', headers: { Authorization: `Bearer ${'w'.repeat(32)}` } }));
    expect(dispatch.status).toBe(200); expect(await dispatch.json()).toEqual({ attempted: 0 }); expect(calls).toBe(0);
    for (const change of [{ MEALS_ENVELOPE_KEY: 'not-base64' }, { MEALS_ENVELOPE_KEY: btoa('\0'.repeat(32)) }, { MEALS_ENVELOPE_KEY: btoa('x'.repeat(32)) }, { NOTIFICATIONS_FROM: 'invalid' }, { RESEND_API_KEY: 'line\nbreak' }, { MEALS_WORKER_SECRET: 'too-short' }]) {
        const invalid = fixture(); expect((await createMealRuntime(invalid.dependencies({ ...configured, ...change }))).state).toBe('disabled'); expect(invalid.configurations).toHaveLength(0);
    }
});

test('reviewed proxy option accepts only one canonical address from its configured header, never forwarding lists', async () => {
    const f = fixture(); const configured = { ...production, MEALS_IP_MODE: 'trusted-proxy', MEALS_TRUSTED_IP_HEADER: 'x-real-ip', MEALS_TRUSTED_PROXY_VERIFIED: 'true' };
    const runtime = await createMealRuntime(f.dependencies(configured)); expect(runtime.state).toBe('enabled');
    for (const [value, expected] of [['192.0.2.7', '192.0.2.7'], ['2001:0db8::7', '2001:db8::7'], ['192.0.2.7, 192.0.2.8', 'untrusted-shared'], ['999.0.0.1', 'untrusted-shared'], ['unknown', 'untrusted-shared']]) {
        const response = await runtime.handle(request({ operation: 'list' }, { Origin: 'https://meals.example.com', 'X-Real-IP': value, 'X-Forwarded-For': '198.51.100.9' }));
        expect(response.status).toBe(200); expect(f.statements.filter(row => row.sql.includes('reserve_request')).at(-1)?.values?.[0]).toEqual(await digestBytes(expected));
    }
    const invalid = fixture(); expect((await createMealRuntime(invalid.dependencies({ ...configured, MEALS_TRUSTED_PROXY_VERIFIED: 'false' }))).state).toBe('disabled'); expect(invalid.configurations).toHaveLength(0);
});

test('existing platform database/Auth/public-key configuration works without duplicating credentials', async () => {
    const f = fixture(); const configured: Record<string, string | undefined> = { ...base, MEALS_DATABASE_URL: undefined, MEALS_AUTH_URL: undefined, MEALS_AUTH_PUBLIC_KEY: undefined,
        SUPABASE_DB_URL: base.MEALS_DATABASE_URL, SUPABASE_URL: base.MEALS_AUTH_URL, SUPABASE_ANON_KEY: 'synthetic-platform-public-key' };
    let observed: RequestInit | undefined;
    const runtime = await createMealRuntime(f.dependencies(configured, async (_url, init) => { observed = init; return Response.json({ id: '00000000-0000-0000-0000-000000000001' }); }));
    expect(runtime.state).toBe('enabled');
    expect((await runtime.handle(request({ operation: 'manager' }, { Authorization: 'Bearer synthetic-platform-session' }))).status).toBe(200);
    expect((observed?.headers as Record<string, string>).apikey).toBe('synthetic-platform-public-key');
    const bad = fixture(); expect((await createMealRuntime(bad.dependencies({ ...configured, MEALS_AUTH_PUBLIC_KEY: '' }))).state).toBe('disabled'); expect(bad.configurations).toHaveLength(0);
});

test('worker accepts authenticated empty JSON from pg_net and rejects extra/oversized/invalid body data', async () => {
    const f = fixture(), runtime = await createMealRuntime(f.dependencies({ ...base, MEALS_MAIL_ENABLED: 'true', MEALS_MAIL_MODE: 'mock', MEALS_DISPATCH_ENABLED: 'true', MEALS_WORKER_SECRET: 's'.repeat(32) }));
    const dispatch = (body: string, authorization = `Bearer ${'s'.repeat(32)}`, contentType = 'application/json') => new Request('https://gateway.invalid/functions/v1/team-meals/dispatch', { method: 'POST', headers: { Authorization: authorization, 'Content-Type': contentType }, body });
    for (const body of ['', '{}', ' { } ']) {
        const result = await runtime.handle(dispatch(body)); expect(result.status).toBe(200); expect(await result.json()).toEqual({ attempted: 0 });
    }
    for (const body of ['[]', 'null', '{"limit":1000}', 'bad JSON', ' '.repeat(65)]) expect((await runtime.handle(dispatch(body))).status).toBe(400);
    expect((await runtime.handle(dispatch('{}', `Bearer ${'s'.repeat(32)}`, 'text/plain'))).status).toBe(400);
    expect((await runtime.handle(dispatch('oversized'.repeat(500), 'Bearer wrong'))).status).toBe(403);
});

test('startup diagnostics expose fixed stages only and public failures remain generic', async () => {
    const events: unknown[] = []; const f = fixture(); const secret = 'private-provider-contact@example.invalid';
    const runtime = await createMealRuntime({ ...f.dependencies(), createPool: async () => { throw new Error(`driver failed ${secret}`); }, onDiagnostic: event => events.push(event) });
    expect(runtime.state).toBe('disabled'); expect(events).toEqual([{ state: 'disabled', phase: 'pool' }]);
    const response = await runtime.handle(request()); expect(response.status).toBe(503);
    const publicBody = await response.text(); expect(publicBody).toContain('not_configured'); expect(publicBody).not.toContain('pool');
    expect(JSON.stringify(events) + publicBody).not.toContain(secret);
    events.length = 0;
    await createMealRuntime({ ...f.dependencies({ ...base, MEALS_AUTH_URL: 'invalid-private-value' }), onDiagnostic: event => events.push(event) });
    expect(events).toEqual([{ state: 'disabled', phase: 'auth' }]);
    events.length = 0;
    await createMealRuntime({ ...f.dependencies(), onDiagnostic: event => events.push(event) });
    expect(events).toEqual([{ state: 'enabled', phase: 'ready' }]);
    expect((await createMealRuntime({ ...f.dependencies(), onDiagnostic: () => { throw new Error(secret); } })).state).toBe('enabled');
});


test('database diagnostic categories never contain driver SQL, contacts, tokens or credentials', () => {
    const secret = 'postgresql://private:secret@private.example.invalid/db parent@example.invalid';
    const cases = [ ['ENOTFOUND', 'dns'], ['28P01', 'database_authentication'], ['42501', 'database_permission'],
        ['42883', 'database_function_missing'], ['ERR_INVALID_ARG_TYPE', 'driver_argument'], ['unexpected-secret-code', 'unclassified'], ['constructor', 'unclassified'], ['__proto__', 'unclassified'] ];
    for (const [code, expected] of cases) {
        expect(mealDatabaseErrorCategory(Object.assign(new Error(secret), { code }))).toBe(expected);
    }
    expect(mealDatabaseErrorCategory(new Error(`SASL: SCRAM error ${secret}`))).toBe('driver_scram');
    expect(mealDatabaseErrorCategory(new Error(`unsupported feature is not a function ${secret}`))).toBe('runtime_unsupported');
    expect(mealDatabaseErrorCategory(null)).toBe('unclassified');
});


test('local Docker DB address exception requires an exact explicitly configured private IPv4', async () => {
    for (const address of ['10.30.0.2', '172.16.0.3', '172.31.255.254', '192.168.50.2']) {
        const f = fixture(); const runtime = await createMealRuntime(f.dependencies({ ...base, MEALS_DATABASE_URL: `postgresql://synthetic:synthetic@${address}:5432/postgres`, MEALS_LOCAL_DATABASE_HOST: address }));
        expect(runtime.state, address).toBe('enabled'); expect(f.configurations[0].ssl).toBe(false);
    }
    for (const [address, approved] of [['172.20.0.2', undefined], ['172.20.0.2', '172.20.0.3'], ['172.15.0.2', '172.15.0.2'],
        ['172.32.0.2', '172.32.0.2'], ['169.254.169.254', '169.254.169.254'], ['8.8.8.8', '8.8.8.8'], ['192.0.2.1', '192.0.2.1'],
        ['10.30.0.256', '10.30.0.256'], ['10.030.0.2', '10.030.0.2']]) {
        const f = fixture(); const runtime = await createMealRuntime(f.dependencies({ ...base, MEALS_DATABASE_URL: `postgresql://synthetic:synthetic@${address}:5432/postgres`, MEALS_LOCAL_DATABASE_HOST: approved }));
        expect(runtime.state, String(address)).toBe('disabled'); expect(f.configurations).toHaveLength(0);
    }
    // The local DB exception cannot change the Auth/plain-HTTP trust contract.
    const f = fixture(); expect((await createMealRuntime(f.dependencies({ ...base, MEALS_AUTH_URL: 'http://172.20.0.2:8000', MEALS_LOCAL_AUTH_HOST: '172.20.0.2' }))).state).toBe('disabled');
    const prod = fixture(); const runtime = await createMealRuntime(prod.dependencies({ ...production, MEALS_LOCAL_DATABASE_HOST: '172.20.0.2' }));
    expect(runtime.state).toBe('enabled'); expect(prod.configurations[0].ssl).toEqual({ rejectUnauthorized: true });
});
