import type { ClaimReceipt, ManagedClaim, MealDraft } from '../../../src/meals/types.ts';
export type MealRecord = Omit<MealDraft, 'id' | 'version' | 'slots'> & {
    id: string;
    version: number;
    slots: (MealDraft['slots'][number] & {
        id: string;
    })[];
};
export type ClaimRecord = ManagedClaim & {
    created_at: number;
    updated_at: number;
    cancellation_reason?: string;
};
export type TokenRecord = {
    id: string;
    claim_id: string;
    purpose: 'verify' | 'access' | 'manage';
    expires_at: number;
    revoked_at: number | null;
};
export type OutboxRecord = {
    id: string;
    claim_id: string;
    state: ManagedClaim['email_status'];
    attempt_id: string | null;
    attempted_at: number | null;
    provider_id: string | null;
};
export type IdempotencyRecord = {
    id: string;
    claim_id: string;
    fingerprint: string;
    receipt: ClaimReceipt;
    expires_at: number;
};
export type CounterRecord = {
    id: string;
    count: number;
    expires_at: number;
};
export type Tables = {
    meals: MealRecord;
    claims: ClaimRecord;
    tokens: TokenRecord;
    outbox: OutboxRecord;
    idempotency: IdempotencyRecord;
    counters: CounterRecord;
};
/** All methods participate in ONE database transaction. Implementations must provide
 * serializable isolation (including retries) or one global lock before reads/writes.
 * Scope names are advisory optimization hints, not sufficient isolation alone.
 * A future SQL adapter must never implement this as unrelated REST requests. */
export interface MealTransaction {
    get<K extends keyof Tables>(table: K, id: string): Promise<Tables[K] | undefined>;
    list<K extends keyof Tables>(table: K): Promise<Tables[K][]>;
    put<K extends keyof Tables>(table: K, row: Tables[K]): Promise<void>;
    remove<K extends keyof Tables>(table: K, id: string): Promise<void>;
}
export interface MealRepository {
    transaction<T>(scopes: string[], work: (tx: MealTransaction) => Promise<T>): Promise<T>;
}
/** Synthetic local adapter only: global serialization is stronger than per-meal
 * locks and also makes budget + rate + capacity reservations atomic. Rollback
 * uses a private snapshot. No external database or production SDK is imported. */
export class MemoryMealRepository implements MealRepository {
    private state: {
        [K in keyof Tables]: Map<string, Tables[K]>;
    } = { meals: new Map(), claims: new Map(), tokens: new Map(), outbox: new Map(), idempotency: new Map(), counters: new Map() };
    private tail: Promise<unknown> = Promise.resolve();
    transaction<T>(_scopes: string[], work: (tx: MealTransaction) => Promise<T>): Promise<T> {
        const run = this.tail.then(async () => {
            const draft = structuredClone(this.state);
            const tx: MealTransaction = {
                get: async (table, id) => structuredClone(draft[table].get(id)) as never,
                list: async (table) => structuredClone([...draft[table].values()]) as never,
                put: async (table, row) => { (draft[table] as Map<string, typeof row>).set(row.id, structuredClone(row)); },
                remove: async (table, id) => { draft[table].delete(id); },
            };
            const result = await work(tx);
            this.state = draft;
            return result;
        });
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
    /** Tests only; callers receive detached copies, never the mutable store. */
    snapshot() {
        return this.transaction(['snapshot'], async (tx) => ({
            meals: await tx.list('meals'), claims: await tx.list('claims'), tokens: await tx.list('tokens'),
            outbox: await tx.list('outbox'), idempotency: await tx.list('idempotency'), counters: await tx.list('counters'),
        }));
    }
}
