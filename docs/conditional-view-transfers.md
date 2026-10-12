# Conditional replay, spectator and Record Book reads

Replay requests use the existing authorized refresh protocol with a distinct
`replay:<gameId>` scope. They load only the selected game and its participating
player profiles. The viewer keeps a memory-only cache scoped to the user, family
and game, discarding it on failed reads. Existing game removal, practice access,
profile revision, scoring generation and membership checks still run. The client
also accepts the older backend's game-specific refresh scope during rollback;
separate catalog versions prevent reuse of the wrong profile-access subset.

Spectators send a memory-only scoreboard version. PostgreSQL evaluates the
existing authorized `read_watch` function on every request and omits unchanged
scoreboard JSON before it crosses the database connection. Drafts keep their
existing separate one-second reads, so a draft heartbeat does not resend the
board. Completed games still check link validity every five seconds.

Crokinole polling follows the current route: lobby, Crokinole, Record Book and
Settings. Scrabble, Players and History do not fetch unused Crokinole snapshots.
Record Book pages use authorized conditional reads with a bounded, memory-only
cache. The version includes page contents and boundary, membership/permissions,
palette/defaults and feature availability. Refresh still traverses all loaded
pages atomically, so corrections, insertions and removals remain visible.
The pagination sentinel no longer transfers a complete extra game.

No domain commands, persistence schema, migration, permission policy or production
data changed. Polling cadence is retained: lowering empty draft frequency would
delay discovery of the first tile. No cross-tab ownership or auth cache is added.

## Reproduce the paired database benchmark

Activate the pinned cloud tools, restore approved private inputs, then run:

```sh
AMBERLY_REFRESH_RECEIPT=/tmp/conditional-view-transfers.json \
  node scripts/benchmark-view-transfers.mjs \
  6649aba8a7c8d4fd87d0a8fd04600b0033312a3b
```

The script temporarily loads the actual baseline repository readers beside their
normal imports and removes those files afterward. Both reader versions use the
same isolated local PostgreSQL fixtures and warmed protocol-byte counter, with
`prepare:false`. The fixture includes deterministic photos, 21 Scrabble games,
32 Crokinole games, a new page-boundary insertion, moves, draft activity and a
finalized spectator view. Concurrent reads use two independent warm caches;
the database test connection has one slot, so SQL transactions serialize.

The [sample receipt](benchmarks/conditional-views-2026-10-12.json) records bytes
and timings. Selected database server-to-client byte counts:

| Read                             | PR52 baseline | Conditional read |
| -------------------------------- | ------------: | ---------------: |
| Replay cold                      |       414,122 |          181,079 |
| Replay unchanged                 |       414,122 |            1,787 |
| Replay after one turn            |       415,554 |            6,172 |
| Spectator unchanged              |         2,852 |              409 |
| Finalized spectator unchanged    |         3,534 |              409 |
| Record Book unchanged first page |        31,147 |            1,408 |

These are paired transport measurements, not provider bills or complete-session
savings. They exclude authentication-service traffic, TLS/pooler framing, browser
HTTP overhead and the unchanged one-second draft stream. Cold/changed spectator
responses add a small version overhead. Crokinole hashing still reads/serializes
page states inside PostgreSQL; reduced wire bytes do not establish reduced CPU.
Exact timings vary by machine. Browser tests separately check hidden/resumed
refresh, reconnect, route transitions, replay position, draft change/clear,
access loss and multi-page history preservation.
