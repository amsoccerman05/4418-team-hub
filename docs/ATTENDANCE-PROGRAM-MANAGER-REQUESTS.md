# Program Manager attendance requests

## Behavior

An active Program Manager, including one retaining a shared `mentor` or `admin` profile for management, uses **Attendance → My Requests → Report my attendance issue** to submit their own absence, late arrival, or early departure. The selected meeting must include their attendance record. They can update the request before the meeting ends; during a meeting only early-departure requests are accepted. Check-in/out times are independent.

Program Manager is an active team position, not a new profile role. Attendance participation is a separate server-derived capability: ordinary active students/leads and active Program Managers participate; ordinary mentors/admins do not. Shared management roles and permissions in Team Hub, Inventory, Pit, Finance, Planning, Fabrication, Outreach, and Volunteer hours are preserved. The database checks the active profile, unrevoked assignment, and active `program_manager` position by key. Display names and user-editable metadata are never authority.

Only another active **mentor-role Lead Coach who is not a Program Manager** may decide a current Program Manager's attendance request. Another Program Manager cannot excuse, deny, reset, or mark it Not Required. Self-review remains prohibited. Other requests may be decided only by an active mentor-role Lead Coach or active Program Manager. Coaching authority is verified by the active, unrevoked `lead_coach_1` or `lead_coach_2` position; a display name is never authority. Ordinary Mentors retain existing meeting, physical-correction, strike, and policy-management permissions, but cannot decide excuses. Admin is not implicitly an attendance excuse reviewer, and an Admin with a Program Manager assignment cannot review a student Program Manager's request.

Lead Coaches and Program Managers see actionable requests in **Absence & Schedule Requests**. Other existing team readers retain read access but no decision controls. Approval/denial notifications take the Program Manager back to **My Requests**, which initially shows all of their requests, including decided ones. The team review queue keeps an independent Pending filter. Notifications use the same requester-aware rule at enqueue, current action/visibility, and email-delivery eligibility. Existing queued review-request messages are suppressed if the recipient no longer qualifies, including ordinary Mentors and peer Program Managers. Owner decision/strike notifications remain intact. The deployed email worker rechecks `team_attendance_delivery_allowed` before preparing/sending each email; queued records are not replayed. No historical decisions, events, or outbox entries are rewritten or replayed. Routing reflects current active assignments; revoking the requester's PM assignment returns that account to ordinary request routing. There is no new email sender or automatic send in this change.

## Additive rollout requirements

This change is tracked in [PR #16](https://github.com/amsoccerman05/4418-team-hub/pull/16). Consult its release record for the current deployment state. The first two routing migrations were applied before the shared-role participation gap was discovered; the follow-up participation migration is additive.

Apply the reviewed migrations in order, after the existing Team Management positions, Attendance Policy v0.3, and Notification Center prerequisites:

1. `20261008032037_attendance_program_manager_mentor_review.sql`
2. `20261008032108_attendance_program_manager_notification_routing.sql`
3. `20261008051847_attendance_program_manager_participation.sql`

Deploy the matching frontend only after those migrations. The new policy context fields supply stable requester IDs and the current Mentor capability to the UI; the RPC remains the authorization boundary. The migrations do not alter shared profile roles, cross-suite permissions, existing strike authority, meeting management, or stored attendance history. Participation changes do not silently recalculate old snapshots. Existing leadership physical-correction and strike powers remain independent of excuse approval.

Before team rollout, verify a synthetic Program Manager request through real Auth/PostgREST, Mentor approval, and the requester seeing the result. Confirm peer PM review is denied, self-review is denied, and pending notifications are eligible only for Mentors. Check the mobile/desktop browser flows and exact deployment commit.

## Checks

- `npm run build`: TypeScript and Vite build
- `node scripts/test-node-regression.mjs`: isolated local PGlite/model regressions
- `node --test tests/integration/fabrication-safety.test.mjs`: local-stack safety guards
- `npx playwright test tests/attendance-ui.spec.ts --workers=1`: mocked browser flows, including student/lead/mentor/admin PMs, scoped roster selection, Lead-Coach-only PM review, and ordinary-Mentor denial without losing correction/strike controls
- `ATTENDANCE_REQUESTS_INTEGRATION=1 node tests/integration/fabrication-local.mjs --run`: owned disposable real Supabase Auth/PostgREST stack, requires the pinned CLI and Docker

The PGlite tests use a synthetic `auth.uid()` and cannot establish real Auth/PostgREST behavior. The browser fixture also cannot establish backend permissions. Both real-stack and browser checks must pass in a suitable environment before release. The approved CI run at `7e8e3fc` passed the real Auth/PostgREST suite, including peer PM denial and Mentor approval. The first full browser run exposed exact-label dropdown locator issues in the new tests; those locators are corrected in this follow-up. Follow the current PR-head checks for final results. Locally, the pinned Supabase CLI and Docker are absent and Chromium's required socket creation is denied.

## Administrative enrollment and forward-only rosters

Attendance `Registered` is team-attendance enrollment only. It does not confirm FIRST registration or school forms, does not change the shared account role, and does not grant access in another app.

The migration itself enrolls nobody and creates no attendance records. New meetings include eligible participants using the existing active/registered/area/selected/optional rules. For existing meetings, use separately authorized enrollment followed by a bounded, audited forward sync. `team_attendance_sync_participant_rosters(student_id, meeting_ids)` accepts only one eligible participant and an explicit list of future, unfinalized broad-roster meetings; it does not synchronize other people. Missing snapshots are added, untouched optional snapshots may be promoted when eligible, and recorded/reviewed data is preserved. Past, finalized, area-specific, selected, and optional meetings cannot be swept into this operation.

Use a genuinely signed-in leadership account for registration and scoped roster changes. Production requires a non-null authenticated audit actor; this change preserves that constraint and never fabricates Auth claims. In **Attendance → Roster**, open the member, save their Attendance enrollment if authorized, then use **Sync this member’s future meetings** to review the exact selected meetings. This calls the member-specific RPC, not the all-member sync. Do not store actual account IDs or meeting lists in this public migration or tests.

PM classification follows the current active position, and self-review is always denied. Revoking/deactivating the position affects future participation and current reviewer eligibility; stored attendance history is retained. Administrative registration remains independent.

### Audit-shape parity

The original disposable fixture used a hardened audit-table variant with extra database-actor columns. Production uses a public history table with `performed_by NOT NULL` and no such columns. The participant SQL suite now explicitly tests the production shape, genuine leadership attribution, and rejection of missing-Auth administrative writes. No production audit columns, nullability, or triggers are changed by this feature.

## Lead Coach request-review restriction

Apply `20261008063138_attendance_coach_request_review.sql` after the participation migration. This introduces the request-only `can_review_requests` context capability while retaining `can_review` for existing strike and policy operations. Request decision controls fail closed if the new capability is missing. The requester-aware predicate is shared by the decision RPC, notification enqueue, inbox visibility/action eligibility, and queued delivery eligibility. No existing request, audit, recipient, account, role, or meeting record is rewritten by the migration.

This correction is a separate release from PR #16. Publication, CI, migration and deployment results must be checked for its own final head. No real request or email is needed to test the synthetic matrix.
