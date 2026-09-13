# Team Management V2 — local review and manual rollout

Rollout: migration 007 was applied by the operator; `team-invitations` version 1 is deployed. The Hub frontend uses the existing Pages workflow.

## Scope and data preservation

Hub only. The V1 management RPC remains available. V2 adds manager-only context/mutation RPCs, four position metadata columns, and a private invitation ledger. It preserves IDs, stable role/position keys, existing RLS, all position assignments/revocations, and all Finance, Inventory, Pit and announcement references. Existing rows are not deleted. Position display names may change; `lead_coach_1`, `lead_coach_2`, and `finance_lead` retain their authorization meaning. Their deactivation intentionally suspends future position-based eligibility; historical decisions remain unchanged. New positions carry no permission mapping.

Area rename retains ID/slug. It updates only current Attendance roster labels where the profile points to that area and the current label still equals the old name. Meeting membership snapshots and historical Attendance rows are never updated. Archive/reactivate changes only the area's availability for future selection. Existing linked records remain readable under their existing policies.

### Why merge/deletion are deferred

Reference audit: Inventory `profiles.primary_area_id`, `inventory_items.area_id`, `locations.area_id`, and historical `inventory_transactions.area_id`; Finance PO `area_id` plus immutable revision/audit JSON; announcements and email events targeting areas; Attendance current roster labels and immutable meeting membership snapshots. A generic merge would either rewrite historical ownership or leave conflicting current/historical semantics. V2 explicitly rejects merge/delete operations. No Auth user, position, or area hard-delete UI/API is provided. Counts on Areas are profile counts (including inactive members); Inventory counts are not added.

## Invitations and email access

The browser sends its existing Hub session JWT to `team-invitations`. The handler validates it through Auth `/user`; the reservation RPC independently requires an active mentor/admin. Only the Edge Function reads `SUPABASE_SERVICE_ROLE_KEY` and calls the privileged [Supabase Auth invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail). Redirect is fixed to `https://team.frc4418.org/?password-reset=1`; no caller-supplied redirect is accepted. Existing Auth mail configuration/templates are reused; this does not use or change the notification worker.

The reservation stores normalized email, requested initial profile values, server-derived actor and reason. UUID request IDs and unique emails prevent repeated HTTP calls from sending a second invitation. Existing Auth accounts are rejected rather than overwritten. A narrow profile-insert trigger keeps newly invited profiles inactive until provisioning succeeds. Completion verifies the newly-created Auth identity/email/invitation marker and manager's current authority, then atomically sets role/area/registration, activates the profile, and records its audit entry. Metadata never determines role authority: values come only from the authorized private reservation. Positions are assigned afterward through the existing audited member editor.

Manager context joins only email from Auth, plus a pending/accepted/review state for tracked invitations. It exposes no tokens, raw Auth rows, or privileged credentials. Auth email takes precedence over possibly stale profile email. The ledger has RLS with no browser table access. Failed or interrupted requests remain inactive and require review; no automatic resend occurs. An uncompleted reservation older than two minutes displays Needs review. Accepted means Auth has recorded a sign-in; it does not prove the recipient finished password setup.

Resend and link cancellation are intentionally not exposed: Auth email sending and profile provisioning cannot form a single transaction. Deactivating an invited member blocks suite access under existing policies but does not revoke an Auth invitation link. Historical accounts are deactivated, never deleted.

## Review/reconciliation

If an invite reports Needs review, do not send another request or delete its Auth user. An administrator should inspect the private ledger and Auth result without copying tokens. If the matching Auth user was created, server-only `team_invitation_finish(invitation_id, invited_user)` can safely finish a processing/review reservation after confirming the initiating manager is still active and the area is valid. Identity binding and idempotency are rechecked; this operation sends no email. If no Auth user was created, leave the failed reservation for review; safe resend tooling is deferred. A crash before failure recording can leave Processing until the two-minute review projection. Existing successful accounts are unaffected.

## Exact manual rollout

1. Review `supabase/migrations/202609120007_team_management_v2.sql` against the production schema after `202609120006_team_communications.sql`. Retain a normal database backup and baseline member/area/history counts for comparison. Apply this **one file** in Supabase SQL Editor; do not run a blanket migration push.
2. Confirm the existing Auth invite mailer/template works and permits the exact Hub callback `https://team.frc4418.org/?password-reset=1`. Preserve all existing redirect entries. No new Resend or notification secrets are required. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` must be available as server-injected Edge Function settings; never put the service key into Vite.
3. From the Hub repository deploy only `supabase functions deploy team-invitations --project-ref tuxwavmjvjfhmaddchtr`. Its config disables gateway JWT verification because the handler validates the caller via Auth and the manager-only RPC. Verify a missing/invalid bearer token is rejected without reserving/sending an invitation.
4. Run `npm run build` and `npm test`; commit/review only the Hub V2 files, then publish the Hub frontend through its existing Pages workflow. Do not deploy other repositories or notification functions.
5. With a real mentor/admin account, verify roster emails, positions, member counts and historical baseline counts. Use one explicitly approved test email to verify invitation → Hub password setup → expected initial role/area/registration. Re-submit the same request ID only to confirm it does not send again. Verify a student is denied directory/invite/mutation RPCs. Assign positions after creation; test deactivation/reactivation using the test account, never the final manager. Confirm desktop/mobile dialogs and unchanged Finance approval eligibility.

Real-account authorization and one approved invitation/password-setup round trip remain manual verification. No real invitation email was sent during automated rollout checks.
