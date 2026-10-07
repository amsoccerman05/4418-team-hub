# 4418 Team Hub

React + Vite + TypeScript Team 4418 IMPULSE launcher with Attendance V1. Launcher links are public; attendance requires an existing active Team 4418 Supabase Auth account. Inventory and Pit keep their existing authentication and behavior.

## Local development

Use Node 24:

```sh
npm ci
npm run dev
```

The Hub uses port 4420; tests use 4422, leaving Pit/Inventory servers alone.

## Configure links

**`src/links.ts` is the only destination configuration file.** Inventory, Pit Operations, and the Team Website use the supplied URLs. FIRST Dashboard, Slack, Monday, and Canvas are intentionally `null`: their exact team-specific URLs were not found in the locally inspected sources. Replace those nulls with confirmed HTTPS URLs, then rebuild. Unconfigured resources render readable non-clickable placeholders; no URLs are guessed. Do not include secret invite links, API keys, credentials, or private tokens in this public file.

4418 Systems are prominent cards and open in the same tab. Team Resources are explicitly external and configured links open in a new tab with `noopener noreferrer`. Keep future integrations separate from this static configuration and UI; none are implemented now.

## Shared visual language

`src/tokens.css` is copied from standardized Pit tokens derived from Inventory, including its readability overrides. It retains DM Sans / Manrope, brand `#224d3e`, primary `#28583f`, background `#f6f8f6`, white panels, established borders/radii/shadows and spacing. Google Fonts is the same font source used by Inventory/Pit; sans-serif fallback works if unavailable. `public/branding/` contains byte-identical official emblem/wordmark copies and original attribution. This single-page launcher uses the suite header rather than adding a redundant sidebar or mobile menu.

## Checks

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Browser checks verify the configured destinations, same-tab/new-tab rules, safe placeholders, loaded branding, no page errors, and no horizontal overflow at 390, 768, 1280, and 1440px. Screenshots are generated under ignored `test-results/`.

## GitHub Pages and custom domain — prepared, not deployed

No DNS or existing application settings are modified. Launcher links work without environment variables; Attendance requires the two public Supabase values documented below.

1. Create a **separate GitHub repository named `4418-team-hub`** under your desired owner. For GitHub Free Pages, use a public repository; if you choose private, confirm your plan supports Pages. Do not use the Inventory or Pit repository.
2. Add that repository as this local repository's `origin`, then push `main`:

   ```sh
   git remote add origin https://github.com/YOUR_OWNER/4418-team-hub.git
   git push -u origin main
   ```

3. In the new repository's **Settings → Pages**, select **GitHub Actions**. Run **Check and deploy Team Hub** from Actions if the initial push ran before Pages was enabled. The workflow runs TypeScript/build and browser checks before deployment.
4. In **that repository only**, set Pages custom domain to `team.frc4418.org`. The relative Vite base supports both the repository URL and custom domain. Actions deployments use the Pages domain setting; a CNAME file is not required.
5. Add DNS manually after confirming the actual repository owner/Pages hostname:

   | Type  | Host   | Target                 |
   | ----- | ------ | ---------------------- |
   | CNAME | `team` | `YOUR_OWNER.github.io` |

   If the new repository is under the same confirmed owner as Pit (`amsoccerman05`), the exact target is **`amsoccerman05.github.io`**. Use the hostname only, not a repository path or URL. Leave root, www, inventory, and pit records unchanged.

6. Wait for GitHub's domain validation and certificate, enable **Enforce HTTPS**, and verify `https://team.frc4418.org/` and its resource links. Do not bypass certificate errors.

Launcher deployment does not require SSO or API integrations. Attendance setup is described below.

## Attendance V1 — manual setup

1. In the **existing shared Team 4418 Supabase project**, open **SQL Editor → New query**, paste the entire `supabase/migrations/202609100001_team_attendance.sql`, review it, and click **Run** once. It requires the existing `public.profiles(id, display_name, role, active)` contract. It creates only Attendance objects, without changing profiles, Inventory, or Pit. Do not run against a separate project or apply automatically. The migration has not been applied by this implementation.
2. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to that existing project's URL and `VITE_SUPABASE_ANON_KEY` to its **publishable/anon public key**. Never use a secret or service-role key. No production values were available in this Hub repository; none were guessed or copied from other apps.
3. For Pages, set the same two values under **this Hub repository → Settings → Secrets and variables → Actions → Variables**. The workflow supplies them only to the build. Rebuild/redeploy after changing them. No Auth redirect configuration is needed for this password-sign-in flow. No DNS changes are part of Attendance setup.
4. Sign in with an existing active lead/admin/mentor account. Under **Attendance → Manage attendance → Membership & team areas**, review registration and areas **before creating meetings**. Accounts absent from attendance membership default to Prospective; inactive shared profiles are excluded. Lead accounts can also have attendance records and use **My Attendance (lead)**. Readonly accounts have no attendance access.
5. Create a meeting, open check-in within 30 minutes before its start, and share its temporary six-digit code with attendees. Rotate to renew the code (up to 30 minutes, never beyond scheduled end). Close check-in and finalize after scheduled end. A never-opened meeting can be closed and finalized too. Missing required attendees become Absent. Finalized records allow audited leadership corrections, but students cannot change finalized records.

### Scope and policy

- Six public tables: `team_attendance_members` (attendance-only registration/area metadata), `team_meetings`, `team_meeting_members` (immutable requirement snapshot), `team_attendance`, `team_attendance_strikes`, and `team_attendance_history`.
- Four public RPCs: `team_attendance_roster()`, `team_attendance_manage(action, p)`, `team_attendance_check_in(meeting_id, code)`, and `team_attendance_notice(meeting_id, reason)`. Management actions: `member`, `create`, `open`, `close`, `finalize`, `attendance`, `strike`, `rescind`. Private helpers enforce roles and append audit history.
- Existing active roles are read from `profiles`; authenticated clients have RLS-filtered SELECT only. Students see only their own attendance/snapshot/strikes/history and meetings whose roster includes them. Leads/admins/mentors manage all attendance. Codes/hashes and other students' selection lists are not selectable. Writes go through role-checked security-definer RPCs with fixed search paths. No privileged frontend key.
- Check-in uses server time and the authenticated user's ID, serialized with meeting transitions. Five incorrect attempts per student/meeting per 15-minute window; attempts persist even when the client receives an invalid-code message. Repeated successful check-ins are idempotent. Codes are salted with meeting ID and hashed in the database, not stored in browser persistence or audit history. The code is visible only on the device that opened/rotated it.
- Required meetings snapshot registered members (all or selected areas), explicitly selected active students (including prospective), or nobody for optional meetings. Later membership changes never rewrite history. New accounts created after the snapshot are not on that meeting's roster; leadership should create meetings after reviewing membership. Inactive attendance members are excluded from new snapshots.
- Physical attendance and excuse review are separate fields. Students submit one timestamped notice/reason for leadership review; later corrections go through leadership and retain history. A notice does not auto-excuse or auto-assign strikes. The UI distinguishes at least 24 hours' notice from shorter notice.
- Percentages use required **finalized** meetings, exclude Excused/Not Required, and count Present, Late, and Left Early as attended. Empty denominator displays a dash. Late and early departure remain visible. A pending excuse request stays in the denominator until approved. Default grace is 10 minutes (strictly more is Late); leadership can choose a meeting-specific threshold. A Left Early correction requires a departure timestamp during the meeting.
- Multiple strike rows may reference the same attendance incident, each with category, positive quantity, explanation, actor, and time. Active totals are derived, never editable. Rescind with a reason and assign a replacement to correct a strike. No deletes or in-place strike edits are exposed. Three active strikes require warning/parent contact; five require leadership review for possible removal. No automatic removals, profile changes, or access restrictions.
- No realtime subscription is added: mutations refresh attendance and a Refresh button fetches changes from other devices. History is loaded on demand (latest 100 entries per meeting); database history is retained in full. Attendance/snapshot/strike reads paginate to avoid the usual API row limit silently truncating summaries.

### Attendance verification

`npm run build` includes TypeScript. `npm test` runs the launcher/browser checks plus local PostgreSQL (PGlite) migration, RLS, RPC, policy, and audit tests. Tests never contact production: browser tests use an intercepted `.invalid` Supabase hostname; SQL tests use disposable in-memory Postgres with mocked `auth.uid()` and profiles. Student and lead flows are checked at 390px and 1440px. This verifies local enforcement but does not replace a live smoke test after you apply the migration and configure the existing project. Verify real student isolation and a leadership check-in/finalize/review flow before team rollout.

## Family event guides

KCMT 2026 has a team event overview at `/#events/kcmt-2026` and a public family guide at `/event.html#kcmt-2026`. The guide includes the tentative organizer schedule, optional Friday activities, venue and clearly labeled family logistics awaiting confirmation. It requires no sign-in and reads only a separately curated static public document; it never reads team records or Planning tasks. See [event-page content and release guidance](docs/EVENT-PAGES.md) before adding or publishing information.


## Fabrication V1 — local draft

Fabrication reuses existing Planning project boards and supports multiple immutable part revisions per project, a cross-project Ready queue, operator claims, current-revision acknowledgement, and private DXF/PDF transfer. Drawing units and stock-thickness units are separate. All active eligible team members may operate their own claim; existing readonly, project and season restrictions remain in force.

This feature requires the reviewed additive Fabrication migration and private file gateway before deployment. They have **not** been applied to production. See [release and cost review](docs/FABRICATION-RELEASE-REVIEW.md), [backend contract](docs/FABRICATION-BACKEND.md), and [file gateway/format limits](docs/FABRICATION-FILES.md). Only synthetic records and files are used in tests.

Focused checks: `npx playwright test tests/fabrication-db.spec.ts tests/fabrication-model.spec.ts tests/fabrication-files.spec.ts --workers=1`. Browser flow checks: `npx playwright test tests/fabrication-ui.spec.ts --workers=1`; synthetic review screenshots go under ignored `test-results/fabrication/`. Native concurrent transactions: `FABRICATION_PG_BIN=/path/to/postgresql-17/bin node tests/native/fabrication-concurrency.mjs`.

## Assembly & Testing

Planning project boards now include an Assembly & testing view with manufactured-part facts, manual purchased-component status, links to existing Planning tasks, revision-specific checks/rework evidence, and explicit immutable snapshots for Sprint Review drafts. The additive Assembly migration depends on Fabrication. See [scope, access, and release requirements](docs/ASSEMBLY-TESTING.md).

## Design decisions and engineering trade studies — review draft

Project boards include a Design decisions entry into the existing Sprint Review update. Compare engineering alternatives with team-defined units, weights, explicit scoring scales, separate must-have constraints and evidence; optional SWOT adds context. Students record their choice, rationale and reopening criteria, linked to canonical Planning work and existing architecture source IDs. Unknown measurements remain unknown and no winner is selected automatically.

Requires the additive design-decision migration before use; it has not been applied to production. See [scope](docs/DESIGN-DECISIONS.md), [backend contract](docs/DESIGN-DECISION-BACKEND.md), and [verification](docs/DESIGN-DECISIONS-VERIFICATION.md).

## Upcoming meeting editing and Attendance help — review draft

Attendance includes a student-facing **How to use Attendance** tab and contextual help. Existing meeting leadership can edit the title, type, or available start/end fields of one meeting before it starts. Schedule changes preserve rosters and requests, require review, and invalidate the temporary check-in code; recorded attendance and decisions lock the schedule. See [scope, safety, release status, and verification](docs/ATTENDANCE-MEETING-EDITING.md). The additive editing migration is prepared but has not been applied to production.

## Saturday meal signups — disabled runtime draft

An accountless parent meal page, signed-in mentor/admin coordinator view, durable PostgreSQL gateway, server-verified Auth, and Resend delivery/recovery adapter are implemented in [draft PR #15](https://github.com/amsoccerman05/4418-team-hub/pull/15). The Deno runtime, live mail, worker dispatch, and SQL mail budget all remain disabled until separately approved configuration and deployment. `npm run dev:meals` still provides the synthetic loopback-only preview with `.invalid` recipients and no real email. No production migration was applied or family data imported. Current checks include 141 meal logic tests, 17 native PostgreSQL groups, browser review, and five real Auth/API groups; the served Edge runtime now starts successfully, but its database DNS path returns HTTP 503; a verified owned-container address fix is awaiting CI. See [verification status](docs/MEALS-VERIFICATION.md), [runtime configuration and activation requirements](docs/MEALS-RUNTIME.md), and [scope/privacy review](docs/MEALS-REVIEW.md). Existing KCMT pages/forms and the held year-round parent hub remain unchanged.

## Mentor volunteer hours — local review draft

Attendance has a separate mentor/admin **Volunteer hours** view for actual volunteer clock-in/out, past entries, own corrections with history, and CSV exports. Active admins can see team aggregates. Running or voided entries never count as completed hours, and student attendance and strikes remain independent. The additive migration and UI are not deployed by this draft. See [mentor instructions, backend contract, verification, and release checklist](docs/VOLUNTEER-HOURS.md).
