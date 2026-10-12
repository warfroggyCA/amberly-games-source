# Word Buddy

The scorer chooses Word Buddy when creating a Scrabble game. The immutable
definition retains that choice through hydration, corrections, history and
replay. Older definitions are Classic. Both modes use normal eligibility rules;
Word Buddy is independent of private practice and assisted endings.

Every authorized viewer can check words against the game's pinned lexicon and
verified additions. Queries stay in component memory. There are no suggestions,
external dictionary requests, game commands or saved query history.

The scorer's Test words mode reuses BoardEditor with memory-only placements and
no persistence, record, undo, extra-tile or official-search callbacks. Green
tiles and a text label identify the private editor. Leaving testing discards its
placements. Existing scoring drafts are retained separately and require explicit
Resume before sharing again. A session-storage recovery marker contains only
account/game identifiers, never test letters; unavailable recovery storage fails
closed for Word Buddy publication.

Use this play requires an explicit sharing confirmation. It rechecks revision,
current player, scorer authority/generation, pending work and the ordinary draft
before copying placements into that draft. It refuses to overwrite an existing
draft. Review and Record remain separate normal actions. Previously broadcast
letters cannot be made unseen, and in-flight clearing is not instantaneous.

Family standings, the Record Book (including personal achievements and
rivalries), and lead rankings default to All games, with Classic and Word Buddy
filters. The server separates standings rows by mode before aggregation. Lead
rankings filter authorized candidate games before loading their journals, retain
the existing bounded assessment cache, and refresh only on demand. The Record
Book filters games before computing records and retains its existing incomplete
history gate. No extra history polling or automatic browser full-history load
is introduced. In Overall standings the mode filter applies to Scrabble only;
Crokinole remains included.

The watch projection exposes only the lexicon reference and verified additions
needed by Word Buddy, under the existing guest-link authorization. It does not
expose the game definition, command journal or private test entries. Its existing
conditional hash changes when verified additions change.

Release requires separate approval and the projection migration documented in
[releasing.md](releasing.md). Once Word Buddy definitions exist, an older reader
that drops the new field is not a safe rollback target.
