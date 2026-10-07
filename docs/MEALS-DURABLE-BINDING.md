# Meal HTTP → Auth → PostgreSQL binding

## Executable boundary

The actual Edge entrypoint imports the guarded runtime, constructs the server pool only after explicit activation/configuration validation, and serves the meal HTTP handler. It defaults to unavailable without those flags. See [runtime setup and disabled defaults](MEALS-RUNTIME.md). Neither publishing nor deploying source alone activates mail.

`PostgresMealDatabase` binds the reviewed relational SQL functions directly; it is not a second JSON state store. Each operation leases one pool connection exclusively, starts a transaction, sets the verified subject and role transaction-locally, executes fixed SQL with bound parameters, then commits or rolls back. Commit/rollback uncertainty produces a safe error, discards the connection and never triggers capability fallback or an automatic mutation replay.

The gateway shares exact-Origin, method, body-size, content-type, known-field and no-cache/no-referrer controls with the memory fixture. The real mail provider is forbidden in the memory gateway. Public calls use the server-only SQL primitives. Manager calls first verify their bearer at the configured Auth `/auth/v1/user`, then call fresh active mentor/admin SQL guards. Untrusted metadata, fake actors, stale profile roles and anonymous sessions cannot authorize management.

Default IP accounting uses one conservative shared bucket. A forwarding header is trusted only after explicit deployment review confirms that header is overwritten on every ingress path. No caller-selected X-Forwarded-For chain is accepted.

## Durable request and recovery

The gateway normalizes UUID and email spelling before computing the scoped idempotency key. Equivalent UUID casing cannot create another hold or email. A changed request body under the same key is rejected.

It renders and encrypts the immutable exact provider body before hold creation. SQL atomically commits contact/claim state, hash-only authentication capabilities, quota reservation, idempotency and the encrypted outbox row. Request retries and the protected dispatcher reuse that row. A crash after commit or after provider acceptance does not require regenerating links or storing plaintext tokens.

The `sendPrepared` boundary sends recovered bytes unchanged. Lease fencing, bounded retries and provider idempotency prevent duplicate effects. Fresh account usage and database budget approval must pass before live admission/dispatch. Errors never expose provider bodies, contacts, connection strings, SQL or keys. See [private schema and recovery rules](MEALS-DATABASE.md).

## Runtime interfaces

- `MealSqlPool`: injected exclusive connections; runtime uses pinned pg with constrained pool size/timeouts and verified TLS in production.
- `createMealManagerVerifier`: configured HTTPS authority/public key, no JWT payload trust or role cache. Local Docker HTTP is an explicit exact-host test opt-in only.
- `ResendMealMailer`: fixed Resend endpoints, explicit enabled configuration, prepared JSON, stable idempotency, bounded response parsing and safe status classification.
- `createMealEnvelope`: separately approved wrapping key, per-message encrypted data key, fresh nonces and authenticated identity binding.
- Public handler: accountless list/claim/private capability operations plus server-authorized coordinator operations.
- Protected dispatcher: exact server-only route, separate worker credential, bounded batch, no browser Origin and no user-selected request fields. Scheduling/configuration remains off until approved.

The explicit `dev:meals` memory preview remains synthetic and ephemeral. The durable and actual Edge tests use newly owned local databases, fabricated contacts and mock provider I/O. No hosted project, live email or credential setup occurs during those tests.

## Verification limits and deployment

CI covers actual database restart persistence, native lock races, real disposable Auth/PostgREST and the served Edge entrypoint. Read the current PR's results for the exact tested commit and counts. Provider tests inject responses rather than sending messages. Real inbox receipt is not inferred from mock acceptance or successful CI.

The live deployment still needs separately approved server configuration, wrapping/worker-secret provisioning or approved reuse, quota/headroom selection, dispatcher scheduling, additive migration/backup, endpoint activation and a controlled real email test. Existing platform database/Auth values may be reused through validated server-only fallbacks; no secret is created or permission expanded by this source code.
