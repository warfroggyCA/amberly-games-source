# Crokinole implementation and Gauntlet record

Historical milestone status at the time of this record: local implementation and integrated Gauntlet verification completed on 2026-09-17, before publication/hosted migration. See the [release ledger](release-status.md) for subsequent deployment evidence and repairs; this line is not the current release state.

Baseline: `8a1bfdb8941d7729d4013617284381180882f596` on `polish-watch-sharing`. Implementation branch: `codex/crokinole-shared-hub`.

## Acceptance contract

The implementation follows `crokinole-implementation-plan.md` and the user's original scoring acceptance cases. The shared roster, sign-in, permissions and history remain common to both games. Scrabble journals, finality, private-test restrictions, viewing links and the independent local sandbox retain their existing meaning. Crokinole collects atomic completed-round totals; no simulated board, per-shot tracking or anonymous spectator service is added.

Evidence required: pure scoring and malformed-input tests; real isolated PostgreSQL tests for transactions, policies and replay; IndexedDB interruption/recovery tests; rendered phone, tablet and landscape flows; existing lint, typecheck, build and regression suites. Browser device profiles do not establish physical iPhone/iPad acceptance.

## Review and revisions

Bounded builders implemented the domain, database and UI separately. They independently reviewed portions they had not built; the lead integrates and verifies the complete experience. The environment's agent limit prevented adding a fourth fresh critic, so subsequent reviews reuse the existing agents against other portions.

Material findings corrected:

- Cursor timestamps lost sub-millisecond precision and could skip older matches. Preserve PostgreSQL timestamp text through cursor encoding and parameter casting; exercise same-timestamp pagination.
- New-game participant labels could differ from verified roster identities. Bind new labels to the selected people; preserve historical snapshots for rematches through a dedicated operation.
- A rematch could fail after a palette colour was hidden or a profile renamed. Create rematches from the saved definition while checking current roster membership and permissions.
- Malformed or incomplete successful responses could be mistaken for an accepted save. Validate the expected business result before retiring the durable pending request.
- A failed local acknowledgement checkpoint could lose the in-memory pending action; cross-device draft replay could overwrite newer input or appear synchronized incorrectly. Add failure reproductions and explicit conflict reconciliation.
- Enum coercion admitted array values; correction preview replayed prefixes quadratically. Require actual enum strings and use one chronological projection.
- Initial scorer generation differed between client and server. Use generation one consistently.

## Focused implementation choices

The domain is one cohesive `src/domain/crokinole.ts` module rather than a folder of small modules. One Crokinole API accepts typed operations including drafts. This preserves a single authorization/retry boundary without introducing a separate draft route.

The database uses five additive tables. `crokinole_games` holds a protected immutable definition beside its mutable, replay-verifiable projection. Journals remain append-only; removal is an irreversible private-test marker with audit evidence. Separate definition/head/participant/removal tables proposed in the planning document were unnecessary for this bounded feature. Roster identity is verified transactionally during creation; historical identity snapshots are retained.

Legacy Scrabble exports remain supported. The combined games endpoint supplies a versioned multi-game archive without changing the legacy response contract.

## Release boundary

Apply the additive migration only after a separately approved hosted-schema review and backup/recovery rehearsal. `AMBERLY_CROKINOLE_ENABLED` defaults off. Install the schema before enabling the hub and write operations. Do not remove data when disabling the feature. Existing direct reads must remain available.

The local work does not claim remote CI, deployment, hosted migration or physical-device acceptance.

## Final integrated evidence

- `npm test`: 804 passed. The 58 database cases are deliberately excluded from this command and run separately against real isolated PostgreSQL.
- `npm run test:database`: 58 passed, including restricted-role authorization, replay, concurrency, private-test isolation and backup/restore checks.
- `npm run test:browser -- --workers=2`: 105 passed, 3 skipped. The skips are the existing Chromium-CDP touch scenario on the three WebKit profiles; pointer/keyboard paths run on those profiles. All 40 new Crokinole/hub scenarios passed across desktop Chromium, iPhone WebKit, iPad WebKit and iPhone landscape.
- Production build, TypeScript, ESLint and Prettier checks passed. Credential preflight passed for all 295 tracked files; `git diff --check` is clean.
- Browser runs use intercepted shared APIs, not the hosted service. The database suite separately exercises real repository operations and migrations. These complementary layers do not substitute for signed-in hosted release verification.
- Final rendered phone hub, phone standings, tablet score sheet and landscape entry were inspected. Review captures are retained at `/Users/dougfindlay/Documents/Codex/amberly-crokinole-review/` outside the source checkout.

Additional revisions from integrated review: keep Save Round reachable on short viewports; restore standings scroll after saving; preserve uncertain mutations until both server acknowledgement and local checkpoint succeed; quarantine unreadable local workspaces only after confirmation; avoid claiming a Crokinole workspace when opening Scrabble directly.

Earlier failing regression cases and viewport checks were corrected and rerun; none were waived. Independent cross-reviews found no remaining material blocker in their reviewed portions. The lead's final integrated pass found no additional release-candidate blocker. Stop the local loop here: remaining verification is release-environment and physical-device acceptance, with separate hosted-change authority.

## Release CI follow-up

The first hosted Verify run (35218614368, candidate 676793b) passed all non-browser checks, then reported 104 browser passes, 3 expected skips and one iPhone rematch failure. The captured state showed a background read rejecting an enabled Rematch action as another save. This was an application race, not a timeout to waive. Mutations now await the in-flight read and recheck ownership/pending state afterward. Two store cases cover normal completion and access revoked during that read; the browser rematch test deliberately holds the next refresh across the click. A new exact-commit Verify run is required before release.
