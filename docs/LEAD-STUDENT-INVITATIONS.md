# Lead student invitations

## Scope

Active `lead` accounts can invite new ordinary `student` members through the existing single-recipient and reviewed-batch invitation flow. This uses the existing Student role across the shared 4418 suite; it creates no new role or permission set. Leads may select existing active areas and the existing optional Attendance registration choices for the new account.

The lead workspace includes only its own student invitation records and its latest 100 invitation-related audit entries. Open invitation records are never truncated by a count cap. It contains no member directory, other senders' invitations, position assignments, profile snapshots, or general management audit. Account-active status remains derived from the existing authoritative Auth identity projection and is not a promise of password setup or inbox delivery.

Leads cannot invite Lead, Mentor, Admin, or Readonly accounts, modify existing profiles, change account roles/states, manage positions/areas, or call service-only completion. Existing mentor/admin management and invitation capabilities remain unchanged. `team_private.admin()`, manager context RPCs, and management RPCs are unchanged.

## Server enforcement

Migration `20261007013837_lead_student_invitations.sql` changes only:

- `team_invitation_reserve(jsonb)`: reads the current active role from `profiles`; leads require explicit `student`; rejects malformed roles/registration before reservation; actor is always `auth.uid()`; a lead can reconcile only its own stored student request. Reusing a request UUID with changed reviewed details requires review and never sends.
- `team_invitation_finish(uuid, uuid)`: remains service-role-only. Before enabling the quarantined new account it rechecks the inviter's current active role and the stored target role. A lead can complete only a student invitation. The existing new-Auth-invite identity checks, readonly profile requirement, exact registration reconciliation, audit, and idempotency stay intact.
- `team_invitation_context()`: adds an authenticated but actor-authorized, invite-only read projection. Anonymous, student, readonly, and inactive callers are rejected. All functions have fixed empty search paths and explicit grants/revocations.

No existing profile, account role, invitation, or team record is changed by the migration. No email is sent by the migration. No privileged credentials are added to the client.

The Edge Function retains verified caller Auth, fixed callback/origin, one-recipient dispatch, no uncertain Auth retries, and service-only completion. Its new error mappings identify conclusive pre-send denials. Existing clients remain safe; unknown responses still require review.

## Client safeguards

Leads see only Student in both invitation editors. Review validation also rejects a tampered elevated role. Server checks remain authoritative. Batch size remains a 20-recipient review limit, not a provider quota. Sending remains sequential, requires recipient/role review, and stops on rejection, rate-limit responses, or uncertain outcomes. There is no automatic resend.

UID changes and same-UID role/active-permission changes invalidate the previous response scope and clear private invitation drafts/editors. Same-role token refresh preserves paused drafts. Stale manager-context responses cannot populate the lead projection, including when the new context load fails.

## Verification and release

All tests use disposable databases or synthetic intercepted endpoints. Never send a production test invitation or create a production test account for verification.

Local verification: build/typecheck passed; 463 browser-free tests passed across 34 isolated files, plus 5 permission-boundary component-hook tests passed separately. The aggregate runner automatically includes that new hook file on subsequent runs.

Local checks:

- `npm run build` (includes strict source TypeScript check)
- `node scripts/test-node-regression.mjs`
- `npx playwright test tests/lead-invitations-ui.spec.ts tests/team-management-ui.spec.ts tests/onboarding-ui.spec.ts tests/team-directory-ui.spec.ts --config=lead-invitations.playwright.config.ts --workers=1`

The focused database cases cover allowed lead-to-student provisioning, role/metadata tampering, inactive and anonymous callers, manager isolation, own-record projection, UUID/payload/email replay, service-only completion, inviter revocation/demotion, quarantine, audit, and more than 100 unresolved records. The real-component hook cases cover authorization-transition response ordering and same-role draft preservation. Existing invitation/provider handling and manager contracts remain under regression coverage.

This draft is not deployed. Browser test execution is blocked in the current local execution environment: Chromium exits before test steps because its process socket is prohibited, including after an approved outside-sandbox launch attempt. The synthetic mobile/desktop UI tests are prepared for the repository's normal Chromium CI. Passing node/hook tests does not substitute for browser/visual verification.

Release requires explicit approval to publish the source and to apply the permission expansion to the shared Supabase project and live Team Hub. After approval:

1. Publish a draft PR and run the complete existing CI for its exact head. Resolve any browser/visual or other failures before release.
2. Recheck current main and deployed invitation function/database definitions to avoid overwriting concurrent changes.
3. Deploy the backwards-compatible `team-invitations` Edge Function error mappings, then apply the reviewed additive migration. Verify function definitions, grants, and role boundaries without changing production members or sending email.
4. Merge/deploy the reviewed frontend through the existing workflow only with release approval. Verify the expected source/assets are live.

A rollback should first remove lead navigation/client affordances, then restore the prior reserve/finish authorization and revoke the new context RPC. Preserve invitation/audit records, accounts already created, and all existing registration history. Do not delete accounts or audit data as rollback.
