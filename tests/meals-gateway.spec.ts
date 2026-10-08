import { test, expect } from '@playwright/test';
import { fixture, claim, seedMeal, ORIGIN } from './helpers/meal-store';
import { createMealGateway, digest } from '../supabase/functions/team-meals/gateway';
import { MemoryMealRepository } from '../supabase/functions/team-meals/store';
import inertHandler from '../supabase/functions/team-meals/index';
test('public response projects coverage only, even with known synthetic contacts', async () => {
    const f = fixture();
    const result = await f.verified();
    const publicList = await f.call({ operation: 'list' });
    expect(publicList.status).toBe(200);
    expect(publicList.body[0].slots[0]).toMatchObject({ confirmed: 2, held: 0, remaining: 8 });
    const serialized = JSON.stringify(publicList.body);
    for (const value of ['Synthetic Adult', 'adult@example.invalid', result.claim.id, result.token, result.mail.verificationToken, 'email_status'])
        expect(serialized).not.toContain(value);
    expect(Object.keys(publicList.body[0]).sort()).toEqual(['expected_headcount', 'guidance', 'id', 'service_at', 'slots', 'status', 'timezone', 'title', 'version', 'whole_meal'].sort());
    for (const h of ['Cache-Control', 'Referrer-Policy', 'X-Content-Type-Options'])
        expect(publicList.response.headers.get(h)).toBeTruthy();
});
test('verification is one-time and private access is separate, hashed, scoped, and expires', async () => {
    const f = fixture();
    const a = await f.verified();
    const b = await f.verified({ email: 'second@example.invalid', slot_id: 'side' });
    expect(a.token).not.toBe(a.mail.verificationToken);
    expect(a.token).toMatch(/^m1_[a-f0-9]{64}$/);
    expect(a.token).not.toBe(b.token);
    expect((await f.call({ operation: 'verify', token: a.mail.verificationToken })).status).toBe(403);
    expect((await f.call({ operation: 'inspect', token: a.mail.verificationToken })).status).toBe(403);
    expect((await f.call({ operation: 'inspect', token: a.token, id: b.claim.id })).status).toBe(400);
    const inspected = await f.call({ operation: 'inspect', token: a.token });
    expect(inspected.body.id).toBe(a.claim.id);
    expect(inspected.body.email).toBeUndefined();
    const state = JSON.stringify(await f.repository.snapshot());
    expect(state).not.toContain(a.token);
    expect(state).not.toContain(a.mail.verificationToken);
    const stored = (await f.repository.snapshot()).tokens;
    expect(stored.every(t => /^[a-f0-9]{64}$/.test(t.id))).toBe(true);
    f.advance(31 * 60000);
    expect((await f.call({ operation: 'inspect', token: a.token })).status).toBe(403);
});
test('pending hold expires and releases capacity; an expired verification never confirms', async () => {
    const f = fixture();
    await f.call({ operation: 'claim', ...claim({ quantity: 10 }) });
    const token = f.mailbox[0].verificationToken;
    expect((await f.call({ operation: 'list' })).body[0].slots[0]).toMatchObject({ held: 10, remaining: 0 });
    f.advance(16 * 60000);
    expect((await f.call({ operation: 'list' })).body[0].slots[0]).toMatchObject({ held: 0, remaining: 10 });
    expect((await f.call({ operation: 'verify', token })).status).toBe(403);
    expect((await f.call({ operation: 'claim', ...claim({ email: 'other@example.invalid', quantity: 10 }) })).status).toBe(200);
    expect((await f.repository.snapshot()).claims[0].status).toBe('expired');
});
test('concurrent item claims serialize and cannot overbook capacity', async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => f.call({ operation: 'claim', ...claim({ email: `adult${i}@example.invalid`, quantity: 3 }) }, { ip: `synthetic-ip-${i}` })));
    expect(results.filter(r => r.status === 200)).toHaveLength(3);
    expect(results.filter(r => r.body.error?.code === 'capacity_changed')).toHaveLength(7);
    expect((await f.call({ operation: 'list' })).body[0].slots[0]).toMatchObject({ held: 9, remaining: 1 });
    expect(f.mailbox).toHaveLength(3);
});
test('whole-meal and item concurrency has exactly one compatible winner', async () => {
    const f = fixture();
    const results = await Promise.all([
        f.call({ operation: 'claim', ...claim({ whole_meal: true, slot_id: null, quantity: 1, email: 'whole@example.invalid' }) }),
        f.call({ operation: 'claim', ...claim({ quantity: 2, email: 'items@example.invalid' }) }),
    ]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(1);
    const active = (await f.repository.snapshot()).claims.filter(c => c.status === 'pending');
    expect(active).toHaveLength(1);
});
test('whole meal requires explicit coordination when any item is held or confirmed', async () => {
    const f = fixture();
    await f.verified({ slot_id: 'side' });
    const result = await f.call({ operation: 'claim', ...claim({ whole_meal: true, slot_id: null, quantity: 1, email: 'whole@example.invalid' }) });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('coordination_required');
    expect((await f.call({ operation: 'list' })).body[0].whole_meal).toBe('coordination_required');
});
test('whole-meal verification covers slots and cancellation frees all slots', async () => {
    const f = fixture();
    const a = await f.verified({ whole_meal: true, slot_id: null, quantity: 1 });
    expect((await f.call({ operation: 'list' })).body[0].slots.every((s: any) => s.remaining === 0 && s.confirmed === s.needed)).toBe(true);
    expect((await f.call({ operation: 'edit', token: a.token, quantity: 1, version: a.claim.version })).body.error.code).toBe('coordination_required');
    expect((await f.call({ operation: 'cancel', token: a.token, version: a.claim.version })).body.status).toBe('cancelled');
    expect((await f.call({ operation: 'list' })).body[0].whole_meal).toBe('available');
});
test('scoped idempotency replays one receipt and prevents body mismatch without cross-email leakage', async () => {
    const f = fixture();
    const input = claim();
    const results = await Promise.all(Array.from({ length: 6 }, () => f.call({ operation: 'claim', ...input })));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(new Set(results.map(r => r.body.hold_expires_at)).size).toBe(1);
    expect(results.every(r => ['queued', 'uncertain', 'sent'].includes(r.body.email_status))).toBe(true);
    expect((await f.call({ operation: 'claim', ...input })).body.email_status).toBe('sent');
    expect(f.mailbox).toHaveLength(1);
    expect((await f.call({ operation: 'claim', ...input, quantity: 3 })).body.error.code).toBe('idempotency_conflict');
    const different = await f.call({ operation: 'claim', ...input, email: 'other@example.invalid' });
    expect(different.status).toBe(200);
    expect(f.mailbox).toHaveLength(2);
    for (const response of [...results, different]) {
        expect(response.body.email).toBeUndefined();
        expect(response.body.id).toBeUndefined();
        expect(response.body.token).toBeUndefined();
    }
    f.advance(25 * 60 * 60000);
    expect((await f.call({ operation: 'claim', ...input })).status).toBe(200);
    expect(f.mailbox).toHaveLength(3);
});
test('private edits enforce optimistic versions and shared capacity', async () => {
    const f = fixture();
    const a = await f.verified({ quantity: 4 });
    await f.verified({ email: 'second@example.invalid', quantity: 4 });
    const tooMany = await f.call({ operation: 'edit', token: a.token, quantity: 7, version: a.claim.version });
    expect(tooMany.status).toBe(409);
    const updated = await f.call({ operation: 'edit', token: a.token, quantity: 6, version: a.claim.version });
    expect(updated.body.quantity).toBe(6);
    expect((await f.call({ operation: 'edit', token: a.token, quantity: 2, version: a.claim.version })).body.error.code).toBe('version_conflict');
    expect((await f.call({ operation: 'list' })).body[0].slots[0].confirmed).toBe(10);
});
test('cancel revokes the access token and cannot mutate another claim', async () => {
    const f = fixture();
    const a = await f.verified(), b = await f.verified({ email: 'second@example.invalid', slot_id: 'side' });
    const cancelled = await f.call({ operation: 'cancel', token: a.token, version: a.claim.version });
    expect(cancelled.body.status).toBe('cancelled');
    expect((await f.call({ operation: 'inspect', token: a.token })).status).toBe(403);
    expect((await f.call({ operation: 'cancel', token: a.token, version: cancelled.body.version })).status).toBe(403);
    expect((await f.call({ operation: 'inspect', token: b.token })).body.status).toBe('confirmed');
});
test('manager contact access and all mutation operations require injected authority', async () => {
    const f = fixture();
    const a = await f.verified();
    for (const body of [{ operation: 'manager' }, { operation: 'save_meal', meal: seedMeal }, { operation: 'cancel_claim', id: a.claim.id, version: a.claim.version, reason: 'Coordinator cancellation' }])
        expect((await f.call(body)).status).toBe(403);
    const manager = await f.call({ operation: 'manager' }, { manager: true });
    expect(manager.body.claims[0]).toMatchObject({ name: 'Synthetic Adult', email: 'adult@example.invalid', status: 'confirmed', email_status: 'sent' });
    expect(manager.body.mail_mode).toBe('mock');
    expect((await f.call({ operation: 'cancel_claim', id: a.claim.id, version: a.claim.version, reason: 'Adult requested cancellation' }, { manager: true })).status).toBe(200);
    expect((await f.call({ operation: 'inspect', token: a.token })).status).toBe(403);
});
test('manager save has optimistic versions and cannot remove or shrink held slots', async () => {
    const f = fixture();
    await f.call({ operation: 'claim', ...claim({ quantity: 6 }) });
    const current = { ...seedMeal, version: (await f.call({ operation: 'list' })).body[0].version };
    const reduced = { ...current, slots: seedMeal.slots.map(s => s.id === 'main' ? { ...s, needed: 4 } : s) };
    expect((await f.call({ operation: 'save_meal', meal: reduced }, { manager: true })).body.error.code).toBe('active_claims');
    const result = await f.call({ operation: 'save_meal', meal: { ...current, title: 'Saturday team lunch' } }, { manager: true });
    expect(result.status).toBe(200);
    expect(result.body.version).toBe(current.version + 1);
    expect((await f.call({ operation: 'save_meal', meal: seedMeal }, { manager: true })).body.error.code).toBe('version_conflict');
    const rescheduled = { ...seedMeal, version: result.body.version, service_at: '2026-10-17T18:00:00Z' };
    expect((await f.call({ operation: 'save_meal', meal: rescheduled }, { manager: true })).body.error.code).toBe('active_claims');
});
test('cancelled dates retain historical contributions while revoking links', async () => {
    const f = fixture();
    const a = await f.verified();
    const current = { ...seedMeal, version: (await f.call({ operation: 'list' })).body[0].version };
    const missingReason = await f.call({ operation: 'save_meal', meal: { ...current, status: 'cancelled', acknowledge_cancellation: true } }, { manager: true });
    expect(missingReason.status).toBe(400);
    const result = await f.call({ operation: 'save_meal', meal: { ...current, status: 'cancelled', cancellation_reason: 'Meeting cancelled', acknowledge_cancellation: true } }, { manager: true });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('cancelled');
    expect((await f.call({ operation: 'inspect', token: a.token })).status).toBe(403);
    const state = await f.repository.snapshot();
    expect(state.claims).toHaveLength(1);
    expect(state.claims[0]).toMatchObject({ status: 'cancelled', email: 'adult@example.invalid', cancellation_reason: 'Meeting cancelled' });
});
test('per-IP and per-email limits are reserved atomically and ignore spoofed forwarding headers', async () => {
    const f = fixture({ limits: { claimsPerIp: 2, claimsPerEmail: 1 } });
    expect((await f.call({ operation: 'claim', ...claim() })).status).toBe(200);
    expect((await f.call({ operation: 'claim', ...claim({ slot_id: 'side' }) }, { ip: 'second-trusted-ip' })).status).toBe(429);
    expect((await f.call({ operation: 'claim', ...claim({ email: 'second@example.invalid' }) })).status).toBe(200);
    const blocked = await f.call({ operation: 'claim', ...claim({ email: 'third@example.invalid' }) }, { headers: { 'X-Forwarded-For': 'random-ignored-ip' } });
    expect(blocked.status).toBe(429);
    expect(f.mailer.attempts).toHaveLength(2);
});
test('parallel claims cannot exceed global daily mail budget and disabled mode does no work', async () => {
    const f = fixture({ limits: { dailyMailBudget: 2 } });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => f.call({ operation: 'claim', ...claim({ quantity: 1, email: `adult${i}@example.invalid` }) }, { ip: `synthetic-${i}` })));
    expect(results.filter(r => r.status === 200)).toHaveLength(2);
    expect(results.filter(r => r.status === 429)).toHaveLength(6);
    expect(f.mailer.attempts).toHaveLength(2);
    expect((await f.call({ operation: 'manager' }, { manager: true })).body.daily_budget_remaining).toBe(0);
    const disabled = fixture({ mailMode: 'disabled' });
    expect((await disabled.call({ operation: 'claim', ...claim() })).status).toBe(503);
    const state = await disabled.repository.snapshot();
    expect(state.claims).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    expect(state.counters.filter(c => c.id.startsWith('mail-day:'))).toHaveLength(0);
});
test('mock mail never accepts real recipients or calls a shared auth provider', async () => {
    const f = fixture();
    const result = await f.call({ operation: 'claim', ...claim({ email: 'person@example.com' }) });
    expect(result.status).toBe(400);
    expect(f.mailbox).toHaveLength(0);
    expect((await f.repository.snapshot()).claims).toHaveLength(0);
    const repo = new MemoryMealRepository();
    const gateway = createMealGateway({ repository: repo, allowedOrigins: [ORIGIN], publicBaseUrl: ORIGIN });
    const request = new Request('http://localhost/api', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'claim', ...claim() }) });
    expect((await gateway.handle(request)).status).toBe(503);
    expect(inertHandler(request).status).toBe(503);
});
test('outbox sent means provider accepted; failed releases holds and never pretends delivered', async () => {
    const f = fixture();
    f.mailer.nextOutcome = 'failed';
    const input = claim();
    const first = await f.call({ operation: 'claim', ...input });
    expect(first.body).toMatchObject({ email_status: 'unavailable', hold_expires_at: null });
    expect((await f.call({ operation: 'claim', ...input })).body).toEqual(first.body);
    const state = await f.repository.snapshot();
    expect(state.outbox[0].state).toBe('failed');
    expect(state.claims[0].status).toBe('expired');
    expect((await f.call({ operation: 'list' })).body[0].slots[0].held).toBe(0);
    expect(JSON.stringify(state)).not.toContain('delivered');
});
for (const outcome of ['uncertain', 'throw'] as const)
    test(`ambiguous mail ${outcome} is durable and never blindly retried`, async () => {
        const f = fixture();
        f.mailer.nextOutcome = outcome;
        const input = claim();
        const initial = await f.call({ operation: 'claim', ...input });
        expect(initial.status).toBe(200);
        expect(initial.body.email_status).toBe('uncertain');
        let state = await f.repository.snapshot();
        expect(state.outbox[0]).toMatchObject({ state: 'uncertain' });
        expect(state.outbox[0].attempt_id).toBeTruthy();
        expect((await f.call({ operation: 'claim', ...input })).status).toBe(200);
        expect(f.mailer.attempts).toHaveLength(1);
        if (f.mailbox.length)
            await Promise.all([f.processMail(f.mailbox[0]), f.processMail(f.mailbox[0])]);
        expect(f.mailer.attempts).toHaveLength(1);
        f.advance(16 * 60000);
        await f.call({ operation: 'list' });
        state = await f.repository.snapshot();
        expect(state.claims[0].status).toBe('expired');
        expect(state.outbox[0].state).toBe('uncertain');
    });
test('validation rejects malformed, oversized, unsupported content and untrusted origins without CORS', async () => {
    const f = fixture();
    for (const [body, expected] of [[{ operation: 'claim', ...claim({ quantity: 0 }) }, 400], [{ operation: 'claim', ...claim({ whole_meal: true, slot_id: 'main' }) }, 400], [{ operation: 'claim', ...claim({ name: 'x\nInjected' }) }, 400]] as const)
        expect((await f.call(body)).status).toBe(expected);
    const denied = await f.call({ operation: 'list' }, { origin: 'https://evil.invalid' });
    expect(denied.status).toBe(403);
    expect(denied.response.headers.get('access-control-allow-origin')).toBeNull();
    const request = (body: string, type = 'application/json', suffix = '') => new Request('http://127.0.0.1:4432/api' + suffix, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': type }, body });
    expect((await f.handle(request('not-json'))).status).toBe(400);
    expect((await f.handle(request('{}', 'text/plain'))).status).toBe(415);
    expect((await f.handle(request('x'.repeat(17000)))).status).toBe(413);
    expect((await f.handle(request('{"operation":"list"}', 'application/json', '?token=no'))).status).toBe(400);
    const preflight = await f.handle(new Request('http://localhost/api', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await f.handle(new Request('http://localhost/api', { method: 'GET', headers: { Origin: ORIGIN } }))).status).toBe(405);
});
test('generic link failures do not enumerate claims and honeypot causes no holds or mail', async () => {
    const f = fixture();
    const bad = await f.call({ operation: 'inspect', token: 'bad' });
    const unknown = await f.call({ operation: 'inspect', token: 'm1_' + 'a'.repeat(64) });
    expect(bad.body).toEqual(unknown.body);
    expect(bad.status).toBe(403);
    const honeypot = await f.call({ operation: 'claim', ...claim({ website: 'https://spam.invalid' }) });
    expect(honeypot.status).toBe(200);
    expect(f.mailbox).toHaveLength(0);
    expect((await f.repository.snapshot()).claims).toHaveLength(0);
});
test('repository rolls back rejected work and stores detached copies', async () => {
    const repository = new MemoryMealRepository();
    await expect(repository.transaction(['x'], async (tx) => { await tx.put('counters', { id: 'one', count: 1, expires_at: 9999 }); throw new Error('abort'); })).rejects.toThrow('abort');
    expect((await repository.snapshot()).counters).toHaveLength(0);
    const row = { id: 'one', count: 1, expires_at: 9999 };
    await repository.transaction(['x'], async (tx) => { await tx.put('counters', row); });
    row.count = 2;
    expect((await repository.snapshot()).counters[0].count).toBe(1);
    expect(await digest('access:token')).not.toBe(await digest('verify:token'));
});
test('emailed private management link reopens after short session expiration and revokes on cancel', async () => {
    const f = fixture();
    const input = claim();
    await f.call({ operation: 'claim', ...input });
    const email = f.mailbox[0];
    expect(new URL(email.verificationUrl).pathname).toBe('/meals.html');
    expect(new URL(email.manageUrl).pathname).toBe('/meals.html');
    expect(new URL(email.manageUrl).hash).toBe('#manage=' + email.manageToken);
    expect(email.manageToken).not.toBe(email.verificationToken);
    expect((await f.call({ operation: 'inspect', token: email.manageToken })).status).toBe(403);
    const verified = await f.call({ operation: 'verify', token: email.verificationToken });
    expect(verified.status).toBe(200);
    f.advance(31 * 60000);
    expect((await f.call({ operation: 'inspect', token: verified.body.access_token })).status).toBe(403);
    const reopened = await f.call({ operation: 'inspect', token: email.manageToken });
    expect(reopened.status).toBe(200);
    expect(reopened.body.id).toBe(verified.body.claim.id);
    expect(reopened.body.access_expires_at).toBe(seedMeal.service_at.replace('00Z', '00.000Z'));
    const edited = await f.call({ operation: 'edit', token: email.manageToken, version: reopened.body.version, quantity: 3 });
    expect(edited.status).toBe(200);
    expect(JSON.stringify(await f.repository.snapshot())).not.toContain(email.manageToken);
    expect((await f.call({ operation: 'cancel', token: email.manageToken, version: edited.body.version })).status).toBe(200);
    expect((await f.call({ operation: 'inspect', token: email.manageToken })).status).toBe(403);
});
test('management links expire at service cutoff and are bounded to 90 days', async () => {
    const f = fixture();
    const a = await f.verified();
    f.advance(Date.parse(seedMeal.service_at) - f.time());
    expect((await f.call({ operation: 'inspect', token: a.mail.manageToken })).status).toBe(403);
    const far = fixture({ meals: [{ ...seedMeal, service_at: '2027-05-01T18:00:00Z' }] });
    const b = await far.verified();
    const inspected = await far.call({ operation: 'inspect', token: b.mail.manageToken });
    expect(Date.parse(inspected.body.access_expires_at) - far.time()).toBe(90 * 86400000);
    far.advance(90 * 86400000);
    expect((await far.call({ operation: 'inspect', token: b.mail.manageToken })).status).toBe(403);
});
test('active commitments cannot be silently redefined by manager item or whole-meal edits', async () => {
    const f = fixture();
    await f.verified();
    const current = { ...seedMeal, version: (await f.call({ operation: 'list' })).body[0].version };
    for (const changed of [{ label: 'New obligation' }, { unit: 'trays' }, { category: 'supply' }]) {
        const result = await f.call({ operation: 'save_meal', meal: { ...current, slots: seedMeal.slots.map(s => s.id === 'main' ? { ...s, ...changed } : s) } }, { manager: true });
        expect(result.body.error.code).toBe('coordination_required');
    }
    const whole = fixture();
    await whole.verified({ whole_meal: true, slot_id: null, quantity: 1 });
    const wholeCurrent = { ...seedMeal, version: (await whole.call({ operation: 'list' })).body[0].version };
    for (const draft of [{ ...wholeCurrent, expected_headcount: 40 }, { ...wholeCurrent, slots: seedMeal.slots.map(s => ({ ...s, needed: s.needed + 1 })) }, { ...wholeCurrent, slots: seedMeal.slots.map(s => ({ ...s, label: 'Changed ' + s.label })) }])
        expect((await whole.call({ operation: 'save_meal', meal: draft }, { manager: true })).body.error.code).toBe('coordination_required');
});
test('date cancellation needs explicit acknowledgment when active signups are affected', async () => {
    const f = fixture();
    await f.verified();
    const before = await f.repository.snapshot();
    const result = await f.call({ operation: 'save_meal', meal: { ...seedMeal, version: before.meals[0].version, status: 'cancelled', cancellation_reason: 'Team date cancelled' } }, { manager: true });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('cancellation_acknowledgment_required');
    expect((await f.repository.snapshot()).claims).toEqual(before.claims);
});
test('multiline logistics are allowed while contact and name control characters are rejected', async () => {
    const f = fixture();
    const logistics = 'Drop off at noon.\nLabel ingredients.\nThank you.';
    const result = await f.call({ operation: 'save_meal', meal: { ...seedMeal, guidance: logistics } }, { manager: true });
    expect(result.status).toBe(200);
    expect(result.body.guidance).toBe(logistics);
    expect((await f.call({ operation: 'claim', ...claim({ email: 'adult@example.invalid\nBcc:other@example.invalid' }) })).status).toBe(400);
    expect((await f.call({ operation: 'claim', ...claim({ name: 'Adult\nName' }) })).status).toBe(400);
});
test('request rate limits and malformed token errors remain generic', async () => {
    const f = fixture({ limits: { ipRequestsPerMinute: 2 } });
    expect((await f.call({ operation: 'list' })).status).toBe(200);
    expect((await f.call({ operation: 'inspect', token: 'no-such-token' })).status).toBe(403);
    expect((await f.call({ operation: 'manager' }, { manager: true })).status).toBe(429);
    f.advance(61000);
    expect((await f.call({ operation: 'list' })).status).toBe(200);
});


test('calendar validation rejects normalization surprises and public slot projections are strict',async()=>{
  const f=fixture();for(const at of ['2026-02-30T18:00:00Z','2026-10-10T24:00:00Z'])expect((await f.call({operation:'save_meal',meal:{...seedMeal,service_at:at}},{manager:true})).status).toBe(400);
  await f.ready;await f.repository.transaction(['fixture'],async tx=>{const meal=(await tx.get('meals','meal-saturday'))!;(meal.slots[0] as any).private_contact='should-never-leak@example.invalid';await tx.put('meals',meal);});
  expect(JSON.stringify((await f.call({operation:'list'})).body)).not.toContain('should-never-leak');
});


test('Saturday is checked in the meal timezone and an explicit zero mail budget blocks attempts',async()=>{
  const f=fixture();expect((await f.call({operation:'save_meal',meal:{...seedMeal,service_at:'2026-10-11T18:00:00Z'}},{manager:true})).status).toBe(400);
  expect((await f.call({operation:'save_meal',meal:{...seedMeal,service_at:'2026-10-11T00:30:00Z'}},{manager:true})).status).toBe(200);
  const zero=fixture({limits:{dailyMailBudget:0}});expect((await zero.call({operation:'claim',...claim()})).status).toBe(429);expect(zero.mailer.attempts).toHaveLength(0);
});


test('stale coordinator cancellation cannot cancel a newly arrived unreviewed signup',async()=>{
  const f=fixture();const reviewed=(await f.call({operation:'manager'},{manager:true})).body;
  await f.call({operation:'claim',...claim()});
  const result=await f.call({operation:'save_meal',meal:{...seedMeal,version:reviewed.meals[0].version,status:'cancelled',cancellation_reason:'Cancel reviewed meal',acknowledge_cancellation:true}},{manager:true});
  expect(result.status).toBe(409);expect(result.body.error.code).toBe('version_conflict');
  const current=await f.repository.snapshot();expect(current.meals[0].status).toBe('open');expect(current.claims).toHaveLength(1);expect(current.claims[0].status).toBe('pending');
});

test('coverage revisions advance atomically on hold, verification, edit, cancellation and expiry',async()=>{
  const f=fixture();const version=async()=> (await f.call({operation:'list'})).body[0].version;
  expect(await version()).toBe(1);await f.call({operation:'claim',...claim()});expect(await version()).toBe(2);
  const verified=await f.call({operation:'verify',token:f.mailbox[0].verificationToken});expect(await version()).toBe(3);
  const edited=await f.call({operation:'edit',token:verified.body.access_token,version:verified.body.claim.version,quantity:3});expect(await version()).toBe(4);
  await f.call({operation:'cancel',token:verified.body.access_token,version:edited.body.version});expect(await version()).toBe(5);
  await f.call({operation:'claim',...claim({email:'other@example.invalid'})});expect(await version()).toBe(6);f.advance(16*60_000);expect(await version()).toBe(7);
  f.mailer.nextOutcome='failed';await f.call({operation:'claim',...claim({email:'failed@example.invalid'})});expect(await version()).toBe(9);
  const last=await f.verified({email:'manager@example.invalid'});expect(await version()).toBe(11);await f.call({operation:'cancel_claim',id:last.claim.id,version:last.claim.version,reason:'Adult requested cancellation'},{manager:true});expect(await version()).toBe(12);
});


test('closed dates deny pending verification but still allow confirmed contribution cancellation',async()=>{
  const f=fixture();await f.call({operation:'claim',...claim()});const pending=f.mailbox[0];const current=(await f.call({operation:'list'})).body[0];
  expect((await f.call({operation:'save_meal',meal:{...seedMeal,version:current.version,status:'closed'}},{manager:true})).status).toBe(200);
  expect((await f.call({operation:'verify',token:pending.verificationToken})).status).toBe(403);expect((await f.repository.snapshot()).claims[0].status).toBe('pending');
  const confirmed=fixture();const adult=await confirmed.verified();const reviewed=(await confirmed.call({operation:'list'})).body[0];
  expect((await confirmed.call({operation:'save_meal',meal:{...seedMeal,version:reviewed.version,status:'closed'}},{manager:true})).status).toBe(200);
  expect((await confirmed.call({operation:'cancel',token:adult.token,version:adult.claim.version})).status).toBe(200);
});

test('referenced historical slots cannot be removed after cancellation while capacity can be revised',async()=>{
  const f=fixture();const adult=await f.verified();await f.call({operation:'cancel',token:adult.token,version:adult.claim.version});const before=await f.repository.snapshot();
  const current={...seedMeal,version:before.meals[0].version};const removed=await f.call({operation:'save_meal',meal:{...current,slots:seedMeal.slots.filter(s=>s.id!=='main')}},{manager:true});
  expect(removed.status).toBe(409);expect(removed.body.error.code).toBe('claim_history');expect((await f.repository.snapshot()).meals).toEqual(before.meals);expect((await f.repository.snapshot()).claims).toEqual(before.claims);
  expect((await f.call({operation:'save_meal',meal:{...current,slots:seedMeal.slots.map(s=>s.id==='main'?{...s,needed:1}:s)}},{manager:true})).status).toBe(200);
});
