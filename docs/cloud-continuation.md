# Cloud continuation after the October 4 Mac release

Future implementation runs in the saved Codex Cloud environment. The October 4 Mac work was an explicitly authorized recovery exception. Do not start further Mac feature work without a new user exception, delete retained Mac checkouts/private inputs, or assume older cloud tasks automatically synchronize.

## Fresh checkout and setup

1. Fetch `warfroggyCA/amberly-games-source` and start a fresh cloud workspace at the final merged `main` SHA in the private release receipt. Verify `git rev-parse HEAD`, a clean working tree, and the receipt's source-tree relationship before work. Existing tasks must explicitly fetch; their local edits must be preserved.
2. Read `AGENTS.md`, available checkout skills and the installed Next documentation. Use the pinned Node 24.21.0 and package lock (`npm ci`); the installed Next version is 16.3.8. Keep all credentials in the supported environment/connector mechanism.
3. Restore the private word artifact through authorized read-only access, following the pinned repository/commit/artifact in `.github/workflows/verify.yml` and `scripts/lexicon-artifact.mjs`. Verify restoration and `npm run lexicon:prepare` without printing private entries or credential material. Never copy private artifacts into public source or CI logs.
4. Run [fresh Library input/output preflight](cloud-library-preflight.md) on the consuming cloud executor. Inspect every required reference's actual pixels and confirm a small synthetic Library output before image-dependent implementation. Mac transfer success and successful CI word restoration do not prove cloud Library readiness.
5. Verify loopback/server readiness, then run the checks required for the change. Full release checks include unit, isolated database, integrated journey, build, lint, type, format, secret scan and four browser profiles. Test only synthetic fixtures/isolated databases. Exact-head protected CI and `npm run release:check` remain mandatory before publication; preserve the separate release approval requirement.

## Cloud support still outstanding

The approved exact Library hosts are `chatgpt.com`, `oaisdmntpreastus.blob.core.windows.net`, `oaisdmntprwestus.blob.core.windows.net` and `oaisdmntprwestus3.blob.core.windows.net`. The user republished settings on October 4 at 11:31 and 12:41 UTC; the four-host UI configuration was observed at 13:01. Effective policy/consumer transfer failures were still unresolved. Prepared-upload helper discovery also previously failed separately. These facts do not establish the cause or a platform fix.

Use only supported environment and support workflows. Do not change network policy, bypass proxies, log signed URLs/tokens, or rotate credentials to work around failures. Keep detailed support correspondence, private reference identities and delivery receipts in the private project record. If readiness fails, report the exact sanitized stage, continue independent authorized cloud work, and request a user exception before changing execution environment.

## Handoff receipt

The final private receipt supplies the final merged main SHA, tested source SHA, exact CI URL, deployment ID/READY state, canonical alias, confirmed Library screenshots and remaining acceptance limits. No production game commands, migrations or data resets are part of this handoff. The parent coordinator must create and verify the fresh cloud workspace; this document is not evidence that it has already been synchronized or is ready.
