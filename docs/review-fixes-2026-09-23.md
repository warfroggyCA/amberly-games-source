# Code-review fixes — local candidate

Source: consolidated X10 checkout, `codex/crokinole-shared-hub`, based on `631fe08`. These changes are local and uncommitted. No hosted migration, production data repair or deployment was performed.

| Review item | Resolution |
| --- | --- |
| D1: incomplete migration instructions | One ordered migration manifest drives PostgreSQL tests; tests also check the release guide matches it. The integrity migration rejects missing defaults, nickname or invitation prerequisites. Repository transactions reject a missing schema capability before proceeding. |
| D2: ended-early amendments | New correction/undo commands preserve ended-early status. Explicit, reasoned Resume supports zero-round games and retains restored drafts. Original v1 journal commands retain their replay semantics; stale clients must reload before new ended-early amendments. |
| D3: unlogged integrity failures | Family, Crokinole and combined-history repository failures now log a privacy-safe incident and return its ID for server errors. |
| D4: Scrabble ownership policy | The database requires scoring permission plus current ownership or takeover permission. Redundant game-head row locks were removed from paths already serialized by the family lock, preserving concern/report, approval and retry access for non-scorers. |
| D5: result/concern integrity | Projection changes require the next matching immutable journal append; orphan events and duplicate command IDs are rejected. Combined history replays returned Crokinole games and compares their complete state within the same read snapshot. Concern updates can append one resolution but cannot rewrite the original report or an existing resolution. This preserves the current table/data format. |
| R1: long replay under family lock | Replay no longer repeatedly clones accumulated events, normal appended rounds reuse the verified projection, and corrections no longer rebuild twice. Mutation preflight replays outside the family write lock, then rechecks state and current ownership under the lock. Changed snapshots are retried at most three times; conflicts retain input. The existing 5,000-event allowance remains. Repeated corrections still require recalculating affected score histories; no constant-time performance claim is made. |
| R2: rollout flag | Direct saved-game/history access intentionally remains available. Scoring, creation, equipment changes and administration controls now consistently reflect paused Crokinole writes. |
| R3: optional account header | Family, Crokinole and combined-history routes now require the expected-account header and reject missing/mismatched accounts before repository access. |
| R4: command uniqueness | A generated command ID and per-match unique constraint supplement existing request idempotency and transaction locking. |
| R5: hosted/physical evidence | Remains a release-verification task, not a local code defect. Hosted migration state, actual login grants, off-device backup custody and physical iPhone/iPad acceptance were not verified here. |

## Validation

- Node 24: **840 unit tests passed**. The PostgreSQL group is skipped in this invocation and run separately.
- Disposable PostgreSQL 17: **73 tests passed**, including real scoring, concurrent requests, SQL-level permission/tampering checks, incomplete-schema rejection and two backup/restore checks.
- Production-mode Playwright: the full 180-case run produced 176 passes, three existing platform skips and one new test synchronization failure. The test had asserted against a Resume button already visible before undo finished; it now waits for completion. All **32 Crokinole journey cases passed on rerun**, covering that case and retained-draft Resume across desktop Chromium, iPhone WebKit portrait/landscape and iPad WebKit. Together these runs cover 177 passing cases and the three existing skips. Browser API fixtures are synthetic; they do not prove hosted behaviour or physical-device acceptance.
- Production build, TypeScript, lint, formatting, credential preflight and `git diff --check` passed.
- Full-cap replay stress covers 5,000 appended events and 2,500 rounds followed by 2,500 corrections. The test checks replay correctness and avoids accumulated-journal copies; its timeout allows shared-runner CPU contention rather than asserting a hardware-dependent latency.

## Release order

Follow [releasing.md](releasing.md#complete-ordered-application-schema). Reconcile the hosted schema and approved backup first, then apply the reviewed missing migrations, including `20260923235027_review_integrity_guards.sql`, before deploying this build. Do not deploy this application ahead of that migration: its compatibility guard deliberately fails closed.

Existing history is retained. After new amendment/resume events are recorded, any rollback build must understand those event types and retain the additive integrity protections. Exact-commit GitHub Verify and release approval remain outstanding; local checks do not satisfy that release gate.
