# Attendance policy v0.3 — focused enforcement

Policy source: `public/policies/attendance-v03.pdf`. Team decision: current strike totals reset each January 1 (UTC calendar), rather than an inferred kickoff date. Strike and audit rows are retained.

- Meeting controls share the existing 30-minute opening window. Future meetings cannot be closed before that window.
- Rostered Leads use the same personal requests as students. Requests remain bound to `auth.uid()`; no self-review is permitted.
- Excuse review and strike assignment/rescission require an active Mentor or an active, unrevoked Program Manager Team Position. Legacy Admin and other Leads retain their existing meeting-management/read permissions, but do not receive policy-review authority merely from their base role. No global or other-app capabilities change.
- Server check-in now enforces five minutes, including existing meetings whose stored setting was ten. Existing arrivals are not reclassified. New meetings store five minutes.
- All request types show at least 24 hours versus emergency/late notice. Neither timing nor an excuse description automatically approves, denies or assigns strikes.
- Leadership gets a compact dashboard, current-member lookup and current-year searchable strikes. Two strikes flags warning/parent contact; five flags removal. Neither action happens automatically.
- Completed verbal warning/parent contact is explicitly recorded in the existing `public.team_attendance_history` table, with server actor/time and an optional note. Reaching a threshold alone never creates that record.

## Deferred policy automation

Competition classification is not authoritative (`offseason`, `preseason`, `other`; presets are only titles), so one-week competition notice remains reviewer guidance. Weekly full-time/part-time hours, assigned off-day and Saturday compliance remain manual because schedule/participation data is absent. Parent/school confirmation and educational/mental-health judgment remain human review. Mentor roster expansion, automatic removal/contact and notifications are out of scope.

## Database and rollout

`202609300001_attendance_policy_v03.sql` uses the inspected production audit table and installed function signatures. It changes narrow Attendance functions, read policies and the new-meeting grace default; it creates no tables and rewrites no historical records. It does not touch checkout, recurrence, roster-sync functions, Suite Auth or other applications.

Apply this migration once as its single transaction before deploying this frontend (which reads the new policy context). Verify unchanged data fingerprints and unaffected function definitions, plus authenticated context/permissions, without creating production requests or strikes. Deploy Hub through its existing Pages workflow after focused Attendance tests and TypeScript/build pass.

## Validation and rollout status

54 focused Attendance tests pass (17 local database checks and 37 UI/helper checks), including 390px/1440px layouts, self-request identity, reviewer/strike restrictions, revoked/archived/inactive assignments, five-minute grace, notice timing, January 1 filtering, checkout, recurrence, roster sync and audit preservation. Hub TypeScript and production build pass. Browser data are controlled fixtures; no production requests or strikes were created.

Read-only production preflight matched all inspected function definitions, the existing audit table and six read policies. Before migration: 23 meetings, 22 roster snapshots, 22 attendance records, one membership row, one strike and 111 audit records; fingerprints are retained locally for post-application comparison. Physical-correction notes remain in the existing audit table without recording an excuse decision.

Production migration applied on 2026-09-30 after explicit user approval. Post-migration authenticated Mentor/student context and anonymous denial checks passed; the student could read no other member’s attendance. All six Attendance table fingerprints are unchanged. Only the intended existing manage/check-in/roster functions changed; other inspected Attendance functions and the Team Position helper remain unchanged. Hub frontend deployment follows through the existing Pages workflow. No production requests, strikes, warning actions or emails were generated.
