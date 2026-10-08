import type { ClaimInput, MealDraft } from '../../src/meals/types';
import { createMockBackend } from '../../supabase/functions/team-meals/mock';
export const ORIGIN = 'http://127.0.0.1:4430';
export const INITIAL_TIME = Date.parse('2026-10-07T12:00:00Z');
export const seedMeal: MealDraft = { id: 'meal-saturday', version: 1, title: 'Saturday lunch', service_at: '2026-10-10T18:00:00Z', timezone: 'America/Chicago', expected_headcount: 30, guidance: 'Drop off at the workshop. Label ingredients.', status: 'open', slots: [{ id: 'main', label: 'Main dish', category: 'main', unit: 'servings', needed: 10 }, { id: 'side', label: 'Sides', category: 'side', unit: 'servings', needed: 8 }, { id: 'cups', label: 'Cups', category: 'supply', unit: 'packs', needed: 2 }] };
export function claim(overrides: Partial<ClaimInput> = {}): ClaimInput { return { meal_id: 'meal-saturday', slot_id: 'main', whole_meal: false, quantity: 2, name: 'Synthetic Adult', email: 'adult@example.invalid', idempotency_key: crypto.randomUUID(), ...overrides }; }
export function fixture(options: Parameters<typeof createMockBackend>[0] = {}) {
    let now = INITIAL_TIME;
    const managerToken = crypto.randomUUID();
    const backend = createMockBackend({ meals: [seedMeal], now: () => now, managerToken, ...options });
    async function call(body: Record<string, unknown>, extra: {
        manager?: boolean;
        ip?: string;
        origin?: string;
        headers?: Record<string, string>;
    } = {}) {
        const headers = new Headers({ 'Content-Type': 'application/json', 'Origin': extra.origin ?? ORIGIN, ...extra.headers });
        if (extra.manager)
            headers.set('Authorization', `Bearer ${managerToken}`);
        const response = await backend.handle(new Request('http://127.0.0.1:4432/api/meals', { method: 'POST', headers, body: JSON.stringify(body) }), { ip: extra.ip ?? '127.0.0.1' });
        return { response, status: response.status, body: await response.json() };
    }
    async function verified(input: Partial<ClaimInput> = {}) { const receipt = await call({ operation: 'claim', ...claim(input) }); if (receipt.status !== 200)
        throw new Error(JSON.stringify(receipt.body)); const mail = backend.mailbox.at(-1)!; const result = await call({ operation: 'verify', token: mail.verificationToken }); if (result.status !== 200)
        throw new Error(JSON.stringify(result.body)); return { token: result.body.access_token, claim: result.body.claim, mail }; }
    return { ...backend, call, verified, advance: (ms: number) => { now += ms; }, time: () => now, managerToken };
}
