# Planning V1.2 — local implementation review

This implementation is local only. Do not deploy the dependency-enabled frontend before reviewing and applying its migration. The implementation pass made no production changes. The read-only production review is recorded below; no migration or deployment has occurred.

## Existing records and workflow

Season Table and Gantt share `planning_items`; Board Table, Kanban, Gantt, and My Work share `planning_tasks`. Inline title, owner, area, status, priority, and timeline edits call the existing version-checked `planning_save` RPC with the current record. Date editors submit calendar-date strings without timestamp conversion. Failures retain the previous displayed value and show the server error. Quick creation keeps the current Board/group and canonical status.

Board views use the shared Planning context and reset filters when changing workspace/Board. Functional Area Boards remain persistent across seasons; project Boards remain season-bound. Board Gantt derives ranges and deadline-only markers from existing dates, leaves undated/start-only Tasks without invented durations, and opens the existing Task details. Dates and statuses remain manually controlled.

## Dependency relation and security

Migration: `supabase/migrations/202610030001_planning_task_dependencies.sql`.

The additive relation `public.planning_task_dependencies` stores immutable predecessor/successor pairs, their Board, creator, and timestamp. A Task/Board composite unique key supports foreign keys enforcing same-Board identity. Pair uniqueness, self-reference check, and foreign keys enforce basic integrity. No Task backfill or existing record changes occur.

`planning_dependency_save(text,uuid,uuid,uuid)` adds/removes relationships only. It derives Board identity from Tasks, uses existing active-member/active-position management checks, rejects archived Boards/project seasons, and serializes with the existing Planning advisory lock `(4418,30)`. Recursive reachability rejects cycles of any length. No automatic date or status changes occur, and conflicting dates are not prohibited by dependencies. Removing an already-removed relationship fails clearly. Task optimistic versions are unchanged by relationship edits.

Dependency reads are batched into the existing `planning_context(uuid)` JSON response using its existing Board visibility predicate. RLS is enabled and direct client table access revoked. Only authenticated callers can execute the new mutation; authority is rechecked server-side. Ordinary assigned members may continue existing Task edits but cannot add/remove dependencies.

Adds/removals write atomically to `planning_private.history`, attached to the successor Task, with actor, relationship identity, both Task IDs and title snapshots. Board archival preserves relationships and history. Task deletion cannot leave dangling references. Existing `planning_save`, Team Positions, Suite Auth, Attendance, and Team Management are unchanged.

## Review and later rollout (not executed)

1. Review this local implementation and migration. After approval, separately inspect production for object-name conflicts; verify Task/Board keys, current Planning function signatures, RLS/grants, and trusted active-position classifications. Compare the installed `planning_context(uuid)` with the reviewed V1 definition before replacing it; stop on unexpected differences.
2. Verify a fresh recoverable production backup using the established process.
3. Apply only `202610030001_planning_task_dependencies.sql` once, as its BEGIN/COMMIT transaction. Do not run unrelated migrations or backfill relationships.
4. Verify permissions, visible context/dependencies, original Task/Board record fingerprints, and existing RPC grants. Use local tests or a reviewed rolled-back transaction for mutation/security verification; do not create fake production work.
5. Only after backend verification and deployment authorization, deploy this reviewed Hub build. Verify Table/Kanban/Gantt, member privacy, Board switching, and desktop/phone layouts. Existing Tasks initially have no dependencies.

## Deliberately deferred

Board sidebar shortcuts (the existing Boards index remains), saved filters, schedule conflict intelligence, automatic rescheduling, Gantt dragging/resizing, cross-Board dependencies, other dependency types, and all other explicitly excluded features. No new notifications or integrations.

## Local validation

- 36 focused cases passed: 15 Planning database/security tests and 21 Planning UI tests. The final full run passed 34; two new timezone fixtures were corrected to initialize dates before shared context loading, then both passed on focused rerun.
- Dependency coverage includes duplicates, self-reference, 2/3/4-node cycles, multiple predecessors, missing/cross-Board Tasks, manager/member/revoked/inactive permissions, direct-access denial, archived visibility, persistent Functional Area Boards, relationship-only removal, and add/remove audit rollback.
- UI checks cover direct edits, keyboard creation/cancel, stale/error restoration, date-only DST round trips in Los Angeles/Auckland, shared record identity, Board isolation, dependency indicators, deadline-only/undated Tasks, and 390px/1440px layouts without page overflow or runtime errors.
- Hub TypeScript and production build passed. No unrelated application tests were run. Browser checks use intercepted fixtures; database tests use local PGlite.
- Migration is ready for review, not yet production-verified or applied. No deployment occurred.


## V1.2 production compatibility review — 2026-10-02T21:39:42.392419+00:00

**Result:** compatible with the production schema inspected read-only using the established Supabase Management connection. No schema/data writes or deployment. Migration SHA-256: `db5e73d817b5d408bcf8824fcb50a29b87869567b21ae0ef2e0fd5386f72aec9`.

- Production PostgreSQL 17.6 Planning columns/types/defaults/nullability and PK/FK/check constraints match the local V1 migration. Local PGlite exposes NOT NULL entries separately in `pg_constraint`; comparison accounts for that catalog-format difference and verifies nullability through `pg_attribute` on both systems. No semantic difference was found.
- All five installed Planning function bodies exactly match V1: `planning_context(uuid)`, `planning_save(text,jsonb)`, `planning_task_detail(uuid)`, `planning_private.member()`, and `planning_private.manager()`. Signatures, security-definer settings, empty search paths, grants, and stable/volatile declarations are compatible. `auth.uid()` remains the existing JWT-derived UUID function.
- All eight existing Planning tables/history have RLS. Effective anon/authenticated SELECT/INSERT/UPDATE/DELETE/TRUNCATE privileges are denied. Only the three public RPCs are executable by authenticated clients; private helpers and public RPCs are denied to anon. Existing grants are not widened by V1.2. Production default table grants are neutralized on the new dependency table by explicit revokes.
- All 11 designated Planning leadership position keys exist and are active; the installed manager function still requires current active accounts, active positions and unrevoked assignments. Mentor/Admin compatibility and assigned-member restrictions are unchanged.
- No dependency table, mutation function, index, or Task/Board constraint name conflicts exist. The unique active-season index and Task/Board reference structure match expectations. Planning history has the exact required audit columns and no incompatible trigger/action constraint.
- Production has no `supabase_migrations.schema_migrations` ledger. V1 was applied through the documented manual transactional process; compatibility is verified from actual installed objects and exact function bodies, not inferred from a migration version row. At inspection there were 2 seasons, 1 Board, 1 Task and 52 history entries; none were changed.

### Cycle and concurrency review

For an added A → B relationship, recursive traversal starts at B's successors and rejects if A is reachable. `UNION` bounds traversal even in a corrupt graph. Every edge is confined to one immutable Board through both composite foreign keys, so traversal cannot escape Boards. Self-reference and pair uniqueness are also database constraints. Task deletion is restricted by foreign keys; removal deletes only the relationship.

Both dependency mutation and the unchanged `planning_save` take the same transaction-scoped advisory lock `(4418,30)`. Production defaults to Read Committed with no authenticated/authenticator isolation override, and the mutation functions are volatile: after acquiring the lock, subsequent queries see the preceding committed writer. Thus simultaneous authorized RPC writes cannot bypass duplicate/cycle checks, including add/remove/archive races. Task versions remain enforced by the existing RPC. This is a source/catalog concurrency review, not a multi-session production load test. Keep the reviewed Read Committed RPC execution model; any future isolation or direct-write API change requires another concurrency review.

### Contained correction and verification

The dependency migration required no correction. Board Gantt arrows now use the actual rendered bar/marker endpoint (including due-only and short bars), and omit arrows toward start-only Tasks without a rendered bar. Their dependency remains visible in Task details. No dates, statuses, or persistence behavior changed.

Focused coverage was extended for explicit direct dependency INSERT/UPDATE denial and the Gantt endpoint/start-only edge case. The complete run passed the existing 36 cases; the new Gantt test's text selector was corrected and its targeted rerun passed (37 cases total). Hub TypeScript/build passed. Existing focused desktop/390px, cross-view, signed-out privacy, DST/timezone, audit rollback, archival and authorization checks passed. No unrelated application suites ran.

### Required approved rollout sequence

1. Obtain rollout approval for the reviewed local implementation and unchanged migration. Rerun `docs/PLANNING-V1.2-PREFLIGHT.sql` immediately before applying; stop on a material difference or conflicting V1.2 object.
2. Create a **fresh** full native `pg_dump --format=custom --role=postgres` archive using the established private connection configuration. Store outside Git under a new timestamped `/Users/aiden/Documents/IMPULSE-backups/...-planning-v12-pre-migration/` directory. The October 1 pre-V1 archive predates existing Planning work and is not sufficient.
3. Verify nonzero archive size, `pg_restore --list`, complete decoding with `pg_restore --file=/dev/null`, and SHA-256; retain verification and compatible-Supabase recovery notes. Confirm definitions and data for every Planning table and `planning_private.history`, existing Planning RPCs, profiles/areas/positions, Hub/Attendance/Team Management structures, and policies/grants. Never print credentials or blindly restore over production. No new backup was created during this review.
4. Capture pre-migration Planning record/function/grant fingerprints. Apply **only** `202610030001_planning_task_dependencies.sql` once in its BEGIN/COMMIT transaction, after backup and final preflight pass.
5. Verify empty initial dependencies, unchanged Task/Board/Season/history records, existing RPC behavior, expected grants/RLS, and manager/member context. For dependency mutations use a reviewed rolled-back test transaction; leave no fake production tasks, relationships or audit records.
6. If backend checks pass, deploy only the reviewed Team Hub build. Check Board Table/Kanban/Gantt, Season Plan, My Work, dependency permissions, cross-view identity, signed-out protection, and desktop/390px behavior. Stop on failure; retain all production records/history.

**Ready for an approved rollout, conditional on that fresh verified backup and unchanged final preflight. Nothing applied or deployed in this review.**


## Approved production backend rollout — 2026-10-02

Fresh native custom-format archive verified at `/Users/aiden/Documents/IMPULSE-backups/2026-10-02-214408Z-planning-v12-pre-migration/production.dump` (1,079,370 bytes; SHA-256, archive contents and recovery notes alongside). Full decoding and all required Planning/Hub/Attendance/Team Management structures passed. No isolated restore was performed.

Final read-only preflight after backup matched the reviewed catalog and effective grants exactly. Applied only `202610030001_planning_task_dependencies.sql` once in its transaction. Installed columns/constraints/RLS and new function bodies match the reviewed migration.

Production checks passed in an explicitly rolled-back transaction: same-Board add/remove, cross-Board/duplicate/self/cycle/missing-reference rejection, Mentor and designated active leadership authority, ordinary-member and inactive/revoked rejection, direct-access denial, add/remove audit, unchanged Tasks on relationship removal, assigned Task updates, reassignment denial, checklist/comments/detail and archival preservation. Test fixtures initially required SQL alias and complete position-revocation fields; corrected rerun passed. No fixture records persisted. Original Planning data/history and pre-existing function fingerprints are unchanged.

Frontend release uses the existing Team Hub GitHub Pages workflow. No unrelated applications, Auth, notifications or migrations changed.
