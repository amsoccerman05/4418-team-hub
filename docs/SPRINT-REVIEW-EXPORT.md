# Sprint Review PowerPoint export

This is a local, editable PPTX export of a saved, selected Sprint Review. It is staged for review, not published. The January reference was a PDF, so the export recreates its visual language; it does not preserve an original PowerPoint theme, slide master, or animation model.

## Integration

```ts
const {createReviewPptx} = await import('./reviews/export');
const result = await createReviewPptx(context, selectedReviewId);
// Check the current actor, selected review and route again before offering the Blob.
// Download result.blob locally using result.filename, and show result.warnings.
```

`createReviewExportSnapshot(context, reviewId)` creates detached, minimal data from the loaded review context. `buildReviewDeckPlan(snapshot)` is pure. `createSnapshotPptx(snapshot, options)` returns `{blob, filename, slideCount, warnings}`. `createReviewPptx(context, reviewId, options)` combines those steps. These functions do not fetch, save review records, access authentication storage, download images, upload files, or trigger a browser download. They exclude unrelated reviews/seasons, credentials, recorder identity, and inaccessible task details.

`options.fontMode` is `reference` by default. An explicit `arial` value creates a compatibility layout with Arial and bold headings. Its typography differs from the reference and its narrower wrapping allowance may create more slides. It is an alternative when the recipient cannot install the reference fonts, not an exact style match.

## Content and authority

The deck contains the selected meeting header, season, date, chair, loaded-at timestamp, agenda items/presenters/durations, project leads/supporters, progress, blockers, evidence links, tradeoffs, decisions needed, source-linked reported decisions and rationale, recorded student participants, next tests, canonical Planning task/owner/date/status, unresolved carry-forward, and next sprint actions.

Planning is authoritative for task ownership and dates at the snapshot time. External architecture decision registers and their supplied reference IDs remain authoritative. The export does not create decision parameters, infer a decision from the recorder, declare an unreported test successful, or add new commitments. Older review headers outside the bounded context display an explicit unavailable cue.

Missing or inaccessible content is visible. An unavailable task never exports a cached title, owner, status or date. Evidence URLs become native external hyperlinks only for ordinary HTTP(S) URLs without embedded credentials. Unsafe or unavailable links display a missing-link cue. Links retain their destination in the slide relationship and speaker notes. Clicking them later may require the recipient's existing source access.

Version 1 exports evidence as links. It does not embed review images, video, private CAD, or arbitrary remote images. Every evidence section explicitly says when no image is attached. The generic reference logo/background are the only embedded images. No historical review text, roster, CAD, results, or reference PDF/renders are in the repository or generated template.

## Rendering and packaging

The private `build-template.mjs` authoring script uses the supplied `@oai/artifact-tool` runtime. It authors native text shapes, the native agenda table, and reusable brand artwork. The frontend never imports that SDK. `package-template.py` packages the authored OOXML and deduplicated image bytes into `template.generated.ts`; it does not author slides. Browser code fills escaped text slots, adds hyperlinks, copies authored slide/notes parts, and writes a standard UTF-8 ZIP STORE package with CRC32. No new app dependency is required.

The source was measured at 720 × 405 points (16:9). The authored canvas is the same physical 10 × 5.625 inches. The navy/curved blue band background and original Impulse 4418 logo are extracted reusable source artwork. Headings use #F1C232 at 39 pt, divider titles use 90 pt with editable red offset text, body content uses 21 pt, and the lower-right folio uses 13 pt. Agenda cells use 18 pt. The PDF also used 24/21/19 pt body variations, so this export chooses the readable 21 pt reference size and paginates longer updates instead of reproducing the source's overflow.

The PDF's PostScript face names `RedHatDisplay-Black` and `RedHatText-Regular` map to the normal editor family names **Red Hat Display Black** and **Red Hat Text**. The full open-source families came from [Google Fonts Red Hat Display](https://github.com/google/fonts/tree/main/ofl/redhatdisplay) and [Red Hat Text](https://github.com/google/fonts/tree/main/ofl/redhattext). Their [Display OFL](https://github.com/google/fonts/blob/main/ofl/redhatdisplay/OFL.txt) and [Text OFL](https://github.com/google/fonts/blob/main/ofl/redhattext/OFL.txt) licenses apply. The repository includes advance-width measurements, not font binaries.

Fonts are referenced, **not embedded**. Inspection found no font parts or `embeddedFontLst`, and the supplied authoring API exposes no documented embedding option. Install the two Red Hat families in the presentation editor for the closest match. PDF PostScript aliases alone do not establish font availability. Canonical family names are used for editor compatibility. Font substitution can alter appearance. Native PowerPoint rendering has not been verified.

All substantive text, labels, agenda cells and reference labels remain native/editable. Brand artwork is intentionally raster artwork, and the red title shadow consists of a second editable text shape. Finalizer overlap warnings for these title/shadow pairs are intentional. Agenda is the only table in this bounded export; no charts or robot images are invented.

Text wraps using measured reference-font advances, with conservative handling for unfamiliar glyphs. Fields stay together when they fit; long fields continue at the same type size, with project context repeated where applicable. Agenda cell text continues across native table rows/pages, and unused rows are removed while preserving native table geometry. The visible as-of time includes UTC; speaker notes retain the exact source timestamp. No content is silently ellipsized or dropped. Exports over 500 slides or a 2,000,000-character snapshot fail with a visible scope error. The PDF's source overflow and stale numbering are not reproduced.

## Validation and remaining limits

The synthetic fixture contains no real people or review records. Pure tests cover native text/table parts, hyperlink relationships, long prose and agenda pagination, XML escaping, safe URL handling, detached snapshots and inaccessible task redaction. The generated PPTX is imported/rendered through the supplied artifact runtime, checked by the shared finalizer, and inspected slide by slide. A native text edit and native table-cell edit also survived export and re-import in the shared runtime. Arial compatibility previews use the available Liberation Sans metric substitute, so they are not evidence of native Arial rendering in PowerPoint. Structural validation does not prove behavior in Microsoft PowerPoint or Google Slides.

A browser test also attempts the same export after replacing `window.fetch` with a failure. It is kept as a release check. In this execution environment, bundled Playwright Chromium is missing and installed `/usr/bin/chromium` fails before opening a page with `socket() failed: Operation not permitted`. No sandbox flags were changed and no browser was installed to get around this restriction. Actual browser download/interaction validation remains pending in a supported environment.

Run pure tests with `npx playwright test tests/sprint-review-export.spec.ts tests/sprint-review-export-xml.spec.ts --grep-invert 'the browser export' --workers=1`. The XML regression tests require Python 3 and use its standard-library ZIP and strict XML parsers against actual PPTX parts. GitHub's Ubuntu runners provide Python 3; locally the tests use `CODEX_PRIMARY_RUNTIME_PYTHON` when set, otherwise `python3`. This is a test prerequisite, not an application dependency. A supported Chromium installation can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; that variable changes only the executable location. Browser validation is not skipped automatically.

Before formatting or packaging, export rejects any snapshot string containing an XML 1.0-forbidden character, including forbidden controls, U+FFFE/U+FFFF, and unpaired UTF-16 surrogates. The error names the readable field and code point; source text is never silently replaced. Valid supplementary characters such as emoji are preserved. The adapter also rejects a review ID that differs from the loaded selected review, so an older header cannot be combined with another review's loaded updates.

To regenerate the template, supply a private build directory containing separately approved generic background/logo assets and the full Red Hat fonts. Resolve the prescribed runtime paths, run the shared artifact-operation marker, invoke the authoring script, package the authored parts, and re-run the shared presentation finalizer and complete visual inspection. Keep private source documents, extraction scratch files, sample outputs and validation reports outside the repository. Publication/deployment remains a separate approval step.
