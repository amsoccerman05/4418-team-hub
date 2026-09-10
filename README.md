# 4418 Team Hub

Small React + Vite + TypeScript launcher for Team 4418 IMPULSE. No authentication, Supabase, management features, API integrations, embedded apps, or statistics. Each destination keeps its existing authentication. This is a publicly served launcher intended for team use, not an access-control boundary.

## Local development

Use Node 24:

```sh
npm ci
npm run dev
```

The Hub uses port 4420; tests use 4422, leaving Pit/Inventory servers alone.

## Configure links

**`src/links.ts` is the only destination configuration file.** Inventory, Pit Operations, and the Team Website use the supplied URLs. FIRST Dashboard, Slack, Monday, and Canvas are intentionally `null`: their exact team-specific URLs were not found in the locally inspected sources. Replace those nulls with confirmed HTTPS URLs, then rebuild. Unconfigured resources render readable non-clickable placeholders; no URLs are guessed. Do not include secret invite links, API keys, credentials, or private tokens in this public file.

4418 Systems are prominent cards and open in the same tab. Team Resources are explicitly external and configured links open in a new tab with `noopener noreferrer`. Keep future integrations separate from this static configuration and UI; none are implemented now.

## Shared visual language

`src/tokens.css` is copied from standardized Pit tokens derived from Inventory, including its readability overrides. It retains DM Sans / Manrope, brand `#224d3e`, primary `#28583f`, background `#f6f8f6`, white panels, established borders/radii/shadows and spacing. Google Fonts is the same font source used by Inventory/Pit; sans-serif fallback works if unavailable. `public/branding/` contains byte-identical official emblem/wordmark copies and original attribution. This single-page launcher uses the suite header rather than adding a redundant sidebar or mobile menu.

## Checks

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Browser checks verify the configured destinations, same-tab/new-tab rules, safe placeholders, loaded branding, no page errors, and no horizontal overflow at 390, 768, 1280, and 1440px. Screenshots are generated under ignored `test-results/`.

## GitHub Pages and custom domain — prepared, not deployed

No DNS or existing application settings are modified. No environment variables are required.

1. Create a **separate GitHub repository named `4418-team-hub`** under your desired owner. For GitHub Free Pages, use a public repository; if you choose private, confirm your plan supports Pages. Do not use the Inventory or Pit repository.
2. Add that repository as this local repository's `origin`, then push `main`:

   ```sh
   git remote add origin https://github.com/YOUR_OWNER/4418-team-hub.git
   git push -u origin main
   ```

3. In the new repository's **Settings → Pages**, select **GitHub Actions**. Run **Check and deploy Team Hub** from Actions if the initial push ran before Pages was enabled. The workflow runs TypeScript/build and browser checks before deployment.
4. In **that repository only**, set Pages custom domain to `team.frc4418.org`. The relative Vite base supports both the repository URL and custom domain. Actions deployments use the Pages domain setting; a CNAME file is not required.
5. Add DNS manually after confirming the actual repository owner/Pages hostname:

   | Type  | Host   | Target                 |
   | ----- | ------ | ---------------------- |
   | CNAME | `team` | `YOUR_OWNER.github.io` |

   If the new repository is under the same confirmed owner as Pit (`amsoccerman05`), the exact target is **`amsoccerman05.github.io`**. Use the hostname only, not a repository path or URL. Leave root, www, inventory, and pit records unchanged.

6. Wait for GitHub's domain validation and certificate, enable **Enforce HTTPS**, and verify `https://team.frc4418.org/` and its resource links. Do not bypass certificate errors.

No Supabase migrations, redirect changes, SSO setup, or API credentials are needed. FIRST/Slack/Monday/Canvas link configuration and repository/Pages/DNS setup are the only outstanding owner decisions/actions.
