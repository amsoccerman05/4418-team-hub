import { test, expect } from '@playwright/test';
import { ResendMealMailer } from '../supabase/functions/team-meals/provider.ts';
import { escapeMealHtml, renderMealVerification, validPreparedMealEmail } from '../supabase/functions/team-meals/email.ts';
import type { VerificationMail } from '../supabase/functions/team-meals/mail.ts';
const verify = `m1_${'a'.repeat(64)}`, manage = `m1_${'b'.repeat(64)}`;
const mail: VerificationMail = { to: 'adult@example.invalid', claimId: '00000000-0000-0000-0000-000000000001', verificationToken: verify,
    verificationUrl: `https://meals.example.invalid/meals.html#verify=${verify}`, manageToken: manage, manageUrl: `https://meals.example.invalid/meals.html#manage=${manage}` };
const settings = { enabled: true, apiKey: 'synthetic-provider-key', from: '4418 Test <meals@example.invalid>' };
const key = 'meal-verification:00000000-0000-0000-0000-000000000001';

test('Resend uses immutable exact bytes, fixed endpoint, stable key and accepted-only state', async () => {
    const requests: { input: unknown; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => { requests.push({ input, init }); return Response.json({ id: 'synthetic-provider-id' }); };
    const first = new ResendMealMailer({ ...settings, fetcher });
    const payload = first.prepare(mail);
    expect(await first.sendPrepared(payload, key)).toEqual({ status: 'sent', providerId: 'synthetic-provider-id' });
    const recreated = new ResendMealMailer({ ...settings, from: 'Changed <different@example.invalid>', fetcher });
    expect(await recreated.sendPrepared(payload, key)).toEqual({ status: 'sent', providerId: 'synthetic-provider-id' });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
        expect(request.input).toBe('https://api.resend.com/emails'); expect(request.init?.body).toBe(payload);
        expect(request.init?.method).toBe('POST'); expect(request.init?.redirect).toBe('error'); expect(request.init?.cache).toBe('no-store');
        expect(request.init?.signal).toBeInstanceOf(AbortSignal);
        expect(request.init?.headers).toEqual({ Authorization: 'Bearer synthetic-provider-key', 'Content-Type': 'application/json', 'Idempotency-Key': key });
    }
    const parsed = JSON.parse(payload);
    expect(parsed.to).toEqual([mail.to]); expect(parsed.from).toBe(settings.from);
    expect(parsed.text).toContain(mail.verificationUrl); expect(parsed.html).toContain(mail.manageUrl);
    expect(parsed.subject).not.toContain(mail.to); expect(parsed.text).toContain('only after you confirm');
});

test('missing or disabled configuration performs no provider calls', async () => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error('Must not call'); };
    for (const options of [{}, { ...settings, enabled: false }, { ...settings, apiKey: '' }, { ...settings, apiKey: 'bad\nkey' }, { ...settings, from: 'bad\nsender' }]) {
        const provider = new ResendMealMailer({ ...options, fetcher });
        expect(provider.mode).toBe('disabled'); expect(await provider.send(mail, key)).toMatchObject({ status: 'failed', retryable: false });
        expect(await provider.sendPrepared('{}', key)).toMatchObject({ status: 'failed', code: 'mail_disabled' });
    }
    expect(calls).toBe(0);
});

for (const status of [400, 401, 403, 404, 413, 422]) test(`Resend definite rejection ${status} cannot be mistaken for accepted or retryable`, async () => {
    const provider = new ResendMealMailer({ ...settings, fetcher: async () => new Response('private message content', { status }) });
    expect(await provider.send(mail, key)).toEqual({ status: 'failed', code: 'provider_rejected', retryable: false });
});

for (const status of [408, 500, 502, 503]) test(`Resend ${status} preserves provider uncertainty for same-envelope retry`, async () => {
    const provider = new ResendMealMailer({ ...settings, fetcher: async () => new Response('', { status }) });
    expect(await provider.send(mail, key)).toEqual({ status: 'uncertain', code: 'provider_unavailable', retryable: true });
});

test('Resend quota rejection is retryable without asserting acceptance', async () => {
    const provider = new ResendMealMailer({ ...settings, fetcher: async () => new Response('', { status: 429 }) });
    expect(await provider.send(mail, key)).toEqual({ status: 'failed', code: 'provider_rate_limited', retryable: true });
});

test('409 concurrency retries exact bytes; mismatch and unknown409 never invent replacement keys', async () => {
    for (const name of ['concurrent_idempotent_requests', 'invalid_idempotent_request', 'unknown']) {
        const provider = new ResendMealMailer({ ...settings, fetcher: async () => Response.json({ name, message: 'private response' }, { status: 409 }) });
        const result = await provider.send(mail, key);
        expect(result).toMatchObject({ status: 'uncertain', retryable: name === 'concurrent_idempotent_requests' });
        expect(JSON.stringify(result)).not.toContain('private response');
    }
});

test('network, malformed, oversized and incomplete success stay uncertain without logging private data', async () => {
    const fakeResponses: (typeof fetch)[] = [async () => { throw new Error(`${mail.to} ${verify}`); }, async () => new Response('bad JSON'),
        async () => Response.json({}), async () => Response.json({ id: mail.to }), async () => Response.json({ id: 'valid', padding: 'x'.repeat(5000) })];
    for (const fetcher of fakeResponses) {
        const result = await new ResendMealMailer({ ...settings, fetcher }).send(mail, key);
        expect(result).toMatchObject({ status: 'uncertain', retryable: true });
        expect(JSON.stringify(result)).not.toContain(verify); expect(JSON.stringify(result)).not.toContain(mail.to);
    }
});

test('renderer and prepared-payload checks reject header injection, wrong-purpose links and extra recipients', async () => {
    expect(escapeMealHtml('<a "x">&\'')).toBe('&lt;a &quot;x&quot;&gt;&amp;&#39;');
    expect(() => renderMealVerification({ ...mail, verificationUrl: mail.manageUrl }, settings.from)).toThrow('Invalid meal email');
    expect(() => renderMealVerification(mail, 'Sender\r\nBcc: bad@example.invalid')).toThrow('Invalid meal email');
    const payload = renderMealVerification(mail, settings.from);
    for (const bad of [{ ...payload, to: [mail.to, 'other@example.invalid'] }, { ...payload, bcc: ['other@example.invalid'] }, { ...payload, subject: 'Line\nInjected' }])
        expect(validPreparedMealEmail(JSON.stringify(bad))).toBe(false);
    let calls = 0; const provider = new ResendMealMailer({ ...settings, fetcher: async () => { calls++; return Response.json({ id: 'no' }); } });
    expect(await provider.sendPrepared(JSON.stringify(payload), 'bad\nkey')).toMatchObject({ status: 'failed', code: 'invalid_email' });
    expect(await provider.sendPrepared('{"to":[]}', key)).toMatchObject({ status: 'failed', code: 'invalid_email' }); expect(calls).toBe(0);
});

function usage() {
    return { object: 'usage', emails: { daily: { used: 80, limit: 100, resets_at: new Date(Date.now() + 86400000).toISOString() },
        monthly: { used: 2100, limit: 3000, resets_at: new Date(Date.now() + 30 * 86400000).toISOString() } } };
}
test('fresh actual account daily/monthly usage is fetched without caching or sending mail', async () => {
    const calls: { url: unknown; init?: RequestInit }[] = [];
    const provider = new ResendMealMailer({ ...settings, fetcher: async (url, init) => { calls.push({ url, init }); return Response.json(usage()); } });
    const result = await provider.readUsage();
    expect(result).toMatchObject({ dailyUsed: 80, dailyLimit: 100, monthlyUsed: 2100, monthlyLimit: 3000 });
    expect(Date.now() - Date.parse(result.fetchedAt)).toBeLessThan(1000); expect(calls[0].url).toBe('https://api.resend.com/usage');
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    expect(calls[0].init?.body).toBeUndefined();
});

test('quota guards fail closed on insufficient key access, missing counts, negative counts, stale reset/date or network', async () => {
    const negative = usage(); negative.emails.daily.used = -1;
    const staleReset = usage(); staleReset.emails.daily.resets_at = new Date(Date.now() - 1000).toISOString();
    for (const fetcher of [async () => new Response('', { status: 403 }), async () => Response.json({}), async () => Response.json(negative),
        async () => Response.json(staleReset), async () => Response.json(usage(), { headers: { date: new Date(Date.now() - 120000).toUTCString() } }), async () => { throw new Error(mail.to); }]) {
        await expect(new ResendMealMailer({ ...settings, fetcher }).readUsage()).rejects.toThrow('provider_usage_unavailable');
    }
});

test('provider explicitly uncapped plan windows remain null, never invented counts', async () => {
    const value = usage(); (value.emails.daily as { limit: number | null }).limit = null;
    const result = await new ResendMealMailer({ ...settings, fetcher: async () => Response.json(value) }).readUsage();
    expect(result.dailyLimit).toBeNull(); expect(result.dailyUsed).toBe(80);
});
