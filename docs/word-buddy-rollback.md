# Compatible Word Buddy fallback

PR53 (`1b2d3e44eb447989c03e98cd47f45134f9e4bdb8`) is not a supported
rollback deployment after Word Buddy definitions exist. Its createGame reader
omits the new definition field; hydrateGame compares the full replayed object
with the stored object and rejects it. Server checkedGame verifies immutable
definition/journal agreement and hydration before writes. This fails closed,
but prevents reading/scoring affected games. Do not loosen canonical validation.

## Concrete fallback artifact

Use the same reviewed PR54 commit as the feature deployment, built with
`NEXT_PUBLIC_AMBERLY_WORD_BUDDY_ENABLED=false`. This is a build-time setting,
not a runtime toggle. `npm run test:word-buddy:rollback` builds this variant,
tests its production server, and writes `.next/word-buddy-rollback-receipt.json`
with the exact source SHA, build ID and setting. It leaves the fallback build in
`.next`; rebuild explicitly with `NEXT_PUBLIC_AMBERLY_WORD_BUDDY_ENABLED=true`
before preparing the feature variant. CI requires the fallback check in addition
to the normal feature build, database and integrated tests and all browser shards.

The fallback hides new Word Buddy setup, private testing and word-check controls.
Its API rejects new Word Buddy creation, including requests from cached feature
clients. It retains the compatible domain reader/writer, mode labels, filtered
stats, guest projection, and draft recovery hold/explicit Resume. Existing Word
Buddy games remain Word Buddy and can be scored normally. No game is converted
to Classic, no private placements are promoted automatically, and no data is
deleted. This is a fallback from the new tools, not a return to every PR53 code
path. If the shared reader itself is defective, investigate a compatible patch
before switching; this artifact cannot promise to undo every possible defect.

## Mixed-version behavior

- PR53 domain/local/replay hydration cannot canonically hydrate new Word Buddy
  games. Shared browser reads use structural checks instead, so some old tabs can
  still display games and send ordinary commands without showing the new mode or
  tools. A client-side correction that rebuilds through the old createGame may
  drop the field in memory, but describeSharedChange rejects any definition change
  before sending it. The compatible server never accepts replacement definitions.
  Old tabs must reload for the complete compatible experience; do not claim that
  they gain new readers automatically. Classic games remain supported.
- Mutations carry commands/revisions, not replacement game snapshots. The server
  loads its authoritative definition and journal. Older-shaped commands accepted
  by the compatible server preserve absent/false/true mode fields exactly.
- New feature clients against the fallback cannot create new Word Buddy games.
  A retry of an already committed creation still recovers its original receipt.
  Existing-game commands remain supported and preserve mode; retries do not
  duplicate events. A cached private workspace may remain on screen until reload;
  explicit sharing still creates only an ordinary draft, never an automatic turn.
- Normal and fallback readers retain the immutable field through read, commands,
  retry and re-upgrade. Definitions are never replaced from a client payload;
  unexpected definition fields on command operations are rejected.
- Local/offline PR53 hydration also rejects the new shape; retain the file and
  reopen with a compatible build. No export, deletion or repair is automatic.

## Proposed release sequence — separate approval required

1. Review the current hosted migration ledger and obtain explicit authorization
   for the exact backup/restore workflow and migration. The phrase “approved
   backup” in the earlier receipt did not identify an authorized workflow and
   must not be treated as permission for a new data export. No backup/export has
   been performed by this task. Rehearsals use synthetic isolated databases.
2. Apply only the approved missing projection migration, after its authorized
   rehearsal. Retain it on rollback; it does not rewrite saved games.
3. Build/deploy the reviewed commit with the switch false first. Verify existing
   signed-in and guest reads and preserve its Ready deployment ID as the concrete
   alias rollback target. This compatibility stage is necessary because the
   currently deployed PR53 artifact cannot serve new Word Buddy definitions.
4. Build/deploy the same reviewed commit with the switch true. Record both source
   SHA/build settings and deployment IDs. Verify authorized reads, denial cases,
   mode preservation and physical-device behavior without test scores in real
   family games. A stale PR53 tab must reload before using Word Buddy.
5. If the tools must be withdrawn, repoint the alias to the retained false build;
   keep the migration and all definitions/events. Verify reads and ordinary
   scoring/retry behavior; re-enable later only via the reviewed true build.

No production deployment IDs exist for either PR54 variant yet. Local build IDs
and passing CI are evidence of rehearsal, not evidence of production readiness
or release authorization. Do not use the earlier PR53 deployment as this target.
