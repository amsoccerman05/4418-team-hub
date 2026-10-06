# Fabrication V1: local backend contract

This is a local draft. No production SQL writes, Storage objects, external uploads, account changes, or deployment were performed. The additive migration was created with official Supabase CLI 2.119.0 as `20261006201639_fabrication_v1.sql`. It depends on the existing Planning and Sprint Review migrations and Supabase Storage schema.

## Canonical projects and immutable part revisions

Fabrication references `planning_boards.id` where `kind = 'project'`; season, project identity, active state and visibility remain canonical Planning data. It creates no parallel project register and does not alter existing Planning/Sprint Review functions, grants, policies, task ownership or assignments.

A part has one mutable queue state and a strictly versioned immutable revision history. Every revision stores the entire manufacturing metadata snapshot: name, material, positive stock thickness and `thickness_unit` (`mm` or `in`), separate explicit DXF `drawing_unit` (`mm` or `in`), positive integer quantity, finite needed-by date, optional HTTPS Onshape document reference and notes. Drawing units never derive from thickness units or a filename. Each revision requires a newly supplied DXF; a PDF drawing is optional and is never silently copied from the previous revision. Neither file is replaced in place.

Limits count JavaScript UTF-16 units: name 200, material 120, notes/status reason 2,000, optional Onshape URL 2,000; filenames accepted by SQL are at most 150 units (the gateway applies its stricter safe-name bound). Thickness is greater than zero and at most 1,000 in the explicitly chosen unit; quantity is an integer from 1 through 100,000. Dates are exact ISO dates in years 0001–9999. An Onshape reference must point to `https://cad.onshape.com/documents/{alphanumeric-id}` with an optional following path/query/fragment, without credentials, ports, backslashes, whitespace/control characters or traversal. No automatic Onshape fetch, export, access grant or conversion happens.

Stored `created_by`, timestamps, revision numbers, current state and audit provenance are server recorded. UI payloads cannot forge them. Removed profiles may remain as historical UUID references; current capability always comes from the current active profile. Historical claimant names are projected safely as bounded labels or “Unavailable teammate.”

## Current permissions

The user explicitly authorized any active teammate to operate the queue. Active `student`, `lead`, `mentor` and `admin` profiles can claim available parts and operate their own claim, subject to current canonical project and season rules. `readonly` profiles can read available work but cannot submit, claim, review or progress it. Inactive accounts cannot read, recover or mutate Fabrication data. There are no training records or checks.

Submission/revision remains limited to current Planning management or the canonical Sprint Review project lead/supporters. That assignment grants no additional Planning task authority. All operations re-read current records instead of trusting cached JWT metadata or browser capability booleans. Service ingress uses an explicit actor supplied only after the Edge gateway validates the bearer token with `auth.getUser()`; browser-provided actor fields are never authoritative.

Canonical Planning management is reproduced for the service actor from the same active profile roles, active positions, unrevoked assignments and exact position allowlist as `planning_private.manager()`. It must stay in sync if Planning's permission model changes. No existing helper is replaced.

Managers can read draft/archived seasons and inactive boards. Ordinary active members read active-season/active-board projects only. Writable projects must be active, nonarchived and in an active season unless the actor is a Planning manager. An archived season/inactive board is never writable, including by managers. Current membership and project authority are checked for reservation, reservation replay, pre-upload authorization, finalize, transitions, context and every download. Status/cancel are deliberately minimal actor-owned recovery endpoints: an active actor who lost project access may resolve only their own opaque receipt, never retrieve the draft, files, project name or lease paths.

## Workflow and claims

The normal path is `needs_review → ready → in_progress → done`.

- Claim: any eligible current operator claims an unclaimed, unfinished part. Optimistic version and the shared locks serialize competing claims.
- Acknowledge: only the current claimant can acknowledge the exact current revision. Start and Done require that acknowledgement and review to still match the current revision.
- Ready: the claimant or an active mentor/admin can review a part in `needs_review` and mark that exact revision Ready.
- Start/Done: only the current eligible claimant can progress Ready to In progress and In progress to Done.
- Hold: claimant or active mentor/admin may place unfinished work on hold with a required reason. It clears review and acknowledgement.
- Rework: claimant, active mentor/admin or currently authorized project submitter may reopen a non-review state to `needs_review`, with a required reason; review and acknowledgement clear.
- Release: claimant or active mentor/admin can release the claim. Release during work resets to `needs_review`; acknowledgement always clears.

Every new revision preserves the existing claim but resets status to `needs_review`, clears review and acknowledgement, and increments the part version, including when the part was Done. Previously loaded actions with stale version or revision ID fail. `status_note` is the current workflow action note/reason and is preserved by claim, acknowledgement and release; metadata notes remain in the immutable revision.

## Browser API

Concrete types live in `src/fabrication/types.ts`; synthetic examples live in `tests/fixtures/fabrication.ts`.

- `fabrication_context(selected_season uuid default null, selected_project uuid default null)` returns `FabricationContext`: current actor/permissions, canonical seasons/projects, up to 200 visible parts with their current revision, all revision history for those listed parts, and explicit `parts_limit_reached`. A direct project link resolves its actual authorized season; an explicit mismatched season fails instead of falling back. Unfinished parts sort before Done, then by needed date. The aggregate view may be bounded; a project drilldown is complete because a project cannot exceed 200 current/pending part IDs.
- `fabrication_part_version(part_id uuid, expected_actor uuid)` returns only the current positive integer part version, after exact actor binding, active membership and current canonical project visibility checks. Only authenticated callers may execute it. The UI can poll the one open part cheaply and reload full context only when its version changes; no revision history, filenames, paths or draft content is returned. Readonly members may read visible versions; inactive/revoked/hidden scopes fail closed, with canonical manager read exceptions for archived seasons and inactive boards.
- `fabrication_mutate(action text, request_id uuid, expected_actor uuid, p jsonb)` accepts `claim`, `release`, `acknowledge`, `ready`, `start`, `done`, `hold`, `rework`. Payload is exactly `{part_id, version, revision_id, note}`.
- `fabrication_mutation_status(request_id uuid, expected_actor uuid)` returns one minimal actor-bound receipt.
- `fabrication_cancel_mutation(request_id uuid, expected_actor uuid)` installs a permanent cancellation tombstone if nothing has committed. A committed request returns its applied receipt; cancellation never undoes a committed part or revision.

Every request is bound to `expected_actor = auth.uid()` and current active membership. Terminal receipts contain `{request_id,status,action,entity_id,version}`. `applied` has a real action (`revision` for uploads), part ID and committed version. `pending`, `unknown` and `cancelled` have null action/entity/version. `pending` means a bounded upload reservation exists, not that its files or part committed. A frontend may retain only `{request_id,expected_actor}` after closing/signing out; metadata, files, bearer tokens and context must be cleared.

All mutation/recovery/ingress functions acquire team authority lock `pg_advisory_xact_lock(4418)` before Planning lock `(4418,30)`. They check current authority after the locks. Same actor/request plus identical original payload/manifest returns the same outcome; reuse with changed content fails. Applied mutations and their audit/receipt commit atomically. A timeout proves neither failure nor success: recover or cancel the same key. Revision paths never depend on retry-generated random data. Once reserved, a part UUID cannot move to a different canonical project, including before finalize.

Stable sanitized SQL codes: `FB401` account changed, `FB403` unavailable/current permission, `FB409` stale state/version, `FB412` request-key reuse, `FB413` finite capacity reached, `FB422` invalid fields/files, `FB500` other unavailable service. Internal row details and hints are suppressed.

## Private file ingress and download

The browser cannot upload, select, sign a URL for, replace or delete any object in the `fabrication-private` bucket. Restrictive Storage policies enforce this even if an unrelated application has an overly broad permissive policy. The bucket is private, limits individual objects to 20 MiB and allows only `application/dxf`/`application/pdf`. The gateway additionally restricts PDF to 10 MiB and validates actual bytes before any reservation/write, including the DXF structure and optional PDF content. See the file gateway implementation/tests for its supported DXF/PDF subset.

The gateway-only RPCs are granted exclusively to `service_role`:

1. `fabrication_reserve_upload(actor, request_id, p, manifest)` validates current submission authority, the complete submission, sizes/hashes/names, optimistic part version and finite quota. It returns `{receipt,reservation}`. A live reservation contains `{lease_id,revision_id,bucket,dxf_path,pdf_path,manifest}`; applied/cancelled returns null reservation. Manifest is `{dxf:{name,size,sha256},pdf:null|{name,size,sha256}}` with lowercase SHA-256 hashes calculated from bytes by the gateway.
2. `fabrication_upload_authorize(actor, request_id, lease_id)` rechecks current authority and returns the same envelope before each file operation. The gateway writes only those paths, with `upsert:false`, content type, exact size and `metadata:{sha256}`. Identical existing objects may be recovered only after downloading and matching actual bytes, size and hash.
3. `fabrication_finalize_upload(actor, request_id, lease_id)` rechecks all current authority, part version and exact reservation. It requires both expected Storage objects with matching stored size, SHA-256 metadata and MIME type, then atomically creates the immutable revision, updates the part, clears old acknowledgement/review, writes audit and installs an applied receipt. SQL metadata checks supplement the trusted Edge byte validation; SQL never claims to parse remote object bytes itself.
4. `fabrication_cancelled_upload_paths(actor, request_id, lease_id default null)` returns only `{bucket,paths}` for that actor's terminal-cancelled request, after current membership and available project checks. A cancelled-before-reserve tombstone returns an empty list. Applied, unknown and pending are refused; a supplied lease must match. The gateway may delete only these paths after definitive cancellation. It rechecks after uploads to clean a raced cancellation. Unknown finalize outcomes never authorize deletion. All reservation records remain quota charged after cleanup.
5. `fabrication_download_file(actor, revision_id, file_kind)` validates current membership and canonical project visibility and returns one exact finalized descriptor `{bucket,path,name,size,sha256,content_type,revision_number}`. The gateway proxies the bytes as an attachment named with immutable revision number, rechecks permission and sends no-store headers. No public/signed bearer download URLs are created. Previously downloaded bytes cannot be remotely revoked.

Object paths are server-built `{board_id}/{part_id}/{revision_id}/drawing.dxf` and optional `drawing.pdf`. Filename metadata cannot control bucket, path or lease. No browser direct-table or service direct-table privileges exist for Fabrication records; the service has only those guarded ingress/download RPC grants. The trusted Storage client still necessarily has the service credential and must remain server-only.

## Finite storage and recovery budget

Atomic reservation caps are five pending uploads per actor, 1,000 lifetime reservations per actor and project, 50 lifetime revision reservations per part, default reserved-byte budgets of 128 MiB per project and 256 MiB across Fabrication. Those byte budgets come from the singleton private settings row, rather than from a hardcoded reservation allowance. Every attempted reservation consumes its byte/revision budget permanently, even after cancellation and cleanup. A hard-crashed or late upload is therefore bounded; a timeout never frees bytes for a stale writer to recreate.

The `fabrication_private.settings` table has RLS enabled, no PUBLIC/anon/authenticated/service_role table privileges and no browser or service mutation API. Exactly one true singleton key is permitted. Constraints require positive budgets with project budget ≤ total budget ≤ 1 GiB. Every reservation, including replay, reads this row and fails closed if it is absent. Changing the budgets requires reviewed privileged administrator SQL under the same authority locks and current plan/shared-storage usage evidence, including other buckets. The defaults do not promise available capacity, authorize a plan upgrade or allocate capacity belonging to other features. Existing reservations stay charged; a lower budget blocks new capacity rather than deleting existing parts or files.

The 200-part project limit counts the union of existing parts and noncancelled reservations for new part IDs. Revising an existing part does not consume a new part slot. Cancelling an uncommitted new part releases only that part slot; the reservation's lifetime byte/revision budget remains charged. The aggregate 200-part read limit cannot hide an unviewable 201st part within a project.

Terminal cancelled objects should be cleaned by the gateway. A process crash can leave bounded private orphan bytes; operational release needs a reviewed service-side janitor that enumerates only terminal-cancelled leases, uses the Storage API (never raw `storage.objects` deletion), and does not release charged reservation quotas while old writers may still finish. This first draft does not ship a timer, janitor, destructive reset or quota-reclamation API. Capacity exhaustion is an explicit administrator-review blocker, never a reason to accept unlimited uploads.

## Isolation and local verification

New public tables are `fabrication_parts` and `fabrication_revisions`. Private tables are settings, requests, reservations and immutable audit history. All six have RLS enabled and direct PUBLIC/anon/authenticated/service_role privileges revoked. All private helper/schema/sequence privileges are revoked. Public API functions pin an empty search path and fully qualify relations. Revisions, terminal receipts, reservations and audit reject updates/deletes. No destructive public API exists. A forced-migration-failure test proves atomic rollback and unchanged pre-existing Planning/Sprint function definitions.

Run the focused and canonical regressions:

    npx playwright test tests/fabrication-db.spec.ts tests/planning-db.spec.ts tests/planning-owners-db.spec.ts tests/sprint-review-db.spec.ts --workers=1 --reporter=line

Run true concurrent synthetic PostgreSQL tests:

    FABRICATION_PG_BIN=/path/to/postgresql-17/bin node tests/native/fabrication-concurrency.mjs

The harness creates an isolated temporary database, clears inherited PostgreSQL settings, listens only on 127.0.0.1, and shuts down/removes its own data. It never loads production settings. An optional `FABRICATION_SUPABASE_CLI=/path/to/official/supabase` runs the official local security advisors before teardown.

Final local verification: all 16 Fabrication PGlite groups passed, plus 28 gateway/byte-validation tests and 15 frontend model/service tests (59 focused checks). Three editor contract checks passed. The broader non-browser regression run passed 395 cases across 27 spec files before the final byte-budget adjustment; the final 16-group Fabrication run covers that adjustment. All 13 native PostgreSQL 17.6 multi-session checks were repeated against the final migration. Official Supabase security advisors reported zero findings on that disposable synthetic database.

Coverage includes actual RPC→frontend parser roundtrip, immutable metadata/files, explicit units, any active eligible member's own claim, stale actions and revision invalidation, current roles/assignments/project/season scope, lightweight version-read scope, required reasons, strict input boundaries, actor-bound exact replay/status/cancel, terminal cleanup, Storage restriction despite a synthetic broad policy, administrator-only configurable byte budgets and missing-setting failure, finite pending/project-byte/part budgets, cross-project UUID stability, status-note preservation, audit/migration rollback, direct access denial and real lock-wait authority changes. The browser scenarios are defined but were not executed in this environment. Local results do not establish deployed Storage compatibility or authorize release.
