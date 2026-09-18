# Amberly release status

This is the release ledger. Older milestone documents describe what was known at that milestone; they are not the current deployment record.

## Local review-footer correction after ecb2ada deployment

Preview was subsequently verified on `ecb2adae1a535f8f9457a60e53745626d23f586a`, deployment `dpl_ChnHcVd9Z8e4PAWYf3hWKVciCg6i`, with [successful exact-commit CI](https://github.com/warfroggyCA/amberly-games-source/actions/runs/35382399158), release gate and hosted smoke checks. The sections below retain earlier milestones.

Physical iPhone feedback found that the landscape turn-review buttons needed scrolling. The local follow-up keeps the title and action footer visible while only review details scroll, and compacts spacing on short screens. The regression failed against ecb2ada; build/TypeScript and 32 focused browser checks passed after the change, including normal and correction review states. This follow-up is not deployed and still needs the full release gate and physical acceptance. No persistence or hosted changes are included.

## Unreleased second keyboard follow-up

After the release below, physical iPhone feedback confirmed portrait improvement but exposed a clipped vertical word in landscape and an unresponsive blocked-square dialog. The local follow-up reserves landscape keyboard space for the word with a side control rail, keeps entered letters in view, and replaces the rejected-square modal with a dismissible warning that preserves draft, cursor and typing focus. Review and Clear letters remain available through their existing controls.

The landscape defect reproduced against the released build. The physical dialog freeze did not reproduce in WebKit; removing this modal removes that failure path without claiming a general native-dialog root cause. Other dialogs still require physical acceptance. Build/TypeScript, lint,144 focused unit tests and32 browser checks passed, including vertical entry with installed-app top clearance and touch dismissal through rotation. These are local checks, not physical-device proof. No database or hosted changes are included. Exact-commit CI, release gate and approval remain required before publication.

## Last verified Preview release

- Source: `1e3c9874da0cfadbdba14f95dd4bbaf5b5f9bb5c`.
- Alias: `https://amberly-games-preview.vercel.app`.
- Ready deployment: `dpl_BnpzNbCW7k9Mion8HS6BSTK14rpt`, `amberly-games-pk7spkyef-dougs-projects-e9ca299b.vercel.app`.
- Exact-commit CI passed: https://github.com/warfroggyCA/amberly-games-source/actions/runs/35372670151 . PR CI and release gate also passed.
- Hosted smoke verified existing sign-in, both game types, preserved synthetic final results and viewing-link revocation. No migration or permission change.
- This release remains the rollback target for the unreleased follow-up above. Its physical keyboard acceptance failed as described above; retain all drafts/history.

## Historical keyboard/recovery candidate before publication

Observed September 18, 2026 after physical iPhone testing:

- Preview alias still resolves to Ready deployment `dpl_2cwWQsau9YTfsZb2r6mTr3WGpSsk`, previously released from `6e98a3ac6f419fa26cec42e39b4308f6b6761935`. Crokinole is enabled in Preview configuration.
- This candidate fixes confirmed native-keyboard obstruction and obsolete connection warnings after a successfully retried Scrabble turn. It changes presentation and recovery messages only; no migration or historical rewrite is needed.
- Before publication: production build and 28 focused browser checks passed. New keyboard regression failed on the previous build; final simulated portrait, landscape, panning, rotation and keyboard-close checks passed. These are browser simulations, not acceptance on an installed iPhone.
- User authorized Preview publication and physical retest. Exact-commit CI and the repository release gate remain required before alias promotion. No main-branch merge or Vercel Production promotion is part of this release.
- Rollback target for this candidate is `amberly-games-ihfarm6ay-dougs-projects-e9ca299b.vercel.app`. Retain all drafts and game history.
- Physical iPad remains deferred. Managed hosted backups are unavailable on the current plan; complete operator backup/restore evidence remains pending access and durable archive/key custody.

## Historical baseline observed before the first repairs

Observed during the September 17–18, 2026 adversarial Gauntlet:

- Source commit: `631fe08c9df77b2f7761574d3ed4d2baa9692d4f`.
- Alias: `https://amberly-games-preview.vercel.app`.
- Vercel deployment: `dpl_BLb4LbPf6o6nRHt7DhS9yDL4Xfx5`, READY, matching source metadata.
- [Successful exact-commit Verify run](https://github.com/warfroggyCA/amberly-games-source/actions/runs/35296925983).
- Hosted migration metadata included shared Crokinole, family defaults, player nicknames, and invitation/profile onboarding. Hosted timestamps differ from local source filenames; compare each migration's contents before proposing a migration operation.
- All 24 application tables had RLS enabled. Runtime/login roles were not superusers and did not bypass RLS. This was not a byte-for-byte comparison of every deployed policy/function.
- Anonymous sign-in configuration/headers were checked. Signed-in production journeys and real records were not used as test fixtures.

Refresh this evidence before release. A successful local build or an older deployment lookup does not prove that a new candidate is deployed.

## Gauntlet repair candidate

Branch: `codex/gauntlet-repairs`, based on the hosted source above. The commit containing this document identifies the candidate; record the final `git rev-parse HEAD` with its CI run when promoting it.

- Changes and acceptance evidence: [Gauntlet repairs](gauntlet-repairs.md).
- No database migration, dependency upgrade, or historical data rewrite is required.
- Candidate deployment and hosted mutation: **not performed**.
- Remote exact-commit CI: **required before promotion**, in addition to local checks.
- Hosted backup/key/retention evidence: **not established**; the dashboard required operator sign-in during repair verification.
- Physical iPhone/iPad installed-app acceptance: **not performed**.

## Promotion and rollback

Follow [releasing](releasing.md), including `npm run release:check`, authorized hosted checks, backup evidence, and explicit release approval. The candidate adds the disposable integrated test to the normal check/CI gate. That test uses real app routes and PostgreSQL with a local external-auth fixture; it does not establish real Google-provider acceptance.

Rollback needs no schema rollback. Retain existing game tables and journals. Returning to `631fe08` restores the three known defects; use only as a deliberate emergency decision and retain any local recovery drafts. The repair's workspace format remains compatible with the baseline. No stored history should be deleted during rollback.

After an approved deployment, update this ledger with the exact commit, successful CI URL, deployment ID/alias, verified migration mapping, signed-in smoke evidence, backup evidence, and device acceptance gaps. Do not infer one from another.
