# Private post-turn coaching

The scorer chooses coaching before game creation. Everyone can review registered
turns using the same mode; the setting is immutable. Classic and Word Buddy word
checks, scoring and record eligibility retain their existing behavior.

## Review boundary

Review pairs an original journal turn with its authoritative pre-turn projection.
It never subtracts tiles from the final board to invent history. Missing journals,
undone turns and assisted placements are unavailable. Later corrections are clearly
labelled, and the original rack must be re-entered. Later dictionary additions,
supply changes, opponent racks and newly drawn tiles do not enter the position.

A player selects a seat locally on their own device. This is a local preference,
not authentication or additional access. Signed-in views already have an authorized
game snapshot. Guests use the existing valid viewing link and an on-demand GET at
`/api/watch/coaching?turnId=...`; the rack is never included in that request.

The runtime-only `read_watch_coaching_source` capability preserves all existing
watch-link predicates and additionally requires coaching mode. Its journal source
stays inside the trusted repository; the HTTP response explicitly projects only
the historical board, original turn, dictionary/additions, supply and count, source
sequence, game/revision identity and correction flag. No new anonymous database
grants, account requirements, cookies or credentials are introduced. Every read
reauthorizes, including after prior successful reads. Ordinary polling adds only
the coaching flag and a rack-continuity scalar; analysis is never polled.

## Private rack lifecycle

Racks and snapshots live only in component memory and the local worker. They are
not saved to IndexedDB, local/session storage, game commands, drafts, URLs,
analytics or the server. Reload, navigation away, seat change or another device
loses this information. A shared scorer screen is not private.

Players may confirm a starting/current rack, then enter refills. Confirmed plays
snapshot the pre-turn rack before removing physical tiles; a represented blank
consumes `?`. Exchanges require both returned identities and replacement tiles,
matching the recorded count. Missing refills or skipped exchanges produce explicit
incompleteness. Confirmation resumes current tracking without repairing past gaps.

A continuity scalar changes for undo, correction, reconciliation, supply extension
and assistance. Those changes clear uncertain tracking. Timer changes, dictionary
confirmation and finalization preserve rack snapshots. Turn-prefix comparison and
revision checks prevent duplicate application. Bag-empty plays do not request
invented refills. Manual full pre-turn entry always remains available.

## Analysis limits

A dedicated browser worker uses the existing placement solver and the same
histogram/distinct-score accumulator as Gym. Gold, silver and bronze are distinct
score tiers, with ties sharing a medal. Fewer than three tiers is valid. Only a
complete search certifies medals or a maximum. The worker is bounded to two million
search states and 30 seconds, and is terminated on cancellation, closing, navigation,
backgrounding, seat changes or revision changes. No analysis records a pass or game
command. These are score leaders, not proven strategic optima; pass/exchange review
must not imply that their strategy was wrong. Legacy example dictionaries are
labelled as limited. Missing exact dictionary versions fail closed.

## Review and release

The migration is included in the ordered test manifest and exercised only in
isolated PostgreSQL tests during implementation. Applying it to a hosted database,
merging and releasing require separate approval. Once coaching definitions exist,
rollback must retain a coaching-compatible reader; older builds may not hydrate the
new immutable definition field. This document does not authorize a backup/export,
hosted migration, deployment, account change or new credential.

Tests cover domain projection/medals, physical racks and continuity, HTTP errors,
real database authorization, guest browser privacy/mobile behavior, and a real
Next/PostgreSQL anonymous viewing-link journey including revocation. External auth
is simulated only in the isolated integrated harness; physical-device and hosted
acceptance remain separate.
