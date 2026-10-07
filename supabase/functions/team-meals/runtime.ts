import { createMealManagerVerifier } from './auth.ts';
import { SYNTHETIC_ENVELOPE_KEY } from './envelope.ts';
import { DisabledMealMailer, MockMealMailer } from './mail.ts';
import type { MealMailer } from './mail.ts';
import { createPostgresMealGateway } from './postgres-gateway.ts';
import type { MealSqlPool } from './postgres.ts';
import { ResendMealMailer } from './provider.ts';

export type MealEnvironment = { get(name: string): string | undefined };
export type MealPoolConfiguration = {
    connectionString: string; max: number; connectionTimeoutMillis: number;
    idleTimeoutMillis: number; statement_timeout: number; query_timeout: number;
    ssl: false | { rejectUnauthorized: true; ca?: string };
};
export type MealRuntimeDependencies = {
    env: MealEnvironment;
    createPool: (configuration: MealPoolConfiguration) => MealSqlPool | Promise<MealSqlPool>;
    /** Isolated tests inject a no-network fake. Never selected by caller data. */
    fetcher?: typeof fetch;
};
export type MealRuntime = {
    state: 'disabled' | 'enabled';
    handle: (request: Request) => Promise<Response> | Response;
};
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function response(status: number, code: string, message: string): Response { return new Response(JSON.stringify({ error: { code, message } }), { status, headers }); }
export function mealsUnavailable(): Response { return response(503, 'not_configured', 'Meal signups are not enabled.'); }
const disabled = (): MealRuntime => ({ state: 'disabled', handle: mealsUnavailable });
function required(env: MealEnvironment, name: string, ...fallbacks: string[]): string {
    const value = [name, ...fallbacks].map(key => env.get(key)).find(candidate => candidate !== undefined);
    if (!value || value.length > 16384 || value.trim() !== value) throw new Error('Invalid meal configuration');
    return value;
}
function validEnvelopeKey(value: string, local: boolean): boolean {
    try {
        if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
        const bytes = atob(value);
        return bytes.length === 32 && btoa(bytes) === value && (local || (value !== SYNTHETIC_ENVELOPE_KEY && new Set(bytes).size > 1));
    } catch { return false; }
}
function localHost(hostname: string, approved: string | undefined): boolean {
    return LOOPBACK.has(hostname) || Boolean(approved && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(approved) && hostname === approved);
}
function trustedUrl(value: string, local: boolean, allowPath: boolean, approvedLocalHost?: string): URL {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search || (!allowPath && url.pathname !== '/')) throw new Error('Invalid meal configuration');
    const isolated = localHost(url.hostname, approvedLocalHost) || url.hostname.endsWith('.invalid');
    if (local ? !isolated || (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost(url.hostname, approvedLocalHost))) : url.protocol !== 'https:' || isolated)
        throw new Error('Invalid meal configuration');
    return url;
}
/** Hash both values before comparison so all valid-length attempts perform the
 * same comparison work. Never log or echo a worker secret. */
async function matchesSecret(request: Request, expected: string): Promise<boolean> {
    const incoming = request.headers.get('authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9._~-]{32,512}$/.test(incoming)) return false;
    const encode = new TextEncoder();
    const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encode.encode(incoming.slice(7))), crypto.subtle.digest('SHA-256', encode.encode(expected))]);
    const left = new Uint8Array(a), right = new Uint8Array(b); let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
}
async function emptyWorkerBody(request: Request): Promise<boolean> {
    if (!request.body) return true;
    const reader = request.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
    try {
        for (;;) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.length;
            if (length > 64) { await reader.cancel(); return false; }
            chunks.push(part.value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
        const value = new TextDecoder().decode(bytes).trim();
        if (!value) return true;
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return false;
        const parsed: unknown = JSON.parse(value);
        return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0);
    } catch { return false; }
    finally { reader.releaseLock(); }
}
function trustedIp(env: MealEnvironment, local: boolean): (request: Request) => string {
    const mode = env.get('MEALS_IP_MODE') ?? 'shared';
    // Proxy forwarding headers are untrusted unless deployment review verified
    // this exact single-address header is overwritten at every ingress path.
    if (mode === 'shared') return () => 'untrusted-shared';
    const header = env.get('MEALS_TRUSTED_IP_HEADER') ?? '';
    if (local || mode !== 'trusted-proxy' || env.get('MEALS_TRUSTED_PROXY_VERIFIED') !== 'true' || !['cf-connecting-ip', 'x-real-ip'].includes(header))
        throw new Error('Invalid meal configuration');
    return request => {
        const value = request.headers.get(header) ?? '';
        // Never split X-Forwarded-For or take a caller-selected leftmost address.
        // Reject invalid/list/port/zone-id values into the conservative bucket.
        if (value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value)) return 'untrusted-shared';
        try {
            if (value.includes(':')) return new URL(`http://[${value}]/`).hostname.slice(1, -1);
            const octets = value.split('.');
            if (octets.length !== 4 || octets.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return 'untrusted-shared';
            return octets.map(Number).join('.');
        } catch { return 'untrusted-shared'; }
    };
}

/** A complete deployable runtime with no activation side effects. Configuration
 * failure disables the handler before a pool is created or any network call is
 * made. Merely deploying this module leaves all SQL mail quotas at zero. */
export async function createMealRuntime(dependencies: MealRuntimeDependencies): Promise<MealRuntime> {
    const { env } = dependencies;
    if (env.get('MEALS_ENABLED') !== 'true') return disabled();
    try {
        const mode = required(env, 'MEALS_RUNTIME_MODE');
        if (mode !== 'production' && mode !== 'local-test') return disabled();
        const local = mode === 'local-test';
        const page = trustedUrl(required(env, 'MEALS_PUBLIC_BASE_URL'), local, true);
        const origins: unknown = JSON.parse(required(env, 'MEALS_ALLOWED_ORIGINS'));
        if (!Array.isArray(origins) || !origins.length || origins.length > 10 || !origins.every(value => typeof value === 'string' && trustedUrl(value, local, false).origin === value) || !origins.includes(page.origin))
            return disabled();
        const databaseUrl = new URL(required(env, 'MEALS_DATABASE_URL', 'SUPABASE_DB_URL'));
        if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.username || databaseUrl.pathname.length < 2 || databaseUrl.search || databaseUrl.hash ||
            (local ? !localHost(databaseUrl.hostname, env.get('MEALS_LOCAL_DATABASE_HOST')) : LOOPBACK.has(databaseUrl.hostname) || databaseUrl.hostname.endsWith('.invalid') || !databaseUrl.password)) return disabled();
        const auth = trustedUrl(required(env, 'MEALS_AUTH_URL', 'SUPABASE_URL'), local, false, env.get('MEALS_LOCAL_AUTH_HOST'));
        const fetcher = dependencies.fetcher ?? fetch;
        const verify = createMealManagerVerifier({ authBaseUrl: auth.origin, publicApiKey: required(env, 'MEALS_AUTH_PUBLIC_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'), fetcher,
            ...(local && env.get('MEALS_LOCAL_AUTH_HOST') ? { localTestHost: env.get('MEALS_LOCAL_AUTH_HOST') } : {}),
        });
        const ip = trustedIp(env, local);
        let mailer: MealMailer = new DisabledMealMailer();
        let envelopeKey: string | undefined;
        if (env.get('MEALS_MAIL_ENABLED') === 'true') {
            const mailMode = required(env, 'MEALS_MAIL_MODE');
            if (local) {
                if (mailMode !== 'mock' || env.get('RESEND_API_KEY') || env.get('NOTIFICATIONS_FROM')) return disabled();
                mailer = new MockMealMailer();
                envelopeKey = env.get('MEALS_ENVELOPE_KEY');
            } else {
                if (mailMode !== 'resend') return disabled();
                envelopeKey = required(env, 'MEALS_ENVELOPE_KEY');
                if (!validEnvelopeKey(envelopeKey, false)) return disabled();
                mailer = new ResendMealMailer({ enabled: true, apiKey: required(env, 'RESEND_API_KEY'), from: required(env, 'NOTIFICATIONS_FROM'), fetcher });
                if (mailer.mode !== 'resend') return disabled();
            }
        }
        if (envelopeKey !== undefined && !validEnvelopeKey(envelopeKey, local)) return disabled();
        const dispatchEnabled = env.get('MEALS_DISPATCH_ENABLED') === 'true';
        const workerSecret = dispatchEnabled ? required(env, 'MEALS_WORKER_SECRET') : '';
        if (dispatchEnabled && (mailer.mode === 'disabled' || !/^[A-Za-z0-9._~-]{32,512}$/.test(workerSecret))) return disabled();
        const pool = await dependencies.createPool({ connectionString: databaseUrl.toString(), max: 2, connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 10000, statement_timeout: 8000, query_timeout: 10000,
            ssl: local ? false : { rejectUnauthorized: true, ...(env.get('MEALS_DATABASE_CA') ? { ca: env.get('MEALS_DATABASE_CA') } : {}) },
        });
        const gateway = createPostgresMealGateway({ pool, allowedOrigins: origins, publicBaseUrl: page.toString(), mailer, envelopeKey, deferDelivery: local && env.get('MEALS_LOCAL_DEFER_DELIVERY') === 'true', authorizeManager: verify });
        return { state: 'enabled', async handle(request) {
            const url = new URL(request.url);
            // Dispatch is a separate exact path, never a public JSON operation.
            if (url.pathname === '/team-meals/dispatch' || url.pathname === '/functions/v1/team-meals/dispatch') {
                if (!dispatchEnabled) return response(404, 'not_found', 'Not found.');
                if (request.method !== 'POST' || url.search || request.headers.has('origin')) return response(400, 'invalid_request', 'Use the configured worker request.');
                if (!await matchesSecret(request, workerSecret)) return response(403, 'worker_required', 'Worker access is required.');
                if (!await emptyWorkerBody(request)) return response(400, 'invalid_request', 'Use an empty worker request.');
                try { return new Response(JSON.stringify(await gateway.dispatchPending(3)), { status: 200, headers }); }
                catch { return response(503, 'temporarily_unavailable', 'The meal service is temporarily unavailable. Try again later.'); }
            }
            if (!['/team-meals', '/team-meals/', '/functions/v1/team-meals', '/functions/v1/team-meals/'].includes(url.pathname)) return response(404, 'not_found', 'Not found.');
            return gateway.handle(request, { ip: ip(request) });
        } };
    } catch { return disabled(); }
}
