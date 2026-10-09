# Automatic absence strikes

## Scope

Newly completed meetings opt into one automatic `Unexcused Absence` strike per required, unexcused absence. Existing finalized meetings remain outside this policy, including when their records are later reviewed or corrected. The migration does not backfill strikes or finalize meetings.

The required meeting-roster snapshot is authoritative. A required prospective participant is included; an optional or not-required record is excluded. Finalization marks required pending attendance absent as before. Present, late, and early-departure records receive no automatic absence strike. Approved excuses and pending excuse requests receive none. A pending request receives its strike only if a later authorized review leaves the required absence unexcused.

A later excuse approval, not-required decision, or correction away from absent rescinds only the automatic strike, with the acting user's identity and existing audit history. Manual strike rows remain untouched. Any previous automatic absence strike or manual `Unexcused Absence` decision, including a rescinded one, prevents another automatic strike for the same attendance incident. A rescinded automatic strike is not silently recreated; leadership may explicitly assign a reviewed replacement. While an automatic absence strike is active, the manual form cannot add a duplicate absence strike. Other manual categories retain their existing behavior.

## Safety and presentation

Before completion, leadership sees candidate names, the exact strike count, and pending requests that will wait for review. The RPC checks the count and exact attendance IDs under the existing management/meeting locks. Missing or stale previews reject atomically and require refresh. Old clients without the preview fail safely.

`team_meetings.auto_absence_strikes_enabled` starts false and changes only during a new finalization. `team_attendance_strikes.source` identifies manual versus automatic records. A partial unique index permits at most one automatic row per attendance incident, including after rescission. The private reconciliation helper is not client-callable. Existing RLS, reviewer authority, authenticated human attribution, annual totals, and audit table shape stay unchanged.

Normal attendee strike notifications use the existing notification mechanism. This feature does not contact parents, record a warning as completed, remove anyone, change profiles, or change access permissions.

## Release and verification

Apply `20261009155227_attendance_automatic_absence_strikes.sql` before publishing the UI. The migration is additive and does not modify historical attendance decisions or strike records. Compare pre/post fingerprints with only the two new metadata columns excluded, and verify all pre-existing meetings retain a false marker. Do not create production test meetings, absences, or strikes.

Coverage includes production-shaped ten-column audit records with a required actor, local PGlite permission/policy tests, synthetic browser previews/corrections, and genuine Auth/PostgREST integration on an owned disposable Supabase stack. The integration suite runs after the active-roster fixture and uses no hosted endpoints or impersonated app sessions. Both automated-strike tests and previous attendance regressions run in the Attendance PR workflow.
