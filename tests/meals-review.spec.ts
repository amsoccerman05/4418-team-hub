import { test, expect } from '@playwright/test';
import { fixture, seedMeal, claim } from './helpers/meal-store';

// Independent, browser-free regression: a retained contribution must keep its
// original slot resolvable even after the adult cancels the commitment.
test('cancelled contribution history prevents deletion of its item slot', async () => {
  const f = fixture();
  const signup = await f.verified();
  expect((await f.call({ operation: 'cancel', token: signup.token, version: signup.claim.version })).status).toBe(200);
  const snapshot = (await f.call({ operation: 'manager' }, { manager: true })).body;
  const current = snapshot.meals[0];
  const save = await f.call({
    operation: 'save_meal',
    meal: { ...seedMeal, version: current.version, slots: seedMeal.slots.filter(slot => slot.id !== 'main') },
  }, { manager: true });
  expect(save.status).toBe(409);
  const retained = (await f.call({ operation: 'manager' }, { manager: true })).body;
  const historical = retained.claims.find((claim: { id: string }) => claim.id === signup.claim.id);
  expect(historical.status).toBe('cancelled');
  expect(retained.meals[0].slots.some((slot: { id: string }) => slot.id === historical.slot_id)).toBe(true);
});


// Simulate a committed but not-yet-leased outbox entry. The original provider
// call is replaced with a counter, so provider idempotency cannot hide calls.
test('dispatch never invokes mailer for a closed, cancelled, past or expired commitment', async () => {
  for (const scenario of ['closed_meal', 'cancelled_meal', 'past_service', 'expired_hold', 'cancelled_claim'] as const) {
    const f = fixture();
    expect((await f.call({ operation: 'claim', ...claim() })).status).toBe(200);
    const mail = f.mailbox[0];
    let providerCalls = 0;
    f.mailer.send = async () => { providerCalls++; return { status: 'sent', providerId: 'unexpected-review-send' }; };
    await f.repository.transaction(['review-fixture'], async tx => {
      const outbox = (await tx.get('outbox', mail.claimId))!;
      const held = (await tx.get('claims', mail.claimId))!;
      const meal = (await tx.get('meals', held.meal_id))!;
      await tx.put('outbox', { ...outbox, state: 'queued', attempt_id: null, attempted_at: null, provider_id: null });
      await tx.put('claims', { ...held, email_status: 'queued',
        ...(scenario === 'expired_hold' ? { hold_expires_at: new Date(f.time() - 1).toISOString() } : {}),
        ...(scenario === 'cancelled_claim' ? { status: 'cancelled' as const } : {}),
      });
      await tx.put('meals', { ...meal,
        ...(scenario === 'closed_meal' ? { status: 'closed' as const } : {}),
        ...(scenario === 'cancelled_meal' ? { status: 'cancelled' as const } : {}),
        ...(scenario === 'past_service' ? { service_at: new Date(f.time() - 1).toISOString() } : {}),
      });
    });
    await f.processMail(mail);
    expect(providerCalls, scenario).toBe(0);
    const state = await f.repository.snapshot();
    expect(state.outbox[0].state, scenario).toBe('queued');
    expect(state.outbox[0].attempt_id, scenario).toBeNull();
  }
});
