# Team directory and invitation cleanup

Review candidate. This changes the client UI and adds a PR-only synthetic screenshot artifact. There are no database, invitation service, authentication, role, email delivery, deployment-trigger, or workflow-permission changes.

## Result

Members opens directly on the roster, with a compact search/role/state/area toolbar and a visible invitation entry point showing the open count. Historical invitation rows no longer appear ahead of team accounts. The member editor, single-invitation form, and existing role/position controls retain their behavior.

Onboarding is the single invitation workspace:

- In progress is the default. Pending, processing, review, legacy accepted, and unknown statuses remain visible and searchable.
- Account history retains only records whose server display status is exactly `account_active`. Records are never deleted, deduplicated by name/email, or rewritten. A later refreshed review status returns a record to the open queue.
- The existing group composer starts collapsed so the queue is immediately available. Opening/closing preserves its in-memory draft and review. Closing during a send requests a synchronous pause before hiding the composer; the current request settles, and a new acknowledgement is required to resume.
- Attendance registration remains separate and is available in each record's details. It is resolved only through the existing linked user UUID.

Service acceptance, inbox delivery, sign-in, and password setup remain distinct. Server `account_active` confirms the existing active/verified/signed-in readiness projection; it does not prove completion of password setup. Legacy `accepted` stays open as “Sign-in recorded.”

## Verification

- `npm run typecheck`: passed.
- `npm run build` and all 209 browser-free regression checks passed locally. All 400 tests passed in [the first PR 5 CI run](https://github.com/amsoccerman05/4418-team-hub/actions/runs/37412968590).
- All 32 focused onboarding contract tests passed, including partitioning every known/unknown state without collapsing duplicate identities and rendering the default open queue with a separate history count.
- Browser fixtures use only synthetic names and `example.test` addresses; they never send live invitations. The initial screenshots were rendered and inspected at 390/768/1440px, revealing tablet spacing and inherited-control-style issues. Corrections and keyboard-focus coverage must pass on the current PR head, with its new screenshots reviewed before release. Local Chromium is blocked by the sandbox's socket restriction; CI supplies the review images.
- The existing batch and member UI tests were updated for the new composer/history navigation. New browser regressions cover 390/768/1440px roster and invitation views, unresolved duplicate identities, history/search transitions, empty states, refreshed readiness reversals, draft preservation, and pausing before hiding a running batch.

Run in an approved browser runner:

```sh
npx playwright test tests/team-directory-ui.spec.ts tests/onboarding-ui.spec.ts tests/team-management-ui.spec.ts
```

The tests write synthetic screenshots to ignored `test-results/invite-cleanup/{members,invitations,history,batch}-{390,768,1440}.png`. Inspect those images and the full browser result before treating this UI as ready to publish. The supplied feedback images and private recipient addresses are not included in source or fixtures.

The approved PR-only artifact step uploads only `test-results/invite-cleanup/*.png`, including synthetic invitation-email renders. It does not upload browser traces, session files, or the supplied feedback images, and it cannot run on a main-branch deployment.
