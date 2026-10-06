# Fabrication private file gateway

## Scope and verification status

This is a local implementation, not a deployment. No real CAD/PDF files, remote database writes, bucket changes, or real uploads were used to verify it. `tests/fabrication-files.spec.ts` creates synthetic fixtures entirely in memory and mocks Auth, RPC, and Storage.

The gateway checks file admission and integrity. It does **not** certify geometry, dimensions, toolpaths, workholding, compatibility with a particular VCarve version, or suitability to machine. Drawing units are explicit immutable metadata (`drawing_unit`), independently of stock thickness units; the gateway does not infer or change either from DXF content.

## API

Endpoint: authenticated POST to the `fabrication-files` Edge Function. A valid Supabase access token is required in `Authorization: Bearer …`. The gateway calls `auth.getUser(token)` against Auth; JWT payload claims and browser-supplied actor metadata are not authority. Anonymous Auth users are rejected. Each database RPC additionally checks the current active team account and canonical project access.

### Upload

Multipart form fields, exactly once each:

- `action`: `upload`
- `request_id`: caller-generated UUID, stable for the identical request
- `expected_actor`: current actor UUID; must match the verified Auth user
- `p`: JSON-serialized `FabricationSubmission` from `src/fabrication/types.ts`
- `dxf`: required File
- `pdf`: optional File, omitted when absent

Clients never choose bucket, object path, lease, checksum, content type, or committed file metadata. The gateway validates actual bytes, computes SHA-256, and passes an exact manifest to service-only `fabrication_reserve_upload`. The reservation returns fixed paths:

`{board_id}/{part_id}/{revision_id}/drawing.dxf` and optional `drawing.pdf` in the private `fabrication-private` bucket.

`fabrication_upload_authorize` rechecks current authority before each privileged write or retry read. Uploads use `upsert: false`, fixed server-derived MIME types, and `metadata: { sha256 }`. The database finalizer requires the Storage object's actual size, MIME, and trusted upload checksum metadata to match. All revision metadata and file records become visible together at finalization; a partial upload never becomes a selectable revision.

Success and safe replay return a plain `FabricationReceipt`, not an envelope. Upload commits use `action: "revision"`, `entity_id: part_id`, and the committed part version. Pending/cancelled receipts have null action/entity/version fields.

### Download

JSON body: `{ "action": "download", "expected_actor": "…", "revision_id": "…", "file_kind": "dxf" }` (or `pdf`). No path is accepted.

`fabrication_download_file` authorizes the exact revision and file. The gateway reads a bounded Storage stream, verifies actual byte length and SHA-256, then calls that RPC again immediately before returning bytes to recheck current access. The response is an attachment with a safe `-r{revision_number}` filename and:

- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`
- `X-Fabrication-Revision`, `X-Fabrication-Kind`, `X-Fabrication-SHA256`
- exact `Content-Length`
- `Content-Type: application/octet-stream` for DXF, `application/pdf` for PDF

The client checks headers and hashes again before offering the temporary object-URL download. There are no public or signed download/upload URLs. Browser access to this bucket is denied for SELECT, INSERT, UPDATE, and DELETE, even when another application's permissive Storage policy exists. A downloaded local copy cannot be recalled; no implementation can prevent an already-authorized download from being retained. The final authority check also cannot make a database transaction atomic with an HTTP response already in flight.

### Cancel and reconcile

JSON body: `{ "action": "cancel", "expected_actor": "…", "request_id": "…" }`.

The authenticated `fabrication_cancel_mutation` inserts an actor-bound terminal tombstone, or returns an already-applied receipt if finalization won. Only after confirmed cancellation may the service-only `fabrication_cancelled_upload_paths` return exact paths for cleanup. Applied, pending, ambiguous, or mismatched leases do not grant deletion. A pre-reservation cancellation returns an empty path list and prevents a late upload from committing.

Cancelled paths are never reused. If a storage write was already in flight when cancelled, its handler sees cancellation at the next authorization/finalization point and repeats the scoped cleanup. Deletion never targets another request or an applied revision. A hard crash or access revocation may leave a bounded inaccessible orphan; administrative cleanup is still needed in those cases.

Definitive post-reservation failures (for example, a part-version conflict) are terminal-cancelled before returning a rejected 4xx response, so the client does not discard a recovery ID for a still-pending lease. A cancellation that cannot be confirmed returns 503 `upload_outcome_unknown`, which retains client recovery. If project access was revoked but the account can still cancel, the response carries its cancelled receipt and `cleanup_pending: true`; the former actor does not regain permission to delete files.

Transport errors remain pending until retry or explicit cancellation. An identical pending retry may find a file already present; it reauthorizes and compares the actual stored bytes to the server-computed manifest, never overwrites them. A corrupt/oversized existing object triggers terminal cancellation and scoped cleanup. An ambiguous finalize is reconciled before any cleanup; a committed upload is returned as applied even if its original response was lost.

## Supported file subset and limits

- DXF: nonempty, at most **20 MiB**; ASCII printable text plus CR/LF/TAB only; no binary DXF or embedded NUL. Valid alternating group-code/value records, bounded line lengths and record count, balanced unique sections, nonempty ENTITIES, and a final EOF are required. Numeric records must be well-formed and finite.
- Accepted DXF entities: LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND, SPLINE, and POINT. Required coordinate records and polyline counts/sequence are checked. Other entity types, blocks referenced by INSERT, text annotations, and 3D-solid entities are rejected; export flattened 2D curves. HEADER is optional, matching minimal ASCII DXF exports. The file's declared units never override the explicit submitted units.
- PDF: nonempty, at most **10 MiB**; supported header, EOF/startxref, real classic cross-reference offsets, root catalog, page reference and page object marker are checked. This first version intentionally requires a **fresh static PDF with a classic xref table**. Compressed object/xref streams, incremental updates, encrypted PDFs, and known active-content names are rejected, including hex-escaped names. This is a conservative admission filter, not a complete PDF parser, malware scanner, or sanitizer. Content streams are neither decompressed nor executed. It may reject otherwise-valid PDFs, including some normal export formats; export compatibility with real Onshape PDFs has **not** been established. If rejected, submit the required DXF without the optional PDF or re-export a compatible static PDF. Do not claim broad PDF compatibility until representative sanitized exports pass tests.
- Filename: 5–120 ASCII characters, beginning with a letter/number, using letters, numbers, spaces, `_`, `-`, `.`, and parentheses. Correct extension, no traversal, double dots, control characters, dangerous double extensions, or Windows reserved basename. Ambiguous names are rejected rather than silently renamed.
- Browser MIME is checked for inconsistency but never treated as proof of format. Storage MIME comes from the validated kind.
- Total request body is bounded while streaming at 30 MiB + 64 KiB, regardless of the Content-Length header. JSON file actions are capped at 4 KiB. Duplicate and unknown fields are rejected.
- Onshape links are reference metadata only: HTTPS `cad.onshape.com/documents/…`, no credentials, alternate ports, whitespace/control characters, or automatic fetches.

The database additionally limits each actor to 5 pending leases and 1,000 lifetime reservations, a project to 1,000 reservations/128 MiB reserved bytes, a part to 50 reservations, and the installation to 256 MiB reserved bytes (administrator-configurable in the private settings row). All reservation charges, including cancellation/crash charges, are retained. This avoids freeing capacity while an old writer can still create an object. It is deliberately conservative; safe lifetime quota reclamation and periodic administrator orphan maintenance are future operational work, not silently enabled background jobs.

## Configuration and operational boundary

Required Edge secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and backend-only `SUPABASE_SERVICE_ROLE_KEY`. Do not put the service key in Vite environment variables or source. SDK import is pinned to `npm:@supabase/supabase-js@2.116.0`.

`FABRICATION_ALLOWED_ORIGINS` is an exact comma-separated allowlist; it defaults to `https://team.frc4418.org`. For an authorized local development run, explicitly add the local origin, rather than allowing `*`. No-origin requests still require Auth and database authorization. CORS preflight is unauthenticated and returns no protected data.

When eventually approved for deployment, the function needs `verify_jwt = false` in its Supabase configuration because it performs Auth `getUser` verification itself; disabling the platform check is not disabling gateway authentication. Deployment, secrets configuration, migrations, and real files require their separate authorized rollout. The existing team-invitations function is unaffected.

Before rollout, run the migration/RLS integration suite on an authorized disposable local stack, check Edge runtime cold-start and size/CPU limits with synthetic boundary-size files, lock/cache the pinned Deno dependency, and verify representative non-sensitive Onshape DXF/PDF exports. The current environment had no Deno executable or local Storage server, so mock tests and TypeScript checks do not establish deployed Edge/Storage interoperability.

## Local tests

`npx playwright test tests/fabrication-files.spec.ts --workers=1`

Coverage includes byte validation, malformed/truncated documents, filename and MIME spoofing, finite DXF numeric values, explicit units and Onshape URL constraints, real PDF xref offsets, actual chunked-body limits, caller verification, current permission revocation, immutable manifests, successful replay, pending duplicate checksum verification, changed-payload conflict, ambiguous successful finalize, partial failure/cancellation, late write cleanup, finalized-file preservation, pre-reservation tombstones, storage corruption, cleanup errors, post-reservation conflict cancellation, lost cancellation receipt recovery, exact revision downloads, pre-response authorization, and static checks against public URLs/client Storage/service-key usage.

## Documentation checked

- [Supabase changelog](https://supabase.com/changelog) (checked October 6, 2026; no relevant breaking change found for these APIs)
- [Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Edge Functions and Storage](https://supabase.com/docs/guides/functions/storage-caching)
- [Storage uploads](https://supabase.com/docs/reference/javascript/storage-from-upload)
- [Private file downloads and signed URL lifetime](https://supabase.com/docs/guides/storage/serving/downloads)
- [Autodesk DXF group codes](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-3F0380A5-1C15-464D-BC66-2C5F094BCFB9.htm)
- [Autodesk DXF object/entity records](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-A35B8C2A-1885-4A8E-8533-E61D8A423D62.htm)
- [Adobe PDF reference, file structure](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.4.pdf)
