# Saturday meals verification — 2026-10-07

Status: **local draft, not production-ready or deployed**. Baseline is public Team Hub main `8b3f9a7`; branch `draft/saturday-meals-local` exists only in the isolated checkout. No production records, schema, account roles, credentials, emails, repository push, PR or publication were changed.

## Passed against final code

- `npm run build`: TypeScript and production Vite build pass. The pre-existing large-chunk warning remains; it is a warning, not a build failure.
- Strict standalone backend TypeScript check passes.
- 66 browser-free meal logic tests: 34 gateway, 16 PGlite database, 6 timezone/model, 8 client transport, 2 independent security regressions.
- 4 static React rendering/privacy tests. These render actual components; they do not verify browser layout or interactions.
- 528 existing browser-free regression tests across 40 pre-existing test files pass. An initial mid-development meal SQL harness failure was corrected; the final 16 meal DB tests pass separately.
- `node scripts/smoke-meals-local.mjs`: real loopback HTTP page/module boot, synthetic claim, captured mock message, one-time verification, reopening emailed management capability, quantity edit, coordinator snapshot, cancellation/revocation, and hostile-origin rejection pass. Server is stopped afterward. No SMTP/Resend/Auth or production request occurs.
- `git diff --check` passes. Existing `event.html`, event-guide sources and public event content are unchanged.
- Production build excludes the coordinator demo HTML and contains no mock mailer, local manager token or mock-mailbox route.
- Independent review rechecked public projection, token scoping, atomic capacity, acknowledged cancellation/version races, uncertain result handling, private-data clearing, retained history, and delivery eligibility. No remaining material local-draft finding was identified.

## Explicitly unverified

- 33 browser tests (21 parent, 12 coordinator) are authored and collected, but **not executed**. Installed Chromium fails during startup with `socket() failed: Operation not permitted`. No security bypass or false screenshot claim was made.
- Phone/desktop visual layout, keyboard interaction and navigation behavior require those real-browser tests. The attached HTML is a static design review, with sample dates and coverage and nonfunctional buttons.
- PGlite is single-connection. Native multi-session PostgreSQL race behavior is not verified.
- The executable gateway uses an in-memory repository; the private-schema SQL foundation is tested separately, not wired into that gateway. Real Supabase Auth/REST integration is not verified.
- Live sender configuration, durable dispatch/recovery, distributed abuse protection, shared quota budget, actual inbox delivery, production data retention and recovery are not implemented or tested.

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

On an authorized browser-capable runner: `npm run test:meals:ui`. Publishing this public repository or running its CI is a separate approval step. See [release requirements](MEALS-REVIEW.md) before any live enablement.
