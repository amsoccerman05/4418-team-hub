/** Plaintext exists only in memory. Durable delivery uses an authenticated,
 * short-lived envelope containing the immutable exact provider request. */
export type VerificationMail = {
    to: string;
    claimId: string;
    verificationToken: string;
    verificationUrl: string;
    manageToken: string;
    manageUrl: string;
};
export type MailResult = {
    status: 'sent';
    providerId: string;
} | {
    status: 'failed' | 'uncertain';
    retryable?: boolean;
    code?: string;
};
export type ProviderUsage = {
    dailyUsed: number; dailyLimit: number | null;
    monthlyUsed: number; monthlyLimit: number | null;
    fetchedAt: string; dailyResetsAt: string; monthlyResetsAt: string;
};
/** Synthetic-only allowance, never a production usage fallback. */
export function mockProviderUsage(): ProviderUsage {
    return { dailyUsed: 0, dailyLimit: 10000, monthlyUsed: 0, monthlyLimit: 100000,
        fetchedAt: new Date().toISOString(), dailyResetsAt: new Date(Date.now() + 86400000).toISOString(), monthlyResetsAt: new Date(Date.now() + 32 * 86400000).toISOString() };
}
export interface MealMailer {
    readonly mode: 'disabled' | 'mock' | 'resend';
    prepare?(mail: VerificationMail): string;
    sendPrepared?(payload: string, idempotencyKey: string): Promise<MailResult>;
    readUsage?(): Promise<ProviderUsage>;
    send(mail: VerificationMail, idempotencyKey: string): Promise<MailResult>;
}
export class DisabledMealMailer implements MealMailer {
    readonly mode = 'disabled' as const;
    async send(): Promise<MailResult> { return { status: 'failed' }; }
}
/** This mock cannot route real mail. Memory-only mailbox is visible only to the
 * local fixture harness; it must never be exposed by a production endpoint. */
export class MockMealMailer implements MealMailer {
    readonly mode = 'mock' as const;
    readonly mailbox: VerificationMail[] = [];
    prepare(mail: VerificationMail): string { return JSON.stringify(mail); }
    sendPrepared(payload: string, key: string): Promise<MailResult> { return this.send(JSON.parse(payload), key); }
    readUsage(): Promise<ProviderUsage> { return Promise.resolve(mockProviderUsage()); }
    readonly attempts: string[] = [];
    nextOutcome: 'sent' | 'failed' | 'uncertain' | 'throw' = 'sent';
    private results = new Map<string, MailResult>();
    async send(mail: VerificationMail, idempotencyKey: string): Promise<MailResult> {
        if (!/^[^\s@]+@[^\s@]+\.invalid$/i.test(mail.to))
            return { status: 'failed' };
        const known = this.results.get(idempotencyKey);
        if (known)
            return known;
        this.attempts.push(idempotencyKey);
        const next = this.nextOutcome;
        this.nextOutcome = 'sent';
        if (next === 'throw') {
            this.results.set(idempotencyKey, { status: 'uncertain' });
            throw new Error('Simulated ambiguous provider response');
        }
        const result: MailResult = next === 'sent' ? { status: 'sent', providerId: `mock-${crypto.randomUUID()}` } : { status: next };
        this.results.set(idempotencyKey, result);
        if (next === 'sent' || next === 'uncertain')
            this.mailbox.push(structuredClone(mail));
        return result;
    }
}
