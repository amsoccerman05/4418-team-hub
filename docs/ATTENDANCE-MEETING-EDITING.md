# Upcoming meeting editing and Attendance help

## Scope

Attendance → Calendar → open a meeting → **Edit meeting** edits one upcoming meeting's title, type, start, and end. All edits stop at the server-authoritative start time, or once attendance is finalized. Recurring creation already makes independent meetings; this action changes only the selected occurrence.

The existing active **lead / mentor / admin** roles retain meeting-management authority. A student Program Manager may review requests under the existing policy but cannot edit meetings. Students can read the **How to use Attendance** tab and its contextual link from meeting details.

The required roster, requirement mode, five-minute grace policy, attendance records, request submissions, excuse decisions, strike rows, creator, and original creation time are preserved. There are no new location, notes, requirement-selection, series-edit, or notification features.

## Schedule safety

- Even before start, a schedule cannot change once physical attendance, an excuse decision, or any strike has been recorded. Title/type may still be corrected before start.
- A schedule change requires acknowledgment. Pending requests keep their original reasons, submission timestamps, and expected arrival/departure timestamps. The editor asks leadership to review whether they fit the new schedule. The existing notice-timing display compares the saved submission time with the new start.
- Schedule changes close check-in and clear its temporary code. Leadership must reopen check-in during the new window. Title/type changes preserve any current code.
- Saving does not email or message attendees. The acknowledgment reminds leadership to communicate the new schedule through its normal team channel.
- Local-time inputs identify the device's IANA time zone. Nonexistent DST times are rejected; repeated DST times require an explicit offset. Unchanged inputs preserve stored seconds and the exact repeated-hour offset. Overnight meetings use separate start and end dates.

## Backend contract

Migration: `20261007033053_attendance_meeting_editing.sql`.

The only new public endpoint is `team_attendance_edit_meeting(p jsonb)`, an invoker wrapper around the guarded private implementation. `p` accepts exactly `meeting_id`, `version`, `title`, `meeting_type`, `starts_at`, `ends_at`, and `acknowledge_schedule_change`. Unsupported keys fail rather than changing other meeting properties.

The private implementation uses the existing Attendance management advisory lock and the selected meeting row lock. It rechecks the authenticated actor's active leadership profile under a share lock. Existing check-in, request, checkout, review, strike, and roster operations use compatible meeting locking. The meeting version rejects a stale different draft; an exact replay is a read-only acknowledgment with no extra audit or mutation.

Existing `team_audit` records old/new values and the actor in the same transaction, excluding code material. An audit failure rolls back the edit. No existing table, history, policy, notification, or roster is rewritten by applying the migration.

The editor preserves a draft on failure. **Refresh meeting** reads the current state without replacing the draft; **Reload latest meeting** explicitly replaces it. If saving succeeds but the subsequent read fails, the message explicitly says the meeting was saved and keeps the form for recovery. Cancel/Escape/navigation perform no write.

## Release status and verification

This is a **local review draft**, not published or deployed. The additive migration has not been applied to the shared project.

Verified on the final local branch:
- TypeScript / production build (the existing large-bundle warning remains).
- 528 browser-free regression tests across 40 isolated files, including seven new PostgreSQL-engine (PGlite) tests and three new date/locking model tests.
- Independent code review of roles, scope, locking, record preservation, retry behavior, guide text, and save/refresh recovery.

Browser tests are written but **not verified in this environment**. The official Chromium download returned an invalid archive; installed Chromium's required local sockets were denied by the execution sandbox, including the supported escalation attempt. The supported cloud browser separately rejected the local preview URL with `ERR_BLOCKED_BY_CLIENT`. Browser tests did not reach the app, so those launcher failures are not product test failures or a passing UI result. No layout or screenshot claim is made.

Run the browser suite in an environment supporting Chromium before release:

```sh
npm ci
npm run build
npx playwright install --with-deps chromium
npx playwright test tests/attendance-ui.spec.ts tests/attendance-editing-model.spec.ts --workers=1
npm test
```

The new UI cases cover mobile/desktop save and help, cancel/Escape/navigation, stale writes and explicit reload, student/Program Manager authority, an open editor crossing the start time, and successful write followed by refresh failure. Existing Attendance browser tests remain in the same suite.

A strictly synthetic interactive preview can be generated with `node scripts/preview-attendance-editing.mjs`. Its output stays under ignored `test-results/`, uses actual Attendance components, intercepts every mock service request, and has a no-network CSP. It is not part of the production bundle and is not proof that browser interactions passed.

Before rollout, obtain approval to publish the branch/PR and apply this exact additive migration. Apply the reviewed migration to the existing shared project before deploying the client. Then verify with authorized accounts that an upcoming meeting can be edited, a student cannot edit it, and the help page opens. Do not create real student records, send messages, or apply production schema changes as part of synthetic QA.
