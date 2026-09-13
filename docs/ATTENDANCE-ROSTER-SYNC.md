# Attendance future roster reconciliation

## Cause and model

`team_attendance_manage('create', ...)` copies current active student/lead profiles into `team_meeting_members` and creates their attendance entries once. The batch RPC calls that function for every recurrence occurrence. Registration updates do not revisit these snapshots. Meeting SELECT policies require a student's snapshot row, and request submission requires the corresponding attendance row.

The existing `requirement` field retains roster intent. Migration `202609120008_attendance_roster_sync.sql` adds `active` to its constraint and uses it as the creation RPC fallback. The frontend defaults new meetings/series and non-optional presets to **All active students**, retaining **Registered students only** explicitly. Active means active student/lead profiles, excluding an explicitly inactive Attendance membership; prospective students and profiles without registration metadata qualify. No existing meeting requirement is changed.

There is no persisted recurrence-series ID: a series is an atomic batch of independent meetings. **Sync future rosters** therefore reconciles all future broad-roster meetings, both recurring and standalone. It does not infer series membership from names and adds no series schema.

## Safety and scope

The leadership-only RPC `team_attendance_sync_future_rosters()` shares Attendance's advisory lock and locks each meeting before acting, rechecking that its start is still in the future. Only non-finalized `active`/`registered` meetings qualify. Past, in-progress, finalized, selected/custom, area-based and optional meetings are excluded. No rows are deleted or students made non-required.

Missing eligible students receive a required snapshot and pending attendance entry. Existing non-required entries become required only if attendance is untouched (initial version, no check-in, notice or review). Existing requests/decisions stay unchanged and are counted as preserved for review. Already-required snapshots keep their original metadata. Sync is repeatable without duplicate rows or repeated mutation audit entries. Explicit snapshot audit events use the existing private history/actor machinery; normal attendance audit triggers and RLS remain unchanged.

Automatic reconciliation on shared profile/registration writes is deliberately deferred in V1: it would couple account provisioning and registration transactions to potentially many meeting locks, with different existing lock orders. Run the explicit action after adding/activating students or changing registration. The migration itself performs no roster backfill and installs no profile triggers.

## Rollout

1. Review and manually apply only migration 008 after the existing Attendance requests/recurrence and Team Management V2 migrations. Do not use a blanket migration push.
2. Deploy the matching Hub frontend after the migration; an older backend rejects the new `active` mode. No Edge Function deployment or changes to other apps are needed.
3. As Attendance leadership, review upcoming meeting requirement modes and click **Sync future rosters** once. Existing registered-only meetings stay registered-only. Review the returned added/newly-required/preserved counts and Activity/history; handle existing attendance decisions individually through existing review tools.
4. With an approved student account, verify upcoming broad-roster meetings appear and attendance requests work. Confirm past/finalized/custom snapshots are unchanged. Repeat sync to confirm zero further additions/upgrades.
5. Repeat the explicit sync after future enrollment or eligibility changes. Do not relabel existing selected/custom rosters to make them eligible for broad sync.

Prepared locally only; not applied or deployed by this change.
