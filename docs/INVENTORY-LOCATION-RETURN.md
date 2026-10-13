# Safe scanned Inventory location return

A signed-out Inventory location link may send the user to Team Hub with `?inventory_location=<UUID>`. This is a non-secret location identifier only. Team Hub accepts exactly one canonical-shape UUID value, constructs the destination with the fixed `https://inventory.frc4418.org/` origin and `#location/<UUID>` route, and ignores malformed, duplicate, URL/path, and external-destination values.

The query survives reload and normal successful sign-in. No local/session storage is added. Existing authentication and profile authorization remain responsible for access. Once authenticated, Team Hub displays “Continue to scanned inventory location.” Only the user's click opens Inventory using the unchanged suite-auth first-party opener handler. The click consumes the routing query. There is no automatic popup, broker change, token-bearing return URL, extra permission, or inventory mutation. A normal gateway without this query keeps its current behavior.

Inventory's matching patch should only preserve an exact `#location/<UUID>` hash when redirecting to Team Hub. Other routes, malformed hashes, and arbitrary destinations must still use the ordinary gateway. Ship this Hub change before the Inventory redirect change.

Checks:

- `npm run build`
- `npx playwright test tests/inventory-return.spec.ts tests/events-ui.spec.ts tests/hub.spec.ts --workers=1`
- Build with synthetic Supabase environment values, then `npx playwright test --config tests/suite/inventory-return.config.ts` for the real-origin first-party opener test. The suite intercepts every HTTPS request with local build files and synthetic responses; it never signs in to or mutates a live project.

The first-party suite verifies mobile/desktop, signed-out/reload/sign-in destination preservation, no automatic popup, an explicit click opening the exact fixed Inventory route, a stripped access-only broker response, no Inventory credential storage, and no data mutations. It does not change the shared broker implementation or exercise production credentials.
