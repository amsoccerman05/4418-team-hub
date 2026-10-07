# Saturday meals — local draft

This draft is based on Team Hub main `8b3f9a7`. It has not been published, connected to production, or used with actual families. It does not modify the existing KCMT page/form or the separately held year-round parent hub.

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
- Private edit/cancel capability restricted to one claim, expiring/revocable and hash-at-rest. URL fragments are stripped before network work, no browser persistence or analytics.
- Whole-meal commitment only when it does not conflict with existing active contributions. Otherwise the page directs coordination; no other contributions are silently replaced.
- Explicit mail states and stale-write/capacity protection. Cancelling a date preserves contribution records and requires coordinator follow-through; the draft does not pretend anyone has been notified.

## Existing infrastructure inspected

Repository `docs/NOTIFICATION-CENTER-V1.md` records the shared existing notification route as Finance history → notification outbox → `finance-notifications` worker → Resend. `supabase/functions/team-invitations/index.ts` uses the existing Supabase Auth administrative invitation API; it does not provide a general-purpose parent-email transport. No secrets or SMTP account settings were read or changed for this draft.

Meal signups do not create a Team Hub/Auth account. Reusing account invitations for meal signups would grant the wrong semantics and add unnecessary account/quota load. The local email adapter is mock/disabled. A reviewed live transport and durable database binding are still required.

The reported shared Free-plan mail limit is a deployment constraint, not a per-feature guaranteed allowance. Before enabling live mail, verify the current provider quota and remaining daily budget, reserve capacity for existing authentication/notification traffic, and add global atomic delivery-budget accounting plus a challenge/abuse control appropriate to a public form. The local limits demonstrate the boundaries but cannot prove distributed production abuse resistance.

Official references checked 2026-10-07:
- [Supabase custom SMTP and limits](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

Provider acceptance is `sent`, not delivered/read. An uncertain send must be reconciled or retried only with the same frozen provider request/key inside its supported window. Never generate a new email or token silently after uncertainty. The outbox must not hold plaintext reusable token URLs; durable encrypted delivery material needs separately approved secret/access setup and review.

## Before any publication

1. Review the parent and coordinator experience, decide coordinator role scope, set the actual dates/headcounts, and approve public generic guidance.
2. Complete durable gateway/database binding and live email transport, external-origin allowlists, trusted proxy IP handling, abuse protection, quota isolation, revocation/recovery, retention and cancellation communication workflows.
3. Run the full browser suite at phone/desktop sizes and native multi-session database races. Run real Auth/API isolation tests in an isolated secretless stack, then security review the exact release diff.
4. Obtain separate authorization for a public repository push/PR, production schema/runtime/secret changes, and any controlled email delivery tests. No such actions are part of this local draft.
5. Recheck production dependencies and create an approved fresh backup before an additive migration. Keep the existing KCMT form and held parent hub untouched.

## Verification

See [the final verification report](MEALS-VERIFICATION.md). A passing pure handler/database test is not a claim that the unbound production gateway or real email delivery works. Local browser execution may be blocked by the runner; that stage must be explicitly reported as unverified.
