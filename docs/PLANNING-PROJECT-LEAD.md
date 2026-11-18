# Project Lead — local review draft

Assign the **Project Lead** position through Team Management → member → Team positions. Existing mentor/Admin assignment and revocation controls, reason capture and audit history are reused. No one is assigned automatically and the member's account role remains unchanged.

Active holders can create, edit, assign and change status/priority/dates for task cards, and maintain checklists on available active project and functional-area boards. Existing member commenting is unchanged. This is a team-wide task capability, not a per-board lead assignment.

Regular students still edit only their assigned tasks and cannot create/reassign cards. Project Lead does not grant season-plan/board/dependency administration, account administration, finance approval, attendance management, or generic Pit leadership. A distinct **Project Leads** category avoids the generic Pit grants carried by other leadership categories. Changing the category later may grant the separately displayed Pit access and requires the existing access acknowledgment.

Current active account, position and assignment are checked by the database. Revocation, deactivation or Read-only demotion removes the capability on the next mutation. Existing season/board availability, optimistic version checks, field validation and audit transaction behavior remain in place.

## Release

Not deployed. Review/apply `20261118015929_planning_project_lead.sql` before deploying the frontend. It adds a position and category, a private current-assignment helper, and task-specific capabilities in existing Planning RPCs. Existing records/assignments are untouched. An existing custom `project_lead` key blocks the migration for manual review. Do not change profile roles to work around an unapplied migration. Validate assignment/revocation and an actual student test account before rollout. No production database or assignment changes were performed here.

Privacy review: no new data types, recipients, storage, retention or providers. Existing public privacy text covers positions, task records and role/assigned-responsibility access. No public notice wording changed; this draft does not claim deployment.

## Verification

`npm run build`; `npx playwright test tests/planning-project-lead-db.spec.ts tests/planning-db.spec.ts tests/planning-owners-db.spec.ts tests/planning-editor-model.spec.ts tests/planning-recovery-model.spec.ts --workers=1` (database/model suites can use a config without webServer).

Browser cases in `planning-role-access-ui.spec.ts` cover Project Lead new-card save/close/reopen and unchanged ordinary-student restrictions at 390/1440px. Existing role-loss/retry tests remain. Browser execution must be completed in CI/a supported environment; local browser startup is blocked. Supabase advisors/live smoke test are not run; SQL behavior was tested only in disposable PGlite.

Live deployment preflight: production Planning writer guards exclude the legacy `admin` role. This migration preserves that restriction. Existing Project Lead key is absent and the category constraint matches expectations. Security advisors were inspected; existing RPC/security-definer findings and leaked-password-protection warning predate this change. Deployment remains blocked by the repository dependency-audit gate.

## Approved temporary build-only audit exception

The owner explicitly approved a temporary exception for GHSA-fc5q-39xc-vjpf to release Project Lead on 2026-11-18. `scripts/dependency-audit.mjs` retains the high/critical audit gate except this exact advisory and its transitive propagation at the currently pinned, dev-only versions. It expires **2026-11-25 02:55 UTC**; failures, unexpected graphs/versions, other advisories and production dependencies fail closed. A clean future audit does not require the exception. Remove the exception after a safe upstream update; do not extend it without approval.

Evidence: production-only audit reports zero vulnerabilities; the affected packages are Vite's build/dev tools, not the static Pages runtime. No application/Edge code consumes user-controlled globs. A sourcemap build inspected 241 runtime source modules without this toolchain. Vite's build now rejects affected toolchain modules in output chunks. Browser test dev servers remain loopback-only. CI build has a 45-minute cap. Residual risk is CPU denial of service during builds/local development with malicious glob patterns. All other tests and deployment gates remain unchanged; this is not a claim that the dependency itself is patched.
