# Saturday meals verification — 2026-10-07

Status: **implemented, published as a draft, disabled and not deployed**.
[PR #15](https://github.com/amsoccerman05/4418-team-hub/pull/15) includes the
production-capable runtime at `d7a02c7`. That published commit has the same runtime
source tree as the candidate tested in
[meal CI run 37678831155](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37678831155).
Production schema/configuration, credentials, mail activation, worker scheduling,
merge and deployment have not been performed.

## Confirmed results

- Production TypeScript/Vite build and strict backend typecheck pass. The existing
  large-bundle warning remains non-fatal.
- 141 browser-free meal logic tests pass, covering model/transport, memory and
  durable PostgreSQL gateways, authoritative Auth, runtime guards, real-provider
  request construction and classifications, encrypted outbox recovery, quotas,
  expiry, concurrency, idempotency and prior ambiguous delivery outcomes.
- Four static React rendering/privacy cases pass. The focused browser/static
  review reports 38 passing cases; these include actual parent/coordinator
  interactions and responsive layouts, not just mocked component text.
- The public 390px, claim 320px and coordinator 1440px screenshots were visually
  reviewed and are clean. All review data is synthetic.
- All 17 native PostgreSQL concurrency/durable-handler groups pass. This includes
  replacement delivery leases, unchanged encrypted payload/key, stale completion
  fencing, transaction rollback, identity cleanup and real multi-session races.
- All five real Auth/PostgREST meal integration groups pass in the owned
  disposable Supabase stack. They establish server user verification, fresh
  profile authorization, private-schema API isolation and mock-mail lifecycle.
- Genuine `deno.lock` generation passed under the pinned Deno toolchain in CI.
  The artifact was downloaded, its digest verified, and its actual generated
  bytes copied to `supabase/functions/team-meals/deno.lock`. Integrity hashes were
  not hand-authored. This does not by itself establish compatibility with the
  served Edge runtime.
- The full repository suite (1,062 tests) and mentor-hours CI pass at `d7a02c7`.
- The loopback HTTP smoke passes synthetic claim, captured mock email,
  verification, returning management capability, edit, coordinator review,
  cancellation/revocation and hostile-origin rejection. It sends no real email.
- Production builds exclude coordinator demo HTML, demo manager credentials and
  the mock-mailbox route. Existing KCMT/event sources and the held parent hub
  remain unaffected.

## Remaining served-Edge database blocker

The initial disposable-stack job failed `team-meals` HTTP readiness with 503.
The next [diagnostic CI run 37681291197](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37681291197)
at `ddcaddad` confirms `driver_import: loaded` and runtime `enabled/ready`. This
clears startup/import resolution as the observed failure. The real HTTP `list`
request still returns the generic `temporarily_unavailable` response from the
database path, so the five additional served-Edge groups have not completed.

The preceding five real Auth/API groups passed. Neither those groups nor an
in-process handler test establish a passing Deno HTTP-to-database integration.
Safe database-boundary diagnostics are being added to distinguish connection,
query and idle failures with fixed allowlisted categories only. SQL, bind values,
raw errors, connection URLs, contacts and credentials are never logged.

The genuine version-5 lock and per-function import map now load far enough for
the pg driver and runtime to initialize. There is no current evidence that the
lock format is the cause of the remaining database-path failure. The next
isolated-stack rerun must establish a successful request and all served groups.

## Implemented activation boundaries

`index.ts` registers a real Deno listener and binds a guarded PostgreSQL pool,
Auth verifier, Resend adapter and authenticated recovery endpoint. It returns
503 when explicitly required configuration is absent or invalid. This is a
runnable disabled-by-default service, not an unbound placeholder.

The runtime flag, live-mail flag, dispatch flag and SQL mail-budget approval are
independent. Encrypted immutable messages can be recovered with the same provider
key under fenced leases and bounded retries. Fresh account-level daily/monthly
usage and reserved capacity protect the shared mail account conservatively;
missing or stale usage fails closed. Configuration, sender/key permissions,
quota headroom, wrapping/worker keys, scheduled recovery and operational retention
still require separate approval.

No real Resend email or mailbox delivery has been tested or claimed. `sent` means
provider accepted, never delivered/read. The tested adapter uses injected no-network
responses; isolated Edge/SQL tests use `.invalid` mock mail only.

## Reproduce

```sh
npm ci
npm run build
npm run test:meals
npm run test:meals:static
node scripts/smoke-meals-local.mjs
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions supabase/functions/team-meals/*.ts
npm run test:meals:ui
node scripts/preview-meals.mjs
```

Native PostgreSQL and real Auth/served-Edge commands and isolation requirements
are in [native verification](MEALS-NATIVE-VERIFICATION.md). Dependency-lock
resolution must use the pinned official toolchain in
`scripts/lock-meals-edge.mjs`. See [runtime requirements](MEALS-RUNTIME.md) and
[release review](MEALS-REVIEW.md) before enabling any live configuration.

## Security regressions retained

UUID spelling is normalized before idempotency hashing. An ambiguous commit or
failed rollback never falls through to another capability purpose. Lease
replacement cannot be completed by a stale worker; last-attempt cleanup respects
an active lease. Monthly quota accounting includes outstanding reservations from
the previous month. A later definite rejection cannot erase the uncertainty of
an earlier potentially accepted message. These corrections remain covered by
regression tests rather than relying on manual review alone.
