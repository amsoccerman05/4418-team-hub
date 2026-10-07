# Saturday meals — disabled runtime draft

The implementation is published in [draft PR #15](https://github.com/amsoccerman05/4418-team-hub/pull/15), including runtime commit `d7a02c7`. It has not been deployed, connected to production, or used with actual families. It does not modify the existing KCMT page/form or the separately held year-round parent hub. The latest evidence is recorded in [the verification report](MEALS-VERIFICATION.md) and [CI run 37678831155](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37678831155).

## Review locally

Use Node 24 and `npm ci`, then `npm run dev:meals`.

- Parent page: `http://127.0.0.1:4430/meals.html`
- Synthetic coordinator preview: `http://127.0.0.1:4430/meals-manager.html`
- Captured mock messages: `http://127.0.0.1:4432/__demo/mailbox`

The preview binds only to literal loopback, overwrites production client configuration, accepts only `.invalid` email recipients, keeps data in memory, and never sends email. Restarting resets it. The manager preview is deliberately excluded from the production build inputs. `node scripts/preview-meals.mjs` generates a self-contained static design preview at `review/meal-parent-preview.html`; its buttons are illustrative and do not submit anything. Use the private link from the captured test message to confirm a synthetic claim. Test tokens are random and exist only within this disposable preview. No production credential is created.

Normal builds have no meal API URL by default and fail closed. The intended authenticated manager location is `/#meals`; only existing active mentor/admin authority is allowed server-side. Choosing a dedicated coordinator permission remains a release decision.

## Scope

- Flexible meal dates, meal times/timezones, expected headcounts, and main/side/drink/supply/other slots with quantities.
- Public coverage only. Adult contributor name and email stay private to the coordinator; no student roster, individual dietary restrictions, phone numbers, financial hardship records, or payment handling.
- Accountless claim with short pending verification hold. Email verification confirms the commitment; an unverified request is not a confirmed signup.
- Private edit/cancel capability restricted to one claim, expiring/revocable with hash-only capability lookup. Short-lived delivery recovery uses an authenticated encrypted envelope. URL fragments are stripped before network work, no browser persistence or analytics.
- Whole-meal commitment only when it does not conflict with existing active contributions. Otherwise the page directs coordination; no other contributions are silently replaced.
- Explicit mail states and stale-write/capacity protection. Cancelling a date preserves contribution records and requires coordinator follow-through; the draft does not pretend anyone has been notified.

## Existing infrastructure inspected

Repository `docs/NOTIFICATION-CENTER-V1.md` records the shared existing notification route as Finance history → notification outbox → `finance-notifications` worker → Resend. `supabase/functions/team-invitations/index.ts` uses the existing Supabase Auth administrative invitation API; it does not provide a general-purpose parent-email transport. No secrets or SMTP account settings were read or changed for this draft.

Meal signups do not create a Team Hub/Auth account. Reusing account invitations for meal signups would grant the wrong semantics and add unnecessary account/quota load. The loopback demo uses mock/disabled mail. The production-capable Deno runtime, pooled PostgreSQL adapter, authoritative Auth verifier, real Resend adapter, authenticated recovery worker and immutable encrypted delivery envelopes are implemented. Runtime, live mail, dispatch and SQL budget activation remain independently off by default. Configuration and production deployment still require separate approval; see [the runtime guide](MEALS-RUNTIME.md).

The reported shared Free-plan mail limit is a deployment constraint, not a per-feature guaranteed allowance. Before enabling live mail, verify the current provider quota and reserve capacity for existing mail traffic. The implemented guard reads fresh Resend account daily/monthly usage, requires time-limited quota approval and reserved headroom, and uses atomic SQL feature budgets, delivery leases, and distributed request/email/IP limits. Missing usage or insufficient key access fails closed. Other independent senders do not share the meal transaction lock, so approved reserves and operational monitoring remain essential. Any additional challenge flow appropriate to the public deployment must be reviewed separately.

Official references checked 2026-10-07:
- [Supabase custom SMTP and limits](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

Provider acceptance is `sent`, not delivered/read. An uncertain send must be reconciled or retried only with the same frozen provider request/key inside its supported window. Never generate a new email or token silently after uncertainty. The outbox stores authenticated encrypted delivery material, not plaintext reusable URLs. Recovery reuses the original provider bytes/key; terminal outcomes and expiry purge the envelope. Production wrapping-key/worker-secret setup and scheduled dispatch still need approval. No actual mailbox delivery is claimed.

## Before production activation

1. Review the parent and coordinator experience, decide coordinator role scope, set the actual dates/headcounts, and approve public generic guidance.
2. Review the implemented runtime/database/provider binding and complete approved configuration for exact origins, verified proxy handling if used, quota reserves, retention, wrapping key and authenticated recovery schedule. Cancellation communication remains a coordinator workflow; no automatic cancellation email is claimed.
3. Retain the passing browser, 17-group native PostgreSQL and five-group real Auth/API evidence. Fix and rerun the actual served Deno Edge startup smoke, whose runtime now starts but database request path still returns HTTP 503; recheck all affected tests on the exact candidate.
4. Public draft PR publication and synthetic CI are approved and have run in PR #15. Production schema/runtime/secret changes, merge/deployment, and controlled live email tests still need separate authorization.
5. Recheck production dependencies and create an approved fresh backup before an additive migration. Keep the existing KCMT form and held parent hub untouched.

## Verification

See [the verification report](MEALS-VERIFICATION.md): 141 meal logic tests, 17 native PostgreSQL groups, browser/static coverage and five real Auth/API groups passed for the published runtime source. Deno generated the genuine transitive dependency lock in CI. Parent/claim/coordinator screenshots were reviewed. The [diagnostic CI run](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37681291197) confirms that the driver loads and the runtime reaches ready. Actual HTTP listing still returns 503 from the database path, so the served integration remains unverified while safe connection/query diagnostics narrow the cause. Provider acceptance and actual inbox delivery remain distinct, and no live delivery test has occurred.
