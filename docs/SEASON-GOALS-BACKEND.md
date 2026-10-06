# Season Goals V1: backend contract

Season Goals adds the capabilities below to Planning. Deploy the migration only after reviewing its existing Planning dependencies, grants and the goal access policy. The local verification uses synthetic records and performs no production queries, migrations, deployments or notifications. Goals has no dependency on Sponsor Outreach code or schema.

## Scope and authority

Season Goals live inside existing Planning seasons. They do not change `planning_private.member()` or `planning_private.manager()`. Existing members are active profiles. Existing managers are active mentor/admin profiles, or active student/lead profiles holding one of the existing 11 current active Planning leadership positions. Base Lead alone is not a manager.

- Active student/lead users can create self-owned goals in the active season.
- Existing managers can facilitate creation in active/draft seasons with an eligible active student/lead owner, edit definitions and reassign ownership.
- The current active student owner or existing manager can edit definitions, supporters and links.
- Named active student/lead/mentor/admin supporters may append evidence and weekly updates. A retained supporter who becomes readonly or inactive has no writing capability.
- Readonly profiles retain existing Planning read access, but cannot create, own or update goals. No goal relation grants task ownership, Planning leadership, role management or Finance rights.
- Ordinary members see the active season only. Managers may inspect drafts and archives. Archived seasons are read-only for everyone.
- Operation reconciliation is available to the original active account even after it loses goal-writing authority; it changes no goal data. Inactive and signed-out accounts cannot reconcile.

All authority is evaluated from current profile/position rows on the server. UI capability flags are explicit affordances, not authorization. Calls with a different authenticated identity from `expected_actor` fail, including exact replays.

## Data model

The CLI-generated migration is `supabase/migrations/20261006061729_season_goals_v1.sql` (Supabase CLI 2.119.0).

| Table | Responsibility |
| --- | --- |
| `public.planning_goals` | Season, student owner, title, description, category, baseline, target, unit, direction, deadline, optional next milestone, timestamps and optimistic version |
| `public.planning_goal_supporters` | Named supporting members |
| `public.planning_goal_task_links` | References to existing tasks only |
| `public.planning_goal_milestone_links` | References to existing milestones, composite foreign keys enforcing the goal's season |
| `public.planning_goal_updates` | Append-only measured values, evidence, manually selected status and next step |
| `planning_goals_private.goal_operations` | Immutable actor-bound committed receipts and cancellation tombstones |
| `planning_goals_private.goal_history` | Immutable atomic before/after audit tied to each committed operation |

All new tables enable RLS and explicitly revoke direct access from PUBLIC, anon, authenticated and service_role, including inherited grants. There are no permissive table policies. Evidence, receipts and audit reject UPDATE, DELETE and TRUNCATE. Authenticated users receive only the narrow function entry points. Public RPCs are invoker shims; guarded security-definer implementations remain in the dedicated, unexposed `planning_goals_private` schema with an empty search path. General private helpers remain uncallable by clients.

`planning_goals_private` contains only the new Goals helpers, guarded entry points, receipts and audit. Its schema privileges are revoked from PUBLIC, anon, authenticated and service_role before granting authenticated USAGE. All functions, tables and the audit identity sequence explicitly clear those roles' inherited default grants; the only non-owner schema/function/table/sequence grants are authenticated EXECUTE on the four guarded private entry points and the five public invoker RPCs, plus USAGE on the new schema. Do not add `planning_goals_private` to the Data API's exposed schemas or extra search path. The five public tables remain inaccessible through direct Data API calls because all client table grants are revoked and RLS has no client policies.

The migration never grants USAGE on the pre-existing `planning_private` schema and never changes its objects or ACLs. This distinction matters when global default privileges have given clients dormant rights to its history identity sequence or helpers: granting schema USAGE could activate those rights. Goals calls the unchanged `planning_private.member()` and `planning_private.manager()` only from guarded definer code running with the migration owner's existing permissions. No existing object moves into the new schema.

Existing Planning rows, RPC definitions, owner-assignment relations and history are unchanged by the migration. Task owner display reads the canonical `planning_task_assignees` relation. No Finance table is read or written.

## RPC contract

Shared TypeScript contract: `src/planning/goals/types.ts`.

1. `planning_goals_context(selected_season uuid default null)` returns `GoalsContext`.
2. `planning_goal_save(p jsonb, expected_actor uuid)` returns `GoalOperationReceipt`.
3. `planning_goal_update(p jsonb, expected_actor uuid)` returns `GoalOperationReceipt`.
4. `planning_goal_operation_status(operation_id uuid, expected_actor uuid)` returns `GoalOperationReceipt`.
5. `planning_goal_operation_cancel(operation_id uuid, expected_actor uuid)` returns `GoalOperationReceipt`.

`expected_actor` is a separate RPC argument and must equal `auth.uid()`. Every write requires a client-generated UUID `operation_id`, a client-generated record `id`, and `expected_version`. New goals require version 0. Definition edits and evidence appends increment the same goal version; one concurrent stale writer cannot partially replace another's result. Unknown payload fields are rejected, including spoofed actor/author/role/capability fields.

`GoalsContext` contains the current user/season, top-level create/manage/reassign capability flags, eligible student owner choices, eligible supporting member choices, goals with per-goal edit/update/reassign flags and append-only evidence, and task/milestone choices. Historical owner/supporter names remain associated with their IDs when the person is inactive. Goals projects missing/blank names as `Team member`, caps labels at 200 Unicode code points, and treats a legacy null active flag as false. These defensive projections do not mutate profiles.

## Measures and evidence

Categories: engineering, performance, fundraising, team_growth. Direction is increase, decrease or equal. Increase requires target > baseline; decrease requires target < baseline; equal means maintain the same value and requires target = baseline. Numbers must be JSON numbers, finite, and have absolute value at most 1e12. There is no calculated completion percentage and no automatic completed status.

A fundraising goal must explicitly specify `fundraising_measure: pledged | received`; other categories must use null. Values are manually reported in the goal's chosen unit. This is not a ledger, reconciliation or permission inference, and does not pull any Finance amount or detail.

Each appended update includes kind (measurement or weekly), manually selected status (on_track, at_risk, blocked or achieved), evidence, a next step and the observation date. Measurements require a finite measured value; weekly updates require null for that field. Observation dates cannot be in the future. Dates use years 0001 through 9999. Optional evidence links use HTTPS, exclude credentials and whitespace, and are bounded to 2,000 characters. Required title, unit, evidence and next-step text uses the exact ECMAScript trim whitespace set, including tabs, newlines, NBSP, Unicode spaces and BOM. Whitespace-only required values fail the transaction before any receipt/audit can commit. Evidence and next steps are bounded to 5,000 and 2,000 characters. Definitions use titles <=200, descriptions <=5,000 and units <=60 characters. Each supporters/tasks/milestones list allows at most 50 distinct UUIDs.

The server applies conservative HTTPS syntax bounds rather than implementing a full browser URL parser. A stored optional URL that the browser cannot safely use remains readable evidence and appears as an unavailable link without an anchor; it cannot invalidate the entire season context. New form input uses strict browser URL validation.

Baseline, target, unit, direction, category and fundraising measure freeze after the first evidence update. A changed measure requires a new goal. Title, description, deadline, ownership, supporters and links can still change under the normal authorization/version checks; every change is audited.

## Linked work

New task links must refer to an active board in the selected season, or an active persistent functional-area board. Existing unavailable task links can be retained during unrelated edits or removed. They cannot be newly added while unavailable. Ordinary users receive only an unavailable placeholder for a linked task hidden by existing Planning rules: task ID, null board ID, generic title/status and an empty owner list. Moving a task to another season does not expose its new parent or content to either a student or a manager inspecting the original season. Managers may retain the same archived-board details existing Planning permits in the selected season.

New milestone links must be existing milestone items in the same season with finite years 0001–9999. Legacy nonfinite, BC or five-digit-year dates project as unavailable placeholders with null date and no title/status details. Existing unavailable milestone IDs and an existing next-milestone reference may be retained or removed during unrelated edits; they cannot be newly added or newly selected as the next milestone. The optional next milestone must also be among that goal's linked milestones, enforced with a deferred composite foreign key. Links never create tasks, edit task status, claim task ownership or change milestone state.

## Reliable uncertain-write recovery

All goal mutations and reconciliation use the existing transaction advisory lock `(4418,30)`, shared with Planning writes. Goal, season, profile/position and linked-record locks serialize relevant races. Current roles, season state and parent/link eligibility are checked after possible lock waits. Role/profile rows remain locked for the mutation, preventing revocation from passing unnoticed after validation.

A committed receipt contains only operation ID and `{goal_id, version, update_id}`. The private row stores the actor, operation kind and original JSON payload. An exact replay by the same active actor returns the original receipt without another mutation or audit entry. Reusing an operation ID with changed data/kind, a different actor, or a cancelled tombstone fails.

The client must not automatically resend a timed-out or otherwise uncertain write. It preserves an opaque pending operation reference scoped to the original actor across navigation/sign-out, and blocks replacement writes until resolved:

- Status waits for an earlier lock holder. `committed` gives the exact original receipt; `cancelled` confirms the tombstone.
- `not_found` means no committed record was visible after acquiring the lock. It does not prove that a delayed network request will never arrive.
- Explicit cancel takes the same lock. If the write already committed, cancel returns its original receipt and does not undo it. Otherwise cancel inserts an immutable tombstone. Any later original write is rejected.
- Repeated cancellation returns the same terminal receipt. Status/cancel cannot read or cancel another actor's operation.
- A database error, including failed audit insertion, rolls back goal/version/evidence/link changes and the operation receipt together. The failed operation then reconciles as not_found; explicit cancellation is still required before replacing an uncertain client request.

## Local verification

Run from the checkout:

```sh
npx playwright test tests/season-goals-db.spec.ts tests/planning-db.spec.ts tests/planning-owners-db.spec.ts tests/planning-goals-model.spec.ts --workers=1 --reporter=line
SEASON_GOALS_PG_BIN=/tmp/repair-po-native-pg17/install/bin node tests/native/season-goals-concurrency.mjs
```

The PGlite suite covers capabilities and eligible choices; all categories; finite/directional/maintenance targets; manual pledged versus received; evidence immutability; frozen measurement definitions; owner/support/manager/readonly/inactive/anonymous boundaries; stale versions; exact replay and actor spoofing; cross-season and unavailable linked records; all direct table paths under inherited grants; atomic audit rollback; and complete rollback of a forced failing migration, including the new private schema. The baseline deliberately grants tables, functions and sequences globally to anon, authenticated and service_role before applying any Planning migration. A regression compares all existing Planning schema/object ACLs, RPC/helper definitions, owners, RLS flags and default privileges before and after Goals, proves old history sequence/helper calls remain unreachable, and exercises the still-working Goals and Planning APIs. Exact catalog assertions permit only the ten intended non-owner grants described above. Additional tests feed real RPC contexts directly into the actual frontend model for Unicode whitespace, unusable optional URLs, null/long legacy profile labels, null active flags and unavailable legacy milestone dates. Existing Planning DB and multiple-owner regression suites run alongside it.

The native PostgreSQL 17.6 suite uses a disposable synthetic database bound only to 127.0.0.1, disables Unix sockets, scrubs PG environment variables, and verifies actual advisory/row-lock waits. It repeats the pre-existing Planning boundary, private sequence/helper denial and exact Goals grant checks under global defaults, then covers simultaneous exact create/append replays, stale updates, authority revocation during waits, board/season/milestone changes, retained unavailable task links, uncertain commit and rollback, both cancellation race outcomes, actor swaps and readonly/inactive reconciliation behavior. It performs no production queries or messages.

Local isolation verification passed 73 focused Goals/model and existing Planning database tests, plus 22 native PostgreSQL 17.6 checks (the new isolation check and 21 concurrency/reconciliation checks). Official Supabase CLI 2.119.0 security advisors against a disposable loopback database returned exit 0 with no issues.

Run security advisors against the intended approved environment and verify the five RPCs under actual JWT sessions as part of the project's normal release process. Confirm that `planning_goals_private` is absent from the Data API's exposed schemas and extra search path. Local database checks do not verify the deployed API configuration or real JWT sessions.
