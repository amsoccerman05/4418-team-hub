# Saturday meals gateway

This directory contains the accountless meal signup endpoint, server-verified
coordinator endpoint, and durable email delivery worker. `index.ts` is a runnable
Supabase Deno Edge entrypoint. It is **disabled by default**: no pool is constructed
and no Auth or email request occurs without explicit valid runtime configuration.
No production activation, secret configuration, schedule, hosted write, or real
email delivery is part of this draft.

See [runtime and activation guide](../../../docs/MEALS-RUNTIME.md) for exact
configuration names, safety gates, provider behavior and the remaining operational
approval checklist. The repository's loopback UI demo still uses `mock.ts` and its
synthetic in-memory repository. The deployed entrypoint uses `postgres-gateway.ts`
and the reviewed relational SQL primitives; it never substitutes an in-memory
store for PostgreSQL.

## HTTP boundary

`POST /functions/v1/team-meals` accepts JSON operations:

- Public `list` and `claim`
- Private capability `verify`, `inspect`, `edit`, `cancel`
- Coordinator `manager`, `save_meal`, `cancel_claim`

Public requests need no user account. All regular operations require an exact
configured Origin, a JSON body limited to 16 KiB, known fields, bounded values,
and a URL without query data. Responses are private/no-store and no-referrer.
Coordinator bearers are verified with the configured Supabase Auth `/auth/v1/user`
on every request; the SQL wrappers separately recheck the current active
mentor/admin profile. Caller-provided role metadata never authorizes access.

The runtime ignores all forwarding headers by default, using a conservative
shared request/claim quota bucket. A separately reviewed proxy option can use one
known overwritten single-address header. Neither caller headers nor body fields
can select the strategy or Auth authority.

`POST /functions/v1/team-meals/dispatch` is a separate worker endpoint. It requires
its own explicit enable flag and configured bearer secret, rejects browser Origin
headers and any nonempty JSON fields, and processes at most three due deliveries. It is not
a public JSON operation. No schedule is created by the code.

## Private links and durable mail

Verification and management links carry separate 256-bit random capabilities in
URL fragments, never query strings. Clients erase fragments before API calls.
Only purpose-separated hashes are used to look up capabilities in SQL. A
verification link expires with its pending hold (at most 15 minutes). Successful
verification creates a separate 30-minute access capability. The original private
management link reopens that one confirmed signup until service time or 90 days,
whichever comes first. Cancellation and expiry revoke capabilities.

The initial claim transaction atomically reserves capacity and budget and saves
an AES-GCM envelope containing the exact immutable provider payload and stable
idempotency key. This allows recovery after a crash without replacing any links.
Plaintext contacts, tokens and message bodies are never written into the outbox
or diagnostics. SQL removes the envelope on terminal outcome or expiry. A worker
lease, generation check, bounded attempts, hold cutoff, and provider idempotency
protect delivery recovery and simultaneous workers.

`provider.ts` calls only Resend's fixed `/emails` and `/usage` endpoints. It uses
the existing sender/key environment names, an eight-second timeout, no redirects,
and no logs. Accepted means the provider returned a valid message ID, not that
the email reached an inbox. Definite rejections, retryable rejections, and ambiguous
acceptance stay distinct. Every permitted retry reuses the exact persisted body
and key; the recovery deadline is far shorter than Resend's 24-hour key lifetime.

SQL mail is independently off by default with a zero daily cap. Fresh provider
account daily/monthly usage, approved headroom for other senders, feature
reservations, current queued notifications, and a time-limited quota approval are
required before accepting/sending live email. Missing, stale, malformed or
unavailable provider usage fails closed. No shared Supabase Auth mail quota is
used. A shared Resend account cannot make independent senders transactionally
atomic; reserve headroom and operational monitoring remain required.

## Safe local tests

`local-test` mode supports only the no-network `MockMealMailer` and `.invalid`
recipients. It cannot construct a Resend sender, and rejects real provider
configuration. Explicit Docker host configuration allows the local Auth/DB
containers; it cannot relax production HTTPS/TLS requirements. An optional
local-only deferred-delivery flag permits an isolated fixture to inspect/decrypt
its own synthetic queued envelope before testing the authenticated worker route.
There is no HTTP mailbox or capability-inspection test endpoint.

## Verification

- `tests/meals-runtime.spec.ts`: runtime guard matrix, exact origins, real Auth
  wiring, proxy trust, disabled state and protected dispatch routing
- `tests/meals-provider.spec.ts`: immutable provider requests, all result classes,
  no-network disabled paths, renderer safety, usage parsing/failure and freshness
- `tests/meals-auth.spec.ts`: authoritative user verification and local-host guard
- `tests/meals-postgres.spec.ts`: Request/Response through actual SQL primitives
- Delivery recovery and native/served Edge integration tests cover encrypted
  restart recovery, real multi-connection PostgreSQL and local Deno HTTP.

Run the root meal logic suite and backend typecheck as documented in the runtime
guide. Live email is deliberately never used by these tests.
