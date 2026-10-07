# Local meal gateway vertical slice

This is executable local domain code, not an enabled production feature. `index.ts`
returns 503, imports no provider/DB SDK, reads no environment credentials, and does
not register a deployment listener. `mock.ts` is for synthetic local tests only.
There is no real email adapter or deployment. The separate injectable
`createPostgresMealGateway` now binds this same HTTP contract to the reviewed SQL
primitives; see [the durable binding report](../../../docs/MEALS-DURABLE-BINDING.md)
for tests, transaction/auth boundaries and remaining enablement gates. The loopback
UI demo still uses its synthetic in-memory repository.

## Boundary

`createMealGateway(options).handle(Request, { ip })` accepts a POST JSON object with
`operation`. The IP is trusted transport metadata; headers such as X-Forwarded-For
are deliberately ignored. If the transport does not supply an IP, all callers
share one conservative rate-limit bucket.

Operations: `list`; `claim` with `ClaimInput` fields; `verify` / `inspect` with
`token`; `edit` with `token, quantity, version`; `cancel` with `token, version`;
`manager`; `save_meal` with `meal: MealDraft`; `cancel_claim` with
`id, version, reason`. Responses are the matching `src/meals/types.ts` DTO, or
`{ error: { code, message } }` with an appropriate HTTP status.

All POST requests require an exact configured Origin. CORS is allowlisted, never
wildcarded. Requests have a 16 KiB streaming body limit, strict JSON content type,
known-field validation, bounded strings and quantities, Saturday-in-timezone validation,
and URL-query rejection.
Responses are no-store and no-referrer. Frontends must use fragment links, erase
the fragment before making requests, and never persist or log bearer capabilities.
Public projection explicitly allowlists fields and contains no parent contact or
claim identity. Coordinator contact access needs an injected authorization callback
on every request; the default is denial. The mock takes an explicit process-local
coordinator bearer from its loopback transport. That is not production authority.

## Capacity and commitment safety

The in-memory repository serializes **all** transactions and rolls back failed
work. This covers item capacity, whole-meal exclusivity, token changes, rate limits,
idempotency, and budget reservations. Pending holds last 15 minutes (or until the
meal, whichever is sooner); lazy expiry is applied before every operation and
releases capacity. Failed mail expires its hold immediately. Pending never means
confirmed. Only one-time email verification on an open meal confirms a contribution.
Closing a date prevents pending verification, while already confirmed adults can
still cancel through their valid private links.

Whole-meal requests require no active item claims. Active whole-meal commitments
cannot have their headcount or slot specifications silently changed. Claimed item
labels, categories, and units are protected. Slots referenced by historical item
contributions cannot be deleted, even after cancellation or expiry. Claimed slots cannot be deleted or
shrunk below reserved quantity. Date/time changes with active commitments require
coordination. Optimistic versions protect edit/cancel/save operations. Meal revisions
also change atomically with claim holds, verification, edits, cancellation, expiry,
and failed-mail release, so an old manager cancellation acknowledgment cannot
silently include a newly arrived or changed contribution. Cancelling
a date with active claims requires a reason and `acknowledge_cancellation: true`;
records remain private history and every capability is revoked. No cancellation
notification is claimed or sent by this draft.

## Private link recovery

Every capability has 256 random bits from Web Crypto and is stored only as a
purpose-separated SHA-256 digest. The initial synthetic email has two links:

- One-time `#verify=` link: expires with the pending hold. Successful verification
  returns a separate 30-minute access token, bounded by the service cutoff.
- Reopenable `#manage=` link: usable only after confirmation; expires at the earlier
  of the meal service time and 90 days after issue. It supports inspect, quantity
  edit, and cancellation of that one claim. Whole-meal edits require coordination.

Closing the browser loses the short session, but the adult can reopen the original
email's private management link. Expired links require coordinator assistance; the
draft does not invent an email resend or credential-recovery path. Cancellation,
expired pending holds, and cancelled dates revoke every token for the claim.
Plaintext tokens exist only in the response or immediate mail object and the
memory-only synthetic mailbox. They are never written to repository records.

## Mail and abuse controls

The default mailer is disabled and the base gateway mail budget is zero. The explicit mock accepts `.invalid` recipients
only and performs no network calls. A claim transaction reserves both a per-IP
limit (12/hour), per-normalized-email limit (4/hour), and a global daily mail budget
(50/day in the explicit local mock). General requests are limited to 120/minute/IP. Production limits require
review for expected team traffic. Failed and uncertain sends still consume the
reserved budget, conservatively protecting shared quota. No shared Auth email
quota is used.

In the memory demo, idempotency is scoped to normalized email + meal + client key,
with a request-body fingerprint and 24-hour expiry. The durable SQL binding retains
expired entries as conservative replay tombstones pending an approved retention
and recovery design. Reusing a key with a changed body is rejected.
Another email cannot receive the first email's receipt or claim. Concurrent replays
may truthfully observe queued → uncertain → sent progression, but never create a
second hold or send attempt. A settled replay returns the known current mail state.

Outbox metadata has `queued`, `sent`, `failed`, or `uncertain`; `sent` means provider
accepted, **never delivered**. Before provider I/O, the attempt is durably marked
uncertain. Exceptions remain uncertain and are never blindly retried. The mock is
provider-idempotent as a second guard. Failed receipts explicitly say unavailable
and have no hold; uncertain receipts explain uncertainty. Outbox records contain
no plaintext links or message body. A crash between claim commit and send leaves
a queued hold that expires; this draft deliberately has no background resend job.

## Before any production binding

- The durable SQL implementation is available in `postgres.ts` and
  `postgres-gateway.ts`; validate its environment/driver integration and keep the
  original memory demo separate. The memory `MealRepository` contract requires
  serializable isolation with safe conflict handling, or a global lock. The durable
  service instead calls the relational SQL primitives directly, preserving their
  per-meal and shared-budget locks. Do not replace either boundary with unrelated
  REST mutations.
- Bind real coordinator authorization to verified server authority and current
  permissions. Never rely on user-editable JWT metadata or the local demo header.
- Review RLS/private-schema grants and role tests, retention, audit fields, bounded
  indexed queries, distributed rate limits, proxy IP trust, and a real outbox
  reconciliation/recovery design before making a live mail adapter.
- Review sender domain, recipient consent, overall quota, and secrets separately.
  No such setup, persistent credentials, live delivery, or deployment is authorized
  or performed by this local slice.

## Verification

`tests/meals-gateway.spec.ts` runs the real Request/Response gateway against the
synthetic transactional repository. It covers privacy projection, expired and
reopened links, concurrency, rollback, idempotency, authorization, cancellation
acknowledgment, immutable commitments, quota reservation, mail failure/uncertainty,
and malformed requests. Run via the root meal logic Playwright configuration.

`tests/meals-postgres.spec.ts` additionally exercises the same Request/Response
contract through the actual SQL primitives, including persistence after disk
close/reopen. Its injected synthetic manager authority does not establish real
Supabase Auth network verification.

Backend strict typecheck (root):

    npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions supabase/functions/team-meals/*.ts

Supabase documentation checked October 7, 2026: [Edge Functions overview](https://supabase.com/docs/guides/functions)
and [changelog](https://supabase.com/changelog). No runtime SDK API is used here.
