# Team Communications + Leadership Positions V1

Local implementation only. No production SQL, bucket, worker, secret, Cron or DNS
changes have been made by this pass.

## Manual activation order

1. Review and run `supabase/migrations/202609120006_team_communications.sql` once
   in the existing shared Supabase project SQL Editor. It requires the applied
   dashboard/announcements migration and Finance notification migration.
   The SQL itself creates the private `team-announcement-media` bucket, its 6 MB
   limit, JPG/PNG/WebP MIME allowlist and its access policies. Do not separately
   create a public bucket or change existing bucket policies. No data backfill sends
   email; the existing global/area announcements retain their audiences.
2. Before using announcement email, deploy the updated **existing** worker from
   `4418-finance`: `npx supabase functions deploy finance-notifications --project-ref tuxwavmjvjfhmaddchtr`.
   It now recognizes Hub announcement payloads and rechecks audience eligibility.
   Keep the existing Resend secrets, Vault credentials, and five-minute Cron.
   Deploy this worker before the new Hub frontend. Do not enqueue announcement
   emails while the old Finance-only renderer is running.
3. Deploy Team Hub after review. Confirm the Positions directory and a non-email
   test announcement with a private image under a mentor account. Verify area and
   position visibility with suitable existing test accounts. Only then opt into a
   controlled email to an audience whose recipients have consented to that test.
   This pass sends no test emails and makes no position assignments in production.

## Positions and permissions

Coaching retains Lead Coach 1/2. Program adds Program Manager and Product/Technical
Manager. Functional Leads retains Finance Lead and adds Software, Business, CAD,
Fabrication, Strategy, Power, Communications, and Operations Leads.

Positions remain `team_positions` + audited `team_member_positions`; multiple
positions per member remain supported. The existing `team_my_positions`,
`team_has_position` and `team_has_any_position` helpers remain caller-scoped.
New positions grant no global roles or Finance/Attendance/management powers.
Finance Lead and either Lead Coach keep exactly their existing approval slots.

## Audiences and images

All active members (including readonly); registered students (student/lead roles
with registered membership); mentors/admins; primary functional area; or active,
unrevoked position holders. Ordinary viewers must match the audience and see only
active, unexpired announcements. Active mentors/admins retain management visibility
across audiences. Email audience resolution does NOT add managers to restricted
recipient lists merely because they can manage announcements.

Images are optional immutable objects. Only mentor/admin may upload, and only they
may delete unreferenced images. Ordinary members download an image only through
its visible announcement. The record stores a path, not a URL/email/credential.
The browser uses authenticated downloads and revocable local blob previews, not
public image links. Upload UI checks type, signature, and 6 MB size; Storage enforces
its MIME/size configuration. Only JPG/JPEG, PNG, WebP are accepted; no SVG/HTML.
Replacement saves a new path before removing the old unreferenced object. Cancel
cleans up newly uploaded unreferenced objects when possible; interrupted browsers
can leave orphan images for later manager cleanup. No destructive bulk cleanup.
Emails link to Hub to see private images rather than embedding signed URLs.

## Durable email

Creation's email checkbox defaults OFF. With it enabled, a server-authorized save
creates one private `team_private.announcement_email_events` record and one
`team_notifications` row per resolved recipient. A stable client request UUID
makes retries idempotent; actor and recipients always come from database checks.
A normal edit never sends. `Send update email` requires confirmation and uses a
new request UUID. Retrying that same request does not create another event.

Outbox rows use source `hub`, entity type `announcement`, event
`announcement_published`. Two nullable Hub FK columns preserve the existing Finance
history/PO FKs, with a source-identity check separating the two shapes. The unique
Hub event/recipient/channel index complements the existing Finance dedupe key.
Private event rows retain actor/time and original audience for delivery checks.

The shared worker still uses exclusive leases, frozen provider payloads, stable
provider keys, five attempts and the existing retry/window rules. Claims now
explicitly process email only, leaving future slack/in_app rows untouched.
Auth email lookup remains server-side. Hub delivery rechecks active profiles and
both original and current audiences, including revoked positions/registration.
Inactive, expired or deactivated announcements are not sent. Provider failures
happen after save and cannot roll back publication. No new email service/config.

## Validation

Hub: `npm run build`, `npm test`. Finance: `npm run build`, `npm test`,
`npx deno check supabase/functions/finance-notifications/index.ts`.
Database tests use local PGlite and Storage table stand-ins to exercise policies;
bucket MIME/size settings are asserted, uploads tested through mocked Storage.
Actual Supabase Storage enforcement and real delivery still require the controlled
post-activation check. Tests never contact Resend or send email.
