# Team Hub usability review

Base: `main` at `81b77434305cb56fa75ca792b7dac08660d191a4`.
Scope: focused Hub navigation, Home announcements, and announcement-editor improvements. Existing design tokens and role gates remain in place.

## Findings and changes

- **Student announcement destination disappeared when empty.** The navigation linked to `#home-announcements`, but Home omitted that section when there were no active announcements. Explicitly opening that destination now shows “You’re up to date. No new announcements.” Ordinary quiet Home still omits the empty section.
- **Delayed content missed hash navigation.** A fragment can be handled before data arrives. The requested announcement section now receives focus and a scroll request when the dashboard becomes ready, including after an error and retry.
- **Phone menu could hide its focused link.** Local navigation now transfers focus to the destination or main content before collapsing the menu. This also handles activating the current route again. Escape still returns focus to the menu button; modified clicks retain normal link behavior.
- **Creation appeared available before announcement data arrived.** Create announcement is disabled until its data is available and while a manager action is busy. The existing loading, retry, and empty messages are retained.
- **Form requirements and phone text sizing were unclear.** The editor now states that title and message are required, associates message guidance with the textarea, and uses 16px form text on phones to avoid small input text and mobile focus zoom. Existing field limits and submission behavior are unchanged.

## Verification

- `npm run build`: passed (TypeScript and Vite). Vite still reports large output chunks.
- 22 existing model/presentation tests passed:
  `npx playwright test tests/attendance-home-checkin-model.spec.ts tests/attendance-check-in-result.spec.ts tests/personal-attention.spec.ts tests/workspace-presentation.spec.ts --workers=1`
- A temporary jsdom harness mounted the real React components with synthetic service boundaries. On the original components the requested empty-announcement scenario failed because the section was absent. With this change, four checks passed: error/retry into the focused empty destination; compact ordinary Home; local navigation and Escape focus behavior; disabled creation during loading and associated form guidance after loading. This substitute verifies component behavior, not rendered geometry or native dialog behavior.
- Added six browser regressions in `tests/hub-usability.spec.ts` using only an invalid test API host and synthetic accounts. They cover 320px, 390px, and 1440px widths, error recovery, repeated keyboard navigation, loading controls, editor labels, focus restoration, overflow, and screenshots.
- `git diff --check`: passed.

## Remaining validation limits

The new browser regressions could not execute here: the Playwright Chromium download returned HTTP 403; installed Chromium failed before opening a page because the environment forbids its process-singleton socket. Single-process mode had the same failure. A synthetic local preview was also attempted, but the cloud browser could not reach the local server. No browser assertion result or screenshot is claimed.

Run `npx playwright test tests/hub-usability.spec.ts tests/dashboard-ui.spec.ts --workers=1` in a browser-capable environment before merging. Review narrow-phone and desktop screenshots, native dialog focus/Tab containment and Escape restoration, and actual scrolling. Safari/iOS zoom, assistive-technology announcements, physical devices, and live backend integration were not verified. This was not an exhaustive audit of every Planning, Fabrication, Outreach, or Attendance form.

## Authorization and attendance overlap

Loading the existing dashboard invokes `syncMyMeetingRosters()` before reading its context. It was not changed; synthetic fixtures intercept that existing side effect. The new focus/empty-state behavior does not add a dashboard refresh or service call. Mentor announcement eligibility, student denial of the management route, announcement audience handling, attendance calculations, and role assignments are unchanged. Production data, permissions, email delivery, storage, and authorization enforcement were not exercised.

## Dark mode follow-up

The Hub now has a native labelled Theme select (System / Light / Dark) on sign-in, the shared signed-in header (including Planning), the public event page, and the privacy notice. System is the default; a Hub-specific localStorage key persists an explicit choice on this origin. System changes and other-tab preference changes update the page. Storage failures do not block rendering or an in-page choice. A small synchronous public script applies the preference before the React application renders. It performs no network requests and does not change separately hosted suite apps.

The dark palette covers shared surfaces, text, inputs, borders, focus indicators, semantic feedback, menus, dialogs, and legacy literal colors in attendance, Planning/Assembly, Fabrication, and other Hub modules. Filled-action backgrounds are separate from lighter link colors to retain readable white labels. Light palette values are preserved. Legacy color pairs use CSS `light-dark()` (modern browser support required). Printed privacy output retains its existing print styling.

A realistic partial-fix case is a student whose device is dark, who explicitly chooses Light, reloads, opens My assignments and Attendance, then returns to System: an OS-only CSS switch would ignore the override, while a one-time stored boolean would stop following device changes. Preference regressions exercise this, invalid/blocked storage, and cross-tab synchronization; the browser suite checks public pages and synthetic student/mentor flows at 390px and 1440px in both themes. The dedicated `Check Hub themes (synthetic only)` PR workflow builds, runs the tests, and retains screenshots; it has read-only repository permissions and no deployment step.

Local follow-up validation: build passed; all five preference/contrast tests and four existing workspace-presentation tests passed. The contrast test covers normal and muted text, links, semantic feedback, and filled action labels. It does not constitute a complete rendered-page contrast audit. Browser results are reported in the PR after CI runs; local browser restrictions described above still apply. No backend or authorization behavior was changed.
