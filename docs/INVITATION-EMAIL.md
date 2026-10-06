# IMPULSE invitation email

This is the reviewable source for Supabase Auth's **Invite user** email. It replaces the generic email presentation with the official IMPULSE emblem, team identity, an accessible blue action, a copyable fallback link, and short guidance for unexpected invitations.

## Files and scope

- `supabase/templates/invite.subject.txt`: proposed subject, **You're invited to 4418 IMPULSE**.
- `supabase/templates/invite.html`: the HTML to paste into the hosted project's **Invite user** template.
- `supabase/templates/invite.txt`: equivalent plain-text copy for review or a mailer that explicitly supports a separate text body. Supabase's documented hosted template settings expose subject and HTML; this file is not automatically deployed or wired to a separate text setting. Inspect the delivered plain-text alternative when an authorized mail test is available.
- `supabase/templates/preview-invite.mjs`: offline synthetic previews with an embedded local logo and long links under the reserved `example.invalid` domain.

This template is staged for review in the repository. Committing, building or deploying the web app will **not** change the hosted Auth email template. Neither `supabase/config.toml`, the Edge Function, the mail provider, sender identity, redirect settings, nor any account or invitation record is changed.

The HTML's action and fallback both use `{{ .ConfirmationURL }}` verbatim. The existing Auth-generated verification URL and redirect remain responsible for acceptance. There is no custom token construction, `.Data`/user metadata, recipient data, role claim, fixed expiry, or promise about completed setup. No invitation link from a real email is needed for these checks.

## Branding and email compatibility

The public logo is the [official IMPULSE emblem](https://www.frc4418.org/uploads/6/2/1/3/62133151/editor/logo-concept-first-it1.png), already recorded in `public/branding/README.md`. An unauthenticated fetch on 2026-10-06 returned a valid 242 × 242 PNG, byte-identical to `public/branding/4418-impulse-emblem.png` (SHA-256 `890376104cbc68857df843c5744e521b3073ebba5c413731782561c7cac4223a`). It is displayed at 48 × 48 without modification. The visible text identity remains when remote images are blocked. The only remote resource is that static, non-personalized logo; there are no tracking pixels, external fonts or scripts.

The neutral `#171717` header and `#006bb3` action follow `docs/SUITE-COLORS.md`. The layout uses presentation tables, inline styles, email-safe system fonts, a 600px maximum width, and an Outlook conditional width wrapper. A media query improves small-screen spacing, while the inline layout remains usable without it. The link fallback wraps long URLs. Light color-scheme hints are included, but email clients may still apply their own dark-mode transformations.

## Local checks and synthetic preview

From the repository root, run the browser-free contract checks:

```sh
npx playwright test --config supabase/templates/invitation-email.playwright.config.ts tests/invitation-email.spec.ts
node supabase/templates/preview-invite.mjs
```

The preview command writes three self-contained HTML files and a plain-text preview under ignored `test-results/invitation-email-preview/`. Open those files locally to review the standard, images-disabled, and head-CSS-stripped variants. Their links are deliberately unusable; do not substitute a real invitation URL. The generated HTML is only for review; the deployable file is `invite.html`, which retains Supabase placeholders and the public logo URL.

In an environment where Playwright browser launch is supported, run:

```sh
npx playwright test --config supabase/templates/invitation-email.playwright.config.ts
```

If the environment provides its own Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its supported executable. Browser checks cover 320px, 390px and 1024px widths, blocked images, missing head CSS, a long synthetic link, keyboard focus, CTA target size and horizontal overflow. They attach synthetic screenshots and also write deterministic `test-results/invite-cleanup/email-{width}-{mode}.png` files; network requests are blocked. A separately approved screenshot-only artifact can use those PNG files without collecting traces or session files. These are browser layout checks, not Gmail/Outlook rendering or real delivery tests.

During preparation on 2026-10-06, all four browser-free contract checks and nine browser layout cases passed in [the first PR 5 CI run](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37412968590). Its synthetic screenshots were inspected at phone and desktop widths, including images-disabled and head-CSS-stripped rendering. Local browser launch is blocked by the execution sandbox, so CI supplies the review images. The current PR head must pass again after later changes. Gmail/Outlook inbox rendering, delivery, and a live acceptance flow are not claimed as verified.

## Apply to the hosted project after release approval

1. Open the correct existing project in the [Supabase dashboard Email Templates page](https://supabase.com/dashboard/project/_/auth/templates). Verify the project against the app's existing deployment configuration; do not copy credentials or inspect unrelated secrets. Select **Invite user**.
2. Confirm the current editor allows customization. [Supabase's June 3, 2026 change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier) restricts new free-plan projects using default SMTP; older projects, paid plans and projects with their own SMTP are unaffected. If this project's editor is restricted, pause the rollout and report that specific blocker. Configuring a provider or changing a plan is a separate decision.
3. Save a private rollback copy of the existing **Invite user** subject and HTML. Back up only the template fields, not a delivered email, token-bearing preview, full Auth configuration, or SMTP credentials.
4. Paste `invite.subject.txt` into **Subject** and all of `invite.html` into the HTML body. Confirm the CTA and copyable fallback still contain the exact `{{ .ConfirmationURL }}` placeholder. Keep all other email templates, sender/provider settings, Auth URLs, token lifetimes, and security settings as they are.
5. Review any dashboard preview without opening its invitation links, then save the two template fields. Reopen **Invite user** and confirm the saved subject and HTML match the reviewed files. Saving affects subsequent project Auth invitations; it does not change previously sent emails.
6. If separately authorized, use one approved test recipient and the existing Team Management invitation flow. Check the sender, branded HTML, images-blocked view and text alternative in the received message. The recipient can accept their own invitation to verify the existing callback and setup flow. Keep real tokens out of screenshots, reports and source control. Do not send or resend an invitation solely to make a screenshot.
7. If verification fails, restore the backed-up **Invite user** subject and HTML only and confirm those saved fields. Do not regenerate tokens, alter the callback, or change providers to work around a presentation issue.

The [current Supabase template documentation](https://supabase.com/docs/guides/auth/auth-email-templates) confirms hosted editing and the `ConfirmationURL` variable. For a separately authorized Management API rollout, the narrow fields are `mailer_subjects_invite` and `mailer_templates_invite_content` on the project's Auth configuration endpoint. Do not fetch or print the entire Auth configuration or generate new credentials for this review. No Management API request is included or executed here.

For isolated local Supabase testing, the [documented configuration](https://supabase.com/docs/guides/local-development/customizing-email-templates) is `[auth.email.template.invite]`, `subject`, and `content_path = "./supabase/templates/invite.html"`. This patch deliberately leaves the current local configuration unchanged; those settings would not deploy a hosted template.
