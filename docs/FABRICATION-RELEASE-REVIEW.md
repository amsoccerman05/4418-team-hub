# Fabrication V1: local draft and release review

This draft starts from the exact tree of released Team Hub main `4eae85719103f2a33729e77b09054019e71ea581` (`a1a95ade059629288bc415176f6088aa94b4c9a1`). The isolated local branch uses its tree-identical Sprint parent `e816f19`. No public branch/PR upload, production migration, Edge deployment, live file upload, notification, or user-record mutation is included in this local work.

## What the draft adds

- `#fabrication` and `#fabrication/projects/{board_id}` reuse canonical Planning project boards. An Intake project can contain many fabrication parts; no separate project list is introduced.
- Project progress and a cross-project Ready queue, with Needs review → Ready → In progress → Done, On hold, and return-for-review actions.
- Every immutable revision includes a DXF, optional PDF drawing/Onshape reference, part name, material, stock thickness and units, separately chosen drawing units, quantity, needed date, and revision notes.
- Current active student/lead/mentor/admin profiles can operate their own claim on a writable visible project. Global readonly accounts remain read-only. Project submission/revision follows existing Planning leadership or that project's current Sprint lead/supporter assignment. Mentors/admins can release abandoned claims and facilitate review/hold/rework.
- A newer revision preserves its claimant but resets review and acknowledgement; starting/completing requires the current reviewed, acknowledged revision. An open detail checks a lightweight version every 30 seconds while visible; full history reloads only when needed. Focus/visibility refresh is suppressed during drafts and pending writes. Actor/request receipts, versions and immutable audit protect interrupted and repeated actions.
- A private Storage bucket is accessible only through the authenticated file gateway. Browser Storage reads, signed URL creation, uploads, overwrite and deletion are denied. Exact revision bytes are returned as attachment-only downloads after current permission and hash checks.

## What needs separate release approval

1. **Public source/CI review:** uploading only source, migration code and synthetic fixtures to the existing public `amsoccerman05/4418-team-hub` repository, with a draft PR and synthetic screenshot artifacts. No real CAD, member records, secrets or production data belong in Git or CI. Approval for a prior Sprint feature does not authorize this upload.
2. **Data/security rollout:** additive Fabrication tables, scoped RPC permissions, restrictive policies limited to the new bucket, one private bucket, and one authenticated Edge gateway in the existing shared Supabase project. This enables private team file storage and the access model above. It must not change unrelated Planning, Inventory, Pit, Finance or invitation behavior.
3. **Application release:** merge/deploy the reviewed frontend only after database/Edge compatibility, CI and visual review pass. No credentials should be entered into chat or placed in public source; the gateway uses server-only existing Supabase environment secrets.

## Storage and operating-cost review

Every retained revision adds object storage. Downloads consume bandwidth and gateway invocations; retry and rejected requests also use function invocations. Read-only plan and aggregate object-size checks were used to choose a conservative draft budget; no billing plan or spend-cap settings were changed. Account-specific results are intentionally omitted from public source. Month-to-date bandwidth and billing meters still need an operational check before rollout. The private proxy deliberately avoids reusable cached/signed links, so it should not be assumed to receive cached-egress pricing.

As checked in official Supabase documentation on October 6, 2026:

- Storage includes 1 GB on Free and 100 GB on Pro/Team. Paid overage is $0.0213/GB-month, measured as GB-hours. [Storage usage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
- Uncached egress includes 5 GB on Free and 250 GB on Pro/Team; paid overage is $0.09/GB. [Egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- Functions include 500,000 Free or 2 million Pro/Team invocations; paid overage is $2 per additional million, rounded by package. These are organization quotas shared with other work, not an allocation reserved for Fabrication. [Function usage](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)

Admission limits are 20 MiB per DXF and 10 MiB per PDF. Initial lifetime reservation budgets are 128 MiB/project, 256 MiB total, 1,000 reservations/actor and project, and 50 reservations/part, with at most 5 pending reservations/actor. The internal reservation ceiling is **not a billing cap**: it does not limit repeated-download bandwidth or function invocations. The default leaves headroom beneath the documented Free storage allowance, but current shared usage and billing-period meters must be rechecked before rollout. A private administrator-only settings row controls the two byte budgets; clients and the gateway cannot raise them. Missing settings fail closed. No plan upgrade is automatic.

Cancellation attempts cleanup only for terminal-cancelled exact paths. Quota charges remain after cancellation/cleanup because an earlier write may still be in flight. Crashes and authority revocation can leave bounded, inaccessible orphans. Safe quota reclamation and administrative orphan review need a later explicit maintenance design; no automatic destructive cleanup job is enabled here.

## Compatibility and verification gates

- Supabase Storage/Edge live interoperability is not established by synthetic PGlite/mocked transport tests. Verify the actual `storage.objects` metadata shape, service-only grants, restrictive-policy isolation, immutable upload behavior, auth verification, cold-start/CPU/memory limits and final deployed environment with synthetic files in an authorized disposable stack.
- V1 accepts a documented 2D ASCII DXF entity subset and a conservative static classic-xref PDF subset. Normal but unsupported PDFs may be rejected. A representative sanitized Onshape export must be tried before claiming broad export compatibility. See [file gateway details](FABRICATION-FILES.md).
- The local Playwright Chromium executable is unavailable. Prior system-Chromium execution was blocked by the sandbox. The separate cloud browser was explicitly denied access to `http://127.0.0.1:4470` with `ERR_BLOCKED_BY_CLIENT`; no alternate-address bypass was attempted. Browser scenarios and screenshot assertions are prepared but require an authorized capable environment or approved public CI run.
- No actual CAM import, toolpath generation or machine interaction was performed. Onshape's official export documentation supports sketch/planar-face DXF export; VCarve's official vector-import documentation lists DXF. The workflow records explicit source units and asks the operator to check the current revision; it does not infer or change geometry scale. [Onshape export](https://cad.onshape.com/help/Content/File/exporting_files.htm), [VCarve vector import](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/import-vectors/)

Final local verification results are listed below. Do not interpret this draft as production-ready or a completed visual review.


## Final local checks — October 6, 2026

- Application TypeScript and production build: passed. The existing large-chunk advisory remains; no build error.
- Non-browser regression pass: 395 cases across 27 spec files, with a separate Playwright project per file and one worker to bound PGlite memory. The earlier resource-pressure SIGKILLs were resolved by serial isolated reruns; this completed pass had no failures.
- After the final smaller configurable-budget patch: all 59 focused Fabrication checks passed (16 DB groups, 28 file-gateway checks, 15 model/service checks). These overlap the broader regression count; they are not additional unique cases.
- Three editor contract checks: passed.
- Thirteen true PostgreSQL 17.6 concurrent/transaction checks: passed against the final migration.
- Official Supabase local security advisor: zero findings on the disposable synthetic database. This is not a production audit.
- Browser suite: 20 Fabrication browser scenarios are prepared, including desktop/mobile screenshots, repeated submits, role/archive states, claims/current-revision workflow, cancellation, stale replies, account changes, downloads, focus refresh and bounded version polling. They remain unexecuted here.
- Repository aggregate: 679 tests collect. The unexecuted browser tests are not counted as passed.
- Independent review: no remaining blocking source finding after fixing cancellation recovery, the 200-part reachability limit, cross-project reservation identity, and held-part reason preservation.

All file examples and database identities used in tests are synthetic. No representative real Onshape drawing was uploaded or added to Git.
