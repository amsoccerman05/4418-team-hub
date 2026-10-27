# My 4418 meeting check-in

Prepared against Hub `f834bcf72c09bd01b0f9ad2057a14a44d293c297`.
No migration, backend grant, production attendance record, or external app is changed by this implementation.

## Behavior

- Next up opens the named meeting via `#attendance/meeting/<uuid>`, not a generic calendar search. When check-in is open, the action says **Check in**. This only navigates: the existing six-digit-code form and authoritative attendance RPC still record attendance after explicit submission.
- Home uses the caller's own attendance row to distinguish **You're checked in**, **Check out**, and **Checked out**. A current checked-in meeting takes priority through the existing 30-minute checkout grace, including after finalization. Overlapping checked-in meetings are ordered by earliest scheduled end. Optional attendance remains labelled Optional.
- Existing authenticated, RLS-filtered reads supply current meetings, the caller's attendance, and that caller's requirement snapshot. Current meeting reads paginate; attendance reads use bounded identifier batches and the current authenticated user ID. Reads share the dashboard's 15-second timeout. No new persistence, keys, role grants, joins dependent on PostgREST relationship inference, or direct table mutations are introduced.
- Attendance loads fresh, role-checked data before resolving a deep link. Missing, canceled, inaccessible, or unrostered meetings show an unavailable message; no other meeting is substituted. Closed/expired/finalized check-in retains existing restrictions, and checkout retains its existing confirmation and server boundary.
- A valid meeting link survives sign-in or an interrupted session. A typed code never survives the unmounted form, and returning does not submit anything. Explicit sign-out still clears the route.
- Close/Escape removes the linked route using replacement navigation, so Refresh or Forward cannot resurrect a dismissed dialog. Newer navigation wins over an old completion message. A synchronous in-flight guard blocks duplicate submissions before React disables controls.

## Verification

Passed locally:

- `npm ci --offline --cache /tmp/finance-po-npm-cache --ignore-scripts` using the repository lockfile and Node 24.
- `npm run build` (includes `npm run typecheck`; existing bundle-size warning remains).
- `node --test tests/suite-auth.test.mjs`: 9 passed.
- All non-browser `tests/attendance-*.spec.ts`, plus `tests/dashboard-db.spec.ts` and the initial new model tests: 237 passed with synthetic PGlite/mock auth.
- Final focused model/database regression rerun: 22 passed, including route validation, current checkout selection, exact grace/cancellation/overlap, and existing dashboard/RPC outcomes.

GitHub CI verified the browser coverage at feature head `6737c42a183055c1434d69ec294f0e1099a24e2d`: the existing focused Attendance workflow passed **379 tests**, including all 18 new Home UI scenarios and 4 model regressions. Coverage includes phone/desktop explicit code entry, wrong codes, repeated submission, check-out cancellation, Home state, stale targets, permission denial, sign-in/session interruption, Close/Escape/Refresh/Back/Forward, newer navigation, and checkout grace. Existing dashboard fixtures use the precise meeting link and authoritative timing. Attendance-state enrichment explicitly preserves meeting identity.

The local sandbox could not launch Chromium, so browser evidence comes from GitHub CI, not local browser assertions. Independent static review also completed. Disposable Auth/PostgREST, Attendance/shared-sites/Fabrication integration checks, volunteer-hours checks and scanned Inventory return checks passed at that head.

The Home regression files use the existing `attendance-*` naming convention so both the focused Attendance workflow and aggregate suite run them. The original aggregate run stopped at a pre-existing Vite security advisory; aggregate build/full browser stages were skipped, not passed. The approved minimal patch updates only Vite's lockfile version/resolved/integrity from 6.4.3 to 6.4.5, within the existing package.json range, with unchanged dependency/peer/engine ranges. The audit gate remains enabled.

[PR #35](https://github.com/amsoccerman05/4418-team-hub/pull/35) records the final exact-commit checks and release status. The feature history is based on the verified upstream main tree and parent, not the connector-materialized local snapshot history. Release requires successful final checks and the separately authorized merge/deployment; production attendance records must not be used for smoke tests.
