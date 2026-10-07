# Saturday meals verification — 2026-10-07

Status: **public draft PR #15, not production-ready or deployed**. Baseline is public Team Hub main `8b3f9a7`; branch `dot/saturday-meal-signups` is under review at https://github.com/amsoccerman05/4418-team-hub/pull/15. Public code, synthetic tests and review artifacts were approved for this PR. No production records, schema, account roles, credentials, live emails, merge or feature deployment were changed.

## Passed against final code

- `npm run build`: TypeScript and production Vite build pass. The pre-existing large-chunk warning remains; it is a warning, not a build failure.
- Strict standalone backend TypeScript check passes.
- 87 browser-free meal logic tests: 34 memory gateway, 17 PGlite database, 14 durable HTTP-to-SQL, 3 Auth verifier, 6 timezone/model, 8 client transport, 2 original independent security regressions, and 3 durable retry/transaction regressions. Durable tests include disk close/reopen persistence, SQL profile rechecks and post-send outage replay.
- 4 static React rendering/privacy tests. These render actual components; they do not verify browser layout or interactions.
- 528 existing browser-free regression tests across 40 pre-existing test files pass. An initial mid-development meal SQL harness failure was corrected; the final 16 meal DB tests pass separately.
- `node scripts/smoke-meals-local.mjs`: real loopback HTTP page/module boot, synthetic claim, captured mock message, one-time verification, reopening emailed management capability, quantity edit, coordinator snapshot, cancellation/revocation, and hostile-origin rejection pass. Server is stopped afterward. No SMTP/Resend/Auth or production request occurs.
- `git diff --check` passes. Existing `event.html`, event-guide sources and public event content are unchanged.
- Production build excludes the coordinator demo HTML and contains no mock mailer, local manager token or mock-mailbox route.
- Independent review rechecked public projection, token scoping, atomic capacity, acknowledged cancellation/version races, uncertain result handling, private-data clearing, retained history, and delivery eligibility. No remaining material local-draft finding was identified.

## Browser CI established

- All 37 focused UI/static tests passed in [CI run 37659479738](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37659479738) at commit `1e5a7b9`: 33 browser interactions plus 4 static rendering/privacy cases. Parent coverage includes 320, 390, 768 and 1440px; coordinator coverage includes 390 and 1440px.
- The full repository suite and existing disposable integration also passed at that commit in [run 37659479724](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37659479724). Deployment was skipped.
- First-run failures were exact text-label selectors including nested select/textarea content. Accessible-role selectors fixed them without weakening the behavior assertions. Parent and coordinator screenshots were reviewed; screenshots remain synthetic.

## Explicitly unverified for the durable update

- PGlite is single-connection. The new native PostgreSQL runner has 16 concurrency/durable-handler groups; their CI result is pending.
- The new PostgreSQL gateway now calls the actual private SQL primitives through exclusive pooled transactions. A concrete Auth `/auth/v1/user` verifier is available, and the 5-group disposable real Auth/API smoke is authored; its CI execution is pending. The explicitly named local demo still uses memory-only fixtures.
- Live sender/runtime configuration, durable mail recovery, distributed abuse operations, shared quota allocation, actual inbox delivery, production data retention and recovery remain deployment prerequisites. Production index.ts stays inert; all tested mail is disabled or `.invalid` mock delivery.

## Reproduce

```sh
npm ci
npm run build
npm run test:meals
npm run test:meals:static
node scripts/smoke-meals-local.mjs
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions supabase/functions/team-meals/*.ts
node scripts/preview-meals.mjs
```

On an authorized browser-capable runner: `npm run test:meals:ui`. Public draft publication and synthetic CI are authorized; merge, production configuration and live mail remain separate approval steps. See [release requirements](MEALS-REVIEW.md) before any live enablement.

## Corrected durable candidate review

Independent review reproduced and fixed UUID-case idempotency duplication and capability fallback after an ambiguous COMMIT/failed ROLLBACK. UUID identifiers are normalized before hashing. Connection uncertainty now forces a generic 503/uncertain result before domain-error mapping and discards the connection without a second operation. The disposable Auth helper uses explicit nonempty PostgreSQL startup options rather than inheriting PGOPTIONS. All three focused regressions pass and are included in the aggregate command. The corrected source remains local pending renewed authorization to update the public draft branch; native/real-Auth CI has not run for it.
