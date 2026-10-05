# Event overview and parent event pages

## Scope and current status

The user approved publication of the KCMT family guide on 2026-10-05, with Friday explicitly optional and unconfirmed logistics clearly labeled. The public registry contains only that curated guide. No production database write, schema migration, permission grant or RLS change is part of this feature. Release is gated on the repository checks.

This is a reusable per-event structure, with KCMT 2026 as the first event. It does not add a permanent year-round parent hub or invent annual registration, volunteer or team-role information.

- Internal overview: `/#events/kcmt-2026`
- Authenticated parent-copy preview: `/#events/kcmt-2026/preview`
- Public page, after approval and publication: `/event.html#kcmt-2026`
- Static public entry works on GitHub Pages without a server rewrite. Hash deep links, reload and Back/Forward are supported.

## Public boundary

`event.html` is a separate Vite entry. It imports only React, pure event presentation, styles, branding and the public content validator. It never imports/initializes the Supabase client, suite sign-in broker, profiles, notifications, Planning, Attendance or dashboard. It does not inspect or refresh a saved user session, even if the visitor also has a team account.

The only content request is the same-origin static `events/published.json`, using `credentials: omit`, `cache: no-store` and `referrerPolicy: no-referrer`. The file contains the approved KCMT event under `{ "schemaVersion": 1, "events": [...] }`. Unknown events remain unpublished. A missing, unknown or unpublished slug has a generic unavailable state. Bad documents fail closed with a retry option. No remote images, map embeds, payments or signup/collection forms are included.

Only separately curated `PublicEvent` fields are rendered. Unknown object properties are dropped as defense in depth; this is **not redaction**. Every byte of `published.json` is publicly downloadable. Never place private data in this file, source files, fixtures, screenshots or public build artifacts. No student names, rosters, attendance, disciplinary records, internal tasks, finance details, dietary or medical information belong in public event content. Personal contact details require the person’s specific approval for this public page; the only approved contact currently listed is Aiden Morrison at 720-525-3196. Do not derive this file by serializing an internal record or an existing database response. Its approval is a separate human editorial step.

The organizer URL is explicitly allowlisted in `public-model.ts`. Public links have `noopener noreferrer`. Text is rendered as React text, not HTML. `event.html` has a no-referrer policy and `noindex, nofollow`; search directives do not provide access control.

## Internal overview

The authenticated overview and review preview use only the separately curated event configuration. They do not query Planning, Attendance, Inventory, tasks or other operational records. There are no board-linking controls, task assignments, Kanban views or data mutation actions. The user's existing Planning UI and task routes are unchanged.

The overview retains a direct Competition Operations link for the team. That link is not part of the parent guide. The parent's own public page needs no sign-in. An optional Team sign-in link continues to the event overview after sign-in.

## KCMT approved publication copy

Source: https://coloradofirst.org/frc/kcmt/ (checked 2026-10-05).

- KCMT 2026, Kendrick Castillo Memorial Tournament
- October 10–11, 2026; load-in Friday October 9
- Coronado High School, 1590 W Fillmore St, Colorado Springs, CO 80904
- Organizer schedule highlights, explicitly tentative, all times Mountain Time
- Friday attendance is optional for Team 4418, explicitly requested by the user. Friday: load-in 4–6 pm; practice field 5 pm; practice 6–8 pm; venue closes 8:30 pm
- Saturday: venue 7:30 am; drivers meeting 8:30; ceremony 9; qualifications 9:30; lunch break 12:30; qualifications 1:15–6 pm; venue closing listed as 7:30 pm or one hour after the last round
- Sunday: venue 7:30 am; welcome 8:30; qualifications 9; alliance selection noon; lunch break 12:30; eliminations 1:30–6 pm
The family guide includes the following parent-relevant details from the organizer’s latest update supplied by the user on 2026-10-05. The raw email screenshot is not included in the repository or public page.

- Parking is available in the school parking lot.
- Optional Friday load-in is 4–6 pm on October 9, entering from W Fillmore St and following the bright yellow arrows. Team arrival/pickup arrangements remain pending.
- Outside food is allowed. Food may be eaten in the cafeteria, avoiding reserved sections, or outside in the courtyard. Team meal plans remain pending; dietary arrangements should be discussed privately.
- Bring safety glasses for guests; loaners are limited.
- Seating is limited, and accessible seating is reserved for people who need it.
- No quiet room is available.
- The walkway between the pits and field is outside; prepare for weather.
- The event seeks referees, meal-support volunteers, queuers, photographers/videographers and setup/cleanup help. Use the verified official event page’s Volunteer sign up tab rather than a guessed link from the email.
- Questions: Aiden Morrison, 720-525-3196. The user explicitly approved this number appearing on the public no-sign-in page. The phone link is constructed as `tel:+17205253196` from a validated E.164 phone field.

Machine-shop availability, robot equipment/tools/covers, field test elements, second-robot details, trailer logistics, and unrelated email content are omitted. No food order, prices, payment link, headcount form or individual health details are published.

## Suite branding

The public page uses the existing IMPULSE emblem and the suite’s shared DM Sans/Manrope typography, blue primary (`--suite-primary`), surfaces, borders, cards, radii and header spacing. Its presentation-only header remains independent of `SuiteHeader`, the suite switcher and auth code. Tests continue to inspect the public dependency graph and anonymous request behavior; visual consistency does not require initializing a team session.

## Review and release sequence

1. Review the authenticated preview and exact copy with the user. Confirm arrival/pickup, meal arrangements and the private dietary-needs route, spectator/parking/bring-list information, volunteering and the contact approved for public listing. Unknowns can stay clearly pending.
2. Obtain approval for the specific public copy and permission to publish. Approval of the concept does not authorize publishing later unreviewed private details.
3. Copy **only the approved public fields** into `public/events/published.json` under `events`. The draft in `src/events/event-config.ts` is not automatically exported. There is no environment variable, CI fixture, query parameter or localStorage flag that bypasses this gate.
4. Update the approved-registry assertions when the user approves new public content. Tests check the actual shipped document as well as empty, unknown and unsafe fixtures; do not change deployed content merely to satisfy a test.
5. Run `npm run build` and `npm test`, including the public dependency-graph and network-isolation checks. Verify mobile and desktop screenshots, anonymous entry, sign-in continuation, event deep links and Back/Forward. No live data should be used in fixtures.
6. Submit a draft PR only when pushing has been authorized. The current workflow deploys pushes to `main` and manual workflow runs, so do not use either as a preview mechanism. Merging/deployment requires separate authorization.
7. After authorized deployment, verify the deployed commit and anonymous public URL in a fresh session. Verify no public page requests hit Supabase. Confirm internal anonymous requests are still rejected. Do not change permissions to make a test pass.

Rollback: remove the event from the static public registry and redeploy with authorization. That cannot retract copies already shared; initial content approval remains essential.

## Remaining details to ask the user

Team arrival, meeting point/pickup arrangements and the team meal plan remain to be confirmed.

No additional phone number, email, health details or private form should be published without approval. Keep future organizer updates separate from internal operational records.
