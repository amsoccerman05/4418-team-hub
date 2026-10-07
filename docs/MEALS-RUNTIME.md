# Meal Edge runtime and provider integration

Status: implemented and disabled by default. This is a production-capable code
path awaiting separately approved configuration and deployment, not an activated
service. No credentials were read, generated, saved or expanded, and no real
emails or hosted database mutations were performed while implementing it.

## Architecture

`index.ts` registers `Deno.serve`, loads the guarded runtime, and lazily constructs
a pinned `npm:pg@8.23.1` pool through the function's `deno.json` import mapping.
The pool has two connections, bounded connection/query/statement timeouts, and
verified TLS in production. The gateway leases one connection for each entire
BEGIN/COMMIT/ROLLBACK transaction and discards ambiguous connections. No
transaction is split across independent PostgREST requests. A disabled or invalid
configuration returns a generic 503 without opening a pool or making network
requests. Provider or driver exception text is never logged or returned.

`supabase/config.toml` uses `verify_jwt = false` for accountless requests. This does
not authorize coordinator operations: `auth.ts` verifies each bearer with the
fixed configured Auth authority and public API key, then SQL evaluates fresh
profile role/active status. Public callers cannot provide identities, select
roles or authorize dispatch.

## Runtime configuration names

This table documents names and requirements only. No values or secret setup are
included. All configuration is server-side, never in a Vite environment variable.

| Name | Requirement |
| --- | --- |
| `MEALS_ENABLED` | Must explicitly enable the endpoint; missing or any other value leaves 503. |
| `MEALS_RUNTIME_MODE` | Explicit `production` or isolated `local-test`. No inferred mode. |
| `MEALS_DATABASE_URL` | Explicit override or existing platform `SUPABASE_DB_URL`; trusted PostgreSQL connection URL; no query/hash parameters, so embedded SSL options cannot override TLS. Production requires credentials and a non-local host. |
| `MEALS_DATABASE_CA` | Optional configured CA certificate for production verified TLS; certificate verification is never disabled. |
| `MEALS_AUTH_URL` | Explicit override or existing platform `SUPABASE_URL`; exact trusted Supabase Auth origin. Production requires HTTPS. Not taken from requests. |
| `MEALS_AUTH_PUBLIC_KEY` | Explicit override, otherwise existing `SUPABASE_PUBLISHABLE_KEY` then `SUPABASE_ANON_KEY`; public key only, never a service-role/secret key. |
| `MEALS_PUBLIC_BASE_URL` | Canonical meal-page URL, without credentials, query or fragment. Production requires HTTPS. |
| `MEALS_ALLOWED_ORIGINS` | JSON list of exact origins, including the canonical meal-page origin. No wildcards. |
| `MEALS_MAIL_ENABLED` | Separately enables email. Otherwise public reads/coordinator operations work but claims cannot send. |
| `MEALS_MAIL_MODE` | Production requires `resend`; local tests require `mock`. |
| `RESEND_API_KEY` | Existing approved Resend credential. The `/usage` guard requires the key's existing full-access capability. An insufficient-scope key causes fail-closed behavior; this implementation never expands it. |
| `NOTIFICATIONS_FROM` | Existing approved verified sender identity, reused by the meal renderer. |
| `MEALS_ENVELOPE_KEY` | Separately approved 32-byte base64 wrapping key. Required for live mail; the known synthetic test key and any all-identical-byte key are rejected in production. No production key is created by this work. |
| `MEALS_DISPATCH_ENABLED` | Separately enables authenticated recovery dispatch. No schedule is installed by the code. |
| `MEALS_WORKER_SECRET` | Approved worker-only bearer secret with at least 32 characters. Never the user's session token. |
| `MEALS_IP_MODE` | Defaults to conservative shared bucketing. `trusted-proxy` needs the reviewed configuration below. |
| `MEALS_TRUSTED_IP_HEADER` | Only a reviewed single-address `cf-connecting-ip` or `x-real-ip` header; never an X-Forwarded-For chain. |
| `MEALS_TRUSTED_PROXY_VERIFIED` | Explicit assertion that deployment review proved the header is overwritten at every ingress and direct bypass is impossible. Required for the proxy option. |
| `MEALS_LOCAL_DATABASE_HOST` | Local-test only: exact single-label Docker service host for the isolated database. |
| `MEALS_LOCAL_AUTH_HOST` | Local-test only: exact single-label Docker service host for isolated HTTP Auth. |
| `MEALS_LOCAL_DEFER_DELIVERY` | Local-test only: queue the encrypted mock request for fixture inspection before worker dispatch. |

Explicit overrides take precedence. Empty or malformed overrides fail closed rather than silently falling back. Existing platform values are read only after explicit endpoint enablement; the runtime never creates or duplicates credentials.

The production runtime does not accept `.invalid`/loopback application or Auth
origins. Local mode accepts isolated `.invalid` HTTPS origins or loopback HTTP
application origins and explicit local Docker Auth/DB hosts. Local mode refuses
Resend configuration even if provider variables were accidentally inherited.
There is no configurable Resend endpoint or test mailbox HTTP route.

## IP trust and public abuse controls

The default ignores all caller forwarding headers. Every request shares one
conservative request bucket, and all anonymous claims share the corresponding IP
claim bucket. This is safe but restrictive until ingress has been reviewed.

Do not set the proxy assertion merely because a header appears in a request.
The deployment owner must verify who writes it, whether caller duplicates are
stripped, and whether every direct/alternate ingress overwrites it. Only a single
validated canonical IPv4/IPv6 address is used; malformed or combined values fall
back to the conservative bucket. Changing request headers cannot select a
strategy or reset the default quota bucket.

## Immutable delivery and provider outcomes

The rendered message contains one adult recipient, fixed subject, HTML/text, a
one-time verification link, and a private management link. No student record is
included. The exact JSON string, including sender, is encrypted before the claim
transaction commits. Restart/retry sends that same string with its original
`Idempotency-Key`, even if templates or sender configuration later change.

The provider adapter makes one eight-second request per leased attempt, follows
no redirects, has a bounded response parser, and does not retry internally:

- Valid 2xx response with a provider message ID: accepted (`sent`), never an inbox
  delivery claim.
- Definite non-retryable 4xx: rejected and terminal. Release the unverified hold
  only when no earlier attempt had ambiguous acceptance; otherwise retain terminal
  uncertainty and the potentially delivered link until the original hold expires.
- 429: definite rejection eligible for bounded same-payload retry (`retry`).
- Timeout/network/408/5xx, incomplete 2xx, or concurrent-idempotency 409:
  uncertain acceptance, eligible for bounded same-payload retry.
- Idempotency-mismatch or unknown 409: uncertain, no automatic replacement key
  or changed-body retry.

SQL limits retries by attempt count and the pending hold deadline, well inside
Resend's documented 24-hour idempotency window. Lease generations prevent a stale
worker from overwriting a newer result. Terminal success/failure and expiry purge
the recoverable envelope. A missing/mismatched encryption key never triggers a
replacement capability. Key rotation requires pausing/draining pending envelopes
or a separately reviewed migration; do not simply replace the wrapping key while
recovery is pending.

## Shared quota guard

`GET https://api.resend.com/usage` supplies actual account daily/monthly usage and
limits. Missing/403 responses, malformed or negative counts, expired reset times,
or stale response dates fail closed. Uncapped windows are explicitly null rather
than guessed. Snapshots are never cached in the runtime.

SQL separately checks the off-by-default mail flag, zero-by-default feature cap,
time-limited operator quota approval, daily/monthly reserves, current pending
notification queue and conservative feature reservations. Provider failures still
consume the reserved feature budget. Concurrent feature claims and worker
attempts use database locks. Notifications/finance/other independent senders do
not participate in that same lock, so account-wide races cannot be eliminated by
this feature alone: approved headroom and monitoring are necessary. Do not enable
this service with all remaining Resend capacity allocated to meal signups.

If the existing API key cannot read usage, leave mail off until an authorized
operator decides how to supply approved access. This is an operational blocker,
not permission to generate or expand a key.

## Recovery endpoint and scheduling

A configured worker sends an empty or strictly `{}` JSON `POST` to the exact
`/functions/v1/team-meals/dispatch` path with its approved worker bearer. Requests
with a browser Origin, URL query, body fields, or a body larger than 64 bytes are rejected. Body validation happens only after worker authentication; the empty JSON form supports a normal `pg_net.http_post` scheduler invocation. Authorization is compared
through fixed-size digests. A worker processes at most three due deliveries;
public list requests cannot drain the outbox. The public `claim` may recover only
its own already-due delivery on a repeated identical request.

A durable externally scheduled caller is necessary to recover a crash when the
original browser never retries. No schedule exists or is installed by this code.
After deployment approval, an operator must explicitly approve/configure an
appropriate bounded cadence shorter than the 15-minute hold and verify it calls
the protected endpoint successfully. Until then, recovery code is available but
not promised to run autonomously.

## Before activation

1. Approve applying the reviewed relational schema and verify private-schema
   grants, RLS, function privileges, pool roles and current profile authorization.
2. Confirm canonical application URL and exact CORS origins; verify default
   shared-IP tradeoff or review the proxy trust contract.
3. Approve using the existing Resend account, verified sender and eligible key;
   check actual daily/monthly usage, expected notifications and reserved headroom.
4. Approve wrapping-key and worker-secret setup separately. Never copy them into
   browser bundles, docs, PRs, diagnostics or fixtures.
5. Approve time-limited SQL mail enablement/budget and worker scheduling, then
   configure the independent runtime/mail/dispatch switches.
6. Run a separately authorized delivery validation to approved recipients. These
   isolated tests establish no claim about actual mailbox delivery.
7. Establish who monitors failures, expiry, quota approval expiry and independent
   account senders. The normal emergency send off-switch is the SQL
   `meals_private.mail_budget.mail_enabled` flag: keep the authenticated worker
   scheduled so it can still purge expired ciphertext before the quota gate.
   Disabling the entire runtime or worker also stops lazy cleanup; account for
   pending encrypted envelopes before doing so. Keep a documented key-rotation
   procedure.

## Verification and authoritative references

Focused checks: `npx playwright test --config meals.logic.config.ts` and backend
strict typecheck:

    npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions supabase/functions/team-meals/*.ts

Native integration covers actual local PostgreSQL, local Supabase Auth, and the
served Deno Edge entrypoint with `.invalid` recipients and synthetic encrypted
mail. It does not deploy to or modify the hosted project.

References checked October 7, 2026:

- [Supabase public-function auth configuration](https://supabase.com/docs/guides/functions/auth)
- [Supabase direct PostgreSQL connections](https://supabase.com/docs/guides/functions/connect-to-postgres)
- [Supabase per-function dependencies](https://supabase.com/docs/guides/functions/dependencies)
- [node-postgres pool API](https://node-postgres.com/apis/pool)
- [Resend idempotency and 409 semantics](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend usage API announcement and response contract](https://resend.com/changelog/account-usage-api)

The Supabase changelog Markdown endpoint was attempted and unavailable; the
relevant current official function documentation above was consulted directly.
