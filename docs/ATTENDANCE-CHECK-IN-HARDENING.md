# Attendance check-in hardening

## Scope and preserved behavior

This change keeps six-digit meeting codes, the existing five attempts per
participant per meeting per 15 minutes, and the existing meeting/code lifetime.
It does not change sign-in, CAPTCHA, MFA, leadership roles, student directory
visibility, invitations, offline drafts, or any other suite application's
workflow. It creates no tables, logging stream, polling task, or external service.

The database migration replaces only `public.team_attendance_check_in(uuid,text)`
and restates its existing caller grants. It does not edit historical attendance,
profiles, meeting rosters, counters, strikes, or audit history during deployment.

## Server boundary

- Active attendance participation and meeting-roster membership remain required.
- A read-only probe can reject an already locked-out caller before the shared
  meeting lock. It does not inspect the submitted code or admit any request.
- Requests that might proceed retain meeting → roster member → attendance locks
  and authoritative authorization, meeting, idempotency, and budget checks.
- The current time is refreshed after lock waits so those waits cannot extend
  a code's lifetime or permit a check-in after the meeting ends.
- Missing attendance fails closed. Caller identity always comes from `auth.uid()`.
- Failed guesses return an error envelope rather than raising an exception after
  incrementing the counter; the attempt must commit, not roll back.
- Rotation keeps the existing attempt budget. No client-side cooldown is relied
  upon for security, and clients cannot reset the database counter.

## Response contract

The RPC adds `status` while keeping legacy `message` / `error` fields:

- `checked_in`: a new attendance check-in was recorded.
- `already_recorded`: no new check-in was made. This is an idempotency outcome,
  **not confirmation that a submitted code was valid**.
- `invalid_code`: the attempt was consumed and no check-in was made.
- `rate_limited`: no attempt was consumed; `retry_at` is the server's window end.

Authorization, missing-roster and closed/expired meeting failures retain their
existing PostgreSQL errors. HTTP success alone is not evidence of a valid code.

The frontend understands new outcomes and the two existing success messages,
allowing an additive database-first rollout. Unknown responses fail closed rather
than displaying a success. The existing form and manual retry remain available;
retry information does not add background requests.

## Resource impact

The probe adds a small indexed read to ordinary attempts and avoids the meeting
write-lock path for a caller already known to be locked out. It does not prevent
traffic from reaching Supabase or make rejected requests free. Existing counters
are reused and repeated denied requests create no per-guess rows. No blanket
shared-IP lockout is added, because many attendees can share school Wi-Fi.

## Verification and release

- Pure response tests and synthetic browser tests cover explicit outcomes,
  duplicate submissions, retry feedback, legacy compatibility and unconfirmed
  HTTP-success responses.
- Database regression tests exercise the actual migration with synthetic users.
- Disposable Auth/PostgREST tests cover direct API calls and shared suite
  permission boundaries. They must remain guarded against non-loopback targets.
- Native PostgreSQL multi-session tests cover races and lock waiting.
- Production preflight/postflight compares function definition, grants and
  relevant policies using metadata only. Do not test by changing real student
  attendance, roles or profiles.

Deploy the exact reviewed migration only after tests on the reviewed commit pass,
then publish the compatible frontend and verify the live artifact. Keep the prior
function definition for a bounded rollback if needed; rollback must not reset
attempt counters or alter attendance data.

This is focused hardening, not a conclusion about the reported student's method
or a claim that the entire suite has undergone a penetration test.
