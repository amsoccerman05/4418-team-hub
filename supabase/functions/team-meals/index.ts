/** Intentionally inert. No database, JWT authority, mail provider, environment
 * credentials, or network client is wired here. Local testing imports mock.ts.
 * Deployment requires a reviewed SQL adapter and real coordinator authorization. */
export default function handler(_request: Request): Response {
    return new Response(JSON.stringify({ error: { code: 'not_configured', message: 'Meal signups are not enabled.' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
