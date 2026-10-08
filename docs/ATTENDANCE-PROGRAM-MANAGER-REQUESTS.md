# Program Manager attendance requests

## Behavior

An active Program Manager with a `student` or `lead` profile uses **Attendance → My Requests → Report my attendance issue** to submit their own absence, late arrival, or early departure. The selected meeting must include their attendance record. They can update the request before the meeting ends; during a meeting only early-departure requests are accepted. Check-in/out times are independent.

Program Manager is an active team position, not a new profile role. The database checks the active profile, unrevoked assignment, and active `program_manager` position by key. Display names and user-editable metadata are never authority.

Only an active **Mentor** may decide a current student/lead Program Manager's attendance request. Another Program Manager cannot excuse, deny, reset, or mark it Not Required. Self-review remains prohibited. Ordinary students' and leads' requests retain the existing Mentor/Program Manager approval rule. Admin is not implicitly an attendance excuse reviewer, and an Admin with a Program Manager assignment cannot review a student Program Manager's request.

Mentors see the request in **Absence & Schedule Requests**. Approval/denial notifications take the Program Manager back to **My Requests**, which initially shows all of their requests, including decided ones. The team review queue keeps an independent Pending filter. Notifications use the same requester-aware rule at enqueue, current action/visibility, and email-delivery eligibility. Existing queued peer-PM messages are suppressed when the requester is now a Program Manager. No historical decisions, events, or outbox entries are rewritten or replayed. Routing reflects current active assignments; revoking the requester's PM assignment returns that account to ordinary request routing. There is no new email sender or automatic send in this change.

## Additive rollout requirements

This is a local review draft. It has not been published or deployed, and no production migration was applied.

Apply the reviewed migrations in order, after the existing Team Management positions, Attendance Policy v0.3, and Notification Center prerequisites:

1. `20261008032037_attendance_program_manager_mentor_review.sql`
2. `20261008032108_attendance_program_manager_notification_routing.sql`

Deploy the matching frontend only after those migrations. The new policy context fields supply stable requester IDs and the current Mentor capability to the UI; the RPC remains the authorization boundary. The migrations do not alter profile roles, general attendance reads, strike authority, meeting management, or stored attendance history.

Before team rollout, verify a synthetic Program Manager request through real Auth/PostgREST, Mentor approval, and the requester seeing the result. Confirm peer PM review is denied, self-review is denied, and pending notifications are eligible only for Mentors. Check the mobile/desktop browser flows and exact deployment commit.

## Checks

- `npm run build`: TypeScript and Vite build
- `node scripts/test-node-regression.mjs`: isolated local PGlite/model regressions
- `node --test tests/integration/fabrication-safety.test.mjs`: local-stack safety guards
- `npx playwright test tests/attendance-ui.spec.ts --workers=1`: mocked browser flows, including student/lead PMs and Mentor-only review controls
- `ATTENDANCE_REQUESTS_INTEGRATION=1 node tests/integration/fabrication-local.mjs --run`: owned disposable real Supabase Auth/PostgREST stack, requires the pinned CLI and Docker

The PGlite tests use a synthetic `auth.uid()` and cannot establish real Auth/PostgREST behavior. The browser fixture also cannot establish backend permissions. Both real-stack and browser checks must pass in a suitable environment before release; neither has run successfully in this cloud checkout because the pinned Supabase CLI and Docker are absent and Chromium's required socket creation is denied.
