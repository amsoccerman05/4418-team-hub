# Operations Lead attendance participation

An active Operations Lead may participate in Attendance while keeping a shared `admin` or `mentor` profile role. The existing server-derived `can_participate` capability already drives check-in/out and My Requests in the deployed frontend.

Apply `20261010144421_attendance_operations_lead_participation.sql` after the current Attendance participation, coach-review, active-roster, and automatic-absence migrations. It replaces only the private participant predicate. Student/lead behavior and Program Manager eligibility are unchanged. An unrevoked `operations_lead` assignment and active position/profile are required; readonly, inactive, revoked, unrelated mentor/admin accounts remain excluded. Display names and user metadata are never authority.

The migration changes no profiles, membership, rosters, attendance, history, strikes, reviewer rules, or cross-suite permissions. It does not grant request-review permission or allow self-review. As with any participant, future meetings may include eligible Operations Leads under existing roster rules.

## Existing meetings

A separately authorized leader must use **Attendance → Roster → the member → Sync this member’s meetings**. Explicitly select only the approved meeting(s); the UI initially selects all eligible meetings. Broad active-member meetings do not require Registered enrollment. Never change enrollment unless separately authorized. This creates pending, required attendance through the existing audited RPC. It does not mark the person present or check them in. The participant then checks themselves in using a current code. Existing late-arrival rules still apply; any correction of an actual arrival time needs its own authorization and supporting facts.

Use a genuine signed-in leader, never fabricated Auth claims or an invented audit actor. Closed, ended, finalized, custom, area, and optional meetings remain outside scoped sync.

## Verification

- `tests/attendance-operations-lead-db.spec.ts`: synthetic isolated PostgreSQL permission matrix, unchanged data/functions, explicit one-meeting sync, check-in/out, revocation, self-review rejection, private helper ACLs
- `tests/attendance-ui.spec.ts`: admin Operations Lead personal-request and self-check-in flows at mobile/desktop widths, preserving management controls and other attendance
- Disposable real Auth/PostgREST Operations Lead suite in the existing local integration harness
- Existing attendance regression suites, production build, and exact-commit GitHub CI before release

No real account identifiers or check-in codes belong in this document, migration, tests, or PR.
