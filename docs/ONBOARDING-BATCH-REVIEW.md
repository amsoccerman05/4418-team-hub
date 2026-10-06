# Reviewed onboarding batches (staged)

Base: Team Hub main `4aadc3d01e54b503478e418513feefb45eff4de2`.

## Scope

The manager-only Onboarding tab adds a two-column Name/email paste or individual draft rows, explicit per-recipient role/reason/optional attendance choices, a final review acknowledgement, and sequential manual dispatch through the existing `team-invitations` Edge Function. The 20-recipient batch cap is a UI review limit, not an assertion about SMTP capacity.

Account setup and team attendance registration are presented separately. Registration is matched only through the invitation's linked user UUID. It does not indicate FIRST registration or school forms. Service acceptance does not prove inbox delivery or completed setup.

No database migration, Edge Function, authentication setting, SMTP configuration, app permission, workflow, or notification configuration changes are included. No real invitation is needed for verification.

## Safety contract

- A single stable UUID belongs to each recipient draft and survives validation correction and safe retries.
- Editing invalidates that row's reviewed payload. Sending requires an exact reviewed payload and a new acknowledgement after any pause.
- Refresh the authorized team list immediately before starting a batch and reject duplicate members/invitations. Single and batch flows share local uncertain/accepted outcomes.
- One request is in flight at a time. Pause lets that request settle and prevents the next request. Leaving Onboarding or auth revalidation pauses the queue; it never resumes automatically.
- Only the existing server's explicit pre-reservation errors are classified as definitely not sent. A timeout, network error, unrecognized response, mismatched ID, or potentially post-reservation error is locked for review, never automatically resent.
- Success means the server returned the same request UUID and its accepted pending contract. Refresh may reconcile an attempted uncertain UUID with server pending/account-active status; matching email alone is insufficient.
- A monotonic account-identity boundary clears private drafts/editors on account changes and invalidates old send/refresh completions, including switching away and back. Same-user token refresh preserves the paused draft. Dispatch rechecks the actual Team Management URL, verifies the broker session belongs to the reviewed actor, pins that actor's Authorization per request, and cancels pending broker/SDK dispatch on account change, route exit, or unmount. The existing server still authorizes every request; uncertain post-dispatch outcomes remain locked for review.
- Current draft/pause history is in component memory, not localStorage or a remote draft store. Reloading discards it; the directory must be refreshed before preparing another batch.
- Existing account-management and server authorization remain authoritative. UI role options do not add privileges.

## Verification

- Production build and TypeScript check pass using synthetic Supabase configuration.
- 202 integrated non-browser checks pass across existing database/RLS, invitation service, recurrence, public privacy, presentation, onboarding contracts, and personal-attention contracts. This includes 15 deterministic dispatch-boundary regressions using the actual sender, adapter, suite broker, and installed SDK with only synthetic in-memory transport.
- New fixture-only browser cases cover explicit review at 390/768/1440px, duplicates, fresh-roster changes, sequential pause/resume, pause during preflight, uncertain responses, cross-tab single/batch blocking, UUID-only reconciliation, registration linkage, denied student access, and auth refresh during a request.
- Browser execution and visual review remain pending because this environment cannot launch the required Chromium browser. A run that accidentally included one existing browser case reported that executable limitation; it was not an application assertion failure.
- Integration review reproduced and fixed two pre-dispatch races: navigation before the router rendered could start the next recipient, and a delayed broker lookup could select another account’s token. Scope cancellation and actor-bound per-invoke headers cover both broker waits. Independent source review and hook/transport regression checks are not a substitute for browser CI.

## Release plan

1. Keep this branch separate from the held Parents preview. Recheck current main and preserve all concurrent event/UI changes.
2. With approval, publish a draft PR without workflow/deployment changes. Run the existing complete GitHub test/build workflow for the exact head.
3. Review synthetic browser screenshots and interrupted/repeated flows. Fix any failures before requesting merge/deployment approval.
4. Deploy only through the existing approved workflow after explicit release clearance. Verify live assets and public/protected entry points without sending invitations or creating production test accounts.
5. SMTP capacity remains a separate provider/setup decision. Do not hardcode a quota or promise delivery throughput.
