# Disposable Fabrication integration

## Verification status

This harness is **authored, locally safety-tested, and prepared with the official Supabase CLI; the full Supabase stack has not run in the authoring environment**. There is no Docker binary or local Docker socket there. `--preflight` exits nonzero with an explicit blocker; missing infrastructure never becomes a passing or skipped integration result.

Locally verified:

- Seven Node safety tests: literal-loopback validation, CLI status/key checks, isolated environment, redirect refusal, a hostile parent-proxy regression, application-specific readiness, and gateway-normalized CORS checks.
- JavaScript syntax checks for the runner and integration suite.
- `--prepare-only` with official Supabase CLI **2.119.0**. Its actual `init`, `start`, `status`, `stop`, and `functions serve` help was inspected.
- Generated DXF (116 bytes) and PDF (329 bytes) pass the unchanged feature's real validators. No existing document is opened or uploaded.

Do not treat these checks, the existing PGlite tests, or native PostgreSQL checks as evidence that Auth/Edge/Storage integration passed. Only a successful `--run` can print `PASS_REAL_SUPABASE_INTEGRATION`.

## Run on a disposable Docker-capable Linux machine

Requirements: Node 22 or 24, official Supabase CLI **2.119.0** on PATH, Docker daemon at `/var/run/docker.sock`, and free ports **54330–54339**. Do not use a production machine or a developer computer containing a valuable stack on these ports. The runner creates its own random project; it never stops or resets another project.

```sh
node --test tests/integration/fabrication-safety.test.mjs
node tests/integration/fabrication-local.mjs --preflight
node tests/integration/fabrication-local.mjs --run
```

An already-installed official binary at a different path can be selected explicitly:

```sh
FABRICATION_SUPABASE_CLI=/absolute/path/to/supabase \
  node tests/integration/fabrication-local.mjs --run
```

`--prepare-only` is useful without Docker. It checks the CLI, creates a temporary local config, copies the exact Edge entry point and its two helper files, records SHA-256 source hashes, and removes the temporary files. It does not start services, invoke functions, or prove config/runtime compatibility.

No `npm install` for this harness is necessary. It uses Node built-ins only. The actual Edge entry point retains its existing pinned npm import, `@supabase/supabase-js@2.116.0`; the local Edge runtime may need to fetch that package on its first invocation. Docker image pulls and this package fetch are the only external dependencies of the stack setup, not application-data destinations.

## Isolation and scope

- A new temporary working directory, home, Docker configuration, and random `fabrication-it-*` project ID are created for every run. An owned Docker bridge binds published ports to `127.0.0.1`; every published `HostIp` is independently inspected before any synthetic user/data is inserted.
- No repository `.env`, `.temp`, project link, production URL, access token, database password, or saved CLI login is read or copied.
- Subprocess environments are allowlisted, excluding Supabase/Vite/PG credentials, proxy settings, remote Docker contexts, and Node preload settings. Docker is explicitly directed to the local Unix socket.
- Host-side service URLs must use literal `127.0.0.1`, `localhost`, or `[::1]`. The expected API/database ports are checked. Remote URLs, userinfo, IPv4 shorthand, and redirects are rejected. Keys come only from this new stack's `supabase status -o json`; local legacy JWT issuer and role are checked.
- The unchanged Edge entry point receives the CLI's local container-network service addresses and synthetic default keys. Those intra-stack addresses are necessarily container aliases; they are not accepted as host-side target overrides. There is no production-target option.
- Six new `example.invalid` email/password identities and tiny synthetic DXF/PDF byte arrays are generated in memory. Auth must initially contain zero users and Storage zero objects. Passwords, JWTs, and local API keys are not included in reports.
- Every command is local: no `login`, `link`, `db push`, hosted project/branch creation, `deploy`, or secrets-management command exists in the runner.
- The local stack retains PostgreSQL, Auth, gateway, PostgREST, Storage, and Edge Runtime. Studio, analytics, image transforms, realtime, mail UI, database metadata UI, and pooler are excluded. No email is sent or verification flow needed.
- Normal completion/failure and SIGINT/SIGTERM handling run `supabase stop --project-id <this-run-id> --no-backup` then removes the owned network and temporary directory. Cleanup failures retain the synthetic workspace and print narrowly scoped commands. This intentionally deletes only the generated disposable stack. A hard-killed process or machine failure can prevent cleanup; see below.

## What is real, and what is synthetic

The suite uses a direct `node:http` socket connection to the actual local gateway. It does not honor parent-process proxy variables or a global fetch dispatcher. `Request`/`Response` only encode/decode the real HTTP payloads. It never imports the Edge handler, provides a fake `Services` object, replaces `fetch`, redefines `auth.uid()`, inserts fake Storage metadata, or bypasses the application RPCs for feature operations.

Readiness requires the handler-specific `401/sign_in_required` response to an unauthenticated POST, not only a gateway preflight. A proper browser preflight then verifies POST and authorization/apikey/content-type headers, accepting either the exact local origin or the pinned CLI gateway's `*` normalization for these cookie-free bearer requests. An unapproved Origin must independently return the handler's `403/origin_denied`. Status, selected CORS headers, and at most 512 response-body characters are logged on changes and every 15 seconds while starting. The synthetic origin setting is written to the temporary `supabase/functions/.env` before `start`, and the same generated file is passed to `functions serve`.

The successful upload path is:

1. Real Auth `/signup`, password `/token`, and `/user` yield an actual user/session.
2. Multipart POST reaches `/functions/v1/fabrication-files` through the gateway and Deno Edge Runtime, executing the unchanged `index.ts`, `handler.ts`, and `validation.ts`.
3. That code independently verifies the bearer token with real Auth `/user`.
4. Its backend SDK invokes the exact service-only reservation/authorization/finalization RPCs through PostgREST.
5. Its SDK writes actual DXF/PDF bytes to real private Storage. The test checks real `storage.objects` size, MIME, and `user_metadata.sha256` generated by that API.
6. The finalization RPC persists the revision, receipt, and audit in actual PostgreSQL.
7. A subsequent authenticated Edge download authorizes again, reads actual stored bytes, checks the digest, and returns the byte-identical attachment with revision headers.

Direct privileged SQL is limited to shared-contract scaffolding, seeding synthetic profiles, independent persistence assertions, controlled access changes, and race/fault instrumentation. The scaffold creates four shared tables missing from this repository's migration history: `profiles`, `areas`, `team_positions`, and `team_member_positions`. They use RLS and no client grants. Profiles reference actual `auth.users`. This is **not** an end-to-end migration replay of every unrelated app or the production profile-onboarding flow.

After that scaffold, five existing migrations run byte-for-byte unchanged: Planning V1, task dependencies, assignees, Sprint Review, and Fabrication. Season/project creation and assignment setup use real authenticated Planning/Sprint Review RPCs. The report hashes each migration and all three Edge source files, so reviewers can tie proof to the tested code.

A deliberately broad unrelated Storage policy verifies that the feature's restrictive private-bucket policies still deny direct access. Test-only triggers in a private schema can fail finalization or hold the terminal-receipt transaction at an advisory lock. They do not replace application functions or write Storage rows. They are removed after the tests; all generated data disappears when the stack is stopped.

## Assertions

- Invalid token, account mismatch, inactive user, readonly writer, and unassigned writer are rejected. User-editable `user_metadata.role = admin` grants nothing.
- DXF and PDF pass the real validators, upload through Edge/Storage, and download byte-for-byte with SHA-256 and immutable revision headers.
- Ordinary callers cannot use service-only RPCs, read raw revision tables, use a public file URL, or directly read/write the private Storage bucket, including in the presence of the broad unrelated policy.
- Current database role, active state, assignment, and season status override an already-issued JWT. Managers can read authorized archived history.
- Exact applied retry returns the same receipt. Changed bytes with the same request key fail without replacement.
- A real finalization rollback leaves a pending lease and real Storage objects. Retrying must recognize duplicate objects, verify their bytes, and preserve their IDs/metadata while committing exactly one revision/audit.
- Concurrent real Edge requests are observed waiting inside PostgreSQL, then released: same-key upload replay, cancel-first, finalize-first, and competing immutable revisions.
- Cancel-before-reserve installs a tombstone. Cancelled uploads clean real Storage objects; applied uploads retain them.
- Concurrent authenticated operator claims yield one owner. Same-key acknowledgements yield one audit. A new revision preserves the claim, invalidates acknowledgement/review, and leaves prior revision bytes available.
- A queued retry rechecks role, assignment, and archive changes after its authority lock wait.
- All leases end terminally; no test-only triggers remain.

The lock tests wait for `pg_stat_activity.wait_event = advisory`, not arbitrary sleeps. Gate connections are explicitly committed/released in `finally` blocks. Endpoint timeouts and SQL statement timeouts bound a broken run.

## Storage duplicate compatibility is an explicit integration gate

The pinned Storage SDK exposes `status`, `statusCode`, and `code`; it does not preserve a raw response's `.error` field. Storage versions may report a duplicate as HTTP 409 or as a legacy HTTP 400 duplicate response. The adapter's narrow conflict classifier must treat a recognized conflict only as permission to reauthorize and verify existing bytes, never as success or permission to overwrite.

The pending-retry assertion intentionally exercises this exact path and must stay strict. If it fails, inspect the actual returned SDK error shape and make a separately reviewed adapter change, then rerun the entire harness. Do not widen the test to accept 502, skip retry coverage, or replace this with a mocked Storage result. A first successful upload and unit-tested error classification do not settle live duplicate behavior.

## Separate PR-only CI job

The draft workflow includes this job alongside the existing browser checks, only for pull-request events. It requires no repository or Supabase secrets and does not use a production environment. The official setup action is pinned to the verified v3 commit. The Node integration files are excluded from Playwright discovery and run only in this separate job.

```yaml
fabrication-local-integration:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  timeout-minutes: 25
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '24'
    - uses: supabase/setup-cli@45a513f8c64c0bc8e0e3dfe572b5c95be85f6359 # v3
      with:
        version: '2.119.0'
    - name: Check local-only guards
      run: node --test tests/integration/fabrication-safety.test.mjs
    - name: Run actual disposable Supabase integration
      run: node tests/integration/fabrication-local.mjs --run
```

Cold image pulls can take several minutes and several GB of disk. Supabase recommends at least 7 GB RAM for its full stack; this job excludes optional services to reduce footprint but has not yet been benchmarked. Keep one integration stack per runner, avoid parallel jobs sharing these ports, and allow the job to fail on infrastructure or dependency errors. Do not use `--ignore-health-check`.

A passing run prints individual assertions followed by `PASS_REAL_SUPABASE_INTEGRATION`, Node/CLI versions, the database image, and source hashes. Keep that sanitized CI output as evidence. A partially completed run is not a pass.

If a process was killed before cleanup, identify its exact printed `fabrication-it-*` ID and remove only that disposable stack with the same CLI:

```sh
supabase stop --project-id <exact-generated-fabrication-it-id> --no-backup
```

Never use `supabase stop --all`, a production project reference, or a valuable developer stack's ID.

## Official references checked

- [CLI local development and Docker requirements](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [CLI command reference](https://supabase.com/docs/reference/cli/introduction)
- [Edge Functions local testing](https://supabase.com/docs/guides/functions/unit-test)
- [Storage error codes](https://supabase.com/docs/guides/storage/debugging/error-codes)
- [Official setup-cli action](https://github.com/supabase/setup-cli)
- [Supabase changelog](https://supabase.com/changelog)

The current changelog notes a self-hosted gateway transition; this harness uses the pinned official CLI and its gateway, and does not assume or modify a standalone Kong/Envoy deployment.
