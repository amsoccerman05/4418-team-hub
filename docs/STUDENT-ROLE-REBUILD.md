# Student role release — reconstructed candidate

This candidate was rebuilt from released Hub `255a201a537ae67ed9ce92d37da8a13ee5e30892` after the earlier unpublished workspace was lost. Only **fresh** checks apply to this tree.

## Policy
- Read only cannot mutate team/business records. Auth/password/session and own-notification read-state housekeeping remain.
- Student keeps ordinary workflows and purchase requests. Lead keeps functional leadership, but generic invitations and Attendance management move to Admin Lead.
- Admin Lead is a literal role, not an Admin/Mentor alias. It can invite Students and update only ordinary-tier display names and Attendance registration with reason/version checks. It cannot edit roles, active state, areas, positions, categories or security.
- Mentor and owner Admin remain separate. Mentors cannot invite a new owner Admin; immutable existing invitation replay and already-provisioned accounts are preserved. Finish rechecks current authority and retains quarantine on failure.
- Position categories truthfully disclose existing Pit competition/scouting management. No position authority changes.
- Planning writer eligibility is a read fact composed with existing narrower ownership/manager rules. Downgrade and interrupted saves preserve drafts.
- Finance's separate candidate grants Admin Lead existing designated-submitter non-draft visibility and Submitted/Received actions, not role-only approval/admin/override/budget authority. Staff assigned Lead Coaches can approve only their own Coach step with a different assigned Finance Lead. Shared action counts consume Finance's server-owned eligibility; they do not grant helper access or add notification recipients/backfill.

## Ordered shared release
Coordinator, not this PR owner, applies shared SQL/Edge changes after all candidate gates pass. Canonical order:
1. Hub `20261028160322_student_admin_lead_roles.sql`
2. Finance `20261028160500_finance_student_roles_readonly_privacy.sql`
3. Pit `20261028160506_pit_admin_lead_role_adapter.sql`
4. Hub `20261028160521_admin_lead_workflow_compatibility.sql`
5. Inventory `20261028160648_inventory_admin_lead_compatibility.sql`
6. Hub `20261028160734_admin_lead_attendance_and_notices.sql`
7. Hub `20261028162931_coach_own_step_hub_counts.sql`

Existing profiles/assignments are not converted. New RPCs are authenticated-only; private helpers owner-only. Existing ACLs/security modes are preserved. Exact production function owner/ACL/search_path/full-definition and constraint preflight remains a required action-time gate; migrations also fail atomically on pinned function-body/constraint drift. Workflow source pins are released-source pins, not live-catalog proof.

Invitation Edge deployment changes only safe known reserve-error classification. `verify_jwt=false` and explicit Auth/user verification remain; finish/provider failures remain uncertain, never falsely classified as not sent.

## Evidence and limits
Fresh targeted core SQL 7, Attendance/notices 4, workflow SQL/Editor 13 and invitation/Editor models 94 passed. Build/typecheck passes. Actual combined Finance/core/count tests and full aggregate are recorded in the release manifest as they finish. Native role-revocation tests and real Auth/PostgREST shared-security tests run only on disposable hosted databases. Browser regressions use synthetic local fixtures at 390/1440 pixels; unknown external traffic fails closed in new role cases, exact Google Fonts stylesheet is fulfilled locally with empty CSS (fallback fonts).

No live users, account assignments or business records are test fixtures. No production SQL/Edge/deploy by the Hub owner. No approval review, automatic merge or deployment before coordinator clearance.
