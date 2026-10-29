# Admin Lead workflow adapter

Reconstructed from released Hub `255a201a537ae67ed9ce92d37da8a13ee5e30892`.
This is a fresh candidate, not a recovered or previously tested artifact.

## Boundaries

Apply `20261028160521_admin_lead_workflow_compatibility.sql` after the shared
`20261028160322_student_admin_lead_roles.sql` core. Deploy the Planning frontend
only after its context migration: missing `can_write` deliberately disables writes.

Seventeen existing function definitions add literal `admin_lead` to ordinary
Student/Lead eligibility. The eighteenth adds the current active writer read fact
to Planning context. Named positions, project assignments, ownership, archive
rules, review management, Finance redaction, and Mentor/Admin-only Volunteer
remain intact. No role conversion, assignment/data backfill, RLS or ACL changes.

Planning conjoins the writer fact with existing narrower authority; it never
replaces ownership/manager checks. Role loss, failed permission refresh, and
restoration preserve the open draft, checklist text and unsent comment. Restoration
does not save or retry automatically. Current ownership wins over draft ownership.
A previously opened My Work editor remains open if a refresh removes its assignment;
its draft is retained with editing disabled. Identity/route unmount behavior stays
with the existing authenticated shell.

## Verification and remaining release gates

- Fresh combined actual-module PGlite proof tests all 18 replacements, rollback,
  original function ownership/ACL/security modes, table ACL/RLS, unchanged original
  profiles/assignments/tasks, literal role eligibility and forbidden direct RPCs.
- Actual Editor model tests exercise interruption, explicit conflict reconciliation,
  role downgrade, unavailable permission refresh, current assignment loss and
  restoration without autosave.
- `tests/planning-role-access-ui.spec.ts` stages five synthetic desktop/phone
  scenarios. Unknown service HTTP routes fail closed, WebSockets are closed, and
  HANDOFF_LIVE is forbidden. Local browser execution was not attempted.
- Full combined aggregate, hosted browser screenshots, native PostgreSQL and
  disposable Supabase checks remain release-owner gates, not claimed passed here.
- Retain `test-results/planning-role-*.png` in the PR workflow for visual review.

`tests/fixtures/workflow-role-definition-pins.json` contains complete released
source and expected replacement definitions plus source hashes. These are source
pins, **not** live canonical `pg_get_functiondef` proof. The release owner must
compare current production definitions, owners, ACLs, security modes and search
paths before applying, reject unexpected drift, and verify preservation afterward.
No production records were queried or changed by this helper.
