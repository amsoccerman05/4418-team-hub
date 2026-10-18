# Attendance and Planning write-boundary fixes

Prepared against Team Hub `6f8b7b92eb847a6e840efa2285fba0bb14db1437`. These changes are for review; no hosted database, production setting, or deployment was changed.

## Attendance compatibility endpoint

`20261018051317_attendance_legacy_notice_validation.sql` replaces only `team_attendance_notice(uuid,text)`. Existing authenticated callers retain the same signature and first-notice-only behavior. A legacy untyped notice is submitted as an `absent` request through `team_attendance_request(jsonb)`, which is the single authoritative validation and write path.

- Both meeting and attendance rows are locked in the existing meeting-first order. The current request RPC rechecks participant eligibility and wall-clock time after those locks have been acquired.
- Before the meeting, a first notice remains valid and creates one typed, pending absence request with the normal audit and version increment.
- At or after the meeting start, an untyped absence notice is rejected. During a meeting, the current RPC still accepts valid explicit early-departure requests with a future expected time.
- Ended meetings are rejected even when they have not been finalized. Finalized meetings and optional STEM outreach are also rejected.
- A prior notice cannot be replaced through the legacy endpoint. Current clients retain the existing version-checked correction path.
- Existing profile, roster, reason, function grants, physical attendance and strike policy remain intact. No records are rewritten by the migration.

## Planning current writer check

`20261018051320_planning_current_writer_guard.sql` replaces only `planning_save(text,jsonb)`, adding a current active-profile role check at its mutation entry. Eligible base roles are `student`, `lead`, `mentor` and `admin`; the existing manager/assignment checks still decide which operations each writer may perform.

An active `readonly` profile cannot comment, modify a retained assigned task, create or update its checklist, or use retained leadership assignments to write. An inactive profile is still rejected. Active readonly accounts retain their existing `planning_context`, `planning_my_work_context` and `planning_task_detail` access. No assignment is deleted, no read helper is tightened, and no new table/function privilege is granted.

## Regression checks

The repository's existing Playwright/PGlite tests load both new migrations in their corresponding suites:

```sh
npm run typecheck
npx playwright test tests/attendance-stem-outreach-db.spec.ts tests/planning-db.spec.ts tests/planning-owners-db.spec.ts --workers=2
npx playwright test tests/attendance-*.spec.ts tests/planning-*.spec.ts --workers=2
```

New negative tests cover ended/non-finalized legacy notices, finalized and start/end boundaries, repeat notices, invalid/inactive/readonly/anonymous callers, readonly comments without assignment, retained assignment and position after demotion, and inactive Planning writes. Positive controls cover first-notice audit/version behavior, current early-departure and amended late-arrival requests, readonly reads, and student/lead/mentor/admin task/checklist/comment writes. Existing outreach, manager authority, version, direct-table permission and assignment tests continue to run.

These use synthetic in-memory PostgreSQL and mocked authentication; they do not establish deployed state or real lock-contention behavior. The normal PR workflows are the next verification gate, including disposable real-Auth/PostgREST checks where configured. Deployment remains a separate decision.

## Required rollout review

1. Verify the deployed function definitions, function ACLs, applied migration versions and relation shapes before approving application. The Attendance wrapper expects the latest `team_attendance_request(jsonb)` contract from the STEM outreach migration; Planning expects the multi-assignee `planning_save` contract.
2. Attendance history has a pre-existing repository/production-shape mismatch: the original migration creates a redacting view, while later migrations and tests expect a public table. Tests explicitly adapt that fixture. These migrations do not repair that historical mismatch, and clean full migration replay is not proof of the deployed schema.
3. Apply only the two reviewed migrations through the normal separately authorized deployment process. Do not rerun old setup migrations, reset the shared database, or change unrelated Finance, profile, RLS, authentication or storage configuration.
4. Verify function ACLs and fixed search paths remain unchanged, then smoke-test a legitimate pre-meeting request and assigned writer, plus ended legacy notice and readonly denials, using designated synthetic accounts.
5. If an unexpected dependency or schema mismatch is found, stop rollout and review it. Reverting to either previous function body restores the security defect, so prefer a reviewed forward correction over silently restoring the vulnerable implementation.
