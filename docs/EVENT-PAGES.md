# Event overview and parent event pages

## Scope and current status

The KCMT 2026 guide was retired at the user's request on 2026-10-08. Both the public registry and the internal draft registry are empty, and the Hub hides Events navigation while no drafts exist. Old public links show a generic unavailable state and return sign-in to the Hub; old internal overview/preview links show Event not found with a route back to the Hub.

The reusable per-event structure remains available for separately approved future guides. No production database write, schema migration, permission grant or RLS change is part of this removal. Attendance events, rosters, meals, calendar and logistics records are unchanged. Previous guide content remains recoverable through Git history, but is not included in the current application or public registry.

- Future internal overview: `/#events/<approved-slug>`
- Future authenticated parent-copy preview: `/#events/<approved-slug>/preview`
- Future public page, after approval and publication: `/event.html#<approved-slug>`
- Static public entry works on GitHub Pages without a server rewrite. Hash deep links, reload and Back/Forward are supported.

## Public boundary

`event.html` is a separate Vite entry. It imports only React, pure event presentation, styles, branding and the public content validator. It never imports/initializes the Supabase client, suite sign-in broker, profiles, notifications, Planning, Attendance or dashboard. It does not inspect or refresh a saved user session, even if the visitor also has a team account.

The only content request is the same-origin static `events/published.json`, using `credentials: omit`, `cache: no-store` and `referrerPolicy: no-referrer`. The file currently contains `{ "schemaVersion": 1, "events": [] }`. Unknown events remain unpublished. A missing, unknown or unpublished slug has a generic unavailable state. Bad documents fail closed with a retry option. No remote images, map embeds, payments or signup/collection forms are included.

Only separately curated `PublicEvent` fields are rendered. Unknown object properties are dropped as defense in depth; this is **not redaction**. Every byte of `published.json` is publicly downloadable. Never place private data in this file, source files, fixtures, screenshots or public build artifacts. No student names, rosters, attendance, disciplinary records, internal tasks, finance details, dietary or medical information belong in public event content. Personal contact details require the person’s specific approval for this public page; no contact is currently listed. Do not derive this file by serializing an internal record or an existing database response. Its approval is a separate human editorial step.

The organizer URL is explicitly allowlisted in `public-model.ts`. Public links have `noopener noreferrer`. Text is rendered as React text, not HTML. `event.html` has a no-referrer policy and `noindex, nofollow`; search directives do not provide access control.

## Internal overview

The authenticated overview and review preview use only the separately curated event configuration. They do not query Planning, Attendance, Inventory, tasks or other operational records. There are no board-linking controls, task assignments, Kanban views or data mutation actions. The user's existing Planning UI and task routes are unchanged.

For an available event, the overview retains a direct Competition Operations link for the team. That link is not part of the parent guide. The public page needs no sign-in. An optional Team sign-in link continues to the event overview only when that event is published; unavailable links return to the Hub.

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

## Future content

No new event information or personal contact details should be published without approval. Keep future organizer updates separate from internal operational records. Do not restore retired guide content while merging unrelated features.
