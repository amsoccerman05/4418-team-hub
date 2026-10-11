# Upcoming meeting and required-roster editing

## Scope

Attendance → Calendar → open a meeting → **Edit meeting** edits one upcoming meeting’s title, type, start/end, and required participants. All edits stop at the server-authoritative start time or once attendance is finalized. A repeating schedule consists of independent meetings; only the selected occurrence changes.

Existing active **lead / mentor / admin** roles retain meeting-management authority. A student Program Manager’s request-review capability does not grant meeting editing. Participant eligibility uses the current Attendance predicate, including active Program Managers and Operations Leads with eligible shared roles. No shared role or request-approval capability changes.

## Required participants

- The editor starts from the saved meeting snapshots, including people no longer returned by the eligible roster. Unavailable or inactive snapshot members remain visible and keep their saved required status.
- Checkboxes and **All active / Clear all** change only unlocked people. A person with any submitted request, recorded physical attendance, reviewed decision, or strike (including a rescinded strike) is locked. Use the normal request-review workflow for existing requests; changing a roster cannot substitute for excuse approval.
- The review shows the original and new required counts plus additions/removals. A separate acknowledgment is required, explaining that only this date changes and participants are not automatically notified.
- Changing the required set changes this occurrence to **selected** (or **optional** when empty). This prevents broad active/registered roster sync from restoring a removed person. The existing requirement mode, areas, and selected IDs stay unchanged when the required set is untouched, including title/schedule-only edits.
- Existing snapshot and attendance rows are never deleted. A clean pending row’s default `none` / `not_required` flag follows its requirement; a newly selected eligible participant receives one pending attendance row. Other records, creation metadata, check-in attempts, request/decision content, and strikes remain intact.
- Required-flag changes and additions have attributed old/new audit entries in the existing public history table. Meeting updates and default attendance-flag changes use the existing audit triggers. Any failure rolls back the whole edit.

## Schedule safety

- Before start, recorded attendance, an excuse decision, or any strike locks the schedule. Title/type and other unlocked participants can still be edited.
- A schedule change requires its existing separate acknowledgment. Pending requests retain their original reasons, submission times, and expected arrival/departure times. Leadership is reminded to review whether they still fit the new schedule; notice timing uses the new start.
- Schedule changes close check-in and clear its temporary code. Leadership must reopen check-in during the new window. Roster-only and title/type-only changes preserve the existing check-in state and code.
- Local-time inputs identify the device’s IANA time zone. Nonexistent DST times are rejected; repeated DST times require an explicit offset. Unchanged inputs preserve stored seconds and offset. Overnight meetings have separate start/end dates.

## Backend contract

The original editor is introduced by `20261007033053_attendance_meeting_editing.sql`. The additive `20261011025742_attendance_required_roster_editing.sql` replaces only its guarded private implementation. Applying it does not modify existing meeting, roster, attendance, strike, or history data, permissions, or the public invoker wrapper.

`team_attendance_edit_meeting(p jsonb)` retains `meeting_id`, `version`, `title`, `meeting_type`, `starts_at`, `ends_at`, and `acknowledge_schedule_change`. Roster edits additionally supply all three fields:

- `required_student_ids`: the complete desired distinct UUID list, including preserved locked participants
- `expected_required_student_ids`: the original distinct required UUID list
- `acknowledge_roster_change`: `true`

Other fields are rejected. Lists are bounded and validated; unavailable newly selected or changed participants are rejected. The implementation serializes with existing Attendance management, locks the meeting and live eligibility rows, checks active leadership, and rechecks the start boundary after waiting. The meeting version protects all edits; the expected required set additionally detects roster sync, which does not bump meeting versions. An exact replay of an already-saved complete target is a read-only receipt with no extra audit or mutation.

The UI preserves drafts on failure. **Refresh meeting** fetches state without discarding the draft; **Reload latest meeting** explicitly replaces it. A changed required set or newly locked edited person blocks saving. If the mutation succeeds but the refresh fails, the existing recovery message says the meeting was saved. Cancel/Escape/navigation write nothing.

## Verification and rollout

All fixtures use synthetic data. Coverage includes PostgreSQL authorization/data-preservation tests, model tests, mobile/desktop browser flows, disposable real Auth/PostgREST, and native multi-session races. Run the exact commit’s CI before release; test wiring alone is not a pass.

```sh
npm ci
npm run build
npx playwright install --with-deps chromium
npx playwright test tests/attendance-*.spec.ts --workers=2
npm test
ATTENDANCE_EDITING_PG_BIN=/path/to/postgresql/bin node tests/native/attendance-editing-concurrency.mjs
ATTENDANCE_REQUESTS_INTEGRATION=1 node tests/integration/fabrication-local.mjs --run
```

Apply the reviewed additive migration before deploying the client. Verify the deployed bundle matches the tested commit. Do not edit real meetings, invent an authenticated actor, create student data, or send notifications for QA. Publication, merge/deployment, and production migration application require the user’s release authorization.
