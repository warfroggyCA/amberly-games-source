# Adversarial Gauntlet repairs — September 18, 2026

## Scope and acceptance contract

Repair the three confirmed defects and focused workflow improvements from the September 17–18 review. Preserve the family physical-game model: shared players, account-designated scorer, observers, private links, superadmin-only tests, and immutable historical evidence. No deployments, hosted migrations, real-record repairs, new services, or permission changes are part of this implementation.

Acceptance is observable behavior, not a test count:

1. A stale Scrabble draft stays intact and visible while other games/history remain usable. Only explicit confirmation removes it, using a writer-fenced durable checkpoint. Administrative acknowledgements must not silently rebase it.
2. Finished Scrabble summary totals agree with the saved final result for every ending kind, including ties and winner-changing adjustments.
3. A capability denial preserves Crokinole input and allowed viewing. A committed settings retry is acknowledged after capability reduction; new writes remain forbidden. True account loss preserves account-scoped pending data while permitting sign-out after a successful local flush.
4. Crokinole corrections expose readable original/new totals, reasons, recorded actors, outcomes, and excluded rounds without modifying history.
5. Short landscape view prioritizes scores and the next action; opening a different match resets retained setup scroll without scrolling on every score update.
6. Scrabble Play again reopens confirmed setup with the prior players/seats/starter/direction and creates a new game. It preserves the old result, uses current equipment selection, and retains private-test classification unless explicitly changed by the superadmin.

## Implementation and regressions

| Review item | Implementation | Regression evidence |
|---|---|---|
| D1 stale draft blocks hub | Per-game conflict state; retained-tile notice in scorer/viewer layouts; explicit discard; guards against normal edits and administrative rebasing | `shared-draft-recovery.test.ts`, existing shared-store tests, browser `gauntlet-repairs.spec.ts` |
| D2 wrong history scores | Finalized summaries read `result.scores`; unfinished summaries read running scores; malformed final results fail validation | Seven actual PostgreSQL cases in `game-summary-database-cases.ts`; integrated browser history compares −45/−7 |
| D3 capability denial traps pending save | Distinct capability/access-loss states; current permissions refresh; committed settings acknowledgement before new-write permission checks | Store cases, three PostgreSQL permission cases, four-layout browser paths, real integrated offline draft/retry denial/reload |
| U1 hidden amendment history | Read-only Changes disclosure, prior/new totals/results, reason, retained raw entries, excluded rounds; bounded rendering | Six projection cases, four-layout History-to-viewer journey |
| U2 landscape score visibility | Compact match heading/rules on short screens; reset scroll only on match identity change | Four-long-name landscape viewport assertions and screenshots |
| Optional Play again | New confirmed setup from prior player arrangement; new ID and existing append-only create path | Complete Scrabble finish/reload/replay browser journey |
| Integrated test gap | Normal sign-in/cookies and actual app APIs, RLS-backed repositories and real disposable PostgreSQL; only external Auth service is simulated | `npm run test:integrated`, included in `npm run check` and CI |
| Restore identity gap | Restored app-schema test exercises original UUID access, restricted role/grants, revoked/new-UUID denial, scorer write, retry and stale revision | Existing actual database restore rehearsal extended; provider Auth remains outside this evidence |

## Independent critique and verification

Builders and critics reviewed portions they did not implement. Independent critique caught two material intermediate D1 gaps: the early spectator render initially hid the recovery notice, and administrative acknowledgements could advance retained draft revisions. Both were corrected and received regressions before final browser acceptance. It also required the integrated test to preserve a temporary database if shutdown cannot be confirmed.

Local verification: 846 unit/API/store checks, 74 real PostgreSQL checks, 186 complete browser-suite checks (six intentional skips), and one integrated browser/HTTP/database journey passed. After the final recovery-layout adjustment, the 21 focused browser checks were rerun across the four profiles (three additional viewport-inapplicable cases skipped). Build, TypeScript, ESLint, formatting, credential preflight and the production dependency audit passed. No remote CI or physical device result is claimed. Raw logs and screenshots are retained in the task's repair evidence bundle. Reproduction tests were changed to assert the repaired behavior, rather than merely passing by asserting the defect. A test-only palette expectation was corrected to distinguish a null stored default from its legitimate hydrated family default. The stale-draft browser fixture waits for the durable draft before testing another-device conflict; rendered letters alone do not prove a checkpoint completed.

The full browser suite uses Chromium desktop and WebKit phone portrait, phone landscape, and tablet profiles. These are emulation, not physical-device acceptance. Read [integrated test boundaries](../tests/integrated/README.md) before interpreting its result.

## Remaining operational acceptance

- Hosted backup availability, retention, key custody, and complete provider/Auth recovery remain unverified. The dashboard required sign-in; no hosted capture/restore or paid setting was attempted. See [backup recovery](backup-recovery.md).
- Real Google consent, actual provider token refresh, and invitation delivery require a disposable provider-connected acceptance environment.
- Physical installed iPhone/iPad keyboard, safe-area, OS termination/sleep, storage eviction, and VoiceOver checks remain necessary.
- No remote CI or deployment is implied by local verification. See the [release ledger](release-status.md).
