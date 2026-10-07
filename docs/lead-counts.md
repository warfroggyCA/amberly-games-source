# Per-game Scrabble lead counts

Open **Lead counts** in a recorded game's Replay, including Replay opened from
History. The summary describes the complete corrected game, independently of the
playback position. This milestone does not add cross-game totals or rankings.

One completed turn by any player is one checkpoint. Plays, passes and exchanges
all count; pauses, corrections, undo commands and final adjustments do not add
turns. A sole-lead spell includes the turn gaining the lead and excludes the turn
losing it. Continuing ahead lengthens the same spell. A tie ends a sole spell;
tied-top turns are counted separately for each co-leader. All-zero scores count
as no lead. Regains are entries after that player's first sole-lead spell within
this game, including returns from a tie. They do not necessarily mean comebacks.

The summary shows spell lengths, entries/regains, total turns led alone, tied-top
turns and longest/average spell. Average is total sole-leading turns divided by
spell count, rounded to one decimal for display. No spells have zero entries and
turns, with longest/average unavailable. Turns are not full multiplayer rounds or
elapsed time; there is no clock dependency. Recorded assisted turns are included
and labelled; these descriptions are not competitive records.

Derivation consumes an authorized hydrated game and uses the existing read-only
journal projector. The final effective turns incorporate all recorded corrections
and undo exclusions. A single scan checks order, running scores and final
adjustments before deriving the counts. It never executes a command, modifies a
record, fetches a journal or starts a timer. Results are memoized for the mounted
record, not recalculated for each replay frame. Existing authorization and removal
handling apply; no API, polling, database or persistent-cache changes are needed.

Final deductions and transfers are a separate ending checkpoint. A changed final
leader is labelled and ends a sole spell, without adding a turn or a new played
spell. A winner can therefore have zero turns led. Incomplete/gapped or
inconsistent records show unavailable, never invented zero statistics. Solo and
unfinished games are outside this first milestone. Old games without timers work
when their journals are complete. Full validation of arbitrary imported journals
continues to belong to the existing hydration boundary.

For example, sole leaders after turns are A, A, A, tie A/B, A, B, B. A has spells
of three and one turns, four total turns led, two entries and one regain. B has
one two-turn spell. Each has one tied-top turn. Sole-leading turns across all
players never exceed completed turns; tied-top totals can overlap.

Tests cover correction/undo projection, counting boundaries, multiplayer order,
pass/exchange, all-zero starts, ties, final adjustments, invalid histories,
repeatability and no input mutation. Browser coverage checks keyboard disclosure,
stable totals during seeking, mobile width, unavailable histories, no game writes,
private-practice denial and removal. Any future all-games total must deduplicate
revisions and disclose coverage rather than treating missing journals as zero;
it must not add full-history reads to the refresh polling path.
