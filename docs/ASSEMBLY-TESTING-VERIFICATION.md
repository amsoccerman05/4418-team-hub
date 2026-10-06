# Assembly & Testing local verification

Date: 2026-10-06 UTC. All records and evidence URLs used by these checks are synthetic. No actual team/student records, CAD files, production credentials, production database changes, public code uploads, or deployment were used.

## Scope verified

- Existing Planning project view and explicit Sprint Review draft insertion compile with the application.
- Canonical Planning tasks are referenced, never copied into an independent task system. Existing read/write permissions are retained.
- Checks are append-only and reference exact immutable Fabrication revisions. Follow-up checks retain history; old-revision outcomes do not count as current outcomes.
- Board-version concurrency, current role/assignment/season checks after authority locks, actor-bound idempotency, cancellation ordering, immutable snapshot capture, and failure rollback were tested.
- Strict client readback was tested against actual local PostgreSQL-compatible data, including legal canonical Unicode, whitespace, infinities, BCE dates and extended-year dates.
- Evidence URLs are bounded, inert HTTPS references. Conservative ASCII-host validation rejects invalid punycode that could otherwise poison immutable record readback.
- Private tables have RLS and no direct client grants. Assembly leaves canonical Planning, Sprint Review, Fabrication, profiles, Inventory, Finance and Storage permissions unchanged.

## Passed checks

- Full browser-free regression: 449 tests passed across 32 isolated test files, with zero failed files.
- TypeScript and Vite production build passed. The existing large export chunk warning remains informational.
- Assembly database suite: 14 tests passed.
- Assembly model/service/session suite: 27 tests passed, including one real local SQL-to-client integration test.
- Native PostgreSQL 17.6: 13 multi-session concurrency scenarios passed.
- Official Supabase CLI 2.119.0 security advisors against the disposable local database returned no findings.
- UI fixture contract checks: 2 passed without a browser.
- Offline preview presentation check passed. It renders the actual shared React presentation and source styles, with no scripts or authentication material.
- All 755 application tests collect successfully. Assembly adds 74 checks: 14 database, 27 model/service/session, 1 offline presentation, and 32 UI-file cases (2 browser-free fixtures and 30 browser cases).
- Synthetic UI tests/fixtures also pass standalone TypeScript checking.
- The latest stacked Fabrication integration safety suite passes 7 checks. This does not claim the Assembly RPCs have passed real Supabase HTTP integration.
- Independent security review found and closed input/readback mismatches for invalid punycode and canonical Planning Unicode/whitespace/dates; no remaining access-control blocker was found.

## Browser and runtime limitations

Chromium could not launch in this cloud environment: its local process socket is denied with `process_singleton_posix.cc` / `socket() Operation not permitted`, including an approved local test invocation and a writable temporary browser home. No operating-system security setting was changed and no alternate route was used to bypass that restriction.

The 30 new browser cases are prepared, but their test bodies, responsive layout screenshots, keyboard interactions, stale-editor flows and end-to-end Snapshot Picker interaction have not run here. No screenshot was generated or visually inspected. The offline HTML preview is explicitly labelled synthetic and unverified in a browser; it is not a substitute for those checks.

Earlier combined PGlite/WASM runs exhausted runtime resources (SIGKILL/SIGTRAP), which also disrupted stateful legacy tests. The affected legacy files passed when isolated. `scripts/test-node-regression.mjs` runs each browser-free file in a fresh process to return WASM memory to the OS between files. The final isolated aggregate completed with all 449 tests passing across 32 files and no failed files.

Assembly-specific Supabase Auth/PostgREST HTTP smoke tests remain a release gate. Native PostgreSQL permission tests exercise roles and a synthetic `auth.uid()` fixture, not a production sign-in.

## Release gate

This is a local draft, not a merge/deploy recommendation. Before release:

1. Resolve the stacked dependency on the separately reviewed Fabrication PR 9.
2. Obtain authorization before any public review-branch upload, production migration, or deployment.
3. Run the full application browser suite in an environment that permits Chromium; inspect its synthetic desktop/mobile screenshots.
4. Run Assembly's additive migration and authenticated RPC round trips on a disposable Supabase stack; verify student lead/supporter, readonly, unrelated actor, archived project, and idempotent retry behavior.
5. Review the migration and preserve existing Storage permissions. No new upload or file-sharing permission is part of this feature.

Migration: `20261006213850_assembly_testing_v1.sql`

SHA-256: `e12f1f3a511f53df9904a2509117a642cdbbc5912ccd04d548c288bf1dc21836`
