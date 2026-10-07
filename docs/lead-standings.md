# Scrabble lead rankings

History → **Scrabble lead rankings** → **Load Scrabble lead rankings** reads a
fresh authorized full-history snapshot on demand. Five independent sortable
measures are available: leads taken, total turns led alone, longest streak,
average streak and percentage of eligible turns led. These do not change the
existing win ranks or rating formula. History's player/game/page filters do not
change aggregate coverage.

The candidate population is visible, nonremoved, confirmed finalized multiplayer
Scrabble games. Private practice is excluded even for an administrator. Ranking
eligibility follows `competitiveResultEligible` and existing unresolved/upheld
protest rules: early, assisted, custom-supply or otherwise noncompetitive games
are excluded. An eligible candidate still needs its exact word-list version and
a complete canonical journal whose definition, events, revision and replayed
projection agree. Unverifiable records are unavailable, never fabricated zeros.
The per-game Replay panel remains descriptive and can therefore cover a broader
set of games than these competitive rankings.

The table shows global qualifying/completed-game coverage, unavailable histories
policy exclusions and pending verification, plus each player's qualifying/completed games and eligible
turns. Only stable player IDs are combined; equal names and archived names never
merge identities. The database supplies one current head per game, and the pure
aggregator also deduplicates by game ID/latest revision, refusing conflicting
same-revision evidence. A new snapshot replaces old totals, including removals.

One completed turn by any participant is one checkpoint for every participant in
that game. A lead starts on the gaining turn and ends before the losing/tie turn.
Ties terminate sole streaks; co-leading checkpoints are separate. All-zero starts
give no lead. Final rack adjustments add no turn or new played streak. Counts
use corrected effective turns, excluding undone/superseded turns.

Average streak is **sum of sole-leading turns / sum of lead entries**, not an
average of game averages. Longest is the maximum individual streak, never a
streak spanning games. Regains are summed within each game after that player's
first lead. Turns-led percentage is **sole-leading turns / all completed turns
in qualifying games that player participated in**; it does not use only that
player's own turns or other players' unrelated games. Tied-top turns are excluded
from its numerator. A player with no qualifying games gets unavailable measures;
an eligible zero-lead game contributes legitimate zero leads. No streaks gives
an unavailable average/longest, and zero eligible turns gives an unavailable
percentage. Unavailable values sort last in either direction.

## Data access and performance

The optional `leadCounts=1` History read uses the existing authenticated account
header, active membership, restricted SQL role, RLS and repeatable-read snapshot.
It returns aggregate numbers only, not full journals or rack details. There are
no migrations, writes, persistent summaries, extra polling requests or history
scans in the normal refresh path. Canonical event reads are batched in groups of
25 games. A process-local LRU retains compact verified summaries for at most four families,
evicting a whole least-recently-used family rather than individual games mid-verification.
Up to 5,000 completed games per family are supported; larger candidate sets return
an explicit capacity error without totals or a promise that retrying will finish.
Authorization, removal/protest status and exact canonical content are checked
before reuse. All available cache hits are collected before new validations, avoiding
sequential scan thrashing. Removed games are pruned and changed revisions replace
old summaries; no full journals or spell lists are retained in this cache. Hashes include family/game identity, revision, definition, state
and permanent events, so same-revision corruption cannot hit a cached summary.
Deterministically invalid journals retain an unavailable assessment under that
content key so repeated attempts cannot starve later games. Supported word-list
versions are bundled and immutable for a process: unavailable versions are cached
as unavailable, and deployments/process restarts recreate that cache. Changed
evidence is always rechecked.

The UI clears its snapshot on observed membership/access/game/removal changes,
focus or visibility changes, and requires explicit reload. In-flight stale
responses cannot restore it. Failed loads clear data. Existing family polling
continues unchanged; there is no promise of instantaneous detection of a remote
change before that existing refresh observes it. Manual Refresh performs a new
authorized snapshot, including old games outside the current recent-game page.

The opt-in `AMBERLY_BENCHMARK=1` performance test builds a legal 5,000-event game
and measures first validation, derivation and verified reuse. The cloud review
run measured approximately 17.3 seconds cold, 21 ms for counting, and 8 ms warm.
Cold hydration uses the existing command replay and can be slow for maximum-size
journals. A one-second work budget, checked between cold validations, defers
remaining games as **pending verification**. The UI labels partial coverage and
offers **Verify more histories**; it never automatically retries. Already verified
results still require current authorization and matching canonical bytes. This is
a soft budget: it cannot interrupt a single synchronous validation, so one very
large journal may exceed it. It is an on-demand cost, not polling overhead. The benchmark is one
synthetic large game, not a hosted latency or whole-family scalability guarantee.

Tests cover weighted aggregation, unequal participation, empty coverage, ties,
deduplication/revisions/undo, cache corruption, RLS/access/removal/private-practice
rules, sorting, stale-response clearing and unchanged refresh requests. Hosted
exact-head CI and publication approval remain separate release requirements.
