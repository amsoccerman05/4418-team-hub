/** Mail content (including plaintext link tokens) exists only for an immediate
 * send attempt, never in an outbox record, application log, or persisted file. */
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
};
export interface MealMailer {
    readonly mode: 'disabled' | 'mock';
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
