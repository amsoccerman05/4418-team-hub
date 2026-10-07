import type { ClaimInput, ClaimReceipt, ManagedClaim, MealDraft, MealManagerSnapshot, PrivateClaim, PublicMeal } from '../../../src/meals/types.ts';
import type { ClaimRecord, MealRecord, MealRepository, MealTransaction, TokenRecord } from './store.ts';
import { DisabledMealMailer } from './mail.ts';
import type { MealMailer, VerificationMail } from './mail.ts';
const MINUTE = 60000, DAY = 86400000;
const GENERIC_LINK = 'This link is unavailable or expired. Ask the meal coordinator for help.';
const RECEIPT_MESSAGE = 'If this request can be accepted, a verification link will be sent. Your signup counts only after verification.';
/** Trusted transport metadata only; never copy user-controlled forwarding headers. */
export type RequestContext = {
    ip: string;
};
export type GatewayLimits = {
    holdMs: number;
    accessMs: number;
    idempotencyMs: number;
    ipRequestsPerMinute: number;
    claimsPerIp: number;
    claimsPerEmail: number;
    claimWindowMs: number;
    dailyMailBudget: number;
};
export type GatewayOptions = {
    repository: MealRepository;
    allowedOrigins: string[];
    publicBaseUrl: string;
    mailer?: MealMailer;
    now?: () => number;
    limits?: Partial<GatewayLimits>;
    authorizeManager?: (request: Request) => Promise<{
        id: string;
    } | null>;
};
const DEFAULT_LIMITS: GatewayLimits = { holdMs: 15 * MINUTE, accessMs: 30 * MINUTE, idempotencyMs: DAY, ipRequestsPerMinute: 120, claimsPerIp: 12, claimsPerEmail: 4, claimWindowMs: 60 * MINUTE, dailyMailBudget: 0 };
class GatewayError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
function fail(status: number, code: string, message: string): never { throw new GatewayError(status, code, message); }
function linkError(): never { return fail(403, 'invalid_link', GENERIC_LINK); }
const iso = (n: number) => new Date(n).toISOString();
const randomToken = () => `m1_${Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('')}`;
export async function digest(value: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join(''); }
function text(value: unknown, label: string, max: number, min = 1, multiline = false): string { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || (multiline ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value))
    fail(400, 'invalid_input', `Check ${label}.`); return (value as string).trim(); }
function integer(value: unknown, label: string, min: number, max: number): number { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    fail(400, 'invalid_input', `Check ${label}.`); return Number(value); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(400, 'invalid_input', 'Expected a JSON object.'); return value as Record<string, unknown>; }
function fields(row: Record<string, unknown>, allowed: string[]) { if (Object.keys(row).some(key => !allowed.includes(key)))
    fail(400, 'invalid_input', 'Unexpected request fields.'); }
function claimInput(body: Record<string, unknown>): ClaimInput {
    fields(body, ['operation', 'meal_id', 'slot_id', 'whole_meal', 'quantity', 'name', 'email', 'idempotency_key', 'website']);
    const email = text(body.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail(400, 'invalid_input', 'Check email.');
    const input = { meal_id: text(body.meal_id, 'meal', 80), slot_id: body.slot_id === null ? null : text(body.slot_id, 'item', 80), whole_meal: body.whole_meal as boolean, quantity: integer(body.quantity, 'quantity', 1, 1000), name: text(body.name, 'adult name', 80), email, idempotency_key: text(body.idempotency_key, 'request key', 128, 16), website: body.website === undefined ? '' : text(body.website, 'website', 200, 0) };
    if (typeof input.whole_meal !== 'boolean' || (input.whole_meal ? (input.slot_id !== null || input.quantity !== 1) : !input.slot_id))
        fail(400, 'invalid_input', 'Choose an item quantity or the whole meal.');
    return input;
}
export function validateMeal(value: unknown): MealDraft {
    const draft = record(value);
    fields(draft, ['id', 'version', 'title', 'service_at', 'timezone', 'expected_headcount', 'guidance', 'status', 'slots', 'cancellation_reason', 'acknowledge_cancellation']);
    const at = text(draft.service_at, 'meal time', 40);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(at) || !Number.isFinite(Date.parse(at)))
        fail(400, 'invalid_input', 'Use a complete meal time with timezone.');
    const datePart = at.slice(0, 10);
    if (new Date(datePart + 'T00:00:00Z').toISOString().slice(0, 10) !== datePart || Number(at.slice(11, 13)) > 23 || Number(at.slice(14, 16)) > 59)
        fail(400, 'invalid_input', 'Check the calendar date and time.');
    const timezone = text(draft.timezone, 'timezone', 80);
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    }
    catch {
        fail(400, 'invalid_input', 'Check timezone.');
    }
    if (new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date(at)) !== 'Sat')
        fail(400, 'invalid_input', 'Choose a Saturday in the meal timezone.');
    if (!['open', 'closed', 'cancelled'].includes(String(draft.status)))
        fail(400, 'invalid_input', 'Check meal status.');
    if (!Array.isArray(draft.slots) || draft.slots.length < 1 || draft.slots.length > 30)
        fail(400, 'invalid_input', 'Add between 1 and 30 item slots.');
    const slots = (draft.slots as unknown[]).map(value => { const slot = record(value); fields(slot, ['id', 'label', 'category', 'unit', 'needed']); if (!['main', 'side', 'drink', 'supply', 'other'].includes(String(slot.category)))
        fail(400, 'invalid_input', 'Check item category.'); return { id: slot.id === undefined ? undefined : text(slot.id, 'item id', 80), label: text(slot.label, 'item label', 100), category: slot.category as MealDraft['slots'][number]['category'], unit: text(slot.unit, 'item unit', 40), needed: integer(slot.needed, 'needed quantity', 1, 1000) }; });
    const ids = slots.map(s => s.id).filter(Boolean);
    if (new Set(ids).size !== ids.length)
        fail(400, 'invalid_input', 'Item IDs must be unique.');
    return { id: draft.id === undefined ? undefined : text(draft.id, 'meal id', 80), version: draft.version === undefined ? undefined : integer(draft.version, 'version', 1, 1e9), title: text(draft.title, 'title', 120), service_at: iso(Date.parse(at)), timezone, expected_headcount: integer(draft.expected_headcount, 'headcount', 1, 1000), guidance: text(draft.guidance, 'guidance', 2000, 0, true), status: draft.status as MealDraft['status'], slots, ...(draft.cancellation_reason !== undefined ? { cancellation_reason: text(draft.cancellation_reason, 'cancellation reason', 300, 1, true) } : {}), ...(draft.acknowledge_cancellation === true ? { acknowledge_cancellation: true } : {}) };
}
const active = (c: ClaimRecord) => c.status === 'pending' || c.status === 'confirmed';
/** Coverage is part of the reviewed manager snapshot. Bump in the same transaction
 * so an old cancellation acknowledgment cannot affect newly arrived signups. */
async function bumpMealVersion(tx: MealTransaction, mealId: string) {
    const meal = await tx.get('meals', mealId);
    if (meal) await tx.put('meals', { ...meal, version: meal.version + 1 });
}
async function expire(tx: MealTransaction, now: number) {
    for (const claim of await tx.list('claims'))
        if (claim.status === 'pending' && Date.parse(claim.hold_expires_at!) <= now) {
            claim.status = 'expired';
            claim.version++;
            claim.updated_at = now;
            await tx.put('claims', claim);
            await bumpMealVersion(tx, claim.meal_id);
            await revoke(tx, claim.id, now);
        }
    for (const token of await tx.list('tokens'))
        if (token.expires_at <= now)
            await tx.remove('tokens', token.id);
    for (const key of await tx.list('idempotency'))
        if (key.expires_at <= now)
            await tx.remove('idempotency', key.id);
    for (const key of await tx.list('counters'))
        if (key.expires_at <= now)
            await tx.remove('counters', key.id);
}
async function revoke(tx: MealTransaction, claimId: string, now: number) { for (const token of await tx.list('tokens'))
    if (token.claim_id === claimId && token.revoked_at === null)
        await tx.put('tokens', { ...token, revoked_at: now }); }
export function publicMeal(meal: MealRecord, claims: ClaimRecord[]): PublicMeal {
    const mine = claims.filter(c => c.meal_id === meal.id && active(c));
    const whole = mine.find(c => c.whole_meal);
    return { id: meal.id, title: meal.title, service_at: meal.service_at, timezone: meal.timezone, expected_headcount: meal.expected_headcount, guidance: meal.guidance, status: meal.status, version: meal.version, whole_meal: whole ? (whole.status === 'confirmed' ? 'confirmed' : 'held') : mine.length ? 'coordination_required' : 'available', slots: meal.slots.map(slot => { const items = mine.filter(c => c.slot_id === slot.id); const confirmed = whole?.status === 'confirmed' ? slot.needed : items.filter(c => c.status === 'confirmed').reduce((n, c) => n + c.quantity, 0); const held = whole?.status === 'pending' ? slot.needed : items.filter(c => c.status === 'pending').reduce((n, c) => n + c.quantity, 0); return { id: slot.id, label: slot.label, category: slot.category, unit: slot.unit, needed: slot.needed, confirmed, held, remaining: Math.max(0, slot.needed - confirmed - held) }; }) };
}
async function privateClaim(tx: MealTransaction, claim: ClaimRecord, expiresAt: number): Promise<PrivateClaim> { const meal = await tx.get('meals', claim.meal_id); if (!meal)
    linkError(); return { id: claim.id, meal: publicMeal(meal!, await tx.list('claims')), slot_id: claim.slot_id, whole_meal: claim.whole_meal, quantity: claim.quantity, name: claim.name, status: claim.status, version: claim.version, access_expires_at: iso(expiresAt) }; }
async function reserve(tx: MealTransaction, id: string, limit: number, windowMs: number, now: number) { const prior = await tx.get('counters', id); const current = prior && prior.expires_at > now ? prior : { id, count: 0, expires_at: now + windowMs }; if (current.count >= limit)
    fail(429, 'rate_limited', 'Too many requests. Try again later.'); await tx.put('counters', { ...current, count: current.count + 1 }); }
async function bodyJson(request: Request): Promise<Record<string, unknown>> {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
        fail(415, 'invalid_content_type', 'Use application/json.');
    const length = request.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > 16384))
        fail(413, 'request_too_large', 'Request is too large.');
    const reader = request.body?.getReader();
    if (!reader)
        fail(400, 'invalid_input', 'Missing request body.');
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const part = await reader!.read();
        if (part.done)
            break;
        size += part.value.byteLength;
        if (size > 16384) {
            await reader!.cancel();
            fail(413, 'request_too_large', 'Request is too large.');
        }
        chunks.push(part.value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
        buffer.set(part, offset);
        offset += part.length;
    }
    try {
        return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
    }
    catch (error) {
        if (error instanceof GatewayError)
            throw error;
        return fail(400, 'invalid_input', 'Invalid JSON.');
    }
}
export function createMealGateway(options: GatewayOptions) {
    const repository = options.repository, mailer = options.mailer ?? new DisabledMealMailer(), now = options.now ?? Date.now, limits = { ...DEFAULT_LIMITS, ...options.limits };
    const origins = new Set(options.allowedOrigins);
    const publicUrl = new URL(options.publicBaseUrl);
    if (!origins.has(publicUrl.origin))
        throw new Error('Link origin must be explicitly allowlisted');
    if (Object.entries(limits).some(([key, n]) => !Number.isSafeInteger(n) || (key === 'dailyMailBudget' ? n < 0 : n <= 0)) || limits.holdMs > 60 * MINUTE || limits.accessMs > 60 * MINUTE || limits.idempotencyMs > 2 * DAY)
        throw new Error('Invalid security limits');
    async function processMail(mail: VerificationMail) {
        const attempt = await repository.transaction(['outbox:' + mail.claimId], async (tx) => { const outbox = await tx.get('outbox', mail.claimId); const claim = await tx.get('claims', mail.claimId); const meal = claim ? await tx.get('meals', claim.meal_id) : undefined; if (!outbox || outbox.state !== 'queued' || !claim || claim.status !== 'pending' || Date.parse(claim.hold_expires_at!) <= now() || !meal || meal.status !== 'open' || Date.parse(meal.service_at) <= now())
            return null; const attemptId = crypto.randomUUID(); await tx.put('outbox', { ...outbox, state: 'uncertain', attempt_id: attemptId, attempted_at: now() }); await tx.put('claims', { ...claim, email_status: 'uncertain' }); for (const key of await tx.list('idempotency'))
            if (key.claim_id === claim.id)
                await tx.put('idempotency', { ...key, receipt: { ...key.receipt, email_status: 'uncertain' } }); return attemptId; });
        if (!attempt)
            return;
        // Unknown exceptions and process interruption must never cause a blind retry.
        let result: Awaited<ReturnType<MealMailer['send']>>;
        try {
            result = await mailer.send(mail, `meal-verification:${mail.claimId}`);
        }
        catch {
            result = { status: 'uncertain' };
        }
        await repository.transaction(['outbox:' + mail.claimId, 'meal-claims'], async (tx) => { const outbox = await tx.get('outbox', mail.claimId); const claim = await tx.get('claims', mail.claimId); if (!outbox || outbox.attempt_id !== attempt || !claim)
            return; await tx.put('outbox', { ...outbox, state: result.status, provider_id: result.status === 'sent' ? result.providerId : null }); await tx.put('claims', { ...claim, email_status: result.status }); if (result.status === 'failed' && claim.status === 'pending') {
            await tx.put('claims', { ...claim, email_status: 'failed', status: 'expired', version: claim.version + 1, updated_at: now() });
            await bumpMealVersion(tx, claim.meal_id);
            await revoke(tx, claim.id, now());
        } for (const key of await tx.list('idempotency'))
            if (key.claim_id === claim.id)
                await tx.put('idempotency', { ...key, receipt: { ...key.receipt, email_status: result.status === 'failed' ? 'unavailable' : result.status, hold_expires_at: result.status === 'failed' ? null : key.receipt.hold_expires_at, message: result.status === 'failed' ? 'Verification email could not be sent. No signup is held. Please contact the coordinator.' : result.status === 'uncertain' ? 'The email provider response is uncertain. Check your inbox before trying again; this unverified hold will expire.' : RECEIPT_MESSAGE } }); });
    }
    async function operation(body: Record<string, unknown>, request: Request, ip: string): Promise<unknown> {
        const op = text(body.operation, 'operation', 30);
        const time = now();
        if (op === 'claim') {
            const input = claimInput(body);
            const receipt: ClaimReceipt = { status: 'pending_verification', message: RECEIPT_MESSAGE, email_status: mailer.mode === 'disabled' ? 'unavailable' : 'queued', hold_expires_at: null };
            if (input.website)
                return receipt;
            if (mailer.mode === 'disabled')
                fail(503, 'mail_unavailable', 'Meal verification is not enabled yet. Please contact the coordinator.');
            if (mailer.mode === 'mock' && !input.email.endsWith('.invalid'))
                fail(400, 'synthetic_email_required', 'This local preview accepts only addresses ending in .invalid.');
            const emailHash = await digest(input.email), keyId = await digest(`${input.meal_id}\0${emailHash}\0${input.idempotency_key}`), fingerprint = await digest(JSON.stringify({ ...input, website: '' }));
            const result = await repository.transaction(['meal:' + input.meal_id, 'abuse-budget', 'idempotency:' + keyId], async (tx) => {
                await expire(tx, time);
                const prior = await tx.get('idempotency', keyId);
                if (prior) {
                    if (prior.fingerprint !== fingerprint)
                        fail(409, 'idempotency_conflict', 'This request key was already used for a different request.');
                    return { receipt: prior.receipt, mail: null };
                }
                const meal = await tx.get('meals', input.meal_id);
                if (!meal || meal.status !== 'open' || Date.parse(meal.service_at) <= time)
                    fail(409, 'meal_unavailable', 'This meal is not accepting signups.');
                const claims = (await tx.list('claims')).filter(c => c.meal_id === meal.id && active(c));
                if (input.whole_meal) {
                    if (claims.length)
                        fail(409, 'coordination_required', 'Some items are already covered. Please coordinate with the meal organizer.');
                }
                else {
                    const slot = meal.slots.find(s => s.id === input.slot_id);
                    if (!slot || claims.some(c => c.whole_meal) || claims.filter(c => c.slot_id === input.slot_id).reduce((n, c) => n + c.quantity, 0) + input.quantity > slot.needed)
                        fail(409, 'capacity_changed', 'Availability changed. Please refresh and choose an available quantity.');
                }
                await reserve(tx, `claim-ip:${await digest(ip)}`, limits.claimsPerIp, limits.claimWindowMs, time);
                await reserve(tx, `claim-email:${emailHash}`, limits.claimsPerEmail, limits.claimWindowMs, time);
                const day = Math.floor(time / DAY);
                await reserve(tx, `mail-day:${day}`, limits.dailyMailBudget, (day + 1) * DAY - time, time);
                const id = crypto.randomUUID(), token = randomToken(), manageToken = randomToken(), expires = Math.min(time + limits.holdMs, Date.parse(meal.service_at)), manageExpires = Math.min(Date.parse(meal.service_at), time + 90 * DAY);
                const claim: ClaimRecord = { id, meal_id: meal.id, slot_id: input.slot_id, whole_meal: input.whole_meal, quantity: input.quantity, name: input.name, email: input.email, status: 'pending', email_status: 'queued', hold_expires_at: iso(expires), version: 1, created_at: time, updated_at: time };
                await tx.put('claims', claim);
            await bumpMealVersion(tx, claim.meal_id);
                await tx.put('tokens', { id: await digest('verify:' + token), claim_id: id, purpose: 'verify', expires_at: expires, revoked_at: null });
                await tx.put('tokens', { id: await digest('manage:' + manageToken), claim_id: id, purpose: 'manage', expires_at: manageExpires, revoked_at: null });
                await tx.put('outbox', { id, claim_id: id, state: 'queued', attempt_id: null, attempted_at: null, provider_id: null });
                // All public receipts omit IDs, contacts, tokens, and any per-email existence signal.
                const accepted = { ...receipt, hold_expires_at: iso(expires) };
                await tx.put('idempotency', { id: keyId, claim_id: id, fingerprint, receipt: accepted, expires_at: time + limits.idempotencyMs });
                const verificationUrl = new URL(publicUrl);
                verificationUrl.hash = `verify=${encodeURIComponent(token)}`;
                const manageUrl = new URL(publicUrl);
                manageUrl.hash = `manage=${encodeURIComponent(manageToken)}`;
                return { receipt: accepted, mail: { to: input.email, claimId: id, verificationToken: token, verificationUrl: verificationUrl.toString(), manageToken, manageUrl: manageUrl.toString() } };
            });
            if (result.mail)
                await processMail(result.mail);
            return repository.transaction(['idempotency:' + keyId], async (tx) => (await tx.get('idempotency', keyId))?.receipt ?? result.receipt);
        }
        if (['verify', 'inspect', 'edit', 'cancel'].includes(op)) {
            fields(body, op === 'edit' ? ['operation', 'token', 'quantity', 'version'] : op === 'cancel' ? ['operation', 'token', 'version'] : ['operation', 'token']);
            if (typeof body.token !== 'string' || !/^m1_[a-f0-9]{64}$/.test(body.token))
                linkError();
            const purpose = op === 'verify' ? 'verify' : 'access', tokenHash = await digest(`${purpose}:${body.token}`), manageHash = op === 'verify' ? null : await digest(`manage:${body.token}`);
            return repository.transaction(['tokens:' + tokenHash, 'meal-claims'], async (tx) => {
                await expire(tx, time);
                const token = (await tx.get('tokens', tokenHash)) ?? (manageHash ? await tx.get('tokens', manageHash) : undefined);
                if (!token || (token.purpose !== purpose && !(op !== 'verify' && token.purpose === 'manage')) || token.revoked_at !== null || token.expires_at <= time)
                    linkError();
                const grant = token as TokenRecord, claim = await tx.get('claims', grant.claim_id);
                if (!claim || !active(claim) || (grant.purpose === 'manage' && claim.status !== 'confirmed'))
                    linkError();
                const row = claim as ClaimRecord, meal = await tx.get('meals', row.meal_id);
                if (!meal || meal.status === 'cancelled' || Date.parse(meal.service_at) <= time)
                    linkError();
                if (op === 'verify') {
                    if (meal.status !== 'open' || row.status !== 'pending' || Date.parse(row.hold_expires_at!) <= time)
                        linkError();
                    const access = randomToken(), expires = Math.min(time + limits.accessMs, Date.parse(meal!.service_at)), confirmed = { ...row, status: 'confirmed' as const, hold_expires_at: null, version: row.version + 1, updated_at: time };
                    await tx.put('tokens', { ...grant, revoked_at: time });
                    await tx.put('tokens', { id: await digest('access:' + access), claim_id: row.id, purpose: 'access', expires_at: expires, revoked_at: null });
                    await tx.put('claims', confirmed);
                    await bumpMealVersion(tx, confirmed.meal_id);
                    return { access_token: access, claim: await privateClaim(tx, confirmed, expires) };
                }
                if (op === 'inspect')
                    return privateClaim(tx, row, grant.expires_at);
                if (row.status !== 'confirmed')
                    linkError();
                if (integer(body.version, 'version', 1, 1e9) !== row.version)
                    fail(409, 'version_conflict', 'This signup changed. Refresh before trying again.');
                if (op === 'cancel') {
                    const cancelled = { ...row, status: 'cancelled' as const, version: row.version + 1, updated_at: time };
                    await tx.put('claims', cancelled);
                    await bumpMealVersion(tx, cancelled.meal_id);
                    await revoke(tx, row.id, time);
                    return privateClaim(tx, cancelled, grant.expires_at);
                }
                if (row.whole_meal)
                    fail(409, 'coordination_required', 'Please coordinate whole-meal changes with the organizer, or cancel your signup.');
                if (meal!.status !== 'open' || Date.parse(meal!.service_at) <= time)
                    fail(409, 'meal_unavailable', 'This meal is not accepting changes.');
                const quantity = integer(body.quantity, 'quantity', 1, 1000), slot = meal!.slots.find(s => s.id === row.slot_id), others = (await tx.list('claims')).filter(c => c.meal_id === row.meal_id && c.id !== row.id && active(c));
                if (!slot || others.some(c => c.whole_meal) || others.filter(c => c.slot_id === row.slot_id).reduce((n, c) => n + c.quantity, 0) + quantity > slot.needed)
                    fail(409, 'capacity_changed', 'Availability changed. Choose a smaller quantity.');
                const edited = { ...row, quantity, version: row.version + 1, updated_at: time };
                await tx.put('claims', edited);
                await bumpMealVersion(tx, edited.meal_id);
                return privateClaim(tx, edited, grant.expires_at);
            });
        }
        if (op === 'list') {
            fields(body, ['operation']);
            return repository.transaction(['meal-claims'], async (tx) => { await expire(tx, time); const claims = await tx.list('claims'); return (await tx.list('meals')).sort((a, b) => a.service_at.localeCompare(b.service_at)).map(m => publicMeal(m, claims)); });
        }
        if (!['manager', 'save_meal', 'cancel_claim'].includes(op))
            fail(400, 'invalid_operation', 'Unknown operation.');
        const manager = await options.authorizeManager?.(request);
        if (!manager)
            fail(403, 'manager_required', 'Coordinator access is required.');
        return repository.transaction(['manager:' + manager!.id, 'meal-claims', 'abuse-budget'], async (tx) => {
            await expire(tx, time);
            if (op === 'manager') {
                fields(body, ['operation']);
                const claims = await tx.list('claims'), budget = await tx.get('counters', `mail-day:${Math.floor(time / DAY)}`);
                return { meals: (await tx.list('meals')).sort((a, b) => a.service_at.localeCompare(b.service_at)).map(m => publicMeal(m, claims)), claims: claims.map(({ created_at: _c, updated_at: _u, cancellation_reason: _r, ...claim }) => claim), mail_mode: mailer.mode, daily_budget_remaining: Math.max(0, limits.dailyMailBudget - (budget?.count ?? 0)) } satisfies MealManagerSnapshot;
            }
            if (op === 'cancel_claim') {
                fields(body, ['operation', 'id', 'version', 'reason']);
                const id = text(body.id, 'signup', 80), claim = await tx.get('claims', id);
                if (!claim)
                    fail(409, 'claim_unavailable', 'This signup is not available.');
                if (integer(body.version, 'version', 1, 1e9) !== claim!.version)
                    fail(409, 'version_conflict', 'This signup changed. Refresh before trying again.');
                const reason = text(body.reason, 'cancellation reason', 300, 1, true);
                if (active(claim!)) {
                    await tx.put('claims', { ...claim!, status: 'cancelled', version: claim!.version + 1, cancellation_reason: reason, updated_at: time });
                    await bumpMealVersion(tx, claim!.meal_id);
                    await revoke(tx, id, time);
                }
                return null;
            }
            fields(body, ['operation', 'meal']);
            const input = validateMeal(body.meal), prior = input.id ? await tx.get('meals', input.id) : undefined;
            if (input.id && !prior)
                fail(409, 'meal_unavailable', 'This meal is not available.');
            if (prior && input.version !== prior.version)
                fail(409, 'version_conflict', 'This meal changed. Refresh before saving.');
            const id = prior?.id ?? crypto.randomUUID(), history = (await tx.list('claims')).filter(c => c.meal_id === id), claims = history.filter(active);
            const meal: MealRecord = { ...input, id, version: (prior?.version ?? 0) + 1, slots: input.slots.map(s => ({ ...s, id: s.id ?? crypto.randomUUID() })) };
            if (prior) {
                for (const claim of history)
                    if (claim.slot_id && !meal.slots.some(slot => slot.id === claim.slot_id))
                        fail(409, 'claim_history', 'Keep slots referenced by contribution history.');
                if (meal.status !== 'cancelled' && claims.some(c => c.whole_meal) && (meal.expected_headcount !== prior.expected_headcount || JSON.stringify(meal.slots) !== JSON.stringify(prior.slots)))
                    fail(409, 'coordination_required', 'Coordinate changes to the whole-meal commitment before saving.');
                for (const slot of meal.slots)
                    if (input.slots.find(s => s.id === slot.id) && !prior.slots.some(s => s.id === slot.id))
                        fail(400, 'invalid_input', 'New slots cannot choose their own IDs.');
                for (const claim of claims) {
                    if (claim.whole_meal)
                        continue;
                    const slot = meal.slots.find(s => s.id === claim.slot_id), before = prior.slots.find(s => s.id === claim.slot_id);
                    if (meal.status !== 'cancelled' && slot && before && (slot.label !== before.label || slot.unit !== before.unit || slot.category !== before.category))
                        fail(409, 'coordination_required', 'Coordinate changes to a claimed item before saving.');
                    if (!slot || claims.filter(c => c.slot_id === claim.slot_id).reduce((n, c) => n + c.quantity, 0) > slot.needed)
                        fail(409, 'active_claims', 'Keep claimed slots and enough capacity, or coordinate cancellations first.');
                }
                if (claims.length && (meal.service_at !== prior.service_at || meal.timezone !== prior.timezone))
                    fail(409, 'active_claims', 'Coordinate existing contributors before changing the meal time.');
            }
            if (meal.status === 'cancelled') {
                if (claims.length && input.acknowledge_cancellation !== true)
                    fail(409, 'cancellation_acknowledgment_required', 'Confirm cancellation of all affected signups and arrange contributor contact.');
                const reason = text(input.cancellation_reason, 'cancellation reason', 300, 1, true);
                for (const claim of claims) {
                    await tx.put('claims', { ...claim, status: 'cancelled', version: claim.version + 1, updated_at: time, cancellation_reason: reason });
                    await revoke(tx, claim.id, time);
                }
            }
            await tx.put('meals', meal);
            return publicMeal(meal, await tx.list('claims'));
        });
    }
    async function handle(request: Request, context: RequestContext = { ip: 'untrusted-shared' }): Promise<Response> {
        const origin = request.headers.get('origin');
        const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
        if (origin && origins.has(origin)) {
            headers.set('Access-Control-Allow-Origin', origin);
            headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
            headers.set('Access-Control-Allow-Headers', 'content-type, authorization, x-meals-demo');
        }
        try {
            if (!origin || !origins.has(origin))
                fail(403, 'origin_forbidden', 'This origin is not allowed.');
            if (request.method === 'OPTIONS') {
                if (request.headers.get('access-control-request-method') !== 'POST')
                    fail(405, 'method_not_allowed', 'Use POST.');
                return new Response(null, { status: 204, headers });
            }
            if (request.method !== 'POST')
                fail(405, 'method_not_allowed', 'Use POST.');
            if (new URL(request.url).search)
                fail(400, 'invalid_input', 'Do not put tokens or private data in the URL.');
            const ip = typeof context.ip === 'string' && context.ip.length <= 200 ? context.ip : 'untrusted-shared';
            const time = now();
            await repository.transaction(['request-rate'], async (tx) => { await expire(tx, time); await reserve(tx, `request-ip:${await digest(ip)}`, limits.ipRequestsPerMinute, MINUTE, time); });
            const result = await operation(await bodyJson(request), request, ip);
            return new Response(JSON.stringify(result), { status: 200, headers });
        }
        catch (error) {
            const safe = error instanceof GatewayError ? error : new GatewayError(503, 'temporarily_unavailable', 'The meal service is temporarily unavailable. Try again later.');
            return new Response(JSON.stringify({ error: { code: safe.code, message: safe.message } }), { status: safe.status, headers });
        }
    }
    return { handle, processMail };
}
