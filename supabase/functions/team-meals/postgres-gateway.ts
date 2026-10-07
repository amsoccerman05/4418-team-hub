import type { ClaimReceipt } from '../../../src/meals/types.ts';
import { claimInput, createMealTransport, digest, fail, fields, integer, linkError, randomToken, RECEIPT_MESSAGE, text, validateMeal } from './gateway.ts';
import { DisabledMealMailer } from './mail.ts';
import type { MealMailer, VerificationMail } from './mail.ts';
import { PostgresMealDatabase } from './postgres.ts';
import type { MealSqlPool, SqlHold, VerifiedMealManager } from './postgres.ts';

export type PostgresMealGatewayOptions = {
    pool: MealSqlPool;
    allowedOrigins: string[];
    publicBaseUrl: string;
    mailer?: MealMailer;
    /** Must verify the session at the server authority. This draft does not decode
     * a caller JWT or implement a real Auth network integration. SQL independently
     * requires a fresh active mentor/admin profile for the returned subject. */
    authorizeManager?: (request: Request) => Promise<VerifiedMealManager | null>;
};
export async function digestBytes(value: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
function uuid(value: unknown, label: string): string {
    const result = text(value, label, 36);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result)) fail(400, 'invalid_input', `Check ${label}.`);
    return result.toLowerCase();
}
/** Explicit public projection: internal IDs, replay flags and outbox state never
 * accidentally become a public capability or per-email existence oracle. */
function receipt(hold: SqlHold): ClaimReceipt {
    const failed = hold.email_status === 'failed';
    return {
        status: 'pending_verification',
        email_status: hold.email_status === 'failed' ? 'unavailable' : hold.email_status,
        hold_expires_at: failed ? null : hold.hold_expires_at,
        message: failed ? 'Verification email could not be sent. No signup is held. Please contact the coordinator.' :
            hold.email_status === 'uncertain' ? 'The email provider response is uncertain. Check your inbox before trying again; this unverified hold will expire.' : RECEIPT_MESSAGE,
    };
}

/** Durable, injectable handler. Production index.ts stays inert. Defaults are
 * disabled mail, zero SQL mail budget, and no manager authorization. */
export function createPostgresMealGateway(options: PostgresMealGatewayOptions) {
    const database = new PostgresMealDatabase(options.pool), mailer = options.mailer ?? new DisabledMealMailer();
    const publicUrl = new URL(options.publicBaseUrl);
    if (!options.allowedOrigins.includes(publicUrl.origin) || publicUrl.username || publicUrl.password || publicUrl.search)
        throw new Error('Link origin must be explicitly allowlisted without credentials or query data');
    if (mailer.mode !== 'disabled' && mailer.mode !== 'mock') throw new Error('Live mail is not implemented');

    async function operation(body: Record<string, unknown>, request: Request, ip: string): Promise<unknown> {
        const op = text(body.operation, 'operation', 30);
        if (op === 'list') { fields(body, ['operation']); return database.list(); }
        if (op === 'claim') {
            const input = claimInput(body);
            input.meal_id = uuid(input.meal_id, 'meal'); if (input.slot_id) input.slot_id = uuid(input.slot_id, 'item');
            if (input.website) return { status: 'pending_verification', message: RECEIPT_MESSAGE, email_status: mailer.mode === 'disabled' ? 'unavailable' : 'queued', hold_expires_at: null } satisfies ClaimReceipt;
            if (mailer.mode === 'disabled') fail(503, 'mail_unavailable', 'Meal verification is not enabled yet. Please contact the coordinator.');
            if (!input.email.endsWith('.invalid')) fail(400, 'synthetic_email_required', 'This local preview accepts only addresses ending in .invalid.');
            const verificationToken = randomToken(), manageToken = randomToken();
            const hashes = {
                request: await digestBytes(`${input.meal_id}\0${await digest(input.email)}\0${input.idempotency_key}`),
                verify: await digestBytes(`verify:${verificationToken}`), manage: await digestBytes(`manage:${manageToken}`), ip: await digestBytes(ip),
            };
            const accepted = await database.createHold(input, hashes);
            if (accepted.can_send && accepted.outbox_id && await database.beginDelivery(accepted.outbox_id)) {
                const verificationUrl = new URL(publicUrl), manageUrl = new URL(publicUrl);
                verificationUrl.hash = `verify=${encodeURIComponent(verificationToken)}`;
                manageUrl.hash = `manage=${encodeURIComponent(manageToken)}`;
                const mail: VerificationMail = { to: input.email, claimId: accepted.claim_id, verificationToken, verificationUrl: verificationUrl.toString(), manageToken, manageUrl: manageUrl.toString() };
                // Lease is durably uncertain before this side effect. No retry on
                // provider exception, post-send SQL failure, or process interruption.
                let status: 'sent' | 'failed' | 'uncertain';
                try { status = (await mailer.send(mail, `meal-verification:${accepted.claim_id}`)).status; }
                catch { status = 'uncertain'; }
                await database.finishDelivery(accepted.outbox_id, status);
            }
            // Re-read through the idempotent SQL primitive, not private base tables.
            // The retained tombstone never spends another budget or sends again.
            return receipt(await database.createHold(input, hashes));
        }
        if (['verify', 'inspect', 'edit', 'cancel'].includes(op)) {
            fields(body, op === 'edit' ? ['operation', 'token', 'quantity', 'version'] : op === 'cancel' ? ['operation', 'token', 'version'] : ['operation', 'token']);
            if (typeof body.token !== 'string' || !/^m1_[a-f0-9]{64}$/.test(body.token)) linkError();
            if (op === 'verify') {
                const access = randomToken();
                const claim = await database.verify(await digestBytes(`verify:${body.token}`), await digestBytes(`access:${access}`));
                return { access_token: access, claim };
            }
            const hashes: [Uint8Array, Uint8Array] = [await digestBytes(`access:${body.token}`), await digestBytes(`manage:${body.token}`)];
            if (op === 'inspect') return database.inspect(hashes);
            const version = integer(body.version, 'version', 1, 1e9);
            if (op === 'cancel') return database.change(hashes, version, null, true);
            const quantity = integer(body.quantity, 'quantity', 1, 1000);
            // The SQL mutation rechecks version/capacity under its lock. This
            // read only aligns the whole-meal edit contract with the local UI.
            const current = await database.inspect(hashes);
            if (current.whole_meal) fail(409, 'coordination_required', 'Please coordinate whole-meal changes with the organizer, or cancel your signup.');
            return database.change(hashes, version, quantity, false);
        }
        if (!['manager', 'save_meal', 'cancel_claim'].includes(op)) fail(400, 'invalid_operation', 'Unknown operation.');
        fields(body, op === 'manager' ? ['operation'] : op === 'save_meal' ? ['operation', 'meal'] : ['operation', 'id', 'version', 'reason']);
        const manager = await options.authorizeManager?.(request);
        if (!manager || typeof manager.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(manager.id))
            fail(403, 'manager_required', 'Coordinator access is required.');
        if (op === 'manager') return { ...await database.manager(manager), mail_mode: mailer.mode };
        if (op === 'save_meal') {
            const meal = validateMeal(body.meal);
            if (meal.id) uuid(meal.id, 'meal');
            for (const slot of meal.slots) if (slot.id) uuid(slot.id, 'item');
            return database.saveMeal(manager, meal);
        }
        await database.cancelClaim(manager, uuid(body.id, 'signup'), integer(body.version, 'version', 1, 1e9), text(body.reason, 'cancellation reason', 300, 1, true));
        return null;
    }
    const handle = createMealTransport({
        allowedOrigins: options.allowedOrigins,
        reserveRequest: async ip => {
            if (!await database.reserveRequest(await digestBytes(ip))) fail(429, 'rate_limited', 'Too many requests. Try again later.');
        },
        operation,
    });
    return { handle };
}
