# FRC 2027 attendance notice reset

FIRST lists the 2027 FRC kickoff on January 9, 2027:
https://www.firstinspires.org/programs/frc/game-and-season

The notice counting window switches at the beginning of that date in America/Denver:
2027-01-09 00:00 MST = 2027-01-09 07:00 UTC. This is a calendar-day reset,
not the game-reveal broadcast time.

Until that instant, retain the existing 2026-01-01 00:00 UTC counting window.
There is no January 1, 2027 reset. On kickoff, prior notices and completed
member/parent follow-ups leave the current window but remain in history.
Notice quantity, assignment date, rescission, automatic absence generation,
review rules, and authorization are unchanged. No stored rows are updated.

Only the confirmed 2027 reset is configured. The boundary remains there in 2028
until another verified kickoff is explicitly added; do not infer annual dates.

## Deployment

Review the live definition and migration history before applying
`20261015071925_frc_2027_kickoff_reset.sql` to the intended project. Apply the
migration before publishing the frontend's updated reset description. The
migration preserves the existing RPC signature and return keys, so old clients
also receive the new boundary without an API change. No scheduled job is needed:
the read-only context RPC computes the boundary when attendance is loaded.
Refresh an already-open screen to load the new window.

The migration has been prepared and tested locally. A read-only live inspection
confirmed the current RPC matches the predecessor used for this change. No
production migration or deployment has been performed.
