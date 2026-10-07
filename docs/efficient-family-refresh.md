# Conditional family refresh

The shared family store polls every five seconds while visible. Previously each
poll selected all inline player photos and the latest 21 full game states (20
were returned). The optional `x-scrabble-refresh` protocol now sends only changed
resources. It is a read optimization, not a scoring or authorization change.

The authenticated route still checks the current Supabase user, expected account,
scoring-device binding and active family membership. The database still checks
schema compatibility, sets the runtime role and actor/family context, and applies
RLS inside a repeatable-read, read-only transaction. A caller-supplied version is
only a bandwidth hint; it never authorizes access. Responses remain private and
no-store. Old clients and explicit archive/page/replay reads retain the existing
full response contract.

## Resource versions and correctness

A catalog fingerprint covers the family name, current member and permissions,
membership/player/invitation revisions, participant references, removal markers,
immutable verified-word identities and equipment. Per-player fingerprints use
family/id/revision; every supported profile/archive write increments that revision.
Per-game fingerprints include family/id/revision/update time, scorer identity and
generation, mode, current viewer permissions, participants, approvals and immutable
concern/resolution identities. They do not hash photos, boards or journals.

Only changed players select photo_data_url; only changed games select their full
authoritative state. No game is reconstructed from score totals or an incomplete
journal. Compact versions and changed values are read from the same database
snapshot, so a move cannot be acknowledged by a version newer than its content.
Removal and permission changes invalidate metadata/access and retain the existing
client filtering and local-draft conflict behavior.

The memory cache belongs to one store/account, has at most four request scopes,
and is cleared on access loss or close. The client reconstructs and validates a
complete SharedState before installing it. Refreshes stay serialized with saved
actions. Failed or malformed partial responses discard their cache entry so the
next request fetches a complete snapshot. A retired store cannot install late
responses. Header hints are bounded to 6,000 ASCII characters; resources omitted
from an unusually large hint are safely fetched again. No profile/game data or
refresh cache is added to persistent storage.

Visible polling remains five seconds. Hidden tabs skip refresh, visibility return
refreshes immediately, and an online event now also requests a refresh. This does
not introduce WebSockets or change live-draft/Crokinole polling. The family store
also runs behind the lobby; the measurements below cover this shared-family path,
not the sum of every request made by a lobby or spectator screen.

## Reproducible measurement

Run the isolated PostgreSQL suite with `AMBERLY_REFRESH_RECEIPT` set to a private
output path. The measurement test seeds eight synthetic players, four valid PNGs
(about 348 KB inline), and 21 games. A loopback TCP proxy counts actual PostgreSQL
server-to-application bytes using `prepare: false`, matching production. It also
records JSON response-body bytes and a separately calculated gzip estimate, plus
EXPLAIN ANALYZE/BUFFERS for the version queries under the runtime role.

Connection setup, TLS/Supavisor framing, HTTP headers and Supabase Auth responses
are excluded. Browser figures are response-body sizes, not a claim about all
browser network traffic. Multiple clients are represented by independent version
hints; there is no cross-client server cache. Test photos and games are synthetic.
This does not prove which requests caused the historical 6.66 GB pooler usage.

Initial loading still fetches full data and adds small version metadata. An
unchanged refresh fetches no photos or game states. A move fetches its one changed
game; a profile update fetches that one profile/photo. Older explicitly selected
games remain covered in addition to the current page. Large in-progress journals
still travel with their changed authoritative game; an event-delta protocol is
not part of this patch.

Measured example (bytes per request, one local run):

| Scenario | DB before | DB after | JSON before | JSON after |
| --- | ---: | ---: | ---: | ---: |
| cold-lobby | 409,202 | 410,079 | 396,587 | 398,999 |
| idle-lobby | 409,202 | 4,171 | 396,587 | 2,026 |
| one-move | 410,940 | 9,584 | 398,154 | 5,967 |
| second-client-same-move | 410,940 | 9,584 | 398,154 | 5,967 |
| one-photo-update | 410,955 | 92,767 | 398,178 | 90,450 |
| idle-after-photo | 410,955 | 4,171 | 398,178 | 2,026 |
| open-older-game | 414,003 | 414,792 | 400,530 | 403,032 |
| idle-older-game | 414,003 | 4,395 | 400,530 | 2,096 |

At 720 visible polls/hour, that idle family path is approximately 294.6 MB → 3.0 MB per client-hour; four comparable clients scale to 1178.5 MB → 12.0 MB. Hidden tabs send no requests through this polling loop. These are fixture-based projections, not measured account billing.

Version-query EXPLAIN ANALYZE used existing family/game indexes, with no shared-block reads in the warm fixture: catalog 4.329 ms, game versions 12.219 ms (20 rows). Timings are diagnostic samples, not performance guarantees.

## Rollout prerequisites

This patch requires no schema, auth, RLS, connection, storage or production-setting
change. Review the local patch and byte/query-plan receipt, then separately
approve push/PR/CI and deployment. The protected exact-commit Verify workflow and
release check remain required before publication. Existing open clients need a
reload to opt in; old clients remain compatible. After an approved deployment,
compare pooler usage over a representative period and verify two signed-in devices,
profile replacement, history and revoked access without writing synthetic scores
into real games. Rollback is a code rollback; no data rollback is needed.
