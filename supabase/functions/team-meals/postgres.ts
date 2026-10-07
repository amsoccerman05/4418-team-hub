import type { ClaimInput, ManagedClaim, MealDraft, MealManagerSnapshot, PrivateClaim, PublicMeal } from '../../../src/meals/types.ts';
import { GatewayError } from './gateway.ts';

/** Inject a trusted direct server pool, never a browser/PostgREST query client.
 * Each connection must remain exclusively leased until COMMIT/ROLLBACK completes.
 * No driver, network endpoint, credential, or environment lookup is bundled here. */
export interface MealSqlConnection {
    query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
    release(error?: Error): void | Promise<void>;
}
export interface MealSqlPool { connect(): Promise<MealSqlConnection>; }
export type VerifiedMealManager = { id: string };
export type SqlHold = {
    claim_id: string;
    outbox_id?: string;
    status: 'pending_verification';
    hold_expires_at: string | null;
    replayed: boolean;
    email_status: ManagedClaim['email_status'];
    can_send: boolean;
};
export type HoldHashes = { request: Uint8Array; verify: Uint8Array; manage: Uint8Array; ip: Uint8Array };

const domainErrors: Record<string, [number, string, string]> = {
    'Invalid or expired link': [403, 'invalid_link', 'This link is unavailable or expired. Ask the meal coordinator for help.'],
    'Request key already used': [409, 'idempotency_conflict', 'This request key was already used for a different request.'],
    'Meal unavailable': [409, 'meal_unavailable', 'This meal is not available.'],
    'Meal is not accepting contributions': [409, 'meal_unavailable', 'This meal is not accepting signups.'],
    'Meal is not accepting changes': [409, 'meal_unavailable', 'This meal is not accepting changes.'],
    'Slot unavailable': [409, 'capacity_changed', 'Availability changed. Refresh and choose an available quantity.'],
    'Requested quantity is no longer available': [409, 'capacity_changed', 'Availability changed. Choose a smaller quantity.'],
    'Whole meal needs coordinator review': [409, 'coordination_required', 'Some items are already covered. Please coordinate with the meal organizer.'],
    'Whole-meal quantity must be one': [409, 'coordination_required', 'Please coordinate whole-meal changes with the organizer.'],
    'Email service daily budget reached': [429, 'rate_limited', 'Too many requests. Try again later.'],
    'Too many requests; try later': [429, 'rate_limited', 'Too many requests. Try again later.'],
    'Meal changed; reload before saving': [409, 'version_conflict', 'This meal changed. Refresh before saving.'],
    'Contribution changed; reload before editing': [409, 'version_conflict', 'This signup changed. Refresh before trying again.'],
    'Contribution unavailable': [409, 'claim_unavailable', 'This signup is not available.'],
    'Contribution is not editable': [403, 'invalid_link', 'This link is unavailable or expired. Ask the meal coordinator for help.'],
    'Contribution is not cancellable': [409, 'claim_unavailable', 'This signup is not available.'],
    'Please acknowledge cancellation of existing contributions': [409, 'cancellation_acknowledgment_required', 'Confirm cancellation of all affected signups and arrange contributor contact.'],
    'Existing contributions require coordination before rescheduling': [409, 'active_claims', 'Coordinate existing contributors before changing the meal time.'],
    'Whole-meal commitment requires coordination before headcount changes': [409, 'coordination_required', 'Coordinate changes to the whole-meal commitment before saving.'],
    'Whole-meal commitment requires coordination before capacity changes': [409, 'coordination_required', 'Coordinate changes to the whole-meal commitment before saving.'],
    'Claimed slot specifications require coordination': [409, 'coordination_required', 'Coordinate changes to a claimed item before saving.'],
    'Capacity is below current allocations': [409, 'active_claims', 'Keep enough capacity, or coordinate cancellations first.'],
    'A claimed slot cannot be removed': [409, 'claim_history', 'Keep slots referenced by contribution history.'],
    'New slot identifiers must be assigned by the server': [400, 'invalid_input', 'New slots cannot choose their own IDs.'],
};
const invalidInputs = new Set(['Invalid claim', 'Invalid claim change', 'Invalid meal', 'Invalid slot', 'Duplicate slot', 'Invalid version', 'Invalid cancellation acknowledgement', 'Cancellation reason required', 'Choose a valid Saturday and timezone']);
/** Do not surface SQL text, constraints, parameters, contacts, or driver details. */
export function safePostgresError(error: unknown): Error {
    if (error instanceof GatewayError) return error;
    const candidate = error as { code?: unknown; message?: unknown } | null;
    if (candidate?.code === '42501' && candidate.message === 'Meal coordinator access required')
        return new GatewayError(403, 'manager_required', 'Coordinator access is required.');
    if (candidate?.code === 'P0001' && typeof candidate.message === 'string') {
        const known = domainErrors[candidate.message];
        if (known) return new GatewayError(...known);
        if (invalidInputs.has(candidate.message)) return new GatewayError(400, 'invalid_input', 'Check the submitted information.');
    }
    return new GatewayError(503, 'temporarily_unavailable', 'The meal service is temporarily unavailable. Try again later.');
}

/** Bound to the reviewed relational schema and functions in saturday-meals.sql.
 * Mutations use the SQL meal/budget/token locks, never a second JSON state store.
 * Manager roles are re-read from profiles by the SQL wrappers on every call. */
export class PostgresMealDatabase {
    private readonly pool: MealSqlPool;
    constructor(pool: MealSqlPool) { this.pool = pool; }

    private async transaction<T>(manager: VerifiedMealManager | null, work: (connection: MealSqlConnection) => Promise<T>): Promise<T> {
        const connection = await this.pool.connect();
        let unusable = false;
        try {
            await connection.query('begin');
            // Server-verified subject only. Body fields, forwarding headers and JWT
            // metadata are never copied into these transaction-local claims.
            await connection.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
                [manager?.id ?? '', JSON.stringify(manager ? { sub: manager.id, role: 'authenticated' } : { role: 'service_role' })]);
            await connection.query(manager ? 'set local role authenticated' : 'set local role service_role');
            const result = await work(connection);
            // A failed/ambiguous COMMIT must never trigger automatic replay.
            try { await connection.query('commit'); } catch (error) { unusable = true; throw error; }
            return result;
        } catch (error) {
            try { await connection.query('rollback'); } catch { unusable = true; }
            // Never downgrade commit/rollback uncertainty into a domain error:
            // capability fallback is permitted only after a confirmed rollback.
            if (unusable) throw new GatewayError(503, 'uncertain_result', 'The result could not be confirmed. Refresh the latest status before trying again.');
            throw safePostgresError(error);
        } finally {
            await connection.release(unusable ? new Error('Discard uncertain meal database connection') : undefined);
        }
    }
    private async call<T>(sql: string, values: unknown[] = [], manager: VerifiedMealManager | null = null): Promise<T> {
        return this.transaction(manager, async connection => {
            const result = await connection.query<{ result: T }>(sql, values);
            if (result.rows.length !== 1) throw new Error('Unexpected meal SQL result');
            return result.rows[0].result;
        });
    }
    reserveRequest(hash: Uint8Array): Promise<boolean> {
        return this.call('select meals_private.reserve_request($1::bytea) as result', [hash]);
    }
    list(): Promise<PublicMeal[]> { return this.call('select meals_private.list_public() as result'); }
    createHold(input: ClaimInput, hashes: HoldHashes): Promise<SqlHold> {
        return this.call('select meals_private.create_hold($1::uuid,$2::uuid,$3::boolean,$4::integer,$5::text,$6::text,$7::bytea,$8::bytea,$9::bytea,$10::bytea) as result',
            [input.meal_id, input.slot_id, input.whole_meal, input.quantity, input.name, input.email, hashes.request, hashes.verify, hashes.manage, hashes.ip]);
    }
    verify(verifyHash: Uint8Array, accessHash: Uint8Array): Promise<PrivateClaim> {
        return this.call('select meals_private.verify($1::bytea,$2::bytea) as result', [verifyHash, accessHash]);
    }
    /** Failed candidate lookup fully rolls back before trying the distinct purpose.
     * No automatic retry for conflicts, SQL errors, or uncertain commits. */
    private async capability<T>(hashes: [Uint8Array, Uint8Array], action: (hash: Uint8Array) => Promise<T>): Promise<T> {
        try { return await action(hashes[0]); }
        catch (error) {
            if (!(error instanceof GatewayError) || error.code !== 'invalid_link') throw error;
            return action(hashes[1]);
        }
    }
    inspect(hashes: [Uint8Array, Uint8Array]): Promise<PrivateClaim> {
        return this.capability(hashes, hash => this.call('select meals_private.inspect($1::bytea) as result', [hash]));
    }
    change(hashes: [Uint8Array, Uint8Array], version: number, quantity: number | null, cancel: boolean): Promise<PrivateClaim> {
        return this.capability(hashes, hash => this.call('select meals_private.change_claim($1::bytea,$2::integer,$3::integer,$4::boolean) as result', [hash, version, quantity, cancel]));
    }
    beginDelivery(id: string): Promise<boolean> { return this.call('select meals_private.begin_delivery($1::uuid) as result', [id]); }
    async finishDelivery(id: string, status: 'sent' | 'failed' | 'uncertain'): Promise<void> {
        await this.call('select meals_private.finish_delivery($1::uuid,$2::text) as result', [id, status]);
    }
    manager(manager: VerifiedMealManager): Promise<MealManagerSnapshot> {
        return this.call('select public.meals_manager_context() as result', [], manager);
    }
    saveMeal(manager: VerifiedMealManager, meal: MealDraft): Promise<PublicMeal> {
        return this.call('select public.meals_manager_save($1::jsonb) as result', [JSON.stringify(meal)], manager);
    }
    async cancelClaim(manager: VerifiedMealManager, id: string, version: number, reason: string): Promise<void> {
        await this.call('select public.meals_manager_cancel_claim($1::uuid,$2::integer,$3::text) as result', [id, version, reason], manager);
    }
}
