# Amberly release status

This is the release ledger. Older milestone documents describe what was known at that milestone; they are not the current deployment record.

## Last independently observed hosted release

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
