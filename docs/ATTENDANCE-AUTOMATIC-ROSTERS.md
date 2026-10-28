# Automatic missing-roster enrollment

## Behavior

Home and Attendance await `team_attendance_sync_my_rosters()` before fetching meetings. Accepted, confirmed, active Attendance participants are automatically added when they sign in, open either view, or refresh. This is lazy reconciliation at app access, not an Auth/profile trigger or background job. It cannot interrupt invitation acceptance/password setup, and every write has the genuine signed-in actor.

Only missing roster entries in unended draft/open meetings are inserted. Creation already includes all eligible participants; `selected`, `areas`, and `registered` determine who is **required**, not a confidential meeting audience. Future additions follow those exact rules; STEM outreach stays optional. Anyone newly added after a meeting starts is optional to avoid a retrospective required absence/automatic notice. Home can show that current optional meeting without displacing an existing ongoing required meeting or checkout.

Pending/unconfirmed invitations, banned/deleted/anonymous accounts, inactive profiles or Attendance memberships, readonly accounts, and nonparticipant mentors/admins are not enrolled. Existing Program Manager / Operations Lead participation rules are reused. Nonparticipants receive a no-op and retain normal Home access.

Existing roster snapshots—including manual exclusions, optional entries, requests, check-ins, reviews and attempts—are untouched. Registration changes do not silently promote an existing optional row. Closed, finalized and ended meetings and all historical attendance/strikes remain unchanged. The function does not check anybody in, extend/rotate codes, or excuse/mark attendance. Check-in still requires the existing code/window/eligibility rules.

## Security and release

- No RLS, table grants, existing RPCs, Auth configuration, user metadata, or invitation lifecycle changes.
- Public RPC has no target argument; it can enroll only `auth.uid()`. The private helper is not executable by clients. Fixed search paths, existing Attendance serialization, eligibility row locks, and end/status rechecks protect concurrent use.
- DDL migration `20261028001414_attendance_automatic_roster_membership.sql` performs **no record backfill**. Apply only this reviewed migration after explicit production approval, then deploy the matching UI. Never blanket-push the repository's migration history.
- For an immediate affected-user repair, have the genuinely signed-in participant refresh after deployment. Do not forge Auth claims or substitute a profile UUID for a real session. A future administrator backfill would need its own genuine authenticated execution path and authorization.
- Sync errors surface a retry state instead of presenting a false empty calendar. Retries are idempotent. Existing account-generation guards discard late UI responses after sign-out/account changes.

## Verification

Synthetic PGlite tests use production-shaped mandatory-actor audit records and real RLS. Coverage includes accepted vs pending/inactive/banned/deleted/anonymous accounts, self-only access, future active/registered/area/custom/optional rosters, ongoing optional enrollment, ended/closed/finalized exclusions, preserved decisions/attendance, valid-code check-in, repeated requests, and STEM outreach. Browser regressions cover automatic ordering, optional Home visibility, retry, and no accidental check-in. Production authentication is not mocked or impersonated during verification.

Local results: production build (including TypeScript), 243 broad Attendance/database/model checks, the expanded 18-case automatic-roster suite, 11 suite-auth tests, and 7 local-only integration safety guards passed. The broad and focused counts overlap. Browser tests were blocked by unavailable/sandbox-restricted Chromium; native PostgreSQL and real Auth/PostgREST execution require CI because this executor has neither PostgreSQL nor Docker. Both suites are included in the Attendance workflow.

Release state: prepared locally; production migration and UI deployment require exact-commit CI and explicit approval. After release, confirm function/grants exist, verify deployed asset includes the new call, and read aggregate missing-eligible counts after real users refresh. Do not claim students have been enrolled merely because deployment succeeded.
