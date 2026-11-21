# Shared identity security regression fixtures

These files are byte-identical snapshots from the pinned Inventory and Pit commits listed in `sources.json`. The test installer verifies every SHA-256 before applying anything. They are test inputs, not Team Hub migrations and must never be deployed to a shared or hosted project.

The isolated runner creates a fresh loopback-only Supabase stack with genuine Auth and PostgREST. It installs the actual released Inventory, Pit competition/scouting, Finance, Attendance and Hub workflow foundations, then the five exact reviewed canonical-role migrations. Only the guarded synthetic legacy-account identity/version digest is substituted; migration drift guards remain active. Every external source is byte-pinned in `sources.json`. The native run exports schema-only PostgreSQL metadata to `test-results/shared-canonical-catalog.json`, without Auth or business records. This fixture is not a production installer.

Every user, item, event, invitation, and test mutation is synthetic. Fresh Auth signups create profiles through Inventory's actual trigger. Fixture SQL sets known test roles and inspects invariants; all application actions under test use real Auth-issued bearer tokens and raw HTTP requests.

Run after installing the official Supabase CLI version pinned in `tests/integration/fabrication-safety.mjs` and starting local Docker:

```
SHARED_SECURITY_INTEGRATION=1 node tests/integration/fabrication-local.mjs --run
```

The runner rejects non-loopback URLs, inherited project credentials and remote Docker routing. It destroys only its own generated local stack and temporary directory. No production URL, credentials, CLI link, or migration deployment is used.
