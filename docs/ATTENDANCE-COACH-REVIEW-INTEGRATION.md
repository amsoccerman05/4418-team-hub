# Attendance coach request review: real-stack verification

## Run

`ATTENDANCE_REQUESTS_INTEGRATION=1 node tests/integration/fabrication-local.mjs --run`

The runner requires the pinned official Supabase CLI 2.119.0 and a working local Docker daemon. It creates and owns one disposable, loopback-only stack with synthetic `example.invalid` accounts. It never links to a project, accepts a hosted Supabase URL, deploys, uses a Management API, or sends email. The existing Attendance editing suite runs first; the request suite then applies `20261008063138_attendance_coach_request_review.sql`. The final source hashes include that migration and the request test source.

The existing `Check own attendance requests` CI workflow invokes this opt-in suite. Success is reported as `PASS_REAL_SUPABASE_INTEGRATION` only after the real Auth, PostgREST, database assertions, and cleanup succeed. Preparation or preflight alone is not integration success.

## Request authorization matrix

The synthetic suite signs in nineteen distinct real Auth accounts and reuses their issued JWTs while testing current database authority:

- Active mentor-role holders of both `lead_coach_1` and `lead_coach_2` approve and deny ordinary student/lead requests and each supported Program Manager account role.
- Active Program Managers with student, lead, mentor, or admin shared roles approve and deny ordinary student/lead requests.
- Program Managers cannot decide their own or another Program Manager's request, including a mentor-role PM who also holds a lead-coach position.
- An ordinary mentor with a valid JWT cannot approve, deny, reset, or mark a request Not Required. A coach position attached only to a student, lead, admin, or readonly shared role grants no new decision authority.
- Revoking either coach assignment, deactivating either coach position, or deactivating its profile removes decision authority immediately without refreshing the Auth token. The same checks cover a student-role Program Manager's assignment, position, and profile. Combined physical-correction/review payloads cannot bypass these restrictions.
- Authorized reviews preserve physical evidence, increment the row version once, and write one correctly attributed audit update. A fresh request clears the previous review. Denials preserve records and audit history.

The existing request submission, participant eligibility, check-in/out, concurrency, spoofing, validation, and audit-rollback cases remain. Canonical table/role fingerprints and the definitions of the existing Auth, shared-position, role, reader, meeting-manager, and strike-reviewer helpers must remain unchanged. Policy context independently verifies the narrowed `can_review_requests` capability and legacy `can_review` strike capability.

## Explicit coverage boundaries

This disposable real-stack fixture still has the older thirteen-column audit table with nullable `performed_by` and three extra database-actor columns. It does not establish production audit-table parity. The separate `tests/attendance-participation-db.spec.ts` and `tests/attendance-coach-review-db.spec.ts` production-shape fixtures exercise the ten-column public table, `performed_by NOT NULL`, and missing-Auth rejection. That suite uses PGlite and a synthetic Auth function, so it does not establish real Supabase authentication.

Notification Center and Finance prerequisites are absent from this real-stack fixture. Notification recipient selection, live eligibility, and queued-delivery suppression are covered separately in `tests/notification-center-db.spec.ts`; this real-stack suite does not claim notification or email-delivery integration.

## Local verification, October 8, 2026

- Both changed integration modules pass `node --check`.
- All seven `fabrication-safety.test.mjs` checks pass.
- `git diff --check` passes.
- Real-stack preflight is blocked by `spawnSync supabase ENOENT`; Docker is also absent from this executor. No real Auth/PostgREST runtime assertion has run here. The updated suite requires a successful CI run before release.
