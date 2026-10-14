# Attendance checkout grace

Existing checked-in active participants may record their own departure using server time until, but not including, 30 minutes after the scheduled end. This narrow operation also works after leadership completes attendance. New check-ins and other student edits remain locked under the existing rules.

Departures before the scheduled end remain Left Early. At or after scheduled end, Present/Late remains unchanged. The original arrival, excuse request, strikes, finalization state, code controls, and all other attendees remain unchanged. Duplicate retries preserve the first departure even after cutoff. Missing departures are never inferred or backfilled.

Leadership sees an outstanding-departure warning before completion. Calendar checkout stays visible through the grace period. After cutoff, corrections still require leadership and the existing audit process.

Migration: `20261014051116_attendance_checkout_grace.sql`. It replaces only `team_attendance_check_out(uuid)` and updates no existing rows or grants. Apply before publishing the UI. Database coverage includes finalized status, boundary times, rejected unauthorized callers, repeat calls and audit rollback. Browser coverage uses synthetic intercepted data at 390px and 1440px.
