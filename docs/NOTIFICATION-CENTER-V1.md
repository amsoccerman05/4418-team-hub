# Notification Center V1 — local implementation, review required

No production migration, deployment, email delivery, history replay, secret change, or provider configuration change is part of this implementation. Only Finance, Attendance and Announcements participate. Planning/Inventory/Competition Operations events and all preferences/digests/additional channels are deferred.

## Existing Finance flow and preserved behavior

`finance_private.history` → existing `finance_notification_outbox` trigger → production v6 `notifications_private.enqueue` → private `public.team_notifications` email outbox → existing `finance-notifications` worker → Resend. Recipient rules, actor exclusion, distinct approval slots, school-submitter fallback, immutable request preparation, delivery leases, bounded retries and `impulse-notification/{id}` provider idempotency keys are unchanged. The queue is not safe browser data: it contains frozen provider requests, email addresses and diagnostics.

V1 adds a BEFORE INSERT outbox hook that creates the canonical in-app event/recipient before a prospective Finance delivery row is committed. It does not enqueue additional Finance emails or replace Finance's history/enqueue functions. A migration-time Finance history ID watermark prevents an old event replay from becoming a new unread notification. No old rows are traversed/backfilled into the center. Existing server-only email repair behavior is not invoked by installation.

## Canonical model and transaction boundary

Migration: `supabase/migrations/202610050001_notification_center.sql` (local and unapplied).

- `notifications_private.events`: unique `(source,event_key)`, domain object UUID, current-event revision where needed, short safe title/message, server creation timestamp. No full domain payloads or email bodies.
- `notifications_private.recipients`: stable recipient notification ID, unique `(event_id,user_id)`, server-owned read timestamp. Identity and read state cannot be written directly by browsers.
- `notifications_private.center_epoch`: reviewed prospective Finance cutoff.
- Existing delivery outbox gains optional `center_event_id`. Its source-identity check is extended for Attendance while retaining the prior Finance/Announcement branches and all historical data. A partial unique index deduplicates Attendance email delivery per event/recipient/channel.

Finance identity is history ID + event kind; Attendance identity is authoritative public Attendance audit row ID; Announcement publication identity is announcement ID + version. Read state belongs to each recipient. Email retry updates the existing outbox row, not events/recipients. Domain action, audit, notification creation and enqueue are one database transaction; failures roll all of them back. There is no eventually-consistent browser enqueue path.

Attendance listens to the existing **public `team_attendance_history` table**, not the old private-history variant. A fresh request notice timestamp generates review notifications; transitions to excused/denied generate decisions; strike INSERT generates a strike notification. Check-in/check-out, physical corrections, warning records and strike rescission do not generate new V1 events. Request resubmission is a distinct audited event. No request reasons, reviewer notes or strike explanations enter previews/email payloads.

Announcement insert/publication or inactive→active transition creates in-app records for the existing audience predicate. Editing an already active announcement alone does not notify again. Existing explicit send-email/update-email generates or reuses the matching version event through the outbox hook. No new mass-email default or control is introduced.

## Recipient security and action state

`notification_center(filter,before_at,before_id)` derives the user solely from `auth.uid()`, checks active membership, returns at most 30 history records + five current actionable records + unread count, and supports tuple keyset pagination with a `has_more` flag. `notification_read(notification_id,unread)` marks one recipient row, or all currently visible rows when ID is null. Repeated mark-read preserves the first timestamp; unread clears only that timestamp. No recipient/user argument is accepted. Mark-all uses one statement snapshot; subsequently created records remain unread.

Private storage has RLS and no ordinary client grants. All private helper functions are revoked from PUBLIC/anon/authenticated. The projection exposes only notification ID, source, safe title/message, timestamps, safe link and current actionability. No provider diagnostics, IDs, payloads or recipient lists are returned. Current Finance visibility and Announcement visibility are reapplied; reviewer-only Attendance notifications disappear when review authority is lost. Requester Attendance records also retain existing role/read authority boundaries. Newly appointed reviewers do not inherit old recipients' notifications.

Actionability is computed server-side in one joined projection, separately from read state: Finance uses current revision/status, existing capabilities and remaining distinct-actor approval slots; school submission uses existing permission and authoritative complete approvals. Attendance requires current pending state, current reviewer authority, and non-self review. Reading never completes an action; completed actions remain in permitted history without the action badge. No action-state column is persisted. SQL uses a materialized current-user capability CTE and domain joins; no per-notification browser requests.

Attendance reviewer resolution mirrors Policy v0.3: active Mentor or active Program Manager with current position/profile eligibility. Admin alone is not silently promoted to reviewer. The existing worker calls the new service-role-only `team_attendance_delivery_allowed` RPC on every attempt; revoked/inactive/self reviewers and no-longer-pending review requests are skipped. Decisions and strikes target the affected active account only. The worker retains Auth account confirmation/banning/deletion checks. Frozen request/retry behavior is reused. `sent` remains provider acceptance, not proof of inbox delivery; no delivery claim is shown to recipients.

## Frontend and links

Team Hub has the bell/popover and `#notifications` page with All/Unread/Action needed, mark read/unread/all, refresh and Load more. The popover displays five actionable and five recent records at most. Refresh is initial/manual plus a two-minute visible-document timer; no focus-triggered reload or realtime system. Keyboard Escape closes the panel and returns focus, controls have touch targets, and read/action badges use text. Notification state is keyed to the already-existing signed-in user ID and clears on account change/logout. The Hub auth hook only exposes that existing ID; its authentication behavior and shared Suite Auth files are unchanged.

Finance links use the existing exact `https://finance.frc4418.org/#po/{id}` anchor/handoff. Attendance uses existing `#attendance/notices` or `#attendance/strikes` (no new detail route). Announcements use **`#home-announcements`**, the existing reader section, rather than the manager-only editor. Target-domain authorization remains authoritative. The frontend also allowlists these link forms. No credentials are placed in URLs.

My 4418's existing Needs your attention remains unchanged because historical actionable objects are deliberately not backfilled into the new center. Account-menu polish and suite-wide bells are deferred. No Planning event integration or shell change was made.

## Local verification and limitations

Focused PGlite tests cover actual Finance v6 enqueue/approval/request/school transitions, local production-variant Attendance audit/policy/request functions, announcement audiences, prospective creation, read/action independence, current visibility, direct-access denial, privacy, event/email deduplication, pagination and forced notification-persistence rollback. Mocked worker tests cover all four Attendance email kinds, rendering/escaping, send-time revocation, frozen retries, and existing Finance/Announcement behavior. Browser tests use controlled fixtures at 390px/1440px; they do not send emails or call production. Native multi-session checks are now completed below. Actual inbox delivery and a live production walkthrough are not claimed and require a separately approved rollout.

## Separate compatibility review before any rollout

Do not apply this draft automatically. Read-only production review must compare:

1. Current Finance v6 enqueue/history/visibility/capability/revision-approved definitions, outbox columns/source constraint/ACLs/claim and prepare/finish signatures, and actual deployed worker version.
2. Public Attendance history is a TABLE with the reviewed audit columns, uppercase INSERT/UPDATE actions, before/after JSON and current audit trigger. Compare reviewer/reader/profile-position semantics and request/decision/strike payload fields. Stop if production uses a different history facade or policy.
3. Team Communications announcement audience/visible functions, active/version fields, publication/send-email behavior and existing queue source constraints. Verify default grants, schema exposure and the absence of new object-name conflicts.
4. Current data integrity and index/query plans at actual notification volumes, including unread/action counts. No historical replay or backfill is authorized.

After separate approval and a fresh verified backup, the updated **existing worker must be deployed before this migration can enqueue Attendance email**, then apply this one migration transactionally, verify RPC grants/recipient isolation with controlled rolled-back fixtures, and deploy Hub. These are review instructions, not actions performed in this implementation. Keep worker diagnostics server-side. Do not roll back to an Attendance-unaware worker once Attendance rows can be queued. No email tests are authorized by this document.

Final local results: 59 distinct focused tests passed: 14 Notification Center database tests, 5 Notification Center UI tests, 6 affected Hub/navigation tests, and 34 Finance notification database/worker tests. Hub TypeScript/build, worker-module TypeScript, and Finance TypeScript/build passed. The final 19 Notification Center tests passed after deterministic pagination and the Finance transaction-rollback check. Desktop/390px screenshots were reviewed; no page overflow or runtime errors were observed. No commits, pushes, deployments or production writes are required for this local deliverable.


## Production compatibility/security review — 2026-10-02

Read-only Management API inspection matched the notification dependencies: production Finance v6 enqueue, Finance history trigger and capability/visibility/current-revision helpers; Attendance Policy v0.3 reviewer/reader and request/decision/strike audit functions; and Team Communications audience/publication/email functions. `public.team_attendance_history` is the authoritative RLS-protected **table**, with the expected before/after JSON and uppercase audit actions. The active-position helper chain requires active profiles/positions and unrevoked assignments, matching recipient resolution. Existing delivery source constraints and nullable Finance identifiers match the additive Attendance branch. The private notification schema grants usage/create only to postgres; new functions explicitly revoke default PUBLIC/client execution and pin an empty search_path. Public RPCs derive identity from auth.uid(), never caller-supplied recipient identity. Existing table policies are unchanged.

The deployed `finance-notifications` worker is ACTIVE **version 8**. All five original source modules extracted from its deployment archive (`index.ts`, `account.ts`, `email.ts`, `worker.ts`, `provider.ts`) exactly match the local HEAD baseline. The proposed account/rendering changes therefore extend the actual installed worker rather than an older fixture. No provider invocation occurred. No Notification Center object conflicts or migration ledger exist. Production uses manual migrations; verify objects directly after applying. Reusable read-only snapshot: `docs/NOTIFICATION-CENTER-PREFLIGHT.sql`. Rerun immediately before rollout and stop on a material difference.

No runtime defect or migration correction was needed in this review. Added `tests/native/notification-concurrency.mjs`: four native PostgreSQL 17 multi-session checks passed for same-event/recipient races, independent recipients, concurrent mark-read, mark-all overlapping an incoming event, and disjoint worker claims/duplicate retry completion without recipient recreation. This runner creates an isolated Unix-socket-only temporary cluster, clears inherited PostgreSQL connection variables, and removes the cluster afterward. Run from the Hub root with `node tests/native/notification-concurrency.mjs`; set `NOTIFICATION_PG_BIN` if PostgreSQL binaries are elsewhere. It never invokes an email provider.

All three domain hooks execute inside their authoritative database transaction, including event/recipient/outbox insertion. Forced persistence failures roll back domain data and audit together. Delivery occurs later through the existing leased outbox; delivery failure does not remove the in-app record. Decisions/strikes remain historical event notifications to the affected active account; review-needed delivery additionally rechecks current pending state and current non-self reviewer authority. Provider acceptance is not an inbox-delivery guarantee.

Retrieval is indexed by recipient user/event, with bounded 30-row keyset pages and five actionable rows. Current-user capabilities are computed once per projection; no browser N+1 calls are introduced. Exact unread/action counts necessarily evaluate the recipient's visible history, not only the current page. This is appropriate for V1; no production latency claim is made for the not-yet-installed RPC. Finance links target the exact PO; Attendance/Announcement links use existing authorized context routes, not new detail routes. My 4418 and Suite Auth behavior remain unchanged.

Review verification: **59 focused tests + 4 native multi-session checks passed**. Hub notification UI covers desktop 1440px and phone 390px, bounded pagination, keyboard behavior, unsafe-link rejection and signed-out privacy. Hub and Finance TypeScript/production builds and the affected worker-module typecheck passed. No production schema/data/configuration change, email, deployment or backup was performed.

### Required separately approved rollout

1. Create a **fresh native custom-format full production pg_dump** immediately before rollout. Include public Hub/profile/position/Attendance/Announcement/Finance tables, private Finance history and notification functions/outbox, relevant auth schema/identities, grants and dependencies. Verify `pg_restore --list`, required recovery objects and SHA-256; retain recovery notes and a secure backup location. Do not substitute a stale pre-Planning/Finance backup. No backup was created during this review.
2. Rerun `NOTIFICATION-CENTER-PREFLIGHT.sql`, compare signatures/bodies/constraints/grants and absence of new objects, and recheck the deployed worker baseline. Stop if assumptions differ.
3. Deploy only the reviewed update to the **existing Finance notification worker**, preserving its credentials/configuration. This must precede the migration that can enqueue Attendance deliveries. No test email or replay is part of this step.
4. Apply only `202610050001_notification_center.sql` once, as its BEGIN/COMMIT transaction. No historical replay/backfill or unrelated migration.
5. Verify new objects/grants and recipient isolation/actionability with read-only checks or controlled rolled-back fixtures. Verify existing Finance/Attendance/Announcement behavior and delivery contracts. Stop on failure before Hub deployment.
6. Deploy the reviewed Hub frontend. Verify bell/page, authorized links, recipient isolation, sign-out cache clearing and desktop/390px layouts. Do not create lasting fake domain records or send smoke-test emails. Any controlled email delivery requires separate explicit authorization.
7. Stop. Do not roll back to an Attendance-unaware worker while Attendance deliveries may be queued. Preserve recipient/event/history data if a correction is needed.

The reviewed implementation is ready for a separately approved rollout subject to that fresh backup and final unchanged preflight. No production rollout is authorized by this review.
