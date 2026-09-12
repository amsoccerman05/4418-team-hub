# Team Management and shared positions — local review only

Canonical migration: `supabase/migrations/202609120003_team_management_positions.sql` in Team Hub. Apply once, after the existing Inventory profile/areas schema, Attendance membership table, and **hardened** Finance V1 (private audit storage) are installed. No migration or frontend deployment has been performed for this pass.

## Ownership and compatibility

Hub's `#team-management` route manages existing profiles; it never creates a second account database. Active mentors/admins edit names, active state, broad roles, shared area IDs, existing registration status, and positions. Inviting new Auth users remains an owner operation in Supabase Auth.

The migration revokes direct client UPDATE on `profiles`; `team_manage` becomes the audited editing entry point. Existing profile SELECT policies, identity/last-admin guard, Inventory authorization helpers, area definitions, and realtime publication stay intact. Profile updates use an expected timestamp. Registration updates also compare the previous status/area to reject stale edits. The same profile advisory lock protects last-admin changes. No position grants team administration by itself. Hub also creates new shared areas through the same audited RPC; existing area IDs and stored legacy lead labels are preserved. Inventory reads area leads from active shared profiles and no longer edits legacy lead-name strings. Its isolated local demo and legacy import path remain compatible; existing area definitions are never deleted or renamed in this pass.

Registration stays in `team_attendance_members`; existing Attendance RPCs remain compatible and unchanged. Hub writes that same row, synchronizing its legacy text area with the selected shared `areas` name for tracked members. It does not rewrite historical meeting snapshots or add registration records for untracked members unless a status is explicitly selected. Attendance's existing leadership membership tools remain operational for compatibility; Hub is the canonical suite-wide member editor.

## Positions

`team_positions` is a small extensible directory, initially `lead_coach_1`, `lead_coach_2`, `finance_lead`. New position definitions can be added later by an owner without changing Auth roles. Multiple members can hold a position; multiple positions per member are supported. This migration deliberately imposes no unique office-holder rule that was not specified.

`team_member_positions` records grants and revocations. Reassignment inserts a new row; previous reasons, actors, timestamps, and revoked assignments remain intact. Direct browser writes are denied. Position helpers only answer for the current authenticated user, require an active eligible profile and active position definition, and ignore revoked assignments. `team_private.management_history` stores administrator-only member/position changes.

## Finance rules

Existing persisted slot keys and historical approvals/revision snapshots are unchanged:

- `po_approver` → **Lead Coach Approval**, authorized by Lead Coach 1 OR Lead Coach 2.
- `finance_approver` → **Finance Lead Approval**, authorized by Finance Lead.

The current revision still requires two distinct people, in either order. Removing a position prevents future approvals; it does not revoke or rewrite a decision valid when it was made. A change request still invalidates the revision and edits/resubmission still require new approvals.

Emergency overrides require an active global **mentor/admin**, an explicit reason, and two distinct people. The existing exceptional requester approval is retained only through this audited override. App-specific `finance_admin` does not grant emergency override authority. School submission is independently available to global mentors/admins or explicitly assigned `school_submitter` users. App-specific Finance administration assignments otherwise remain supported.

## Required manual mapping and rollout

1. Review this migration and the three repos' local changes. In particular, confirm the tighter mentor/admin-only override rule and revocation of direct profile UPDATE.
2. Decide the actual holders of Lead Coach 1, Lead Coach 2, and Finance Lead. **No legacy approval capability is automatically mapped.** Existing `finance_assignments` rows remain historical but `finance_approver`/`po_approver` no longer authorize normal approvals after this migration. Even Finance Lead mapping needs explicit confirmation of the intended person.
3. After approval, an owner runs only the new migration in the shared Supabase SQL Editor. Do not rerun Finance V1 or other app migrations.
4. Publish the reviewed Hub UI; an active mentor/admin opens Team Management and assigns positions with reasons. Existing school-submitter and Finance-admin assignments remain in place. During the short migration-to-assignment interval, normal new approvals are unavailable; audited mentor/admin overrides remain available.
5. Publish the reviewed Finance labels/settings and Inventory redirect. Do not deploy Inventory's redirect before Hub's management route is available. No DNS or Suite Auth changes are needed.

The SQL fixture in Finance's tests is an exact copy of the canonical Hub migration, for independent CI. Hub's Finance V1 fixture is an exact copy of Finance's reviewed base migration. When the migration changes before review, update its Finance test fixture byte-for-byte; fixtures are never production migration entry points.
