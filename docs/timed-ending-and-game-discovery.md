# Timed ending and game discovery

This is an implementation record, not a deployment receipt.

The ending-review preview previously omitted `timedAt`, even though saved
commands included it. A game whose clock had started therefore rejected a valid
finalization preview with `TURN_TIME_REQUIRED` and disabled confirmation. Preview
and save now share timestamp construction; rack counts, physical tile inventory,
ending conditions, revision checks, scorer permissions and backward-clock
validation remain enforced. Rejected rack-entry warnings clear when leaving the
field; the accepted rack retains its own validation state.

The Games page now lists all loaded unfinished Scrabble games, with active games
before paused games and newer games first. The old single shortcut could hide a
new game behind an older paused game. Opening an entry changes the local selection,
not its status. All saved games remains available through History; household and
private-test access still come from the existing authorized shared state.

Total game time appears above the board, and the current-turn clock appears with
the active player. Both derive from the existing timing journal. Pauses are
excluded; sleep, ending review and time spent before undo remain game time. No
historical timestamps are rewritten. Timing begins only after the existing
explicit clock-start action.

A signed-in participant sees their own seat at the bottom of the local layout.
The board rotates for that viewer with upright letters and premiums; arrow keys
map back to canonical coordinates. Canonical seats, board tiles (including blank
identity), turn order, scores and command coordinates do not change. Unlinked
accounts and private-link guests retain the canonical perspective. Compact
landscape layouts keep seats in their existing lower/upper side positions.

## Verification and rollout

Regression coverage lives in `timed-ending.spec.ts`, `scrabble-discovery.spec.ts`
and `board-perspective.spec.ts`, alongside the existing interrupted-save,
tab-ownership, database and integrated tests. Fixtures use isolated game journals
and local/mock services; no real game is finalized or edited for testing.

There is no storage migration, key change, reset or data conversion. Keep both
existing and new games and all pending commands. Before refreshing to a released
build, finish saving the current entry or resolve its pending save. Unsubmitted
ending-rack letters and count-dialog edits are temporary form state: note them
before refreshing and re-enter them afterward. Do not clear website data.

Release still requires the exact-commit protected Verify workflow and the
approved Preview/canonical-alias process in `releasing.md`. Physical-device and
signed-in hosted acceptance remain separate from browser emulation.
