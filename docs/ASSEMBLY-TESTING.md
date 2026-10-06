# Assembly & Testing: local draft

## Status and dependency

This is a reviewable local extension of the existing Planning project page. It is not a separate application. Nothing in this draft has been pushed, deployed, or applied to production.

Base: local Fabrication commit `0857dfc172f277bda790c6d141adae252939eb82`, whose tree is identical to Fabrication PR 9 head `f6c8a428fb62cbb32d1ca3ab21563cb65b57e9c1` (tree `9b2a6e3f5f99525b48b666fcd137f9f51361d97a`). Fabrication is an explicit stacked dependency. Rebase onto its released equivalent before preparing a separate PR.

The Assembly migration depends on the canonical Planning, task assignee, Sprint Review, and Fabrication migrations. The frontend must not be released without the additive migration, its authorization review, and a disposable integration test. This document is not authorization to run a production migration.

## Project workflow

Open Planning → Boards → a project → Assembly & testing.

- Manufactured parts use the current immutable Fabrication revision and its existing completion status.
- Purchased components are manually recorded project line items: Needed, Ordered, Received, or Installed. Received/Installed means the entire quantity on that line is on hand. Partial arrivals stay Needed/Ordered with explanatory notes. No Inventory quantity is decremented and no Finance/purchasing row is changed.
- Assembly work is a link to an existing Planning task. Ownership, status, dates, and blockers remain canonical in Planning. New tasks use the normal project task editor. Unlinking from assembly does not delete a task.
- Checks record the method, expected result, observation, optional existing evidence URL, and optional exact part revision. A failed or blocked check can reference an existing same-project rework task. That reference does not change Fabrication status or create another task.
- Check records are append-only. A follow-up creates another record and supersedes the previous current observation for the same revision. Older records remain visible. Checks of older part revisions never count as a current-revision pass, failure, or blockage.
- The four summary cards count records/line items, not individual physical units, and show recorded facts only. They do not certify readiness, physical safety, design quality, or subsystem performance. A project/subsystem check with no part revision applies to its documented conditions; it is not proof that every current part was tested.

## Saturday Sprint Review

Capture review snapshot stores immutable counts, notes, ID, actor, and server timestamp. From an existing weekly update, choose an Assembly snapshot and explicitly add it to Progress this week. This is a draft insertion, not an automatic save. The user reviews the text and uses Save weekly update normally.

Later Assembly changes do not silently rewrite saved review updates or already exported PowerPoint decks. A new snapshot and explicit new insertion are required. Snapshot insertion preserves existing progress, rejects duplicate snapshot IDs and refuses to truncate text beyond the existing 5,000-character review-field limit.

## Access and records

Assembly reads follow the existing Fabrication project visibility. Writes follow existing project submission permissions: active authorized managers, project student lead, and assigned supporters, while the board and season are writable. Readonly users stay read-only. Client permissions are advisory; every write rechecks current server-side authority.

The local additive database design uses a private schema, RLS, revoked direct table access, and role-checked, fixed-search-path RPCs. It does not add file buckets, Storage grants, public links, or profile/role changes. Evidence links are reference-only HTTPS URLs on ASCII DNS hosts; punycode/internationalized hostname labels are conservatively unsupported in this MVP. The app never fetches or embeds their contents and does not change source-document sharing permissions.

Mutations use a board-wide optimistic version, actor-specific idempotency receipts, and the existing ordered authority locks. A timeout is treated as an unknown result. Users can check its status or cancel the pending request before creating another mutation. Only opaque actor/request IDs are retained for recovery, never draft check details or evidence URLs. Closing an editor or changing account/project aborts its requests and discards its draft.

Existing canonical tasks, Fabrication parts, and immutable revisions are referenced, not copied into new editable task or part tables. Snapshot facts are deliberately copied into immutable meeting references.

## MVP limits

- No file uploads, photo hosting, new file permissions, stock reservation, purchasing integration, automatic fabricated-part rework, test-instrument import, or automatic readiness sign-off.
- No component deletion UI in this initial draft; update a line's description/status/notes through the record instead. A future remove/cancel design needs an explicit audit-preserving contract.
- Check follow-ups retain their original revision. Record a new check when testing a new revision.
- Project limits are bounded; reaching a limit rejects the change instead of silently omitting records. Review capacity before broad rollout.
- Current factual counts reflect the moment of load/snapshot; Refresh obtains changes made elsewhere. No continuous realtime subscription is added.
- Real Storage and Edge gateway behavior belongs to the stacked Fabrication release. Assembly adds no file transport.

## Verification

Synthetic records only. No actual team/student records or CAD files are used in development fixtures.

Run:

```sh
npm run build
node scripts/test-node-regression.mjs
npx playwright test --config=assembly.regression.config.ts tests/assembly-model.spec.ts tests/assembly-db.spec.ts
npx playwright test --config=assembly.playwright.config.ts
node tests/native/assembly-concurrency.mjs
```

The Assembly UI configuration uses port 4432 to avoid the active Fabrication checkout. The native PostgreSQL harness uses its own disposable database and port 55457; set `ASSEMBLY_PG_BIN` to a local PostgreSQL 17 bin directory when running outside this development workspace. The browser-free regression runner isolates each test file in a fresh process to release PGlite/WASM memory in small local environments. The exact verification results and limitations are recorded in `ASSEMBLY-TESTING-VERIFICATION.md`.

Generate an offline read-only preview with `node scripts/preview-assembly.mjs`. It uses the actual shared React presentation with synthetic data, contains no scripts or authentication state, and makes no live connection. It is an HTML preview, not evidence of browser layout or interaction verification.
