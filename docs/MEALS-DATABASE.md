# Saturday meals database foundation

## Review status

`supabase/drafts/saturday-meals.sql` is an additive **local review draft**, deliberately outside `supabase/migrations`. It has not been applied to any Supabase project. It creates no accounts, keys or new roles and changes no existing profile roles. The existing local gateway uses its own in-memory repository; it is **not bound to this SQL**. Neither a live public signup endpoint nor production email is enabled by this work.

The SQL is exercised with synthetic data in `tests/meals-db.spec.ts` using PGlite. These tests validate PostgreSQL statements, roles/grants, RLS, projections, capacity, tokens, optimistic versions, idempotency and transactional rollback. PGlite has one connection; this is not evidence of native multi-connection locking behavior, deployed PostgREST exposure, provider delivery or end-to-end Supabase integration.

Run the focused suite with:

```sh
npm run test:meals -- tests/meals-db.spec.ts
```

## Access and privacy boundary

All base tables live in `meals_private`, which must remain **absent from exposed API schemas**. Every table has RLS enabled and no browser policies. `anon`, `authenticated` and `service_role` have no direct table privileges. The private schema contains:

- Meals and slot definitions
- Parent contact names and normalized email addresses
- Contributions, including expired/cancelled history
- SHA-256 capability hashes, expiry, purpose and revocation
- Mail delivery states and idempotency receipts
- Bounded email/IP rate counters and daily email budget
- Private attributed action history and coordinator cancellation reasons

No contribution stores children’s names or individual dietary/health information. Public guidance is for generic instructions such as ingredient labeling; coordinators must not put personal details into titles, slot labels or guidance.

Only three public-schema wrappers are granted to `authenticated`: `meals_manager_context`, `meals_manager_save` and `meals_manager_cancel_claim`. Every call reads the current `public.profiles` row through `auth.uid()`, checks `active = true` and role `mentor` or `admin`, and takes a shared row lock for the duration of the transaction. Lead/student/readonly/inactive profiles do not get coordinator access. Browser-editable metadata and supplied actor IDs are not authorization inputs. Anonymous callers and `service_role` cannot invoke these wrappers.

Private, service-only primitives have narrow explicit grants. Their schema is unexposed, their bodies use an empty `search_path`, and default `PUBLIC` function execution is revoked. Other private helpers have no service-role grant. A later server adapter can call the primitives using a trusted direct database connection. Do not expose the private schema to make `.rpc()` convenient, and do not add public service-role passthrough functions.

`list_public`/`public_meal` construct an explicit allowlist matching `src/meals/types.ts`: meal ID, generic title, service timestamp/timezone, expected headcount, generic guidance, status/version, whole-meal coverage, and slot requirement/confirmed/held/remaining quantities. There are no contacts, individual claims, identifying dietary details, token hashes or delivery metadata. The private claimant response shows only that claim’s name and quantities, never other parents or email addresses.

## Transaction and allocation rules

Every allocation-changing operation locks the meal row `FOR UPDATE` before re-reading contributions/tokens or changing quantities. Hold creation additionally locks the singleton budget row first. The consistent hold order is budget → meal → contribution/token; other claim mutations start at the meal.

- Pending holds expire after 15 minutes or at the meal cutoff, whichever comes first. Expired holds stop consuming capacity immediately in every projection/check, even before their row is marked expired.
- Confirmation consumes the existing held quantity, so it cannot double-count or compete for a second allocation.
- A whole-meal pledge has quantity one and no slot ID. Any confirmed or nonexpired pending item blocks it. A whole-meal pledge likewise blocks every other whole/item pledge.
- Item edits account for every other confirmed and nonexpired pending allocation under the same lock.
- Meal and contribution edits require a current optimistic version. Missing/stale versions fail.
- Capacity cannot fall below current item allocations. Slots with any contribution history cannot be removed; their records remain intelligible after cancellation/expiration.
- Active item pledges prevent changing that slot’s label, unit or category. Active whole-meal pledges also freeze headcount and slot requirements/specifications. Active contributions prevent rescheduling. Coordinate explicitly before cancelling/replacing commitments; the draft never silently changes what a parent agreed to bring.
- Cancelling a meal with active contributions requires `acknowledge_cancellation: true` and a cancellation reason. The transaction marks those contributions cancelled and revokes their capabilities, preserving all rows and private audit attribution. No parent notification is implied or sent. The UI must show the affected count before acknowledgement.
- Individual cancellation needs the current version; coordinator cancellation also needs a reason. It retains the contribution and revokes all its capabilities.
- Audit inserts are in the same transaction. An audit failure rolls back the data, capacity, budget, receipts and tokens.

Service functions are privileged implementation boundaries. All application input validation, HTTPS/origin checks, bounded request size, anti-abuse handling, safe errors and non-logging of secrets remain gateway responsibilities. `public.meals_manager_*` is separately authorized through fresh shared identity.

## Capabilities, email and uncertain outcomes

The gateway must create independently random, high-entropy verification, management and session tokens (at least 256 bits). It hashes them with SHA-256 before calling SQL. The database accepts only 32-byte hashes, never plaintext tokens, links, email bodies or provider responses. All sample tokens in tests are synthetic hashes, not production secrets.

- Verification is one-use, 15 minutes maximum and linked to a pending hold.
- A separate email management capability survives browser closure and is valid until the meal cutoff or 90 days after issuance, whichever comes first. It is usable only once the contribution is confirmed.
- A verification response issues a distinct 30-minute session capability. `inspect`/`change_claim` accept either a valid management capability or a session capability, matching the local gateway. Optional `reopen_session` exchanges the reusable management capability for a fresh short session.
- Expired/revoked/unknown links return a generic failure. Cancellation revokes all purposes. No token can select an arbitrary claim ID.

Hold creation atomically reserves capacity, writes contact/claim/hash rows and a token-free outbox record, and consumes daily/rate limits. The SQL daily budget defaults to zero (fail closed); tests explicitly configure a synthetic budget of 50. Production budget configuration requires an approved feature-specific allowance. Per-email and per-IP claim caps are 4 and 12 per hour, respectively. It returns private dispatch metadata only to the trusted gateway. The public handler must project this to its generic receipt.

The raw verification and management tokens remain transient in the request process. After commit, that same process calls `begin_delivery(outbox_id)`. Only the caller that changes `queued` to `uncertain` may contact the mail provider, using the outbox ID as the provider idempotency key and a stable, verified sender. After the provider outcome, `finish_delivery` records `sent`, `failed` or `uncertain`. Both delivery primitives take the meal lock before an outbox lock. After that lock, dispatch requires an open meal with a future service time and a still-pending, nonexpired hold; a closed/cancelled/past date cannot lease a verification email. A definite failed dispatch expires a still-pending claim immediately, revokes its links, releases capacity, increments the meal/contribution versions and writes private audit history in the same transaction. Its replay receipt has no hold. If verification acquired the meal lock first and already confirmed the pledge, a late failure callback changes only the delivery state; it preserves that confirmed commitment and its management access. `sent` means provider acceptance, not inbox delivery. An ambiguous result stays uncertain and must never be automatically resent.

A crash after the database commits can strand the plaintext link. The outbox intentionally cannot reconstruct it. A retry with the same request key reuses the original receipt, does not consume capacity/budget again, and does not send again; it retains known failed/uncertain status. The draft keeps expired idempotency entries as conservative replay tombstones rather than silently creating a second hold. The `expires_at` field is a future retention boundary, not permission to delete receipts ad hoc. A production retention policy and deliberate resend/rotation flow are **not implemented**. Until then, the user can wait for the hold to expire and submit a fresh request; confirmed parents with lost links need a coordinator, who can explicitly cancel the old commitment before a replacement.

No durable worker should claim it can reliably retry token-free queued mail. A future durable design must explicitly choose approved envelope encryption/ephemeral secret handling, or a safe revoke-and-rotate recovery protocol with fresh budgets, expiry, provider idempotency and clear uncertainty semantics. Never solve this by persisting plaintext tokens in the outbox, telemetry, audit history or client storage.

## Adapter and deployment checklist

This is not a turnkey deployment. Before any live enablement:

1. Obtain authorization for the target environment and delivery integration. Resolve sender identity, permitted origins, canonical share URL, notification policy, consent/retention requirements and supported management-link recovery.
2. Bind the gateway transaction/repository contract to PostgreSQL. Reconcile field mapping, SQL error normalization, rate/budget configuration and idempotency-key/fingerprint hashing; do not assume the in-memory implementation already uses this draft.
3. Use only a server-held secret/direct connection. Verify the Supabase Data API still excludes `meals_private`; test that public function ACLs and fresh-role revocation behave through the real API.
4. Run native PostgreSQL multi-connection races for simultaneous item/whole claims, expiry/confirmation, quantity edits, coordinator capacity updates, meal cancellation and mail dispatch. Assert no over-allocation and deterministic recovery on serialization/lock errors.
5. Add network-level tests for origin denial, public enumeration, malformed/replayed/expired tokens, browser reload, revoked profiles, email budget/rate enforcement, provider timeouts, duplicate HTTP retries and post-commit process loss. Confirm tokens never reach logs, URL referrers or analytics.
6. Run current Supabase database/security advisors. Convert the reviewed draft using the official CLI migration workflow (`supabase ... --help` first); never invent a timestamped migration filename. Test in an isolated local/staging project before proposing a remote apply.
7. Verify end-to-end signup, inbox delivery, confirmation, returning management links, edit/cancel and coordinator views before enabling the share link. Establish private retention/backup access and a documented operational recovery path.

## References checked

- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Function privileges and security modes](https://supabase.com/docs/guides/database/functions)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase changelog](https://supabase.com/changelog), checked 2026-10-07. The draft uses built-in PostgreSQL SHA-256 rather than an added crypto extension; no remote database change was made.
