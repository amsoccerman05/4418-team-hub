import { createMealRuntime, mealsUnavailable } from './runtime.ts';
import type { MealRuntime } from './runtime.ts';

/** Deno injects these APIs in Supabase Edge. The structural declaration also lets
 * the repository typecheck/import the disabled entry in isolated Node tests. */
declare const Deno: undefined | {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response> | Response): unknown;
};
/** Only fixed categories leave the database boundary. Driver errors frequently
 * contain connection URLs, SQL, bind parameters or parent contact data. */
export function mealDatabaseErrorCategory(error: unknown): string {
    const row = error && typeof error === 'object' ? error as { code?: unknown; name?: unknown; message?: unknown } : {};
    const codes: Record<string, string> = {
        ENOTFOUND: 'dns', EAI_AGAIN: 'dns', ECONNREFUSED: 'connection_refused', ECONNRESET: 'connection_reset',
        ETIMEDOUT: 'connection_timeout', ERR_INVALID_ARG_TYPE: 'driver_argument', ERR_INVALID_ARG_VALUE: 'driver_argument',
        ERR_NOT_IMPLEMENTED: 'runtime_unsupported', ERR_METHOD_NOT_IMPLEMENTED: 'runtime_unsupported',
        '28P01': 'database_authentication', '28000': 'database_authentication', '3D000': 'database_missing',
        '42501': 'database_permission', '42883': 'database_function_missing', '42P01': 'database_table_missing',
        '3F000': 'database_schema_missing', '22P02': 'database_encoding', '22021': 'database_encoding',
        '08P01': 'database_protocol', '57014': 'database_timeout', '53300': 'database_connections',
        '57P01': 'database_shutdown', '08006': 'database_connection', '08001': 'database_connection',
    };
    if (typeof row.code === 'string' && Object.hasOwn(codes, row.code)) return codes[row.code];
    if (row.name === 'NotFound') return 'dns';
    if (row.name === 'ConnectionRefused') return 'connection_refused';
    if (row.name === 'TimedOut') return 'connection_timeout';
    const message = typeof row.message === 'string' ? row.message : '';
    if (message.includes('SASL:') || message.includes('SCRAM')) return 'driver_scram';
    if (message.includes('timeout exceeded when trying to connect')) return 'pool_timeout';
    if (message.includes('Connection terminated')) return 'connection_terminated';
    if (message.includes('not implemented') || message.includes('is not a function')) return 'runtime_unsupported';
    return 'unclassified';
}
function databaseDiagnostic(phase: 'connect' | 'query' | 'idle', error: unknown) {
    console.info(JSON.stringify({ event: 'team_meals_database', phase, category: mealDatabaseErrorCategory(error) }));
}
let active: MealRuntime | undefined;
export default function handler(request: Request): Response | Promise<Response> {
    return active ? active.handle(request) : mealsUnavailable();
}
if (typeof Deno !== 'undefined') {
    const ready = createMealRuntime({ env: Deno.env, onDiagnostic(diagnostic) {
        // Fixed enum only. No exception, URL, environment value or private data.
        console.info(JSON.stringify({ event: 'team_meals_runtime', ...diagnostic }));
    }, async createPool(configuration) {
        // Per-function deno.json pins this to npm:pg@8.23.1. The driver is loaded
        // only after every activation guard passes, never on a disabled deploy.
        console.info(JSON.stringify({ event: 'team_meals_runtime', phase: 'driver_import', state: 'starting' }));
        const { Pool } = await import('pg');
        console.info(JSON.stringify({ event: 'team_meals_runtime', phase: 'driver_import', state: 'loaded' }));
        const pool = new Pool(configuration);
        // Idle socket errors must not emit driver credentials or kill the worker.
        pool.on('error', error => databaseDiagnostic('idle', error));
        return { async connect() {
            let connection;
            try { connection = await pool.connect(); }
            catch (error) { databaseDiagnostic('connect', error); throw error; }
            return { async query<Row>(sql: string, values?: unknown[]) {
                try {
                    const result = await connection.query(sql, values);
                    return { rows: result.rows as Row[] };
                } catch (error) { databaseDiagnostic('query', error); throw error; }
            }, release: (error?: Error) => connection.release(error) };
        } };
    } }).then(runtime => { active = runtime; return runtime; });
    Deno.serve(async request => (await ready).handle(request));
}
