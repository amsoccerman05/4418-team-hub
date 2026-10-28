# Exact released Student handoff proof

`released-artifacts.json` records freshly downloaded and SHA256-verified Pages
archives for the currently released four commits, including Pit's Vite fix.
Each runtime asset has its own exact archived-byte digest. The hosted fetch step
reads only those public static paths and rejects any byte mismatch or redirect.
This is not a source rebuild or demo bundle; a changed live deployment fails and
requires a newly verified manifest. CNAME hosting metadata is not a runtime asset.

Run `HANDOFF_DIST_ROOT=/absolute/artifact/root node tests/suite/handoff-fetch-artifacts.mjs`
then `npx playwright test --config tests/suite/handoff.config.ts`. Alternatively,
extract the verified archives into the manifest's app-name directories. No owner
checkout's dist is modified. Root bytes are checked before and after each case.
`HANDOFF_LIVE` is forbidden. There is no browser route that continues live traffic.

The synthetic backend returns literal `student`, null primary area, no positions
and no administrative capability in each app. It uses one synthetic Auth identity
whose bearer token must actually be issued by this browser fixture before any
protected REST, user or logout request succeeds. Missing, public-anon or invented
bearer credentials receive 401 and fail the request audit; each app must make an
authenticated data read. This proves synthetic credential transport, not real JWT
validation or server revocation (covered by the separate native gate).
The real released broker/client code handles sign-in, opener transport, refresh,
Finance own-PO deep links and cross-app logout at 390 and 1440 pixels. Tests assert
Inventory Add item and Finance New purchase order are available, not Mentor-only
shortcuts. The exact observed automatic self-roster sync RPC is answered locally
with `{added: 0}` (empty synthetic meeting roster), never sent to a server. Direct
signed-out app tabs intentionally show their local sign-in form; the test checks
no private UI and follows their existing Hub help link. Shared logout likewise
clears each app in place: every tab (including the open PO) must show its local
sign-in form with no private header/dialog, remain signed out after reload, and
make no subsequent protected REST calls. The fixture does not falsely revoke
access JWTs at logout; client shared-session clearing is the property under test.
Unknown HTTP/WebSocket
requests fail closed. Expected Supabase sockets
are locally closed; service workers are blocked. Only the observed Google Fonts
CSS URL is locally fulfilled as empty CSS; screenshots use fallback fonts.

This baseline proves released client navigation/identity and visible ordinary
actions with fixtures, not real Auth/API correctness or complete stock mutations.
The separate candidate Inventory SQL-backed UI journeys cover add/count/verify/
move/approved packing/returns; the shared native Auth/API gate covers actual
permissions and concurrent role revocation. Never combine these into a claim that
a real user or real production record was exercised. Final role deployments need
new exact deployment manifests, not this older baseline labeled as current.
