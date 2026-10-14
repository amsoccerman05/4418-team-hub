# Account access: reversible default, separate deletion review

## Reversible account access

The member editor has a dedicated **Account access** section. The general member editor no longer changes active state: deactivation/reactivation uses the existing dedicated, audited `member_state` action. Confirmation shows name, available email, and stable account ID, requires a nonblank reason and explicit acknowledgement, and blocks duplicate submissions. Cancel and Escape are non-mutating; dismissal is disabled while a write is pending. Reactivation warns that retained roles and positions restore access. Inactive accounts remain searchable using the Account state filter.

The server remains authoritative. It rechecks active mentor/admin authority, takes the shared advisory transaction lock, checks the target timestamp, protects the last active manager, and records actor/reason/history. Existing authority to manage peer mentors/admins and to deactivate oneself when another manager exists is unchanged. Any tighter policy must be separately approved and implemented across both `team_manage` and `team_manage_v2`.

No database migration, credential, role, RLS or Auth change is included. No real account was changed for testing. Deactivation does not erase records, delete the Auth identity, revoke an invitation link, or remove cached/downloaded information. Privacy notice sections 8–9 remain consistent with this reversible behavior.

## Permanent deletion: design only, unavailable

Checked-in shared Inventory schema has `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` (`tests/fixtures/shared-security/inventory-001_initial_schema.sql`). Other references differ:

- Initial Inventory transaction actor references may become NULL; later trip/balance/movement actor references restrict deletion.
- Attendance membership, participants, strikes and audit attribution reference profiles.
- Position grants/revocations, management history and invitations reference profiles.
- Finance requester, submitter, approvals and private history reference profiles (`tests/fixtures/finance_v1.sql`).
- Sponsor/outreach owners, activity and immutable history reference profiles (`20261006045839_sponsor_outreach_v1.sql`).
- Planning, sprint review, volunteer hours and Pit operational histories also reference profiles.

These definitions establish risk, not a complete production dependency inventory. No generic Auth deletion endpoint is provided. Never add blanket CASCADE rules or remove history simply to make Auth deletion succeed.

Deleting a login identity while retaining a historical identity is not complete erasure of personal information. Pseudonymizing the profile alone does not erase names/emails in audit JSON, invitation ledgers, delivery records, files, exports or backups. Retention/anonymization choices require review before implementation.

A conservative future scope would restrict permanent deletion to inactive non-manager accounts with no operational records, pending obligations, protected positions, files or other dependencies. History-bearing accounts remain deactivated pending individual review. Even this scope requires current schema, trigger and storage-ownership verification.

A future implementation needs:

1. Active administrator-only authorization from trusted database state, rechecked at execution, with an approved administrative role policy. Do not rely on user-editable metadata or stale JWT roles, or silently promote mentors to the legacy Admin role.
2. Rejection of self-targeting/protected manager targets; inactive target, last-manager/administrator protection, fresh target version and dependency checks under the shared transaction lock.
3. Server-generated, expiring, one-use preview bound to actor, target, version and dependency results. Fresh authentication or approved step-up, typed identifier, explicit reason, and exact retained/deleted data summary.
4. Server-only privileged Auth operations. Never expose service-role keys in Vite. New persistent credentials need separate approval. Revoke sessions and preserve inactive database access checks during processing; deleting an Auth user must not be assumed to invalidate issued JWTs.
5. Minimal access-controlled audit that survives the operation, with no passwords/tokens. Explicit idempotency and reconciliation of partial/ambiguous outcomes rather than automatic destructive retries.
6. Isolated synthetic Auth/database/storage end-to-end tests before client exposure. No production test-account creation/deletion without specific approval.

## Verification and release gates

The reversible UI is covered by TypeScript/build checks, isolated PGlite permission/staleness/history tests, and mocked browser tests for acknowledgement, identity, mobile/desktop layout, cancellation, restoration, server failures and duplicate submissions. Existing Pages CI runs the aggregate test suite with Chromium; synthetic confirmation screenshots are retained as `account-access-review` for visual review.

Production browser account mutations are not part of release verification. Permanent deletion remains unavailable pending approved eligible targets/retention outcomes, verified production dependencies and separately reviewed authorization/schema/credential changes. Any future privacy notice update must describe the implemented behavior accurately. Building a feature does not authorize deleting a particular account.
