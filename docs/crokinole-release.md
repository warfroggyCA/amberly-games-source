# Shared Crokinole release notes and operator sequence

This is the original rollout procedure. For current observed deployment and candidate status, consult the [release ledger](release-status.md). Do not reapply migrations based on this historical sequence.

This feature adds Crokinole to the existing Amberly family. It reuses accounts, roster IDs and member permission switches. There is no new sign-in provider or service.

## Local implementation

- Hub, shared history, existing players and equipment destinations under `/family`.
- Crokinole singles, doubles and Family Free-for-All with cumulative, differential and NCA-style scoring choices.
- Atomic round entries, chronological phone history, wide score sheet, corrections, undo, completion and rematches.
- Shared equipment colours with immutable match snapshots.
- Scorer-account access, synchronized private drafts, retained uncertain requests, current-tab ownership and explicit draft conflict resolution.
- Concerns and superadmin-only private tests, including audited removal.
- Version 2 combined archive; legacy Scrabble archive remains compatible.

No Crokinole anonymous watch links, per-shot data, new ratings or rankings are included.

## Safe rollout

1. Complete local and CI checks against the final candidate. Record exact commit and test evidence.
2. Review current hosted migration history and restricted runtime grants. Local migration version names are not proof of the hosted baseline.
3. With hosted-change authorization, capture a current encrypted backup using the existing operator workflow; rehearse restoration to an isolated database and compare table digests.
4. Apply only the reviewed additive migration `20260917105407_crokinole_shared_scorer.sql`. Do not run a blind migration push.
5. Publish the matching application with `AMBERLY_CROKINOLE_ENABLED=false` first. Verify existing Scrabble and sign-in behaviour. Do not use real family matches as synthetic test fixtures.
6. Enable `AMBERLY_CROKINOLE_ENABLED=true` for the family hub and Crokinole writes after checking schema compatibility.
7. Verify superadmin and ordinary-member paths, private-test isolation, account-based scorer access and combined history. Record deployment identity separately from the local build.
8. Complete physical iPhone/iPad Home Screen checks: safe areas, keyboard entry, portrait/landscape, background/resume, retained drafts and corrections.

Turning the flag off pauses Crokinole mutations; saved match reads and direct history remain available. Keep the additive schema and records. Roll back with a build that retains existing authorization/private-test protections; never drop tables or return to an older unsafe permission implementation.

## Persistence and privacy

The five new tables are inside the existing private `scrabble` schema so the full-schema backup includes them automatically. Definitions and journals preserve original names, colours and raw scores. Corrections append events; totals are replayed, not patched counters. Private-test removal retains internal audit evidence.

The Crokinole IndexedDB workspace is separate from Scrabble, keyed by family and verified account. Local storage failure must leave visible input available and block unsafe progression. A network timeout retains the same request ID for retry. Cross-device differences require an explicit choice; they are never silently merged.

Combined JSON archives are useful for inspection, but are not a replacement for the encrypted full database backup. They include game-specific sections and preserve the legacy Scrabble export contract. Each game collection uses its own authorized repeatable-read snapshot; the combined JSON is not a single atomic disaster-recovery snapshot across both games.

## Release status

The original local implementation and automated verification were completed in the milestone recorded in `crokinole-gauntlet.md`. Subsequent deployment evidence and Gauntlet repairs are recorded separately in the [release ledger](release-status.md). This historical document does not establish physical-device acceptance.
