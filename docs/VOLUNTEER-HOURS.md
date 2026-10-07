# Mentor volunteer hours

## Local review draft

This change adds **Attendance → Volunteer hours** for active mentors and admins. It has not been published, deployed, or applied to the shared Supabase database. It contains no historical backfill or inferred hours.

### Mentor instructions

1. Open **Attendance → Volunteer hours** after signing in.
2. Choose an activity. A season, meeting, and notes are optional.
3. Use **Clock in for volunteering** when work begins, then **Clock out from volunteering** when it ends. The server records actual times. No student code or meeting-time window is required.
4. Use **Add past hours** for work already completed. Enter both dates and actual times in the displayed time zone. For overnight work, use the next day as the end date.
5. Use **Correct hours** to fix your own entry, including a forgotten checkout. A reason is required and the previous record stays in **History**.
6. Use **Void entry** for a mistake or duplicate. Voiding removes the hours from totals without deleting the record or its history.
7. Filter by season, activity, or this week, then use **Export my hours CSV** to download the displayed entries. Weeks start Monday and use the entry's start date.

Running timers do not count toward completed totals. A timer open for more than 24 hours is flagged as a missing checkout and requires an actual-time correction. A completed entry is limited to 24 hours; longer work should be recorded in distinct, non-overlapping entries.

This is a separate volunteer record. It never changes student attendance, late/early classification, excuse decisions, or strikes.

### Admin totals

Active admins can open **Team totals** and export an aggregate CSV by mentor, week, activity, and season. Running entries and missing-checkout counts are included as flags, with zero credited hours. Admins do not receive other mentors' private notes or correction histories, and cannot correct or void another person's entry. Mentors do not see each other's hours. Confirm the intended team lead already has the appropriate active admin role before rollout; this change does not grant or change any profile role.

## Data and permission contract

- Additive migration: `supabase/migrations/20261007155231_mentor_volunteer_hours.sql`, generated with Supabase CLI 2.120.0 `migration new`.
- Existing prerequisites: `public.profiles`, `public.planning_seasons`, and `public.team_meetings`.
- Public table `team_volunteer_entries` has RLS-filtered, self-only SELECT for active mentors/admins. No client role receives direct INSERT, UPDATE, DELETE, or TRUNCATE.
- `volunteer_private.history` stores every mutation's before/after snapshot, authenticated actor, timestamp, and correction/void reason. `volunteer_private.receipts` stores request IDs and their payload/response for repeat-safe requests. Both are private, RLS-enabled, and deny client table access.
- Public RPC wrappers are SECURITY INVOKER with a fixed empty search path. Their narrowly scoped SECURITY DEFINER implementations are in the non-exposed `volunteer_private` schema, with explicit grants/revokes and current-profile authorization checks.
- `team_volunteer_context()` returns the current user, server time, admin aggregate permission, and the existing Planning seasons. Archived seasons remain available for recording actual historical work. Season links are labels, not meeting or date-window restrictions.
- `team_volunteer_save(action, p)` accepts `start`, `stop`, `manual`, `correct`, or `void`. Every request requires a UUID request ID. Correction/stop/void requests also require the entry ID and expected version. Entry ownership is always derived from auth, never supplied by the client.
- `team_volunteer_history(entry, before_id)` returns at most 100 own-entry revisions per page. The UI supports loading older pages. Admins cannot read another person's revisions.
- `team_volunteer_summary(selected_season)` returns admin-only aggregates and excludes voided records. It includes historical totals even if the original mentor is now inactive. It does not expose per-entry notes, times, or IDs.
- All writes use a per-user transaction advisory lock, followed by a current-role check with a profile-row share lock. An additional unique partial index guarantees at most one unvoided open timer per user. Overlap checks use half-open timestamp ranges across every season; adjacent entries are permitted.
- A successful repeat with the same request ID returns the original result without another write/audit. Reusing a request ID with a different payload is rejected. The browser retains the exact attempt after a transport failure and exposes **Retry same request**, including inside entry dialogs.
- Actual instants are stored as `timestamptz` with a validated IANA time zone and a derived activity date. The browser rejects daylight-saving gaps and asks which UTC offset to use for a repeated hour. Unchanged timestamps preserve exact seconds when correcting notes or activity only.
- Manual work must end after it starts, be no more than 24 hours long, fall between January 2000 and server now, and not overlap another unvoided entry. Open timers block overlapping manual entries until corrected/stopped/voided. The database never substitutes scheduled meeting length for a missing checkout.
- CSV generation happens in the authorized user's browser. Formula-like cells are escaped. There is no external upload or sharing, and this feature adds no emails, notifications, paid services, or credential handling.

## Verification

Commands:

```sh
npm run build
npx playwright test --config volunteer.playwright.config.ts
VOLUNTEER_PG_BIN=/path/to/postgresql/bin node tests/native/volunteer-hours-concurrency.mjs
npx playwright test --config volunteer.regression.config.ts
```

For a preinstalled compatible Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path. Otherwise use the normal Playwright browser installation.

- Focused PGlite permission/RPC tests cover current-role enforcement, self-only reads, admin-only aggregates, other-person mutation denial, blocked student/lead/readonly/inactive/anonymous accounts, direct-write denial, repeat receipts, stale corrections, immutable history, voiding, overlaps, actual server timestamps, future/duration bounds, missing checkout, DST/overnight time, archived seasons, optional meeting links, and unchanged student attendance/strikes.
- Model tests cover DST gaps/folds, time-zone conversion, exact-second preservation, Monday weeks, finalized-duration calculations, CSV quoting, and spreadsheet formula escaping.
- Browser tests use only synthetic accounts and a disposable PGlite backend reached through an intercepted `.invalid` hostname. They exercise real timer/manual/correct/history/void/download flows, mentor/admin isolation, lost-response retry, cancellation, back navigation, and 390px/1440px overflow.
- The native PostgreSQL harness creates and removes its own fresh cluster and private socket. It covers simultaneous starts, repeat-safe stop/manual requests, overlapping manual-entry races, stale concurrent corrections, and role revocation while a request waits on its lock. It never accepts a production database URL.
- The dedicated `Check volunteer hours` workflow is check-only and does not deploy. Publishing/running this workflow requires the separately authorized repository step.

### Current local verification limits

The final build passed, and the final database/model regression run passed all 396 checks, including 12 volunteer-hours checks. Browser tests could not start: the executor denied Chromium's local socket with `Operation not permitted`, including one elevated retry. No browser test has been counted as passed. No native PostgreSQL binary was present, so the real multi-connection harness is prepared but not run. Full UI appearance/accessibility and real concurrency must pass in a suitable disposable runner before release. Live Supabase advisors and production smoke checks were not run because this draft has not been applied to production.

## Release checklist

1. Obtain approval for the public repository change and separate production migration/deployment.
2. Run the focused browser suite and native concurrency harness in an allowed test environment, inspect desktop/mobile screenshots, and run existing regression checks.
3. Review the additive migration against the actual shared project, including existing profile/season/meeting contracts and the intended admin account. Do not change roles implicitly.
4. Apply only the reviewed new migration after explicit approval, run database security/performance advisors, and deploy the matching UI through the existing authorized flow.
5. With explicitly authorized test accounts, verify mentor self-isolation, student/lead denial, admin aggregate access, and a start/stop/correction flow. Do not create real volunteer work or backfill meeting history as a smoke test.
6. If release is held, leave the live app unchanged. Removing the UI later must not discard entered hours or audit history; preserve data and use a separately reviewed rollback plan.
