# Project Lead account role

This release supersedes the original Project Lead **position**. A mentor selects
**Team Management → Members → member → Account role → Project Lead**, provides a
reason, and saves. This uses the existing audited member editor, not a position
assignment. No production account is assigned by this release.

## Access boundary

The stored profile role is `project_lead`. Active Project Leads retain ordinary
Student behavior throughout the shared suite and additionally create, assign,
edit and update Planning task cards/checklists on available boards. They do not
receive season, board, dependency, account, finance approval or general Pit
administration. Existing separately assigned leadership positions retain their
same conditional effects. Regular Students remain unchanged. Read-only,
inactive and demoted profiles do not retain the new card capability.

Invitations remain unchanged: invite a Student and use the mentor account editor
to select Project Lead afterward. Admin Lead invitation/role authority is not
expanded. Direct profile writes and self-role changes remain denied.

## Migration and compatibility

`20261119232042_project_lead_account_role.sql` adds the canonical text role,
changes the Planning capability helper to check that role, and retires the old
position. The position cannot be reactivated through the management RPC.
No profile rows or position assignments are converted or overwritten. Preflight
found no unrevoked holders of the old position; the migration aborts if one has
appeared so that existing access can be reviewed rather than silently removed.

The suite shares this database. The migration adds Project Lead only to reviewed
Student-containing role predicates in 55 existing functions, adds a retirement
guard in `team_manage_v2`, and adapts the legacy Finance context (57 functions in
total). It never adds Project Lead to a mentor/admin-only predicate. Exact source
hashes and literal replacements are pinned to the reviewed definitions in
`tests/fixtures/project-lead-account-reviewed-functions.json`. Unexpected function,
profile-constraint or Pit read-policy drift aborts the transaction. Existing
function owners, security settings and grants are retained by CREATE OR REPLACE.
The private Planning helper stays unavailable to anonymous/authenticated callers.

Ten Pit SELECT policies receive the same additive Student-equivalent role.
Finance's legacy frontend receives `student` only in its `finance_context`
profile-role field, preserving Student UI behavior. This does not change the
stored role, grant finance authority, or alter responses for any other role.

Release order:
1. Publish and verify Inventory and Pit compatibility clients, which recognize
   Project Lead only where Student was already supported.
2. Wait for the independent attendance release to be verified live.
3. Run account-role PR CI on current main with the strict dependency audit intact.
4. Recheck schema preconditions and apply the transactional migration.
5. Merge/deploy Hub through normal checks and verify deployed assets/schema.
6. Leave every actual account unchanged for the owner to assign explicitly.

Do not roll back compatibility clients after accounts use the new role. A Hub
frontend rollback alone must not undo role data. If a schema precondition changes,
review that exact difference rather than weakening the guard.

## Verification

Focused PGlite tests execute the exact migration and real Planning/member RPCs,
including role assignment, card creation/editing/checklists, demotion,
inactivation, unchanged Student behavior, no extra management privileges,
direct-write denial, and safe aborts for source/policy drift or legacy holders.
Only synthetic accounts in disposable databases are modified. Shared helper
fixtures model existing privileges; these focused tests are not an end-to-end
test of every Finance/Pit/Inventory workflow. Browser role and member-editor cases
run in normal CI. Local browser startup is unavailable in this executor.

Privacy: no new data categories, recipients, providers or retention behavior.
Existing role/task audit records remain governed by the current privacy notice.

## Follow-up review of PR #43

Reviewed from `f81e03c2f0f9db13a05a5acea34f4ceb12652587` in an isolated
checkout, using synthetic profiles and disposable PGlite databases only. No
application or migration change was necessary in the exercised paths. The main
coverage gap was that several detailed boundary tests still exercised only the
retired position baseline.

New account-role regressions verify:
- An active `mentor` (the canonical administrator in this schema) can assign and
  remove Project Lead through `team_manage_v2`, with before/after role audit
  records. Student, Lead, Admin Lead, Project Lead, Readonly and inactive mentor
  actors cannot assign it. Stale member versions cannot overwrite an assignment.
- Removal during a session denies stale unowned task/checklist writes and new
  cards, while preserving owned Student edits, checklists and comments. Readonly
  or inactive former Project Leads cannot write even to retained assignments.
- Creation, editing, multiple owners and checklist updates work across two active
  project boards and a persistent area board. Draft/archived project seasons and
  inactive boards remain protected; area boards retain their existing persistence.
- Student and Project Lead agree on tested Attendance, Goals, Inventory,
  Fabrication, Finance and Pit predicates. No unassigned management/approval
  capability is gained. The real Finance context maps Project Lead to `student`
  for its legacy client without granting capabilities.
- The actual React editor, bundled in the existing model harness, preserves drafts
  and removes owner assignment after a denied save and refreshed role removal.
  It retains editing only for owned Student work. Browser regressions cover the
  unowned case at 390px and 1440px.

Local verification: build/typecheck and focused database/editor/Attendance model
checks passed. Browser assertions could not execute: the Playwright Chromium
artifact returned HTTP 403; installed `/usr/bin/chromium` failed at startup with
`socket() failed: Operation not permitted`. The model harness substitutes local
editor execution but does not verify browser layout, focus or interaction.

Integration limits: PGlite uses the repository's reviewed function fixtures and
existing modeled shared helpers, not deployed Auth/PostgREST or every related app
workflow. This review does not establish live schema compatibility, concurrency
behavior, Inventory/Pit client deployment readiness, or production role changes.
The original release prerequisites above still apply. The legacy `admin` label in
frontend compatibility code is not a newly authorized database administrator.
