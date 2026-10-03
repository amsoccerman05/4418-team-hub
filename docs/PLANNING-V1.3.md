# Planning V1.3 — multiple Task owners (local review only)

Implementation remains local. The read-only production compatibility review is recorded below; no production migration or deployment has been performed. Based on deployed Hub `ffeb7f6`. Scope is Board Task ownership; Season Plan items retain their single Owner/Area fields.

## Previous model and preserved boundaries

`planning_tasks.owner_id` was the singleton assignment. `planning_save(text,jsonb)` checked it for Task/checklist edits and prohibited ordinary members from changing owner, Board, or area. Ordinary active members could already comment on visible active-board Tasks; comments were not restricted to the owner. Assigned members could edit the Task's existing title, description, status, priority, dates, blocked reason and checklist. These boundaries are preserved for each current assignee. Base-role Lead does not grant Planning management. The installed trusted active-position/mentor/admin checks remain unchanged.

## Authoritative assignment model and migration

`202610040001_planning_task_assignees.sql` creates `public.planning_task_assignees(task_id,user_id,assigned_at,assigned_by)`. The composite primary key prevents duplicates; the `(user_id,task_id)` index supports My Work. Both identities reference the existing Task/profile tables, without cascading deletes.

The migration takes the existing Planning mutation advisory lock and an exclusive Task-table lock before backfill, preventing legacy writes during the authority transition. Every non-null legacy owner is copied once, including inactive owners. Backfilled `assigned_by` is null: this is migration provenance, not a fabricated user action. The migration checks assignment counts and exact identity matches before proceeding. Existing Task IDs, Board IDs, status, priority, dates, blocked reasons, dependencies, comments, checklist and audit rows are unchanged.

**The migration removes only `planning_tasks.owner_id` after verified backfill.** It is not purely additive: this narrow Planning-only column removal is deliberate to leave exactly one authoritative writable model. It uses no CASCADE. There is no writable compatibility projection. Season Plan `planning_items.owner_id` is untouched. Historical audit JSON retains its original owner fields. An old Task RPC payload containing `owner_id` fails with a reload message rather than collapsing a multiple-owner set. This requires coordinated migration/frontend rollout and makes rolling back to the old frontend unsafe after migration. Review this transition before approval.

## Mutation, security, audit and concurrency

The existing `planning_save` remains the Task mutation API. `owner_ids` is an atomic complete set; omitting it retains the current set. An empty array unassigns the Task. Duplicate, malformed, unknown or newly inactive owners are rejected. An existing inactive owner may be retained or removed, but not newly assigned. No client-provided owner names, actor, active state, role or capability are trusted.

Reassignment requires existing Planning management authority. Ordinary assignees may submit the unchanged set in their normal Task edits, but cannot add/remove anyone, including themselves. Existing active Board/season and version checks apply. Owner edits and ordinary Task edits share the existing advisory transaction lock `(4418,30)` and Task version. The entire Task update, assignment diff, version and audit record succeed or roll back together. Retained assignment metadata is not rewritten. New assignment actor/time is server-authored.

The existing `planning_private.history` records before/after owner IDs and server-resolved names in each meaningful Task mutation; the UI describes owners added/removed by name alongside the existing actor/time. No second audit system or migration-generated user activity. RLS is enabled on the relation; PUBLIC/anon/authenticated direct privileges are revoked. All reads/mutations remain through the existing security-definer RPC architecture. Private helpers are not client-callable. No changes to Suite Auth, other Hub permissions, or member-directory access.

## Queries and views

Board context aggregates assignments once in a grouped query and returns one Task with `owner_ids` and `owners` (ID/name/active). Inactive names are exposed only for existing assignments to already-visible Tasks; they are not added to the eligible-member directory.

`planning_context(uuid)` preserves its signature. `planning_my_work_context(uuid)` uses the same private context implementation with indexed, server-side current-assignee filtering. It returns only assigned full Task records, plus minimal ID/Board/title/status metadata for Tasks in those same visible Boards to preserve existing dependency display/selection. This metadata is not treated as My Work or counted as Tasks. There are no per-owner network requests. Existing My Work presentation continues to show unfinished Tasks; Done remains canonical and is visible on the Board/context for all owners.

Table, Kanban, Board Gantt and My Work use one owner-summary component: Unassigned, one name, two names, or first name + count with a full accessible name/title. The searchable native-checkbox selector stages one owner-set change, supports keyboard/Cancel/Escape, and has explicit accessible remove buttons. Full Task creation/details use the same selector. Quick creation stays title-only and unassigned. Owner / Person filters test membership in the set; Task counts, progress and Gantt bars remain Task-based.

## Local validation

55 focused tests passed (15 existing Planning database/dependency tests, 11 ownership database tests, 29 Planning UI tests). The final ownership UI/database checks also passed after long-name mobile sizing and inactive-owner backfill assertions were tightened. Hub TypeScript and the Vite production build passed. Desktop (1440px) and phone (390px) screenshots were reviewed; the selector and long names remain within the viewport.

Focused Planning database and UI tests cover migration data snapshots; zero/one/multiple owners; rejected/duplicate/inactive input; shared Task/checklist/comment identity; My Work A/B/C membership and removal; trusted/revoked/inactive authority; direct access denial; audit rollback; stale owner updates; V1.2 dependencies; quick/full creation; filters; server rejection; and 390px/1440px rendering.

The conflicting-request test submits overlapping owner-set saves with the same version and verifies exactly one winner and no partial set. PGlite executes on one connection, so this validates stale/version semantics, not native PostgreSQL multi-session lock scheduling. A native multi-session check belongs in the separate controlled compatibility/rollout verification. No production data is used by local browser fixtures.

## Separate compatibility review — completed read-only (2026-10-02)

The documented preflight and expanded production catalog inspection were run read-only on 2026-10-02. Rerun `docs/PLANNING-V1.3-PREFLIGHT.sql` immediately before rollout. Compare exact Task columns/keys, installed save/context/helper bodies, audit infrastructure, V1.2 dependency objects, RLS/grants, position authorization and absence of new V1.3 objects. Production migrations are manual: do not assume a ledger. Reconcile total/assigned/unassigned Tasks and distinct owners; expected relationship backfill equals the assigned Task count. Do not expose member PII. Stop on any material discrepancy. Production matched the reviewed local assumptions at this inspection; that does not replace the final rollout preflight.

## Later rollout — requires explicit approval

1. Complete and approve the separate compatibility review and legacy-column transition.
2. Create a fresh native custom-format pg_dump backup, verify pg_restore readability/required objects and record checksum; use the established process without exposing credentials.
3. Rerun the unchanged approved read-only preflight immediately before migration; stop on changed assumptions.
4. Apply only `202610040001_planning_task_assignees.sql` once, in its transaction. Verify object creation directly and reconcile every prior Task/owner against the backup/preflight counts. No lost/duplicate owners or Task/history/dependency changes are acceptable.
5. Verify permissions/RLS, active/inactive assignment behavior, Task versions, My Work and V1.2 dependencies with rolled-back controlled fixtures. Leave no fake records.
6. Only after backend verification, deploy the reviewed matching Hub frontend. Old Task-owner payloads intentionally fail closed during this interval. Verify Table/Kanban/Gantt/My Work/details at desktop/390px; no fake lasting data. No other app or notification deployment.
7. Stop. No Calendar, owner roles, per-owner state, automation, notifications or V1.4.


## Compatibility review findings — 2026-10-02

- Production Task owner is nullable `uuid`, no default, with `planning_tasks_owner_id_fkey` → `profiles(id)` and `planning_tasks_owner` index. These are the only column catalog dependencies and are removed automatically by DROP COLUMN without CASCADE.
- `planning_save(text,jsonb)` is the only installed function/procedure with a textual legacy owner reference. Its body exactly matches the reviewed V1 baseline. It reads/writes Task ownership and enforces assigned-member permissions; the migration replaces those Task paths. Its Season Plan owner references remain intentionally unchanged.
- `planning_context(uuid)` implicitly exposes the legacy field through `to_jsonb(t)`; its body exactly matches V1.2. The migration replaces it with the normalized grouped projection. The deployed V1.2 UI uses this field for Table/Kanban/Gantt, My Work, owner filters and editing; the reviewed V1.3 frontend converts those Task paths. Old clients must reload after coordinated deployment, and legacy mutation payloads fail closed.
- No Planning views/materialized views, custom triggers or policies reference the legacy column/Planning tables. Textual function/procedure searches supplement pg_depend because PL/pgSQL body references are not necessarily catalog dependencies. `planning_task_detail`, dependency RPC, manager and member bodies match the reviewed baseline. Audit retains Task/profile FKs and existing server-authored history.
- Production counts: 1 Task; 1 unassigned; 0 assigned; 0 distinct referenced owners; 0 references to active owners; 0 to inactive owners; 0 invalid references. **Expected backfill: 0 relationships.** No Task IDs or member details are included here. Counts must be repeated immediately before migration.
- V1.2 composite Task/Board identity, dependency foreign keys, uniqueness/self checks, indexes and cycle RPC match. Existing RLS is enabled and ordinary direct table access remains revoked. The existing public RPCs are executable by authenticated users and private helpers are not. `auth.uid()` returns UUID from JWT claims; all 11 trusted student-leadership position keys exist and are active. No V1.3 object conflicts and no migration ledger exist.
- Backfill order/locking/reconciliation, single authoritative model, assignment capability equivalence, unchanged comments access, task-based metrics and transaction rollback were reviewed. No implementation or migration correction was necessary.
- Review hardening: expanded the documented preflight to search all function/procedure bodies and column dependencies, views and policies. Added forced end-of-migration failure coverage confirming restoration of old Task data/owner column, original save function and absence of uncommitted relationship/helper objects.
- Validation: the existing 55 focused tests and Hub TypeScript/build passed. The ownership suite then passed all 12 tests including the new forced-migration rollback case (56 distinct focused tests total). Desktop/390px checks passed. Conflicting request tests run in PGlite; native multi-session scheduling is not claimed as tested.
- Conclusion: legacy Task owner-column removal is compatible with the inspected production schema and approved by this technical review, conditional on fresh backup, unchanged final preflight, ownership reconciliation, backend verification and coordinated matching frontend deployment under explicit rollout approval. No production schema/data was changed; no deployment occurred.

## Production rollout — 2026-10-02 (America/Denver)

Fresh native custom backup: `/Users/aiden/Documents/IMPULSE-backups/2026-10-03-005634Z-planning-v13-pre-migration/production.dump`. Full pg_restore decoding, required schema/data/functions/dependencies/history, and SHA-256 verified in the adjacent verification.json. No isolated recovery-database restore was performed.

The unchanged documented preflight and full catalog/body comparison ran after backup; every reviewed section matched. Applied only `202610040001_planning_task_assignees.sql` once in its transaction. Reconciliation: 1 Task remains unassigned, 0 assignment rows, 0 duplicates; legacy Task owner column removed. Remaining owner_id text is the intentional stale-client rejection or unchanged Season Plan fields, not a legacy Task data path. Existing Planning data/history/dependencies and unaffected Hub function fingerprints match before/after.

Rolled-back native production verification passed: Mentor/trusted leadership owner management; one/two/replacement/removal/empty owner sets; duplicate/stale rejection; each assignee's My Work and shared canonical status; removal revokes assignment editing; member reassignment denied; inactive historical owners retained but not selectable for new assignment; revoked/inactive management denied; direct table privileges denied; forced audit-persistence failure fully rolls back Task/version/assignment/audit. V1.2 same-Board/cross-Board/duplicate/self/cycle behavior, dependency audit, comments/checklists and archival passed. All disposable records, temporary profile/position changes and audit-failure trigger rolled back; original fingerprints rechecked.

Frontend deployment follows this commit through the existing Pages workflow. Reload old clients after deployment. Real signed-in multi-owner walkthrough remains a separate live verification; controlled database identities and browser fixtures do not substitute for it.
