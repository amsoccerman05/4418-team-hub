# Privacy notice maintenance

The canonical public notice is `public/privacy.html`, served at https://team.frc4418.org/privacy.html without sign-in or JavaScript. Its stylesheet and branding assets are local; it does not initialize Auth, Supabase, analytics or remote embeds. Hub sign-in and the app footer link here. Other suite tools should link to this canonical URL rather than maintain conflicting copies.

The initial publication uses the user-reviewed October 13, 2026 notice, including the approved review paragraph. The public page removes only draft metadata and supplies its publication date. The editable review draft is a separate artifact.

## Required feature and release review

For every feature or integration change, check whether the notice still accurately describes:

- Information collected, including free text, images, files, identity and activity history
- Purpose and affected people, especially student information
- Who can view, export or receive information, including public content and role permissions
- Hosting, authentication, email, analytics, embeds and other providers
- Browser/device storage and offline queues, including behavior after sign-out
- Retention, correction, deactivation and deletion behavior

Amend the canonical notice as needed for authorized, implemented changes. Record a meaningful updated date when information practices change. Do not describe pending features as deployed. Verify wording against implementation and test public access and suite links before release.

A notice amendment does not authorize a new data use, disclosure, permission expansion or retention change. Obtain the approvals and any separate legally required consent for those actions. Do not add access-equals-consent wording or a forced acceptance checkbox. Refer legal or school-arrangement uncertainties to the team operator rather than claiming compliance.

Keep tests/fixtures/privacy-approved-text.json synchronized only with reviewed wording changes; do not change the fixture merely to make a mismatch pass. Styling and links can change without rewriting policy substance.
