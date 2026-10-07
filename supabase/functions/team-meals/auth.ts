import type { VerifiedMealManager } from './postgres.ts';

export type MealAuthVerifierOptions = {
    /** Trusted server configuration only; never derived from an incoming request. */
    authBaseUrl: string;
    publicApiKey: string;
    /** Only the explicitly enabled isolated local-test runtime supplies an exact
     * single-label Docker service hostname. Never inferred from requests. */
    localTestHost?: string;
    fetcher: (input: string, init: RequestInit) => Promise<Response>;
};

/** Verify each bearer session with its configured Auth authority. No JWT payload
 * decoding, user_metadata authorization, environment lookup, session persistence,
 * or role caching. SQL separately checks the current active mentor/admin profile. */
export function createMealManagerVerifier(options: MealAuthVerifierOptions) {
    const base = new URL(options.authBaseUrl);
    const dockerHost = options.localTestHost;
    if (dockerHost !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(dockerHost))
        throw new Error('A trusted local Docker authority is required');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || Boolean(dockerHost && base.hostname === dockerHost);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
        base.username || base.password || base.search || base.hash || base.pathname !== '/')
        throw new Error('A trusted HTTPS Auth origin or isolated loopback origin is required');
    if (!options.publicApiKey || options.publicApiKey.length > 8192 || /[\s\r\n]/.test(options.publicApiKey) || options.publicApiKey.startsWith('sb_secret_'))
        throw new Error('A public Auth API key is required');
    // Legacy anon keys are JWT-shaped. Reading this configured key's role only
    // rejects accidental service credentials; it never authorizes a caller.
    const keyParts = options.publicApiKey.split('.');
    if (keyParts.length === 3) {
        try {
            const normalized = keyParts[1].replace(/-/g, '+').replace(/_/g, '/');
            const claims: unknown = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
            if (!claims || typeof claims !== 'object' || Array.isArray(claims) || (claims as { role?: unknown }).role !== 'anon') throw new Error();
        } catch { throw new Error('A public Auth API key is required'); }
    }
    const target = new URL('/auth/v1/user', base).toString();
    return async (request: Request): Promise<VerifiedMealManager | null> => {
        const authorization = request.headers.get('authorization');
        if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(authorization)) return null;
        try {
            const response = await options.fetcher(target, {
                method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
                headers: { apikey: options.publicApiKey, Authorization: authorization },
            });
            if (!response.ok || response.redirected) return null;
            const user: unknown = await response.json();
            if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
            const candidate = user as { id?: unknown; is_anonymous?: unknown };
            if (candidate.is_anonymous === true || typeof candidate.id !== 'string' ||
                !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidate.id)) return null;
            return { id: candidate.id };
        } catch {
            // No tokens, authority responses, or driver diagnostics in logs/errors.
            return null;
        }
    };
}
