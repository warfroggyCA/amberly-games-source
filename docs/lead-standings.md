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

The UI labels every result as a snapshot with its client request date/time and
an always-visible warning that older history, disputes or access changes may not
appear until manual Refresh. This time is not a server verification timestamp or
promise of live accuracy. The existing family refresh sees only the recent game
window, plus catalog/access information; no new full-history poll is introduced.
Observed membership/access/game/removal changes, focus and visibility changes
clear the snapshot. In-flight stale responses cannot restore it. Failed loads
clear data. Manual Refresh starts a new authorized repeatable-read snapshot,
including old games outside the recent page; it rechecks protests and all canonical
bytes before cache reuse. A removal drops its contribution, revocation denies the
read, and invalid/newly mismatched evidence becomes unavailable instead of retaining
old totals. Corrections and undo recorded before finalization use effective turns.
Ordinary correction/undo commands on already finalized games are rejected; this
feature does not add an amendment or history-rewrite capability.

Cold validation runs in the server's Node process, not the browser main thread.
It now cooperatively schedules between replay commands, including nested replay
inside a historical correction, using the **same** validation generator as
synchronous hydration. Exact event and final projection comparisons are unchanged.
The browser shows an indeterminate status (no invented percentage), lets users
cancel, and remains navigable. Cancel, unmount, focus/visibility invalidation and
superseding loads abort the fetch; request cancellation is forwarded through the
route and repository to cooperative hydration. Cancelled work is not cached as
unavailable. Disconnect signalling is transport-dependent, and SQL, hashing,
projection and final comparison remain indivisible work between checkpoints.
Cancellation is cooperative, not a hard deadline or guaranteed database-query abort.

The opt-in `AMBERLY_BENCHMARK=1` test measures one maximum-event game plus a shorter
mixed correction/undo/exchange game directly in Node. The 5,000-event fixture has
4,994 pause/resume actions and only five effective turns: it stresses journal
copy/reprojection cost, not a typical game, dense board or family-scale load.
A cloud run measured 17.0 seconds synchronous versus 17.8 seconds cooperative, with
1,251 timer heartbeats, largest timer gap 37 ms and cancellation in 31 ms. The
500-event mixed fixture measured 436/462 ms, largest timer gap 14 ms and cancellation
in 26 ms. Cooperative scheduling improves responsiveness, not total CPU complexity.
The previous 16.7-second measurement did not exercise HTTP or browser responsiveness.
These direct Node results and separately held-response browser tests are not a
hosted concurrency, end-to-end latency or strict scheduling guarantee.

A one-second work budget checked between cold game validations still marks remaining
games **pending verification**. It cannot cap the total duration of one large game.
**Verify more histories** runs only on request; no automatic retries or polling.
Process-local progress can reset on another worker/restart/whole-family eviction.
Large families still incur full-history reads and hashing. Client requests have the
existing 40-second timeout; hosted CPU/response limits still require deployment review.

Tests cover weighted aggregation, unequal participation, empty coverage, ties,
deduplication/revisions/undo, cache corruption, RLS/access/removal/private-practice
rules, sorting, stale-response clearing and unchanged refresh requests. Hosted
exact-head CI and publication approval remain separate release requirements.
