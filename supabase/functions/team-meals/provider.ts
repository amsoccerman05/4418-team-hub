import type { MealMailer, MailResult, ProviderUsage, VerificationMail } from './mail.ts';
import { renderMealVerification, validMealSender, validPreparedMealEmail } from './email.ts';

export type ResendMealMailerOptions = {
    enabled?: boolean;
    apiKey?: string;
    from?: string;
    /** Inject a no-network fake for isolated unit tests only. The Edge entrypoint
     * always uses the platform fetch, with the fixed provider endpoint below. */
    fetcher?: typeof fetch;
};
const ENDPOINT = 'https://api.resend.com/emails';
const failure = (status: 'failed' | 'uncertain', code: string, retryable = false): MailResult => ({ status, code, retryable });
async function responseObject(response: Response): Promise<Record<string, unknown> | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let length = 0;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.length;
            if (length > 4096) { await reader.cancel(); return null; }
            chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch { return null; }
    finally { reader.releaseLock(); }
}
/** No SDK, retries, logs, Auth mail, or configurable provider URL. A successful
 * result means provider accepted, never inbox delivery. Recovery must send the
 * identical prepared body/key before the SQL retry deadline (under 24 hours). */
export class ResendMealMailer implements MealMailer {
    readonly mode: 'disabled' | 'resend';
    private readonly apiKey: string;
    private readonly from: string;
    private readonly fetcher: typeof fetch;
    constructor(options: ResendMealMailerOptions = {}) {
        this.apiKey = options.apiKey ?? ''; this.from = options.from ?? ''; this.fetcher = options.fetcher ?? fetch;
        this.mode = options.enabled === true && Boolean(this.apiKey) && this.apiKey.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(this.apiKey) && validMealSender(this.from) ? 'resend' : 'disabled';
    }
    async readUsage(): Promise<ProviderUsage> {
        if (this.mode !== 'resend') throw new Error('provider_usage_unavailable');
        const requestedAt = Date.now();
        try {
            const response = await this.fetcher('https://api.resend.com/usage', {
                method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
                headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
            });
            if (!response.ok || response.redirected || Date.now() - requestedAt > 10000) throw new Error();
            const responseDate = response.headers.get('date');
            if (responseDate && (!Number.isFinite(Date.parse(responseDate)) || requestedAt - Date.parse(responseDate) > 60000 || Date.parse(responseDate) - Date.now() > 5000)) throw new Error();
            const value = await responseObject(response);
            const emails = value?.emails as Record<string, unknown> | undefined;
            function window(input: unknown) {
                if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
                const row = input as Record<string, unknown>;
                const count = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 2147483647;
                if (!count(row.used) || !(row.limit === null || count(row.limit)) || typeof row.resets_at !== 'string' || !Number.isFinite(Date.parse(row.resets_at)) || Date.parse(row.resets_at) <= requestedAt) throw new Error();
                return { used: row.used as number, limit: row.limit as number | null, resetsAt: row.resets_at };
            }
            if (value?.object !== 'usage' || !emails || typeof emails !== 'object' || Array.isArray(emails)) throw new Error();
            const daily = window(emails.daily), monthly = window(emails.monthly);
            return { dailyUsed: daily.used, dailyLimit: daily.limit, monthlyUsed: monthly.used, monthlyLimit: monthly.limit,
                fetchedAt: new Date(requestedAt).toISOString(), dailyResetsAt: daily.resetsAt, monthlyResetsAt: monthly.resetsAt };
        } catch { throw new Error('provider_usage_unavailable'); }
    }
    prepare(mail: VerificationMail): string {
        if (this.mode !== 'resend') throw new Error('Meal email is disabled');
        return JSON.stringify(renderMealVerification(mail, this.from));
    }
    async send(mail: VerificationMail, idempotencyKey: string): Promise<MailResult> {
        if (this.mode !== 'resend') return failure('failed', 'mail_disabled');
        try { return await this.sendPrepared(this.prepare(mail), idempotencyKey); }
        catch { return failure('failed', 'invalid_email'); }
    }
    async sendPrepared(payload: string, idempotencyKey: string): Promise<MailResult> {
        if (this.mode !== 'resend') return failure('failed', 'mail_disabled');
        if (!/^[A-Za-z0-9:_/-]{1,256}$/.test(idempotencyKey) || !validPreparedMealEmail(payload)) return failure('failed', 'invalid_email');
        try {
            const response = await this.fetcher(ENDPOINT, {
                method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
                headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
                body: payload,
            });
            if (response.redirected) return failure('uncertain', 'provider_redirect', false);
            if (response.ok) {
                const value = await responseObject(response);
                return typeof value?.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.id)
                    ? { status: 'sent', providerId: value.id }
                    : failure('uncertain', 'provider_response_incomplete', true);
            }
            if (response.status === 409) {
                const value = await responseObject(response);
                return failure('uncertain', value?.name === 'concurrent_idempotent_requests' ? 'provider_concurrent_request' : 'provider_idempotency_conflict', value?.name === 'concurrent_idempotent_requests');
            }
            if (response.status === 429) return failure('failed', 'provider_rate_limited', true);
            if (response.status >= 500 || response.status === 408) return failure('uncertain', 'provider_unavailable', true);
            if (response.status >= 400 && response.status < 500) return failure('failed', 'provider_rejected', false);
            return failure('uncertain', 'provider_unexpected_response', false);
        } catch {
            // Provider exceptions may contain recipient, body, key or tokens.
            return failure('uncertain', 'provider_network_or_timeout', true);
        }
    }
}
