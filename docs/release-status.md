# Current Amberly Games release

The running app is **Amberly Games Preview** at https://amberly-games-preview.vercel.app.

| Item | Verified release |
| --- | --- |
| Application commit | `7f64c6086af58fab239064adf3232276f4e33940` |
| Release tag | `preview-2026-09-26-gameplay` |
| Ready deployment | `dpl_4ubKsKWqE5Q45neN9HxqsjBLi1R8` |
| Deployment URL | https://amberly-games-d4j4qsedm-dougs-projects-e9ca299b.vercel.app |
| Full Verify | https://github.com/warfroggyCA/amberly-games-source/actions/runs/36242562622 |
| Viewer migration | `20260926123933_gameplay_timing_viewers` |
| Sign-in | Google and email codes |
| Enabled features | Crokinole, Scrabble Gym, Gym profile history |
| Publication | Preview; no Vercel Production promotion |

The final verification passed 920 unit, 103 database, 340 browser and one integrated test. The fresh game-schema backup restored all 26 tables; applying the viewer migration twice preserved all table fingerprints. Auth/provider configuration and off-device iCloud upload are outside that backup proof.

Hosted postflight verified signed-in history, winner crowns, sortable standings and saved-game rack counts with unchanged scores. Refresh existing app tabs before playing. Physical iPhone/iPad gameplay, Erin's first sign-in, the optional email-button click and live guest-token postflight remain separate acceptance checks. Email-code delivery and sign-in were verified before deployment.

## Source of truth

Use the canonical **Scrabble scorer** checkout and public repository `warfroggyCA/amberly-games-source`. The release tag identifies the exact deployed application. Later documentation-only commits do not imply a different application deployment. Compare Vercel's deployment commit with this record before claiming a newer release.

The September 26 cleanup aligns the local checkout with the deployed application and consolidates the stacked release history for review against `main`. All former PR heads are ancestors of the deployed commit. Merge must retain that ancestry; use a merge commit, not squash or rebase, so earlier release references remain valid. No redeployment is needed for this documentation-only cleanup.

Local creative experiments, source media and draft notes are preserved under ignored `output/cleanup-preserved-2026-09-26/`, with a SHA-256 manifest. They are not part of the app release and have not been uploaded to the public repository. Runtime secrets, private word inputs and operator backups remain excluded from Git.

## Rollback boundary

New timing and correction commands require the released journal reader. After those commands have been saved, do not roll back to an older incompatible reader. Retain the additive migration and prefer a compatible forward fix.

## Historical release notes

The entries below describe earlier milestones. Any statement of “current,” “pending,” or “unreleased” below applies only to its historical entry; the table above is the current deployment record.

## Strategy coaching published — 2026-09-26T03:07:41.463662+00:00

Approved commit `8da43605c77327df8dca4bdced5cc16a4ad79569` is live on `https://amberly-games-preview.vercel.app`, pointing to Ready Preview deployment `dpl_6mJuiH1LEs6KahHbKUWA2UtQ7u9Q` (`amberly-games-c2wf06xau-dougs-projects-e9ca299b.vercel.app`). Protected Verify run `36203957485` and exact-commit release gate passed. PR #11 remains the source review; no main-branch merge or Production promotion was performed.

Postflight: independent alias inspection confirmed Ready; signed-in Games, Gym profile connection and existing practice history loaded. Standalone hosted practice generated a board, listed ranked moves, showed strategy progress/Answer now/Cancel, and returned a real comparison. No family-game score or new profile practice attempt was created by this smoke check. A standalone device-local draft was created. Physical iPad acceptance and private spectator verification were not repeated in this release. No migration or auth configuration change. Previous Ready deployment `dpl_3hig4BQyGcziiRj11wMfmsUzMGMV` remains the rollback target.

The installed Vercel CLI was rejected as outdated; a temporary Vercel 60.1.3 invocation deployed successfully without changing project dependencies or the global installation.

# Amberly release status

## Players navigation follow-up — September 25, 2026 UTC

Preview now serves `3f0feb38374d82b89b8d022bad356fda3cddfa16`, Ready deployment `dpl_AUkYhnLyskaCH3xzn1rj173WhGcQ` (`amberly-games-rh0wakqv5-dougs-projects-e9ca299b.vercel.app`). Players retains the shared top navigation, reusing AmberlyNavigation with its tabs variant. No data, auth or URL changes.

Published with the user's expedited UI-check approach: production build, lint, formatting and eight focused browser checks passed across desktop/iPhone/iPad/landscape. Hosted Settings → Players → Settings was verified signed in, including a visual inspection of the selected Players tab. Full Verify 36130889328 is running separately; the preceding release's full Verify 36092513642 passed. No claim that the full exact-commit gate passed before this publication.

Rollback: `dpl_B2uuT2TJF1qEwQJkiaVozbcTMoR5`, `amberly-games-de65wsud7-dougs-projects-e9ca299b.vercel.app`. Existing source PR #8 remains open; no main merge or Vercel Production promotion.


## Invitation link and Gym visual update — September 25, 2026 UTC

The existing Preview alias serves commit `3c4108767b04e1d434b2da6d825850fe674a3dfc`, Ready deployment `dpl_B2uuT2TJF1qEwQJkiaVozbcTMoR5`. It adds invitation-link copying with manual fallback, enlarges Scarlett on Games, and strongly highlights the drag landing square. URL and sign-in configuration are unchanged; no database changes or main merge.

User requested expedited publication after the full-suite wait was explained. This release used a one-time focused-check exception; the normal exact-commit release gate was not represented as passed. Local production build, formatting, lint, invitation clipboard success/fallback on all four browser projects, and native Chromium touch landing passed. GitHub Verify 36092513642 was running at publication and subsequently completed successfully, including full browser and integrated checks.

Hosted alias and exact source metadata were independently verified. Signed-in Games loaded with the enlarged Scarlett. The available browser session lacks Family access permission, so the hosted invitation button could not be exercised in that account; its administrative UI behavior passed fixture-backed browser checks. Existing invitations and game data were not modified. Physical iPad acceptance remains pending.

Rollback target: `dpl_5pagbeE7AqTypMFNuN7QygeN2MMP`, `amberly-games-2126ombaw-dougs-projects-e9ca299b.vercel.app`.


## Gym Preview release — September 25, 2026 UTC

The existing Preview alias now serves verified commit `c31d994965ac633c2c60b4de458f3f5f12a943d8`, deployment `dpl_5pagbeE7AqTypMFNuN7QygeN2MMP`. Protected Verify run 36087618845 passed (899 unit, 92 database, 303 browser, 1 integrated); the exact-commit release gate passed. Crokinole, Gym entry and Gym profile history are enabled. No main-branch merge or Vercel Production promotion was performed.

Fresh owner-run backup, isolated migration rehearsal and hosted additive Gym migration were completed. All 24 original tables had matching before/after migration fingerprints. Operational evidence is private in `output/gym-release-20260925/release-evidence.json`; do not include it in public PR messages.

Hosted browser verification covered signed-in Games, profile connection, private history, one assisted/viewed session with zero scored attempts, persistence through full reload and retrieval of the original rack and solution event. Physical device and second-device acceptance remain pending. Rollback target is the previous Ready deployment `dpl_HUw7crQhmSuohaLEjRFExZCuwDDA`; retain the additive Gym tables and any saved history.

This is the release ledger. Older milestone documents describe what was known at that milestone; they are not the current deployment record.

## Review-integrity release candidate — September 23, 2026

Current hosted evidence was refreshed during release preparation: `amberly-games-preview.vercel.app` resolves to Ready deployment `dpl_Bjx3GLcRjxufwW5TaPDcQpLDWHde`, source `f4d55c83a8671aeda614a1d27f14592fbcdf5c51`. The consolidated X10 checkout initially lagged that release; `codex/review-integrity-fixes` incorporates that complete deployed branch before publication. Earlier unreleased labels below are historical.

The candidate fixes [the supplied integrity review](review-fixes-2026-09-23.md). It preserves the deployed draft recovery, final Scrabble summaries, keyboard layout and bingo features, and updates the Changes view for the new amendment/Resume events. User authorized release to the existing Preview alias. No main-branch merge or Vercel Production promotion is included.

Hosted preflight confirms all ten application prerequisites (plus the operator-only restricted-login migration), no duplicate command IDs or malformed Crokinole event shapes, and restricted `NOINHERIT`, non-superuser, `NOBYPASSRLS` runtime/login roles. The login can explicitly assume only the runtime role. Application-table grants are limited to the owner and runtime role. GitHub main protection still requires `verify`, including for administrators, with force pushes and deletion disabled.

Before publishing, complete the fresh owner-run backup/isolated restore, successful exact-commit Verify run, and reviewed `review_integrity_guards` migration. These are release gates, not claims that they have already run. The owner-approved backup destination is the existing private iCloud Amberly Games folder; independent off-device retrieval and Auth/provider recovery remain separate evidence. Physical iPhone/iPad acceptance remains separate from browser emulation.

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
