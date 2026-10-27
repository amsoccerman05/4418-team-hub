# My 4418 task shortcuts

Prepared against exact Hub main `3778d238a3379640817463cd92b85829b645ac75`.

## Behavior and boundaries

- Four compact task links on existing My 4418: **Find a part**, **Request a purchase**, **Report a problem**, and **My assignments**. No extra dashboard or permission is added.
- Find a part uses Inventory's existing `/#inventory` route. Request a purchase uses Finance's `/?action=request-purchase` route; release Finance's authenticated, capability-checked route before releasing this Hub change.
- Pit has no create-report deep link. Report a problem honestly says **Open Pit, then choose Report issue** and opens the existing homepage. My assignments opens existing Planning My Work; assigned Pit repairs remain on Home's existing attention panel.
- Links preserve existing suite behavior: on the canonical Hub origin the existing first-party SSO handler opens trusted suite apps in child tabs; blocked popups retain native link navigation. No tokens or user data are added to destination URLs.
- My Work list and validated assigned-task routes survive sign-in and interrupted sessions. Explicit sign-out still clears the route. Planning reads and role gates remain authoritative; navigating never saves or submits a record.
- Existing own purchase-order data now includes concise next-step summaries beside the record link. Home only knows status and approval count, so it never guesses which reviewer remains after one approval. Finance resolves exact current-revision roles and available actions. Pending attendance requests explain that review is pending with no immediate action.
- Existing attendance check-in code, checkout, SSO, profile gates, RLS, and all writes are unchanged. No schema, backend permission, storage, retention, privacy-notice substance, dependency, or live record changes.

## Verification

Local Node 24:

- `npm run build` passed, including TypeScript; existing large-bundle warning remains.
- `node --test tests/suite-auth.test.mjs` includes exact destination handoff and popup-blocked fallback coverage.
- Browser-free model/SSR, existing dashboard database, personal assignment, and check-in model regressions passed.
- Phone/tablet/desktop browser regressions cover four readable links, minimum touch targets, no horizontal overflow, truthful next steps, no mutation, repeated navigation, Back/Forward, sign-in, interrupted session, and explicit sign-out.
- Independent review identified cramped tablet columns; the final layout uses two columns through 1200px and adds 768px coverage. No authorization or correctness regression was found.
- Local Chromium/socket execution is blocked by the environment; browser scenarios must pass GitHub CI before release. Synthetic phone/desktop screenshots are retained in `home-task-shortcuts-review` for visual review. No live records are used in tests.

Release requires successful final exact-commit CI and Finance destination deployment first. User authorized draft PR publication and merge/deployment after successful checks.
