# Sprint Review V1: local backend contract

Sprint Review is staged locally above verified main `2ee3857`, preserving the merged Sponsor and Season Goals features. No Sprint Review production migration, write, deployment, public upload, real-data import, notification, or account change has been performed.

## Scope and source of truth

Sprint Review records a meeting and its project reports. It does not create a new architecture authority, approval gate, vote, signature, task board, requirements store, or engineering-parameter register. Existing architecture decision IDs and their external register, Docs, Onshape, Gantt and Kanban sources remain authoritative.

A meeting has a Planning season, title, finite calendar date, optional chair and up to 30 configurable agenda items with presenter and 1–240 minute duration. Each canonical Planning project board has at most one versioned update per meeting. The report contains manual progress, blockers, evidence references, tradeoffs, decisions needed, reported student decision and rationale, named reported student participants, next test, optional canonical task, and an unresolved flag. Missing evidence, task, owner, date or participant is not inferred or filled with a fabricated value.

Project teams can be cross-functional. A project review assignment names an optional student lead and up to 30 supporters; it is independent of functional areas and existing Task ownership. One person can support multiple projects. An assignment never grants authority to create, reassign or otherwise change Planning tasks.

A reported decision is a statement in meeting notes. `recorded_by` and `recorded_at` identify the authenticated recorder of the current version, while `reported_by_student_ids` identifies expressly reported student participants. No participant is inferred from the recorder or treated as having signed or approved anything. The immutable audit preserves every prior version and its actual recorder. Students retain the final architecture decisions described in the workflow; this implementation creates no mentor approval requirement.

## Permission matrix

- Existing `planning_private.manager()` remains unchanged. Current Planning leadership creates/edits meetings, manages project lead/supporter assignments, and facilitates updates.
- An active student or base-role lead can be selected as project lead. New supporters, chairs and presenters must be active students, leads, mentors or admins. Readonly accounts remain readers.
- Explicitly assigned lead/supporters can edit reports for that project only. The backend also rechecks their current eligible role, active account, active project board and active season. A supporter later changed to readonly cannot write despite a retained historical assignment.
- Managers can work in draft seasons and read archived seasons/inactive boards. Archived seasons and inactive boards are never writable, including by managers. Ordinary active members, including readonly, can read only active-season/active-board work under existing Planning visibility rules.
- Task linkage may point to a visible task in the review's season or a persistent area board. New links to inactive, hidden, foreign-season or nonexistent work are rejected. Existing unavailable links may be retained or cleared, with unavailable metadata redacted on read. Owners and due date always come from the canonical Planning task.
- Removed/inactive lead/supporter/person IDs may remain as historical references, but cannot gain new edit authority. Newly assigned inactive people and readonly supporters are rejected.

## RPCs and payloads

The concrete frontend types are `src/planning/reviews/types.ts`; complete synthetic payload examples and actual-database helpers are in `tests/fixtures/sprint-review.ts`.

- `sprint_review_context(selected_season uuid default null, selected_review uuid default null)` returns `SprintReviewContext`: authenticated actor, current management permission, season/review selection, read timestamp, readable seasons, normalized members, project boards and explicit assignments/edit capabilities, latest 100 meeting headers plus the selected header, selected meeting updates, latest earlier update per project, and canonical task projections. `reviews_limit_reached` explicitly reports that older meeting headers are omitted. When a direct review link supplies only `selected_review`, the RPC resolves that review’s actual visible season. Explicit season/review mismatches and unreadable draft/archive links are denied; there is no fallback to a different season.
- `sprint_review_save(action text, request_id uuid, expected_actor uuid, p jsonb)` accepts `review`, `assignment`, or `update`. The payload is a complete field set from the matching `ReviewSave`, `AssignmentSave` or `UpdateSave`; new rows require `version: null`, updates the current integer version. Unknown/missing fields, forged provenance, duplicate identities, malformed references or cross-scope references fail closed.
- `sprint_review_mutation_status(request_id uuid, expected_actor uuid)` returns only an opaque actor-owned receipt. It never requires, returns or stores a client-side copy of the draft.
- `sprint_review_cancel_mutation(request_id uuid, expected_actor uuid)` installs a permanent actor/request cancellation tombstone if no write has committed. A committed save returns its applied receipt. Cancelling does not revert committed work.

Receipts contain `request_id`, `status` (`applied`, `cancelled`, `unknown`), `action`, `entity_id` and `version`. An unknown/cancelled request has null action/entity/version. The frontend may retain only `ReviewRecovery {request_id, expected_actor}` after closing/signing out. It must clear private draft content and account-specific context on those transitions.

All save, status and cancel RPCs acquire the existing Planning advisory transaction lock `(4418,30)`, then verify `expected_actor = auth.uid()` and current active membership. This orders review writes with existing Planning changes and gives exact recovery after transport failure. No timeout implies failure or success: use the same opaque key to resolve status or cancel. The backend stores the original action/payload privately for exact replay comparison. Same actor/key + identical payload returns one applied receipt; changed payload conflicts; other actors cannot recover that receipt. Save replay rechecks current write authority. An inactive actor cannot recover; an active actor who lost editing permission can still see only their own prior minimal receipt, to resolve an already attempted action.

Stable codes: `SR401` account/session changed; `SR403` unavailable/current permission; `SR409` optimistic conflict; `SR412` request key reused with different data; `SR422` invalid request; `SR500` unreadable/unavailable service. Errors never include PostgreSQL failing-row details, hints or protected source values.

## Carry-forward, data quality and safe reads

`carry_from_update_id` is a stable reference to an earlier update for the same project and season. It never creates a task or copies a decision into a new register. Ordering includes review date, immutable creation time and ID. Self/forward/foreign-project links are rejected. A later meeting-date correction that would reverse an existing carry-forward link is rejected, preserving an acyclic chain.

Text limits count UTF-16 code units to match JavaScript. Reference labels and IDs retain their full accepted 200-unit values through reads, subsequent edits and export; the separate person/project display-label bound remains 150 units. Required whitespace validation uses exactly the ECMAScript trim set, including NBSP and BOM. Review dates must be ISO dates in years 0001–9999. Legacy null, blank, overlong and supplementary-Unicode profile labels are normalized for display without changing profiles. Task dates outside the finite range become null with `due_date_unavailable: true`. An unreadable linked task returns an explicit placeholder and no cached title, owner, board, status or date. Optional legacy unusable reference URLs become empty strings through the safe SQL projection and defensive frontend URL parser, so the frontend/export can display an unavailable reference without rejecting the whole report. HTTP(S) is required for newly saved external references, with credentials, whitespace/control characters and backslashes rejected.

The RPC reads current canonical task owners and due date, not copied snapshots. `loaded_at` states the read time; detached PPTX snapshots must use that authorized loaded context and the selected review. They do not fetch external links or change any source.

## Storage and isolation

The official Supabase CLI 2.119.0 created the additive migration `20261006073717_sprint_review_v1.sql`. New public relations are `planning_sprint_reviews`, `planning_project_review_assignments`, `planning_project_review_supporters`, and `planning_sprint_review_updates`. New private relations store immutable before/after audit and actor/request receipts. All six have RLS enabled; direct PUBLIC/anon/authenticated/service_role privileges are revoked, including table/sequence/private-function access. Only the four authenticated, guarded RPCs are granted. Definer functions pin an empty search path and fully qualify relations.

No old migration body, Planning manager/member helper, existing grant/policy, Task mutation API or other subsystem is replaced. The migration and every mutation are atomic. There is no destructive public API. Audit and request rows reject UPDATE/DELETE even from privileged incidental writes. The migration rollback test proves a forced failure removes all new objects and preserves every pre-existing Planning function and relation security setting before applying locally.

## Local verification

Run focused functional/permission checks with:

    npx playwright test tests/sprint-review-db.spec.ts --workers=1 --reporter=line

Run true multi-session PostgreSQL checks with:

    SPRINT_REVIEW_PG_BIN=/path/to/postgresql-17/bin node tests/native/sprint-review-concurrency.mjs

The native harness initializes a disposable synthetic database under `/tmp`, binds only `127.0.0.1`, clears inherited PostgreSQL connection settings, and shuts down/removes its temporary data. It never loads production settings. PGlite is run with one worker to bound memory.

Verified: 17 PGlite groups and 12 native PostgreSQL 17.6 multi-session/transaction checks, including permissions, readonly transitions, authoritative task reuse, stale versions, request races, cancel-before-save/save-before-cancel, role/supporter/season changes while waiting for the lock, exact status, audit rollback, sanitization, reference/date/Unicode boundaries, carry-forward ordering and direct-access denial. The 17 groups include actual RPC responses passed through the actual frontend parser and detached export adapter across manager/student/readonly access, inactive/emoji labels, unavailable dates/work, malformed legacy optional URLs, 38 canonical task owners, no readable active season, explicitly selected older headers, unavailable historical attribution, and direct links into authorized draft/archive seasons with mismatch/member denial coverage. A dedicated field-boundary regression preserves 173/200-unit reference labels (including supplementary Unicode and END suffixes) through actual save, parser, export and later edits, rejects 201-unit writes, and confirms the private bounded-text helper remains inaccessible. The 27 existing Planning/Task-owner regression tests also passed. Aggregate application build/UI/export checks are coordinated separately with the frontend/export work. The direct-link and reference-boundary patches change only read projection; native mutation/locking behavior is unchanged, so the prior 12 native checks were not repeated for those patches. Local checks do not constitute production compatibility review or permission to release.
