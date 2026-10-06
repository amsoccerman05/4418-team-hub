# Season Goals in Planning

Season Goals is an additive Planning feature. Deployment follows the dependency, permission and verification gates below.

## The weekly workflow

1. A student creates an engineering, performance, fundraising, or team-growth goal in the active Planning season. The goal has a student owner, supporting teammates, a baseline and measurable target, a unit, and a deadline.
2. The owner links existing tasks and season milestones to show the work behind the goal. These links never create tasks, change assignments, or mark work complete.
3. Each week, the owner or a named supporter records what happened, an observed date, a manually reported status, and the next step. A measured update adds a numeric observation; a weekly note leaves the measurement unchanged. Earlier evidence remains visible.
4. The detail view places baseline, latest observed value, and target together. The numeric target check and the student's reported status are separate. Task counts are not converted into a goal-completion percentage.

A lower target is supported for measurements such as cycle time. An unchanged target uses the explicit “Maintain this value” direction. Fundraising goals label their manually reported measure as pledged or received; they do not import donor, income, or budget data from Finance.

## Goal permissions

| Action | Who can do it |
| --- | --- |
| Read active-season goals | Existing active Planning members |
| Create a goal for themselves | Active student/lead accounts |
| Facilitate a goal for a student; reassign ownership | Existing Planning leadership |
| Edit the goal definition and linked work | Its active student owner or existing Planning leadership |
| Add evidence or a weekly update | Its active student owner, named eligible supporter, or existing Planning leadership |
| Read drafts/archives | Existing Planning leadership, following the current Planning season rules |

Supporting writers must have an active student, lead, mentor, or admin base role. Readonly profiles remain read-only. A goal assignment never adds task-editing, season-administration, app, or Finance permissions. The existing `planning_private.manager()` definition and Planning private schema permissions are unchanged. Goals uses its own private schema for guarded operations and history.

## History, links, and interrupted work

Evidence is append-only. Measurement definitions are locked once evidence exists so earlier observations keep their meaning; a different measure needs a new goal. Title, description, deadline, supporters, and linked work remain versioned and audited. A future change to that rule would need a reviewed way to preserve each observation's original measurement definition.

Links retain their identity when underlying work becomes unavailable. Ordinary members receive a neutral placeholder for task details they can no longer access. Retaining or removing an existing unavailable link is allowed; adding new hidden work is not. Opening an available link uses the existing Planning task or milestone editor and its existing permissions.

Saving uses a server-checked actor, explicit operation identity, optimistic version, and atomic audit. Repeated identical requests return the first result. An uncertain save is checked or explicitly canceled before a replacement is started; a cancellation never undoes an already committed record. Only opaque recovery identifiers are kept in this browser tab. Draft text and goal data clear when the account, route, or season changes. If tab storage is blocked or cleared, recovery identifiers may be lost; server history remains authoritative.

## Validation and release gates

The feature adds database authorization, concurrency, model/service/session, and synthetic browser tests alongside the existing Planning regressions. The browser tests cover phone, tablet, and desktop layouts and interrupted/repeated flows. Test fixtures do not contact production or contain real student records.

Run `npm run build` and the normal `npm test` release checks on the final candidate. Native PostgreSQL concurrency coverage is in `tests/native/season-goals-concurrency.mjs`; the backend contract and focused verification commands are in [SEASON-GOALS-BACKEND.md](SEASON-GOALS-BACKEND.md).

Before rollout: review the goal-specific access policy, verify current production dependencies and privileges without modifying business records, assess the additive migration and rollback plan, and complete browser/visual review. Keep the new `planning_goals_private` schema outside the Data API's exposed schemas and extra search path. Goals does not change the parent hub, training, Sponsor policy, Test & Practice, notifications, or engineering logs.
