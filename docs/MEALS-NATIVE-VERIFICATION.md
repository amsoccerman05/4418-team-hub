# Native Saturday-meal verification

## Scope and safety

`tests/native/meals-concurrency.mjs` creates and destroys its own PostgreSQL
cluster. It requires an installed PostgreSQL binary directory and a non-root
runner. It never accepts a database URL, connects to an existing cluster, exposes
TCP, reads repository environment files, deploys migrations, or sends email.

```sh
npm ci
MEALS_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/meals-concurrency.mjs
```

Use Node 24 and the runner's installed PostgreSQL version. `initdb`, `pg_ctl` and
`psql` all come from the same absolute `MEALS_PG_BIN` directory. The cluster has a
fresh temporary data directory, a private Unix socket with mode 0700, and no TCP
listener. Child processes receive a minimal environment. The test process clears
inherited environment variables before loading the PostgreSQL driver; no inherited
PG settings, database URLs, proxies, or application credentials are used.

All identities and data are synthetic. Contact addresses end in `.invalid`.
Database roles are created only in the owned cluster. The fixture supplies a mock
`auth.uid()` reading the same transaction-local subject setting as the durable
adapter. This is **not real Supabase Auth or PostgREST verification**.

## Native multi-session checks

The suite launches independent PostgreSQL sessions. A transaction holds the
contested row until `pg_stat_activity` confirms the competing session is waiting
on a lock. Assertions do not rely on a sleep to decide which transaction won.

- Two parents contesting the final serving produce one reservation.
- Whole-meal and item claims exclude each other in either lock ordering.
- Duplicate request keys produce one claim, budget charge, and mail outbox row.
- Concurrent dispatch leases have exactly one winner.
- Expiry-first verification cannot revive a released hold; verification-first
  preserves the confirmed allocation during a competing claim/cleanup.
- A new claim invalidates an old coordinator capacity change or cancellation
  acknowledgement. Capacity-reduction/cancellation-first rejects the later claim.
- A quantity increase competes safely with another parent's reservation.
- Definite delivery failure releases an unverified hold once. Verification-first
  protects the confirmed pledge and management capability from a late failure.
- Profile revocation committed before authorization rejects the queued manager.
  An already-authorized transaction holds its shared profile lock until commit;
  a queued revocation takes effect for subsequent requests.
- Anonymous/authenticated/service roles cannot read or mutate private base tables.
  Browser roles still see no rows after an intentionally temporary SELECT grant,
  demonstrating the RLS backstop independently of normal ACL denial.
- A forced audit insert failure rolls back contact, claim, token, outbox, budget,
  idempotency and history writes. Public projections omit identifying data.

## Durable handler checks

`tests/integration/meals-gateway-native.mjs` runs the real Request/Response handler
and SQL adapter using `pg.Pool` over the same private socket. Two independent
handlers share durable quota, idempotency and allocation state. Recreating the
handler does not lose management capabilities or contribution versions.

Coverage includes synthetic manager authorization and fresh profile revocation,
origin/malformed-input rejection, duplicate claims and single mail dispatch,
one-use verification, returning management links, quantity edits, coordinator
cancellation, public privacy, zero-budget rollback, definite/uncertain delivery
outcomes, token-free durable records, committed request quotas, and cleanup of
transaction-local identity/role settings before pool reuse.

These are real PostgreSQL-driver and handler tests. The handler is called with
Request/Response objects, rather than through a deployed HTTP server. The manager
authority and mail transport are explicitly synthetic; no real JWT verification,
Supabase API exposure, browser integration, SMTP/provider service, or inbox delivery
is implied.

## Current evidence

Local execution on 2026-10-07:

- 17 SQL/PGlite tests pass after the request-quota and server-assigned-slot changes.
- Native runner/helper syntax checks and Node 24 adapter imports pass.
- Native PostgreSQL execution is **not run locally** because `initdb`/`psql` are
  unavailable in this workspace. The authorized CI runner must establish the
  native outcome for the exact commit. Do not treat authored coverage as a pass.
- Docker and the Supabase CLI are also unavailable locally; real Auth/PostgREST
  smoke tests remain a separate deployment gate.

The draft SQL remains outside `supabase/migrations`. Production entry remains
inert, the SQL mail budget defaults to zero, and no deployment or live mail is
part of this verification.

## Opt-in real Auth and PostgREST smoke

The existing owned disposable stack runner can additionally run meal integration:

```sh
MEALS_INTEGRATION=1 node tests/integration/fabrication-local.mjs --run
```

This requires the harness's pinned Supabase CLI (currently 2.119.0), Docker, and
Node 24. Existing stack safety checks, fresh-workspace construction, loopback-only
ports, isolated environment, secret redaction, and cleanup stay enabled. The flag
adds meal source hashes and the meal smoke after the existing integration checks;
it does not change default runs or expose the private schema.

`meals-stack.spec.mjs` creates four disposable `.invalid` Auth identities with
synthetic passwords, signs in using the real Auth service, and verifies them with
`createMealManagerVerifier`. That verifier calls the trusted authority's
`/auth/v1/user` each time and only passes the verified subject to SQL. It ignores
user-editable metadata and does not cache roles. No application environment is
read and no production entry point is wired to it.

The smoke checks mentor/admin access through the durable handler and the real
manager RPC, lead/student/forged-token denial, same-session profile deactivation
and role downgrade, anonymous RPC rejection, private-schema API read/write denial,
and missing public passthrough helpers. A synthetic claim is verified through the
durable handler, appears in the real manager RPC, and is cancelled through that
RPC with capability revocation. Verification messages stay in a memory-only mock
mailer; Auth email confirmations are disabled in this disposable stack.

Three local verifier unit tests cover fixed destination, safe bearer forwarding,
ignored metadata, anonymous/malformed identities, authority/network failures,
unsafe origin configuration and absence of an identity cache. A successful unit
suite is not evidence that the real Auth/API smoke ran. The opt-in smoke remains
**unexecuted locally** until a Docker-capable authorized CI run establishes its
result for the exact source hashes.

Auth verification follows [Supabase's server-verified user guidance](https://supabase.com/docs/reference/javascript/auth-getuser).
