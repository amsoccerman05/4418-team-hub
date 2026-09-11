# Team 4418 suite authentication

The three production HTTPS origins use `src/suite-auth.ts` (identical copies in each repository). Hub serves a small separate `suite-auth.html` entry containing `src/suite-broker.ts`. This is a browser session broker, not a second identity provider. All authentication and authorization remain Supabase Auth and the existing profile/RLS rules.

The broker runs on `https://team.frc4418.org` in a hidden same-site frame. It alone uses Supabase's standard persistent Auth client (`4418-team-hub-auth`). Supabase coordinates refresh and broadcasts sign-in/out between the Hub-origin frames/tabs using its normal SDK mechanisms. Inventory/Pit use a normal data client with an `accessToken` callback and delegate their existing auth methods to the broker. They do not persist or receive refresh/provider tokens. Access tokens are held in memory and still validated by Supabase for every protected API operation.

Messages require the exact production origin, the expected parent/frame Window, a protocol tag, and matching request ID. The broker accepts only the three listed suite origins and a fixed method allowlist. No wildcard destinations, shared-domain cookies, cross-origin localStorage copying, tokens in navigation URLs, service keys, Auth setting changes, or RLS changes are introduced. Other subdomains (including www) cannot request sessions. Browser storage or network failures do not fall back to anonymous privileged access or independent production sessions.

The public-key data clients have no independent refresh loop. See [Supabase session/refresh behavior](https://supabase.com/docs/guides/auth/sessions) and the supported [accessToken client option](https://supabase.com/docs/reference/javascript/initializing).

## Recovery and logout

Inventory's existing password-reset UI, redirect destination and PKCE flow remain. The broker stores the PKCE verifier through the Auth SDK, then exchanges the returned code. Existing implicit invitation/recovery callbacks are consumed in memory and removed from the address bar, then passed only to the trusted broker; the suite never creates token-bearing URLs. Password changes use the same Supabase update-user endpoint. Redirect destinations are restricted to the three suite origins.

Logout means this browser's suite session: it revokes the current refresh session and broadcasts logout to all three apps/tabs. Other devices are unchanged. UI/profile data and realtime subscriptions clear on logout. As with standard Supabase Auth, already-issued access JWTs expire according to the project's existing expiration setting; this implementation does not change that setting or claim instant JWT revocation.

Existing Hub sessions carry over. Previously independent Inventory/Pit sessions are not copied; users may sign in once after upgrading those apps, then all subsequent suite navigation shares that session. Old unused origin-specific SDK storage is not read or migrated. Localhost, demos, and existing isolated tests retain their original SDK clients.

## Deployment and verification

Deploy Hub (including `suite-auth.html`) first, then Inventory and Pit. All builds must use the existing same Supabase project and public key. No DNS changes are needed. Existing Inventory reset redirect allowlisting remains necessary; no new redirect target is introduced. Do not separately deploy a broker from a different project. Future CSP headers must permit the Hub frame and restrict its frame ancestors to the three suite origins.

Run each app's build and existing tests. For the cross-origin production-bundle tests, build all three sibling repositories, then from Hub run:

```sh
npx playwright test --config suite.playwright.config.ts
```

These tests serve the actual build artifacts at isolated browser routes for the production origins and intercept only the Supabase responses. They verify one-login navigation, reverse entry through Inventory/Pit, desktop/phone layout, shared logout across tabs, protected-page rejection afterward, untrusted-origin rejection, and Inventory password reset. They do not prove a real account's live backend permissions. A real authenticated production journey requires a valid test account and must be reported separately.

No database, attendance migration, profile or business-logic changes belong to this integration.
