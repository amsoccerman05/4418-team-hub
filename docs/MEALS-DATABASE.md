# Saturday meals: private SQL and delivery state

## Scope and deployment status

`supabase/drafts/saturday-meals.sql` is an additive review draft, outside migration history. It has not been applied to a hosted project by this work. The actual PostgreSQL gateway calls these relational functions through leased server connections. The explicit memory demo is separate. See [runtime configuration](MEALS-RUNTIME.md), [durable adapter](MEALS-DURABLE-BINDING.md), and the PR's latest verified CI summary.

No production credentials, users, roles or permissions have been created or changed. Local tests use fabricated contacts and ephemeral databases only.

## Privacy and authority

All meal base tables live in the unexposed `meals_private` schema. They have RLS enabled, no ordinary browser policies, and no direct table grants to `anon`, `authenticated` or `service_role`. Narrow private functions are granted to the server role. The three public manager wrappers independently read `auth.uid()` and the current profile, require active mentor/admin, and hold the profile row `FOR SHARE` through the transaction. Student, lead, inactive and readonly profiles do not qualify; user metadata never grants management.

The public projection explicitly lists only meal dates/timezones, generic guidance, headcount, slot requirements and coverage. It contains no adult contacts, individual dietary information, students, claim identities, tokens, envelopes or provider diagnostics. The claimant projection is scoped by a private capability and omits other contributors and contact emails. Only the coordinator context exposes the adult name/email and contribution/delivery history.

The gateway uses the real Auth authority before supplying a manager subject. It sets claims and roles transaction-locally, with fixed SQL statements and bound parameters. It never copies an actor supplied in a request body into database authorization.

## Allocation and concurrency

- Hold creation locks budget → meal → claim/outbox state. Allocation changes serialize on the meal row. Pending holds last at most 15 minutes, bounded by service time.
- Confirmation consumes the existing reservation. Whole-meal and item commitments exclude each other, including pending holds. Quantity edits account for every other active allocation.
- Meal and claim versions are optimistic concurrency controls. Coverage changes advance the meal version, preventing an old cancellation acknowledgement from affecting a newly arrived contributor.
- Referenced slots retain history. Active item labels/categories/units cannot change; whole-meal commitments also protect headcount and requirements. Existing contributors must be coordinated before rescheduling.
- Date cancellation needs a current version, explicit acknowledgement and reason. It marks active contributions cancelled, revokes all capabilities, purges queued delivery material, and retains attributed private history. No cancellation email is sent automatically.
- Audits, reservations, token hashes, encrypted outbox preparation, idempotency and budget accounting commit together. A failure rolls everything back.

## Capabilities and encrypted delivery material

Verification, management and session capabilities have independently random 256-bit tokens. The authentication table stores purpose-separated SHA-256 hashes only. Verification is single-use and expires with the pending hold. Management links last until service or 90 days after issue; short sessions last at most 30 minutes. Cancellation revokes all purposes.

The outbox additionally contains a short-lived **encrypted** exact provider request so a process crash does not strand verification. This supersedes the earlier token-free, unrecoverable prototype. No plaintext token, URL, email body, wrapping key or decrypted provider response is stored in the outbox or logs.

Before SQL creates a hold, the gateway prepares the exact email JSON and seals it with a fresh AES-GCM data key and nonce. That data key is wrapped by a separately configured 32-byte `MEALS_ENVELOPE_KEY`. Both layers authenticate the version/purpose, claim ID, outbox ID and stable provider idempotency key. The hold, token hashes, encrypted body and identity commit atomically. Replays return the existing row instead of replacing links, recipients or ciphertext.

Terminal delivery or expiry erases ciphertext. Physical expiry cleanup requires the protected dispatcher to run regularly; merely defining an expiry is not deletion. Configure and verify that schedule before enabling mail. A wrapping-key rotation must drain or deliberately expire/purge all outstanding envelopes first, unless backward decryption support is separately added. Current code uses one active wrapping key and fails closed on an unknown/wrong key or tampering.

## Fenced dispatch and recovery

Dispatch leases last 45 seconds, longer than the provider timeout. The lease is committed before I/O and its token fences completion. A repeated request cannot steal a currently active final attempt. Recovery always decrypts and sends the exact original bytes under the same Resend idempotency key.

Maximum attempts are five, with bounded 20/40/80/160-second backoff. No send starts within ten seconds of hold/retry expiry, and retry duration is also bounded below the provider's 24-hour idempotency retention window. A later definitive rejection cannot prove an earlier uncertain send was rejected; uncertainty is retained without falsely claiming failure or revoking a possibly delivered valid link.

`sent` means provider acceptance, never inbox delivery/read. `retry` means a safe retry is pending. Permanent first-attempt failure releases the unverified hold. Ambiguous outcomes retain the appropriate pending/uncertain state until verification, exhaustion or expiry. Old lease finishes cannot overwrite a newer attempt. The dispatcher returns only aggregate processing counts.

Lost confirmed management links remain an explicit coordinator workflow. There is no public resend/mint endpoint that enumerates contributors or replaces a capability on demand.

## Abuse and shared quota protection

Defaults are zero feature mail budget, mail disabled and no operator-approved quota window. Request, normalized email and feature-global rate limits are committed even when a request is rejected; stale rate rows are cleaned in bounded batches. The memory example cannot use a live mailer.

Live admission/dispatch requires a fresh Resend account-usage snapshot, approved feature allowance and reserved daily/monthly headroom. Unknown, stale, malformed or unavailable usage fails closed. A count-only guard inspects existing notification activity/backlog when its known table is present; it never reads recipients or message bodies. Feature reservations and attempt counts are atomic and deliberately conservative, including carryover across day/month boundaries.

This is **not a globally atomic cap across every sender**: Auth SMTP and the existing notification worker do not take the meal budget lock. Actual provider usage plus explicit reserved headroom protects those senders conservatively; operator monitoring and capacity planning are still required. `GET /usage` requires a full-access Resend key. Do not silently expand an existing key or bypass this guard if that permission is unavailable.

## Verification and release

Focused SQL/PGlite, durable handler, crypto/recovery, native multi-session PostgreSQL and actual local Edge/Auth/API suites are maintained. See the current PR CI results for exact executed counts; authored tests alone are not passed tests. Native/Edge tests own disposable, synthetic stacks and clear inherited connection settings.

Before release: convert the reviewed SQL via the supported CLI migration workflow, obtain backup/apply/runtime/credential approvals, verify the private schema stays unexposed, configure the protected dispatcher and quotas, and verify controlled live email only with separate permission. No deployment or secret setup is implied by this document.

References: [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Resend account usage](https://resend.com/changelog/account-usage-api), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
