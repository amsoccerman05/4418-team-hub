import type { VerifiedMealManager } from './postgres.ts';

export type MealAuthVerifierOptions = {
    /** Trusted server configuration only; never derived from an incoming request. */
    authBaseUrl: string;
    publicApiKey: string;
    fetcher: (input: string, init: RequestInit) => Promise<Response>;
};

/** Verify each bearer session with its configured Auth authority. No JWT payload
 * decoding, user_metadata authorization, environment lookup, session persistence,
 * or role caching. SQL separately checks the current active mentor/admin profile. */
export function createMealManagerVerifier(options: MealAuthVerifierOptions) {
    const base = new URL(options.authBaseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
        base.username || base.password || base.search || base.hash || base.pathname !== '/')
        throw new Error('A trusted HTTPS Auth origin or isolated loopback origin is required');
    if (!options.publicApiKey || options.publicApiKey.length > 8192 || /[\s\r\n]/.test(options.publicApiKey) || options.publicApiKey.startsWith('sb_secret_'))
        throw new Error('A public Auth API key is required');
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
