# Draft and selected-game transfer efficiency

This change compares against released commit
`ef8a0d6cfaad42985e0df047b9d8f64340dc3dba` on the same Cloud executor.
It changes application reads and an entry-card asset; it needs no schema migration.

## Scrabble draft publications

Each publication still checks active membership, scoring permission, designated
scorer, revision, generation, active status and pending ending under the existing
family lock. A genuinely unchanged, unexpired heartbeat from the same stream
renews its sequence and expiry in PostgreSQL. Placements must match the saved,
server-scored entry, and the sequence must increase. Canonical position changes
increment revision under that same lock. Changed or expired heartbeats still score
the current authoritative position. Superseded streams and delayed clears retain
the existing acceptance rules.

Scoring now selects only the board, dictionary reference, verified additions,
current player, rack counts and tile supply plus game identity/revision. It does
not transfer the growing journal, turns, scores, result or player profiles.
Preview scores, validity, overlap rejection and revision/scorer fences retain the
same behavior. No private rack content is added to requests or responses.

## Selected Crokinole games

Selected game reads now accept the existing private refresh header and return a
`crokinole-game-refresh-v1` envelope scoped to the selected game. Older clients
retain full reads; the new client also accepts full responses from older servers.
Every read still authenticates the account and current family membership, applies
RLS and checks schema compatibility in a read-only repeatable-read transaction.

The fingerprint covers definition, projection, revision, the ordered permanent
journal, scorer/generation, mode, concerns/resolutions, viewer membership and
permissions, palette/defaults, feature availability, and the current scorer's
private draft revision/payload. An unchanged revision cannot conceal tampered
history. Changed reads still run canonical integrity validation. Removed or
inaccessible games reject matching hints; other viewers do not receive or track
private draft changes. Snapshot and version come from the same database snapshot.

The bounded memory cache belongs to one account/family store, distinguishes game
and history-page scopes, and clears after failures, mutations, or closure. Full
fallback reads retire their old hint. Local dirty drafts still reconcile with
remote revisions and generations. Existing polling cadence and history behavior
are retained.

## Paired measurements

Activate the saved Cloud tools and restore the approved private inputs, then run:

```sh
AMBERLY_F4_RECEIPT=/tmp/draft-refresh-paired.json \
  node scripts/benchmark-draft-refresh.mjs \
  ef8a0d6cfaad42985e0df047b9d8f64340dc3dba
```

The harness loads the actual baseline readers beside their imports and removes
them afterward. Both versions use the same isolated PostgreSQL 17.6 cluster,
canonical migrations, two synthetic players, and one warmed `prepare:false`,
`max:1` connection through a loopback byte-counting proxy. Scrabble uses legal
exchange journals at 0/40/100 events, a central AT publication and three identical
heartbeats. Crokinole uses 0/20/100 scored rounds in a fixed-100-round singles game,
three unchanged reads and a conditional-history control. Each step records DB
bytes, JSON/gzip response bytes and elapsed time. The two control read paths are
unchanged; games accumulate in the fixture family across size scenarios.

The [paired receipt](benchmarks/draft-refresh-2026-10-14.json) includes every
sample, source-file hashes and EXPLAIN ANALYZE/BUFFERS summaries. Representative
server-to-application DB bytes (all three idle repeats have the same byte count):

| Read | Journal size | Released | Candidate |
| --- | ---: | ---: | ---: |
| Scrabble publication | 0 / 40 / 100 | 4,100 / 36,299 / 84,726 | 3,273 / 3,276 / 3,279 |
| Scrabble heartbeat | 0 / 40 / 100 | 4,100 / 36,299 / 84,726 | 1,575 / 1,576 / 1,577 |
| Crokinole selected idle | 0 / 20 / 100 | 3,576 / 22,366 / 97,776 | 1,359 / 1,359 / 1,359 |

The heartbeat acknowledgment remains 17 JSON bytes. At 100 rounds, Crokinole's
idle JSON falls from 54,867 to 114 bytes. Cold Crokinole reads add 305 DB bytes
and 108–110 JSON bytes for the fingerprint and envelope.

Hashing still reads and serializes the history inside PostgreSQL. Its measured
execution times at 0/20/100 rounds were 0.241/1.803/6.066 ms, with 10/101/427 shared
buffer hits and zero shared reads in the warm fixture. This is a transfer
optimization, not a claim that database CPU stops growing with history length.
Elapsed samples vary; these figures exclude TLS/pooler overhead, Supabase Auth
HTTP and HTTP headers. They do not establish household savings, billing or quotas.

## Animated entry asset

Only `GymEntryCard` selects `/gym/scarlett-entry.webp`. The original 640px Gym
animation remains unchanged at SHA-256
`e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e`.
The 360px derived image supports the 144–180px entry display at approximately 2×.
Layout, alt text, focus order and the Open Gym action are retained.

Run `node scripts/prepare-scarlett-entry.mjs` with the pinned installation to
reproduce the derivation. It verifies the approved source before encoding and
checks all frames, delays, loop and transparency before replacing the derivative.
The [asset receipt](benchmarks/scarlett-entry-2026-10-14.json) records source and
output hashes, encoder versions and settings. Output is 2,844,668 bytes versus
7,270,588 bytes, a 60.9% reduction; both have 120 frames, the same 5,000 ms timeline
and an infinite loop. All alpha samples match the source resized to 360px. The
cream-composited comparison at 360px measures 38.749 dB PSNR overall (minimum frame
38.113 dB). Sampled poses were inspected at 180px; lossy/resized pixels are not
claimed to be identical to the 640px source.

The [browser receipt](benchmarks/scarlett-browser-2026-10-14.json) compares cold
context visits in all four profiles; each requests 2,844,668 instead of 7,270,588
bytes with identical image bounds and viewport. The browser check makes cold
context visits at identical profile/viewport sizes,
records the requested URL and response bytes, compares two rendered animation
frames, checks the image geometry, and activates Open Gym by keyboard. Static
asset transfer is separate from database egress. Physical-device quality and
household network behavior remain separate acceptance checks.
