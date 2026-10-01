# Planning V1 — local review

Planning lives in Team Hub at `#planning`, with Season Plan, Boards and My Work. This implementation is local only; no migration or deployment has run.

## Model and behavior

- A Planning season is separate from Finance. One active season is enforced by a partial unique index. Seasons start as drafts in the UI; activation is explicit. Archived season plans/project boards are read only and remain available to leadership.
- Season Plan has ordered groups, dated work items and first-class milestones. Each item may have one finish-to-start predecessor, an owner, an area and a linked board. References must stay in the same season (or link a persistent area board); cycles are rejected. Dates never propagate automatically.
- Gantt provides day/week scale, status bars, milestone diamonds, dependency arrows and a today line when today lies in the displayed date range. Labels/items open a form editor; list editing is also available. The timeline scrolls locally on phones.
- Project boards belong to one season. Functional Area boards have no season ID and persist across seasons, including their tasks. They appear alongside the selected season. Archival preserves tasks/history; boards can be reactivated. Board type/season and task board association are stable in V1.
- Tasks have fixed statuses, priority, one primary owner, area, start/due dates and optional blocked reason. Desktop native drag/drop and an accessible status selector invoke the same version-checked RPC. Search, owner/area/status/priority filters and a compact list view use the same loaded data.
- My Work shows unfinished assigned tasks on active boards, grouped into Overdue, Today, This week (through Sunday), Later and Blocked. Blocked takes precedence; undated work is Later. Dates use the viewer’s local calendar day.
- One-time checklist steps, plain-text comments and concise task activity are included. Task comments are append-only. No email/notification integration is added.

## Authorization and data safety

`planning_private.manager()` follows existing trusted-position checks: active Mentor/Admin, or active Student/Lead with an unrevoked assignment to an active designated position. Explicit keys: Program Manager, Product/Technical Manager, Finance Lead, Software/Business/CAD/Fabrication/Strategy/Power/Communications/Operations Lead. Base-role Lead alone is insufficient. Editable names are not authorization. No other app’s capabilities change.

Active team members can view the active season/active boards and comment. Assigned members may edit their own tasks and checklist steps, but may not reassign the owner/area/board or administer projects. Leadership manages seasons, plan items, groups, boards and tasks. Every RPC rechecks current account/position state. New unclassified positions do not automatically receive Planning administration.

Planning tables have RLS enabled and no direct client table privileges. Three authenticated, security-definer RPCs expose a bounded field model: `planning_context(uuid)`, `planning_task_detail(uuid)` and `planning_save(text,jsonb)`. Private functions/history are not client-callable. There is no new auth mechanism.

Mutations serialize on a Planning-only advisory lock and enforce row versions. Stale saves fail instead of overwriting. Actors/timestamps are server-derived. Before/after audit writes and mutations commit atomically. No destructive delete RPC exists. Existing Hub/Attendance/Finance data and functions are untouched.

## Review and manual rollout (not performed)

1. Review `supabase/migrations/202610020001_planning_v1.sql`. Verify production has the existing `profiles` fields (`id`, `display_name`, `role`, `active`), `areas` (`id`, `name`, `active`), `team_positions` (`key`, `active`), `team_member_positions` (`user_id`, `position_key`, `revoked_at`) and `auth.uid()` with their reviewed types. Confirm there are no conflicting Planning objects. The pre-deployment review below verified these assumptions read-only; rerun `docs/PLANNING-V1-PREFLIGHT.sql` immediately before application.
2. Take/verify the standard production backup. Apply only this migration as its single transaction after explicit approval. It creates only Planning objects and has no backfill.
3. Check Mentor, assigned leadership, ordinary-member, inactive/revoked-position and signed-out access. Keep this read-only; do not create a production season as a deployment smoke test.
4. Deploy only Team Hub after backend verification and deployment approval. Existing Suite Auth/handoff, routes and other workspaces remain unchanged.
5. Deliberately create a draft season, review its plan and boards, then activate when ready. Archive the previous active season explicitly first. Persistent area boards carry forward independently.

Rollback before use can hide the frontend route. Preserve Planning records/history if correcting a migration later; do not drop tables containing team work.

## Deliberate V1 limits

One primary owner per task and one predecessor per plan item. Gantt drag/resize, Calendar, a My 4418 summary, notifications, attachments, task recurrence, charts and integrations are deferred. Native Kanban drag is a convenience; status selection is the supported fallback on all devices. No scheduling engine or custom-field system.

## Focused validation

Planning-only PGlite database tests cover season/position permissions, activation uniqueness, stale writes, groups/items/milestones/dependencies, both board types, tasks/assignments/status, comments/checklists/audit, draft privacy, reference safety, archive/reactivation, persistence across seasons and atomic rollback when auditing fails. Browser fixtures cover 390px/1440px layouts, Gantt editors, status fallback, task editing/reassignment, checklist/comments, My Work, normal-member controls, desktop drag, draft setup and sign-out privacy. Hub TypeScript/build is required. No unrelated app suites are run.


## Pre-deployment review of 6a4cf78 — 2026-10-01

**Result:** no implementation/migration corrections were required. Only focused regression tests and review documentation were added. No schema, application, Auth, notification or production data changes were made during review.

Production catalog verification used the existing Supabase management connection with `read_only: true`. PostgreSQL 17.6 has all referenced UUID/text/boolean/timestamptz columns, referenced primary keys, the expected `auth.uid() returns uuid`, and all 11 designated position keys (active). No Planning schema, relation or function conflicts exist. Existing profile/area read policies already permit active members to read the limited names/IDs projected by Planning. Planning adds no grants to existing tables or functions. Broad Supabase default privileges are accounted for by explicit revokes, tested locally including SELECT/DELETE/TRUNCATE and private helper/history denial. RLS is enabled on all eight Planning tables.

Scheduling uses SQL `date`, ISO calendar-date strings in forms, and UTC timeline arithmetic/labels. Date round trips pass in Los Angeles/Auckland, including a DST boundary; reversed ranges and multi-day milestones are rejected. Cycles, self/missing/cross-season predecessors are rejected. Clearing a dependency retains both items; direct client deletion is denied, and foreign keys reject privileged deletion of a referenced predecessor. V1 exposes no item/task deletion API. Dependencies do not enforce automatic rescheduling.

Mutations use the Planning advisory lock plus row versions. Local tests verify stale-save rejection, atomic rollback on audit failure, server-authored comments, draft/archived privacy, all designated positions, current revocation/archival/inactive-account checks and denial of browser-supplied authority. Unique-index enforcement protects the single active season. These are local functional/security tests, not a production concurrency load test.

**Validation:** 19 focused Planning tests passed (12 database/security, 7 UI, including the original UI checks at 390px/1440px and two timezone checks); Hub TypeScript and production build passed. Auth bundle fingerprints are unchanged. Source review confirms the only pre-existing Hub files touched by implementation are the Planning sidebar entry and guarded route/context in `HubNav.tsx`/`main.tsx`; Attendance and Team Management implementations and Suite Auth are unchanged. The authenticated App guard encloses Planning; the existing Planning sign-out privacy test passes.

**Release readiness:** ready for an approved rollout, subject to a fresh verified backup and an unchanged preflight immediately before application. Apply only `202610020001_planning_v1.sql` once in its BEGIN/COMMIT transaction, verify the three RPC grants, RLS, manager/member context and absence of unrelated changes, then deploy only the reviewed Hub branch after approval. Create a draft deliberately after deployment; activation remains a separate action. Nothing has been applied, pushed or deployed in this review.


## Approved production backend rollout — 2026-10-01

Fresh native `pg_dump --format=custom --role=postgres` backup verified at `/Users/aiden/Documents/IMPULSE-backups/2026-10-01-164244Z-planning-v1-pre-migration/production.dump` (1,024,946 bytes; checksum, contents and recovery notes alongside). Full archive decoding passed; Hub/Attendance/Team Management schema/data/functions/policies/grants were verified present. No isolated restore was performed.

The final preflight exactly matched the reviewed production snapshot. Applied only `202610020001_planning_v1.sql`, unchanged from `6a4cf78`, once in its transaction. Backend verification used authenticated roles and existing identities with temporary fixtures inside an explicit rolled-back transaction. Mentor/member context, assigned task updates/checklists/comments, active designated leadership, revoked/inactive rejection, unauthorized administration/reassignment rejection, all eight RLS tables and direct access restrictions passed. Postcheck confirmed zero rows in every Planning table/history. Existing Hub/Attendance/Team Management records, functions and policies matched pre-migration fingerprints exactly.

No real season was created or activated. Frontend rollout proceeds through the existing Hub Pages workflow. Earlier local-only notes above record the implementation/review stages, not the current backend state.
