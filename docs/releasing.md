# Releases

1. Work on a branch. Keep credentials, original/generated word data, browser profiles, backups and local provider configuration out of Git.
2. Run local checks appropriate to the change, including related integration paths, and `npm run format:check`; push the exact commit to the public source repository and open/update its pull request. Use `npm run check` when a complete local rehearsal is needed. Every release still requires the full protected `Verify` workflow: it restores the checksum-pinned word asset, installs the lockfile on Node 24, audits production dependencies, and runs all checks, including real PostgreSQL and production-mode browser tests. Focused local checks do not replace that gate.
3. Run `npm run release:check`. It rejects dirty checkouts and commits without a successful matching GitHub Verify run. A new code change invalidates the previous result. Do not treat a passed unit suite as a passed database/browser suite.
4. Review the diff and remaining boundaries, and obtain approval for publication. CI has no production database, OAuth or deployment credentials and does not deploy automatically.
5. Deploy the reviewed commit to the existing Vercel project using the existing approved process. Preserve required private word sources for the build; do not change auth configuration or apply migrations as a side effect. Record the commit, deployment ID, URL, verification run and promotion time.
6. Verify the deployed revision and shared signed-in read paths; check a private spectator view. Do not create test scores in real family games. Physical iPhone/iPad acceptance remains a separate check when viewport, keyboard or installed-app behavior changes.

## Parallel verification

`Verify` runs the code, database and integrated checks alongside four browser profiles: desktop Chromium, iPhone WebKit, iPad WebKit and landscape iPhone WebKit. Each profile is split into four Playwright shards on independent runners (16 browser jobs). With `fullyParallel: true`, Playwright distributes individual tests across those shards; every test still runs in every applicable profile. Each runner uses one worker to avoid CPU contention, restores the pinned private inputs and builds locally. No build or word-input artifacts are shared between jobs; only the existing npm download cache and failure evidence are retained. Failure artifacts include both profile and shard so parallel uploads cannot collide. Browser failures do not cancel other shards, so one run collects all results.

The protected `verify` status is the final aggregate. It succeeds only when the checks job and all 16 browser shards succeed; failures, skipped jobs and cancellations block release. The exact-commit `release:check` gate is unchanged. Splitting the suites reduces elapsed time at the cost of additional runner setup/build work; actual speed depends on available GitHub runners, queue time and the slowest shard. Keep the matrix aligned with the projects in `playwright.config.ts` when adding devices. When changing shard counts, keep the matrix, command denominator, job labels and this document in sync, and compare `playwright test --list --reporter=json` test IDs for the full profile against the disjoint union of its shards. Do not omit slow tests or enable retries to make a timing result look better.

## Source and private inputs

The canonical source is `warfroggyCA/amberly-games-source`. Earlier private history and word inputs remain in `warfroggyCA/amberly-games`; never publish that repository. The public repository requires the GitHub Actions `verify` status on pull requests before merging to `main`, prohibits force pushes/deletion, and applies those rules to administrators. These rules were read back from GitHub after configuration. Confirm the active rules in GitHub before each release; `release:check` independently checks the exact local commit.

CI reads a pinned private word-input commit through a read-only deploy key stored as a GitHub secret. Fork pull requests do not receive this secret and cannot run the private-input verification automatically. Review outside contributions before creating a trusted branch. Do not move private files into the public repository, logs, caches or uploaded reports. Credential scanning supplements human review; it is not a complete confidentiality audit.

## Rollback

Keep the prior Ready deployment and source tag. Roll back the alias to that deployment when needed. Once new reference-v1 games exist, **do not** roll back to code before reference-v1 support: those games must retain a reader for their exact dictionary. Prefer a forward fix or a rollback build that retains the new registry entry. No history should be deleted to make old code load.

## Database migration mapping

The permissions/private-test update requires the additive migration described in [member permissions](member-permissions.md). Apply it before the matching API and retain its authorization checks in any rollback build. Hosted migration versions differ from local filenames:

| Local source | Hosted migration |
| --- | --- |
| 20260914184358 foundation | 20260915001529 |
| 20260914195113 protests | 20260915001537 |
| runtime login (operator-only hosted setup) | 20260915001831 |
| 20260915033241 spectator inventory | 20260915033926 |
| 20260915181732 live drafts | 20260915184810 |
| 20260916150031 saved tile sets | 20260916152145 |

Do not blindly push local migration history to the live project. Inspect current provider history and verify the intended schema change independently.

## Complete ordered application schema

The canonical ordered list is [`config/database-migrations.json`](../config/database-migrations.json). The real PostgreSQL suite applies exactly this list and rejects unlisted migration files. It exercises both games against the resulting schema. The mapping above is historical evidence only, not the complete current schema.

The required local files, in order, are:

1. `20260914184358_shared_family_foundation.sql`
2. `20260914195113_game_protests.sql`
3. `20260915033241_spectator_tile_inventory.sql`
4. `20260915181732_live_provisional_drafts.sql`
5. `20260916150031_saved_tile_sets.sql`
6. `20260916234943_member_permissions_and_practice_removal.sql`
7. `20260917105407_crokinole_shared_scorer.sql`
8. `20260917132437_crokinole_family_defaults.sql`
9. `20260917182443_player_nicknames.sql`
10. `20260918003644_invitation_player_onboarding.sql`
11. `20260923235027_review_integrity_guards.sql`
12. `20260924011827_superadmin_game_removal.sql`
13. `20260924214100_gym_profile_history.sql`
14. `20260926032143_gameplay_timing_viewers.sql`
15. `20260926185952_player_archiving.sql`

Before deployment, compare the full list with **current hosted schema and migration history**, including changes applied under different provider timestamps. Apply only the reviewed missing changes in order, after an owner-approved backup and isolated restore rehearsal. Do not blindly push local migration history. Defaults, nicknames and invitation onboarding are required even when the Crokinole rollout flag is off.

The integrity migration installs ownership policies, immutable concern evidence, journal/projection guards, a unique per-match command ID, and the `application_schema_v1()` capability marker atomically. The game-removal migration adds `application_schema_v2()` and permits reasoned superadmin removal of regular games while retaining all original evidence. The player-archiving migration adds `application_schema_v3()`, archive metadata, deletion tombstones and superadmin-only guards. Every repository transaction checks the v3 marker and returns `SCHEMA_BEHIND` (503) before proceeding when it is absent. Install the complete schema before publishing this build. Reads as well as writes fail closed on an old schema.

The integrity migration retains existing data. Duplicate command IDs or invalid historic event shapes cause a transactional migration failure; investigate and restore/repair from verified evidence, never delete history to force installation. Existing resolved concerns remain intact; future resolutions can be appended once but cannot replace the original report or a previous resolution.

New Crokinole amendments use `correct_round_v2` / `undo_round_v2` and explicit `resume` events. Original v1 journals keep their historical semantics. After these new events are saved, rollback must retain support for them and the integrity migration. An older application cannot safely replay these journals. Keep the additive migration on rollback; prefer a forward fix or a compatible build.

Hosted migration history, runtime-login grants, off-device backup custody, deployment and physical-device acceptance must be recorded separately. Local tests do not establish those facts.


### Staged Gym history

Migration 13 adds private Gym sessions/events only; it has been prepared for local verification and must not be assumed present in the hosted migration ledger. Enable `AMBERLY_GYM_HISTORY_ENABLED=true` only after the reviewed migration and application revision are authorized and verified. The existing `AMBERLY_GYM_LAB_ENABLED` gate still controls Gym entry. On rollback, disable the history gate and retain the additive tables, receipts and device queues; never delete practice history to roll back UI. Verify an owned save and second-device retrieval after rollout, plus rejection for another account/profile.

Player archiving is additive: historical games and linked accounts remain intact. Permanent deletion is restricted to archived profiles without account, invitation, game or Gym references. Rehearse migration 15 against an isolated restore and verify its guards before applying it to the hosted database, then deploy the matching API. Retain its schema and tombstones on application rollback so delayed retries cannot resurrect deleted profiles.
