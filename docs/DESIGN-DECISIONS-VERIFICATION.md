# Local verification: design decisions and engineering trade studies

Date: 2026-10-07 UTC. This section records local verification before draft-PR publication. No production migration or deployment is included. The authorized public draft will run the full browser suite, final native concurrency checks and disposable Supabase integration in CI.

## Source and scope

The isolated checkout is `team-hub-design-decisions`, branch `dot/design-decision-local-v1`. Its base is local commit `af80e303a4dedad2b22d303d4e553e6c6a9cf286`, whose tree was verified identical to released GitHub main `a13b42c6ec7ba70e12c98f88a34619c266ba62ef`. Local ancestry must not be pushed as the public branch; replay this draft's delta onto verified current main if publication is later authorized.

The draft extends one existing project update per Sprint Review. It does not add a parallel decision register or change student/supporter/manager authorization. Training is untouched. All test records and evidence URLs are synthetic.

## Passed

- Production build and TypeScript, including the final historical-owner editor change. Existing Vite large-chunk warnings remain; no new dependency was added.
- 498 non-browser checks across 35 isolated spec-file runs, all exit 0. This includes existing Planning, owners, Sprint Review, export, Assembly, Fabrication, attendance, outreach, goals and other app regressions.
- After the final small historical-owner editor improvement, 51 affected model/SSR checks passed again: design-decision model (15), trade-study model (16), and existing Sprint Review model (20). This adds one new test to the prior 498-test aggregate; it is not an additional 51 unique tests.
- Final design-decision database coverage: 19 PGlite groups. Includes migration rollback, unchanged ACL/RLS checks, authorization and role changes, actor binding, version conflicts, audit atomicity, replay, old-client field omission, explicit null clearing, strict nested bounds, complete 8×6 studies, raw-JSON numeric precision, and historical-owner projection through the real parser.
- Engineering model coverage: normalization/direction, unknown measurements, zero weights, hard constraints independent of score, no ranking/winner, full-precision raw display, unsafe-link handling, and bounded data.
- Export coverage: source IDs, raw measurements, per-criterion scores and hard-limit results, failed plus unknown constraints, optional SWOT, final reasoning, canonical task metadata, and stable criterion/option identity on continuation pages.
- Independent read-only review. Findings about focused-route navigation, numeric parsing precision, historical owners, UUID case and export context were fixed and rechecked; no remaining blocking code finding was reported.
- Integration safety suite: 7/7 checks, plus syntax checks for the integration runner and new regression file. The native concurrency harness also passes syntax check.
- `git diff --check`.

Verification logs and the isolated test configuration are retained in the sibling `design-decision-verification` directory, outside the application source.

## Earlier real PostgreSQL checks

All 13 native PostgreSQL 17.6 multi-session checks passed against the expanded trade-study/SWOT contract. They cover exact replay, concurrent creation/version conflicts, cancel/save ordering, account/role/assignment/season changes while waiting for the shared lock, old-client retention and audit rollback.

These native checks were **not repeated after** the final numeric validation, migration-lock and owner-projection hardening: the execution workspace restarted and removed the temporary PostgreSQL binary. Those final changes passed the PGlite and parser regressions. The native harness is retained for a later rerun.

The official Supabase CLI security advisor reported no issues against a separate synthetic loopback database before those final hardening changes. No remote project was queried.

## Not verified here

- Browser interactions and screenshots. A system Chromium launch failed before opening a page with `socket() failed: Operation not permitted` and SIGABRT. No browser assertions or screenshot review are claimed. Nine browser scenarios are authored, covering 390/1440 layouts, trade-study save, explicit selection, unknowns and failed limits, SWOT, footer access, close/discard, readonly behavior, safe links, focused navigation and Planning entry. Future PR CI is configured to retain only synthetic review screenshots.
- Real Supabase Auth/PostgREST execution. Docker preflight found no working daemon at `/var/run/docker.sock`. Nine new integration groups are wired into the existing disposable, loopback-only runner; official CLI prepare-only and safety checks passed before the restart. The real-stack tests have not executed.
- Production schema compatibility, authenticated live use, real team data or real CAD/requirements documents. No such data was imported or mutated.

An initial broad test process was interrupted by the workspace restart and is inconclusive. The later isolated 35-file run above completed successfully; it replaces that interrupted result.

## Before release

Public draft publication was authorized on 2026-10-07. Before any separately authorized release, run the full collected app suite and the existing disposable real-stack integration job, inspect the 390/1440 synthetic screenshots, rerun native concurrency on the final migration, and review the production schema before any separately authorized migration/deployment. The additive migration is `20261006235739_sprint_review_design_decisions_v1.sql`; existing migration files are unchanged.
