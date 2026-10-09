# Roster sync during an active meeting

Roster sync includes future and in-progress meetings until the scheduled end, provided the meeting is still Draft or Open and requires active or registered participants. Closed, finalized, ended, selected-member, area-specific and optional meetings are excluded. Both the all-member control and the member-scoped control use the same eligibility boundary.

## What changes

- The existing `team_attendance_sync_future_rosters()` RPC name is retained so previously deployed clients can use the backend fix immediately.
- Member-scoped sync still requires one explicitly selected participant and 1–52 explicitly selected meeting IDs. All IDs are preflighted atomically.
- Missing eligible participants receive an audited required roster row and a pending attendance row. Only completely untouched optional attendance can be promoted to required.
- Existing attendance, notices, reviews, check-in timestamps, strikes and historical rosters are preserved. The migration does not synchronize or backfill any records by itself.
- Student meeting visibility remains protected by the existing own-roster RLS rule. Students use Refresh after a coach syncs their roster.
- Roster sync does not open check-in, extend an expired code, or change the five-minute late threshold. A coach must open or rotate a code normally. A student checking in more than five minutes after the meeting starts is still marked Late.

## Migration and compatibility

Apply `supabase/migrations/20261008234849_attendance_active_meeting_roster_sync.sql` only through the authorized release process. It replaces two existing sync function bodies and retains all authenticated/manager checks and existing function grants. It does not change tables, RLS policies, Auth helpers, request reviewers or audit schema.

The production-compatible audit shape is the existing public ten-column `team_attendance_history` table with `performed_by NOT NULL`. There is no missing-actor fallback or fabricated identity. The preserved public scoped wrapper requires the signed-in manager's actual Auth identity.

## Verification

`tests/attendance-active-roster-db.spec.ts` first reproduces the old failure and then applies this migration. Its isolated PGlite/PostgreSQL fixture exercises:

- Bulk and member-scoped sync making an ongoing meeting visible through student RLS
- Own-identity check-in, late classification, repeat-call idempotency and genuine audit attribution
- Future/ongoing eligibility and closed/finalized/ended/custom-roster exclusions
- Active profile and registered-membership requirements
- Byte-for-byte preservation of existing meeting, attendance, roster and strike records
- Protection of previously requested, reviewed or checked-in optional entries
- Unchanged code expiry, attempt limits, closed check-in and scheduled-end enforcement
- Unchanged Auth, RLS, reviewer functions and production audit schema; denied anonymous, student, inactive and missing-Auth mutations

The model/browser tests cover both 390px and 1440px flows, explicit ongoing-meeting selection, preserved selection after rejection, end-time revalidation and student Refresh. Browser tests must run in a browser-capable environment; PGlite uses synthetic `auth.uid()` and is not a real Supabase Auth session test.

`tests/integration/attendance-active-roster-stack.spec.mjs` runs last in the existing `ATTENDANCE_REQUESTS_INTEGRATION=1` CI route. It applies this migration in the owned disposable Supabase stack, then verifies genuine signup/login sessions, PostgREST/RLS visibility, both sync paths, own-identity late check-in, code validation, idempotency, denial cases and authenticated audit attribution. Before these checks only, it resets earlier synthetic audit rows and converts the disposable audit table to the production ten-column/NOT NULL shape; production data is never part of this fixture. Local syntax and safety guards can pass without Docker, but real execution must pass in CI.

## Release smoke test

After the authorized migration and frontend deploy, an authenticated manager can sync the intended meeting/member, then the affected student can Refresh Attendance and verify that the meeting appears. Student check-in requires a valid currently open code and records the actual server-time attendance status. Do not create production test students, invoke roster sync, rotate a code or record attendance solely for verification without separate authorization. Use the owned disposable Supabase stack for synthetic real-Auth/PostgREST checks when that runtime is available.
