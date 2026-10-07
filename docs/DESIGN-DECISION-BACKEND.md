# Design decisions: proposed additive backend contract

Proposed additive implementation above released main `a13b42c6`, extending the existing Sprint Review implementation. Public draft review is authorized. Applying this migration to production, writing production data, merging or deploying still requires separate approval.

## One review record, existing authority

A nullable `decision_workflow jsonb` column on `public.planning_sprint_review_updates` stores one comparison inside the existing project update. There is no separate design decision register, new role, task, approval, vote or signature. Existing external architecture and requirement sources remain references, and canonical Planning work remains the only task source. Reported student participants and the chosen option are a report of the team's decision, not consent inferred from the person saving. No mentor approval is required.

The exact TypeScript contract is `src/planning/reviews/decision-types.ts`. Existing report text, reported rationale, participants, task linkage, recorder, version and immutable audit are shared with the decision comparison. Workflow changes commit together with those fields through the existing `sprint_review_save` RPC.

## Additive migration

The official cached Supabase CLI 2.119.0 created `20261006235739_sprint_review_design_decisions_v1.sql` using `supabase migration new`. Existing migration files are untouched. The new transaction first acquires the existing Planning advisory transaction lock `(4418,30)` before changing the update table, ordering schema evolution consistently with current Planning/Review writes. It then:

1. Adds one nullable JSON column, without rewriting old records or populating fictional values.
2. Adds one private, security-invoker validation function with an empty search path; PUBLIC, anon, authenticated and service_role execution are explicitly revoked.
3. Extends the existing private `update_json` projection with a nullable `decision_owner`, resolved by the existing bounded `person` helper only for the owner referenced by this already-authorized update. Historical inactive or unavailable owners remain attributable without expanding the active member directory. Its security mode, search path and ACL are preserved.
4. Uses `CREATE OR REPLACE` on the existing `sprint_review_save` signature. This preserves its current ACL and security-definer contract. Differences from the released function are limited to validation of the optional workflow payload key, selection/validation of its effective value, and insertion/update of the new column.

The existing `authorize`, `can_edit`, `actor`, visibility, status, cancellation, error sanitization and Planning helpers are unchanged. The context projection already serializes the full update row with `to_jsonb`; it therefore includes the workflow without a new read RPC. Its only explicit change is the bounded `decision_owner` projection described above. The original advisory lock, actor binding, authorization-before-replay, exact payload replay, optimistic version check, stable project/review scope, audit and request receipt logic remain intact. Existing relation privileges, RLS flags and RPC grants are unchanged and tested by catalog comparison.

## Backward compatibility and atomicity

- Omitted `decision_workflow`: a legacy client's update preserves the currently stored workflow. A new legacy update receives SQL NULL.
- Explicit `decision_workflow: null`: clears the workflow.
- Object: validates and stores the supplied workflow.
- Optional `trade_study` and per-option `swot` may be absent or null. Old manual comparison objects remain valid.
- The original actor-owned request stores the exact submitted payload, including whether the workflow was omitted. Omission and explicit null are different payloads for replay; a request key cannot be reused to change either.
- Recorded-workflow completeness is checked against the effective workflow and the same incoming report. Thus legacy omission preserves the comparison, but cannot silently clear the reported choice/rationale/participants required by an already recorded decision.
- Audit before/after snapshots include the workflow automatically. Any validation/audit failure rolls back report, workflow, version and receipt together.
- The existing 64,000-byte JSON request ceiling remains unchanged.

## Validation

All required object keys must be present, unknown keys are rejected, and nullable fields accept JSON null rather than empty strings. Text bounds count UTF-16 code units using the existing validator, and required text uses its ECMAScript whitespace trimming rules.

Base workflow: schema version 1; status `comparing`, `recorded` or `reopened`; nullable UUID owner; nullable finite exact `YYYY-MM-DD` dates in years 0001–9999; at most 20 requirement references; 1–6 unique UUID option IDs; optional chosen UUID that must exactly identify one current option; reopen criteria up to 2,000 units. Each option requires a nonblank label up to 200, description up to 2,000, each manual weight/space/cost/reliability/time note up to 1,000, and up to 20 evidence references. All references use the unchanged Sprint Review reference validator.

A new owner must be an active student or lead. The identical historical owner can remain when inactive or unavailable; this never restores their writing permission. A recorded workflow additionally requires an owner, decision date, chosen option, nonblank reported decision/rationale/reopen criteria and at least one valid reported student participant. Comparing and reopened records can remain incomplete.

Optional SWOT: exact `strengths`, `weaknesses`, `opportunities`, `threats` strings, each at most 2,000 units. SWOT does not generate score or approval.

Optional engineering trade study:

- Exact `criteria` and `assessments` arrays, at most 8 and 48 entries respectively. Empty arrays and partial measurements are valid drafts.
- Each criterion has a unique UUID, required label up to 200, required unit up to 50, numeric weight from 0 through 1,000, explicit numeric scale minimum less than maximum, direction `higher` or `lower`, a Boolean `must_have`, and nullable minimum/maximum hard-constraint bounds.
- Scale bounds, constraint bounds and raw measurement values are finite numbers from -1e12 through 1e12. Numeric validation and ordering use double precision to match the browser's IEEE-754 representation. Raw JSON endpoints that collapse to the same JavaScript number, and unrepresentable overflow/underflow, are rejected rather than storing an unreadable comparison. Constraints marked must-have require at least one bound; unmarked constraints require both bounds null; a pair requires minimum <= maximum.
- Each assessment references an exact option/criterion ID in this comparison, with only one entry per pair; it contains a nullable raw numeric value, reason up to 2,000, and at most 20 valid evidence references.
- No normalized score, rank, weighted total or computed selection is accepted or persisted. Derived comparison results use raw measurements in the frontend.
- A team may report a chosen option that fails a hard constraint. The interface must make that conflict visible; the backend does not give the scoring algorithm authority to overrule the students' reported decision.

## Security review and local verification

Security review: no new definer endpoint, public/private schema grant, policy, broad owner permission or direct table access was introduced. The existing guarded public RPC remains the only write route. No user-editable metadata is used for authorization. Readonly accounts retain permitted reads but cannot write; inactive actors cannot read recovery; an active actor whose assignment was removed may recover only the minimal receipt of their own earlier request.

The same-day Supabase changelog index and current official database-function guidance were reviewed. The index's PostgreSQL 15.19/17.11 notice concerned extensions/operators not changed here; its detailed linked page timed out. Current function guidance: https://supabase.com/docs/guides/database/functions. Local native checks use PostgreSQL 17.6 and do not claim production-version compatibility or replace a deployment review.

Run functional tests:

    npx playwright test tests/design-decision-db.spec.ts --workers=1 --reporter=line

Run true multi-session PostgreSQL tests:

    DESIGN_DECISION_PG_BIN=/path/to/postgresql-17/bin node tests/native/design-decision-concurrency.mjs

The native harness starts a disposable synthetic cluster on `127.0.0.1:55447`, distinct from the Sprint Review harness's port. It clears inherited PostgreSQL connection settings, never loads production credentials, and shuts down/removes its temporary database. PGlite checks include a forced migration rollback and exact comparison of unchanged helper definitions, all helper security settings/ACLs, relation security settings and save grants. Only the intentionally extended `update_json` body is exempted from the body comparison. Functional cases cover the real parser, legacy omission/null clearing, strict nested validation, recorded completeness, historical owners, permissions, stale versions, exact/payload-conflicting replay, actor recovery and audit rollback. Native cases exercise unique-create and version races, exact replay and payload conflict, cancellation ordering, role/assignment/season changes while blocked on the advisory lock, legacy retention, actor isolation and audit rollback.

Verified on 2026-10-07 UTC: all 19 PGlite groups pass on the final numeric-hardening, migration-lock and historical-owner contract, including the actual frontend parser and editable-payload adapter. Earlier, all 13 native PostgreSQL 17.6 multi-session/transaction checks passed against the expanded trade-study/SWOT contract. That native suite was not repeated after the later validation/read-projection fixes: an executor restart removed the temporary PostgreSQL binary. The native harness remains committed for rerun. Official CLI `db advisors --type security` had reported “No issues found” against a separate loopback-only disposable database before those final hardening changes; no remote project was queried. Final catalog/ACL regression checks and `git diff --check` passed. Local passing results do not authorize release.
