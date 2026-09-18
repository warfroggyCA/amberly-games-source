# Releases

1. Work on a branch. Keep credentials, original/generated word data, browser profiles, backups and local provider configuration out of Git.
2. Run `npm run check` and `npm run format:check`; push the exact commit to the public source repository and open/update its pull request. The `Verify` workflow restores the checksum-pinned word asset, installs the lockfile on Node 24, audits production dependencies, and runs all checks, including real PostgreSQL and production-mode browser tests.
3. Run `npm run release:check`. It rejects dirty checkouts and commits without a successful matching GitHub Verify run. A new code change invalidates the previous result. Do not treat a passed unit suite as a passed database/browser suite.
4. Review the diff and remaining boundaries, and obtain approval for publication. CI has no production database, OAuth or deployment credentials and does not deploy automatically.
5. Deploy the reviewed commit to the existing Vercel project using the existing approved process. Preserve required private word sources for the build; do not change auth configuration or apply migrations as a side effect. Record the commit, deployment ID, URL, verification run and promotion time.
6. Verify the deployed revision and shared signed-in read paths; check a private spectator view. Do not create test scores in real family games. Physical iPhone/iPad acceptance remains a separate check when viewport, keyboard or installed-app behavior changes.

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
