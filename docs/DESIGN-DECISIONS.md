# Design decisions and engineering trade studies: review draft

This draft extends the existing Planning / Sprint Review workflow. Public draft review is authorized; production migration and deployment require separate approval. All fixtures are synthetic.

## One workflow, existing authority

Planning → a project board → Design decisions opens a read-through view of the latest Sprint Review for that board's season. Its button goes to that exact review and focuses that project. The same existing weekly update contains an optional comparison; no second decision register, task store, requirements database, or approval role is introduced.

The first draft supports one focused choice per project per review, with up to six design alternatives. Requirements, architecture decisions, prototype tests and calculations use the existing source-label, URL and source-ID reference shape. Existing external documents remain authoritative. Nothing imports or rewrites their contents.

The optional workflow records a student owner, target date, comparison status, actual decision date, selected option and criteria for reopening. Existing reported decision, rationale, student participants, next test/action and canonical task fields remain the outcome. The authenticated recorder is separate from reported participants. A record does not imply a signature or a mentor approval. Student leaders and assigned supporters retain existing editing rights; readonly members cannot write.

## Engineering trade studies

Students define measurable criteria, units, weights, an explicit low/high scoring scale and which direction is preferable. Each option's raw measured or calculated value can have a reasoning note and evidence references. Examples such as mass, cycle time, capacity, packaging, manufacturing effort and reliability are starting prompts, never project requirements.

Weights normalize by their sum. Unknown measurements remain unknown, with coverage shown instead of a fabricated zero. A complete weighted total requires values for every positive-weight criterion. Values outside the selected scale are clamped only for the displayed score and explicitly marked; the raw value remains visible.

Hard minimum/maximum must-have limits are checked separately from desirability scores. A failed or unverified constraint remains visible even if a weighted score is high. The application does not rank a winner, select an option, or claim a design is approved. Students record and explain their own choice.

Manual weight/space/cost/reliability/time observations remain available without a numerical study. SWOT is optional per alternative and secondary to the engineering evidence.

## History, exports and boundaries

The same update version, authenticated actor, immutable before/after audit and idempotent request receipt cover the entire comparison and outcome atomically. Stale saves must be refreshed. An omitted optional workflow from an older client retains the stored value; explicit null clears it and remains audited. Old review records without a comparison still work.

Open and reopened comparisons appear in the existing discussion queue. Review exports include the selected loaded comparison, its source IDs, raw study data, separate constraint outcomes, optional SWOT, final reason and canonical next task as a detached snapshot. Exports do not fetch private linked documents or create a second authority.

Carrying open text into the next review does not silently copy a chosen design or old prototype evidence into a new decision. Earlier review records remain linked and available.

## Verification

See DESIGN-DECISIONS-VERIFICATION.md for the final local test report and limitations. A public branch/PR, production migration or release needs separate authorization.
