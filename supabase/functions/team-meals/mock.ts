import type { MealDraft } from '../../../src/meals/types.ts';
import { createMealGateway, validateMeal } from './gateway.ts';
import type { GatewayLimits } from './gateway.ts';
import { DisabledMealMailer, MockMealMailer } from './mail.ts';
import { MemoryMealRepository } from './store.ts';
/** Explicit local fixture factory. This module is never imported by browser code
 * or the inert production entrypoint. The caller owns localhost-only transport. */
export function createMockBackend(options: {
    meals?: MealDraft[];
    now?: () => number;
    allowedOrigins?: string[];
    managerToken?: string;
    mailMode?: 'mock' | 'disabled';
    limits?: Partial<GatewayLimits>;
} = {}) {
    const repository = new MemoryMealRepository(), mailer = new MockMealMailer(), origins = options.allowedOrigins ?? ['http://127.0.0.1:4430', 'http://localhost:4430'];
    const ready = repository.transaction(['seed'], async (tx) => { for (const value of options.meals ?? []) {
        const meal = validateMeal(value);
        await tx.put('meals', { ...meal, id: meal.id ?? crypto.randomUUID(), version: meal.version ?? 1, slots: meal.slots.map(s => ({ ...s, id: s.id ?? crypto.randomUUID() })) });
    } });
    const gateway = createMealGateway({ repository, allowedOrigins: origins, publicBaseUrl: origins[0] + '/meals.html', now: options.now, limits: { dailyMailBudget: 50, ...options.limits }, mailer: options.mailMode === 'disabled' ? new DisabledMealMailer() : mailer, authorizeManager: async (request) => options.managerToken && request.headers.get('authorization') === `Bearer ${options.managerToken}` ? { id: 'local-synthetic-coordinator' } : null });
    return { handle: async (request: Request, context?: {
            ip: string;
        }) => { await ready; return gateway.handle(request, context); }, mailbox: mailer.mailbox, mailer, repository, ready, processMail: gateway.processMail };
}
