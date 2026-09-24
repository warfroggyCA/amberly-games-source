# Shared Crokinole release notes and operator sequence

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
4. Apply the reviewed missing migrations in the complete ordered [application schema list](releasing.md#complete-ordered-application-schema), including defaults, player nicknames, invitation onboarding and integrity guards. Reconcile provider timestamps against actual schema; do not run a blind migration push.
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

Local implementation and automated verification are complete. See `crokinole-gauntlet.md` for counts, review evidence and limitations. No hosted migration, release, production repair or physical-device acceptance is implied by this document.

## Review fixes (local candidate)

Corrections and undo now preserve an explicitly ended-early match. Resume match is a separate confirmed, reasoned action, including for a match ended before its first round. New event types preserve replay of original histories; stale clients must reload before amending an ended-early match. Naturally completed matches may still reopen when a correction removes their finish condition.

Crokinole integrity failures receive a privacy-safe incident log and response ID. Account identity headers are required on family, Crokinole and combined-history requests. The database enforces scorer permissions, append-only projection transitions, unique command IDs and immutable concern evidence. History summaries replay the selected Crokinole journals within the same database snapshot, using batched reads.

The rollout flag is a write switch, not a schema-installation switch. Turning it off keeps direct routes and saved history available while disabling Crokinole scoring, creation and administration controls. Scrabble remains available. Journal replay no longer clones the accumulated event list at every step, and the existing 5,000-event history limit is retained. Mutations replay in a read snapshot before acquiring the family write lock; they recheck the projection and current ownership under that lock, retrying a changed snapshot up to three times before returning a safe revision conflict.
