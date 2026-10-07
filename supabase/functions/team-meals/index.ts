/** Intentionally inert. No database, JWT authority, mail provider, environment
 * credentials, or network client is wired here. Local testing imports mock.ts.
 * The durable SQL adapter and Auth verifier are available as injected modules.
 * Deployment still needs separately approved runtime configuration and live mail. */
export default function handler(_request: Request): Response {
    return new Response(JSON.stringify({ error: { code: 'not_configured', message: 'Meal signups are not enabled.' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
