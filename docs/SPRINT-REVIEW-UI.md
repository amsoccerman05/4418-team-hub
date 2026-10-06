# Sprint Review workspace

Local frontend implementation for `#planning/reviews` and `#planning/reviews/{review UUID}`. This is a student-led weekly meeting record tied to the existing Planning season and canonical project boards. It adds no alternative task ownership, requirements register, architecture-decision register, or mentor approval gate.

## Main flow

- Choose a season and review. The compact meeting header shows the chair, date, update count, configurable agenda and export controls.
- A facilitator can create/edit the review title, date, chair, and ordered agenda with a presenter and 1–240 minute duration for each item. Project review assignments select an active student lead and active eligible supporters.
- Each assigned project team creates or edits one update per review. The editor separates progress/evidence, reported student decision/rationale/participants, and the next test/linked task into keyboard-accessible tabs.
- An explicit carry-forward action copies earlier unresolved blockers, options, questions and next test with provenance. It does not label prior progress, evidence or decisions as new observations.
- The next task is an existing visible Planning record. Current task owners and due date are displayed; this workspace does not create, reassign, or change the task.
- The review queue lists concrete missing fields: update/lead, evidence, trade-offs, next test, next task/owner/date, open decision, or missing decision rationale/participants. It uses no score, percentage, inferred quality judgment, or approval state.
- Export is lazy and uses only the selected loaded review. Original deck style requires the Red Hat fonts for the closest match; Common-font compatibility uses Arial. Text remains editable. An in-flight export is discarded after navigation/account changes. Export and attachment behavior are documented separately by the export module.

## Access and lifecycle

`can_manage`, per-board `can_edit_update`, and person `can_write`/`is_student` are explicit server capabilities. UI role names do not grant write access. Archived/inactive records are read only. Historical participants remain readable, while new selection is limited to currently eligible people.

Actor, route and season changes remount the scope before another render can display old content. Context validation checks scope, selected review, identity uniqueness, nested records and capability types. Optional invalid legacy reference URLs become unavailable links while retaining their labels and source IDs. Evidence links accept only HTTP(S) URLs without credentials, backslashes or controls.

All requests check the current session, pin that exact access token on the RPC request, and include `expected_actor` for writes/recovery. Request retries are disabled. Late responses, auth changes, route changes and closed editors cannot repopulate stale data or cause another save.

Before a write, the browser retains only `{request_id, expected_actor}`. Draft text, task metadata and credentials are never retained in recovery storage. Recovery is rendered before unavailable-context/permission guards, so an actor can reconcile an interrupted save even after losing access to its original review. New writes stay paused for that actor until the receipt reports applied/cancelled. Unknown status does not trigger a retry. Explicit cancel uses the backend tombstone and does not undo an already completed write. Blocked session storage falls back to in-memory recovery with a keep-tab-open note.

Write validation mirrors the typed field/list/date constraints and uses a conservative 60,000-byte serialized client threshold below the backend 64,000-byte JSONB limit. Conflict errors preserve the unsaved editor for review and direct the user to close/refresh.

## Integration

`SprintReviewWorkspace` accepts `actorId`, exact hash `route`, optional `seasonId` and `onSeasonChange`, and optional `onOpenTask`. The initial shell integration uses the independent review season selector and canonical project-board links. Local season selection survives review-route changes; direct links let the server resolve the visible review’s season when no explicit season was chosen. No shared Planning task editor is duplicated. The component uses a single nested section rather than adding another main landmark.

## Verification

- `npm run build` checks frontend types and bundles the lazy exporter separately.
- `npx playwright test tests/sprint-review-model.spec.ts --workers=1` exercises model, server-rendered views, exact token pinning with the real Supabase client, interrupted/stale responses, bounded RPCs, recovery isolation, and queue/carry-forward rules without a browser.
- `tests/sprint-review-db.spec.ts` passes actual RPC output through the frontend parser for manager, student and readonly accounts, unavailable links/tasks, historical people, missing seasons and large canonical task-owner lists. Backend migration/concurrency verification is owned by the database contract suite.
- `tests/sprint-review-ui.spec.ts` stages 390/768/1440 workspace and dialog screenshots; manager setup; capability gates; double-submit; Close/Back; delayed saves; explicit cancel; account/signout; inaccessible context; conflict; malformed route; and lazy export cancellation/download checks.

The staged UI browser tests and visual QA have not run in this local executor. One browser-only exporter test included in an initial aggregate stopped at the missing bundled Chromium executable before page creation; the corrected aggregate excludes it. The system browser cannot launch under the current sandbox. No browser install or sandbox-flag workaround was attempted by the frontend implementation. A later authorized CI run must execute the browser suite, inspect the generated screenshots, and fix any findings before the UI is called visually polished or ready to publish. All fixtures are synthetic and contain no historical roster, student results, CAD or production data.
