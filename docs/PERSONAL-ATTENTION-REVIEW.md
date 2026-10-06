# Personal follow-through: local first slice

Status: staged locally; no production reads, schema changes, notification sends, push, or publication. Based on Team Hub `4aadc3d01e54b503478e418513feefb45eff4de2`; existing onboarding changes were left untouched.

## What changes

The existing **Needs your attention** surface now combines its existing Finance/Attendance actions with a small preview of the signed-in person's assigned Planning tasks and Pit repairs. There is no second inbox, new badge, or manufactured unread count.

- Planning shows unfinished, currently assigned tasks on active boards. Project work is restricted to the active season; functional-area boards keep their existing cross-season behavior. Shared ownership appears once. Blocked tasks come first, followed by overdue, today, and later work. Done, unassigned, inactive-board, draft-project, and archived-project tasks are omitted.
- Pit shows the three most recently updated unresolved repairs assigned to the signed-in person, including deferred work and unresolved work from prior events. An exact server count makes truncation explicit. This is a recent preview, not a severity-ranked or exhaustive list.
- The sources load independently after the existing dashboard authorizes the actor. One failing or missing integration cannot hide the other or masquerade as “all caught up.” Refresh replaces old results. Requests are bounded, aborted on replacement/unmount, and protected by the existing auth generation guard.
- Personal task links use `#planning/my-work/{UUID}` and only resolve to a currently visible assigned task. Completed tasks remain available through an old link while still assigned. Removed/archived/invalid tasks show an unavailable state without opening a detail dialog. Opening a link performs no mutation. Save completion and dismissal are guarded by the mounted instance, exact route, and editor-session identity, so a slow save cannot close or replace a newer task after Back/navigation. UUID hex case is normalized without relaxing the route grammar. Close/Escape clears the selected-task URL by replacement so Back does not reopen a dismissed dialog. Valid personal task links survive sign-in; signed-out screens remain private.
- Repair links use `https://pit.frc4418.org/#issue/{UUID}`. Release together with the independently staged Pit route support.

## Audited contracts and security choices

1. `planning_my_work_context(selected_season => null)` already filters task ownership on the server using `auth.uid()` and `planning_task_assignees`, returning one canonical task identity. It accepts no user identity argument. The frontend checks the returned `user_id` against the current auth event's user before using it.
2. `planning_private.member()` accepts an active profile. This implementation defers to that existing contract rather than inventing extra client-only role restrictions. Existing Planning RPC mutation policy remains unchanged.
3. Pit's existing SELECT RLS permits active known team roles to read Pit records; it is **not** an owner-only table policy. The new read uses `.eq('assigned_to', currentAuthUserId)` and an explicit unresolved-status list, selects only the six summary fields needed, and validates every returned assignment. This is a personal filtered read within existing domain visibility, not a new authorization boundary. No direct Pit writes or wider read grants were added.
4. Anonymous, inactive, and revoked actors were checked against local copies of existing policies. Reassignment disappears on the next read. Nothing is persisted in browser storage by this feature.
5. No service-role key, RPC with a caller-supplied actor, security-definer wrapper, view, migration, outbox entry, event trigger, or notification delivery was added.
6. Default Planning context has an existing limitation: with no season available to the actor it does not return functional-area work. This slice does not change that RPC. The normal active-season flow is covered.

Pit's baseline migration is copied byte-for-byte into `tests/fixtures/pit_operations_attention.sql` from `82195caaf89b57d6127faa5bc28174e34ac8fdbf`. It is a local policy fixture only. The Planning migrations under `supabase/migrations/` are unchanged.

## Verification

Passed:

- `npm run build` (includes TypeScript)
- 75 browser-free tests (run with an ignored local runner override; the repository’s standard Playwright configuration is unchanged) covering the new projection/SDK query contracts/SSR/PGlite authorization checks and existing dashboard DB, Planning ownership, Planning DB, notification center DB, and presentation regressions
- `git diff --check`

The new SDK-contract tests use a `.invalid` host and a synthetic fetch implementation. PGlite uses only disposable synthetic users and records. No production data was queried.

Browser fixtures are provided in `tests/personal-attention-ui.spec.ts` for 390/1440 widths, exact task links, dismissal/Back/Forward, refresh and resolution, partial errors, late responses after sign-out, delayed saves after Back/new-task navigation or unmount/remount of the same task, and private sign-in continuation. Chromium execution is blocked in this environment, so these are **not browser-verified**. SSR verifies structure/text/links, not actual layout, focus, browser history, or live Auth behavior.

Before release, use the unchanged standard configuration: `npm test -- tests/personal-attention-ui.spec.ts tests/dashboard-ui.spec.ts tests/planning-ui.spec.ts`. Run the remaining normal release checks, inspect phone/desktop screenshots, and perform an authorized staging smoke test with two different real test accounts. Verify the deployed Planning ownership RPC exists and the Pit deep-link implementation is included. Missing source schema/RPCs are visible errors, not silent empty states. No migration is required for this first slice.

## Proposed later targeted in-app events, for review only

Do not implement this section until the contract is approved. Keep the existing `notifications_private.events`, `recipients`, and `center_rows()` projection as the single notification infrastructure. No new general broadcasts, email, delivery jobs, or `team_notifications` outbox writes are needed.

### Smallest event scope

- **New assignment:** notify only each newly added active assignee. Planning uses the difference between the audited before/after owner sets. Pit uses an audited `assigned_to` change. Do not notify unchanged co-owners, the removed owner, all board members, or a whole functional area.
- **Material change to assigned work:** the separately reviewed allowlist should start with status changes into blocked / repair-severity escalation and due-date changes, directed only to the current active assignees other than the actor. Omit free-text edits, routine checklist/comment activity, self-updates, and repeated no-op saves. If the review prefers a stricter first step, ship assignment events alone.
- Do not backfill historical assignments or replay old audit events. Creating the migration must not send any notification.

### Persistence and visibility contract

- Insert one event per audited source identity and kind, with recipients deduplicated on `(event_id, user_id)`. Use canonical Planning audit identity (or task ID plus task version) and Pit audit-event ID; never a client-generated timestamp or broad table-update trigger on the reassigned join table.
- Prefer the existing committed audit write as the integration point. Planning replaces assignee relations during saves, so raw INSERT/DELETE triggers on `planning_task_assignees` would generate false assignment notices. Compare the canonical history's before/after sets instead.
- Store only minimal generic event copy and canonical object IDs, not descriptions, repair notes, private comments, owner names, or cached audience lists in client-visible payloads.
- Extend `center_rows()` with explicit `planning` and `pit` branches. Require current active profile, current object authorization, and current assignment when reading, marking read, counting unread, and computing action-needed. Reassignment, archival, or access revocation must make old notices invisible immediately. Done/resolved work clears action-needed independently of read state. Update `safeTarget()` to allow only the reviewed exact UUID routes and add source labels.
- Do not repurpose `read_at` as a completion flag. Keep per-recipient read state unchanged on retries and keep the personal attention card as the current-work source of truth.
- Make the event+recipient write atomic with the domain mutation, following the existing center's contract. Decide explicitly in review whether event persistence failure should block the domain save; current infrastructure uses transactional rollback.

### Required later tests and release gates

Test distinct/co-owned assignment sets, add/remove/re-add, actor suppression, inactive recipients, unrelated members, no-op saves, retries, rollback, stale concurrent versions, permissions revoked after event creation, done/resolved transitions, pagination and counts, and exact destination allowlisting. Assert every scenario creates **zero email/outbox rows**. Run full Supabase advisors and actual multi-session Postgres staging tests before any migration release; PGlite alone is insufficient for lock/concurrency confidence. Migration, trigger activation, and any real notifications require separate release approval.
