# Parent home: design review only

This branch adds `/#parents-preview` to the existing signed-in Team Hub. It is not linked in navigation and is not a parent access system. It makes no new API requests. The default state is unconnected; the optional example switch uses labeled synthetic content and resets on reload. Signup buttons show a preview explanation and never submit a claim.

## Existing integration points

Main at `f834bcf` contains the retired, empty event guide, team-account authentication, and team-audience announcements. It does not contain a released parent signup page. The existing meal implementation is preserved in draft PR #15 (`dot/saturday-meal-signups`), confirmed open and unmerged on October 18, 2026. Do not duplicate or silently activate it. Its claim, verification, edit and cancellation flow should be reused after its own release review.

The new presentational `ParentHome` accepts only a narrow family-facing DTO and a signup action. It does not accept full dashboard, attendance, roster, profile or financial records. No existing team announcement is reclassified as parent-visible.

## Before connecting real data or releasing

- Agree parent email-roster onboarding and verify email ownership server-side. An approved email roster exists according to the user, but was not provided for this iteration. Do not grant access by a self-entered student name.
- Review and authorize the backend boundary, revocation, pending access state, rate limits, retention and roster administration. Existing team login is only the design-review gate, not proof of parent authorization.
- Connect a minimal, parent-authorized calendar and coach-published parent announcements. Never reuse unrestricted team data or infer consent from an announcement's team audience.
- Integrate the existing meal draft after its release requirements and access model are reconciled. Keep private adult contact/claim details private. No parent-wide attendee directory.
- Keep student-specific information deferred until verified guardian relationships and appropriate permissions are implemented and reviewed.
- Revisit the Privacy Notice for new collection/access behavior before release. No production policy change is in this preview.

## Verification

`npm run build` checks TypeScript and bundles the existing app. `npx playwright test tests/parents-preview.spec.ts` checks phone/tablet/desktop layout, signed-out gate, default empty state, explicitly labeled examples, repeated signup clicks, dismissal, keyboard anchor focus, reload/back navigation, no operational reads/writes and browser errors. The wider suite must be run before publication; this branch is not approved for deployment.

Local result: TypeScript/build and three server-rendered parent/event tests passed. Browser tests could not launch Chromium in this container (socket permission denied); the permitted escalation failed at runtime setup. Browser tests are included for CI, but no screenshot or visual QA is claimed locally.
