import { createMealRuntime, mealsUnavailable } from './runtime.ts';
import type { MealRuntime } from './runtime.ts';

/** Deno injects these APIs in Supabase Edge. The structural declaration also lets
 * the repository typecheck/import the disabled entry in isolated Node tests. */
declare const Deno: undefined | {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response> | Response): unknown;
};
let active: MealRuntime | undefined;
export default function handler(request: Request): Response | Promise<Response> {
    return active ? active.handle(request) : mealsUnavailable();
}
if (typeof Deno !== 'undefined') {
    const ready = createMealRuntime({ env: Deno.env, async createPool(configuration) {
        // Per-function deno.json pins this to npm:pg@8.23.1. The driver is loaded
        // only after every activation guard passes, never on a disabled deploy.
        const { Pool } = await import('pg');
        const pool = new Pool(configuration);
        // Idle socket errors must not emit driver credentials or kill the worker.
        pool.on('error', () => {});
        return { async connect() {
            const connection = await pool.connect();
            return { async query<Row>(sql: string, values?: unknown[]) {
                const result = await connection.query(sql, values);
                return { rows: result.rows as Row[] };
            }, release: (error?: Error) => connection.release(error) };
        } };
    } }).then(runtime => { active = runtime; return runtime; });
    Deno.serve(async request => (await ready).handle(request));
}
