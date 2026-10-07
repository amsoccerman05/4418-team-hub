# Saturday meals: durable gateway binding

## Scope and verified boundary

`supabase/functions/team-meals/postgres-gateway.ts` implements the public and
coordinator Request/Response contract against the **actual relational SQL draft**
in `supabase/drafts/saturday-meals.sql`. It calls the reviewed private primitives
and public coordinator wrappers through `postgres.ts`; it does not copy the
in-memory repository into a JSON table or introduce a second schema/model.

The original loopback UI demo continues to use `MemoryMealRepository`. The durable
factory is separately injectable and tested. Production `index.ts` still returns
503. No listener, environment lookup, credential, deployment, live mail adapter or
production database access is added by this binding.

`tests/meals-postgres.spec.ts` verifies 14 complete browser-free HTTP-to-SQL paths
with synthetic data on PGlite, including a real disk close/reopen. PGlite has one
connection, so its parallel-request tests establish transaction behavior and
adapter integration, **not native multi-connection locking**. Native PostgreSQL
and optional isolated Auth/PostgREST coverage have their own status and commands
in [MEALS-NATIVE-VERIFICATION.md](MEALS-NATIVE-VERIFICATION.md).

A concrete trusted-server verifier is also provided in `auth.ts`; it calls the
configured Auth user endpoint rather than locally decoding a bearer. Its real
Auth/PostgREST smoke is tracked separately from these injected-authority tests.

The PGlite suite injects synthetic verified identities and provides a minimal
`auth.uid()` test fixture. It does **not** establish that a real Auth service,
revoked bearer, issuer/audience validation, deployed Edge transport, or Supabase
network policy works. Do not promote its passing result to real-Auth evidence.

## Reusable server boundary

`createPostgresMealGateway` accepts:

- `pool`: a trusted direct server pool implementing `MealSqlPool`. A leased
  connection provides parameterized `query` and `release`; it stays exclusive
  until commit or rollback. The interface can wrap `pg.Pool`, and does not depend
  on or construct a driver.
- `allowedOrigins`: exact allowed browser origins.
- `publicBaseUrl`: the canonical fragment-link page at an allowed origin, with no
  credentials or query data.
- `mailer`: disabled by default. The only enabled draft mode is an explicit
  network-free mock accepting `.invalid` recipients. Runtime checks reject live
  mode; no real recipients are permitted.
- `authorizeManager(request)`: absent by default. A trusted server authority must
  verify the request and return only the verified subject UUID. Caller body
  fields, unsigned JWT decoding, editable metadata and the local demo header are
  not an authority.

`handle(request, { ip })` takes an IP **from trusted transport metadata**. It never
reads `X-Forwarded-For` or similar caller-supplied headers. Missing metadata uses
one conservative shared rate bucket. A future deployment must review its actual
proxy trust boundary before supplying this field.

`PostgresMealDatabase` exports typed service methods for request quota, public
listing, holds, verification, private inspection/changes, delivery state and
coordinator operations. SQL strings and role selection are fixed by the service;
all values use placeholders. There is no arbitrary caller SQL entrypoint.

## Transactions and identity isolation

Each call leases one connection, begins a transaction, sets transaction-local
`request.jwt.claim.sub` and `request.jwt.claims`, and selects a fixed local role:

- Public and capability actions: `service_role`, no subject.
- Coordinator actions: `authenticated`, only the already verified subject.

The SQL coordinator wrappers independently re-read `public.profiles`, requiring
an active mentor/admin and holding the profile lock for the operation. Even a
valid bearer for a student or deactivated coordinator is denied. Role/subject
settings revert at transaction completion; tests check that pooled reuse cannot
inherit a coordinator identity.

No application transaction is decomposed into unrelated REST requests. The
existing SQL budget/meal/claim/token locks enforce allocation and audit
invariants. Separate phases are deliberate: request quotas commit before body
processing; hold creation commits before a delivery lease; the lease commits
before mock dispatch; final mail status has its own transaction. A failed
operation never refunds the general request quota.

On an error, the adapter rolls back before returning the connection. An uncertain
COMMIT or failed rollback discards it. It does not automatically retry an uncertain
commit or provider operation. Known SQL domain errors become fixed safe HTTP
messages; constraint names, driver details, query text, contacts and values never
appear in HTTP errors. Purpose-separated access/manage hash lookup tries the
second capability only after a generic invalid-link rollback, never after a
conflict or uncertain database failure.

## Limits, privacy and replay

Both the memory and SQL handlers use the same `createMealTransport` Origin/CORS,
16 KiB streaming body, JSON content type, no-query, no-store/no-referrer and safe
error boundary. Claim/meal validators and the DTO contract are shared.

The SQL path owns its clock and reviewed fixed limits: a 15-minute pending hold,
30-minute access session, reusable management capability until the meal or 90
days, 120 requests per minute per hashed transport IP, 12 claims per hour per
hashed IP, 4 per hour per normalized email, and one atomic configured daily mail
budget. SQL's daily budget defaults to zero. No TypeScript options silently
override SQL limits. Configuring a nonzero budget outside synthetic tests is a
separate reviewed operational action.

Verification, access and management tokens each contain 256 random bits. Only
purpose-separated SHA-256 bytes cross into SQL. The private tables/outbox store
no raw token, URL, message body or provider response. Public claim receipts are
explicitly projected to status, email status, expiry and generic message; internal
claim/outbox IDs and replay flags never escape. Public lists contain only meal and
aggregate coverage fields. Names/emails remain in the private relational contact
model and authorized coordinator projection.

The request hash scopes the client key to normalized email plus meal. SQL computes
a fingerprint from normalized input. A body mismatch fails. Identical concurrent
replays reserve one hold, budget and send; another email cannot discover the first
email's claim. Unlike the memory demo's 24-hour eviction, SQL intentionally keeps
expired idempotency entries as conservative replay tombstones until an approved
retention/recovery policy exists. The integration test covers that distinction.

## Mail uncertainty and recovery

`begin_delivery` atomically changes `queued` to `uncertain` before any mock send.
The stable provider key is `meal-verification:<claim UUID>`; the unique outbox is
bound one-to-one to that claim. Failed send releases a pending hold and revokes
its capabilities. Exceptions remain uncertain. A successful provider acceptance
is called `sent`, never inbox delivery.

The final public receipt is re-read through the idempotent SQL primitive, without
private table grants. A crash after sending but before recording the outcome leaves
the durable lease uncertain. Rebuilding the handler and replaying the request
cannot resend a replacement token. A crash before dispatch can leave queued mail
and a hold that expires. Because plaintext links are not durable, there is no
background retry/reconstruction job. Lost confirmed links still need coordinator
help; an approved rotate/reconcile/retention design remains future work.

## Verification

The PGlite handler suite covers:

1. Full claim, verification, inspection, quantity edit and cancellation contract;
   a newly constructed handler sees the same SQL state.
2. Public privacy projection, one-use verification, purpose scoping, hash-only
   storage, management links after short-session expiry, and claim isolation.
3. Contended capacity, atomic rollback of contacts/budget/outbox on failed holds,
   idempotency fingerprint conflicts and retained tombstones.
4. Fresh coordinator role/active checks, attempted body actor spoofing,
   transaction-local identity cleanup, server-assigned IDs and stale meal
   cancellation acknowledgement.
5. Definite, uncertain and thrown mock-mail outcomes; a post-send SQL outage;
   conservative replay with no duplicate send.
6. Origin denial before SQL, oversized/malformed bodies, safe errors, ignored
   forwarding headers, distributed committed request quotas, email quota, zero
   mail budget, disabled defaults and the inert production entrypoint.
7. PGlite disk close/reopen with surviving claim, capability and idempotency state;
   uncertain COMMIT connection disposal without retry or SQL detail disclosure.

Run from the repository root (browser installation is unnecessary):

```sh
npm run test:meals -- tests/meals-postgres.spec.ts
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions supabase/functions/team-meals/*.ts tests/meals-postgres.spec.ts
```

A separate run of the original gateway and SQL suites checks the shared transport
refactor. Publication/CI results must identify the exact commit; a local result
alone is not a claim that CI or a deployed service passed.

## Remaining enablement gates

This closes the previously disconnected SQL-to-HTTP implementation boundary.
Before any feature enablement, independently review native concurrency and real
Auth/network test evidence, proxy IP trust, private-schema exposure/ACLs, production
connection setup and security advisors, retention and backup policy, approved
recovery/rotation, sender identity and consent/quota policy, actual provider/inbox
behavior, and end-to-end browser integration. Applying a migration, configuring
credentials, sending real mail or deploying remains outside this draft.

References reviewed 2026-10-07: [Supabase database functions](https://supabase.com/docs/guides/database/functions)
and [changelog](https://supabase.com/changelog). This adapter uses no changing SDK
method or framework authentication API.
