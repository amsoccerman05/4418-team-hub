# Saturday meals verification

The implementation is published in [draft PR #15](https://github.com/amsoccerman05/4418-team-hub/pull/15).
The pull request's current checks and verification summary identify the exact
source commit, terminal outcomes, test counts and retained artifacts for the
meal, full-repository and mentor-hours workflows. This document records test
scope and safety boundaries rather than a snapshot of a running job.

## What the suites establish

- Build and backend typecheck cover the production frontend bundle and complete
  Edge function graph. The synthetic coordinator demo is excluded from production.
- Meal logic exercises model/transport, memory and SQL gateways, Auth verification,
  runtime configuration, provider classifications, immutable encrypted delivery,
  idempotency, quotas, expiry and recovery regressions.
- Static rendering covers component/privacy projections. Browser tests exercise
  parent/coordinator actions and responsive layouts; synthetic screenshots support
  separate visual review.
- The loopback HTTP smoke uses the disposable memory demo for claim, mock email,
  verification, management, edits, cancellation and origin rejection.
- Native PostgreSQL checks use independent connections to prove actual capacity,
  transaction, role, duplicate-claim, lease-replacement and stale-completion races.
- The owned Supabase stack tests real Auth/PostgREST authorization and private-schema
  isolation, then the actual Deno HTTP entrypoint through PostgreSQL and protected
  worker dispatch. Mock mail remains `.invalid`-only; no provider request occurs.
- Lock checks use genuine official Deno resolution and frozen verification of the
  committed transitive dependency lock. No integrity hashes are hand-authored.
- Full repository and mentor-hours workflows check unrelated behavior remains
  intact alongside the meal changes.

Passing one boundary is not evidence that another ran. In particular, PGlite and
injected handlers do not substitute for native concurrency or served Deno HTTP.

## Recorded integration diagnosis

An earlier [diagnostic run](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37682588301)
reported successful pg import/runtime initialization followed by `connect/dns`
failures resolving the owned Docker database alias. The candidate harness uses
an RFC1918 address verified against that exact running container and owned
network. Local-test mode must match the address to its explicit allowlist;
public, link-local, malformed and mismatched addresses are rejected. Production
DNS/TLS and Auth-origin rules are unchanged. Refer to the candidate meal run above
for the integration outcome after this change.

Startup/database diagnostics contain fixed stages/categories only. No raw errors,
SQL, bind values, connection URLs, contacts or credentials are logged. Public
failures stay generic.

## Live activation limits

`index.ts` registers a runnable Deno service with a guarded PostgreSQL pool,
server-verified manager Auth, Resend adapter and authenticated recovery endpoint.
Runtime, live mail, dispatch and SQL mail approval remain independently disabled
by default. Production schema/configuration, wrapping/worker keys, quota reserves,
scheduled recovery, migration backup, merge and deployment need separate approval.

Tests do not establish actual Resend or mailbox delivery. `sent` means provider
accepted, never delivered/read. Provider unit tests inject no-network responses;
isolated database/Edge tests use synthetic mock mail. No family data was imported
and no production mail was sent by this work.

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

See [native verification](MEALS-NATIVE-VERIFICATION.md) for PostgreSQL and owned-stack
commands, [runtime requirements](MEALS-RUNTIME.md) for configuration and operations,
and [release review](MEALS-REVIEW.md) before enabling any live feature.
